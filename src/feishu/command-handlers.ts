/**
 * Command handlers for Feishu bot.
 *
 * This module extracts command handling logic from the main bot class
 * to improve modularity and maintainability.
 *
 * Only /task command is specially handled. All other messages (including
 * any potential commands like /status, /help, /cancel) are passed through
 * to the Agent SDK for direct processing.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('CommandHandlers');

/**
 * Command handler context
 */
export interface CommandHandlerContext {
  chatId: string;
  sendMessage: (chatId: string, message: string) => Promise<void>;
}

/**
 * Handle /task command - start structured task workflow (Scout + TaskPlanner)
 */
export async function handleTaskCommand(
  context: CommandHandlerContext,
  userRequest: string
): Promise<void> {
  const { chatId, sendMessage } = context;

  logger.info({ chatId, task: userRequest }, 'Task command triggered');

  if (!userRequest) {
    await sendMessage(
      chatId,
      '⚠️ Usage: `/task <your task description>`\n\nExample: `/task Analyze the authentication system`'
    );
    return;
  }

  // Return success - caller will handle the task flow
  // This keeps the module clean by avoiding Config imports
}

/**
 * Check if text is a /task command.
 *
 * Note: All other text (including any other "commands") are passed to the SDK.
 */
export function isCommand(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('/task ');
}

/**
 * Parse command from text
 */
export function parseCommand(text: string): {
  command: string;
  args: string;
} | null {
  const trimmed = text.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const spaceIndex = trimmed.indexOf(' ');

  if (spaceIndex === -1) {
    return { command: trimmed, args: '' };
  }

  return {
    command: trimmed.substring(0, spaceIndex),
    args: trimmed.substring(spaceIndex + 1),
  };
}

/**
 * Execute command.
 *
 * Only handles /task command. Returns true if handled, false otherwise.
 *
 * Note: /reset and any other potential commands are passed to the Agent SDK.
 */
export async function executeCommand(
  context: CommandHandlerContext,
  text: string
): Promise<boolean> {
  const trimmed = text.trim();

  // Handle /task command with arguments
  if (trimmed.startsWith('/task ')) {
    const args = trimmed.substring(6).trim();
    await handleTaskCommand(context, args);
    return true;
  }

  return false;
}
