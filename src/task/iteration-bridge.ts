/**
 * IterationBridge - Simplified Evaluator-Planner-Executor communication with REAL-TIME streaming.
 *
 * **Architecture (P0 - Direct Evaluator → Planner + Executor):**
 * - Phase 1: Evaluator evaluates task completion and calls task_done if complete
 * - Phase 2: If not complete, Planner breaks down task into subtasks
 * - Phase 3: Executor executes subtasks sequentially with isolated agents
 *
 * **Key Components:**
 * - **Evaluator** (Phase 1): Specialized in task completion evaluation
 * - **TaskPlanner** (Phase 2): Breaks down tasks into subtasks
 * - **Worker** (Phase 3 - simple): Executes simple tasks directly
 * - **SubtaskExecutor** (Phase 3 - complex): Executes individual subtasks from plan
 *
 * **Plan-and-Execute Architecture:**
 * - TaskPlanner decomposes complex tasks into subtasks
 * - For simple tasks: Worker executes directly
 * - For complex tasks: SubtaskExecutor runs each subtask with fresh Worker instances
 * - Each subtask executed by fresh agent instance (isolation)
 * - Sequential handoff with context passing
 * - Results aggregated for final output
 *
 * **Real-time Streaming:**
 * - All agent messages are yielded immediately for user feedback
 * - Subtask progress tracked and reported in real-time
 *
 * **Direct Architecture:**
 * - Evaluator provides missing_items directly to next execution phase
 * - No Manager intermediate layer - simpler and faster
 */

import type { AgentMessage } from '../types/agent.js';
import { extractText } from '../utils/sdk.js';
import { Evaluator, type EvaluatorConfig, type EvaluationResult } from './evaluator.js';
import { TaskPlanner } from '../long-task/planner.js';
import { SubtaskExecutor } from '../long-task/executor.js';
import type { LongTaskConfig, SubtaskResult, LongTaskPlan } from '../long-task/types.js';
import { createLogger } from '../utils/logger.js';
import { parseTaskMd } from './prompt-builder.js';
import { Config } from '../config/index.js';

const logger = createLogger('IterationBridge', {});

/**
 * Result of a single iteration.
 */
export interface IterationResult {
  /** All messages produced during iteration */
  messages: AgentMessage[];
  /** Accumulated Worker output text */
  workerOutput: string;
  /** Accumulated Manager output text */
  managerOutput: string;
  /** Whether Worker completed its work (sent 'result' message) */
  workerComplete: boolean;
  /** Whether Manager called task_done to signal completion */
  taskDone: boolean;
}

/**
 * Configuration for IterationBridge.
 */
export interface IterationBridgeConfig {
  /** Planner configuration for task planning */
  plannerConfig: {
    apiKey: string;
    model: string;
    apiBaseUrl?: string;
  };
  /** Executor configuration for subtask execution */
  executorConfig: LongTaskConfig;
  /** Evaluator configuration */
  evaluatorConfig: EvaluatorConfig;
  /** Full Task.md content */
  taskMdContent: string;
  /** Current iteration number */
  iteration: number;
  /** Previous Worker output (for iteration > 1) */
  previousWorkerOutput?: string;
  /** Chat ID for user feedback (passed from DialogueOrchestrator) */
  chatId?: string;
}

/**
 * IterationBridge - Simplified Evaluator-Planner-Executor communication for a single iteration.
 *
 * Usage:
 * ```typescript
 * const bridge = new IterationBridge({
 *   plannerConfig: { apiKey, model },
 *   executorConfig: { apiKey, model, sendMessage, sendCard, chatId },
 *   evaluatorConfig: { apiKey, model },
 *   taskMdContent,
 *   iteration: 1,
 * });
 *
 * for await (const msg of bridge.runIterationStreaming()) {
 *   // Handle real-time messages
 * }
 * ```
 */
