import axios from 'axios';
import type {
    Actor,
    BalanceResult,
    BotCommandRecord,
    ChampPool,
    HealthInfo,
    MatchRecord,
    Player,
    ResetView,
    SearchResult,
    Tier,
    Division,
} from './types';

/** localStorage key holding the admin/bot token (if the user has unlocked). */
export const TOKEN_KEY = 'lmm_token';
/** localStorage key holding the Discord server key (which server's data we browse). */
export const SERVER_KEY = 'lmm_server_key';
/** localStorage key holding the map of matchId -> proposal token ("my" proposals). */
export const PROPOSALS_KEY = 'lmm_proposals';

// In dev, '/api' is proxied to the backend by Vite. In production set VITE_API_BASE_URL
// to your backend's API base (e.g. https://your-app.up.railway.app/api), OR leave it unset
// and proxy /api via Netlify (see netlify.toml).
export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api' });

// Attach the stored token + server scope to every request; harmless on public endpoints.
api.interceptors.request.use((config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    const serverKey = localStorage.getItem(SERVER_KEY);
    if (serverKey) config.headers['X-Server-Key'] = serverKey;
    return config;
});

/* ----------------------- "my proposals" registry ------------------------ */

function readProposals(): Record<string, string> {
    try {
        return JSON.parse(localStorage.getItem(PROPOSALS_KEY) ?? '{}') as Record<string, string>;
    } catch {
        return {};
    }
}

/** Remember the secret that lets this browser delete its own proposal. */
export function rememberProposal(matchId: string, token: string): void {
    const all = readProposals();
    all[matchId] = token;
    localStorage.setItem(PROPOSALS_KEY, JSON.stringify(all));
}

export function getProposalToken(matchId: string): string | null {
    return readProposals()[matchId] ?? null;
}

export function forgetProposal(matchId: string): void {
    const all = readProposals();
    delete all[matchId];
    localStorage.setItem(PROPOSALS_KEY, JSON.stringify(all));
}

/** Pull a human-readable message out of an axios error. */
export function apiErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
        return (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
    }
    return err instanceof Error ? err.message : 'Unexpected error';
}

/* ------------------------------ players -------------------------------- */

export async function getHealth(): Promise<HealthInfo> {
    const { data } = await api.get<HealthInfo>('/health');
    return data;
}

export async function getPlayers(): Promise<Player[]> {
    const { data } = await api.get<{ players: Player[] }>('/players');
    return data.players;
}

export async function searchPlayer(gameName: string, tagLine: string): Promise<SearchResult> {
    const { data } = await api.post<SearchResult>('/players/search', { gameName, tagLine });
    return data;
}

export async function injectRiotPlayer(
    gameName: string,
    tagLine: string,
    tags?: string[],
): Promise<Player> {
    const { data } = await api.post<{ player: Player }>('/players', {
        source: 'riot',
        gameName,
        tagLine,
        tags,
    });
    return data.player;
}

export interface ManualPlayerInput {
    displayName: string;
    region?: string;
    rank?: { tier: Tier; division?: Division; leaguePoints?: number };
    mmr?: number;
    tags?: string[];
}

export async function injectManualPlayer(input: ManualPlayerInput): Promise<Player> {
    const { data } = await api.post<{ player: Player }>('/players', {
        source: 'manual',
        ...input,
    });
    return data.player;
}

export async function updatePlayerTags(id: string, tags: string[]): Promise<Player> {
    const { data } = await api.patch<{ player: Player }>(`/players/${id}/tags`, { tags });
    return data.player;
}

/** Admin: clear a player's Discord link (e.g. they linked the wrong account). */
export async function unlinkPlayerDiscord(id: string): Promise<Player> {
    const { data } = await api.patch<{ player: Player }>(`/players/${id}/discord`, {
        discordUserId: null,
    });
    return data.player;
}

/** Admin: set a player's champion-pool depth (the versatility MMR modifier). */
export async function updatePlayerChampPool(id: string, champPool: ChampPool): Promise<Player> {
    const { data } = await api.patch<{ player: Player }>(`/players/${id}/roles`, { champPool });
    return data.player;
}

/** Admin: permanently delete a player (website only; blocked if they're in an open match). */
export async function deletePlayer(id: string): Promise<void> {
    await api.delete(`/players/${id}`);
}

/** Admin override of a player's seed and/or current MMR. */
export async function updatePlayerMmr(
    id: string,
    input: { seedMMR?: number; mmr?: number },
): Promise<Player> {
    const { data } = await api.patch<{ player: Player }>(`/players/${id}/mmr`, input);
    return data.player;
}

/* ------------------------------- teams --------------------------------- */

export interface BalanceInput {
    playerIds: string[];
    teamSize?: number;
    constraints?: {
        sameTeam?: [string, string][];
        oppositeTeam?: [string, string][];
    };
    excludeKeys?: string[];
    maxResults?: number;
}

