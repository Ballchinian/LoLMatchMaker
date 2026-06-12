import { config } from './config';

/** Minimal client for the Match Maker backend, authenticated as the `bot` actor. */

async function req<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const { timeoutMs = 15_000, ...rest } = init ?? {};
    const res = await fetch(`${config.API_BASE_URL}${path}`, {
        ...rest,
        // Fail fast instead of hanging on a cold/unreachable API. Autocomplete
        // passes a much tighter budget (Discord only allows ~3s to respond).
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.BOT_TOKEN}`,
            ...(rest.headers ?? {}),
        },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        throw new Error((data && data.error) || `API ${res.status} ${res.statusText}`);
    }
    return data as T;
}

export interface ApiPlayer {
    id: string;
    displayName: string;
    mmr: number;
    discordUserId?: string;
    rank: { tier: string; label: string };
}

export interface ApiRosterEntry {
    player: string;
    displayName: string;
    mmrAtCreate: number;
}

export interface ApiMatch {
    _id: string;
    status: 'pending' | 'confirmed' | 'reversed';
    name?: string;
    teamA: ApiRosterEntry[];
    teamB: ApiRosterEntry[];
    winner: 'A' | 'B' | null;
    proposedWinner?: 'A' | 'B' | null;
    reportedBy?: string;
    createdAt: string;
}

export const apiGetPlayers = (timeoutMs?: number) =>
    req<{ players: ApiPlayer[] }>('/players', { timeoutMs }).then((r) => r.players);

export const apiGetMatches = (timeoutMs?: number) =>
    req<{ matches: ApiMatch[] }>('/matches', { timeoutMs }).then((r) => r.matches);

export const apiConfirmMatch = (id: string, winner: 'A' | 'B') =>
    req<{ players: ApiPlayer[] }>(`/matches/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ winner }),
  }).then((r) => r.players);

/**
 * Ask the server to find the played custom game in Riot match history.
 * null = couldn't tell (customs aren't guaranteed to be indexed) — ask the humans.
 * Generous timeout: the server fans out several Riot API calls.
 */
export const apiDetectWinner = (id: string) =>
    req<{ detected: { winner: 'A' | 'B'; gameId: string } | null }>(`/matches/${id}/detected-winner`, {
    timeoutMs: 30_000,
  }).then((r) => r.detected);

export const apiLinkDiscord = (playerId: string, discordUserId: string | null) =>
    req<{ player: ApiPlayer }>(`/players/${playerId}/discord`, {
    method: 'PATCH',
    body: JSON.stringify({ discordUserId }),
  }).then((r) => r.player);

export type ChampPool = 'one-trick' | 'two-trick' | 'diverse';

/** Set a player's champion-pool depth (the only versatility MMR modifier). */
export const apiUpdateRoles = (
    playerId: string,
    input: { champPool: ChampPool },
) =>
    req<{ player: ApiPlayer }>(`/players/${playerId}/roles`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }).then((r) => r.player);
