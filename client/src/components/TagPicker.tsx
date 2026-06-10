import { useState } from 'react';

/**
 * Controlled tag chooser for forms (e.g. manual player add): pick from the
 * roster's existing tags via a dropdown, or create a brand-new one through an
 * explicit input — no free-typing that silently mints near-duplicates.
 */
export function TagPicker({
    value,
    onChange,
    allTags,
}: {
    value: string[];
    onChange: (tags: string[]) => void;
    /** Every distinct tag in the roster — the pick-from list. */
    allTags: string[];
}) {
    const [creating, setCreating] = useState(false);
    const [input, setInput] = useState('');

    const has = (t: string) => value.some((x) => x.toLowerCase() === t.toLowerCase());
    const applicable = allTags.filter((t) => !has(t));

    const apply = (t: string) => {
        if (t && !has(t)) onChange([...value, t]);
    };

    const createNew = () => {
        const t = input.trim();
        setInput('');
        setCreating(false);
        if (!t || has(t)) return;
        // Same casing rule as TagEditor: reuse an existing spelling if there is one.
        const existing = allTags.find((x) => x.toLowerCase() === t.toLowerCase());
        onChange([...value, existing ?? t]);
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
            <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300"
            >
            {t}
            <button
                type="button"
                className="text-slate-500 hover:text-rose-300"
                onClick={() => onChange(value.filter((x) => x !== t))}
                title="Remove tag"
            >
                ✕
            </button>
            </span>
        ))}

        {applicable.length > 0 && (
            <select
            value=""
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
            className="w-24 rounded-full border border-dashed border-indigo-500/60 bg-transparent px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-indigo-400"
            />
        ) : (
            <button
            type="button"
            className="rounded-full border border-dashed border-slate-700 px-2 py-0.5 text-xs text-slate-500 hover:border-indigo-500 hover:text-indigo-300"
            onClick={() => setCreating(true)}
            title="Create a brand-new tag"
            >
            ✚ new
            </button>
        )}
        </div>
    );
}
