/**
 * Comprehensive Tests for Feishu Bot (src/feishu/bot.ts)
 *
 * Coverage Goals: Increase from 25.18% to >70%
 *
 * Tests the following functionality:
 * - Bot initialization and lifecycle (start/stop)
 * - Message sending (sendMessage, sendCard, sendFileToUser)
 * - WebSocket connection and event handling
 * - Message processing and deduplication
 * - Command processing (/task)
 * - Direct chat mode
 * - File message handling (image, file, media)
 * - Task flow (Scout → Task.md → DialogueOrchestrator)
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach, MockedFunction } from 'vitest';
import { EventEmitter } from 'events';
import { FeishuBot } from './bot.js';
import * as lark from '@larksuiteoapi/node-sdk';
import { TaskTracker } from '../utils/task-tracker.js';
import { LongTaskTracker } from '../long-task/index.js';
import { Pilot } from '../pilot/index.js';
import { messageHistoryManager } from './message-history.js';
import { attachmentManager, type FileAttachment } from './attachment-manager.js';
import { Config } from '../config/index.js';
import * as fs from 'fs/promises';
import { Scout, DialogueOrchestrator } from '../task/index.js';

// Mock dependencies
vi.mock('@larksuiteoapi/node-sdk', () => {
  const mockClient = vi.fn();
  const mockWSClient = vi.fn();
  const mockEventDispatcher = vi.fn();

  return {
    Client: mockClient,
    WSClient: mockWSClient,
    EventDispatcher: mockEventDispatcher,
    Domain: {
      Feishu: 'https://open.feishu.cn',
    },
  };
});

vi.mock('../utils/task-tracker.js', () => ({
  TaskTracker: vi.fn(),
}));

vi.mock('../long-task/index.js', () => ({
  LongTaskTracker: vi.fn(),
  LongTaskManager: vi.fn(),
}));

vi.mock('../pilot/index.js', () => ({
  Pilot: vi.fn(),
}));

vi.mock('../config/index.js', () => ({
  Config: {
    getAgentConfig: vi.fn(() => ({
      apiKey: 'test-api-key',
      model: 'test-model',
      apiBaseUrl: 'https://api.test.com',
    })),
  },
}));

vi.mock('./content-builder.js', () => ({
  buildTextContent: vi.fn((text) => JSON.stringify({ text })),
}));

vi.mock('../utils/error-handler.js', () => ({
  handleError: vi.fn((error, context, options) => ({
    userMessage: 'Test error message',
    message: 'Original error message',
  })),
  ErrorCategory: {
    API: 'api',
    SDK: 'sdk',
  },
}));

vi.mock('./file-uploader.js', () => ({
  uploadAndSendFile: vi.fn(),
}));

vi.mock('./file-downloader.js', () => ({
  downloadFile: vi.fn(),
  getFileStats: vi.fn(),
}));

vi.mock('../task/index.js', () => ({
  Scout: vi.fn(),
  DialogueOrchestrator: vi.fn(),
  extractText: vi.fn((msg) => msg.content || ''),
}));

vi.mock('../mcp/feishu-context-mcp.js', () => ({
  setMessageSentCallback: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { buildTextContent } from './content-builder.js';
import { handleError, ErrorCategory } from '../utils/error-handler.js';
import { uploadAndSendFile } from './file-uploader.js';
import { downloadFile, getFileStats } from './file-downloader.js';
import { setMessageSentCallback } from '../mcp/feishu-context-mcp.js';

describe('FeishuBot', () => {
  let bot: FeishuBot;
  let mockClientInstance: any;
  let mockWSClientInstance: any;
  let mockEventDispatcherInstance: any;
  let mockTaskTrackerInstance: any;
  let mockLongTaskTrackerInstance: any;
  let mockPilotInstance: any;
  let mockScoutInstance: any;
  let mockDialogueOrchestratorInstance: any;

  const mockedLarkClient = lark.Client as unknown as ReturnType<typeof vi.fn>;
  const mockedLarkWSClient = lark.WSClient as unknown as ReturnType<typeof vi.fn>;
  const mockedEventDispatcher = lark.EventDispatcher as unknown as ReturnType<typeof vi.fn>;
  const mockedTaskTracker = TaskTracker as unknown as ReturnType<typeof vi.fn>;
  const mockedLongTaskTracker = LongTaskTracker as unknown as ReturnType<typeof vi.fn>;
  const mockedPilot = Pilot as unknown as ReturnType<typeof vi.fn>;
  const mockedScout = Scout as unknown as ReturnType<typeof vi.fn>;
  const mockedDialogueOrchestrator = DialogueOrchestrator as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock client instance
    mockClientInstance = {
      im: {
        message: {
          create: vi.fn(),
        },
      },
    };

    // Mock WebSocket client instance
    mockWSClientInstance = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
    };

    // Mock event dispatcher instance
    mockEventDispatcherInstance = {
      register: vi.fn().mockReturnThis(),
    };

    // Mock task tracker instance
    mockTaskTrackerInstance = {
      hasTaskRecord: vi.fn().mockResolvedValue(false),
      saveTaskRecord: vi.fn().mockResolvedValue(undefined),
      saveTaskRecordSync: vi.fn(),
      getDialogueTaskPath: vi.fn().mockReturnValue('/tmp/test-task.md'),
    };

    // Mock long task tracker instance
    mockLongTaskTrackerInstance = {
      saveDialogueTaskPlan: vi.fn().mockResolvedValue(undefined),
      saveLongTaskPlan: vi.fn().mockResolvedValue(undefined),
    };

    // Mock pilot instance
    mockPilotInstance = {
      enqueueMessage: vi.fn().mockResolvedValue(undefined),
    };

    // Mock Scout instance
    mockScoutInstance = {
      initialize: vi.fn().mockResolvedValue(undefined),
      setTaskContext: vi.fn(),
      queryStream: vi.fn().mockResolvedValue(undefined),
    };

    // Mock DialogueOrchestrator instance
    mockDialogueOrchestratorInstance = {
      runDialogue: vi.fn(),
      getMessageTracker: vi.fn().mockReturnValue({
        recordMessageSent: vi.fn(),
        hasAnyMessage: vi.fn().mockReturnValue(true),
        buildWarning: vi.fn().mockReturnValue('Warning message'),
      }),
    };

    mockedLarkClient.mockReturnValue(mockClientInstance);
    mockedLarkWSClient.mockReturnValue(mockWSClientInstance);
    mockedEventDispatcher.mockReturnValue(mockEventDispatcherInstance);
    mockedTaskTracker.mockReturnValue(mockTaskTrackerInstance);
    mockedLongTaskTracker.mockReturnValue(mockLongTaskTrackerInstance);
    mockedPilot.mockReturnValue(mockPilotInstance);
    mockedScout.mockReturnValue(mockScoutInstance);
    mockedDialogueOrchestrator.mockReturnValue(mockDialogueOrchestratorInstance);

    // Mock message history manager
    vi.spyOn(messageHistoryManager, 'addBotMessage').mockImplementation(() => {});
    vi.spyOn(messageHistoryManager, 'addUserMessage').mockImplementation(() => {});
    vi.spyOn(messageHistoryManager, 'getFormattedHistory').mockReturnValue('');

    // Mock attachment manager
    vi.spyOn(attachmentManager, 'hasAttachments').mockReturnValue(false);
    vi.spyOn(attachmentManager, 'formatAttachmentsForPrompt').mockReturnValue('');
    vi.spyOn(attachmentManager, 'addAttachment').mockImplementation(() => {});
    vi.spyOn(attachmentManager, 'getAttachmentCount').mockReturnValue(0);

    // Mock fs.readFile - mock the module directly
    (fs.readFile as any).mockResolvedValue('Task content');

    // Create bot instance
    bot = new FeishuBot('test-app-id', 'test-app-secret');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create bot instance with appId and appSecret', () => {
      expect(bot.appId).toBe('test-app-id');
      expect(bot.appSecret).toBe('test-app-secret');
    });

    it('should extend EventEmitter', () => {
      expect(bot).toBeInstanceOf(EventEmitter);
    });

    it('should initialize task tracker', () => {
      expect(mockedTaskTracker).toHaveBeenCalled();
    });

    it('should initialize long task tracker', () => {
      expect(mockedLongTaskTracker).toHaveBeenCalled();
    });

    it('should initialize pilot with callbacks', () => {
      expect(mockedPilot).toHaveBeenCalledWith({
        callbacks: {
          sendMessage: expect.any(Function),
          sendCard: expect.any(Function),
          sendFile: expect.any(Function),
        },
      });
    });

    it('should initialize deduplication set', () => {
      expect((bot as any).processedMessageIds).toBeInstanceOf(Set);
    });

    it('should initialize empty long task managers map', () => {
      expect((bot as any).longTaskManagers).toBeInstanceOf(Map);
      expect((bot as any).longTaskManagers.size).toBe(0);
    });

    it('should initialize empty active dialogues map', () => {
      expect((bot as any).activeDialogues).toBeInstanceOf(Map);
      expect((bot as any).activeDialogues.size).toBe(0);
    });
  });

  describe('getClient', () => {
    it('should create Lark client on first call', () => {
      const client = (bot as any).getClient();
      expect(mockedLarkClient).toHaveBeenCalledWith({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      });
      expect(client).toBe(mockClientInstance);
    });

    it('should reuse existing client on subsequent calls', () => {
      const client1 = (bot as any).getClient();
      const client2 = (bot as any).getClient();
      expect(client1).toBe(client2);
      expect(mockedLarkClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      mockClientInstance.im.message.create.mockResolvedValue({
        data: { message_id: 'msg123' },
      });
    });

    it('should send text message via REST API', async () => {
      await bot.sendMessage('oc_chat123', 'Test message');

      expect(mockClientInstance.im.message.create).toHaveBeenCalledWith({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: 'oc_chat123',
          msg_type: 'text',
          content: expect.any(String),
        },
      });
    });

    it('should use buildTextContent for message formatting', async () => {
      await bot.sendMessage('oc_chat123', 'Test message');

      expect(buildTextContent).toHaveBeenCalledWith('Test message');
    });

    it('should track bot message in history', async () => {
      await bot.sendMessage('oc_chat123', 'Test message');

      expect(messageHistoryManager.addBotMessage).toHaveBeenCalledWith(
        'oc_chat123',
        'msg123',
        'Test message'
      );
    });

    it('should handle empty message gracefully', async () => {
      await bot.sendMessage('oc_chat123', '');

      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should handle API errors', async () => {
      mockClientInstance.im.message.create.mockRejectedValue(new Error('API error'));

      await expect(bot.sendMessage('oc_chat123', 'Test message')).resolves.not.toThrow();
      expect(handleError).toHaveBeenCalledWith(
        expect.any(Error),
        {
          category: ErrorCategory.API,
          chatId: 'oc_chat123',
          messageType: 'text'
        },
        {
          log: true,
          customLogger: expect.any(Object)
        }
      );
    });

    it('should truncate long messages in logs', async () => {
      const longMessage = 'A'.repeat(200);
      await bot.sendMessage('oc_chat123', longMessage);

      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should handle missing message_id in response', async () => {
      mockClientInstance.im.message.create.mockResolvedValue({
        data: {}, // No message_id
      });

      await expect(bot.sendMessage('oc_chat123', 'Test message')).resolves.not.toThrow();
      expect(messageHistoryManager.addBotMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendCard', () => {
    beforeEach(() => {
      mockClientInstance.im.message.create.mockResolvedValue({
        data: { message_id: 'msg123' },
      });
    });

    it('should send interactive card message', async () => {
      const card = { config: { wide_screen_mode: true } };
      await bot.sendCard('oc_chat123', card, 'Test card');

      expect(mockClientInstance.im.message.create).toHaveBeenCalledWith({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: 'oc_chat123',
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
    });

    it('should send card without description', async () => {
      const card = { config: {} };
      await bot.sendCard('oc_chat123', card);

      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should handle card send errors', async () => {
      mockClientInstance.im.message.create.mockRejectedValue(new Error('Card send failed'));

      await expect(bot.sendCard('oc_chat123', { config: {} })).resolves.not.toThrow();
      expect(handleError).toHaveBeenCalledWith(
        expect.any(Error),
        {
          category: ErrorCategory.API,
          chatId: 'oc_chat123',
          description: undefined,
          messageType: 'card'
        },
        {
          log: true,
          customLogger: expect.any(Object)
        }
      );
    });
  });

  describe('sendFileToUser', () => {
    it('should upload and send file to user', async () => {
      (uploadAndSendFile as any).mockResolvedValue(1024);

      await bot.sendFileToUser('oc_chat123', '/path/to/file.txt');

      expect(uploadAndSendFile).toHaveBeenCalledWith(
        mockClientInstance,
        '/path/to/file.txt',
        'oc_chat123'
      );
    });

    it('should handle file upload errors gracefully', async () => {
      (uploadAndSendFile as any).mockRejectedValue(new Error('Upload failed'));

      await expect(bot.sendFileToUser('oc_chat123', '/path/to/file.txt')).resolves.not.toThrow();
    });

    it('should not throw on upload failure', async () => {
      (uploadAndSendFile as any).mockRejectedValue(new Error('Upload failed'));

      let errorOccurred = false;
      try {
        await bot.sendFileToUser('oc_chat123', '/path/to/file.txt');
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).toBe(false);
    });
  });

  describe('start', () => {
    it('should create event dispatcher and register handlers', async () => {
      await bot.start();

      expect(mockedEventDispatcher).toHaveBeenCalled();
      expect(mockEventDispatcherInstance.register).toHaveBeenCalled();
    });

    it('should register im.message.receive_v1 handler', async () => {
      await bot.start();

      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      expect(registerCall[0]).toHaveProperty('im.message.receive_v1');
      expect(typeof registerCall[0]['im.message.receive_v1']).toBe('function');
    });

    it('should register im.message.message_read_v1 handler', async () => {
      await bot.start();

      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      expect(registerCall[0]).toHaveProperty('im.message.message_read_v1');
    });

    it('should register im.chat.access_event.bot_p2p_chat_entered_v1 handler', async () => {
      await bot.start();

      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      expect(registerCall[0]).toHaveProperty('im.chat.access_event.bot_p2p_chat_entered_v1');
    });

    it('should create WebSocket client and start connection', async () => {
      await bot.start();

      expect(mockedLarkWSClient).toHaveBeenCalledWith({
        appId: 'test-app-id',
        appSecret: 'test-app-secret',
      });
      expect(mockWSClientInstance.start).toHaveBeenCalledWith({
        eventDispatcher: mockEventDispatcherInstance,
      });
    });

    it('should set running flag to true', async () => {
      await bot.start();

      expect((bot as any).running).toBe(true);
    });

    it('should register SIGINT handler', async () => {
      const sigintListeners = process.listeners('SIGINT');
      const initialCount = sigintListeners.length;

      await bot.start();

      expect(process.listeners('SIGINT').length).toBeGreaterThan(initialCount);
    });
  });

  describe('stop', () => {
    it('should set running flag to false', () => {
      (bot as any).running = true;
      bot.stop();

      expect((bot as any).running).toBe(false);
    });

    it('should clear wsClient reference', () => {
      (bot as any).wsClient = mockWSClientInstance;
      bot.stop();

      expect((bot as any).wsClient).toBeUndefined();
    });
  });

  describe('handleMessageReceive - validation and deduplication', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await bot.start();
      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      messageHandler = registerCall[0]['im.message.receive_v1'];
    });

    it('should return early if not running', async () => {
      (bot as any).running = false;

      await expect(messageHandler({})).resolves.not.toThrow();
    });

    it('should return early if message is missing', async () => {
      await expect(messageHandler({})).resolves.not.toThrow();
    });

    it('should return early if message_id is missing', async () => {
      await expect(messageHandler({
        message: { chat_id: 'chat123', content: '{}', message_type: 'text' }
      })).resolves.not.toThrow();
    });

    it('should return early if chat_id is missing', async () => {
      await expect(messageHandler({
        message: { message_id: 'msg123', content: '{}', message_type: 'text' }
      })).resolves.not.toThrow();
    });

    it('should return early if content is missing', async () => {
      await expect(messageHandler({
        message: { message_id: 'msg123', chat_id: 'chat123', message_type: 'text' }
      })).resolves.not.toThrow();
    });

    it('should return early if message_type is missing', async () => {
      await expect(messageHandler({
        message: { message_id: 'msg123', chat_id: 'chat123', content: '{}' }
      })).resolves.not.toThrow();
    });

    it('should skip duplicate message in memory cache', async () => {
      (bot as any).processedMessageIds.add('msg123');

      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"hello"}',
          message_type: 'text',
          sender: { sender_type: 'user' }
        }
      });

      expect(mockClientInstance.im.message.create).not.toHaveBeenCalled();
    });

    it('should skip duplicate message from file-based deduplication', async () => {
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(true);

      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"hello"}',
          message_type: 'text',
          sender: { sender_type: 'user' }
        }
      });

      expect(mockTaskTrackerInstance.hasTaskRecord).toHaveBeenCalledWith('msg123');
      expect((bot as any).processedMessageIds.has('msg123')).toBe(true);
      expect(mockClientInstance.im.message.create).not.toHaveBeenCalled();
    });

    it('should add message to memory cache after processing', async () => {
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);

      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"hello"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect((bot as any).processedMessageIds.has('msg123')).toBe(true);
    });

    it('should remove oldest entry when cache exceeds limit', async () => {
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);

      // Fill the cache
      const maxSize = (bot as any).MAX_PROCESSED_IDS;
      for (let i = 0; i < maxSize + 1; i++) {
        (bot as any).processedMessageIds.add(`msg${i}`);
      }

      await messageHandler({
        message: {
          message_id: 'msg_new',
          chat_id: 'chat123',
          content: '{"text":"hello"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect((bot as any).processedMessageIds.size).toBe(maxSize + 1);
    });

    it('should skip messages from bot itself (sender_type === app)', async () => {
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);

      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"hello"}',
          message_type: 'text',
          sender: { sender_type: 'app' }
        }
      });

      expect(mockClientInstance.im.message.create).not.toHaveBeenCalled();
    });

    it('should skip old messages beyond MAX_MESSAGE_AGE', async () => {
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);
      const oldTime = Date.now() - ((bot as any).MAX_MESSAGE_AGE + 10000);

      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"hello"}',
          message_type: 'text',
          sender: { sender_type: 'user' },
          create_time: oldTime
        }
      });

      expect(mockClientInstance.im.message.create).not.toHaveBeenCalled();
    });

    it('should process recent messages within MAX_MESSAGE_AGE', async () => {
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);
      mockClientInstance.im.message.create.mockResolvedValue({ data: { message_id: 'bot_msg' } });

      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"hello"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalled();
    });
  });

  describe('handleMessageReceive - file/image/media messages', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await bot.start();
      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      messageHandler = registerCall[0]['im.message.receive_v1'];
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);
      (downloadFile as any).mockResolvedValue('/tmp/downloaded_file.jpg');
      (getFileStats as any).mockResolvedValue({ size: 1024 });
    });

    it('should handle image messages', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"image_key":"img_abc123"}',
          message_type: 'image',
          sender: { sender_type: 'user', sender_id: 'user123' }
        }
      });

      expect(downloadFile).toHaveBeenCalledWith(
        mockClientInstance,
        'img_abc123',
        'image',
        expect.stringContaining('image_'),
        'msg123'
      );
    });

    it('should handle file messages', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"file_key":"file_xyz","file_name":"document.pdf"}',
          message_type: 'file',
          sender: { sender_type: 'user', sender_id: 'user123' }
        }
      });

      expect(downloadFile).toHaveBeenCalledWith(
        mockClientInstance,
        'file_xyz',
        'file',
        'document.pdf',
        'msg123'
      );
    });

    it('should handle media messages', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"file_key":"media_123","file_name":"video.mp4"}',
          message_type: 'media',
          sender: { sender_type: 'user', sender_id: 'user123' }
        }
      });

      expect(downloadFile).toHaveBeenCalledWith(
        mockClientInstance,
        'media_123',
        'media',
        'video.mp4',
        'msg123'
      );
    });

    it('should send file received confirmation', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"file_key":"file_xyz","file_name":"test.pdf"}',
          message_type: 'file',
          sender: { sender_type: 'user', sender_id: 'user123' }
        }
      });

      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should handle missing file_key gracefully', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"invalid":"data"}',
          message_type: 'image',
          sender: { sender_type: 'user', sender_id: 'user123' }
        }
      });

      expect(downloadFile).not.toHaveBeenCalled();
      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should handle download errors gracefully', async () => {
      (downloadFile as any).mockRejectedValue(new Error('Download failed'));

      await expect(messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"image_key":"img_123"}',
          message_type: 'image',
          sender: { sender_type: 'user', sender_id: 'user123' }
        }
      })).resolves.not.toThrow();
    });

    it('should enqueue file notification to pilot', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"file_key":"file_xyz","file_name":"test.pdf"}',
          message_type: 'file',
          sender: { sender_type: 'user', sender_id: 'user123' }
        }
      });

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledWith(
        'chat123',
        expect.stringContaining('User uploaded a file'),
        'file-msg123'
      );
    });
  });

  describe('handleMessageReceive - text message parsing', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await bot.start();
      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      messageHandler = registerCall[0]['im.message.receive_v1'];
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);
    });

    it('should parse text message content', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"  hello world  "}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledWith(
        'chat123',
        'hello world',
        'msg123'
      );
    });

    it('should skip empty text messages', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"   "}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(mockPilotInstance.enqueueMessage).not.toHaveBeenCalled();
    });

    it('should parse post type content (rich text)', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"content":[[{"tag":"text","text":"Hello"}],[{"tag":"text","text":" World"}]]}',
          message_type: 'post',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledWith(
        'chat123',
        'Hello World',
        'msg123'
      );
    });

    it('should handle invalid JSON content gracefully', async () => {
      await expect(messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: 'invalid json',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      })).resolves.not.toThrow();
    });

    it('should skip unsupported message types', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{}',
          message_type: 'audio',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(mockPilotInstance.enqueueMessage).not.toHaveBeenCalled();
    });

    it('should save task record before processing', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"test"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(mockTaskTrackerInstance.saveTaskRecord).toHaveBeenCalledWith(
        'msg123',
        {
          chatId: 'chat123',
          senderType: 'user',
          senderId: 'user123',
          text: 'test',
          timestamp: expect.any(Number)
        },
        '[Processing...]'
      );
    });

    it('should use sync write for restart commands', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"please restart pm2"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(mockTaskTrackerInstance.saveTaskRecordSync).toHaveBeenCalled();
    });

    it('should track user message in history', async () => {
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"test"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect(messageHistoryManager.addUserMessage).toHaveBeenCalledWith(
        'chat123',
        'msg123',
        'test',
        'user123'
      );
    });
  });

  describe('handleMessageReceive - command handling', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await bot.start();
      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      messageHandler = registerCall[0]['im.message.receive_v1'];
      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);
    });

    it('should handle /reset command', async () => {
      // This test verifies command routing exists
      // Actual command tests are in command-handlers.test.ts
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"/reset"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      // Verify the message was processed (command execution happens in command-handlers)
      expect(mockTaskTrackerInstance.saveTaskRecord).toHaveBeenCalled();
    });
  });

  describe('handleDirectChat', () => {
    it('should enqueue message to pilot', async () => {
      await (bot as any).handleDirectChat('oc_chat123', 'Hello', 'msg123');

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledWith(
        'oc_chat123',
        'Hello',
        'msg123'
      );
    });

    it('should enhance text with attachment info when present', async () => {
      vi.spyOn(attachmentManager, 'hasAttachments').mockReturnValue(true);
      vi.spyOn(attachmentManager, 'formatAttachmentsForPrompt')
        .mockReturnValue('Attachments: file1.txt\n');

      await (bot as any).handleDirectChat('oc_chat123', 'Process these files', 'msg123');

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledWith(
        'oc_chat123',
        expect.stringContaining('Attachments:'),
        'msg123'
      );
    });

    it('should not enhance text when no attachments', async () => {
      await (bot as any).handleDirectChat('oc_chat123', 'Hello', 'msg123');

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledWith(
        'oc_chat123',
        'Hello',
        'msg123'
      );
    });

    it('should return empty string', async () => {
      const result = await (bot as any).handleDirectChat('oc_chat123', 'Hello', 'msg123');

      expect(result).toBe('');
    });
  });

  describe('handleTaskFlow', () => {
    it('should create Scout instance with agent config', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task created', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        yield { content: 'Response', messageType: 'text' };
      });

      await (bot as any).handleTaskFlow('chat123', 'Create a file', 'msg123', { sender_id: 'user123' });

      expect(mockedScout).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        model: 'test-model',
        apiBaseUrl: 'https://api.test.com',
      });
    });

    it('should initialize Scout and set task context', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task created', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        yield { content: 'Response', messageType: 'text' };
      });

      await (bot as any).handleTaskFlow('chat123', 'Create a file', 'msg123', { sender_id: 'user123' });

      expect(mockScoutInstance.initialize).toHaveBeenCalled();
      expect(mockScoutInstance.setTaskContext).toHaveBeenCalledWith({
        chatId: 'chat123',
        userId: 'user123',
        messageId: 'msg123',
        taskPath: '/tmp/test-task.md',
        conversationHistory: '',
      });
    });

    it('should run Scout queryStream and create Task.md', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task content', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        yield { content: 'Response', messageType: 'text' };
      });

      await (bot as any).handleTaskFlow('chat123', 'Create task', 'msg123', { sender_id: 'user123' });

      expect(mockScoutInstance.queryStream).toHaveBeenCalledWith('Create task');
    });

    it('should send Task.md content to user', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task content', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        yield { content: 'Response', messageType: 'text' };
      });

      await (bot as any).handleTaskFlow('chat123', 'Create task', 'msg123', { sender_id: 'user123' });

      expect(fs.readFile).toHaveBeenCalledWith('/tmp/test-task.md', 'utf-8');
      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should create DialogueOrchestrator with correct config', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        yield { content: 'Done', messageType: 'result' };
      });

      await (bot as any).handleTaskFlow('chat123', 'Task', 'msg123', { sender_id: 'user123' });

      expect(mockedDialogueOrchestrator).toHaveBeenCalledWith({
        plannerConfig: {
          apiKey: 'test-api-key',
          model: 'test-model',
          apiBaseUrl: 'https://api.test.com',
        },
        executorConfig: {
          apiKey: 'test-api-key',
          model: 'test-model',
          apiBaseUrl: 'https://api.test.com',
          sendMessage: expect.any(Function),
          sendCard: expect.any(Function),
          chatId: 'chat123',
          permissionMode: 'bypassPermissions',
        },
        evaluatorConfig: {
          apiKey: 'test-api-key',
          model: 'test-model',
          apiBaseUrl: 'https://api.test.com',
          permissionMode: 'bypassPermissions',
        },
        onTaskPlanGenerated: expect.any(Function),
      });
    });

    it('should run dialogue and send responses', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);

      const mockDialogueStream = async function* () {
        yield { content: 'Step 1', messageType: 'text' };
        yield { content: 'Step 2', messageType: 'text' };
        yield { content: 'Complete', messageType: 'result' };
      };
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(mockDialogueStream);

      await (bot as any).handleTaskFlow('chat123', 'Multi-step task', 'msg123', { sender_id: 'user123' });

      expect(mockDialogueOrchestratorInstance.runDialogue).toHaveBeenCalled();
      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should store active dialogue in map', async () => {
      let dialogueStored = false;

      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);

      const mockDialogueStream = async function* () {
        // Check that dialogue is stored while running
        dialogueStored = (bot as any).activeDialogues.has('chat123');
        yield { content: 'Done', messageType: 'result' };
      };
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(mockDialogueStream);

      await (bot as any).handleTaskFlow('chat123', 'Task', 'msg123', { sender_id: 'user123' });

      // Verify dialogue was stored at some point during execution
      expect(dialogueStored).toBe(true);
    });

    it('should clean up active dialogue after completion', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        yield { content: 'Done', messageType: 'result' };
      });

      await (bot as any).handleTaskFlow('chat123', 'Task', 'msg123', { sender_id: 'user123' });

      expect((bot as any).activeDialogues.has('chat123')).toBe(false);
    });

    it('should handle errors in task flow', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        throw new Error('Task failed');
      });

      await (bot as any).handleTaskFlow('chat123', 'Failing task', 'msg123', { sender_id: 'user123' });

      expect(handleError).toHaveBeenCalled();
    });

    it('should send warning when no messages sent', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        // No messages
      });
      mockDialogueOrchestratorInstance.getMessageTracker.mockReturnValue({
        recordMessageSent: vi.fn(),
        hasAnyMessage: vi.fn().mockReturnValue(false),
        buildWarning: vi.fn().mockReturnValue('No messages sent'),
      });

      await (bot as any).handleTaskFlow('chat123', 'Task', 'msg123', { sender_id: 'user123' });

      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should return accumulated response', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);

      const mockDialogueStream = async function* () {
        yield { content: 'Response 1', messageType: 'text' };
        yield { content: 'Response 2', messageType: 'text' };
      };
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(mockDialogueStream);

      const result = await (bot as any).handleTaskFlow('chat123', 'Task', 'msg123', { sender_id: 'user123' });

      expect(result).toContain('Response 1');
      expect(result).toContain('Response 2');
    });

    it('should handle readFile errors gracefully', async () => {
      const mockScoutStream = async function* () {
        yield { content: 'Task', messageType: 'text' };
      };
      mockScoutInstance.queryStream.mockImplementation(mockScoutStream);
      mockDialogueOrchestratorInstance.runDialogue.mockImplementation(async function* () {
        yield { content: 'Done', messageType: 'result' };
      });
      (fs.readFile as any).mockRejectedValue(new Error('File not found'));

      await expect((bot as any).handleTaskFlow('chat123', 'Task', 'msg123', { sender_id: 'user123' }))
        .resolves.not.toThrow();
    });
  });

  describe('handleFileMessage', () => {
    beforeEach(() => {
      (downloadFile as any).mockResolvedValue('/tmp/file.jpg');
      (getFileStats as any).mockResolvedValue({ size: 1024 });
    });

    it('should handle image message download', async () => {
      await (bot as any).handleFileMessage('chat123', 'image', '{"image_key":"img123"}', 'msg123', { sender_id: 'user123' });

      expect(downloadFile).toHaveBeenCalledWith(
        mockClientInstance,
        'img123',
        'image',
        expect.stringContaining('.jpg'),
        'msg123'
      );
    });

    it('should handle file message download', async () => {
      await (bot as any).handleFileMessage('chat123', 'file', '{"file_key":"file123","file_name":"doc.pdf"}', 'msg123', { sender_id: 'user123' });

      expect(downloadFile).toHaveBeenCalledWith(
        mockClientInstance,
        'file123',
        'file',
        'doc.pdf',
        'msg123'
      );
    });

    it('should store attachment after download', async () => {
      await (bot as any).handleFileMessage('chat123', 'file', '{"file_key":"f123","file_name":"test.txt"}', 'msg123', { sender_id: 'user123' });

      expect(attachmentManager.addAttachment).toHaveBeenCalledWith(
        'chat123',
        expect.objectContaining({
          fileKey: 'f123',
          fileName: 'test.txt',
          localPath: '/tmp/file.jpg', // Matches the mock downloadFile return value
        })
      );
    });

    it('should send confirmation message to user', async () => {
      await (bot as any).handleFileMessage('chat123', 'file', '{"file_key":"f123","file_name":"test.txt"}', 'msg123', { sender_id: 'user123' });

      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should handle missing file_key', async () => {
      await (bot as any).handleFileMessage('chat123', 'image', '{"invalid":"data"}', 'msg123', { sender_id: 'user123' });

      expect(downloadFile).not.toHaveBeenCalled();
      expect(mockClientInstance.im.message.create).toHaveBeenCalled();
    });

    it('should handle download errors', async () => {
      (downloadFile as any).mockRejectedValue(new Error('Download failed'));

      await expect((bot as any).handleFileMessage('chat123', 'file', '{"file_key":"f123"}', 'msg123', { sender_id: 'user123' }))
        .resolves.not.toThrow();
    });

    it('should enqueue file notification to pilot', async () => {
      await (bot as any).handleFileMessage('chat123', 'file', '{"file_key":"f123","file_name":"test.txt"}', 'msg123', { sender_id: 'user123' });

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledWith(
        'chat123',
        expect.stringContaining('User uploaded a file'),
        'file-msg123'
      );
    });
  });

  describe('error handling', () => {
    it('should handle sendMessage errors gracefully', async () => {
      mockClientInstance.im.message.create.mockRejectedValue(new Error('API error'));

      await expect(bot.sendMessage('oc_chat123', 'Test message')).resolves.not.toThrow();
      expect(handleError).toHaveBeenCalled();
    });

    it('should handle sendCard errors gracefully', async () => {
      mockClientInstance.im.message.create.mockRejectedValue(new Error('Card send failed'));

      await expect(bot.sendCard('oc_chat123', { config: {} })).resolves.not.toThrow();
      expect(handleError).toHaveBeenCalled();
    });

    it('should handle file upload errors gracefully', async () => {
      (uploadAndSendFile as any).mockRejectedValue(new Error('Upload failed'));

      await expect(bot.sendFileToUser('oc_chat123', '/path/to/file.txt')).resolves.not.toThrow();
    });

    it('should handle message receive event errors', async () => {
      await bot.start();
      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      const messageHandler = registerCall[0]['im.message.receive_v1'];

      mockTaskTrackerInstance.hasTaskRecord.mockImplementation(() => {
        throw new Error('Deduplication failed');
      });

      await expect(messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"test"}',
          message_type: 'text',
          sender: { sender_type: 'user' }
        }
      })).resolves.not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete message lifecycle', async () => {
      await bot.start();

      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      const messageHandler = registerCall[0]['im.message.receive_v1'];

      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);

      // Simulate receiving a message
      await messageHandler({
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"Hello bot"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      // Verify message was deduplicated
      expect((bot as any).processedMessageIds.has('msg123')).toBe(true);

      // Verify task record was saved
      expect(mockTaskTrackerInstance.saveTaskRecord).toHaveBeenCalled();

      // Verify pilot was called
      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalled();
    });

    it('should handle multiple messages in sequence', async () => {
      await bot.start();

      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      const messageHandler = registerCall[0]['im.message.receive_v1'];

      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);

      // First message
      await messageHandler({
        message: {
          message_id: 'msg1',
          chat_id: 'chat123',
          content: '{"text":"First"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      // Second message
      await messageHandler({
        message: {
          message_id: 'msg2',
          chat_id: 'chat123',
          content: '{"text":"Second"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      });

      expect((bot as any).processedMessageIds.has('msg1')).toBe(true);
      expect((bot as any).processedMessageIds.has('msg2')).toBe(true);
      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledTimes(2);
    });

    it('should skip duplicate messages', async () => {
      await bot.start();

      const registerCall = (mockEventDispatcherInstance.register as any).mock.calls[0];
      const messageHandler = registerCall[0]['im.message.receive_v1'];

      mockTaskTrackerInstance.hasTaskRecord.mockResolvedValue(false);

      const messageData = {
        message: {
          message_id: 'msg123',
          chat_id: 'chat123',
          content: '{"text":"Duplicate"}',
          message_type: 'text',
          sender: { sender_type: 'user', sender_id: 'user123' },
          create_time: Date.now()
        }
      };

      // First processing
      await messageHandler(messageData);

      // Second processing (should be skipped)
      await messageHandler(messageData);

      expect(mockPilotInstance.enqueueMessage).toHaveBeenCalledTimes(1);
    });
  });
});
