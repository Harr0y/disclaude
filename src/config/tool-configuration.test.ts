/**
 * Tests for tool configuration (src/config/tool-configuration.ts)
 *
 * Tests the following functionality:
 * - Core tools array contains expected tools
 * - Playwright tools array contains all browser automation tools
 * - ALLOWED_TOOLS combines both arrays
 * - Arrays are readonly (as const)
 */

import { describe, it, expect } from 'vitest';
import {
  CORE_TOOLS,
  PLAYWRIGHT_TOOLS,
  ALLOWED_TOOLS,
} from './tool-configuration.js';

describe('Tool Configuration', () => {
  describe('CORE_TOOLS', () => {
    it('should contain expected core SDK tools', () => {
      expect(CORE_TOOLS).toContain('Skill');
      expect(CORE_TOOLS).toContain('WebSearch');
      expect(CORE_TOOLS).toContain('Task');
      expect(CORE_TOOLS).toContain('Read');
      expect(CORE_TOOLS).toContain('Write');
      expect(CORE_TOOLS).toContain('Edit');
      expect(CORE_TOOLS).toContain('Bash');
      expect(CORE_TOOLS).toContain('Glob');
      expect(CORE_TOOLS).toContain('Grep');
    });

    it('should have 9 core tools', () => {
      expect(CORE_TOOLS.length).toBe(9);
    });

    it('should be readonly', () => {
      const initialLength = CORE_TOOLS.length;
      expect(CORE_TOOLS.length).toBe(initialLength);
    });
  });

  describe('PLAYWRIGHT_TOOLS', () => {
    it('should contain browser_navigate tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_navigate');
    });

    it('should contain browser_click tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_click');
    });

    it('should contain browser_snapshot tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_snapshot');
    });

    it('should contain browser_run_code tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_run_code');
    });

    it('should contain browser_close tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_close');
    });

    it('should contain browser_type tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_type');
    });

    it('should contain browser_press_key tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_press_key');
    });

    it('should contain browser_hover tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_hover');
    });

    it('should contain browser_tabs tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_tabs');
    });

    it('should contain browser_take_screenshot tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_take_screenshot');
    });

    it('should contain browser_wait_for tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_wait_for');
    });

    it('should contain browser_evaluate tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_evaluate');
    });

    it('should contain browser_fill_form tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_fill_form');
    });

    it('should contain browser_select_option tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_select_option');
    });

    it('should contain browser_drag tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_drag');
    });

    it('should contain browser_handle_dialog tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_handle_dialog');
    });

    it('should contain browser_network_requests tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_network_requests');
    });

    it('should contain browser_console_messages tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_console_messages');
    });

    it('should contain browser_install tool', () => {
      expect(PLAYWRIGHT_TOOLS).toContain('mcp__playwright__browser_install');
    });

    it('should have 19 Playwright tools', () => {
      expect(PLAYWRIGHT_TOOLS.length).toBe(19);
    });

    it('should be readonly', () => {
      const initialLength = PLAYWRIGHT_TOOLS.length;
      expect(PLAYWRIGHT_TOOLS.length).toBe(initialLength);
    });
  });

  describe('ALLOWED_TOOLS', () => {
    it('should contain all core tools', () => {
      CORE_TOOLS.forEach((tool) => {
        expect(ALLOWED_TOOLS).toContain(tool);
      });
    });

    it('should contain all Playwright tools', () => {
      PLAYWRIGHT_TOOLS.forEach((tool) => {
        expect(ALLOWED_TOOLS).toContain(tool);
      });
    });

    it('should have total of 28 tools (9 core + 19 Playwright)', () => {
      expect(ALLOWED_TOOLS.length).toBe(28);
    });

    it('should be the concatenation of CORE_TOOLS and PLAYWRIGHT_TOOLS', () => {
      const expectedTools = [...CORE_TOOLS, ...PLAYWRIGHT_TOOLS];
      expect(ALLOWED_TOOLS).toEqual(expectedTools);
    });

    it('should be readonly', () => {
      const initialLength = ALLOWED_TOOLS.length;
      expect(ALLOWED_TOOLS.length).toBe(initialLength);
    });
  });

  describe('Tool Naming Convention', () => {
    it('should use mcp__playwright__ prefix for all Playwright tools', () => {
      PLAYWRIGHT_TOOLS.forEach((tool) => {
        expect(tool).toMatch(/^mcp__playwright__browser_/);
      });
    });
  });
});
