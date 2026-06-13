import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, balanceTeams, createMatch, getPlayers } from '../api/client';
import { useSelection } from '../store/useSelection';
import { usePrivileged } from '../lib/usePrivileged';
import { Card, btnGhost, btnPrimary, inputCls as selectCls } from '../components/ui';
import { PlayerPicker } from '../components/teamBuilder/PlayerPicker';
import { Constraints } from '../components/teamBuilder/Constraints';
import { TeamPanel, Bench } from '../components/teamBuilder/TeamPanels';
import { useDragAssign } from '../components/teamBuilder/useDragAssign';
import { totalOf } from '../components/teamBuilder/shared';

export default function TeamBuilderPage() {
  const qc = useQueryClient();
  const privileged = usePrivileged();
  const { data: players } = useQuery({ queryKey: ['players'], queryFn: getPlayers });
  const { selectedIds, toggle, sameTeam, oppositeTeam, excludeKeys, addExcludeKey, resetExcludeKeys } =
    useSelection();

  const [totalValid, setTotalValid] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Public-submission fields: who the proposer is (required, one open proposal each) + the winner they claim.
  const [reportedBy, setReportedBy] = useState('');
  const [proposed, setProposed] = useState<'A' | 'B' | ''>('');
  const [proposerId, setProposerId] = useState('');

  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players]);

  // Assignment + the press-hold-drag interaction live in this hook.
  const { assign, setAssign, bench, moveTo, drag, zoneA, zoneB, zoneBench, onGrab } = useDragAssign(
    selectedIds,
    toggle,
  );

  const balance = useMutation({
    mutationFn: (exclude: string[]) =>
      balanceTeams({
        playerIds: selectedIds,
        constraints: { sameTeam, oppositeTeam },
        excludeKeys: exclude,
      }),
    onSuccess: (res) => {
      const c = res.candidates[0];
      if (c) {
        setAssign({ a: c.teamA, b: c.teamB });
        addExcludeKey(c.key);
      }
      setTotalValid(res.totalValid);
      setNotice(null);
    },
    onError: (err) => setNotice(apiErrorMessage(err)),
  });

  const save = useMutation({
    mutationFn: (opts: {
      winner?: 'A' | 'B';
      proposedWinner?: 'A' | 'B';
      reportedBy?: string;
      proposedByPlayerId?: string;
    }) => createMatch({ teamA: assign.a, teamB: assign.b, ...opts }),
    onSuccess: (data, opts) => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      const lobby = data.match.name ? ` "${data.match.name}"` : '';
      if (opts.winner) {
        qc.invalidateQueries({ queryKey: ['players'] });
        setNotice(`Confirmed — Team ${opts.winner} won. MMR updated.`);
      } else {
        setNotice(
          privileged
            ? `Saved as proposed lobby${lobby} — confirm the winner from the Matches tab.`
            : `Match proposed${lobby} — start it from Discord with /match setup, or wait for an admin. You can delete your own proposal from the Matches tab.`,
        );
      }
      setAssign({ a: [], b: [] });
      setReportedBy('');
      setProposed('');
      setProposerId('');
      resetExcludeKeys();
    },
    onError: (err) => setNotice(apiErrorMessage(err)),
  });

  const canBalance = selectedIds.length >= 2;
  const teamsReady = assign.a.length > 0 && assign.b.length > 0;

  // Both teams' averages divide by the LARGER team's size, matching the server
  // (a short-handed team isn't rated as the equal of a full one).
  const divisor = Math.max(assign.a.length, assign.b.length, 1);
  const avgA = Math.round(totalOf(assign.a, byId) / divisor);
  const avgB = Math.round(totalOf(assign.b, byId) / divisor);
  const gap = Math.abs(avgA - avgB);

  const dragPlayer = drag ? byId.get(drag.id) : null;

  const generate = () => {
    resetExcludeKeys();
    balance.mutate([]);
  };
  const reRoll = () => balance.mutate(excludeKeys);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-5">
        {players && <PlayerPicker players={players} />}
        <Constraints byId={byId} />
      </div>

      <div className="space-y-5">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <button className={btnPrimary} onClick={generate} disabled={!canBalance || balance.isPending}>
              {balance.isPending ? 'Balancing…' : 'Auto-balance'}
            </button>
            <button className={btnGhost} onClick={reRoll} disabled={!canBalance || balance.isPending}>
              Re-roll (no repeat)
            </button>
            {(assign.a.length > 0 || assign.b.length > 0) && (
              <button className={btnGhost} onClick={() => setAssign({ a: [], b: [] })}>
                Clear teams
              </button>
            )}
            {!canBalance && <span className="text-sm text-slate-500">Pick at least 2 players.</span>}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Auto-balance fills the teams fairly; then drag players between the team boxes and the bench
            (click a team player to bench them, click a bench player to unselect them). The ⇄ / ↧ / →A /
            →B buttons still work too.
          </p>
          {notice && <p className="mt-2 text-sm text-amber-300">{notice}</p>}
        </Card>

        {(assign.a.length > 0 || assign.b.length > 0 || bench.length > 0) && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Fairness</p>
                <p className="text-2xl font-black text-white">
                  {gap.toFixed(0)}
                  <span className="ml-1 text-sm font-medium text-slate-400">avg MMR gap</span>
                </p>
              </div>
              <div className="text-right text-xs text-slate-400">
                {totalValid > 0 && <p>{totalValid} valid splits</p>}
                <p>{excludeKeys.length} auto-rolls shown</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <TeamPanel
                label="Team A"
                side="a"
                ids={assign.a}
                avg={avgA}
                byId={byId}
                highlight="border-sky-700/40"
                dragId={drag?.id ?? null}
                dropActive={drag?.over === 'a'}
                zoneRef={zoneA}
                onGrab={onGrab}
                onMove={moveTo}
              />
              <TeamPanel
                label="Team B"
                side="b"
                ids={assign.b}
                avg={avgB}
                byId={byId}
                highlight="border-rose-700/40"
                dragId={drag?.id ?? null}
                dropActive={drag?.over === 'b'}
                zoneRef={zoneB}
                onGrab={onGrab}
                onMove={moveTo}
              />
            </div>

            <div className="mt-3">
              <Bench
                ids={bench}
                byId={byId}
                dragId={drag?.id ?? null}
                dropActive={drag?.over === 'bench'}
                zoneRef={zoneBench}
                onGrab={onGrab}
                onMove={moveTo}
              />
            </div>

            {privileged ? (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Record result</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className={btnGhost}
                    disabled={!teamsReady || save.isPending}
                    onClick={() => {
                      if (window.confirm('Record Team A as the winner? MMR is applied immediately (reversible from the Matches tab).')) save.mutate({ winner: 'A' });
                    }}
                  >
                    Team A won
                  </button>
                  <button
                    className={btnGhost}
                    disabled={!teamsReady || save.isPending}
                    onClick={() => {
                      if (window.confirm('Record Team B as the winner? MMR is applied immediately (reversible from the Matches tab).')) save.mutate({ winner: 'B' });
                    }}
                  >
                    Team B won
                  </button>
                  <span className="text-slate-600">·</span>
                  <button className={btnPrimary} disabled={!teamsReady || save.isPending} onClick={() => save.mutate({})}>
                    Save as pending
                  </button>
                  {!teamsReady && <span className="text-xs text-slate-500">Both teams need a player.</span>}
                </div>
                {save.isError && <p className="mt-2 text-sm text-rose-400">{apiErrorMessage(save.error)}</p>}
                <p className="mt-2 text-xs text-slate-500">
                  Confirming applies MMR immediately. "Save as pending" locks the matchup for confirmation later.
                </p>
              </div>
            ) : (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Propose this match</p>
                <p className="mb-3 text-xs text-slate-500">
                  Propose this matchup as a game to play. Pick which player YOU are, non-admins can
                  have one open proposal at a time, and you can delete your own proposal from the
                  Matches tab. The lobby starts it from Discord with /match setup.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500">I am:</span>
                  <select className={selectCls} value={proposerId} onChange={(e) => setProposerId(e.target.value)}>
                    <option value="">Pick yourself…</option>
                    {[...assign.a, ...assign.b].map((id) => (
                      <option key={id} value={id}>
                        {byId.get(id)?.displayName ?? id}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-500">Reported by:</span>
                  <input
                    className={`${selectCls} w-40`}
                    value={reportedBy}
                    onChange={(e) => setReportedBy(e.target.value)}
                    placeholder="your name (optional)"
                  />
                  <span className="text-xs text-slate-500">Winner you claim:</span>
                  <select className={selectCls} value={proposed} onChange={(e) => setProposed(e.target.value as 'A' | 'B' | '')}>
                    <option value="">Undecided (not played yet)</option>
                    <option value="A">Team A</option>
                    <option value="B">Team B</option>
                  </select>
                  <button
                    className={btnPrimary}
                    disabled={!teamsReady || !proposerId || save.isPending}
                    onClick={() =>
                      save.mutate({
                        proposedWinner: proposed || undefined,
                        reportedBy: reportedBy.trim() || undefined,
                        proposedByPlayerId: proposerId,
                      })
                    }
                  >
                    Propose match
                  </button>
                  {!teamsReady && <span className="text-xs text-slate-500">Both teams need a player.</span>}
                  {teamsReady && !proposerId && (
                    <span className="text-xs text-slate-500">Pick which player you are.</span>
                  )}
                </div>
                {save.isError && <p className="mt-2 text-sm text-rose-400">{apiErrorMessage(save.error)}</p>}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Floating ghost of the player being dragged. */}
      {drag && dragPlayer && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-full border border-indigo-400 bg-slate-900 px-3 py-1.5 text-sm shadow-lg shadow-indigo-950/50"
          style={{ left: drag.x + 10, top: drag.y + 10 }}
        >
          <span className="font-medium text-white">{dragPlayer.displayName}</span>
          <span className="text-indigo-300">{dragPlayer.effectiveMmr}</span>
        </div>
      )}
    </div>
  );
}
