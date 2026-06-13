import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { env, riotEnabled } from '../config/env';
import { riotLimiter } from './riotLimiter';
import type { Division, Tier } from './rank';
import { classifyChampPool, type ChampPool, type RecentForm } from './mmr';

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
  /** Champ-pool depth auto-detected from recent ranked champion frequency (null = couldn't tell). */
  detectedChampPool: ChampPool | null;
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

/** How many times to retry a call that still 429s after the proactive throttle. */
const RIOT_429_RETRIES = 3;

/**
 * Every Riot GET goes through here: it waits for the outbound limiter, then —
 * as a safety net if the budget is still exceeded (e.g. another process sharing
 * the key) — honours a 429's Retry-After and retries a few times before giving
 * up. Proactive throttling means 429s should be rare; this stops a transient one
 * from failing a whole reset.
 */
async function riotGet<T>(http: AxiosInstance, url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  for (let attempt = 0; ; attempt++) {
    await riotLimiter.acquire();
    try {
      return await http.get<T>(url, config);
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : undefined;
      if (status === 429 && attempt < RIOT_429_RETRIES) {
        const retryAfter = Number(err instanceof AxiosError ? err.response?.headers['retry-after'] : 0);
        //Riot's Retry-After is in seconds; fall back to a short backoff.
        await new Promise((r) => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2) * 1000));
        continue;
      }
      throw err;
    }
  }
}

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
  championName?: string;
}

/**
 * Sample the player's recent RANKED matches once, deriving BOTH:
 *  - recent form (win rate + average KDA, cosmetic preview), and
 *  - auto-detected champ pool (champion frequency over the same games).
 * One match fetch serves both, so champ-pool detection costs no extra calls.
 */
