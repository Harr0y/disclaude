/**
 * Tests for pilot module exports.
 */

import { describe, it, expect } from 'vitest';

describe('Pilot Module Exports', () => {
  describe('Module Structure', () => {
    it('should export Pilot class', async () => {
      const module = await import('./index.js');
      expect(module.Pilot).toBeDefined();
    });

    it('should allow module import', async () => {
      const module = await import('./index.js');
      expect(module).toBeDefined();
    });
  });

  describe('Module Purpose', () => {
    it('should serve as barrel export for pilot module', async () => {
      const module = await import('./index.js');
      expect(module).toBeDefined();
    });

    it('should allow imports from pilot/index', async () => {
      const { Pilot } = await import('./index.js');
      expect(Pilot).toBeDefined();
    });
  });

  describe('Exported Types', () => {
    it('should export Pilot as class', async () => {
      const { Pilot } = await import('./index.js');
      expect(typeof Pilot).toBe('function');
    });
  });
});
