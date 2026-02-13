/**
 * Evaluator - Task completion evaluation specialist.
 *
 * **Single Responsibility**: Evaluate if a task is complete and output evaluation.md.
 *
 * **Output**: Creates `evaluation.md` in the iteration directory.
 * The file contains the evaluation result - no JSON parsing needed.
 *
 * **Tools Available**:
 * - Read, Grep, Glob: For reading task files and verifying completion
 * - Write: For creating evaluation.md
 *
 * **Tools NOT Available (intentionally restricted)**:
 * - send_user_feedback: Reporter's job, not Evaluator's
 *
 * **Completion Detection**:
 * - Task completion is determined by the presence of final_result.md (created by Executor)
 * - Evaluator's evaluation.md is used for tracking evaluation history and guiding Executor
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseSDKMessage, buildSdkEnv } from '../utils/sdk.js';
import { Config } from '../config/index.js';
import type { AgentMessage, AgentInput } from '../types/agent.js';
import { createLogger } from '../utils/logger.js';
import { loadSkillOrThrow, type ParsedSkill } from '../task/skill-loader.js';
import { TaskFileManager } from '../task/file-manager.js';
import { AgentExecutionError, TimeoutError, formatError } from '../utils/errors.js';

// Logger instance - used via this.logger in class methods

/**
 * Input type for Evaluator queries.
 */
export type EvaluatorInput = AgentInput;

/**
 * Evaluator agent configuration.
 */
export interface EvaluatorConfig {
  apiKey: string;
  model: string;
  apiBaseUrl?: string;
  permissionMode?: 'default' | 'bypassPermissions';
  /** Optional subdirectory for task files (e.g., 'regular' for CLI tasks) */
  subdirectory?: string;
}

/**
 * Type for permission mode.
 */
export type EvaluatorPermissionMode = 'default' | 'bypassPermissions';

/**
 * Evaluator - Task completion evaluation specialist.
 *
 * Simplified architecture:
 * - No JSON output - writes evaluation.md directly
 * - No structured result parsing
 * - File-driven workflow
 */
export class Evaluator {
  readonly apiKey: string;
  readonly model: string;
  readonly apiBaseUrl?: string;
  readonly permissionMode: EvaluatorPermissionMode;
  protected skill?: ParsedSkill;
  protected initialized = false;
  private fileManager: TaskFileManager;
  private readonly provider: 'anthropic' | 'glm';

  private readonly logger = createLogger('Evaluator');

  constructor(config: EvaluatorConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiBaseUrl = config.apiBaseUrl;
    this.permissionMode = config.permissionMode || 'bypassPermissions';
    this.fileManager = new TaskFileManager(Config.getWorkspaceDir(), config.subdirectory);

    // Detect provider from API base URL
    const agentConfig = Config.getAgentConfig();
    this.provider = agentConfig.provider;
  }

  /**
   * Initialize the Evaluator agent.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load skill (required)
    this.skill = await loadSkillOrThrow('evaluator');
    this.logger.debug({
      skillName: this.skill.name,
      toolCount: this.skill.allowedTools.length,
    }, 'Evaluator skill loaded');

    this.initialized = true;
    this.logger.debug('Evaluator initialized');
  }

  /**
   * Query the Evaluator agent with streaming response.
   *
   * @param input - Prompt or message array
   * @returns Async iterable of agent messages
   */
  async *queryStream(input: EvaluatorInput): AsyncIterable<AgentMessage> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Create SDK options for Evaluator
    // Skill is required, so allowedTools is always defined
    const allowedTools = this.skill!.allowedTools;
    // Note: send_user_feedback, send_file_to_feishu are intentionally NOT included (Reporter's job)

    const sdkOptions: Record<string, unknown> = {
      cwd: Config.getWorkspaceDir(),
      permissionMode: this.permissionMode,
      allowedTools,
      settingSources: ['project'],
      // No MCP servers needed - Evaluator only uses file reading/writing tools
    };

    // Set environment
    sdkOptions.env = buildSdkEnv(this.apiKey, this.apiBaseUrl);

    // Set model
    if (this.model) {
      sdkOptions.model = this.model;
    }

    const ITERATOR_TIMEOUT_MS = 30000; // 30 seconds timeout for iterator

