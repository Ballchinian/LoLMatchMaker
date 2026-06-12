import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Player, type PlayerDoc } from '../models/Player';
import { Match, type MatchDoc, type RosterEntry } from '../models/Match';
import { applyMatchResult, type GlickoPlayer } from '../services/glicko';
import { findRecentCustomResult } from '../services/riot';
import { riotEnabled, writesProtected } from '../config/env';
import { randomLobbyName } from '../services/lobbyName';
import { ApiError, asyncHandler } from '../middleware/errors';
import { guildFilter, identify, requireWriter, resolveCreator, type Actor } from '../middleware/auth';

export const matchesRouter = Router();

/** Cap on outstanding pending matches (per server), to bound the public submission queue. */
const MAX_PENDING = 50;

/** Tighter limit on match creation since it's a public write. */
const createLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

/* ------------------------------- helpers ------------------------------- */

const teamsSchema = z.object({
  teamA: z.array(z.string()).min(1).max(10),
  teamB: z.array(z.string()).min(1).max(10),
  // Admin/bot only: confirm immediately on create.
  winner: z.enum(['A', 'B']).optional(),
  // Public reporters: the winner they claim + who they are (for admin review).
  proposedWinner: z.enum(['A', 'B']).optional(),
  reportedBy: z.string().max(40).optional(),
  // Public proposers must say which roster player they are (one open proposal each).
  proposedByPlayerId: z.string().optional(),
});

/** Load a match by id within the request's server scope (404 outside it). */
async function loadScopedMatch(req: Request, opts?: { withToken?: boolean }): Promise<MatchDoc> {
  let query = Match.findById(req.params.id);
  if (opts?.withToken) query = query.select('+proposalToken');
  const match = await query.exec();
  if (!match || (match.guildId ?? null) !== (req.guildId ?? null)) {
    throw new ApiError(404, 'Match not found.');
  }
  return match;
}

const confirmSchema = z.object({
  // Optional: defaults to the reporter's proposed winner if omitted.
  winner: z.enum(['A', 'B']).optional(),
});

/** Load the given player ids (within the guild scope), erroring if any are missing or duplicated. */
async function loadPlayers(
  teamA: string[],
  teamB: string[],
  guildId: string | null,
): Promise<Map<string, PlayerDoc>> {
  const overlap = teamA.filter((id) => teamB.includes(id));
  if (overlap.length > 0) throw new ApiError(400, 'A player cannot be on both teams.');

  const allIds = [...teamA, ...teamB];
  if (new Set(allIds).size !== allIds.length) throw new ApiError(400, 'Duplicate player ids.');

  const players = await Player.find({ _id: { $in: allIds }, guildId }).exec();
  if (players.length !== allIds.length) throw new ApiError(404, 'One or more players were not found.');

  return new Map(players.map((p) => [p._id.toString(), p]));
}

//A lobby name not currently used by another open match on this server (best-effort, falls back with a suffix)
async function uniqueLobbyName(guildId: string | null): Promise<string> {
  const pending = await Match.find({ status: { $in: ['pending', 'inProgress'] }, guildId })
    .select('name')
    .lean()
    .exec();
  const taken = new Set(pending.map((m) => m.name).filter(Boolean));
  for (let i = 0; i < 25; i++) {
    const candidate = randomLobbyName();
    if (!taken.has(candidate)) return candidate;
  }
  return `${randomLobbyName()} ${Math.floor(Math.random() * 1000)}`;
}

function rosterFrom(ids: string[], byId: Map<string, PlayerDoc>): RosterEntry[] {
  return ids.map((id) => {
    const p = byId.get(id)!;
    return { player: p._id, displayName: p.displayName, mmrAtCreate: p.mmr };
  });
}

/*
    Confirm a pending match: compute Glicko updates from the players' CURRENT
    mmr/RD, persist each player's new mmr + RD + ladder record, fill in the
    match's before/after, and finalize it. Returns the updated players.
 */