export class IterationBridge {
  readonly plannerConfig: { apiKey: string; model: string; apiBaseUrl?: string };
  readonly executorConfig: LongTaskConfig;
  readonly evaluatorConfig: EvaluatorConfig;
  readonly taskMdContent: string;
  readonly iteration: number;
  readonly previousWorkerOutput?: string;
  readonly chatId?: string;

  // Completion tracking
  private taskDoneSignaled = false;  // Set when Evaluator calls task_done
  private workerToManagerQueue: AgentMessage[] = [];
  private workerDone = false;

  constructor(config: IterationBridgeConfig) {
    this.plannerConfig = config.plannerConfig;
    this.executorConfig = config.executorConfig;
    this.evaluatorConfig = config.evaluatorConfig;
    this.taskMdContent = config.taskMdContent;
    this.iteration = config.iteration;
    this.previousWorkerOutput = config.previousWorkerOutput;
    this.chatId = config.chatId;
  }

  /**
   * Run a single iteration with DIRECT Evaluator → Planner/Executor communication.
   *
   * **Plan-and-Execute architecture (P0):**
   * - Phase 1: Evaluator evaluates task completion, calls task_done if complete
   * - Phase 2: If not complete, always use Planner to break down task, then Executor executes subtasks
   *
   * Key design:
   * - task_done decision happens in Phase 1 (Evaluator)
   * - First iteration: No task_done possible (no Worker output yet)
   * - Evaluator provides missing_items directly to execution phase
   * - All tasks use TaskPlanner → SubtaskExecutor flow (no simple/direct mode)
   *
   * @returns Async iterable of AgentMessage
   */
  async *runIterationStreaming(): AsyncIterable<AgentMessage> {
    logger.info({
      iteration: this.iteration,
    }, 'Starting three-phase IterationBridge iteration with Evaluator (Plan-and-Execute Architecture)');

    // Reset state for this iteration
    this.workerToManagerQueue = [];
    this.workerDone = false;
    this.taskDoneSignaled = false;

    // === Phase 1a: Evaluation - Evaluator decides if task is complete ===
    const evaluator = new Evaluator(this.evaluatorConfig);
    await evaluator.initialize();

    let evaluationResult: EvaluationResult;

    try {
      logger.debug({
        iteration: this.iteration,
      }, 'Phase 1a: Evaluation - Evaluator assessing task completion');

      evaluationResult = await this.evaluateCompletion(evaluator);

      if (evaluationResult.is_complete) {
        logger.info({
          iteration: this.iteration,
          reason: evaluationResult.reason,
          confidence: evaluationResult.confidence,
        }, 'Evaluator determined task is complete - ending iteration without Worker');

        this.taskDoneSignaled = true;
        evaluator.cleanup();

        // ✨ P0 FIX: Yield a completion signal message so DialogueOrchestrator knows task is done
        yield {
          content: `Task completed: ${evaluationResult.reason}`,
          role: 'assistant',
          messageType: 'task_completion',
          metadata: {
            status: 'complete',
          },
        };

        return;  // Early return - task complete, no Worker needed
      }

      logger.info({
        iteration: this.iteration,
        reason: evaluationResult.reason,
        missingItems: evaluationResult.missing_items,
      }, 'Evaluator determined task is not complete - continuing to Phase 1b');

    } finally {
      evaluator.cleanup();
    }

    // === Phase 2: Execution with Evaluator's feedback ===
    // Parse Task.md to extract metadata and user request
    const taskMetadata = parseTaskMd(this.taskMdContent);

    // Determine task path from Task.md (fallback to taskId if not found)
    // Task.md is typically at workspace/tasks/{taskId}/Task.md
    const taskPath = `workspace/tasks/${taskMetadata.messageId}/Task.md`;

    // Format Evaluator output as execution instruction
    const executionInstruction = this.formatEvaluatorOutputAsInstruction(evaluationResult);

    logger.debug({
      iteration: this.iteration,
      instructionLength: executionInstruction.length,
      chatId: taskMetadata.chatId || this.chatId,
      messageId: taskMetadata.messageId,
    }, 'Phase 2: Execution phase with Evaluator feedback (streaming to user)');

    // Always use planning mode (Plan-and-Execute architecture)
    logger.info('Using Plan-and-Execute mode with TaskPlanner and SubtaskExecutor');
    yield* this.executeWithPlanning(executionInstruction, taskMetadata);

    logger.info({
      iteration: this.iteration,
      totalMessages: this.workerToManagerQueue.length,
    }, 'Phase 2: Execution phase complete (streamed to user)');
  }

