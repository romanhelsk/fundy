import { config } from './config.ts';
import { db, tx } from './db.ts';

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
         COALESCE(SUM(CASE WHEN status = 'Pending' AND ${INFLOW} THEN amount_cents END), 0) AS pending,
         COALESCE(SUM(CASE WHEN status = 'Pending' AND ${OUTFLOW} THEN amount_cents END), 0) AS held
       FROM transactions WHERE user_id = $u`,
    )
    .get({ $u: userId }) as Record<string, number>;
  // Pending withdrawals are held: out of the available balance, but still the client's money.
  const held = n(row.held);
  const available = n(row.opening) + n(row.inflow) - n(row.outflow) - held;
  const pending = n(row.pending);
  return { availableCents: available, pendingCents: pending, heldCents: held, totalCents: available + held + pending };
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
  // Any pending deposit, credit or withdrawal starts the 12-hour deadline.
  const dueAt = t.status === 'Pending' ? new Date(Date.now() + config.transferWindowMs).toISOString() : null;
  const r = db
    .prepare(
      `INSERT INTO transactions (user_id, date, type, method_id, status, amount_cents, note, created_by, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.userId, today(), t.type, t.methodId ?? null, t.status, t.amountCents, t.note ?? null, t.createdBy ?? null, dueAt);
  const seq = Number(r.lastInsertRowid);
  const reference = `TX-${81000 + seq}`;
  db.prepare('UPDATE transactions SET ref = ? WHERE seq = ?').run(reference, seq);
  return { seq, reference };
}

// ---------- Transfer deadlines & suspension ----------

export interface PendingTransfer {
  reference: string;
  type: TxType;
  /** Money in (client must send it) or out (an admin must send the wire). */
  direction: 'in' | 'out';
  amountCents: number;
  dueAt: string; // ISO
  /** Destination/source account label, when there is one. */
  methodLabel: string | null;
}

/** The pending transaction with the nearest deadline, if any. While one exists, add/withdraw is blocked. */
export function pendingTransferFor(userId: number): PendingTransfer | null {
  const row = db
    .prepare(
      `SELECT t.ref, t.type, t.amount_cents, t.due_at, m.long_label
       FROM transactions t LEFT JOIN payment_methods m ON m.id = t.method_id
       WHERE t.user_id = ? AND t.status = 'Pending' AND t.due_at IS NOT NULL
       ORDER BY t.due_at ASC LIMIT 1`,
    )
    .get(userId) as { ref: string; type: TxType; amount_cents: number; due_at: string; long_label: string | null } | undefined;
  if (!row) return null;
  return {
    reference: row.ref,
    type: row.type,
    direction: row.type === 'Deposit' || row.type === 'Credit' ? 'in' : 'out',
    amountCents: row.amount_cents,
    dueAt: row.due_at,
    methodLabel: row.long_label,
  };
}

export type SuspensionReason = 'TRANSFER_NOT_RECEIVED' | 'WITHDRAWAL_NOT_COMPLETED';

export interface AccountStatus {
  status: 'active' | 'suspended';
  suspendedAt: string | null;
  suspendedReason: SuspensionReason | null;
  /** The transfer that expired and caused the suspension, if that was the reason. */
  expiredReference: string | null;
}

export function accountStatusFor(userId: number): AccountStatus {
  const row = db.prepare('SELECT suspended_at, suspended_reason FROM users WHERE id = ?').get(userId) as {
    suspended_at: string | null;
    suspended_reason: SuspensionReason | null;
  };
  if (!row?.suspended_at) return { status: 'active', suspendedAt: null, suspendedReason: null, expiredReference: null };
  const expired = db
    .prepare(
      `SELECT ref FROM transactions
       WHERE user_id = ? AND status = 'Failed' AND error_code IN ('TRANSFER_EXPIRED', 'WITHDRAWAL_EXPIRED')
       ORDER BY seq DESC LIMIT 1`,
    )
    .get(userId) as { ref: string } | undefined;
  return {
    status: 'suspended',
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
    expiredReference: expired?.ref ?? null,
  };
}

/**
 * Fails every pending transaction whose deadline has passed and suspends the
 * account. A failed withdrawal releases its hold back to the balance. Runs on
 * a timer and before any read or write that depends on it, so the state is
 * never stale. Returns how many transactions expired.
 */
export function enforceTransferDeadlines(userId?: number): number {
  const now = new Date().toISOString();
  const expired = db
    .prepare(
      `SELECT seq, ref, type, user_id, amount_cents FROM transactions
       WHERE status = 'Pending' AND due_at IS NOT NULL AND due_at <= ?
       ${userId === undefined ? '' : 'AND user_id = ?'}`,
    )
    .all(...(userId === undefined ? [now] : [now, userId])) as unknown as {
    seq: number;
    ref: string;
    type: TxType;
    user_id: number;
    amount_cents: number;
  }[];
  if (expired.length === 0) return 0;

  tx(() => {
    for (const t of expired) {
      const isWithdrawal = t.type === 'Withdrawal' || t.type === 'Debit';
      const errorCode = isWithdrawal ? 'WITHDRAWAL_EXPIRED' : 'TRANSFER_EXPIRED';
      const reason: SuspensionReason = isWithdrawal ? 'WITHDRAWAL_NOT_COMPLETED' : 'TRANSFER_NOT_RECEIVED';
      db.prepare("UPDATE transactions SET status = 'Failed', error_code = ? WHERE seq = ?").run(errorCode, t.seq);
      const wasActive =
        db
          .prepare('UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ? AND suspended_at IS NULL')
          .run(now, reason, t.user_id).changes > 0;
      db.prepare('INSERT INTO admin_audit (admin_id, target_user_id, action, details) VALUES (NULL, ?, ?, ?)').run(
        t.user_id,
        'transaction.expire',
        JSON.stringify({ reference: t.ref, type: t.type, amountCents: t.amount_cents, suspended: wasActive }),
      );
    }
  });
  console.log(`12-hour deadline passed for ${expired.map((t) => t.ref).join(', ')}; account(s) suspended.`);
  return expired.length;
}
