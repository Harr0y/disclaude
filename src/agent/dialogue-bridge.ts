/**
 * AgentDialogueBridge - Manages prompt-based dialogue between Manager and Worker.
 *
 * NEW Architecture (Manager-First Flow):
 * - First iteration: Manager reads Task.md, provides initial planning → Worker executes
 * - Subsequent iterations: Manager evaluates (Task.md + previous Worker output) FIRST
 *   - If Manager calls task_done → Task complete, end immediately
 *   - If not complete → Manager provides instructions → Worker executes
 * - Loop continues until Manager calls task_done
 *
 * Completion detection:
 * - Via task_done tool call only
 * - When called, loop ends and final message is sent to user
 *
 * **CRITICAL DESIGN PRINCIPLE:**
 * Worker output is NOT automatically sent to users. Only Manager decides what to send.
 * - Worker messages are collected for Manager evaluation only (NOT yielded)
 * - Manager uses MCP tools (send_user_feedback, send_user_card) to send user-facing messages
 * - This ensures Manager is the sole interface layer for user communication
 * - Worker is a background worker - Manager is the user interface
 *
 * **NO SESSION STATE ACROSS ITERATIONS:**
 * - Each iteration creates FRESH Manager and Worker instances
 * - Context is maintained via Task.md file and previousWorkerOutput storage
 * - No cross-iteration session IDs needed
 */
import type { AgentMessage } from '../types/agent.js';
import { extractText } from '../utils/sdk.js';
import { DIALOGUE } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Manager, type ManagerConfig } from './manager.js';
import { Worker, type WorkerConfig } from './worker.js';

const logger = createLogger('AgentDialogueBridge', {});

/**
 * Detect if Worker has completed execution.
 * Checks if the message stream contains a 'result' type message from SDK.
 *
 * @param messages - Messages from Worker
 * @returns true if execution is complete (SDK sent 'result'), false otherwise
 */
export function isExecutionComplete(messages: AgentMessage[]): boolean {
  return messages.some(msg => msg.messageType === 'result');
}

/**
 * Completion signal data from task_done tool call.
 */
export interface CompletionSignal {
  completed: boolean;
  files?: string[];
}

/**
 * Task plan data extracted from manager agent output.
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
 * Now accepts agent configs instead of instances to enable fresh instance creation per iteration.
 */
export interface DialogueBridgeConfig {
  managerConfig: ManagerConfig;
  workerConfig: WorkerConfig;
  /** Callback when manager generates a task plan */
  onTaskPlanGenerated?: (plan: TaskPlanData) => Promise<void>;
}

/**
 * AgentDialogueBridge - Manages Manager-First dialogue loop between agents.
 *
 * NEW Manager-First Flow:
 * 1. First iteration: Manager reads Task.md, provides initial planning → Worker executes
 * 2. Subsequent iterations: Manager evaluates (Task.md + previous Worker output) FIRST
 *    - If complete → task_done → END
 *    - If not complete → Manager provides next instructions → Worker executes
 * 3. Loop until Manager calls task_done
 *
 * **User Communication (Manager-only):**
 * - Manager uses `send_user_feedback` or `send_user_card` MCP tools to communicate with users
 * - These tool calls are handled by feishu-context MCP server and directly sent to Feishu/CLI
 * - Notifications bypass the yielding mechanism and reach users immediately
 * - Worker output is NEVER directly shown to users - Manager decides what to share
 */
export class AgentDialogueBridge {
  readonly managerConfig: ManagerConfig;
  readonly workerConfig: WorkerConfig;
  /** Maximum iterations from constants - single source of truth */
  readonly maxIterations = DIALOGUE.MAX_ITERATIONS;
  private onTaskPlanGenerated?: (plan: TaskPlanData) => Promise<void>;
  private taskId: string = '';
  private originalRequest: string = '';
  private taskPlanSaved = false;
  private userMessageSent = false;  // Track if any user message was sent

