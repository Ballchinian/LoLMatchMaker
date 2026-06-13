import { ActivityType, ChannelType, Client, Events, GatewayIntentBits, MessageFlags, type Guild } from 'discord.js';
import { config } from './config';
import { commandMap } from './commands/index';
import { registerCommandsForGuild, registerCommandsForGuilds } from './discord/registerCommands';
import { sweepOrphanedChannels } from './discord/voice';
import { closeMatchVotes } from './discord/votes';
import {
    apiClaimNextBotCommand,
    apiCompleteBotCommand,
    apiGetMatches,
    apiGetPlayers,
    apiPurgeServer,
    apiStopMatch,
    type ApiMatch,
} from './api';
import { fetchCommandThreads, findCommandsChannel, performAction } from './commands/matchActions';

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

/** Post in the guild's commands channel (best effort). */
async function announce(guild: Guild, content: string): Promise<void> {
    const channel = findCommandsChannel(guild);
    if (!channel) return;
    await channel.send(content).catch(() => undefined);
}

function labelOf(m: ApiMatch): string {
    return m.name ?? `#${m._id.slice(-4)}`;
}

/*
    How often the bot reconciles EVERY guild with the backend: 2h match expiry,
    new-proposal @admin pings, and tearing down channels/threads for matches
    confirmed/cancelled/deleted from the website. Uniform (no warm/cold tiers):
    the expensive per-guild command poll is already a single global request (see
    QUEUE_POLL_INTERVAL_MS), and the reaper deletes dead servers, so sweeping
    everyone each minute is cheap and keeps latency predictable.
*/
const SWEEP_INTERVAL_MS = 60_000;
/** An in-progress game should last about 2 hours; after that it auto-expires. */
const MATCH_MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** How often to claim the next website (Discord tab) command — ONE global request, ~5s latency. */
const QUEUE_POLL_INTERVAL_MS = 5_000;

/*
    New-proposal announcements: remember which matches each guild has already
    been told about. Primed silently on the first sweep so a bot restart
    doesn't re-announce the whole backlog.
*/
const announcedByGuild = new Map<string, Set<string>>();

/** Mention the guild's Match Admin role (falls back to plain text if missing). */
function adminMention(guild: Guild): string {
    const role = guild.roles.cache.find((r) => r.name === config.ADMIN_ROLE_NAME);
    return role ? `<@&${role.id}>` : `**${config.ADMIN_ROLE_NAME}s**`;
}

//Announce proposals this guild hasn't seen yet, @mentioning the Match Admins
async function announceNewMatches(guild: Guild, matches: ApiMatch[]): Promise<void> {
    let known = announcedByGuild.get(guild.id);
    if (!known) {
        //First sweep after boot: prime with everything that already exists
        announcedByGuild.set(guild.id, new Set(matches.map((m) => m._id)));
        return;
    }
    for (const m of matches) {
        if (known.has(m._id)) continue;
        known.add(m._id);
        if (m.status !== 'pending') continue;
        const by = m.reportedBy ? ` by **${m.reportedBy}**` : '';
        await announce(
            guild,
            `📥 ${adminMention(guild)} — new match proposed${by}: **${labelOf(m)}** ` +
                `(${m.teamA.length}v${m.teamB.length}). Start it with \`/match setup\`.`,
        );
    }
    //Drop ids that no longer exist so the set can't grow forever
    const live = new Set(matches.map((m) => m._id));
    for (const id of [...known]) if (!live.has(id)) known.delete(id);
}

//Expire in-progress games older than ~2h: back to proposed (channels/threads
//are then torn down by the same sweep pass, since they're no longer active).
async function expireOverdueMatches(guild: Guild, matches: ApiMatch[]): Promise<void> {
    const now = Date.now();
    for (const m of matches) {
        if (m.status !== 'inProgress') continue;
        const startedAt = m.startedAt ? Date.parse(m.startedAt) : Date.parse(m.createdAt);
        if (!Number.isFinite(startedAt) || now - startedAt < MATCH_MAX_AGE_MS) continue;
        try {
            await apiStopMatch(guild.id, m._id);
            m.status = 'pending';
            closeMatchVotes(m._id, `**${labelOf(m)}** expired after 2 hours.`);
            await announce(
                guild,
                `⏱️ **${labelOf(m)}** has been in progress for over 2 hours — it expired back to **proposed**. ` +
                    `Channels are being cleaned up; \`/match setup\` to play it, \`/match confirm\` if it actually finished, or \`/match delete\` to drop it.`,
            );
        } catch (err) {
            console.error('[sweep] expire failed:', err);
        }
    }
}

//Delete match chat threads whose match is no longer being played
async function sweepOrphanedThreads(guild: Guild, activeLabels: Set<string>): Promise<void> {
    for (const thread of await fetchCommandThreads(guild)) {
        const m = thread.name.match(/^💬 (.+) — match chat$/u);
        if (!m || activeLabels.has(m[1]!)) continue;
        await thread.delete().catch(() => undefined);
    }
}

