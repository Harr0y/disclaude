/**
 * Executor - Executes tasks directly with a fresh agent.
 *
 * Simplified architecture:
 * - No subtask concept
 * - Direct task execution based on Evaluator's evaluation.md
 * - Outputs execution.md and optionally final_result.md
 * - Yields progress events for real-time reporting
 * - Uses Config for unified configuration
 */
import * as fs from 'fs/promises';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createAgentSdkOptions, parseSDKMessage } from '../utils/sdk.js';
import type { ParsedSDKMessage } from '../types/agent.js';
import { Config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { AgentExecutionError, TimeoutError, formatError } from '../utils/errors.js';
import { TaskFileManager } from '../task/file-manager.js';

/**
 * Executor configuration.
 */
export interface ExecutorConfig {
  /**
   * Abort signal for cancellation.
   */
  abortSignal?: AbortSignal;
}

/**
 * Progress event type for task execution.
 * These events are yielded during execution and passed to the Reporter.
 */
export type TaskProgressEvent =
  | {
      type: 'start';
      title: string;
    }
  | {
      type: 'output';
      content: string;
      messageType: string;
      metadata?: ParsedSDKMessage['metadata'];
    }
  | {
      type: 'complete';
      summaryFile: string;
      files: string[];
    }
  | {
      type: 'error';
      error: string;
    };

/**
 * Result of task execution.
 */
export interface TaskResult {
  success: boolean;
  summaryFile: string;
  files: string[];
  output: string;
  error?: string;
}

/**
 * Executor for running tasks directly.
 *
 * Yields progress events during execution without handling user communication.
 * All reporting is delegated to the Reporter via the IterationBridge layer.
 *
 * Output files:
 * - execution.md: Created in each iteration directory
 * - final_result.md: Created when task is complete
 */
export class Executor {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly apiBaseUrl?: string;
  private readonly provider: 'anthropic' | 'glm';
  private logger: ReturnType<typeof createLogger>;
  private readonly config: ExecutorConfig;
  private fileManager: TaskFileManager;

  constructor(config: ExecutorConfig) {
    this.config = config;

    // Get agent configuration from Config
    const agentConfig = Config.getAgentConfig();

    this.apiKey = agentConfig.apiKey;
    this.model = agentConfig.model;
    this.apiBaseUrl = agentConfig.apiBaseUrl;
    this.provider = agentConfig.provider;
    this.fileManager = new TaskFileManager();

    // Create logger
    this.logger = createLogger('Executor', { model: this.model });

    this.logger.debug({
      provider: agentConfig.provider,
      model: this.model,
    }, 'Executor initialized');
  }

  /**
   * Execute a task with a fresh agent.
   *
   * Reads evaluation.md for guidance and creates execution.md + final_result.md.
   *
   * Yields progress events during execution:
   * - 'start': When the task begins
   * - 'output': For each message from the agent
   * - 'complete': When the task succeeds
   * - 'error': When the task fails
   *
   * Returns the final TaskResult when complete.
   */
  async *executeTask(
    taskId: string,
    iteration: number,
    workspaceDir: string
  ): AsyncGenerator<TaskProgressEvent, TaskResult> {
    // Check for cancellation
    if (this.config?.abortSignal?.aborted) {
      throw new Error('AbortError');
    }

    await fs.mkdir(workspaceDir, { recursive: true });

    // Yield start event
    yield {
      type: 'start',
      title: 'Execute Task',
    };

    // Read evaluation.md for guidance
    let evaluationContent = '';
    try {
      evaluationContent = await this.fileManager.readEvaluation(taskId, iteration);
    } catch {
      this.logger.warn({ taskId, iteration }, 'No evaluation.md found, proceeding without guidance');
    }

    // Build the task execution prompt
    const prompt = this.buildTaskPrompt(taskId, iteration, evaluationContent);

    // Log execution start
    this.logger.debug({
      workspaceDir,
      taskId,
      iteration,
      promptLength: prompt.length,
      evaluationLength: evaluationContent.length,
    }, 'Starting task execution');

    // Prepare SDK options
    const sdkOptions = createAgentSdkOptions({
      apiKey: this.apiKey,
      model: this.model,
      apiBaseUrl: this.apiBaseUrl,
      permissionMode: 'bypassPermissions',
      cwd: workspaceDir,
    });

    let output = '';
    let error: string | undefined;

    // Get task timeout from Config (default: 5 minutes)
    const ITERATOR_TIMEOUT_MS = Config.getTaskTimeout();

    this.logger.debug({
      timeoutMs: ITERATOR_TIMEOUT_MS,
      timeoutMinutes: Math.round(ITERATOR_TIMEOUT_MS / 60000),
    }, 'Executor timeout configured');

    try {
      // Execute task with agent
      const generator = query({ prompt, options: sdkOptions });
      const iterator = generator[Symbol.asyncIterator]();

      while (true) {
        // Race between next message and timeout
        const nextPromise = iterator.next();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Iterator timeout')), ITERATOR_TIMEOUT_MS)
        );

        const result = await Promise.race([nextPromise, timeoutPromise]) as IteratorResult<unknown>;

        if (result.done) {
          break;
        }

        const message = result.value as SDKMessage;
        const parsed = parseSDKMessage(message);

        // GLM-specific logging to monitor streaming behavior
        if (this.provider === 'glm') {
          this.logger.debug({
            provider: 'GLM',
            messageType: parsed.type,
            contentLength: parsed.content?.length || 0,
            toolName: parsed.metadata?.toolName,
            stopReason: (message as any).stop_reason,
            stopSequence: (message as any).stop_sequence,
            rawMessagePreview: JSON.stringify(message).substring(0, 500),
          }, 'SDK message received (GLM)');
        }

        // Collect all content-producing messages
        if (['text', 'tool_use', 'tool_progress', 'tool_result', 'status', 'result'].includes(parsed.type)) {
          output += parsed.content;

          // Yield output event
          yield {
            type: 'output',
            content: parsed.content,
            messageType: parsed.type,
            metadata: parsed.metadata,
          };

          // Log with full content (as per logging guidelines)
          this.logger.debug({
            content: parsed.content,
            contentLength: parsed.content.length,
            messageType: parsed.type,
          }, 'Executor output');
        } else if (parsed.type === 'error') {
          error = parsed.content; // Error message is in content
          this.logger.error({ error: parsed.content }, 'Executor error');
        }
      }

      // Create execution.md in iteration directory
      await this.createExecutionFile(taskId, iteration, output, error);

      // Find all created files
      const files = await this.findCreatedFiles(workspaceDir);

      // Check if final_result.md was created by the agent
      // (used for logging, actual completion check is in IterationBridge)

      // Yield complete event
      yield {
        type: 'complete',
        summaryFile: this.fileManager.getExecutionPath(taskId, iteration),
        files,
      };

      // Return result
      return {
        success: !error,
        summaryFile: this.fileManager.getExecutionPath(taskId, iteration),
        files,
        output,
        error,
      };

    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'Iterator timeout';
      error = err instanceof Error ? err.message : String(err);

      if (isTimeout) {
        const timeoutError = new TimeoutError(
          'Task execution timeout - operation took longer than expected',
          ITERATOR_TIMEOUT_MS,
          'executeTask'
        );
        this.logger.warn({ err: formatError(timeoutError) }, 'Executor iterator timeout - task may be incomplete');
        error = timeoutError.message;
      } else {
        const agentError = new AgentExecutionError(
          'Task execution failed',
          {
            cause: err instanceof Error ? err : new Error(String(err)),
            agent: 'Executor',
            recoverable: true,
          }
        );
        this.logger.error({ err: formatError(agentError) }, 'Task execution failed');
      }

      // Create execution.md even on error
      try {
        await this.createExecutionFile(taskId, iteration, output, error);
      } catch (writeError) {
        this.logger.error({ err: writeError }, 'Failed to write execution.md');
      }

      yield {
        type: 'error',
        error,
      };

      return {
        success: false,
        summaryFile: this.fileManager.getExecutionPath(taskId, iteration),
        files: [],
        output,
        error,
      };
    }
  }

  /**
   * Build task execution prompt.
   */
  private buildTaskPrompt(taskId: string, iteration: number, evaluationContent: string): string {
    const taskMdPath = this.fileManager.getTaskSpecPath(taskId);
    const executionPath = this.fileManager.getExecutionPath(taskId, iteration);
    const finalResultPath = this.fileManager.getFinalResultPath(taskId);

    const parts: string[] = [];

    parts.push('# Task Execution');
    parts.push('');
    parts.push(`Task ID: ${taskId}`);
    parts.push(`Iteration: ${iteration}`);
    parts.push('');

    // Add evaluation guidance if available
    if (evaluationContent) {
      parts.push('## Evaluation Guidance');
      parts.push('');
      parts.push('The Evaluator has assessed the task. Here is the evaluation:');
      parts.push('');
      parts.push('```');
      parts.push(evaluationContent);
      parts.push('```');
      parts.push('');
      parts.push('---');
      parts.push('');
    }

    parts.push('## Your Job');
    parts.push('');
    parts.push(`1. Read the task specification: \`${taskMdPath}\``);
    parts.push('2. Execute the task based on the requirements and evaluation guidance');
    parts.push('3. When complete, create the following files:');
    parts.push('');
    parts.push(`**Required**: \`${executionPath}\``);
    parts.push('```markdown');
    parts.push('# Execution: Iteration ' + iteration);
    parts.push('');
    parts.push('## Summary');
    parts.push('(What you did)');
    parts.push('');
    parts.push('## Changes Made');
    parts.push('- Change 1');
    parts.push('- Change 2');
    parts.push('');
    parts.push('## Files Modified');
    parts.push('- file1.ts');
    parts.push('- file2.ts');
    parts.push('```');
    parts.push('');
    parts.push(`**If task is complete**: \`${finalResultPath}\``);
    parts.push('```markdown');
    parts.push('# Final Result');
    parts.push('');
    parts.push('Task completed successfully.');
    parts.push('');
    parts.push('## Deliverables');
    parts.push('- Deliverable 1');
    parts.push('- Deliverable 2');
    parts.push('```');
    parts.push('');
    parts.push('---');
    parts.push('');
    parts.push('**Start executing the task now.**');

    return parts.join('\n');
  }

  /**
   * Create execution.md file.
   */
  private async createExecutionFile(
    taskId: string,
    iteration: number,
    output: string,
    error?: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    const content = `# Execution: Iteration ${iteration}

**Timestamp**: ${timestamp}
**Status**: ${error ? 'Failed' : 'Completed'}

## Execution Output

${output || '(No output)'}

${error ? `## Error\n\n${error}\n` : ''}
`;

    await this.fileManager.writeExecution(taskId, iteration, content);
    this.logger.debug({ taskId, iteration }, 'Execution file created');
  }

  /**
   * Find all files created in workspace (excluding summary.md).
   */
  private async findCreatedFiles(workspaceDir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(workspaceDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name !== 'summary.md') {
          files.push(entry.name);
        }
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to list workspace files');
    }

    return files;
  }
}
