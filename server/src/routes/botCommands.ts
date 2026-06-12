import { Router } from 'express';
import { z } from 'zod';
import { BotCommand } from '../models/BotCommand';
import { Match } from '../models/Match';
import { ApiError, asyncHandler } from '../middleware/errors';
import { guildFilter, requireWriter } from '../middleware/auth';

/*
    Queue between the website's Discord tab and the bot: admins enqueue match
    actions here, the bot claims them one at a time, runs the real Discord work
    (channels, moves, votes are bypassed: this is an admin surface) and posts
    the outcome back.
*/
export const botCommandsRouter = Router();

const enqueueSchema = z.object({
  action: z.enum(['setup', 'split', 'join', 'cancel', 'confirm', 'delete']),
  matchId: z.string().min(1),
  winner: z.enum(['A', 'B']).optional(),
});

/** POST /api/bot-commands — enqueue an action for the bot (website admin). */
botCommandsRouter.post(
  '/',
  requireWriter,
  asyncHandler(async (req, res) => {
    const body = enqueueSchema.parse(req.body);
    const guildId = req.guildId ?? null;
    if (!guildId) {
      throw new ApiError(400, 'No server scope — connect with a server key before using the Discord tab.');
    }

    const match = await Match.findById(body.matchId).lean().exec();
    if (!match || (match.guildId ?? null) !== guildId) throw new ApiError(404, 'Match not found.');

    //Bound the queue: a dead bot shouldn't accumulate clicks
    const waiting = await BotCommand.countDocuments({ guildId, status: { $in: ['queued', 'running'] } }).exec();
    if (waiting >= 10) {
      throw new ApiError(429, 'The bot has a backlog of commands — is it online? Try again shortly.');
    }

    const command = await BotCommand.create({
      guildId,
      action: body.action,
      match: match._id,
      matchLabel: match.name ?? `#${String(match._id).slice(-4)}`,
      winner: body.winner,
      status: 'queued',
    });
    res.status(201).json({ command });
  }),
);

/** GET /api/bot-commands — recent commands for this server (website admin polls this). */
botCommandsRouter.get(
  '/',
  requireWriter,
  asyncHandler(async (req, res) => {
    const commands = await BotCommand.find(guildFilter(req)).sort({ createdAt: -1 }).limit(20).lean().exec();
    res.json({ commands });
  }),
);

/**
 * POST /api/bot-commands/claim — the bot atomically claims the oldest queued
 * command for its guild (X-Guild-Id). Returns { command: null } when idle.
 */
botCommandsRouter.post(
  '/claim',
  requireWriter,
  asyncHandler(async (req, res) => {
    const command = await BotCommand.findOneAndUpdate(
      { ...guildFilter(req), status: 'queued' },
      { $set: { status: 'running' } },
      { sort: { createdAt: 1 }, new: true },
    )
      .lean()
      .exec();
    res.json({ command: command ?? null });
  }),
);

const completeSchema = z.object({
  ok: z.boolean(),
  result: z.string().max(2000),
});

/** POST /api/bot-commands/:id/complete — the bot reports an outcome. */
botCommandsRouter.post(
  '/:id/complete',
  requireWriter,
  asyncHandler(async (req, res) => {
    const { ok, result } = completeSchema.parse(req.body);
    const command = await BotCommand.findById(req.params.id).exec();
    if (!command || (command.guildId ?? null) !== (req.guildId ?? null)) {
      throw new ApiError(404, 'Command not found.');
    }
    command.status = ok ? 'done' : 'error';
    command.result = result;
    await command.save();
    res.json({ command });
  }),
);

export default botCommandsRouter;
