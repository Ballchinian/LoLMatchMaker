import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
    DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
    DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
    DISCORD_GUILD_ID: z.string().min(1, 'DISCORD_GUILD_ID is required'),

    // Admin marker role created by /setup; holders count as bot admins. Per guild
    // by design: the bot should work on any server it's invited to.
    ADMIN_ROLE_NAME: z.string().default('Match Admin'),
    INHOUSE_CATEGORY: z.string().default('Inhouse'),
    // Persistent lobby voice channel, found by name (created by /setup if missing).
    LOBBY_CHANNEL_NAME: z.string().default('Lobby'),

    // Role granted on /link that gates access to the server (everything but the commands channel).
    LINKED_ROLE_NAME: z.string().default('Linked'),
    // The commands channel: where members run /link AND every other slash command.
    // Normal messages are blocked/auto-deleted there; commands are rejected elsewhere.
    COMMANDS_CHANNEL_NAME: z.string().optional(),
    // Deprecated alias for COMMANDS_CHANNEL_NAME (kept so older .envs keep working).

    // Read-only info channel /setup creates: website link, signup steps, bot commands.
    INFO_CHANNEL_NAME: z.string().default('info'),
    // Public website URL shown in the info channel.
    WEBSITE_URL: z.string().default('https://lolmatchmaker.netlify.app/build'),

    API_BASE_URL: z.url().default('http://localhost:4000/api'),
    BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required (must match the backend)'),
});

const parsed = schema.parse(process.env);

export const config = {
    ...parsed,
    COMMANDS_CHANNEL_NAME: parsed.COMMANDS_CHANNEL_NAME ?? 'commands',
};
