// Local / self-hosted entry point: a long-running Express server.
// On Vercel the app runs as a function instead (api/index.ts).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: defaults apply.
}

// Imported after .env is loaded, so config sees those values.
const express = (await import('express')).default;
const { existsSync } = await import('node:fs');
const path = (await import('node:path')).default;
const { app, init } = await import('./app.js');
const { pruneExpired } = await import('./auth.js');
const { config } = await import('./config.js');
const { gateway } = await import('./gateway.js');
const { enforceTransferDeadlines } = await import('./ledger.js');

await init();

// Serve the built frontend from the same origin when it exists (npm start).
const dist = path.resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Background jobs. On Vercel these run through /api/cron/enforce-deadlines instead.
const every = (ms: number, job: () => Promise<unknown>) =>
  setInterval(() => job().catch((err) => console.error('Background job failed', err)), ms).unref();
await enforceTransferDeadlines();
every(60 * 1000, () => enforceTransferDeadlines());
every(15 * 60 * 1000, pruneExpired);

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (payment gateway: ${gateway.name}, db: ${config.databaseUrl.split('?')[0]})`);
});

export {};
