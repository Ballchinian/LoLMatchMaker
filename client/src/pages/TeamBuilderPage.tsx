import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

/** Live pointer-drag state (only set once the press moves past the threshold). */
interface DragState {
  id: string;
  x: number;
  y: number;
  over: Side | null;
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

/** A player's matchmaking value (MMR minus versatility penalty) for display. */
function Value({ player }: { player: Player }) {
  if (player.flexPenalty > 0) {
    return (
      <span
        className="w-12 text-right font-semibold text-amber-300"
        title={`MMR ${player.mmr} − ${player.flexPenalty} versatility penalty`}
      >
        {player.effectiveMmr}
      </span>
    );
  }
  return <span className="w-12 text-right font-semibold text-indigo-300">{player.effectiveMmr}</span>;
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
              <Value player={p} />
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

function totalOf(ids: string[], byId: Map<string, Player>): number {
  return ids.reduce((s, id) => s + (byId.get(id)?.effectiveMmr ?? 0), 0);
}

function TeamPanel({
  label,
  side,
  ids,
  avg,
  byId,
  highlight,
  dragId,
  dropActive,
  zoneRef,
  onGrab,
  onMove,
}: {
  label: string;
  side: 'a' | 'b';
  ids: string[];
  avg: number;
  byId: Map<string, Player>;
  highlight: string;
  dragId: string | null;
  dropActive: boolean;
  zoneRef: React.RefObject<HTMLDivElement | null>;
  onGrab: (e: React.PointerEvent, id: string, from: Side) => void;
  onMove: (id: string, target: Side) => void;
}) {
  const other: Side = side === 'a' ? 'b' : 'a';
  return (
    <div
      ref={zoneRef}
      className={`flex-1 rounded-xl border ${highlight} bg-slate-950/40 p-4 transition ${
        dropActive ? 'ring-2 ring-indigo-400/70 bg-indigo-500/10' : ''
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="font-bold text-white">{label}</h4>
        <span className="text-xs text-slate-400">
          {ids.length} · avg <span className="font-bold text-indigo-300">{avg}</span>
        </span>
      </div>
      <ul className="space-y-1.5">
        {ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <li
              key={id}
              onPointerDown={(e) => onGrab(e, id, side)}
              title="Drag to a team or the bench · click to send to bench"
              className={`flex cursor-grab select-none touch-none items-center gap-2 rounded-lg bg-slate-900/50 px-2 py-1.5 ${
                dragId === id ? 'opacity-30' : ''
              }`}
            >
              <span className="flex-1 truncate text-sm text-slate-200">{p.displayName}</span>
              <RankBadge rank={p.rank} size="sm" />
              <Value player={p} />
              <button
                className="rounded border border-slate-700 px-1.5 text-xs text-slate-400 hover:text-white"
                title={`Move to ${other === 'a' ? 'Team A' : 'Team B'}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onMove(id, other)}
              >
                ⇄
              </button>
              <button
                className="rounded border border-slate-700 px-1.5 text-xs text-slate-400 hover:text-white"
                title="Send to bench"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onMove(id, 'bench')}
              >
                ↧
              </button>
            </li>
          );
        })}
        {ids.length === 0 && <li className="px-1 py-2 text-xs text-slate-600">empty — drop players here</li>}
      </ul>
    </div>
  );
}

function Bench({
  ids,
  byId,
  dragId,
  dropActive,
  zoneRef,
  onGrab,
  onMove,
}: {
  ids: string[];
  byId: Map<string, Player>;
  dragId: string | null;
  dropActive: boolean;
  zoneRef: React.RefObject<HTMLDivElement | null>;
  onGrab: (e: React.PointerEvent, id: string, from: Side) => void;
  onMove: (id: string, target: Side) => void;
}) {
  return (
    <div
      ref={zoneRef}
      className={`rounded-xl border border-slate-800 bg-slate-950/30 p-3 transition ${
        dropActive ? 'ring-2 ring-indigo-400/70 bg-indigo-500/10' : ''
      }`}
    >
      <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Bench ({ids.length})</p>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => {
          const p = byId.get(id);
          if (!p) return null;
          return (
            <span
              key={id}
              onPointerDown={(e) => onGrab(e, id, 'bench')}
              title="Drag to a team · click to unselect"
              className={`inline-flex cursor-grab select-none touch-none items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs ${
                dragId === id ? 'opacity-30' : ''
              }`}
            >
              <span className="text-slate-200">{p.displayName}</span>
              <span className={p.flexPenalty > 0 ? 'text-amber-300' : 'text-indigo-300'}>
                {p.effectiveMmr}
              </span>
              <button
                className="text-sky-400 hover:text-sky-300"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onMove(id, 'a')}
                title="To Team A"
              >
                →A
              </button>
              <button
                className="text-rose-400 hover:text-rose-300"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onMove(id, 'b')}
                title="To Team B"
              >
                →B
              </button>
            </span>
          );
        })}
        {ids.length === 0 && <span className="text-xs text-slate-600">empty — drop players here to bench them</span>}
      </div>
    </div>
  );
}

