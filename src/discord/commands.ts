/**
 * Discord commands registration.
 */
import { REST, Routes } from 'discord.js';
import type { DiscordBot } from './bot.js';
import type { SlashCommand } from './types.js';

/**
 * Register slash commands with Discord.
 */
export async function registerCommands(bot: DiscordBot): Promise<void> {
  const commands: SlashCommand[] = [
    {
      name: 'ask',
      description: 'Ask the agent a question',
      options: [
        {
          name: 'question',
          description: 'Your question for the agent',
          type: 3, // STRING
          required: true,
        },
      ],
    },
    {
      name: 'reset',
      description: 'Reset conversation history',
    },
    {
      name: 'ping',
      description: 'Check if the bot is responsive',
    },
    {
      name: 'info',
      description: 'Show information about Disclaude',
    },
  ];

  const rest = new REST({ version: '10' }).setToken(bot.agentClient.apiKey);

  try {
    console.log('Started refreshing application (/) commands.');

    if (bot.user) {
      await rest.put(Routes.applicationCommands(bot.user.id), {
        body: commands,
      });
    }

    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }

  // Register interaction handler
  bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    switch (commandName) {
      case 'ask':
        await handleAsk(interaction, bot);
        break;
      case 'reset':
        await handleReset(interaction, bot);
        break;
      case 'ping':
        await handlePing(interaction, bot);
        break;
      case 'info':
        await handleInfo(interaction, bot);
        break;
    }
  });
}

/**
 * Handle /ask command.
 */
async function handleAsk(interaction: any, bot: DiscordBot): Promise<void> {
  await interaction.deferReply();

  const question = interaction.options.getString('question');
  if (!question) {
    await interaction.editReply('Please provide a question.');
    return;
  }

  // Create a mock message object
  const mockMessage = {
    author: interaction.user,
    channel: interaction.channel,
    reply: async (text: string) => {
      await interaction.editReply(text);
    },
  };

  await bot.processAgentMessage(mockMessage as any, question);
}

/**
 * Handle /reset command.
 */
async function handleReset(interaction: any, bot: DiscordBot): Promise<void> {
  const userId = interaction.user.id;
  if (userId in bot.conversationHistory) {
    delete bot.conversationHistory[userId];
  }
  await interaction.reply('Conversation history cleared!');
}

/**
 * Handle /ping command.
 */
async function handlePing(interaction: any, bot: DiscordBot): Promise<void> {
  const latency = Math.round(bot.ws.ping);
  await interaction.reply(`Pong! 🏓 Latency: ${latency}ms`);
}

/**
 * Handle /info command.
 */
async function handleInfo(interaction: any, bot: DiscordBot): Promise<void> {
  const agentConfig = bot.agentClient.model;
  const info =
    `**Disclaude** - Discord × Agent\n\n` +
    `Platform: Discord\n` +
    `Model: ${agentConfig}\n\n` +
    `**Commands:**\n` +
    `\`/ask <question>\` - Ask a question\n` +
    `\`/reset\` - Clear conversation history\n` +
    `\`/ping\` - Check bot latency\n` +
    `\`/info\` - Show this info\n\n` +
    `**Tip:** You can also mention the bot directly to chat!`;

  await interaction.reply(info);
}
