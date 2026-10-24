// mono-mandate: creates a Mono customer (if needed) and a variable e-mandate for
// a member, and returns Mono's authorisation link (mono_url) to send to them.
//
// Auth: executive only (Authorization: Bearer <user token>); verify_jwt is OFF so
// this function checks the token itself against the executives list.
// The mandate row is saved with member_id already set, so Mono's webhooks update
// the same row and nobody types an internal ID again.
//
// Body: {
//   member_id (uuid), first_name, last_name, email, phone,
//   amount (naira, TOTAL collectable over the whole mandate period),
//   start_date (YYYY-MM-DD), end_date (YYYY-MM-DD),
//   fee_bearer? ("business" | "customer"), existing_customer_id?, new_customer?, address?, force?
// }

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const MONO_KEY = Deno.env.get("MONO_SECRET_KEY") ?? "";
const MONO_BASE = "https://api.withmono.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const OPEN_STATUSES = ["initiated", "approved", "reinstated", "paused"];

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
const fail = (message: string, status = 400, extra: Record<string, unknown> = {}) => json({ ok: false, message, ...extra }, status);

async function mono(path: string, body: unknown) {
  const res = await fetch(MONO_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json", "mono-sec-key": MONO_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { res, data };
}
const monoMessage = (d: any, fallback: string) => String(d?.message ?? d?.error ?? fallback).slice(0, 300);
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("Method not allowed", 405);
  if (!MONO_KEY) return fail("MONO_SECRET_KEY not set", 500);

  // ---- who is calling: must be an executive
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail("Unauthorized", 401);
  const { data: u } = await supabase.auth.getUser(jwt);
  if (!u?.user) return fail("Unauthorized", 401);
  const { data: ex } = await supabase.from("executives").select("email").eq("user_id", u.user.id).maybeSingle();
  if (!ex) return fail("Not authorised", 403);

  // ---- validate input
  const b = await req.json().catch(() => ({}));
  const first = String(b.first_name ?? "").trim();
  const last = String(b.last_name ?? "").trim();
  const email = String(b.email ?? "").trim();
  const phone = String(b.phone ?? "").trim();
  const amountNaira = Number(b.amount);
  if (!b.member_id) return fail("Pick a member.");
  if (!first || !last) return fail("First and last name are required.");
  if (!email) return fail("The member needs an email address (Mono sends the link there too).");
  if (!phone) return fail("The member needs a phone number.");
  if (!(amountNaira > 0)) return fail("Enter the total mandate amount.");
  if (!isDate(b.start_date) || !isDate(b.end_date) || b.end_date <= b.start_date) {
    return fail("Start and end dates must be valid, with the end after the start.");
  }
  const feeBearer = b.fee_bearer === "customer" ? "customer" : "business";

  const { data: member } = await supabase.from("members")
    .select("id, ogfza_member_id, full_name, mono_customer_id, status").eq("id", b.member_id).maybeSingle();
  if (!member) return fail("Member not found.", 404);
  if (member.status !== "active") return fail(`Member is ${member.status}.`);

  if (!b.force) {
    const { data: open } = await supabase.from("mandates").select("status").eq("member_id", member.id).in("status", OPEN_STATUSES);
    if (open && open.length > 0) {
      return fail(`This member already has a mandate (${open[0].status}). Confirm to create another.`, 409, { needs_force: true });
    }
  }

  // ---- 1. customer
  let customerId: string | null = (b.existing_customer_id ? String(b.existing_customer_id).trim() : "") || (b.new_customer ? null : member.mono_customer_id) || null;
  if (!customerId) {
    const address = String(b.address ?? "").trim();
    if (!address) return fail("Mono requires an address to register a new customer. Fill in the address box.", 400, { stage: "customer" });
    const { res, data } = await mono("/v2/customers", {
      type: "individual", first_name: first, last_name: last, email, phone, address,
    });
    if (!res.ok) {
      const already = /already exist/i.test(String(data?.message ?? ""));
      return fail(
        already
          ? "Mono says this customer already exists. Copy their customer ID from Mono's dashboard (Customers) and paste it into the form."
          : "Mono could not create the customer: " + monoMessage(data, `HTTP ${res.status}`),
        res.status === 401 ? 502 : 400,
        { stage: "customer", needs_customer_id: already },
      );
    }
    customerId = data?.data?.id ?? data?.data?._id ?? data?.id ?? null;
    if (!customerId) {
      // Never guess: report the SHAPE of the response so it can be fixed.
      return fail("Mono created the customer but the response had no id I recognise.", 502, {
        stage: "customer", shape: Object.keys(data ?? {}), data_shape: Object.keys(data?.data ?? {}),
      });
    }
  }
  await supabase.from("members").update({ mono_customer_id: customerId }).eq("id", member.id);

  // ---- 2. mandate (Mono's documented initiate call for variable mandates)
  // Short and unique (about 15 characters): MND + the member number + a time stamp.
  const reference = `MND${member.ogfza_member_id.replace(/\D/g, "")}-${Date.now().toString(36)}`;
  const payload: Record<string, unknown> = {
    amount: Math.round(amountNaira * 100),
    type: "recurring-debit",
    method: "mandate",
    mandate_type: "emandate",
    debit_type: "variable",
    description: "OGFZA Cooperative monthly contributions",
    reference,
    start_date: b.start_date,
    end_date: b.end_date,
    customer: { id: customerId },
    meta: { ogfza_member_id: member.ogfza_member_id },
  };
  if (feeBearer === "customer") payload.fee_bearer = "customer";

  let { res, data } = await mono("/v2/payments/initiate", payload);
  if (res.status === 404) ({ res, data } = await mono("/v2/payments/initiate-mandate", payload));
  if (!res.ok) {
    return fail("Mono could not create the mandate: " + monoMessage(data, `HTTP ${res.status}`), 400, { stage: "mandate", customer_id: customerId });
  }
  const mandateId: string | null = data?.data?.mandate_id ?? data?.data?.mandate ?? null;
  const url: string | null = data?.data?.mono_url ?? null;
  if (!mandateId) {
    return fail("Mono accepted the request but the response had no mandate id I recognise.", 502, {
      stage: "mandate", shape: Object.keys(data ?? {}), data_shape: Object.keys(data?.data ?? {}),
    });
  }

  // ---- 3. save it, already linked to the member
  const { error: insErr } = await supabase.from("mandates").insert({
    member_id: member.id,
    mono_mandate_id: mandateId,
    mono_customer_id: customerId,
    mandate_type: "emandate",
    debit_type: "variable",
    status: "initiated",
    amount: amountNaira,
    start_date: b.start_date,
    end_date: b.end_date,
    fee_bearer: feeBearer,
    authorisation_url: url,
    ready_to_debit: false,
  });
  if (insErr && (insErr as any).code === "23505") {
    // The webhook got there first: just link and store the link.
    await supabase.from("mandates").update({ member_id: member.id, fee_bearer: feeBearer, authorisation_url: url }).eq("mono_mandate_id", mandateId);
  } else if (insErr) {
    return fail("Mandate created at Mono (" + mandateId + ") but saving it here failed: " + insErr.message, 500, { stage: "save", mono_mandate_id: mandateId, authorisation_url: url });
  }

  await supabase.from("audit_logs").insert({
    actor: ex.email, action: "mandate_created", record_type: "mandate", details: {
      member: member.ogfza_member_id, mono_mandate_id: mandateId, amount: amountNaira, fee_bearer: feeBearer, start: b.start_date, end: b.end_date,
    },
  });
  return json({ ok: true, mono_mandate_id: mandateId, authorisation_url: url, member: member.ogfza_member_id });
});
