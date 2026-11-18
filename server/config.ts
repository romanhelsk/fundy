import path from 'node:path';

export const config = {
  port: Number(process.env.API_PORT ?? 3001),
  /** Origins allowed to make state-changing requests (CSRF guard). */
  appOrigins: (process.env.APP_ORIGIN ?? 'http://localhost:5173,http://localhost:3001').split(','),
  dataDir: process.env.DATA_DIR ?? path.resolve('data'),
  /** Set to true when served over HTTPS so cookies get the Secure flag. */
  secureCookies: process.env.SECURE_COOKIES === 'true',
  /** Which payment gateway to use. Only "test" exists for now. */
  paymentGateway: process.env.PAYMENT_GATEWAY ?? 'test',
  /** Simulated provider latency for the test gateway, in ms. */
  testGatewayLatencyMs: Number(process.env.TEST_GATEWAY_LATENCY_MS ?? 1800),

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
  /** How long a client has to send the transfer for a pending deposit/credit before suspension. */
  transferWindowMs: 12 * 60 * 60 * 1000,
  /** Largest single admin balance adjustment, in cents ($100,000,000.00). */
  maxAdjustmentCents: 10_000_000_000,
};
