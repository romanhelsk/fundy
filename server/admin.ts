import { Router, type Response } from 'express';
import { EMAIL_PATTERN, currentUser, requireAdmin, requireUser, type User } from './auth.ts';
import { config } from './config.ts';
import { hashPassword, randomToken } from './crypto.ts';
import { db, tx } from './db.ts';
import { HttpError, str } from './http.ts';
import {
  accountStatusFor,
  balanceFor,
  enforceTransferDeadlines,
  pendingTransferFor,
  insertTransaction,
  methodLabelsFor,
  methodsFor,
  summaryFor,
  transactionBySeq,
  transactionsFor,
} from './ledger.ts';

export const adminRouter = Router();
adminRouter.use(requireUser, requireAdmin);

// ---------- Helpers ----------
function audit(res: Response, action: string, targetUserId: number | null, details: Record<string, unknown>) {
  db.prepare('INSERT INTO admin_audit (admin_id, target_user_id, action, details) VALUES (?, ?, ?, ?)').run(
    currentUser(res).id,
    targetUserId,
    action,
    JSON.stringify(details),
  );
}

type ClientRow = Omit<User, 'mustChangePassword'> & { createdAt: string; mustChange: number };
const CLIENT_COLUMNS = 'id, email, name, role, must_change_password AS mustChange, created_at AS createdAt';

function toClient({ mustChange, ...rest }: ClientRow): User & { createdAt: string } {
  return { ...rest, mustChangePassword: mustChange === 1 };
}

function loadClient(idParam: unknown): User & { createdAt: string } {
  const id = Number(idParam);
  const row = Number.isSafeInteger(id)
    ? (db.prepare(`SELECT ${CLIENT_COLUMNS} FROM users WHERE id = ? AND role = 'client'`).get(id) as ClientRow | undefined)
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

function auditFor(userId: number) {
  return (
    db
      .prepare(
        `SELECT a.id, a.action, a.details, a.created_at AS createdAt, COALESCE(u.name, 'System') AS adminName
         FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id
         WHERE a.target_user_id = ? ORDER BY a.id DESC LIMIT 50`,
      )
      .all(userId) as unknown as { id: number; action: string; details: string; createdAt: string; adminName: string }[]
  ).map((a) => ({ ...a, details: JSON.parse(a.details) as Record<string, unknown> }));
}

// ---------- Clients ----------
adminRouter.get('/users', (req, res) => {
  enforceTransferDeadlines();
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const rows = db
    .prepare(
      `SELECT ${CLIENT_COLUMNS} FROM users
       WHERE role = 'client' AND ($q = '' OR name LIKE $like OR email LIKE $like)
       ORDER BY created_at DESC, id DESC LIMIT 200`,
    )
    .all({ $q: q, $like: `%${q}%` }) as unknown as ClientRow[];
  res.json({
    users: rows.map(toClient).map((u) => ({
      ...u,
      balance: balanceFor(u.id),
      account: accountStatusFor(u.id),
      pendingTransfer: pendingTransferFor(u.id),
      methodCount: methodsFor(u.id).length,
    })),
  });
});

adminRouter.post('/users', async (req, res) => {
  const name = str(req.body?.name, 'name', 120);
  const email = str(req.body?.email, 'email', 254).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'VALIDATION', 'Enter a valid email address.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
  }
  // Shown to the admin once; never stored in plain text.
  const temporaryPassword = randomToken(12);
  const passwordHash = await hashPassword(temporaryPassword);
  const id = tx(() => {
    const userId = Number(
      db
        .prepare("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'client', 1)")
        .run(email, name, passwordHash).lastInsertRowid,
    );
    audit(res, 'user.create', userId, { email, name });
    return userId;
  });
  res.status(201).json({ user: loadClient(id), temporaryPassword });
});

/**
 * Issues a new temporary password. The client must set their own on next
 * sign-in, and every existing session and pending sign-in code is revoked.
 */
adminRouter.post('/users/:id/reset-password', async (req, res) => {
  const user = loadClient(req.params.id);
  const temporaryPassword = randomToken(12);
  const passwordHash = await hashPassword(temporaryPassword);
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(passwordHash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(user.id);
    audit(res, 'user.reset_password', user.id, {});
  });
  res.json({ user: loadClient(user.id), temporaryPassword });
});