/* ------------------------------- Page ---------------------------------- */

export default function TeamBuilderPage() {
  const qc = useQueryClient();
  const privileged = usePrivileged();
  const { data: players } = useQuery({ queryKey: ['players'], queryFn: getPlayers });
  const { selectedIds, toggle, sameTeam, oppositeTeam, excludeKeys, addExcludeKey, resetExcludeKeys } =
    useSelection();

  const [assign, setAssign] = useState<Assignment>({ a: [], b: [] });
  const [totalValid, setTotalValid] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Public-submission fields (reporter's name + the winner they claim).
  const [reportedBy, setReportedBy] = useState('');
  const [proposed, setProposed] = useState<'A' | 'B' | ''>('');

  // Press-hold-drag state. Zones are hit-tested against these refs.
  const [drag, setDrag] = useState<DragState | null>(null);
  const zoneA = useRef<HTMLDivElement | null>(null);
  const zoneB = useRef<HTMLDivElement | null>(null);
  const zoneBench = useRef<HTMLDivElement | null>(null);

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

  const zoneAt = (x: number, y: number): Side | null => {
    const zones: [Side, HTMLDivElement | null][] = [
      ['a', zoneA.current],
      ['b', zoneB.current],
      ['bench', zoneBench.current],
    ];
    for (const [side, el] of zones) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return side;
    }
    return null;
  };

  /**
   * Press, hold & drag: past a small threshold the player is "picked up" (ghost
   * follows the pointer) and can be dropped on Team A / Team B / the bench.
   * A plain click instead sends a team player to the bench, or unselects a
   * bench player entirely. Row buttons stop propagation, so they win.
   */
  const onGrab = (e: React.PointerEvent, id: string, from: Side) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onPointerMove = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) started = true;
      if (started) {
        setDrag({ id, x: ev.clientX, y: ev.clientY, over: zoneAt(ev.clientX, ev.clientY) });
      }
    };
    const onPointerUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      setDrag(null);
      if (ev.type === 'pointercancel') return;
      if (started) {
        const over = zoneAt(ev.clientX, ev.clientY);
        if (over) moveTo(id, over);
      } else if (from === 'bench') {
        toggle(id); // unselect from "Pick players" (and therefore the bench)
      } else {
        moveTo(id, 'bench');
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

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
    onSuccess: (data, opts) => {
      qc.invalidateQueries({ queryKey: ['matches'] });
      const lobby = data.match.name ? ` "${data.match.name}"` : '';
      if (opts.winner) {
        qc.invalidateQueries({ queryKey: ['players'] });
        setNotice(`Confirmed — Team ${opts.winner} won. MMR updated.`);
      } else {
        setNotice(
          privileged
            ? `Saved as pending lobby${lobby} — confirm the winner from the Matches tab.`
            : `Submitted for review${lobby} — an admin will confirm it from the Matches tab.`,
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

      {/* Floating ghost of the player being dragged. */}
      {drag && dragPlayer && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-full border border-indigo-400 bg-slate-900 px-3 py-1.5 text-sm shadow-lg shadow-indigo-950/50"
          style={{ left: drag.x + 10, top: drag.y + 10 }}
        >
          <span className="font-medium text-white">{dragPlayer.displayName}</span>
          <span className={dragPlayer.flexPenalty > 0 ? 'text-amber-300' : 'text-indigo-300'}>
            {dragPlayer.effectiveMmr}
          </span>
        </div>
      )}
    </div>
  );
}
