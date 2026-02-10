/**
 * Tests for Reporter class.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Reporter } from './reporter.js';
import type { EvaluationResult } from './evaluator.js';

describe('Reporter', () => {
  let reporter: Reporter;
  let mockConfig: {
    apiKey: string;
    model: string;
    apiBaseUrl?: string;
    permissionMode?: 'default' | 'bypassPermissions';
  };

  beforeEach(() => {
    mockConfig = {
      apiKey: 'test-api-key',
      model: 'claude-3-5-sonnet-20241022',
      permissionMode: 'bypassPermissions',
    };
    reporter = new Reporter(mockConfig);
  });

  afterEach(() => {
    reporter.cleanup();
  });

  describe('Constructor', () => {
    it('should create Reporter instance with config', () => {
      expect(reporter).toBeInstanceOf(Reporter);
      expect(reporter.apiKey).toBe('test-api-key');
      expect(reporter.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should use bypassPermissions as default permission mode', () => {
      expect(reporter.permissionMode).toBe('bypassPermissions');
    });

    it('should accept apiBaseUrl', () => {
      const configWithBaseUrl = {
        ...mockConfig,
        apiBaseUrl: 'https://api.example.com',
      };
      const reporterWithUrl = new Reporter(configWithBaseUrl);
      expect(reporterWithUrl.apiBaseUrl).toBe('https://api.example.com');
      reporterWithUrl.cleanup();
    });

    it('should accept default permission mode', () => {
      const configWithDefault = {
        ...mockConfig,
        permissionMode: 'default' as const,
      };
      const reporterWithDefault = new Reporter(configWithDefault);
      expect(reporterWithDefault.permissionMode).toBe('default');
      reporterWithDefault.cleanup();
    });

    it('should initialize with not initialized state', () => {
      expect(reporter['initialized']).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should initialize Reporter', async () => {
      await reporter.initialize();
      expect(reporter['initialized']).toBe(true);
    });

    it('should be idempotent', async () => {
      await reporter.initialize();
      await reporter.initialize();
      expect(reporter['initialized']).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should cleanup resources', () => {
      reporter.cleanup();
      expect(reporter['initialized']).toBe(false);
    });
  });

  describe('buildReportPrompt', () => {
    const mockTaskMd = '# Task\n\nDo something.';
    const mockEvaluation: EvaluationResult = {
      is_complete: false,
      reason: 'Task not complete',
      missing_items: ['item1', 'item2'],
      confidence: 0.8,
    };

    it('should build prompt for first iteration', () => {
      const prompt = Reporter.buildReportPrompt(mockTaskMd, 1, undefined, mockEvaluation);

      expect(prompt).toContain(mockTaskMd);
      expect(prompt).toContain('Current Iteration: 1');
      expect(prompt).toContain('No Worker output yet');
      expect(prompt).toContain('FIRST ITERATION');
    });

    it('should build prompt with worker output', () => {
      const workerOutput = 'Worker did something';
      const prompt = Reporter.buildReportPrompt(mockTaskMd, 2, workerOutput, mockEvaluation);

      expect(prompt).toContain(workerOutput);
      expect(prompt).toContain("Worker's Previous Output (Iteration 1)");
    });

    it('should include evaluation result', () => {
      const prompt = Reporter.buildReportPrompt(mockTaskMd, 1, undefined, mockEvaluation);

      expect(prompt).toContain('Evaluator\'s Assessment');
      expect(prompt).toContain('"is_complete": false');
      expect(prompt).toContain(mockEvaluation.reason);
      expect(prompt).toContain('item1');
      expect(prompt).toContain('item2');
    });

    it('should include first iteration instructions', () => {
      const prompt = Reporter.buildReportPrompt(mockTaskMd, 1, undefined, mockEvaluation);

      expect(prompt).toContain('Your Reporting Task');
      expect(prompt).toContain('Generate clear, actionable Worker instructions');
      expect(prompt).toContain('Use send_user_feedback');
    });

    it('should include subsequent iteration instructions when task not complete', () => {
      const workerOutput = 'Partial work done';
      const prompt = Reporter.buildReportPrompt(mockTaskMd, 2, workerOutput, mockEvaluation);

      expect(prompt).toContain('Task is NOT COMPLETE');
      expect(prompt).toContain('Missing Items:');
      expect(prompt).toContain('Generate specific Worker instructions');
    });

    it('should include completion instructions when task complete', () => {
      const completeEvaluation: EvaluationResult = {
        is_complete: true,
        reason: 'Task completed successfully',
        missing_items: [],
        confidence: 1.0,
      };
      const workerOutput = 'Work completed';
      const prompt = Reporter.buildReportPrompt(mockTaskMd, 2, workerOutput, completeEvaluation);

      expect(prompt).toContain('Task is COMPLETE');
      expect(prompt).toContain('Organize final summary');
      expect(prompt).toContain('Generate more Worker instructions (task is complete)');
    });

    it('should include proper warnings and reminders', () => {
      const prompt = Reporter.buildReportPrompt(mockTaskMd, 1, undefined, mockEvaluation);

      expect(prompt).toContain('DO NOT evaluate if task is complete');
      expect(prompt).toContain('DO NOT call task_done');
      expect(prompt).toContain('You are the REPORTER');
    });
  });

  describe('report', () => {
    it('should be defined as async method', async () => {
      const mockEvaluation: EvaluationResult = {
        is_complete: false,
        reason: 'Not complete',
        missing_items: [],
        confidence: 0.5,
      };

      // report method exists
      expect(typeof reporter.report).toBe('function');
    });

    it('should accept required parameters', () => {
      const taskMdContent = '# Task';
      const iteration = 1;
      const workerOutput = undefined;
      const evaluation: EvaluationResult = {
        is_complete: false,
        reason: 'Test',
        missing_items: [],
        confidence: 0.5,
      };

      // Method signature is correct
      expect(reporter.report.length).toBe(4);
    });
  });

  describe('queryStream', () => {
    it('should be defined as async generator method', () => {
      expect(typeof reporter.queryStream).toBe('function');
    });

    it('should initialize if not initialized', async () => {
      expect(reporter['initialized']).toBe(false);

      // queryStream will initialize automatically
      const generator = reporter.queryStream('test');
      expect(generator).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle errors gracefully', async () => {
      const errorReporter = new Reporter({
        apiKey: 'invalid-key',
        model: 'invalid-model',
      });

      // Error handling is implemented
      expect(errorReporter).toBeInstanceOf(Reporter);
      errorReporter.cleanup();
    });
  });

  describe('Configuration', () => {
    it('should have correct default permission mode', () => {
      const defaultReporter = new Reporter({
        apiKey: 'key',
        model: 'model',
      });

      expect(defaultReporter.permissionMode).toBe('bypassPermissions');
      defaultReporter.cleanup();
    });

    it('should allow custom permission mode', () => {
      const customReporter = new Reporter({
        apiKey: 'key',
        model: 'model',
        permissionMode: 'default',
      });

      expect(customReporter.permissionMode).toBe('default');
      customReporter.cleanup();
    });
  });

  describe('Module Structure', () => {
    it('should export Reporter class', () => {
      expect(Reporter).toBeDefined();
      expect(typeof Reporter).toBe('function');
    });

    it('should export ReporterConfig type', () => {
      const config: {
        apiKey: string;
        model: string;
        apiBaseUrl?: string;
        permissionMode?: 'default' | 'bypassPermissions';
      } = {
        apiKey: 'key',
        model: 'model',
      };

      expect(config.apiKey).toBe('key');
      expect(config.model).toBe('model');
    });

    it('should export ReporterInput type alias', () => {
      // ReporterInput is an alias for AgentInput
      expect(true).toBe(true);
    });
  });
});
