import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'fundy.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    email                 TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name                  TEXT NOT NULL,
    password_hash         TEXT NOT NULL,
    opening_balance_cents INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL,
    persistent  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mfa_challenges (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    sent_at     INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    remember    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('bank', 'card')),
    label       TEXT NOT NULL,
    long_label  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    ref           TEXT UNIQUE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('Deposit', 'Withdrawal')),
    method_id     TEXT NOT NULL REFERENCES payment_methods(id),
    status        TEXT NOT NULL CHECK (status IN ('Pending', 'Completed', 'Failed')),
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    error_code    TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS tx_user_date ON transactions (user_id, date DESC, seq DESC);
`);

/** Runs fn inside a transaction. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- Migrations (tracked with PRAGMA user_version) ----------
const migrations: string[] = [
  // 1: roles, admin balance adjustments, soft-removed payment methods, audit log
  `
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'admin'));
  ALTER TABLE payment_methods ADD COLUMN removed_at TEXT;

  CREATE TABLE transactions_v1 (
    seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    ref           TEXT UNIQUE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('Deposit', 'Withdrawal', 'Credit', 'Debit')),
    method_id     TEXT REFERENCES payment_methods(id),
    status        TEXT NOT NULL CHECK (status IN ('Pending', 'Completed', 'Failed')),
    amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
    error_code    TEXT,
    note          TEXT,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (type IN ('Credit', 'Debit') OR method_id IS NOT NULL)
  );
  INSERT INTO transactions_v1 (seq, ref, user_id, date, type, method_id, status, amount_cents, error_code, created_at)
    SELECT seq, ref, user_id, date, type, method_id, status, amount_cents, error_code, created_at FROM transactions;
  DROP TABLE transactions;
  ALTER TABLE transactions_v1 RENAME TO transactions;
  CREATE INDEX tx_user_date ON transactions (user_id, date DESC, seq DESC);

  CREATE TABLE admin_audit (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id        INTEGER NOT NULL REFERENCES users(id),
    target_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    details         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 2: force a password change on first sign-in for accounts created with a temporary password
  `
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
  UPDATE users SET must_change_password = 1
    WHERE id IN (SELECT target_user_id FROM admin_audit WHERE action = 'user.create');
  `,
  // 3: 12-hour transfer deadline for pending money-in, account suspension,
  //    and audit entries written by the system (admin_id NULL)
  `
  ALTER TABLE users ADD COLUMN suspended_at TEXT;
  ALTER TABLE users ADD COLUMN suspended_reason TEXT;
  ALTER TABLE transactions ADD COLUMN due_at TEXT;
  -- Existing pending items get a fresh clock from now, so nobody is suspended on upgrade.
  UPDATE transactions SET due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+12 hours')
    WHERE status = 'Pending' AND type IN ('Deposit', 'Credit');
  CREATE INDEX tx_pending_due ON transactions (status, due_at);

  CREATE TABLE admin_audit_v3 (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id        INTEGER REFERENCES users(id),
    target_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    details         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO admin_audit_v3 (id, admin_id, target_user_id, action, details, created_at)
    SELECT id, admin_id, target_user_id, action, details, created_at FROM admin_audit;
  DROP TABLE admin_audit;
  ALTER TABLE admin_audit_v3 RENAME TO admin_audit;
  `,
];

const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
for (let v = current; v < migrations.length; v++) {
  tx(() => {
    db.exec(migrations[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  });
  console.log(`Applied database migration ${v + 1}`);
}
