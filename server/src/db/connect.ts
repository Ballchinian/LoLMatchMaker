import mongoose from 'mongoose';
import { env } from '../config/env';
import { Player } from '../models/Player';
import { Server } from '../models/Server';
import { BotCommand } from '../models/BotCommand';
import { Match } from '../models/Match';

let connected = false;

/*
    Sync indexes for collections that changed shape: the Player discordUserId
    index went from GLOBAL-unique to per-guild compound, Server gained
    lastActiveAt, BotCommand gained a TTL index, and Match's two single-field
    indexes (guildId, status) were replaced by one compound {guildId, status}. syncIndexes drops indexes
    the schema no longer declares and builds new ones. Best effort: a failure
    here must not stop the boot.
*/
async function migrateIndexes(): Promise<void> {
  for (const [name, model] of [
    ['player', Player],
    ['server', Server],
    ['botCommand', BotCommand],
    ['match', Match],
  ] as const) {
    try {
      const dropped = await model.syncIndexes();
      if (dropped.length > 0) console.log(`[db] synced ${name} indexes (dropped: ${dropped.join(', ')})`);
    } catch (err) {
      console.warn(`[db] ${name} index sync skipped:`, (err as Error).message);
    }
  }
}

/**
 * Connect to MongoDB. Safe to call once on boot.
 * Throws if the connection cannot be established (caller decides how loud to be).
 */
export async function connectDB(): Promise<void> {
  if (connected) return;
  mongoose.set('strictQuery', true);
  // Don't queue queries when disconnected — fail fast so requests return a clear
  // error instead of hanging for 10s (the default buffering timeout).
  mongoose.set('bufferCommands', false);
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });
  connected = true;
  const { name, host } = mongoose.connection;
  console.log(`[db] connected to "${name}" @ ${host}`);
  void migrateIndexes();

  mongoose.connection.on('error', (err) => {
    console.error('[db] connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    connected = false;
    console.warn('[db] disconnected');
  });
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
