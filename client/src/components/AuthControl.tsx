import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage, lookupServer, serverLogin, verifyToken } from '../api/client';
import { useAuth } from '../store/useAuth';

//px-3 -> px-2, py-2 -> py-1.5 compared to OG inputCls
const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500';

/*
    Header control for per server access:
    - Server key (from the Discord #info link): scopes the site to that server's
    players/matches: viewing only.
    - Admin password (set via /setup): unlocks admin actions for that server.
    - A raw global admin/bot token still works via the password box (no key).
    The key box is NOT pre filled with the current scope (that went stale when the
    scope changed via a magic link, then logged you into the wrong server). When a
    server is already in scope, just type the password, the live scope is used.
*/
export function AuthControl() {
    const { token, actor, serverKey, serverName, setAuth, setServer, stash, clear } = useAuth();
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [keyInput, setKeyInput] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    //On first load: resolve a stored token's role, and a stored key's server name.
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
    }, []);

    //Everything server scoped must refetch when the scope/role changes
    const refreshData = () => qc.invalidateQueries();

    const closePanel = () => {
        setOpen(false);
        setError(null);
        setKeyInput('');
        setPassword('');
    };

    const submit = async () => {
        const typedKey = keyInput.trim();
        const pw = password.trim();
        //An empty key box means "the server I'm already on" (the live scope).
        const key = typedKey || serverKey || '';

        if (!key && !pw) {
            setError('Enter a server key (and the admin password to unlock).');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (key && pw) {
                //Admin login for this server (or the one being switched to).
                const r = await serverLogin(key, pw);
                setServer(key, r.guildName);
                setAuth(r.token, 'admin', r.guildName);
            } else if (pw) {
                //No key at all: treat the password as a global admin/bot token.
                stash(pw);
                const r = await verifyToken();
                setAuth(pw, r.actor, r.guildName ?? null);
            } else {
                //Key only (no password): scope to that server, view only.
                const r = await lookupServer(key);
                setServer(key, r.guildName);
            }
            refreshData();
            closePanel();
        } catch (err) {
            //A failed legacy token attempt leaves a bad token stashed: drop it.
            if (!typedKey && !serverKey && pw) clear();
            setError(apiErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    //Drop admin but stay scoped to the same server (preview the player view).
    const viewAsPlayer = () => {
        clear();
        refreshData();
    };

    //Leave the server entirely (clears admin + scope).
    const disconnect = () => {
        clear();
        setServer(null);
        refreshData();
        closePanel();
    };

    return (
        <div className="relative">
        <div className="flex items-center gap-2">
            {serverName && (
                <span className="rounded-full border border-indigo-700/50 bg-indigo-900/30 px-2.5 py-1 text-xs font-semibold text-indigo-300">
                    🖥️ {serverName}
                </span>
            )}
            {actor && (
                <span className="rounded-full border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                    🔓 {actor === 'admin' ? 'Admin' : 'Bot'}
                </span>
            )}
            {actor && (
                <button
                    onClick={viewAsPlayer}
                    title="Drop admin and see exactly what players see (stay on this server)"
                    className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
                >
                    View as player
                </button>
            )}
            <button
                onClick={() => (open ? closePanel() : setOpen(true))}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
            >
                {serverName || actor ? '⚙️ Server' : '🔒 Connect server'}
            </button>
        </div>

        {open && (
            <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
                {serverKey ? (
                    <p className="mb-2 text-xs text-slate-400">
                    Connected to <span className="font-semibold text-indigo-300">{serverName ?? 'this server'}</span>.
                    {actor ? ' Already unlocked.' : ' Enter the admin password to unlock.'}
                    </p>
                ) : (
                    <p className="mb-2 text-xs text-slate-400">Connect to a server with its key (from Discord #info).</p>
                )}

                <label className="mb-1 block text-xs text-slate-400">
                    {serverKey ? 'Switch to another server key (optional)' : 'Server key (from Discord #info)'}
                </label>
                <input
                    autoFocus={!serverKey}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                    className={inputCls}
                    placeholder={serverKey ? 'paste a different server key' : 'paste server key'}
                />
                <label className="mb-1 mt-2 block text-xs text-slate-400">Admin password (leave empty to just browse)</label>
                <input
                    type="password"
                    autoFocus={Boolean(serverKey)}
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
                        <button onClick={closePanel} className="text-xs text-slate-400 hover:text-white">
                            Cancel
                        </button>
                        <button
                            onClick={submit}
                            disabled={busy}
                            className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
                        >
                            {busy ? 'Checking…' : actor ? 'Switch / re-unlock' : 'Connect'}
                        </button>
                    </div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                    Tip: the link in your Discord <span className="font-mono">#info</span> channel scopes the
                    site in one click, then you only need the admin password here. Use “View as player” to drop
                    admin without leaving the server.
                </p>
            </div>
        )}
        </div>
    );
}
