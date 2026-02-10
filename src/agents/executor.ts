/**
 * Executor - runs individual subtasks with isolated agents.
 *
 * Refactored to yield progress events instead of handling reporting directly.
 * The IterationBridge layer connects these events to the Reporter for user communication.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createAgentSdkOptions, parseSDKMessage } from '../utils/sdk.js';
import type { Subtask, SubtaskResult, LongTaskConfig } from './types.js';
import type { ParsedSDKMessage } from '../types/agent.js';

/**
 * Executor configuration.
 *
 * Extends LongTaskConfig with API credentials for consistency with other agents.
 */
export interface ExecutorConfig {
  apiKey: string;
  model: string;
  apiBaseUrl?: string;
  abortSignal?: AbortSignal;
  totalSteps?: number;
}

/**
 * Progress event type for subtask execution.
 * These events are yielded during execution and passed to the Reporter by the IterationBridge.
 */
export type SubtaskProgressEvent =
  | {
      type: 'start';
      sequence: number;
      totalSteps: number;
      title: string;
      description: string;
    }
  | {
      type: 'output';
      content: string;
      messageType: string;
      metadata?: ParsedSDKMessage['metadata'];
    }
  | {
      type: 'complete';
      sequence: number;
      title: string;
      files: string[];
      summaryFile: string;
    }
  | {
      type: 'error';
      sequence: number;
      title: string;
      error: string;
    };

/**
 * Executor for running individual subtasks.
 *
 * Yields progress events during execution without handling user communication.
 * All reporting is delegated to the Reporter via the IterationBridge layer.
 */
export class Executor {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly config: LongTaskConfig;

  constructor(apiKey: string, model: string, config: LongTaskConfig) {
    this.apiKey = apiKey;
    this.model = model;
    this.config = config;
  }

