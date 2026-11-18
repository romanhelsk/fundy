import { db } from './db.ts';

export type TxType = 'Deposit' | 'Withdrawal' | 'Credit' | 'Debit';
export type TxStatus = 'Pending' | 'Completed' | 'Failed';

/** Money in: deposits and admin credits. Money out: withdrawals and admin debits. */
const INFLOW = `type IN ('Deposit', 'Credit')`;
const OUTFLOW = `type IN ('Withdrawal', 'Debit')`;

export interface MethodRow {
  id: string;
  kind: 'bank' | 'card';
  label: string;
  long_label: string;
}

interface TxRow {
  ref: string;
  date: string;
  type: TxType;
  method_id: string | null;
  status: TxStatus;
  amount_cents: number;
  error_code: string | null;
  note: string | null;
}

const TX_COLUMNS = 'ref, date, type, method_id, status, amount_cents, error_code, note';

export function toTransaction(r: TxRow) {
  return {
    id: r.ref,
    date: r.date,
    type: r.type,
    methodId: r.method_id,
    status: r.status,
    amountCents: r.amount_cents,
    errorCode: r.error_code,
    note: r.note,
  };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

const n = (v: unknown) => Number(v ?? 0);

export function balanceFor(userId: number) {
  const row = db
    .prepare(
      `SELECT
         (SELECT opening_balance_cents FROM users WHERE id = $u) AS opening,
         COALESCE(SUM(CASE WHEN status = 'Completed' AND ${INFLOW} THEN amount_cents END), 0) AS inflow,
         COALESCE(SUM(CASE WHEN status = 'Completed' AND ${OUTFLOW} THEN amount_cents END), 0) AS outflow,
         COALESCE(SUM(CASE WHEN status = 'Pending' AND ${INFLOW} THEN amount_cents END), 0) AS pending
       FROM transactions WHERE user_id = $u`,
    )
    .get({ $u: userId }) as Record<string, number>;
  const available = n(row.opening) + n(row.inflow) - n(row.outflow);
  const pending = n(row.pending);
  return { availableCents: available, pendingCents: pending, totalCents: available + pending };
}

export function summaryFor(userId: number) {
  const month = today().slice(0, 7);
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Deposit' AND substr(date, 1, 7) = $m THEN amount_cents END), 0) AS dep,
         COUNT(CASE WHEN status = 'Completed' AND type = 'Deposit' AND substr(date, 1, 7) = $m THEN 1 END) AS depCount,
         COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Withdrawal' AND substr(date, 1, 7) = $m THEN amount_cents END), 0) AS wd,
         COUNT(CASE WHEN status = 'Completed' AND type = 'Withdrawal' AND substr(date, 1, 7) = $m THEN 1 END) AS wdCount,
         COUNT(CASE WHEN status = 'Pending' THEN 1 END) AS pendingCount,
         COUNT(*) AS total
       FROM transactions WHERE user_id = $u`,
    )
    .get({ $u: userId, $m: month }) as Record<string, number>;
  return {
    summary: {
      depositsCents: n(row.dep),
      depositsCount: n(row.depCount),
      withdrawalsCents: n(row.wd),
      withdrawalsCount: n(row.wdCount),
      pendingCount: n(row.pendingCount),
    },
    totalCount: n(row.total),
  };
}

/** Active (not removed) payment methods. */
export function methodsFor(userId: number) {
  return (
    db
      .prepare(
        'SELECT id, kind, label, long_label FROM payment_methods WHERE user_id = ? AND removed_at IS NULL ORDER BY kind, rowid',
      )
      .all(userId) as unknown as MethodRow[]
  ).map((m) => ({ id: m.id, kind: m.kind, label: m.label, longLabel: m.long_label }));
}

/** Labels for every method the user ever had, so old transactions still render after a method is removed. */
export function methodLabelsFor(userId: number): Record<string, string> {
  const rows = db.prepare('SELECT id, long_label FROM payment_methods WHERE user_id = ?').all(userId) as unknown as {
    id: string;
    long_label: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.long_label]));
}

export function transactionsFor(userId: number, limit = 50) {
  return (
    db
      .prepare(`SELECT ${TX_COLUMNS} FROM transactions WHERE user_id = ? ORDER BY date DESC, seq DESC LIMIT ?`)
      .all(userId, limit) as unknown as TxRow[]
  ).map(toTransaction);
}

export function transactionBySeq(seq: number) {
  return toTransaction(db.prepare(`SELECT ${TX_COLUMNS} FROM transactions WHERE seq = ?`).get(seq) as unknown as TxRow);
}

/** Inserts a transaction and gives it its public reference. Returns the row's seq. */
export function insertTransaction(t: {
  userId: number;
  type: TxType;
  status: TxStatus;
  amountCents: number;
  methodId?: string | null;
  note?: string | null;
  createdBy?: number | null;
}): { seq: number; reference: string } {
  const r = db
    .prepare(
      `INSERT INTO transactions (user_id, date, type, method_id, status, amount_cents, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.userId, today(), t.type, t.methodId ?? null, t.status, t.amountCents, t.note ?? null, t.createdBy ?? null);
  const seq = Number(r.lastInsertRowid);
  const reference = `TX-${81000 + seq}`;
  db.prepare('UPDATE transactions SET ref = ? WHERE seq = ?').run(reference, seq);
  return { seq, reference };
}
