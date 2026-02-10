/**
 * Tests for long-task module exports.
 */

import { describe, it, expect } from 'vitest';

describe('Long Task Module Exports', () => {
  describe('Class Exports', () => {
    it('should export Planner class', async () => {
      const module = await import('./index.js');
      expect(module.Planner).toBeDefined();
    });

    it('should export Executor class', async () => {
      const module = await import('./index.js');
      expect(module.Executor).toBeDefined();
    });

    it('should export LongTaskTracker class', async () => {
      const module = await import('./index.js');
      expect(module.LongTaskTracker).toBeDefined();
    });

    it('should export TaskPlanExtractor class', async () => {
      const module = await import('./index.js');
      expect(module.TaskPlanExtractor).toBeDefined();
    });
  });

  describe('Module Purpose', () => {
    it('should serve as barrel export for long-task module', async () => {
      const module = await import('./index.js');
      expect(module).toBeDefined();
    });
  });
});
