import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, updatePlayerTags } from '../api/client';
import type { Player } from '../api/types';

/**
 * Inline editor: shows a player's tags as removable chips.
 * Applying a tag picks from the list of EXISTING tags (across all players), so a
 * typo can't silently create a near-duplicate. Brand-new tags go through an
 * explicit "create" input instead.
 */
export function TagEditor({
    player,
    allTags = [],
    readOnly = false,
}: {
    player: Player;
    /** Every distinct tag in the roster (see collectTags) — the apply-from list. */
    allTags?: string[];
    readOnly?: boolean;
}) {
    const qc = useQueryClient();
    const [creating, setCreating] = useState(false);
    const [input, setInput] = useState('');

    const mutate = useMutation({
        mutationFn: (tags: string[]) => updatePlayerTags(player.id, tags),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
    });

    const tags = player.tags ?? [];

    // Read-only mode (non-admins): plain chips, no editing affordances.
    if (readOnly) {
        if (tags.length === 0) return null;
        return (
        <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
            <span
                key={t}
                className="rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300"
            >
                {t}
            </span>
            ))}
        </div>
        );
    }

    const has = (t: string) => tags.some((x) => x.toLowerCase() === t.toLowerCase());
    const applicable = allTags.filter((t) => !has(t));

    const apply = (t: string) => {
        if (!t || has(t)) return;
        mutate.mutate([...tags, t]);
    };

    const createNew = () => {
        const t = input.trim();
        setInput('');
        setCreating(false);
        if (!t || has(t)) return;
        // If it already exists roster-wide (maybe with different casing), apply that
        // spelling instead of minting a variant.
        const existing = allTags.find((x) => x.toLowerCase() === t.toLowerCase());
        mutate.mutate([...tags, existing ?? t]);
    };

    const remove = (tag: string) => mutate.mutate(tags.filter((x) => x !== tag));

    return (
        <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
            <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300"
            >
            {t}
            <button
                type="button"
                className="text-slate-500 hover:text-rose-300"
                onClick={() => remove(t)}
                title="Remove tag"
                disabled={mutate.isPending}
            >
                ✕
            </button>
            </span>
        ))}

        {applicable.length > 0 && (
            <select
            value=""
            disabled={mutate.isPending}
            onChange={(e) => apply(e.target.value)}
            className="rounded-full border border-dashed border-slate-700 bg-slate-950 px-2 py-0.5 text-xs text-slate-400 outline-none focus:border-indigo-500"
            title="Apply an existing tag"
            >
            <option value="">+ tag…</option>
            {applicable.map((t) => (
                <option key={t} value={t}>
                {t}
                </option>
            ))}
            </select>
        )}

        {creating ? (
            <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                e.preventDefault();
                createNew();
                }
                if (e.key === 'Escape') {
                setInput('');
                setCreating(false);
                }
            }}
            onBlur={createNew}
            placeholder="new tag"
            disabled={mutate.isPending}
            className="w-24 rounded-full border border-dashed border-indigo-500/60 bg-transparent px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-indigo-400"
            />
        ) : (
            <button
            type="button"
            className="rounded-full border border-dashed border-slate-700 px-2 py-0.5 text-xs text-slate-500 hover:border-indigo-500 hover:text-indigo-300"
            onClick={() => setCreating(true)}
            disabled={mutate.isPending}
            title="Create a brand-new tag"
            >
            ✚ new
            </button>
        )}

        {mutate.isError && <span className="text-xs text-rose-400">{apiErrorMessage(mutate.error)}</span>}
        </div>
    );
}
