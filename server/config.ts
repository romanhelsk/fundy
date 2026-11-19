const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const onVercel = Boolean(env.VERCEL);
const databaseUrl = env.TURSO_DATABASE_URL ?? env.DATABASE_URL ?? 'file:data/fundy.db';

/** Origins allowed to make state-changing requests (CSRF guard). */
function appOrigins(): string[] {
  const list = (env.APP_ORIGIN ?? 'http://localhost:5173,http://localhost:3001')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Vercel deployment URLs (preview + production) are allowed automatically.
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (host) list.push(`https://${host}`);
  }
  return [...new Set(list)];
}

export const config = {
  /** Product name used in emails. */
  brandName: env.BRAND_NAME ?? 'RecoverWise',
  isProduction,
  onVercel,
  port: Number(env.API_PORT ?? 3001),
  appOrigins: appOrigins(),

  /**
   * libSQL connection. Locally a SQLite file; in production a Turso database
   * (libsql://<db>-<org>.turso.io) with its auth token.
   */
  databaseUrl,
  databaseAuthToken: env.TURSO_AUTH_TOKEN,

  /** Cookies get the Secure flag over HTTPS. On by default in production. */
  secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : isProduction,

  /** Shared secret for /api/cron/* (sent as "Authorization: Bearer <secret>"). */
  cronSecret: env.CRON_SECRET,

  /**
   * Test accounts from server/seed.ts (their passwords are in the repo). Only
   * seeded into a local file database in development, never into a remote
   * database (Turso) or in production, unless SEED_DEMO_USER=true.
   */
  seedDemoUsers: env.SEED_DEMO_USER
    ? env.SEED_DEMO_USER === 'true'
    : !isProduction && databaseUrl.startsWith('file:'),
  /** Creates the first admin on startup if no admin exists (production bootstrap). */
  bootstrapAdmin:
    env.BOOTSTRAP_ADMIN_EMAIL && env.BOOTSTRAP_ADMIN_PASSWORD
      ? { email: env.BOOTSTRAP_ADMIN_EMAIL, password: env.BOOTSTRAP_ADMIN_PASSWORD, name: env.BOOTSTRAP_ADMIN_NAME ?? 'Admin' }
      : null,

  /** Email: Resend when RESEND_API_KEY and MAIL_FROM are set, otherwise printed to the console. */
  mail: { resendApiKey: env.RESEND_API_KEY, from: env.MAIL_FROM },

  /** Which payment gateway to use. Only "test" exists for now. */
  paymentGateway: env.PAYMENT_GATEWAY ?? 'test',
  /** Simulated provider latency for the test gateway, in ms. */
  testGatewayLatencyMs: Number(env.TEST_GATEWAY_LATENCY_MS ?? 1800),

  session: {
    cookieName: 'fundy_sid',
    shortTtlMs: 12 * 60 * 60 * 1000, // without "keep me signed in"
    longTtlMs: 30 * 24 * 60 * 60 * 1000, // with "keep me signed in"
  },
  mfa: {
    codeTtlMs: 10 * 60 * 1000,
    maxAttempts: 5,
    resendCooldownMs: 30 * 1000,
  },
  login: {
    maxFailures: 5,
    windowMs: 15 * 60 * 1000,
  },
  /** Largest single deposit accepted by the API, in cents ($1,000,000.00). */
  maxDepositCents: 100_000_000,
  /** How long a pending deposit, credit or withdrawal has before it fails and the account is suspended. */
  transferWindowMs: 12 * 60 * 60 * 1000,
  /** Largest single admin balance adjustment, in cents ($100,000,000.00). */
  maxAdjustmentCents: 10_000_000_000,
};
