import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    apiErrorMessage,
    cancelMatch,
    confirmMatch,
    deleteMatch,
    getMatches,
    getProposalToken,
    reverseMatch,
} from '../api/client';
import type { MatchRecord, RosterEntry } from '../api/types';
import { usePrivileged } from '../lib/usePrivileged';
import { Card } from '../components/ui';

//Compact button variant (smaller than the shared btnGhost) — Matches packs many per card.
const btnGhost = 'rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-slate-500 disabled:opacity-50';

/** A team's roster. Shows before→after + delta once confirmed, else the MMR at creation. */
function TeamSide({ team, label, highlight }: { team: RosterEntry[]; label: string; highlight: string }) {
    const avg = team.length ? Math.round(team.reduce((s, e) => s + (e.after ?? e.mmrAtCreate), 0) / team.length) : 0;
    return (
        <div className={`flex-1 rounded-xl border p-3 ${highlight}`}>
            <p className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-400">
                <span>{label}</span>
                <span className="text-indigo-300">avg {avg}</span>
            </p>
            <ul className="space-y-1">
                {team.map((e) => (
                <li key={e.player} className="flex items-center justify-between text-sm">
                    <span className="text-slate-200">{e.displayName}</span>
                    {e.before != null && e.after != null ? (
                    <span className="flex items-center gap-2">
                        <span className="text-slate-500">
                        {e.before}→{e.after}
                        </span>
                        <span className={(e.delta ?? 0) >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-rose-400'}>
                        {(e.delta ?? 0) >= 0 ? `+${e.delta}` : e.delta}
                        </span>
                    </span>
                    ) : (
                    <span className="text-slate-500">{e.mmrAtCreate}</span>
                    )}
                </li>
                ))}
            </ul>
        </div>
    );
}

function PendingCard({ m }: { m: MatchRecord }) {
    const qc = useQueryClient();
    const privileged = usePrivileged();
    //This browser proposed the match: it may delete its own proposal without admin
    const mine = getProposalToken(m._id) !== null;

    const confirm = useMutation({
        mutationFn: (winner: 'A' | 'B') => confirmMatch(m._id, winner),
        onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['matches'] });
        qc.invalidateQueries({ queryKey: ['players'] });
        },
    });
    const discard = useMutation({
        mutationFn: () => deleteMatch(m._id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
    });
    //In progress only: back to proposed, nothing deleted ("Cancel" never deletes)
    const cancel = useMutation({
        mutationFn: () => cancelMatch(m._id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['matches'] }),
    });

    return (
        <Card className="border-amber-700/40">
        <div className="mb-3 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
            {m.status === 'inProgress' ? (
                <span className="rounded-full border border-sky-700/50 bg-sky-900/30 px-2 py-0.5 font-semibold text-sky-300">
                In game
                </span>
            ) : (
                <span className="rounded-full border border-amber-700/50 bg-amber-900/30 px-2 py-0.5 font-semibold text-amber-300">
                Pending
                </span>
            )}
            {m.name && <span className="font-semibold text-slate-200">{m.name}</span>}
            </span>
            <span className="text-slate-500">
            created {new Date(m.createdAt).toLocaleString()} · by {m.createdByActor}
            </span>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
            <TeamSide team={m.teamA} label="Team A" highlight="border-sky-700/40 bg-slate-950/40" />
            <TeamSide team={m.teamB} label="Team B" highlight="border-rose-700/40 bg-slate-950/40" />
        </div>

        {(m.reportedBy || m.proposedWinner) && (
            <p className="mt-3 text-xs text-slate-400">
            {m.reportedBy ? (
                <>
                Reported by <span className="text-slate-200">{m.reportedBy}</span>
                </>
            ) : (
                'Reported anonymously'
            )}
            {m.proposedWinner && (
                <>
                {' '}· claims <span className="text-amber-300">Team {m.proposedWinner}</span> won
                </>
            )}
            </p>
        )}

        {privileged ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">Who won?</span>
            <button
                className={btnGhost}
                disabled={confirm.isPending}
                onClick={() => {
                    if (window.confirm('Confirm Team A won? MMR is applied immediately (you can reverse it later).')) confirm.mutate('A');
                }}
            >
                Team A
            </button>
            <button
                className={btnGhost}
                disabled={confirm.isPending}
                onClick={() => {
                    if (window.confirm('Confirm Team B won? MMR is applied immediately (you can reverse it later).')) confirm.mutate('B');
                }}
            >
                Team B
            </button>
            {/* Terminology: "Cancel" returns an ACTIVE game to proposed; "Delete" removes a match. */}
            {m.status === 'inProgress' && (
                <button
                className={`${btnGhost} ml-auto border-amber-800/60 text-amber-300`}
                disabled={cancel.isPending}
                onClick={() => {
                    if (window.confirm('Cancel this in-progress game? It returns to Proposed (nothing is deleted) so it can be restarted, confirmed, or deleted later.')) {
                        cancel.mutate();
                    }
                }}
                >
                {cancel.isPending ? 'Cancelling…' : 'Cancel match'}
                </button>
            )}
            <button
                className={`${btnGhost} ${m.status === 'inProgress' ? '' : 'ml-auto'} border-rose-800/60 text-rose-300`}
                disabled={discard.isPending}
                onClick={() => {
                    const warning =
                        m.status === 'inProgress'
                            ? 'Delete this IN-PROGRESS match? This voids the game entirely (no MMR was applied) and removes it — normally you should Cancel or Confirm instead.'
                            : 'Delete this proposed match? This removes it entirely.';
                    if (window.confirm(warning)) discard.mutate();
                }}
            >
                {discard.isPending ? 'Deleting…' : 'Delete match'}
            </button>
            </div>
        ) : mine && m.status === 'pending' ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-slate-500">Your proposal — awaiting the lobby/an admin.</p>
            <button
                className={`${btnGhost} ml-auto border-rose-800/60 text-rose-300`}
                disabled={discard.isPending}
                onClick={() => {
                    if (window.confirm('Delete your proposal? You can propose a new match afterwards.')) discard.mutate();
                }}
            >
                {discard.isPending ? 'Deleting…' : 'Delete my proposal'}
            </button>
            </div>
        ) : (
            <p className="mt-4 text-sm text-slate-500">
            {m.status === 'inProgress'
                ? 'Being played on Discord — confirm or cancel it from there (or as an admin).'
                : 'Awaiting an admin to confirm the winner.'}
            </p>
        )}
        {(confirm.isError || discard.isError || cancel.isError) && (
            <p className="mt-2 text-sm text-rose-400">
                {apiErrorMessage(confirm.error ?? discard.error ?? cancel.error)}
            </p>
        )}
        </Card>
    );
}

