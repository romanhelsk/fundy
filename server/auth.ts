import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from './config.ts';
import { hashPassword, randomToken, sameHash, sha256, sixDigitCode, verifyPassword } from './crypto.ts';
import { db, tx } from './db.ts';
import { HttpError, readCookie, str } from './http.ts';
import { sendMail } from './mailer.ts';

export type Role = 'client' | 'admin';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  /** Set for accounts created with a temporary password until the user picks their own. */
  mustChangePassword: boolean;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  must_change_password: number;
  password_hash: string;
}

const USER_COLUMNS = 'id, email, name, role, must_change_password, password_hash';

function toUser(r: UserRow): User {
  return { id: r.id, email: r.email, name: r.name, role: r.role, mustChangePassword: r.must_change_password === 1 };
}

function loadUserRow(id: number): UserRow {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as unknown as UserRow;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;

// A real hash of a random password, so unknown emails cost the same time as
// known ones (no user enumeration through timing).
const DUMMY_HASH = await hashPassword(randomToken());

// ---------- Failed-login throttling (in memory; move to Redis for multi-instance) ----------
const failures = new Map<string, { count: number; first: number }>();

function throttleKey(req: Request, email: string) {
  return `${req.ip}|${email.toLowerCase()}`;
}
function assertNotThrottled(key: string) {
  const f = failures.get(key);
  if (!f) return;
  if (Date.now() - f.first > config.login.windowMs) {
    failures.delete(key);
    return;
  }
  if (f.count >= config.login.maxFailures) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in 15 minutes.');
  }
}
function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > config.login.windowMs) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

// ---------- Helpers ----------
function publicUser(u: User): User {
  return { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: u.mustChangePassword };
}

function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

async function startChallenge(user: User, remember: boolean) {
  const id = randomToken(18);
  const code = sixDigitCode();
  const now = Date.now();
  db.prepare('DELETE FROM mfa_challenges WHERE user_id = ? OR expires_at < ?').run(user.id, now);
  db.prepare(
    'INSERT INTO mfa_challenges (id, user_id, code_hash, expires_at, sent_at, remember) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, user.id, sha256(code), now + config.mfa.codeTtlMs, now, remember ? 1 : 0);
  await sendVerificationCode(user, code);
  return { challengeId: id, emailHint: maskEmail(user.email) };
}

async function sendVerificationCode(user: User, code: string) {
  await sendMail({
    to: user.email,
    subject: 'Your sign-in code',
    text: `Your verification code is ${code}. It expires in 10 minutes.\nIf you didn't try to sign in, change your password.`,
  });
}

function createSession(res: Response, userId: number, persistent: boolean) {
  const token = randomToken();
  const ttl = persistent ? config.session.longTtlMs : config.session.shortTtlMs;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, persistent) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    Date.now() + ttl,
    persistent ? 1 : 0,
  );
  res.cookie(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    // Without "keep me signed in" it's a browser-session cookie.
    ...(persistent ? { maxAge: ttl } : {}),
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(config.session.cookieName, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/' });
}

/** Creates the user's test payment methods (until real methods can be linked). */
export function createTestPaymentMethods(userId: number, last4 = { bank: '4242', card: '4242' }) {
  const insert = db.prepare('INSERT INTO payment_methods (id, user_id, kind, label, long_label) VALUES (?, ?, ?, ?, ?)');
  insert.run(`pm_${randomToken(9)}`, userId, 'bank', `Bank •••• ${last4.bank}`, `Bank transfer •••• ${last4.bank}`);
  insert.run(`pm_${randomToken(9)}`, userId, 'card', `Card •••• ${last4.card}`, `Card •••• ${last4.card}`);
}

// ---------- Middleware ----------
function authenticate(allowPendingPasswordChange: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, config.session.cookieName);
    if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.'));
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.must_change_password, u.password_hash
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(sha256(token), Date.now()) as UserRow | undefined;
    if (!row) {
      clearSessionCookie(res);
      return next(new HttpError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.'));
    }
    const user = toUser(row);
    // Until a temporary password is replaced, the session can do nothing else.
    if (user.mustChangePassword && !allowPendingPasswordChange) {
      return next(new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Set a new password to continue.'));
    }
    res.locals.user = user;
    res.locals.sessionTokenHash = sha256(token);
    next();
  };
}

/** Signed in, with a password the user chose. Use on every API route. */
export const requireUser = authenticate(false);
/** Signed in, possibly still on a temporary password (session check and password change only). */
const requireSession = authenticate(true);

export function currentUser(res: Response): User {
  return res.locals.user as User;
}

/** Use after requireUser. */
export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  if (currentUser(res).role !== 'admin') return next(new HttpError(403, 'FORBIDDEN', 'Admins only.'));
  next();
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 10;

// ---------- Routes ----------
export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const name = str(req.body?.name, 'name', 120);
  const email = str(req.body?.email, 'email', 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'VALIDATION', 'Enter a valid email address.');
  if (password.length < MIN_PASSWORD || password.length > 200) {
    throw new HttpError(400, 'WEAK_PASSWORD', `Use at least ${MIN_PASSWORD} characters for your password.`);
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');

  const passwordHash = await hashPassword(password);
  const user = tx(() => {
    const result = db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(email, name, passwordHash);
    const id = Number(result.lastInsertRowid);
    createTestPaymentMethods(id);
    return { id, email, name, role: 'client' as const, mustChangePassword: false };
  });
  // New accounts verify their email with the same code flow before the first session.
  res.status(201).json(await startChallenge(user, false));
});

