import type { Player } from '../../api/types';

//Shared types + tiny helpers for the Team Builder sub-components.

export type Side = 'a' | 'b' | 'bench';

export interface Assignment {
    a: string[];
    b: string[];
}

//Live pointer-drag state (only set once the press moves past the threshold).
export interface DragState {
    id: string;
    x: number;
    y: number;
    over: Side | null;
}

//The adjusted MMR — what users see everywhere (the modifier itself is hidden).
export function Value({ player }: { player: Player }) {
    return <span className="w-12 text-right font-semibold text-indigo-300">{player.effectiveMmr}</span>;
}

export function totalOf(ids: string[], byId: Map<string, Player>): number {
    return ids.reduce((s, id) => s + (byId.get(id)?.effectiveMmr ?? 0), 0);
}
