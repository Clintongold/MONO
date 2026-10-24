# OGFZA Mono Payments — Dashboard

A standalone payment-operations dashboard for OGFZA's direct debit collections
via Mono. This app talks only to its own Supabase project — it does not touch
the cooperative's existing Google Sheets/Apps Script CMS.

## Status of this build

- **Live**: the dashboard reads the cooperative's real members, mandates,
  payments, schedules and reconciliation data from Supabase.
- **Sign-in required**: only people on the `executives` list in the database
  can see anything. A person who has an account but is not on that list sees
  a "Not authorised" screen.
- **Read-only**: the dashboard does not write to the database. Direct debits
  are started from Mono's own dashboard. The Mono webhook (a Supabase Edge
  Function, not part of this repo) records results.
- The old "Initiate direct debit" simulator has been removed. It wrote fake
  payments and must never run against real data.

## Local setup

```bash
npm install
```

Your `.env` file already has the real project URL and anon/publishable key
filled in — it's excluded from git via `.gitignore`, so it won't be committed.
If you're setting this up somewhere fresh, copy `.env.example` to `.env` and
fill in your own values.

```bash
npm run dev
```

## Demo data

The old `seed.sql` demo script was removed on purpose. It deleted every member
whose ID starts with `OGFZACOOP0`, which now matches real members.
Do not recreate it against the live project.

## Signing in

1. In Supabase, open Authentication > Users and create the person's login.
2. Add them to the executives list (run in the SQL editor):

```sql
insert into public.executives (user_id, email)
select id, email from auth.users where lower(email) = lower('person@example.com');
```

To remove access, delete their row from `public.executives`.

## Deploying via GitHub

```bash
git init
git add .
git commit -m "Initial commit: OGFZA Mono payments dashboard"
git branch -M main
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```

Then connect the repo to Vercel or Netlify (both auto-detect Vite projects) —
one thing to do on their end: add the two environment variables
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the platform's project
settings, since `.env` itself never leaves your machine.

## On the Supabase keys

The anon/publishable key in `.env` is meant to be public-facing — that's how
Supabase's client-side model works. Access control is enforced by the Row
Level Security policies on the database, not by keeping this key secret.

Row Level Security allows reading only for people on the `executives` list
(checked by the `is_executive()` database function). Nothing is writable
through the public key.

The `service_role` key for this project should never appear in this
repository or in any client-side code. It stays in Supabase's own project
settings for later use inside a backend Edge Function only.

## Remaining work

1. Per-role access (for example a Payment Administrator who can write)
2. A server-side function that holds the Mono secret key and starts debits
3. The scheduled retry job (insufficient-funds only, capped at
   `max_retries_per_day`, stopping at `retry_deadline_date`)
4. CSV export for the Reconciliation page
