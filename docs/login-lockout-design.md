# Login lockout fix: atomic throttle, and a stranger can't lock an owner out

Status: proposal, 11 Oct 2026. Risk class: 🔴 (auth/security, schema change: MODEL-POLICY §8).
No code written. Design by Opus; implementation is for a Sonnet session, then an independent
review of the diff (`jewelos-security-auditor`, per CLAUDE.md agent routing). Cowork applies the
migration.
Destination: `Desktop\jewelos\docs\login-lockout-design.md`. The HANDOFF entry is separate.

Scope: HANDOFF 10 Oct Phase 5, item 6. That means the `login` route in
`supabase/functions/auth-gateway/index.ts` (lines 231-269 as of today), plus the smallest
supporting changes it needs: one new table and function (migration 009 — see numbering note
below), a few lines in the `signup` and `reset-password` responses, and one client function
(`authGatewayCall`). Items 5 (session versioning) and 7/8 (`auth_store` CAS + audit) are **not**
reopened here. Section 6 covers where this touches them.

**Numbering note (added after this doc was written, by the Sonnet session that dispatched this
design):** this doc was written in parallel with `docs/auth-store-cas-audit-design.md`, which also
claimed migration 008 and reasoned it should land first (session-versioning's implementation will
build on its `mutateBlob` helper). Resolved: **`auth_store` CAS + history is 008, this is 009.**
Every `008` below referring to this design's own table/function is renumbered to `009` and the
filename to `009_login_throttle.sql`. This is a numbering fix only — no part of this design's
logic changed.

---

## For Tanish, in plain words

There are two problems with how the login screen blocks password guessing today.

1. **The limit can be skipped.** The server is supposed to allow 5 wrong passwords and then block
   the email for 15 minutes. But it counts the earlier wrong attempts *before* writing down the
   current one. If someone sends 50 guesses at the same instant, all 50 see "0 wrong so far" and
   all 50 get checked. The limit only works against people who guess one at a time.
2. **Anyone can lock you out of your own shop.** The block is attached to the email address and
   nothing else. Your email is printed on invoices and business cards. A stranger who types it
   with 5 wrong passwords locks *you* out for 15 minutes. They can repeat that forever, from
   anywhere, without ever knowing your password.

The fix has two parts:

- **Count first, then check.** The database records the attempt and makes the decision in one
  step that can't be interrupted, so 50 simultaneous guesses still get exactly 5 checks. This is
  the same technique that already protects password-reset codes (migration 003).
- **Your own phone gets its own lane.** When you sign in successfully, your phone is given a
  signed "this device has signed in here before" pass. A stranger hammering your email fills up
  the lane for *unknown* devices only. Your phone stays in its own lane and is never blocked by
  them. The pass doesn't let anyone in: it only decides which lane you queue in, and you still
  need the password.

For people guessing from devices the server doesn't know, the block now gets longer each time it
triggers: 15 minutes, then 30, then an hour, and so on up to 24 hours. Someone trying to guess
your password gets about 5 tries a day instead of about 480. If you're ever blocked on a **new**
phone while somebody is attacking your email, "Forgot password" gets you in. Proving you own the
inbox also gives that new phone its pass.

---

## 1. Root cause (confirmed against current code, 11 Oct)

`auth-gateway/index.ts`, `login` route:

| Line | What happens |
|---|---|
| 54-55 | `MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_WINDOW_MIN = 15` |
| 222 | `ip = x-forwarded-for \|\| "unknown"`, captured for every route |
| 238-244 | `select count` from `login_attempts` where `email = ?` and `succeeded = false` and the row is within the last 15 min |
| 245-246 | `count >= 5` returns `429` |
| 249-251 | load the `users` blob, then PBKDF2-verify the password (100k iterations, around 50-100 ms) |
| 253 | `insert into login_attempts { email, ip, succeeded }` |

**Bug A (race).** The read (238) and the write (253) are separate round-trips, and the slowest
step in the whole request (PBKDF2) sits between them. Every request in a parallel burst reads the
same pre-burst count, passes the check, and inserts its row only after its own verify. So the cap
limits *sequential* guessing, not *concurrent* guessing. It's the same check-then-act class that
migration 002 fixed for `store` and migration 003 fixed for reset codes.

**Bug B (no device/IP component).** The count is filtered only by `.eq("email", email)`. `ip` is
stored on line 253 but never read. Five requests per 15 minutes, which is about 480 a day, is
enough to keep any owner locked out permanently. It costs the attacker nothing and needs no
knowledge of the password.

**A third, smaller defect the fix also removes:** a successful login doesn't reset anything.
Failures before a success still count toward the next 15-minute window, so 4 typos, then a
successful login, then 1 typo locks you out. This is probably part of the shared-test-shop e2e
flake noted in HANDOFF (line ~2831) and in `tests/e2e/session-restore.spec.js` line 90.

