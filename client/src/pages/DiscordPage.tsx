import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    apiErrorMessage,
    enqueueBotCommand,
    getBotCommands,
    getMatches,
} from '../api/client';
import type { BotCommandRecord, MatchRecord } from '../api/types';
import { usePrivileged } from '../lib/usePrivileged';

/*
    Admin-only remote control for the Discord bot: every /match action as a
    button. Clicks are queued on the backend; the bot (polling every few
    seconds) executes them in the Discord server and reports back here.
*/

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-5 ${className}`}>{children}</div>
    );
}

const btn =
    'rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';
const btnIndigo = `${btn} border-indigo-700/60 bg-indigo-900/30 text-indigo-200 hover:border-indigo-500`;
const btnSlate = `${btn} border-slate-700 text-slate-200 hover:border-slate-500`;
const btnAmber = `${btn} border-amber-800/60 bg-amber-950/30 text-amber-300 hover:border-amber-600`;
const btnRose = `${btn} border-rose-800/60 bg-rose-950/30 text-rose-300 hover:border-rose-600`;
const btnEmerald = `${btn} border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:border-emerald-600`;

const ACTION_LABEL: Record<BotCommandRecord['action'], string> = {
    setup: 'Setup (start game)',
    split: 'Split to teams',
    join: 'Join Game Comms',
    cancel: 'Cancel (back to proposed)',
    confirm: 'Confirm winner',
    delete: 'Delete match',
};

const STATUS_BADGE: Record<BotCommandRecord['status'], string> = {
    queued: 'border-amber-700/50 bg-amber-900/30 text-amber-300',
    running: 'border-sky-700/50 bg-sky-900/30 text-sky-300',
    done: 'border-emerald-700/50 bg-emerald-900/30 text-emerald-300',
    error: 'border-rose-700/50 bg-rose-900/30 text-rose-300',
};

function MatchRow({ m, busy, onAction }: {
    m: MatchRecord;
    busy: boolean;
    onAction: (action: BotCommandRecord['action'], winner?: 'A' | 'B') => void;
}) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const playing = m.status === 'inProgress';
    const label = m.name ?? `#${m._id.slice(-4)}`;

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                        playing
                            ? 'border-sky-700/50 bg-sky-900/30 text-sky-300'
                            : 'border-amber-700/50 bg-amber-900/30 text-amber-300'
                    }`}
                >
                    {playing ? 'In game' : 'Proposed'}
                </span>
                <span className="font-semibold text-white">{label}</span>
                <span className="text-xs text-slate-500">
                    {m.teamA.length}v{m.teamB.length}
                    {m.reportedBy ? ` · proposed by ${m.reportedBy}` : ''}
                </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {!playing && (
                    <button className={btnIndigo} disabled={busy} onClick={() => onAction('setup')}>
                        ▶ {ACTION_LABEL.setup}
                    </button>
                )}
                {playing && (
                    <>
                        <button className={btnSlate} disabled={busy} onClick={() => onAction('join')}>
                            🎙 {ACTION_LABEL.join}
                        </button>
                        <button className={btnSlate} disabled={busy} onClick={() => onAction('split')}>
                            ⚔ {ACTION_LABEL.split}
                        </button>
                        <button className={btnAmber} disabled={busy} onClick={() => onAction('cancel')}>
                            ↩ {ACTION_LABEL.cancel}
                        </button>
                    </>
                )}
                {confirmOpen ? (
                    <span className="inline-flex items-center gap-2">
                        <button className={btnEmerald} disabled={busy} onClick={() => { onAction('confirm', 'A'); setConfirmOpen(false); }}>
                            🏆 Team A won
                        </button>
                        <button className={btnEmerald} disabled={busy} onClick={() => { onAction('confirm', 'B'); setConfirmOpen(false); }}>
                            🏆 Team B won
                        </button>
                        <button className={btnSlate} disabled={busy} onClick={() => { onAction('confirm'); setConfirmOpen(false); }}>
                            🔎 Auto-detect
                        </button>
                        <button className="text-xs text-slate-400 hover:text-white" onClick={() => setConfirmOpen(false)}>
                            ✕
                        </button>
                    </span>
                ) : (
                    <button className={btnEmerald} disabled={busy} onClick={() => setConfirmOpen(true)}>
                        ✅ {ACTION_LABEL.confirm}…
                    </button>
                )}
                <button
                    className={`${btnRose} ml-auto`}
                    disabled={busy}
                    onClick={() => {
                        const warning = playing
                            ? `Delete the IN-PROGRESS match "${label}"? This voids the game entirely.`
                            : `Delete the proposal "${label}"?`;
                        if (window.confirm(warning)) onAction('delete');
                    }}
                >
                    🗑 {ACTION_LABEL.delete}
                </button>
            </div>
        </div>
    );
}

function CommandLog({ commands }: { commands: BotCommandRecord[] }) {
    if (commands.length === 0) {
        return <p className="text-sm text-slate-500">No commands sent yet — actions you run appear here with the bot's response.</p>;
    }
    return (
        <ul className="space-y-2">
            {commands.map((c) => (
                <li key={c._id} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[c.status]}`}>
                            {c.status}
                        </span>
                        <span className="text-slate-200">
                            {ACTION_LABEL[c.action]}
                            {c.winner ? ` (Team ${c.winner})` : ''} · <span className="font-semibold">{c.matchLabel}</span>
                        </span>
                        <span className="ml-auto text-xs text-slate-500">{new Date(c.createdAt).toLocaleTimeString()}</span>
                    </div>
                    {c.result && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{c.result}</p>}
                </li>
            ))}
        </ul>
    );
}

