import axios from 'axios';
import type {
    Actor,
    BalanceResult,
    ChampPool,
    HealthInfo,
    MatchRecord,
    Player,
    SearchResult,
    Tier,
    Division,
} from './types';

/** localStorage key holding the admin/bot token (if the user has unlocked). */
export const TOKEN_KEY = 'lmm_token';

// In dev, '/api' is proxied to the backend by Vite. In production set VITE_API_BASE_URL
// to your backend's API base (e.g. https://your-app.up.railway.app/api), OR leave it unset
// and proxy /api via Netlify (see netlify.toml).
export const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api' });

// Attach the stored token to every request; harmless on public endpoints.
api.interceptors.request.use((config) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

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

/** Admin: set a player's versatility — role coverage (1–5) and/or champion-pool depth. */
export async function updatePlayerRoles(
    id: string,
    input: { rolesPlayed?: number; champPool?: ChampPool },
): Promise<Player> {
    const { data } = await api.patch<{ player: Player }>(`/players/${id}/roles`, input);
    return data.player;
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
 * - public → always pending; `proposedWinner`/`reportedBy` recorded for admin review
 */
export async function createMatch(input: {
    teamA: string[];
    teamB: string[];
    winner?: 'A' | 'B';
    proposedWinner?: 'A' | 'B';
    reportedBy?: string;
}): Promise<{ match: MatchRecord; players: Player[] }> {
    const { data } = await api.post<{ match: MatchRecord; players: Player[] }>('/matches', input);
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

export async function deleteMatch(id: string): Promise<void> {
     await api.delete(`/matches/${id}`);
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
export async function verifyToken(): Promise<{ actor: Actor }> {
    const { data } = await api.get<{ actor: Actor; writesProtected: boolean }>('/auth/me');
    return { actor: data.actor };
}
