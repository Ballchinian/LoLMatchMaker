import type { Player } from '../api/types';
import { UNTAGGED, collectTags, hasUntagged } from '../lib/tags';

function chipCls(active: boolean): string {
    return `rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        active
        ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
        : 'border-slate-700 text-slate-300 hover:border-slate-500'
    }`;
}

/** Toggle-chip bar for filtering a player list by tag (OR semantics). */
export function TagFilterBar({
    players,
    selected,
    onToggle,
    onClear,
}: {
    players: Player[];
    selected: Set<string>;
    onToggle: (key: string) => void;
    onClear: () => void;
}) {
    const tags = collectTags(players);
    const untagged = hasUntagged(players);
    if (tags.length === 0 && !untagged) return null;

    return (
        <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">Filter</span>
        {tags.map((t) => {
            const key = t.toLowerCase();
            return (
            <button key={key} type="button" className={chipCls(selected.has(key))} onClick={() => onToggle(key)}>
                {t}
            </button>
            );
        })}
        {untagged && (
            <button
            type="button"
            className={chipCls(selected.has(UNTAGGED))}
            onClick={() => onToggle(UNTAGGED)}
            >
            Untagged
            </button>
        )}
        {selected.size > 0 && (
            <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={onClear}>
            clear
            </button>
        )}
        </div>
    );
}
