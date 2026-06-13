import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMatches } from '../api/client';
import type { MatchRecord, Player } from '../api/types';

/*
    A player's inhouse history, built entirely from the matches already in cache
    (each confirmed match stores every participant's before/after/delta), so this
    needs no new endpoint. Only CONFIRMED games are shown: reversed games had
    their delta undone, so they no longer count toward the player's standing.
*/

interface GameLine {
  id: string;
  name?: string;
  when: string;
  side: 'A' | 'B';
  won: boolean;
  before: number;
  after: number;
  delta: number;
}

function buildHistory(matches: MatchRecord[], playerId: string): GameLine[] {
  const lines: GameLine[] = [];
  for (const m of matches) {
    if (m.status !== 'confirmed') continue;
    const inA = m.teamA.find((e) => e.player === playerId);
    const entry = inA ?? m.teamB.find((e) => e.player === playerId);
    if (!entry || entry.before == null || entry.after == null) continue;
    const side: 'A' | 'B' = inA ? 'A' : 'B';
    lines.push({
      id: m._id,
      name: m.name,
      when: m.confirmedAt ?? m.createdAt,
      side,
      won: m.winner === side,
      before: entry.before,
      after: entry.after,
      delta: entry.delta ?? entry.after - entry.before,
    });
  }
  // Newest first.
  return lines.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
}

export function PlayerHistoryModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const { data: matches } = useQuery({ queryKey: ['matches'], queryFn: getMatches });
  const games = useMemo(() => buildHistory(matches ?? [], player.id), [matches, player.id]);

  const net = games.reduce((s, g) => s + g.delta, 0);
  const wins = games.filter((g) => g.won).length;
  const losses = games.length - wins;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-4 sm:p-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white">{player.displayName}</h3>
            <p className="text-xs text-slate-400">
              MMR <span className="font-semibold text-indigo-300">{player.effectiveMmr}</span> · ±{player.rd} ·{' '}
              {player.wins}W {player.losses}L over {player.gamesPlayed} games
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" title="Close">
            ✕
          </button>
        </div>

        {games.length === 0 ? (
          <p className="text-sm text-slate-500">No confirmed inhouse games yet.</p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-4 text-xs text-slate-400">
              <span>
                Last {games.length} game{games.length === 1 ? '' : 's'}: {wins}W {losses}L
              </span>
              <span>
                Net{' '}
                <span className={net >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-rose-400'}>
                  {net >= 0 ? `+${net}` : net}
                </span>{' '}
                MMR
              </span>
            </div>
            <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {games.map((g) => (
                <li
                  key={g.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        g.won
                          ? 'bg-emerald-900/40 text-emerald-300'
                          : 'bg-rose-900/40 text-rose-300'
                      }`}
                    >
                      {g.won ? 'WIN' : 'LOSS'}
                    </span>
                    <span className="text-slate-300">{g.name ?? 'Match'}</span>
                    <span className="text-xs text-slate-600">Team {g.side}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-slate-500">
                      {g.before}→{g.after}
                    </span>
                    <span className={g.delta >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-rose-400'}>
                      {g.delta >= 0 ? `+${g.delta}` : g.delta}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-slate-600">{new Date(games[0]!.when).toLocaleString()} — most recent</p>
          </>
        )}
      </div>
    </div>
  );
}
