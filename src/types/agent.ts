// Content block type from Anthropic API
export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: string | unknown[];
  [key: string]: unknown;
}

// Agent message interface
export interface AgentMessage {
  content: string | ContentBlock[];
  role?: 'user' | 'assistant';
  stop_reason?: string;
  stop_sequence?: string | null;
}

// Stream response chunk
export interface StreamChunk {
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string;
  };
  type?: string;
  index?: number;
  [key: string]: unknown;
}

// Agent client interface
export interface IAgentClient {
  queryStream(prompt: string, sessionId?: string): AsyncIterable<AgentMessage>;
  getEnvDict(): Record<string, string>;
  extractText(message: AgentMessage): string;
}

// Agent options
export interface AgentOptions {
  apiKey: string;
  model: string;
  apiBaseUrl?: string;
  allowedTools?: string[];
  workspace: string;
}
