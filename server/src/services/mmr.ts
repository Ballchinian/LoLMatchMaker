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

/** Total roles in League. */
export const MAX_ROLES = 5;

/** MMR modifier by how many roles a player covers: one role costs, full flex pays. */
export const ROLE_MODIFIER: Record<number, number> = {
  1: -125,
  2: -50,
  3: 0,
  4: 25,
  5: 50,
};

/**
 * Champion-pool depth, separate from role coverage. A champion one-trick is
 * worth far less in a draft with bans (their champ gets banned away) even if
 * they can technically fill several roles.
 */
export const CHAMP_POOLS = ['one-trick', 'two-trick', 'diverse'] as const;
export type ChampPool = (typeof CHAMP_POOLS)[number];

export const CHAMP_POOL_MODIFIER: Record<ChampPool, number> = {
  'one-trick': -200, // one champion — fully ban-able
  'two-trick': -75, // two champions — still squeezable
  diverse: 0, // can't be banned out
};

/** Modifier for role coverage: 1 → -125, 2 → -50, 3 → 0, 4 → +25, 5 → +50. */
export function roleModifier(rolesPlayed: number | undefined | null): number {
  const roles = clamp(Math.round(rolesPlayed ?? MAX_ROLES), 1, MAX_ROLES);
  return ROLE_MODIFIER[roles] ?? 0;
}

/**
 * Total versatility modifier (role coverage + champion-pool depth). Can be
 * positive: a 5-role diverse player is worth +50 over their raw MMR; a
 * one-role one-trick bottoms out at -325.
 */
export function versatilityModifier(
  rolesPlayed: number | undefined | null,
  champPool: string | undefined | null,
): number {
  // 'limited' was the pre-rename value for a shallow pool — treat as two-trick.
  const pool: ChampPool =
    champPool === 'limited' ? 'two-trick' : CHAMP_POOLS.includes(champPool as ChampPool) ? (champPool as ChampPool) : 'diverse';
  return roleModifier(rolesPlayed) + CHAMP_POOL_MODIFIER[pool];
}

/**
 * The adjusted MMR used for team balancing AND shown as the player's MMR.
 * Ranks and Elo (post-game gains/losses) still operate on the raw `mmr`.
 */
export function effectiveMMR(
  mmr: number,
  rolesPlayed: number | undefined | null,
  champPool: string | undefined | null,
): number {
  return Math.max(0, mmr + versatilityModifier(rolesPlayed, champPool));
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