async function fetchRankedSample(
  puuid: string,
): Promise<{ recent: RecentForm | null; champPool: ChampPool | null }> {
  const count = env.RIOT_RECENT_MATCH_COUNT;
  if (count <= 0) return { recent: null, champPool: null };

  try {
    const regional = regionalHttp();
    const { data: matchIds } = await riotGet<string[]>(
      regional,
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`,
      { params: { count, type: 'ranked' } },
    );
    if (!matchIds.length) return { recent: null, champPool: null };

    const details = await Promise.all(
      matchIds.map((id) =>
        riotGet<{ info: { participants: MatchParticipant[] } }>(
          regional,
          `/lol/match/v5/matches/${encodeURIComponent(id)}`,
        )
          .then((r) => r.data)
          .catch(() => null),
      ),
    );

    let games = 0;
    let wins = 0;
    let kdaSum = 0;
    const champCounts = new Map<string, number>();
    for (const d of details) {
      if (!d) continue;
      const me = d.info.participants.find((p) => p.puuid === puuid);
      if (!me) continue;
      games++;
      if (me.win) wins++;
      kdaSum += (me.kills + me.assists) / Math.max(1, me.deaths);
      if (me.championName) champCounts.set(me.championName, (champCounts.get(me.championName) ?? 0) + 1);
    }

    if (games === 0) return { recent: null, champPool: null };
    return {
      recent: { games, winRate: wins / games, avgKDA: kdaSum / games },
      champPool: classifyChampPool(champCounts, games),
    };
  } catch {
    // Best-effort; failing here shouldn't block injection.
    return { recent: null, champPool: null };
  }
}

/* ----------------------- custom-game result detection ---------------------- */

export interface DetectedCustomResult {
  winner: 'A' | 'B';
  gameId: string;
  gameEndedAt: number; // epoch ms
}

/**
 * Best-effort: find the finished custom game these two rosters just played and
 * which side won. Plain customs are NOT guaranteed to appear in match-v5 (only
 * tournament-code games are), so `null` means "couldn't tell — ask the humans",
 * never "no game happened".
 *
 * Matching is by PUUID overlap: sample a few players' recent match ids since the
 * match was created, keep custom games containing (almost) the whole lobby, then
 * map the in-game winning side back onto our rosters — tolerating one player
 * sitting on the "wrong" side compared to the website teams.
 */
export async function findRecentCustomResult(
  teamAPuuids: string[],
  teamBPuuids: string[],
  sinceMs: number,
): Promise<DetectedCustomResult | null> {
  assertEnabled();
  const known = [...teamAPuuids, ...teamBPuuids];
  if (known.length < 4) return null; // too few linked Riot accounts to identify the lobby

  // A custom can be missing from one player's history yet present in another's,
  // so sample a few PUUIDs across both teams.
  const samples = [teamAPuuids[0], teamBPuuids[0], teamAPuuids[1] ?? teamBPuuids[1]].filter(
    (p): p is string => Boolean(p),
  );

  const regional = regionalHttp();
  const candidateIds = new Set<string>();
  for (const puuid of samples) {
    try {
      const { data } = await riotGet<string[]>(
        regional,
        `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`,
        { params: { startTime: Math.floor(sinceMs / 1000), count: 5 } },
      );
      for (const id of data) candidateIds.add(id);
    } catch {
      // One player's history failing shouldn't sink the search.
    }
  }

  interface CandidateInfo {
    queueId: number;
    gameType: string;
    gameDuration: number; // seconds
    gameCreation: number; // epoch ms
    gameEndTimestamp?: number; // epoch ms
    participants: Array<{ puuid: string; win: boolean }>;
  }
  const details = await Promise.all(
    [...candidateIds].slice(0, 8).map((id) =>
      riotGet<{ info: CandidateInfo }>(regional, `/lol/match/v5/matches/${encodeURIComponent(id)}`)
        .then((r) => ({ id, info: r.data.info }))
        .catch(() => null),
    ),
  );

  let best: DetectedCustomResult | null = null;
  for (const d of details) {
    if (!d) continue;
    const { id, info } = d;
    if (info.queueId !== 0 && info.gameType !== 'CUSTOM_GAME') continue;
    if (info.gameDuration < 300) continue; // remake / abandoned lobby

    const inGame = new Set(info.participants.map((p) => p.puuid));
    const overlap = known.filter((p) => inGame.has(p)).length;
    if (overlap < Math.max(4, Math.ceil(known.length * 0.8))) continue; // not our lobby

    // Each in-game lobby member supports one orientation: "A won" is backed by
    // our-A players who won plus our-B players who lost (and vice versa).
    const winners = new Set(info.participants.filter((p) => p.win).map((p) => p.puuid));
    const aWon =
      teamAPuuids.filter((p) => winners.has(p)).length +
      teamBPuuids.filter((p) => inGame.has(p) && !winners.has(p)).length;
    const bWon = overlap - aWon;

    let winner: 'A' | 'B' | null = null;
    if (aWon >= overlap - 1 && aWon > bWon) winner = 'A';
    else if (bWon >= overlap - 1 && bWon > aWon) winner = 'B';
    if (!winner) continue; // sides don't line up with the website rosters

    const endedAt = info.gameEndTimestamp ?? info.gameCreation + info.gameDuration * 1000;
    if (!best || endedAt > best.gameEndedAt) best = { winner, gameId: id, gameEndedAt: endedAt };
  }
  return best;
}

/**
 * Look up a full normalized profile by Riot ID (gameName#tagLine).
 *
 * `includeRecent` (default true) controls the recent-match sample, which is the
 * expensive part (1 + up to RIOT_RECENT_MATCH_COUNT match-detail calls). It's
 * only cosmetic now — seeding uses season W/L from the rank entry, not recent
 * form — so bulk callers (reset) pass false to stay fast and avoid gateway
 * timeouts. Search/inject keep it for the preview.
 */
export async function lookupByRiotId(
  gameName: string,
  tagLine: string,
  opts: { includeRecent?: boolean } = {},
): Promise<RiotProfile> {
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
    const { data } = await riotGet<{ puuid: string; gameName: string; tagLine: string }>(
      regionalHttp(),
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
    const { data } = await riotGet<{ summonerLevel: number; profileIconId: number }>(
      platformHttp(),
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
    const { data } = await riotGet<
      Array<{
        queueType: string;
        tier: Tier;
        rank: Division;
        leaguePoints: number;
        wins: number;
        losses: number;
      }>
    >(platformHttp(), `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`);

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

  // 4) Recent ranked sample → recent form + champ-pool detection.
  //    Skipped for bulk callers (reset) to stay fast; they keep the existing pool.
  const sample =
    opts.includeRecent === false
      ? { recent: null, champPool: null }
      : await fetchRankedSample(puuid);

  return {
    puuid,
    gameName: resolvedName,
    tagLine: resolvedTag,
    platform: env.RIOT_PLATFORM,
    region: env.RIOT_REGION,
    summonerLevel,
    profileIconId,
    rank,
    recent: sample.recent,
    detectedChampPool: sample.champPool,
  };
}
