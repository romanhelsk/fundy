// Creates an admin account in the database configured in .env (local file or Turso).
//
//   npm run create-admin -- you@company.com "Your Name"
//
// Offline mode: doesn't connect to any database. Prints a SQL statement to paste
// into Turso's SQL console (useful when your network can't reach Turso directly):
//
//   npm run create-admin -- --sql you@company.com "Your Name"
//
// Either way it prints a temporary password once. The admin must set their own
// password at first sign-in (after the emailed verification code).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: defaults (local file database) apply.
}

const args = process.argv.slice(2);
const sqlMode = args.includes('--sql');
const [email, ...nameParts] = args.filter((a) => a !== '--sql');
const name = nameParts.join(' ').trim() || 'Admin';

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run create-admin -- [--sql] <email> "<Full name>"');
  process.exit(1);
}

const { hashPassword, randomToken } = await import('../server/crypto.js');
const temporaryPassword = randomToken(12);
const passwordHash = await hashPassword(temporaryPassword);
const normalizedEmail = email.toLowerCase();

const credentials = `  Email:              ${normalizedEmail}
  Name:               ${name}
  Temporary password: ${temporaryPassword}`;
const nextSteps = `Sign in with it, enter the emailed code, then set your own password.
This password is not stored anywhere else; copy it now.`;

if (sqlMode) {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  console.log(`
Paste this into your database's SQL console (Turso dashboard → your database → Edit Data → SQL console):

INSERT INTO users (email, name, password_hash, role, must_change_password)
VALUES (${q(normalizedEmail)}, ${q(name)}, ${q(passwordHash)}, 'admin', 1);

Once it runs, the admin can sign in with:
${credentials}

${nextSteps}
(The app must have started once against that database so the tables exist.)
`);
  process.exit(0);
}

const { config } = await import('../server/config.js');
const { migrate, get, run } = await import('../server/db.js');
const target = config.databaseUrl.split('?')[0];

try {
  await migrate();
} catch (err) {
  const cause = (err as { cause?: { code?: string } }).cause;
  if (cause?.code === 'ENOTFOUND' || cause?.code === 'ECONNREFUSED' || cause?.code === 'ETIMEDOUT') {
    console.error(`Can't reach ${target} (${cause.code}).
Your network or DNS can't connect to the database. Either fix that and retry, or use
offline mode and paste the SQL into Turso's SQL console:

  npm run create-admin -- --sql ${normalizedEmail} "${name}"`);
    process.exit(1);
  }
  throw err;
}

const existing = await get<{ role: string }>('SELECT role FROM users WHERE email = ?', [normalizedEmail]);
if (existing) {
  console.error(`${normalizedEmail} already exists (role: ${existing.role}) in ${target}. Nothing changed.`);
  process.exit(1);
}

await run("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'admin', 1)", [
  normalizedEmail,
  name,
  passwordHash,
]);

console.log(`
Admin created in ${target}
${credentials}

${nextSteps}
`);
process.exit(0);
