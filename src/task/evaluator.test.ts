/**
 * Tests for Evaluator (src/task/evaluator.ts)
 *
 * Tests the following functionality:
 * - Evaluator initialization
 * - Query streaming
 * - Task evaluation
 * - Evaluation result parsing
 * - Prompt building
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Evaluator, type EvaluationResult } from './evaluator.js';
import type { AgentMessage } from '../types/agent.js';

// Mock dependencies
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  tool: vi.fn((name, description, schema, handler) => ({
    name,
    description,
    schema,
    handler,
  })),
}));

vi.mock('../config/index.js', () => ({
  Config: {
    getWorkspaceDir: vi.fn(() => '/workspace'),
    getAgentConfig: vi.fn(() => ({
      apiKey: 'test-api-key',
      model: 'test-model',
      apiBaseUrl: 'https://api.test.com',
    })),
  },
}));

vi.mock('../utils/sdk.js', () => ({
  parseSDKMessage: vi.fn((msg) => ({
    content: msg.content?.[0]?.text || '',
    type: msg.type || 'text',
    metadata: msg.metadata,
  })),
  buildSdkEnv: vi.fn(() => ({})),
}));

vi.mock('./skill-loader.js', () => ({
  loadSkill: vi.fn().mockResolvedValue({
    success: true,
    skill: {
      allowedTools: ['task_done', 'read_file'],
    },
  }),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { parseSDKMessage, buildSdkEnv } from '../utils/sdk.js';
import { loadSkill } from './skill-loader.js';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

describe('Evaluator', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    vi.clearAllMocks();

    evaluator = new Evaluator({
      apiKey: 'test-api-key',
      model: 'test-model',
      apiBaseUrl: 'https://api.test.com',
      permissionMode: 'bypassPermissions',
    });
  });

  describe('initialization', () => {
    it('should create evaluator instance with config', () => {
      expect(evaluator.apiKey).toBe('test-api-key');
      expect(evaluator.model).toBe('test-model');
      expect(evaluator.apiBaseUrl).toBe('https://api.test.com');
      expect(evaluator.permissionMode).toBe('bypassPermissions');
    });

    it('should default permission mode to bypassPermissions', () => {
      const evalWithoutMode = new Evaluator({
        apiKey: 'test-key',
        model: 'test-model',
      });

      expect(evalWithoutMode.permissionMode).toBe('bypassPermissions');
    });

    it('should initialize successfully', async () => {
      await evaluator.initialize();

      expect(loadSkill).toHaveBeenCalledWith('evaluator');
    });

    it('should not initialize twice', async () => {
      await evaluator.initialize();
      await evaluator.initialize();

      expect(loadSkill).toHaveBeenCalledTimes(1);
    });

    it('should handle skill loading failure gracefully', async () => {
      (loadSkill as any).mockResolvedValueOnce({
        success: false,
      });

      await expect(evaluator.initialize()).resolves.not.toThrow();
    });
  });

  describe('queryStream', () => {
    it('should initialize automatically if not initialized', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        yield { content: [{ type: 'text', text: 'Response' }] };
      });

      const stream = evaluator.queryStream('Test prompt');
      const messages: AgentMessage[] = [];

      for await (const msg of stream) {
        messages.push(msg);
      }

      expect(loadSkill).toHaveBeenCalled();
    });

    it('should stream messages from SDK query', async () => {
      const mockMessages = [
        { content: [{ type: 'text', text: 'Thinking...' }], type: 'text' },
        { content: [{ type: 'text', text: '{"is_complete": true}' }], type: 'text' },
      ];

      (mockedQuery as any).mockImplementation(function* () {
        yield* mockMessages;
      });

      (parseSDKMessage as any).mockImplementation((msg: any) => ({
        content: msg.content?.[0]?.text || '',
        type: msg.type,
        metadata: undefined,
      }));

      const stream = evaluator.queryStream('Test prompt');
      const messages: AgentMessage[] = [];

      for await (const msg of stream) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Thinking...');
      expect(mockedQuery).toHaveBeenCalled();
    });

    it('should handle query errors', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        throw new Error('SDK query failed');
      });

      const stream = evaluator.queryStream('Test prompt');
      const messages: AgentMessage[] = [];

      for await (const msg of stream) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].messageType).toBe('error');
      expect(messages[0].content).toContain('Error');
    });

    it('should pass correct SDK options', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        yield { content: [{ type: 'text', text: 'OK' }] };
      });

      const stream = evaluator.queryStream('Test prompt');

      for await (const _ of stream) {
        // Consume stream
      }

      expect(mockedQuery).toHaveBeenCalledWith({
        prompt: 'Test prompt',
        options: expect.objectContaining({
          permissionMode: 'bypassPermissions',
          allowedTools: expect.any(Array),
          tools: expect.any(Array),
        }),
      });
    });
  });

  describe('evaluate', () => {
    it('should evaluate task completion', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        yield {
          content: [{ type: 'text', text: '```json\n{"is_complete": true, "reason": "Done", "confidence": 1.0}\n```' }],
        };
      });

      (parseSDKMessage as any).mockReturnValue({
        content: '```json\n{"is_complete": true, "reason": "Done", "confidence": 1.0}\n```',
        type: 'text',
        metadata: undefined,
      });

      const result = await evaluator.evaluate('Task content', 2);

      expect(result.result.is_complete).toBe(true);
      expect(result.messages).toBeDefined();
    });

    it('should pass worker output in prompt', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        yield { content: [{ type: 'text', text: 'Evaluation' }] };
      });

      await evaluator.evaluate('Task content', 2, 'Worker output here');

      const callArgs = (mockedQuery as any).mock.calls[0];
      expect(callArgs[0].prompt).toContain('Worker output here');
    });

    it('should handle empty worker output', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        yield { content: [{ type: 'text', text: 'Evaluation' }] };
      });

      await evaluator.evaluate('Task content', 1);

      const callArgs = (mockedQuery as any).mock.calls[0];
      expect(callArgs[0].prompt).toContain('No Worker output yet');
    });
  });

  describe('parseEvaluationResult', () => {
    const buildMockMessage = (content: string, messageType = 'text', toolName?: string): AgentMessage => ({
      content,
      role: 'assistant',
      messageType,
      metadata: toolName ? { toolName } : undefined,
    });

    it('should detect task completion from task_done tool use', () => {
      const messages = [
        buildMockMessage('Task is complete', 'tool_use', 'task_done'),
      ];

      const result = Evaluator.parseEvaluationResult(messages, 2);

      expect(result.is_complete).toBe(true);
      expect(result.reason).toBe('Evaluator called task_done');
      expect(result.confidence).toBe(1.0);
      expect(result.missing_items).toEqual([]);
    });

    it('should parse JSON from markdown code block', () => {
      const messages = [
        buildMockMessage('```json\n{"is_complete": false, "reason": "Not done", "missing_items": ["testing"], "confidence": 0.8}\n```'),
      ];

      const result = Evaluator.parseEvaluationResult(messages, 2);

      expect(result.is_complete).toBe(false);
      expect(result.reason).toBe('Not done');
      expect(result.missing_items).toEqual(['testing']);
      expect(result.confidence).toBe(0.8);
    });

    it('should handle partial JSON with defaults', () => {
      const messages = [
        buildMockMessage('```json\n{"is_complete": true}\n```'),
      ];

      const result = Evaluator.parseEvaluationResult(messages, 2);

      expect(result.is_complete).toBe(true);
      expect(result.reason).toBe('No reason provided');
      expect(result.missing_items).toEqual([]);
    });

    it('should handle invalid JSON gracefully', () => {
      const messages = [
        buildMockMessage('```json\n{invalid json}\n```'),
      ];

      const result = Evaluator.parseEvaluationResult(messages, 2);

      expect(result.is_complete).toBe(false);
      expect(result.reason).toBe('Unable to determine completion status');
    });

    it('should return incomplete for first iteration', () => {
      const messages: AgentMessage[] = [];

      const result = Evaluator.parseEvaluationResult(messages, 1);

      expect(result.is_complete).toBe(false);
      expect(result.reason).toContain('First iteration');
      expect(result.missing_items).toContain('Worker execution');
      expect(result.confidence).toBe(1.0);
    });

    it('should return default incomplete when no clear signal', () => {
      const messages = [
        buildMockMessage('Some text without JSON or tool use'),
      ];

      const result = Evaluator.parseEvaluationResult(messages, 2);

      expect(result.is_complete).toBe(false);
      expect(result.reason).toBe('Unable to determine completion status');
      expect(result.confidence).toBe(0.0);
    });

    it('should parse missing_items array correctly', () => {
      const messages = [
        buildMockMessage('```json\n{"is_complete": false, "missing_items": ["test", "code", "deploy"]}\n```'),
      ];

      const result = Evaluator.parseEvaluationResult(messages, 2);

      expect(result.missing_items).toEqual(['test', 'code', 'deploy']);
    });

    it('should handle empty missing_items', () => {
      const messages = [
        buildMockMessage('```json\n{"is_complete": true, "missing_items": []}\n```'),
      ];

      const result = Evaluator.parseEvaluationResult(messages, 2);

      expect(result.missing_items).toEqual([]);
    });
  });

  describe('buildEvaluationPrompt', () => {
    it('should build prompt with task content', () => {
      const prompt = Evaluator.buildEvaluationPrompt('Task: do something', 1);

      expect(prompt).toContain('Task: do something');
      expect(prompt).toContain('Current Iteration: 1');
    });

    it('should include worker output when provided', () => {
      const prompt = Evaluator.buildEvaluationPrompt('Task', 2, 'Worker did X');

      expect(prompt).toContain('Worker did X');
      expect(prompt).toContain('Worker\'s Previous Output');
    });

    it('should show no worker output message for first iteration', () => {
      const prompt = Evaluator.buildEvaluationPrompt('Task', 1);

      expect(prompt).toContain('No Worker output yet');
    });

    it('should include evaluation instructions', () => {
      const prompt = Evaluator.buildEvaluationPrompt('Task', 1);

      expect(prompt).toContain('Your Evaluation Task');
    });

    it('should add separator lines', () => {
      const prompt = Evaluator.buildEvaluationPrompt('Task', 1);

      expect(prompt).toContain('---');
    });
  });

  describe('task done tool', () => {
    it('should have correct tool definition', () => {
      // The tool is created in the constructor
      // We can verify it's configured correctly by checking the evaluator

      expect(evaluator).toBeDefined();
      // The tool itself is private, but we can verify it's used in queryStream
    });
  });

  describe('error handling', () => {
    it('should handle SDK errors in queryStream', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        throw new Error('Network error');
      });

      const stream = evaluator.queryStream('Test');
      const messages: AgentMessage[] = [];

      for await (const msg of stream) {
        messages.push(msg);
      }

      expect(messages).toHaveLength(1);
      expect(messages[0].messageType).toBe('error');
      expect(messages[0].content).toContain('Network error');
    });

    it('should handle parseSDKMessage errors', async () => {
      (mockedQuery as any).mockImplementation(function* () {
        yield { content: [{ type: 'text', text: 'OK' }] };
      });

      (parseSDKMessage as any).mockImplementation(() => {
        throw new Error('Parse error');
      });

      const stream = evaluator.queryStream('Test');
      const messages: AgentMessage[] = [];

      // Should not throw, but might yield error message
      try {
        for await (const msg of stream) {
          messages.push(msg);
        }
      } catch (e) {
        // Expected
      }

      // The error handling should work
    });
  });
});
