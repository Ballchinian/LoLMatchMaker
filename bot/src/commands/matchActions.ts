import type { Guild } from 'discord.js';
import { apiConfirmMatch, type ApiMatch, type ApiPlayer, type ApiRosterEntry } from '../api';
import {
    createMatchChannels,
    deleteChannels,
    ensureCategory,
    findMatchChannels,
    moveMembers,
} from '../discord/voice';
import { syncMemberRoles } from '../discord/roles';
import { config } from '../config';

/*
    The actual /match actions (setup, split, confirm, cancel, join), separate
    from the command itself: the command decides WHO may run an action (admin,
    auto-confirm, or a vote) and this module is the action.
*/

//Split a team's roster into linked Discord ids vs unlinked display names
export function resolve(entries: ApiRosterEntry[], byId: Map<string, ApiPlayer>) {
    const linked: string[] = [];
    const unlinked: string[] = [];
    for (const e of entries) {
        const p = byId.get(e.player);
        if (p?.discordUserId) linked.push(p.discordUserId);
        else unlinked.push(e.displayName);
    }
    return { linked, unlinked };
}

//Return players to Lobby (if configured) and delete the match's channels
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

//Append a warning to a reply if some channels couldn't be deleted (e.g. missing perms)
function withErrors(base: string, errors: string[]): string {
    if (errors.length === 0) return base;
    return `${base}\n⚠️ Couldn't delete ${errors.length} channel(s): ${errors.join('; ')}`;
}

/*
    Create the match channels and send players straight to their team channels.
    (Use /match join to pull everyone back into Game Comms if something goes wrong.)
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

/*
    Execute a /match subcommand against a (still pending) match and return the
    outcome message. Used directly by admins and by approved non-admin votes,
    so every action validates its own preconditions here.
*/
export async function performAction(
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
        if (!found.teamA || !found.teamB) return '❌ Team channels not found, run `/match setup` first.';
        const movedA = await moveMembers(guild, a.linked, found.teamA.id);
        const movedB = await moveMembers(guild, b.linked, found.teamB.id);
        return `✔️ Split teams: moved ${movedA} to Team A, ${movedB} to Team B.`;
    }

    if (sub === 'confirm') {
        if (winner !== 'A' && winner !== 'B') return '❌ No winner specified.';
        const updated = await apiConfirmMatch(match._id, winner); //applies MMR; match -> confirmed

        //Resync rank roles for participants whose MMR (and maybe rank) just changed.
        for (const p of updated) {
        if (!p.discordUserId) continue;
        const m = await guild.members.fetch(p.discordUserId).catch(() => null);
        if (m) await syncMemberRoles(guild, m, p.rank.tier).catch(() => undefined);
        }

        const { deleted, errors } = await teardown(guild, allLinked, label);
        return withErrors(
        `✔️ Confirmed — Team ${winner} won, MMR updated (rank roles synced). Returned players to Lobby and removed ${deleted} channel(s).`,
        errors,
        );
    }

    if (sub === 'cancel') {
        const { deleted, errors } = await teardown(guild, allLinked, label);
        return withErrors(
        `✔️ Cancelled — returned players to Lobby and removed ${deleted} channel(s). ` +
            'The match is still pending, so you can `/match setup` again.',
        errors,
        );
    }

    if (sub === 'join') {
        const found = findMatchChannels(guild, label);
        if (!found.gameComms) {
        return '❌ Game Comms channel not found, run `/match setup` first.';
        }
        const moved = await moveMembers(guild, allLinked, found.gameComms.id);
        return `✔️ Moved ${moved} player(s) into Game Comms for ${label}.`;
    }

    return '❌ Unknown subcommand.';
}

//Human description of the requested action, for the vote message
export function actionDescription(sub: string, label: string, winner?: 'A' | 'B'): string {
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
