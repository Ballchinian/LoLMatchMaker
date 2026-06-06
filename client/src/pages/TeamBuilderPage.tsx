import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, balanceTeams, createMatch, getPlayers } from '../api/client';
import type { Player } from '../api/types';
import { RankBadge } from '../components/RankBadge';
import { TagFilterBar } from '../components/TagFilterBar';
import { matchesTagFilter } from '../lib/tags';
import { useSelection, type ConstraintType } from '../store/useSelection';
import { usePrivileged } from '../lib/usePrivileged';

type Side = 'a' | 'b' | 'bench';
interface Assignment {
  a: string[];
  b: string[];
}

const btnPrimary =
  'rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50';
const btnGhost =
  'rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 disabled:opacity-50';
const selectCls =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500';

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-5 ${className}`}>{children}</div>
  );
}

/* --------------------------- Player picker ----------------------------- */

function PlayerPicker({ players }: { players: Player[] }) {
  const { selectedIds, toggle, selectMany, clear } = useSelection();
  const [filter, setFilter] = useState<Set<string>>(new Set());

  const toggleFilter = (key: string) =>
    setFilter((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const visible = useMemo(() => players.filter((p) => matchesTagFilter(p, filter)), [players, filter]);

  return (
    <Card className="p-0">
      <div className="space-y-2 border-b border-slate-800 px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Pick players ({selectedIds.length} selected)
          </h3>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="text-indigo-300 hover:text-indigo-200"
              onClick={() => selectMany(visible.map((p) => p.id))}
            >
              Select shown ({visible.length})
            </button>
            {selectedIds.length > 0 && (
              <button type="button" className="text-slate-400 hover:text-white" onClick={clear}>
                Clear
              </button>
            )}
          </div>
        </div>
        <TagFilterBar players={players} selected={filter} onToggle={toggleFilter} onClear={() => setFilter(new Set())} />
      </div>
      <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-800">
        {visible.map((p) => {
          const active = selectedIds.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              className={`flex w-full items-center gap-3 px-5 py-2.5 text-left transition ${
                active ? 'bg-indigo-500/10' : 'hover:bg-slate-800/40'
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${
                  active ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-slate-600 text-transparent'
                }`}
              >
                ✓
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium text-white">{p.displayName}</span>
                {p.tags.length > 0 && (
                  <span className="block truncate text-xs text-slate-500">{p.tags.join(' · ')}</span>
                )}
              </span>
              <RankBadge rank={p.rank} size="sm" />
              <span className="w-12 text-right font-semibold text-indigo-300">{p.mmr}</span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <p className="px-5 py-6 text-sm text-slate-500">No players match the selected tags.</p>
        )}
      </div>
    </Card>
  );
}

/* ---------------------------- Constraints ------------------------------ */

function Constraints({ byId }: { byId: Map<string, Player> }) {
  const { selectedIds, sameTeam, oppositeTeam, addConstraint, removeConstraint } = useSelection();
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  const name = (id: string) => byId.get(id)?.displayName ?? id;
  const options = selectedIds;

  const add = (type: ConstraintType) => {
    if (a && b && a !== b) addConstraint(type, a, b);
  };

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Constraints</h3>
      {selectedIds.length < 2 ? (
        <p className="text-sm text-slate-500">Select at least two players to add constraints.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectCls} value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">Player A…</option>
              {options.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
            <select className={selectCls} value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">Player B…</option>
              {options.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
            <button className={btnGhost} onClick={() => add('same')} type="button">
              Same team
            </button>
            <button className={btnGhost} onClick={() => add('opposite')} type="button">
              Opposite teams
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {sameTeam.map((p, i) => (
              <Chip key={`s${i}`} color="emerald" onRemove={() => removeConstraint('same', i)}>
                {name(p[0])} = {name(p[1])}
              </Chip>
            ))}
            {oppositeTeam.map((p, i) => (
              <Chip key={`o${i}`} color="rose" onRemove={() => removeConstraint('opposite', i)}>
                {name(p[0])} ⨯ {name(p[1])}
              </Chip>
            ))}
            {sameTeam.length === 0 && oppositeTeam.length === 0 && (
              <p className="text-sm text-slate-500">No constraints — fully free balancing.</p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function Chip({
  children,
  color,
  onRemove,
}: {
  children: ReactNode;
  color: 'emerald' | 'rose';
  onRemove: () => void;
}) {
  const cls =
    color === 'emerald'
      ? 'border-emerald-700/50 bg-emerald-900/30 text-emerald-200'
      : 'border-rose-700/50 bg-rose-900/30 text-rose-200';
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${cls}`}>
      {children}
      <button onClick={onRemove} className="text-slate-400 hover:text-white" title="Remove">
        ✕
      </button>
    </span>
  );
}

