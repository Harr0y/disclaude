/**
 * IterationBridge - Simplified Evaluator-Executor communication with REAL-TIME streaming.
 *
 * **Architecture (File-Driven - Direct Evaluator → Executor):**
 * - Phase 1: Evaluator evaluates task completion and writes evaluation.md
 * - Phase 2: If final_result.md not present, Executor executes the task
 *
 * **Key Components:**
 * - **Evaluator** (Phase 1): Writes evaluation.md to iteration directory
 * - **Executor** (Phase 2): Reads evaluation.md, executes, writes execution.md
 *
 * **File-Driven Architecture:**
 * - No JSON parsing - all communication via markdown files
 * - No Planner layer - Executor executes tasks directly
 * - No subtask concept - Single task execution
 * - Completion detected via final_result.md presence
 *
 * **Real-time Streaming:**
 * - All agent messages are yielded immediately for user feedback
 * - Task progress tracked and reported in real-time
 *
 * **Non-blocking Reporter:**
 * - Reporter runs asynchronously and does not block Executor
 * - Reporter messages are queued and yielded alongside Executor output
 * - Executor completion is returned immediately, Reporter feedback arrives later
 */

import type { AgentMessage } from '../types/agent.js';
import { Evaluator, type EvaluatorConfig } from '../agents/evaluator.js';
import { Reporter } from '../agents/reporter.js';
import { Executor, type TaskProgressEvent, type TaskResult } from '../agents/executor.js';
import { createLogger } from '../utils/logger.js';
import { TaskFileManager } from './file-manager.js';
import { Config } from '../config/index.js';

const logger = createLogger('IterationBridge', {});

/**
 * Internal message types for the async queue.
 */
type QueueMessage =
  | { type: 'executor'; message: AgentMessage }
  | { type: 'reporter'; message: AgentMessage }
  | { type: 'executor_done'; result?: TaskResult }
  | { type: 'reporter_done' };

/**
 * Result of a single iteration.
 */

/**
 * Result of a single iteration.
 */
export interface IterationResult {
  /** All messages produced during iteration */
  messages: AgentMessage[];
  /** Accumulated Executor output text */
  workerOutput: string;
  /** Accumulated Manager output text */
  managerOutput: string;
  /** Whether Executor completed its work (sent 'result' message) */
  workerComplete: boolean;
}

/**
 * Configuration for IterationBridge.
 */
export interface IterationBridgeConfig {
  /** Evaluator configuration */
  evaluatorConfig: EvaluatorConfig;
  /** Current iteration number */
  iteration: number;
  /** Task ID for file management */
  taskId: string;
  /** Chat ID for user feedback (passed from DialogueOrchestrator) */
  chatId?: string;
}

/**
 * IterationBridge - Simplified Evaluator-Executor communication for a single iteration.
 *
 * File-driven architecture:
 * - Evaluator writes evaluation.md
 * - Executor reads evaluation.md and writes execution.md + final_result.md
 * - Completion detected by checking final_result.md existence
 */
export class IterationBridge {
  readonly evaluatorConfig: EvaluatorConfig;
  readonly iteration: number;
  readonly taskId: string;
  readonly chatId?: string;

  private fileManager: TaskFileManager;

  constructor(config: IterationBridgeConfig) {
    this.evaluatorConfig = config.evaluatorConfig;
    this.iteration = config.iteration;
    this.taskId = config.taskId;
    this.chatId = config.chatId;
    this.fileManager = new TaskFileManager();
  }

  /**
   * Run a single iteration with DIRECT Evaluator → Executor communication.
   */
  async *runIterationStreaming(): AsyncIterable<AgentMessage> {
    logger.info({
      iteration: this.iteration,
      taskId: this.taskId,
    }, 'Starting iteration');

    // === Phase 1: Evaluation ===
    const evaluator = new Evaluator(this.evaluatorConfig);

    try {
      // Evaluator writes evaluation.md
      for await (const msg of evaluator.evaluate(this.taskId, this.iteration)) {
        yield msg;
      }

      logger.info({
        iteration: this.iteration,
        taskId: this.taskId,
      }, 'Evaluation phase complete');
    } finally {
      evaluator.cleanup();
    }

    // Check if task is already complete (final_result.md exists)
    const hasFinalResult = await this.fileManager.hasFinalResult(this.taskId);

    if (hasFinalResult) {
      logger.info({
        iteration: this.iteration,
        taskId: this.taskId,
      }, 'Task complete (final_result.md detected) - ending without Executor');

      yield {
        content: '✅ Task completed - final result detected',
        role: 'assistant',
        messageType: 'task_completion',
        metadata: { status: 'complete' },
      };

      return;
    }

    // === Phase 2: Execution ===
    logger.debug({
      iteration: this.iteration,
      taskId: this.taskId,
    }, 'Phase 2: Execution phase');

    yield* this.executeTask();

    logger.info({
      iteration: this.iteration,
      taskId: this.taskId,
    }, 'Execution phase complete');
  }

