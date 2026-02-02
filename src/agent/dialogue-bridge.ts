/**
 * AgentDialogueBridge - Manages prompt-based dialogue between OrchestrationAgent and ExecutionAgent.
 *
 * NEW Architecture (Flow 2):
 * - Task.md content → ExecutionAgent FIRST (executes/explores)
 * - ExecutionAgent output → OrchestrationAgent (evaluates/plans)
 * - OrchestrationAgent output → ExecutionAgent (next steps)
 * - Loop continues until OrchestrationAgent calls send_complete
 *
 * Completion detection:
 * - Via send_complete tool call only
 * - When called, loop ends and final message is sent to user
 *
 * Session Management:
 * - Each messageId has its own OrchestrationAgent session
 * - Sessions are stored internally in taskSessions Map
 * - This allows multiple parallel tasks within the same chat
 */
import type { AgentMessage } from '../types/agent.js';
import { extractText } from '../utils/sdk.js';
import { createLogger } from '../utils/logger.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { OrchestrationAgent } from './orchestration-agent.js';
import type { ExecutionAgent } from './execution-agent.js';

const logger = createLogger('AgentDialogueBridge', {});

/**
 * Completion signal data from send_complete tool call.
 */
export interface CompletionSignal {
  completed: boolean;
  finalMessage?: string;
  files?: string[];
}

/**
 * Task plan data extracted from orchestration agent output.
 */
export interface TaskPlanData {
  taskId: string;
  title: string;
  description: string;
  milestones: string[];
  originalRequest: string;
  createdAt: string;
}

/**
 * Agent dialogue configuration.
 */
export interface DialogueBridgeConfig {
  orchestrationAgent: OrchestrationAgent;
  executionAgent: ExecutionAgent;
  maxIterations?: number;
  /** Callback when orchestration agent generates a task plan */
  onTaskPlanGenerated?: (plan: TaskPlanData) => Promise<void>;
}

/**
 * AgentDialogueBridge - Manages Flow 2 dialogue loop between agents.
 *
 * NEW Flow:
 * 1. User request from Task.md → ExecutionAgent (works/explores first)
 * 2. ExecutionAgent output → OrchestrationAgent (evaluates/plans)
 * 3. OrchestrationAgent output → ExecutionAgent (next instructions)
 * 4. Loop until OrchestrationAgent calls send_complete
 *
 * This approach uses Claude Agent SDK's native conversation capability:
 * Each agent maintains its own session context, and the bridge simply
 * passes the output of one as input to the other.
 */
export class AgentDialogueBridge {
  readonly orchestrationAgent: OrchestrationAgent;
  readonly executionAgent: ExecutionAgent;
  readonly maxIterations: number;
  private onTaskPlanGenerated?: (plan: TaskPlanData) => Promise<void>;
  private taskId: string = '';
  private originalRequest: string = '';
  private taskPlanSaved = false;

  constructor(config: DialogueBridgeConfig) {
    this.orchestrationAgent = config.orchestrationAgent;
    this.executionAgent = config.executionAgent;
    this.maxIterations = config.maxIterations ?? 1;
    this.onTaskPlanGenerated = config.onTaskPlanGenerated;
  }

