import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Server } from '../models/Server';
import { Player } from '../models/Player';
import { Match } from '../models/Match';
import { BotCommand } from '../models/BotCommand';
import { hashPassword, newServerKey, signServerToken, verifyPassword } from '../services/passwords';
import { env } from '../config/env';
import { ApiError, asyncHandler } from '../middleware/errors';
import { isGlobalActor, requireWriter } from '../middleware/auth';

export const serversRouter = Router();

/** Brute-forcing a server password or key gets slow fast. */
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

/*
    Per-server-key login lockout (defence in depth on top of the IP limiter,
    which a botnet can dodge): too many wrong passwords for ONE key locks that
    key briefly regardless of source IP. In-memory (single instance); cleared on
    a correct login.
*/
const LOCK_THRESHOLD = 8;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

function lockState(key: string): { locked: boolean; retryMs: number } {
  const f = failures.get(key);
  if (!f) return { locked: false, retryMs: 0 };
  if (f.until > Date.now()) return { locked: true, retryMs: f.until - Date.now() };
  return { locked: false, retryMs: 0 };
}
function noteFailure(key: string): void {
  const f = failures.get(key) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= LOCK_THRESHOLD) {
    f.until = Date.now() + LOCK_MS;
    f.count = 0;
  }
  failures.set(key, f);
}

const registerSchema = z.object({
  guildId: z.string().min(5).max(32),
  guildName: z.string().min(1).max(120),
  //Current guild owner (bot-reported) and who ran /setup, for the owner-only gate
  ownerId: z.string().max(32).optional(),
  invokerId: z.string().max(32).optional(),
  //Omitted on plain re-register (channel repair): the existing password is kept
  password: z.string().min(4).max(128).optional(),
  //Regenerate the server key (invalidates the old one everywhere it was shared)
  rotateKey: z.boolean().optional(),
});

/**
 * POST /api/servers/register — the bot's /setup registers (or updates) its guild.
 * GLOBAL admin / bot only (a per-server token must not touch another guild).
 * Returns the server key the website uses for this guild.
 */
serversRouter.post(
  '/register',
  requireWriter,
  asyncHandler(async (req, res) => {
    if (!isGlobalActor(req)) {
      throw new ApiError(403, 'Only the bot may register servers.');
    }
    const body = registerSchema.parse(req.body);

    const server = await Server.findOne({ guildId: body.guildId }).exec();

    /*
        Setting the password (incl. the FIRST time), changing it, or rotating the
        key are all takeover vectors, so they're owner-only. The current owner is
        the stored ownerId (preferred), or — on first setup / servers registered
        before we stored it — the bot-reported current owner.
    */
    const wantsSensitiveChange = Boolean(body.password) || Boolean(body.rotateKey);
    if (wantsSensitiveChange) {
      const owner = server?.ownerId ?? body.ownerId;
      if (owner && body.invokerId && body.invokerId !== owner) {
        throw new ApiError(403, 'Only the server owner can set or change the website password or rotate the server key.');
      }
    }

    if (!server) {
      if (!body.password) {
        throw new ApiError(400, 'A website admin password is required to register this server (owner only).');
      }
      //Hard cap on tenants (0 = unlimited). Reaping happens separately.
      if (env.MAX_SERVERS > 0) {
        const count = await Server.countDocuments().exec();
        if (count >= env.MAX_SERVERS) {
          throw new ApiError(503, 'This bot has reached its server limit. Please try again later.');
        }
      }
      const created = await Server.create({
        guildId: body.guildId,
        guildName: body.guildName,
        ownerId: body.ownerId,
        serverKey: newServerKey(),
        adminPasswordHash: hashPassword(body.password),
        tokenVersion: 0,
        lastActiveAt: new Date(),
      });
      res.status(201).json({ serverKey: created.serverKey, created: true });
      return;
    }

    server.guildName = body.guildName;
    if (body.ownerId) server.ownerId = body.ownerId;
    //Re-running /setup with a password rotates it AND logs out old sessions
    if (body.password) {
      server.adminPasswordHash = hashPassword(body.password);
      server.tokenVersion += 1;
    }
    if (body.rotateKey) server.serverKey = newServerKey();
    server.lastActiveAt = new Date();
    await server.save();
    res.json({ serverKey: server.serverKey, created: false, rotatedKey: Boolean(body.rotateKey) });
  }),
);

/**
 * DELETE /api/servers/:guildId — purge a server and ALL its data (the bot calls
 * this when it's kicked; the reaper calls it for dead servers). Global/bot only.
 */
serversRouter.delete(
  '/:guildId',
  requireWriter,
  asyncHandler(async (req, res) => {
    if (!isGlobalActor(req)) throw new ApiError(403, 'Only the bot may purge servers.');
    const guildId = req.params.guildId;
    const [players, matches, commands] = await Promise.all([
      Player.deleteMany({ guildId }).exec(),
      Match.deleteMany({ guildId }).exec(),
      BotCommand.deleteMany({ guildId }).exec(),
      Server.deleteOne({ guildId }).exec(),
    ]);
    res.json({
      ok: true,
      removed: { players: players.deletedCount, matches: matches.deletedCount, commands: commands.deletedCount },
    });
  }),
);

const loginSchema = z.object({
  serverKey: z.string().min(8).max(64),
  password: z.string().min(1).max(128),
});

/**
 * POST /api/servers/login — exchange a server key + admin password for a
 * version-stamped token scoped to that guild. PUBLIC (rate limited + lockout).
 */
serversRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { serverKey, password } = loginSchema.parse(req.body);

    const lock = lockState(serverKey);
    if (lock.locked) {
      throw new ApiError(429, `Too many wrong passwords. Try again in ${Math.ceil(lock.retryMs / 60_000)} min.`);
    }

    const server = await Server.findOne({ serverKey }).exec();
    //Same error either way: don't reveal whether the key exists
    if (!server || !verifyPassword(password, server.adminPasswordHash)) {
      noteFailure(serverKey);
      throw new ApiError(401, 'Unknown server key or wrong password.');
    }

    failures.delete(serverKey);
    server.lastActiveAt = new Date();
    await server.save();
    res.json({
      token: signServerToken(server.guildId, server.tokenVersion),
      guildId: server.guildId,
      guildName: server.guildName,
    });
  }),
);

/**
 * GET /api/servers/lookup — resolve a server key to its name, so the website
 * can show which server a visitor is browsing. PUBLIC (rate limited).
 */
serversRouter.get(
  '/lookup',
  loginLimiter,
  asyncHandler(async (req: Request, res) => {
    const serverKey = String(req.query.key ?? '').trim();
    if (!serverKey) throw new ApiError(400, 'Provide ?key=<server key>.');
    const server = await Server.findOne({ serverKey }).lean().exec();
    if (!server) throw new ApiError(404, 'Unknown server key.');
    res.json({ guildId: server.guildId, guildName: server.guildName });
  }),
);

export default serversRouter;
