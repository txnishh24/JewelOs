// ══════════════════════════════════════════════════════════════════════
// auth-gateway — replaces direct client REST access to `auth_store`.
//
// Fixes two audit findings at once:
//  1. "Login rate limiting is client-side only (resets on reload)" — login
//     attempts are throttled server-side via login_throttle_take()
//     (migrations/009_login_throttle.sql, docs/login-lockout-design.md),
//     which a page refresh can't touch. login_attempts itself is now just
//     an audit log of checked attempts; nothing reads it to decide anything.
//  2. "Staff permission enforcement is UI-only, no function-level
//     authorization" — role checks (e.g. "only an owner can add/remove
//     staff") now happen here, server-side, using a signed session token
//     the client cannot forge or edit. Previously, because auth_store was
//     writable directly with the anon key, a staff account could simply
//     PATCH its own role to "owner" in the JSON blob and save — nothing
//     stopped it. Now auth_store is unreachable from the browser at all
//     (see 001_lockdown_rls.sql); every mutation goes through the role
//     checks below.
//
// Session tokens: lightweight HMAC-signed tokens (not full JWT/Supabase
// Auth — that would mean migrating the whole login system, out of scope
// for this pass). Format: base64url(payload) + "." + base64url(hmac).
// Secret lives only in the SESSION_SECRET Edge Function secret.
//
// Deploy:  supabase functions deploy auth-gateway
// Secrets: supabase secrets set SESSION_SECRET=$(openssl rand -hex 32)
//          (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected)
//
// Endpoints (all POST, JSON body):
//   /auth-gateway/signup                 { name, email, password, shopName, city }
//   /auth-gateway/login                  { email, password, deviceToken? }
//   /auth-gateway/change-password        { sessionToken, currentPassword, newPassword } -- returns a fresh sessionToken
//   /auth-gateway/update-shop            { sessionToken, name?, city?, phone?, gstin?, locale? }
//   /auth-gateway/add-staff              { sessionToken, name, email }
//   /auth-gateway/remove-staff           { sessionToken, staffUserId }
//   /auth-gateway/request-password-reset { email }
//   /auth-gateway/reset-password         { email, code, newPassword }
//
// auth_store (the `users`/`shops` blobs) is written through mutateBlob(), a
// compare-and-swap helper backed by the auth_store_cas_write() RPC
// (migrations/008_auth_store_cas_history.sql) -- every write re-checks its
// own preconditions against fresh data on a conflict and retries, rather
// than overwriting a concurrent change to an unrelated record. See
// docs/auth-store-cas-audit-design.md (10/11 Oct Phase 5, items 7+8).
//
// `login` accepts an optional `deviceToken` (proof this browser has signed
// in to that email before, so it gets its own failed-login throttle bucket
// a stranger can't fill by guessing against the email alone); `login`,
// `signup`, and a successful `reset-password` all return a fresh one. See
// docs/login-lockout-design.md and migrations/009_login_throttle.sql
// (10/11 Oct Phase 5, item 6).
//
// Session tokens carry a `sessionVersion`, bumped on change-password and
// reset-password; a mismatch against the user record's current value is
// treated the same as a removed/moved user wherever that's already checked
// (loadActor here, resolveTenant in store-proxy) -- so a password change
// signs out every OTHER device within one request, not just at `exp`. No
// migration: a missing field reads as 0 on both sides. See
// docs/session-versioning-design.md (10/11 Oct Phase 5, item 5).
//
// Email delivery (request-password-reset): sends a 6-digit code via the
// Resend API. Requires secret RESEND_API_KEY and RESEND_FROM_EMAIL (a
// verified sending address on your Resend domain):
//   supabase secrets set RESEND_API_KEY=<from resend.com dashboard>
//   supabase secrets set RESEND_FROM_EMAIL=noreply@yourdomain.com
// If RESEND_API_KEY is not set, request-password-reset refuses with 503
// and issues no code at all. It used to log the code instead so the flow
// could be tested before email was wired up; that put a working
// account-takeover code for any email into the function logs, so it is
// gone. The code is never logged, in any branch — to test the flow, set
// RESEND_API_KEY against a real Resend account.
// ══════════════════════════════════════════════════════════════════════

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SESSION_SECRET = Deno.env.get("SESSION_SECRET")!;

