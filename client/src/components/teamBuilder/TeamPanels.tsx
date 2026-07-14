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
    heldId,
    dropActive,
    zoneRef,
    onGrab,
    onMove,
    onZoneTap,
    onRowTap,
}: {
    label: string;
    side: 'a' | 'b';
    ids: string[];
    avg: number;
    byId: Map<string, Player>;
    highlight: string;
    dragId: string | null;
    heldId: string | null;
    dropActive: boolean;
    zoneRef: React.RefObject<HTMLDivElement | null>;
    onGrab: (e: React.PointerEvent, id: string, from: Side) => void;
    onMove: (id: string, target: Side) => void;
    onZoneTap: (target: Side) => void;
    onRowTap: (id: string, from: Side) => void;
}) {
    const other: Side = side === 'a' ? 'b' : 'a';
    return (
        <div
        ref={zoneRef}
        onClick={() => onZoneTap(side)}
        //cursor-pointer below sm: iOS Safari only delivers click events on
        //elements it considers clickable, and this CSS is what marks them.
        className={`flex-1 cursor-pointer rounded-xl border sm:cursor-auto ${highlight} bg-slate-950/40 p-4 transition ${
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
                //stopPropagation: a row tap must not bubble into the zone tap
                //(it would instantly re-place the player).
                onClick={(e) => {
                    e.stopPropagation();
                    onRowTap(id, side);
                }}
                title="Drag to a team or the bench · click to send to bench"
                className={`flex cursor-pointer select-none items-center gap-2 rounded-lg bg-slate-900/50 px-2 py-1.5 sm:cursor-grab ${
                    dragId === id ? 'opacity-30' : ''
                } ${heldId === id ? 'ring-2 ring-indigo-400/80' : ''}`}
                >
                <span className="flex-1 truncate text-sm text-slate-200">{p.displayName}</span>
                <RankBadge rank={p.rank} size="sm" />
                <Value player={p} />
                <button
                    className="hidden rounded border border-slate-700 px-1.5 text-xs text-slate-400 hover:text-white sm:block"
                    title={`Move to ${other === 'a' ? 'Team A' : 'Team B'}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onMove(id, other)}
                >
                    ⇄
                </button>
                <button
                    className="hidden rounded border border-slate-700 px-1.5 text-xs text-slate-400 hover:text-white sm:block"
                    title="Send to bench"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onMove(id, 'bench')}
                >
                    ↧
                </button>
                </li>
            );
            })}
            {ids.length === 0 && <li className="px-1 py-2 text-xs text-slate-600">empty, drop or tap players here</li>}
        </ul>
        </div>
    );
}

//The unassigned-but-selected pool; drop target and source for the teams.
export function Bench({
    ids,
    byId,
    dragId,
    heldId,
    dropActive,
    zoneRef,
    onGrab,
    onMove,
    onZoneTap,
    onRowTap,
}: {
    ids: string[];
    byId: Map<string, Player>;
    dragId: string | null;
    heldId: string | null;
    dropActive: boolean;
    zoneRef: React.RefObject<HTMLDivElement | null>;
    onGrab: (e: React.PointerEvent, id: string, from: Side) => void;
    onMove: (id: string, target: Side) => void;
    onZoneTap: (target: Side) => void;
    onRowTap: (id: string, from: Side) => void;
}) {
    return (
        <div
        ref={zoneRef}
        onClick={() => onZoneTap('bench')}
        //cursor-pointer below sm: see TeamPanel (iOS clickability).
        className={`cursor-pointer rounded-xl border border-slate-800 bg-slate-950/30 p-3 transition sm:cursor-auto ${
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
                //stopPropagation: a row tap must not bubble into the zone tap
                //(it would instantly re-place the player).
                onClick={(e) => {
                    e.stopPropagation();
                    onRowTap(id, 'bench');
                }}
                title="Drag to a team · click to unselect"
                className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-xs sm:cursor-grab ${
                    dragId === id ? 'opacity-30' : ''
                } ${heldId === id ? 'ring-2 ring-indigo-400/80' : ''}`}
                >
                <span className="text-slate-200">{p.displayName}</span>
                <span className="text-indigo-300">{p.effectiveMmr}</span>
                <button
                    className="hidden text-sky-400 hover:text-sky-300 sm:block"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onMove(id, 'a')}
                    title="To Team A"
                >
                    →A
                </button>
                <button
                    className="hidden text-rose-400 hover:text-rose-300 sm:block"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onMove(id, 'b')}
                    title="To Team B"
                >
                    →B
                </button>
                </span>
            );
            })}
            {ids.length === 0 && <span className="text-xs text-slate-600">empty, drop or tap players here to bench them</span>}
        </div>
        </div>
    );
}
