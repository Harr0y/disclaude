/**
 * Tests for platform type (src/types/platform.ts)
 *
 * Tests the following functionality:
 * - Platform type definition
 * - Type allows 'feishu' and 'cli' values
 */

import { describe, it, expect } from 'vitest';
import type { Platform } from '../../../src/types/platform.js';

describe('Platform Type', () => {
  describe('Type Definition', () => {
    it('should accept "feishu" as valid platform', () => {
      const platformFeishu: Platform = 'feishu';
      expect(platformFeishu).toBe('feishu');
    });

    it('should accept "cli" as valid platform', () => {
      const platformCli: Platform = 'cli';
      expect(platformCli).toBe('cli');
    });

    it('should have correct type structure', () => {
      // This is a compile-time test, but we can check values at runtime
      const validPlatforms: Platform[] = ['feishu', 'cli'];
      expect(validPlatforms).toHaveLength(2);
      expect(validPlatforms).toContain('feishu');
      expect(validPlatforms).toContain('cli');
    });
  });

  describe('Type Guards and Validation', () => {
    it('should identify valid platform values', () => {
      const isValidPlatform = (value: string): value is Platform => {
        return value === 'feishu' || value === 'cli';
      };

      expect(isValidPlatform('feishu')).toBe(true);
      expect(isValidPlatform('cli')).toBe(true);
      expect(isValidPlatform('invalid')).toBe(false);
      expect(isValidPlatform('')).toBe(false);
    });

    it('should only allow specific platform values', () => {
      const platforms: Platform[] = ['feishu', 'cli'];

      platforms.forEach((platform) => {
        expect(['feishu', 'cli']).toContain(platform);
      });
    });
  });
});
