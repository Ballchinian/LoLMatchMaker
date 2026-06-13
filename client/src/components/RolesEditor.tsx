import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, updatePlayerChampPool } from '../api/client';
import type { ChampPool, Player } from '../api/types';

const POOLS: { value: ChampPool; label: string; mod: number; desc: string }[] = [
    { value: 'one-trick', label: 'One-trick', mod: -200, desc: 'Peak rank on basically 1 champ' },
    { value: 'two-trick', label: 'Two-trick', mod: -75, desc: 'Strong on about 2 champs' },
    { value: 'diverse', label: 'Diverse', mod: 0, desc: 'Comfortable on 3+ (or new / low level)' },
];

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/*
    Admin-only: set a player's champion-pool depth, the only versatility
    modifier on the displayed/balancing MMR (one-trick -200, two-trick -75,
    diverse 0). Raw MMR, ranks and Glicko are untouched.
*/
export function RolesEditor({ player }: { player: Player }) {
    const qc = useQueryClient();

    const mut = useMutation({
        mutationFn: (champPool: ChampPool) => updatePlayerChampPool(player.id, champPool),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
    });

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="flex items-center gap-2">
            <span className="text-slate-500">Champ pool</span>
            <span className="flex overflow-hidden rounded-lg border border-slate-700">
            {POOLS.map((p) => (
                <button
                key={p.value}
                type="button"
                title={`${p.desc} (${fmt(p.mod)})`}
                disabled={mut.isPending}
                onClick={() => mut.mutate(p.value)}
                className={`px-2 py-0.5 transition ${
                    player.champPool === p.value
                    ? 'bg-indigo-500 font-semibold text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                >
                {p.label}
                </button>
            ))}
            </span>
        </span>

        {player.mmrModifier !== 0 && (
            <span className="text-slate-500">
            <span className={player.mmrModifier > 0 ? 'text-emerald-400' : 'text-amber-400'}>
                {fmt(player.mmrModifier)}
            </span>{' '}
            → shown as <span className="font-semibold text-indigo-300">{player.effectiveMmr}</span> (raw{' '}
            {player.mmr})
            </span>
        )}
        {mut.isError && <span className="text-rose-400">{apiErrorMessage(mut.error)}</span>}
        </div>
    );
}
