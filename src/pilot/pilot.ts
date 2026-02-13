/**
 * Pilot - Platform-agnostic direct chat abstraction with Streaming Input.
 *
 * The Pilot class manages conversational AI interactions using Claude Agent SDK's
 * streaming input mode. It maintains persistent Agent instances per chatId, allowing
 * for context persistence across multiple user messages.
 *
 * Key Features:
 * - Streaming Input Mode: Uses SDK's AsyncGenerator-based input for real-time interaction
 * - Per-chatId Agent Instances: Each chatId has its own persistent Agent instance
 * - Message Queue: Messages are queued and processed sequentially per chatId
 * - Automatic cleanup: Idle sessions are cleaned up after a timeout
 *
 * Architecture:
 * ```
 * User Message → Pilot.processMessage()
 *                    ↓
 *              Get/Create state for chatId
 *                    ↓
 *              Push message to queue
 *                    ↓
 *              Message queued → Generator yields → SDK processes
 *                    ↓
 *              SDK output → Callbacks → Platform (Feishu/CLI)
 * ```
 */

import type { SDKUserMessage, Query } from '@anthropic-ai/claude-agent-sdk';
import { createLogger } from '../utils/logger.js';
import { Config } from '../config/index.js';
import { feishuSdkMcpServer } from '../mcp/feishu-context-mcp.js';
import { taskSkillSdkMcpServer } from '../mcp/task-skill-mcp.js';
import { parseSDKMessage } from '../utils/sdk.js';

/**
 * Callback functions for platform-specific operations.
 */
export interface PilotCallbacks {
  /**
   * Send a text message to the user.
   * @param chatId - Platform-specific chat identifier
   * @param text - Message content
   */
  sendMessage: (chatId: string, text: string) => Promise<void>;

  /**
   * Send an interactive card to the user.
   * @param chatId - Platform-specific chat identifier
   * @param card - Card JSON structure
   * @param description - Optional description for logging
   */
  sendCard: (chatId: string, card: Record<string, unknown>, description?: string) => Promise<void>;

  /**
   * Send a file to the user.
   * @param chatId - Platform-specific chat identifier
   * @param filePath - Local file path to send
   */
  sendFile: (chatId: string, filePath: string) => Promise<void>;
}

/**
 * Configuration options for Pilot.
 */
export interface PilotOptions {
  /**
   * Callback functions for platform-specific operations.
   */
  callbacks: PilotCallbacks;

  /**
   * Maximum idle time before a session is cleaned up (ms).
   * Default: 30 minutes
   */
  sessionIdleTimeout?: number;
}

/**
 * Queued message waiting to be processed by the Agent.
 */
interface QueuedMessage {
  text: string;
  messageId: string;
  senderOpenId?: string;
}

/**
 * Per-chatId state for managing Agent instances.
 */
interface PerChatIdState {
  /** Message queue for streaming input */
  messageQueue: QueuedMessage[];
  /** Resolver for signaling new messages */
  messageResolver?: (() => void);
  /** SDK Query instance */
  queryInstance?: Query;
  /** Pending Write tool files */
  pendingWriteFiles: Set<string>;
  /** Whether this chatId is closed */
  closed: boolean;
  /** Last activity timestamp */
  lastActivity: number;
  /** Whether the Agent loop has been started */
  started: boolean;
}

/**
 * Pilot - Platform-agnostic direct chat abstraction with Streaming Input.
 *
 * Manages conversational AI interactions via streaming SDK queries.
 * Each chatId gets its own persistent Agent instance that maintains
 * conversation context across multiple messages.
 */
export class Pilot {
  private readonly callbacks: PilotCallbacks;
  private readonly logger = createLogger('Pilot');

  // Per-chatId Agent states
  private states = new Map<string, PerChatIdState>();

  // Session idle timeout (default: 30 minutes)
  private readonly sessionIdleTimeout: number;

  // Cleanup interval timer
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(options: PilotOptions) {
    this.callbacks = options.callbacks;
    this.sessionIdleTimeout = options.sessionIdleTimeout ?? 30 * 60 * 1000; // 30 minutes

    // Start periodic cleanup
    this.startCleanupTimer();
  }

  /**
   * Process a message with the AI agent.
   *
   * This method is non-blocking - it queues the message and returns immediately.
   * The message will be processed by the Agent instance for this chatId.
   *
   * If no Agent state exists for this chatId, one is created automatically.
   *
   * @param chatId - Platform-specific chat identifier
   * @param text - User's message text
   * @param messageId - Unique message identifier
   * @param senderOpenId - Optional sender's open_id for @ mentions
   */
  processMessage(
    chatId: string,
    text: string,
    messageId: string,
    senderOpenId?: string
  ): void {
    this.logger.debug({ chatId, messageId, textLength: text.length }, 'Processing message');

    // Get or create state for this chatId
    const state = this.getOrCreateState(chatId);

    // Update last activity
    state.lastActivity = Date.now();

    // Push message to the queue
    state.messageQueue.push({ text, messageId, senderOpenId });

    // Signal the generator that a new message is available
    if (state.messageResolver) {
      state.messageResolver();
    }
  }