## 2. The two threats, stated so a design can be checked against them

- **T1, fast automated guessing** against one known email. Today that's about 480 guesses a day
  sequentially, unbounded in parallel. Passwords are at least 8 characters, and owners do pick
  things like `jewel123`.
- **T2, stranger-initiated lockout (DoS).** Someone with only the email address denies the real
  owner access.

A good design bounds T1 tightly **and** makes T2 impossible against the owner's normal device,
without needing anything we can't verify, such as whether the IP header is trustworthy.

## 3. Options considered

### The mechanism question has one answer: an atomic Postgres function

HANDOFF floated "a single atomic RPC like 003, **or** a growing per-email delay". Those aren't
alternatives. The first is a *mechanism* and the second is a *policy*. A growing delay computed
from a count that's read before the attempt is recorded has exactly the same race: 50 parallel
requests all read "delay = 0" and all go through. Whatever the policy, the count-and-decide step
must be one locked statement. That's settled, so the real choices are what to lock on (section
3.1) and what policy to enforce (section 3.2).

### 3.1 What to lock on

**(a) Recommended: a new `login_throttle` table, one row per throttle key.** This is the same
move migration 002 made when it gave counters their own `counters` table instead of deriving
them from history. The function takes a `for update` lock on that row, exactly like 003 does on
the reset-token row. A row is small, the lock is per key (attacks on two emails never wait for
each other), and the row can hold the escalation state (`lockouts`, `locked_until`) that a policy
needs.

**(b) Rejected: keep counting `login_attempts`, guarded by `pg_advisory_xact_lock(hashtext(email))`.**
This works for the race, but:
- The attempt would have to be inserted as `succeeded = false` *before* the password check, and
  then updated afterwards. That mixes the audit log with enforcement, and a crash in between
  leaves a false "failed" record.
