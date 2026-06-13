import { useMemo, useState } from 'react';
import type { Player } from '../../api/types';
import { RankBadge } from '../RankBadge';
import { TagFilterBar } from '../TagFilterBar';
import { matchesTagFilter } from '../../lib/tags';
import { useSelection } from '../../store/useSelection';
import { Card } from '../ui';
import { Value } from './shared';

//The selectable roster: tag filter + name search + "select shown".
export function PlayerPicker({ players }: { players: Player[] }) {
    const { selectedIds, toggle, selectMany, clear } = useSelection();
    const [filter, setFilter] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');

    const toggleFilter = (key: string) =>
        setFilter((prev) => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
        });

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return players.filter(
        (p) => matchesTagFilter(p, filter) && (!q || p.displayName.toLowerCase().includes(q)),
        );
    }, [players, filter, search]);

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
                <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name…"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500"
                />
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