  /**
   * Execute a single subtask with a fresh agent.
   *
   * Yields progress events during execution:
   * - 'start': When the subtask begins
   * - 'output': For each message from the agent
   * - 'complete': When the subtask succeeds
   * - 'error': When the subtask fails
   *
   * Returns the final SubtaskResult when complete.
   */
  async *executeSubtask(
    subtask: Subtask,
    previousResults: SubtaskResult[],
    workspaceDir: string
  ): AsyncGenerator<SubtaskProgressEvent, SubtaskResult> {
    const subtaskDir = path.join(workspaceDir, `subtask-${subtask.sequence}`);

    // Check for cancellation before starting
    if (this.config.abortSignal?.aborted) {
      throw new Error('AbortError');
    }

    await fs.mkdir(subtaskDir, { recursive: true });

    console.log(`[Executor] Starting subtask ${subtask.sequence}: ${subtask.title}`);

    // Prepare context from previous results
    const contextInfo = this.buildContextInfo(previousResults);

    // Create execution prompt using static method
    const prompt = Executor.buildExecutionPrompt(subtask, contextInfo, subtaskDir);

    // Create SDK options for isolated agent using shared utility
    const sdkOptions = createAgentSdkOptions({
      apiKey: this.apiKey,
      model: this.model,
      apiBaseUrl: this.config.apiBaseUrl,
      cwd: subtaskDir,
      permissionMode: 'bypassPermissions',
    });

    const startTime = Date.now();

    try {
      // Yield start event (reporting layer will format and send to user)
      yield {
        type: 'start',
        sequence: subtask.sequence,
        totalSteps: this.config.totalSteps ?? 0,
        title: subtask.title,
        description: subtask.description,
      };

      // Execute subtask with fresh agent
      const queryResult = query({
        prompt,
        options: sdkOptions,
      });

      // Collect response and track created files
      let fullResponse = '';
      const createdFiles: string[] = [];

      // Track abort state
      let aborted = false;

      // Add abort listener (set flag instead of throwing)
      const abortHandler = () => {
        console.log(`[Executor] Subtask ${subtask.sequence} aborted`);
        aborted = true;
      };

      if (this.config.abortSignal) {
        this.config.abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      try {
        for await (const message of queryResult) {
          // Check for abort (from handler or signal state)
          if (aborted || this.config.abortSignal?.aborted) {
            throw new Error('AbortError');
          }
          // Check for cancellation during iteration
          if (this.config.abortSignal?.aborted) {
            throw new Error('AbortError');
          }

          const parsed = parseSDKMessage(message);

          if (parsed.content) {
            fullResponse += parsed.content;
          }

          // Yield output event (reporting layer will format and send to user)
          yield {
            type: 'output',
            content: parsed.content,
            messageType: parsed.type,
            metadata: parsed.metadata,
          };

          // Track file operations from metadata
          if (parsed.type === 'tool_use' && parsed.metadata?.toolName) {
            if (parsed.metadata.toolName === 'Write' || parsed.metadata.toolName === 'Edit') {
              // Extract file path from tool input if available in metadata
              if (
                parsed.metadata.toolInput &&
                typeof parsed.metadata.toolInput === 'string' &&
                parsed.metadata.toolInput.includes('Writing:')
              ) {
                // Parse file path from toolInput format: "Writing: /path/to/file"
                const match = parsed.metadata.toolInput.match(/Writing:|Editing:\s*(.+)/);
                if (match && match[1]) {
                  createdFiles.push(match[1].trim());
                }
              }
            }
          }
        }
      } finally {
        // Remove abort listener
        if (this.config.abortSignal) {
          this.config.abortSignal.removeEventListener('abort', abortHandler);
        }
      }

      // Ensure summary file exists (use basename to avoid path duplication)
      const summaryFile = path.join(subtaskDir, path.basename(subtask.outputs.summaryFile));

      // Check if summary file was created
      try {
        await fs.access(summaryFile);
      } catch {
        // Create default summary if agent didn't create one
        const defaultSummary = this.createDefaultSummary(subtask, fullResponse, createdFiles);
        await fs.writeFile(summaryFile, defaultSummary, 'utf-8');
      }

      // List all files created in subtask directory
      const files = await this.listCreatedFiles(subtaskDir);

      const duration = Date.now() - startTime;

      console.log(`[Executor] Completed subtask ${subtask.sequence} in ${duration}ms`);

      // Yield completion event (reporting layer will format and send to user)
      yield {
        type: 'complete',
        sequence: subtask.sequence,
        title: subtask.title,
        files,
        summaryFile,
      };

      return {
        sequence: subtask.sequence,
        success: true,
        summary: fullResponse,
        files,
        summaryFile,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[Executor] Subtask ${subtask.sequence} failed after ${duration}ms:`, error);

      // Check if it's an abort error
      if (error instanceof Error && error.message === 'AbortError') {
        throw error; // Re-raise abort error without sending message
      }

      // Yield error event (reporting layer will format and send to user)
      yield {
        type: 'error',
        sequence: subtask.sequence,
        title: subtask.title,
        error: error instanceof Error ? error.message : String(error),
      };

      return {
        sequence: subtask.sequence,
        success: false,
        summary: '',
        files: [],
        summaryFile: path.join(subtaskDir, path.basename(subtask.outputs.summaryFile)),
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Build context information from previous subtask results.
   */
  private buildContextInfo(previousResults: SubtaskResult[]): string {
    if (previousResults.length === 0) {
      return 'This is the first subtask. Start fresh based on the task description.';
    }

    const info: string[] = ['## Context from Previous Steps\n'];

    for (const result of previousResults) {
      info.push(`### Step ${result.sequence}\n`);
      info.push(`**Status**: ${result.success ? '✅ Completed' : '❌ Failed'}\n`);

      if (result.success) {
        info.push(`**Summary File**: \`${result.summaryFile}\`\n`);
        info.push('**Created Files**:\n');

        if (result.files.length > 0) {
          for (const file of result.files) {
            info.push(`- \`${file}\`\n`);
          }
        } else {
          info.push('(No files tracked)\n');
        }
      } else if (result.error) {
        info.push(`**Error**: ${result.error}\n`);
      }

      info.push('\n');
    }

    return info.join('');
  }

  /**
   * Build execution prompt for a subtask (static method for consistency with other agents).
   *
   * @param subtask - Subtask to execute
   * @param contextInfo - Context from previous steps
   * @param workspaceDir - Working directory for this subtask
   * @returns Formatted execution prompt
   */
  static buildExecutionPrompt(subtask: Subtask, contextInfo: string, workspaceDir: string): string {
    const markdownRequirements = Executor.formatMarkdownRequirements(subtask);

    return `You are executing a subtask in a long task workflow. You have a specific responsibility within the larger plan.

## Your Subtask

**Title**: ${subtask.title}

**Description**: ${subtask.description}

**Sequence**: Step ${subtask.sequence} in the workflow

## Inputs

${subtask.inputs.description}

**Sources**: ${subtask.inputs.sources.join(', ') || 'None (first step)'}

${subtask.inputs.context ? `**Additional Context**:\n${JSON.stringify(subtask.inputs.context, null, 2)}\n` : ''}

## Expected Outputs

${subtask.outputs.description}

**Required Files**:
${subtask.outputs.files.map(f => `- \`${f}\``).join('\n')}${markdownRequirements}

## Context from Previous Steps

${contextInfo}

## Working Directory

You are working in: \`${workspaceDir}\`

All files you create will be saved here. Use relative paths for file operations.

## Instructions

1. Read and understand the context from previous steps
2. If inputs reference specific markdown sections (using # notation), read those sections carefully
3. Execute your specific task as described
4. Create the required output files
5. **Crucially**: Create a comprehensive markdown summary at \`${subtask.outputs.summaryFile}\`
   - Follow the structure requirements above exactly
   - Ensure each section contains the specified content
   - This summary will be used by subsequent steps
6. Report your completion and summary

Begin your work now. Focus only on your assigned subtask.`;
  }

