/**
 * Discord-specific types.
 */
import type { APIApplicationCommandOption } from 'discord.js';

export interface SlashCommand {
  name: string;
  description: string;
  options?: APIApplicationCommandOption[];
}
