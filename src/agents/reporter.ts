/**
 * Reporter - Communication and instruction generation specialist.
 *
 * **Single Responsibility**: Generate Executor instructions and format user feedback.
 *
 * **Key Differences from Manager:**
 * - Manager: Evaluates AND generates instructions AND formats output
 * - Reporter: ONLY generates instructions and formats output, does NOT evaluate
 *
 * **Tools Available:**
 * - send_user_feedback: Send formatted feedback to user
 * - send_file_to_feishu: Send files to user (e.g., reports, logs, generated content)
 *
 * **Tools NOT Available (intentionally restricted):**
 * - task_done: Evaluator's job, not Reporter's
 *
 * **Workflow:**
 * 1. Receive evaluation result from Evaluator
 * 2. Read Task.md and Executor output
 * 3. Generate Executor instructions (if not complete)
 * 4. Format user feedback
 * 5. Send files to user (if applicable)
 * 6. Call send_user_feedback
 *
 * **Output Format:**
 * Reporter generates user-facing messages:
 * - Executor instructions (clear, actionable)
 * - Progress updates (what was accomplished)
 * - Next steps (what needs to be done)
 * - File attachments (reports, logs, etc.)
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { parseSDKMessage, buildSdkEnv } from '../utils/sdk.js';
import { Config } from '../config/index.js';
import type { AgentMessage, AgentInput } from '../types/agent.js';
import { feishuSdkMcpServer } from '../mcp/feishu-context-mcp.js';
import { createLogger } from '../utils/logger.js';
import { loadSkillOrThrow, type ParsedSkill } from '../task/skill-loader.js';
import { AgentExecutionError, formatError } from '../utils/errors.js';

/**
 * Input type for Reporter queries.
 */
export type ReporterInput = AgentInput;

/**
 * Reporter agent configuration.
 */
export interface ReporterConfig {
  apiKey: string;
  model: string;
  apiBaseUrl?: string;
  permissionMode?: 'default' | 'bypassPermissions';
}

/**
 * Type for permission mode.
 */
export type ReporterPermissionMode = 'default' | 'bypassPermissions';

/**
 * Reporter - Communication and instruction generation specialist.
 */
export class Reporter {
  readonly apiKey: string;
  readonly model: string;
  readonly apiBaseUrl?: string;
  readonly permissionMode: ReporterPermissionMode;
  protected skill?: ParsedSkill;
  protected initialized = false;
  private readonly provider: 'anthropic' | 'glm';

  private readonly logger = createLogger('Reporter');

  constructor(config: ReporterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiBaseUrl = config.apiBaseUrl;
    this.permissionMode = config.permissionMode || 'bypassPermissions';

    // Detect provider from API base URL
    const agentConfig = Config.getAgentConfig();
    this.provider = agentConfig.provider;
  }

  /**
   * Initialize the Reporter agent.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load skill (required)
    this.skill = await loadSkillOrThrow('reporter');
    this.logger.debug({
      skillName: this.skill.name,
      toolCount: this.skill.allowedTools.length,
    }, 'Reporter skill loaded');

    this.initialized = true;
    this.logger.debug('Reporter initialized');
  }

  /**
   * Query the Reporter agent with streaming response.
   *
   * @param input - Prompt or message array
   * @returns Async iterable of agent messages
   */
  async *queryStream(input: ReporterInput): AsyncIterable<AgentMessage> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Create SDK options for Reporter
    // Skill is required, so allowedTools is always defined
    const allowedTools = this.skill!.allowedTools;
    // Note: task_done is intentionally NOT included (Evaluator's job)

    const sdkOptions: Record<string, unknown> = {
      cwd: Config.getWorkspaceDir(),
      permissionMode: this.permissionMode,
      allowedTools,
      settingSources: ['project'],
      mcpServers: {
        'feishu-context': feishuSdkMcpServer,
      },
    };

    // Set environment
    sdkOptions.env = buildSdkEnv(this.apiKey, this.apiBaseUrl, Config.getGlobalEnv());

    // Set model
    if (this.model) {
      sdkOptions.model = this.model;
    }

    // Reporter does NOT have a timeout limit.
    // Rationale:
    // 1. Reporter is invoked during Executor execution to provide user feedback
    // 2. Timeout errors mislead users into thinking the task failed
    // 3. The task has already completed by the time Reporter is called for 'complete' events
    // 4. SDK has its own timeout mechanisms for API calls

    try {
      const queryResult = query({ prompt: input, options: sdkOptions as any });
      const iterator = queryResult[Symbol.asyncIterator]();

      while (true) {
        const result = await iterator.next();

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
      const agentError = new AgentExecutionError(
        'Reporter query failed',
        {
          cause: error instanceof Error ? error : new Error(String(error)),
          agent: 'Reporter',
          recoverable: true,
        }
      );
      this.logger.error({ err: formatError(agentError) }, 'Reporter query failed');
      yield {
        content: `❌ Reporter error: ${error instanceof Error ? error.message : String(error)}`,
        role: 'assistant',
        messageType: 'error',
      };
    }
  }

  /**
   * Generate Executor instructions and user feedback.
   *
   * @param taskMdContent - Full Task.md content
   * @param iteration - Current iteration number
   * @param workerOutput - Executor's output from previous iteration (if any)
   * @param evaluation - Evaluation result from Evaluator
   * @returns Generated messages
   */
  async report(
    taskMdContent: string,
    iteration: number,
    workerOutput: string | undefined,
    evaluationContent: string
  ): Promise<AgentMessage[]> {
    const prompt = Reporter.buildReportPrompt(taskMdContent, iteration, workerOutput, evaluationContent);
    const messages: AgentMessage[] = [];

    // Collect all messages from queryStream
    for await (const msg of this.queryStream(prompt)) {
      messages.push(msg);
    }

    return messages;
  }

  /**
   * Build report prompt for Reporter.
   */
  static buildReportPrompt(
    taskMdContent: string,
    iteration: number,
    workerOutput: string | undefined,
    evaluationContent: string
  ): string {
    let prompt = `${taskMdContent}

---

## Current Iteration: ${iteration}

`;

    // Add Executor output if available
    const hasExecutorOutput = workerOutput && workerOutput.trim().length > 0;
    if (hasExecutorOutput) {
      prompt += `## Executor's Previous Output (Iteration ${iteration - 1})

\`\`\`
${workerOutput}
\`\`\`

---

`;
    } else {
      prompt += `## Executor's Previous Output

*No Executor output yet - this is the first iteration.*

---

`;
    }

    // Add evaluation result (markdown format)
    prompt += `## Evaluator's Assessment

${evaluationContent}

---

`;

    // Add report instructions
    prompt += `### Your Reporting Task

**Your Job:**
1. Read the Evaluator's assessment above
2. Format user feedback based on the evaluation
3. Use send_user_feedback to send feedback to user

**What to include in user feedback:**
- Current progress status
- What was accomplished (if any)
- What still needs to be done (if not complete)
- Next steps

**DO NOT:**
❌ Evaluate if task is complete (Evaluator already did)
❌ Generate new instructions (Executor reads evaluation.md directly)

**Remember**: You are the REPORTER.
You ONLY format and communicate feedback to users.
`;

    return prompt;
  }

  /**
   * Cleanup resources.
   */
  cleanup(): void {
    this.logger.debug('Reporter cleaned up');
    this.initialized = false;
  }
}