- Every login runs a `count(*)` whose cost grows with attack volume. Escalation ("this is the
  3rd lock in a row") would have to be reconstructed from history on every request.
- Advisory-lock keys are a hashed `bigint`, so two emails can collide and serialize each other
  (harmless, but surprising).

**`login_attempts` stays exactly as it is: one row per *checked* attempt, as the audit/forensic
log.** It keeps `ip`. Nothing reads it to make a decision any more. Refused attempts (429) are
still not logged there, same as today. They show up in the Edge Function logs.

### 3.2 Policy: email+IP vs. growing delay vs. what I recommend

**Option P1, key on email+IP (rejected).**
- *Defeats T2 from a single IP*: the attacker only locks their own IP.
- *Fails T1 against anyone who rotates IPs.* A proxy list or a phone toggling airplane mode on
  Jio's carrier-grade NAT gives a fresh IP each time, so each IP gets 5 guesses and there's no
  cap at all. To stop that you need a per-email ceiling as well, and that ceiling **brings back
  T2** for exactly the attacker who can rotate IPs.
- *It also rests on something I can't verify from this repo:* whether `x-forwarded-for` at
  Supabase's edge is overwritten by the proxy or appended to. If it's appended, line 222 stores
  the whole client-controllable string, and an attacker gets a "new IP" just by sending a
  different header. Building a security key on an unverified header is the wrong foundation.
- *Legitimate-owner cost:* small (an owner on mobile data whose IP changes simply gets a new
  bucket), but that's irrelevant given the two problems above.

**Option P2, growing per-email delay with no hard lock (rejected).** For example 1 s, 2 s,
4 s... capped at 60 s, and reset on success. The HANDOFF framing assumed this "denies neither
the owner nor lets an attacker guess fast". **That premise is wrong on both counts:**
- *T2 isn't defeated, it's just made continuous.* A per-email delay means the email has one open
  "slot" every N seconds. An attacker's script fires the moment each slot opens, and it beats a
  human every time. So the owner is starved indefinitely, at a cost to the attacker of 1 request
  per minute, about 1,440 a day. That's comparable to today's lockout DoS (480 a day), and
  arguably worse, because it never ends on its own.
- *T1 gets weaker, not stronger.* A 60-second cap allows about 1,440 guesses a day against
  today's 480. Making the cap large enough to matter (say 1 hour) just turns P2 back into a lock.

**Option P3, recommended: a per-email lock that escalates, plus a separate bucket for known
devices.**

The real problem is that "the owner" and "the attacker" look identical to the server: same
email, possibly the same IP, nothing else to tell them apart. Delays and IP keys can't separate
them. **The only thing that reliably separates them is that the owner has signed in from this
device before and the attacker hasn't.** OWASP calls this "device cookies". So:

- **Key `e:<email>`, unknown devices.** Every 5th counted failure starts a lock of
  **15 min × 2^n**, capped at **24 h**: 15, 30, 60, 120, 240, 480, 960 min, then 1440 from then on.
  Attempts made during a lock are refused **and not counted**, so hammering neither extends the
  lock nor escalates it. After **24 h of quiet** (no counted attempt and no lock active) the key is
  forgotten. A correct password deletes the row.
- **Key `d:<email>|<device id>`, a device holding a valid device token for *this* email.** It
  uses the same function and the same numbers, but it's a separate row. Nobody can fill this
  bucket without the token, and the token can only come from this device having signed in
  successfully (or reset the password through the emailed code).
- **IP is not part of any key.** It's still recorded in `login_attempts` for forensics, and that's
  all.

**How P3 handles each threat:**

| | Today | P3 |
|---|---|---|
| T1, sequential, unknown device | about 480/day | 40 in the first ~32 h (8 locks × 5), then **5/day** |
| T1, parallel burst | unbounded | **exactly 5** per lock period (atomic) |
| T1, IP rotation | same as sequential | same as sequential (IP isn't a key, so rotating gains nothing) |
| T1, attacker pauses to reset | n/a | needs 24 h of quiet *after* the lock ends, so pausing gains nothing over 5/day |
| T2 against the owner's usual device | locked 15 min, repeatable forever | **impossible**: the attacker can't touch the `d:` row |
| T2 against the owner on a **new** device | locked 15 min | locked up to 24 h. **Escape hatch:** Forgot Password, which returns a device token for that device |
| The owner's own typos | 5 → 15 min (and a success doesn't reset) | 5 → 15 min; a success resets |

**New risks P3 introduces, and why they're acceptable:**

- *Token-type confusion* (a device token used as a session, or the reverse). This is prevented
  by **domain separation**: device tokens are HMAC-signed over `"device." + body`, sessions over
  the bare `body`. Neither can verify as the other, and `verifySession` in auth-gateway and in
  store-proxy is untouched. There's a test for it (section 7).
- *A device token that isn't bound to an email would be a bypass*: an attacker signs up their
  own free account, collects a token, and uses it as a fresh bucket against the victim's email,
  minting a new one whenever needed. **So the token must carry the email, and the server must
  check `payload.email === email`.** This is the one line the reviewer should look at hardest.
- *A device token stolen through XSS* gives the thief a separate bucket with the same caps. The
  same XSS already gets the 6-hour session token from localStorage, which is strictly worse, so
  this adds nothing meaningful.
- *Success on the `e:` key clears the attacker's escalation.* If the owner habitually signs in
  from unknown devices, each such sign-in gives the attacker a fresh 15-minute curve. The bound
  is about 5 guesses per owner unknown-device sign-in. That's acceptable, and it shrinks as
  owners' devices pick up tokens.
- *Escape-hatch DoS (pre-existing, not introduced here):* an attacker can also request reset
  codes (3 an hour) and burn each with 5 wrong guesses (migration 003). An owner on a new device
  during a *combined* attack could be stuck until the attacker stops. That's out of scope; listed
  in section 9 as a follow-up.

## 4. Recommended design

### 4.1 Table and function (full SQL in the Migration checklist at the end)

```
login_throttle(key text primary key, failures int, lockouts int,
               locked_until timestamptz, last_attempt_at timestamptz)

login_throttle_take(p_key text, p_max_failures int,
                    p_base_lock_min int, p_max_lock_min int) returns integer
  -- 0  = go ahead; this attempt has been counted
  -- >0 = refused; seconds until the lock lifts (nothing counted)
```

The structure mirrors 003 line for line: declare locals, make sure the row exists
(`insert ... on conflict do nothing`), `select ... for update`, decide, `update`, return.

**"Count pessimistically, forgive on success."** Unlike 003, the secret check (PBKDF2 over a
user record in the `auth_store` JSON blob) can't move into SQL. So the function counts *every*
attempt as a failure before the password is checked, and the route deletes the row when the
password turns out to be right. The 5th counted attempt sets the lock **and is still allowed
through**, because it might be the right password, and a success deletes the lock along with the
row. With 10 parallel requests: numbers 1-5 return 0 (the 5th sets `locked_until`), and 6-10
block on the row lock, then see `locked_until > now()` and get refused. Exactly 5 PBKDF2 checks
run.

Success clears **only the key that was used**. A sign-in from the owner's phone (`d:` key) must
*not* clear `e:<email>`. Otherwise every owner sign-in would hand the attacker 5 fresh guesses.

### 4.2 Device token

- Format: `base64url(JSON{email, did, exp}) + "." + base64url(HMAC_SESSION_SECRET("device." + body))`.
  `did` is a `crypto.randomUUID()`. `exp` is 180 days out.
- **Issued** on: successful `login` (keeping the same `did` if the request already presented a
  valid token, so the device keeps its bucket), `signup`, and successful `reset-password`
  (proving control of the inbox counts as owner-level proof).
- **Read** only by `login`. If the token is missing, garbage, expired, signed for another email,
  or is a session token, the request falls back silently to the `e:` key. Verification must
  never throw, because `atob` on garbage does, so wrap it in `try/catch`.
- **No server-side storage and no revocation.** The token grants no access, only a queue lane,
  so there's nothing worth revoking.
- **Client:** stored per email in one localStorage key, `jewelos_login_devices` (a JSON map from
  email to token). It's deliberately **not** `shopScopedKey()`: it exists before any shop is
  known, and it must **survive sign-out** (`_clearDeviceSession` in `05-auth-login.js:158`
  removes a fixed list of keys, so a new key survives it automatically). The whole client change
  sits in `authGatewayCall` (`04-orders-detail.js:1956`), the one function all four auth calls
  go through: login, re-auth, signup, reset. No call site changes.

### 4.3 Constants (auth-gateway)

```ts
const MAX_FAILED_ATTEMPTS = 5;        // unchanged
const BASE_LOCK_MIN = 15;             // replaces LOCKOUT_WINDOW_MIN (first lock length)
const MAX_LOCK_MIN = 24 * 60;         // locks double up to this; also the quiet period that forgets a key
const DEVICE_TOKEN_DAYS = 180;
```

## 5. Exact diff shape for the `login` route

Replaces lines 237-255 (from the rate-limit comment through the 401) and the success `return` on
line 268. Lines 233-235 and 257-266 are unchanged.

```ts
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
    if (throttleErr) {
      // Fail closed, same as reset-password: without the throttle, every
      // guess would be free. Already signed-in sessions are unaffected.
      console.error("[auth-gateway] login_throttle_take failed:", throttleErr.message);
      return json({ error: "Could not sign in right now. Please try again in a minute." }, 503, origin);
    }
    if (typeof waitSec === "number" && waitSec > 0) {
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
    const ok = user ? await verifyPassword(password, String(user.passwordHash), String(user.salt)) : false;

    // Audit log only — nothing reads this to decide anything any more.
    await supabase.from("login_attempts").insert({ email, ip, succeeded: ok });

    if (!ok || !user) return json({ error: "Invalid email or password" }, 401, origin);

    // Right password: forget THIS key's failures and lock. Never clear the
    // e: key from a device-token sign-in — that would hand an attacker 5
    // fresh guesses every time the owner signs in on their phone.
    const { error: clearErr } = await supabase.from("login_throttle").delete().eq("key", throttleKey);
    if (clearErr) console.error("[auth-gateway] login_throttle clear failed:", clearErr.message);

    // ... lines 257-266 unchanged (shop lookup, signSession) ...

    const deviceToken = await signDeviceToken(email, did || crypto.randomUUID());
    return json({ sessionToken: token, deviceToken, user: sanitizeUser(user), shop }, 200, origin);
```

**Where the decision plugs in:** `waitSec > 0` is the only path to the existing `429`, and the
client already shows `err.data.error` for 429 in both places (`05-auth-login.js:60` and `:270`),
so the client needs no change for the new message. `waitSec === 0` falls through to the normal
auth flow unchanged. An RPC error is a new `503`. The client's generic branch already shows
"Could not sign in (server error 503)..." and, correctly, does *not* count it as a wrong password.

**New helpers**, placed directly after `verifySession` (around line 137):

```ts
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
```

**`signup`** (line 311): add `deviceToken: await signDeviceToken(email, crypto.randomUUID())` to
the response object.
**`reset-password`** (line 527): `return json({ ok: true, deviceToken: await signDeviceToken(email, crypto.randomUUID()) }, 200, origin);`.

**Client, `js/04-orders-detail.js`, `authGatewayCall` only** (ES5):

```js
// Device token (docs/login-lockout-design.md): one per browser per email.
// Not shop state, so deliberately NOT shopScopedKey(); and deliberately left
// alone by sign-out (_clearDeviceSession) — surviving sign-out is the point.
var LOGIN_DEVICES_KEY = 'jewelos_login_devices';
function _loginDevices(){
  try{ return JSON.parse(localStorage.getItem(LOGIN_DEVICES_KEY) || '{}') || {}; }catch(e){ return {}; }
}
function authGatewayCall(route, body){
  body = body || {};
  var em = String(body.email || '').trim().toLowerCase();
  if(route === 'login' && em){ var dt = _loginDevices()[em]; if(dt) body.deviceToken = dt; }
  return fetch(/* ...unchanged... */ JSON.stringify(body)).then(function(r){
    return r.json().then(function(data){
      if(!r.ok) throw /* ...unchanged... */;
      if(data && data.deviceToken && em){
        var m = _loginDevices(); m[em] = data.deviceToken;
        try{ localStorage.setItem(LOGIN_DEVICES_KEY, JSON.stringify(m)); }catch(e){}
      }
      return data;
    });
  });
}
```

The client-side 60-second lock in `05-auth-login.js` (`_recordLoginFailure`) stays. It's harmless
UX, and the server is the real limit. Its "N attempt(s) remaining" text was already only an
estimate. Leave it alone.

## 6. Interaction with items 7/8 (`auth_store` CAS + audit) and item 5

I checked for `docs/auth-store-cas-audit-design.md`, but it doesn't exist yet, so this is based on
HANDOFF's description of it. **The two designs share no table:** this one touches
`login_throttle`/`login_attempts`, that one touches `auth_store`/`store`/`store_history`. The
only overlap is textual: both edit the `signup` and `reset-password` handlers in
`auth-gateway/index.ts` (this one adds `deviceToken` to their responses, that one rewrites their
`putBlob` calls). **Land them one after the other, not in parallel branches.** Issue the device
token only *after* the CAS write succeeds, which the placements above already do. Item 5
(session versioning) doesn't affect this: device tokens aren't sessions, and the domain
separation means a future `sessionVersion` check never sees them.

## 7. Test plan

Both harnesses already exist. **No new test infrastructure is needed.**

### 7.1 `tests/edge-functions.test.js`: the real handler, RPC modelled in JS

Add `login_throttle: []` to `makeDb()`, a `throttleModel(db, args)` mirroring the SQL (as
`consumeModel` mirrors 003), and an `rpc` branch for `login_throttle_take`. The existing
`.delete().eq()` fake already handles the success-clear. Same limitation as today, stated in the
file header: this proves the *route's ordering and wiring* against a synchronous (and therefore
atomic) model, not Postgres locking.