  /**
   * Execute task with planning and multi-agent relay (complex tasks).
   */
  private async *executeWithPlanning(
    instruction: string,
    taskMetadata: { chatId?: string; messageId: string; userRequest: string }
  ): AsyncIterable<AgentMessage> {
    // Phase 1: Create plan
    yield {
      content: '📋 **Planning Phase**\n\nAnalyzing task and creating execution plan...',
      role: 'assistant',
      messageType: 'progress',
    };

    const planner = new TaskPlanner(
      this.plannerConfig.apiKey,
      this.plannerConfig.model,
      this.plannerConfig.apiBaseUrl
    );
    let plan: LongTaskPlan;

    try {
      plan = await planner.planTask(instruction, {
        model: this.plannerConfig.model,
      });

      logger.info({
        taskId: plan.taskId,
        subtasks: plan.totalSteps,
      }, 'Task plan created');

      yield {
        content: `✅ **Plan Created**: ${plan.title}\n\n**Steps**: ${plan.totalSteps}\n\n${plan.subtasks.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}\n\n⏳ Starting execution...`,
        role: 'assistant',
        messageType: 'progress',
      };
    } catch (error) {
      logger.error({ err: error }, 'Planning failed - cannot proceed without execution plan');
      yield {
        content: `❌ **Planning Failed**: ${error instanceof Error ? error.message : String(error)}`,
        role: 'assistant',
        messageType: 'error',
      };
      // Cannot proceed without a plan - rethrow the error
      throw error;
    }

    // Phase 2: Execute subtasks with SubtaskExecutor
    const subtaskResults: SubtaskResult[] = [];

    for (let i = 0; i < plan.subtasks.length; i++) {
      const subtask = plan.subtasks[i];
      const subtaskNumber = i + 1;

      logger.debug({
        subtaskNumber,
        title: subtask.title,
      }, 'Executing subtask');

      yield {
        content: `🔄 **Step ${subtaskNumber}/${plan.totalSteps}**: ${subtask.title}`,
        role: 'assistant',
        messageType: 'progress',
      };

      const executor = new SubtaskExecutor(
        this.executorConfig.apiKey,
        this.executorConfig.model,
        this.executorConfig
      );

      try {
        const result = await executor.executeSubtask(
          subtask,
          subtaskResults,
          Config.getWorkspaceDir()
        );

        subtaskResults.push(result);

        // Store result for Evaluator's evaluation
        this.workerToManagerQueue.push({
          content: `Step ${subtaskNumber} completed: ${subtask.title}\n\n${result.summary}`,
          role: 'assistant',
          messageType: 'text',
        });

        if (!result.success) {
          yield {
            content: `❌ **Step ${subtaskNumber} failed**, stopping execution`,
            role: 'assistant',
            messageType: 'error',
          };
          break;
        }

        yield {
          content: `✅ **Step ${subtaskNumber} completed**: ${subtask.title}`,
          role: 'assistant',
          messageType: 'progress',
        };
      } catch (error) {
        logger.error({
          err: error,
          subtaskNumber,
        }, 'Subtask execution failed');

        yield {
          content: `❌ **Step ${subtaskNumber} failed**: ${error instanceof Error ? error.message : String(error)}`,
          role: 'assistant',
          messageType: 'error',
        };
        break;
      }
    }

    // Phase 3: Aggregate and finalize
    const completedSteps = subtaskResults.filter(r => r.success).length;
    const finalOutput = subtaskResults.map(r => r.summary).join('\n\n---\n\n');

    yield {
      content: `🎉 **Multi-Agent Relay Complete**\n\n**Completed**: ${completedSteps}/${plan.totalSteps} steps\n\n**Summary**:\n\n${finalOutput}`,
      role: 'assistant',
      messageType: 'result',
      metadata: {
        usedPlanning: true,
        subtaskCount: plan.totalSteps,
      },
    };

    this.workerDone = true;
  }

