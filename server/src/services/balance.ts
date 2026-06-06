/**
 * Fair team balancing.
 *
 * Given a set of selected players (each with an MMR), split them into two teams
 * so the teams are as evenly matched as possible, subject to optional constraints:
 *   - sameTeam[a,b]      : a and b must end up on the SAME team
 *   - oppositeTeam[a,b]  : a and b must end up on OPPOSITE teams
 *
 * "Fairness" = absolute difference of the two teams' AVERAGE MMR (averages, not
 * sums, so uneven team sizes are handled correctly). Lower is fairer.
 *
 * For up to EXACT_LIMIT players we enumerate every partition exhaustively (cheap:
 * C(9,4)=126 partitions for a 10-player lobby), so the result is provably optimal.
 *
 * Each partition has a canonical, mirror-invariant `key`. Pass previously-seen keys
 * via `excludeKeys` to get fresh teams on re-roll ("don't repeat teams").
 */

export interface BalancePlayer {
  id: string;
  mmr: number;
}

export interface PairConstraint {
  a: string;
  b: string;
}

export interface BalanceConstraints {
  sameTeam?: PairConstraint[];
  oppositeTeam?: PairConstraint[];
}

export interface BalanceOptions {
  /** Force exact team sizes (requires exactly 2*teamSize players). Omit to auto-split evenly. */
  teamSize?: number;
  constraints?: BalanceConstraints;
  /** Canonical keys to skip (already shown to the user). */
  excludeKeys?: string[];
  /** How many ranked candidates to return. Default 5. */
  maxResults?: number;
}

export interface TeamSplit {
  teamA: string[];
  teamB: string[];
  avgA: number;
  avgB: number;
  avgDiff: number;
  totalA: number;
  totalB: number;
  /** Mirror-invariant identity of this partition. */
  key: string;
}

export interface BalanceResult {
  candidates: TeamSplit[];
  totalValid: number;
  exact: boolean;
}

/** Above this many players we refuse exact enumeration (would be too large). */
const EXACT_LIMIT = 20;

export class BalanceError extends Error {}

function canonicalKey(a: string[], b: string[]): string {
  const sa = [...a].sort().join(',');
  const sb = [...b].sort().join(',');
  return sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
}

/** Yield every size-k subset of [0..n-1], as arrays of indices. */
function* combinations(n: number, k: number): Generator<number[]> {
  if (k < 0 || k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.slice();
    // advance like an odometer
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

export function balanceTeams(players: BalancePlayer[], options: BalanceOptions = {}): BalanceResult {
  const n = players.length;
  if (n < 2) {
    throw new BalanceError('Need at least 2 players to form teams.');
  }
  if (n > EXACT_LIMIT) {
    throw new BalanceError(
      `Too many players (${n}). Exact balancing supports up to ${EXACT_LIMIT}.`,
    );
  }

  const ids = players.map((p) => p.id);
  const mmr = players.map((p) => p.mmr);
  const idToIndex = new Map(ids.map((id, i) => [id, i]));

  // Keep only constraints whose both members are actually in the selected set.
  const selected = new Set(ids);
  const sameTeam = (options.constraints?.sameTeam ?? []).filter(
    (c) => selected.has(c.a) && selected.has(c.b) && c.a !== c.b,
  );
  const oppositeTeam = (options.constraints?.oppositeTeam ?? []).filter(
    (c) => selected.has(c.a) && selected.has(c.b) && c.a !== c.b,
  );

  // Determine the size of the anchor team (the team that always contains players[0]).
  let anchorSizes: number[];
  if (options.teamSize != null) {
    if (n !== options.teamSize * 2) {
      throw new BalanceError(
        `teamSize=${options.teamSize} requires exactly ${options.teamSize * 2} players, got ${n}.`,
      );
    }
    anchorSizes = [options.teamSize];
  } else {
    const floorS = Math.floor(n / 2);
    const ceilS = Math.ceil(n / 2);
    anchorSizes = floorS === ceilS ? [floorS] : [floorS, ceilS];
  }

  const excluded = new Set(options.excludeKeys ?? []);
  const seen = new Set<string>();
  const all: TeamSplit[] = [];

  const round2 = (x: number) => Math.round(x * 100) / 100;

  for (const anchorSize of anchorSizes) {
    // Team A = { index 0 } ∪ (anchorSize-1 indices chosen from 1..n-1).
    for (const combo of combinations(n - 1, anchorSize - 1)) {
      const inA = new Array<boolean>(n).fill(false);
      inA[0] = true;
      for (const c of combo) inA[c + 1] = true;

      // Constraint checks.
      let ok = true;
      for (const { a, b } of sameTeam) {
        if (inA[idToIndex.get(a)!] !== inA[idToIndex.get(b)!]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        for (const { a, b } of oppositeTeam) {
          if (inA[idToIndex.get(a)!] === inA[idToIndex.get(b)!]) {
            ok = false;
            break;
          }
        }
      }
      if (!ok) continue;

      const teamA: string[] = [];
      const teamB: string[] = [];
      let totalA = 0;
      let totalB = 0;
      for (let i = 0; i < n; i++) {
        if (inA[i]) {
          teamA.push(ids[i]!);
          totalA += mmr[i]!;
        } else {
          teamB.push(ids[i]!);
          totalB += mmr[i]!;
        }
      }

      const key = canonicalKey(teamA, teamB);
      if (seen.has(key)) continue; // guards the floor/ceil overlap edge cases
      seen.add(key);

      const avgA = totalA / teamA.length;
      const avgB = totalB / teamB.length;
      all.push({
        teamA,
        teamB,
        avgA: round2(avgA),
        avgB: round2(avgB),
        avgDiff: round2(Math.abs(avgA - avgB)),
        totalA,
        totalB,
        key,
      });
    }
  }

  // Best-first: smallest average gap, then smallest total gap, then stable by key.
  all.sort(
    (x, y) =>
      x.avgDiff - y.avgDiff ||
      Math.abs(x.totalA - x.totalB) - Math.abs(y.totalA - y.totalB) ||
      (x.key < y.key ? -1 : 1),
  );

  const candidates = all.filter((s) => !excluded.has(s.key));
  const maxResults = options.maxResults ?? 5;

  return {
    candidates: candidates.slice(0, maxResults),
    totalValid: all.length,
    exact: true,
  };
}
