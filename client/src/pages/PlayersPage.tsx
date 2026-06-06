import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  apiErrorMessage,
  getHealth,
  getPlayers,
  injectManualPlayer,
  injectRiotPlayer,
  searchPlayer,
} from '../api/client';
import { DIVISIONS, TIERS, type Division, type SearchResult, type Tier } from '../api/types';
import { RankBadge } from '../components/RankBadge';
import { TagEditor } from '../components/TagEditor';
import { MmrEditor } from '../components/MmrEditor';
import { TagFilterBar } from '../components/TagFilterBar';
import { matchesTagFilter } from '../lib/tags';
import { usePrivileged } from '../lib/usePrivileged';

/** Parse a comma/space separated tag string into a clean list. */
function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/50 p-5 ${className}`}>
      {children}
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500';
const btnPrimary =
  'rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50';
const btnGhost =
  'rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500 disabled:opacity-50';

/* ----------------------------- Riot search ----------------------------- */

function RiotSearch() {
  const qc = useQueryClient();
  const [gameName, setGameName] = useState('');
  const [tagLine, setTagLine] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);

  const search = useMutation({
    mutationFn: () => searchPlayer(gameName.trim(), tagLine.trim()),
    onSuccess: (data) => setResult(data),
  });

  const inject = useMutation({
    mutationFn: () => injectRiotPlayer(gameName.trim(), tagLine.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['players'] });
      setResult(null);
      setGameName('');
      setTagLine('');
    },
  });

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Search &amp; inject from Riot
      </h3>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (gameName.trim() && tagLine.trim()) search.mutate();
        }}
      >
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs text-slate-400">Game name</label>
          <input className={inputCls} value={gameName} onChange={(e) => setGameName(e.target.value)} placeholder="Faker" />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs text-slate-400">Tag</label>
          <input className={inputCls} value={tagLine} onChange={(e) => setTagLine(e.target.value)} placeholder="KR1" />
        </div>
        <button type="submit" className={btnGhost} disabled={search.isPending}>
          {search.isPending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {search.isError && <p className="mt-3 text-sm text-rose-400">{apiErrorMessage(search.error)}</p>}

      {result && (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white">{result.preview.displayName}</p>
              <p className="text-xs text-slate-400">
                {result.profile.rank
                  ? `${result.profile.rank.tier} ${result.profile.rank.division} · ${result.profile.rank.leaguePoints} LP`
                  : 'Unranked'}
                {result.profile.recent &&
                  ` · ${Math.round(result.profile.recent.winRate * 100)}% WR over ${result.profile.recent.games} games`}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Seed MMR</p>
              <p className="text-lg font-bold text-indigo-300">{result.preview.seedMMR}</p>
            </div>
          </div>

          {result.alreadyInjected ? (
            <p className="mt-3 text-sm text-amber-400">
              Already injected — players can't be re-uploaded.
            </p>
          ) : (
            <button className={`${btnPrimary} mt-3`} disabled={inject.isPending} onClick={() => inject.mutate()}>
              {inject.isPending ? 'Injecting…' : 'Inject player'}
            </button>
          )}
          {inject.isError && <p className="mt-2 text-sm text-rose-400">{apiErrorMessage(inject.error)}</p>}
        </div>
      )}
    </Card>
  );
}

/* ----------------------------- Manual add ------------------------------ */

function ManualAdd() {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<'rank' | 'mmr'>('rank');
  const [tier, setTier] = useState<Tier>('SILVER');
  const [division, setDivision] = useState<Division>('II');
  const [lp, setLp] = useState(50);
  const [mmr, setMmr] = useState(1000);
  const [tagsInput, setTagsInput] = useState('');

  const isApex = tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER';

  const add = useMutation({
    mutationFn: () =>
      injectManualPlayer({
        displayName: displayName.trim(),
        tags: parseTags(tagsInput),
        ...(mode === 'rank'
          ? { rank: { tier, division: isApex ? undefined : division, leaguePoints: lp } }
          : { mmr }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['players'] });
      setDisplayName('');
      setTagsInput('');
    },
  });

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Add manually</h3>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (displayName.trim()) add.mutate();
        }}
      >
        <div>
          <label className="mb-1 block text-xs text-slate-400">Display name</label>
          <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ScuttleEnjoyer" />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className={mode === 'rank' ? btnPrimary : btnGhost}
            onClick={() => setMode('rank')}
          >
            By rank
          </button>
          <button
            type="button"
            className={mode === 'mmr' ? btnPrimary : btnGhost}
            onClick={() => setMode('mmr')}
          >
            By raw MMR
          </button>
        </div>

        {mode === 'rank' ? (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Tier</label>
              <select className={inputCls} value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Division</label>
              <select
                className={inputCls}
                value={division}
                disabled={isApex}
                onChange={(e) => setDivision(e.target.value as Division)}
              >
                {DIVISIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">LP</label>
              <input
                type="number"
                className={inputCls}
                value={lp}
                min={0}
                max={2000}
                onChange={(e) => setLp(Number(e.target.value))}
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-xs text-slate-400">Raw MMR (0–6000)</label>
            <input
              type="number"
              className={inputCls}
              value={mmr}
              min={0}
              max={6000}
              onChange={(e) => setMmr(Number(e.target.value))}
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-slate-400">Tags (comma-separated, optional)</label>
          <input
            className={inputCls}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="office, jungle main, smurf"
          />
        </div>

        <button type="submit" className={btnPrimary} disabled={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add player'}
        </button>
        {add.isError && <p className="text-sm text-rose-400">{apiErrorMessage(add.error)}</p>}
      </form>
    </Card>
  );
}

/* ------------------------------ Roster --------------------------------- */

function Roster() {
  const { data: players, isLoading, isError, error } = useQuery({
    queryKey: ['players'],
    queryFn: getPlayers,
  });
  const privileged = usePrivileged();
  const [filter, setFilter] = useState<Set<string>>(new Set());

  const toggleFilter = (key: string) =>
    setFilter((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const visible = useMemo(
    () => (players ?? []).filter((p) => matchesTagFilter(p, filter)),
    [players, filter],
  );

  if (isLoading) return <Card>Loading roster…</Card>;
  if (isError) return <Card><span className="text-rose-400">{apiErrorMessage(error)}</span></Card>;
  if (!players || players.length === 0)
    return <Card><span className="text-slate-400">No players yet. Search Riot or add one manually.</span></Card>;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Roster ({visible.length}
          {visible.length !== players.length ? ` / ${players.length}` : ''})
        </h3>
        <TagFilterBar players={players} selected={filter} onToggle={toggleFilter} onClear={() => setFilter(new Set())} />
      </div>
      <div className="divide-y divide-slate-800">
        {visible.map((p, i) => (
          <div key={p.id} className="px-5 py-3">
            <div className="flex items-center gap-4">
              <span className="w-6 text-center text-sm text-slate-500">{i + 1}</span>
              <div className="flex-1">
                <p className="font-medium text-white">{p.displayName}</p>
                <p className="text-xs text-slate-500">
                  {p.source === 'riot' ? p.region.toUpperCase() : 'manual'} · {p.wins}W {p.losses}L · {p.gamesPlayed} games
                </p>
              </div>
              <RankBadge rank={p.rank} size="sm" />
              <div className="w-16 text-right">
                <p className="text-xs text-slate-500">MMR</p>
                <p className="font-bold text-indigo-300">{p.mmr}</p>
              </div>
            </div>
            <div className="mt-2 space-y-1 pl-10">
              <TagEditor player={p} readOnly={!privileged} />
              {privileged && <MmrEditor player={p} />}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="px-5 py-6 text-sm text-slate-500">No players match the selected tags.</p>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------- Page ---------------------------------- */

export default function PlayersPage() {
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: getHealth, staleTime: 30_000 });
  const privileged = usePrivileged();
  const riotDisabled = health?.riot === 'disabled';

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-5">
        {privileged ? (
          <>
            {riotDisabled ? (
              <Card className="border-amber-700/40 bg-amber-950/20">
                <p className="text-sm text-amber-300">
                  Riot search is disabled — no API key configured on the server. Add one to
                  <span className="font-mono"> server/.env</span> (RIOT_API_KEY) to enable it. You can still
                  add players manually.
                </p>
              </Card>
            ) : (
              <RiotSearch />
            )}
            <ManualAdd />
          </>
        ) : (
          <Card className="border-slate-700/60">
            <p className="text-sm text-slate-400">
              Adding players is restricted. Unlock with an admin token (top-right) to search Riot or
              add players manually. Anyone can browse the roster and build teams.
            </p>
          </Card>
        )}
      </div>
      <Roster />
    </div>
  );
}