function HistoryCard({ m }: { m: MatchRecord }) {
    const qc = useQueryClient();
    const privileged = usePrivileged();
    const reversed = m.status === 'reversed';

    const reverse = useMutation({
        mutationFn: () => reverseMatch(m._id),
        onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['matches'] });
        qc.invalidateQueries({ queryKey: ['players'] });
        },
    });

    const when = reversed
        ? m.reversedAt && new Date(m.reversedAt).toLocaleString()
        : m.confirmedAt
        ? new Date(m.confirmedAt).toLocaleString()
        : new Date(m.createdAt).toLocaleString();

    const highlight = (side: 'A' | 'B') =>
        !reversed && m.winner === side
        ? 'border-emerald-700/50 bg-emerald-950/20'
        : 'border-slate-800 bg-slate-950/40';

    return (
        <Card className={reversed ? 'opacity-70' : ''}>
        <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-2">
            {reversed && (
                <span className="rounded-full border border-rose-700/50 bg-rose-900/30 px-2 py-0.5 font-semibold text-rose-300">
                Reversed
                </span>
            )}
            {m.name && <span className="font-semibold text-slate-200">{m.name}</span>}
            <span>{when}</span>
            </span>
            <span>
            win chance A {Math.round((m.expectedA ?? 0) * 100)}%{m.kFactor != null ? ` · K=${m.kFactor}` : ''}
            </span>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
            <TeamSide team={m.teamA} label={`Team A${m.winner === 'A' ? ' — won' : ''}`} highlight={highlight('A')} />
            <TeamSide team={m.teamB} label={`Team B${m.winner === 'B' ? ' — won' : ''}`} highlight={highlight('B')} />
        </div>

        {reversed ? (
            <p className="mt-3 text-xs text-rose-300/80">
            MMR changes undone{m.reversedByActor ? ` by ${m.reversedByActor}` : ''} — kept for the record.
            </p>
        ) : privileged ? (
            <div className="mt-3 flex items-center gap-3">
            <button
                className="rounded-lg border border-rose-800/60 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:border-rose-600 disabled:opacity-50"
                disabled={reverse.isPending}
                onClick={() => {
                if (
                    window.confirm(
                    "Reverse this match? Each player's MMR and W/L from this game will be undone. It stays in history as reversed.",
                    )
                ) {
                    reverse.mutate();
                }
                }}
            >
                {reverse.isPending ? 'Reversing…' : 'Reverse result'}
            </button>
            {reverse.isError && <span className="text-xs text-rose-400">{apiErrorMessage(reverse.error)}</span>}
            </div>
        ) : null}
        </Card>
    );
}