```js
function throttleModel(db, a) {
  var now = Date.now(), r = db.login_throttle.find(function (x) { return x.key === a.p_key; });
  if (!r) { r = { key: a.p_key, failures: 0, lockouts: 0, locked_until: null, last_attempt_at: now }; db.login_throttle.push(r); }
  if (r.locked_until && r.locked_until > now) return Math.max(1, Math.ceil((r.locked_until - now) / 1000));
  if (Math.max(r.last_attempt_at, r.locked_until || 0) <= now - a.p_max_lock_min * 60000) { r.failures = 0; r.lockouts = 0; }
  r.failures++;
  if (r.failures >= a.p_max_failures) {
    r.locked_until = now + Math.min(a.p_max_lock_min, a.p_base_lock_min * Math.pow(2, Math.min(r.lockouts, 16))) * 60000;
    r.lockouts++; r.failures = 0;
  }
  r.last_attempt_at = now;
  return 0;
}
```

New tests. Each one asserts exact values. Use a dedicated owner signed up for these tests, and
keep the signup response's `deviceToken` as `devTok`.

1. **The race (bug A). This must fail on today's code.** Fire 10 wrong-password logins with
   `Promise.all`. Expect exactly **5 × 401 and 5 × 429**, and exactly **5** `login_attempts` rows
   for that email. Then the *right* password with no device token: **429**. (Today's code gives
   10 × 401, 10 rows, then 200.)
