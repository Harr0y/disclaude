/**
 * Bot runner functions for Feishu/Lark.
 */
import { Config } from './config/index.js';
import { FeishuBot, SessionManager } from './feishu/index.js';

/**
 * Run Feishu/Lark bot.
 */
export async function runFeishu(): Promise<void> {
  console.log('Initializing Feishu/Lark bot...');

  // Initialize session manager
  const sessionManager = new SessionManager();

  // Create Feishu bot
  const bot = new FeishuBot(Config.FEISHU_APP_ID!, Config.FEISHU_APP_SECRET!, sessionManager);

  // Run bot (blocking)
  await bot.start();
}