  /**
   * Legacy method: Run a single iteration and return buffered results.
   *
   * @deprecated Use runIterationStreaming() for real-time user feedback.
   * This method is kept for backward compatibility.
   */
  async runIteration(): Promise<IterationResult> {
    logger.info({ iteration: this.iteration }, 'Using LEGACY buffered runIteration (deprecated)');

    const messages: AgentMessage[] = [];
    const managerOutputBuf: string[] = [];

    // Collect all messages from the streaming version
    for await (const msg of this.runIterationStreaming()) {
      messages.push(msg);

      // Collect text from non-tool messages (Manager output)
      if (msg.messageType !== 'tool_use') {
        const text = extractText(msg);
        if (text) {
          managerOutputBuf.push(text);
        }
      }
    }

    // Worker output is in the queue
    const workerOutput = this.collectWorkerResults();

    return {
      messages,
      workerOutput,
      managerOutput: managerOutputBuf.join(''),
      workerComplete: this.workerDone,
      taskDone: this.taskDoneSignaled,
    };
  }

  /**
   * Evaluate task completion using Evaluator.
   *
   * Phase 1: Evaluator assesses whether the task is complete.
   * Returns structured evaluation result with missing_items.
   *
   * @param evaluator - Evaluator instance
   * @returns Evaluation result
   */
  private async evaluateCompletion(evaluator: Evaluator): Promise<EvaluationResult> {
    // Query Evaluator and parse result
    const { result } = await evaluator.evaluate(
      this.taskMdContent,
      this.iteration,
      this.previousWorkerOutput
    );

    logger.debug({
      iteration: this.iteration,
      isComplete: result.is_complete,
      reason: result.reason,
      missingItems: result.missing_items,
      confidence: result.confidence,
    }, 'Evaluator result received');

    return result;
  }

  /**
   * Format Evaluator's output as execution instruction.
   *
   * Converts EvaluationResult into clear, actionable instructions for execution.
   *
   * @param evaluationResult - Result from Evaluator
   * @returns Formatted instruction string for execution
   */
  private formatEvaluatorOutputAsInstruction(evaluationResult: EvaluationResult): string {
    // If no missing items but also not complete (edge case), use reason
    if (evaluationResult.missing_items.length === 0) {
      return evaluationResult.reason;
    }

    // Format missing_items as clear instructions
    let instruction = 'Based on the evaluation, the following items need to be addressed:\n\n';
    instruction += evaluationResult.missing_items.map((item, i) => `${i + 1}. ${item}`).join('\n');
    instruction += '\n\nPlease complete these items to fulfill the task requirements.';

    return instruction;
  }

  /**
   * Collect Worker results from the message queue.
   *
   * @returns Worker's output text
   */
  private collectWorkerResults(): string {
    const results: string[] = [];
    for (const msg of this.workerToManagerQueue) {
      const text = extractText(msg);
      if (text) {
        results.push(text);
      }
    }
    return results.join('\n');
  }

  /**
   * Get the Worker's output from the most recent iteration.
   * This should be called after runIterationStreaming() completes.
   *
   * @returns Worker's output text
   */
  getWorkerOutput(): string {
    return this.collectWorkerResults();
  }

}
