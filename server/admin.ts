import { Router, type Response } from 'express';
import { EMAIL_PATTERN, currentUser, requireAdmin, requireUser, type User } from './auth.js';
import { config } from './config.js';
import { hashPassword, randomToken } from './crypto.js';
import { all, db, get, run, tx, type Executor } from './db.js';
import { HttpError, str } from './http.js';
import {
  accountStatusFor,
  balanceFor,
  enforceTransferDeadlines,
  insertTransaction,
  methodLabelsFor,
  methodsFor,
  pendingTransferFor,
  summaryFor,
  transactionBySeq,
  transactionsFor,
} from './ledger.js';

export const adminRouter = Router();
adminRouter.use(requireUser, requireAdmin);

// ---------- Helpers ----------
async function audit(
  res: Response,
  action: string,
  targetUserId: number | null,
  details: Record<string, unknown>,
  ex: Executor = db,
) {
  await run(
    'INSERT INTO admin_audit (admin_id, target_user_id, action, details) VALUES (?, ?, ?, ?)',
    [currentUser(res).id, targetUserId, action, JSON.stringify(details)],
    ex,
  );
}

type ClientRow = Omit<User, 'mustChangePassword'> & { createdAt: string; mustChange: number };
const CLIENT_COLUMNS = 'id, email, name, role, must_change_password AS mustChange, created_at AS createdAt';

function toClient({ mustChange, ...rest }: ClientRow): User & { createdAt: string } {
  return { ...rest, id: Number(rest.id), mustChangePassword: Number(mustChange) === 1 };
}

async function loadClient(idParam: unknown): Promise<User & { createdAt: string }> {
  const id = Number(idParam);
  const row = Number.isSafeInteger(id)
    ? await get<ClientRow>(`SELECT ${CLIENT_COLUMNS} FROM users WHERE id = ? AND role = 'client'`, [id])
    : undefined;
  if (!row) throw new HttpError(404, 'USER_NOT_FOUND', 'Client not found.');
  return toClient(row);
}

function amount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new HttpError(400, 'VALIDATION', 'Enter an amount greater than $0.00.');
  }
  if ((value as number) > config.maxAdjustmentCents) {
    throw new HttpError(400, 'AMOUNT_LIMIT_EXCEEDED', 'That amount is over the adjustment limit.');
  }
  return value as number;
}

async function auditFor(userId: number) {
  const rows = await all<{ id: number; action: string; details: string; createdAt: string; adminName: string }>(
    `SELECT a.id, a.action, a.details, a.created_at AS createdAt, COALESCE(u.name, 'System') AS adminName
     FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id
     WHERE a.target_user_id = ? ORDER BY a.id DESC LIMIT 50`,
    [userId],
  );
  return rows.map((a) => ({ ...a, id: Number(a.id), details: JSON.parse(a.details) as Record<string, unknown> }));
}

// ---------- Clients ----------
adminRouter.get('/users', async (req, res) => {
  await enforceTransferDeadlines();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = await all<ClientRow>(
    `SELECT ${CLIENT_COLUMNS} FROM users
     WHERE role = 'client' AND (?1 = '' OR name LIKE ?2 OR email LIKE ?2)
     ORDER BY created_at DESC, id DESC LIMIT 200`,
    [q, `%${q}%`],
  );
  const users = await Promise.all(
    rows.map(toClient).map(async (u) => {
      const [balance, account, pendingTransfer, methods] = await Promise.all([
        balanceFor(u.id),
        accountStatusFor(u.id),
        pendingTransferFor(u.id),
        methodsFor(u.id),
      ]);
      return { ...u, balance, account, pendingTransfer, methodCount: methods.length };
    }),
  );
  res.json({ users });
});

adminRouter.post('/users', async (req, res) => {
  const name = str(req.body?.name, 'name', 120);
  const email = str(req.body?.email, 'email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'VALIDATION', 'Enter a valid email address.');
  if (await get('SELECT 1 FROM users WHERE email = ?', [email])) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }
  // Shown to the admin once; never stored in plain text.
  const temporaryPassword = randomToken(12);
  const passwordHash = await hashPassword(temporaryPassword);
  const id = await tx(async (t) => {
    const { lastInsertRowid: userId } = await run(
      "INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'client', 1)",
      [email, name, passwordHash],
      t,
    );
    await audit(res, 'user.create', userId, { email, name }, t);
    return userId;
  });
  res.status(201).json({ user: await loadClient(id), temporaryPassword });
});

/**
 * Issues a new temporary password. The client must set their own on next
 * sign-in, and every existing session and pending sign-in code is revoked.
 */
adminRouter.post('/users/:id/reset-password', async (req, res) => {
  const user = await loadClient(req.params.id);
  const temporaryPassword = randomToken(12);
  const passwordHash = await hashPassword(temporaryPassword);
  await tx(async (t) => {
    await run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [passwordHash, user.id], t);
    await run('DELETE FROM sessions WHERE user_id = ?', [user.id], t);
    await run('DELETE FROM mfa_challenges WHERE user_id = ?', [user.id], t);
    await audit(res, 'user.reset_password', user.id, {}, t);
  });
  res.json({ user: await loadClient(user.id), temporaryPassword });
});

adminRouter.get('/users/:id', async (req, res) => {
  const user = await loadClient(req.params.id);
  await enforceTransferDeadlines(user.id);
  const [{ summary, totalCount }, balance, account, pendingTransfer, methods, methodLabels, transactions, auditLog] =
    await Promise.all([
      summaryFor(user.id),
      balanceFor(user.id),
      accountStatusFor(user.id),
      pendingTransferFor(user.id),
      methodsFor(user.id),
      methodLabelsFor(user.id),
      transactionsFor(user.id, 100),
      auditFor(user.id),
    ]);
  res.json({ user, balance, account, pendingTransfer, summary, totalCount, methods, methodLabels, transactions, audit: auditLog });
});

