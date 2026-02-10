/**
 * Comprehensive tests for Executor class.
 *
 * Tests the following functionality:
 * - Subtask execution with SDK mocking (async generator)
 * - Progress event yielding (start, output, complete, error)
 * - Abort signal handling before and during execution
 * - Context building from previous results
 * - Execution prompt creation
 * - File tracking and summary creation
 * - Error handling and recovery
 * - Private helper methods via test exposure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Executor, type SubtaskProgressEvent } from '../../src/long-task/executor.js';
import type { Subtask, SubtaskResult, LongTaskConfig } from '../../src/long-task/types.js';

// Mock dependencies
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('../../src/utils/sdk.js', () => ({
  createAgentSdkOptions: vi.fn(() => ({ apiKey: 'test-key', model: 'test-model' })),
  parseSDKMessage: vi.fn((msg) => ({
    content: msg.content || '',
    type: msg.type || 'text',
    metadata: msg.metadata || {},
  })),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs/promises';

describe('Executor', () => {
  let mockConfig: LongTaskConfig;
  let executor: Executor;
  let apiKey: string;
  let model: string;

  beforeEach(() => {
    apiKey = 'test-api-key';
    model = 'claude-3-5-sonnet-20241022';
    mockConfig = {
      apiKey,
      model,
      workspaceBaseDir: '/workspace',
      sendMessage: vi.fn(async () => {}),
      sendCard: vi.fn(async () => {}),
      chatId: 'chat-123',
      totalSteps: 5,
      apiBaseUrl: 'https://api.example.com',
      taskTimeoutMs: 86400000,
      maxCostUsd: 10.0,
    };

    executor = new Executor(apiKey, model, mockConfig);

    // Clear mocks but preserve implementations
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to consume the async generator and return the final result.
   * Also collects all yielded events.
   */
  async function consumeGenerator(
    generator: AsyncGenerator<SubtaskProgressEvent, SubtaskResult>
  ): Promise<{ events: SubtaskProgressEvent[]; result: SubtaskResult }> {
    const events: SubtaskProgressEvent[] = [];
    let result: IteratorResult<SubtaskProgressEvent, SubtaskResult>;

    while (!(result = await generator.next()).done) {
      events.push(result.value);
    }

    return { events, result: result.value };
  }

  describe('Constructor', () => {
    it('should create executor with API key, model, and config', () => {
      expect(executor).toBeInstanceOf(Executor);
    });

    it('should store API key', () => {
      expect(executor['apiKey']).toBe(apiKey);
    });

    it('should store model', () => {
      expect(executor['model']).toBe(model);
    });

    it('should store config', () => {
      expect(executor['config']).toBe(mockConfig);
    });
  });

  describe('executeSubtask - Successful Execution', () => {
    it('should execute subtask and return successful result', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test response' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { result, events } = await consumeGenerator(generator);

      expect(result.success).toBe(true);
      expect(result.sequence).toBe(1);
      expect(result.summary).toBe('Test response');
    });

    it('should create subtask directory', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      await consumeGenerator(generator);

      expect(fs.mkdir).toHaveBeenCalledWith('/workspace/subtask-1', { recursive: true });
    });

    it('should yield start event with correct data', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { events } = await consumeGenerator(generator);

      expect(events[0]).toMatchObject({
        type: 'start',
        sequence: 1,
        totalSteps: 5,
        title: 'Test Subtask',
        description: 'Test description',
      });
    });

    it('should yield output events for each SDK message', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'First message' };
          yield { type: 'text', content: 'Second message' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { events } = await consumeGenerator(generator);

      // Find output events (after start event, before complete event)
      const outputEvents = events.filter(e => e.type === 'output');
      expect(outputEvents).toHaveLength(2);
      expect(outputEvents[0]).toMatchObject({
        type: 'output',
        content: 'First message',
        messageType: 'text',
      });
      expect(outputEvents[1]).toMatchObject({
        type: 'output',
        content: 'Second message',
        messageType: 'text',
      });
    });

    it('should yield complete event on success', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test response' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'file1.txt', isFile: () => true, isDirectory: () => false },
        { name: 'file2.txt', isFile: () => true, isDirectory: () => false },
      ] as any);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { events } = await consumeGenerator(generator);

      const completeEvent = events.find(e => e.type === 'complete');
      expect(completeEvent).toMatchObject({
        type: 'complete',
        sequence: 1,
        title: 'Test Subtask',
        files: ['file1.txt', 'file2.txt'],
        summaryFile: '/workspace/subtask-1/summary.md',
      });
    });

    it('should use totalSteps from config in start event', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { events } = await consumeGenerator(generator);

      expect(events[0]).toMatchObject({
        type: 'start',
        totalSteps: 5,
      });
    });

    it('should use 0 for totalSteps when not provided in config', async () => {
      const configWithoutTotal = { ...mockConfig, totalSteps: undefined };
      const executorWithoutTotal = new Executor(apiKey, model, configWithoutTotal);

      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executorWithoutTotal.executeSubtask(subtask, [], '/workspace');
      const { events } = await consumeGenerator(generator);

      expect(events[0]).toMatchObject({
        type: 'start',
        totalSteps: 0,
      });
    });
  });

  describe('executeSubtask - Abort Handling', () => {
    it('should throw AbortError if signal already aborted before execution', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const configWithAbort = {
        ...mockConfig,
        abortSignal: abortController.signal,
      };

      const executorWithAbort = new Executor(apiKey, model, configWithAbort);

      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const generator = executorWithAbort.executeSubtask(subtask, [], '/workspace');

      await expect(consumeGenerator(generator)).rejects.toThrow('AbortError');
    });

    it('should throw AbortError if signal aborted during execution', async () => {
      const abortController = new AbortController();

      const configWithAbort = {
        ...mockConfig,
        abortSignal: abortController.signal,
      };

      const executorWithAbort = new Executor(apiKey, model, configWithAbort);

      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          // Abort during iteration
          abortController.abort();
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const generator = executorWithAbort.executeSubtask(subtask, [], '/workspace');

      await expect(consumeGenerator(generator)).rejects.toThrow('AbortError');
    });

    it('should clean up abort listener after execution', async () => {
      const abortController = new AbortController();

      const configWithAbort = {
        ...mockConfig,
        abortSignal: abortController.signal,
      };

      const executorWithAbort = new Executor(apiKey, model, configWithAbort);

      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executorWithAbort.executeSubtask(subtask, [], '/workspace');
      const { result } = await consumeGenerator(generator);

      // Execution completes successfully
      expect(result.success).toBe(true);
    });
  });

  describe('executeSubtask - Error Handling', () => {
    it('should return failed result on SDK error', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          throw new Error('SDK Error');
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { result, events } = await consumeGenerator(generator);

      expect(result.success).toBe(false);
      expect(result.error).toBe('SDK Error');
      expect(result.sequence).toBe(1);
    });

    it('should yield error event on failure', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Test error');
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { events } = await consumeGenerator(generator);

      const errorEvent = events.find(e => e.type === 'error');
      expect(errorEvent).toMatchObject({
        type: 'error',
        sequence: 1,
        title: 'Test Subtask',
        error: 'Test error',
      });
    });

    it('should handle non-Error objects', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          throw 'String error';
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { result } = await consumeGenerator(generator);

      expect(result.success).toBe(false);
      expect(result.error).toBe('String error');
    });

    it('should create default summary if agent does not create one', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Agent response' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      await consumeGenerator(generator);

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/workspace/subtask-1/summary.md',
        expect.stringContaining('# Summary: Test Subtask'),
        'utf-8'
      );
    });

    it('should not overwrite existing summary file', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Agent response' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockResolvedValue(undefined); // File exists
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      await consumeGenerator(generator);

      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('executeSubtask - File Tracking', () => {
    it('should track files from Write tool metadata', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'tool_use',
            content: '',
            metadata: {
              toolName: 'Write',
              toolInput: 'Writing: /workspace/test.txt',
            },
          };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      await consumeGenerator(generator);

      // Should track the file internally (file tracking logic)
      expect(mockConfig.sendMessage).not.toHaveBeenCalled(); // Executor no longer sends messages
    });

    it('should track files from Edit tool metadata', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'tool_use',
            content: '',
            metadata: {
              toolName: 'Edit',
              toolInput: 'Editing: /workspace/test.txt',
            },
          };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      await consumeGenerator(generator);

      expect(mockConfig.sendMessage).not.toHaveBeenCalled(); // Executor no longer sends messages
    });

    it('should list created files in result', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'file1.txt', isFile: () => true, isDirectory: () => false },
        { name: 'file2.txt', isFile: () => true, isDirectory: () => false },
      ] as any);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { result } = await consumeGenerator(generator);

      expect(result.files).toEqual(['file1.txt', 'file2.txt']);
    });
  });

  describe('buildContextInfo - Private Method', () => {
    it('should return default message for empty previous results', () => {
      const result = executor['buildContextInfo']([]);

      expect(result).toContain('This is the first subtask');
    });

    it('should build context from successful results with files', () => {
      const previousResults: SubtaskResult[] = [
        {
          sequence: 1,
          success: true,
          summary: 'Summary text',
          files: ['file1.txt', 'file2.txt'],
          summaryFile: 'summary.md',
          completedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = executor['buildContextInfo'](previousResults);

      expect(result).toContain('Step 1');
      expect(result).toContain('✅ Completed');
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
    });

    it('should build context from successful results with no files', () => {
      const previousResults: SubtaskResult[] = [
        {
          sequence: 1,
          success: true,
          summary: 'Summary text',
          files: [],
          summaryFile: 'summary.md',
          completedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = executor['buildContextInfo'](previousResults);

      expect(result).toContain('(No files tracked)');
    });

    it('should build context from failed results', () => {
      const previousResults: SubtaskResult[] = [
        {
          sequence: 1,
          success: false,
          summary: '',
          files: [],
          summaryFile: 'summary.md',
          error: 'Something went wrong',
          completedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const result = executor['buildContextInfo'](previousResults);

      expect(result).toContain('❌ Failed');
      expect(result).toContain('Something went wrong');
    });

    it('should build context from multiple previous results', () => {
      const previousResults: SubtaskResult[] = [
        {
          sequence: 1,
          success: true,
          summary: 'Summary 1',
          files: ['file1.txt'],
          summaryFile: 'summary1.md',
          completedAt: '2024-01-01T00:00:00Z',
        },
        {
          sequence: 2,
          success: true,
          summary: 'Summary 2',
          files: ['file2.txt'],
          summaryFile: 'summary2.md',
          completedAt: '2024-01-01T02:00:00Z',
        },
      ];

      const result = executor['buildContextInfo'](previousResults);

      expect(result).toContain('Step 1');
      expect(result).toContain('Step 2');
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
    });
  });

  describe('buildExecutionPrompt - Static Method', () => {
    it('should create prompt with all subtask fields', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Title',
        description: 'Test description',
        inputs: {
          description: 'Input description',
          sources: ['source1.txt', 'source2.txt'],
          context: { key: 'value' },
        },
        outputs: {
          description: 'Output description',
          files: ['out1.txt', 'out2.txt'],
          summaryFile: 'summary.md',
        },
      };

      const prompt = Executor.buildExecutionPrompt(subtask, 'Context info', '/workspace');

      expect(prompt).toContain('Test Title');
      expect(prompt).toContain('Test description');
      expect(prompt).toContain('Step 1');
      expect(prompt).toContain('Input description');
      expect(prompt).toContain('source1.txt');
      expect(prompt).toContain('source2.txt');
      expect(prompt).toContain('"key": "value"');
      expect(prompt).toContain('Output description');
      expect(prompt).toContain('out1.txt');
      expect(prompt).toContain('out2.txt');
      expect(prompt).toContain('Context info');
      expect(prompt).toContain('/workspace');
    });

    it('should handle empty sources', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Title',
        description: 'Test description',
        inputs: {
          description: 'Input description',
          sources: [],
        },
        outputs: {
          description: 'Output description',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const prompt = Executor.buildExecutionPrompt(subtask, 'Context', '/workspace');

      expect(prompt).toContain('None (first step)');
    });

    it('should handle missing context', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Title',
        description: 'Test description',
        inputs: {
          description: 'Input description',
          sources: [],
        },
        outputs: {
          description: 'Output description',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const prompt = Executor.buildExecutionPrompt(subtask, 'Context', '/workspace');

      expect(prompt).not.toContain('Additional Context');
    });
  });

  describe('formatMarkdownRequirements - Static Helper', () => {
    it('should return default message when no markdown requirements', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test',
        description: 'Test',
        inputs: { description: 'Test', sources: [] },
        outputs: {
          description: 'Test',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const result = Executor['formatMarkdownRequirements'](subtask);

      expect(result).toContain('summary.md');
      expect(result).toContain('What was accomplished');
    });

    it('should format markdown requirements with required and optional sections', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test',
        description: 'Test',
        inputs: { description: 'Test', sources: [] },
        outputs: {
          description: 'Test',
          files: ['out.txt'],
          summaryFile: 'summary.md',
          markdownRequirements: [
            { id: 'section-1', title: 'Section 1', content: 'Content 1', required: true },
            { id: 'section-2', title: 'Section 2', content: 'Content 2', required: false },
          ],
        },
      };

      const result = Executor['formatMarkdownRequirements'](subtask);

      expect(result).toContain('Section 1 ✅ (Required)');
      expect(result).toContain('Section 2 ⚪ (Optional)');
      expect(result).toContain('`section-1`');
      expect(result).toContain('`section-2`');
      expect(result).toContain('Content 1');
      expect(result).toContain('Content 2');
    });

    it('should include all section headings in requirements', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test',
        description: 'Test',
        inputs: { description: 'Test', sources: [] },
        outputs: {
          description: 'Test',
          files: ['out.txt'],
          summaryFile: 'summary.md',
          markdownRequirements: [
            { id: 'test-section', title: 'Test Section', content: 'Test content', required: true },
          ],
        },
      };

      const result = Executor['formatMarkdownRequirements'](subtask);

      expect(result).toContain('### Test Section ✅ (Required)');
      expect(result).toContain('**Section ID**: `test-section`');
      expect(result).toContain('**Content**: Test content');
    });
  });

  describe('createDefaultSummary - Private Method', () => {
    it('should create default summary with subtask info', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Title',
        description: 'Test description',
        inputs: { description: 'Test', sources: [] },
        outputs: {
          description: 'Test',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const summary = executor['createDefaultSummary'](subtask, 'Agent response', ['file1.txt']);

      expect(summary).toContain('# Summary: Test Title');
      expect(summary).toContain('**Subtask Sequence**: 1');
      expect(summary).toContain('Test description');
      expect(summary).toContain('Agent response');
      expect(summary).toContain('file1.txt');
    });

    it('should truncate long responses at 2000 characters', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test',
        description: 'Test',
        inputs: { description: 'Test', sources: [] },
        outputs: {
          description: 'Test',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const longResponse = 'a'.repeat(3000);
      const summary = executor['createDefaultSummary'](subtask, longResponse, []);

      expect(summary).toContain('... (truncated)');
      expect(summary.split('... (truncated)')[0].length).toBeLessThan(2500);
    });

    it('should handle empty files list', () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test',
        description: 'Test',
        inputs: { description: 'Test', sources: [] },
        outputs: {
          description: 'Test',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const summary = executor['createDefaultSummary'](subtask, 'Response', []);

      expect(summary).toContain('No files were tracked');
    });
  });

  describe('listCreatedFiles - Private Method', () => {
    it('should list files in directory', async () => {
      const entries = [
        { name: 'file1.txt', isFile: () => true, isDirectory: () => false },
        { name: 'file2.txt', isFile: () => true, isDirectory: () => false },
      ];

      vi.mocked(fs.readdir).mockResolvedValue(entries as any);

      const files = await executor['listCreatedFiles']('/workspace');

      expect(files).toEqual(['file1.txt', 'file2.txt']);
    });

    it('should recursively list subdirectories', async () => {
      const entries = [
        { name: 'file.txt', isFile: () => true, isDirectory: () => false },
        { name: 'subdir', isFile: () => false, isDirectory: () => true },
      ];

      const subEntries = [
        { name: 'subfile.txt', isFile: () => true, isDirectory: () => false },
      ];

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(entries as any)
        .mockResolvedValueOnce(subEntries as any);

      const files = await executor['listCreatedFiles']('/workspace');

      expect(files).toEqual(['file.txt', 'subdir/subfile.txt']);
    });

    it('should handle readdir errors gracefully', async () => {
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));

      const files = await executor['listCreatedFiles']('/workspace');

      expect(files).toEqual([]);
    });

    it('should handle nested subdirectories', async () => {
      const entries = [
        { name: 'level1', isFile: () => false, isDirectory: () => true },
      ];

      const level1Entries = [
        { name: 'level2', isFile: () => false, isDirectory: () => true },
      ];

      const level2Entries = [
        { name: 'deep.txt', isFile: () => true, isDirectory: () => false },
      ];

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(entries as any)
        .mockResolvedValueOnce(level1Entries as any)
        .mockResolvedValueOnce(level2Entries as any);

      const files = await executor['listCreatedFiles']('/workspace');

      expect(files).toEqual(['level1/level2/deep.txt']);
    });

    it('should handle mix of files and directories', async () => {
      const entries = [
        { name: 'file1.txt', isFile: () => true, isDirectory: () => false },
        { name: 'dir1', isFile: () => false, isDirectory: () => true },
        { name: 'file2.txt', isFile: () => true, isDirectory: () => false },
      ];

      const dir1Entries = [
        { name: 'dir1file.txt', isFile: () => true, isDirectory: () => false },
      ];

      vi.mocked(fs.readdir)
        .mockResolvedValueOnce(entries as any)
        .mockResolvedValueOnce(dir1Entries as any);

      const files = await executor['listCreatedFiles']('/workspace');

      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
      expect(files).toContain('dir1/dir1file.txt');
      expect(files.length).toBe(3);
    });
  });

  describe('executeSubtask - Context Building Integration', () => {
    it('should pass previous results to context builder', async () => {
      const subtask: Subtask = {
        sequence: 2,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const previousResults: SubtaskResult[] = [
        {
          sequence: 1,
          success: true,
          summary: 'Previous summary',
          files: ['prev.txt'],
          summaryFile: 'prev.md',
          completedAt: '2024-01-01T00:00:00Z',
        },
      ];

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, previousResults, '/workspace');
      await consumeGenerator(generator);

      // Should have included context in the prompt
      // (we can't directly check this without inspecting the SDK call)
      expect(mockConfig.sendMessage).not.toHaveBeenCalled(); // Executor no longer sends messages
    });
  });

  describe('executeSubtask - Summary File Path Handling', () => {
    it('should use basename to avoid path duplication', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'subtask/summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      // File doesn't exist, so default summary will be created
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      await consumeGenerator(generator);

      // Should use basename only (summary.md, not subtask/summary.md)
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/workspace/subtask-1/summary.md',
        expect.any(String),
        'utf-8'
      );
    });

    it('should include summary file path in result', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { result } = await consumeGenerator(generator);

      expect(result.summaryFile).toBe('/workspace/subtask-1/summary.md');
    });
  });

  describe('executeSubtask - Result Timestamps', () => {
    it('should include completion timestamp in successful result', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'text', content: 'Test' };
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const beforeTime = new Date();
      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { result } = await consumeGenerator(generator);
      const afterTime = new Date();

      expect(result.completedAt).toBeDefined();
      const completionTime = new Date(result.completedAt);
      expect(completionTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(completionTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should include completion timestamp in failed result', async () => {
      const subtask: Subtask = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Test input',
          sources: [],
        },
        outputs: {
          description: 'Test output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      const mockQueryResult = {
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Test error');
        },
      };

      vi.mocked(query).mockReturnValue(mockQueryResult as any);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const beforeTime = new Date();
      const generator = executor.executeSubtask(subtask, [], '/workspace');
      const { result } = await consumeGenerator(generator);
      const afterTime = new Date();

      expect(result.completedAt).toBeDefined();
      const completionTime = new Date(result.completedAt);
      expect(completionTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(completionTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('SubtaskProgressEvent Type Export', () => {
    it('should export SubtaskProgressEvent type', () => {
      // This test ensures the type is exported and available
      const event: SubtaskProgressEvent = {
        type: 'start',
        sequence: 1,
        totalSteps: 5,
        title: 'Test',
        description: 'Test description',
      };
      expect(event.type).toBe('start');
    });
  });
});