export default function DiscordPage() {
    const qc = useQueryClient();
    const privileged = usePrivileged();
    const [notice, setNotice] = useState<string | null>(null);

    const { data: matches } = useQuery({ queryKey: ['matches'], queryFn: getMatches, enabled: privileged });
    const { data: commands } = useQuery({
        queryKey: ['bot-commands'],
        queryFn: getBotCommands,
        enabled: privileged,
        //Keep polling while anything is pending so results stream in
        refetchInterval: (q) =>
            (q.state.data ?? []).some((c) => c.status === 'queued' || c.status === 'running') ? 2_000 : 10_000,
    });

    const enqueue = useMutation({
        mutationFn: enqueueBotCommand,
        onSuccess: (cmd) => {
            setNotice(`Queued ${ACTION_LABEL[cmd.action]} for ${cmd.matchLabel} — the bot picks it up within ~5s.`);
            qc.invalidateQueries({ queryKey: ['bot-commands'] });
            //Match states change once the bot acts; refresh shortly after
            setTimeout(() => {
                qc.invalidateQueries({ queryKey: ['matches'] });
                qc.invalidateQueries({ queryKey: ['players'] });
            }, 6_000);
        },
        onError: (err) => setNotice(apiErrorMessage(err)),
    });

    if (!privileged) {
        return (
            <Card>
                <p className="text-sm text-slate-400">
                    The Discord tab is for admins. Connect with your server key and admin password (top right)
                    to drive the bot from here.
                </p>
            </Card>
        );
    }

    const open = (matches ?? []).filter((m) => m.status === 'pending' || m.status === 'inProgress');

    return (
        <div className="space-y-6">
            <Card>
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-indigo-300">Discord remote</h2>
                <p className="text-xs text-slate-500">
                    Every /match command as a button — no typing in Discord needed. The bot executes the action in
                    your server (channels, moves, MMR) and reports back below. Admin actions skip lobby votes.
                </p>
                {notice && <p className="mt-2 text-sm text-amber-300">{notice}</p>}
            </Card>

            <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">
                    Open matches ({open.length})
                </h2>
                {open.length === 0 ? (
                    <Card><span className="text-slate-500">No proposed or in-progress matches. Build one in the Team Builder.</span></Card>
                ) : (
                    open.map((m) => (
                        <MatchRow
                            key={m._id}
                            m={m}
                            busy={enqueue.isPending}
                            onAction={(action, winner) => enqueue.mutate({ action, matchId: m._id, winner })}
                        />
                    ))
                )}
            </section>

            <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Command log</h2>
                <Card>
                    <CommandLog commands={commands ?? []} />
                </Card>
            </section>
        </div>
    );
}
