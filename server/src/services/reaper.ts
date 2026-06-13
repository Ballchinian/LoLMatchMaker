import { Server } from '../models/Server';
import { Player } from '../models/Player';
import { Match } from '../models/Match';
import { BotCommand } from '../models/BotCommand';
import { env } from '../config/env';

/*
    Storage hygiene so dead servers and stale history don't grow forever:
      - servers with no activity for REAP_INACTIVE_DAYS are deleted with all
        their data (a kicked bot also triggers this immediately via DELETE
        /servers/:guildId; the reaper is the safety net for silent abandonment)
      - reversed matches older than REVERSED_PRUNE_DAYS are dropped (they only
        exist for a short audit window; confirmed history is kept)
    Runs on an interval from index.ts. Best effort: failures are logged, not thrown.
*/

const DAY_MS = 24 * 60 * 60 * 1000;

async function reapDeadServers(): Promise<number> {
  if (env.REAP_INACTIVE_DAYS <= 0) return 0;
  const cutoff = new Date(Date.now() - env.REAP_INACTIVE_DAYS * DAY_MS);
  const dead = await Server.find({ lastActiveAt: { $lt: cutoff } }).select('guildId').lean().exec();
  let removed = 0;
  for (const s of dead) {
    await Promise.all([
      Player.deleteMany({ guildId: s.guildId }).exec(),
      Match.deleteMany({ guildId: s.guildId }).exec(),
      BotCommand.deleteMany({ guildId: s.guildId }).exec(),
      Server.deleteOne({ guildId: s.guildId }).exec(),
    ]);
    removed += 1;
    console.log(`[reaper] purged dead server ${s.guildId} (inactive > ${env.REAP_INACTIVE_DAYS}d)`);
  }
  return removed;
}

async function pruneReversedMatches(): Promise<number> {
  if (env.REVERSED_PRUNE_DAYS <= 0) return 0;
  const cutoff = new Date(Date.now() - env.REVERSED_PRUNE_DAYS * DAY_MS);
  //updatedAt moved to ~reversal time; reversed + old enough = safe to drop
  const res = await Match.deleteMany({ status: 'reversed', updatedAt: { $lt: cutoff } }).exec();
  return res.deletedCount ?? 0;
}

export async function runReaper(): Promise<void> {
  try {
    const servers = await reapDeadServers();
    const matches = await pruneReversedMatches();
    if (servers || matches) {
      console.log(`[reaper] removed ${servers} dead server(s), pruned ${matches} reversed match(es)`);
    }
  } catch (err) {
    console.error('[reaper]', (err as Error).message);
  }
}

/** Start the reaper: an immediate sweep, then daily. No-op if fully disabled. */
export function startReaper(): void {
  if (env.REAP_INACTIVE_DAYS <= 0 && env.REVERSED_PRUNE_DAYS <= 0) return;
  void runReaper();
  setInterval(() => void runReaper(), DAY_MS);
}
