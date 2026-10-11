# Login timing side-channel: always pay for one password hash

Status: proposal, 11 Oct 2026. Risk class: 🔴 (auth, MODEL-POLICY §8).
No code written. Design by Opus; implementation is meant for a Sonnet (Claude Code) session,
followed by an independent review of the applied diff before deploy (MODEL-POLICY §3).
Destination: `Desktop\jewelos\docs\login-timing-sidechannel-design.md`. The HANDOFF entry is separate.

Scope: HANDOFF's 10 Oct Phase 5 list, **item 3 only** (login timing side-channel), re-checked
against current code on 11 Oct: still open, exactly as described. The fix direction (hash
against a fixed dummy when no account matches) was agreed in HANDOFF and is not reopened here.
This doc settles the open details: where the dummy lives, the exact diff, what else in the
route could leak, how it touches item 6 (lockout), and how to test it without a stopwatch.

---

## For Tanish, in plain words

When someone signs in, the server turns the typed password into a scrambled fingerprint and
compares it with the one saved for that account. Making that fingerprint is deliberately slow
(about a tenth of a second), so a stolen password list is expensive to crack.

The bug: when the email isn't registered at all, the server skips that slow step and answers
straight away. The message is the same ("Invalid email or password"), but the reply comes back
noticeably faster. So a stranger can type in a list of emails and, just by timing the replies,
learn which ones are JewelOS customers. That's a list of jewellers worth targeting with
password guessing or phishing.

The fix: the server always does the slow step, whether or not the email exists. For a
missing email it scrambles the password against a fixed dummy value that can never match
anything. Both answers then take the same time, and the timing tells the stranger nothing.
No database change, no change to the app on the phone, nothing for customers to notice.

One honest caveat (section 3): two *other* places in JewelOS already reveal whether an email
is registered, and more loudly than this one. This fix is still worth doing, because it is cheap
and it is the one an attacker would use against the sign-in screen. Those two are listed as
separate follow-ups.

---

## 1. Root cause

`supabase/functions/auth-gateway/index.ts`, `login` route, line 251:

```ts
const ok = user ? await verifyPassword(password, String(user.passwordHash), String(user.salt)) : false;
```

`verifyPassword` (line 94) calls `hashPassword` (line 78), which runs one
`crypto.subtle.deriveBits` with PBKDF2-SHA-256 at 100,000 iterations. That one call is the
expensive part of the whole route, tens of milliseconds of CPU. The ternary skips it when
`user` is `undefined`. Everything else in the route costs about the same either way
(section 3), so the request time splits into two clean groups: "registered" (slow) and
"not registered" (fast). The response body and status (401, line 255) are identical, which is
why this was missed. The difference is in *when* the answer arrives, not in what it says.

The cost of PBKDF2 depends only on the iteration count, the hash function, the output length
and (barely) the salt and password lengths. It does **not** depend on the stored hash that
the result is compared with. That's the fact the whole fix rests on: we don't need a real
account's hash to pay a real account's price.

## 2. Where the dummy hash + salt live (design question 1)

What the dummy has to do, given the threat model:

- make the missing-account path run the **same** `hashPassword` call, with the same cost;
- **never** compare equal to any password's hash;
- nothing else. It doesn't need to be secret, it doesn't need to be a real hash, and it
  doesn't need to be the same across deploys.

### Options considered

| Option | Verdict |
|---|---|
| **A. Hard-coded constants in `index.ts`** | **Chosen.** |
| B. Edge Function secret / env var | Rejected |
| C. Generated at cold start, cached in module scope | Rejected |
| D. Use a real user's hash (e.g. `users[0]`) | Rejected |

**B. Env var: rejected.** It adds a deploy step (`supabase secrets set ...`) that protects
nothing, because the value isn't secret. It also adds a failure mode: if the secret is
missing, `Deno.env.get` returns `undefined`. `String(undefined)` would still hash, so it would
fail *safe* by luck, not by design. Config that guards nothing is complexity with no payoff.

**C. Cold-start generation: rejected.** The isolate restarting isn't the problem. A fresh
random salt per isolate is harmless, since no one ever verifies against it. The problem is
*how* you'd generate it. The obvious way, `await hashPassword(randomString())` at module
load or lazily on first use, adds one extra PBKDF2 call to the first request a new isolate
serves. If it's lazy, it lands on the first *unknown-email* login, which makes that request
about twice as slow. That's a new timing signal, and it's the very thing we're removing. Doing
it without PBKDF2 (random bytes for both values) avoids that, but then it's just option A
with randomness added for no reason, and tests can't pin the values.

