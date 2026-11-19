import { Router, type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { hashPassword, randomToken, sameHash, sha256, sixDigitCode, verifyPassword } from './crypto.js';
import { db, get, run, tx, type Executor } from './db.js';
import { HttpError, readCookie, str } from './http.js';
import { sendMail } from './mailer.js';

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
  return {
    id: Number(r.id),
    email: r.email,
    name: r.name,
    role: r.role,
    mustChangePassword: Number(r.must_change_password) === 1,
  };
}

async function loadUserRow(id: number): Promise<UserRow> {
  return (await get<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]))!;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 10;

// A real hash of a random password, so unknown emails cost the same time as
// known ones (no user enumeration through timing). Computed lazily once.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

// ---------- Failed-login throttling (stored in the DB so it holds across serverless instances) ----------
function throttleKey(req: Request, email: string) {
  return `${req.ip}|${email.toLowerCase()}`;
}

async function assertNotThrottled(key: string) {
  const f = await get<{ count: number; first_at: number }>('SELECT count, first_at FROM login_failures WHERE key = ?', [key]);
  if (!f) return;
  if (Date.now() - Number(f.first_at) > config.login.windowMs) {
    await run('DELETE FROM login_failures WHERE key = ?', [key]);
    return;
  }
  if (Number(f.count) >= config.login.maxFailures) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in 15 minutes.');
  }
}

async function recordFailure(key: string) {
  const now = Date.now();
  await run(
    `INSERT INTO login_failures (key, count, first_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ?2 - first_at > ?3 THEN 1 ELSE count + 1 END,
       first_at = CASE WHEN ?2 - first_at > ?3 THEN ?2 ELSE first_at END`,
    [key, now, config.login.windowMs],
  );
}

