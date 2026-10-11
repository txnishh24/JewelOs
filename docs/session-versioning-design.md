# Session versioning: a password change signs out every other device

Status: proposal, 11 Oct 2026. Risk class: 🔴 (auth/session, MODEL-POLICY §8).
No code written. Design by Opus; implementation is for a Claude Code (Sonnet) session, then an
independent review of the diff (`jewelos-security-auditor` + `Code Reviewer`, MODEL-POLICY §3).
Destination: `Desktop\jewelos\docs\session-versioning-design.md`. The HANDOFF entry is separate.

Scope: HANDOFF 10 Oct Phase 5, item 5 ("no `sessionVersion`"). Re-confirmed today: `grep
sessionVersion` over `js/` and `supabase/functions/` finds nothing. Items 6 (login lockout) and
7/8 (auth_store CAS + audit trail) have their own design docs in parallel; this doc only notes
where they touch this one (section 7).

---

## For Tanish, in plain words

Today, when you sign in, the server gives your phone a "pass" that works for 6 hours. Changing
your password doesn't cancel the passes already handed out. So if a phone is stolen and you
change your password from your own phone, the stolen phone keeps working for up to 6 more
hours.

The fix gives every account a small number, starting at 0, which goes up by one each time the
password changes. Each pass records the number it was issued with. When the server sees a pass
whose number is older than the account's, it refuses it, and that phone has to sign in again
with the new password. The phone you changed the password on gets a fresh pass at that moment,
so you don't notice anything.

Nobody is signed out on the day this goes live. Every account starts at 0, and every pass
issued before the update also counts as 0, so they all still match. A pass stops working only
after its own account's password has actually been changed.

---

## 1. What the code does today

- **Token.** `signSession` (`auth-gateway/index.ts` ~118) signs `{userId, shopId, role, exp}`.
  `verifySession` checks the HMAC and `exp`, and that's all. The token has no tie to the
  password it was obtained with.
- **Re-checks since Phase 3.** `loadActor` (auth-gateway ~158, used by update-shop/add-staff/
  remove-staff) and `resolveTenant` (store-proxy ~146, used on **every** store-proxy request)
  re-read the caller's current user record. A *removed* user, or one moved to another shop, is
  refused. Role comes from the record, not the token.
- **The gap.** `change-password` (~315) and `reset-password` (~487) rewrite `passwordHash`/`salt`
  and nothing else. Every token issued earlier still passes both re-checks, because the user
  record still exists in the same shop.
- **Client, which decides how the fix must fail.** On a store-proxy 401,
  `saasRequireReauth` (`js/05-auth-login.js:208`) branches on `reason`:
  - `"revoked"` means `saasForceLogout`: **it wipes the device, unsaved work included**.
  - `"expired"` means the in-place re-sign-in overlay: saves are held and replayed on a fresh
    token, and nothing is lost.

  `submitPwdModal` (`05-auth-login.js:423`) ignores the response body and keeps using
  `SAAS.sessionToken` after a successful change.

## 2. Design decisions (the six questions)

### 2.1 Schema: the field, its default, and no backfill

- **Key:** `sessionVersion`, an integer on each object in the `users` blob of `auth_store`.
- **Existing records:** left as they are. A missing key **reads as 0**. There is **no backfill
  write** and **no SQL migration**.
- **Why no backfill:** this codebase already treats missing optional fields as a default at read
  time (`String(user.role ?? "staff")` in store-proxy ~167, `payload.role ?? "staff"` ~126,
  `shop.rowKey ?? ""` ~161). A backfill would be a whole-array read-modify-write of `users`
  under the exact lost-update race item 7 describes, which is a risk taken on for no benefit.
  The field gets written the first time it matters (the first password change), as part of a
  write that route already does.
- **The one rule that makes "missing = 0" safe:** both sides of every comparison go through the
  same normaliser, in both files:

  ```ts
  // Missing/legacy = 0. Used on the token AND the user record, never one side only.
  const ver = (v: unknown) => (typeof v === "number" ? v : 0);
  ```

  Comparing raw values (`session.sessionVersion !== user.sessionVersion`) would make
  `undefined !== 0` the moment any record gains the field. Section 9 covers this.

