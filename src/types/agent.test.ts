/**
 * Tests for agent types (src/types/agent.ts)
 *
 * Tests the following functionality:
 * - AgentMessageType enum values
 * - ContentBlock interface structure
 * - AgentMessageMetadata interface
 * - ParsedSDKMessage interface
 * - AgentMessage interface
 * - AgentOptions interface
 * - SessionInfo interface
 * - AgentInput union type
 * - ConversationHistory type
 */

import { describe, it, expect } from 'vitest';
import type {
  AgentMessageType,
  ContentBlock,
  AgentMessageMetadata,
  ParsedSDKMessage,
  AgentMessage,
  AgentOptions,
  SessionInfo,
  AgentInput,
  ConversationHistory,
} from '../../../src/types/agent.js';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

describe('Agent Types', () => {
  describe('AgentMessageType', () => {
    it('should have "text" type', () => {
      const messageType: AgentMessageType = 'text';
      expect(messageType).toBe('text');
    });

    it('should have "tool_use" type', () => {
      const messageType: AgentMessageType = 'tool_use';
      expect(messageType).toBe('tool_use');
    });

    it('should have "tool_progress" type', () => {
      const messageType: AgentMessageType = 'tool_progress';
      expect(messageType).toBe('tool_progress');
    });

    it('should have "tool_result" type', () => {
      const messageType: AgentMessageType = 'tool_result';
      expect(messageType).toBe('tool_result');
    });

    it('should have "error" type', () => {
      const messageType: AgentMessageType = 'error';
      expect(messageType).toBe('error');
    });

    it('should have "status" type', () => {
      const messageType: AgentMessageType = 'status';
      expect(messageType).toBe('status');
    });

    it('should have "result" type', () => {
      const messageType: AgentMessageType = 'result';
      expect(messageType).toBe('result');
    });

    it('should have "notification" type', () => {
      const messageType: AgentMessageType = 'notification';
      expect(messageType).toBe('notification');
    });

    it('should have "task_completion" type', () => {
      const messageType: AgentMessageType = 'task_completion';
      expect(messageType).toBe('task_completion');
    });

    it('should have "max_iterations_warning" type', () => {
      const messageType: AgentMessageType = 'max_iterations_warning';
      expect(messageType).toBe('max_iterations_warning');
    });

    it('should have all expected message types', () => {
      const types: AgentMessageType[] = [
        'text',
        'tool_use',
        'tool_progress',
        'tool_result',
        'error',
        'status',
        'result',
        'notification',
        'task_completion',
        'max_iterations_warning',
      ];

      expect(types).toHaveLength(10);
    });
  });

  describe('ContentBlock', () => {
    it('should allow text content block', () => {
      const block: ContentBlock = {
        type: 'text',
        text: 'Hello, world!',
      };

      expect(block.type).toBe('text');
      expect(block.text).toBe('Hello, world!');
    });

    it('should allow tool_use content block', () => {
      const block: ContentBlock = {
        type: 'tool_use',
        id: 'tool_123',
        name: 'read_file',
        input: { filePath: '/test.txt' },
      };

      expect(block.type).toBe('tool_use');
      expect(block.id).toBe('tool_123');
      expect(block.name).toBe('read_file');
    });

    it('should allow image content block', () => {
      const block: ContentBlock = {
        type: 'image',
      };

      expect(block.type).toBe('image');
    });

    it('should allow tool_result content block', () => {
      const block: ContentBlock = {
        type: 'tool_result',
        content: 'Result output',
      };

      expect(block.type).toBe('tool_result');
    });

    it('should allow thinking content block', () => {
      const block: ContentBlock = {
        type: 'thinking',
      };

      expect(block.type).toBe('thinking');
    });

    it('should allow additional properties via index signature', () => {
      const block: ContentBlock = {
        type: 'text',
        text: 'Test',
        customProperty: 'custom value',
      };

      expect(block.customProperty).toBe('custom value');
    });
  });

  describe('AgentMessageMetadata', () => {
    it('should allow empty metadata', () => {
      const metadata: AgentMessageMetadata = {};
      expect(Object.keys(metadata)).toHaveLength(0);
    });

    it('should allow toolName property', () => {
      const metadata: AgentMessageMetadata = {
        toolName: 'read_file',
      };

      expect(metadata.toolName).toBe('read_file');
    });

    it('should allow toolInput property', () => {
      const metadata: AgentMessageMetadata = {
        toolInput: '{"filePath": "/test.txt"}',
      };

      expect(metadata.toolInput).toBe('{"filePath": "/test.txt"}');
    });

    it('should allow toolInputRaw property', () => {
      const metadata: AgentMessageMetadata = {
        toolInputRaw: { filePath: '/test.txt' },
      };

      expect(metadata.toolInputRaw).toEqual({ filePath: '/test.txt' });
    });

    it('should allow toolOutput property', () => {
      const metadata: AgentMessageMetadata = {
        toolOutput: 'File content',
      };

      expect(metadata.toolOutput).toBe('File content');
    });

    it('should allow elapsed property', () => {
      const metadata: AgentMessageMetadata = {
        elapsed: 1234,
      };

      expect(metadata.elapsed).toBe(1234);
    });

    it('should allow cost property', () => {
      const metadata: AgentMessageMetadata = {
        cost: 0.05,
      };

      expect(metadata.cost).toBe(0.05);
    });

    it('should allow tokens property', () => {
      const metadata: AgentMessageMetadata = {
        tokens: 1000,
      };

      expect(metadata.tokens).toBe(1000);
    });

    it('should allow status property', () => {
      const metadata: AgentMessageMetadata = {
        status: 'success',
      };

      expect(metadata.status).toBe('success');
    });
  });

  describe('ParsedSDKMessage', () => {
    it('should create message with all properties', () => {
      const message: ParsedSDKMessage = {
        type: 'text',
        content: 'Hello',
        metadata: { status: 'success' },
        sessionId: 'sess_123',
      };

      expect(message.type).toBe('text');
      expect(message.content).toBe('Hello');
      expect(message.metadata?.status).toBe('success');
      expect(message.sessionId).toBe('sess_123');
    });

    it('should allow message without optional properties', () => {
      const message: ParsedSDKMessage = {
        type: 'text',
        content: 'Hello',
      };

      expect(message.type).toBe('text');
      expect(message.content).toBe('Hello');
      expect(message.metadata).toBeUndefined();
      expect(message.sessionId).toBeUndefined();
    });
  });

  describe('AgentMessage', () => {
    it('should create message with string content', () => {
      const message: AgentMessage = {
        content: 'Hello, world!',
        role: 'assistant',
        messageType: 'text',
      };

      expect(message.content).toBe('Hello, world!');
      expect(message.role).toBe('assistant');
      expect(message.messageType).toBe('text');
    });

    it('should create message with ContentBlock array', () => {
      const content: ContentBlock[] = [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'tool_1', name: 'read' },
      ];

      const message: AgentMessage = {
        content,
        messageType: 'text',
      };

      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content).toHaveLength(2);
    });

    it('should allow stop_reason property', () => {
      const message: AgentMessage = {
        content: 'Done',
        stop_reason: 'end_turn',
      };

      expect(message.stop_reason).toBe('end_turn');
    });

    it('should allow stop_sequence property', () => {
      const message: AgentMessage = {
        content: 'Done',
        stop_sequence: null,
      };

      expect(message.stop_sequence).toBeNull();
    });
  });

  describe('AgentOptions', () => {
    it('should create options with required properties', () => {
      const options: AgentOptions = {
        apiKey: 'test-key',
        model: 'claude-3-5-sonnet-20241022',
      };

      expect(options.apiKey).toBe('test-key');
      expect(options.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should allow apiBaseUrl property', () => {
      const options: AgentOptions = {
        apiKey: 'test-key',
        model: 'claude-3-5-sonnet-20241022',
        apiBaseUrl: 'https://api.example.com',
      };

      expect(options.apiBaseUrl).toBe('https://api.example.com');
    });

    it('should allow permissionMode property', () => {
      const modes: Array<AgentOptions['permissionMode']> = [
        'default',
        'acceptEdits',
        'bypassPermissions',
        'plan',
      ];

      modes.forEach((mode) => {
        const options: AgentOptions = {
          apiKey: 'test-key',
          model: 'claude-3-5-sonnet-20241022',
          permissionMode: mode,
        };

        expect(options.permissionMode).toBe(mode);
      });
    });

    it('should allow bypassPermissions property', () => {
      const options: AgentOptions = {
        apiKey: 'test-key',
        model: 'claude-3-5-sonnet-20241022',
        bypassPermissions: true,
      };

      expect(options.bypassPermissions).toBe(true);
    });
  });

  describe('SessionInfo', () => {
    it('should allow empty session info', () => {
      const sessionInfo: SessionInfo = {};

      expect(sessionInfo.sessionId).toBeUndefined();
      expect(sessionInfo.resume).toBeUndefined();
    });

    it('should allow sessionId property', () => {
      const sessionInfo: SessionInfo = {
        sessionId: 'sess_123',
      };

      expect(sessionInfo.sessionId).toBe('sess_123');
    });

    it('should allow resume property', () => {
      const sessionInfo: SessionInfo = {
        resume: 'resume_token',
      };

      expect(sessionInfo.resume).toBe('resume_token');
    });

    it('should allow both properties', () => {
      const sessionInfo: SessionInfo = {
        sessionId: 'sess_123',
        resume: 'resume_token',
      };

      expect(sessionInfo.sessionId).toBe('sess_123');
      expect(sessionInfo.resume).toBe('resume_token');
    });
  });

  describe('AgentInput', () => {
    it('should accept string input', () => {
      const input: AgentInput = 'Hello, agent!';

      expect(typeof input).toBe('string');
    });

    it('should accept async iterable input', () => {
      const asyncIterable: AsyncIterable<SDKUserMessage> = (async function* () {
        yield { type: 'text', text: 'Message 1' } as SDKUserMessage;
        yield { type: 'text', text: 'Message 2' } as SDKUserMessage;
      })();

      const input: AgentInput = asyncIterable;

      // Verify it's an async iterable
      expect(typeof input[Symbol.asyncIterator]).toBe('function');
    });
  });

  describe('ConversationHistory', () => {
    it('should accept SDKUserMessage array', () => {
      const history: ConversationHistory = [
        { type: 'text', text: 'Message 1' } as SDKUserMessage,
        { type: 'text', text: 'Message 2' } as SDKUserMessage,
      ];

      expect(history).toHaveLength(2);
      expect(history[0].text).toBe('Message 1');
      expect(history[1].text).toBe('Message 2');
    });

    it('should allow empty history', () => {
      const history: ConversationHistory = [];

      expect(history).toHaveLength(0);
    });

    it('should be an array type', () => {
      const history: ConversationHistory = [];

      expect(Array.isArray(history)).toBe(true);
    });
  });
});