    try {
      // Query SDK with timeout protection
      const queryResult = query({ prompt: input, options: sdkOptions as any });
      const iterator = queryResult[Symbol.asyncIterator]();

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

        // Yield formatted message
        yield {
          content: parsed.content,
          role: 'assistant',
          messageType: parsed.type,
          metadata: parsed.metadata,
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Iterator timeout') {
        const timeoutError = new TimeoutError(
          'Evaluator query timeout - unable to complete evaluation',
          ITERATOR_TIMEOUT_MS,
          'queryStream'
        );
        this.logger.warn({ err: formatError(timeoutError) }, 'Iterator timeout - returning partial results');
        yield {
          content: '⚠️ Query timeout - unable to complete evaluation',
          role: 'assistant',
          messageType: 'error',
        };
      } else {
        const agentError = new AgentExecutionError(
          'Evaluator query failed',
          {
            cause: error instanceof Error ? error : new Error(String(error)),
            agent: 'Evaluator',
            recoverable: true,
          }
        );
        this.logger.error({ err: formatError(agentError) }, 'Evaluator query failed');
        yield {
          content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
          role: 'assistant',
          messageType: 'error',
        };
      }
    }
  }

  /**
   * Evaluate if the task is complete (streaming version).
   *
   * The Evaluator will create evaluation.md in the iteration directory.
   * No structured result is returned - callers should check the file.
   *
   * @param taskId - Task identifier
   * @param iteration - Current iteration number
   * @returns Async iterable of agent messages
   */
  async *evaluate(
    taskId: string,
    iteration: number
  ): AsyncIterable<AgentMessage> {
    // Ensure iteration directory exists
    await this.fileManager.createIteration(taskId, iteration);

    // Build the prompt
    const prompt = this.buildEvaluationPrompt(taskId, iteration);

    this.logger.debug({
      taskId,
      iteration,
    }, 'Starting evaluation');

    // Stream messages from queryStream
    for await (const msg of this.queryStream(prompt)) {
      yield msg;
    }

    this.logger.debug({
      taskId,
      iteration,
    }, 'Evaluation completed');
  }

  /**
   * Build evaluation prompt for Evaluator.
   */
  private buildEvaluationPrompt(taskId: string, iteration: number): string {
    const taskMdPath = this.fileManager.getTaskSpecPath(taskId);
    const evaluationPath = this.fileManager.getEvaluationPath(taskId, iteration);

    let previousExecutionPath: string | null = null;
    if (iteration > 1) {
      previousExecutionPath = this.fileManager.getExecutionPath(taskId, iteration - 1);
    }

    let prompt = `# Evaluator Task

## Context
- Task ID: ${taskId}
- Iteration: ${iteration}

## Your Job

1. Read the task specification:
   \`${taskMdPath}\`
`;

    if (previousExecutionPath) {
      prompt += `
2. Read the previous execution output:
   \`${previousExecutionPath}\`
`;
    } else {
      prompt += `
2. This is the first iteration - no previous execution exists.
`;
    }

    prompt += `
3. Evaluate if the task is complete based on Expected Results

4. Write your evaluation to:
   \`${evaluationPath}\`

## Output Format for evaluation.md

\`\`\`markdown
# Evaluation: Iteration ${iteration}

## Status
[COMPLETE | NEED_EXECUTE]

## Assessment
（你的评估理由）

## Next Actions (only if NEED_EXECUTE)
- Action 1
- Action 2
\`\`\`

## Status Rules

### COMPLETE
When ALL conditions are met:
- ✅ All Expected Results satisfied
- ✅ Code actually modified (not just explained)
- ✅ Build passed (if required)
- ✅ Tests passed (if required)

### NEED_EXECUTE
When ANY condition is true:
- ❌ First iteration (no previous execution)
- ❌ Executor only explained (no code changes)
- ❌ Build failed or tests failed
- ❌ Expected Results not fully satisfied

## Important Notes

- Write the file to \`${evaluationPath}\`
- Do NOT output JSON - write markdown directly
- Task completion is detected by final_result.md (created by Executor)

**Now start your evaluation.**`;

    return prompt;
  }

  /**
   * Cleanup resources.
   */
  cleanup(): void {
    this.logger.debug('Evaluator cleaned up');
    this.initialized = false;
  }
}
