# OGFZA Mono Payments — Dashboard

A standalone payment-operations dashboard for OGFZA's direct debit collections
via Mono. This app talks only to its own Supabase project — it does not touch
the cooperative's existing Google Sheets/Apps Script CMS.

## What this app does today

- **Live data**: the dashboard reads the cooperative's real members, mandates,
  payments, schedules and reconciliation data from Supabase.
- **Sign-in required**: only people on the `executives` list in the database
  can see or do anything. A person who has an account but is not on that list
  sees a "Not authorised" screen.
- **Reads are open to every executive; writes go through checked database
  functions.** The browser can only read tables. Every change (upload,
  approve, cancel, debit switch, one-off debit) is a database function that
  checks `is_executive()` itself.
- **Monthly schedule page**: upload the month's CSV from the ledger's
  PAYROLL_CURRENT tab (any row order), preview who will be debited, who is
  discarded (no ready mandate, inactive member, nothing to debit) and which
  rows have problems, then approve. Only the approved upload is ever debited,
  and only inside that month's debit window.
- **Debit switch**: a master on/off switch. Debits are OFF until an executive
  turns them on.
- **One-off debit**: debit one member any amount straight away, with an
  optional auto-retry. A one-off that was recorded but not started shows a
  "Start debit" button in the Progress table.
- **Create mandate**: registers the member as a Mono customer (if needed) and
  creates a variable e-mandate, then shows Mono's authorisation link to send to
  the member. The mandate is saved already linked to the member's internal ID.
- **Collection schedule, Mandates, Reconciliation, Overview**: read-only views
  of the results.

### Server side (Supabase Edge Functions, in `supabase/functions/`)

- `mono-webhook`: receives Mono's webhooks and records mandates, debits and
  results. (Not in this repo.)
- `mono-debit`: starts debits. Run hourly by the scheduler (acts only at the
  debit hours, 10:00, 14:00, 18:00 and 21:00 Lagos time) and on demand for
  one-off debits. Only insufficient-funds failures are retried. At most 4
  attempts per mandate per day. The amount comes from the schedule row, never
  from the browser.
- `mono-mandate`: creates the Mono customer and mandate.
- `mono-import`: one-time member import. To be deleted or its token rotated.
- Scheduler: a database job (`pg_cron`) calls `mono-debit` at the top of every
  hour. A GitHub workflow pings the database every 3 days to stop the project
  pausing.

All dates and times are handled in Lagos time (Africa/Lagos).

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

1. Mono Sweep mandates (waiting on Mono to confirm Sweep is enabled).
2. Per-member fee payer (the form has the choice; waiting on Mono to confirm
   `fee_bearer: customer` works on our account).
3. Per-role access (for example read-only executives who cannot approve or
   debit). Today every executive can do everything.
4. Multi-factor sign-in for executives (not set up).
5. CSV export for the Reconciliation page.
6. Delete or rotate the `mono-import` function.
