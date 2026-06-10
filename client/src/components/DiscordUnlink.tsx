import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, unlinkPlayerDiscord } from '../api/client';
import type { Player } from '../api/types';

/** Admin-only: shows a player's Discord link status with an unlink button. */
export function DiscordUnlink({ player }: { player: Player }) {
    const qc = useQueryClient();
    const mut = useMutation({
        mutationFn: () => unlinkPlayerDiscord(player.id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
    });

    if (!player.discordUserId) return null;

    return (
        <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>🔗 Discord linked</span>
        <button
            type="button"
            className="text-rose-400 hover:text-rose-300 disabled:opacity-50"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
        >
            {mut.isPending ? 'Unlinking…' : 'unlink'}
        </button>
        {mut.isError && <span className="text-rose-400">{apiErrorMessage(mut.error)}</span>}
        </div>
    );
}
