import { create } from 'zustand';
import { TOKEN_KEY } from '../api/client';
import type { Actor } from '../api/types';

interface AuthState {
  token: string | null;
  actor: Actor | null;
  /** Persist a verified token + role and unlock privileged UI. */
  setAuth: (token: string, actor: Actor) => void;
  /** Stash a token so the request interceptor sends it (used before verifying). */
  stash: (token: string) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  actor: null,

  setAuth: (token, actor) => {
    localStorage.setItem(TOKEN_KEY, token);
    set({ token, actor });
  },

  stash: (token) => {
    localStorage.setItem(TOKEN_KEY, token);
    set({ token });
  },

  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ token: null, actor: null });
  },
}));
