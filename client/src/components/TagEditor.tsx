import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, updatePlayerTags } from '../api/client';
import type { Player } from '../api/types';

/** Inline editor: shows a player's tags as removable chips with an add-input. */
export function TagEditor({ player, readOnly = false }: { player: Player; readOnly?: boolean }) {
  const qc = useQueryClient();
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

  const add = () => {
    const t = input.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setInput('');
      return;
    }
    mutate.mutate([...tags, t]);
    setInput('');
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
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={() => input.trim() && add()}
        placeholder="+ tag"
        disabled={mutate.isPending}
        className="w-20 rounded-full border border-dashed border-slate-700 bg-transparent px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-indigo-500"
      />
      {mutate.isError && <span className="text-xs text-rose-400">{apiErrorMessage(mutate.error)}</span>}
    </div>
  );
}
