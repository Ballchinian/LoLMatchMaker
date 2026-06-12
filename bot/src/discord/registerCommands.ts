import { REST, Routes } from 'discord.js';
import { config } from '../config';
import { commands } from '../commands/index';

const rest = new REST().setToken(config.DISCORD_TOKEN);

//Publish the slash commands to one guild (instant, unlike global registration)
export async function registerCommandsForGuild(guildId: string): Promise<number> {
    const body = commands.map((c) => c.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, guildId), { body });
    return body.length;
}

//Publish to every given guild (the bot works on any server it's invited to)
export async function registerCommandsForGuilds(guildIds: string[]): Promise<number> {
    let total = 0;
    for (const id of guildIds) {
        try {
            total += await registerCommandsForGuild(id);
        } catch (err) {
            console.error(`[bot] command registration failed for guild ${id}:`, err);
        }
    }
    return total;
}
