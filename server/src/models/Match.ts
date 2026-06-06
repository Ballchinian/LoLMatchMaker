import { Schema, model, type Model, type HydratedDocument, Types } from 'mongoose';
import type { Actor, CreatorActor } from '../middleware/auth';

/**
 * A custom game with a lifecycle:
 *   - 'pending'   : the two rosters are locked in (auto-balanced or hand-made) but the
 *                   winner hasn't been confirmed yet. No MMR has moved.
 *   - 'confirmed' : an admin/bot confirmed the winner; MMR/Elo has been applied and the
 *                   per-player before/after is recorded for audit.
 *
 * Each roster entry stores the player's MMR at creation; on confirmation we also fill
 * before/after/delta from the Elo calculation (using live MMR at confirm time).
 */

export type MatchStatus = 'pending' | 'confirmed' | 'reversed';

export interface RosterEntry {
  player: Types.ObjectId;
  displayName: string;
  mmrAtCreate: number;
  before?: number;
  after?: number;
  delta?: number;
}

export interface MatchAttrs {
  status: MatchStatus;
  teamA: RosterEntry[];
  teamB: RosterEntry[];
  /** The confirmed winner (set on confirmation). */
  winner: 'A' | 'B' | null;
  /** The winner the reporter claimed at submission (for the admin to review). */
  proposedWinner?: 'A' | 'B' | null;
  /** Free-text name a public reporter optionally attached to the submission. */
  reportedBy?: string;
  teamAAvg?: number;
  teamBAvg?: number;
  expectedA?: number;
  kFactor?: number;
  createdByActor: CreatorActor;
  confirmedByActor?: Actor;
  confirmedAt?: Date;
  reversedByActor?: Actor;
  reversedAt?: Date;
}

type MatchModel = Model<MatchAttrs>;
export type MatchDoc = HydratedDocument<MatchAttrs>;

const rosterEntrySchema = new Schema<RosterEntry>(
  {
    player: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    displayName: { type: String, required: true },
    mmrAtCreate: { type: Number, required: true },
    before: { type: Number },
    after: { type: Number },
    delta: { type: Number },
  },
  { _id: false },
);

const matchSchema = new Schema<MatchAttrs, MatchModel>(
  {
    status: { type: String, enum: ['pending', 'confirmed', 'reversed'], required: true, default: 'pending', index: true },
    teamA: { type: [rosterEntrySchema], required: true },
    teamB: { type: [rosterEntrySchema], required: true },
    winner: { type: String, enum: ['A', 'B', null], default: null },
    proposedWinner: { type: String, enum: ['A', 'B', null], default: null },
    reportedBy: { type: String },
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
