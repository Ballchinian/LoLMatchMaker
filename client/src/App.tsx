import type { ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getHealth } from './api/client';
import { AuthControl } from './components/AuthControl';
import { usePrivileged } from './lib/usePrivileged';
import PlayersPage from './pages/PlayersPage';
import TeamBuilderPage from './pages/TeamBuilderPage';
import MatchesPage from './pages/MatchesPage';
import DiscordPage from './pages/DiscordPage';
import ServerLink from './pages/ServerLink';
import { PrivacyPage, TermsPage } from './pages/LegalPages';

function HealthPill() {
    const { data } = useQuery({ queryKey: ['health'], queryFn: getHealth, staleTime: 30_000 });
    if (!data) return null;
    const dot = (ok: boolean) => (ok ? 'bg-emerald-400' : 'bg-rose-400');
    return (
        <div className="flex items-center gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${dot(data.db === 'connected')}`} /> DB
        </span>
        <span className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${dot(data.riot === 'enabled')}`} /> Riot
        </span>
        </div>
    );
}

function NavTab({ to, children }: { to: string; children: ReactNode }) {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                `rounded-lg px-4 py-2 text-sm font-medium transition ${
                isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`
            }
        >
            {children}
        </NavLink>
    );
}

export default function App() {
    //The Discord remote tab is admin-only
    const privileged = usePrivileged();
    return (
        <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4">
            <header className="flex flex-wrap items-center justify-between gap-4 py-6">
                <div className="flex items-center gap-3">
                    <img
                        src="/logo-emblem.png"
                        alt="LoL Match Maker logo"
                        className="h-14 w-14 rounded-xl object-cover"
                    />
                    <div>
                        <h1 className="text-lg font-bold leading-tight text-white">LoL Match Maker</h1>
                        <p className="text-xs text-slate-400">Fair custom teams, powered by internal MMR</p>
                    </div>
                </div>
                <nav className="flex items-center gap-1 rounded-xl bg-slate-900/60 p-1">
                <NavTab to="/players">Players</NavTab>
                <NavTab to="/build">Team Builder</NavTab>
                <NavTab to="/matches">Matches</NavTab>
                {privileged && <NavTab to="/discord">Discord</NavTab>}
                </nav>
                <div className="flex items-center gap-4">
                    <HealthPill />
                    <AuthControl />
                </div>
            </header>

            <main className="flex-1 pb-16">
                <Routes>
                <Route path="/" element={<Navigate to="/players" replace />} />
                {/* Magic link from the Discord #info channel: scope to a server, then redirect. */}
                <Route path="/s/:key" element={<ServerLink />} />
                <Route path="/players" element={<PlayersPage />} />
                <Route path="/build" element={<TeamBuilderPage />} />
                <Route path="/matches" element={<MatchesPage />} />
                <Route path="/discord" element={<DiscordPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="*" element={<Navigate to="/players" replace />} />
                </Routes>
            </main>

            {/* Discord's dev portal links to these; Riot requires the disclaimer. */}
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 py-4 text-xs text-slate-600">
                <span>LoL Match Maker isn't endorsed by Riot Games. League of Legends © Riot Games, Inc.</span>
                <span className="flex gap-4">
                    <NavLink to="/terms" className="hover:text-slate-400">Terms of Service</NavLink>
                    <NavLink to="/privacy" className="hover:text-slate-400">Privacy Policy</NavLink>
                </span>
            </footer>
        </div>
    );
}