// ---------- Balance adjustments ----------
adminRouter.post('/users/:id/adjustments', async (req, res) => {
  const user = await loadClient(req.params.id);
  const direction = req.body?.direction;
  if (direction !== 'credit' && direction !== 'debit') {
    throw new HttpError(400, 'VALIDATION', 'Choose credit or debit.');
  }
  const amountCents = amount(req.body?.amountCents);
  const status = req.body?.status === 'Pending' ? 'Pending' : 'Completed';
  if (direction === 'debit' && status === 'Pending') {
    throw new HttpError(400, 'VALIDATION', 'Debits are applied immediately and cannot be pending.');
  }
  const note = str(req.body?.note, 'note', 200);

  const { seq } = await tx(async (t) => {
    if (direction === 'debit' && amountCents > (await balanceFor(user.id, t)).availableCents) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', "A debit can't be larger than the client's available balance.");
    }
    const inserted = await insertTransaction(
      {
        userId: user.id,
        type: direction === 'credit' ? 'Credit' : 'Debit',
        status,
        amountCents,
        note,
        createdBy: currentUser(res).id,
      },
      t,
    );
    await audit(res, `balance.${direction}`, user.id, { reference: inserted.reference, amountCents, status, note }, t);
    return inserted;
  });
  res.status(201).json({ transaction: await transactionBySeq(seq), balance: await balanceFor(user.id) });
});

adminRouter.post('/users/:id/transactions/:ref/settle', async (req, res) => {
  const user = await loadClient(req.params.id);
  // A transaction whose deadline passed is already failed; it can't be completed late.
  await enforceTransferDeadlines(user.id);
  const status = req.body?.status;
  if (status !== 'Completed' && status !== 'Failed') {
    throw new HttpError(400, 'VALIDATION', 'Settle as Completed or Failed.');
  }
  const ref = String(req.params.ref);
  const row = await get<{ seq: number; status: string; amountCents: number }>(
    'SELECT seq, status, amount_cents AS amountCents FROM transactions WHERE ref = ? AND user_id = ?',
    [ref, user.id],
  );
  if (!row) throw new HttpError(404, 'TX_NOT_FOUND', 'Transaction not found.');
  if (row.status !== 'Pending') throw new HttpError(409, 'NOT_PENDING', 'Only pending transactions can be settled.');

  await tx(async (t) => {
    const updated = await run(
      "UPDATE transactions SET status = ?, error_code = ? WHERE seq = ? AND status = 'Pending'",
      [status, status === 'Failed' ? 'FAILED_BY_ADMIN' : null, row.seq],
      t,
    );
    if (updated.changes === 0) throw new HttpError(409, 'NOT_PENDING', 'Only pending transactions can be settled.');
    await audit(res, 'transaction.settle', user.id, { reference: ref, status, amountCents: Number(row.amountCents) }, t);
  });
  res.json({ transaction: await transactionBySeq(Number(row.seq)), balance: await balanceFor(user.id) });
});

// ---------- Linked accounts ----------
adminRouter.post('/users/:id/methods', async (req, res) => {
  const user = await loadClient(req.params.id);
  const kind = req.body?.kind;
  if (kind !== 'bank' && kind !== 'card') throw new HttpError(400, 'VALIDATION', 'Choose bank account or card.');
  const last4 = String(req.body?.last4 ?? '');
  if (!/^\d{4}$/.test(last4)) throw new HttpError(400, 'VALIDATION', 'Enter the last 4 digits.');
  const institution = typeof req.body?.institution === 'string' ? req.body.institution.trim().slice(0, 60) : '';

  const label = `${kind === 'bank' ? 'Bank' : 'Card'} •••• ${last4}`;
  const longLabel = institution
    ? `${institution} •••• ${last4}`
    : kind === 'bank'
      ? `Bank transfer •••• ${last4}`
      : `Card •••• ${last4}`;
  const id = `pm_${randomToken(9)}`;
  await tx(async (t) => {
    await run('INSERT INTO payment_methods (id, user_id, kind, label, long_label) VALUES (?, ?, ?, ?, ?)', [id, user.id, kind, label, longLabel], t);
    await audit(res, 'method.link', user.id, { methodId: id, kind, label: longLabel }, t);
  });
  res.status(201).json({ methods: await methodsFor(user.id) });
});

adminRouter.post('/users/:id/methods/:methodId/remove', async (req, res) => {
  const user = await loadClient(req.params.id);
  const methodId = String(req.params.methodId);
  const m = await get<{ label: string }>(
    'SELECT long_label AS label FROM payment_methods WHERE id = ? AND user_id = ? AND removed_at IS NULL',
    [methodId, user.id],
  );
  if (!m) throw new HttpError(404, 'METHOD_NOT_FOUND', 'Linked account not found.');
  await tx(async (t) => {
    // Soft remove: past transactions keep pointing at it.
    await run("UPDATE payment_methods SET removed_at = datetime('now') WHERE id = ?", [methodId], t);
    await audit(res, 'method.remove', user.id, { methodId, label: m.label }, t);
  });
  res.json({ methods: await methodsFor(user.id) });
});

// ---------- Account status ----------
adminRouter.post('/users/:id/reactivate', async (req, res) => {
  const user = await loadClient(req.params.id);
  const before = await accountStatusFor(user.id);
  if (before.status !== 'suspended') throw new HttpError(409, 'NOT_SUSPENDED', 'This account is not suspended.');
  await tx(async (t) => {
    await run('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?', [user.id], t);
    await audit(res, 'account.reactivate', user.id, { reason: before.suspendedReason }, t);
  });
  res.json({ account: await accountStatusFor(user.id) });
});
