import { Schema, model, type Model, type HydratedDocument } from 'mongoose';
import { mmrToRank, formatRank, type Tier, type Division } from '../services/rank';
import { CHAMP_POOLS, effectiveMMR, versatilityModifier, type ChampPool } from '../services/mmr';
import { currentRD } from '../services/glicko';

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
  //Discord guild (server) this player belongs to; null only in unscoped local dev
  guildId?: string | null;
  uniqueKey: string;
  displayName: string;
  region: string;
  riot?: RiotSnapshot;
  recent?: RecentSnapshot;
  seedMMR: number;
  mmr: number;
  /**
   * Glicko rating deviation — how unsure the system is about `mmr`. Set at
   * injection from the seed curve, shrinks each game, grows with inactivity.
   * Absent on players injected before Glicko; backfilled lazily from history.
   */
  rd?: number;
  /** When this player last had a confirmed match (drives idle RD growth). */
  lastMatchAt?: Date;
  wins: number;
  losses: number;
  gamesPlayed: number;
  /** Mutable, free-form organizational labels (e.g. "smurfs", "office", "jungle mains"). */
  tags: string[];
  /** Champion-pool depth: a one-trick is ban-able in tournaments regardless of role coverage. */
  champPool: ChampPool;
  /** Discord user id linked to this player (for the bot to map voice members). */
  discordUserId?: string;
}

export interface PlayerMethods {
  toPublic(): PublicPlayer;
  /**
   * The RD this player would carry into a game right now: stored value
   * (backfilled from seed + inhouse history when absent), inflated for idle time.
   */
  liveRD(now?: Date): number;
}

export interface PublicPlayer {
  id: string;
  source: PlayerSource;
  displayName: string;
  region: string;
  seedMMR: number;
  mmr: number;
  /** Current rating uncertainty (inflated for inactivity). Lower = more settled. */
  rd: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  tags: string[];
  champPool: ChampPool;
  /** Champ-pool modifier: -200 … 0. */
  mmrModifier: number;
  /** Adjusted MMR (mmr + modifier): shown to users and used for balancing. Ranks use raw mmr. */
  effectiveMmr: number;
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

    // Which Discord server (tenant) owns this player. Frozen at injection.
    guildId: { type: String, default: null, index: true, immutable: true },

    // Unique, frozen identity — prevents re-upload of the same player.
    // Guild-scoped entries embed their guildId (e.g. "1234:riot:<puuid>"), so the
    // same person can exist on two different servers without colliding.
    uniqueKey: { type: String, required: true, unique: true, immutable: true },

    displayName: { type: String, required: true, trim: true, immutable: true },
    region: { type: String, required: true, immutable: true },

    // Frozen snapshots captured at injection time.
    riot: { type: riotSnapshotSchema, immutable: true },
    recent: { type: recentSnapshotSchema, immutable: true },

    // Starting MMR (set at injection); `mmr` is the live value that evolves via Glicko.
    // Both are admin-adjustable via PATCH /players/:id/mmr (identity stays immutable).
    seedMMR: { type: Number, required: true },
    mmr: { type: Number, required: true, index: true },

    // Rating uncertainty + last confirmed game (no default: pre-Glicko players
    // are backfilled lazily via currentRD until their first new match persists it).
    rd: { type: Number, min: 0 },
    lastMatchAt: { type: Date },

    // Live ladder record (this site's custom games).
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },

    // Mutable organizational labels — NOT part of the immutable identity.
    tags: { type: [String], default: [] },

    // Versatility (mutable; set at /link signup or via /update / the admin UI).
    // Champ pool adjusts displayed/balancing MMR (one-trick -200, two-trick -75,
    // diverse 0). Raw mmr drives ranks and Glicko.
    champPool: { type: String, enum: CHAMP_POOLS, default: 'diverse' },

    // Discord link (one Discord account ↔ one player PER SERVER). Mutable.
    discordUserId: { type: String },
  },
  { timestamps: true },
);

// One Discord account claims at most one player within a guild (cross-guild is fine).
playerSchema.index(
  { guildId: 1, discordUserId: 1 },
  { unique: true, partialFilterExpression: { discordUserId: { $type: 'string' } } },
);

playerSchema.methods.liveRD = function liveRD(this: PlayerDoc, now?: Date): number {
  // Ranked games backing the frozen Riot rank snapshot; null = no rank data.
  const riot = this.riot;
  const hasRank = riot?.tier != null;
  const seedGames = hasRank ? (riot?.wins ?? 0) + (riot?.losses ?? 0) : null;

  return currentRD({
    rd: this.rd,
    seedRankedGames: seedGames,
    inhouseGames: this.gamesPlayed ?? 0,
    lastActiveAt: this.lastMatchAt ?? (this as unknown as { createdAt?: Date }).createdAt,
    now,
  });
};

playerSchema.methods.toPublic = function toPublic(this: PlayerDoc): PublicPlayer {
  const rank = mmrToRank(this.mmr);
  return {
    id: this._id.toString(),
    source: this.source,
    displayName: this.displayName,
    region: this.region,
    seedMMR: this.seedMMR,
    mmr: this.mmr,
    rd: this.liveRD(),
    wins: this.wins,
    losses: this.losses,
    gamesPlayed: this.gamesPlayed,
    tags: this.tags ?? [],
    champPool: this.champPool ?? 'diverse',
    mmrModifier: versatilityModifier(this.champPool),
    effectiveMmr: effectiveMMR(this.mmr, this.champPool),
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