2. **A different IP doesn't matter.** While test 1's lock is active: right password, header
   `x-forwarded-for: 203.0.113.9`, no device token. Expect **429**.
3. **The owner's device is immune (bug B).** While still locked: right password plus `devTok`.
   Expect **200**, the response carries a `deviceToken` whose payload `did` equals `devTok`'s, and
   the `e:<email>` row is **still locked** (its `locked_until` is unchanged).
4. **A device token for another email gives no bypass.** Sign up a second account, take its
   token, and present it on the locked email with the right password. Expect **429**.
5. **No token confusion.** (a) The owner's `sessionToken` presented as `deviceToken` on the
   locked email gives **429**. (b) `devTok` as `x-session-token` to store-proxy GET gives **401**.
   (c) `devTok` as `sessionToken` to `change-password` gives **401**.
6. **Garbage tokens don't crash anything.** `deviceToken` values of `'abc'`, `'a.b.c'` and
   `'!!!.###'` on an unlocked email with a wrong password each give **401** (not 500).
7. **Success resets the counter.** On a fresh email: 4 wrong, then right (**200**), then 5 wrong
   (all **401**), then a 6th (**429**).
8. **The 5th attempt is still evaluated.** On a fresh email: 4 wrong, then right on the 5th gives
   **200**, and there's no row for that key afterwards.