const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCK_MIN = 15;       // first lock length; replaces LOCKOUT_WINDOW_MIN
const MAX_LOCK_MIN = 24 * 60;   // locks double up to this; also the quiet period that forgets a key
const DEVICE_TOKEN_DAYS = 180;
const SESSION_TTL_HOURS = 6; // Tanish, 29 Sep: token now survives app reopen on the device, so shorter life
const RESET_CODE_TTL_MIN = 15;
const RESET_MAX_REQUESTS_PER_HOUR = 3;
const RESET_MAX_GUESSES = 5; // wrong guesses before a reset code is burned
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "onboarding@resend.dev";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

// ── PBKDF2 password hashing — mirrors js/04-orders-detail.js exactly ───
async function hashPassword(pw: string, saltHex?: string) {
  if (!saltHex) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    saltHex = Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(saltHex), iterations: 100000, hash: "SHA-256" },
    key,
    256,
  );
  const hash = Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hash: "pbkdf2:" + hash, salt: saltHex };
}
async function verifyPassword(pw: string, storedHash: string, salt: string) {
  const r = await hashPassword(pw, salt);
  return r.hash === storedHash;
}

// Login always pays for exactly one PBKDF2 hash, account or no account, so the
// response time can't reveal whether an email is registered (10 Oct Phase 5,
// item 3 -- see docs/login-timing-sidechannel-design.md). Not secrets; they
// only exist to be hashed against.
//   DUMMY_SALT: 32 hex chars, the same length as a real salt, so PBKDF2 does
//     identical work.
//   DUMMY_HASH: the same length as a real "pbkdf2:<64 hex>" value, but "-" is
//     never a hex digit, so no password can ever produce it.
const DUMMY_SALT = "a916d76f434c963972bef9307fc3def9";
const DUMMY_HASH = "pbkdf2:" + "-".repeat(64);

// ── Signed session tokens ───────────────────────────────────────────────
function b64url(bytes: ArrayBuffer | Uint8Array) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
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
async function signSession(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}
// Missing/legacy = 0. Used on the token AND the user record, never one side
// only -- that's what makes "a token minted before sessionVersion existed
// still works" and "a user record that's never had a password change on
// the new code still matches" both true on day one of this shipping
// (docs/session-versioning-design.md, Phase 5 item 5).
const ver = (v: unknown) => (typeof v === "number" ? v : 0);
async function verifySession(token: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    b64urlDecode(sig),
    new TextEncoder().encode(body),
  );
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  return payload;
}

// ── Device tokens (docs/login-lockout-design.md) ──────────────────────
// Proof that this browser has signed in to `email` before. NOT a session:
// it grants no access, only a separate failed-login bucket. Signed over
// "device." + body, so it can never verify as a session token (signSession
// signs the bare body), and a session token can never verify as this.
async function signDeviceToken(email: string, did: string) {
  const body = b64url(new TextEncoder().encode(JSON.stringify({
    email, did, exp: Date.now() + DEVICE_TOKEN_DAYS * 86400000,
  })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode("device." + body));
  return `${body}.${b64url(sig)}`;
}
// Returns the device id only if the token is genuine, unexpired, and was
// issued for THIS email. The email check is what stops someone using a
// token from their own account as a fresh bucket against someone else's.
async function verifyDeviceToken(token: string, email: string): Promise<string | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), b64urlDecode(parts[1]),
      new TextEncoder().encode("device." + parts[0]));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    if (p.email !== email || typeof p.did !== "string" || typeof p.exp !== "number" || Date.now() > p.exp) return null;
    return p.did;
  } catch {
    return null; // garbage base64/JSON must fall back to the e: key, never 500
  }
}

// ── auth_store helpers (service-role only, past the RLS lockdown) ──────
async function getBlob(supabase: ReturnType<typeof createClient>, id: "users" | "shops") {
  const { data, error } = await supabase.from("auth_store").select("data").eq("id", id).limit(1);
  if (error) throw error;
  return data && data.length ? (data[0].data as unknown[]) : [];
}

