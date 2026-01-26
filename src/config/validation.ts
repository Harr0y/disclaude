/**
 * Configuration validation utilities.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate configuration and return detailed errors.
 */
export function validateConfig(config: {
  platform: string;
  discordBotToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  glmApiKey?: string;
  anthropicApiKey?: string;
}): ValidationResult {
  const errors: string[] = [];

  // Validate platform
  if (config.platform !== 'discord' && config.platform !== 'feishu') {
    errors.push(`PLATFORM must be 'discord' or 'feishu', got: ${config.platform}`);
  }

  // Validate platform-specific configuration
  if (config.platform === 'discord') {
    if (!config.discordBotToken) {
      errors.push("DISCORD_BOT_TOKEN is required when PLATFORM=discord");
    }
  } else if (config.platform === 'feishu') {
    if (!config.feishuAppId) {
      errors.push("FEISHU_APP_ID is required when PLATFORM=feishu");
    }
    if (!config.feishuAppSecret) {
      errors.push("FEISHU_APP_SECRET is required when PLATFORM=feishu");
    }
  }

  // Validate agent configuration
  if (!config.glmApiKey && !config.anthropicApiKey) {
    errors.push('At least one API key is required: GLM_API_KEY or ANTHROPIC_API_KEY');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
