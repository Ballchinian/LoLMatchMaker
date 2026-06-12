import { Schema, model, type Model, type HydratedDocument, Types } from 'mongoose';
import type { Actor, CreatorActor } from '../middleware/auth';

/*
    'pending':    no MMR moved yet, not being played
    'inProgress': bot set up the game channels, being played (back to pending on cancel)
    'confirmed':  winner set, MMR/RD applied
    'reversed':   confirmed, then undone
*/
export type MatchStatus = 'pending' | 'inProgress' | 'confirmed' | 'reversed';

export interface RosterEntry {
  //Player ObjectId
  player: Types.ObjectId;
  displayName: string;
  //Integer 0..6000
  mmrAtCreate: number;
  //Absent while pending; after = before + delta
  before?: number;
  after?: number;
  delta?: number;
  //Absent while pending and on pre Glicko matches; integers 75..300
  rdBefore?: number;
  rdAfter?: number;
}

export interface MatchAttrs {
  status: MatchStatus;
  //Discord guild (server) this match belongs to; null = legacy single-tenant data
  guildId?: string | null;
  //Two word lobby name; absent on old matches
  name?: string;
  //1..10 entries each
  teamA: RosterEntry[];
  teamB: RosterEntry[];
  //null while pending; kept after reverse
  winner: 'A' | 'B' | null;
  //Public submissions only, null otherwise
  proposedWinner?: 'A' | 'B' | null;
  //Public submissions only; max 40 chars
  reportedBy?: string;
  //Public proposals: the roster player who proposed this match (drives the one-open-proposal limit)
  proposedByPlayer?: Types.ObjectId | null;
  //That player's linked Discord id at proposal time (lets the bot allow self-delete)
  proposedByDiscordId?: string | null;
  /*
      Secret returned ONCE to the proposing browser on create (never in GETs:
      select is false). Presenting it via X-Proposal-Token allows the proposer
      to delete their own pending proposal without being an admin.
  */
  proposalToken?: string;
  //Set on pending -> inProgress; cleared on stop. Drives the ~2h auto-expiry.
  startedAt?: Date | null;
  //Absent while pending; rounded team MMR averages
  teamAAvg?: number;
  teamBAvg?: number;
  //Absent while pending; 0..1, 3 decimals
  expectedA?: number;
  //Pre Glicko matches only; integer 1..128
  kFactor?: number;
  //'admin', 'bot', or 'public'
  createdByActor: CreatorActor;
  //Absent while pending; 'admin' or 'bot'
  confirmedByActor?: Actor;
  confirmedAt?: Date;
  //Set only on reversed matches; 'admin' or 'bot'
  reversedByActor?: Actor;
  reversedAt?: Date;
}

type MatchModel = Model<MatchAttrs>;

//Convert into mongodb document instance
export type MatchDoc = HydratedDocument<MatchAttrs>;

const rosterEntrySchema = new Schema<RosterEntry>(
  {
    player: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    displayName: { type: String, required: true },
    mmrAtCreate: { type: Number, required: true },
    before: { type: Number },
    after: { type: Number },
    delta: { type: Number },
    rdBefore: { type: Number },
    rdAfter: { type: Number },
  },
  { _id: false },
);

const matchSchema = new Schema<MatchAttrs, MatchModel>(
  {
    status: { type: String, enum: ['pending', 'inProgress', 'confirmed', 'reversed'], required: true, default: 'pending', index: true },
    guildId: { type: String, default: null, index: true },
    name: { type: String },
    teamA: { type: [rosterEntrySchema], required: true },
    teamB: { type: [rosterEntrySchema], required: true },
    winner: { type: String, enum: ['A', 'B', null], default: null },
    proposedWinner: { type: String, enum: ['A', 'B', null], default: null },
    reportedBy: { type: String },
    proposedByPlayer: { type: Schema.Types.ObjectId, ref: 'Player', default: null },
    proposedByDiscordId: { type: String, default: null },
    proposalToken: { type: String, select: false },
    startedAt: { type: Date, default: null },
    teamAAvg: { type: Number },
    teamBAvg: { type: Number },
    expectedA: { type: Number },
    kFactor: { type: Number },
    createdByActor: { type: String, enum: ['admin', 'bot', 'public'], required: true },
    confirmedByActor: { type: String, enum: ['admin', 'bot'] },
    confirmedAt: { type: Date },
    reversedByActor: { type: String, enum: ['admin', 'bot'] },
    reversedAt: { type: Date },
  },
  { timestamps: true },
);

export const Match: MatchModel =
  (globalThis as any).__MatchModel ?? model<MatchAttrs, MatchModel>('Match', matchSchema);

(globalThis as any).__MatchModel = Match;
