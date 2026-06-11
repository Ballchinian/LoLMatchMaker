import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Player, type PlayerDoc } from '../models/Player';
import { Match, type MatchDoc, type RosterEntry } from '../models/Match';
import { applyMatchResult, type GlickoPlayer } from '../services/glicko';
import { findRecentCustomResult } from '../services/riot';
import { riotEnabled } from '../config/env';
import { randomLobbyName } from '../services/lobbyName';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireWriter, resolveCreator, type Actor } from '../middleware/auth';

export const matchesRouter = Router();

/** Cap on outstanding pending matches, to bound the public submission queue. */
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
});

const confirmSchema = z.object({
  // Optional: defaults to the reporter's proposed winner if omitted.
  winner: z.enum(['A', 'B']).optional(),
});

/** Load the given player ids, erroring if any are missing or duplicated. */
async function loadPlayers(teamA: string[], teamB: string[]): Promise<Map<string, PlayerDoc>> {
  const overlap = teamA.filter((id) => teamB.includes(id));
  if (overlap.length > 0) throw new ApiError(400, 'A player cannot be on both teams.');

  const allIds = [...teamA, ...teamB];
  if (new Set(allIds).size !== allIds.length) throw new ApiError(400, 'Duplicate player ids.');

  const players = await Player.find({ _id: { $in: allIds } }).exec();
  if (players.length !== allIds.length) throw new ApiError(404, 'One or more players were not found.');

  return new Map(players.map((p) => [p._id.toString(), p]));
}

//A lobby name not currently used by another pending match (best-effort, falls back with a suffix)
async function uniqueLobbyName(): Promise<string> {
  const pending = await Match.find({ status: 'pending' }).select('name').lean().exec();
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
  const byId = await loadPlayers(teamAIds, teamBIds);
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

/** GET /api/matches — all games, newest first (pending + confirmed). Public. */
matchesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const matches = await Match.find().sort({ createdAt: -1 }).limit(100).lean().exec();
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
    const match = await Match.findById(req.params.id).exec();
    if (!match) throw new ApiError(404, 'Match not found.');
    if (match.status !== 'pending') throw new ApiError(409, 'Only pending matches have a winner to detect.');

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
    const byId = await loadPlayers(body.teamA, body.teamB);

    const isPrivileged = creator === 'admin' || creator === 'bot';

    // Public submissions are pending-only and capped to deter spam.
    if (!isPrivileged) {
      const pendingCount = await Match.countDocuments({ status: 'pending' }).exec();
      if (pendingCount >= MAX_PENDING) {
        throw new ApiError(429, 'Too many matches are awaiting review. Please try again later.');
      }
    }

    const match = await Match.create({
      status: 'pending',
      name: await uniqueLobbyName(),
      teamA: rosterFrom(body.teamA, byId),
      teamB: rosterFrom(body.teamB, byId),
      winner: null,
      proposedWinner: body.proposedWinner ?? null,
      reportedBy: body.reportedBy?.trim() || undefined,
      createdByActor: creator,
    });

    // Only admin/bot may confirm in one shot.
    if ((creator === 'admin' || creator === 'bot') && body.winner) {
      const players = await confirmMatch(match, body.winner, creator);
      res.status(201).json({ match, players });
      return;
    }

    res.status(201).json({ match, players: [] });
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
    const match = await Match.findById(req.params.id).exec();
    if (!match) throw new ApiError(404, 'Match not found.');
    if (match.status !== 'pending') throw new ApiError(409, 'This match has already been confirmed.');

    const effectiveWinner = winner ?? match.proposedWinner ?? null;
    if (effectiveWinner !== 'A' && effectiveWinner !== 'B') {
      throw new ApiError(400, 'Specify the winner (A or B) — no proposed winner to fall back on.');
    }

    const players = await confirmMatch(match, effectiveWinner, req.actor!);
    res.json({ match, players });
  }),
);

/** POST /api/matches/:id/reverse — undo a confirmed match's MMR; keep it in history. Admin/bot. */
matchesRouter.post(
  '/:id/reverse',
  requireWriter,
  asyncHandler(async (req, res) => {
    const match = await Match.findById(req.params.id).exec();
    if (!match) throw new ApiError(404, 'Match not found.');
    if (match.status !== 'confirmed') {
      throw new ApiError(409, 'Only confirmed matches can be reversed.');
    }
    const players = await reverseMatch(match, req.actor!);
    res.json({ match, players });
  }),
);

/** DELETE /api/matches/:id — discard a PENDING match. Confirmed matches are immutable. */
matchesRouter.delete(
  '/:id',
  requireWriter,
  asyncHandler(async (req, res) => {
    const match = await Match.findById(req.params.id).exec();
    if (!match) throw new ApiError(404, 'Match not found.');
    if (match.status !== 'pending') {
      throw new ApiError(409, 'Confirmed matches cannot be deleted (they affected MMR).');
    }
    await match.deleteOne();
    res.json({ ok: true });
  }),
);

export default matchesRouter;
