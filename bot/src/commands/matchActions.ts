import { ChannelType, ThreadAutoArchiveDuration, type Guild, type TextChannel } from 'discord.js';
import {
    apiConfirmMatch,
    apiDeleteMatch,
    apiGetMatches,
    apiStartMatch,
    apiStopMatch,
    type ApiMatch,
    type ApiPlayer,
    type ApiRosterEntry,
} from '../api';
import {
    createMatchChannels,
    deleteChannels,
    ensureCategory,
    ensureLobbyChannel,
    findMatchChannels,
    moveMembers,
} from '../discord/voice';
import { syncMemberRoles } from '../discord/roles';
import { config } from '../config';

/*
    The actual /match actions (setup, split, confirm, cancel, join, delete),
    separate from the command itself: the command decides WHO may run an action
    (admin, auto-confirm, or a vote) and this module is the action.
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

//Name of a match's persistent chat thread (lives while the match is in progress)
export function matchThreadName(label: string): string {
    return `💬 ${label}: match chat`;
}

//Find the commands channel (where votes/threads live), if /setup created it
export function findCommandsChannel(guild: Guild): TextChannel | null {
    return (
        guild.channels.cache.find(
            (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === config.COMMANDS_CHANNEL_NAME,
        ) ?? null
    );
}

/*
    Make sure an in-progress match has its chat thread in the commands channel
    (vote-started matches reuse the vote's discussion thread; admin/website
    started ones get a fresh one). Best effort.
*/
//Active threads in the commands channel (fetched, so it survives bot restarts)
export async function fetchCommandThreads(guild: Guild) {
    const channel = findCommandsChannel(guild);
    if (!channel) return [];
    const active = await channel.threads.fetchActive().catch(() => null);
    return active ? [...active.threads.values()] : [...channel.threads.cache.values()];
}

async function ensureMatchThread(guild: Guild, label: string): Promise<void> {
    const channel = findCommandsChannel(guild);
    if (!channel) return;
    const name = matchThreadName(label);
    const threads = await fetchCommandThreads(guild);
    if (threads.some((t) => t.name === name)) return;
    await channel.threads
        .create({
            name,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
            reason: 'Match Maker: in-progress match chat',
        })
        .catch(() => undefined);
}

//Delete the match's chat thread (the match stopped being in progress)
export async function deleteMatchThread(guild: Guild, label: string): Promise<void> {
    const name = matchThreadName(label);
    const threads = (await fetchCommandThreads(guild)).filter((t) => t.name === name);
    for (const t of threads) await t.delete().catch(() => undefined);
}

/*
    Return players to Lobby and delete the match's channels + chat thread.
    Moves the match's linked players PLUS anyone actually sitting in the match
    channels (spectating admins would otherwise be disconnected when the
    channels die). Recreates a missing Lobby rather than silently skipping the
    move, and reports the real moved count so failures aren't invisible.
*/
async function teardown(guild: Guild, memberIds: string[], label: string) {
    const found = findMatchChannels(guild, label);
    //No channels (never set up, or already gone): nobody to move, nothing to delete.
    if (found.all.length === 0) {
        await deleteMatchThread(guild, label);
        console.log(`[teardown] ${label} in ${guild.name}: no match channels found`);
        return { deleted: 0, errors: [] as string[], moved: 0 };
    }
    const ids = new Set(memberIds);
    for (const ch of found.all) for (const id of ch.members.keys()) ids.add(id);

    let moved = 0;
    const lobby = await ensureLobbyChannel(guild).catch((err) => {
        console.warn(`[teardown] ${label}: no Lobby and couldn't create one:`, err instanceof Error ? err.message : err);
        return null;
    });
    if (lobby) {
        moved = await moveMembers(guild, [...ids], lobby.id);
    }
    await deleteMatchThread(guild, label);
    const del = await deleteChannels(
        guild,
        found.all.map((c) => c.id),
    );
    console.log(`[teardown] ${label} in ${guild.name}: moved ${moved} member(s) to Lobby, deleted ${del.deleted}/${found.all.length} channel(s)`);
    return { ...del, moved };
}

//Website-side confirm/cancel/delete cleanup: teardown by label + return the outcome message.
//Works from the label snapshot alone, so it survives the match being deleted.
export async function runCleanup(guild: Guild, label: string, memberIds: string[]): Promise<string> {
    const { moved, deleted, errors } = await teardown(guild, memberIds, label);
    return withErrors(`✔️ Cleaned up **${label}**: returned ${moved} member(s) to Lobby, removed ${deleted} channel(s).`, errors);
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
    await ensureMatchThread(guild, label);
    return (
        `✔️ Created channels for ${label}. Moved ${movedA} player(s) to Team A and ${movedB} to Team B.` +
        '\nUse `/match join` to bring everyone into Game Comms, or `/match split` to resend them to their teams.' +
        '\n⏱️ In-progress games auto-expire after ~2 hours (back to proposed, channels removed).' +
        (unlinked.length
            ? `\n⚠️ Not linked (couldn't add/move): ${unlinked.join(', ')}. They should run /link.`
            : '')
    );
}

