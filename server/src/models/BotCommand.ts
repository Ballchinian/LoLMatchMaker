import { Schema, model, type Model, type HydratedDocument, Types } from 'mongoose';

/*
    The website's Discord tab can't reach the bot directly (the bot has no
    public HTTP endpoint), so admin clicks are queued here and the bot polls,
    executes, and writes the outcome back.
*/
//'cleanup' is server-enqueued (not a website button): a website-side
//confirm/cancel/delete of an in-progress match tells the bot to return the
//players to Lobby and remove the match channels right away (~5s) instead of
//leaving them to the 60s orphan sweep.
export type BotCommandAction = 'setup' | 'split' | 'join' | 'cancel' | 'confirm' | 'delete' | 'cleanup';
export type BotCommandStatus = 'queued' | 'running' | 'done' | 'error';

export interface BotCommandAttrs {
  //Discord guild this command belongs to; null only in unscoped local dev
  guildId: string | null;
  action: BotCommandAction;
  match: Types.ObjectId;
  //Lobby name snapshot for display even after the match is deleted
  matchLabel: string;
  //confirm only
  winner?: 'A' | 'B';
  status: BotCommandStatus;
  //Bot outcome message; set when status is done/error
  result?: string;
}

type BotCommandModel = Model<BotCommandAttrs>;
export type BotCommandDoc = HydratedDocument<BotCommandAttrs>;

const botCommandSchema = new Schema<BotCommandAttrs, BotCommandModel>(
  {
    guildId: { type: String, default: null, index: true },
    action: { type: String, enum: ['setup', 'split', 'join', 'cancel', 'confirm', 'delete', 'cleanup'], required: true },
    match: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    matchLabel: { type: String, required: true },
    winner: { type: String, enum: ['A', 'B'] },
    status: { type: String, enum: ['queued', 'running', 'done', 'error'], required: true, default: 'queued', index: true },
    result: { type: String },
  },
  { timestamps: true },
);

//Self-cleaning: queued commands are short-lived UI events, no value after a week.
botCommandSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const BotCommand: BotCommandModel =
  (globalThis as any).__BotCommandModel ?? model<BotCommandAttrs, BotCommandModel>('BotCommand', botCommandSchema);

(globalThis as any).__BotCommandModel = BotCommand;
