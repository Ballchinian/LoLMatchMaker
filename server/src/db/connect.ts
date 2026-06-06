import mongoose from 'mongoose';
import { env } from '../config/env';

let connected = false;

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
