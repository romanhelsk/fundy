# Deploying to Vercel + Turso (free tiers)

The frontend is served by Vercel, the Express API runs as a Vercel Function (`api/index.ts`),
data lives in a Turso database (hosted SQLite / libSQL), and a free external cron service
calls the deadline job every minute.

> **Free-tier caveats.** Vercel's Hobby plan is for personal, non-commercial projects, so use
> it for a demo or staging site; a live client product belongs on Vercel Pro (or similar).
> The payment gateway is still the test gateway: no real money moves.

## 1. Create the Turso database

Easiest (any OS, no install), from the web dashboard:

1. Sign up at [app.turso.tech](https://app.turso.tech) (GitHub sign-in works).
2. **Create Database**, name it `fundy`, pick the region closest to your users.
3. On the database page, copy its **URL** (`libsql://fundy-<org>.turso.io`) → `TURSO_DATABASE_URL`,
   and generate a **token** → `TURSO_AUTH_TOKEN`. Keep the token private.

Or with the Turso **Cloud** CLI (macOS/Linux, or WSL on Windows). Note: the `turso`
program that opens a `turso>` prompt is the Turso *database engine's* SQL shell, not
this CLI, so it won't understand `auth` or `db` commands.

```bash
turso auth signup
turso db create fundy
turso db show fundy --url          # → TURSO_DATABASE_URL
turso db tokens create fundy       # → TURSO_AUTH_TOKEN
```

The app creates its tables on the first request (migrations run automatically).

*Optional: start from your local data instead of an empty database.* Turso can create a
database from a SQLite file (check `turso db create --help` for the current flag, e.g.
`--from-file data/fundy.db`). That copies the local test accounts too, so change or remove
them before sharing the site.

## 2. Set up email for sign-in codes

Sign-in codes must be emailed in production (the app refuses to print them to logs).

1. Create a free account at [Resend](https://resend.com) and an API key → `RESEND_API_KEY`.
2. Verify a domain you own and pick a sender, e.g. `Funds <no-reply@yourdomain.com>` → `MAIL_FROM`.
   (Without a verified domain, Resend's test sender can only email your own address.)

## 3. Deploy on Vercel

1. In Vercel, **Add New → Project** and import the GitHub repo. The settings come from
   `vercel.json` (Vite build, output `dist`, `/api/*` routed to the function).
2. Add these **Environment Variables** (Production, and Preview if you use previews):

| Variable | Value |
| --- | --- |
| `TURSO_DATABASE_URL` | from step 1 |
| `TURSO_AUTH_TOKEN` | from step 1 |
| `RESEND_API_KEY` | from step 2 |
| `MAIL_FROM` | from step 2 |
| `CRON_SECRET` | a long random string (e.g. `openssl rand -hex 32`) |
| `BOOTSTRAP_ADMIN_EMAIL` | your email: the first admin account |
| `BOOTSTRAP_ADMIN_PASSWORD` | a long temporary password |
| `APP_ORIGIN` | only if you add a custom domain, e.g. `https://funds.yourdomain.com` |

Vercel's own URLs are allowed automatically, cookies are `Secure`, and the demo accounts
are **not** created in production (`SEED_DEMO_USER` defaults to off).

3. Deploy.

## 4. First sign-in

**Option A, from your computer (no bootstrap variables needed):** with the Turso URL and
token in your local `.env`, run:

```powershell
npm run create-admin -- you@yourcompany.com "Your Name"
```

It prints a temporary password once. Sign in on the deployed site with it, enter the
emailed code, and set your own password. Use the same command later to add more admins.

If your computer can't reach Turso (e.g. `ENOTFOUND`, a DNS problem on your network),
use the offline variant: nothing connects, and it prints an `INSERT` statement to paste
into the Turso dashboard's SQL console instead.

```powershell
npm run create-admin:sql -- you@yourcompany.com "Your Name"
```

**Option B, bootstrap variables in Vercel:**

1. Open the site and sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`.
2. Enter the code from your email, then set your own password (required).
3. Remove `BOOTSTRAP_ADMIN_PASSWORD` from Vercel's environment variables. It is only used
   while no admin exists, and stops working once you've changed the password.
4. Create clients from the admin console.

## 5. Schedule the deadline job (every minute)

Pending deposits, credits and withdrawals fail after 12 hours and suspend the account.
The app enforces this whenever someone loads a balance, but a scheduled call makes it
happen on time for accounts nobody is looking at.

Vercel's free cron only runs once a day (`vercel.json` includes a daily run as a backup).
For every-minute checks, use a free external service such as [cron-job.org](https://cron-job.org):

- **URL:** `https://<your-app>.vercel.app/api/cron/enforce-deadlines`
- **Method:** GET, every 1 minute
- **Header:** `Authorization: Bearer <CRON_SECRET>`

A successful call returns `{"ok":true,"expired":0}`.

## Local development (unchanged)

```powershell
npm install
npm run dev
```

Locally the API uses `data/fundy.db` (a SQLite file), seeds the test accounts from
`server/seed.ts`, prints sign-in codes in the terminal, and runs the deadline job every
minute by itself. Settings are listed in `.env.example`; copy it to `.env` to change them.
