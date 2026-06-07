import { config } from './config';

/** Minimal client for the Match Maker backend, authenticated as the `bot` actor. */

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.BOT_TOKEN}`,
      ...(init?.headers ?? {}),
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

export const apiGetPlayers = () =>
  req<{ players: ApiPlayer[] }>('/players').then((r) => r.players);

export const apiGetMatches = () =>
  req<{ matches: ApiMatch[] }>('/matches').then((r) => r.matches);

export const apiConfirmMatch = (id: string, winner: 'A' | 'B') =>
  req<{ players: ApiPlayer[] }>(`/matches/${id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ winner }),
  }).then((r) => r.players);

export const apiLinkDiscord = (playerId: string, discordUserId: string | null) =>
  req<{ player: ApiPlayer }>(`/players/${playerId}/discord`, {
    method: 'PATCH',
    body: JSON.stringify({ discordUserId }),
  }).then((r) => r.player);