export default function MatchesPage() {
    const { data, isLoading, isError, error } = useQuery({
        queryKey: ['matches'],
        queryFn: getMatches,
        //Open games change state on Discord (in-progress, confirmed); poll so the
        //page tracks them live instead of going stale until a manual reload.
        refetchInterval: (q) =>
            (q.state.data ?? []).some((m) => m.status === 'pending' || m.status === 'inProgress')
                ? 5_000
                : false,
    });

    if (isLoading) return <Card>Loading match history…</Card>;
    if (isError) return <Card><span className="text-rose-400">{apiErrorMessage(error)}</span></Card>;
    if (!data || data.length === 0)
        return (
        <Card>
            <span className="text-slate-400">No games yet. Build teams and confirm or save a result.</span>
        </Card>
        );

    //Open = pending (awaiting result) + inProgress (being played on Discord)
    const open = data.filter((m) => m.status === 'pending' || m.status === 'inProgress');
    const history = data.filter((m) => m.status === 'confirmed' || m.status === 'reversed');
    //"View the last match": the most recently CONFIRMED game (by confirm time,
    //not creation), surfaced on its own above the rest of the history.
    const latest = history
        .filter((m) => m.status === 'confirmed')
        .sort(
            (a, b) =>
                new Date(b.confirmedAt ?? b.createdAt).getTime() -
                new Date(a.confirmedAt ?? a.createdAt).getTime(),
        )[0];
    const rest = history.filter((m) => m._id !== latest?._id);

    return (
        <div className="space-y-6">
        {open.length > 0 && (
            <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
                Open ({open.length})
            </h2>
            {open.map((m) => (
                <PendingCard key={m._id} m={m} />
            ))}
            </section>
        )}

        {latest && (
            <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-400">
                Latest result
            </h2>
            <div className="rounded-2xl ring-1 ring-emerald-700/40">
                <HistoryCard m={latest} />
            </div>
            </section>
        )}

        <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            History ({rest.length})
            </h2>
            {rest.length === 0 ? (
            <Card><span className="text-slate-500">{latest ? 'No earlier games.' : 'No confirmed games yet.'}</span></Card>
            ) : (
            rest.map((m) => <HistoryCard key={m._id} m={m} />)
            )}
        </section>
        </div>
    );
}
