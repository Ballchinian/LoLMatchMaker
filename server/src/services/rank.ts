/**
 * Rank ladder + bidirectional MMR <-> rank mapping.
 *
 * Model:
 *  - Each division is worth 100 MMR.
 *  - Each standard tier (Iron..Diamond) spans 4 divisions = 400 MMR.
 *  - LP within a division contributes 0..99 MMR (≈ 1 LP per point).
 *  - Apex tiers (Master/GM/Challenger) have no divisions; they sit on flat bases
 *    above Diamond and their LP is added on top.
 *
 * This is deliberately self-contained and pure so it can be unit-tested and
 * reused by both seeding (rank -> mmr) and display (mmr -> rank).
 */

export const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const;

export type Tier = (typeof TIERS)[number];

/** Divisions from lowest (IV) to highest (I). Apex tiers ignore these. */
export const DIVISIONS = ['IV', 'III', 'II', 'I'] as const;
export type Division = (typeof DIVISIONS)[number];

/** Tiers that use I..IV divisions. */
const STANDARD_TIERS: Tier[] = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const MMR_PER_DIVISION = 100;
const MMR_PER_TIER = MMR_PER_DIVISION * DIVISIONS.length; // 400

/** MMR floor (division IV, 0 LP) for each standard tier, and base for apex tiers. */
const TIER_BASE: Record<Tier, number> = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
  MASTER: 2800,
  GRANDMASTER: 3200,
  CHALLENGER: 3600,
};

export interface RankInput {
  tier: Tier;
  division?: Division | null;
  leaguePoints?: number;
}

export interface Rank {
  tier: Tier;
  division: Division | null; // null for apex tiers
  leaguePoints: number; // 0..99 for standard tiers, unbounded-ish for apex
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isApex(tier: Tier): boolean {
  return tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER';
}

function divisionIndex(division: Division): number {
  // IV -> 0 (lowest), I -> 3 (highest)
  return DIVISIONS.indexOf(division);
}

/** Convert a rank (tier/division/LP) to an internal MMR value. */
export function rankToMMR(input: RankInput): number {
  const base = TIER_BASE[input.tier];
  const lp = Math.max(0, input.leaguePoints ?? 0);

  if (isApex(input.tier)) {
    // Cap LP contribution so apex tiers stay ordered without runaway values.
    return Math.round(base + clamp(lp, 0, 599));
  }

  const division = input.division ?? 'IV';
  const divMMR = divisionIndex(division) * MMR_PER_DIVISION;
  return Math.round(base + divMMR + clamp(lp, 0, 99));
}

/** Convert an internal MMR value back to a displayable website rank. */
export function mmrToRank(mmr: number): Rank {
  const m = Math.max(0, Math.round(mmr));

  // Apex tiers sit above Diamond's ceiling.
  if (m >= TIER_BASE.CHALLENGER) {
    return { tier: 'CHALLENGER', division: null, leaguePoints: m - TIER_BASE.CHALLENGER };
  }
  if (m >= TIER_BASE.GRANDMASTER) {
    return { tier: 'GRANDMASTER', division: null, leaguePoints: m - TIER_BASE.GRANDMASTER };
  }
  if (m >= TIER_BASE.MASTER) {
    return { tier: 'MASTER', division: null, leaguePoints: m - TIER_BASE.MASTER };
  }

  // Standard tiers.
  const tierIdx = clamp(Math.floor(m / MMR_PER_TIER), 0, STANDARD_TIERS.length - 1);
  const tier = STANDARD_TIERS[tierIdx]!;
  const withinTier = m - tierIdx * MMR_PER_TIER; // 0..399
  const divBlock = clamp(Math.floor(withinTier / MMR_PER_DIVISION), 0, 3); // 0..3
  const division = DIVISIONS[divBlock]!;
  const leaguePoints = withinTier % MMR_PER_DIVISION; // 0..99

  return { tier, division, leaguePoints };
}

/** Human-readable label, e.g. "Gold II 43 LP" or "Master 312 LP". */
export function formatRank(rank: Rank): string {
  const tierName = rank.tier.charAt(0) + rank.tier.slice(1).toLowerCase();
  if (rank.division === null) {
    return `${tierName} ${rank.leaguePoints} LP`;
  }
  return `${tierName} ${rank.division} ${rank.leaguePoints} LP`;
}

/** Convenience: MMR straight to a label. */
export function mmrToRankLabel(mmr: number): string {
  return formatRank(mmrToRank(mmr));
}
