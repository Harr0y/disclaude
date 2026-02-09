/**
 * Tests for long task type definitions.
 */

import { describe, it, expect } from 'vitest';

describe('Long Task Types', () => {
  describe('SubtaskInput', () => {
    it('should define SubtaskInput interface', () => {
      const subtaskInput: {
        description: string;
        sources: string[];
        context?: Record<string, unknown>;
      } = {
        description: 'Test input',
        sources: ['file1.txt'],
      };

      expect(subtaskInput.description).toBe('Test input');
      expect(subtaskInput.sources).toEqual(['file1.txt']);
      expect(subtaskInput.context).toBeUndefined();
    });

    it('should accept optional context', () => {
      const subtaskInput: {
        description: string;
        sources: string[];
        context?: Record<string, unknown>;
      } = {
        description: 'Test input',
        sources: ['file1.txt'],
        context: { key: 'value' },
      };

      expect(subtaskInput.context).toEqual({ key: 'value' });
    });
  });

  describe('MarkdownSectionRequirement', () => {
    it('should define MarkdownSectionRequirement interface', () => {
      const requirement: {
        id: string;
        title: string;
        content: string;
        required: boolean;
      } = {
        id: 'section-1',
        title: 'Section 1',
        content: 'Content description',
        required: true,
      };

      expect(requirement.id).toBe('section-1');
      expect(requirement.title).toBe('Section 1');
      expect(requirement.required).toBe(true);
    });

    it('should allow optional sections', () => {
      const requirement: {
        id: string;
        title: string;
        content: string;
        required: boolean;
      } = {
        id: 'section-2',
        title: 'Optional Section',
        content: 'Optional content',
        required: false,
      };

      expect(requirement.required).toBe(false);
    });
  });

  describe('SubtaskOutput', () => {
    it('should define SubtaskOutput interface', () => {
      const subtaskOutput: {
        description: string;
        files: string[];
        summaryFile: string;
        markdownRequirements?: Array<{
          id: string;
          title: string;
          content: string;
          required: boolean;
        }>;
      } = {
        description: 'Test output',
        files: ['output.txt'],
        summaryFile: 'summary.md',
      };

      expect(subtaskOutput.description).toBe('Test output');
      expect(subtaskOutput.files).toEqual(['output.txt']);
      expect(subtaskOutput.summaryFile).toBe('summary.md');
      expect(subtaskOutput.markdownRequirements).toBeUndefined();
    });

    it('should accept optional markdownRequirements', () => {
      const markdownRequirements = [
        { id: 's1', title: 'Section 1', content: 'Content', required: true },
      ];

      const subtaskOutput: {
        description: string;
        files: string[];
        summaryFile: string;
        markdownRequirements?: Array<{
          id: string;
          title: string;
          content: string;
          required: boolean;
        }>;
      } = {
        description: 'Test output',
        files: ['output.txt'],
        summaryFile: 'summary.md',
        markdownRequirements,
      };

      expect(subtaskOutput.markdownRequirements).toEqual(markdownRequirements);
    });
  });

  describe('Subtask', () => {
    it('should define Subtask interface', () => {
      const subtask: {
        sequence: number;
        title: string;
        description: string;
        inputs: {
          description: string;
          sources: string[];
          context?: Record<string, unknown>;
        };
        outputs: {
          description: string;
          files: string[];
          summaryFile: string;
        };
        complexity?: 'simple' | 'medium' | 'complex';
      } = {
        sequence: 1,
        title: 'Test Subtask',
        description: 'Test description',
        inputs: {
          description: 'Input',
          sources: [],
        },
        outputs: {
          description: 'Output',
          files: ['out.txt'],
          summaryFile: 'summary.md',
        },
      };

      expect(subtask.sequence).toBe(1);
      expect(subtask.title).toBe('Test Subtask');
    });

    it('should accept complexity levels', () => {
      const complexities: Array<'simple' | 'medium' | 'complex'> = ['simple', 'medium', 'complex'];

      complexities.forEach((complexity) => {
        expect(['simple', 'medium', 'complex']).toContain(complexity);
      });
    });
  });

  describe('LongTaskPlan', () => {
    it('should define LongTaskPlan interface', () => {
      const plan: {
        taskId: string;
        originalRequest: string;
        title: string;
        description: string;
        subtasks: Array<{
          sequence: number;
          title: string;
          description: string;
          inputs: unknown;
          outputs: unknown;
        }>;
        totalSteps: number;
        createdAt: string;
      } = {
        taskId: 'task-123',
        originalRequest: 'Test request',
        title: 'Test Task',
        description: 'Test description',
        subtasks: [],
        totalSteps: 0,
        createdAt: '2024-01-01T00:00:00Z',
      };

      expect(plan.taskId).toBe('task-123');
      expect(plan.subtasks).toEqual([]);
      expect(plan.totalSteps).toBe(0);
    });
  });

  describe('LongTaskStatus', () => {
    it('should define valid status types', () => {
      const statuses: Array<'planning' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled'> = [
        'planning',
        'approved',
        'executing',
        'completed',
        'failed',
        'cancelled',
      ];

      statuses.forEach((status) => {
        expect(status).toBeDefined();
      });
    });
  });

  describe('LongTaskState', () => {
    it('should define LongTaskState interface', () => {
      const state: {
        plan: unknown;
        status: 'planning' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
        currentStep: number;
        results: Map<number, unknown>;
        error?: string;
        startedAt?: string;
        completedAt?: string;
      } = {
        plan: {},
        status: 'planning',
        currentStep: 0,
        results: new Map(),
      };

      expect(state.status).toBe('planning');
      expect(state.currentStep).toBe(0);
      expect(state.results).toBeInstanceOf(Map);
    });

    it('should accept optional fields', () => {
      const state: {
        plan: unknown;
        status: string;
        currentStep: number;
        results: Map<number, unknown>;
        error?: string;
        startedAt?: string;
        completedAt?: string;
      } = {
        plan: {},
        status: 'failed',
        currentStep: 5,
        results: new Map(),
        error: 'Task failed',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T01:00:00Z',
      };

      expect(state.error).toBe('Task failed');
      expect(state.startedAt).toBeDefined();
      expect(state.completedAt).toBeDefined();
    });
  });

  describe('SubtaskResult', () => {
    it('should define SubtaskResult interface', () => {
      const result: {
        sequence: number;
        success: boolean;
        summary: string;
        files: string[];
        summaryFile: string;
        error?: string;
        completedAt: string;
      } = {
        sequence: 1,
        success: true,
        summary: 'Test summary',
        files: ['out.txt'],
        summaryFile: 'summary.md',
        completedAt: '2024-01-01T00:00:00Z',
      };

      expect(result.sequence).toBe(1);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept error field for failed results', () => {
      const result: {
        sequence: number;
        success: boolean;
        summary: string;
        files: string[];
        summaryFile: string;
        error?: string;
        completedAt: string;
      } = {
        sequence: 1,
        success: false,
        summary: 'Failed',
        files: [],
        summaryFile: 'summary.md',
        error: 'Execution failed',
        completedAt: '2024-01-01T00:00:00Z',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Execution failed');
    });
  });

  describe('LongTaskConfig', () => {
    it('should define LongTaskConfig interface', () => {
      const config: {
        workspaceBaseDir: string;
        sendMessage: (chatId: string, message: string) => Promise<void>;
        sendCard: (chatId: string, card: Record<string, unknown>) => Promise<void>;
        chatId: string;
        totalSteps?: number;
        apiBaseUrl?: string;
        taskTimeoutMs?: number;
        maxCostUsd?: number;
        abortSignal?: AbortSignal;
      } = {
        workspaceBaseDir: '/workspace',
        sendMessage: async () => {},
        sendCard: async () => {},
        chatId: 'chat-123',
      };

      expect(config.workspaceBaseDir).toBe('/workspace');
      expect(config.chatId).toBe('chat-123');
      expect(typeof config.sendMessage).toBe('function');
      expect(typeof config.sendCard).toBe('function');
    });

    it('should accept optional configuration fields', () => {
      const abortController = new AbortController();
      const config: {
        workspaceBaseDir: string;
        sendMessage: () => Promise<void>;
        sendCard: () => Promise<void>;
        chatId: string;
        totalSteps?: number;
        apiBaseUrl?: string;
        taskTimeoutMs?: number;
        maxCostUsd?: number;
        abortSignal?: AbortSignal;
      } = {
        workspaceBaseDir: '/workspace',
        sendMessage: async () => {},
        sendCard: async () => {},
        chatId: 'chat-123',
        totalSteps: 10,
        apiBaseUrl: 'https://api.example.com',
        taskTimeoutMs: 86400000,
        maxCostUsd: 10.0,
        abortSignal: abortController.signal,
      };

      expect(config.totalSteps).toBe(10);
      expect(config.apiBaseUrl).toBe('https://api.example.com');
      expect(config.taskTimeoutMs).toBe(86400000);
      expect(config.maxCostUsd).toBe(10.0);
      expect(config.abortSignal).toBe(abortController.signal);
    });
  });
});