### 2.2 Token payload, and the compatibility rule for old tokens

- **New field:** `sessionVersion` in the signed payload, set from `ver(user.sessionVersion)` at
  **login** and at the **new token change-password returns** (2.4). Signup doesn't need
  changing: a new user is at 0, and a token without the field already reads as 0.
- **A token minted before this ships** has no `sessionVersion`, so `ver()` gives 0.
  - Its user has never changed password on the new code, so `ver(record)` is 0. They match,
    and the token stays valid until its normal `exp`.
  - Its user *has* changed password since the deploy, so the record is at 1 or more. The token
    is rejected, which is exactly right: it was issued before the change.
- **So the rule is "treat it as version 0".** Not "always valid", which would leave every
  pre-deploy token immune for its remaining 6 hours, including a stolen phone's. And not an
  escape hatch, which would be a second code path to get wrong. No explicit grace period is
  needed: every pre-deploy token is gone within `SESSION_TTL_HOURS` = 6 h of the deploy anyway.
- **Forgery:** the field is inside the HMAC'd body, so a client can't edit it. The existing
  tamper test already covers this.

### 2.3 Where the version is checked: inside the two existing re-checks

No new error path. A stale token is folded into each function's existing "not you any more"
result.

**auth-gateway `loadActor`.** A mismatch returns `me: null`, so every caller's existing
`if (!me) return 401 ACCESS_CHANGED` handles it unchanged:

```ts
async function loadActor(supabase, session) {
  const users = (await getBlob(supabase, "users")) as Record<string, unknown>[];
  const found = users.find((u) => u.id === session.userId);
  const current = found && found.shopId === session.shopId &&
    ver(found.sessionVersion) === ver(session.sessionVersion);   // NEW
  return { users, me: current ? found : null };
}
```

**store-proxy.** `verifySession` carries the field through; `resolveTenant` gains one reason
value on its existing `{ok:false, reason}` union; the caller maps it to a 401 with reason
`"expired"`:

```ts
type Session = { userId: string; shopId: string; role: string; sessionVersion: number };
// in verifySession's return:
  sessionVersion: ver(payload.sessionVersion),

type Tenant =
  | { ok: true; rowKey: string; role: string }
  | { ok: false; reason: "user_gone" | "shop_gone" | "stale_session" };   // NEW member

// in resolveTenant, right after the user_gone line:
if (ver(user.sessionVersion) !== session.sessionVersion) return { ok: false, reason: "stale_session" };

// at the call site (~208):
if (!tenant.ok) {
  if (tenant.reason === "user_gone")
    return json({ error: "unauthenticated", reason: "revoked", message: "Please sign in again." }, 401, origin);
  if (tenant.reason === "stale_session")   // NEW: password changed elsewhere
    return json({ error: "unauthenticated", reason: "expired", message: "Your password was changed. Please sign in again." }, 401, origin);
  return json({ error: "invalid_tenant", message: "Shop not found for this session." }, 403, origin);
}
```

**The most important detail in this doc: a stale token answers `reason: "expired"`, never
`"revoked"`.** `"revoked"` wipes the device, including unsaved bills (section 1). A stale token is
not only the thief's phone. It's also:

- the owner's *other* legitimate device (the shop counter PC with a half-typed sale);
- a second tab on the *same* phone, which still holds the old token in memory;
- a save already in flight on the very phone that changed the password, if it lands a moment
  after the bump.

With `"expired"`, all of those get the re-sign-in overlay, their saves are held, and they type the
new password and carry on. The thief gets the same overlay, can't get past it without the new
password, and can only Sign out. Using `"revoked"` would buy one extra thing (wiping the thief's
cached copy), and the cost would be data loss on the owner's own devices. MODEL-POLICY §9 #1
decides this. If Tanish later wants stolen-device wiping, the correct tool is an explicit "sign
out this device" action, not a side-effect of every password change.

