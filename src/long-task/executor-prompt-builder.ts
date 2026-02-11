/**
 * Executor Prompt Builder Module - Centralized prompt building for Executor agent.
 *
 * This module provides reusable functions for building prompts with context
 * for the Executor agent when executing individual subtasks.
 */

import type { Subtask } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ExecutorPromptBuilder', {});

/**
 * Executor prompt context.
 */
export interface ExecutorPromptContext {
  /** Current subtask to execute */
  subtask: Subtask;
  /** Context information from previous subtask results */
  contextInfo: string;
  /** Working directory for this subtask */
  workspaceDir: string;
  /** Optional: Additional instructions */
  additionalInstructions?: string;
}

/**
 * Build execution prompt for a subtask.
 *
 * This function constructs a prompt that guides the Executor agent to:
 * 1. Read the plan.md file to understand the overall task
 * 2. Locate their specific step in the plan
 * 3. Review context from previous steps
 * 4. Execute their assigned task
 * 5. Create a detailed summary for the next step
 *
 * @param context - Executor prompt context
 * @returns Formatted execution prompt
 */
export function buildExecutorPrompt(context: ExecutorPromptContext): string {
  const { subtask, contextInfo, workspaceDir, additionalInstructions } = context;

  logger.debug({
    subtaskSequence: subtask.sequence,
    subtaskTitle: subtask.title,
    workspaceDir,
    contextInfoLength: contextInfo.length,
    hasAdditionalInstructions: !!additionalInstructions,
  }, 'Building executor prompt');

  // Use direct template (defined below)
  const promptTemplate = getDirectTemplate();

  // Replace placeholders in the template
  const prompt = promptTemplate
    .replace(/{stepNumber}/g, String(subtask.sequence))
    .replace('{workspaceDir}', workspaceDir)
    .replace('{contextInfo}', contextInfo)
    .replace('{additionalInstructions}', additionalInstructions || 'No additional instructions.');

  logger.debug({
    promptLength: prompt.length,
    promptPreview: prompt.substring(0, 200),
  }, 'Executor prompt built');

  return prompt;
}

/**
 * Get the direct prompt template for Executor agent.
 *
 * This template is explicitly defined in code (not loaded from external files)
 * to ensure stability and predictability of Executor's behavior.
 *
 * @returns Direct template string with placeholders
 */
function getDirectTemplate(): string {
  return `You are executing Step {stepNumber} of a multi-step task.

## Current Step

**Step Number**: {stepNumber}

## Working Directory

You are working in: \`{workspaceDir}\`

## Instructions

1. **Read the plan**: The execution plan is in the \`plan.md\` file in your parent directory (use relative path \`../plan.md\`)
2. **Find your step**: Locate "Step {stepNumber}" in the plan to understand your specific task
3. **Review context**: Check the context from previous steps below
4. **Execute your task**: Complete the work described in your step of the plan
5. **Create summary**: Write a detailed summary of your work in this directory for the next step to use

## Context from Previous Steps

{contextInfo}

## Additional Instructions

{additionalInstructions}

---

**Start by reading the ../plan.md file to understand your specific task for Step {stepNumber}.**

**Remember to create a summary.md file when you complete your work.**`;
}

/**
 * Build context information from previous subtask results.
 *
 * This function formats the results of previous subtasks into a structured
 * context that helps the current step understand what has been done before.
 *
 * @param previousResults - Array of previous subtask results
 * @returns Formatted context information string
 */
export function buildContextInfo(previousResults: import('./types.js').SubtaskResult[]): string {
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

  const contextInfo = info.join('');

  logger.debug({
    previousResultsCount: previousResults.length,
    contextInfoLength: contextInfo.length,
  }, 'Context info built');

  return contextInfo;
}