  /**
   * Generate a unique task ID.
   */
  private generateTaskId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `dialogue-task-${timestamp}-${random}`;
  }

  /**
   * Detect completion via send_complete tool call only.
   * Scans message content for tool_use blocks with name 'send_complete'.
   *
   * @param messages - Messages to scan for completion signal
   * @returns Completion signal data if found, null otherwise
   */
  private detectCompletion(messages: AgentMessage[]): CompletionSignal | null {
    for (const msg of messages) {
      const {content} = msg;

      // Handle array content (ContentBlock[])
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use' && block.name === 'send_complete') {
            const input = block.input as Record<string, unknown> | undefined;
            const finalMessage = input?.message as string | undefined;
            const files = input?.files as string[] | undefined;
            logger.info({ source: 'tool_call' }, 'Completion detected via send_complete tool');
            return {
              completed: true,
              finalMessage: finalMessage || undefined,
              files,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract task plan from orchestration agent output.
   * Looks for structured plan sections in the output.
   */
  private extractTaskPlan(output: string): TaskPlanData | null {
    const lines = output.split('\n');

    let title = 'Untitled Task';
    let description = '';
    const milestones: string[] = [];

    // Try to extract title from headers
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') && trimmed.length > 2) {
        title = trimmed.replace(/^#+\s*/, '').trim();
        break;
      }
    }

    // Try to extract milestones from numbered lists or bullet points
    let inMilestones = false;
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.toLowerCase().includes('milestone') ||
          trimmed.toLowerCase().includes('step') ||
          trimmed.toLowerCase().includes('plan')) {
        inMilestones = true;
        continue;
      }

      if (inMilestones || /^\d+\./.test(trimmed) || /^[-*]/.test(trimmed)) {
        const milestone = trimmed.replace(/^\d+\.?\s*/, '').replace(/^[-*]\s*/, '').trim();
        if (milestone && !milestone.startsWith('#')) {
          milestones.push(milestone);
        }
      }
    }

    if (milestones.length === 0) {
      description = output.substring(0, 1000);
    } else {
      description = output.substring(0, 500);
    }

    return {
      taskId: this.generateTaskId(),
      title,
      description,
      milestones,
      originalRequest: this.originalRequest,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Run a dialogue loop (Flow 2).
   *
   * NEW FLOW:
   * 1. ExecutionAgent works FIRST on user request
   * 2. ExecutionAgent output → OrchestrationAgent for evaluation
   * 3. OrchestrationAgent provides next instructions OR calls send_complete
   * 4. Loop continues until send_complete is called
   *
   * @param taskPath - Path to Task.md file
   * @param originalRequest - Original user request text
   * @param chatId - Feishu chat ID
   * @param messageId - Unique message ID for session management (each task has its own session)
   * @returns Async iterable of messages from orchestration agent (to show user)
   */
  async *runDialogue(
    taskPath: string,
    originalRequest: string,
    chatId: string,
    _messageId: string  // Reserved for future use
  ): AsyncIterable<AgentMessage> {
    this.taskId = path.basename(taskPath, '.md');
    this.originalRequest = originalRequest;
    this.taskPlanSaved = false;

    // Read Task.md content (contains chatId!)
    const taskMdContent = await fs.readFile(taskPath, 'utf-8');

    // Set Task.md as OrchestrationAgent's system prompt
    // This provides the chatId context needed for send_complete tool
    this.orchestrationAgent.setSystemPrompt(taskMdContent);

    let currentPrompt = taskMdContent;
    let iteration = 0;
    let firstIteration = true;

    logger.info(
      { taskId: this.taskId, chatId, maxIterations: this.maxIterations },
      'Starting Flow 2: ExecutionAgent first'
    );

    while (iteration < this.maxIterations) {
      iteration++;

      // === FIRST iteration: ExecutionAgent works on original request ===
      if (firstIteration) {
        logger.debug({ iteration, promptLength: currentPrompt.length },
                     'ExecutionAgent working (FIRST iteration)');

        const executionMessages: AgentMessage[] = [];
        for await (const msg of this.executionAgent.queryStream(currentPrompt)) {
          executionMessages.push(msg);
          // Don't yield execution messages - they go to orchestration agent
        }

        const executionOutput = executionMessages
          .map(msg => extractText(msg))
          .join('');

        logger.debug({ iteration, executionOutputLength: executionOutput.length },
                     'ExecutionAgent output received (first iteration)');

        // Execution output becomes orchestration input
        currentPrompt = executionOutput;
        firstIteration = false;
      }

      // === OrchestrationAgent evaluates ExecutionAgent's work ===
      logger.debug({ iteration, promptLength: currentPrompt.length },
                   'OrchestrationAgent evaluating');

      // OrchestrationAgent internally manages its own session
      const orchestrationMessages: AgentMessage[] = [];
      for await (const msg of this.orchestrationAgent.queryStream(currentPrompt)) {
        orchestrationMessages.push(msg);
        // Yield orchestration messages to user for progress visibility
        yield msg;
      }

      // === Check for send_complete tool call ===
      const completion = this.detectCompletion(orchestrationMessages);
      if (completion?.completed) {
        logger.info({ iteration, hasFinalMessage: !!completion.finalMessage },
                    'Task completed via send_complete');

        // Yield final message if provided
        if (completion.finalMessage) {
          yield {
            content: completion.finalMessage,
            role: 'assistant',
            messageType: 'result',
          };
        }
        break;  // Exit loop
      }

      const orchestrationOutput = orchestrationMessages
        .map(msg => extractText(msg))
        .join('');

      logger.debug({ iteration, outputLength: orchestrationOutput.length },
                   'OrchestrationAgent output received');

      // === Save task plan on first orchestration output ===
      if (iteration === 1 && this.onTaskPlanGenerated && !this.taskPlanSaved) {
        const plan = this.extractTaskPlan(orchestrationOutput);
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

      // === Orchestration output becomes prompt for ExecutionAgent (next iteration) ===
      logger.debug({ iteration }, 'ExecutionAgent working (next iteration)');

      const executionMessages: AgentMessage[] = [];
      for await (const msg of this.executionAgent.queryStream(orchestrationOutput)) {
        executionMessages.push(msg);
        // Don't yield execution messages directly
      }

      const executionOutput = executionMessages
        .map(msg => extractText(msg))
        .join('');

      logger.debug({ iteration, executionOutputLength: executionOutput.length },
                   'ExecutionAgent output received');

      currentPrompt = executionOutput;
    }

    if (iteration >= this.maxIterations) {
      logger.warn({ iteration }, 'Dialogue reached max iterations');
      yield {
        content: `⚠️ Maximum iterations reached (${this.maxIterations}). Use /reset to start fresh.`,
        role: 'assistant',
        messageType: 'error',
      };
    }
  }
}
