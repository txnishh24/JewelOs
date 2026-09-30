// ══════════════════════════════════════════════════════════════════════
// store-proxy — HARDENED v5 (session-token authentication)
//
// WHAT CHANGED FROM v4 AND WHY
//
// v4 authenticated the caller by one thing only: possession of the
// shop's rowKey UUID, sent in the x-shop-key header. That is a bearer
// secret with no expiry, no revocation, and no link to a user:
//   • Anyone who obtains a rowKey (shared browser, stale localStorage, a
//     departing employee, a logged request) has permanent full
//     read/write on that tenant, with no login, and no way to cut them
//     off short of migrating the shop to a new key.
//   • Every staff member had identical access. The proxy validated the
//     SHOP, never the USER, so a "staff" or "readonly" account could
//     fetch and overwrite the entire shop blob — sales, customer KYC,
//     girvi loans, audit logs — with one devtools fetch. All the
//     isOwner()/isManager() checks in the client are browser-side JS,
//     defeated by typing SAAS.user.role='owner' into the console.
//
// v5 ignores x-shop-key entirely. It reads the HMAC-signed session
// token auth-gateway already issues at login/signup, verifies signature
// and expiry server-side, then resolves the shop's rowKey ITSELF from
// auth_store. The client never names the tenant it wants. Role comes
// from the user's current record in auth_store (not the token, since
// 14 Sep), so per-action authorization can no longer be bypassed by
// editing frontend JavaScript, and a removed user is cut off at once.
//
// Client-facing request/response SHAPES are unchanged from v4, so the
// only client edit needed is swapping the header. See DEPLOY.md.
//
// Requires: SESSION_SECRET (same value auth-gateway signs with).
//           SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected.
// ══════════════════════════════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SESSION_SECRET = Deno.env.get("SESSION_SECRET")!;

const ALLOWED_COUNTERS = new Set([
  "inv_no", "girvi_no", "ord_no", "prod_no", "purchase_no",
]);

// Roles as actually issued by auth-gateway: owner (at signup), and
// manager | staff | readonly (add-staff ALLOWED_ROLES).
// readonly may load the shop but must not write anything.
const CAN_WRITE = new Set(["owner", "manager", "staff"]);
const CAN_READ = new Set(["owner", "manager", "staff", "readonly"]);

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-session-token, prefer",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// ── Session verification ──────────────────────────────────────────────
// Mirrors auth-gateway's signSession() exactly:
//   b64url(JSON payload) + "." + b64url(HMAC-SHA256(payload))
//   payload = { userId, shopId, role, exp }
// NOTE: exp is epoch MILLISECONDS (auth-gateway sets
// Date.now() + TTL*3600000), not seconds. Treating it as seconds would
// mark every live token expired.
function b64urlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

type Session = { userId: string; shopId: string; role: string };

async function verifySession(token: string | null): Promise<Session | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  let valid: boolean;
  try {
    // crypto.subtle.verify compares in constant time internally — no
    // manual byte comparison, so no timing side channel on the sig.
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      b64urlDecode(sig),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  if (!payload.shopId || !payload.userId) return null;

  return {
    userId: String(payload.userId),
    shopId: String(payload.shopId),
    role: String(payload.role ?? "staff"),
  };
}

// ── Tenant + user resolution ──────────────────────────────────────────
// The session carries shopId ("shop_xxxx"), but `store` rows are keyed
// by the shop's rowKey (a UUID). v4 had the client supply that rowKey;
// v5 looks it up server-side so the client can't name another tenant.
//
// A valid signature only proves the token was issued, not that its user
// still belongs to this shop. Without re-checking, a removed staff member
// kept full access until the token expired (up to 12h — security review
// 14 Sep, finding 3). So the user is looked up on every request too, and
// the role is taken from their current record rather than from the token.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tenant =
  | { ok: true; rowKey: string; role: string }
  | { ok: false; reason: "user_gone" | "shop_gone" };