  /**
   * Get or create a PerChatIdState for a chatId.
   *
   * If a state already exists and is active, it's reused.
   * If not, a new state is created and started.
   */
  private getOrCreateState(chatId: string): PerChatIdState {
    const existing = this.states.get(chatId);

    // Check if existing state is still active
    if (existing && !existing.closed && existing.started) {
      this.logger.debug({ chatId }, 'Reusing existing state');
      return existing;
    }

    // Create new state
    this.logger.info({ chatId }, 'Creating new state');

    const state: PerChatIdState = {
      messageQueue: [],
      messageResolver: undefined,
      queryInstance: undefined,
      pendingWriteFiles: new Set(),
      closed: false,
      lastActivity: Date.now(),
      started: false,
    };

    this.states.set(chatId, state);

    // Start the Agent loop
    this.startAgentLoop(chatId).catch((err) => {
      this.logger.error({ err, chatId }, 'Failed to start Agent loop');
    });

    return state;
  }

  /**
   * Build enhanced content with Feishu context.
   */
  private buildEnhancedContent(chatId: string, msg: QueuedMessage): string {
    if (msg.senderOpenId) {
      return `You are responding in a Feishu chat.

**Chat ID:** ${chatId}
**Sender Open ID:** ${msg.senderOpenId}

---

## @ Mention the User

To notify the user in your FINAL response, use:
\`\`\`
<at user_id="${msg.senderOpenId}">@用户</at>
\`\`\`

**Rules:**
- Use @ ONLY in your **final/complete response**, NOT in intermediate messages
- This triggers a Feishu notification to the user

---

## Tools

When using send_file_to_feishu or send_user_feedback, use Chat ID: \`${chatId}\`

--- User Message ---
${msg.text}`;
    }

    return `You are responding in a Feishu chat.

**Chat ID:** ${chatId}

When using send_file_to_feishu or send_user_feedback, use this Chat ID.

--- User Message ---
${msg.text}`;
  }

  /**
   * Message generator for SDK streaming input.
   *
   * This AsyncGenerator yields messages from the queue, waiting
   * for new messages when the queue is empty.
   */
  private async *messageGenerator(chatId: string): AsyncGenerator<SDKUserMessage> {
    const state = this.states.get(chatId);
    if (!state) {
      return;
    }

    while (!state.closed) {
      // Yield all queued messages
      while (state.messageQueue.length > 0) {
        const msg = state.messageQueue.shift();
        if (!msg) {
          break;
        }
        this.logger.debug({ messageId: msg.messageId }, 'Yielding message to Agent');

        // Build user message with context
        const enhancedContent = this.buildEnhancedContent(chatId, msg);

        yield {
          type: 'user',
          message: {
            role: 'user',
            content: enhancedContent,
          },
          parent_tool_use_id: null,
          session_id: '', // Empty string - SDK handles session internally
        };
      }

      // If closed, stop the generator
      if (state.closed) {
        return;
      }

      // Wait for new messages
      await new Promise<void>((resolve) => {
        state.messageResolver = resolve;
      });
      state.messageResolver = undefined;
    }
  }

  /**
   * Main Agent loop - processes SDK messages.
   */
  private async startAgentLoop(chatId: string): Promise<void> {
    const state = this.states.get(chatId);
    if (!state) {
      return;
    }

    if (state.started) {
      this.logger.warn({ chatId }, 'Agent loop already started');
      return;
    }

    state.started = true;

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { createAgentSdkOptions } = await import('../utils/sdk.js');
    const agentConfig = Config.getAgentConfig();

    const sdkOptions = createAgentSdkOptions({
      apiKey: agentConfig.apiKey,
      model: agentConfig.model,
      apiBaseUrl: agentConfig.apiBaseUrl,
      permissionMode: 'bypassPermissions',
      disallowedTools: ['AskUserQuestion'],
    });

    // Add MCP servers for task tools
    (sdkOptions as Record<string, unknown>).mcpServers = {
      'feishu-context': feishuSdkMcpServer,
      'task-skill': taskSkillSdkMcpServer,
    };

    this.logger.info({ chatId }, 'Starting SDK query with streaming input');

    try {
      // Create query with streaming input generator
      state.queryInstance = query({
        prompt: this.messageGenerator(chatId),
        options: sdkOptions,
      });

      // Process SDK messages
      for await (const message of state.queryInstance) {
        if (state.closed) {
          break;
        }

        // Parse and process the message
        const parsed = parseSDKMessage(message);

        // Update activity timestamp
        state.lastActivity = Date.now();

        // Track Write tool operations
        const isWriteTool =
          parsed.type === 'tool_use' && parsed.metadata?.toolName === 'Write';

        if (isWriteTool && parsed.metadata?.toolInputRaw) {
          const toolInput = parsed.metadata.toolInputRaw as Record<string, unknown>;
          const filePath =
            (toolInput.file_path || toolInput.filePath) as string | undefined;

          if (filePath) {
            state.pendingWriteFiles.add(filePath);
            this.logger.debug({ filePath, chatId }, 'Write tool detected');
          }
        }

        // Send file when Write tool completes
        if (parsed.type === 'tool_result' && state.pendingWriteFiles.size > 0) {
          const filePaths = Array.from(state.pendingWriteFiles);
          state.pendingWriteFiles.clear();
          this.logger.debug(
            { fileCount: filePaths.length, chatId },
            'Write tool completed'
          );

          for (const filePath of filePaths) {
            try {
              await this.callbacks.sendFile(chatId, filePath);
              this.logger.info({ filePath, chatId }, 'File sent');
            } catch (error) {
              const err = error as Error;
              this.logger.error({ err, filePath, chatId }, 'Failed to send file');
              await this.callbacks.sendMessage(
                chatId,
                `❌ Failed to send file: ${filePath}`
              );
            }
          }
        }

        // Send message content to callback
        if (parsed.content) {
          await this.callbacks.sendMessage(chatId, parsed.content);
        }
      }

      this.logger.info({ chatId }, 'Agent loop completed normally');

      // Remove state from map on completion
      this.states.delete(chatId);
    } catch (error) {
      const err = error as Error;
      this.logger.error({ err, chatId }, 'Agent loop error');

      await this.callbacks.sendMessage(chatId, `❌ Session error: ${err.message}`);

      // Remove state from map on error
      this.states.delete(chatId);
    }
  }