  // Store previous Worker output for Manager evaluation in next iteration
  private previousWorkerOutput?: string;

  constructor(config: DialogueBridgeConfig) {
    // Store config instead of instances - instances will be created per iteration
    this.managerConfig = config.managerConfig;
    this.workerConfig = config.workerConfig;
    this.onTaskPlanGenerated = config.onTaskPlanGenerated;
  }

  /**
   * Record that a user message was sent.
   * Called by FeishuBot when a message is sent to the user.
   */
  recordUserMessageSent(): void {
    this.userMessageSent = true;
  }

  /**
   * Check if any user message has been sent.
   * Used to determine if a no-message warning is needed.
   */
  hasUserMessageBeenSent(): boolean {
    return this.userMessageSent;
  }

  /**
   * Cleanup resources held by the dialogue bridge.
   *
   * **IMPORTANT**: Call this method when the dialogue is complete to prevent memory leaks.
   *
   * Reset all state variables to their initial values.
   */
  cleanup(): void {
    logger.debug({ taskId: this.taskId }, 'Cleaning up dialogue bridge');
    this.taskId = '';
    this.originalRequest = '';
    this.taskPlanSaved = false;
    this.userMessageSent = false;
    this.previousWorkerOutput = undefined;
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
   * Detect completion via task_done tool call only.
   * Scans message content for tool_use blocks with name 'task_done'.
   *
   * @param messages - Messages to scan for completion signal
   * @returns Completion signal data if found, null otherwise
   */
  private detectCompletion(messages: AgentMessage[]): CompletionSignal | null {
    for (const msg of messages) {
      const {content, metadata} = msg;

      // Debug: log all message types for troubleshooting
      logger.debug({
        messageType: msg.messageType,
        contentType: Array.isArray(content) ? `array[${content.length}]` : typeof content,
        contentTypes: Array.isArray(content) ? content.map(b => b.type) : [typeof content],
        toolName: metadata?.toolName,
      }, 'detectCompletion: checking message');

      // Handle array content (ContentBlock[]) - raw SDK format
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use' && block.name === 'task_done') {
            const input = block.input as Record<string, unknown> | undefined;
            const files = input?.files as string[] | undefined;
            logger.info({ source: 'tool_call' }, 'Completion detected via task_done tool');
            return {
              completed: true,
              files,
            };
          }
        }
      }

