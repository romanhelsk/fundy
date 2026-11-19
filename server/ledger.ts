import { config } from './config.js';
import { all, db, get, run, tx, type Executor } from './db.js';

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
    amountCents: Number(r.amount_cents),
    errorCode: r.error_code,
    note: r.note,
  };
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

const n = (v: unknown) => Number(v ?? 0);

export async function balanceFor(userId: number, ex: Executor = db) {
  const row = await get<Record<string, number>>(
    `SELECT
       (SELECT opening_balance_cents FROM users WHERE id = ?1) AS opening,
       COALESCE(SUM(CASE WHEN status = 'Completed' AND ${INFLOW} THEN amount_cents END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN status = 'Completed' AND ${OUTFLOW} THEN amount_cents END), 0) AS outflow,
       COALESCE(SUM(CASE WHEN status = 'Pending' AND ${INFLOW} THEN amount_cents END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'Pending' AND ${OUTFLOW} THEN amount_cents END), 0) AS held
     FROM transactions WHERE user_id = ?1`,
    [userId],
    ex,
  );
  // Pending withdrawals are held: out of the available balance, but still the client's money.
  const held = n(row?.held);
  const available = n(row?.opening) + n(row?.inflow) - n(row?.outflow) - held;
  const pending = n(row?.pending);
  return { availableCents: available, pendingCents: pending, heldCents: held, totalCents: available + held + pending };
}

export async function summaryFor(userId: number) {
  const month = today().slice(0, 7);
  const row = await get<Record<string, number>>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Deposit' AND substr(date, 1, 7) = ?2 THEN amount_cents END), 0) AS dep,
       COUNT(CASE WHEN status = 'Completed' AND type = 'Deposit' AND substr(date, 1, 7) = ?2 THEN 1 END) AS depCount,
       COALESCE(SUM(CASE WHEN status = 'Completed' AND type = 'Withdrawal' AND substr(date, 1, 7) = ?2 THEN amount_cents END), 0) AS wd,
       COUNT(CASE WHEN status = 'Completed' AND type = 'Withdrawal' AND substr(date, 1, 7) = ?2 THEN 1 END) AS wdCount,
       COUNT(CASE WHEN status = 'Pending' THEN 1 END) AS pendingCount,
       COUNT(*) AS total
     FROM transactions WHERE user_id = ?1`,
    [userId, month],
  );
  return {
    summary: {
      depositsCents: n(row?.dep),
      depositsCount: n(row?.depCount),
      withdrawalsCents: n(row?.wd),
      withdrawalsCount: n(row?.wdCount),
      pendingCount: n(row?.pendingCount),
    },
    totalCount: n(row?.total),
  };
}

/** Active (not removed) payment methods. */
export async function methodsFor(userId: number) {
  const rows = await all<MethodRow>(
    'SELECT id, kind, label, long_label FROM payment_methods WHERE user_id = ? AND removed_at IS NULL ORDER BY kind, rowid',
    [userId],
  );
  return rows.map((m) => ({ id: m.id, kind: m.kind, label: m.label, longLabel: m.long_label }));
}

/** Labels for every method the user ever had, so old transactions still render after a method is removed. */
export async function methodLabelsFor(userId: number): Promise<Record<string, string>> {
  const rows = await all<{ id: string; long_label: string }>('SELECT id, long_label FROM payment_methods WHERE user_id = ?', [
    userId,
  ]);
  return Object.fromEntries(rows.map((r) => [r.id, r.long_label]));
}

export async function transactionsFor(userId: number, limit = 50) {
  const rows = await all<TxRow>(
    `SELECT ${TX_COLUMNS} FROM transactions WHERE user_id = ? ORDER BY date DESC, seq DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map(toTransaction);
}

export async function transactionBySeq(seq: number, ex: Executor = db) {
  return toTransaction((await get<TxRow>(`SELECT ${TX_COLUMNS} FROM transactions WHERE seq = ?`, [seq], ex))!);
}

