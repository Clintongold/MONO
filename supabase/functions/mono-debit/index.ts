// mono-debit: starts Mono direct debits for approved schedules.
//
// Two ways in (verify_jwt is OFF because the scheduler has no user token; this
// function authenticates every caller itself):
//   1. Scheduler:  header x-cron-token == secret CRON_TOKEN. Runs the debit slot.
//   2. Executive:  Authorization: Bearer <user token>, body {schedule_id}.
//                  Starts ONE manual debit right now. The amount is never taken
//                  from the request: it is worked out here from the schedule row.
//
// Safety rules:
//   - Nothing runs unless debit_settings.debits_enabled is true.
//   - Only schedules of an APPROVED batch, inside its debit window, are touched.
//   - A payment row is written BEFORE Mono is called, so the webhook can match it.
//   - Never starts a second debit while one is still 'processing'.
//   - Only insufficient-funds failures (code 51) are retried automatically.
//   - At most 4 attempts per MANDATE per day, counting every schedule on it
//     (monthly schedule and one-off debits together).
//   - Success is never decided here: only Mono's final webhook credits money.

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const MONO_KEY = Deno.env.get("MONO_SECRET_KEY") ?? "";
const CRON_TOKEN = Deno.env.get("CRON_TOKEN") ?? "";
const MONO_BASE = "https://api.withmono.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const RETRYABLE = ["insufficient_funds"];
// Hard ceiling, whatever the settings say.
const MAX_ATTEMPTS_PER_MANDATE_PER_DAY = 4;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
function safeEqual(a: string, b: string) {
  const e = new TextEncoder(), x = e.encode(a), y = e.encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
// Lagos is UTC+1 all year (no daylight saving).
function lagosNow() {
  const l = new Date(Date.now() + 3600_000);
  return {
    hour: l.getUTCHours(),
    date: l.toISOString().slice(0, 10),
    startOfDayUtc: new Date(Date.parse(l.toISOString().slice(0, 10) + "T00:00:00Z") - 3600_000).toISOString(),
    startOfHourUtc: new Date(Math.floor(Date.now() / 3600_000) * 3600_000).toISOString(),
  };
}

type Outcome = { schedule_id: string; result: string };

async function attempt(s: any, nowL: ReturnType<typeof lagosNow>, opts: { first_only: boolean; enforce_hour_lock: boolean; max_per_day: number }): Promise<Outcome> {
  const out = (result: string): Outcome => ({ schedule_id: s.id, result });
  const maxPerDay = Math.min(opts.max_per_day, MAX_ATTEMPTS_PER_MANDATE_PER_DAY);
  const remaining = Number(s.total_expected) - Number(s.total_collected);
  if (!(remaining > 0)) return out("nothing outstanding");

  const { data: pays, error: pe } = await supabase.from("payments")
    .select("id,status,failure_category,attempted_at").eq("schedule_id", s.id).order("attempted_at", { ascending: false });
  if (pe) return out("db error reading payments");
  if (pays!.some((p) => p.status === "processing")) return out("skipped: a debit is still processing");
  if (opts.first_only && pays!.length > 0) return out("skipped: already attempted");
  const last = pays![0];
  if (last && last.status === "failed" && !RETRYABLE.includes(last.failure_category ?? "")) {
    return out("skipped: last failure is not retryable (" + (last.failure_category ?? "unknown") + ")");
  }

  // Daily cap per MANDATE: every attempt today on this mandate counts, from any schedule.
  const { count: todays, error: ce } = await supabase.from("payments")
    .select("id", { count: "exact", head: true }).eq("mandate_id", s.mandate_id).gte("attempted_at", nowL.startOfDayUtc);
  if (ce) return out("db error counting today's attempts");
  if ((todays ?? 0) >= maxPerDay) return out("skipped: daily attempt limit reached for this mandate");

  const { data: m } = await supabase.from("mandates")
    .select("id,mono_mandate_id,status,ready_to_debit,member_id").eq("id", s.mandate_id).maybeSingle();
  if (!m || !m.ready_to_debit || !["approved", "reinstated"].includes(m.status)) return out("skipped: mandate not ready");
  if (m.member_id !== s.member_id) return out("skipped: mandate belongs to another member");

  // Lock: one atomic update decides which caller may start an attempt for this schedule.
  // A second click or an overlapping run finds last_attempt_at too recent and stops.
  const lockBefore = opts.enforce_hour_lock ? nowL.startOfHourUtc : new Date(Date.now() - 60_000).toISOString();
  const { data: locked } = await supabase.from("payment_schedules")
    .update({ last_attempt_at: new Date().toISOString() })
    .eq("id", s.id).or(`last_attempt_at.is.null,last_attempt_at.lt.${lockBefore}`).select("id");
  if (!locked || locked.length === 0) return out("skipped: already attempted this slot");

  // Letters and numbers only (Mono rejects anything else), short and unique, 17 characters:
  // OGZ + 12 characters of the schedule id + a 2-digit attempt number.
  const reference = `OGZ${String(s.id).replace(/-/g, "").slice(0, 12)}${String(pays!.length + 1).padStart(2, "0")}`;

  const { data: pay, error: ie } = await supabase.from("payments").insert({
    member_id: s.member_id, schedule_id: s.id, mandate_id: m.id, mono_mandate_id: m.mono_mandate_id,
    mono_reference: reference, amount: remaining, status: "processing", attempted_at: new Date().toISOString(),
  }).select("id").single();
  if (ie) return out("skipped: could not record attempt");

  let res: Response | null = null;
  let body: any = null;
  try {
    res = await fetch(`${MONO_BASE}/v3/payments/mandates/${m.mono_mandate_id}/debit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json", "mono-sec-key": MONO_KEY },
      // Naira to kobo, from the amount worked out above (never from the browser).
      body: JSON.stringify({ amount: Math.round(remaining * 100), reference, narration: `OGFZA Cooperative deduction ${String(s.period).slice(0, 7)}` }),
    });
    body = await res.json().catch(() => null);
  } catch (_e) {
    // Outcome unknown: leave the payment 'processing' so we never double-debit.
    await supabase.from("payments").update({ failure_reason: "request error: outcome unconfirmed, check Mono" }).eq("id", pay.id);
    return out("unconfirmed (network error), left as processing");
  }

  const note = JSON.stringify({ http: res.status, status: body?.status ?? null, message: body?.message ?? null, data_status: body?.data?.status ?? null }).slice(0, 500);
  await supabase.from("audit_logs").insert({ actor: "mono-debit", action: "debit_initiated", record_type: "payment", record_id: pay.id, details: { reference, amount: remaining, response: note } });

  if (res.ok) {
    if (body?.data?.id) await supabase.from("payments").update({ mono_transaction_id: String(body.data.id) }).eq("id", pay.id);
    return out("initiated, waiting for Mono's final webhook");
  }
  if (res.status >= 400 && res.status < 500) {
    await supabase.from("payments").update({ status: "failed", failure_category: "api_rejected", failure_reason: String(body?.message ?? "rejected by Mono").slice(0, 300) }).eq("id", pay.id);
    await supabase.from("payment_schedules").update({ status: "failed" }).eq("id", s.id).eq("status", "pending");
    return out("rejected by Mono: " + (body?.message ?? res.status));
  }
  await supabase.from("payments").update({ failure_reason: `Mono returned ${res.status}: outcome unconfirmed, check Mono` }).eq("id", pay.id);
  return out("unconfirmed (Mono " + res.status + "), left as processing");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ message: "Method not allowed" }, 405);
  if (!MONO_KEY) return json({ message: "MONO_SECRET_KEY not set" }, 500);

  const { data: st } = await supabase.from("debit_settings").select("*").maybeSingle();
  if (!st) return json({ message: "settings missing" }, 500);
  const nowL = lagosNow();

  const cron = req.headers.get("x-cron-token") ?? "";
  const isCron = CRON_TOKEN !== "" && safeEqual(cron, CRON_TOKEN);

  // ---------------------------------------------------- executive: one manual debit now
  if (!isCron) {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ message: "Unauthorized" }, 401);
    const { data: u } = await supabase.auth.getUser(jwt);
    if (!u?.user) return json({ message: "Unauthorized" }, 401);
    const { data: ex } = await supabase.from("executives").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!ex) return json({ message: "Not authorised" }, 403);
    if (!st.debits_enabled) return json({ message: "Debits are switched off. Turn them on first." }, 409);

    const body = await req.json().catch(() => ({}));
    if (!body?.schedule_id) return json({ message: "schedule_id required" }, 400);
    const { data: s } = await supabase.from("payment_schedules")
      .select("*, batch:schedule_batches!inner(status)").eq("id", body.schedule_id).eq("kind", "manual").maybeSingle();
    if (!s || (s as any).batch.status !== "approved") return json({ message: "No approved manual debit with that id" }, 404);
    if (nowL.date < s.initiation_date || nowL.date > s.retry_deadline_date) {
      return json({ message: "This one-off debit's window has passed. Create a new one." }, 409);
    }
    const r = await attempt(s, nowL, { first_only: true, enforce_hour_lock: false, max_per_day: st.attempts_per_day });
    return json(r);
  }

  // ---------------------------------------------------- scheduler slot
  if (!st.debits_enabled) return json({ skipped: "debits are switched off" });
  const slots: number[] = (st.retry_hours as number[]).slice(0, st.attempts_per_day);
  if (!slots.includes(nowL.hour)) return json({ skipped: `hour ${nowL.hour} is not a debit hour`, slots });

  // Past-window batches are closed so last month can never run again.
  await supabase.from("schedule_batches").update({ status: "closed" }).eq("status", "approved").lt("window_end", nowL.date);

  const { data: due, error } = await supabase.from("payment_schedules")
    .select("*, batch:schedule_batches!inner(status)")
    .eq("batch.status", "approved")
    .lte("initiation_date", nowL.date).gte("retry_deadline_date", nowL.date)
    .in("status", ["pending", "failed"]);
  if (error) return json({ message: "query failed" }, 500);

  const results: Outcome[] = [];
  for (const s of due ?? []) {
    if (s.kind === "manual" && !s.auto_retry) continue; // manual one-shots run only on demand
    results.push(await attempt(s, nowL, { first_only: false, enforce_hour_lock: true, max_per_day: st.attempts_per_day }));
  }
  const tally: Record<string, number> = {};
  for (const r of results) tally[r.result.split(":")[0]] = (tally[r.result.split(":")[0]] ?? 0) + 1;
  return json({ ran: nowL.hour, considered: results.length, tally });
});
