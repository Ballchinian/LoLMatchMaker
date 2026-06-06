import axios, { AxiosError, type AxiosInstance } from 'axios';
import { env, riotEnabled } from '../config/env';
import type { Division, Tier } from './rank';
import type { RecentForm } from './mmr';

/**
 * Thin, normalized Riot Games API client.
 *
 * Routing recap:
 *  - account-v1 + match-v5 live on the *regional* host (americas|europe|asia|sea)
 *  - summoner-v4 + league-v4 live on the *platform* host (euw1|na1|kr|...)
 *
 * If no RIOT_API_KEY is configured, `riotEnabled` is false and lookups throw a
 * clear RiotError so routes can return a friendly "search disabled" response.
 */

export class RiotError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export interface RiotRankEntry {
  queueType: string;
  tier: Tier;
  division: Division;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface RiotProfile {
  puuid: string;
  gameName: string;
  tagLine: string;
  platform: string;
  region: string;
  summonerLevel?: number;
  profileIconId?: number;
  rank: RiotRankEntry | null;
  recent: RecentForm | null;
}

const regionalHttp = (): AxiosInstance =>
  axios.create({
    baseURL: `https://${env.RIOT_REGION}.api.riotgames.com`,
    headers: { 'X-Riot-Token': env.RIOT_API_KEY },
    timeout: 8000,
  });

const platformHttp = (): AxiosInstance =>
  axios.create({
    baseURL: `https://${env.RIOT_PLATFORM}.api.riotgames.com`,
    headers: { 'X-Riot-Token': env.RIOT_API_KEY },
    timeout: 8000,
  });

function toRiotError(err: unknown, context: string): RiotError {
  if (err instanceof AxiosError) {
    const status = err.response?.status ?? 502;
    if (status === 401 || status === 403) {
      return new RiotError('Riot API key is missing, invalid, or expired.', 502);
    }
    if (status === 404) {
      return new RiotError(`${context}: not found.`, 404);
    }
    if (status === 429) {
      return new RiotError('Riot API rate limit reached. Try again shortly.', 429);
    }
    return new RiotError(`${context}: Riot API error (${status}).`, 502);
  }
  return new RiotError(`${context}: unexpected error.`, 502);
}

function assertEnabled(): void {
  if (!riotEnabled) {
    throw new RiotError('Player search is disabled — no Riot API key configured.', 503);
  }
}

/** Pick the most relevant ranked entry (solo queue preferred, then flex). */
function pickRankedEntry(entries: RiotRankEntry[]): RiotRankEntry | null {
  if (!entries.length) return null;
  return (
    entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') ??
    entries.find((e) => e.queueType === 'RANKED_FLEX_SR') ??
    entries[0] ??
    null
  );
}

interface MatchParticipant {
  puuid: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

/** Sample the player's recent solo/flex matches to derive win rate + average KDA. */
async function fetchRecentForm(puuid: string): Promise<RecentForm | null> {
  const count = env.RIOT_RECENT_MATCH_COUNT;
  if (count <= 0) return null;

  try {
    const regional = regionalHttp();
    const { data: matchIds } = await regional.get<string[]>(
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`,
      { params: { count, type: 'ranked' } },
    );
    if (!matchIds.length) return null;

    const details = await Promise.all(
      matchIds.map((id) =>
        regional
          .get<{ info: { participants: MatchParticipant[] } }>(
            `/lol/match/v5/matches/${encodeURIComponent(id)}`,
          )
          .then((r) => r.data)
          .catch(() => null),
      ),
    );

    let games = 0;
    let wins = 0;
    let kdaSum = 0;
    for (const d of details) {
      if (!d) continue;
      const me = d.info.participants.find((p) => p.puuid === puuid);
      if (!me) continue;
      games++;
      if (me.win) wins++;
      kdaSum += (me.kills + me.assists) / Math.max(1, me.deaths);
    }

    if (games === 0) return null;
    return {
      games,
      winRate: wins / games,
      avgKDA: kdaSum / games,
    };
  } catch {
    // Recent form is best-effort; failing here shouldn't block injection.
    return null;
  }
}

/** Look up a full normalized profile by Riot ID (gameName#tagLine). */
export async function lookupByRiotId(gameName: string, tagLine: string): Promise<RiotProfile> {
  assertEnabled();

  const cleanName = gameName.trim();
  const cleanTag = tagLine.trim().replace(/^#/, '');
  if (!cleanName || !cleanTag) {
    throw new RiotError('Provide a Riot ID as gameName#tagLine.', 400);
  }

  // 1) Account -> PUUID (regional host).
  let puuid: string;
  let resolvedName = cleanName;
  let resolvedTag = cleanTag;
  try {
    const { data } = await regionalHttp().get<{ puuid: string; gameName: string; tagLine: string }>(
      `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(cleanName)}/${encodeURIComponent(cleanTag)}`,
    );
    puuid = data.puuid;
    resolvedName = data.gameName ?? cleanName;
    resolvedTag = data.tagLine ?? cleanTag;
  } catch (err) {
    throw toRiotError(err, `Riot ID "${cleanName}#${cleanTag}"`);
  }

  // 2) Summoner profile (platform host) — optional cosmetics.
  let summonerLevel: number | undefined;
  let profileIconId: number | undefined;
  try {
    const { data } = await platformHttp().get<{ summonerLevel: number; profileIconId: number }>(
      `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
    );
    summonerLevel = data.summonerLevel;
    profileIconId = data.profileIconId;
  } catch {
    // Non-fatal.
  }

  // 3) Ranked entries (platform host, by PUUID).
  let rank: RiotRankEntry | null = null;
  try {
    const { data } = await platformHttp().get<
      Array<{
        queueType: string;
        tier: Tier;
        rank: Division;
        leaguePoints: number;
        wins: number;
        losses: number;
      }>
    >(`/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`);

    const normalized: RiotRankEntry[] = data.map((e) => ({
      queueType: e.queueType,
      tier: e.tier,
      division: e.rank,
      leaguePoints: e.leaguePoints,
      wins: e.wins,
      losses: e.losses,
    }));
    rank = pickRankedEntry(normalized);
  } catch (err) {
    throw toRiotError(err, 'Ranked data');
  }

  // 4) Recent form (best-effort).
  const recent = await fetchRecentForm(puuid);

  return {
    puuid,
    gameName: resolvedName,
    tagLine: resolvedTag,
    platform: env.RIOT_PLATFORM,
    region: env.RIOT_REGION,
    summonerLevel,
    profileIconId,
    rank,
    recent,
  };
}
