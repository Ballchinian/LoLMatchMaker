import type { Request, Response, NextFunction } from 'express';
import { isDbConnected } from '../db/connect';

/**
 * Short-circuit DB-backed routes with a clear 503 when MongoDB isn't connected,
 * instead of letting queries fail with an opaque buffering timeout.
 */
export function requireDb(_req: Request, res: Response, next: NextFunction): void {
  if (!isDbConnected()) {
    res.status(503).json({
      error:
        'Database unavailable — the server cannot reach MongoDB. Check MONGODB_URI and your Atlas network access.',
    });
    return;
  }
  next();
}
