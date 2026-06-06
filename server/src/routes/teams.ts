import { Router } from 'express';
import { z } from 'zod';
import { Player } from '../models/Player';
import { balanceTeams, type BalancePlayer } from '../services/balance';
import { ApiError, asyncHandler } from '../middleware/errors';

export const teamsRouter = Router();

const pairSchema = z.tuple([z.string(), z.string()]);

const balanceSchema = z.object({
  playerIds: z.array(z.string()).min(2).max(20),
  teamSize: z.number().int().min(1).max(10).optional(),
  constraints: z
    .object({
      sameTeam: z.array(pairSchema).optional(),
      oppositeTeam: z.array(pairSchema).optional(),
    })
    .optional(),
  excludeKeys: z.array(z.string()).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});

/**
 * POST /api/teams/balance
 * Compute the fairest 2-team split of the selected players, honoring same/opposite
 * constraints. Pass `excludeKeys` (the keys of splits already shown) to avoid repeats.
 */
teamsRouter.post(
  '/balance',
  asyncHandler(async (req, res) => {
    const body = balanceSchema.parse(req.body);

    const uniqueIds = [...new Set(body.playerIds)];
    if (uniqueIds.length !== body.playerIds.length) {
      throw new ApiError(400, 'Duplicate player ids in selection.');
    }

    const players = await Player.find({ _id: { $in: uniqueIds } }).exec();
    if (players.length !== uniqueIds.length) {
      throw new ApiError(404, 'One or more selected players were not found.');
    }

    const balancePlayers: BalancePlayer[] = players.map((p) => ({
      id: p._id.toString(),
      mmr: p.mmr,
    }));

    const result = balanceTeams(balancePlayers, {
      teamSize: body.teamSize,
      excludeKeys: body.excludeKeys,
      maxResults: body.maxResults,
      constraints: {
        sameTeam: body.constraints?.sameTeam?.map(([a, b]) => ({ a, b })),
        oppositeTeam: body.constraints?.oppositeTeam?.map(([a, b]) => ({ a, b })),
      },
    });

    if (result.candidates.length === 0) {
      const reason =
        result.totalValid === 0
          ? 'No team arrangement satisfies the given constraints.'
          : 'No fresh team arrangements left — every valid split has already been shown.';
      throw new ApiError(422, reason);
    }

    res.json(result);
  }),
);

export default teamsRouter;
