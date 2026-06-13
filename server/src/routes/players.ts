import { Router, type Request } from 'express';
import { z } from 'zod';
import { Player, type PlayerDoc } from '../models/Player';
import { Match } from '../models/Match';
import { lookupByRiotId, type RiotProfile } from '../services/riot';
import { computeSeedMMR } from '../services/mmr';
import { seedRD, RD_FLOOR, RD_CEILING } from '../services/glicko';
import { rankToMMR, TIERS, DIVISIONS, type Tier, type Division } from '../services/rank';
import { riotEnabled } from '../config/env';
import { ApiError, asyncHandler } from '../middleware/errors';
import { guildFilter, requireWriter } from '../middleware/auth';

export const playersRouter = Router();

/* ------------------------------- helpers ------------------------------- */

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Load a player by id within the request's server scope (404 outside it). */
async function loadScopedPlayer(req: Request): Promise<PlayerDoc> {
  const player = await Player.findById(req.params.id).exec();
  if (!player || (player.guildId ?? null) !== (req.guildId ?? null)) {
    throw new ApiError(404, 'Player not found.');
  }
  return player;
}

/** Prefix a uniqueKey with the owning guild so the same person can exist per server. */
function scopedKey(guildId: string | null, key: string): string {
  return guildId ? `${guildId}:${key}` : key;
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
function playerFromRiotProfile(profile: RiotProfile, guildId: string | null) {
  const seedMMR = computeSeedMMR({
    riotRank: profile.rank
      ? { tier: profile.rank.tier, division: profile.rank.division, leaguePoints: profile.rank.leaguePoints }
      : null,
    recent: profile.recent,
  });

  return {
    source: 'riot' as const,
    guildId,
    uniqueKey: scopedKey(guildId, riotUniqueKey(profile.puuid)),
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
    // Confidence in the seed scales with current-season ranked games (250 → 89);
    // an unranked account is a near-unknown (300).
    rd: seedRD(profile.rank ? profile.rank.wins + profile.rank.losses : null),
  };
}

/* -------------------------------- routes ------------------------------- */

/** GET /api/players — this server's players, strongest first. Public within scope. */
playersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const players = await Player.find(guildFilter(req)).sort({ mmr: -1 }).exec();
    res.json({ players: players.map((p) => p.toPublic()) });
  }),
);

/** GET /api/players/:id */
playersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const player = await loadScopedPlayer(req);
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

    const draft = playerFromRiotProfile(profile, req.guildId ?? null);
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
    const guildId = req.guildId ?? null;

    let attrs;
    if (body.source === 'riot') {
      if (!riotEnabled) {
        throw new ApiError(503, 'Riot injection is disabled — no Riot API key configured on the server.');
      }
      const profile = await lookupByRiotId(body.gameName, body.tagLine);
      attrs = playerFromRiotProfile(profile, guildId);
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
        guildId,
        uniqueKey: scopedKey(guildId, manualUniqueKey(region, body.displayName)),
        displayName: body.displayName.trim(),
        region,
        seedMMR,
        mmr: seedMMR,
        // No ranked-activity data behind a manual entry — full uncertainty.
        rd: seedRD(null),
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
    const player = await loadScopedPlayer(req);
    player.tags = normalizeTags(tags);
    await player.save();
    res.json({ player: player.toPublic() });
  }),
);

const mmrSchema = z
  .object({
    seedMMR: z.number().int().min(0).max(6000).optional(),
    mmr: z.number().int().min(0).max(6000).optional(),
    rd: z.number().int().min(RD_FLOOR).max(RD_CEILING).optional(),
  })
  .refine((d) => d.seedMMR !== undefined || d.mmr !== undefined || d.rd !== undefined, {
    message: 'Provide seedMMR, mmr and/or rd.',
  });

/**
 * PATCH /api/players/:id/mmr — admin override of a player's seed, current MMR
 * and/or rating uncertainty (rd). Identity stays immutable.
 */
playersRouter.patch(
  '/:id/mmr',
  requireWriter,
  asyncHandler(async (req, res) => {
    const body = mmrSchema.parse(req.body);
    const player = await loadScopedPlayer(req);

    if (body.seedMMR !== undefined) player.seedMMR = body.seedMMR;
    if (body.mmr !== undefined) player.mmr = body.mmr;
    if (body.rd !== undefined) player.rd = body.rd;
    await player.save();

    res.json({ player: player.toPublic() });
  }),
);

const rolesSchema = z.object({
  champPool: z.enum(['one-trick', 'two-trick', 'diverse']),
});

/**
 * PATCH /api/players/:id/roles — set a player's champion-pool depth, which
 * adjusts the displayed/balancing MMR (one-trick -200, two-trick -75,
 * diverse 0). Raw MMR, ranks and Glicko are untouched. (Route name kept for
 * the bot's existing /link call.)
 */
playersRouter.patch(
  '/:id/roles',
  requireWriter,
  asyncHandler(async (req, res) => {
    const body = rolesSchema.parse(req.body);
    const player = await loadScopedPlayer(req);
    player.champPool = body.champPool;
    await player.save();
    res.json({ player: player.toPublic() });
  }),
);

const discordLinkSchema = z.object({
  discordUserId: z.string().min(1).max(32).nullable(),
});

/**
 * PATCH /api/players/:id/discord — link (or unlink with null) a Discord user id.
 * Used by the bot to map a site player to a Discord member. One Discord id ↔ one player.
 */
