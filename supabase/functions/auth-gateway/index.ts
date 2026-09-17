// ══════════════════════════════════════════════════════════════════════
// auth-gateway — replaces direct client REST access to `auth_store`.
//
// Fixes two audit findings at once:
//  1. "Login rate limiting is client-side only (resets on reload)" —
//     failed attempts are now counted in the login_attempts table, which
//     a page refresh can't touch.
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
//   /auth-gateway/login                  { email, password }
//   /auth-gateway/add-staff              { sessionToken, name, email }
//   /auth-gateway/remove-staff           { sessionToken, staffUserId }
//   /auth-gateway/request-password-reset { email }
//   /auth-gateway/reset-password         { email, code, newPassword }
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
const LOCKOUT_WINDOW_MIN = 15;
const SESSION_TTL_HOURS = 12;
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

// ── auth_store helpers (service-role only, past the RLS lockdown) ──────
async function getBlob(supabase: ReturnType<typeof createClient>, id: "users" | "shops") {
  const { data, error } = await supabase.from("auth_store").select("data").eq("id", id).limit(1);
  if (error) throw error;
  return data && data.length ? (data[0].data as unknown[]) : [];
}
async function putBlob(supabase: ReturnType<typeof createClient>, id: "users" | "shops", arr: unknown[]) {
  const { error } = await supabase.from("auth_store").upsert({ id, data: arr }, { onConflict: "id" });
  if (error) throw error;
}

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

    // Server-side rate limit — cannot be reset by refreshing the page.
    const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60000).toISOString();
    const { count } = await supabase
      .from("login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("email", email)
      .eq("succeeded", false)
      .gte("created_at", windowStart);
    if ((count ?? 0) >= MAX_FAILED_ATTEMPTS) {
      return json({ error: `Too many failed attempts. Try again in ${LOCKOUT_WINDOW_MIN} minutes.` }, 429, origin);
    }

    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    const user = users.find((u) => String(u.email).toLowerCase() === email);
    const ok = user ? await verifyPassword(password, String(user.passwordHash), String(user.salt)) : false;

    await supabase.from("login_attempts").insert({ email, ip, succeeded: ok });

    if (!ok || !user) return json({ error: "Invalid email or password" }, 401, origin);

    const shops = (await getBlob(supabase, "shops")) as Record<string, unknown>[];
    const shop = shops.find((s) => s.id === user.shopId);
    if (!shop) return json({ error: "Shop not found for this account" }, 500, origin);

    const token = await signSession({
      userId: user.id,
      shopId: user.shopId,
      role: user.role,
      exp: Date.now() + SESSION_TTL_HOURS * 3600000,
    });

    return json({ sessionToken: token, user: sanitizeUser(user), shop }, 200, origin);
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

    const shops = (await getBlob(supabase, "shops")) as unknown[];
    await putBlob(supabase, "shops", [...shops, newShop]);
    await putBlob(supabase, "users", [...users, newUser]);

    const token = await signSession({
      userId, shopId, role: "owner", exp: Date.now() + SESSION_TTL_HOURS * 3600000,
    });

    return json({ sessionToken: token, user: sanitizeUser(newUser), shop: newShop }, 200, origin);
  }

  // ── CHANGE PASSWORD (self-service, any authenticated user) ─────────
  if (route === "change-password") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);

    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 8) return json({ error: "New password must be at least 8 characters" }, 400, origin);

    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    const idx = users.findIndex((u) => u.id === session.userId);
    if (idx === -1) return json({ error: "User not found" }, 404, origin);

    const ok = await verifyPassword(currentPassword, String(users[idx].passwordHash), String(users[idx].salt));
    if (!ok) return json({ error: "Current password is incorrect" }, 401, origin);

    const hashed = await hashPassword(newPassword);
    users[idx] = { ...users[idx], passwordHash: hashed.hash, salt: hashed.salt, mustResetPassword: false };
    await putBlob(supabase, "users", users);

    return json({ ok: true }, 200, origin);
  }

  // ── UPDATE SHOP PROFILE (owner only) ────────────────────────────────
  if (route === "update-shop") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);
    if (session.role !== "owner" && session.role !== "manager") {
      return json({ error: "Only the shop owner or a manager can update shop details" }, 403, origin);
    }

    const shops = (await getBlob(supabase, "shops")) as Record<string, unknown>[];
    const idx = shops.findIndex((s) => s.id === session.shopId);
    if (idx === -1) return json({ error: "Shop not found" }, 404, origin);

    const patch: Record<string, unknown> = {};
    for (const field of ["name", "city", "phone", "gstin", "locale"]) {
      if (typeof body[field] === "string") patch[field] = body[field];
    }
    if (hasMarkup(...Object.values(patch))) return json({ error: NO_MARKUP_ERROR }, 400, origin);
    shops[idx] = { ...shops[idx], ...patch };
    await putBlob(supabase, "shops", shops);

    return json({ ok: true, shop: shops[idx] }, 200, origin);
  }

  // ── ADD STAFF (owner only) ────────────────────────────────────────
  if (route === "add-staff") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);
    if (session.role !== "owner") return json({ error: "Only the shop owner can add staff" }, 403, origin);

    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    if (!email || !name) return json({ error: "name and email required" }, 400, origin);
    if (hasMarkup(name, email)) return json({ error: NO_MARKUP_ERROR }, 400, origin);

    // Only these three are assignable via invite — "owner" can never be
    // granted this way (there is exactly one owner, set at signup).
    const ALLOWED_ROLES = ["manager", "staff", "readonly"];
    const role = ALLOWED_ROLES.includes(String(body.role)) ? String(body.role) : "staff";

    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    if (users.find((u) => String(u.email).toLowerCase() === email)) {
      return json({ error: "That email is already registered" }, 409, origin);
    }

    // Temp password — owner shares this out-of-band; user should change it
    // on first login (existing client flow already supports forced reset).
    const tempPassword = crypto.randomUUID().slice(0, 12);
    const hashed = await hashPassword(tempPassword);
    const userId = "usr_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newUser = {
      id: userId, name, email, passwordHash: hashed.hash, salt: hashed.salt,
      shopId: session.shopId, role, createdAt: new Date().toISOString(), mustResetPassword: true,
    };
    await putBlob(supabase, "users", [...users, newUser]);

    return json({ ok: true, user: sanitizeUser(newUser), tempPassword }, 200, origin);
  }

  // ── REMOVE STAFF (owner only, own shop only) ─────────────────────
  if (route === "remove-staff") {
    const session = await verifySession(String(body.sessionToken || ""));
    if (!session) return json({ error: "Session expired — please sign in again" }, 401, origin);
    if (session.role !== "owner") return json({ error: "Only the shop owner can remove staff" }, 403, origin);

    const staffUserId = String(body.staffUserId || "");
    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    const target = users.find((u) => u.id === staffUserId);
    if (!target) return json({ error: "User not found" }, 404, origin);
    if (target.shopId !== session.shopId) {
      return json({ error: "That user does not belong to your shop" }, 403, origin);
    }
    if (target.id === session.userId) return json({ error: "You cannot remove yourself" }, 400, origin);

    await putBlob(supabase, "users", users.filter((u) => u.id !== staffUserId));
    return json({ ok: true }, 200, origin);
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

    const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
    const idx = users.findIndex((u) => String(u.email).toLowerCase() === email);
    if (idx === -1) {
      // Shouldn't happen (token only issued for a real user), but don't
      // leak that distinction to the caller.
      return json({ error: "That code is invalid or has expired. Request a new one." }, 401, origin);
    }

    const hashed = await hashPassword(newPassword);
    users[idx] = { ...users[idx], passwordHash: hashed.hash, salt: hashed.salt, mustResetPassword: false };
    await putBlob(supabase, "users", users);

    return json({ ok: true }, 200, origin);
  }

  return json({ error: "unknown route" }, 404, origin);
});