async function confirmMatch(match: MatchDoc, winner: 'A' | 'B', actor: Actor) {
  const teamAIds = match.teamA.map((e) => e.player.toString());
  const teamBIds = match.teamB.map((e) => e.player.toString());

  const now = new Date();
  const byId = await loadPlayers(teamAIds, teamBIds, match.guildId ?? null);
  const toGlicko = (ids: string[]): GlickoPlayer[] =>
    ids.map((id) => {
      const p = byId.get(id)!;
      return { id, mmr: p.mmr, rd: p.liveRD(now) };
    });

  const outcome = applyMatchResult(toGlicko(teamAIds), toGlicko(teamBIds), winner);
  const changeById = new Map(outcome.changes.map((c) => [c.id, c]));

  const fill = (entries: RosterEntry[]) => {
    for (const e of entries) {
      const c = changeById.get(e.player.toString())!;
      e.before = c.before;
      e.after = c.after;
      e.delta = c.delta;
      e.rdBefore = c.rdBefore;
      e.rdAfter = c.rdAfter;
    }
  };
  fill(match.teamA);
  fill(match.teamB);

  // Persist per-player MMR + RD + ladder record.
  await Promise.all(
    outcome.changes.map((c) => {
      const onWinningTeam =
        (winner === 'A' && teamAIds.includes(c.id)) || (winner === 'B' && teamBIds.includes(c.id));
      return Player.updateOne(
        { _id: c.id },
        {
          $set: { mmr: c.after, rd: c.rdAfter, lastMatchAt: now },
          $inc: { gamesPlayed: 1, wins: onWinningTeam ? 1 : 0, losses: onWinningTeam ? 0 : 1 },
        },
      ).exec();
    }),
  );

  match.status = 'confirmed';
  match.winner = winner;
  match.teamAAvg = Math.round(outcome.teamAAvg);
  match.teamBAvg = Math.round(outcome.teamBAvg);
  match.expectedA = Math.round(outcome.expectedA * 1000) / 1000;
  match.confirmedByActor = actor;
  match.confirmedAt = now;
  await match.save();

  const updated = await Player.find({ _id: { $in: [...teamAIds, ...teamBIds] } }).exec();
  return updated.map((p) => p.toPublic());
}

/**
 * Reverse a confirmed match: undo each participant's MMR delta and ladder record
 * (clamped at 0), then flag the match `reversed`. It STAYS in history for audit.
 *
 * Note: this removes exactly this match's point swing. If players have since played
 * other games, those remain — a full ladder recompute would be a separate feature.
 */
async function reverseMatch(match: MatchDoc, actor: Actor) {
  const allIds = [...match.teamA, ...match.teamB].map((e) => e.player.toString());
  const players = await Player.find({ _id: { $in: allIds } }).exec();
  const byId = new Map(players.map((p) => [p._id.toString(), p]));

  const undo = (entries: RosterEntry[], won: boolean) => {
    for (const e of entries) {
      const p = byId.get(e.player.toString());
      if (!p) continue; // player no longer exists — skip
      p.mmr = Math.max(0, p.mmr - (e.delta ?? 0));
      // Restore the uncertainty this game consumed (pre-Glicko matches have none).
      if (e.rdBefore != null) p.rd = e.rdBefore;
      p.gamesPlayed = Math.max(0, p.gamesPlayed - 1);
      if (won) p.wins = Math.max(0, p.wins - 1);
      else p.losses = Math.max(0, p.losses - 1);
    }
  };
  undo(match.teamA, match.winner === 'A');
  undo(match.teamB, match.winner === 'B');

  await Promise.all([...byId.values()].map((p) => p.save()));

  match.status = 'reversed';
  match.reversedByActor = actor;
  match.reversedAt = new Date();
  await match.save();

  return players.map((p) => p.toPublic());
}

/* -------------------------------- routes ------------------------------- */

/** GET /api/matches — this server's games, newest first (pending + confirmed). Public within scope. */
matchesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const matches = await Match.find(guildFilter(req)).sort({ createdAt: -1 }).limit(100).lean().exec();
    res.json({ matches });
  }),
);

/**
 * GET /api/matches/:id/detected-winner — best-effort: find the played custom
 * game in Riot match history and report who won. `detected: null` means
 * "couldn't tell" (plain customs aren't guaranteed to appear in match-v5) —
 * the caller should fall back to asking the players.
 */