9. **Escalation.** After a lock, set the model row's `locked_until = Date.now() - 1`, then 5 wrong
   and a 6th. The 6th's `retryAfterSec` is between **1741 and 1800** (30 min).
10. **Fail closed.** Set `db.fail['rpc:login_throttle_take']` and try the right password. Expect
    **503**, and the `login_attempts` row count is unchanged (the password was never checked).
11. **Issuance.** `signup` and a successful `reset-password` both return a `deviceToken` that
    passes test 3's check for their email.

Every existing test must stay green, in particular the top-of-file staff login and the
reset-password tests.

### 7.2 `tests/sql-login-throttle.test.mjs`: new file, same pattern as `sql-inv-counter-floor.test.mjs`

Real Postgres (PGlite). Create the roles, then `exec` the whole of `009_login_throttle.sql`.
Asserts:
- 4 calls on `'e:a'` return `0`. The 5th returns `0` and sets `locked_until` to roughly
  now + 15 min. The 6th returns between 899 and 900, and `failures`/`lockouts` are **unchanged**
  by the 6th (refused attempts aren't counted).
- Escalation: after `update ... set locked_until = now() - interval '1 second'`, the next 5 calls
  set a 30-minute lock, then a 60-minute one. With `lockouts = 7` the lock is 1440 minutes, and
  with `lockouts = 20` it's still 1440 (capped, no overflow).
- Quiet reset: set `last_attempt_at` and `locked_until` to `now() - interval '25 hours'`. The
  next call leaves `failures = 1, lockouts = 0`. With `locked_until = now() - interval '23 hours'`
  there's **no** reset.
- Independence: with `'e:a'` locked, `'e:b'` and `'d:a|x'` both return `0`.
- Best effort: `set role anon; select login_throttle_take(...)` raises a permission error.

**Honest limit:** PGlite is a single connection, so it proves the function's logic, not that
`for update` serialises real concurrent sessions. That guarantee comes from Postgres semantics
(the same argument 002 and 003 rely on) and from 7.3.

### 7.3 Live concurrency check (post-deploy, the only real proof of bug A)

Claude Code runs a one-off Node script, which isn't committed. It fires **20 parallel** `login`
POSTs at the deployed auth-gateway for a **non-existent** email
`throttle-race-<timestamp>@example.invalid` with any password. Expect **exactly 5 × 401 and
15 × 429**. No real account is involved. Then Cowork cleans up:
`delete from login_throttle where key like 'e:throttle-race-%'; delete from login_attempts where email like 'throttle-race-%';`

### 7.4 Existing suites

`check.bat` (`backup-check` and `roundtrip` clean), `node tests/regression.test.js`, and e2e
`auth.spec.js` plus `session-restore.spec.js` against the shared test shop. Expect *fewer*
lockout flakes than before, because a success now resets the counter. A fresh Playwright context
has no device token, so it always uses the `e:` key. That's fine, because each run includes a
successful login, which clears it.

## 8. Rollout order and rollback

1. **Cowork applies 009** (after 008, `auth_store` CAS + history — see numbering note at top).
   It's additive. The deployed auth-gateway never touches the new table,
   so nothing changes yet.
2. **Deploy auth-gateway.** It **must** come after step 1: the new code fails closed (503 on every
   login) if the function is missing. Anyone currently locked by the old `login_attempts` count is
   unlocked at this moment, which is fine.
3. **Ship the client** (`04-orders-detail.js`). Old cached clients keep working: they don't send
   a token, so they use the `e:` key, which is roughly today's behaviour minus the race. Owners
   get their device token on their next successful sign-in.

Rollback: redeploy the previous auth-gateway. The table and function can stay. Nothing else
reads them, and they hold no customer data.

## 9. Residual risks and follow-ups (not fixed here, on purpose)

- **Reset-code burning** (pre-existing): an attacker can request reset codes and burn each with 5
  wrong guesses, which blocks the escape hatch for an owner on a *new* device during a combined
  attack. A follow-up could give `reset-password` the same device-bucket treatment.
- **Row growth:** an attacker spraying random emails creates one small row per email. That's
  strictly less than `login_attempts` already grows. If it ever matters:
  `delete from login_throttle where greatest(last_attempt_at, locked_until) < now() - interval '2 days';`
  run on a schedule.
- **Login timing enumeration** (a separate Phase 5 item): a non-existent email skips PBKDF2 and
  answers faster. This design doesn't change that, in either direction.
- **Support action** if an owner is stuck and can't use Forgot Password: Cowork runs
  `delete from login_throttle where key = 'e:<their email>';`. That's safe; it only forgets
  failures.

## 10. Risk and effort

**Size: small.** One migration (about 70 lines including comments), about 60 changed lines in
`auth-gateway/index.ts`, about 12 in `authGatewayCall`, 11 edge tests and one SQL test file. One
Sonnet session.

**Risk: 🔴.** Every sign-in goes through this, and a mistake can lock out everyone (fail closed)
or nobody (cap bypassed). Tests 1, 3, 4, 5 and 10 cover those failure modes directly.

**Stop and escalate to Opus instead of pushing on if:**
- Test 1 doesn't fail on today's code before the change. That would mean the harness isn't
  actually exercising concurrency, and the "fixed" result proves nothing.
- Anything other than `login` needs to read the device token, or someone proposes letting a
  device-token sign-in clear the `e:` key.
- The live check (7.3) returns anything other than exactly 5 × 401.
- `checks/` flags `jewelos_login_devices` as a raw localStorage key and the suggested fix is to
  make it shop-scoped. That would break the design: the token must exist before a shop is known
  and must survive sign-out. Document it as a false positive instead.

---

## Implementation checklist for Claude Code

Order matters. Commit each step separately.

1. **`supabase/functions/auth-gateway/index.ts`**
   - Constants (lines 54-55): keep `MAX_FAILED_ATTEMPTS`. Replace `LOCKOUT_WINDOW_MIN` with
     `BASE_LOCK_MIN = 15`, `MAX_LOCK_MIN = 24 * 60` and `DEVICE_TOKEN_DAYS = 180`. Grep to confirm
     `LOCKOUT_WINDOW_MIN` has no other users.
   - Add `signDeviceToken` / `verifyDeviceToken` after `verifySession` (section 5).
   - `login` route: replace lines 237-255 and the line-268 return as in section 5.
   - `signup` response (line 311) and `reset-password` success (line 527): add `deviceToken`.
   - Header comment block: add one line under the endpoints list noting that `login` accepts an
     optional `deviceToken` and that login/signup/reset-password return one.
   - **Don't** touch `verifySession`, store-proxy, or any `putBlob`/`getBlob` (item 7's territory).
