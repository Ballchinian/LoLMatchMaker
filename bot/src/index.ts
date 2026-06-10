import { ChannelType, Client, Events, GatewayIntentBits, MessageFlags, type Guild } from 'discord.js';
import { config } from './config';
import { commandMap } from './commands/index';
import { registerGuildCommands } from './discord/registerCommands';
import { sweepOrphanedChannels } from './discord/voice';
import { apiGetMatches } from './api';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        // Needed to auto-delete normal messages in the commands channel.
        GatewayIntentBits.GuildMessages,
    ],
});

/** The commands channel, if it exists. Commands only work there; chat doesn't. */
function commandsChannelId(guild: Guild | null): string | null {
    if (!guild) return null;
    const ch = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === config.COMMANDS_CHANNEL_NAME,
    );
    return ch?.id ?? null;
}

/** How often to check for channels whose match was cancelled/confirmed via the webpage. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * The webpage can cancel/confirm/delete a match the bot set channels up for,
 * and the bot never hears about it — so periodically reconcile: any inhouse
 * channel whose match is no longer pending gets its members sent back to
 * Lobby and is deleted.
 */
async function sweepAllGuilds(): Promise<void> {
    let pending: Set<string>;
    try {
        const matches = await apiGetMatches();
        pending = new Set(
        matches.filter((m) => m.status === 'pending').map((m) => m.name ?? `#${m._id.slice(-4)}`),
        );
    } catch {
        return; // API unreachable — don't tear anything down on bad data
    }
    for (const guild of client.guilds.cache.values()) {
        try {
        const removed = await sweepOrphanedChannels(guild, pending);
        if (removed > 0) {
            console.log(`[sweep] removed ${removed} channel(s) for non-pending matches in ${guild.name}`);
        }
        } catch (err) {
        console.error('[sweep]', err);
        }
    }
}

client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] logged in as ${c.user.tag}`);
    try {
        const n = await registerGuildCommands();
        console.log(`[bot] registered ${n} slash command(s)`);
    } catch (err) {
        console.error('[bot] command registration failed:', err);
    }
    setInterval(sweepAllGuilds, SWEEP_INTERVAL_MS);
});

/**
 * Discord error 10062 "Unknown interaction": the 3-second ack window expired
 * (slow/cold API, or another bot instance with this token already answered).
 * There is nothing left to reply to, so don't try — just note it briefly.
 */
function isUnknownInteraction(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 10062;
}

// Keep the commands channel command-only: anything that isn't from this bot
// (chatter, stray bot messages) is removed so votes/notices never get buried.
client.on(Events.MessageCreate, async (message) => {
    if (!message.inGuild() || message.author.id === client.user?.id) return;
    if (message.channelId !== commandsChannelId(message.guild)) return;
    await message.delete().catch(() => undefined);
});

client.on(Events.InteractionCreate, async (interaction) => {
    // All commands live in the commands channel (until /setup creates it, anywhere goes).
    const required = commandsChannelId(interaction.guild);
    const wrongChannel = required !== null && interaction.channelId !== required;

    if (interaction.isAutocomplete()) {
        if (wrongChannel) {
        await interaction.respond([]).catch(() => undefined);
        return;
        }
        const cmd = commandMap.get(interaction.commandName);
        if (cmd?.autocomplete) {
        try {
            await cmd.autocomplete(interaction);
        } catch (err) {
            if (isUnknownInteraction(err)) {
                console.warn('[autocomplete] interaction expired before we could respond (slow API or duplicate bot instance)');
            } else {
                console.error('[autocomplete]', err);
            }
        }
        }
        return;
    }

    if (interaction.isChatInputCommand()) {
        if (wrongChannel) {
        await interaction
            .reply({ content: `❌ Commands only work in <#${required}>.`, flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
        return;
        }
        const cmd = commandMap.get(interaction.commandName);
        if (!cmd) return;
        try {
        await cmd.execute(interaction);
        } catch (err) {
        if (isUnknownInteraction(err)) {
            console.warn('[command] interaction expired before we could respond (slow API or duplicate bot instance)');
            return;
        }
        console.error('[command]', err);
        const content = `❌ ${(err as Error).message}`;
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(content).catch(() => undefined);
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
        }
        }
    }
});

client.login(config.DISCORD_TOKEN);
