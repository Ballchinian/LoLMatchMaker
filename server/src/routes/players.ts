import { Router } from 'express';
import { z } from 'zod';
import { Player } from '../models/Player';
import { lookupByRiotId, type RiotProfile } from '../services/riot';
import { computeSeedMMR } from '../services/mmr';
import { rankToMMR, TIERS, DIVISIONS, type Tier, type Division } from '../services/rank';
import { riotEnabled } from '../config/env';
import { ApiError, asyncHandler } from '../middleware/errors';
import { requireWriter } from '../middleware/auth';

export const playersRouter = Router();

/* ------------------------------- helpers ------------------------------- */

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Trim, drop empties, and de-duplicate tags case-insensitively (keeping first-seen casing). */
function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

const tagsField = z.array(z.string().max(24)).max(20).optional();

function riotUniqueKey(puuid: string): string {
  return `riot:${puuid}`;
}

function manualUniqueKey(region: string, displayName: string): string {
  return `manual:${region.toLowerCase()}:${normalizeName(displayName)}`;
}

/** Build the immutable Player payload from a Riot profile. */
function playerFromRiotProfile(profile: RiotProfile) {
  const seedMMR = computeSeedMMR({
    riotRank: profile.rank
      ? { tier: profile.rank.tier, division: profile.rank.division, leaguePoints: profile.rank.leaguePoints }
      : null,
    recent: profile.recent,
  });

  return {
    source: 'riot' as const,
    uniqueKey: riotUniqueKey(profile.puuid),
    displayName: `${profile.gameName}#${profile.tagLine}`,
    region: profile.platform,
    riot: {
      puuid: profile.puuid,
      gameName: profile.gameName,
      tagLine: profile.tagLine,
      platform: profile.platform,
      region: profile.region,
      summonerLevel: profile.summonerLevel,
      profileIconId: profile.profileIconId,
      queueType: profile.rank?.queueType,
      tier: profile.rank?.tier,
      division: profile.rank?.division,
      leaguePoints: profile.rank?.leaguePoints,
      wins: profile.rank?.wins,
      losses: profile.rank?.losses,
    },
    recent: profile.recent ?? undefined,
    seedMMR,
    mmr: seedMMR,
  };
}

/* -------------------------------- routes ------------------------------- */

/** GET /api/players — all injected players, strongest first. */
playersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const players = await Player.find().sort({ mmr: -1 }).exec();
    res.json({ players: players.map((p) => p.toPublic()) });
  }),
);

/** GET /api/players/:id */
playersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const player = await Player.findById(req.params.id).exec();
    if (!player) throw new ApiError(404, 'Player not found.');
    res.json({ player: player.toPublic() });
  }),
);

const searchSchema = z.object({
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
});

/**
 * POST /api/players/search — preview a Riot player WITHOUT saving.
 * Lets the UI show what will be injected (and whether they already exist).
 */
playersRouter.post(
  '/search',
  requireWriter,
  asyncHandler(async (req, res) => {
    if (!riotEnabled) {
      throw new ApiError(503, 'Player search is disabled — no Riot API key configured on the server.');
    }
    const { gameName, tagLine } = searchSchema.parse(req.body);
    const profile = await lookupByRiotId(gameName, tagLine);

    const draft = playerFromRiotProfile(profile);
    const existing = await Player.findOne({ uniqueKey: draft.uniqueKey }).exec();

    res.json({
      profile,
      preview: {
        displayName: draft.displayName,
        region: draft.region,
        seedMMR: draft.seedMMR,
      },
      alreadyInjected: Boolean(existing),
    });
  }),
);

const manualSchema = z.object({
  source: z.literal('manual'),
  displayName: z.string().min(1).max(64),
  region: z.string().min(1).max(16).optional(),
  rank: z
    .object({
      tier: z.enum(TIERS as unknown as [Tier, ...Tier[]]),
      division: z.enum(DIVISIONS as unknown as [Division, ...Division[]]).optional(),
      leaguePoints: z.number().int().min(0).max(2000).optional(),
    })
    .optional(),
  mmr: z.number().int().min(0).max(6000).optional(),
  tags: tagsField,
});

const riotInjectSchema = z.object({
  source: z.literal('riot'),
  gameName: z.string().min(1),
  tagLine: z.string().min(1),
  tags: tagsField,
});

const injectSchema = z.discriminatedUnion('source', [manualSchema, riotInjectSchema]);

/**
 * POST /api/players — inject a player (append-only).
 * Riot players are re-fetched fresh; manual players seed from a rank or raw MMR.
 * Duplicate uniqueKey -> 409 (handled by the error middleware).
 */
playersRouter.post(
  '/',
  requireWriter,
  asyncHandler(async (req, res) => {
    const body = injectSchema.parse(req.body);

    let attrs;
    if (body.source === 'riot') {
      if (!riotEnabled) {
        throw new ApiError(503, 'Riot injection is disabled — no Riot API key configured on the server.');
      }
      const profile = await lookupByRiotId(body.gameName, body.tagLine);
      attrs = playerFromRiotProfile(profile);
    } else {
      const region = body.region?.trim() || 'manual';
      const seedMMR = computeSeedMMR({
        manualMMR: body.mmr ?? null,
        riotRank: body.rank
          ? { tier: body.rank.tier, division: body.rank.division ?? null, leaguePoints: body.rank.leaguePoints ?? 0 }
          : null,
      });
      attrs = {
        source: 'manual' as const,
        uniqueKey: manualUniqueKey(region, body.displayName),
        displayName: body.displayName.trim(),
        region,
        seedMMR,
        mmr: seedMMR,
      };
    }

    // Pre-check for a friendlier message than the raw duplicate-key error.
    const existing = await Player.findOne({ uniqueKey: attrs.uniqueKey }).exec();
    if (existing) {
      throw new ApiError(409, 'This player has already been injected and cannot be re-uploaded.');
    }

    const player = await Player.create({ ...attrs, tags: normalizeTags(body.tags) });
    res.status(201).json({ player: player.toPublic() });
  }),
);

const updateTagsSchema = z.object({
  tags: z.array(z.string().max(24)).max(20),
});

/**
 * PATCH /api/players/:id/tags — replace a player's tags.
 * Tags are mutable metadata; this does NOT touch the immutable identity/seed/MMR.
 */
playersRouter.patch(
  '/:id/tags',
  requireWriter,
  asyncHandler(async (req, res) => {
    const { tags } = updateTagsSchema.parse(req.body);
    const player = await Player.findById(req.params.id).exec();
    if (!player) throw new ApiError(404, 'Player not found.');
    player.tags = normalizeTags(tags);
    await player.save();
    res.json({ player: player.toPublic() });
  }),
);

export default playersRouter;
