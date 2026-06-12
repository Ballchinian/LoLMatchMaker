import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env, riotEnabled, writesProtected } from './config/env';
import { connectDB, isDbConnected } from './db/connect';
import { notFound, errorHandler } from './middleware/errors';
import { requireDb } from './middleware/requireDb';
import { resolveScope } from './middleware/auth';
import authRouter from './routes/auth';
import playersRouter from './routes/players';
import teamsRouter from './routes/teams';
import matchesRouter from './routes/matches';
import serversRouter from './routes/servers';
import botCommandsRouter from './routes/botCommands';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '256kb' }));

// Basic abuse protection (also helps stay within Riot rate limits).
app.use(
  '/api/',
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: isDbConnected() ? 'connected' : 'disconnected',
    riot: riotEnabled ? 'enabled' : 'disabled',
    writeProtection: writesProtected ? 'on' : 'off',
  });
});

app.use('/api/auth', authRouter);
app.use('/api/servers', requireDb, serversRouter);
//Every data route resolves its per-server scope first (see middleware/auth.ts)
app.use('/api/players', requireDb, resolveScope, playersRouter);
app.use('/api/teams', requireDb, resolveScope, teamsRouter);
app.use('/api/matches', requireDb, resolveScope, matchesRouter);
app.use('/api/bot-commands', requireDb, resolveScope, botCommandsRouter);

app.use(notFound);
app.use(errorHandler);

async function start(): Promise<void> {
  try {
    await connectDB();
  } catch (err) {
    console.error('[boot] could not connect to MongoDB:', (err as Error).message);
    console.error('[boot] starting anyway — set MONGODB_URI in server/.env and restart.');
  }

  app.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT}`);
    console.log(`[server] CORS origin: ${env.CLIENT_ORIGIN}`);
    console.log(`[server] Riot search: ${riotEnabled ? 'enabled' : 'disabled (set RIOT_API_KEY)'}`);
    if (writesProtected) {
      console.log('[server] write protection: ON (admin/bot token required for writes)');
    } else {
      console.warn(
        '[server] ⚠ write protection: OFF — anyone can inject/tag/record. Set ADMIN_TOKEN before sharing!',
      );
    }
  });
}

void start();
