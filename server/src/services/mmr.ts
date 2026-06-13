import { rankToMMR, type RankInput } from './rank';

/**
 * MMR seeding: turn a freshly-injected player's Riot data into a single internal
 * MMR number. This runs ONCE at injection; the value is frozen as `seedMMR` and
 * also used as the starting `mmr`, which then evolves via Glicko as customs are played.
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
  /** Current-season ranked wins/losses backing the rank (drives the win-rate seed adjustment). */
  seasonWins?: number | null;
  seasonLosses?: number | null;
  /** Explicit MMR override (manual entry of a raw number). Wins over everything. */
  manualMMR?: number | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Seed adjustment from current-season ranked WIN RATE (KDA is deliberately
 * ignored — win rate is the cleaner signal at our volumes). Win rate above/below
 * 50% pushes the rank-based seed up/down, scaled by how many games back it up:
 *
 *   - magnitude = (winRate - 0.5) * 2000  → +200 at 60%, +400 at 70%, etc.
 *   - confidence ramps with games, ~0.25 at 10 games and full by 30 (slightly
 *     super-linear, so a handful of games barely moves the seed). e.g.
 *       30 games @ 40% → -200,  60% → +200,  70% → +400 (one tier)
 *       10 games @ 60% → ~+50,  70% → ~+100
 *
 * Capped at ±400 (a full tier) either way.
 */
export function seasonWinRateAdjustment(
  wins: number | null | undefined,
  losses: number | null | undefined,
): number {
  const w = Math.max(0, wins ?? 0);
  const l = Math.max(0, losses ?? 0);
  const games = w + l;
  if (games <= 0) return 0;

  const winRate = w / games;
  const magnitude = (winRate - 0.5) * 2000;
  const confidence = Math.min(1, (games / 30) ** 1.3);
  return clamp(Math.round(magnitude * confidence), -400, 400);
}

/* ------------------------- champion versatility ------------------------- */

//Total roles in League.
export const MAX_ROLES = 5;

/*
    Champion-pool depth: a champion one-trick is worth far less in a draft with
    bans (their champ gets banned away). This is the ONLY modifier on the
    shown/balancing MMR; how many roles a player covers is stored as info but
    does not adjust MMR.
*/
export const CHAMP_POOLS = ['one-trick', 'two-trick', 'diverse'] as const;
export type ChampPool = (typeof CHAMP_POOLS)[number];

export const CHAMP_POOL_MODIFIER: Record<ChampPool, number> = {
  'one-trick': -200, //one champion: fully ban-able
  'two-trick': -75, //two champions: still squeezable
  diverse: 0, //can't be banned out
};

//Champion-pool modifier (-200 .. 0). Unknown/absent values fall back to 'diverse' (no penalty).
export function versatilityModifier(champPool: string | undefined | null): number {
  const pool: ChampPool = CHAMP_POOLS.includes(champPool as ChampPool) ? (champPool as ChampPool) : 'diverse';
  return CHAMP_POOL_MODIFIER[pool];
}

/*
    The adjusted MMR used for team balancing AND shown as the player's MMR.
    Ranks and Glicko (post-game gains/losses) still operate on the raw `mmr`.
*/
export function effectiveMMR(mmr: number, champPool: string | undefined | null): number {
  return Math.max(0, mmr + versatilityModifier(champPool));
}

/** Compute the seed MMR for a player from whatever data we have. */
export function computeSeedMMR(input: SeedInput): number {
  if (typeof input.manualMMR === 'number' && Number.isFinite(input.manualMMR)) {
    return clamp(Math.round(input.manualMMR), 0, 6000);
  }

  const base = input.riotRank ? rankToMMR(input.riotRank) : DEFAULT_SEED_MMR;
  const adjustment = seasonWinRateAdjustment(input.seasonWins, input.seasonLosses);
  return clamp(Math.round(base + adjustment), 0, 6000);
}