**D. Borrow a real user's hash: rejected.** It ties the login route to whatever record
happens to be first in the blob, and it's a plausible way to log into someone else's
account if the `!!user` gate below is ever lost in a refactor.

**A. Hard-coded constants: chosen.** Zero runtime cost, zero config, deterministic for
tests, and the "never matches" property can be guaranteed by *shape*, not by luck:

```ts
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
```

Why each detail matters:

- **Salt length 32.** Real salts are 16 random bytes written as 32 hex characters (line 82),
  and `hashPassword` feeds the *hex string's* bytes to PBKDF2 (line 87). Matching the length
  keeps even the first-block work identical. (The salt only feeds the first of 100,000 HMAC
  rounds, so this is tidiness, not something measurable.)
- **Non-empty salt.** `hashPassword` generates a random salt when `saltHex` is falsy
  (line 79). Our constant is non-empty, so the dummy path never calls `getRandomValues`,
  just as the real path never does. Same steps on both paths.
- **Hash uses `-`.** `hashPassword` only ever outputs `"pbkdf2:"` followed by 64 lowercase
  hex digits (line 91). A string containing `-` is outside that output space, so
  `r.hash === DUMMY_HASH` is false for every possible password. It's a guarantee, not a
  2^-256 probability.
- **Same total length (71).** This keeps the final `===` from exiting on a length mismatch.
  The effect is nanoseconds and can't be measured over a network (section 3), but it costs
  nothing.

The salt value above was generated once (`crypto.randomBytes(16)`) for this doc. Use it
exactly. It must never change, because there's no reason to, and a constant that "rotates"
invites someone to think it's a secret.

## 3. Exact change to the `login` route (design question 2)

Put the two constants right after `verifyPassword` (after line 97), so they sit next to the
code they mirror. Then replace line 251:

```ts
// before
const ok = user ? await verifyPassword(password, String(user.passwordHash), String(user.salt)) : false;
```

```ts
// after
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
```

Everything after it stays **byte-for-byte unchanged**:

- line 253 `insert({ email, ip, succeeded: ok })`: `ok` is still `false` for an unknown email,
  so the attempt is recorded exactly as today;
- line 255 `if (!ok || !user) return json({ error: "Invalid email or password" }, 401, origin);`:
  keep both conditions. `!user` is redundant at runtime now (`ok` implies `user`), but
  TypeScript needs it to narrow `user` for lines 258-268, and it's a second gate if
  someone edits the `ok` line later.

So "no such account" still ends in the same 401 with the same body. It just gets there after
paying the same hashing cost as "wrong password".

Two belts, deliberately: `!!user` (logic) and the unmatchable `DUMMY_HASH` (shape). Either
one alone keeps an unknown email from logging in. With both, a future edit has to break two
independent things before the dummy becomes a backdoor.

### What not to change

- `verifyPassword` and `hashPassword` stay as they are. Don't make `verifyPassword` "take an
  optional user". That spreads the timing rule across two functions, and `change-password`
  (line 327) calls it too.
- Don't add a constant-time string compare (`timingSafeEqual`) as part of this fix. The
  existing `===` on two 71-char strings varies by nanoseconds, and both sides are attacker-
  unknown digests. It's not this finding, and it isn't measurable remotely.
- Don't add an artificial delay or random jitter. Sleeping doesn't use CPU, so it wouldn't
  match PBKDF2's profile under load, and jitter only makes the attacker average over more
  samples. Equal work is the real fix.

## 4. Does this fully close the channel? (design question 3)

**On the `login` route: it closes the channel down to noise.** Not to zero, so "fully closed"
would overstate it. I went through every step of the route (lines 232-268) for anything whose
cost depends on whether the email is registered:

| Step | Line | Depends on account existing? | Verdict |
|---|---|---|---|
| Parse / validate body, 400 on blank | 233-235 | No (depends only on what the caller sent) | Equal |
| `login_attempts` count query | 239-244 | No. Keyed on the email string, and rows are inserted for unknown emails too (line 253), so both kinds of email build up counts the same way | Equal |
| 429 lockout | 245-247 | No. An unknown email that's been tried 5 times is locked just like a real one | Equal, and good: the lockout itself doesn't enumerate |
| `getBlob("users")` | 249 | No. Always fetches the whole blob | Equal |
| `users.find(...)` | 250 | **Yes, slightly.** It stops early on a match. An unknown email scans all users | Residual, negligible (below) |
| PBKDF2 | 251 | **Yes, today.** Fixed by this doc | Closed |
| Final `===` | 96 | Nanoseconds, length-matched | Negligible |
| `login_attempts` insert | 253 | No | Equal |
| 401 | 255 | No | Equal |
| `getBlob("shops")`, sign token, 200 | 257-268 | Only after a **correct** password | Not a channel: a caller who has the password already knows the account exists |

