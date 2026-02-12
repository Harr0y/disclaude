/**
 * Tests for Greeting Executor.
 */

import { describe, it, expect } from 'vitest';
import { isGreeting, generateGreetingResponse, handleGreeting } from './greeting-executor.js';

describe('Greeting Executor', () => {
  describe('isGreeting', () => {
    it('should detect English greetings', () => {
      expect(isGreeting('hello')).toBe(true);
      expect(isGreeting('hello there')).toBe(true);
      expect(isGreeting('hi')).toBe(true);
      expect(isGreeting('hi!')).toBe(true);
      expect(isGreeting('hey')).toBe(true);
      expect(isGreeting('hey there')).toBe(true);
      expect(isGreeting('greetings')).toBe(true);
      expect(isGreeting('hi, how are you?')).toBe(true);
    });

    it('should detect Chinese greetings', () => {
      expect(isGreeting('你好')).toBe(true);
      expect(isGreeting('您好')).toBe(true);
      expect(isGreeting('嗨')).toBe(true);
      expect(isGreeting('嗨，你好')).toBe(true);
      expect(isGreeting('你好！')).toBe(true);
    });

    it('should detect time-based greetings', () => {
      expect(isGreeting('good morning')).toBe(true);
      expect(isGreeting('good morning!')).toBe(true);
      expect(isGreeting('good afternoon')).toBe(true);
      expect(isGreeting('good evening')).toBe(true);
      expect(isGreeting('good morning, how are you?')).toBe(true);
    });

    it('should handle case insensitivity', () => {
      expect(isGreeting('HELLO')).toBe(true);
      expect(isGreeting('Hello')).toBe(true);
      expect(isGreeting('HeLLo')).toBe(true);
      expect(isGreeting('你好')).toBe(true);
      expect(isGreeting('NI HAO')).toBe(false); // Different phrase
    });

    it('should handle whitespace', () => {
      expect(isGreeting('  hello  ')).toBe(true);
      expect(isGreeting('\thi\n')).toBe(true);
      expect(isGreeting('  你好  ')).toBe(true);
    });

    it('should reject non-greeting messages', () => {
      expect(isGreeting('say hello to the world')).toBe(false);
      expect(isGreeting('what is hello?')).toBe(false);
      expect(isGreeting('help me')).toBe(false);
      expect(isGreeting('create a file')).toBe(false);
      expect(isGreeting('how do I write code')).toBe(false);
      expect(isGreeting('the code says hello')).toBe(false); // 'hello' not at start
      expect(isGreeting('helloworld')).toBe(false); // No space after greeting
    });

    it('should reject empty or whitespace-only messages', () => {
      expect(isGreeting('')).toBe(false);
      expect(isGreeting('   ')).toBe(false);
      expect(isGreeting('\t\n')).toBe(false);
    });
  });

  describe('generateGreetingResponse', () => {
    it('should generate a non-empty response', () => {
      const response = generateGreetingResponse();
      expect(response).toBeTruthy();
      expect(response.length).toBeGreaterThan(0);
    });

    it('should include key information sections', () => {
      const response = generateGreetingResponse();

      // Check for welcome message
      expect(response).toContain('Disclaude');

      // Check for architectural context (messaging platform + Claude Agent SDK)
      expect(response).toMatch(/飞书|Feishu|Lark/i);
      expect(response).toMatch(/Claude Agent SDK|SDK/i);

      // Check for mode explanation (Bot vs CLI)
      expect(response).toMatch(/Bot 模式|CLI 模式|命令行/i);

      // Check for capabilities section
      expect(response).toMatch(/我能做什么|capabilities/i);

      // Check for quick start section
      expect(response).toMatch(/快速开始|get started/i);

      // Check for commands section
      expect(response).toMatch(/命令|commands/i);
    });

    it('should mention key capabilities', () => {
      const response = generateGreetingResponse();

      expect(response).toMatch(/代码|code/i);
      expect(response).toMatch(/文件|file/i);
      expect(response).toMatch(/任务|task/i);
    });

    it('should include actionable examples', () => {
      const response = generateGreetingResponse();

      // Should have example prompts or commands
      expect(response).toContain('/task');
      expect(response).toContain('/reset');
    });

    it('should have a friendly tone', () => {
      const response = generateGreetingResponse();

      // Should have welcoming indicators
      expect(response).toMatch(/👋|😊|很高兴|welcome/i);
    });

    it('should explain the platform bridge architecture', () => {
      const response = generateGreetingResponse();

      // Should mention Feishu/Lark as messaging platform
      expect(response).toMatch(/飞书|Feishu|Lark/);

      // Should mention Claude Agent SDK
      expect(response).toMatch(/Claude Agent SDK|SDK/);

      // Should mention the bridge/bridge concept
      expect(response).toMatch(/桥梁|bridge/i);
    });

    it('should explain CLI and Bot modes', () => {
      const response = generateGreetingResponse();

      // Should mention Bot mode
      expect(response).toMatch(/Bot 模式|飞书.*对话/);

      // Should mention CLI mode
      expect(response).toMatch(/CLI 模式|命令行/);
    });
  });

  describe('handleGreeting', () => {
    it('should return response for greeting messages', () => {
      const result1 = handleGreeting('hello');
      expect(result1).toBeTruthy();
      expect(result1).toContain('Disclaude');

      const result2 = handleGreeting('你好');
      expect(result2).toBeTruthy();
      expect(result2).toContain('Disclaude');
    });

    it('should return null for non-greeting messages', () => {
      expect(handleGreeting('help me write code')).toBeNull();
      expect(handleGreeting('create a file')).toBeNull();
      expect(handleGreeting('what is the weather')).toBeNull();
      expect(handleGreeting('')).toBeNull();
    });

    it('should be case insensitive', () => {
      const result1 = handleGreeting('HELLO');
      expect(result1).toBeTruthy();

      const result2 = handleGreeting('HeLLo');
      expect(result2).toBeTruthy();
    });

    it('should handle greetings with extra text', () => {
      const result1 = handleGreeting('hello there');
      expect(result1).toBeTruthy();

      const result2 = handleGreeting('hi! how are you?');
      expect(result2).toBeTruthy();
    });

    it('should produce consistent responses', () => {
      const result1 = handleGreeting('hello');
      const result2 = handleGreeting('hi');
      expect(result1).toEqual(result2);
    });
  });
});