playersRouter.patch(
  '/:id/discord',
  requireWriter,
  asyncHandler(async (req, res) => {
    const { discordUserId } = discordLinkSchema.parse(req.body);
    const player = await loadScopedPlayer(req);

    if (discordUserId) {
      // This Discord account already claimed by a different player ON THIS SERVER?
      const existing = await Player.findOne({ discordUserId, ...guildFilter(req) }).exec();
      if (existing && existing._id.toString() !== player._id.toString()) {
        throw new ApiError(409, 'That Discord account is already linked to another player.');
      }
      // This player already linked to a different Discord account?
      if (player.discordUserId && player.discordUserId !== discordUserId) {
        throw new ApiError(
          409,
          'This player is already linked to a different Discord account. Unlink it first.',
        );
      }
      player.discordUserId = discordUserId;
      await player.save();
    } else {
      player.set('discordUserId', undefined);
      await player.save();
    }

    res.json({ player: player.toPublic() });
  }),
);

/* ------------------------------- resets -------------------------------- */

/** The fields a reset touches, for before/after confirmation messages. */
export interface ResetView {
  displayName: string;
  mmr: number;
  seedMMR: number;
  rd: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  /** Frozen Riot rank snapshot, e.g. "GOLD II 40LP"; null when absent. */
  riotRank: string | null;
}

function resetView(p: PlayerDoc): ResetView {
  const riot = p.riot;
  return {
    displayName: p.displayName,
    mmr: p.mmr,
    seedMMR: p.seedMMR,
    rd: p.liveRD(),
    wins: p.wins,
    losses: p.losses,
    gamesPlayed: p.gamesPlayed,
    riotRank: riot?.tier ? `${riot.tier}${riot.division ? ` ${riot.division}` : ''} ${riot.leaguePoints ?? 0}LP` : null,
  };
}

/*
    Reset a player's attached Riot details and ladder state WITHOUT touching the
    Discord link: riot players are re-fetched (fresh rank snapshot + re-seeded
    MMR/RD), manual players fall back to their seed. W/L/games restart at zero.
    Identity fields are schema-immutable, so the update opts into
    overwriteImmutable for the refreshed snapshot.
*/
async function performReset(player: PlayerDoc): Promise<{ before: ResetView; after: ResetView; refreshedFromRiot: boolean }> {
  const before = resetView(player);

  let update: Record<string, unknown>;
  let refreshedFromRiot = false;
  if (player.source === 'riot' && riotEnabled && player.riot?.gameName && player.riot?.tagLine) {
    const profile = await lookupByRiotId(player.riot.gameName, player.riot.tagLine);
    const draft = playerFromRiotProfile(profile, player.guildId ?? null);
    update = {
      displayName: draft.displayName,
      riot: draft.riot,
      recent: draft.recent ?? null,
      seedMMR: draft.seedMMR,
      mmr: draft.seedMMR,
      rd: draft.rd,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      lastMatchAt: null,
    };
    refreshedFromRiot = true;
  } else {
    const riot = player.riot;
    update = {
      mmr: player.seedMMR,
      rd: seedRD(riot?.tier ? (riot.wins ?? 0) + (riot.losses ?? 0) : null),
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      lastMatchAt: null,
    };
  }

  await Player.updateOne({ _id: player._id }, { $set: update }, { overwriteImmutable: true }).exec();
  const fresh = await Player.findById(player._id).exec();
  if (!fresh) throw new ApiError(404, 'Player vanished during reset.');
  return { before, after: resetView(fresh), refreshedFromRiot };
}

/*
    Server reset (resetting EVERY player) is driven CLIENT-side, one call to
    /:id/reset per player: that lets the website show live progress, pace the
    Riot calls (dev keys rate-limit hard — the lookup throws 429), and offer a
    Cancel button mid-run. So there's deliberately no bulk reset-all route.
*/

/** POST /api/players/:id/reset — PLAYER RESET: one player, same semantics. Admin/bot. */
playersRouter.post(
  '/:id/reset',
  requireWriter,
  asyncHandler(async (req, res) => {
    const player = await loadScopedPlayer(req);
    const { before, after, refreshedFromRiot } = await performReset(player);
    const fresh = await Player.findById(player._id).exec();
    res.json({ player: fresh!.toPublic(), before, after, refreshedFromRiot });
  }),
);

/**
 * DELETE /api/players/:id — permanently remove a player (admin, website only).
 * Blocked while they're in an OPEN match (resolve those first); confirmed
 * history keeps its own displayName/MMR snapshots, so it's unaffected.
 */
playersRouter.delete(
  '/:id',
  requireWriter,
  asyncHandler(async (req, res) => {
    const player = await loadScopedPlayer(req);

    const openMatch = await Match.findOne({
      guildId: player.guildId ?? null,
      status: { $in: ['pending', 'inProgress'] },
      $or: [{ 'teamA.player': player._id }, { 'teamB.player': player._id }],
    })
      .select('name')
      .lean()
      .exec();
    if (openMatch) {
      throw new ApiError(
        409,
        `${player.displayName} is in an open match (${openMatch.name ?? 'unnamed'}). Delete or confirm that match first.`,
      );
    }

    await player.deleteOne();
    res.json({ ok: true });
  }),
);

export default playersRouter;
