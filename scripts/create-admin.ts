// Creates an admin account in the database configured in .env (local file or Turso).
//
//   npm run create-admin -- you@company.com "Your Name"
//
// Prints a temporary password once. The admin must set their own password at
// first sign-in (after the emailed verification code).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: defaults (local file database) apply.
}

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim() || 'Admin';

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run create-admin -- <email> "<Full name>"');
  process.exit(1);
}

const { config } = await import('../server/config.js');
const { migrate, get, run } = await import('../server/db.js');
const { hashPassword, randomToken } = await import('../server/crypto.js');

const target = config.databaseUrl.split('?')[0];
await migrate();

const existing = await get<{ role: string }>('SELECT role FROM users WHERE email = ?', [email.toLowerCase()]);
if (existing) {
  console.error(`${email} already exists (role: ${existing.role}) in ${target}. Nothing changed.`);
  process.exit(1);
}

const temporaryPassword = randomToken(12);
await run("INSERT INTO users (email, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'admin', 1)", [
  email.toLowerCase(),
  name,
  await hashPassword(temporaryPassword),
]);

console.log(`
Admin created in ${target}
  Email:              ${email.toLowerCase()}
  Name:               ${name}
  Temporary password: ${temporaryPassword}

Sign in with it, enter the emailed code, then set your own password.
This password is not stored anywhere else; copy it now.
`);
process.exit(0);
