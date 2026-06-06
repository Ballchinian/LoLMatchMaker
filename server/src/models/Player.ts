import { Schema, model, type Model, type HydratedDocument } from 'mongoose';
import { mmrToRank, formatRank, type Tier, type Division } from '../services/rank';

/**
 * A Player is append-only once injected:
 *  - `uniqueKey` carries a unique index, so the same person can't be re-uploaded.
 *  - Seed/identity fields are marked `immutable`, so they can't be edited or "reset".
 *  - Only the live ladder fields (mmr, wins, losses, gamesPlayed) change, and only
 *    through the match-recording flow.
 */

export type PlayerSource = 'riot' | 'manual';

interface RiotSnapshot {
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

interface RecentSnapshot {
  games: number;
  winRate: number;
  avgKDA: number;
}

export interface PlayerAttrs {
  source: PlayerSource;
  uniqueKey: string;
  displayName: string;
  region: string;
  riot?: RiotSnapshot;
  recent?: RecentSnapshot;
  seedMMR: number;
  mmr: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  /** Mutable, free-form organizational labels (e.g. "smurfs", "office", "jungle mains"). */
  tags: string[];
  /** Discord user id linked to this player (for the bot to map voice members). */
  discordUserId?: string;
}

export interface PlayerMethods {
  toPublic(): PublicPlayer;
}

export interface PublicPlayer {
  id: string;
  source: PlayerSource;
  displayName: string;
  region: string;
  seedMMR: number;
  mmr: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  tags: string[];
  discordUserId?: string;
  rank: {
    tier: Tier;
    division: Division | null;
    leaguePoints: number;
    label: string;
  };
  riot?: RiotSnapshot;
  recent?: RecentSnapshot;
  createdAt: string;
}

type PlayerModel = Model<PlayerAttrs, {}, PlayerMethods>;
export type PlayerDoc = HydratedDocument<PlayerAttrs, PlayerMethods>;

const riotSnapshotSchema = new Schema<RiotSnapshot>(
  {
    puuid: String,
    gameName: String,
    tagLine: String,
    platform: String,
    region: String,
    summonerLevel: Number,
    profileIconId: Number,
    queueType: String,
    tier: String,
    division: String,
    leaguePoints: Number,
    wins: Number,
    losses: Number,
  },
  { _id: false },
);

const recentSnapshotSchema = new Schema<RecentSnapshot>(
  {
    games: { type: Number, required: true },
    winRate: { type: Number, required: true },
    avgKDA: { type: Number, required: true },
  },
  { _id: false },
);

const playerSchema = new Schema<PlayerAttrs, PlayerModel, PlayerMethods>(
  {
    source: { type: String, enum: ['riot', 'manual'], required: true, immutable: true },

    // Unique, frozen identity — prevents re-upload of the same player.
    uniqueKey: { type: String, required: true, unique: true, immutable: true },

    displayName: { type: String, required: true, trim: true, immutable: true },
    region: { type: String, required: true, immutable: true },

    // Frozen snapshots captured at injection time.
    riot: { type: riotSnapshotSchema, immutable: true },
    recent: { type: recentSnapshotSchema, immutable: true },

    // Frozen starting MMR; `mmr` is the live value that evolves via Elo.
    seedMMR: { type: Number, required: true, immutable: true },
    mmr: { type: Number, required: true, index: true },

    // Live ladder record (this site's custom games).
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },

    // Mutable organizational labels — NOT part of the immutable identity.
    tags: { type: [String], default: [] },

    // Discord link (one Discord account ↔ one player). Mutable.
    discordUserId: { type: String, index: { unique: true, sparse: true } },
  },
  { timestamps: true },
);

playerSchema.methods.toPublic = function toPublic(this: PlayerDoc): PublicPlayer {
  const rank = mmrToRank(this.mmr);
  return {
    id: this._id.toString(),
    source: this.source,
    displayName: this.displayName,
    region: this.region,
    seedMMR: this.seedMMR,
    mmr: this.mmr,
    wins: this.wins,
    losses: this.losses,
    gamesPlayed: this.gamesPlayed,
    tags: this.tags ?? [],
    discordUserId: this.discordUserId,
    rank: {
      tier: rank.tier,
      division: rank.division,
      leaguePoints: rank.leaguePoints,
      label: formatRank(rank),
    },
    riot: this.riot ? (this.riot as RiotSnapshot) : undefined,
    recent: this.recent ? (this.recent as RecentSnapshot) : undefined,
    createdAt: (this as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
};

export const Player: PlayerModel =
  (globalThis as any).__PlayerModel ?? model<PlayerAttrs, PlayerModel>('Player', playerSchema);

// Avoid OverwriteModelError under tsx watch / hot reload.
(globalThis as any).__PlayerModel = Player;
