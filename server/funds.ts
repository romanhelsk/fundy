import { Router } from 'express';
import { currentUser, requireUser } from './auth.ts';
import { config } from './config.ts';
import { db } from './db.ts';
import { TEST_TRIGGERS, gateway } from './gateway.ts';
import { HttpError, str } from './http.ts';

export const fundsRouter = Router();
fundsRouter.use(requireUser);

interface MethodRow {
  id: string;
  kind: 'bank' | 'card';
  label: string;
  long_label: string;
}

interface TxRow {
  ref: string;
  date: string;
  type: 'Deposit' | 'Withdrawal';
  method_id: string;
  status: 'Pending' | 'Completed' | 'Failed';
  amount_cents: number;
  error_code: string | null;
}

function toTransaction(r: TxRow) {
  return {
    id: r.ref,
    date: r.date,
    type: r.type,
    methodId: r.method_id,
    status: r.status,
    amountCents: r.amount_cents,
    errorCode: r.error_code,
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

fundsRouter.get('/overview', (_req, res) => {
  const user = currentUser(res);
  const month = today().slice(0, 7);

  const opening = num(
    (db.prepare('SELECT opening_balance_cents AS v FROM users WHERE id = ?').get(user.id) as { v: number }).v,
  );
  const sums = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Deposit' THEN amount_cents END), 0) AS dep,
         COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Withdrawal' THEN amount_cents END), 0) AS wd,
         COALESCE(SUM(CASE WHEN status = 'Pending' AND type = 'Deposit' THEN amount_cents END), 0) AS pending,
         COUNT(CASE WHEN status = 'Pending' THEN 1 END) AS pendingCount,
         COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Deposit' AND substr(date, 1, 7) = $month THEN amount_cents END), 0) AS monthDep,
         COUNT(CASE WHEN status = 'Completed' AND type = 'Deposit' AND substr(date, 1, 7) = $month THEN 1 END) AS monthDepCount,
         COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Withdrawal' AND substr(date, 1, 7) = $month THEN amount_cents END), 0) AS monthWd,
         COUNT(CASE WHEN status = 'Completed' AND type = 'Withdrawal' AND substr(date, 1, 7) = $month THEN 1 END) AS monthWdCount,
         COUNT(*) AS total
       FROM transactions WHERE user_id = $user`,
    )
    .get({ $user: user.id, $month: month }) as Record<string, number>;

  const available = opening + num(sums.dep) - num(sums.wd);
  const pending = num(sums.pending);

  const methods = (
    db.prepare('SELECT id, kind, label, long_label FROM payment_methods WHERE user_id = ? ORDER BY kind').all(user.id) as unknown as MethodRow[]
  ).map((m) => ({ id: m.id, kind: m.kind, label: m.label, longLabel: m.long_label }));

  const transactions = (
    db
      .prepare(
        `SELECT ref, date, type, method_id, status, amount_cents, error_code FROM transactions
         WHERE user_id = ? ORDER BY date DESC, seq DESC LIMIT 50`,
      )
      .all(user.id) as unknown as TxRow[]
  ).map(toTransaction);

  res.json({
    user,
    gateway: { name: gateway.name, isTest: gateway.isTest, triggers: gateway.isTest ? TEST_TRIGGERS : [] },
    balance: { availableCents: available, pendingCents: pending, totalCents: available + pending, asOf: new Date().toISOString() },
    summary: {
      depositsCents: num(sums.monthDep),
      depositsCount: num(sums.monthDepCount),
      withdrawalsCents: num(sums.monthWd),
      withdrawalsCount: num(sums.monthWdCount),
      pendingCount: num(sums.pendingCount),
    },
    methods,
    transactions,
    totalCount: num(sums.total),
  });
});

fundsRouter.post('/deposits', async (req, res) => {
  const user = currentUser(res);
  const amountCents = req.body?.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new HttpError(400, 'VALIDATION', 'Enter an amount greater than $0.00.');
  }
  if (amountCents > config.maxDepositCents) {
    throw new HttpError(400, 'AMOUNT_LIMIT_EXCEEDED', 'The most you can add in one deposit is $1,000,000.00.');
  }
  const methodId = str(req.body?.methodId, 'methodId', 64);
  const method = db
    .prepare('SELECT id, kind, label, long_label FROM payment_methods WHERE id = ? AND user_id = ?')
    .get(methodId, user.id) as MethodRow | undefined;
  if (!method) throw new HttpError(404, 'METHOD_NOT_FOUND', 'That payment method is not linked to your account.');

  // 1. Record the deposit as Pending before talking to the provider.
  const insert = db
    .prepare(
      `INSERT INTO transactions (user_id, date, type, method_id, status, amount_cents)
       VALUES (?, ?, 'Deposit', ?, 'Pending', ?)`,
    )
    .run(user.id, today(), method.id, amountCents);
  const seq = Number(insert.lastInsertRowid);
  const reference = `TX-${81000 + seq}`;
  db.prepare('UPDATE transactions SET ref = ? WHERE seq = ?').run(reference, seq);

  // 2. Charge through the gateway.
  let result;
  try {
    result = await gateway.charge({ reference, amountCents, method: { kind: method.kind, label: method.label } });
  } catch (err) {
    console.error('Gateway error', err);
    result = { status: 'failed' as const, code: 'PROVIDER_ERROR', message: "Our payment provider couldn't process this deposit." };
  }

  // 3. Settle. Failed deposits never touch the balance.
  if (result.status === 'succeeded') {
    db.prepare("UPDATE transactions SET status = 'Completed' WHERE seq = ?").run(seq);
  } else {
    db.prepare("UPDATE transactions SET status = 'Failed', error_code = ? WHERE seq = ?").run(result.code, seq);
  }
  const row = db
    .prepare('SELECT ref, date, type, method_id, status, amount_cents, error_code FROM transactions WHERE seq = ?')
    .get(seq) as unknown as TxRow;

  res.status(201).json(
    result.status === 'succeeded'
      ? { ok: true, transaction: toTransaction(row), feeCents: result.feeCents }
      : { ok: false, transaction: toTransaction(row), errorCode: result.code, errorMessage: result.message },
  );
});
