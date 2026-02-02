/**
 * Interaction Agent - Task initialization specialist.
 *
 * Responsibilities:
 * - Analyze user requests
 * - Create Task.md file with metadata
 *
 * This agent runs BEFORE the execution dialogue loop.
 * It focuses ONLY on creating the Task.md file that will be used
 * by the ExecutionAgent and OrchestrationAgent.
 *
 * Key behaviors:
 * - Uses Write tool to create Task.md at the specified taskPath
 * - Task.md contains metadata (Task ID, Chat ID, User ID, timestamp)
 * - Task.md contains the original request
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { parseSDKMessage, buildSdkEnv } from '../utils/sdk.js';
import { Config } from '../config/index.js';
import type { AgentMessage, SessionInfo } from '../types/agent.js';
import { createLogger } from '../utils/logger.js';
import { loadSkill, type ParsedSkill } from './skill-loader.js';

// Re-export extractText for convenience
export { extractText } from '../utils/sdk.js';

/**
 * Interaction agent configuration.
 */
export interface InteractionAgentConfig {
  apiKey: string;
  model: string;
  apiBaseUrl?: string;
}

/**
 * Task context for interaction agent.
 */
export interface TaskContext {
  chatId: string;
  userId?: string;
  messageId: string;
  taskPath: string;
}

/**
 * Interaction agent for task initialization.
 *
 * This agent relies entirely on skill files for behavior definition.
 * No fallback prompts are used - if the skill fails to load, an error is thrown.
 */
export class InteractionAgent {
  readonly apiKey: string;
  readonly model: string;
  readonly apiBaseUrl: string | undefined;
  readonly workingDirectory: string;
  private currentSessionId?: string;
  private taskContext?: TaskContext;
  private skill?: ParsedSkill;
  private initialized = false;
  private logger = createLogger('InteractionAgent', { model: '' });

  constructor(config: InteractionAgentConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiBaseUrl = config.apiBaseUrl;
    this.workingDirectory = Config.getWorkspaceDir();
    this.logger = createLogger('InteractionAgent', { model: this.model });
  }

  /**
   * Initialize agent by loading skill file.
   * Must be called before queryStream().
   */
  async initialize(): Promise<void> {
    if (this.initialized) {return;}
    await this.loadSkill();
    this.initialized = true;
  }

  /**
   * Set task context for Task.md creation.
   * Includes chatId, messageId, and taskPath.
   */
  setTaskContext(context: TaskContext): void {
    this.taskContext = context;
    this.logger.debug({ chatId: context.chatId, messageId: context.messageId, taskPath: context.taskPath }, 'Task context set');
  }

  /**
   * Load skill file for this agent.
   * Skill loading is required - throws error if it fails.
   */
  private async loadSkill(): Promise<void> {
    const result = await loadSkill('interaction-agent');
    if (!result.success || !result.skill) {
      throw new Error(
        `InteractionAgent skill is required but failed to load. ` +
        `Error: ${result.error || 'Unknown error'}. ` +
        `Please ensure .claude/skills/interaction-agent/SKILL.md exists and is valid.`
      );
    }
    this.skill = result.skill;
    this.logger.debug({
      skillName: result.skill.name,
      toolCount: result.skill.allowedTools.length,
      contentLength: result.skill.content.length,
    }, 'InteractionAgent skill loaded');
  }

  /**
   * Create SDK options for interaction agent.
   * Tool configuration comes from the skill file.
   */
  private createSdkOptions(resume?: string): Record<string, unknown> {
    const allowedTools = this.skill?.allowedTools || ['Write', 'WebSearch'];

    this.logger.debug({
      hasSkill: !!this.skill,
      skillName: this.skill?.name,
      allowedTools,
      toolCount: allowedTools.length,
    }, 'InteractionAgent SDK options');

    const sdkOptions: Record<string, unknown> = {
      cwd: this.workingDirectory,
      permissionMode: 'bypassPermissions',
      settingSources: ['project'],
      // Tool configuration from skill file
      allowedTools,
    };

    // Set environment using unified helper
    sdkOptions.env = buildSdkEnv(this.apiKey, this.apiBaseUrl);

    // Set model
    if (this.model) {
      sdkOptions.model = this.model;
    }

    // Resume session
    if (resume) {
      sdkOptions.resume = resume;
    } else if (this.currentSessionId) {
      sdkOptions.resume = this.currentSessionId;
    }

    return sdkOptions;
  }

  /**
   * Build prompt with context prepended.
   * Task context is added to the beginning of the user prompt.
   */
  private buildPromptWithContext(userPrompt: string): string {
    if (!this.taskContext) {
      return userPrompt;
    }

    return `## Task Context

- **Message ID**: ${this.taskContext.messageId}
- **Task Path**: ${this.taskContext.taskPath}
- **Chat ID**: ${this.taskContext.chatId}
${this.taskContext.userId ? `- **User ID**: ${this.taskContext.userId}` : ''}

---

## User Request

\`\`\`
${userPrompt}
\`\`\`

---

## Your Instruction

**DO NOT answer the user's request directly.** Your job is to create a Task.md file that defines a task for solving this request.

1. Use the **Write** tool to create a Task.md file at the exact taskPath specified above
2. The Task.md should contain:
   - Original request (preserved exactly)
   - Intent analysis (what does the user want?)
   - Expected results (what should be produced to satisfy the request)

Think of it as: **create a task specification that another agent will execute**, not "answer the question now".

For questions like math problems, write: "User wants to solve [specific problem]. Calculate and provide the answer." in the Expected Results section.
`;
  }

  /**
   * Stream agent response.
   */
  async *queryStream(prompt: string, sessionId?: string): AsyncIterable<AgentMessage> {
    // Ensure skill is loaded before processing
    if (!this.initialized) {
      await this.initialize();
    }

    this.logger.debug({ sessionId, promptLength: prompt.length }, 'Starting interaction query');

    try {
      const sdkOptions = this.createSdkOptions(sessionId);

      this.logger.debug({
        hasTaskContext: !!this.taskContext,
        model: sdkOptions.model,
        allowedTools: (sdkOptions as { allowedTools?: string[] }).allowedTools,
        hasEnv: !!(sdkOptions as { env?: Record<string, unknown> }).env,
        baseUrl: (sdkOptions as { env?: Record<string, unknown> }).env?.ANTHROPIC_BASE_URL,
      }, 'InteractionAgent SDK query config');

      // Build prompt with context prepended
      const fullPrompt = this.buildPromptWithContext(prompt);

      const queryResult = query({
        prompt: fullPrompt,
        options: sdkOptions,
      });

      for await (const message of queryResult) {
        const parsed = parseSDKMessage(message);

        if (parsed.sessionId) {
          this.currentSessionId = parsed.sessionId;
        }

        if (!parsed.content) {
          continue;
        }

        yield {
          content: parsed.content,
          role: 'assistant',
          messageType: parsed.type,
          metadata: parsed.metadata,
        };
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Interaction query failed');
      yield {
        content: `❌ Error: ${error instanceof Error ? error.message : String(error)}`,
        role: 'assistant',
        messageType: 'error',
      };
    }
  }

  /**
   * Get session info.
   */
  getSessionInfo(): SessionInfo {
    return {
      sessionId: this.currentSessionId,
      resume: this.currentSessionId,
    };
  }
}
