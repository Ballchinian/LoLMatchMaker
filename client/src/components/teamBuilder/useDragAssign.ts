import { useEffect, useMemo, useRef, useState } from 'react';
import type { Assignment, DragState, Side } from './shared';

/*
    Owns the A/B/bench assignment plus the two move interactions:

    keeps the assignment in sync with the selection pool (drops deselected players)
    - `moveTo` shuffles a player between Team A / Team B / the bench
    - Mouse (`onGrab`): past a small movement threshold a player is "picked up"
    (a ghost follows the pointer) and can be dropped on a zone; a plain click
    instead benches a team player, or unselects a bench player. Row buttons
    stopPropagation.
    - Touch: press-drag is unreliable on mobile browsers and fights page
    scrolling, so a tap HOLDS the player (`held`, via `onRowTap` from the row's
    onClick — the browser's native tap detection, NOT hand-rolled pointer
    tracking) and tapping a zone places them (`placeHeld`). `onGrab` records
    the pointer type so onClick can tell a mouse click (desktop shortcuts)
    from a tap.
*/
export function useDragAssign(selectedIds: string[], toggle: (id: string) => void) {
    const [assign, setAssign] = useState<Assignment>({ a: [], b: [] });
    const [drag, setDrag] = useState<DragState | null>(null);
    //Touch only: the tapped player waiting for a zone tap (null: nothing held).
    const [held, setHeld] = useState<string | null>(null);
    //What produced the current interaction; 'touch' by default so devices where
    //pointer events never fire still get the tap flow.
    const lastPointerType = useRef<string>('touch');
    const zoneA = useRef<HTMLDivElement | null>(null);
    const zoneB = useRef<HTMLDivElement | null>(null);
    const zoneBench = useRef<HTMLDivElement | null>(null);

    // Keep the A/B assignment in sync with the selection pool (drop deselected players).
    useEffect(() => {
        setAssign((prev) => ({
        a: prev.a.filter((id) => selectedIds.includes(id)),
        b: prev.b.filter((id) => selectedIds.includes(id)),
        }));
        setHeld((prev) => (prev && !selectedIds.includes(prev) ? null : prev));
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

    //Zone tap (touch): place the held player there, if one is held.
    const placeHeld = (target: Side) => {
        if (!held) return;
        moveTo(held, target);
        setHeld(null);
    };

    //Row tap (touch, from the row's onClick): pick the player up; tapping the
    //held player again puts them down. Mouse clicks are handled in onGrab.
    const onRowTap = (id: string, from: Side) => {
        if (lastPointerType.current === 'mouse') return;
        /*
            Already holding someone else: the tap PLACES them in this row's box
            (a finger aiming for the box often lands on a row, and that must not
            steal the hold). To pick this player up instead, tap the held player
            first to cancel.
        */
        if (held && held !== id) {
            moveTo(held, from);
            setHeld(null);
            return;
        }
        setHeld((prev) => (prev === id ? null : id));
    };

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
        lastPointerType.current = e.pointerType || 'touch';
        //Touch/pen: nothing here; the tap arrives as the row's onClick (onRowTap)
        //and the browser keeps scrolling normally (no preventDefault).
        if (e.pointerType !== 'mouse') return;

        if (e.button !== 0) return;
        e.preventDefault();
        setHeld(null);
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

    return { assign, setAssign, bench, moveTo, drag, held, placeHeld, onRowTap, zoneA, zoneB, zoneBench, onGrab };
}
