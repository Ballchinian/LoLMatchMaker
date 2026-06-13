import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assignment, DragState, Side } from './shared';

/*
    Owns the A/B/bench assignment plus the press-hold-drag interaction.

    keeps the assignment in sync with the selection pool (drops deselected players)
    - `moveTo` shuffles a player between Team A / Team B / the bench
    - `onGrab`: past a small movement threshold a player is "picked up" (a ghost
    follows the pointer) and can be dropped on a zone; a plain click instead
    benches a team player, or unselects a bench player. Row buttons stopPropagation.
*/
export function useDragAssign(selectedIds: string[], toggle: (id: string) => void) {
    const [assign, setAssign] = useState<Assignment>({ a: [], b: [] });
    const [drag, setDrag] = useState<DragState | null>(null);
    const zoneA = useRef<HTMLDivElement | null>(null);
    const zoneB = useRef<HTMLDivElement | null>(null);
    const zoneBench = useRef<HTMLDivElement | null>(null);

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

    return { assign, setAssign, bench, moveTo, drag, zoneA, zoneB, zoneBench, onGrab };
}
