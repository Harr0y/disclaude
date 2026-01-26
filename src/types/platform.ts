// Conversation history storage (in-memory for Discord)
export interface ConversationHistory {
  [userId: string]: string;
}

// Session storage interface (for Feishu file-based persistence)
export interface SessionStorage {
  [chatId: string]: string;
}

// Bot state interface
export interface BotState {
  conversationHistory: ConversationHistory;
  isReady: boolean;
}

// Command handler type
export type CommandHandler = (
  interaction: unknown,
  args?: string[]
) => Promise<void>;