2. **`js/04-orders-detail.js`**, `authGatewayCall` only (section 5). ES5: `var`, `function(){}`,
   no `includes`. Don't touch any of the four call sites.
3. **`tests/edge-functions.test.js`**: `makeDb` field, `throttleModel`, `rpc` branch, and tests
   1-11 (section 7.1). Run it against today's `index.ts` *first* and confirm that test 1 fails.
4. **`tests/sql-login-throttle.test.mjs`** (new; section 7.2). It runs after Cowork has committed
   009 into the repo, or against the SQL copied from the checklist below into
   `supabase/migrations/009_login_throttle.sql` by whoever owns that file. **Claude Code doesn't
   create or edit migration files** (MODEL-POLICY workflow for this task).
5. Run `node tests/edge-functions.test.js`, the PGlite test, `node tests/regression.test.js`,
   `check.bat`, and e2e `auth.spec.js` plus `session-restore.spec.js`.
6. Review: `jewelos-security-auditor` on the diff (auth change), then `jewelos-test-runner`.
7. Deploy auth-gateway **only after Cowork confirms 009 is applied**, then run the live check
   (7.3), and ask Cowork for its cleanup.
8. HANDOFF entry: say plainly that the real-Postgres concurrency guarantee was verified only by
   the 7.3 live check, and nothing in CI exercises it.

## Migration checklist for Cowork

Number resolved (see numbering note at the top of this doc): `auth_store` CAS + history
(`docs/auth-store-cas-audit-design.md`) is **008** and lands first; this is **`009_login_throttle.sql`**.
Apply it **before** the new auth-gateway is deployed, and after 008 is confirmed live.
Afterwards, check that the table exists with RLS on and that
`select login_throttle_take('e:migration-smoke@example.invalid', 5, 15, 1440);` returns `0`. Then
`delete from login_throttle where key = 'e:migration-smoke@example.invalid';`.

