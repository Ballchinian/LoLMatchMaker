import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env, writesProtected } from '../config/env';
import { ApiError } from './errors';

/**
 * Token-based authorization for privileged (write) actions.
 *
 * The browser app or Discord bot sends `Authorization: Bearer <token>` (or
 * `X-Auth-Token`). The token is compared, in constant time, against ADMIN_TOKEN
 * and BOT_TOKEN from the environment, yielding an `actor` role on the request.
 *
 * Reads and team balancing stay public; only mutations use `requireWriter`.
 * If no tokens are configured at all, we run in OPEN dev mode (warned at boot).
 */

export type Actor = 'admin' | 'bot';
/** Who created a record; 'public' = an unauthenticated visitor (pending submissions only). */
export type CreatorActor = Actor | 'public';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const x = req.header('x-auth-token');
  return x ? x.trim() : null;
}

/** Resolve the actor for a request from its token, or null if unauthenticated. */
export function identify(req: Request): Actor | null {
  const token = extractToken(req);
  if (!token) return null;
  if (env.ADMIN_TOKEN.trim() && safeEqual(token, env.ADMIN_TOKEN)) return 'admin';
  if (env.BOT_TOKEN.trim() && safeEqual(token, env.BOT_TOKEN)) return 'bot';
  return null;
}

/**
 * Resolve who is creating a record on a PUBLIC-writable route.
 * - open dev mode (no tokens set): everyone is 'admin'
 * - protected mode: a valid token → 'admin'/'bot', otherwise 'public'
 */
export function resolveCreator(req: Request): CreatorActor {
  if (!writesProtected) return 'admin';
  return identify(req) ?? 'public';
}

/** Gate a route to admin/bot. In open dev mode (no tokens set) it lets everything through as 'admin'. */
export function requireWriter(req: Request, _res: Response, next: NextFunction): void {
  if (!writesProtected) {
    req.actor = 'admin';
    next();
    return;
  }
  const actor = identify(req);
  if (!actor) {
    next(new ApiError(401, 'Unauthorized — admin or bot token required for this action.'));
    return;
  }
  req.actor = actor;
  next();
}
