import { createTestPaymentMethods } from './auth.js';
import { config } from './config.js';
import { hashPassword } from './crypto.js';
import { all, get, run, tx } from './db.js';

/**
 * Local test accounts. Created on startup when seeding is on: by default in
 * development, never in production unless SEED_DEMO_USER=true.
 */
export const DEMO_USER = {
  email: 'demo@fundy.test',
  password: 'fundy-demo-2026',
  name: 'Alex Carter',
};

export const ADMIN_USER = {
  email: 'admin@fundy.test',
  password: 'fundy-admin-2026',
  name: 'Fundy Admin',
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
  await bootstrapAdmin();
  if (!config.seedDemoUsers) return;

  if (!(await get('SELECT 1 FROM users WHERE email = ?', [ADMIN_USER.email]))) {
    await run("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'admin')", [
      ADMIN_USER.email,
      ADMIN_USER.name,
      await hashPassword(ADMIN_USER.password),
    ]);
    console.log(`Seeded test admin ${ADMIN_USER.email} (password in server/seed.ts)`);
  }
  if (await get('SELECT 1 FROM users WHERE email = ?', [DEMO_USER.email])) return;

  const passwordHash = await hashPassword(DEMO_USER.password);
  const net = DEMO_TX.reduce((sum, t) => {
    if (t.status !== 'Completed') return sum;
    return sum + (t.type === 'Deposit' ? t.cents : -t.cents);
  }, 0);
  const dueAt = new Date(Date.now() + config.transferWindowMs).toISOString();

  await tx(async (t) => {
    const { lastInsertRowid: userId } = await run(
      'INSERT INTO users (email, name, password_hash, opening_balance_cents) VALUES (?, ?, ?, ?)',
      [DEMO_USER.email, DEMO_USER.name, passwordHash, DEMO_AVAILABLE_CENTS - net],
      t,
    );
    await createTestPaymentMethods(userId, { bank: '4417', card: '0932' }, t);
    const methods = await all<{ id: string; kind: string }>('SELECT id, kind FROM payment_methods WHERE user_id = ?', [userId], t);
    const methodId = (kind: string) => methods.find((m) => m.kind === kind)!.id;

    for (const d of [...DEMO_TX].reverse()) {
      await run(
        `INSERT INTO transactions (ref, user_id, date, type, method_id, status, amount_cents, error_code, due_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [d.ref, userId, d.date, d.type, methodId(d.method), d.status, d.cents, 'error' in d ? d.error : null, d.status === 'Pending' ? dueAt : null],
        t,
      );
    }
  });
  console.log(`Seeded test account ${DEMO_USER.email} (password in server/seed.ts)`);
}

/**
 * Production bootstrap: if BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD are
 * set and there is no admin yet, create one. They must set a new password at
 * first sign-in, so the env value stops working after that.
 */
async function bootstrapAdmin() {
  const admin = config.bootstrapAdmin;
  if (!admin) return;
  if (await get("SELECT 1 FROM users WHERE role = 'admin'")) return;
  await run("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'admin', 1)", [
    admin.email.toLowerCase(),
    admin.name,
    await hashPassword(admin.password),
  ]);
  console.log(`Created first admin ${admin.email} (must set a new password at first sign-in)`);
}
