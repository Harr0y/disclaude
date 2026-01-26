// Platform type
export type Platform = 'discord' | 'feishu';

// Agent provider type
export type AgentProvider = 'anthropic' | 'glm';

// Discord configuration
export interface DiscordConfig {
  botToken: string;
  commandPrefix: string;
}

// Feishu configuration
export interface FeishuConfig {
  appId: string;
  appSecret: string;
}

// Agent configuration
export interface AgentConfig {
  provider: AgentProvider;
  apiKey: string;
  model: string;
  apiBaseUrl?: string; // For GLM
}

// App configuration interface
export interface AppConfig {
  // Platform selection
  platform: Platform;

  // Discord configuration
  discord?: DiscordConfig;

  // Feishu configuration
  feishu?: FeishuConfig;

  // Agent configuration
  agent: AgentConfig;

  // Paths
  workspace: string;
  sessionPersistencePath: string;
}

// Environment variables interface
export interface EnvVars {
  PLATFORM?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_COMMAND_PREFIX?: string;
  FEISHU_APP_ID?: string;
  FEISHU_APP_SECRET?: string;
  ANTHROPIC_API_KEY?: string;
  CLAUDE_MODEL?: string;
  GLM_API_KEY?: string;
  GLM_MODEL?: string;
  GLM_API_BASE_URL?: string;
  AGENT_WORKSPACE?: string;
  SESSION_PERSISTENCE_PATH?: string;
}

// Validation error interface
export interface ConfigValidationError {
  field: string;
  message: string;
}