async function resolveTenant(
  supabase: ReturnType<typeof createClient>,
  session: Session,
): Promise<Tenant | null> {
  const { data, error } = await supabase
    .from("auth_store").select("id, data").in("id", ["shops", "users"]);
  if (error || !data) return null;
  const blob = (id: string) =>
    ((data.find((r) => r.id === id)?.data ?? []) as Record<string, unknown>[]);

  const user = blob("users").find((u) => u.id === session.userId);
  if (!user || user.shopId !== session.shopId) return { ok: false, reason: "user_gone" };

  const shop = blob("shops").find((s) => s.id === session.shopId);
  if (!shop) return { ok: false, reason: "shop_gone" };
  const rowKey = String(shop.rowKey ?? "");
  // Refuse anything that isn't a proper UUID — in particular the legacy
  // shared 'main' key, which must never be addressable again.
  if (!UUID_RE.test(rowKey)) return { ok: false, reason: "shop_gone" };

  // Same fallback verifySession applies to a token with no role.
  return { ok: true, rowKey, role: String(user.role ?? "staff") };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  const session = await verifySession(req.headers.get("x-session-token"));
  // reason (30 Sep): the client used to guess "expired vs removed" from the
  // phone's clock and wiped a slow-clock phone. "expired" covers any token
  // that fails verification (timed out, bad signature): signing in again is
  // the right answer, and it grants nothing without the password.
  if (!session) {
    return json({ error: "unauthenticated", reason: "expired", message: "Please sign in again." }, 401, origin);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const tenant = await resolveTenant(supabase, session);
  if (!tenant) {
    return json({ error: "lookup failed" }, 500, origin);
  }
  if (!tenant.ok) {
    // 401 on a removed user sends the client down its existing "session
    // expired — sign in again" path (js/01-sync-core.js), where the login
    // itself will now fail.
    return tenant.reason === "user_gone"
      ? json({ error: "unauthenticated", reason: "revoked", message: "Please sign in again." }, 401, origin)
      : json({ error: "invalid_tenant", message: "Shop not found for this session." }, 403, origin);
  }
  const shopKey = tenant.rowKey;
  const role = tenant.role;

  // ── READ ────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    if (!CAN_READ.has(role)) return json({ error: "forbidden" }, 403, origin);
    const { data: rows, error } = await supabase
      .from("store").select("data, updated_at").eq("id", shopKey).limit(1);
    if (error) {
      console.error("[store-proxy] read failed:", error.message);
      return json({ error: "read failed" }, 500, origin);
    }
    if (!rows || rows.length === 0) return json(null, 200, origin);
    return json(rows[0], 200, origin);
  }

  // ── WRITE (atomic compare-and-swap) ─────────────────────────────────
  if (req.method === "PUT") {
    if (!CAN_WRITE.has(role)) {
      return json({ error: "forbidden", message: "Your account cannot save changes." }, 403, origin);
    }
    let body: { data?: unknown; expectedVersion?: number };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400, origin);
    }
    if (!body.data || typeof body.data !== "object") {
      return json({ error: "body.data is required" }, 400, origin);
    }
    const expectedVersion = typeof body.expectedVersion === "number" ? body.expectedVersion : 0;

    const { data: rpcRows, error: rpcError } = await supabase.rpc("store_cas_write", {
      p_shop_id: shopKey,
      p_data: body.data,
      p_expected_version: expectedVersion,
    });
    if (rpcError) {
      console.error("[store-proxy] cas write failed:", rpcError.message);
      return json({ error: "write failed" }, 500, origin);
    }

    const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!result) return json({ error: "store_cas_write returned no result" }, 500, origin);

    if (result.conflict) {
      return json({ ok: false, conflict: true, data: result.current_data }, 409, origin);
    }
    return json({ ok: true, data: result.new_data }, 200, origin);
  }

  // ── COUNTERS ────────────────────────────────────────────────────────
  if (req.method === "POST") {
    if (!CAN_WRITE.has(role)) return json({ error: "forbidden" }, 403, origin);
    let body: { action?: string; counter?: string };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400, origin);
    }

    if (body.action === "increment_counter") {
      if (!body.counter || !ALLOWED_COUNTERS.has(body.counter)) {
        return json({ error: "unknown or missing counter name" }, 400, origin);
      }
      const { data: val, error } = await supabase.rpc("increment_shop_counter", {
        p_shop_id: shopKey,
        p_counter: body.counter,
      });
      if (error) {
        console.error("[store-proxy] counter failed:", error.message);
        return json({ error: "counter failed" }, 500, origin);
      }
      return json({ ok: true, val }, 200, origin);
    }

    return json({ error: "unknown action" }, 400, origin);
  }

  return json({ error: "method not allowed" }, 405, origin);
});