matchesRouter.get(
  '/:id/detected-winner',
  requireWriter,
  asyncHandler(async (req, res) => {
    const match = await loadScopedMatch(req);
    if (match.status !== 'pending' && match.status !== 'inProgress') {
      throw new ApiError(409, 'Only pending or in-progress matches have a winner to detect.');
    }

    const allIds = [...match.teamA, ...match.teamB].map((e) => e.player.toString());
    const players = await Player.find({ _id: { $in: allIds } }).exec();
    const byId = new Map(players.map((p) => [p._id.toString(), p]));
    const puuidsOf = (entries: RosterEntry[]) =>
      entries
        .map((e) => byId.get(e.player.toString())?.riot?.puuid)
        .filter((x): x is string => Boolean(x));

    const createdAt = (match as unknown as { createdAt: Date }).createdAt;
    const detected = riotEnabled
      ? await findRecentCustomResult(puuidsOf(match.teamA), puuidsOf(match.teamB), createdAt.getTime()).catch(
          () => null,
        )
      : null;
    res.json({ detected });
  }),
);

/**
 * POST /api/matches — create a matchup (auto-balanced or hand-made). PUBLIC route.
 *
 * - Public visitors: always creates a PENDING submission for the admin to review
 *   (their `winner` is ignored; `proposedWinner`/`reportedBy` are recorded). Spam-capped.
 * - Admin/bot: `winner` ⇒ confirmed immediately (MMR applied now); otherwise pending.
 */
matchesRouter.post(
  '/',
  createLimiter,
  asyncHandler(async (req, res) => {
    const body = teamsSchema.parse(req.body);
    const creator = resolveCreator(req);
    const guildId = req.guildId ?? null;
    const byId = await loadPlayers(body.teamA, body.teamB, guildId);

    const isPrivileged = creator === 'admin' || creator === 'bot';

    let proposedByPlayer: PlayerDoc | null = null;
    if (!isPrivileged) {
      // Public submissions are pending-only and capped to deter spam.
      const pendingCount = await Match.countDocuments({ status: 'pending', guildId }).exec();
      if (pendingCount >= MAX_PENDING) {
        throw new ApiError(429, 'Too many matches are awaiting review. Please try again later.');
      }

      // Proposers must identify as one of the roster players...
      proposedByPlayer = body.proposedByPlayerId ? (byId.get(body.proposedByPlayerId) ?? null) : null;
      if (!proposedByPlayer) {
        throw new ApiError(400, 'Pick which of the match\'s players you are before proposing.');
      }
      // ...and may only have ONE open proposal at a time (delete it to re-propose).
      const open = await Match.findOne({
        guildId,
        status: { $in: ['pending', 'inProgress'] },
        proposedByPlayer: proposedByPlayer._id,
      })
        .select('name')
        .lean()
        .exec();
      if (open) {
        throw new ApiError(
          409,
          `You already have an open proposal (${open.name ?? 'unnamed'}). Delete it before proposing another match.`,
        );
      }
    }

    //Returned once to the proposing browser; lets them delete their own proposal later
    const proposalToken = isPrivileged ? undefined : randomBytes(24).toString('hex');

    const match = await Match.create({
      status: 'pending',
      guildId,
      name: await uniqueLobbyName(guildId),
      teamA: rosterFrom(body.teamA, byId),
      teamB: rosterFrom(body.teamB, byId),
      winner: null,
      proposedWinner: body.proposedWinner ?? null,
      reportedBy: body.reportedBy?.trim() || proposedByPlayer?.displayName || undefined,
      proposedByPlayer: proposedByPlayer?._id ?? null,
      proposedByDiscordId: proposedByPlayer?.discordUserId ?? null,
      proposalToken,
      createdByActor: creator,
    });

    // Only admin/bot may confirm in one shot.
    if (isPrivileged && body.winner) {
      const players = await confirmMatch(match, body.winner, creator as Actor);
      res.status(201).json({ match, players });
      return;
    }

    //match.toJSON would include proposalToken here (we selected it by creating);
    //strip it from the document and hand it back separately, once.
    const json = match.toObject() as unknown as Record<string, unknown>;
    delete json.proposalToken;
    res.status(201).json({ match: json, players: [], proposalToken });
  }),
);

/**
 * POST /api/matches/:id/confirm — confirm a pending match's winner (applies MMR). Admin/bot.
 * If `winner` is omitted, falls back to the reporter's proposed winner.
 */