authRouter.post('/login', async (req, res) => {
  const email = str(req.body?.email, 'email', 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const remember = req.body?.remember === true;
  const key = throttleKey(req, email);
  assertNotThrottled(key);

  const user = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(key);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  failures.delete(key);
  res.json(await startChallenge(toUser(user), remember));
});

interface ChallengeRow {
  id: string;
  user_id: number;
  code_hash: string;
  expires_at: number;
  sent_at: number;
  attempts: number;
  remember: number;
}

function loadChallenge(id: unknown): ChallengeRow {
  const row = db.prepare('SELECT * FROM mfa_challenges WHERE id = ?').get(str(id, 'challengeId', 100)) as
    | ChallengeRow
    | undefined;
  if (!row || row.expires_at < Date.now() || row.attempts >= config.mfa.maxAttempts) {
    if (row) db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(row.id);
    throw new HttpError(410, 'CHALLENGE_EXPIRED', 'This code has expired. Please sign in again.');
  }
  return row;
}

authRouter.post('/verify', (req, res) => {
  const challenge = loadChallenge(req.body?.challengeId);
  const code = String(req.body?.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !sameHash(sha256(code), challenge.code_hash)) {
    db.prepare('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
    const left = config.mfa.maxAttempts - challenge.attempts - 1;
    if (left <= 0) {
      db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(challenge.id);
      throw new HttpError(410, 'CHALLENGE_EXPIRED', 'Too many incorrect codes. Please sign in again.');
    }
    throw new HttpError(401, 'INVALID_CODE', `That code isn't right. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
  }
  db.prepare('DELETE FROM mfa_challenges WHERE id = ?').run(challenge.id);
  createSession(res, challenge.user_id, challenge.remember === 1);
  res.json({ user: toUser(loadUserRow(challenge.user_id)) });
});

authRouter.post('/resend', async (req, res) => {
  const challenge = loadChallenge(req.body?.challengeId);
  const wait = challenge.sent_at + config.mfa.resendCooldownMs - Date.now();
  if (wait > 0) {
    throw new HttpError(429, 'RESEND_COOLDOWN', `Please wait ${Math.ceil(wait / 1000)} seconds before requesting a new code.`);
  }
  const code = sixDigitCode();
  const now = Date.now();
  db.prepare('UPDATE mfa_challenges SET code_hash = ?, sent_at = ?, expires_at = ? WHERE id = ?').run(
    sha256(code),
    now,
    now + config.mfa.codeTtlMs,
    challenge.id,
  );
  await sendVerificationCode(toUser(loadUserRow(challenge.user_id)), code);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  const token = readCookie(req, config.session.cookieName);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/session', requireSession, (_req, res) => {
  res.json({ user: publicUser(currentUser(res)) });
});

/**
 * Sets a new password. On first sign-in with a temporary password the user
 * just proved it (password + emailed code), so only the new one is needed;
 * otherwise the current password is required.
 */
authRouter.post('/change-password', requireSession, async (req, res) => {
  const user = currentUser(res);
  const row = loadUserRow(user.id);
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!user.mustChangePassword) {
    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    if (!(await verifyPassword(current, row.password_hash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Your current password is incorrect.');
    }
  }
  if (newPassword.length < MIN_PASSWORD || newPassword.length > 200) {
    throw new HttpError(400, 'WEAK_PASSWORD', `Use at least ${MIN_PASSWORD} characters for your password.`);
  }
  if (await verifyPassword(newPassword, row.password_hash)) {
    throw new HttpError(400, 'SAME_PASSWORD', 'Choose a password different from your current one.');
  }

  const hash = await hashPassword(newPassword);
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
    // Sign out every other session; keep this one.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(user.id, res.locals.sessionTokenHash);
  });
  res.json({ user: toUser(loadUserRow(user.id)) });
});

/** Periodically drop expired sessions and challenges. */
export function pruneExpired() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM mfa_challenges WHERE expires_at < ?').run(now);
}
