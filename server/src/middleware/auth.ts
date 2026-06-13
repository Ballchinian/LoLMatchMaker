import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env, writesProtected } from '../config/env';
import { verifyServerToken } from '../services/passwords';
import { Server } from '../models/Server';
import { ApiError, asyncHandler } from './errors';

/**
 * Token-based authorization for privileged (write) actions, plus per-server
 * (Discord guild) data scoping.
 *
 * Accepted credentials (Authorization: Bearer <token> or X-Auth-Token):
 *  - ADMIN_TOKEN  -> global 'admin' (site owner, any server)
 *  - BOT_TOKEN    -> 'bot' (the Discord bot; names its guild via X-Guild-Id)
 *  - gs1.* tokens -> per-server 'admin' (issued by /api/auth/server-login,
 *                    scoped to the guild baked into the token)
 *
 * Scope (which server's data a request sees) resolves from, in order: the
 * server token's guild, the bot's X-Guild-Id header, or a public visitor's
 * X-Server-Key header (the unguessable key shared in the Discord info channel).
 * No scope at all sees nothing: every document carries its server's guildId
 * (a null scope only ever matches unscoped local-dev data).
 */

export type Actor = 'admin' | 'bot';
/** Who created a record; 'public' = an unauthenticated visitor (pending submissions only). */
export type CreatorActor = Actor | 'public';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
      /** Discord guild id this request is scoped to; null = legacy/unscoped data. */
      guildId?: string | null;
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

export interface Identity {
  actor: Actor;
  /** Guild the credential itself is bound to (server tokens only). */
  guildId: string | null;
}

/** Resolve the actor for a request from its token, or null if unauthenticated. */
export function identify(req: Request): Identity | null {
  const token = extractToken(req);
  if (!token) return null;
  if (env.ADMIN_TOKEN.trim() && safeEqual(token, env.ADMIN_TOKEN)) return { actor: 'admin', guildId: null };
  if (env.BOT_TOKEN.trim() && safeEqual(token, env.BOT_TOKEN)) return { actor: 'bot', guildId: null };
  const guildId = verifyServerToken(token);
  if (guildId) return { actor: 'admin', guildId };
  return null;
}

/**
 * Resolve who is creating a record on a PUBLIC-writable route.
 * - open dev mode (no tokens set): everyone is 'admin'
 * - protected mode: a valid token → 'admin'/'bot', otherwise 'public'
 */
export function resolveCreator(req: Request): CreatorActor {
  if (!writesProtected) return 'admin';
  return identify(req)?.actor ?? 'public';
}

/** Gate a route to admin/bot. In open dev mode (no tokens set) it lets everything through as 'admin'. */
export function requireWriter(req: Request, _res: Response, next: NextFunction): void {
  if (!writesProtected) {
    req.actor = 'admin';
    next();
    return;
  }
  const id = identify(req);
  if (!id) {
    next(new ApiError(401, 'Unauthorized — admin or bot token required for this action.'));
    return;
  }
  req.actor = id.actor;
  next();
}

/**
 * Resolve which server's (guild's) data this request sees, into req.guildId.
 * Mounted on every data router. Never rejects: an unknown server key just
 * resolves to the (typically empty) legacy tenant instead of leaking data.
 */
export const resolveScope = asyncHandler(async (req, _res, next) => {
  const id = identify(req);

  //Server-admin tokens are hard-bound to their guild
  if (id?.guildId) {
    req.guildId = id.guildId;
    next();
    return;
  }

  //The bot (and the global admin) name the guild directly
  const guildHeader = req.header('x-guild-id')?.trim();
  if (guildHeader && (id?.actor === 'bot' || id?.actor === 'admin' || !writesProtected)) {
    req.guildId = guildHeader;
    next();
    return;
  }

  //Public visitors prove scope with the unguessable server key
  const serverKey = req.header('x-server-key')?.trim();
  if (serverKey) {
    const server = await Server.findOne({ serverKey }).lean().exec();
    req.guildId = server ? server.guildId : 'unknown-server-key';
    next();
    return;
  }

  //No scope: matches only guildId-less documents (i.e. unscoped local dev)
  req.guildId = null;
  next();
});

/** Mongo filter limiting a query to the request's server scope. */
export function guildFilter(req: Request): { guildId: string | null } {
  return { guildId: req.guildId ?? null };
}