// ---------- Helpers ----------
function maskEmail(email: string) {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

async function startChallenge(user: User, remember: boolean) {
  const id = randomToken(18);
  const code = sixDigitCode();
  const now = Date.now();
  await run('DELETE FROM mfa_challenges WHERE user_id = ? OR expires_at < ?', [user.id, now]);
  await run(
    'INSERT INTO mfa_challenges (id, user_id, code_hash, expires_at, sent_at, remember) VALUES (?, ?, ?, ?, ?, ?)',
    [id, user.id, sha256(code), now + config.mfa.codeTtlMs, now, remember ? 1 : 0],
  );
  await sendVerificationCode(user, code);
  return { challengeId: id, emailHint: maskEmail(user.email) };
}

async function sendVerificationCode(user: User, code: string) {
  await sendMail({
    to: user.email,
    subject: `Your ${config.brandName} sign-in code`,
    text: `Your ${config.brandName} verification code is ${code}. It expires in 10 minutes.\nIf you didn't try to sign in, change your password.`,
  });
}

async function createSession(res: Response, userId: number, persistent: boolean) {
  const token = randomToken();
  const ttl = persistent ? config.session.longTtlMs : config.session.shortTtlMs;
  await run('INSERT INTO sessions (token_hash, user_id, expires_at, persistent) VALUES (?, ?, ?, ?)', [
    sha256(token),
    userId,
    Date.now() + ttl,
    persistent ? 1 : 0,
  ]);
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
export async function createTestPaymentMethods(userId: number, last4 = { bank: '4242', card: '4242' }, ex: Executor = db) {
  const sql = 'INSERT INTO payment_methods (id, user_id, kind, label, long_label) VALUES (?, ?, ?, ?, ?)';
  await run(sql, [`pm_${randomToken(9)}`, userId, 'bank', `Bank •••• ${last4.bank}`, `Bank transfer •••• ${last4.bank}`], ex);
  await run(sql, [`pm_${randomToken(9)}`, userId, 'card', `Card •••• ${last4.card}`, `Card •••• ${last4.card}`], ex);
}

// ---------- Middleware ----------
function authenticate(allowPendingPasswordChange: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = readCookie(req, config.session.cookieName);
      if (!token) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.'));
      const row = await get<UserRow>(
        `SELECT u.id, u.email, u.name, u.role, u.must_change_password, u.password_hash
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
        [sha256(token), Date.now()],
      );
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
    } catch (err) {
      next(err);
    }
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

// ---------- Routes ----------
export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const name = str(req.body?.name, 'name', 120);
  const email = str(req.body?.email, 'email', 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'VALIDATION', 'Enter a valid email address.');
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw new HttpError(400, 'WEAK_PASSWORD', `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
  }
  if (await get('SELECT 1 FROM users WHERE email = ?', [email])) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }

  const passwordHash = await hashPassword(password);
  const user = await tx(async (t) => {
    const { lastInsertRowid: id } = await run('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)', [email, name, passwordHash], t);
    await createTestPaymentMethods(id, undefined, t);
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
  await assertNotThrottled(key);

  const user = await get<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`, [email]);
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) {
    await recordFailure(key);
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  await run('DELETE FROM login_failures WHERE key = ?', [key]);
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

async function loadChallenge(id: unknown): Promise<ChallengeRow> {
  const row = await get<ChallengeRow>('SELECT * FROM mfa_challenges WHERE id = ?', [str(id, 'challengeId', 100)]);
  if (!row || Number(row.expires_at) < Date.now() || Number(row.attempts) >= config.mfa.maxAttempts) {
    if (row) await run('DELETE FROM mfa_challenges WHERE id = ?', [row.id]);
    throw new HttpError(410, 'CHALLENGE_EXPIRED', 'This code has expired. Please sign in again.');
  }
  return row;
}

authRouter.post('/verify', async (req, res) => {
  const challenge = await loadChallenge(req.body?.challengeId);
  const code = String(req.body?.code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !sameHash(sha256(code), challenge.code_hash)) {
    await run('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge.id]);
    const left = config.mfa.maxAttempts - Number(challenge.attempts) - 1;
    if (left <= 0) {
      await run('DELETE FROM mfa_challenges WHERE id = ?', [challenge.id]);
      throw new HttpError(410, 'CHALLENGE_EXPIRED', 'Too many incorrect codes. Please sign in again.');
    }
    throw new HttpError(401, 'INVALID_CODE', `That code isn't right. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`);
  }
  // Delete first: only one request can consume the code.
  const consumed = await run('DELETE FROM mfa_challenges WHERE id = ?', [challenge.id]);
  if (consumed.changes === 0) throw new HttpError(410, 'CHALLENGE_EXPIRED', 'This code has expired. Please sign in again.');
  await createSession(res, Number(challenge.user_id), Number(challenge.remember) === 1);
  res.json({ user: toUser(await loadUserRow(Number(challenge.user_id))) });
});

authRouter.post('/resend', async (req, res) => {
  const challenge = await loadChallenge(req.body?.challengeId);
  const wait = Number(challenge.sent_at) + config.mfa.resendCooldownMs - Date.now();
  if (wait > 0) {
    throw new HttpError(429, 'RESEND_COOLDOWN', `Please wait ${Math.ceil(wait / 1000)} seconds before requesting a new code.`);
  }
  const code = sixDigitCode();
  const now = Date.now();
  await run('UPDATE mfa_challenges SET code_hash = ?, sent_at = ?, expires_at = ? WHERE id = ?', [
    sha256(code),
    now,
    now + config.mfa.codeTtlMs,
    challenge.id,
  ]);
  await sendVerificationCode(toUser(await loadUserRow(Number(challenge.user_id))), code);
  res.json({ ok: true });
});

authRouter.post('/logout', async (req, res) => {
  const token = readCookie(req, config.session.cookieName);
  if (token) await run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/session', requireSession, (_req, res) => {
  res.json({ user: currentUser(res) });
});

/**
 * Sets a new password. On first sign-in with a temporary password the user
 * just proved it (password + emailed code), so only the new one is needed;
 * otherwise the current password is required.
 */
authRouter.post('/change-password', requireSession, async (req, res) => {
  const user = currentUser(res);
  const row = await loadUserRow(user.id);
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!user.mustChangePassword) {
    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    if (!(await verifyPassword(current, row.password_hash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Your current password is incorrect.');
    }
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 200) {
    throw new HttpError(400, 'WEAK_PASSWORD', `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
  }
  if (await verifyPassword(newPassword, row.password_hash)) {
    throw new HttpError(400, 'SAME_PASSWORD', 'Choose a password different from your current one.');
  }

  const hash = await hashPassword(newPassword);
  await tx(async (t) => {
    await run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, user.id], t);
    // Sign out every other session; keep this one.
    await run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [user.id, res.locals.sessionTokenHash], t);
  });
  res.json({ user: toUser(await loadUserRow(user.id)) });
});

/** Drops expired sessions, sign-in codes and old login-failure counters. */
export async function pruneExpired() {
  const now = Date.now();
  await run('DELETE FROM sessions WHERE expires_at < ?', [now]);
  await run('DELETE FROM mfa_challenges WHERE expires_at < ?', [now]);
  await run('DELETE FROM login_failures WHERE ? - first_at > ?', [now, config.login.windowMs]);
}
