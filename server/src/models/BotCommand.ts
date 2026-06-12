import { Schema, model, type Model, type HydratedDocument, Types } from 'mongoose';

/*
    The website's Discord tab can't reach the bot directly (the bot has no
    public HTTP endpoint), so admin clicks are queued here and the bot polls,
    executes, and writes the outcome back.
*/
export type BotCommandAction = 'setup' | 'split' | 'join' | 'cancel' | 'confirm' | 'delete';
export type BotCommandStatus = 'queued' | 'running' | 'done' | 'error';

export interface BotCommandAttrs {
  //Discord guild this command belongs to; null = legacy single-tenant data
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
    action: { type: String, enum: ['setup', 'split', 'join', 'cancel', 'confirm', 'delete'], required: true },
    match: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    matchLabel: { type: String, required: true },
    winner: { type: String, enum: ['A', 'B'] },
    status: { type: String, enum: ['queued', 'running', 'done', 'error'], required: true, default: 'queued', index: true },
    result: { type: String },
  },
  { timestamps: true },
);

export const BotCommand: BotCommandModel =
  (globalThis as any).__BotCommandModel ?? model<BotCommandAttrs, BotCommandModel>('BotCommand', botCommandSchema);

(globalThis as any).__BotCommandModel = BotCommand;
