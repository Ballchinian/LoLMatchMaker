import type { ReactNode } from 'react';

/*
    Shared presentational primitives. These were copy pasted into every page;
    keeping one source means a restyle (e.g. the card border) happens in one
    place. Page specific button sizes (e.g. the compact buttons on Matches /
    Discord) stay local: only the variants that were bite identical live here.
*/

/** The standard panel: rounded, bordered, dark translucent fill. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-5 ${className}`}>{children}</div>
    );
}

export const btnPrimary = 'rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50';

export const btnGhost = 'rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 disabled:opacity-50';

//Full-width text input / select styling. 
export const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500';