  /**
   * Start periodic cleanup timer for idle sessions.
   */
  private startCleanupTimer(): void {
    // Run cleanup every 5 minutes
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleStates();
    }, 5 * 60 * 1000);
  }

  /**
   * Cleanup states that have been idle for too long.
   */
  private cleanupIdleStates(): void {
    const now = Date.now();
    const toCleanup: string[] = [];

    for (const [chatId, state] of this.states) {
      const idleTime = now - state.lastActivity;

      if (idleTime > this.sessionIdleTimeout) {
        this.logger.info(
          { chatId, idleTimeMs: idleTime, timeoutMs: this.sessionIdleTimeout },
          'State idle timeout'
        );
        toCleanup.push(chatId);
      }
    }

    // Close idle states
    for (const chatId of toCleanup) {
      const state = this.states.get(chatId);
      if (state) {
        state.closed = true;
        if (state.queryInstance) {
          state.queryInstance.close();
        }
      }
    }
  }

  /**
   * Check if an Agent session is active for a chatId.
   *
   * @param chatId - Platform-specific chat identifier
   * @returns true if a session is active
   */
  hasActiveStream(chatId: string): boolean {
    const state = this.states.get(chatId);
    return state?.started === true && state.closed === false;
  }

  /**
   * Get the number of pending messages in the queue for a chatId.
   *
   * @param chatId - Platform-specific chat identifier
   * @returns Number of pending messages
   */
  getQueueLength(chatId: string): number {
    const state = this.states.get(chatId);
    if (!state) {
      return 0;
    }
    return state.messageQueue.length > 0 ? 1 : 0;
  }

  /**
   * Clear all state for a chatId (close session and remove from map).
   *
   * @param chatId - Platform-specific chat identifier
   */
  clearQueue(chatId: string): void {
    const state = this.states.get(chatId);
    if (state) {
      state.closed = true;
      if (state.messageResolver) {
        state.messageResolver();
      }
      if (state.queryInstance) {
        state.queryInstance.close();
      }
    }
    this.states.delete(chatId);
    this.logger.debug({ chatId }, 'State cleared');
  }

  /**
   * Clear all pending files for a chatId.
   *
   * Note: In the new implementation, file tracking is internal to the state.
   * This method is kept for API compatibility.
   *
   * @param chatId - Platform-specific chat identifier
   */
  clearPendingFiles(chatId: string): void {
    const state = this.states.get(chatId);
    if (state) {
      state.pendingWriteFiles.clear();
    }
    this.logger.debug({ chatId }, 'Pending files cleared');
  }

  /**
   * Reset all states (close all and start fresh).
   *
   * This is useful for /reset commands that clear all conversation context.
   */
  resetAll(): void {
    this.logger.info('Resetting all states');

    for (const [, state] of this.states) {
      state.closed = true;
      if (state.messageResolver) {
        state.messageResolver();
      }
      if (state.queryInstance) {
        state.queryInstance.close();
      }
    }

    this.states.clear();
    this.logger.info('All states reset');
  }

  /**
   * Get the number of active states.
   */
  getActiveSessionCount(): number {
    let count = 0;
    for (const state of this.states.values()) {
      if (state.started && !state.closed) {
        count++;
      }
    }
    return count;
  }

  /**
   * Cleanup resources on shutdown.
   */
  async shutdown(): Promise<void> {
    await Promise.resolve(); // No-op to satisfy linter
    this.logger.info('Shutting down Pilot');

    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Close all states
    for (const [, state] of this.states) {
      state.closed = true;
      if (state.messageResolver) {
        state.messageResolver();
      }
      if (state.queryInstance) {
        state.queryInstance.close();
      }
    }

    this.states.clear();
    this.logger.info('Pilot shutdown complete');
  }
}
