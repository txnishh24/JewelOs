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

// ── Karigar 2.0 ledger (supabase/migrations/010_karigar_ledger.sql) ──
// The shop id is NEVER read from the request: it is the tenant resolved from the session
// token, exactly like the blob. Only owner and manager may touch the ledger; ADJUST and
// OPENING are owner-only. Staff and readonly are refused.
const KG_TYPES = new Set([
  "ISSUE", "RETURN", "RECEIPT", "SCRAP", "LOSS", "TRANSFER_OUT", "TRANSFER_IN",
  "ENTITLEMENT_ACCRUE", "ENTITLEMENT_SETTLE", "LABOUR_ACCRUE", "LABOUR_PAY", "ADJUST", "OPENING", "REVERSAL",
]);
const KG_OWNER_ONLY = new Set(["ADJUST", "OPENING"]);
const KG_ACCOUNTS = new Set([
  "VAULT", "KCUST", "WIP", "FG", "SCRAP", "LOSS", "TRANSIT", "ENT", "EARNED", "PAYOUT", "OPENING", "ADJ",
]);
const KG_ROLES = new Set(["owner", "manager"]);
// Optional old-build guard. Unset or 0 = off. Set MIN_CLIENT_BUILD to refuse saves and ledger
// posts from app builds older than that number (a stale phone would otherwise save the shop
// blob without newer keys and erase them). The client sends its build as _build.
const MIN_CLIENT_BUILD = Number(Deno.env.get("MIN_CLIENT_BUILD") ?? "0") || 0;
const buildOf = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
const isInt = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
const isStr = (v: unknown, max: number) => typeof v === "string" && v.length <= max;

// Returns an error string, or the RPC arguments. Shape and size limits only: the balance rules
// (sum to zero, no negative custody, exact mirror reversals) are enforced inside the database.
function checkKgJournal(b: Record<string, unknown>, role: string, userId: string):
  | string
  | { op: string; type: string; job: string | null; voucher: string | null; reverses: number | null;
      date: string; note: string; approved: string | null; meta: Record<string, string>;
      lines: unknown[]; labour: unknown[] } {
  const op = b.op_id;
  if (typeof op !== "string" || !/^[A-Za-z0-9:_.-]{8,64}$/.test(op)) return "op_id must be 8 to 64 safe characters";
  const type = b.type;
  if (typeof type !== "string" || !KG_TYPES.has(type)) return "unknown journal type";
  if (KG_OWNER_ONLY.has(type) && role !== "owner") return "owner only";
  const job = b.job_id == null || b.job_id === "" ? null : b.job_id;
  const voucher = b.voucher_id == null || b.voucher_id === "" ? null : b.voucher_id;
  if (job !== null && !isStr(job, 64)) return "job_id too long";
  if (voucher !== null && !isStr(voucher, 64)) return "voucher_id too long";
  const reverses = b.reverses_id == null ? null : b.reverses_id;
  if (reverses !== null && !isInt(reverses)) return "reverses_id must be an integer";
  if (type === "REVERSAL" && reverses === null) return "a reversal must name the journal it reverses";
  if (type !== "REVERSAL" && reverses !== null) return "only a reversal may name a journal";
  const date = b.business_date;
  // a real calendar date between 2000 and 2100: "2026-02-30" and "0000-01-01" pass Date.parse, but
  // Postgres rejects them while reading the argument, which would surface as a 500 and be retried forever
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2000-01-01" || date > "2100-12-31"
      || isNaN(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) return "business_date must be a real date, YYYY-MM-DD";
  const note = b.note == null ? "" : b.note;
  if (!isStr(note, 200)) return "note too long";
  const lines = b.lines == null ? [] : b.lines;
  const labour = b.labour == null ? [] : b.labour;
  if (!Array.isArray(lines) || !Array.isArray(labour)) return "lines and labour must be lists";
  if (lines.length > 20 || labour.length > 20) return "too many lines";
  if (lines.length === 0 && labour.length === 0) return "a journal needs at least one line";
  const outLines: unknown[] = [];
  for (const l of lines as Record<string, unknown>[]) {
    if (!l || typeof l !== "object") return "bad line";
    if (typeof l.account !== "string" || !KG_ACCOUNTS.has(l.account)) return "unknown account";
    const ref = l.owner_ref == null ? "" : l.owner_ref;
    if (!isStr(ref, 64)) return "owner_ref too long";
    if (!isInt(l.fine_mg) || l.fine_mg === 0 || Math.abs(l.fine_mg as number) > 1e12) return "fine_mg must be a non-zero whole number";
    if (l.gross_mg != null && (!isInt(l.gross_mg) || Math.abs(l.gross_mg as number) > 1e12)) return "gross_mg invalid";
    if (l.permille != null && (!isInt(l.permille) || (l.permille as number) < 1 || (l.permille as number) > 1000)) return "permille invalid";
    outLines.push({ account: l.account, owner_ref: ref, fine_mg: l.fine_mg, gross_mg: l.gross_mg ?? null, permille: l.permille ?? null });
  }
  const outLabour: unknown[] = [];
  for (const l of labour as Record<string, unknown>[]) {
    if (!l || typeof l !== "object") return "bad labour line";
    if (!isStr(l.karigar_id, 64) || !l.karigar_id) return "karigar_id required";
    if (!isInt(l.amount_paise) || l.amount_paise === 0 || Math.abs(l.amount_paise as number) > 1e12) return "amount_paise must be a non-zero whole number";
    if (l.mode != null && !isStr(l.mode, 20)) return "mode too long";
    outLabour.push({ karigar_id: l.karigar_id, amount_paise: l.amount_paise, mode: l.mode ?? null });
  }
  const meta: Record<string, string> = {};
  if (b.meta && typeof b.meta === "object") {
    const keys = Object.keys(b.meta as object);
    if (keys.length > 10) return "meta too large";
    for (const k of keys) {
      const v = (b.meta as Record<string, unknown>)[k];
      // "h" is the server's own op_id fingerprint (migration 011); a client may not set it
      if (k === "h" || !/^[a-z_]{1,24}$/.test(k) || !isStr(v, 120)) return "meta invalid";
      meta[k] = v as string;
    }
  }
  // approval is stamped by the server from the real session, never taken from the body
  const approved = role === "owner" && (b.approve === true || KG_OWNER_ONLY.has(type)) ? userId : null;
  return { op, type, job: job as string | null, voucher: voucher as string | null, reverses: reverses as number | null,
    date, note: note as string, approved, meta, lines: outLines, labour: outLabour };
}

