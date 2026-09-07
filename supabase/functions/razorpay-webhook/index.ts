// ══════════════════════════════════════════════════════════════════════
// razorpay-webhook — fixes "Razorpay payment success handled client-side
// with no visible server-side webhook verification" from the audit.
//
// Previously: the client ran the Razorpay checkout, and on the success
// callback, the BROWSER itself flipped SAAS.plan to 'pro'/'basic' and
// saved it. Anyone could open devtools and call that function directly
// — no payment required.
//
// Now: plan changes only happen here, triggered by Razorpay's own
// server-to-server webhook, whose signature is verified with your
// webhook secret (never exposed to the browser) before anything happens.
//
// Setup:
//  1. Razorpay Dashboard → Settings → Webhooks → add endpoint:
//     https://<project-ref>.supabase.co/functions/v1/razorpay-webhook
//     Subscribe to: payment.captured, subscription.activated (whichever
//     events your checkout flow uses).
//  2. supabase secrets set RAZORPAY_WEBHOOK_SECRET=<the secret Razorpay
//     shows you when you create the webhook>
//  3. Your Razorpay payment notes/metadata must include the shop's
//     rowKey (pass it as `notes: { shop_row_key }` when creating the
//     order/subscription client-side) and the target plan (`notes: {
//     plan }`) so this function knows which shop+plan to activate. The
//     client never gets to set the plan directly — only Razorpay's
//     signed callback does.
// ══════════════════════════════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")!;

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time-ish compare
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  const isValid = await verifySignature(rawBody, signature);
  if (!isValid) {
    // Do not leak which part failed — just reject.
    return new Response(JSON.stringify({ error: "invalid signature" }), { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const eventId = event.id || event.event_id || `${event.event}:${Date.now()}`;

  // Idempotency — Razorpay may retry the same webhook; only act once.
  const { data: seen } = await supabase
    .from("payment_events")
    .select("id")
    .eq("razorpay_event_id", eventId)
    .limit(1);
  if (seen && seen.length) {
    return new Response(JSON.stringify({ ok: true, alreadyProcessed: true }), { status: 200 });
  }

  const acceptedEvents = ["payment.captured", "subscription.activated", "subscription.charged"];
  if (!acceptedEvents.includes(event.event)) {
    return new Response(JSON.stringify({ ok: true, ignored: event.event }), { status: 200 });
  }

  const entity = event.payload?.payment?.entity || event.payload?.subscription?.entity;
  const notes = entity?.notes || {};
  const shopRowKey = notes.shop_row_key;
  const plan = notes.plan;

  if (!shopRowKey || !plan || !["free", "basic", "pro"].includes(plan)) {
    return new Response(JSON.stringify({ error: "missing/invalid shop_row_key or plan in payment notes" }), {
      status: 400,
    });
  }

  // Activate the plan on the shop record. Plan lives on shop.plan inside
  // the `shops` blob in auth_store (see js/04-orders-detail.js signup:
  // newShop = {..., plan:'free', ...}) — NOT in the `store` table, which
  // only holds business data (products/sales/etc). Adjust this if your
  // client's plan field has moved since this function was written.
  const { data: shopRows } = await supabase.from("auth_store").select("data").eq("id", "shops").limit(1);
  if (!shopRows || !shopRows.length) {
    return new Response(JSON.stringify({ error: "shops blob not found" }), { status: 500 });
  }
  const shops = shopRows[0].data as Record<string, unknown>[];
  const shopIdx = shops.findIndex((s) => s.rowKey === shopRowKey);
  if (shopIdx === -1) {
    return new Response(JSON.stringify({ error: "shop not found for that rowKey" }), { status: 404 });
  }
  shops[shopIdx] = { ...shops[shopIdx], plan, planActivatedAt: new Date().toISOString() };
  await supabase.from("auth_store").update({ data: shops }).eq("id", "shops");

  await supabase.from("payment_events").insert({
    razorpay_event_id: eventId,
    razorpay_payment_id: entity?.id || null,
    shop_row_key: shopRowKey,
    plan,
    raw_payload: event,
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
