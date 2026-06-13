import { create } from 'zustand';
import { SERVER_KEY, TOKEN_KEY } from '../api/client';
import type { Actor } from '../api/types';

interface AuthState {
    token: string | null;
    actor: Actor | null;
    //Discord server key scoping which server's data we browse (null = none/legacy). 
    serverKey: string | null;
    //Display name of the connected Discord server, once known. 
    serverName: string | null;
    //Persist a verified token + role and unlock privileged UI. 
    setAuth: (token: string, actor: Actor, serverName?: string | null) => void;
    //Stash a token so the request interceptor sends it (used before verifying). 
    stash: (token: string) => void;
    //Persist the server key the interceptor scopes every request with. 
    setServer: (serverKey: string | null, serverName?: string | null) => void;
    clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
    token: localStorage.getItem(TOKEN_KEY),
    actor: null,
    serverKey: localStorage.getItem(SERVER_KEY),
    serverName: null,

    setAuth: (token, actor, serverName) => {
        localStorage.setItem(TOKEN_KEY, token);
        set((s) => ({ token, actor, serverName: serverName ?? s.serverName }));
    },

    stash: (token) => {
        localStorage.setItem(TOKEN_KEY, token);
        set({ token });
    },

    setServer: (serverKey, serverName) =>
        set((s) => {
            /*
                Switching to a DIFFERENT server drops any admin unlock from the
                old one: the admin token is bound to that guild (and the backend
                scopes by the token's guild over the X-Server-Key header), so
                keeping it would silently show the wrong server's data. You view
                the new server until you enter its password.
            */
            const switching = Boolean(serverKey) && Boolean(s.serverKey) && serverKey !== s.serverKey;
            if (switching) localStorage.removeItem(TOKEN_KEY);
            if (serverKey) localStorage.setItem(SERVER_KEY, serverKey);
            else localStorage.removeItem(SERVER_KEY);
            return {
                serverKey,
                serverName: serverName ?? null,
                ...(switching ? { token: null, actor: null } : null),
            };
        }),

    //Locks admin access but keeps browsing the same server (key stays)
    clear: () => {
        localStorage.removeItem(TOKEN_KEY);
        set({ token: null, actor: null });
    },
}));
