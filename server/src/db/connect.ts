import mongoose from 'mongoose';
import { env } from '../config/env';
import { Player } from '../models/Player';

let connected = false;

/*
    One-time index migration for multi-tenancy: the old schema had a GLOBAL
    unique index on discordUserId; per-server data needs uniqueness per guild.
    syncIndexes drops indexes the schema no longer declares and builds the
    new compound one. Best effort: a failure here must not stop the boot.
*/
async function migrateIndexes(): Promise<void> {
  try {
    const dropped = await Player.syncIndexes();
    if (dropped.length > 0) console.log(`[db] dropped stale player indexes: ${dropped.join(', ')}`);
  } catch (err) {
    console.warn('[db] index sync skipped:', (err as Error).message);
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
