import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, deletePlayer, resetAllPlayers, resetPlayer } from '../api/client';
import type { Player, ResetView } from '../api/types';

/*
    Admin reset controls (website only, by design):
    - PlayerReset: one player's Riot details + ladder record back to a fresh seed
    - ServerReset: the same for EVERY player on the server
    Both confirm before acting and show before -> after once done. Neither
    touches Discord links.
*/

//Compact one-line description of the fields a reset changes
function viewLine(v: ResetView): string {
    return `MMR ${v.mmr} (seed ${v.seedMMR}) · ±${v.rd} · ${v.wins}W ${v.losses}L over ${v.gamesPlayed} games` +
        (v.riotRank ? ` · Riot ${v.riotRank}` : '');
}

export function PlayerReset({ player }: { player: Player }) {
    const qc = useQueryClient();
    const [summary, setSummary] = useState<string | null>(null);

    const reset = useMutation({
        mutationFn: () => resetPlayer(player.id),
        onSuccess: ({ before, after, refreshedFromRiot }) => {
            qc.invalidateQueries({ queryKey: ['players'] });
            setSummary(
                `${refreshedFromRiot ? 'Refetched from Riot. ' : ''}Before: ${viewLine(before)} → After: ${viewLine(after)}`,
            );
        },
    });

    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
                className="rounded border border-rose-800/60 px-2 py-0.5 text-rose-300 transition hover:border-rose-600 disabled:opacity-50"
                disabled={reset.isPending}
                onClick={() => {
                    if (
                        window.confirm(
                            `Reset ${player.displayName}?\n\n` +
                            `Current: MMR ${player.mmr} (seed ${player.seedMMR}), ±${player.rd}, ${player.wins}W ${player.losses}L over ${player.gamesPlayed} games.\n\n` +
                            `This refetches their Riot details (rank, name), re-seeds MMR/RD from it and zeroes their W/L record. ` +
                            `Their Discord link is kept. This cannot be undone.`,
                        )
                    ) {
                        setSummary(null);
                        reset.mutate();
                    }
                }}
            >
                {reset.isPending ? 'Resetting…' : '♻️ Reset player'}
            </button>
            {summary && <span className="text-emerald-400">{summary}</span>}
            {reset.isError && <span className="text-rose-400">{apiErrorMessage(reset.error)}</span>}
        </div>
    );
}

export function DeletePlayer({ player }: { player: Player }) {
    const qc = useQueryClient();

    const del = useMutation({
        mutationFn: () => deletePlayer(player.id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
    });

    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
                className="rounded border border-rose-800/60 px-2 py-0.5 text-rose-300 transition hover:border-rose-600 disabled:opacity-50"
                disabled={del.isPending}
                onClick={() => {
                    if (
                        window.confirm(
                            `Permanently delete ${player.displayName}?\n\n` +
                            `This removes them from the roster entirely (their Discord link too). ` +
                            `Confirmed match history keeps its own name/MMR snapshots and is unaffected. This cannot be undone.`,
                        )
                    ) {
                        del.mutate();
                    }
                }}
            >
                {del.isPending ? 'Deleting…' : '🗑️ Delete player'}
            </button>
            {del.isError && <span className="text-rose-400">{apiErrorMessage(del.error)}</span>}
        </div>
    );
}

export function ServerReset() {
    const qc = useQueryClient();
    const [report, setReport] = useState<string[] | null>(null);

    const reset = useMutation({
        mutationFn: resetAllPlayers,
        onSuccess: ({ results, reset: ok, failed }) => {
            qc.invalidateQueries({ queryKey: ['players'] });
            const lines = results.map((r) =>
                r.error
                    ? `❌ ${r.displayName}: ${r.error}`
                    : `✔ ${r.displayName}: ${r.before!.mmr} → ${r.after!.mmr} MMR, record zeroed` +
                        (r.before!.riotRank !== r.after!.riotRank
                            ? ` (Riot ${r.before!.riotRank ?? 'none'} → ${r.after!.riotRank ?? 'none'})`
                            : ''),
            );
            setReport([`Server reset done: ${ok} player(s) reset${failed ? `, ${failed} failed` : ''}.`, ...lines]);
        },
    });

    return (
        <div className="rounded-2xl border border-rose-900/40 bg-rose-950/10 p-5">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-300">Server reset</h3>
            <p className="mb-3 text-xs text-slate-400">
                Resets EVERY player on this server: refetch Riot details, re-seed MMR/RD, zero the W/L
                record. Discord links and match history are kept. Riot players are refetched one by one,
                so this can take a while.
            </p>
            <button
                className="rounded-lg border border-rose-800/60 px-4 py-2 text-sm font-medium text-rose-300 transition hover:border-rose-600 disabled:opacity-50"
                disabled={reset.isPending}
                onClick={() => {
                    if (!window.confirm('Reset ALL players on this server? Every player\'s MMR/RD is re-seeded and their record zeroed. This cannot be undone.')) return;
                    if (!window.confirm('Are you really sure? This affects every player at once.')) return;
                    setReport(null);
                    reset.mutate();
                }}
            >
                {reset.isPending ? 'Resetting everyone… (this can take a while)' : '♻️ Reset ALL players'}
            </button>
            {reset.isError && <p className="mt-2 text-sm text-rose-400">{apiErrorMessage(reset.error)}</p>}
            {report && (
                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    {report.map((line, i) => (
                        <p key={i} className={`text-xs ${i === 0 ? 'mb-2 font-semibold text-emerald-300' : 'text-slate-300'}`}>
                            {line}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
