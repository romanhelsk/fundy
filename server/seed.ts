import { createTestPaymentMethods } from './auth.ts';
import { hashPassword } from './crypto.ts';
import { db, tx } from './db.ts';

/**
 * Local test account, created on first start. Change or remove before any
 * shared deployment (set SEED_DEMO_USER=false).
 */
export const DEMO_USER = {
  email: 'demo@fundy.test',
  password: 'fundy-demo-2026',
  name: 'Alex Carter',
};

// The design's demo figures: available $1,248,309.57 with these 7 recent rows.
const DEMO_TX = [
  { ref: 'TX-80412', date: '2026-11-18', type: 'Deposit', method: 'bank', status: 'Pending', cents: 1_245_000 },
  { ref: 'TX-80377', date: '2026-11-15', type: 'Withdrawal', method: 'bank', status: 'Completed', cents: 800_000 },
  { ref: 'TX-80321', date: '2026-11-12', type: 'Deposit', method: 'card', status: 'Failed', cents: 500_000, error: 'CARD_DECLINED' },
  { ref: 'TX-80290', date: '2026-11-10', type: 'Deposit', method: 'bank', status: 'Completed', cents: 2_500_000 },
  { ref: 'TX-80211', date: '2026-11-06', type: 'Withdrawal', method: 'bank', status: 'Completed', cents: 1_567_540 },
  { ref: 'TX-80158', date: '2026-11-03', type: 'Deposit', method: 'card', status: 'Completed', cents: 920_000 },
  { ref: 'TX-80102', date: '2026-11-01', type: 'Withdrawal', method: 'bank', status: 'Completed', cents: 800_000 },
] as const;
const DEMO_AVAILABLE_CENTS = 124_830_957;

export async function seed() {
  if (process.env.SEED_DEMO_USER === 'false') return;
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(DEMO_USER.email)) return;

  const passwordHash = await hashPassword(DEMO_USER.password);
  const net = DEMO_TX.reduce((sum, t) => {
    if (t.status !== 'Completed') return sum;
    return sum + (t.type === 'Deposit' ? t.cents : -t.cents);
  }, 0);

  tx(() => {
    const userId = Number(
      db
        .prepare('INSERT INTO users (email, name, password_hash, opening_balance_cents) VALUES (?, ?, ?, ?)')
        .run(DEMO_USER.email, DEMO_USER.name, passwordHash, DEMO_AVAILABLE_CENTS - net).lastInsertRowid,
    );
    createTestPaymentMethods(userId, { bank: '4417', card: '0932' });
    const methods = db.prepare('SELECT id, kind FROM payment_methods WHERE user_id = ?').all(userId) as unknown as {
      id: string;
      kind: string;
    }[];
    const methodId = (kind: string) => methods.find((m) => m.kind === kind)!.id;

    const insert = db.prepare(
      `INSERT INTO transactions (ref, user_id, date, type, method_id, status, amount_cents, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const t of [...DEMO_TX].reverse()) {
      insert.run(t.ref, userId, t.date, t.type, methodId(t.method), t.status, t.cents, 'error' in t ? t.error : null);
    }
  });
  console.log(`Seeded test account ${DEMO_USER.email} (password in server/seed.ts)`);
}