`change-password` should **also** use `loadActor` instead of its own `findIndex`. It then
refuses stale tokens (and removed users) the same way, which closes "a thief who knows the old
password keeps changing it back". `idx` becomes `users.indexOf(me)`. This is a reuse of the
shared function, not a new check.

### 2.4 What bumps the version: password changes only

| Route | Bump? | Why |
|---|---|---|
| `change-password` | **Yes**, and it returns a fresh token | The threat this whole item exists for. |
| `reset-password` (email code) | **Yes** | Account recovery is the strongest "someone else may have my password" signal. It has no session, so it returns no token; the user signs in next anyway. |
| forced first-login reset (goes through `change-password`) | Yes, automatically | Harmless: the client adopts the returned token (section 4). |
| `remove-staff` | No | The user is deleted from the blob, and both re-checks already refuse them with `user_gone` → `"revoked"`, which is the correct "wipe" outcome for a removed employee. A bump on a deleted record does nothing. |
| `add-staff` | No | A new user starts at 0. |
| demotion / role change | No | No route changes a role today. And since 14 Sep (store-proxy) and Phase 3 (auth-gateway), role is read from the current record on every request, never from the token, so a demotion already takes effect at once. A bump would add nothing except a forced sign-in. If a change-role route is added later, it still doesn't need a bump, **as long as no code ever trusts `session.role`**. |
| `update-shop` | No | It doesn't concern credentials. |

**Why not bump more often?** The counter is **per user**, so a bump only ever signs out that one
person's other devices. Tying it to staff-list edits would either do nothing (bumping the
*target*, who is deleted or brand-new) or do harm (bumping the *actor*, the owner, so every time
they add a karigar, their own counter PC drops into the sign-in overlay mid-sale). A **per-shop**
counter was considered and rejected for the same reason, made worse: one staff member's password
change would sign out the entire shop.

**Deliberately skipped:** a "sign out all my other devices" button, which would bump the version
without changing the password. It's about 6 lines on top of this design (a route that does the
bump and returns a new token). Add it when a shop asks for it.

### 2.5 Rollout order: one server change, but the client goes out first

The server side doesn't need staging. The usual "ship tolerant reads first, enforce later"
split exists because enforcement could reject data written by old code. Here, `ver()` *is* the
tolerant read, and enforcement can't reject anything until a new-code password change has
written a non-zero version. At deploy time no record has one, so every comparison is 0 = 0.

The **client** is the one ordering constraint. If the new auth-gateway goes out before the new
client:

- an owner changes their password, the new server bumps them to 1 and returns a token, and the
  old client throws that token away and keeps the v0 one;
- the next sync gets a 401 `"expired"` and the re-sign-in overlay appears **on the device the
  owner just used**. Nothing is lost, but it looks broken;
- worse for a new staff member: set password on first login, then an immediate "sign in again".

The client change is harmless on the *old* server (`res.sessionToken` is `undefined`, so the
client keeps the current token). So the order is:

1. **Client** (`js/05-auth-login.js`) in Tanish's Netlify zip. Safe on the old server.
2. **store-proxy.** Enforcement goes live but is inert, since nothing has bumped yet.
3. **auth-gateway.** It starts minting and bumping, and enforcement begins to matter from the
   first password change.

2 and 3 can go out back to back. If 3 slipped ahead of 2, the only effect would be a short window
where a bump isn't yet enforced by store-proxy. Nothing breaks. Phones still running a cached
old build after step 3 get the "overlay on own device" degradation above, never data loss.

### 2.6 How this relates to items 6, 7 and 8 (sibling docs)

