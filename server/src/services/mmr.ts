import { rankToMMR, type RankInput } from './rank';

/**
 * MMR seeding: turn a freshly-injected player's Riot data into a single internal
 * MMR number. This runs ONCE at injection; the value is frozen as `seedMMR` and
 * also used as the starting `mmr`, which then evolves via Elo as customs are played.
 */

/** Default starting MMR for an unranked / Riot-less player (≈ Silver II). */
export const DEFAULT_SEED_MMR = 1000;

export interface RecentForm {
  games: number; // number of recent games sampled
  winRate: number; // 0..1
  avgKDA: number; // (kills + assists) / max(deaths, 1)
}

export interface SeedInput {
  /** Ranked snapshot from Riot, if available. */
  riotRank?: RankInput | null;
  /** Recent performance sample from match history, if available. */
  recent?: RecentForm | null;
  /** Explicit MMR override (manual entry of a raw number). Wins over everything. */
  manualMMR?: number | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Adjustment derived from recent form. Returns a bounded +/- nudge on top of the
 * rank-based base, scaled by how many games we actually sampled (confidence).
 */
export function recentFormAdjustment(recent: RecentForm | null | undefined): number {
  if (!recent || recent.games <= 0) return 0;

  const winRateComponent = (recent.winRate - 0.5) * 200; // +/-100 at 0%/100% WR
  const kdaComponent = (recent.avgKDA - 2.5) * 15; // ~baseline KDA of 2.5
  const raw = winRateComponent + kdaComponent;

  const confidence = clamp(recent.games / 10, 0, 1); // full confidence at 10+ games
  return clamp(raw * confidence, -150, 150);
}

/* --------------------------- role versatility --------------------------- */

/** Total roles in League; playing all of them means no role-coverage penalty. */
export const MAX_ROLES = 5;

/** Penalty per role NOT played: only 1 role = -100, all 5 roles = 0. */
export const PENALTY_PER_MISSING_ROLE = 25;

/**
 * Champion-pool depth, separate from role coverage. A champion one-trick is
 * worth far less in a draft with bans (their champ gets banned away) even if
 * they can technically fill several roles.
 */
export const CHAMP_POOLS = ['one-trick', 'limited', 'diverse'] as const;
export type ChampPool = (typeof CHAMP_POOLS)[number];

export const CHAMP_POOL_PENALTY: Record<ChampPool, number> = {
  'one-trick': 100, // one champion — fully ban-able
  limited: 50, // a few comfort picks
  diverse: 0, // can't be banned out
};

/** Penalty for limited role coverage: 5 roles → 0 … 1 role → -100. */
export function rolePenalty(rolesPlayed: number | undefined | null): number {
  const roles = clamp(Math.round(rolesPlayed ?? MAX_ROLES), 1, MAX_ROLES);
  return (MAX_ROLES - roles) * PENALTY_PER_MISSING_ROLE;
}

/**
 * Total matchmaking-value penalty: role coverage (0–100) PLUS champion-pool
 * depth (0–100). They stack — a one-champion, one-role player is -200.
 */
export function flexPenalty(
  rolesPlayed: number | undefined | null,
  champPool: ChampPool | undefined | null,
): number {
  return rolePenalty(rolesPlayed) + CHAMP_POOL_PENALTY[champPool ?? 'diverse'];
}

/**
 * The MMR used for team balancing: live MMR minus the versatility penalties.
 * Elo (post-game gains/losses) still operates on the raw `mmr`.
 */
export function effectiveMMR(
  mmr: number,
  rolesPlayed: number | undefined | null,
  champPool: ChampPool | undefined | null,
): number {
  return Math.max(0, mmr - flexPenalty(rolesPlayed, champPool));
}

/** Compute the seed MMR for a player from whatever data we have. */
export function computeSeedMMR(input: SeedInput): number {
  if (typeof input.manualMMR === 'number' && Number.isFinite(input.manualMMR)) {
    return clamp(Math.round(input.manualMMR), 0, 6000);
  }

  const base = input.riotRank ? rankToMMR(input.riotRank) : DEFAULT_SEED_MMR;
  const adjustment = recentFormAdjustment(input.recent);
  return clamp(Math.round(base + adjustment), 0, 6000);
}
