import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
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
        // Needed for the /match setup approval polls (👍/👎 reaction counting).
        GatewayIntentBits.GuildMessageReactions,
    ],
});

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

client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
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
