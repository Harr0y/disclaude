/**
 * Planner - breaks down user requests into subtasks.
 *
 * Follows skill-based initialization pattern like Scout and Evaluator.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { LongTaskPlan } from './types.js';
import { parseSDKMessage, buildSdkEnv } from '../utils/sdk.js';
import { Config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { loadSkillOrThrow, type ParsedSkill } from '../task/skill-loader.js';

const logger = createLogger('Planner');

/**
 * Planner configuration.
 */
export interface PlannerConfig {
  apiKey: string;
  model: string;
  apiBaseUrl?: string;
}

/**
 * Planner for decomposing complex tasks.
 *
 * Uses skill files for behavior definition.
 */
export class Planner {
  readonly apiKey: string;
  readonly model: string;
  readonly apiBaseUrl: string | undefined;
  readonly workingDirectory: string;
  private skill?: ParsedSkill;
  private initialized = false;
  private logger = createLogger('Planner', { model: '' });

  constructor(config: PlannerConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.apiBaseUrl = config.apiBaseUrl;
    this.workingDirectory = Config.getWorkspaceDir();
    this.logger = createLogger('Planner', { model: this.model });
  }

  /**
   * Initialize planner by loading skill file.
   * Must be called before planTask().
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.loadSkill();
    this.initialized = true;
  }

  /**
   * Load skill file for this agent.
   * Skill loading is required - throws error if not found.
   */
  private async loadSkill(): Promise<void> {
    this.skill = await loadSkillOrThrow('planner');
    this.logger.debug({
      skillName: this.skill.name,
      toolCount: this.skill.allowedTools.length,
      contentLength: this.skill.content.length,
    }, 'Planner skill loaded');
  }

