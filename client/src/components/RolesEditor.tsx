import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, updatePlayerRoles } from '../api/client';
import type { ChampPool, Player } from '../api/types';

const ROLE_MOD: Record<number, number> = { 1: -125, 2: -50, 3: 0, 4: 25, 5: 50 };

const POOLS: { value: ChampPool; label: string; mod: number }[] = [
    { value: 'one-trick', label: 'One-trick', mod: -200 },
    { value: 'two-trick', label: 'Two-trick', mod: -75 },
    { value: 'diverse', label: 'Diverse', mod: 0 },
];

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Admin-only: set a player's versatility. Two stacking modifiers on their
 * displayed/balancing MMR (raw MMR, ranks and Elo are untouched):
 *  - role coverage: 1 → -125, 2 → -50, 3 → 0, 4 → +25, 5 → +50
 *  - champion pool: one-trick -200, two-trick -75, diverse 0
 */
export function RolesEditor({ player }: { player: Player }) {
    const qc = useQueryClient();

    const mut = useMutation({
        mutationFn: (input: { rolesPlayed?: number; champPool?: ChampPool }) =>
        updatePlayerRoles(player.id, input),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
    });

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="flex items-center gap-2">
            <span className="text-slate-500">Roles</span>
            <span className="flex overflow-hidden rounded-lg border border-slate-700">
            {[1, 2, 3, 4, 5].map((n) => (
                <button
                key={n}
                type="button"
                title={`${n} role${n > 1 ? 's' : ''} (${fmt(ROLE_MOD[n] ?? 0)})`}
                disabled={mut.isPending}
                onClick={() => mut.mutate({ rolesPlayed: n })}
                className={`px-2 py-0.5 transition ${
                    player.rolesPlayed === n
                    ? 'bg-indigo-500 font-semibold text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                >
                {n}
                </button>
            ))}
            </span>
        </span>

        <span className="flex items-center gap-2">
            <span className="text-slate-500">Champ pool</span>
            <span className="flex overflow-hidden rounded-lg border border-slate-700">
            {POOLS.map((p) => (
                <button
                key={p.value}
                type="button"
                title={fmt(p.mod)}
                disabled={mut.isPending}
                onClick={() => mut.mutate({ champPool: p.value })}
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
