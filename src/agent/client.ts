/**
 * Claude Agent SDK compatible wrapper using @anthropic-ai/sdk.
 */
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import type { IAgentClient, AgentMessage, AgentOptions } from '../types/agent.js';

/**
 * Simple message class for SDK compatibility.
 */
class AgentMessageImpl implements AgentMessage {
  content: string;
  role: 'user' | 'assistant' = 'assistant';

  constructor(content: string) {
    this.content = content;
  }
}

/**
 * Wrapper for Claude API with GLM support (SDK-compatible interface).
 */
export class AgentClient implements IAgentClient {
  readonly apiKey: string;
  readonly model: string;
  readonly apiBaseUrl: string | undefined;
  readonly allowedTools: string[];
  readonly workspace: string;

  private readonly client: Anthropic;

  constructor(options: AgentOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.apiBaseUrl = options.apiBaseUrl;
    this.allowedTools = options.allowedTools || [];
    this.workspace = options.workspace;

    // Initialize anthropic client with custom base URL if provided
    if (this.apiBaseUrl) {
      this.client = new Anthropic({
        apiKey: this.apiKey,
        baseURL: this.apiBaseUrl,
      });
    } else {
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
  }

  /**
   * Create agent options (for SDK compatibility).
   */
  createOptions(resume?: string, env?: Record<string, string>): Record<string, unknown> {
    const options: Record<string, unknown> = {
      model: this.model,
      api_key: this.apiKey,
      workspace: this.workspace,
    };

    if (this.apiBaseUrl) {
      options.api_base_url = this.apiBaseUrl;
    }

    if (resume) {
      options.resume = resume;
    }

    if (env) {
      options.env = env;
    }

    return options;
  }

  /**
   * Stream agent response.
   * For simplicity, this uses non-streaming and yields a single message.
   */
  async *queryStream(prompt: string, _sessionId?: string): AsyncIterable<AgentMessage> {
    try {
      // Call Claude API (non-streaming for simplicity)
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      // Extract response text
      const text = this.extractTextFromContent(response.content);

      // Yield as message object
      yield new AgentMessageImpl(text);
    } catch (error) {
      // Yield error message
      yield new AgentMessageImpl(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get environment variables for agent.
   */
  getEnvDict(): Record<string, string> {
    const envDict: Record<string, string> = {
      ANTHROPIC_API_KEY: this.apiKey,
      ANTHROPIC_MODEL: this.model,
      WORKSPACE_DIR: this.workspace,
    };

    if (this.apiBaseUrl) {
      envDict.ANTHROPIC_BASE_URL = this.apiBaseUrl;
    }

    return envDict;
  }

  /**
   * Extract text from agent message.
   */
  extractText(message: AgentMessage): string {
    const content = message.content;

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if ('text' in block && typeof block.text === 'string') {
          parts.push(block.text);
        }
      }
      return parts.join('');
    }

    return '';
  }

  /**
   * Extract text from Anthropic content blocks.
   */
  private extractTextFromContent(content: Anthropic.ContentBlock[]): string {
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === 'text' && 'text' in block) {
        parts.push(block.text);
      }
    }
    return parts.join('');
  }

  /**
   * Ensure workspace directory exists.
   */
  async ensureWorkspace(): Promise<void> {
    try {
      await fs.mkdir(this.workspace, { recursive: true });
    } catch (error) {
      // Ignore if already exists
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
