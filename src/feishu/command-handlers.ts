/**
 * Command handlers for Feishu bot.
 *
 * This module extracts command handling logic from the main bot class
 * to improve modularity and maintainability.
 */

import { LongTaskManager } from '../long-task/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('CommandHandlers');

/**
 * Command handler context
 */
export interface CommandHandlerContext {
  chatId: string;
  sendMessage: (chatId: string, message: string) => Promise<void>;
  longTaskManagers: Map<string, LongTaskManager>;
}

/**
 * Handle /reset command - clear conversation history
 */
export async function handleResetCommand(
  context: CommandHandlerContext
): Promise<void> {
  const { chatId, sendMessage } = context;

  logger.info({ chatId }, 'Reset command triggered');

  try {
    // Sessions are no longer tracked - each task is independent
    await sendMessage(
      chatId,
      '✅ Each conversation is independent. Just send a new message to start fresh.'
    );
  } catch (error) {
    logger.error({ err: error, chatId }, 'Failed to send reset response');

    await sendMessage(
      chatId,
      '❌ Failed to process reset command. Please try again.'
    );
  }
}

/**
 * Handle /status command - show current task status
 */
export async function handleStatusCommand(
  context: CommandHandlerContext
): Promise<void> {
  const { chatId, sendMessage, longTaskManagers } = context;

  logger.info({ chatId }, 'Status command triggered');

  try {
    // Get long task status
    const taskManager = longTaskManagers.get(chatId);
    let statusMessage = '📊 **Current Status**\n\n';

    if (taskManager) {
      const activeTasks = taskManager.getActiveTasks();
      if (activeTasks.size > 0) {
        const tasksInfo = Array.from(activeTasks.values())
          .map(
            (state) =>
              `- **${state.plan.title}**\n  Status: ${state.status}\n  Step: ${state.currentStep}/${state.plan.totalSteps}`
          )
          .join('\n\n');

        statusMessage += `📊 **Long Task Status**\n\nActive tasks: ${activeTasks.size}\n\n${tasksInfo}`;
      } else {
        statusMessage += '⚠️ No long task is currently running.';
      }
    } else {
      statusMessage += '⚠️ No long task is currently running.\n\n💡 Regular tasks run independently and don\'t have persistent status.';
    }

    await sendMessage(chatId, statusMessage);
  } catch (error) {
    logger.error({ err: error, chatId }, 'Failed to get status');

    await sendMessage(
      chatId,
      '❌ Failed to retrieve status. Please try again.'
    );
  }
}

/**
 * Handle /help command - show help message
 */
export async function handleHelpCommand(
  context: CommandHandlerContext
): Promise<void> {
  const { chatId, sendMessage } = context;

  logger.info({ chatId }, 'Help command triggered');

  const helpMessage = `📖 **Help & Commands**

**Available Commands:**
• /reset - Clear conversation history
• /status - Show session and task status
• /help - Show this help message

**Long Task Mode:**
• /long <task> - Start long task workflow (24h timeout, multi-step)
• /cancel - Cancel running long task

**Task Mode (Default):**
• All messages use dual-agent mode (Worker + Manager)

**Examples:**
\`\`\`
Analyze the authentication system
/long Refactor user module with tests
/reset
\`\`\`

**How It Works:**
1. Your message creates a Task.md file
2. Worker explores and executes
3. Manager evaluates and plans
4. Loop continues until task is complete
`;

  await sendMessage(chatId, helpMessage);
}

/**
 * Handle /long command - start long task workflow
 */
export async function handleLongTaskCommand(
  context: CommandHandlerContext,
  userRequest: string
): Promise<void> {
  const { chatId, sendMessage, longTaskManagers } = context;

  logger.info({ chatId, task: userRequest }, 'Long task triggered');

  // Check if a task is already running
  const taskManager = longTaskManagers.get(chatId);

  if (taskManager) {
    await sendMessage(
      chatId,
      '⚠️ A long task is already running in this chat. Please wait for it to complete or use /cancel to stop it.'
    );
    return;
  }

  if (!userRequest) {
    await sendMessage(
      chatId,
      '⚠️ Usage: `/long <your task description>`\n\nExample: `/long Analyze the codebase and create documentation`'
    );
    return;
  }

  // Return success - caller should create and start the task manager
  // This is done to avoid importing Config and dependencies in this module
}

/**
 * Handle /cancel command - cancel running long task
 */
export async function handleCancelCommand(
  context: CommandHandlerContext
): Promise<boolean> {
  const { chatId, sendMessage, longTaskManagers } = context;

  logger.info({ chatId }, 'Cancel command triggered');

  const taskManager = longTaskManagers.get(chatId);

  if (!taskManager) {
    await sendMessage(
      chatId,
      '⚠️ No long task is currently running in this chat.'
    );
    return false;
  }

  const cancelled = await taskManager.cancelTask(chatId);

  if (cancelled) {
    await sendMessage(chatId, '✅ Long task cancelled successfully.');
    // Clean up manager after cancellation
    longTaskManagers.delete(chatId);
    return true;
  } else {
    await sendMessage(chatId, '❌ Failed to cancel long task.');
    return false;
  }
}

/**
 * Check if text is a command
 */
export function isCommand(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed === '/reset' ||
    trimmed === '/status' ||
    trimmed === '/help' ||
    trimmed === '/cancel' ||
    trimmed.startsWith('/long ')
  );
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
 * Execute command
 *
 * Returns true if command was handled, false otherwise
 */
export async function executeCommand(
  context: CommandHandlerContext,
  text: string
): Promise<boolean> {
  const trimmed = text.trim();

  // Handle simple commands
  if (trimmed === '/reset') {
    await handleResetCommand(context);
    return true;
  }

  if (trimmed === '/status') {
    await handleStatusCommand(context);
    return true;
  }

  if (trimmed === '/help') {
    await handleHelpCommand(context);
    return true;
  }

  if (trimmed === '/cancel') {
    await handleCancelCommand(context);
    return true;
  }

  // Handle commands with arguments
  if (trimmed.startsWith('/long ')) {
    const args = trimmed.substring(6).trim();
    await handleLongTaskCommand(context, args);
    return true;
  }

  return false;
}
