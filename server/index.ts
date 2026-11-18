import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { authRouter, pruneExpired } from './auth.ts';
import { config } from './config.ts';
import { fundsRouter } from './funds.ts';
import { gateway } from './gateway.ts';
import { HttpError, errorHandler, originGuard } from './http.ts';
import { seed } from './seed.ts';

await seed();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

app.use('/api', express.json({ limit: '10kb' }), originGuard, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api/auth', authRouter);
app.use('/api', fundsRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Not found.')));

// In production, serve the built frontend from the same origin.
const dist = path.resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

setInterval(pruneExpired, 15 * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (payment gateway: ${gateway.name})`);
});