// Roles as actually issued by auth-gateway: owner (at signup), and
// manager | staff | readonly (add-staff ALLOWED_ROLES).
// readonly may load the shop but must not write anything.
const CAN_WRITE = new Set(["owner", "manager", "staff"]);
const CAN_READ = new Set(["owner", "manager", "staff", "readonly"]);

// Same allowlist and reasoning as auth-gateway's corsHeaders() — keep both in
// sync; add a new deploy target to both at once.
const ALLOWED_ORIGINS = [
  "https://jewelos.jewelos-e2e.workers.dev",
  "https://jewelos-test.pages.dev",
];
// Local dev (`npx serve`, Playwright on any port) — 21 Oct. Only a page
// already running on this same machine can send these origins, so this does
// not reopen the 14 Oct hole. Anchored on both ends: "http://localhost.evil.com"
// and "http://localhost:80@evil.com" do not match. Plain http only, port optional.
const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
function corsHeaders(origin: string | null) {
  const allowOrigin = origin && (ALLOWED_ORIGINS.includes(origin) || LOCAL_DEV_ORIGIN.test(origin)) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-session-token, prefer",
    "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
    "Vary": "Origin",
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
//   payload = { userId, shopId, role, sessionVersion, exp }
// NOTE: exp is epoch MILLISECONDS (auth-gateway sets
// Date.now() + TTL*3600000), not seconds. Treating it as seconds would
// mark every live token expired.
// Missing/legacy = 0, same normaliser as auth-gateway's. Used on the token
// AND the user record, never one side only -- see resolveTenant below and
// docs/session-versioning-design.md (Phase 5 item 5).
const ver = (v: unknown) => (typeof v === "number" ? v : 0);
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

type Session = { userId: string; shopId: string; role: string; sessionVersion: number };

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
    sessionVersion: ver(payload.sessionVersion),
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
  | { ok: false; reason: "user_gone" | "shop_gone" | "stale_session" };

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
  // A password change elsewhere bumped the record's version past this
  // token's — treated as a stale session, not a removed user, so the
  // client re-signs-in in place instead of wiping unsaved work.
  if (ver(user.sessionVersion) !== session.sessionVersion) return { ok: false, reason: "stale_session" };

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

  // 9 Oct: read the whole request body before ANY response. The early
  // returns below (401 / 403 / 500) used to answer without touching
  // req.body; on a large PUT with an invalid token (726KB probe) the reply
  // then never arrived at all (no status line within 60s), while a small
  // body got a clean 401 in 0.48s. Reading first makes every path behave
  // like the success path, which has always read the body and has never
  // hung. See HANDOFF.md, 9 Oct critical-remediation entry, for the
  // reasoning and the probe evidence this responds to.
  let rawBody = "";
  if (req.method === "PUT" || req.method === "POST") {
    try {
      rawBody = await req.text();
    } catch {
      return json({ error: "could not read request body" }, 400, origin);
    }
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
    if (tenant.reason === "user_gone") {
      return json({ error: "unauthenticated", reason: "revoked", message: "Please sign in again." }, 401, origin);
    }
    // A password change elsewhere, not a removal — "expired", never
    // "revoked": saasRequireReauth holds this device's unsaved work and
    // replays it after a fresh sign-in, instead of wiping it
    // (docs/session-versioning-design.md).
    if (tenant.reason === "stale_session") {
      return json({ error: "unauthenticated", reason: "expired", message: "Your password was changed. Please sign in again." }, 401, origin);
    }
    return json({ error: "invalid_tenant", message: "Shop not found for this session." }, 403, origin);
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
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid JSON body" }, 400, origin);
    }
    if (!body.data || typeof body.data !== "object") {
      return json({ error: "body.data is required" }, 400, origin);
    }
    if (MIN_CLIENT_BUILD > 0 && buildOf((body.data as Record<string, unknown>)._build) < MIN_CLIENT_BUILD) {
      return json({ error: "client_outdated", message: "Please reload the app to update." }, 409, origin);
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
      body = JSON.parse(rawBody);
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

    // ── Karigar 2.0 ledger ───────────────────────────────
    if (typeof body.action === "string" && body.action.startsWith("kg_")) {
      if (!KG_ROLES.has(role)) return json({ error: "forbidden" }, 403, origin);
      const kb = body as Record<string, unknown>;
      if (MIN_CLIENT_BUILD > 0 && buildOf(kb._build) < MIN_CLIENT_BUILD) {
        return json({ error: "client_outdated", message: "Please reload the app to update." }, 409, origin);
      }
      if (body.action === "kg_post") {
        const j = checkKgJournal(kb, role, session.userId);
        if (typeof j === "string") return json({ error: "invalid_journal", message: j }, 400, origin);
        const { data: rows, error: kerr } = await supabase.rpc("kg_post_journal", {
          p_shop_id: shopKey, p_op_id: j.op, p_type: j.type, p_job_id: j.job, p_voucher_id: j.voucher,
          p_reverses_id: j.reverses, p_business_date: j.date, p_note: j.note,
          p_by_user: session.userId, p_by_role: role, p_approved_by: j.approved, p_meta: j.meta,
          p_lines: j.lines, p_labour: j.labour,
        });
        if (kerr) {
          console.error("[store-proxy] kg_post failed:", kerr.message);
          return json({ error: "kg_post failed" }, 500, origin);
        }
        const r = (Array.isArray(rows) ? rows[0] : rows) as { ok: boolean; duplicate: boolean; journal_id: number | null; error: string | null } | null;
        if (!r) return json({ error: "kg_post failed" }, 500, origin);
        // a refusal by the ledger rules is a normal answer (422), not a server fault
        if (!r.ok) return json({ ok: false, error: "rejected", message: r.error }, 422, origin);
        return json({ ok: true, duplicate: !!r.duplicate, journal_id: r.journal_id }, 200, origin);
      }
      if (body.action === "kg_balances") {
        const { data, error: berr } = await supabase.rpc("kg_balances", { p_shop_id: shopKey });
        if (berr) { console.error("[store-proxy] kg_balances failed:", berr.message); return json({ error: "kg_balances failed" }, 500, origin); }
        return json({ ok: true, balances: data ?? [] }, 200, origin);
      }
      if (body.action === "kg_journal_list" || body.action === "kg_export") {
        const exporting = body.action === "kg_export";
        const after = isInt(kb.after) && (kb.after as number) >= 0 ? (kb.after as number) : 0;
        const limit = exporting ? 100000 : (isInt(kb.limit) ? Math.min(Math.max(kb.limit as number, 1), 1000) : 200);
        const { data, error: lerr } = await supabase.rpc("kg_journal_list", { p_shop_id: shopKey, p_after: after, p_limit: limit });
        if (lerr) { console.error("[store-proxy] kg list failed:", lerr.message); return json({ error: "kg list failed" }, 500, origin); }
        return json({ ok: true, journals: data ?? [] }, 200, origin);
      }
      return json({ error: "unknown action" }, 400, origin);
    }

    return json({ error: "unknown action" }, 400, origin);
  }

  return json({ error: "method not allowed" }, 405, origin);
});
