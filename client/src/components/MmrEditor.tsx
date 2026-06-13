import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, updatePlayerMmr } from '../api/client';
import type { Player } from '../api/types';

const numCls = 'w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-100 outline-none focus:border-indigo-500';

//Admin-only: override a player's seed MMR and/or current MMR.
export function MmrEditor({ player }: { player: Player }) {
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [seed, setSeed] = useState(player.seedMMR);
    const [mmr, setMmr] = useState(player.mmr);

    const mut = useMutation({
        mutationFn: () => updatePlayerMmr(player.id, { seedMMR: seed, mmr }),
        onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['players'] });
        setOpen(false);
        },
    });

    if (!open) {
        return (
        <button
            type="button"
            className="text-xs text-slate-500 hover:text-indigo-300"
            onClick={() => {
            setSeed(player.seedMMR);
            setMmr(player.mmr);
            setOpen(true);
            }}
        >
            ✎ edit MMR
        </button>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-slate-400">
            Seed
            <input
            type="number"
            className={numCls}
            value={seed}
            min={0}
            max={6000}
            onChange={(e) => setSeed(Number(e.target.value))}
            />
        </label>
        <label className="flex items-center gap-1 text-slate-400">
            Current
            <input
            type="number"
            className={numCls}
            value={mmr}
            min={0}
            max={6000}
            onChange={(e) => setMmr(Number(e.target.value))}
            />
        </label>
        <button
            type="button"
            className="rounded bg-indigo-500 px-2 py-0.5 font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
        >
            {mut.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="text-slate-400 hover:text-white" onClick={() => setOpen(false)}>
            Cancel
        </button>
        {mut.isError && <span className="text-rose-400">{apiErrorMessage(mut.error)}</span>}
        </div>
    );
}
