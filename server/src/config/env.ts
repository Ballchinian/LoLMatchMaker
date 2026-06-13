import 'dotenv/config';
import { z } from 'zod';

/**
 * Centralised, validated environment configuration.
 * Parsing fails fast on boot if something required is malformed.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

  // Defaults to a local MongoDB so the app runs out of the box.
  // Override with your Atlas URI when ready.
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/lol-matchmaker'),

  // Privileged-action auth. Set ADMIN_TOKEN (you) and optionally BOT_TOKEN (Discord bot).
  // If BOTH are blank, writes are UNPROTECTED (dev mode) and a loud warning is logged.
  ADMIN_TOKEN: z.string().optional().default(''),
  BOT_TOKEN: z.string().optional().default(''),

  // Signs per-server website login tokens. Falls back to ADMIN_TOKEN+BOT_TOKEN;
  // if all are blank a random per-boot secret is used (logins die on restart).
  AUTH_SECRET: z.string().optional().default(''),

  // Set when running behind a reverse proxy (Railway/Netlify) so the rate
  // limiter keys on the real client IP, not the proxy's. 0 = no proxy (dev).
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),

  // Hard cap on registered Discord servers (0 = unlimited).
  MAX_SERVERS: z.coerce.number().int().min(0).default(0),

  // Reaper: a server with no activity (login/match write) for this many days is
  // deleted along with its data. 0 disables the reaper. Match-history pruning of
  // reversed games older than REVERSED_PRUNE_DAYS runs on the same schedule.
  REAP_INACTIVE_DAYS: z.coerce.number().int().min(0).default(120),
  REVERSED_PRUNE_DAYS: z.coerce.number().int().min(0).default(30),

  NODE_ENV: z.string().optional().default('development'),

  // Riot integration is optional — without a key the app still works with manual entry.
  RIOT_API_KEY: z.string().optional().default(''),
  RIOT_REGION: z.enum(['americas', 'europe', 'asia', 'sea']).default('europe'),
  RIOT_PLATFORM: z
    .enum([
      'na1', 'br1', 'la1', 'la2',
      'euw1', 'eun1', 'tr1', 'ru',
      'kr', 'jp1',
      'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2',
    ])
    .default('euw1'),
  RIOT_RECENT_MATCH_COUNT: z.coerce.number().int().min(0).max(30).default(10),
});

export const env = envSchema.parse(process.env);

/** True when a Riot API key is configured, enabling the player-search feature. */
export const riotEnabled = env.RIOT_API_KEY.trim().length > 0;

/** True when at least one auth token is set, meaning privileged routes are enforced. */
export const writesProtected =
  env.ADMIN_TOKEN.trim().length > 0 || env.BOT_TOKEN.trim().length > 0;

/** True in a production deployment (NODE_ENV=production), used to refuse unsafe configs. */
export const isProduction = env.NODE_ENV.toLowerCase() === 'production';