/*
    Execute a /match subcommand against a match and return the outcome message.
    Used directly by admins, by approved non-admin votes and by the website's
    Discord tab, so every action validates its own preconditions here.
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
        if (match.status !== 'pending') {
        return `⚠️ ${label} is **${match.status}**. Only a proposed match can be set up.`;
        }
        const already = findMatchChannels(guild, label);
        if (already.all.length > 0) {
        return (
            `⚠️ This match is already set up (${already.all.length} channel(s) for ${label}). ` +
            'Run `/match cancel` first if you want to recreate them.'
        );
        }
        /*
            Start FIRST: the backend enforces one active game per player, so a
            blocked start must not leave channels behind. Channels only get
            created once the match is officially in progress.
        */
        try {
            await apiStartMatch(guild.id, match._id);
        } catch (err) {
            return `❌ Couldn't start ${label}: ${(err as Error).message}`;
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
        let updated: ApiPlayer[];
        try {
            updated = await apiConfirmMatch(guild.id, match._id, winner); //applies MMR; match -> confirmed
        } catch (err) {
            /*
                The API may have confirmed the match even though this call failed
                (timeout mid-request, or it was already confirmed from the website).
                Bailing here used to strand the channels until the sweep, so refetch:
                if the match IS confirmed, keep going and tear down anyway.
            */
            const fresh = (await apiGetMatches(guild.id).catch(() => [] as ApiMatch[])).find((m) => m._id === match._id);
            if (fresh?.status !== 'confirmed') {
                console.warn(`[confirm] ${label} in ${guild.name}: confirm failed, match not confirmed:`, (err as Error).message);
                return `❌ Couldn't confirm ${label}: ${(err as Error).message}`;
            }
            console.warn(`[confirm] ${label} in ${guild.name}: confirm call failed but the match IS confirmed; tearing down anyway:`, (err as Error).message);
            updated = [];
        }

        //Resync rank roles for participants whose MMR (and maybe rank) just changed.
        for (const p of updated) {
        if (!p.discordUserId) continue;
        const m = await guild.members.fetch(p.discordUserId).catch(() => null);
        if (m) await syncMemberRoles(guild, m, p.rank.tier).catch(() => undefined);
        }

        const { moved, deleted, errors } = await teardown(guild, allLinked, label);
        return withErrors(
        `✔️ Confirmed. Team ${winner} won, MMR updated (rank roles synced). Returned ${moved} player(s) to Lobby and removed ${deleted} channel(s).`,
        errors,
        );
    }

    if (sub === 'cleanup') {
        //Server-enqueued after a website-side confirm/cancel/delete of an active game.
        return runCleanup(guild, label, allLinked);
    }

    if (sub === 'cancel') {
        if (match.status !== 'inProgress') {
        return `⚠️ ${label} is **${match.status}**. Only an in-progress game can be cancelled (use \`/match delete\` to remove a proposal).`;
        }
        const { moved, deleted, errors } = await teardown(guild, allLinked, label);
        //Back to pending: the match can be reviewed, restarted, or deleted later
        await apiStopMatch(guild.id, match._id).catch(() => undefined);
        return withErrors(
        `✔️ Cancelled. Returned ${moved} player(s) to Lobby and removed ${deleted} channel(s). ` +
            'The match is back to **proposed**, so it can be set up again or deleted.',
        errors,
        );
    }

    if (sub === 'delete') {
        const wasInProgress = match.status === 'inProgress';
        try {
            await apiDeleteMatch(guild.id, match._id);
        } catch (err) {
            return `❌ Couldn't delete ${label}: ${(err as Error).message}`;
        }
        const { moved, deleted, errors } = await teardown(guild, allLinked, label);
        return withErrors(
            wasInProgress
                ? `🗑️ Deleted **${label}** mid-game. The match is voided (no MMR was applied), ${moved} player(s) returned to Lobby, ${deleted} channel(s) removed.`
                : `🗑️ Deleted the proposal **${label}**.`,
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
        return `cancel **${label}** (back to proposed, everyone to Lobby, channels deleted)`;
        case 'delete':
        return `delete **${label}** entirely`;
        default:
        return `run \`${sub}\` on **${label}**`;
    }
}
