/**
 * DialogueOrchestrator - Manages streaming dialogue with Plan-and-Execute architecture.
 *
 * ## Architecture: Plan-and-Execute (P0)
 *
 * - Phase 1: Evaluator evaluates task completion
 * - Phase 2: Planner/Executor executes tasks with Evaluator's feedback
 * - Direct architecture: No Manager intermediate layer
 * - Loop continues until max iterations reached or task complete
 *
 * ## Key Changes from Previous Architecture
 *
 * **BEFORE (Manager-Worker)**:
 * - Manager (evaluate + instruct) → Worker (execute) → Manager (feedback)
 * - 3 agent instances per iteration
 * - Manager as intermediate layer
 *
 * **AFTER (Plan-and-Execute)**:
 * - Evaluator (evaluate) → Planner/Executor (plan + execute with multi-agent relay)
 * - 2 agent instances per iteration (Evaluator + Worker/Planner+Executor)
 * - Direct feedback from Evaluator to execution phase
 *
 * ## Plan-and-Execute Flow
 *
 * - TaskPlanner breaks down complex tasks into subtasks
 * - SubtaskExecutor executes each subtask with fresh Worker instances
 * - Simple tasks: Worker executes directly
 * - Complex tasks: TaskPlanner + SubtaskExecutor coordinate
 * - Sequential handoff with context passing
 * - Results aggregated for final output
 *
 * ## No Session State Across Iterations
 *
 * - Each iteration creates FRESH agent instances via IterationBridge
 * - Context is maintained via previousWorkerOutput storage between iterations
 * - No cross-iteration session IDs needed
 */
import type { AgentMessage } from '../types/agent.js';
import { DIALOGUE } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';
import { extractText } from '../utils/sdk.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { EvaluatorConfig } from './evaluator.js';
import type { LongTaskConfig } from '../long-task/types.js';
import { IterationBridge } from './iteration-bridge.js';
import { TaskPlanExtractor, type TaskPlanData } from '../long-task/task-plan-extractor.js';
import { DialogueMessageTracker } from './dialogue-message-tracker.js';
import { isTaskDoneTool } from './mcp-utils.js';

const logger = createLogger('DialogueOrchestrator', {});

/**
 * Dialogue orchestrator configuration.
 */
export interface DialogueOrchestratorConfig {
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
  /** Callback when task plan is generated */
  onTaskPlanGenerated?: (plan: TaskPlanData) => Promise<void>;
}

/**
 * DialogueOrchestrator - Manages streaming dialogue loop with Plan-and-Execute.
 *
 * Refactored from AgentDialogueBridge to focus on orchestration only.
 * - Task plan extraction delegated to TaskPlanExtractor
 * - Message tracking delegated to DialogueMessageTracker
 * - Uses IterationBridge for single iterations
 *
 * NEW Streaming Flow:
 * 1. Each iteration: Evaluator and Planner/Executor run via IterationBridge
 * 2. Evaluator evaluates completion → Planner/Executor plans and executes
 * 3. For complex tasks: TaskPlanner breaks down → SubtaskExecutor executes subtasks
 * 4. For simple tasks: Worker executes directly
 * 5. When execution completes, iteration ends
 * 6. Loop continues until max iterations reached
 *
 * **User Communication:**
 * - Agent output is streamed directly to users
 * - Progress updates provided in real-time
 * - Evaluator controls task completion signaling
 */
export class DialogueOrchestrator {
  readonly plannerConfig: { apiKey: string; model: string; apiBaseUrl?: string };
  readonly executorConfig: LongTaskConfig;
  readonly evaluatorConfig: EvaluatorConfig;
  /** Maximum iterations from constants - single source of truth */
  readonly maxIterations = DIALOGUE.MAX_ITERATIONS;
  private readonly onTaskPlanGenerated?: (plan: TaskPlanData) => Promise<void>;
  private readonly taskPlanExtractor: TaskPlanExtractor;
  private readonly messageTracker: DialogueMessageTracker;

  private taskId: string = '';
  private originalRequest: string = '';
  private taskPlanSaved = false;
  private currentIterationTaskDone = false;
  private currentChatId?: string;

  // Store previous Worker output for Evaluator evaluation in next iteration
  private previousWorkerOutput?: string;

  constructor(config: DialogueOrchestratorConfig) {
    this.plannerConfig = config.plannerConfig;
    this.executorConfig = config.executorConfig;
    this.evaluatorConfig = config.evaluatorConfig;
    this.onTaskPlanGenerated = config.onTaskPlanGenerated;

    // Initialize extracted services
    this.taskPlanExtractor = new TaskPlanExtractor();
    this.messageTracker = new DialogueMessageTracker();
  }

  /**
   * Get the message tracker for this dialogue.
   *
   * @returns The message tracker instance
   */
  getMessageTracker(): DialogueMessageTracker {
    return this.messageTracker;
  }

  /**
   * Cleanup resources held by the dialogue orchestrator.
   *
   * **IMPORTANT**: Call this method when the dialogue is complete to prevent memory leaks.
   *
   * Reset all state variables to their initial values.
   */
  cleanup(): void {
    logger.debug({ taskId: this.taskId }, 'Cleaning up dialogue orchestrator');
    this.taskId = '';
    this.originalRequest = '';
    this.taskPlanSaved = false;
    this.previousWorkerOutput = undefined;
    this.currentChatId = undefined;
    this.messageTracker.reset();
  }