  /**
   * Execute task - reads evaluation.md and writes execution.md.
   *
   * Uses a non-blocking architecture where:
   * - Executor output is yielded immediately
   * - Reporter runs asynchronously in the background
   * - Reporter messages are yielded as they arrive
   * - Executor completion is returned without waiting for Reporter
   */
  private async *executeTask(): AsyncIterable<AgentMessage> {
    yield {
      content: '⚡ **Executing Task**\n\nProcessing task directly...',
      role: 'assistant',
      messageType: 'status',
    };

    const agentConfig = Config.getAgentConfig();
    const reporter = new Reporter({
      apiKey: agentConfig.apiKey,
      model: agentConfig.model,
      apiBaseUrl: agentConfig.apiBaseUrl,
      permissionMode: 'bypassPermissions',
    });
    await reporter.initialize();

    // Create async queue for non-blocking Reporter
    const queue: QueueMessage[] = [];
    let executorDone = false;
    let reporterDone = true; // Starts as true until we have a Reporter task

    // Helper to wait for next message in queue
    const waitForQueueMessage = (): Promise<QueueMessage> => {
      return new Promise((resolve) => {
        const check = () => {
          if (queue.length > 0) {
            resolve(queue.shift()!);
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
    };

    // Helper to run Reporter asynchronously (non-blocking)
    const runReporterAsync = (prompt: string) => {
      reporterDone = false;
      logger.debug({ taskId: this.taskId }, 'Starting async Reporter');

      // Use void operator to explicitly not await the async IIFE
      void (async () => {
        try {
          for await (const msg of reporter.queryStream(prompt)) {
            queue.push({ type: 'reporter', message: msg });
          }
          queue.push({ type: 'reporter_done' });
        } catch (error) {
          logger.warn({
            err: error,
            taskId: this.taskId,
          }, 'Reporter async failed');
          queue.push({
            type: 'reporter',
            message: {
              content: `❌ Reporter error: ${error instanceof Error ? error.message : String(error)}`,
              role: 'assistant',
              messageType: 'error',
            },
          });
          queue.push({ type: 'reporter_done' });
        }
      })();
    };

    try {
      const executor = new Executor({});

      // Start Executor in background
      const executorGenerator = executor.executeTask(
        this.taskId,
        this.iteration,
        Config.getWorkspaceDir()
      );

      // Process Executor events
      const processExecutor = async () => {
        let result: IteratorResult<TaskProgressEvent, TaskResult>;
        while (!(result = await executorGenerator.next()).done) {
          const event = result.value;

          if (event.type === 'output') {
            queue.push({
              type: 'executor',
              message: {
                content: event.content,
                role: 'assistant',
                messageType: event.messageType as any,
                metadata: event.metadata,
              },
            });
          } else {
            // Start Reporter for non-output events (start, complete, error)
            const prompt = this.buildReporterPrompt(event, {
              taskId: this.taskId,
              iteration: this.iteration,
              chatId: this.chatId,
            });
            if (prompt) {
              runReporterAsync(prompt);
            }
          }
        }
        queue.push({ type: 'executor_done', result: result.value });
      };

      // Start Executor processing
      const executorPromise = processExecutor();

      // Yield messages from queue until both Executor and Reporter are done
      while (true) {
        const msg = await waitForQueueMessage();

        if (msg.type === 'executor') {
          yield msg.message;
        } else if (msg.type === 'reporter') {
          yield msg.message;
        } else if (msg.type === 'executor_done') {
          executorDone = true;
          // Yield completion message immediately
          if (msg.result) {
            if (msg.result.success) {
              yield {
                content: `✅ **Task Execution Complete**\n\n**Summary**: ${msg.result.summaryFile}`,
                role: 'assistant',
                messageType: 'result',
              };
            } else {
              yield {
                content: `⚠️ **Task Execution Completed**\n\nError: ${msg.result.error || 'Unknown error'}`,
                role: 'assistant',
                messageType: 'result',
              };
            }
          }
          // Don't break - continue yielding Reporter messages if any
        } else if (msg.type === 'reporter_done') {
          reporterDone = true;
        }

        // Exit when both Executor and Reporter are done
        if (executorDone && reporterDone) {
          break;
        }
      }

      // Ensure Executor promise completes
      await executorPromise;

    } catch (error) {
      logger.error({
        err: error,
        taskId: this.taskId,
        iteration: this.iteration,
      }, 'Task execution failed');

      yield {
        content: `❌ **Task execution failed**: ${error instanceof Error ? error.message : String(error)}`,
        role: 'assistant',
        messageType: 'error',
      };
    } finally {
      reporter.cleanup();
    }
  }

  /**
   * Build Reporter prompt with Chat ID context.
   *
   * This method creates detailed prompts that include:
   * - Chat ID for Feishu tool calls
   * - Explicit instructions to send report files
   * - Clear action items for the Reporter agent
   */
  private buildReporterPrompt(event: TaskProgressEvent, context: {
    taskId: string;
    iteration: number;
    chatId?: string;
  }): string {
    const { taskId, iteration, chatId } = context;

    switch (event.type) {
      case 'start':
        return `## Task Started

**Task ID**: ${taskId}
**Iteration**: ${iteration}
**Task**: ${event.title}

Inform the user that task execution has started.`;

      case 'complete': {
        if (!chatId) {
          return `## Task Completed

Send a completion message to the user.`;
        }

        return `## Task Completed

**Task ID**: ${taskId}

The task execution has completed. Check what was created and notify the user appropriately.

**Chat ID**: \`${chatId}\``;
      }

      case 'error':
        if (!chatId) {
          return `## Task Failed

**Error**: ${event.error}

Report the error to the user.`;
        }

        return `## Task Failed

**Error**: ${event.error}

---

## 🎯 Your Task

Send error feedback to the user using \`send_user_feedback\`:

\`\`\`
send_user_feedback({
  format: "text",
  content: "❌ Task execution failed: ${event.error.replace(/"/g, '\\"')}",
  chatId: "${chatId}"
})
\`\`\`

**Chat ID**: \`${chatId}\`

**⚠️ IMPORTANT**: You MUST use send_user_feedback tool. Do not just output text.`;

      case 'output':
        return ''; // Output events are yielded directly, not sent to Reporter

      default:
        return '';
    }
  }

  /**
   * Get the Executor's output from the execution.md file.
   */
  async getExecutorOutput(): Promise<string> {
    try {
      return await this.fileManager.readExecution(this.taskId, this.iteration);
    } catch {
      return '';
    }
  }
}