**The residual: `users.find`.** It's a linear scan over every user in the system (one shared
blob, not per shop), with a lowercase-and-compare per element. A miss scans the whole array;
a hit stops partway. The difference is under a microsecond per user, so tens of microseconds
at 10,000 users. That's three to four orders of magnitude below the PBKDF2 step we're
equalising, and well below network and Edge-runtime jitter (routinely milliseconds). It isn't
worth fixing. Making it constant-time would mean scanning the full array even after a match,
which is a pointless change. If JewelOS ever has hundreds of thousands of users in one blob,
the blob itself is the problem (HANDOFF Phase 5 item 7), not this scan.

**Other noise that doesn't depend on the email:** cold start versus warm isolate, GC
pauses, Supabase round-trip variance. These hit both paths at random, and they're why the
residual above can't be measured.

### Louder enumeration channels elsewhere: out of scope, flagged

Reading the whole file to check this turned up two places that reveal account existence much
more cheaply than the login timing ever did. **They are not part of this fix.** They need
their own decisions and should go into HANDOFF as separate items:

1. **`signup` returns `409 "Account already exists with this email"`** (line 286). That's a
   direct yes/no answer, no timing needed. Most SaaS products accept this because the
   alternative ("check your email to finish signing up") is a real UX cost. It's a
   **product decision for Tanish**, not a bug to fix silently. Possible mitigations, if
   wanted: rate-limit signup per IP, or switch to an email-confirmation signup.
   🟡 at most, and only once he's made the product call.
2. **`request-password-reset` has the same timing split as this finding.** For a real
   account it does an insert, a SHA-256 and an **outbound HTTP call to Resend** (lines
   461-477). For an unknown email it does nothing. The body is carefully identical
   (`GENERIC_OK`), but a Resend round trip is hundreds of milliseconds, far louder than
   PBKDF2. The fix has the same shape as this doc (respond first and send the email without
   making the caller wait, or do equal work on both branches), but it touches email delivery
   and the 3-per-hour limit, so it needs its own short design. 🔴 (auth), log as a new Phase 5
   item.

(`add-staff` also returns 409 for an existing email, line 383, but only to a signed-in shop
owner. That's a much smaller audience. Mention it in the HANDOFF line about item 1; don't
treat it as its own finding.)

Bottom line for the HANDOFF entry: **"login timing channel closed to below network noise;
residual `users.find` scan difference measured in microseconds and accepted; two louder
enumeration paths found elsewhere and logged separately."** Don't write "account
enumeration fixed", because it isn't, app-wide.

## 5. Interaction with item 6, login lockout (design question 4)

This fix doesn't move anything the lockout depends on. The order stays **count → 429 check →
user lookup → hash → insert attempt → respond**, and `succeeded` is still `ok`, which is still
`false` for unknown emails. Whatever docs/login-lockout-design.md decides (insert-first then
count, an atomic RPC in the style of `migrations/003`, email+IP keying, growing delays),
it can rearrange the count and insert freely, provided it keeps three properties this fix
relies on. Those are the ones for that doc to know about:

