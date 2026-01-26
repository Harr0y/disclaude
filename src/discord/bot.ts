/**
 * Discord bot implementation using discord.js.
 */
import {
  Client,
  GatewayIntentBits,
  Partials,
  Message,
} from 'discord.js';
import { AgentClient } from '../agent/client.js';
import type { ConversationHistory } from '../types/platform.js';
import { Config } from '../config/index.js';
import { registerCommands } from './commands.js';

/**
 * Discord bot that connects to Claude Agent SDK.
 */
export class DiscordBot extends Client {
  readonly agentClient: AgentClient;
  readonly commandPrefix: string;
  conversationHistory: ConversationHistory = {};

  constructor(agentClient: AgentClient, commandPrefix: string = '!') {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.agentClient = agentClient;
    this.commandPrefix = commandPrefix;

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.once('ready', this.onReady.bind(this));
    this.on('messageCreate', this.onMessage.bind(this));
  }

  private async onReady(): Promise<void> {
    const agentConfig = Config.getAgentConfig();
    console.log(`Logged in as ${this.user?.tag} (${this.user?.id})`);
    console.log(`Model: ${agentConfig.model}`);
    console.log('------');
    console.log('Disclaude is online!');

    // Register commands
    await registerCommands(this);
  }

  private async onMessage(message: Message): Promise<void> {
    // Ignore messages from bots
    if (message.author.bot) {
      return;
    }

    // Check for bot mention
    if (this.user && message.mentions.has(this.user)) {
      // Remove the bot mention from the message
      let cleanMessage = message.content.replace(new RegExp(`<@${this.user.id}>`, 'g'), '');
      cleanMessage = cleanMessage.replace(new RegExp(`<@!${this.user.id}>`, 'g'), '');
      cleanMessage = cleanMessage.trim();

      if (cleanMessage) {
        await this.processAgentMessage(message, cleanMessage);
      }
    }
  }

  /**
   * Process agent message with streaming response.
   */
  async processAgentMessage(message: Message, prompt: string): Promise<void> {
    const userId = message.author.id;
    const sessionId = this.conversationHistory[userId];

    // Send "Processing..." immediately
    if ('sendTyping' in message.channel) {
      await (message.channel as { sendTyping(): Promise<void> }).sendTyping();
    }

    let responseText = '';

    try {
      // Stream agent response
      for await (const agentMessage of this.agentClient.queryStream(prompt, sessionId)) {
        // Extract text from message
        const text = this.agentClient.extractText(agentMessage);
        if (text) {
          responseText += text;
        }
      }

      // Send final response
      if (responseText) {
        await message.reply(responseText);
      }
    } catch (error) {
      await message.reply(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start the bot with the given token.
   */
  async start(token: string): Promise<void> {
    await this.login(token);
  }
}
