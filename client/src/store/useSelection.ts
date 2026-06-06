import { create } from 'zustand';

export type ConstraintType = 'same' | 'opposite';
type Pair = [string, string];

interface SelectionState {
  selectedIds: string[];
  sameTeam: Pair[];
  oppositeTeam: Pair[];
  /** Canonical keys of splits already shown, so re-rolls avoid repeats. */
  excludeKeys: string[];

  toggle: (id: string) => void;
  selectMany: (ids: string[]) => void;
  clear: () => void;

  addConstraint: (type: ConstraintType, a: string, b: string) => void;
  removeConstraint: (type: ConstraintType, index: number) => void;

  addExcludeKey: (key: string) => void;
  resetExcludeKeys: () => void;
}

function samePair(p: Pair, a: string, b: string): boolean {
  return (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a);
}

function dropPairsWith(pairs: Pair[], id: string): Pair[] {
  return pairs.filter((p) => p[0] !== id && p[1] !== id);
}

export const useSelection = create<SelectionState>((set) => ({
  selectedIds: [],
  sameTeam: [],
  oppositeTeam: [],
  excludeKeys: [],

  toggle: (id) =>
    set((s) => {
      if (s.selectedIds.includes(id)) {
        // Deselecting: also drop any constraints referencing this player.
        return {
          selectedIds: s.selectedIds.filter((x) => x !== id),
          sameTeam: dropPairsWith(s.sameTeam, id),
          oppositeTeam: dropPairsWith(s.oppositeTeam, id),
          excludeKeys: [],
        };
      }
      return { selectedIds: [...s.selectedIds, id], excludeKeys: [] };
    }),

  selectMany: (ids) =>
    set((s) => {
      const merged = new Set(s.selectedIds);
      for (const id of ids) merged.add(id);
      return { selectedIds: [...merged], excludeKeys: [] };
    }),

  clear: () => set({ selectedIds: [], sameTeam: [], oppositeTeam: [], excludeKeys: [] }),

  addConstraint: (type, a, b) =>
    set((s) => {
      if (a === b) return s;
      const list = type === 'same' ? s.sameTeam : s.oppositeTeam;
      if (list.some((p) => samePair(p, a, b))) return s;
      const pair: Pair = [a, b];
      // A pair can't be both same-team and opposite-team; keep them mutually exclusive.
      return type === 'same'
        ? {
            sameTeam: [...s.sameTeam, pair],
            oppositeTeam: s.oppositeTeam.filter((p) => !samePair(p, a, b)),
            excludeKeys: [],
          }
        : {
            oppositeTeam: [...s.oppositeTeam, pair],
            sameTeam: s.sameTeam.filter((p) => !samePair(p, a, b)),
            excludeKeys: [],
          };
    }),

  removeConstraint: (type, index) =>
    set((s) =>
      type === 'same'
        ? { sameTeam: s.sameTeam.filter((_, i) => i !== index), excludeKeys: [] }
        : { oppositeTeam: s.oppositeTeam.filter((_, i) => i !== index), excludeKeys: [] },
    ),

  addExcludeKey: (key) => set((s) => ({ excludeKeys: [...s.excludeKeys, key] })),
  resetExcludeKeys: () => set({ excludeKeys: [] }),
}));