// Read-modify-write one auth_store row with compare-and-swap (10/11 Oct Phase 5
// items 7+8 -- see docs/auth-store-cas-audit-design.md, migrations/008). Replaces
// the old putBlob, which did a whole-array upsert with no lock and no version
// check: two overlapping writes (even for unrelated shops, since `users`/`shops`
// are each ONE shared array for the whole platform) could silently lose one
// side's change. `apply` is called with a FRESH copy of the array on every
// attempt and must be synchronous and self-contained: every check it makes
// (actor role, duplicate email, target exists) re-runs against the latest data
// on a retry. Do any async work (hashing, id generation) BEFORE calling this,
// since `apply` itself cannot be async. `apply` returns `{ res }` to stop
// without writing (a 4xx that doesn't change anything), or `{ next, res }` to
// write `next` and return `res` once it lands.
type Rec = Record<string, unknown>;
const CAS_ATTEMPTS = 5;
async function mutateBlob(
  supabase: ReturnType<typeof createClient>,
  id: "users" | "shops",
  actor: string,
  apply: (arr: Rec[]) => { next?: Rec[]; res: Response },
): Promise<Response> {
  const { data, error } = await supabase.from("auth_store").select("data, version").eq("id", id).limit(1);
  if (error) throw error;
  let arr = (data && data.length ? data[0].data : []) as Rec[];
  let version = data && data.length ? Number(data[0].version ?? 0) : 0;
  for (let i = 0; i < CAS_ATTEMPTS; i++) {
    const out = apply(JSON.parse(JSON.stringify(arr)));
    if (!out.next) return out.res;
    const { data: rows, error: e } = await supabase.rpc("auth_store_cas_write", {
      p_id: id, p_data: out.next, p_expected_version: version, p_actor: actor,
    });
    if (e) throw e;
    const r = Array.isArray(rows) ? rows[0] : rows;
    if (r.ok) return out.res;
    arr = (r.current_data ?? []) as Rec[]; // someone else wrote in between: re-apply on theirs
    version = r.cur_version;
  }
  throw new Error(`auth_store ${id}: still conflicting after ${CAS_ATTEMPTS} attempts`);
}

// The token's role/shopId are a snapshot from login and live up to 6h. Privileged
// routes re-read the caller's CURRENT record: removed, or moved to another shop
// => null (401); role is then checked on `me.role`, never `session.role`.
// Same rule as store-proxy's resolveTenant.
// (10 Oct critical remediation, Phase 3 — update-shop/add-staff/remove-staff
// used to trust session.role, so a demoted or removed user kept access for the
// rest of their token's 6h life. 11 Oct: no longer returns `users` -- add-staff
// and remove-staff now re-check their own actor inside mutateBlob's `apply`,
// against data that's actually fresh on a CAS retry, not this one snapshot.
// Also 11 Oct: refuses a token whose sessionVersion doesn't match the
// record's -- a password change bumps the record, so every OTHER token
// issued before that change stops working here too, not just on store-proxy
// (docs/session-versioning-design.md, Phase 5 item 5).)
async function loadActor(supabase: ReturnType<typeof createClient>, session: Record<string, unknown>) {
  const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
  const found = users.find((u) => u.id === session.userId);
  const current = found && found.shopId === session.shopId &&
    ver(found.sessionVersion) === ver(session.sessionVersion);
  return { me: current ? found : null };
}
const ACCESS_CHANGED = "Your access to this shop has changed — please sign in again";

// Shop details and people's names are printed on invoices, receipts, labels and
// staff lists. None legitimately contain < or >, and refusing them here protects
// every screen that shows them — including any the client forgets to escape.
// (security review 14 Sep, finding 2: a manager could plant script in the shop
// name that ran when the owner printed an invoice.)
const NO_MARKUP_ERROR = "Names and shop details can't contain < or >";
function hasMarkup(...values: unknown[]) {
  return values.some((v) => typeof v === "string" && /[<>]/.test(v));
}

function sanitizeUser(u: Record<string, unknown>) {
  const { passwordHash: _ph, salt: _s, ...safe } = u;
  return safe;
}

