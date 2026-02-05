/**
 * Bot runner functions for Feishu/Lark.
 */
import { Config } from './config/index.js';
import { FeishuBot } from './feishu/index.js';

/**
 * Run Feishu/Lark bot.
 */
export async function runFeishu(): Promise<void> {
  console.log('Initializing Feishu/Lark bot...');

  // Create Feishu bot
  const bot = new FeishuBot(Config.FEISHU_APP_ID!, Config.FEISHU_APP_SECRET!);

  // Run bot (blocking)
  await bot.start();
}