  /**
   * Format markdown requirements for the execution prompt (static helper).
   */
  private static formatMarkdownRequirements(subtask: Subtask): string {
    if (!subtask.outputs.markdownRequirements || subtask.outputs.markdownRequirements.length === 0) {
      return `

**Critical**: You MUST create a summary file at \`${subtask.outputs.summaryFile}\` containing:
- What was accomplished
- Key findings or results
- Files created (with brief descriptions)
- Any issues encountered
- Recommendations for next steps`;
    }

    const sections = subtask.outputs.markdownRequirements.map(req => {
      const requiredMark = req.required ? '✅ (Required)' : '⚪ (Optional)';
      return `
### ${req.title} ${requiredMark}
**Section ID**: \`${req.id}\`
**Content**: ${req.content}`;
    }).join('\n');

    return `

**Critical**: You MUST create a summary file at \`${subtask.outputs.summaryFile}\` with the following structure:

${sections}

**Important**: The section IDs (like \`${subtask.outputs.markdownRequirements[0]?.id || 'section-name'}\`) can be referenced by subsequent steps. Ensure your markdown uses these exact headings so the next step can find the information it needs.`;
  }

  /**
   * Create default summary if agent doesn't provide one.
   */
  private createDefaultSummary(subtask: Subtask, response: string, files: string[]): string {
    const date = new Date().toISOString();

    return `# Summary: ${subtask.title}

**Subtask Sequence**: ${subtask.sequence}
**Completed At**: ${date}

## What Was Done

${subtask.description}

## Agent Response

\`\`\`
${response.substring(0, 2000)}${response.length > 2000 ? '\n... (truncated)' : ''}
\`\`\`

## Files Created

${files.length > 0 ? files.map(f => `- \`${f}\``).join('\n') : 'No files were tracked.'}

## Notes

This summary was automatically generated. The agent should have created a more detailed summary.
`;
  }

  /**
   * List all files created in the subtask directory.
   */
  private async listCreatedFiles(subtaskDir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(subtaskDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          files.push(entry.name);
        } else if (entry.isDirectory()) {
          // Recursively list subdirectories
          const subPath = path.join(subtaskDir, entry.name);
          const subFiles = await this.listCreatedFiles(subPath);
          files.push(...subFiles.map(f => path.join(entry.name, f)));
        }
      }
    } catch (error) {
      console.error(`[Executor] Failed to list files in ${subtaskDir}:`, error);
    }

    return files;
  }
}
