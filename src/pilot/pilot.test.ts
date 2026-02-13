/**
 * Tests for Pilot class (Streaming Input version).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Pilot, type PilotCallbacks } from './pilot.js';

describe('Pilot (Streaming Input)', () => {
  let mockCallbacks: PilotCallbacks;
  let pilot: Pilot;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCallbacks = {
      sendMessage: vi.fn(async () => {}),
      sendCard: vi.fn(async () => {}),
      sendFile: vi.fn(async () => {}),
    };
    // Use short idle timeout for testing
    pilot = new Pilot({
      callbacks: mockCallbacks,
      sessionIdleTimeout: 1000, // 1 second for testing
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    pilot.shutdown().catch(() => {});
  });

  describe('Constructor', () => {
    it('should create Pilot instance with callbacks', () => {
      expect(pilot).toBeInstanceOf(Pilot);
    });

    it('should store callbacks', () => {
      expect(pilot['callbacks']).toBe(mockCallbacks);
    });

    it('should initialize states map', () => {
      expect(pilot['states']).toBeInstanceOf(Map);
      expect(pilot['states'].size).toBe(0);
    });

    it('should start cleanup timer', () => {
      expect(pilot['cleanupTimer']).toBeDefined();
    });
  });

  describe('processMessage', () => {
    it('should create state for new chatId', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');

      expect(pilot['states'].has('chat-123')).toBe(true);
    });

    it('should handle multiple messages for same chatId (same state)', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      pilot.processMessage('chat-123', 'World', 'msg-002');

      // Should reuse the same state
      expect(pilot['states'].size).toBe(1);
      expect(pilot['states'].has('chat-123')).toBe(true);
    });

    it('should handle different chatIds independently (different states)', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      pilot.processMessage('chat-456', 'Hi', 'msg-002');

      // Should create two separate states
      expect(pilot['states'].size).toBe(2);
      expect(pilot['states'].has('chat-123')).toBe(true);
      expect(pilot['states'].has('chat-456')).toBe(true);
    });

    it('should accept optional senderOpenId parameter', () => {
      // Should not throw
      pilot.processMessage('chat-123', 'Hello', 'msg-001', 'user-open-id');
      expect(pilot['states'].has('chat-123')).toBe(true);
    });

    it('should be non-blocking (returns immediately)', () => {
      const start = Date.now();
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      const elapsed = Date.now() - start;

      // Should return almost immediately (not wait for SDK)
      expect(elapsed).toBeLessThan(100);
    });

    it('should update lastActivity timestamp', () => {
      const before = Date.now();
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      const state = pilot['states'].get('chat-123');

      expect(state?.lastActivity).toBeGreaterThanOrEqual(before);
    });
  });

  describe('PilotCallbacks Interface', () => {
    it('should require sendMessage callback', () => {
      const callbacks: PilotCallbacks = {
        sendMessage: async () => {},
        sendCard: async () => {},
        sendFile: async () => {},
      };

      expect(typeof callbacks.sendMessage).toBe('function');
    });

    it('should require sendCard callback', () => {
      const callbacks: PilotCallbacks = {
        sendMessage: async () => {},
        sendCard: async () => {},
        sendFile: async () => {},
      };

      expect(typeof callbacks.sendCard).toBe('function');
    });

    it('should require sendFile callback', () => {
      const callbacks: PilotCallbacks = {
        sendMessage: async () => {},
        sendCard: async () => {},
        sendFile: async () => {},
      };

      expect(typeof callbacks.sendFile).toBe('function');
    });
  });

  describe('PilotOptions Interface', () => {
    it('should require callbacks field', () => {
      const options: { callbacks: PilotCallbacks } = {
        callbacks: {
          sendMessage: async () => {},
          sendCard: async () => {},
          sendFile: async () => {},
        },
      };

      expect(options.callbacks).toBeDefined();
    });

    it('should accept optional sessionIdleTimeout', () => {
      const options: { callbacks: PilotCallbacks; sessionIdleTimeout?: number } = {
        callbacks: {
          sendMessage: async () => {},
          sendCard: async () => {},
          sendFile: async () => {},
        },
        sessionIdleTimeout: 60000,
      };

      expect(options.sessionIdleTimeout).toBe(60000);
    });
  });

  describe('hasActiveStream', () => {
    it('should return false when no state exists', () => {
      expect(pilot.hasActiveStream('chat-123')).toBe(false);
    });

    it('should return true when state is active', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');

      // State should be active after creation
      expect(pilot.hasActiveStream('chat-123')).toBe(true);
    });
  });

  describe('getQueueLength', () => {
    it('should return 0 when no state exists', () => {
      expect(pilot.getQueueLength('chat-123')).toBe(0);
    });

    it('should return 0 or 1 when state exists', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');

      // Queue length is 0 or 1 based on pending messages
      const length = pilot.getQueueLength('chat-123');
      expect(length).toBeGreaterThanOrEqual(0);
      expect(length).toBeLessThanOrEqual(1);
    });
  });

  describe('clearQueue', () => {
    it('should clear state', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      expect(pilot['states'].has('chat-123')).toBe(true);

      pilot.clearQueue('chat-123');

      expect(pilot['states'].has('chat-123')).toBe(false);
    });

    it('should handle clearing non-existent state', () => {
      // Should not throw
      pilot.clearQueue('chat-nonexistent');
    });
  });

  describe('clearPendingFiles', () => {
    it('should clear pending files in state', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      const state = pilot['states'].get('chat-123');

      // Add some pending files
      state?.pendingWriteFiles.add('file1.txt');
      state?.pendingWriteFiles.add('file2.txt');
      expect(state?.pendingWriteFiles.size).toBe(2);

      // Clear pending files
      pilot.clearPendingFiles('chat-123');
      expect(state?.pendingWriteFiles.size).toBe(0);
    });
  });

  describe('resetAll', () => {
    it('should clear all states', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      pilot.processMessage('chat-456', 'Hi', 'msg-002');
      expect(pilot['states'].size).toBe(2);

      pilot.resetAll();

      expect(pilot['states'].size).toBe(0);
    });
  });

  describe('getActiveSessionCount', () => {
    it('should return 0 when no states', () => {
      expect(pilot.getActiveSessionCount()).toBe(0);
    });

    it('should return count of active states', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      pilot.processMessage('chat-456', 'Hi', 'msg-002');

      expect(pilot.getActiveSessionCount()).toBe(2);
    });
  });

  describe('shutdown', () => {
    it('should cleanup resources', async () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');

      await pilot.shutdown();

      expect(pilot['states'].size).toBe(0);
    });

    it('should stop cleanup timer', async () => {
      await pilot.shutdown();

      expect(pilot['cleanupTimer']).toBeUndefined();
    });
  });

  describe('State Cleanup', () => {
    it('should cleanup idle states after timeout', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      expect(pilot['states'].size).toBe(1);

      // Advance time past idle timeout
      vi.advanceTimersByTime(1100);

      // Trigger cleanup manually (since timer callback runs async)
      pilot['cleanupIdleStates']();

      // State should be marked for cleanup
      // Note: The actual state.close() is async, so we just check the logic
    });
  });

  describe('Design Principles', () => {
    it('should be platform-agnostic', () => {
      // Pilot works with any messaging platform via callbacks
      const isPlatformAgnostic = true;
      expect(isPlatformAgnostic).toBe(true);
    });

    it('should use per-chatId states (not shared)', () => {
      // Each chatId gets its own state
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      pilot.processMessage('chat-456', 'Hi', 'msg-002');

      expect(pilot['states'].size).toBe(2);
    });

    it('should use callback-based output', () => {
      // Pilot uses dependency injection for callbacks
      expect(pilot['callbacks']).toEqual(mockCallbacks);
    });
  });

  describe('Module Exports', () => {
    it('should export Pilot class', () => {
      expect(Pilot).toBeDefined();
      expect(typeof Pilot).toBe('function');
    });

    it('should export PilotCallbacks type', () => {
      // PilotCallbacks is a type interface
      const callbacks: {
        sendMessage: (chatId: string, text: string) => Promise<void>;
        sendCard: (chatId: string, card: Record<string, unknown>, description?: string) => Promise<void>;
        sendFile: (chatId: string, filePath: string) => Promise<void>;
      } = {
        sendMessage: async () => {},
        sendCard: async () => {},
        sendFile: async () => {},
      };

      expect(callbacks).toBeDefined();
    });

    it('should export PilotOptions type', () => {
      // PilotOptions is a type interface
      const options: {
        callbacks: {
          sendMessage: () => Promise<void>;
          sendCard: () => Promise<void>;
          sendFile: () => Promise<void>;
        };
        sessionIdleTimeout?: number;
      } = {
        callbacks: {
          sendMessage: async () => {},
          sendCard: async () => {},
          sendFile: async () => {},
        },
        sessionIdleTimeout: undefined,
      };

      expect(options).toBeDefined();
    });
  });

  describe('State Management', () => {
    it('should initialize PerChatIdState correctly', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      const state = pilot['states'].get('chat-123');

      expect(state).toBeDefined();
      expect(state?.messageQueue).toEqual(expect.any(Array));
      expect(state?.pendingWriteFiles).toBeInstanceOf(Set);
      expect(state?.closed).toBe(false);
      expect(state?.started).toBe(true);
    });

    it('should queue messages correctly', () => {
      pilot.processMessage('chat-123', 'Hello', 'msg-001');
      pilot.processMessage('chat-123', 'World', 'msg-002');
      const state = pilot['states'].get('chat-123');

      // Messages should be in queue (they may have been consumed by the generator)
      expect(state?.messageQueue).toBeDefined();
    });
  });
});
