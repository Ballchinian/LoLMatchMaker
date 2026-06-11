/**
 * Glicko-style rating with an uncertainty term (RD), replacing plain Elo.
 *
 * Every player carries a rating (their MMR, same 0..6000 scale as before — the
 * expectation curve is the standard Elo/Glicko 400-point logistic) plus an RD
 * ("rating deviation"): how unsure the system is about that rating. RD drives
 * how far a single game can move someone:
 *
 *   - high RD (new / barely-known player)  -> big swings while we calibrate
 *   - low RD (regular at the floor)        -> steady ±25-40 swings
 *
 * RD shrinks with every game played (each result is evidence) and grows with
 * inactivity (skills drift; a returner re-calibrates in a few games). This
 * replaces the old hand-rolled `newPlayerBoost` ×2-decay entirely.
 *
 * Seeding: a player's starting RD depends on how much CURRENT-season ranked
 * data backs their Riot rank. The curve composes like statistical precision
 * (1/RD² grows linearly with games — steep at first, flattening out):
 *
 *   ranked games:   0    10    30    50   100   200+      (no rank data)
 *   seed RD:       250   215   175   151   118    89          300
 *
 * Team play: like the old Elo, each team is rated by its average MMR and every
 * member of a team sees the same expected score; each player's update is then
 * scaled by their OWN RD, so a calibrating player moves more than a veteran in
 * the same game.
 */

const Q = Math.LN10 / 400; // Glicko's q: converts rating-point gaps to log-odds

/** RD never drops below this — ratings stay slightly alive forever (≈ old K=32). */
export const RD_FLOOR = 75;

/** RD never grows past this through inactivity. */
export const RD_CEILING = 300;

/** Seed RD when we have a Riot rank but zero ranked games this season. */
export const SEED_RD_MAX = 250;

/** Seed RD for manual entries / accounts with no rank data at all. */
export const SEED_RD_UNRANKED = 300;

/** Ranked games beyond this add no further seed confidence (curve bottom ≈ 89). */
export const SEED_RANKED_GAMES_CAP = 200;

/**
 * Precision (1/RD²) added per current-season ranked game. Calibrated so the
 * curve passes through RD 175 at 30 games; it bottoms out at ≈89 by 200 games,
 * deliberately above RD_FLOOR — soloqueue evidence alone never grants the
 * trust of actual inhouse history.
 */
const SEED_INFO_PER_RANKED_GAME = 5.55e-7;

/** Precision one even-odds inhouse game contributes (q²·E(1-E) at E=0.5). */
const INFO_PER_INHOUSE_GAME = Q * Q * 0.25;

/** Idle RD growth: RD² gains 50² per idle month (the first gap month is free). */
const IDLE_RD_PER_MONTH = 50;
const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

/**
 * Starting RD for a freshly-injected player.
 * @param rankedGames current-season ranked games (wins+losses) backing their
 *   Riot rank, or null/undefined when there is no rank data (manual entry,
 *   unranked account).
 */
export function seedRD(rankedGames: number | null | undefined): number {
  if (rankedGames == null) return SEED_RD_UNRANKED;
  const n = Math.min(Math.max(0, rankedGames), SEED_RANKED_GAMES_CAP);
  return Math.round(1 / Math.sqrt(1 / SEED_RD_MAX ** 2 + n * SEED_INFO_PER_RANKED_GAME));
}

/**
 * RD for a player who predates the rd field (or has never had one persisted):
 * start from their seed curve and credit the inhouse games they've already
 * played, as if each had been roughly even odds.
 */
export function backfillRD(seedRankedGames: number | null | undefined, inhouseGames: number): number {
  const seed = seedRD(seedRankedGames);
  const precision = 1 / seed ** 2 + Math.max(0, inhouseGames) * INFO_PER_INHOUSE_GAME;
  return Math.max(RD_FLOOR, Math.round(1 / Math.sqrt(precision)));
}

/**
 * Grow RD for time away. Playing at the league's normal monthly cadence costs
 * nothing; each FURTHER idle month adds 50² to RD², capped at RD_CEILING.
 * (~6 months out: RD 75 -> ≈135, so the comeback games re-calibrate quickly.)
 */
