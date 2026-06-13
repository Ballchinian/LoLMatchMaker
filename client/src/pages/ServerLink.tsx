import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { lookupServer } from '../api/client';
import { useAuth } from '../store/useAuth';

/*
    Magic link: /s/<serverKey>. Opening it scopes the site to that Discord
    server, then redirects to a clean URL so the key doesn't linger in the
    address bar / browser history / referrers. The key is stored locally (the
    request interceptor sends it as X-Server-Key), so later visits stay scoped.
*/
export default function ServerLink() {
    const { key } = useParams<{ key: string }>();
    const setServer = useAuth((s) => s.setServer);
    const qc = useQueryClient();
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!key) {
            setDone(true);
            return;
        }
        //Scope immediately so the redirect's first fetches carry the new key...
        setServer(key, null);
        qc.invalidateQueries();
        //...then fill in the server's name (best effort; an unknown key just shows no data).
        lookupServer(key)
            .then((r) => setServer(key, r.guildName))
            .catch(() => undefined)
            .finally(() => setDone(true));
    }, [key]);

    //Replace (not push) so Back doesn't return to the key-bearing URL.
    if (done) return <Navigate to="/players" replace />;
    return <p className="py-16 text-center text-sm text-slate-400">Connecting to your server…</p>;
}