      // Handle parsed SDK messages - tool_use info stored in metadata
      // parseSDKMessage() converts tool_use blocks to string content
      // and stores tool info in metadata.toolName and metadata.toolInput
      // Note: MCP tools are namespaced as "mcp__server-name__tool-name"
      if (msg.messageType === 'tool_use' &&
          (metadata?.toolName === 'task_done' ||
           metadata?.toolName?.endsWith('__task_done'))) {
        const toolInput = metadata.toolInput as Record<string, unknown> | undefined;
        const files = toolInput?.files as string[] | undefined;
        logger.info({ source: 'metadata', toolName: metadata.toolName }, 'Completion detected via task_done tool');
        return {
          completed: true,
          files,
        };
      }
    }

    logger.debug({ messageCount: messages.length }, 'detectCompletion: no completion signal found');
    return null;
  }

  /**
   * Extract task plan from manager agent output.
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
   * Build a warning message when task completes without sending any user message.
   *
   * @param reason - Why the task ended (e.g., 'task_done', 'max_iterations')
   * @param taskId - Optional task ID for context
   * @returns Formatted warning message
   */
  buildNoMessageWarning(reason: string, taskId?: string): string {
    const parts = [
      '⚠️ **任务完成但无反馈消息**',
      '',
      `结束原因: ${reason}`,
    ];

    if (taskId) {
      parts.push(`任务 ID: ${taskId}`);
    }

    parts.push('', '这可能表示:');
    parts.push('- Agent 没有生成任何输出');
    parts.push('- 所有消息都通过内部工具处理');
    parts.push('- 可能存在配置问题');

    return parts.join('\n');
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
      const plan = this.extractTaskPlan(managerOutput);
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
   * Build a warning message when max iterations is reached.
   *
   * @param iteration - Final iteration number
   * @returns Formatted warning message
   */
  private buildMaxIterationsWarning(iteration: number): AgentMessage {
    logger.warn({ iteration }, 'Dialogue reached max iterations without completion');

    return {
      content: `Warning: Dialogue reached max iterations (${this.maxIterations}) but task may not be complete.

Possible reasons:
1. Task complexity requires more iterations
2. Manager did not call task_done tool to mark completion

Suggestions:
- Use /reset to clear conversation and resubmit
- Or check and modify task description for clarity
- If this is an analysis task, may need more explicit completion criteria`,
      role: 'assistant',
      messageType: 'error',
    };
  }

  /**
   * Build planning prompt for Manager (first iteration).
   *
   * Manager reads Task.md and identifies the PRIMARY GOAL - no detailed planning.
   *
   * @param taskMdContent - Full Task.md content
   * @returns Planning prompt for Manager
   */
  private buildPlanningPrompt(taskMdContent: string): string {
    return `${taskMdContent}

---

## Your Task

You are the **Manager**. This is the **first iteration**.

### Your Role

Read the task and identify the PRIMARY GOAL - that's all.

### What to Do

1. Read the Original Request in Task.md
2. Identify the MAIN thing that needs to be accomplished
3. State this as a SINGLE, CLEAR goal statement

### What to Provide

Just one clear sentence describing what needs to be done:
- "The goal is to: [明确的目标]"
- "We need to: [需要完成的事]"
- "Please: [简洁的要求]"

**DO NOT**:
- ❌ Create a plan
- ❌ Break down steps
- ❌ Provide detailed instructions
- ❌ List files or approaches

**Remember**: The user will NOT see your text response. They only see messages sent via send_user_feedback.
Use send_user_feedback to inform the user about the goal you've identified.

Your output will be passed directly to the Worker as their instruction.
`;
  }

  /**
   * Build evaluation prompt for Manager (subsequent iterations).
   *
   * Manager evaluates Task.md + previous Worker output to determine if task is complete.
   *
   * @param taskMdContent - Full Task.md content
   * @param workerOutput - Previous Worker's output
   * @param iteration - Current iteration number
   * @returns Evaluation prompt for Manager
   */
  private buildEvaluationPrompt(
    taskMdContent: string,
    workerOutput: string,
    iteration: number
  ): string {
    return `${taskMdContent}

---

## Previous Worker Output (Iteration ${iteration - 1})

\`\`\`
${workerOutput}
\`\`\`

---

## Your Evaluation Task

You are the **Manager**. Worker has completed work based on your previous instruction.

### Step 1: Evaluate Completion

Compare Worker's output against the Expected Results in Task.md:
- Is the user's original request satisfied?
- Has the expected deliverable been produced?
- Is the response complete and adequate?

### Step 2: Take Action

**If COMPLETE** → Follow this EXACT order:

**Step A:** Send the final message to the user
\`\`\`
send_user_feedback({
  content: "Your response to the user...",
  chatId: "EXTRACT_CHAT_ID_FROM_TASK_MD"
})
\`\`\`

**Step B:** Signal completion
\`\`\`
task_done({
  chatId: "EXTRACT_CHAT_ID_FROM_TASK_MD"
})
\`\`\`

Replace EXTRACT_CHAT_ID_FROM_TASK_MD with the Chat ID value from Task.md.

**If INCOMPLETE** → Identify the remaining issue:

Do NOT provide detailed instructions. Instead:
- Identify what is STILL MISSING or NOT WORKING
- Find the MAIN obstacle or incomplete part
- State this as a single clear goal for the Worker

The Worker will figure out HOW to solve it. You just identify WHAT needs to be done.

**IMPORTANT**: The user will NOT see your text response. They only see messages sent via send_user_feedback.

**IMPORTANT**: The task_done and send_user_feedback tools ARE available. Look for them in your tool list and use them!
`;
  }

  /**
   * Query Manager and parse response.
   *
   * @param manager - Manager instance
   * @param prompt - Prompt to send to Manager
   * @param iteration - Current iteration number
   * @returns Manager messages, completion status, and output text
   */
  private async queryManager(
    manager: Manager,
    prompt: string,
    iteration: number
  ): Promise<{ messages: AgentMessage[]; completed: boolean; output: string }> {
    logger.debug({ iteration, promptLength: prompt.length }, 'Querying Manager');

    const managerMessages: AgentMessage[] = [];
    for await (const msg of manager.queryStream(prompt)) {
      managerMessages.push(msg);

      if (msg.metadata?.toolName) {
        logger.debug({
          iteration,
          toolName: msg.metadata.toolName,
          toolInput: msg.metadata.toolInput,
        }, 'Manager tool call detected');
      }
    }

    const completion = this.detectCompletion(managerMessages);
    const managerOutput = managerMessages.map(msg => extractText(msg)).join('');

    logger.debug({
      iteration,
      outputLength: managerOutput.length,
      completed: completion?.completed,
    }, 'Manager response received');

    return {
      messages: managerMessages,
      completed: completion?.completed ?? false,
      output: managerOutput,
    };
  }

  /**
   * Execute Worker with given prompt.
   *
   * @param worker - Worker instance
   * @param prompt - Prompt for Worker
   * @returns Worker's output text
   */
  private async executeWorker(
    worker: Worker,
    prompt: string
  ): Promise<string> {
    logger.debug({ promptLength: prompt.length }, 'Executing Worker');

    const workerMessages: AgentMessage[] = [];
    for await (const msg of worker.queryStream(prompt)) {
      workerMessages.push(msg);
    }

    const workerOutput = workerMessages.map(msg => extractText(msg)).join('');

    logger.debug({ outputLength: workerOutput.length }, 'Worker execution complete');

    return workerOutput;
  }

  /**
   * Build Worker prompt combining Task.md and Manager's instructions.
   *
   * @param taskMdContent - Full Task.md content
   * @param managerInstructions - Manager's instructions for Worker
   * @returns Complete prompt for Worker
   */
  private buildWorkerPrompt(taskMdContent: string, managerInstructions: string): string {
    return `${taskMdContent}

---

## Manager's Instructions

${managerInstructions}

---

## Your Role

You are the **Worker**. Execute the task according to the Manager's instructions above.

### What You Should Do

1. **Follow the Manager's guidance** - Use their instructions as your primary direction
2. **Use tools appropriately** - You have full access to development tools
3. **Report clearly** - Provide a clear summary of what you did and the outcomes

### Important Notes

- Focus on **execution** - get the work done
- The Manager will evaluate your results and decide next steps
- You don't need to signal completion - just report what you did
- Be thorough but efficient
`;
  }

  /**
   * Process a single dialogue iteration with Manager-first flow.
   *
   * First iteration (iteration === 1):
   *   1. Manager reads Task.md, provides initial planning
   *   2. Worker executes with Manager's planning + Task.md
   *   3. Store Worker output for next iteration
   *
   * Subsequent iterations (iteration > 1):
   *   1. Manager evaluates (Task.md + previous Worker output) FIRST
   *   2. If Manager calls task_done → return completed (END)
   *   3. If not complete → Manager provides next instructions
   *   4. Worker executes with Manager's instructions + Task.md
   *   5. Store Worker output for next iteration
   *
   * @param taskMdContent - Full Task.md content
   * @param iteration - Current iteration number
   * @returns Object containing completion status
   */
  private async processIteration(
    taskMdContent: string,
    iteration: number
  ): Promise<{ completed: boolean }> {
    const manager = new Manager(this.managerConfig);
    const worker = new Worker(this.workerConfig);
    await manager.initialize();
    await worker.initialize();

    logger.debug({ iteration }, 'Processing iteration');

    try {
      if (iteration === 1) {
        // === FIRST ITERATION: Manager planning → Worker execution ===

        // Step 1: Manager provides initial planning
        const planningPrompt = this.buildPlanningPrompt(taskMdContent);
        const { messages: managerMessages, output: managerOutput } =
          await this.queryManager(manager, planningPrompt, iteration);

        // Save task plan on first iteration
        await this.saveTaskPlanIfNeeded(managerOutput, iteration);

        // Step 2: Check if Manager somehow completed (unlikely for first iteration)
        const completion = this.detectCompletion(managerMessages);
        if (completion?.completed) {
          logger.info({ iteration }, 'Task completed on first iteration (unexpected)');
          return { completed: true };
        }

        // Step 3: Worker executes with Manager's planning
        const workerPrompt = this.buildWorkerPrompt(taskMdContent, managerOutput);
        const workerOutput = await this.executeWorker(worker, workerPrompt);

        // Store Worker output for next iteration
        this.previousWorkerOutput = workerOutput;

        return { completed: false };

      } else {
        // === SUBSEQUENT ITERATIONS: Manager evaluates FIRST ===

        // Step 1: Manager evaluates (Task.md + previous Worker output)
        const evaluationPrompt = this.buildEvaluationPrompt(
          taskMdContent,
          this.previousWorkerOutput || '',
          iteration
        );
        const { completed, output: managerOutput } =
          await this.queryManager(manager, evaluationPrompt, iteration);

        // Step 2: Check if Manager signaled completion
        if (completed) {
          logger.info({ iteration }, 'Task completed via task_done');
          return { completed: true };
        }

        // Step 3: Worker executes with Manager's new instructions
        const workerPrompt = this.buildWorkerPrompt(taskMdContent, managerOutput);
        const workerOutput = await this.executeWorker(worker, workerPrompt);

        // Store Worker output for next iteration
        this.previousWorkerOutput = workerOutput;

        return { completed: false };
      }

    } finally {
      // Cleanup this iteration's instances
      manager.cleanup();
      worker.cleanup();
    }
  }

  /**
   * Run a dialogue loop with Manager-First flow.
   *
   * NEW Manager-First Flow:
   * 1. First iteration: Manager reads Task.md, provides planning → Worker executes
   * 2. Subsequent iterations: Manager evaluates (Task.md + Worker output) FIRST
   *    - If complete → task_done → END
   *    - If not complete → Manager provides instructions → Worker executes
   * 3. Loop until Manager calls task_done
   *
   * @param taskPath - Path to Task.md file
   * @param originalRequest - Original user request text
   * @param chatId - Feishu chat ID (unused, reserved for future)
   * @param _messageId - Unique message ID (unused, reserved for future)
   * @returns Async iterable of messages from manager agent (to show user)
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

    const taskMdContent = await fs.readFile(taskPath, 'utf-8');
    let iteration = 0;
    let taskCompleted = false;

    logger.info(
      { taskId: this.taskId, chatId, maxIterations: this.maxIterations },
      'Starting Manager-First dialogue flow'
    );

    // Main dialogue loop: Manager → Worker → Manager → Worker → ...
    while (iteration < this.maxIterations) {
      iteration++;

      const result = await this.processIteration(taskMdContent, iteration);

      if (result.completed) {
        taskCompleted = true;
        break;
      }
      // No nextPrompt needed - Manager always leads
    }

    // Warn if max iterations reached without completion
    if (!taskCompleted && iteration >= this.maxIterations) {
      yield this.buildMaxIterationsWarning(iteration);
    }
  }
}
