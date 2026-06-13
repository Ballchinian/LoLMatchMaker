import type { Player } from '../../api/types';
import { RankBadge } from '../RankBadge';
import { Value, type Side } from './shared';

//One team's drop zone: its roster, average, and per-row move buttons.
export function TeamPanel({
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

//The unassigned-but-selected pool; drop target and source for the teams.
export function Bench({
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
                <span className="text-indigo-300">{p.effectiveMmr}</span>
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
            {ids.length === 0 && <span className="text-xs text-slate-600">empty, drop players here to bench them</span>}
        </div>
        </div>
    );
}
