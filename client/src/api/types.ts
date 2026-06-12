// Mirrors the backend's public response shapes.

export const TIERS = [
    'IRON',
    'BRONZE',
    'SILVER',
    'GOLD',
    'PLATINUM',
    'EMERALD',
    'DIAMOND',
    'MASTER',
    'GRANDMASTER',
    'CHALLENGER',
] as const;
export type Tier = (typeof TIERS)[number];

export const DIVISIONS = ['IV', 'III', 'II', 'I'] as const;
export type Division = (typeof DIVISIONS)[number];

export const CHAMP_POOLS = ['one-trick', 'two-trick', 'diverse'] as const;
export type ChampPool = (typeof CHAMP_POOLS)[number];

export interface RankInfo {
    tier: Tier;
    division: Division | null;
    leaguePoints: number;
    label: string;
}

export interface RiotSnapshot {
    puuid?: string;
    gameName?: string;
    tagLine?: string;
    platform?: string;
    region?: string;
    summonerLevel?: number;
    profileIconId?: number;
    queueType?: string;
    tier?: Tier;
    division?: Division;
    leaguePoints?: number;
    wins?: number;
    losses?: number;
}

export interface RecentForm {
    games: number;
    winRate: number;
    avgKDA: number;
}

export interface Player {
    id: string;
    source: 'riot' | 'manual';
    displayName: string;
    region: string;
    seedMMR: number;
    mmr: number;
    /** Glicko rating deviation — how unsettled the MMR is (75 = veteran … 300 = unknown). */
    rd: number;
    wins: number;
    losses: number;
    gamesPlayed: number;
    tags: string[];
    /** How many of the 5 roles this player covers (1–5). Info only: no MMR effect. */
    rolesPlayed: number;
    /** Champion-pool depth: one-tricks are ban-able in tournaments. */
    champPool: ChampPool;
    /** Champ-pool modifier: -200 … 0 (roles played no longer adjusts MMR). */
    mmrModifier: number;
    /** Adjusted MMR (mmr + modifier): what users see and what balancing uses. */
    effectiveMmr: number;
    discordUserId?: string;
    rank: RankInfo;
    riot?: RiotSnapshot;
    recent?: RecentForm;
    createdAt: string;
}

export interface SearchResult {
    profile: {
        puuid: string;
        gameName: string;
        tagLine: string;
        platform: string;
        region: string;
        summonerLevel?: number;
        rank: {
        queueType: string;
        tier: Tier;
        division: Division;
        leaguePoints: number;
        wins: number;
        losses: number;
        } | null;
        recent: RecentForm | null;
    };
    preview: { displayName: string; region: string; seedMMR: number };
    alreadyInjected: boolean;
}

export interface TeamSplit {
    teamA: string[];
    teamB: string[];
    avgA: number;
    avgB: number;
    avgDiff: number;
    totalA: number;
    totalB: number;
    key: string;
}

export interface BalanceResult {
    candidates: TeamSplit[];
    totalValid: number;
    exact: boolean;
}

export type Actor = 'admin' | 'bot';
export type CreatorActor = Actor | 'public';
export type MatchStatus = 'pending' | 'inProgress' | 'confirmed' | 'reversed';

export interface RosterEntry {
    player: string;
    displayName: string;
    mmrAtCreate: number;
    before?: number;
    after?: number;
    delta?: number;
    rdBefore?: number;
    rdAfter?: number;
}

export interface MatchRecord {
    _id: string;
    status: MatchStatus;
    name?: string;
    teamA: RosterEntry[];
    teamB: RosterEntry[];
    winner: 'A' | 'B' | null;
    proposedWinner?: 'A' | 'B' | null;
    reportedBy?: string;
    /** Roster player id of the (non-admin) proposer, if they identified themself. */
    proposedByPlayer?: string | null;
    /** Set while inProgress; the bot expires games after ~2 hours. */
    startedAt?: string | null;
    teamAAvg?: number;
    teamBAvg?: number;
    expectedA?: number;
    /** Legacy: only on matches confirmed under the old Elo system. */
    kFactor?: number;
    createdByActor: CreatorActor;
    confirmedByActor?: Actor;
    confirmedAt?: string;
    reversedByActor?: Actor;
    reversedAt?: string;
    createdAt: string;
}

export interface HealthInfo {
    ok: boolean;
    db: 'connected' | 'disconnected';
    riot: 'enabled' | 'disabled';
    writeProtection: 'on' | 'off';
}

/** One queued/finished Discord-tab command (mirrors the backend BotCommand). */
export interface BotCommandRecord {
    _id: string;
    action: 'setup' | 'split' | 'join' | 'cancel' | 'confirm' | 'delete';
    match: string;
    matchLabel: string;
    winner?: 'A' | 'B';
    status: 'queued' | 'running' | 'done' | 'error';
    result?: string;
    createdAt: string;
}

/** Before/after view returned by the player/server reset endpoints. */
export interface ResetView {
    displayName: string;
    mmr: number;
    seedMMR: number;
    rd: number;
    wins: number;
    losses: number;
    gamesPlayed: number;
    riotRank: string | null;
}

export interface ResetAllResult {
    id: string;
    displayName: string;
    before?: ResetView;
    after?: ResetView;
    error?: string;
}
