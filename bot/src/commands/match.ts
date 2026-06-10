import { MessageFlags, SlashCommandBuilder, type Guild } from 'discord.js';
import type { Command } from './types';
import {
    apiConfirmMatch,
    apiGetMatches,
    apiGetPlayers,
    type ApiMatch,
    type ApiPlayer,
    type ApiRosterEntry,
} from '../api';
import { isAdmin } from '../discord/guards';
import {
    createMatchChannels,
    deleteChannels,
    ensureCategory,
    findMatchChannels,
    moveMembers,
} from '../discord/voice';
import { syncMemberRoles } from '../discord/roles';
import { config } from '../config';

/** How long a setup vote stays open. */
const POLL_DURATION_MS = 10 * 60_000;

/**
 * Votes needed to approve/reject a non-admin setup request: a strict majority
 * of the lobby (half + 1), so one team alone can never force the outcome.
 */
function votesNeededFor(lobbySize: number): number {
    return Math.floor(lobbySize / 2) + 1;
}

/** Split a team's roster into linked Discord ids vs unlinked display names. */
function resolve(entries: ApiRosterEntry[], byId: Map<string, ApiPlayer>) {
    const linked: string[] = [];
    const unlinked: string[] = [];
    for (const e of entries) {
        const p = byId.get(e.player);
        if (p?.discordUserId) linked.push(p.discordUserId);
        else unlinked.push(e.displayName);
    }
    return { linked, unlinked };
}

/** Return players to Lobby (if configured) and delete the match's channels. */
async function teardown(guild: Guild, memberIds: string[], label: string) {
    if (config.LOBBY_CHANNEL_ID) {
        await moveMembers(guild, memberIds, config.LOBBY_CHANNEL_ID);
    }
    const found = findMatchChannels(guild, label);
    return deleteChannels(
        guild,
        found.all.map((c) => c.id),
    );
}

/** Append a warning to a reply if some channels couldn't be deleted (e.g. missing perms). */
function withErrors(base: string, errors: string[]): string {
    if (errors.length === 0) return base;
    return `${base}\n⚠️ Couldn't delete ${errors.length} channel(s): ${errors.join('; ')}`;
}

/**
 * Create the match channels and send players straight to their team channels.
 * (Use /match join to pull everyone back into Game Comms if something goes wrong.)
 */
async function runSetup(
    guild: Guild,
    label: string,
    aLinked: string[],
    bLinked: string[],
    unlinked: string[],
): Promise<string> {
    const category = await ensureCategory(guild);
    const channels = await createMatchChannels(
        guild,
        category,
        label,
        [...aLinked, ...bLinked],
        aLinked,
        bLinked,
    );
    const movedA = await moveMembers(guild, aLinked, channels.teamAId);
    const movedB = await moveMembers(guild, bLinked, channels.teamBId);
    return (
        `✅ Created channels for ${label}. Moved ${movedA} player(s) to Team A and ${movedB} to Team B.` +
        '\nUse `/match join` to bring everyone into Game Comms, or `/match split` to re-send them to their teams.' +
        (unlinked.length
        ? `\n⚠️ Not linked (couldn't add/move): ${unlinked.join(', ')} — they should run /link.`
        : '')
    );
}

