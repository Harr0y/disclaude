/**
 * Tests for IterationBridge (src/task/iteration-bridge.ts)
 *
 * Tests the Plan-and-Execute architecture:
 * - Phase 1: Evaluator evaluates task completion
 * - Phase 2: If not complete, Planner plans → Executor executes subtasks
 * - Always uses planning mode (no simple/direct execution)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IterationBridge } from './iteration-bridge.js';
import type { IterationBridgeConfig } from './iteration-bridge.js';
import type { EvaluatorConfig } from './evaluator.js';

// Create mock instances that will be used in tests
let mockEvaluatorInstance: any;

// Mock Evaluator, TaskPlanner, and Executor classes
vi.mock('./evaluator.js', () => ({
  Evaluator: vi.fn().mockImplementation(() => mockEvaluatorInstance),
}));

vi.mock('../long-task/planner.js', () => ({
  TaskPlanner: vi.fn().mockImplementation(() => ({
    planTask: vi.fn().mockResolvedValue({
      taskId: 'test-task-1',
      originalRequest: 'Test request',
      title: 'Test Plan',
      description: 'Test description',
      subtasks: [],
      totalSteps: 0,
      createdAt: new Date().toISOString(),
    }),
  })),
}));

vi.mock('../long-task/executor.js', () => ({
  Executor: vi.fn().mockImplementation(() => ({
    executeSubtask: vi.fn().mockResolvedValue({
      sequence: 1,
      success: true,
      summary: 'Test summary',
      files: [],
      summaryFile: 'subtask-1/summary.md',
      completedAt: new Date().toISOString(),
    }),
  })),
}));

describe('IterationBridge (Plan-and-Execute Architecture)', () => {
  let bridge: IterationBridge;
  let config: IterationBridgeConfig;
  let evaluatorConfig: EvaluatorConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    evaluatorConfig = {
      apiKey: 'test-evaluator-key',
      model: 'claude-3-5-sonnet-20241022',
    };

    config = {
      evaluatorConfig,
      plannerConfig: {
        apiKey: 'test-planner-key',
        model: 'claude-3-5-sonnet-20241022',
      },
      executorConfig: {
        apiKey: 'test-executor-key',
        model: 'claude-3-5-sonnet-20241022',
        sendMessage: async () => {},
        sendCard: async () => {},
        chatId: 'test-chat',
        workspaceBaseDir: '/workspace',
      },
      taskMdContent: '# Test Task\n\nDescription here',
      iteration: 1,
    };

    // Mock Evaluator instance
    mockEvaluatorInstance = {
      initialize: vi.fn().mockResolvedValue(undefined),
      queryStream: vi.fn(),
      cleanup: vi.fn(),
      evaluate: vi.fn(async function(this: any, taskMdContent: string, iteration: number, workerOutput?: string) {
        const messages: any[] = [];
        for await (const msg of mockEvaluatorInstance.queryStream('mocked evaluation prompt')) {
          messages.push(msg);
        }
        // Return a default evaluation result
        return {
          result: {
            is_complete: false,
            reason: 'Task not complete',
            missing_items: ['Item 1', 'Item 2'],
            confidence: 0.8,
          },
          messages,
        };
      }),
    };
  });

  describe('constructor', () => {
    it('should create bridge with config', () => {
      bridge = new IterationBridge(config);

      expect(bridge).toBeInstanceOf(IterationBridge);
      expect(bridge.evaluatorConfig).toBe(evaluatorConfig);
      expect(bridge.iteration).toBe(1);
    });

    it('should accept previousWorkerOutput', () => {
      const configWithOutput: IterationBridgeConfig = {
        ...config,
        previousWorkerOutput: 'Previous result',
      };

      bridge = new IterationBridge(configWithOutput);
      expect(bridge.previousWorkerOutput).toBe('Previous result');
    });
  });

  describe('runIterationStreaming (Plan-and-Execute)', () => {
    it('should execute Evaluator then Planner/Executor', async () => {
      bridge = new IterationBridge(config);

      // Mock Evaluator to return incomplete
      mockEvaluatorInstance.queryStream.mockReturnValueOnce(async function* () {
        yield { content: '{"is_complete": false}', role: 'assistant', messageType: 'text' };
      }());

      const messages: any[] = [];
      for await (const msg of bridge.runIterationStreaming()) {
        messages.push(msg);
      }

      // Should have called evaluate
      expect(mockEvaluatorInstance.evaluate).toHaveBeenCalledTimes(1);
    });

    it('should skip Planner/Executor if Evaluator determines task is complete', async () => {
      bridge = new IterationBridge(config);

      // Mock Evaluator to return complete
      mockEvaluatorInstance.evaluate.mockResolvedValueOnce({
        result: {
          is_complete: true,
          reason: 'Task is complete',
          missing_items: [],
          confidence: 1.0,
        },
        messages: [],
      });

      const messages: any[] = [];
      for await (const msg of bridge.runIterationStreaming()) {
        messages.push(msg);
      }

      // Should have completion message
      expect(messages.some(m => m.messageType === 'task_completion')).toBe(true);
    });

    it('should cleanup Evaluator after iteration', async () => {
      bridge = new IterationBridge(config);

      mockEvaluatorInstance.queryStream.mockReturnValueOnce(async function* () {
        yield { content: '{"is_complete": false}', role: 'assistant', messageType: 'text' };
      }());

      for await (const _ of bridge.runIterationStreaming()) {
        // Consume all messages
      }

      expect(mockEvaluatorInstance.cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
