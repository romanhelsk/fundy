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