matchesRouter.post(
  '/:id/confirm',
  requireWriter,
  asyncHandler(async (req, res) => {
    const { winner } = confirmSchema.parse(req.body);
    const match = await loadScopedMatch(req);
    if (match.status !== 'pending' && match.status !== 'inProgress') {
      throw new ApiError(409, 'This match has already been confirmed.');
    }

    const effectiveWinner = winner ?? match.proposedWinner ?? null;
    if (effectiveWinner !== 'A' && effectiveWinner !== 'B') {
      throw new ApiError(400, 'Specify the winner (A or B) — no proposed winner to fall back on.');
    }

    const players = await confirmMatch(match, effectiveWinner, req.actor!);
    res.json({ match, players });
  }),
);

/**
 * POST /api/matches/:id/start — pending -> inProgress (the bot set up the game). Admin/bot.
 * A player may only be in ONE active game at a time, admins included.
 */
matchesRouter.post(
  '/:id/start',
  requireWriter,
  asyncHandler(async (req, res) => {
    const match = await loadScopedMatch(req);
    if (match.status !== 'pending') {
      throw new ApiError(409, 'Only pending matches can be started.');
    }

    const rosterIds = [...match.teamA, ...match.teamB].map((e) => e.player);
    const clash = await Match.findOne({
      guildId: match.guildId ?? null,
      status: 'inProgress',
      _id: { $ne: match._id },
      $or: [{ 'teamA.player': { $in: rosterIds } }, { 'teamB.player': { $in: rosterIds } }],
    })
      .lean()
      .exec();
    if (clash) {
      const inClash = new Set(
        [...clash.teamA, ...clash.teamB].map((e) => e.player.toString()),
      );
      const busy = [...match.teamA, ...match.teamB]
        .filter((e) => inClash.has(e.player.toString()))
        .map((e) => e.displayName);
      throw new ApiError(
        409,
        `Already playing in ${clash.name ?? 'another match'}: ${busy.join(', ')}. A player can only be in one active game.`,
      );
    }

    match.status = 'inProgress';
    match.startedAt = new Date();
    await match.save();
    res.json({ match });
  }),
);

/** POST /api/matches/:id/stop — inProgress -> pending (the active game was cancelled). Admin/bot. */
matchesRouter.post(
  '/:id/stop',
  requireWriter,
  asyncHandler(async (req, res) => {
    const match = await loadScopedMatch(req);
    if (match.status !== 'inProgress') {
      throw new ApiError(409, 'Only in-progress matches can be cancelled.');
    }
    match.status = 'pending';
    match.startedAt = null;
    await match.save();
    res.json({ match });
  }),
);

/** POST /api/matches/:id/reverse — undo a confirmed match's MMR; keep it in history. Admin/bot. */
matchesRouter.post(
  '/:id/reverse',
  requireWriter,
  asyncHandler(async (req, res) => {
    const match = await loadScopedMatch(req);
    if (match.status !== 'confirmed') {
      throw new ApiError(409, 'Only confirmed matches can be reversed.');
    }
    const players = await reverseMatch(match, req.actor!);
    res.json({ match, players });
  }),
);

/**
 * DELETE /api/matches/:id — remove a match entirely. Confirmed matches are immutable.
 * - admin/bot: pending and in-progress matches (in-progress deletion is the
 *   exceptional "void this game" path; the bot gates it behind a unanimous vote)
 * - public: only their OWN pending proposal, proven by the X-Proposal-Token
 *   secret returned when they created it
 */
matchesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const match = await loadScopedMatch(req, { withToken: true });
    const isPrivileged = !writesProtected || identify(req) !== null;

    if (isPrivileged) {
      if (match.status !== 'pending' && match.status !== 'inProgress') {
        throw new ApiError(409, 'Confirmed matches can\'t be deleted — reverse them instead.');
      }
    } else {
      if (match.status !== 'pending') {
        throw new ApiError(409, 'Only pending proposals can be deleted.');
      }
      const token = req.header('x-proposal-token')?.trim() ?? '';
      const expected = match.proposalToken ?? '';
      const a = Buffer.from(token);
      const b = Buffer.from(expected);
      if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new ApiError(401, 'Only the player who proposed this match (or an admin) can delete it.');
      }
    }

    await match.deleteOne();
    res.json({ ok: true });
  }),
);

export default matchesRouter;