export function inflateRD(rd: number, lastActiveAt: Date | null | undefined, now: Date = new Date()): number {
  if (!lastActiveAt) return rd;
  const idleMonths = Math.max(0, Math.floor((now.getTime() - lastActiveAt.getTime()) / MS_PER_MONTH) - 1);
  if (idleMonths === 0) return rd;
  return Math.min(RD_CEILING, Math.round(Math.sqrt(rd ** 2 + IDLE_RD_PER_MONTH ** 2 * idleMonths)));
}

/**
 * The RD a player carries into a game right now: their stored value (backfilled
 * from history when absent), inflated for inactivity.
 */
export function currentRD(opts: {
  rd?: number | null;
  seedRankedGames: number | null | undefined;
  inhouseGames: number;
  lastActiveAt?: Date | null;
  now?: Date;
}): number {
  const base = opts.rd ?? backfillRD(opts.seedRankedGames, opts.inhouseGames);
  return inflateRD(base, opts.lastActiveAt, opts.now);
}

/* ------------------------------ match update ----------------------------- */

export interface GlickoPlayer {
  id: string;
  mmr: number;
  rd: number;
}

export interface GlickoResult {
  id: string;
  before: number;
  after: number;
  delta: number;
  rdBefore: number;
  rdAfter: number;
}

export interface GlickoOutcome {
  changes: GlickoResult[];
  teamAAvg: number;
  teamBAvg: number;
  expectedA: number; // probability team A was "expected" to win (0..1)
}

/** Glicko's g(): discounts the rating gap when the opponent itself is uncertain. */
function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

const MMR_FLOOR = 0;

function teamAvg(players: GlickoPlayer[], divisor: number): number {
  return players.reduce((sum, p) => sum + p.mmr, 0) / divisor;
}

/** RD of a team's average rating (mean of independent estimates). */
function teamRD(players: GlickoPlayer[]): number {
  if (players.length === 0) return SEED_RD_UNRANKED;
  const sumSq = players.reduce((sum, p) => sum + p.rd ** 2, 0);
  return Math.sqrt(sumSq) / players.length;
}

function updateSide(
  players: GlickoPlayer[],
  opponentAvg: number,
  ownAvg: number,
  opponentRD: number,
  score: 0 | 1,
  changes: GlickoResult[],
): number {
  const gOpp = g(opponentRD);
  const expected = 1 / (1 + Math.pow(10, (gOpp * (opponentAvg - ownAvg)) / 400));
  // Information this game carries about each player on this side.
  const info = Q * Q * gOpp * gOpp * expected * (1 - expected); // = 1/d²

  for (const p of players) {
    const denom = 1 / p.rd ** 2 + info;
    const delta = Math.round(((Q / denom) * gOpp * (score - expected)));
    const after = Math.max(MMR_FLOOR, p.mmr + delta);
    const rdAfter = Math.max(RD_FLOOR, Math.round(Math.sqrt(1 / denom)));
    changes.push({ id: p.id, before: p.mmr, after, delta: after - p.mmr, rdBefore: p.rd, rdAfter });
  }
  return expected;
}

/**
 * Apply a result and return per-player MMR + RD changes.
 *
 * As with the old Elo, uneven teams divide BOTH totals by the larger team's
 * size, rating a short-handed team below a full one.
 */
export function applyMatchResult(
  teamA: GlickoPlayer[],
  teamB: GlickoPlayer[],
  winner: 'A' | 'B',
): GlickoOutcome {
  const divisor = Math.max(teamA.length, teamB.length, 1);
  const teamAAvg = teamAvg(teamA, divisor);
  const teamBAvg = teamAvg(teamB, divisor);

  const changes: GlickoResult[] = [];
  const expectedA = updateSide(teamA, teamBAvg, teamAAvg, teamRD(teamB), winner === 'A' ? 1 : 0, changes);
  updateSide(teamB, teamAAvg, teamBAvg, teamRD(teamA), winner === 'B' ? 1 : 0, changes);

  return { changes, teamAAvg, teamBAvg, expectedA };
}
