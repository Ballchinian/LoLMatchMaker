import { Router } from 'express';
import { identify, requireWriter } from '../middleware/auth';
import { writesProtected } from '../config/env';
import { Server } from '../models/Server';
import { asyncHandler } from '../middleware/errors';

export const authRouter = Router();

/**
 * GET /api/auth/me — validate the caller's token and return their role
 * (and, for per-server admin tokens, which server they administer).
 * Used by the web app to confirm a pasted token/password and unlock controls.
 */
authRouter.get(
  '/me',
  requireWriter,
  asyncHandler(async (req, res) => {
    const id = identify(req);
    let guildName: string | undefined;
    if (id?.guildId) {
      const server = await Server.findOne({ guildId: id.guildId }).lean().exec();
      guildName = server?.guildName;
    }
    res.json({ actor: req.actor, writesProtected, guildId: id?.guildId ?? null, guildName });
  }),
);

export default authRouter;
