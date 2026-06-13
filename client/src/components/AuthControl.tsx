import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, lookupServer, serverLogin, verifyToken } from '../api/client';
import { useAuth } from '../store/useAuth';

const inputCls =
    'w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500';

/**
 * Header control for per-server access:
 * - Server key (from the Discord #info channel): scopes the site to that
 *   server's players/matches — viewing only.
 * - Admin password (set via /setup): unlocks admin actions for that server.
 * - A raw global admin/bot token still works via the same password box
 *   (leave the key empty), kept for the site owner.
 */
export function AuthControl() {
    const { token, actor, serverKey, serverName, setAuth, setServer, stash, clear } = useAuth();
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [keyInput, setKeyInput] = useState(serverKey ?? '');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // On first load: resolve a stored token's role, and a stored key's server name.
    useEffect(() => {
        if (token && !actor) {
            verifyToken()
                .then((r) => setAuth(token, r.actor, r.guildName ?? null))
                .catch(() => clear());
        }
        if (serverKey && !serverName) {
            lookupServer(serverKey)
                .then((r) => setServer(serverKey, r.guildName))
                .catch(() => undefined);
        }
    }, []); // run once

    //Everything server-scoped must refetch when the scope changes
    const refreshData = () => {
        qc.invalidateQueries();
    };

    const submit = async () => {
        //Fall back to the key already in scope (e.g. set by a magic link), so an
        //admin only needs to type the password to unlock.
        const key = keyInput.trim() || serverKey || '';
        const pw = password.trim();
        if (!key && !pw) return;
        setBusy(true);
        setError(null);
        try {
            if (key && pw) {
                //Server admin: key + password -> scoped token
                const r = await serverLogin(key, pw);
                setServer(key, r.guildName);
                setAuth(r.token, 'admin', r.guildName);
            } else if (key) {
                //View only: just scope the site to this server
                const r = await lookupServer(key);
                setServer(key, r.guildName);
            } else {
                //Legacy: treat the lone password as a global admin/bot token
                stash(pw);
                const r = await verifyToken();
                setAuth(pw, r.actor, r.guildName ?? null);
            }
            refreshData();
            setOpen(false);
            setPassword('');
        } catch (err) {
            //A failed legacy-token attempt leaves a bad token stashed: drop it
            if (!key && pw) clear();
            setError(apiErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const disconnect = () => {
        clear();
        setServer(null);
        setKeyInput('');
        refreshData();
    };

    return (
        <div className="relative">
        <div className="flex items-center gap-2">
            {serverName && (
            <span className="rounded-full border border-indigo-700/50 bg-indigo-900/30 px-2.5 py-1 text-xs font-semibold text-indigo-300">
                🖥️ {serverName}
            </span>
            )}
            {actor ? (
            <span className="rounded-full border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                🔓 {actor === 'admin' ? 'Admin' : 'Bot'}
            </span>
            ) : null}
            <button
                onClick={() => setOpen((o) => !o)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
            >
                {serverName || actor ? '⚙️ Server' : '🔒 Connect server'}
            </button>
        </div>

        {open && (
            <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
            <label className="mb-1 block text-xs text-slate-400">Server key (from Discord #info)</label>
            <input
                autoFocus
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className={inputCls}
                placeholder="paste server key"
            />
            <label className="mb-1 mt-2 block text-xs text-slate-400">
                Admin password (optional — leave empty to just browse)
            </label>
            <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className={inputCls}
                placeholder="admin password / token"
            />
            {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
            <div className="mt-2 flex items-center justify-between gap-2">
                {(serverName || actor) && (
                <button onClick={disconnect} className="text-xs text-rose-400 hover:text-rose-300">
                    Disconnect
                </button>
                )}
                <div className="ml-auto flex gap-2">
                <button
                    onClick={() => {
                        setOpen(false);
                        setError(null);
                    }}
                    className="text-xs text-slate-400 hover:text-white"
                >
                    Cancel
                </button>
                <button
                    onClick={submit}
                    disabled={busy}
                    className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                >
                    {busy ? 'Checking…' : 'Connect'}
                </button>
                </div>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
                Tip: the link in your Discord <span className="font-mono">#info</span> channel scopes the
                site in one click — you only need this box to enter the admin password (set with /setup)
                to unlock admin actions.
            </p>
            </div>
        )}
        </div>
    );
}