```sql
-- ══════════════════════════════════════════════════════════════════════
-- Login lockout: atomic, and a stranger can't lock an owner out of their
-- own phone (HANDOFF 10 Oct Phase 5, item 6; docs/login-lockout-design.md).
--
-- auth-gateway's login route used to COUNT recent failures in
-- login_attempts, check the password, and only THEN insert this attempt.
-- Parallel requests all read the same old count, so 50 guesses fired at
-- once all got past a "5 attempts" limit. And the count was keyed on
-- email alone, so anyone who knew an owner's email could lock them out
-- for 15 minutes, again and again, without knowing the password.
--
-- Now:
--   • One row per throttle key. The key is 'e:<email>' for a device that
--     has never signed in to that email, or 'd:<email>|<device id>' for a
--     device holding a signed device token for it (auth-gateway checks the
--     signature; this table never sees the token).
--   • login_throttle_take() counts the attempt and decides inside one
--     locked statement, BEFORE the password is checked. A correct password
--     then deletes the row. Firing many guesses at once cannot slip past.
--   • Every 5th counted attempt starts a lock: 15 min, then 30, 60 ... up
--     to 24 h. Attempts during a lock are refused and NOT counted. A full
--     24 h of quiet after the last attempt or lock forgets the key.
--   • login_attempts is untouched: still one row per checked attempt, as
--     an audit log. Nothing reads it to decide anything any more.
--
-- Additive and idempotent. Apply BEFORE deploying the auth-gateway that
-- calls login_throttle_take() — that version refuses every login (503) if
-- the function is missing. The currently deployed auth-gateway keeps
-- working after this runs (it never touches the new table).
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.login_throttle (
  key text primary key,
  failures integer not null default 0,        -- counted attempts since the last lock
  lockouts integer not null default 0,        -- locks in a row without a success: 15 * 2^n min
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);
alter table public.login_throttle enable row level security;
-- Default-deny, same as login_attempts: only service_role (auth-gateway).
revoke all on public.login_throttle from anon;
revoke all on public.login_throttle from authenticated;

-- Returns 0 when this attempt may go ahead (it has been counted), or the
-- number of seconds until p_key's lock lifts (nothing counted). Says
-- nothing about whether the email has an account.
create or replace function public.login_throttle_take(
  p_key text,
  p_max_failures integer,
  p_base_lock_min integer,
  p_max_lock_min integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failures integer;
  v_lockouts integer;
  v_locked_until timestamptz;
  v_last timestamptz;
  v_lock_min integer;
begin
  -- Make sure there is a row to lock. If a parallel call is inserting the
  -- same key, this waits for that insert, then does nothing.
  insert into login_throttle (key) values (p_key)
  on conflict (key) do nothing;

  -- `for update` serialises concurrent attempts for the same key: a second
  -- caller waits here, then re-reads the row as the first caller left it
  -- (count raised, or locked).
  select failures, lockouts, locked_until, last_attempt_at
    into v_failures, v_lockouts, v_locked_until, v_last
    from login_throttle
   where key = p_key
   for update;

  -- Still locked: refuse WITHOUT counting, so hammering during a lock
  -- neither extends it nor makes the next one longer.
  if v_locked_until > now() then
    return greatest(1, ceil(extract(epoch from v_locked_until - now()))::integer);
  end if;

  -- A full max-lock period (24 h) of quiet since the last attempt AND since
  -- the last lock ended: start over. greatest() ignores a null locked_until.
  if greatest(v_last, v_locked_until) <= now() - make_interval(mins => p_max_lock_min) then
    v_failures := 0;
    v_lockouts := 0;
  end if;

  v_failures := v_failures + 1;

  if v_failures >= p_max_failures then
    -- This last allowed attempt still goes ahead — it may be the right
    -- password, and a success deletes this row, lock and all. Everything
    -- after it is refused until the lock lifts. 15, 30, 60 ... capped.
    v_lock_min := least(p_max_lock_min,
                        p_base_lock_min * (2 ^ least(v_lockouts, 16))::integer);
    v_locked_until := now() + make_interval(mins => v_lock_min);
    v_lockouts := v_lockouts + 1;
    v_failures := 0;
  end if;

  update login_throttle
     set failures = v_failures,
         lockouts = v_lockouts,
         locked_until = v_locked_until,
         last_attempt_at = now()
   where key = p_key;
  return 0;
end;
$$;

revoke all on function public.login_throttle_take(text, integer, integer, integer) from public;
revoke all on function public.login_throttle_take(text, integer, integer, integer) from anon;
revoke all on function public.login_throttle_take(text, integer, integer, integer) from authenticated;
grant execute on function public.login_throttle_take(text, integer, integer, integer) to service_role;

-- ── NOTES ────────────────────────────────────────────────────────────
-- Additive and idempotent (IF NOT EXISTS / CREATE OR REPLACE), safe to
-- rerun. Touches no existing table; login_attempts keeps its rows and its
-- role as the audit log.
--
-- Support: an owner stuck on a new device who can't use Forgot Password
--   delete from login_throttle where key = 'e:<their email, lowercase>';
-- Housekeeping, only if the table ever grows large:
--   delete from login_throttle
--    where greatest(last_attempt_at, locked_until) < now() - interval '2 days';
-- Rollback: redeploy the previous auth-gateway. Then, optionally:
--   drop function if exists public.login_throttle_take(text, integer, integer, integer);
--   drop table if exists public.login_throttle;
```
