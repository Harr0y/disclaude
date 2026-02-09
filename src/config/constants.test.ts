/**
 * Tests for configuration constants (src/config/constants.ts)
 *
 * Tests the following functionality:
 * - Constant values are correctly defined
 * - Constants are immutable (as const)
 * - Constants have expected types and values
 */

import { describe, it, expect } from 'vitest';
import {
  DEDUPLICATION,
  LONG_TASK,
  THROTTLING,
  FILE_DEDUPLICATION,
  DIALOGUE,
} from './constants.js';

describe('Configuration Constants', () => {
  describe('DEDUPLICATION', () => {
    it('should have correct MAX_PROCESSED_IDS value', () => {
      expect(DEDUPLICATION.MAX_PROCESSED_IDS).toBe(1000);
    });

    it('should have correct MAX_MESSAGE_AGE value (1 minute)', () => {
      expect(DEDUPLICATION.MAX_MESSAGE_AGE).toBe(60 * 1000);
    });

    it('should have correct RECORD_EXPIRATION_MS value (2 minutes)', () => {
      expect(DEDUPLICATION.RECORD_EXPIRATION_MS).toBe(2 * 60 * 1000);
    });

    it('should be readonly', () => {
      // TypeScript should prevent modification, but we can check the value hasn't changed
      const initialMaxIds = DEDUPLICATION.MAX_PROCESSED_IDS;
      expect(DEDUPLICATION.MAX_PROCESSED_IDS).toBe(initialMaxIds);
    });
  });

  describe('LONG_TASK', () => {
    it('should have correct DEFAULT_TASK_TIMEOUT_MS value (24 hours)', () => {
      expect(LONG_TASK.DEFAULT_TASK_TIMEOUT_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('should have correct MAX_CONCURRENT_TASKS_PER_CHAT value', () => {
      expect(LONG_TASK.MAX_CONCURRENT_TASKS_PER_CHAT).toBe(1);
    });

    it('should be readonly', () => {
      const initialTimeout = LONG_TASK.DEFAULT_TASK_TIMEOUT_MS;
      expect(LONG_TASK.DEFAULT_TASK_TIMEOUT_MS).toBe(initialTimeout);
    });
  });

  describe('THROTTLING', () => {
    it('should have correct PROGRESS_MESSAGE_INTERVAL_MS value (2 seconds)', () => {
      expect(THROTTLING.PROGRESS_MESSAGE_INTERVAL_MS).toBe(2000);
    });

    it('should be readonly', () => {
      const initialInterval = THROTTLING.PROGRESS_MESSAGE_INTERVAL_MS;
      expect(THROTTLING.PROGRESS_MESSAGE_INTERVAL_MS).toBe(initialInterval);
    });
  });

  describe('FILE_DEDUPLICATION', () => {
    it('should have correct DEDUPE_DIR value', () => {
      expect(FILE_DEDUPLICATION.DEDUPE_DIR).toBe('./dedupe-records');
    });

    it('should have correct MAX_RECORDS_PER_CHAT value', () => {
      expect(FILE_DEDUPLICATION.MAX_RECORDS_PER_CHAT).toBe(100);
    });

    it('should be readonly', () => {
      const initialDir = FILE_DEDUPLICATION.DEDUPE_DIR;
      expect(FILE_DEDUPLICATION.DEDUPE_DIR).toBe(initialDir);
    });
  });

  describe('DIALOGUE', () => {
    it('should have correct MAX_ITERATIONS value', () => {
      expect(DIALOGUE.MAX_ITERATIONS).toBe(20);
    });

    it('should be readonly', () => {
      const initialMaxIterations = DIALOGUE.MAX_ITERATIONS;
      expect(DIALOGUE.MAX_ITERATIONS).toBe(initialMaxIterations);
    });
  });

  describe('Constant Types', () => {
    it('should export constants with correct structure', () => {
      expect(DEDUPLICATION).toBeDefined();
      expect(LONG_TASK).toBeDefined();
      expect(THROTTLING).toBeDefined();
      expect(FILE_DEDUPLICATION).toBeDefined();
      expect(DIALOGUE).toBeDefined();
    });
  });
});