/*
    Live status under the bot's name ("rich presence"): the game-SDK rich
    presence (party size, join secrets, ...) only exists for desktop apps
    running on a player's machine — a bot instead gets ONE activity line, so
    make it earn its keep by showing the real ladder state across all servers.
    Updated after every sweep; skipped when unchanged (presence is rate limited).
*/
let lastPresence = '';
function updatePresence(inProgress: number, proposed: number): void {
    const state =
        inProgress > 0
            ? `⚔️ ${inProgress} game${inProgress === 1 ? '' : 's'} in progress`
            : proposed > 0
                ? `${proposed} match${proposed === 1 ? '' : 'es'} proposed /match setup`
                : '/link to join the inhouse ladder';
    if (state === lastPresence) return;
    lastPresence = state;
    client.user?.setPresence({
        status: 'online',
        //Custom type shows the text verbatim (no "Playing"/"Watching" prefix)
        activities: [{ type: ActivityType.Custom, name: 'status', state }],
    });
}

/**
 * The webpage can cancel/confirm/delete a match the bot set channels up for,
 * and the bot never hears about it — so periodically reconcile, per guild:
 * expire 2h-old games, announce new proposals to the admins, and tear down
 * channels/threads whose match is no longer in progress.
 */
async function sweepAllGuilds(): Promise<void> {
    let totalInProgress = 0;
    let totalProposed = 0;
    for (const guild of client.guilds.cache.values()) {
        let matches: ApiMatch[];
        try {
            matches = await apiGetMatches(guild.id);
        } catch {
            continue; // API unreachable — don't tear anything down on bad data
        }
        try {
            await expireOverdueMatches(guild, matches);
            await announceNewMatches(guild, matches);

            //Channels/threads belong to games being PLAYED: anything else is an orphan
            const active = new Set(matches.filter((m) => m.status === 'inProgress').map(labelOf));
            await sweepOrphanedThreads(guild, active);
            const removed = await sweepOrphanedChannels(guild, active);
            if (removed > 0) {
                console.log(`[sweep] removed ${removed} channel(s) for non-active matches in ${guild.name}`);
            }
            totalInProgress += active.size;
            totalProposed += matches.filter((m) => m.status === 'pending').length;
        } catch (err) {
            console.error('[sweep]', err);
        }
    }
    updatePresence(totalInProgress, totalProposed);
}

/*
    Website Discord tab: admins queue match actions on the backend. The bot
    claims the next one across ALL its guilds in a single request (so polling is
    cheap no matter how many servers it's in) and executes it. The outcome goes
    back to the website's command log only — we deliberately DON'T post it in the
    Discord channel (that was noise the lobby didn't ask for).
*/
let queueBusy = false;
async function pollCommandQueue(): Promise<void> {
    if (queueBusy) return;
    queueBusy = true;
    try {
        const cmd = await apiClaimNextBotCommand().catch(() => null);
        if (!cmd || !cmd.guildId) return;
        const guild = client.guilds.cache.get(cmd.guildId);

        let ok = false;
        let result: string;
        try {
            if (!guild) {
                result = '❌ The bot is no longer in that server.';
            } else {
                const matches = await apiGetMatches(guild.id);
                const match = matches.find((m) => m._id === cmd.match);
                if (!match) {
                    result = `❌ Match ${cmd.matchLabel} no longer exists.`;
                } else {
                    const players = await apiGetPlayers(guild.id);
                    if (cmd.action === 'confirm' || cmd.action === 'delete') {
                        closeMatchVotes(match._id, `Vote closed, an admin ran ${cmd.action} from the website.`);
                    }
                    result = await performAction(guild, cmd.action, match, players, cmd.winner);
                    ok = !result.startsWith('❌');
                }
            }
        } catch (err) {
            result = `❌ ${(err as Error).message}`;
        }
        await apiCompleteBotCommand(cmd.guildId, cmd._id, ok, result).catch(() => undefined);
    } finally {
        queueBusy = false;
    }
}

client.once(Events.ClientReady, async (c) => {
    console.log(`[bot] logged in as ${c.user.tag}`);
    try {
        const guildIds = [...c.guilds.cache.keys()];
        const n = await registerCommandsForGuilds(guildIds);
        console.log(`[bot] registered ${n} slash command(s) across ${guildIds.length} guild(s)`);
    } catch (err) {
        console.error('[bot] command registration failed:', err);
    }
    //Idle status until the first sweep reports real numbers
    updatePresence(0, 0);
    //Run a sweep right away (primes announcements + sets an accurate presence)
    void sweepAllGuilds();
    setInterval(sweepAllGuilds, SWEEP_INTERVAL_MS);
    setInterval(() => void pollCommandQueue(), QUEUE_POLL_INTERVAL_MS);
});

//Invited to a new server: make the slash commands available right away
client.on(Events.GuildCreate, async (guild) => {
    try {
        await registerCommandsForGuild(guild.id);
        console.log(`[bot] joined ${guild.name}, commands registered — an admin should run /setup password:<...>`);
    } catch (err) {
        console.error(`[bot] command registration failed for new guild ${guild.name}:`, err);
    }
});

//Kicked / guild deleted: purge that server's data so dead servers don't linger
client.on(Events.GuildDelete, async (guild) => {
    announcedByGuild.delete(guild.id);
    try {
        await apiPurgeServer(guild.id);
        console.log(`[bot] left ${guild.name ?? guild.id}, purged its data`);
    } catch (err) {
        console.error(`[bot] purge failed for ${guild.id}:`, (err as Error).message);
    }
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
