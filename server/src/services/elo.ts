/**
 * Team-based Elo. After a custom game we know which side won; every player on the
 * winning team gains MMR and every player on the losing team loses MMR, scaled by
 * how surprising the result was (an upset moves MMR more than an expected win).
 *
 * Each team is rated by its average MMR — with uneven teams, BOTH totals divide
 * by the larger team's size, so a short-handed team is rated below a full one.
 * We compute the expected score for team A, then apply the same magnitude of
 * change to every member of a team.
 */

export interface EloPlayer {
  id: string;
  mmr: number;
}

export interface EloResult {
  id: string;
  before: number;
  after: number;
  delta: number;
}

export interface EloOutcome {
  changes: EloResult[];
  teamAAvg: number;
  teamBAvg: number;
  expectedA: number; // probability team A was "expected" to win (0..1)
}

const DEFAULT_K = 32;
const MMR_FLOOR = 0;

function teamTotal(players: EloPlayer[]): number {
  return players.reduce((sum, p) => sum + p.mmr, 0);
}

/** Standard logistic expectation: probability that rating A beats rating B. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Apply a result and return per-player MMR changes.
 * @param winner 'A' or 'B'
 * @param k learning rate (higher = bigger swings). Defaults to 32.
 */
export function applyMatchResult(
  teamA: EloPlayer[],
  teamB: EloPlayer[],
  winner: 'A' | 'B',
  k: number = DEFAULT_K,
): EloOutcome {
  const divisor = Math.max(teamA.length, teamB.length, 1);
  const teamAAvg = teamTotal(teamA) / divisor;
  const teamBAvg = teamTotal(teamB) / divisor;

  const expectedA = expectedScore(teamAAvg, teamBAvg);
  const expectedB = 1 - expectedA;

  const actualA = winner === 'A' ? 1 : 0;
  const actualB = winner === 'B' ? 1 : 0;

  const deltaA = Math.round(k * (actualA - expectedA));
  const deltaB = Math.round(k * (actualB - expectedB));

  const changes: EloResult[] = [];

  for (const p of teamA) {
    const after = Math.max(MMR_FLOOR, p.mmr + deltaA);
    changes.push({ id: p.id, before: p.mmr, after, delta: after - p.mmr });
  }
  for (const p of teamB) {
    const after = Math.max(MMR_FLOOR, p.mmr + deltaB);
    changes.push({ id: p.id, before: p.mmr, after, delta: after - p.mmr });
  }

  return { changes, teamAAvg, teamBAvg, expectedA };
}
