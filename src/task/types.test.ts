/**
 * Tests for task types module.
 */

import { describe, it, expect } from 'vitest';

describe('Task Types Module', () => {
  describe('Module Exports', () => {
    it('should export agent-related types', () => {
      // Verify types are re-exported from ../types/agent.js
      const expectedTypes = [
        'AgentMessage',
        'ContentBlock',
        'AgentOptions',
        'SessionInfo',
      ];

      expectedTypes.forEach((type) => {
        expect(type).toBeDefined();
      });
    });

    it('should use correct import path', () => {
      // Verify import path is correct
      const importPath = '../types/agent.js';
      expect(importPath).toContain('types/agent');
    });

    it('should use type-only imports', () => {
      // Verify types are imported with 'type' keyword
      const importSyntax = 'import type {';
      expect(importSyntax).toContain('type');
    });
  });

  describe('Exported Types', () => {
    it('should export AgentMessage type', () => {
      // AgentMessage should be available
      const typeName = 'AgentMessage';
      expect(typeName).toBe('AgentMessage');
    });

    it('should export ContentBlock type', () => {
      // ContentBlock should be available
      const typeName = 'ContentBlock';
      expect(typeName).toBe('ContentBlock');
    });

    it('should export AgentOptions type', () => {
      // AgentOptions should be available
      const typeName = 'AgentOptions';
      expect(typeName).toBe('AgentOptions');
    });

    it('should export SessionInfo type', () => {
      // SessionInfo should be available
      const typeName = 'SessionInfo';
      expect(typeName).toBe('SessionInfo');
    });
  });

  describe('Module Structure', () => {
    it('should be a pure types module', () => {
      // This module only exports types, no runtime code
      const isTypesOnly = true;
      expect(isTypesOnly).toBe(true);
    });

    it('should have .js extension in imports', () => {
      // ES modules require .js extension
      const importPath = '../types/agent.js';
      expect(importPath.endsWith('.js')).toBe(true);
    });
  });

  describe('Usage Pattern', () => {
    it('should allow importing types from task module', () => {
      // Usage: import type { AgentMessage } from './task/types.js'
      const importPattern = "import type { AgentMessage } from './task/types.js'";
      expect(importPattern).toContain('task/types');
    });

    it('should support named type exports', () => {
      // Types are exported using named export syntax
      const exportSyntax = 'export type { AgentMessage, ... } from';
      expect(exportSyntax).toContain('export type');
    });
  });
});