- **The 429 decision must not depend on whether the account exists.** Today it's keyed on
  the raw email string, so unknown emails lock out just like real ones. A lockout that only
  counts failures for real accounts (for example, "skip the insert when `user` is null to
  keep the table small") would turn the 429 into a new, louder enumeration oracle. Lockout
  checks must stay before the user lookup, or at least never branch on `user`.
- **The hash must run on every request that gets past the lockout**, on both paths. If the
  lockout logic adds an early return between the lookup and the hash, it reopens this
  channel.
- **Each junk login now costs one PBKDF2 of CPU** where unknown emails used to cost almost
  nothing. Per-email lockout doesn't bound an attacker who rotates through many different
  emails, so this slightly raises the CPU an email-spraying attacker can burn. It's bounded
  by Supabase's per-request CPU limit and isn't a reason to drop this fix. But it's one more
  argument for the IP component that item 6 already proposes.

No reconciliation is needed beyond that. The two diffs touch different lines (this one only
line 251 plus two new constants), so they can land in either order.

## 6. Test plan (design question 5)

### Where

**`tests/edge-functions.test.js`.** It already loads the real `auth-gateway/index.ts` into a
`vm` sandbox against a fake Supabase (`load()`, ~line 112) and has `freshShop()` and `call()`
helpers. `tests/e2e/` is the wrong place: Playwright drives the browser and can't see how
many times the server hashed. This suite isn't in `check.bat` (`tests/README.md`), so it has
to be run by hand: `node tests/edge-functions.test.js`.

### What to assert: count, not stopwatch

As HANDOFF says, a wall-clock assertion is flaky in CI, and it would pass by accident on a
fast machine. What actually makes the route constant-cost is the **number and shape of
PBKDF2 calls**, so that's what the test counts.

`hashPassword` and `verifyPassword` are private to the module inside the `vm` sandbox, so they
**can't be spied on directly**. The point every PBKDF2 call has to pass through is
`crypto.subtle.deriveBits`, and the harness already passes `crypto` into the sandbox (`ctx`,
~line 136, `crypto: webcrypto`). Counting there is actually *better* than spying on
`hashPassword`: it measures the expensive operation itself, so it would also catch a future
refactor that calls `deriveBits` some other way.

**Harness change (one addition near the top, one line in `load()`):**

```js
// Every PBKDF2 the functions run, in order. Login must run exactly one per
// request whether or not the email is registered (docs/login-timing-sidechannel-design.md).
var deriveCalls = [];
var countingCrypto = {
  getRandomValues: function (a) { return webcrypto.getRandomValues(a); },
  randomUUID: function () { return webcrypto.randomUUID(); },
  subtle: new Proxy(webcrypto.subtle, {
    get: function (t, k) {
      if (k === 'deriveBits') return function (params, key, len) {
        deriveCalls.push({ name: params.name, iterations: params.iterations, hash: params.hash,
                           saltLen: params.salt && params.salt.byteLength, len: len });
        return t.deriveBits(params, key, len);
      };
      var v = t[k];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }),
};
```

and in `load()`'s `ctx`, `crypto: webcrypto` becomes `crypto: countingCrypto`. The `bind(t)` is
required because WebCrypto methods reject a `this` that isn't the real `SubtleCrypto`.
store-proxy shares the wrapper and only uses `importKey`/`verify`, which pass straight through.

**New tests, in a section headed `// ---- auth-gateway: login timing side-channel (Phase 5 item 3)`.**
Use fresh emails via `freshShop()` so the earlier tests' failed logins on `owner@shop.in`
can't push these into a 429. Measure only the delta around the single `login` call, because
`signup` hashes too.

```js
var pbkdf2During = async function (fn) {
  var before = deriveCalls.length; var r = await fn();
  return { r: r, calls: deriveCalls.slice(before) };
};

await test('login: an unknown email runs exactly one PBKDF2, the same as a wrong password for a real account', async function () {
  await freshShop('t1');
  var real = await pbkdf2During(function () { return call(auth, 'login', { email: 'owner-t1@shop.in', password: 'wrong-pass-1' }); });
  var none = await pbkdf2During(function () { return call(auth, 'login', { email: 'nobody-t1@shop.in', password: 'wrong-pass-1' }); });
  eq(real.calls.length, 1, 'real account, wrong password: PBKDF2 calls');
  eq(none.calls.length, 1, 'unknown email: PBKDF2 calls');            // 0 on today's code: this is the bug
  eq(JSON.stringify(none.calls[0]), JSON.stringify(real.calls[0]), 'same PBKDF2 parameters on both paths');
});

await test('login: an unknown email gets the identical 401 status and body as a wrong password', async function () {
  await freshShop('t2');
  var real = await call(auth, 'login', { email: 'owner-t2@shop.in', password: 'wrong-pass-2' });
  var none = await call(auth, 'login', { email: 'nobody-t2@shop.in', password: 'wrong-pass-2' });
  eq(real.status, 401, 'real status'); eq(none.status, 401, 'unknown status');
  eq(JSON.stringify(none.body), JSON.stringify(real.body), 'body');
});

await test('login: an unknown email never logs in, and its attempt is recorded as failed', async function () {
  var r = await call(auth, 'login', { email: 'nobody-t3@shop.in', password: 'anything-at-all' });
  eq(r.status, 401, 'status'); eq(r.body.sessionToken, undefined, 'no token');
  var rows = db.login_attempts.filter(function (a) { return a.email === 'nobody-t3@shop.in'; });
  eq(rows.length, 1, 'attempt recorded'); eq(rows[0].succeeded, false, 'succeeded');
});

await test('login: the correct password still succeeds with exactly one PBKDF2', async function () {
  await freshShop('t4');
  var ok = await pbkdf2During(function () { return call(auth, 'login', { email: 'owner-t4@shop.in', password: 'ownerpass1' }); });
  eq(ok.r.status, 200, 'status'); eq(ok.calls.length, 1, 'PBKDF2 calls');
});
```

**Prove-it requirement:** run the first test against **today's** `index.ts` before making the
change. It must fail with `unknown email: PBKDF2 calls: expected 1, got 0`. That's what shows
the test actually measures the bug. Record that output in the HANDOFF entry.

Comparing the `JSON.stringify` of the recorded call (iterations, hash name, salt byte length,
output length) is what pins "same cost", not just "same count". If someone later shortens the
dummy salt or gives the dummy path its own iteration count, the third assertion fails.

Not tested, and say so in HANDOFF: the real latency of the deployed function. An optional,
non-gating manual check after deploy is to time ~20 logins to a known and an unknown address
against the live function and confirm the two medians are within noise of each other. That
gives Tanish a number, but it's not a test.

Also run the whole suite, `node tests/edge-functions.test.js`: every existing test must pass
unchanged. `check.bat` and `tests/e2e/auth.spec.js` are worth one run for confidence, but
neither can see this change.

## 7. Risk and effort

**Size: tiny.** One file of production code: two constants and one changed statement
(roughly 12 lines including comments). One harness addition and four tests.

**Risk: 🔴 by class, low in practice.** It's the login path, so a mistake here either locks
everyone out (the `ok` expression is wrong) or lets an unknown email in (the gate is lost).
Both are covered by the tests above plus the existing "login / change-password / update-shop
unchanged" test. Rollback is a one-commit revert plus `supabase functions deploy auth-gateway`.

**Stop and escalate to Opus instead of pushing on if:**

- Any existing test in `edge-functions.test.js` fails after the change.
- You find a user record whose `passwordHash` isn't `pbkdf2:` + 64 hex (a legacy format).
  The "can never match" argument and the "same cost" argument both assume one format.
- `hashPassword`'s iteration count or algorithm has changed since 11 Oct. The dummy path then
  needs re-checking, not just re-running.
- The lockout implementation (item 6) has already landed and has moved the hash or added an
  early return between the user lookup and the hash.

---

## Implementation checklist for Claude Code

Single commit. Edge Function plus test only; no `js/` change, so ES5 rules don't apply to the
`.ts` file. The test file *is* ES5 house style (`var`, `function`), so match it.

- [ ] `git status` clean, claim the NOW line in HANDOFF.
- [ ] `tests/edge-functions.test.js`: add `deriveCalls` + `countingCrypto` near the other
      module-level vars (~line 36). In `load()`'s `ctx` (~line 136), `crypto: webcrypto` →
      `crypto: countingCrypto`.
- [ ] Add the four tests from §6 before the `// ---- unchanged routes still work` block
      (~line 516). Run the suite against the **unmodified** `index.ts` and confirm test 1 fails
      with `expected 1, got 0`. Save that output.
- [ ] `supabase/functions/auth-gateway/index.ts`, after line 97 (end of `verifyPassword`): add
      the comment block + `DUMMY_SALT` + `DUMMY_HASH` from §2, values exactly as written.
- [ ] Same file, line 251: replace the `const ok = user ? ... : false;` line with the
      `passwordMatches` / `ok = !!user && passwordMatches` block from §3. Leave lines 253 and
      255 untouched.
- [ ] `node tests/edge-functions.test.js`: all green, including the four new tests.
- [ ] Independent review of the diff (🔴 auth): `AI-Generated Code Security Auditor` or
      `jewelos-security-auditor`, per CLAUDE.md routing. Ask specifically: is `!!user` still
      in the `ok` expression, and can `DUMMY_HASH` ever equal a `hashPassword` output?
- [ ] Deploy: `supabase functions deploy auth-gateway` (only Tanish or a session with CLI
      access; no secrets change).
- [ ] HANDOFF entry: item 3 closed, the before/after test output, the two new follow-up items
      from §4 (signup 409, request-password-reset timing), and the "not verified: live latency"
      line. End with `→ FOR COWORK: nothing — FYI only`.

## Nothing for Cowork

No schema change, no migration, no new table or column, no RPC, no Edge Function secret, and
no change to `login_attempts`. Nothing under `supabase/migrations/` is touched. The only
deploy step is redeploying the `auth-gateway` Edge Function. Cowork doesn't need to apply,
run or check anything for this item.
