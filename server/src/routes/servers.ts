import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Server } from '../models/Server';
import { Player } from '../models/Player';
import { Match } from '../models/Match';
import { hashPassword, newServerKey, signServerToken, verifyPassword } from '../services/passwords';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireWriter } from '../middleware/auth';

export const serversRouter = Router();

/** Brute-forcing a server password or key gets slow fast. */
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

const registerSchema = z.object({
  guildId: z.string().min(5).max(32),
  guildName: z.string().min(1).max(120),
  //Omitted on re-register: the existing password is kept
  password: z.string().min(4).max(128).optional(),
});

/*
    Adopt legacy single-tenant documents into the FIRST server that registers:
    sets their guildId and prefixes uniqueKeys so future per-guild keys can't
    collide with them. A no-op for every later server, and locked to
    LEGACY_GUILD_ID when set (so a stranger's server can't claim the old data).
*/
async function adoptLegacyData(guildId: string): Promise<void> {
  if (env.LEGACY_GUILD_ID.trim() && env.LEGACY_GUILD_ID.trim() !== guildId) return;
  const others = await Server.countDocuments({ guildId: { $ne: guildId } }).exec();
  if (others > 0) return;

  const players = await Player.collection.updateMany({ guildId: { $in: [null, undefined] } }, [
    { $set: { guildId, uniqueKey: { $concat: [guildId, ':', '$uniqueKey'] } } },
  ]);
  const matches = await Match.updateMany(
    { guildId: { $in: [null, undefined] } },
    { $set: { guildId } },
  ).exec();
  if (players.modifiedCount || matches.modifiedCount) {
    console.log(
      `[servers] adopted ${players.modifiedCount} player(s) + ${matches.modifiedCount} match(es) into guild ${guildId}`,
    );
  }
}

/**
 * POST /api/servers/register — the bot's /setup registers (or updates) its guild.
 * Bot/global-admin only. Returns the server key the website uses for this guild.
 */
serversRouter.post(
  '/register',
  requireWriter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);

    let server = await Server.findOne({ guildId: body.guildId }).exec();
    if (!server) {
      if (!body.password) {
        throw new ApiError(400, 'A website admin password is required to register this server.');
      }
      server = await Server.create({
        guildId: body.guildId,
        guildName: body.guildName,
        serverKey: newServerKey(),
        adminPasswordHash: hashPassword(body.password),
      });
      await adoptLegacyData(body.guildId);
      res.status(201).json({ serverKey: server.serverKey, created: true });
      return;
    }

    server.guildName = body.guildName;
    //Re-running /setup with a password rotates it
    if (body.password) server.adminPasswordHash = hashPassword(body.password);
    await server.save();
    res.json({ serverKey: server.serverKey, created: false });
  }),
);

const loginSchema = z.object({
  serverKey: z.string().min(8).max(64),
  password: z.string().min(1).max(128),
});

/**
 * POST /api/servers/login — exchange a server key + admin password for a
 * 30-day signed token scoped to that guild. PUBLIC (rate limited).
 */
serversRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { serverKey, password } = loginSchema.parse(req.body);
    const server = await Server.findOne({ serverKey }).exec();
    //Same error either way: don't reveal whether the key exists
    if (!server || !verifyPassword(password, server.adminPasswordHash)) {
      throw new ApiError(401, 'Unknown server key or wrong password.');
    }
    res.json({
      token: signServerToken(server.guildId),
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
  asyncHandler(async (req, res) => {
    const serverKey = String(req.query.key ?? '').trim();
    if (!serverKey) throw new ApiError(400, 'Provide ?key=<server key>.');
    const server = await Server.findOne({ serverKey }).lean().exec();
    if (!server) throw new ApiError(404, 'Unknown server key.');
    res.json({ guildId: server.guildId, guildName: server.guildName });
  }),
);

export default serversRouter;
