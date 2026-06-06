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
  wins: number;
  losses: number;
  gamesPlayed: number;
  tags: string[];
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
export type MatchStatus = 'pending' | 'confirmed' | 'reversed';

export interface RosterEntry {
  player: string;
  displayName: string;
  mmrAtCreate: number;
  before?: number;
  after?: number;
  delta?: number;
}

export interface MatchRecord {
  _id: string;
  status: MatchStatus;
  teamA: RosterEntry[];
  teamB: RosterEntry[];
  winner: 'A' | 'B' | null;
  proposedWinner?: 'A' | 'B' | null;
  reportedBy?: string;
  teamAAvg?: number;
  teamBAvg?: number;
  expectedA?: number;
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
