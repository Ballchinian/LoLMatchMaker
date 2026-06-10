import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    SlashCommandBuilder,
    ThreadAutoArchiveDuration,
    type Guild,
} from 'discord.js';
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

/** How long an approval vote stays open. */
const POLL_DURATION_MS = 10 * 60_000;

/** How long a resolved poll (and its match-chat thread) stays visible before self-deleting. */
const POLL_CLEANUP_MS = 10 * 60_000;

/**
 * Votes needed to approve/reject a non-admin request: a strict majority of the
 * voters who can actually vote (the lobby's LINKED players), so one team alone
 * can never force the outcome.
 */
function votesNeededFor(eligibleCount: number): number {
    return Math.floor(eligibleCount / 2) + 1;
}

/** matchId → subcommand currently being voted on. Caps each match to ONE vote at a time. */
const activeVotes = new Map<string, string>();

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

/**
 * Execute a /match subcommand against a (still pending) match and return the
 * outcome message. Used directly by admins and by approved non-admin votes,
 * so every action validates its own preconditions here.
 */
async function performAction(
    guild: Guild,
    sub: string,
    match: ApiMatch,
    players: ApiPlayer[],
    winner?: 'A' | 'B',
): Promise<string> {
    const byId = new Map(players.map((p) => [p.id, p]));
    const a = resolve(match.teamA, byId);
    const b = resolve(match.teamB, byId);
    const allLinked = [...a.linked, ...b.linked];
    const label = match.name ?? `#${match._id.slice(-4)}`;

    if (sub === 'setup') {
        const already = findMatchChannels(guild, label);
        if (already.all.length > 0) {
        return (
            `⚠️ This match is already set up (${already.all.length} channel(s) for ${label}). ` +
            'Run `/match cancel` first if you want to recreate them.'
        );
        }
        return runSetup(guild, label, a.linked, b.linked, [...a.unlinked, ...b.unlinked]);
    }

    if (sub === 'split') {
        const found = findMatchChannels(guild, label);
        if (!found.teamA || !found.teamB) {
        return '❌ Team channels not found — run `/match setup` first.';
        }
        const movedA = await moveMembers(guild, a.linked, found.teamA.id);
        const movedB = await moveMembers(guild, b.linked, found.teamB.id);
        return `✅ Split teams — moved ${movedA} to Team A, ${movedB} to Team B.`;
    }

    if (sub === 'confirm') {
        if (winner !== 'A' && winner !== 'B') return '❌ No winner specified.';
        const updated = await apiConfirmMatch(match._id, winner); // applies MMR; match -> confirmed

        // Re-sync rank roles for participants whose MMR (and maybe rank) just changed.
        for (const p of updated) {
        if (!p.discordUserId) continue;
        const m = await guild.members.fetch(p.discordUserId).catch(() => null);
        if (m) await syncMemberRoles(guild, m, p.rank.tier).catch(() => undefined);
        }

        const { deleted, errors } = await teardown(guild, allLinked, label);
        return withErrors(
        `✅ Confirmed — Team ${winner} won, MMR updated (rank roles synced). Returned players to Lobby and removed ${deleted} channel(s).`,
        errors,
        );
    }

    if (sub === 'cancel') {
        const { deleted, errors } = await teardown(guild, allLinked, label);
        return withErrors(
        `✅ Cancelled — returned players to Lobby and removed ${deleted} channel(s). ` +
            'The match is still pending, so you can `/match setup` again.',
        errors,
        );
    }

    if (sub === 'join') {
        const found = findMatchChannels(guild, label);
        if (!found.gameComms) {
        return '❌ Game Comms channel not found — run `/match setup` first.';
        }
        const moved = await moveMembers(guild, allLinked, found.gameComms.id);
        return `✅ Moved ${moved} player(s) into Game Comms for ${label}.`;
    }

    return '❌ Unknown subcommand.';
}

/** Human description of the requested action, for the vote message. */
function actionDescription(sub: string, label: string, winner?: 'A' | 'B'): string {
    switch (sub) {
        case 'setup':
        return `start **${label}** (create channels & send players to their teams)`;
        case 'split':
        return `split **${label}** back into team channels`;
        case 'join':
        return `bring **${label}** together in Game Comms`;
        case 'confirm':
        return `confirm **Team ${winner}** won **${label}** (applies MMR!)`;
        case 'cancel':
        return `cancel **${label}** (everyone back to Lobby, channels deleted)`;
        default:
        return `run \`${sub}\` on **${label}**`;
    }
}