The bump is written **in the same object spread as the new `passwordHash`/`salt`, in the same
`putBlob` call** that change-password and reset-password already make. So it doesn't need its own
locking. It rides on whatever item 7 adopts for `users` writes, and it's lost or kept together
with the password change itself, never separately. Today, if a racing add-staff overwrites the
`users` array with a stale copy, the password change *and* the bump both vanish together. That's
item 7's bug, and the state stays consistent (old password, old version, old tokens valid). It's
never "new password, stale tokens still accepted". The single requirement on item 7's design: if
it replaces `putBlob` with a per-user patch RPC, the bump must be part of that same patch
(ideally computed server-side as `coalesce(sessionVersion,0)+1`), not a second call. Item 8
(audit trail) concerns the `store` blob, not `auth_store`, so it doesn't interact. Item 6 (login
lockout) doesn't interact in code. One behavioural note for it: after a bump, every other device
lands on the re-sign-in overlay, which calls `login`, so a mistyped new password there counts
toward the lockout like any other login. That's the intended behaviour.

## 3. Draft SQL (reference for Cowork, **not** a migration)

**No migration is required.** The two snippets below are operational helpers, in the house
migration-comment style, to be run by hand in the SQL editor if needed. Neither should be added
to `supabase/migrations/`.

```sql
-- ══════════════════════════════════════════════════════════════════════
-- Session versioning: read-only post-deploy check (docs/session-versioning-design.md)
--
-- How many users have a sessionVersion yet, and the highest value. Right
-- after deploy both should be 0 / null: the field only appears when someone
-- changes or resets their password on the new auth-gateway. A non-zero count
-- on day one means something wrote the field in bulk, so stop and look.
-- Read-only. Safe to run any time.
-- ══════════════════════════════════════════════════════════════════════
select count(*) filter (where u ? 'sessionVersion')        as users_with_version,
       max((u->>'sessionVersion')::int)                     as max_version
  from auth_store, jsonb_array_elements(data) as u
 where id = 'users';
```

```sql
-- ══════════════════════════════════════════════════════════════════════
-- Session versioning: sign ONE user out of every device, without changing
-- their password (e.g. a lost phone, password believed safe). Optional.
--
-- Bumps sessionVersion for a single user id; their every existing token gets
-- 401 "expired" (re-sign-in overlay, no data wiped) and their next login works
-- normally. Replace the id. NEVER run without the where-clause on u->>'id':
-- bumping everyone signs out the whole platform.
--
-- Caution: this is a whole-array rewrite of the users row, the same
-- unlocked read-modify-write item 7 describes. Run it when no signup/staff
-- change is likely to be in flight, and re-run the check above afterwards.
-- ══════════════════════════════════════════════════════════════════════
update auth_store
   set data = (
     select jsonb_agg(
              case when u->>'id' = 'usr_REPLACE_ME'
                   then jsonb_set(u, '{sessionVersion}',
                                  to_jsonb(coalesce((u->>'sessionVersion')::int, 0) + 1))
                   else u end
              order by ord)
       from jsonb_array_elements(data) with ordinality as t(u, ord))
 where id = 'users';
```

## 4. The client change (small, needed)

`submitPwdModal` (`js/05-auth-login.js:437`): in the success handler, adopt the token the server
returns, falling back to the current one when talking to an old server. ES5 only:

```js
.then(function(res){
  var tok = (res && res.sessionToken) || SAAS.sessionToken;
  ...
  if(isForced){
    ...
    saasSetSession(SAAS.user, SAAS.shop, tok);          // was SAAS.sessionToken
    ...
  } else {
    saasSetSession(SAAS.user, SAAS.shop, tok);          // NEW: persist the fresh token
    toast('✓ Password changed!');
    ...
  }
})
```

`saasSetSession` already does the right thing with an explicit token: it sets `SAAS.sessionToken`
and rewrites the `AUTH_KEY` record with the new `exp`. It skips persisting when
`mustResetPassword` is still true, and the forced branch clears that first, as it does today.
This line has `✓` next to it, so make byte-exact edits (CLAUDE.md rule).

**Known, acceptable edge:** if the change-password *response* is lost on a bad connection, the
password did change but the phone shows "Could not change password" and keeps its old token.
Its next sync gets the re-sign-in overlay, and the *new* password works there. This ambiguity
already exists today (minus the overlay). It isn't made worse in any way that loses data.

## 5. Test plan

