import { createClient, type InArgs, type InValue, type Transaction } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// ---------- Connection ----------
if (config.databaseUrl.startsWith('file:')) {
  mkdirSync(path.dirname(path.resolve(config.databaseUrl.slice('file:'.length))), { recursive: true });
}

export const db = createClient({ url: config.databaseUrl, authToken: config.databaseAuthToken });

/** Anything that can run a statement: the shared client or an open transaction. */
export interface Executor {
  execute: Transaction['execute'];
}

type Row = Record<string, unknown>;

/** Runs a query and returns plain row objects keyed by column name. */
export async function all<T = Row>(sql: string, args: InValue[] = [], ex: Executor = db): Promise<T[]> {
  const rs = await ex.execute({ sql, args: args as InArgs });
  return rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]))) as T[];
}

export async function get<T = Row>(sql: string, args: InValue[] = [], ex: Executor = db): Promise<T | undefined> {
  return (await all<T>(sql, args, ex))[0];
}

export async function run(sql: string, args: InValue[] = [], ex: Executor = db) {
  const rs = await ex.execute({ sql, args: args as InArgs });
  return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
}

/** Runs fn inside a write transaction; rolls back if it throws. */
export async function tx<T>(fn: (t: Transaction) => Promise<T>): Promise<T> {
  const t = await db.transaction('write');
  try {
    const result = await fn(t);
    await t.commit();
    return result;
  } catch (err) {
    await t.rollback().catch(() => undefined);
    throw err;
  } finally {
    t.close();
  }
}

// ---------- Schema ----------
const BASE_SCHEMA = `
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
`;

/** Ordered migrations; each runs once, in a transaction, and is recorded in schema_migrations. */
const MIGRATIONS: string[] = [
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
  // 3: 12-hour deadline for pending transactions, account suspension,
  //    and audit entries written by the system (admin_id NULL)
  `
  ALTER TABLE users ADD COLUMN suspended_at TEXT;
  ALTER TABLE users ADD COLUMN suspended_reason TEXT;
  ALTER TABLE transactions ADD COLUMN due_at TEXT;
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
  // 4: failed-login throttling in the database (works across serverless instances)
  `
  CREATE TABLE login_failures (
    key       TEXT PRIMARY KEY,
    count     INTEGER NOT NULL,
    first_at  INTEGER NOT NULL
  );
  `,
];

async function appliedVersion(): Promise<number> {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = await get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  if (row?.v) return Number(row.v);

  // Databases created before this table existed tracked their version in PRAGMA user_version.
  let legacy = 0;
  try {
    legacy = Number((await get<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0);
  } catch {
    legacy = 0;
  }
  for (let v = 1; v <= legacy; v++) {
    await run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))", [v]);
  }
  return legacy;
}

/** Creates the schema and applies pending migrations. Safe to call on every cold start. */
export async function migrate() {
  if (config.databaseUrl.startsWith('file:')) {
    await db.execute('PRAGMA journal_mode = WAL').catch(() => undefined);
  }
  await db.execute('PRAGMA foreign_keys = ON').catch(() => undefined);
  await db.executeMultiple(BASE_SCHEMA);

  const current = await appliedVersion();
  for (let v = current; v < MIGRATIONS.length; v++) {
    const t = await db.transaction('write');
    try {
      await t.executeMultiple(MIGRATIONS[v]);
      await t.execute({ sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))", args: [v + 1] });
      await t.commit();
      console.log(`Applied database migration ${v + 1}`);
    } catch (err) {
      await t.rollback().catch(() => undefined);
      throw err;
    } finally {
      t.close();
    }
  }
}
