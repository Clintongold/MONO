# OGFZA Mono Payments — Dashboard

A standalone payment-operations dashboard for OGFZA's direct debit collections
via Mono. This app talks only to its own Supabase project — it does not touch
the cooperative's existing Google Sheets/Apps Script CMS.

## What's real vs. simulated in this build

- **Real**: the database schema, the queries, the four dashboard screens.
- **Simulated**: the "Initiate direct debit" button on the Collection Schedule
  page. It writes a `processing` payment row, then after ~1.4 seconds
  randomly resolves it to `successful` or `failed` (insufficient funds) —
  standing in for what would normally be Mono's webhook callback. This lets
  you demo and test the UI end-to-end before the real Mono integration
  exists.
- **Not yet built**: the backend Edge Function that would call Mono's actual
  debit endpoint, the webhook receiver, and the scheduled retry job for
  insufficient-funds failures. Those need a server-side environment (Supabase
  Edge Functions are a natural fit) because the Mono secret key must never be
  present in this browser-side app.

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

## Seeding demo data

The database starts empty. To populate it with realistic demo data for a
presentation:

1. Open your Supabase project → SQL Editor
2. Paste in the contents of `seed.sql`
3. Run it

It creates 10 members across 5 banks, a mix of mandate statuses, two
collection periods (August fully reconciled, September in progress with
paid/retrying/failed rows), and payment history showing the insufficient-funds
retry pattern. It's safe to re-run — it clears its own rows first.

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

Right now those RLS policies are wide open ("any authenticated user, full
access") — fine for a presentation, not fine for production. Before real
executives and real money are involved, split policies by role (e.g.
Executive: read-only; Payment Administrator: read/write) once Supabase Auth
roles are set up.

The `service_role` key for this project should never appear in this
repository or in any client-side code. It stays in Supabase's own project
settings for later use inside a backend Edge Function only.

## Next steps toward a live system

1. Tighten RLS policies by role
2. Build the Supabase Edge Function that holds the Mono secret key and
   exposes a `debit` action the dashboard calls instead of writing directly
   to the `payments` table
3. Build the Mono webhook receiver (mandate + debit events) writing into
   `webhook_events`, then processing into `payments`/`mandates`
4. Build the scheduled retry job (insufficient-funds only, capped at the
   `max_retries_per_day` on each schedule, stopping at `retry_deadline_date`)
5. Build the CSV export for the Reconciliation page
6. Only then connect real Mono sandbox credentials, and later live credentials