export const match: Command = {
    data: new SlashCommandBuilder()
        .setName('match')
        .setDescription('Run inhouse voice channels for a pending match')
        .addSubcommand((s) =>
        s
            .setName('setup')
            .setDescription('Create the channels and send players straight to their team channels')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) =>
        s
            .setName('split')
            .setDescription('Move players (back) into their team channels')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((s) =>
        s
            .setName('confirm')
            .setDescription('Confirm the winner (applies MMR), return players to Lobby, delete channels')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            )
            .addStringOption((o) =>
            o
                .setName('winner')
                .setDescription('Winning team')
                .setRequired(true)
                .addChoices({ name: 'Team A', value: 'A' }, { name: 'Team B', value: 'B' }),
            ),
        )
        .addSubcommand((s) =>
        s
            .setName('cancel')
            .setDescription('Abort: return players to Lobby and delete channels (match stays pending)')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            )
        )
        .addSubcommand((s) =>
        s
            .setName('join')
            .setDescription('Bring everyone back into the shared Game Comms channel')
            .addStringOption((o) =>
                o.setName('match').setDescription('Pending match').setRequired(true).setAutocomplete(true),
            ),
        ),

    async execute(interaction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({ content: '❌ Use this in a server.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Acknowledge FIRST — Discord only gives us ~3s, and everything below
        // (member fetch, API calls against a possibly cold backend) can be slow.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const sub = interaction.options.getSubcommand();
        const admin = await isAdmin(interaction);

        // Non-admins can only REQUEST a setup (it goes to a vote); everything else is admin-only.
        if (!admin && sub !== 'setup') {
            await interaction.editReply('❌ Admins only. (Non-admins can request `/match setup`, which opens a vote.)');
            return;
        }

        const matchId = interaction.options.getString('match', true);

        const matches = await apiGetMatches();
        const match = matches.find((m) => m._id === matchId);
        if (!match) {
            await interaction.editReply('❌ Match not found.');
            return;
        }

        // Every /match action operates on a PENDING game only.
        if (match.status !== 'pending') {
        await interaction.editReply(
            `❌ That match is **${match.status}** — only pending matches can be managed.`,
        );
        return;
        }

        const players = await apiGetPlayers();
        const byId = new Map(players.map((p) => [p.id, p]));
        const a = resolve(match.teamA, byId);
        const b = resolve(match.teamB, byId);
        const allLinked = [...a.linked, ...b.linked];
        const label = match.name ?? `#${matchId.slice(-4)}`;

        if (sub === 'setup') {
        const already = findMatchChannels(guild, label);
        if (already.all.length > 0) {
            await interaction.editReply(
            `⚠️ This match is already set up (${already.all.length} channel(s) for ${label}). ` +
                'Run `/match cancel` first if you want to recreate them.',
            );
            return;
        }

        if (admin) {
            await interaction.editReply(await runSetup(guild, label, a.linked, b.linked, [...a.unlinked, ...b.unlinked]));
            return;
        }

        // Non-admin: open a public 👍/👎 vote decided by a lobby majority.
        const channel = interaction.channel;
        if (!channel || !channel.isSendable()) {
            await interaction.editReply('❌ I can\'t post the vote in this channel.');
            return;
        }
        const votesNeeded = votesNeededFor(match.teamA.length + match.teamB.length);
        const poll = await channel.send(
            `🗳️ <@${interaction.user.id}> wants to start match **${label}**.\n` +
            `React 👍 to open it or 👎 to reject — ${votesNeeded} votes (lobby majority) either way decides ` +
            `(expires in ${POLL_DURATION_MS / 60_000} min). Only the lobby's linked players may vote.`,
        );
        await poll.react('👍');
        await poll.react('👎');
        await interaction.editReply(`🗳️ Vote opened for ${label} — ${votesNeeded} 👍 and the match starts.`);

        // Only the lobby's (linked) players may vote, one vote each. We track
        // votes ourselves instead of trusting reaction.count, removing both
        // outsider reactions and a voter's old reaction when they switch sides.
        const eligible = new Set(allLinked);
        const upVoters = new Set<string>();
        const downVoters = new Set<string>();

        const collector = poll.createReactionCollector({
            filter: (reaction, user) => !user.bot && ['👍', '👎'].includes(reaction.emoji.name ?? ''),
            time: POLL_DURATION_MS,
            dispose: true, // emit 'remove' when someone retracts a reaction
        });

        collector.on('collect', async (reaction, user) => {
            if (!eligible.has(user.id)) {
            // Not in this lobby — doesn't count; scrub the reaction (needs Manage Messages).
            await reaction.users.remove(user.id).catch(() => undefined);
            return;
            }
            if (reaction.emoji.name === '👍') {
            upVoters.add(user.id);
            if (downVoters.delete(user.id)) {
                await poll.reactions.cache.get('👎')?.users.remove(user.id).catch(() => undefined);
            }
            } else {
            downVoters.add(user.id);
            if (upVoters.delete(user.id)) {
                await poll.reactions.cache.get('👍')?.users.remove(user.id).catch(() => undefined);
            }
            }
            if (upVoters.size >= votesNeeded) collector.stop('approved');
            else if (downVoters.size >= votesNeeded) collector.stop('rejected');
        });

        // Retracting a reaction withdraws the vote.
        collector.on('remove', (reaction, user) => {
            if (reaction.emoji.name === '👍') upVoters.delete(user.id);
            else downVoters.delete(user.id);
        });

        collector.on('end', async (_collected, reason) => {
            try {
            if (reason === 'rejected') {
                await poll.edit(`❌ Vote failed — **${label}** was rejected (${votesNeeded} 👎).`);
                return;
            }
            if (reason !== 'approved') {
                await poll.edit(`⏰ Vote for **${label}** expired without enough votes.`);
                return;
            }
            // Re-validate: the match may have been confirmed/cancelled or set up while the vote ran.
            const fresh = (await apiGetMatches()).find((m) => m._id === matchId);
            if (!fresh || fresh.status !== 'pending') {
                await poll.edit(`⚠️ Vote passed, but **${label}** is no longer pending — nothing to set up.`);
                return;
            }
            if (findMatchChannels(guild, label).all.length > 0) {
                await poll.edit(`⚠️ Vote passed, but **${label}** is already set up.`);
                return;
            }
            const freshPlayers = await apiGetPlayers();
            const freshById = new Map(freshPlayers.map((p) => [p.id, p]));
            const fa = resolve(fresh.teamA, freshById);
            const fb = resolve(fresh.teamB, freshById);
            const summary = await runSetup(guild, label, fa.linked, fb.linked, [...fa.unlinked, ...fb.unlinked]);
            await poll.edit(`🗳️ Vote passed!\n${summary}`);
            } catch (err) {
            console.error('[match vote]', err);
            await poll.edit(`❌ Vote passed but setup failed: ${(err as Error).message}`).catch(() => undefined);
            }
        });
        return;
        }

        if (sub === 'split') {
        const found = findMatchChannels(guild, label);
        if (!found.teamA || !found.teamB) {
            await interaction.editReply('❌ Team channels not found — run `/match setup` first.');
            return;
        }
        const movedA = await moveMembers(guild, a.linked, found.teamA.id);
        const movedB = await moveMembers(guild, b.linked, found.teamB.id);
        await interaction.editReply(`✅ Split teams — moved ${movedA} to Team A, ${movedB} to Team B.`);
        return;
        }

        if (sub === 'confirm') {
        const winner = interaction.options.getString('winner', true) as 'A' | 'B';
        const updated = await apiConfirmMatch(matchId, winner); // applies MMR; match -> confirmed

        // Re-sync rank roles for participants whose MMR (and maybe rank) just changed.
        for (const p of updated) {
            if (!p.discordUserId) continue;
            const m = await guild.members.fetch(p.discordUserId).catch(() => null);
            if (m) await syncMemberRoles(guild, m, p.rank.tier).catch(() => undefined);
        }

        const { deleted, errors } = await teardown(guild, allLinked, label);
        await interaction.editReply(
            withErrors(
            `✅ Confirmed — Team ${winner} won, MMR updated (rank roles synced). Returned players to Lobby and removed ${deleted} channel(s).`,
            errors,
            ),
        );
        return;
        }

        if (sub === 'cancel') {
        const { deleted, errors } = await teardown(guild, allLinked, label);
        await interaction.editReply(
            withErrors(
            `✅ Cancelled — returned players to Lobby and removed ${deleted} channel(s). ` +
                'The match is still pending, so you can `/match setup` again.',
            errors,
            ),
        );
        return;
        }

        if (sub === 'join') {
        const found = findMatchChannels(guild, label);
        if (!found.gameComms) {
            await interaction.editReply('❌ Game Comms channel not found — run `/match setup` first.');
            return;
        }
        const moved = await moveMembers(guild, allLinked, found.gameComms.id);
        await interaction.editReply(`✅ Moved ${moved} player(s) into Game Comms for ${label}.`);
        return;
        }

        await interaction.editReply('❌ Unknown subcommand.');
    },

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        // Tight budget: autocomplete must answer within ~3s or the token dies.
        const matches = await apiGetMatches(2_000).catch(() => [] as ApiMatch[]);
        // Only pending games are manageable, so only those appear in the picker.
        // Lobby name + team sizes only — no player names.
        const choices = matches
        .filter((m) => m.status === 'pending')
        .map((m) => {
            const label = m.name ?? `#${m._id.slice(-4)}`;
            return { name: `${label} (${m.teamA.length}v${m.teamB.length})`.slice(0, 100), value: m._id };
        })
        .filter((c) => c.name.toLowerCase().includes(focused))
        .slice(0, 25);
        await interaction.respond(choices);
    },
};
