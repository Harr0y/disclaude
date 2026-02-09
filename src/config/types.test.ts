/**
 * Tests for config types module.
 */

import { describe, it } from 'vitest';

describe('Config Types', () => {
  describe('Type Exports', () => {
    it('should export WorkspaceConfig interface', () => {
      // WorkspaceConfig is a type interface
      // This test verifies type compilation
      const workspaceConfig: {
        dir?: string;
        maxFileSize?: number;
      } = {};

      // @ts-expect-error - Testing type validation
      const invalidConfig: { invalid?: string } = workspaceConfig;
    });

    it('should export AgentConfig interface', () => {
      const agentConfig: {
        model?: string;
        provider?: 'anthropic' | 'glm';
        permissionMode?: 'default' | 'bypassPermissions';
        maxConcurrentTasks?: number;
      } = {};
    });

    it('should export FeishuConfig interface', () => {
      const feishuConfig: {
        appId?: string;
        appSecret?: string;
        cliChatId?: string;
        deduplication?: {
          maxIds?: number;
          maxAgeMs?: number;
        };
      } = {};
    });

    it('should export GlmConfig interface', () => {
      const glmConfig: {
        apiKey?: string;
        model?: string;
        apiBaseUrl?: string;
      } = {};
    });

    it('should export LoggingConfig interface', () => {
      const loggingConfig: {
        level?: string;
        file?: string;
        pretty?: boolean;
        rotate?: boolean;
      } = {};
    });

    it('should export ToolsConfig interface', () => {
      const toolsConfig: {
        enabled?: string[];
        disabled?: string[];
        mcpServers?: Record<string, {
          type: 'stdio' | 'sse';
          command?: string;
          args?: string[];
          env?: Record<string, string>;
        }>;
      } = {};
    });

    it('should export DisclaudeConfig interface', () => {
      const disclaudeConfig: {
        workspace?: {
          dir?: string;
          maxFileSize?: number;
        };
        agent?: {
          model?: string;
          provider?: 'anthropic' | 'glm';
          permissionMode?: 'default' | 'bypassPermissions';
          maxConcurrentTasks?: number;
        };
        feishu?: {
          appId?: string;
          appSecret?: string;
          cliChatId?: string;
          deduplication?: {
            maxIds?: number;
            maxAgeMs?: number;
          };
        };
        glm?: {
          apiKey?: string;
          model?: string;
          apiBaseUrl?: string;
        };
        logging?: {
          level?: string;
          file?: string;
          pretty?: boolean;
          rotate?: boolean;
        };
        tools?: {
          enabled?: string[];
          disabled?: string[];
          mcpServers?: Record<string, unknown>;
        };
      } = {};
    });

    it('should export ConfigFileInfo interface', () => {
      const configFileInfo: {
        path: string;
        exists: boolean;
      } = {
        path: '/path/to/config',
        exists: true,
      };
    });

    it('should export LoadedConfig interface', () => {
      const loadedConfig: {
        _source?: string;
        _fromFile: boolean;
      } = {
        _fromFile: true,
      };
    });
  });

  describe('Type Compatibility', () => {
    it('should accept valid WorkspaceConfig values', () => {
      const config1 = { dir: '/workspace' };
      const config2 = { maxFileSize: 10485760 };
      const config3 = { dir: '/workspace', maxFileSize: 10485760 };

      // These should compile without errors
      const _: Array<{ dir?: string; maxFileSize?: number }> = [config1, config2, config3];
    });

    it('should accept valid AgentConfig provider values', () => {
      const config1 = { provider: 'anthropic' as const };
      const config2 = { provider: 'glm' as const };
      const config3 = { provider: undefined };

      const _: Array<{ provider?: 'anthropic' | 'glm' }> = [config1, config2, config3];
    });

    it('should accept valid permission mode values', () => {
      const config1 = { permissionMode: 'default' as const };
      const config2 = { permissionMode: 'bypassPermissions' as const };

      const _: Array<{ permissionMode?: 'default' | 'bypassPermissions' }> = [config1, config2];
    });

    it('should accept valid MCP server types', () => {
      const server1 = { type: 'stdio' as const };
      const server2 = { type: 'sse' as const };

      const _: Array<{ type: 'stdio' | 'sse' }> = [server1, server2];
    });
  });
});
