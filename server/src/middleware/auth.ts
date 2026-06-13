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
 *  - gs1.* tokens -> per-server 'admin' (issued by /api/auth server-login,
 *                    scoped to the guild baked into the token, and only valid
 *                    while the token's version matches the server's — rotating
 *                    the password bumps the version and logs old sessions out)
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

export interface Identity {
  actor: Actor;
  /** Guild the credential itself is bound to (server tokens only); null = global. */
  guildId: string | null;
  /** Token version (server tokens only), for staleness checks. */
  tokenVersion?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
      /** Discord guild id this request is scoped to; null = legacy/unscoped data. */
      guildId?: string | null;
      /** Resolved identity (undefined = not yet checked, null = anonymous). */
      auth?: Identity | null;
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

/**
 * Cheap (no DB) credential parse: matches the static tokens, or HMAC-verifies a
 * server token. The server token's version is NOT yet validated here — that
 * needs a DB lookup (see authenticate).
 */
function identifyToken(req: Request): Identity | null {
  const token = extractToken(req);
  if (!token) return null;
  if (env.ADMIN_TOKEN.trim() && safeEqual(token, env.ADMIN_TOKEN)) return { actor: 'admin', guildId: null };
  if (env.BOT_TOKEN.trim() && safeEqual(token, env.BOT_TOKEN)) return { actor: 'bot', guildId: null };
  const claims = verifyServerToken(token);
  if (claims) return { actor: 'admin', guildId: claims.guildId, tokenVersion: claims.version };
  return null;
}

/**
 * Full authentication, with the per-server token-version check against the DB.
 * Memoised on the request so resolveScope + requireWriter don't double-look-up.
 */
export async function authenticate(req: Request): Promise<Identity | null> {
  if (req.auth !== undefined) return req.auth;
  let id = identifyToken(req);
  if (id && id.guildId) {
    // Server-bound token: reject if the password has been rotated since issue.
    const server = await Server.findOne({ guildId: id.guildId }).select('tokenVersion').lean().exec();
    if (!server || (server.tokenVersion ?? 0) !== (id.tokenVersion ?? 0)) id = null;
  }
  req.auth = id;
  return id;
}

/**
 * Resolve who is creating a record on a PUBLIC-writable route. Reads the
 * identity resolveScope already cached (matches routes run after it).
 * - open dev mode (no tokens set): everyone is 'admin'
 * - protected mode: a valid token → 'admin'/'bot', otherwise 'public'
 */
export function resolveCreator(req: Request): CreatorActor {
  if (!writesProtected) return 'admin';
  return (req.auth ?? null)?.actor ?? 'public';
}

/** Gate a route to admin/bot. In open dev mode (no tokens set) it lets everything through as 'admin'. */
export const requireWriter = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  if (!writesProtected) {
    req.actor = 'admin';
    next();
    return;
  }
  const id = await authenticate(req);
  if (!id) {
    next(new ApiError(401, 'Unauthorized — admin or bot token required for this action.'));
    return;
  }
  req.actor = id.actor;
  next();
});

/** True when the request is authenticated as the GLOBAL site owner or the bot (not a per-server admin). */
export function isGlobalActor(req: Request): boolean {
  if (!writesProtected) return true;
  const id = req.auth ?? null;
  return id !== null && id.guildId === null;
}

/**
 * Resolve which server's (guild's) data this request sees, into req.guildId.
 * Mounted on every data router. Never rejects: an unknown server key just
 * resolves to a sentinel scope (matching nothing) instead of leaking data.
 * Also bumps the server's lastActiveAt on writes, feeding the dead-server reaper.
 */
export const resolveScope = asyncHandler(async (req, _res, next) => {
  const id = await authenticate(req);

  //Server-admin tokens are hard-bound to their guild
  if (id?.guildId) {
    req.guildId = id.guildId;
    bumpActivity(req);
    next();
    return;
  }

  //The bot (and the global admin) name the guild directly
  const guildHeader = req.header('x-guild-id')?.trim();
  if (guildHeader && (id?.actor === 'bot' || id?.actor === 'admin' || !writesProtected)) {
    req.guildId = guildHeader;
    bumpActivity(req);
    next();
    return;
  }

  //Public visitors prove scope with the unguessable server key
  const serverKey = req.header('x-server-key')?.trim();
  if (serverKey) {
    const server = await Server.findOne({ serverKey }).lean().exec();
    req.guildId = server ? server.guildId : 'unknown-server-key';
    bumpActivity(req);
    next();
    return;
  }

  //No scope: matches only guildId-less documents (i.e. unscoped local dev)
  req.guildId = null;
  next();
});

/*
    Mark a server active on writes so the reaper can tell live servers from dead
    ones. GETs (browsing, the bot's sweep) don't count — only mutations and
    logins do, which is exactly the activity that needs the bot to keep sweeping.
*/
function bumpActivity(req: Request): void {
  if (req.method === 'GET') return;
  const guildId = req.guildId;
  if (!guildId || guildId === 'unknown-server-key') return;
  void Server.updateOne({ guildId }, { $set: { lastActiveAt: new Date() } }).exec().catch(() => undefined);
}

/** Mongo filter limiting a query to the request's server scope. */
export function guildFilter(req: Request): { guildId: string | null } {
  return { guildId: req.guildId ?? null };
}