export async function balanceTeams(input: BalanceInput): Promise<BalanceResult> {
    const { data } = await api.post<BalanceResult>('/teams/balance', input);
    return data;
}

/* ------------------------------ matches -------------------------------- */

export async function getMatches(): Promise<MatchRecord[]> {
    const { data } = await api.get<{ matches: MatchRecord[] }>('/matches');
  return data.matches;
}

/**
 * Create a matchup.
 * - admin/bot with `winner` → confirmed immediately
 * - admin/bot without `winner` → pending
 * - public → always pending; must say which roster player they are
 *   (`proposedByPlayerId`, one open proposal each); the returned
 *   `proposalToken` lets this browser delete its own proposal later
 */
export async function createMatch(input: {
    teamA: string[];
    teamB: string[];
    winner?: 'A' | 'B';
    proposedWinner?: 'A' | 'B';
    reportedBy?: string;
    proposedByPlayerId?: string;
}): Promise<{ match: MatchRecord; players: Player[]; proposalToken?: string }> {
    const { data } = await api.post<{ match: MatchRecord; players: Player[]; proposalToken?: string }>(
        '/matches',
        input,
    );
    if (data.proposalToken) rememberProposal(data.match._id, data.proposalToken);
    return data;
}

export async function confirmMatch(
    id: string,
    winner: 'A' | 'B',
): Promise<{ match: MatchRecord; players: Player[] }> {
    const { data } = await api.post<{ match: MatchRecord; players: Player[] }>(
        `/matches/${id}/confirm`,
        { winner },
    );
    return data;
}

/**
 * Delete a match. Admins delete any pending/in-progress match; a non-admin
 * proposer deletes their OWN pending proposal via the stored proposal token.
 */
export async function deleteMatch(id: string): Promise<void> {
    const token = getProposalToken(id);
    await api.delete(`/matches/${id}`, {
        headers: token ? { 'X-Proposal-Token': token } : undefined,
    });
    forgetProposal(id);
}

/** Cancel an in-progress match: back to proposed (nothing is deleted). */
export async function cancelMatch(id: string): Promise<MatchRecord> {
    const { data } = await api.post<{ match: MatchRecord }>(`/matches/${id}/stop`, {});
    return data.match;
}

/** Reverse a confirmed match: undoes MMR, keeps it in history as reversed. */
export async function reverseMatch(
    id: string,
): Promise<{ match: MatchRecord; players: Player[] }> {
    const { data } = await api.post<{ match: MatchRecord; players: Player[] }>(`/matches/${id}/reverse`, {});
    return data;
}

/* -------------------------------- auth --------------------------------- */

/** Validate the current token and return the actor role (throws on invalid). */
export async function verifyToken(): Promise<{ actor: Actor; guildName?: string }> {
    const { data } = await api.get<{
        actor: Actor;
        writesProtected: boolean;
        guildId: string | null;
        guildName?: string;
    }>('/auth/me');
    return { actor: data.actor, guildName: data.guildName };
}

/** Exchange a server key + admin password for a per-server admin token. */
export async function serverLogin(
    serverKey: string,
    password: string,
): Promise<{ token: string; guildId: string; guildName: string }> {
    const { data } = await api.post<{ token: string; guildId: string; guildName: string }>(
        '/servers/login',
        { serverKey, password },
    );
    return data;
}

/** Resolve a server key to its Discord server name (throws on unknown key). */
export async function lookupServer(serverKey: string): Promise<{ guildId: string; guildName: string }> {
    const { data } = await api.get<{ guildId: string; guildName: string }>('/servers/lookup', {
        params: { key: serverKey },
    });
    return data;
}

/* ------------------------------- resets -------------------------------- */

/** Admin: reset one player (riot refresh + re-seed + zeroed record; link kept). */
export async function resetPlayer(
    id: string,
): Promise<{ player: Player; before: ResetView; after: ResetView; refreshedFromRiot: boolean }> {
    const { data } = await api.post<{
        player: Player;
        before: ResetView;
        after: ResetView;
        refreshedFromRiot: boolean;
    }>(`/players/${id}/reset`, {}, { timeout: 60_000 });
    return data;
}

/* --------------------------- Discord commands --------------------------- */

/** Admin: queue a Discord match action for the bot to run. */
export async function enqueueBotCommand(input: {
    action: BotCommandRecord['action'];
    matchId: string;
    winner?: 'A' | 'B';
}): Promise<BotCommandRecord> {
    const { data } = await api.post<{ command: BotCommandRecord }>('/bot-commands', input);
    return data.command;
}

/** Admin: recent Discord-tab commands and their outcomes. */
export async function getBotCommands(): Promise<BotCommandRecord[]> {
    const { data } = await api.get<{ commands: BotCommandRecord[] }>('/bot-commands');
    return data.commands;
}
