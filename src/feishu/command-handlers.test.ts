/**
 * Tests for command handlers (src/feishu/command-handlers.ts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleTaskCommand,
  isCommand,
  parseCommand,
  executeCommand,
  type CommandHandlerContext,
} from './command-handlers.js';

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('isCommand', () => {
  it('should return true for /task with arguments', () => {
    expect(isCommand('/task Test task')).toBe(true);
  });

  it('should return false for /task without arguments', () => {
    expect(isCommand('/task')).toBe(false);
  });

  it('should return false for /status', () => {
    expect(isCommand('/status')).toBe(false);
  });

  it('should return false for /help', () => {
    expect(isCommand('/help')).toBe(false);
  });

  it('should return false for /cancel', () => {
    expect(isCommand('/cancel')).toBe(false);
  });

  it('should return true for /reset', () => {
    expect(isCommand('/reset')).toBe(true);
  });

  it('should return false for non-command text', () => {
    expect(isCommand('Hello world')).toBe(false);
  });
});

describe('parseCommand', () => {
  it('should parse /task with arguments', () => {
    const result = parseCommand('/task test');
    expect(result).toEqual({ command: '/task', args: 'test' });
  });

  it('should parse command without arguments', () => {
    const result = parseCommand('/status');
    expect(result).toEqual({ command: '/status', args: '' });
  });

  it('should return null for non-command text', () => {
    const result = parseCommand('Hello world');
    expect(result).toBeNull();
  });
});

describe('handleTaskCommand', () => {
  let mockContext: CommandHandlerContext;
  let mockSendMessage: any;

  beforeEach(() => {
    mockSendMessage = vi.fn().mockResolvedValue(undefined);
    mockContext = {
      chatId: 'oc_test123',
      sendMessage: mockSendMessage,
    };
  });

  it('should return success for valid task', async () => {
    await handleTaskCommand(mockContext, 'Analyze the code');
    // Should not send error message
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('should send usage hint when task is empty', async () => {
    await handleTaskCommand(mockContext, '');
    expect(mockSendMessage).toHaveBeenCalledWith(
      'oc_test123',
      expect.stringContaining('Usage:')
    );
  });
});

describe('executeCommand', () => {
  let mockContext: CommandHandlerContext;
  let mockSendMessage: any;

  beforeEach(() => {
    mockSendMessage = vi.fn().mockResolvedValue(undefined);
    mockContext = {
      chatId: 'oc_test123',
      sendMessage: mockSendMessage,
    };
  });

  it('should execute /task command', async () => {
    const result = await executeCommand(mockContext, '/task Analyze code');
    expect(result).toBe(true);
  });

  it('should return false for /status (passed to SDK)', async () => {
    const result = await executeCommand(mockContext, '/status');
    expect(result).toBe(false);
  });

  it('should return false for /help (passed to SDK)', async () => {
    const result = await executeCommand(mockContext, '/help');
    expect(result).toBe(false);
  });

  it('should return false for /cancel (passed to SDK)', async () => {
    const result = await executeCommand(mockContext, '/cancel');
    expect(result).toBe(false);
  });

  it('should return true for /reset (handled by command handler)', async () => {
    const result = await executeCommand(mockContext, '/reset');
    expect(result).toBe(true);
  });

  it('should return false for non-command', async () => {
    const result = await executeCommand(mockContext, 'Hello');
    expect(result).toBe(false);
  });
});
