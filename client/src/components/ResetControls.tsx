import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, deletePlayer, getPlayers, resetPlayer } from '../api/client';
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
//Gap after a Riot-backed reset, to stay clear of the dev key's 2-min window.
const RIOT_PACE_MS = 1500;

export function ServerReset() {
    const qc = useQueryClient();
    const { data: players } = useQuery({ queryKey: ['players'], queryFn: getPlayers });
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
    const [report, setReport] = useState<string[] | null>(null);
    //Read synchronously inside the loop; a button click flips it to stop.
    const cancelRef = useRef(false);

    const run = async () => {
        const list = players ?? [];
        if (list.length === 0) return;
        if (!window.confirm(`Reset ALL ${list.length} players on this server? Each one's MMR/RD is re-seeded and W/L zeroed (Discord links and match history are kept). This cannot be undone.`)) return;
        if (!window.confirm('Are you really sure? This re-fetches every Riot player one by one and can take a while.')) return;

        cancelRef.current = false;
        setRunning(true);
        setReport(null);
        const lines: string[] = [];
        let ok = 0;
        let failed = 0;
        let processed = 0;

        for (const p of list) {
            if (cancelRef.current) break;
            processed += 1;
            setProgress({ done: processed, total: list.length, current: p.displayName });
            try {
                const { before, after, refreshedFromRiot } = await resetPlayer(p.id);
                ok += 1;
                lines.push(
                    `✔ ${after.displayName}: ${before.mmr} → ${after.mmr} MMR, record zeroed` +
                        (before.riotRank !== after.riotRank
                            ? ` (Riot ${before.riotRank ?? 'none'} → ${after.riotRank ?? 'none'})`
                            : ''),
                );
                //Pace only after a real Riot refetch; manual players are instant.
                if (refreshedFromRiot && processed < list.length && !cancelRef.current) await sleep(RIOT_PACE_MS);
            } catch (err) {
                failed += 1;
                lines.push(`❌ ${p.displayName}: ${apiErrorMessage(err)}`);
                //A failure is often a 429 — back off a touch before the next one.
                if (processed < list.length && !cancelRef.current) await sleep(RIOT_PACE_MS);
            }
        }

        const cancelled = cancelRef.current;
        setProgress(null);
        setRunning(false);
        cancelRef.current = false;
        qc.invalidateQueries({ queryKey: ['players'] });
        const head =
            `Server reset ${cancelled ? 'cancelled' : 'done'}: ${ok} reset` +
            (failed ? `, ${failed} failed` : '') +
            ` (of ${list.length}).` +
            (cancelled ? ' Remaining players were left unchanged.' : '');
        setReport([head, ...lines]);
    };

    return (
        <div className="rounded-2xl border border-rose-900/40 bg-rose-950/10 p-5">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-300">Server reset</h3>
            <p className="mb-3 text-xs text-slate-400">
                Resets EVERY player on this server: refetch Riot details, re-seed MMR/RD, zero the W/L
                record. Discord links and match history are kept. Runs one player at a time and paces the
                Riot calls to respect the API limit — you can cancel midway (players already done stay reset).
            </p>

            {running ? (
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-amber-300">
                        Resetting {progress?.done ?? 0}/{progress?.total ?? 0}
                        {progress?.current ? ` — ${progress.current}` : ''}…
                    </span>
                    <button
                        className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-400"
                        onClick={() => {
                            cancelRef.current = true;
                        }}
                    >
                        Cancel
                    </button>
                </div>
            ) : (
                <button
                    className="rounded-lg border border-rose-800/60 px-4 py-2 text-sm font-medium text-rose-300 transition hover:border-rose-600 disabled:opacity-50"
                    disabled={!players || players.length === 0}
                    onClick={run}
                >
                    ♻️ Reset ALL players
                </button>
            )}

            {report && (
                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    {report.map((line, i) => (
                        <p
                            key={i}
                            className={`text-xs ${i === 0 ? 'mb-2 font-semibold text-emerald-300' : line.startsWith('❌') ? 'text-rose-300' : 'text-slate-300'}`}
                        >
                            {line}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
