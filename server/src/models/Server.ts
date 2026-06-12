import { Schema, model, type Model, type HydratedDocument } from 'mongoose';

/*
    One registered Discord server (tenant). Created/updated by the bot's /setup.
    Players, matches and bot commands all carry this server's guildId, so
    nothing is shared between servers.
*/
export interface ServerAttrs {
  //Discord guild id (snowflake)
  guildId: string;
  guildName: string;
  //Unguessable website handle: knowing it grants VIEW access to this server's data
  serverKey: string;
  //scrypt hash (s2$salt$hash) of the website admin password set at /setup
  adminPasswordHash: string;
}

type ServerModel = Model<ServerAttrs>;
export type ServerDoc = HydratedDocument<ServerAttrs>;

const serverSchema = new Schema<ServerAttrs, ServerModel>(
  {
    guildId: { type: String, required: true, unique: true },
    guildName: { type: String, required: true },
    serverKey: { type: String, required: true, unique: true },
    adminPasswordHash: { type: String, required: true },
  },
  { timestamps: true },
);

export const Server: ServerModel =
  (globalThis as any).__ServerModel ?? model<ServerAttrs, ServerModel>('Server', serverSchema);

(globalThis as any).__ServerModel = Server;