  /**
   * Save task plan on first iteration.
   *
   * Extracts and saves task plan from Manager's first output.
   *
   * @param managerOutput - Manager's output text
   * @param iteration - Current iteration number
   */
  private async saveTaskPlanIfNeeded(managerOutput: string, iteration: number): Promise<void> {
    if (iteration === 1 && this.onTaskPlanGenerated && !this.taskPlanSaved) {
      const plan = this.taskPlanExtractor.extract(managerOutput, this.originalRequest);
      if (plan) {
        try {
          await this.onTaskPlanGenerated(plan);
          this.taskPlanSaved = true;
          logger.info({ taskId: plan.taskId }, 'Task plan saved');
        } catch (error) {
          logger.error({ err: error }, 'Failed to save task plan');
        }
      }
    }
  }

  /**
   * Process a single dialogue iteration with REAL-TIME streaming Evaluator-Planner/Executor communication.
   *
   * **NEW: Uses runIterationStreaming() for immediate user feedback**
   * - Agent messages are yielded immediately
   * - Subtask progress is reported in real-time
   * - Execution output is collected for Evaluator evaluation
   *
   * New Flow (Streaming):
   *   1. Create IterationBridge with Evaluator and Planner/Executor configs
   *   2. Run iteration with streaming: Agent messages are yielded immediately
   *   3. When execution sends 'result' message, iteration ends
   *   4. Store execution output for next iteration
   *
   * @param taskMdContent - Full Task.md content
   * @param iteration - Current iteration number
   * @returns Async iterable of AgentMessage (real-time execution output)
   */
  private async *processIterationStreaming(
    taskMdContent: string,
    iteration: number
  ): AsyncIterable<AgentMessage> {
    logger.debug({ iteration }, 'Processing iteration with Plan-and-Execute architecture');

    // Create IterationBridge with all necessary context including chatId
    const bridge = new IterationBridge({
      plannerConfig: this.plannerConfig,
      executorConfig: this.executorConfig,
      evaluatorConfig: this.evaluatorConfig,
      taskMdContent,
      iteration,
      previousWorkerOutput: this.previousWorkerOutput,
      chatId: this.currentChatId,
    });

    let taskDone = false;

    // Run the iteration with streaming
    for await (const msg of bridge.runIterationStreaming()) {
      // Check for task_done using mcp-utils
      if (isTaskDoneTool(msg)) {
        taskDone = true;
      }

      // ✨ P0 FIX: Also check for task_completion message type (from Evaluator)
      if (msg.messageType === 'task_completion') {
        logger.debug({
          iteration,
          messageType: msg.messageType,
        }, 'Task completion signal detected from Evaluator');
        taskDone = true;
      }

      // Yield the message for immediate delivery to user
      yield msg;
    }

    // Get Worker output from this iteration for next iteration
    const workerOutput = bridge.getWorkerOutput();

    // Store Worker output for next iteration
    this.previousWorkerOutput = workerOutput;

    // Log completion status
    logger.info({
      iteration,
      taskDone,
      workerOutputLength: workerOutput.length,
    }, 'REAL-TIME streaming iteration complete');

    // Update completion status for return value check
    // (This is a bit awkward with async generators - we track via instance variable)
    this.currentIterationTaskDone = taskDone;
  }

  /**
   * Run a dialogue loop with REAL-TIME streaming Manager-Worker communication.
   *
   * **NEW: Real-time Streaming Flow**
   * - Manager's messages (including tool calls) are yielded immediately
   * - Users receive progress updates as they happen
   * - Worker's output is collected only for Manager evaluation
   *
   * Flow:
   * 1. Each iteration: Manager runs and yields messages immediately
   * 2. Worker executes based on Manager's instructions (output not yielded)
   * 3. Manager evaluates Worker output and sends next instructions
   * 4. Loop continues until task_done or max iterations
   *
   * @param taskPath - Path to Task.md file
   * @param originalRequest - Original user request text
   * @param chatId - Feishu chat ID (passed to IterationBridge for context)
   * @param _messageId - Unique message ID (reserved for future use)
   * @returns Async iterable of messages (real-time Manager output and tool calls)
   */
  async *runDialogue(
    taskPath: string,
    originalRequest: string,
    chatId: string,
    _messageId: string
  ): AsyncIterable<AgentMessage> {
    this.taskId = path.basename(taskPath, '.md');
    this.originalRequest = originalRequest;
    this.taskPlanSaved = false;
    this.currentIterationTaskDone = false;
    this.currentChatId = chatId;

    const taskMdContent = await fs.readFile(taskPath, 'utf-8');
    let iteration = 0;

    logger.info(
      { taskId: this.taskId, chatId, maxIterations: this.maxIterations },
      'Starting Plan-and-Execute dialogue flow with REAL-TIME streaming'
    );

    // Main dialogue loop: Evaluator → Planner/Executor → Evaluator → Planner/Executor → ...
    while (iteration < this.maxIterations) {
      iteration++;

      // Reset task done flag for this iteration
      this.currentIterationTaskDone = false;

      // Process iteration with REAL-TIME streaming
      // All Manager messages (including tool calls) are yielded immediately
      for await (const msg of this.processIterationStreaming(taskMdContent, iteration)) {
        // Save task plan on first iteration (from Manager's output)
        const text = typeof msg.content === 'string' ? msg.content : extractText(msg);
        if (iteration === 1 && text) {
          await this.saveTaskPlanIfNeeded(text, iteration);
        }

        // Yield the message immediately to the user
        yield msg;
      }

      // Check if task was completed during this iteration
      if (this.currentIterationTaskDone) {
        break;
      }
    }

    // Log warning if max iterations reached without task completion
    if (iteration >= this.maxIterations && !this.currentIterationTaskDone) {
      logger.warn(
        {
          taskId: this.taskId,
          chatId,
          iteration,
          maxIterations: this.maxIterations,
        },
        '⚠️  Task stopped after reaching maximum iterations without completion signal'
      );
    }
  }
}

// Re-export TaskPlanData for backward compatibility
export type { TaskPlanData } from '../long-task/task-plan-extractor.js';
