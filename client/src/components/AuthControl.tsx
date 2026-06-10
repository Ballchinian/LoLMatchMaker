import { useEffect, useState } from 'react';
import { verifyToken } from '../api/client';
import { useAuth } from '../store/useAuth';

/** Header control: paste an admin/bot token to unlock privileged actions; lock to clear. */
export function AuthControl() {
    const { token, actor, setAuth, stash, clear } = useAuth();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // On first load, if a token is stored but unverified, resolve its role (or drop it).
    useEffect(() => {
        if (token && !actor) {
        verifyToken()
            .then((r) => setAuth(token, r.actor))
            .catch(() => clear());
        }
    }, []); // run once

    const submit = async () => {
        const t = input.trim();
        if (!t) return;
        setBusy(true);
        setError(null);
        stash(t); // make the interceptor send it
        try {
        const r = await verifyToken();
        setAuth(t, r.actor);
        setOpen(false);
        setInput('');
        } catch {
        clear();
        setError('Invalid token');
        } finally {
        setBusy(false);
        }
    };

    if (actor) {
        return (
        <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-700/50 bg-emerald-900/30 px-2.5 py-1 text-xs font-semibold text-emerald-300">
            🔓 {actor === 'admin' ? 'Admin' : 'Bot'}
            </span>
            <button onClick={clear} className="text-xs text-slate-400 hover:text-white">
            Lock
            </button>
        </div>
        );
    }

    return (
        <div className="relative">
        <button
            onClick={() => setOpen((o) => !o)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500"
        >
            🔒 Unlock admin
        </button>
        {open && (
            <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
            <label className="mb-1 block text-xs text-slate-400">Admin / bot token</label>
            <input
                type="password"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-indigo-500"
                placeholder="paste token"
            />
            {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
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
                {busy ? 'Checking…' : 'Unlock'}
                </button>
            </div>
            </div>
        )}
        </div>
    );
}
