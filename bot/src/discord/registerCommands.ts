import { REST, Routes } from 'discord.js';
import { config } from '../config';
import { commands } from '../commands/index';

/** Publish the slash commands to the configured guild (instant). Returns how many. */
export async function registerGuildCommands(): Promise<number> {
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID),
    { body },
  );
  return body.length;
}