adminRouter.get('/users/:id', (req, res) => {
  const user = loadClient(req.params.id);
  enforceTransferDeadlines(user.id);
  const { summary, totalCount } = summaryFor(user.id);
  res.json({
    user,
    balance: balanceFor(user.id),
    account: accountStatusFor(user.id),
    pendingTransfer: pendingTransferFor(user.id),
    summary,
    totalCount,
    methods: methodsFor(user.id),
    methodLabels: methodLabelsFor(user.id),
    transactions: transactionsFor(user.id, 100),
    audit: auditFor(user.id),
  });
});

// ---------- Balance adjustments ----------
adminRouter.post('/users/:id/adjustments', (req, res) => {
  const user = loadClient(req.params.id);
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

  const { seq } = tx(() => {
    if (direction === 'debit' && amountCents > balanceFor(user.id).availableCents) {
      throw new HttpError(400, 'INSUFFICIENT_BALANCE', "A debit can't be larger than the client's available balance.");
    }
    const inserted = insertTransaction({
      userId: user.id,
      type: direction === 'credit' ? 'Credit' : 'Debit',
      status,
      amountCents,
      note,
      createdBy: currentUser(res).id,
    });
    audit(res, `balance.${direction}`, user.id, { reference: inserted.reference, amountCents, status, note });
    return inserted;
  });
  res.status(201).json({ transaction: transactionBySeq(seq), balance: balanceFor(user.id) });
});

adminRouter.post('/users/:id/transactions/:ref/settle', (req, res) => {
  const user = loadClient(req.params.id);
  // A transfer whose deadline passed is already failed; it can't be completed late.
  enforceTransferDeadlines(user.id);
  const status = req.body?.status;
  if (status !== 'Completed' && status !== 'Failed') {
    throw new HttpError(400, 'VALIDATION', 'Settle as Completed or Failed.');
  }
  const ref = String(req.params.ref);
  const row = db
    .prepare('SELECT seq, status, amount_cents AS amountCents FROM transactions WHERE ref = ? AND user_id = ?')
    .get(ref, user.id) as { seq: number; status: string; amountCents: number } | undefined;
  if (!row) throw new HttpError(404, 'TX_NOT_FOUND', 'Transaction not found.');
  if (row.status !== 'Pending') throw new HttpError(409, 'NOT_PENDING', 'Only pending transactions can be settled.');

  tx(() => {
    db.prepare('UPDATE transactions SET status = ?, error_code = ? WHERE seq = ?').run(
      status,
      status === 'Failed' ? 'FAILED_BY_ADMIN' : null,
      row.seq,
    );
    audit(res, 'transaction.settle', user.id, { reference: ref, status, amountCents: row.amountCents });
  });
  res.json({ transaction: transactionBySeq(row.seq), balance: balanceFor(user.id) });
});

// ---------- Linked accounts ----------
adminRouter.post('/users/:id/methods', (req, res) => {
  const user = loadClient(req.params.id);
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
  tx(() => {
    db.prepare('INSERT INTO payment_methods (id, user_id, kind, label, long_label) VALUES (?, ?, ?, ?, ?)').run(
      id,
      user.id,
      kind,
      label,
      longLabel,
    );
    audit(res, 'method.link', user.id, { methodId: id, kind, label: longLabel });
  });
  res.status(201).json({ methods: methodsFor(user.id) });
});

adminRouter.post('/users/:id/methods/:methodId/remove', (req, res) => {
  const user = loadClient(req.params.id);
  const methodId = String(req.params.methodId);
  const m = db
    .prepare('SELECT long_label AS label FROM payment_methods WHERE id = ? AND user_id = ? AND removed_at IS NULL')
    .get(methodId, user.id) as { label: string } | undefined;
  if (!m) throw new HttpError(404, 'METHOD_NOT_FOUND', 'Linked account not found.');
  tx(() => {
    // Soft remove: past transactions keep pointing at it.
    db.prepare("UPDATE payment_methods SET removed_at = datetime('now') WHERE id = ?").run(methodId);
    audit(res, 'method.remove', user.id, { methodId, label: m.label });
  });
  res.json({ methods: methodsFor(user.id) });
});

// ---------- Account status ----------
adminRouter.post('/users/:id/reactivate', (req, res) => {
  const user = loadClient(req.params.id);
  const before = accountStatusFor(user.id);
  if (before.status !== 'suspended') throw new HttpError(409, 'NOT_SUSPENDED', 'This account is not suspended.');
  tx(() => {
    db.prepare('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?').run(user.id);
    audit(res, 'account.reactivate', user.id, { reason: before.suspendedReason });
  });
  res.json({ account: accountStatusFor(user.id) });
});