// ── Password reset helpers ──────────────────────────────────────────
async function sha256Hex(str: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateResetCode() {
  // 6-digit numeric code — easy to type on a shop's phone.
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}
// Returns true only if Resend accepted the message. Never logs `code`:
// anything written here lands in the project's function logs, and a
// reset code there is a working takeover of that account.
async function sendResetEmail(email: string, code: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: email,
      subject: "Your JewelOS password reset code",
      text: `Your JewelOS password reset code is ${code}. It expires in ${RESET_CODE_TTL_MIN} minutes. If you didn't request this, you can ignore this email.`,
    }),
  });
  if (!res.ok) {
    // Don't throw — a failed send shouldn't leak into a 500 that could
    // hint whether the account exists. Log server-side for debugging.
    console.error(`[auth-gateway] Resend send failed (${res.status}): ${await res.text()}`);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, origin);

  const url = new URL(req.url);
  const route = url.pathname.split("/").pop();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const ip = req.headers.get("x-forwarded-for") || "unknown";

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400, origin);
  }

  // ── LOGIN ──────────────────────────────────────────────────────────
  if (route === "login") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json({ error: "email and password required" }, 400, origin);

    // Throttle BEFORE checking the password. login_throttle_take counts this
    // attempt and decides in one locked statement, so parallel guesses can't
    // all slip past the cap (migrations/009_login_throttle.sql,
    // docs/login-lockout-design.md). A device that has signed in to this
    // email before has its own bucket, so a stranger hammering the email
    // can't lock the owner out of their own phone. IP is deliberately not
    // part of the key — it's still logged in login_attempts below.
    const did = await verifyDeviceToken(String(body.deviceToken || ""), email);
    const throttleKey = did ? `d:${email}|${did}` : `e:${email}`;
    const { data: waitSec, error: throttleErr } = await supabase.rpc("login_throttle_take", {
      p_key: throttleKey,
      p_max_failures: MAX_FAILED_ATTEMPTS,
      p_base_lock_min: BASE_LOCK_MIN,
      p_max_lock_min: MAX_LOCK_MIN,
    });
    // Fail closed, same as reset-password: without a genuine numeric answer
    // from the throttle, every guess would be free. Already signed-in
    // sessions are unaffected. `typeof waitSec !== "number"` with no `error`
    // shouldn't happen (the RPC returns an integer), but treating it as a
    // failure rather than silently falling through keeps this route
    // fail-closed by construction, not by the RPC's good behavior.
    if (throttleErr || typeof waitSec !== "number") {
      console.error("[auth-gateway] login_throttle_take failed:", throttleErr?.message ?? `non-numeric result: ${JSON.stringify(waitSec)}`);
      return json({ error: "Could not sign in right now. Please try again in a minute." }, 503, origin);
    }
    if (waitSec > 0) {
      const mins = Math.ceil(waitSec / 60);
      // Same text whether or not the email has an account (no enumeration).
      return json({
        error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}, ` +
          `or use "Forgot password" to sign in now.`,
        retryAfterSec: waitSec,
      }, 429, origin);
    }

    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    const user = users.find((u) => String(u.email).toLowerCase() === email);
    // Always hash, even when no account matches: skipping it made unknown emails
    // answer measurably faster than wrong passwords (see DUMMY_HASH above).
    // `!!user` is what actually rejects an unknown email; DUMMY_HASH can never
    // match anyway, but this line must not depend on that.
    const passwordMatches = await verifyPassword(
      password,
      user ? String(user.passwordHash) : DUMMY_HASH,
      user ? String(user.salt) : DUMMY_SALT,
    );
    const ok = !!user && passwordMatches;

    // Audit log only — nothing reads this to decide anything any more.
    await supabase.from("login_attempts").insert({ email, ip, succeeded: ok });

    if (!ok || !user) return json({ error: "Invalid email or password" }, 401, origin);

    // Right password: forget THIS key's failures and lock. Never clear the
    // e: key from a device-token sign-in — that would hand an attacker 5
    // fresh guesses every time the owner signs in on their phone.
    const { error: clearErr } = await supabase.from("login_throttle").delete().eq("key", throttleKey);
    if (clearErr) console.error("[auth-gateway] login_throttle clear failed:", clearErr.message);

    const shops = (await getBlob(supabase, "shops")) as Record<string, unknown>[];
    const shop = shops.find((s) => s.id === user.shopId);
    if (!shop) return json({ error: "Shop not found for this account" }, 500, origin);

    const token = await signSession({
      userId: user.id,
      shopId: user.shopId,
      role: user.role,
      sessionVersion: ver(user.sessionVersion),
      exp: Date.now() + SESSION_TTL_HOURS * 3600000,
    });

    const deviceToken = await signDeviceToken(email, did || crypto.randomUUID());
    return json({ sessionToken: token, deviceToken, user: sanitizeUser(user), shop }, 200, origin);
  }

  // ── SIGNUP ─────────────────────────────────────────────────────────
  if (route === "signup") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const shopName = String(body.shopName || "").trim();
    const city = String(body.city || "").trim();
    if (!email || !password || !name || !shopName) {
      return json({ error: "name, email, password, shopName are required" }, 400, origin);
    }
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400, origin);
    if (hasMarkup(name, shopName, city, email)) return json({ error: NO_MARKUP_ERROR }, 400, origin);

    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    if (users.find((u) => String(u.email).toLowerCase() === email)) {
      return json({ error: "Account already exists with this email" }, 409, origin);
    }

    const hashed = await hashPassword(password);
    const shopId = "shop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const userId = "usr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const rowKey = crypto.randomUUID(); // unguessable — this is the store-proxy bearer secret

    const newShop = {
      id: shopId, name: shopName, city, phone: "", gstin: "", plan: "free", locale: "en-IN",
      createdAt: new Date().toISOString(), rowKey,
    };
    const newUser = {
      id: userId, name, email, passwordHash: hashed.hash, salt: hashed.salt,
      shopId, role: "owner", createdAt: new Date().toISOString(),
    };

    // Shops first, on purpose. If the users write below then loses a duplicate-
    // email race, the result is an orphan shop nobody points to -- invisible
    // and harmless, same failure mode as today. The reverse order would leave
    // a user pointing at a missing shop, which can never log in and
    // permanently holds the email.
    // ponytail: orphan shops on a lost signup race. Sweep them if they ever
    // show up in numbers.
    await mutateBlob(supabase, "shops", `auth-gateway:signup:${shopId}`, (shops) => {
      return { next: [...shops, newShop], res: json({ ok: true }, 200, origin) };
    });
    const signupRes = await mutateBlob(supabase, "users", `auth-gateway:signup:${userId}`, (freshUsers) => {
      if (freshUsers.find((u) => String(u.email).toLowerCase() === email)) {
        return { res: json({ error: "Account already exists with this email" }, 409, origin) };
      }
      return { next: [...freshUsers, newUser], res: json({ ok: true }, 200, origin) };
    });
    if (signupRes.status !== 200) return signupRes;

    const token = await signSession({
      userId, shopId, role: "owner", exp: Date.now() + SESSION_TTL_HOURS * 3600000,
    });

    const deviceToken = await signDeviceToken(email, crypto.randomUUID());
    return json({ sessionToken: token, deviceToken, user: sanitizeUser(newUser), shop: newShop }, 200, origin);
  }

  // ── CHANGE PASSWORD (self-service, any authenticated user) ─────────
  if (route === "change-password") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);

    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8) return json({ error: "New password must be at least 8 characters" }, 400, origin);

    // loadActor (not a plain findIndex) so a stale token -- including a
    // thief's, after the real owner changes password elsewhere -- is
    // refused here too, the same way every other privileged route already
    // is. Closes "a thief who knows the old password keeps changing it
    // back" (docs/session-versioning-design.md, Phase 5 item 5).
    const { me } = await loadActor(supabase, session);
    if (!me) return json({ error: ACCESS_CHANGED }, 401, origin);

    const ok = await verifyPassword(currentPassword, String(me.passwordHash), String(me.salt));
    if (!ok) return json({ error: "Current password is incorrect" }, 401, origin);

    const hashed = await hashPassword(newPassword);
    const verifiedHash = String(me.passwordHash);
    // A password change invalidates every OTHER token for this user --
    // bumped in the SAME object spread as the new hash/salt, so it can
    // never land without the password change or vice versa.
    const newVersion = ver(me.sessionVersion) + 1;
    // Re-find and re-check inside `apply`: if two change-password calls for
    // the same user race (two devices, or an attacker holding a stolen
    // session plus the old password), the one that lands SECOND must not
    // silently overwrite the first's new hash with a hash of the password
    // that's no longer current.
    const result = await mutateBlob(supabase, "users", `auth-gateway:change-password:${session.userId}`, (fresh) => {
      const i = fresh.findIndex((u) => u.id === session.userId);
      if (i === -1) return { res: json({ error: "User not found" }, 404, origin) };
      if (fresh[i].passwordHash !== verifiedHash) {
        return { res: json({ error: "Your password was just changed elsewhere — please sign in again" }, 409, origin) };
      }
      fresh[i] = { ...fresh[i], passwordHash: hashed.hash, salt: hashed.salt, mustResetPassword: false, sessionVersion: newVersion };
      return { next: fresh, res: json({ ok: true }, 200, origin) };
    });
    if (result.status !== 200) return result;

    // This device's own token is replaced with one that matches the new
    // version, so the owner isn't signed out by their own password change.
    const token = await signSession({
      userId: session.userId, shopId: session.shopId, role: me.role,
      sessionVersion: newVersion, exp: Date.now() + SESSION_TTL_HOURS * 3600000,
    });
    return json({ ok: true, sessionToken: token }, 200, origin);
  }

  // ── UPDATE SHOP PROFILE (owner only) ────────────────────────────────
  if (route === "update-shop") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);

    const { me } = await loadActor(supabase, session);
    if (!me) return json({ error: ACCESS_CHANGED }, 401, origin);
    if (me.role !== "owner" && me.role !== "manager") {
      return json({ error: "Only the shop owner or a manager can update shop details" }, 403, origin);
    }

    const patch: Record<string, unknown> = {};
    for (const field of ["name", "city", "phone", "gstin", "locale"]) {
      if (typeof body[field] === "string") patch[field] = body[field];
    }
    if (hasMarkup(...Object.values(patch))) return json({ error: NO_MARKUP_ERROR }, 400, origin);

    // The actor check above reads `users` (via loadActor) while this write
    // goes to `shops` -- a leftover TOCTOU (owner demoted between the two)
    // that already existed before this change, milliseconds wide. Accepted,
    // not widened; closing it needs the bigger one-row-per-record restructure
    // (docs/auth-store-cas-audit-design.md section 3, option A, rejected for now).
    return mutateBlob(supabase, "shops", `auth-gateway:update-shop:${session.userId}`, (shops) => {
      const idx = shops.findIndex((s) => s.id === session.shopId);
      if (idx === -1) return { res: json({ error: "Shop not found" }, 404, origin) };
      shops[idx] = { ...shops[idx], ...patch };
      return { next: shops, res: json({ ok: true, shop: shops[idx] }, 200, origin) };
    });
  }

  // ── ADD STAFF (owner only) ────────────────────────────────────────
  if (route === "add-staff") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);

    const { me } = await loadActor(supabase, session);
    if (!me) return json({ error: ACCESS_CHANGED }, 401, origin);
    if (me.role !== "owner") return json({ error: "Only the shop owner can add staff" }, 403, origin);

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    if (!email || !name) return json({ error: "name and email required" }, 400, origin);
    if (hasMarkup(name, email)) return json({ error: NO_MARKUP_ERROR }, 400, origin);

    // Only these three are assignable via invite — "owner" can never be
    // granted this way (there is exactly one owner, set at signup).
    const ALLOWED_ROLES = ["manager", "staff", "readonly"];
    const role = ALLOWED_ROLES.includes(String(body.role)) ? String(body.role) : "staff";

    // Temp password, id and hash generated once, outside `apply` — a CAS
    // retry must hand the owner back the SAME temp password it already
    // reported, not mint a fresh one it then throws away.
    const tempPassword = crypto.randomUUID().slice(0, 12);
    const hashed = await hashPassword(tempPassword);
    const userId = "usr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newUser = {
      id: userId, name, email, passwordHash: hashed.hash, salt: hashed.salt,
      shopId: session.shopId, role, createdAt: new Date().toISOString(), mustResetPassword: true,
    };
    return mutateBlob(supabase, "users", `auth-gateway:add-staff:${session.userId}`, (fresh) => {
      // Re-check the actor role too: a retry must re-run every decision
      // against fresh data, including whether the owner is still an owner.
      // Also re-check sessionVersion: not independently exploitable here
      // (the outer loadActor above already catches a stale token before
      // this closure ever runs), but kept consistent with remove-staff,
      // where the equivalent inner check is load-bearing.
      const actor = fresh.find((u) => u.id === session.userId);
      if (!actor || actor.shopId !== session.shopId || ver(actor.sessionVersion) !== ver(session.sessionVersion)) {
        return { res: json({ error: ACCESS_CHANGED }, 401, origin) };
      }
      if (actor.role !== "owner") return { res: json({ error: "Only the shop owner can add staff" }, 403, origin) };
      if (fresh.find((u) => String(u.email).toLowerCase() === email)) {
        return { res: json({ error: "That email is already registered" }, 409, origin) };
      }
      return { next: [...fresh, newUser], res: json({ ok: true, user: sanitizeUser(newUser), tempPassword }, 200, origin) };
    });
  }

  // ── REMOVE STAFF (owner only, own shop only) ─────────────────────
  if (route === "remove-staff") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);

    // Every check moves inside `apply` so a CAS retry re-checks it against
    // fresh data -- including this closing a small window where an owner
    // demoted mid-request could still have removed someone. This route has
    // NO outer loadActor call (unlike add-staff/update-shop), so the
    // sessionVersion check here is the ONLY place a stale token gets
    // caught -- without it, a thief's token kept working to delete staff
    // (and wipe their device) for up to 6h after a real password change or
    // reset (docs/session-versioning-design.md, Phase 5 item 5).
    const staffUserId = String(body.staffUserId || "");
    return mutateBlob(supabase, "users", `auth-gateway:remove-staff:${session.userId}`, (users) => {
      const me = users.find((u) => u.id === session.userId);
      if (!me || me.shopId !== session.shopId || ver(me.sessionVersion) !== ver(session.sessionVersion)) {
        return { res: json({ error: ACCESS_CHANGED }, 401, origin) };
      }
      if (me.role !== "owner") return { res: json({ error: "Only the shop owner can remove staff" }, 403, origin) };
      const target = users.find((u) => u.id === staffUserId);
      if (!target) return { res: json({ error: "User not found" }, 404, origin) };
      if (target.shopId !== session.shopId) return { res: json({ error: "That user does not belong to your shop" }, 403, origin) };
      if (target.id === session.userId) return { res: json({ error: "You cannot remove yourself" }, 400, origin) };
      return { next: users.filter((u) => u.id !== staffUserId), res: json({ ok: true }, 200, origin) };
    });
  }

  // ── REQUEST PASSWORD RESET ────────────────────────────────────────
  // Always responds the same way whether or not the email has an
  // account — otherwise this endpoint becomes a way to check which
  // emails are registered (account enumeration).
  if (route === "request-password-reset") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!email) return json({ error: "email required" }, 400, origin);

    // Fail closed with no email provider: issuing a code we cannot deliver
    // only creates a credential nobody asked for. This is checked before
    // the user lookup on purpose — it depends on deployment config, not on
    // whether the address is registered, so it can't be used to enumerate
    // accounts the way a 503 after the lookup could.
    if (!RESEND_API_KEY) {
      console.error("[auth-gateway] request-password-reset: RESEND_API_KEY is not set — refusing to issue a code that cannot be delivered.");
      return json({ error: "Password reset is unavailable right now. Please contact support." }, 503, origin);
    }

    const GENERIC_OK = {
      ok: true,
      message: "If an account exists for that email, a reset code has been sent.",
    };

    // Per-email rate limit — separate from login_attempts, same idea:
    // counted server-side so a page refresh can't reset it.
    const windowStart = new Date(Date.now() - 60 * 60000).toISOString();
    const { count } = await supabase
      .from("password_reset_tokens")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= RESET_MAX_REQUESTS_PER_HOUR) {
      // Still return the generic message — don't reveal rate-limit
      // state to a potential enumerator either.
      return json(GENERIC_OK, 200, origin);
    }

    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    const user = users.find((u) => String(u.email).toLowerCase() === email);

    if (user) {
      const code = generateResetCode();
      const codeHash = await sha256Hex(code);
      await supabase.from("password_reset_tokens").insert({
        email,
        code_hash: codeHash,
        expires_at: new Date(Date.now() + RESET_CODE_TTL_MIN * 60000).toISOString(),
      });
      if (!await sendResetEmail(email, code)) {
        // Undeliverable, so retire it rather than leaving a live code the
        // owner never received — it would also burn one of their three
        // requests an hour. The response below stays GENERIC_OK even now:
        // a send is only attempted for addresses that exist, so reporting
        // this failure to the caller would reveal that the account does.
        await supabase.from("password_reset_tokens")
          .delete().eq("email", email).eq("code_hash", codeHash);
      }
    }
    // If no user matched, do nothing — but still return GENERIC_OK below,
    // and note we deliberately skip the insert+send so no code exists to
    // brute-force for an email that was never registered.

    return json(GENERIC_OK, 200, origin);
  }

  // ── RESET PASSWORD (consume a code from the request above) ─────────
  if (route === "reset-password") {
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const newPassword = String(body.newPassword || "");
    if (!email || !code || !newPassword) {
      return json({ error: "email, code, and newPassword are required" }, 400, origin);
    }
    if (newPassword.length < 8) return json({ error: "New password must be at least 8 characters" }, 400, origin);

    // One locked database call checks the guess against the newest code only,
    // counts it if wrong (burning the code at RESET_MAX_GUESSES), and consumes
    // it if right — see migrations/003_reset_code_guess_limit.sql. Doing this
    // as separate select/update calls here would let parallel guesses race
    // past the cap.
    const codeHash = await sha256Hex(code);
    const { data: consumed, error: consumeErr } = await supabase.rpc("consume_password_reset_code", {
      p_email: email,
      p_code_hash: codeHash,
      p_max_attempts: RESET_MAX_GUESSES,
    });
    if (consumeErr) {
      console.error("[auth-gateway] consume_password_reset_code failed:", consumeErr.message);
      return json({ error: "Could not check that code. Please try again." }, 500, origin);
    }
    if (consumed !== true) {
      return json({ error: "That code is invalid or has expired. Request a new one." }, 401, origin);
    }

    const hashed = await hashPassword(newPassword);
    // Proving control of the inbox counts as owner-level proof, same as a
    // successful login — issue a device token so this device gets its own
    // throttle bucket from now on (docs/login-lockout-design.md).
    const deviceToken = await signDeviceToken(email, crypto.randomUUID());
    return mutateBlob(supabase, "users", `auth-gateway:reset-password:${email}`, (fresh) => {
      const idx = fresh.findIndex((u) => String(u.email).toLowerCase() === email);
      if (idx === -1) {
        // Shouldn't happen (token only issued for a real user), but don't
        // leak that distinction to the caller.
        return { res: json({ error: "That code is invalid or has expired. Request a new one." }, 401, origin) };
      }
      // Account recovery is the strongest "someone else may have my
      // password" signal there is -- bump sessionVersion here too, in the
      // same spread, so every token issued before this reset stops working
      // (docs/session-versioning-design.md). No token is returned from this
      // route, so there's no "own device" to carry forward, unlike
      // change-password.
      fresh[idx] = {
        ...fresh[idx], passwordHash: hashed.hash, salt: hashed.salt, mustResetPassword: false,
        sessionVersion: ver(fresh[idx].sessionVersion) + 1,
      };
      return { next: fresh, res: json({ ok: true, deviceToken }, 200, origin) };
    });
  }

  return json({ error: "unknown route" }, 404, origin);
});