/** Inserts a transaction and gives it its public reference. Returns the row's seq. */
export async function insertTransaction(
  t: {
    userId: number;
    type: TxType;
    status: TxStatus;
    amountCents: number;
    methodId?: string | null;
    note?: string | null;
    createdBy?: number | null;
  },
  ex: Executor = db,
): Promise<{ seq: number; reference: string }> {
  // Any pending deposit, credit or withdrawal starts the 12-hour deadline.
  const dueAt = t.status === 'Pending' ? new Date(Date.now() + config.transferWindowMs).toISOString() : null;
  const r = await run(
    `INSERT INTO transactions (user_id, date, type, method_id, status, amount_cents, note, created_by, due_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.userId, today(), t.type, t.methodId ?? null, t.status, t.amountCents, t.note ?? null, t.createdBy ?? null, dueAt],
    ex,
  );
  const seq = r.lastInsertRowid;
  const reference = `TX-${81000 + seq}`;
  await run('UPDATE transactions SET ref = ? WHERE seq = ?', [reference, seq], ex);
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
export async function pendingTransferFor(userId: number, ex: Executor = db): Promise<PendingTransfer | null> {
  const row = await get<{ ref: string; type: TxType; amount_cents: number; due_at: string; long_label: string | null }>(
    `SELECT t.ref, t.type, t.amount_cents, t.due_at, m.long_label
     FROM transactions t LEFT JOIN payment_methods m ON m.id = t.method_id
     WHERE t.user_id = ? AND t.status = 'Pending' AND t.due_at IS NOT NULL
     ORDER BY t.due_at ASC LIMIT 1`,
    [userId],
    ex,
  );
  if (!row) return null;
  return {
    reference: row.ref,
    type: row.type,
    direction: row.type === 'Deposit' || row.type === 'Credit' ? 'in' : 'out',
    amountCents: Number(row.amount_cents),
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

export async function accountStatusFor(userId: number): Promise<AccountStatus> {
  const row = await get<{ suspended_at: string | null; suspended_reason: SuspensionReason | null }>(
    'SELECT suspended_at, suspended_reason FROM users WHERE id = ?',
    [userId],
  );
  if (!row?.suspended_at) return { status: 'active', suspendedAt: null, suspendedReason: null, expiredReference: null };
  const expired = await get<{ ref: string }>(
    `SELECT ref FROM transactions
     WHERE user_id = ? AND status = 'Failed' AND error_code IN ('TRANSFER_EXPIRED', 'WITHDRAWAL_EXPIRED')
     ORDER BY seq DESC LIMIT 1`,
    [userId],
  );
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
 * a timer / cron and before any read or write that depends on it, so the
 * state is never stale. Returns how many transactions expired.
 */
export async function enforceTransferDeadlines(userId?: number): Promise<number> {
  const now = new Date().toISOString();
  const expired = await all<{ seq: number; ref: string; type: TxType; user_id: number; amount_cents: number }>(
    `SELECT seq, ref, type, user_id, amount_cents FROM transactions
     WHERE status = 'Pending' AND due_at IS NOT NULL AND due_at <= ?
     ${userId === undefined ? '' : 'AND user_id = ?'}`,
    userId === undefined ? [now] : [now, userId],
  );
  if (expired.length === 0) return 0;

  await tx(async (t) => {
    for (const e of expired) {
      const isWithdrawal = e.type === 'Withdrawal' || e.type === 'Debit';
      const errorCode = isWithdrawal ? 'WITHDRAWAL_EXPIRED' : 'TRANSFER_EXPIRED';
      const reason: SuspensionReason = isWithdrawal ? 'WITHDRAWAL_NOT_COMPLETED' : 'TRANSFER_NOT_RECEIVED';
      // Status guard: if another instance already expired it, do nothing.
      const updated = await run(
        "UPDATE transactions SET status = 'Failed', error_code = ? WHERE seq = ? AND status = 'Pending'",
        [errorCode, e.seq],
        t,
      );
      if (updated.changes === 0) continue;
      const suspended = await run(
        'UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ? AND suspended_at IS NULL',
        [now, reason, e.user_id],
        t,
      );
      await run(
        'INSERT INTO admin_audit (admin_id, target_user_id, action, details) VALUES (NULL, ?, ?, ?)',
        [
          e.user_id,
          'transaction.expire',
          JSON.stringify({ reference: e.ref, type: e.type, amountCents: Number(e.amount_cents), suspended: suspended.changes > 0 }),
        ],
        t,
      );
    }
  });
  console.log(`12-hour deadline passed for ${expired.map((e) => e.ref).join(', ')}; account(s) suspended.`);
  return expired.length;
}