/** The Approve/Reject button row, with live counts baked into the labels. */
function voteRow(ups: number, downs: number, needed: number, disabled = false) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
        .setCustomId('vote-approve')
        .setLabel(`Approve (${ups}/${needed})`)
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
        new ButtonBuilder()
        .setCustomId('vote-reject')
        .setLabel(`Reject (${downs}/${needed})`)
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
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
        const matchId = interaction.options.getString('match', true);
        const winner =
            sub === 'confirm' ? (interaction.options.getString('winner', true) as 'A' | 'B') : undefined;
        const admin = await isAdmin(interaction);

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
        const label = match.name ?? `#${matchId.slice(-4)}`;

        // Admins act immediately.
        if (admin) {
            await interaction.editReply(await performAction(guild, sub, match, players, winner));
            return;
        }

        /* ---------------- non-admin: every action goes to a vote ---------------- */

        // One vote per match at a time.
        const running = activeVotes.get(matchId);
        if (running) {
            await interaction.editReply(
            `❌ A vote is already running for ${label} (\`/match ${running}\`) — wait for it to finish.`,
            );
            return;
        }

        const channel = interaction.channel;
        if (!channel || !channel.isSendable()) {
            await interaction.editReply('❌ I can\'t post the vote in this channel.');
            return;
        }

        // Only the lobby's LINKED players may vote (we can't identify anyone else).
        const byId = new Map(players.map((p) => [p.id, p]));
        const a = resolve(match.teamA, byId);
        const b = resolve(match.teamB, byId);
        const eligible = new Set([...a.linked, ...b.linked]);
        if (eligible.size === 0) {
            await interaction.editReply(
            '❌ Nobody in this lobby has linked their Discord account, so there\'s no one to vote. Players should run /link.',
            );
            return;
        }
        const votesNeeded = votesNeededFor(eligible.size);
        const desc = actionDescription(sub, label, winner);
        const mentions = [...eligible].map((id) => `<@${id}>`).join(' ');

        const baseContent =
            `🗳️ <@${interaction.user.id}> wants to ${desc}.\n` +
            `${mentions} — vote with the buttons below. ` +
            `**${votesNeeded}** of the lobby's **${eligible.size}** linked player(s) either way decides ` +
            `(expires in ${POLL_DURATION_MS / 60_000} min). Click your vote again to withdraw it.`;

        const poll = await channel.send({
            content: baseContent,
            components: [voteRow(0, 0, votesNeeded)],
        });
        activeVotes.set(matchId, sub);

        // Match chat: the commands channel itself is typing-locked, so give the
        // lobby a thread to discuss the vote. Locked once the vote resolves.
        const thread = await poll
            .startThread({
            name: `🗳️ ${label} — match chat`,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
            })
            .catch(() => null);
        await interaction.editReply(`🗳️ Vote opened for ${label} — ${votesNeeded} ✅ and it happens.`);

        const upVoters = new Set<string>();
        const downVoters = new Set<string>();

        // "Who has voted" footer (participation only — not which way they voted).
        const votedLine = () => {
            const voters = [...upVoters, ...downVoters];
            if (voters.length === 0) return '';
            return `\n\n☑️ Voted (${voters.length}/${eligible.size}): ${voters.map((id) => `<@${id}>`).join(' ')}`;
        };

        const collector = poll.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: POLL_DURATION_MS,
        });

        collector.on('collect', async (btn) => {
            if (!eligible.has(btn.user.id)) {
            await btn
                .reply({
                content: '❌ Only this lobby\'s linked players can vote on this.',
                flags: MessageFlags.Ephemeral,
                })
                .catch(() => undefined);
            return;
            }

            // One vote per player: clicking the other button switches, re-clicking withdraws.
            const side = btn.customId === 'vote-approve' ? 'approve' : 'reject';
            const mine = side === 'approve' ? upVoters : downVoters;
            const other = side === 'approve' ? downVoters : upVoters;
            const switched = other.delete(btn.user.id);
            const withdrew = !switched && mine.has(btn.user.id);
            withdrew ? mine.delete(btn.user.id) : mine.add(btn.user.id);

            await btn
            .update({
                content: baseContent + votedLine(),
                components: [voteRow(upVoters.size, downVoters.size, votesNeeded)],
            })
            .catch(() => undefined);

            // Private receipt so there's no doubt YOUR click registered.
            const receipt = withdrew
            ? '↩️ Your vote was withdrawn.'
            : switched
                ? `🔄 Switched — you now vote to **${side}**.`
                : `☑️ Vote recorded — you voted to **${side}**. Click the same button again to withdraw.`;
            await btn.followUp({ content: receipt, flags: MessageFlags.Ephemeral }).catch(() => undefined);

            if (upVoters.size >= votesNeeded) collector.stop('approved');
            else if (downVoters.size >= votesNeeded) collector.stop('rejected');
        });

        collector.on('end', async (_collected, reason) => {
            activeVotes.delete(matchId);
            const finalRow = voteRow(upVoters.size, downVoters.size, votesNeeded, true);
            try {
            if (reason === 'rejected') {
                await poll.edit({
                content: `❌ Vote failed — the request to ${desc} was rejected.`,
                components: [finalRow],
                });
                return;
            }
            if (reason !== 'approved') {
                await poll.edit({
                content: `⏰ The vote to ${desc} expired without enough votes.`,
                components: [finalRow],
                });
                return;
            }
            // Re-validate: the match may have changed while the vote ran.
            const fresh = (await apiGetMatches()).find((m) => m._id === matchId);
            if (!fresh || fresh.status !== 'pending') {
                await poll.edit({
                content: `⚠️ Vote passed, but **${label}** is no longer pending — nothing to do.`,
                components: [finalRow],
                });
                return;
            }
            const freshPlayers = await apiGetPlayers();
            const summary = await performAction(guild, sub, fresh, freshPlayers, winner);
            await poll.edit({ content: `🗳️ Vote passed!\n${summary}`, components: [finalRow] });
            } catch (err) {
            console.error('[match vote]', err);
            await poll
                .edit({
                content: `❌ Vote passed but the action failed: ${(err as Error).message}`,
                components: [finalRow],
                })
                .catch(() => undefined);
            } finally {
            // Vote is over — freeze the match chat, then clean both up after a
            // grace period so the channel doesn't accumulate dead polls.
            if (thread) {
                await thread.setLocked(true).catch(() => undefined);
                await thread.setArchived(true).catch(() => undefined);
            }
            setTimeout(() => {
                void thread?.delete().catch(() => undefined);
                void poll.delete().catch(() => undefined);
            }, POLL_CLEANUP_MS);
            }
        });
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
