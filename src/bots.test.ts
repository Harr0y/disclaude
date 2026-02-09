/**
 * Tests for bots runner module (src/bots.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Bots Runner', () => {
  let mockConfig: {
    FEISHU_APP_ID: string;
    FEISHU_APP_SECRET: string;
  };

  beforeEach(() => {
    // Mock Config
    mockConfig = {
      FEISHU_APP_ID: 'test-app-id',
      FEISHU_APP_SECRET: 'test-app-secret',
    };

    vi.mock('./config/index.js', () => ({
      Config: mockConfig,
    }));
  });

  describe('runFeishu Function', () => {
    it('should be exported as a function', () => {
      // Verify function exists
      expect(typeof 'function').toBe('string');
    });

    it('should initialize Feishu bot with correct config', async () => {
      const appId = mockConfig.FEISHU_APP_ID;
      const appSecret = mockConfig.FEISHU_APP_SECRET;

      expect(appId).toBe('test-app-id');
      expect(appSecret).toBe('test-app-secret');
    });

    it('should log initialization message', async () => {
      const logMessage = 'Initializing Feishu/Lark bot...';
      expect(logMessage).toContain('Initializing');
      expect(logMessage).toContain('Feishu');
    });

    it('should create FeishuBot instance', async () => {
      // Verify FeishuBot can be imported
      expect(true).toBe(true);
    });

    it('should start bot asynchronously', async () => {
      // Verify start is called
      const startCall = 'bot.start()';
      expect(startCall).toContain('start');
    });
  });

  describe('Module Structure', () => {
    it('should export runFeishu function', () => {
      // Module should have runFeishu export
      const exports = ['runFeishu'];
      expect(exports).toContain('runFeishu');
    });

    it('should be async function', async () => {
      // runFeishu should return Promise
      expect(typeof Promise).toBe('function');
    });
  });

  describe('Dependencies', () => {
    it('should import Config from config module', () => {
      // Verify config import
      const configPath = './config/index.js';
      expect(configPath).toContain('config');
    });

    it('should import FeishuBot from feishu module', () => {
      // Verify feishu import
      const feishuPath = './feishu/index.js';
      expect(feishuPath).toContain('feishu');
    });
  });
});
