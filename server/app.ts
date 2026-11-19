import express, { type NextFunction, type Request, type Response } from 'express';
import { adminRouter } from './admin.js';
import { authRouter, pruneExpired } from './auth.js';
import { config } from './config.js';
import { sameHash, sha256 } from './crypto.js';
import { migrate } from './db.js';
import { fundsRouter } from './funds.js';
import { HttpError, errorHandler, originGuard } from './http.js';
import { enforceTransferDeadlines } from './ledger.js';
import { seed } from './seed.js';

/**
 * Migrations and seeding run once per process (each serverless cold start
 * included); every request waits for them.
 */
let ready: Promise<void> | null = null;
export function init(): Promise<void> {
  ready ??= (async () => {
    await migrate();
    await seed();
  })().catch((err) => {
    ready = null; // let the next request retry
    throw err;
  });
  return ready;
}

/** The Express app, shared by the local server (server/index.ts) and the Vercel function (api/index.ts). */
export const app = express();
app.disable('x-powered-by');
// Behind Vercel's proxy (or Vite's locally), the client IP comes from X-Forwarded-For.
app.set('trust proxy', config.onVercel ? true : 'loopback');

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

app.use('/api', (_req, _res, next) => {
  init().then(() => next(), next);
});

/**
 * Scheduled jobs, for Vercel Cron or any external cron service:
 * GET /api/cron/enforce-deadlines with "Authorization: Bearer <CRON_SECRET>".
 * Expires overdue pending transactions (suspending those accounts) and prunes
 * expired sessions. Call it every minute or so.
 */
function requireCronSecret(req: Request, _res: Response, next: NextFunction) {
  const secret = config.cronSecret;
  if (!secret) return next(new HttpError(503, 'CRON_DISABLED', 'CRON_SECRET is not configured.'));
  const given = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !sameHash(sha256(given), sha256(secret))) return next(new HttpError(401, 'UNAUTHORIZED', 'Bad cron secret.'));
  next();
}

app.get('/api/cron/enforce-deadlines', requireCronSecret, async (_req, res) => {
  const expired = await enforceTransferDeadlines();
  await pruneExpired();
  res.set('Cache-Control', 'no-store').json({ ok: true, expired });
});

app.use('/api', express.json({ limit: '10kb' }), originGuard, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', fundsRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Not found.')));

app.use(errorHandler);