Infrastructure exists: **`tests/edge-functions.test.js`** runs the *real* auth-gateway and
store-proxy handlers in Node against an in-memory fake Supabase, with a `mint()` helper for
hand-built tokens and a `freshShop()` helper. All server tests belong there, not in e2e, which
can't simulate two devices or a pre-deploy token. Client tests go in `tests/regression.test.js`.

**Must be updated (on purpose):** `login / change-password / update-shop unchanged` (~524). It
calls update-shop with the *pre-change* token `t`, which must now get a 401. Rewrite it to use
the `sessionToken` that change-password returns, and rename it to say so.

**New, `tests/edge-functions.test.js`:**

1. **Zero-logout guarantee.** `mint({userId, shopId, role, exp})` with **no** `sessionVersion`,
   for a user record with **no** `sessionVersion`: store-proxy GET 200, PUT 200, update-shop 200.
   This is the test that proves deploy day signs nobody out.
2. **Legacy token dies after a password change.** Same legacy token, then the user changes
   password (via a different, fresh token): store-proxy GET → 401 with **`reason: "expired"`**
   (assert it's not `"revoked"`); add-staff → 401.
3. **Two devices.** Login twice (t1, t2), then change-password with t1, which returns t1′.
   t2 → 401 `"expired"`, old t1 → 401, t1′ → GET 200, PUT 200, update-shop 200.
4. **A token minted after the change works.** A fresh `login` with the new password →
   store-proxy 200, and its payload's `sessionVersion` equals the record's.
5. **reset-password bumps too.** Token from before a reset → 401 `"expired"`. Login after the
   reset → 200.
6. **A stale token can't change the password.** Old t2 calls change-password with the right
   current password → 401, and `passwordHash` is unchanged.
7. **Staff-list edits don't bump the actor.** The owner holds two tokens. add-staff, remove-staff
   (another user) and update-shop with token A, then token B still → 200 everywhere, and the
   owner's record has no `sessionVersion` / it's unchanged.
8. **Removed user is still "revoked"** (regression guard on the reason split). The existing
   "REMOVED staff member is cut off" tests stay green, and one asserts `reason === "revoked"`.
9. **Forced first-login reset.** add-staff, login with the temp password, change-password →
   the returned token works on store-proxy straight away.

**New, `tests/regression.test.js` (client, via the existing harness):**

10. `submitPwdModal` with `authGatewayCall` stubbed to resolve `{ok:true, sessionToken:'NEW'}`:
    `SAAS.sessionToken === 'NEW'` and the stored `AUTH_KEY` record's `token === 'NEW'`, in both
    normal and forced modes.
11. Same stub resolving `{ok:true}` (old server): the token is unchanged, with no throw.

**e2e:** no new spec. Run `tests/e2e/auth.spec.js` and `session-restore.spec.js` before and
after, to confirm the change-password and reopen flows still behave.

**Live check after deploy (Cowork, real screens, per Tanish's standing preference):** sign in as
a test owner in two browsers, A and B. Change the password in A. A keeps saving with no prompt.
B's next save shows the re-sign-in overlay, the old password fails there, and the new one works
and the held save lands. Then run the SQL check in section 3.

## 6. Implementation checklist for Claude Code

`supabase/functions/auth-gateway/index.ts`:
- [ ] Add `const ver = (v: unknown) => (typeof v === "number" ? v : 0);` near `verifySession`.
- [ ] `loadActor`: add the `ver(found.sessionVersion) === ver(session.sessionVersion)` condition
      (2.3). Update its comment to mention password changes.
- [ ] `login`: add `sessionVersion: ver(user.sessionVersion)` to the `signSession` payload.
- [ ] `change-password`: switch to `loadActor` (`!me` → 401 `ACCESS_CHANGED`; `idx =
      users.indexOf(me)`). Write `sessionVersion: ver(me.sessionVersion) + 1` in the **same**
      object spread as the new hash/salt, and the same `putBlob`. Mint and return
      `{ ok: true, sessionToken }` with the new version and a fresh `exp`.
- [ ] `reset-password`: add `sessionVersion: ver(users[idx].sessionVersion) + 1` to the same
      spread. No token returned.
- [ ] Header comment: add change-password to the endpoint list, with "returns a fresh
      sessionToken".
- [ ] Do **not** touch signup, add-staff, remove-staff or update-shop logic. Do **not** read
      `session.role` anywhere new.

`supabase/functions/store-proxy/index.ts`:
- [ ] Same `ver` helper. `Session` type and `verifySession` return gain `sessionVersion`.
- [ ] `Tenant` union gains `"stale_session"`. `resolveTenant` checks it right after `user_gone`.
- [ ] Call site maps `stale_session` → 401 `{error:"unauthenticated", reason:"expired", ...}`.
      **Never `"revoked"`.**
- [ ] Update the payload comment at ~70 (`payload = { userId, shopId, role, exp }`) to include
      `sessionVersion`.

`js/05-auth-login.js`:
- [ ] `submitPwdModal`: adopt `res.sessionToken` with a fallback, in both branches (section 4).
      ES5, byte-exact.

Tests: section 5, items 1-11, plus the one updated test. Run `node tests/edge-functions.test.js`,
`check.bat`, and the two e2e specs. Then `jewelos-security-auditor` on the diff (auth change,
CLAUDE.md routing) before handing to Cowork.

## 7. Migration checklist for Cowork

**There is no SQL migration.** Steps, in this order:

1. **Tanish deploys the Netlify zip** containing the `js/05-auth-login.js` change. Run
   `jewelos-deploy-verifier` to confirm the live JS has it.
2. **Deploy `store-proxy`.** Smoke test: a signed-in test shop still loads and saves (proves
   legacy tokens pass, since every live token at this point is legacy).
3. **Deploy `auth-gateway`.** Smoke test: sign in, then load and save.
4. Run the **live two-browser check** (section 5) and the **read-only SQL check** (section 3).
   Expect `users_with_version` to equal the number of password changes made since step 3
   (normally just the test one).
5. HANDOFF entry.

**Rollback:** redeploy the previous `auth-gateway` and `store-proxy` versions, in any order.
Old code ignores the `sessionVersion` key, and its object spreads preserve the key in the blob,
so nothing needs cleaning up. Re-deploying the new code later picks up where it left off. While
rolled back, the protection is simply off (today's behaviour). The client change can stay, since
it's harmless against the old server.

## 8. Risk and effort

**Size: small.** About 25 changed lines of server code across two files, about 4 lines of
client code, 11 new tests and 1 updated test. No schema, no migration, no SQL. One Sonnet
session including review.

**Stop and escalate to Opus instead of pushing on if:**

- Any existing edge-functions test other than the one named in section 5 fails.
- You find a writer of the `users` blob that rebuilds user objects from scratch instead of
  spreading the existing record (it would silently drop `sessionVersion`, which "un-bumps" a
  user and revives their old tokens). As of today every writer spreads or appends.
- You find any code path that reads `session.role` or `session.shopId` to *authorise* (rather
  than to look up the record), since 2.4's "no bump on demotion" depends on there being none.
- The reviewer argues for `"revoked"` on a stale token. That's a product decision for Tanish
  (section 2.3), not something to resolve during implementation.

## 9. Rollout risk

**Can this cause an unexpected mass sign-out? Not as designed.** It can happen only under these
conditions:

1. **The `ver()` normaliser is skipped on one side.** For example `user.sessionVersion !==
   session.sessionVersion` with raw values, combined with anything (a backfill, a manual edit)
   that gives records an explicit `0` while tokens lack the field: `0 !== undefined` signs out
   everyone who has the field. Test 1 catches the code half of this.
2. **Someone runs the section 3 bump SQL without its `where u->>'id'` clause.** Every user on
   the platform goes to the overlay. That's recoverable (sign in again), and with no data loss,
   because the reason is `"expired"`.
3. **(Pre-existing, unrelated)** rotating `SESSION_SECRET`.

Even in cases 1 and 2, the failure is the **re-sign-in overlay with saves held**, not a device
wipe, because a stale token never answers `"revoked"`. The worst realistic outcome is a wave of
"please sign in again" prompts, not lost bills.