  /**
   * Generate a unique task ID.
   */
  private generateTaskId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `long-task-${timestamp}-${random}`;
  }

  /**
   * Build task planning prompt (static method for consistency with other agents).
   *
   * @param userRequest - User's original request
   * @param skillContent - Required skill content for behavior definition
   * @returns Formatted planning prompt
   */
  static buildPlanningPrompt(userRequest: string, skillContent: string): string {
    return `${skillContent}\n\n## User Request\n\n${userRequest}`;
  }

  /**
   * Plan a long task by breaking it into subtasks.
   */
  async planTask(userRequest: string, agentOptions?: { model?: string; apiBaseUrl?: string }): Promise<LongTaskPlan> {
    // Ensure initialization (load skill)
    if (!this.initialized) {
      await this.initialize();
    }

    const taskId = this.generateTaskId();

    // Create SDK options using unified helper
    // Skill is required, so allowedTools is always defined
    const allowedTools = this.skill!.allowedTools;

    const sdkOptions: Record<string, unknown> = {
      cwd: this.workingDirectory,
      permissionMode: 'bypassPermissions',
      settingSources: ['project'],
      allowedTools,  // Planning doesn't need browser tools
    };

    // Set environment using unified helper (includes process.env inheritance!)
    const apiBaseUrl = agentOptions?.apiBaseUrl || this.apiBaseUrl;
    sdkOptions.env = buildSdkEnv(this.apiKey, apiBaseUrl);

    // Set model
    const model = agentOptions?.model || this.model;
    if (model) {
      sdkOptions.model = model;
    }

    try {
      logger.debug({
        taskId,
        userRequest,
        model: agentOptions?.model || this.model,
        sdkOptionsKeys: Object.keys(sdkOptions),
        allowedTools: (sdkOptions as { allowedTools?: string[] }).allowedTools,
        hasEnv: !!(sdkOptions as { env?: Record<string, unknown> }).env,
        cwd: (sdkOptions as { cwd?: string }).cwd,
      }, 'Calling SDK query() for task planning');

      // Query planning agent with skill content
      const queryResult = query({
        prompt: Planner.buildPlanningPrompt(userRequest, this.skill!.content),
        options: sdkOptions,
      });

      // Collect response
      let fullResponse = '';
      let messageCount = 0;
      for await (const message of queryResult) {
        messageCount++;
        const parsed = parseSDKMessage(message);
        if (parsed.content) {
          fullResponse += parsed.content;
        }
      }

      logger.debug({
        taskId,
        messageCount,
        responseLength: fullResponse.length,
      }, 'SDK query() completed, response collected');

      // Extract JSON from response
      const planData = this.extractPlanFromResponse(fullResponse);

      // Create plan object
      const plan: LongTaskPlan = {
        taskId,
        originalRequest: userRequest,
        title: planData.title || 'Untitled Task',
        description: planData.description || userRequest,
        subtasks: planData.subtasks || [],
        totalSteps: planData.subtasks?.length || 0,
        createdAt: new Date().toISOString(),
      };

      // Validate plan
      this.validatePlan(plan);

      logger.info({
        taskId,
        title: plan.title,
        subtaskCount: plan.totalSteps,
      }, 'Task plan created successfully');

      return plan;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, 'Task planning failed');
      throw new Error(`Task planning failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract JSON plan from agent response.
   * Handles cases where agent wraps JSON in markdown or adds explanatory text.
   */
  private extractPlanFromResponse(response: string): any {
    let cleaned = response.trim();

    // Remove markdown code blocks if present
    const jsonCodeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonCodeBlockMatch) {
      const [, extracted] = jsonCodeBlockMatch;
      cleaned = extracted;
    }

    // Try to find JSON object boundaries
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(cleaned);
    } catch (error) {
      throw new Error(`Failed to parse plan JSON: ${error instanceof Error ? error.message : String(error)}\n\nExtracted content:\n${cleaned}`);
    }
  }

  /**
   * Validate that the plan meets requirements.
   */
  private validatePlan(plan: LongTaskPlan): void {
    if (!plan.title || plan.title.trim() === '') {
      throw new Error('Plan must have a title');
    }

    if (!plan.subtasks || plan.subtasks.length === 0) {
      throw new Error('Plan must have at least one subtask');
    }

    if (plan.subtasks.length > 10) {
      throw new Error(`Plan should have at most 10 subtasks (current: ${  plan.subtasks.length  })`);
    }

    // Validate each subtask
    for (let i = 0; i < plan.subtasks.length; i++) {
      const subtask = plan.subtasks[i];

      if (subtask.sequence !== i + 1) {
        throw new Error(`Subtask ${i + 1} has incorrect sequence number: ${subtask.sequence}`);
      }

      if (!subtask.title || subtask.title.trim() === '') {
        throw new Error(`Subtask ${i + 1} must have a title`);
      }

      if (!subtask.description || subtask.description.trim() === '') {
        throw new Error(`Subtask ${i + 1} must have a description`);
      }

      if (!subtask.inputs || !subtask.outputs) {
        throw new Error(`Subtask ${i + 1} must have inputs and outputs`);
      }

      if (!subtask.outputs.summaryFile) {
        throw new Error(`Subtask ${i + 1} must specify a summaryFile in outputs`);
      }

      // Validate markdown requirements if present
      if (subtask.outputs.markdownRequirements) {
        for (let j = 0; j < subtask.outputs.markdownRequirements.length; j++) {
          const req = subtask.outputs.markdownRequirements[j];

          if (!req.id || req.id.trim() === '') {
            throw new Error(`Subtask ${i + 1} markdown requirement ${j + 1} must have an id`);
          }

          if (!req.title || req.title.trim() === '') {
            throw new Error(`Subtask ${i + 1} markdown requirement ${j + 1} must have a title`);
          }

          if (!req.content || req.content.trim() === '') {
            throw new Error(`Subtask ${i + 1} markdown requirement ${j + 1} must have content description`);
          }

          if (typeof req.required !== 'boolean') {
            throw new Error(`Subtask ${i + 1} markdown requirement ${j + 1} must specify required as boolean`);
          }

          // Check for duplicate IDs
          const duplicateCount = subtask.outputs.markdownRequirements!.filter(r => r.id === req.id).length;
          if (duplicateCount > 1) {
            throw new Error(`Subtask ${i + 1} has duplicate markdown requirement id: ${req.id}`);
          }
        }
      }
    }

    // Validate inter-step references point to valid sections
    this.validateInterStepReferences(plan);
  }

  /**
   * Validate that cross-step references are valid.
   */
  private validateInterStepReferences(plan: LongTaskPlan): void {
    for (let i = 0; i < plan.subtasks.length; i++) {
      const subtask = plan.subtasks[i];

      // Check if sources reference previous steps
      if (subtask.inputs.sources) {
        for (const source of subtask.inputs.sources) {
          // Match pattern like "subtask-1/summary.md#section-id"
          const match = source.match(/^subtask-(\d+)\/[^#]+(?:#(.+))?$/);
          if (match) {
            const [, stepStr, sectionId] = match;
            const sourceStep = parseInt(stepStr, 10);

            // Check that source step exists and is before current step
            if (sourceStep >= subtask.sequence) {
              throw new Error(`Subtask ${i + 1} references future or current step ${sourceStep} in sources`);
            }

            // If section reference exists, validate it's defined in the source step
            if (sectionId) {
              const sourceSubtask = plan.subtasks[sourceStep - 1];
              if (sourceSubtask.outputs.markdownRequirements) {
                const hasSection = sourceSubtask.outputs.markdownRequirements.some(r => r.id === sectionId);
                if (!hasSection) {
                  throw new Error(`Subtask ${i + 1} references undefined section '${sectionId}' from step ${sourceStep}`);
                }
              } else {
                throw new Error(`Subtask ${i + 1} references section '${sectionId}' from step ${sourceStep}, but that step has no markdown requirements defined`);
              }
            }
          }
        }
      }
    }
  }
}
