/**
 * Greeting Executor - Generates friendly, informative responses for user greetings.
 *
 * This module handles common user greetings (hello, hi, hey, etc.) and provides
 * a warm introduction to Disclaude's capabilities. It serves as the first point
 * of contact for new users and helps them understand what Disclaude can do.
 *
 * Design Principles:
 * - Friendly and welcoming tone
 * - Clear explanation of core capabilities
 * - Actionable examples to get users started
 * - Concise but comprehensive
 *
 * @module agents/greeting-executor
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('GreetingExecutor');

/**
 * Common greeting patterns to detect.
 */
const GREETING_PATTERNS = [
  'hello',
  'hi',
  'hey',
  'greetings',
  'good morning',
  'good afternoon',
  'good evening',
  '嗨', // Chinese
  '嗨你好', // Combined Chinese greeting
  '你好',
  '您好',
];

/**
 * Check if the user's message is a greeting.
 *
 * @param text - User's message text (lowercase)
 * @returns true if the message appears to be a greeting
 */
export function isGreeting(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  // Remove common punctuation for matching
  const cleanText = trimmed.replace(/[!?,.。，！？]/g, '');

  // Check if any greeting pattern matches at the start of the text
  return GREETING_PATTERNS.some(pattern => {
    const patternLower = pattern.toLowerCase();

    // Exact match
    if (cleanText === patternLower) {
      return true;
    }

    // Pattern followed by space or punctuation (boundary check)
    // This prevents matching "hello" in "hello world code"
    const patternWithSpace = patternLower + ' ';
    const patternWithChineseComma = patternLower + '，';
    const patternWithChineseExclamation = patternLower + '！';

    if (cleanText.startsWith(patternWithSpace) ||
        cleanText.startsWith(patternWithChineseComma) ||
        cleanText.startsWith(patternWithChineseExclamation)) {
      return true;
    }

    return false;
  });
}

/**
 * Generate a friendly greeting response that introduces Disclaude.
 *
 * The response includes:
 * - Warm welcome message
 * - Brief overview of Disclaude's identity and purpose
 * - Architectural context (messaging platform + Claude Agent SDK bridge)
 * - Mode explanation (CLI mode vs Feishu/Lark bot mode)
 * - Key capabilities with examples
 * - How to get started
 *
 * @returns Formatted greeting response text
 */
export function generateGreetingResponse(): string {
  const response = '👋 你好！我是 Disclaude，你的 AI 智能助手！\n\n' +
'**🤖 关于我：**\n' +
'我是飞书/Lark 与 Claude Agent SDK 之间的桥梁，为你带来强大的 AI 能力：\n' +
'• **Bot 模式** - 在飞书中与我对话，享受完整的生产力助手体验\n' +
'• **CLI 模式** - 通过命令行快速测试和开发，获得即时反馈\n\n' +
'我很高兴见到你！我可以帮助你完成各种任务：\n\n' +
'**🚀 我能做什么：**\n' +
'• **代码开发** - 编写、调试、重构代码（支持多种编程语言）\n' +
'• **文件操作** - 读取、编辑、创建文件\n' +
'• **数据分析** - 分析代码库、查找信息、生成报告\n' +
'• **任务执行** - 运行命令、执行测试、管理项目\n' +
'• **智能对话** - 回答问题、提供解释、技术支持\n\n' +
'**💡 快速开始：**\n' +
'试试这些命令：\n' +
'- 直接问我问题：*"如何用 Python 读取 JSON 文件？"*\n' +
'- 给我任务：*"创建一个 TypeScript 函数来解析日期"*\n' +
'- 分享文件：上传图片或文件，我来帮你分析\n' +
'- 长任务：使用 `/task` 命令启动复杂任务流程\n\n' +
'**📚 更多命令：**\n' +
'• `/reset` - 重置对话\n' +
'• `/status` - 查看当前状态\n' +
'• `/task <描述>` - 启动任务流程（Scout + 执行器）\n\n' +
'准备好了吗？有什么我可以帮你的吗？😊';

  logger.debug('Generated greeting response');

  return response;
}

/**
 * Process a user message and return a greeting response if appropriate.
 *
 * This is the main entry point for greeting detection and generation.
 *
 * @param text - User's message text
 * @returns Greeting response if detected, null otherwise
 */
export function handleGreeting(text: string): string | null {
  if (isGreeting(text)) {
    logger.info({ textLength: text.length }, 'Greeting detected, generating response');
    return generateGreetingResponse();
  }

  return null;
}
