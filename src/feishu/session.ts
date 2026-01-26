/**
 * Session manager for Feishu/Lark bot (in-memory only).
 */
import type { SessionStorage } from '../types/platform.js';

/**
 * Manage session_id persistence per Feishu chat.
 * Sessions are stored in-memory and reset on restart.
 */
export class SessionManager {
  private sessions: SessionStorage = {};

  constructor() {
    // No persistence path needed
  }

  /**
   * Get session_id for a chat.
   */
  async getSessionId(chatId: string): Promise<string | null> {
    return this.sessions[chatId] ?? null;
  }

  /**
   * Set session_id for a chat.
   */
  async setSessionId(chatId: string, sessionId: string): Promise<void> {
    this.sessions[chatId] = sessionId;
  }

  /**
   * Clear session for a chat.
   */
  async clearSession(chatId: string): Promise<void> {
    delete this.sessions[chatId];
  }
}
