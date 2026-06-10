import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, updatePlayerRoles } from '../api/client';
import type { ChampPool, Player } from '../api/types';

const ROLE_LABELS: Record<number, string> = {
    1: '1 role',
    2: '2 roles',
    3: '3 roles',
    4: '4 roles',
    5: 'All roles',
};

const POOLS: { value: ChampPool; label: string; penalty: number }[] = [
    { value: 'one-trick', label: 'One-trick', penalty: 100 },
    { value: 'limited', label: 'Limited', penalty: 50 },
    { value: 'diverse', label: 'Diverse', penalty: 0 },
];

/**
 * Admin-only: set a player's versatility. Two stacking penalties on their
 * matchmaking value (raw MMR and Elo are untouched):
 *  - role coverage: -25 per role they can't play (up to -100)
 *  - champion pool: one-trick -100 (ban-able), limited -50, diverse 0
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
                title={`${ROLE_LABELS[n]} (${(5 - n) * 25 ? `-${(5 - n) * 25}` : 'no penalty'})`}
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
                title={p.penalty ? `-${p.penalty} matchmaking value` : 'No penalty'}
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

        {player.flexPenalty > 0 && (
            <span className="text-slate-500">
            <span className="text-amber-400">-{player.flexPenalty}</span> → matchmaking value{' '}
            <span className="font-semibold text-indigo-300">{player.effectiveMmr}</span>
            </span>
        )}
        {mut.isError && <span className="text-rose-400">{apiErrorMessage(mut.error)}</span>}
        </div>
    );
}
