import { Router } from 'express';
import { requireWriter } from '../middleware/auth';
import { writesProtected } from '../config/env';

export const authRouter = Router();

/**
 * GET /api/auth/me — validate the caller's token and return their role.
 * Used by the web app to confirm a pasted admin token and unlock controls.
 */
authRouter.get('/me', requireWriter, (req, res) => {
  res.json({ actor: req.actor, writesProtected });
});

export default authRouter;