/* ------------------------------ Team view ------------------------------ */

function avgOf(ids: string[], byId: Map<string, Player>): number {
  if (ids.length === 0) return 0;
  return Math.round(ids.reduce((s, id) => s + (byId.get(id)?.mmr ?? 0), 0) / ids.length);
}

function TeamPanel({
  label,
  side,
  ids,
  byId,
  highlight,
  onMove,
}: {
  label: string;
  side: 'a' | 'b';
  ids: string[];
  byId: Map<string, Player>;
  highlight: string;
  onMove: (id: string, target: Side) => void;
}) {
  const other: Side = side === 'a' ? 'b' : 'a';
  return (
    <div className={`flex-1 rounded-xl border ${highlight} bg-slate-950/40 p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-bold text-white">{label}</h4>
        <span className="text-xs text-slate-400">
          {ids.length} · avg <span className="font-bold text-indigo-300">{avgOf(ids, byId)}</span>
        </span>
      </div>
      <ul className="space-y-1.5">
        {ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <li key={id} className="flex items-center gap-2 rounded-lg bg-slate-900/50 px-2 py-1.5">
              <span className="flex-1 truncate text-sm text-slate-200">{p.displayName}</span>
              <RankBadge rank={p.rank} size="sm" />
              <span className="w-10 text-right text-sm font-semibold text-indigo-300">{p.mmr}</span>
              <button
                className="rounded border border-slate-700 px-1.5 text-xs text-slate-400 hover:text-white"
                title={`Move to ${other === 'a' ? 'Team A' : 'Team B'}`}
                onClick={() => onMove(id, other)}
              >
                ⇄
              </button>
              <button
                className="rounded border border-slate-700 px-1.5 text-xs text-slate-400 hover:text-white"
                title="Send to bench"
                onClick={() => onMove(id, 'bench')}
              >
                ↧
              </button>
            </li>
          );
        })}
        {ids.length === 0 && <li className="px-1 py-2 text-xs text-slate-600">empty</li>}
      </ul>
    </div>
  );
}

function Bench({
  ids,
  byId,
  onMove,
}: {
  ids: string[];
  byId: Map<string, Player>;
  onMove: (id: string, target: Side) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
      <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Bench ({ids.length})</p>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <span key={id} className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs">
              <span className="text-slate-200">{p.displayName}</span>
              <span className="text-indigo-300">{p.mmr}</span>
              <button className="text-sky-400 hover:text-sky-300" onClick={() => onMove(id, 'a')} title="To Team A">
                →A
              </button>
              <button className="text-rose-400 hover:text-rose-300" onClick={() => onMove(id, 'b')} title="To Team B">
                →B
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------- Page ---------------------------------- */

export default function TeamBuilderPage() {
  const qc = useQueryClient();
  const privileged = usePrivileged();
  const { data: players } = useQuery({ queryKey: ['players'], queryFn: getPlayers });
  const { selectedIds, sameTeam, oppositeTeam, excludeKeys, addExcludeKey, resetExcludeKeys } =
    useSelection();

  const [assign, setAssign] = useState<Assignment>({ a: [], b: [] });
  const [totalValid, setTotalValid] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Public-submission fields (reporter's name + the winner they claim).
  const [reportedBy, setReportedBy] = useState('');
  const [proposed, setProposed] = useState<'A' | 'B' | ''>('');

  const byId = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players]);

  // Keep the A/B assignment in sync with the selection pool (drop deselected players).
  useEffect(() => {
    setAssign((prev) => ({
      a: prev.a.filter((id) => selectedIds.includes(id)),
      b: prev.b.filter((id) => selectedIds.includes(id)),
    }));
  }, [selectedIds]);

  const bench = useMemo(
    () => selectedIds.filter((id) => !assign.a.includes(id) && !assign.b.includes(id)),
    [selectedIds, assign],
  );

  const moveTo = (id: string, target: Side) =>
    setAssign((prev) => {
      const a = prev.a.filter((x) => x !== id);
      const b = prev.b.filter((x) => x !== id);
      if (target === 'a') a.push(id);
      if (target === 'b') b.push(id);
      return { a, b };
    });

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
    mutationFn: (opts: { winner?: 'A' | 'B'; proposedWinner?: 'A' | 'B'; reportedBy?: string }) =>
      createMatch({ teamA: assign.a, teamB: assign.b, ...opts }),
    onSuccess: (_data, opts) => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      if (opts.winner) {
        qc.invalidateQueries({ queryKey: ['players'] });
        setNotice(`Confirmed — Team ${opts.winner} won. MMR updated.`);
      } else {
        setNotice(
          privileged
            ? 'Saved as pending — confirm the winner from the Matches tab.'
            : 'Submitted for review — an admin will confirm it from the Matches tab.',
        );
      }
      setAssign({ a: [], b: [] });
      setReportedBy('');
      setProposed('');
      resetExcludeKeys();
    },
    onError: (err) => setNotice(apiErrorMessage(err)),
  });

  const canBalance = selectedIds.length >= 2;
  const teamsReady = assign.a.length > 0 && assign.b.length > 0;
  const gap = Math.abs(avgOf(assign.a, byId) - avgOf(assign.b, byId));

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
            Auto-balance fills the teams fairly; then drag players between sides with ⇄ / ↧ / →A / →B to
            build a custom matchup.
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
              <TeamPanel label="Team A" side="a" ids={assign.a} byId={byId} highlight="border-sky-700/40" onMove={moveTo} />
              <TeamPanel label="Team B" side="b" ids={assign.b} byId={byId} highlight="border-rose-700/40" onMove={moveTo} />
            </div>

            <div className="mt-3">
              <Bench ids={bench} byId={byId} onMove={moveTo} />
            </div>

            {privileged ? (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Record result</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={btnGhost} disabled={!teamsReady || save.isPending} onClick={() => save.mutate({ winner: 'A' })}>
                    Team A won
                  </button>
                  <button className={btnGhost} disabled={!teamsReady || save.isPending} onClick={() => save.mutate({ winner: 'B' })}>
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
                  Confirming applies Elo immediately. "Save as pending" locks the matchup for confirmation later.
                </p>
              </div>
            ) : (
              <div className="mt-4 border-t border-slate-800 pt-4">
                <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Submit for review</p>
                <p className="mb-3 text-xs text-slate-500">
                  Submit this matchup as a pending game. An admin reviews it and confirms the winner
                  (which applies MMR) or discards it.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${selectCls} w-40`}
                    value={reportedBy}
                    onChange={(e) => setReportedBy(e.target.value)}
                    placeholder="Your name (optional)"
                    maxLength={40}
                  />
                  <span className="text-xs text-slate-500">Winner you claim:</span>
                  <select className={selectCls} value={proposed} onChange={(e) => setProposed(e.target.value as 'A' | 'B' | '')}>
                    <option value="">Undecided</option>
                    <option value="A">Team A</option>
                    <option value="B">Team B</option>
                  </select>
                  <button
                    className={btnPrimary}
                    disabled={!teamsReady || save.isPending}
                    onClick={() =>
                      save.mutate({
                        proposedWinner: proposed || undefined,
                        reportedBy: reportedBy.trim() || undefined,
                      })
                    }
                  >
                    Submit for review
                  </button>
                  {!teamsReady && <span className="text-xs text-slate-500">Both teams need a player.</span>}
                </div>
                {save.isError && <p className="mt-2 text-sm text-rose-400">{apiErrorMessage(save.error)}</p>}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
