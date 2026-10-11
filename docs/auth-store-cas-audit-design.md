# auth_store: compare-and-swap writes + history (HANDOFF Phase 5 items 7 and 8)

Status: proposal, 11 Oct 2026. Risk class: 🔴 (auth data, schema migration, cross-tenant data
integrity: MODEL-POLICY §8). No code written. Design by Opus. Implementation is for a Sonnet
(Claude Code) session, the migration is applied by Cowork, and an Opus review of the diff follows
(MODEL-POLICY §3).
Destination: `Desktop\jewelos\docs\auth-store-cas-audit-design.md`. The HANDOFF entry is separate.

Scope: `getBlob`/`putBlob` in `supabase/functions/auth-gateway/index.ts` (lines 139-148), every
writer of the `auth_store` table (section 1 has the verified list, which includes one writer
**outside** auth-gateway), and a history table for `auth_store`. Section 2 explains why
`store_history` for the `store` table, which is what HANDOFF item 8 literally names, is
designed but **not** included in this migration.

---

## For Tanish, in plain words

Every login account in JewelOS lives in one shared list, and every shop lives in another. That
means one list for all users of all shops. When someone signs up, changes a password, or adds or
removes staff, the server copies the whole list, changes its own copy, and saves the whole list
back. If two of those happen at the same moment, even in two unrelated shops, the second save
overwrites the first. One shop's new staff member, or one owner's new password, silently
disappears. Nobody sees an error. It's rare today because there are few shops, but it gets more
likely with every shop you sign up.

The fix gives each list a version number. A save only goes through if the list is still at the
version the server started from. If someone else saved in between, the server picks up the
fresh list, re-applies its own change on top, and saves again, without the user seeing anything.
Both changes survive.

Alongside that, every change to either list now also keeps a copy of what the list looked like
before, for 30 days. If an account or shop ever goes missing, we can see exactly when, and what
changed it: which screen, which user, or "someone edited the database by hand". That copy is
written in the same step as the change itself, so one can't happen without the other.

---

## 1. Current state (verified against the code, 11 Oct)

`auth_store` has two rows, `id='users'` and `id='shops'`, and each row's `data` is a JSON
**array** holding every user or every shop on the platform (`001_lockdown_rls.sql` lines 40-48).
The table's DDL was never in a migration, because it was created by the old in-app setup SQL. So
the repo can't confirm the exact column list. This design only relies on `id` and `data`, and
adds one column itself.

`getBlob` (line 140) reads `data` and returns the array. It has no concept of a version.
`putBlob` (line 145) `upsert`s the whole array, with no lock and no check.

**Writers. The real list is seven, not six:**

| # | Where | Blob | What it changes |
|---|---|---|---|
| 1 | auth-gateway `signup` (303-305) | `shops`, then `users` | appends one shop, then one user. These are **two separate writes** |
| 2 | auth-gateway `change-password` (323-332) | `users` | one user's hash/salt |
| 3 | auth-gateway `update-shop` (342-358) | `shops` (actor check reads `users`) | one shop's five profile fields |
| 4 | auth-gateway `add-staff` (368-395) | `users` | appends one user |
| 5 | auth-gateway `remove-staff` (405-417) | `users` | removes one user |
| 6 | auth-gateway `reset-password` (515-525) | `users` | one user's hash/salt |
| 7 | **`razorpay-webhook/index.ts` 103-113** | `shops` | one shop's `plan`/`planActivatedAt`, using its own raw `.update()`, not `putBlob` |

HANDOFF's list missed #7. It matters: a payment that lands while any `shops` write is in flight
(signup, update-shop) can silently lose either the new shop or **the shop's paid plan
activation**. That's a paying customer left on `free`. Fixing only `putBlob` would leave it open.

There's also an eighth, informal writer: **Cowork's manual SQL** (`docs/HANDOFF-ARCHIVE.md` ~line 3693
shows `update public.auth_store set data = (select jsonb_agg(...) ...)` used to delete test
accounts). Today a gateway write that read the array before such an edit silently undoes it.

**Readers that don't write:** `login` (249, 257), `request-password-reset` (458), `loadActor`
(159), and `store-proxy`'s `resolveTenant` (`store-proxy/index.ts` 150-151, on every request).
These need no change (section 5).

**No sentinel fields in the records.** The `newShop`/`newUser` literals (signup, 294-301) carry
only business fields: no `_v`, no `_saveId`. Even if they had one, a per-record field can't
version the array as a whole.

---

## 2. Scope correction: HANDOFF item 8 names `store`, not `auth_store`

Item 8 (HANDOFF ~line 1135) reads: *"a `store_history` table that `store_cas_write` writes the
previous `data` into"*. That's the **per-shop business blob** (sales, stock, girvi), not
`auth_store`. The brief for this design asked for `auth_store` history. Both are real gaps, but
they have very different costs:

- **`auth_store` history is cheap.** Auth writes are rare (signups, password changes, staff
  changes: a handful a day). The `users` blob is about 350 bytes per user, so roughly 100 KB at 300 users.
  Thirty days of full copies is a few MB to tens of MB. **This is in the migration.**
- **`store` history at "last 30 days of full copies" is not viable.** The shop blob can reach
  about 2.5 MB (HANDOFF line 3200; girvi photos are about 94% of one real shop's blob, per the
  HANDOFF-ARCHIVE line 228 figure). `saveToCloud()` writes it after every sale, edit or payment. A busy shop
  doing 200 saves a day at 0.5 MB is **about 100 MB per shop per day, about 3 GB per shop per month**.
  That's a storage-plan and money decision for Tanish, not a design detail. A viable shape is
  the same trigger pattern as below, but **throttled**: at most one snapshot per shop per hour,
  kept for 7 days (168 × blob size, about 85 MB per busy shop worst case). It still needs Tanish's
  sign-off on cost, and a check of which Supabase plan and backups (daily backups or PITR) the
  project already has. Those may already cover "what did this shop look like yesterday".

**Decision:** this migration carries item 7 (CAS) and the `auth_store` half of item 8. `store`
history becomes its own small follow-up migration once Tanish has answered the cost question.
Bundling it here would hold the auth fix hostage to a pricing decision. The "plan them
together" reasoning in HANDOFF still holds for what's bundled: CAS and history share one hook
point (section 7).

---

## 3. Decision 1: keep the shared array, use optimistic CAS (not a held lock, not a restructure)

**Three options:**

**A. Restructure `auth_store` into one row per user and per shop.** This is the "right" end state:
contention becomes per-record, and history becomes per-record diffs. But it changes the data
shape that `store-proxy`'s `resolveTenant` reads on **every request** (the hot path of the whole
app), plus `razorpay-webhook`, every auth-gateway route, the edge-function test mock, and it
needs a live data migration of every existing account. That's a large blast radius in
launch week, for a race that is rare at today's scale. **Rejected for now.** HANDOFF's
"applied to getBlob/putBlob" scope is right.

**B. Hold a lock for the whole read-modify-write.** This isn't possible from an Edge Function. Each
`supabase.rpc()` / `.from()` call is its own transaction, so a `for update` lock can't be held
across the PBKDF2 hashing and validation that run in TypeScript between the read and the
write. Moving all the route logic into PL/pgSQL to get one transaction means rewriting six
routes' validation in SQL. **Rejected.**

**C. Optimistic compare-and-swap on the whole array (chosen).** This is the same shape as
`store_cas_write` (002): read `{data, version}` with no lock, compute the new array in
TypeScript, then call one Postgres function that locks the row, compares the version, and writes
only if it still matches.

**What actually gets serialized, and the ceiling.** The `for update` lock is held only for the
microseconds the CAS function runs, **not** for the whole request. So "every auth write in
the system goes through one lock" is true, but the lock window is tiny. Two writers only
collide if their read-to-CAS windows (about 10-50 ms of network plus hashing) overlap, and the loser
retries (section 6). At today's scale (tens of shops, a few auth writes a day) contention is
effectively zero. The real ceiling is not the lock. It's **payload size**: every write sends
the whole `users` array (every user's hash and salt) to Postgres, and every write copies it into
history. That's linear in total users, per write.

> ponytail: whole-array CAS. Upgrade to option A (one row per user and per shop) when the
> `users` blob passes about 2,000 users (about 700 KB per write), or `auth_store_history` passes about 500 MB.
> Note that `store-proxy` already reads both whole blobs on every request today. That is an
> existing ceiling of the same kind, and option A would fix both.

**Why the version lives in a column, not inside `data`.** `store_cas_write` keeps `_v` inside
the JSON object (`p_data || jsonb_build_object('_v', ...)`). `auth_store.data` is an **array**,
and `array || object` **appends an element**. A naive port would add a `{"_v": 3}` "user" to
the users list. So this migration adds `auth_store.version integer not null default 0`. Adding a
column with a constant default is metadata-only in Postgres 11+, so there's no table rewrite,
and the two existing rows start at 0.

---

## 4. The migration (SQL)

File: `supabase/migrations/008_auth_store_cas_history.sql` (number provisional, see the Cowork
checklist). The comment style and the revoke/grant block follow 002 and 007.

```sql
-- ── 1. version column ───────────────────────────────────────────────────
alter table public.auth_store
  add column if not exists version integer not null default 0;

-- ── 2. history table ────────────────────────────────────────────────────
-- Holds password hashes, salts and every shop's rowKey (the store-proxy
-- bearer secret), exactly as sensitive as auth_store itself: same lockdown.
create table if not exists public.auth_store_history (
  id bigint generated always as identity primary key,
  row_id text not null,            -- 'users' | 'shops'
  old_version integer not null,
  new_version integer not null,
  old_data jsonb,                  -- the array as it was BEFORE this write
  actor text,                      -- '<function>:<route>:<userId>'; NULL = not via
                                   -- auth_store_cas_write (direct SQL edit or an
                                   -- un-migrated writer). Same idea as 007's 'manual-'.
  created_at timestamptz not null default now()
);
create index if not exists auth_store_history_time_idx
  on public.auth_store_history (created_at);
alter table public.auth_store_history enable row level security;
revoke all on public.auth_store_history from anon;
revoke all on public.auth_store_history from authenticated;

-- ── 3. history + version trigger: fires for EVERY data-changing update ──
-- CAS function, legacy upsert, razorpay-webhook, Cowork's manual SQL alike.
create or replace function public._auth_store_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Always OLD+1, whatever the writer put in NEW.version: the version can
  -- never go backwards or be forged by a manual edit (same rule as 007).
  NEW.version := OLD.version + 1;
  insert into auth_store_history (row_id, old_version, new_version, old_data, actor)
  values (OLD.id, OLD.version, NEW.version, OLD.data,
          nullif(current_setting('jewelos.actor', true), ''));
  -- Retention: auth writes are rare, so pruning here costs nothing and
  -- needs no pg_cron. If nothing is written for 30+ days, old rows simply
  -- wait for the next write. Harmless.
  delete from auth_store_history where created_at < now() - interval '30 days';
  return NEW;
end;
$$;
revoke all on function public._auth_store_history() from public;
revoke all on function public._auth_store_history() from anon;
revoke all on function public._auth_store_history() from authenticated;

drop trigger if exists _auth_store_history on public.auth_store;
create trigger _auth_store_history
  before update on public.auth_store
  for each row
  when (OLD.data is distinct from NEW.data)
  execute function public._auth_store_history();

-- ── 4. CAS write: store_cas_write's shape, for a whole-array row ────────
create or replace function public.auth_store_cas_write(
  p_id text,
  p_data jsonb,
  p_expected_version integer,
  p_actor text
)
returns table(ok boolean, conflict boolean, cur_version integer, current_data jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
  v_version integer;
begin
  if p_id not in ('users', 'shops') then
    raise exception 'auth_store_cas_write: unknown row %', p_id;
  end if;
  -- An object/null here would replace every account on the platform.
  if jsonb_typeof(p_data) is distinct from 'array' then
    raise exception 'auth_store_cas_write: data must be a JSON array';
  end if;

  select a.data, a.version into v_existing, v_version
    from auth_store a where a.id = p_id
    for update;

  if not found then
    -- Fresh database only; production rows exist. Mirrors 002.
    if p_expected_version <> 0 then
      return query select false, true, 0, null::jsonb;
      return;
    end if;
    insert into auth_store (id, data, version) values (p_id, p_data, 1);
    return query select true, false, 1, null::jsonb;
    return;
  end if;

  if v_version <> p_expected_version then
    -- Hand back what's actually stored, so the caller can re-apply its
    -- change without a second round trip (same as 002's current_data).
    return query select false, true, v_version, v_existing;
    return;
  end if;

  -- ponytail: every legitimate route adds or removes at most ONE record per
  -- write. Refusing a bigger drop turns a client/route bug that would wipe
  -- the platform's logins into a 500 instead. Bulk cleanups are manual SQL,
  -- which doesn't go through this function.
  if jsonb_typeof(v_existing) = 'array'
     and jsonb_array_length(p_data) < jsonb_array_length(v_existing) - 1 then
    raise exception 'auth_store_cas_write: refusing to drop % records from % in one write',
      jsonb_array_length(v_existing) - jsonb_array_length(p_data), p_id;
  end if;

  -- Transaction-local: visible to the trigger below, gone at commit.
  perform set_config('jewelos.actor', coalesce(p_actor, ''), true);
  update auth_store a set data = p_data where a.id = p_id
    returning a.version into v_version;   -- post-trigger value (old + 1)
  return query select true, false, v_version, null::jsonb;
end;
$$;

revoke all on function public.auth_store_cas_write(text, jsonb, integer, text) from public;
revoke all on function public.auth_store_cas_write(text, jsonb, integer, text) from anon;
revoke all on function public.auth_store_cas_write(text, jsonb, integer, text) from authenticated;
grant execute on function public.auth_store_cas_write(text, jsonb, integer, text) to service_role;
```

Notes on the SQL:
- The output column is `cur_version`, not `version`. In PL/pgSQL an OUT column named `version`
  is ambiguous with `auth_store.version` inside the function's queries and fails at runtime.
  The `a.` aliases are there for the same reason.
- `nullif(..., '')`: after a transaction-local `set_config` ends, the variable still exists for
  the session as an empty string, not NULL. Without `nullif`, a later manual edit in the same
  session would log `actor = ''` instead of NULL.
- `returning a.version` sees the value the BEFORE trigger set, so the caller gets the true
  new version.
- A no-op write (same array) doesn't fire the trigger, the version stays put, and the function
  returns `ok`. That's correct.
- Concurrent **inserts** on a fresh database (no row yet) can still hit a unique-key error.
  002 has the same limit. It's unreachable in production, where both rows exist.
- **Additive and safe for the currently deployed functions.** The old `putBlob` upsert and the
  webhook's `.update()` keep working after this runs. On top of that, their writes immediately
  start getting a history row (with `actor` NULL) and a version bump, so the history is live
  from the moment the migration is applied, before any function redeploys.

---

## 5. Edge Function changes (traced against real call sites)

### The primitive

`putBlob` is deleted. `getBlob` **stays as it is** for the read-only paths (login,
request-password-reset, update-shop's actor check). That answers the "does every caller now
have to thread a version through" question: **no**. Only writers need the version, and they
get it inside one helper. `login`, `request-password-reset`, `loadActor` and `store-proxy`'s
`resolveTenant` are untouched.

```ts
type Rec = Record<string, unknown>;
const CAS_ATTEMPTS = 5;

// Read-modify-write one auth_store row with compare-and-swap. `apply` is called
// with a FRESH copy of the array on every attempt and must be synchronous and
// self-contained: all its checks (actor role, duplicate email, target exists)
// re-run against the latest data on a retry. Do any hashing BEFORE calling this.
// apply returns { res } to stop without writing (a 4xx), or { next, res } to write.
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
```

Actor string: `"auth-gateway:<route>:<session.userId or new userId>"`, or
`"razorpay-webhook:<eventId>"`. It identifies the request without putting an email (PII) in the
history table.

A thrown error becomes a 500 through `Deno.serve`, which is what a `putBlob` DB error does today. No new
error path.

### Traced call site 1: `remove-staff` (today, lines 405-417)

Today, `loadActor` reads `users`, the role and target checks run against that snapshot, and
`putBlob(users.filter(...))` writes **the snapshot**. Any user added by another shop between those
two lines is wiped.

After the change, the actor check moves **inside** `apply`, so a retry re-checks it against fresh
data. That also closes a small window where an owner demoted mid-request could still remove
someone.

```ts
const staffUserId = String(body.staffUserId || "");
return mutateBlob(supabase, "users", `auth-gateway:remove-staff:${session.userId}`, (users) => {
  const me = users.find((u) => u.id === session.userId);
  if (!me || me.shopId !== session.shopId) return { res: json({ error: ACCESS_CHANGED }, 401, origin) };
  if (me.role !== "owner") return { res: json({ error: "Only the shop owner can remove staff" }, 403, origin) };
  const target = users.find((u) => u.id === staffUserId);
  if (!target) return { res: json({ error: "User not found" }, 404, origin) };
  if (target.shopId !== session.shopId) return { res: json({ error: "That user does not belong to your shop" }, 403, origin) };
  if (target.id === session.userId) return { res: json({ error: "You cannot remove yourself" }, 400, origin) };
  return { next: users.filter((u) => u.id !== staffUserId), res: json({ ok: true }, 200, origin) };
});
```

The error messages and status codes are byte-for-byte today's, so the existing
`tests/edge-functions.test.js` assertions on this route still hold.

### Traced call site 2: `update-shop` (lines 342-358), which crosses two blobs

The actor check reads `users` while the write goes to `shops`. CAS covers the `shops` write. The
actor check stays a plain `loadActor` read before it, as today. The leftover window ("owner
demoted between the users read and the shops write") is the same TOCTOU that exists today,
milliseconds wide, and can't be closed without the option-A restructure or a two-row function.
**Accepted, not widened.** `loadActor` no longer needs to return `users` once add-staff and
remove-staff stop using it. Drop that field.

```ts
const { me } = await loadActor(supabase, session);
// ...unchanged 401/403 checks, patch building and hasMarkup check...
return mutateBlob(supabase, "shops", `auth-gateway:update-shop:${session.userId}`, (shops) => {
  const idx = shops.findIndex((s) => s.id === session.shopId);
  if (idx === -1) return { res: json({ error: "Shop not found" }, 404, origin) };
  shops[idx] = { ...shops[idx], ...patch };
  return { next: shops, res: json({ ok: true, shop: shops[idx] }, 200, origin) };
});
```

### Traced call site 3: `change-password` (323-332), where the async work stays outside `apply`

`verifyPassword` and `hashPassword` are PBKDF2 at 100k iterations, which is slow and async. So:
use a plain `getBlob` read, verify the current password, hash the new one, **then**
`mutateBlob`. Inside `apply`, re-find the user, and refuse if the stored hash is no longer the one
just verified. Otherwise two concurrent change-passwords (two devices, or an attacker holding a
stolen session and the old password) would both pass verification, and the later one would
silently win:

```ts
const verifiedHash = String(users[idx].passwordHash);
// ...verify, hash...
return mutateBlob(supabase, "users", `auth-gateway:change-password:${session.userId}`, (fresh) => {
  const i = fresh.findIndex((u) => u.id === session.userId);
  if (i === -1) return { res: json({ error: "User not found" }, 404, origin) };
  if (fresh[i].passwordHash !== verifiedHash) return { res: json({ error: "Your password was just changed elsewhere — please sign in again" }, 409, origin) };
  fresh[i] = { ...fresh[i], passwordHash: hashed.hash, salt: hashed.salt, mustResetPassword: false };
  return { next: fresh, res: json({ ok: true }, 200, origin) };
});
```

### The remaining writers

- **`add-staff`**: generate `tempPassword`, `hashed` and `userId` **before** `mutateBlob`, so a retry
  reuses them and the owner gets back the same temp password that was saved. Inside `apply`: the
  actor check (as in remove-staff, needing the owner role), then the duplicate-email check, then
  append.
- **`reset-password`**: `consume_password_reset_code` stays first, unchanged. Hash, then
  `mutateBlob` finds the user by email and sets the hash. A missing user returns the same generic 401 as today.
- **`signup`**: hash and generate the ids and `rowKey` first. Keep today's duplicate-email pre-check
  (a plain read). Then `mutateBlob("shops", append newShop)`, then `mutateBlob("users", ...)` with the
  duplicate-email check **repeated inside `apply`** (409 if a racing signup took the email).
  The order stays **shops first**, on purpose. If the users write then fails or loses the email
  race, the result is an orphan shop that no account points to and whose `rowKey` was never
  handed out. Invisible, harmless, same as today's failure mode. The reverse order would leave a
  user pointing at a missing shop, which can't log in and permanently holds the email.
  ponytail: orphan shops on a lost signup race. Sweep them if they ever show up in numbers.
- **`razorpay-webhook`** (lines 103-113): the functions share no module, so inline the same
  read, apply, `rpc("auth_store_cas_write")` and retry loop (about 15 lines) with
  `p_actor: "razorpay-webhook:" + eventId`. Keep the `rowKey`-not-found 404 inside `apply`.
  **Don't skip this one.** It's the writer most likely to lose a paid upgrade.

---

## 6. Decision 2: the losing writer retries on the server, invisible to the user

Scenario: add-staff for shop A and remove-staff for shop B land together, both on `users`. With
this design, both read version 7. Whichever CAS lands first moves the row to version 8. The
second gets `conflict` plus the fresh array, **re-runs its own `apply` on it** (re-finding its
own target and re-checking its own owner), and writes version 9. Both changes survive and
neither user sees anything.

**Why not fail the second writer and let the client retry?** There is no client retry:
`authGatewayCall` (`js/04-orders-detail.js` 1956-1967) throws on any non-2xx, and the screen shows
the error. A shop owner clicking "Remove staff" would get an error because a stranger in another
city signed up in the same 50 ms. They can't understand it and can't do anything about it, and
from their side it looks like the app is broken. A server-side retry is correct here because the
conflict is almost always with an **unrelated record** in the shared array, so re-applying the
change on fresh data is exactly what the user meant. This is different from the `store` blob,
where a conflict means two devices edited the **same** shop and the client really has to decide
(docs/save-conflict-fix-design.md).

**When is a re-apply unsafe?** Only when `apply` makes a decision from data that can change
between attempts. That's why every check lives inside `apply` and re-runs every time: actor role,
duplicate email, target exists and belongs to this shop, password hash unchanged. Anything that must
**not** change between attempts (ids, temp password, hashes) is computed once, outside.

**Bound:** 5 attempts. Losing 5 in a row needs 5+ other writers landing inside successive 50 ms
windows, which doesn't happen at JewelOS's write rate. If it ever does, the request fails loudly
(500) rather than looping, and nothing is half-written, because every CAS is all-or-nothing.

---

## 7. History: what it captures, and why it is atomic with the write

**Name: `auth_store_history`.** `store_history` (HANDOFF's name) must stay free for the `store`
table follow-up in section 2. Using it here would make the two easy to confuse in exactly the
incident where they matter.

**Per write:** `row_id`, `old_version`, `new_version`, `old_data` (the full array **before**), `actor`, and
`created_at`. **Old data only, not new.** The new state of version N is the `old_data` of the
history row for N+1, or the live row if N is current. So storing both doubles the size and adds
nothing. To answer "what changed at version N", diff `old_data` of N against `old_data` of N+1
(or the live row).

**Retention: 30 days, pruned inside the trigger.** It's time-based, not "last N rows", because the
question people ask is "when did this account disappear?", and write rate varies too much for N
to mean a fixed time span. Pruning lives in the trigger (one indexed delete per auth write, and
auth writes are rare), so there's **no dependency on pg_cron**. pg_cron is available on Supabase
but has to be enabled per project. Nothing in this repo uses it, and I have **not confirmed** it's
enabled on `uluzuwomwqsqxtejgzmf`. The trigger approach makes that question moot.

**Atomicity (question 5).** The history insert sits in a `BEFORE UPDATE` trigger on
`auth_store`. That runs **inside the same statement** as the CAS function's `update`, which
itself runs under the function's `for update` row lock, inside the one transaction PostgREST
opens for the RPC. If the history insert fails, the update fails. If the update fails or the
transaction rolls back, the history row vanishes with it. They can't drift apart.

I chose a trigger instead of a second `insert` statement written into the CAS function body for one
reason: **a trigger also catches writers that don't go through the function.** That covers the
legacy `putBlob` between migration and redeploy, a missed webhook, and Cowork's manual SQL. Those
show up with `actor = NULL`, which is precisely the "who did this" signal item 8 asks for, and
the same idea as 007's `manual-` label. An `insert` inside `auth_store_cas_write` would record
only the writes that were already safe. The CAS function's contribution to history is the one
`set_config('jewelos.actor', …)` line right before its `update`. That's the "hook point inside
the locked transaction", and it shows up as the `actor` column.

The same trigger also bumps `version` on manual edits. So a gateway write that read the array
before Cowork's manual cleanup now **conflicts and re-applies on top of the cleanup**, instead of
silently undoing it (section 1, the eighth writer).

**Sensitivity.** History rows hold password hashes and salts, including **old** hashes for 30 days
after a password change, and every shop's `rowKey`. The table gets the same lockdown as
`auth_store` (RLS on, nothing granted to anon or authenticated). Thirty days of old hashes adds
little risk compared with the live table, because an attacker who can read one can read the other.
That's still a reason not to stretch retention past 30 days.

**Recovering from a bad write** (for the HANDOFF runbook, not code):
```sql
select id, old_version, new_version, actor, created_at,
       jsonb_array_length(old_data) as records
  from auth_store_history where row_id = 'users' order by created_at desc limit 20;
-- then inspect / restore specific records from old_data. Never paste a whole
-- old array back over the live row: that undoes every later legitimate write.
```

---

## 8. Test plan

There **is** test infrastructure for both layers. No new infra is needed, only one new file
following an existing one.

**1. Postgres level: new `tests/sql-auth-store-cas.test.mjs`**, a copy of the
`tests/sql-inv-counter-floor.test.mjs` pattern (PGlite, real Postgres in-process. Run with
`npm i --no-save @electric-sql/pglite@0.2 && node tests/sql-auth-store-cas.test.mjs`). Set it up
with `create role anon/authenticated/service_role; create table public.auth_store (id text primary key, data jsonb);`
and seed `users` with `[{"id":"u1"},{"id":"u2"}]`. Then apply 008 and assert:
- The existing row starts at `version = 0`. CAS with expected 0 returns `ok`, `cur_version = 1`.
- **Stale write:** CAS with expected 0 again returns `conflict`, with `cur_version = 1` and
  `current_data` equal to the stored array. The row is unchanged and **no** history row is added.
- **Different-part race, done by hand:** writer A and writer B both read v1. A appends `u3` (ok, v2).
  B's remove of `u1`, computed on v1, conflicts. B re-applies on the returned `current_data`
  (ok, v3). The final array has `u2` and `u3`, so both changes survived.
- **One history row per write:** after the above, there are exactly 2 rows with `old_version`/`new_version`
  1→2 and 2→3, `old_data` equal to the pre-write arrays, and `actor` equal to the passed string.
- A manual `update auth_store set data = ...` (no function) bumps the version and logs `actor IS NULL`.
- A manual update that sets `version = 0` explicitly still ends at old+1, so the version can't be
  rewound.
- Rejections: a `p_data` that's an object, or `null`, raises. A write dropping 2 records raises. `p_id = 'x'`
  raises.
- Retention: insert a history row with `created_at = now() - interval '31 days'`, do one CAS
  write, and the old row is gone while the recent rows stay.
- A no-op write (same array) returns `ok`, the version doesn't change, and no history row is added.

PGlite is a single connection, so it **can't** prove the `for update` lock under real
concurrency. That rests on the same Postgres guarantee 002 and 003 already rely on. State this
limit in the test file header, the way `edge-functions.test.js` states its own.

**2. Edge Function level: `tests/edge-functions.test.js`.** Its fake Supabase already models
`store_cas_write` and `consume_password_reset_code` in JS (lines 95-108). Add a JS model of
`auth_store_cas_write` (version compare on `db.auth_store` rows, bump, push to
`db.auth_store_history`), plus a one-shot hook (`db.beforeRpc`) that lets a test mutate
`db.auth_store` between the gateway's read and its CAS call. New tests:
- **Cross-shop race:** owner A calls `add-staff`. The hook injects a different shop's new user just
  before the CAS. The result is 200 and **both** users are present, and `rpcCalls` shows 2
  `auth_store_cas_write` calls (proving the retry happened).
- **Re-check on retry:** `remove-staff`, with a hook that demotes the caller to `staff` before the
  CAS. The result is 403 and the target is still present.
- `change-password` where the hook changes the stored hash returns 409 and the hash is left as the hook set it.
- **`razorpay-webhook`** (if the file loads in the harness; otherwise note it as unverified): the hook appends
  a shop mid-flight, and both the new shop and the plan change survive.
- `db.fail['rpc:auth_store_cas_write']` on add-staff returns non-200, and `users` is unchanged.
- The existing tests at 230-234 and 502-521 inject `db.fail.auth_store`, which fails the **read**. They
  stay valid and must pass unchanged. The mock's `upsert` branch becomes dead for `auth_store`.
  Leave it, since other tables may use it.

**3. Manual verification SQL after applying**, in the migration's trailing comments (007 style,
`begin; ... rollback;`): CAS with a stale version conflicts, and a manual update creates a NULL-actor
history row. Then, **after the functions are deployed**, one real staff add and remove from the app on
Tanish's test shop, with `select actor, old_version, new_version from auth_store_history order by id desc limit 2`
showing `auth-gateway:add-staff:…` and `auth-gateway:remove-staff:…`. Like check 4 in 007,
that end-to-end step is the one that matters most.

`tests/e2e/` (Playwright) isn't the right layer. It can't produce a deliberate interleaving, and
the login spec already covers the happy path, so it should be re-run, not extended.

---

## 9. Risk and effort

**Size: small-medium.** One migration of about 120 lines, about 60 changed lines in auth-gateway (one helper
plus six route bodies, which get simpler), about 15 lines in razorpay-webhook, one new SQL test file, and about 6
new edge tests. One Sonnet session.

**Risk: 🔴.** Every login-account and shop write goes through it. Mitigations: the migration is
additive and the old functions keep working on top of it, the error messages are unchanged, and
the shrink guard plus the array-type guard turn the two worst-case bugs (wiping the users list, or
writing a non-array) into a refused write.

**Stop and escalate to Opus instead of pushing on if:**
- Cowork's `\d public.auth_store` shows columns this design didn't expect, especially a
  NOT NULL column with no default (breaks the insert path), an existing `version` column, or
  any existing trigger.
- Any **existing** edge-functions test fails after the route rewrite.
- You find another writer of `auth_store` that isn't in section 1's table.
- The session-versioning design (sibling doc) wants to write `users` from `login` or from
  `store-proxy`. That would put a CAS write on the hot path, and the section 3 ceiling needs
  revisiting.

---

## Implementation checklist for Claude Code

1. Confirm Cowork has applied the migration (HANDOFF line), or develop against the PGlite test
   first. The code must not deploy before the migration, because the RPC won't exist yet.
2. Write `tests/sql-auth-store-cas.test.mjs` (section 8.1). Run it against the migration file
   and get it green before touching TypeScript.
3. `auth-gateway/index.ts`: add `mutateBlob`, delete `putBlob`, keep `getBlob`. Rewrite the six
   writers as in section 5: ids and hashes **outside** `apply`, every check **inside** it, error strings
   unchanged. Drop `users` from `loadActor`'s return value once nothing uses it. Update the
   header comment's endpoint list, which is missing `change-password` and `update-shop`.
4. `razorpay-webhook/index.ts`: inline CAS loop, actor `razorpay-webhook:<eventId>`.
5. `tests/edge-functions.test.js`: model `auth_store_cas_write`, add the `beforeRpc` hook, add the section 8.2
   tests. All existing tests must pass unchanged.
6. Run `check.bat`, `node tests/edge-functions.test.js`, and the new SQL test. Report exact counts.
7. Run the `jewelos-security-auditor` agent (auth change, per CLAUDE.md routing), then an Opus review of the diff.
8. Deploy `auth-gateway` and `razorpay-webhook` (Cowork, or Tanish via the CLI, per the current deploy route).
9. HANDOFF entry ending with
   `→ FOR COWORK: run the post-deploy check in 008's trailing comments (staff add/remove on the test shop, check auth_store_history)`.

## Migration checklist for Cowork

1. **Number:** `supabase/migrations/` holds 001-007 as of 11 Oct, so this is **008**, provisionally.
   **Coordination risk:** three sibling designs are being written in parallel right now:
   `docs/session-versioning-design.md`, `docs/login-lockout-design.md` and
   `docs/login-timing-sidechannel-design.md`. None of them was in `docs/` when this one was written. Any of them may
   also claim 008. **Assign numbers in the order you actually apply them, not the order the docs
   arrived.** Recommended order: **this one first**, because session-versioning's code will write
   the `users` blob through `mutateBlob` (adding `sessionVersion` on password change), so it should
   be built on top of this one. Login-lockout touches only `login_attempts` and can go in any
   order, but it still needs its own number. I'm flagging this, not resolving it.
2. **Before applying:** run `\d public.auth_store` (or query `information_schema.columns`)
   and confirm the columns are `id`, `data` and possibly `updated_at`, with no existing
   `version` column and no triggers. Anything else means stop (section 9).
3. Apply `008_auth_store_cas_history.sql`. It's additive and idempotent, and the deployed functions keep
   working.
4. Immediately check: `select id, version from auth_store;` gives two rows at version 0, and
   `select count(*) from auth_store_history;` gives 0.
5. Run the trailing-comment manual checks inside `begin; … rollback;`.
6. Log in HANDOFF that 008 is live. Only **then** may Claude Code's auth-gateway and razorpay-webhook
   deploy (the RPC must exist first).
7. After deploy, do one staff add and remove on Tanish's test shop (`shop_mosftn7z0g1d`), and confirm
   two history rows with `auth-gateway:` actors.
8. **From now on, manual `auth_store` edits leave a NULL-actor history row and bump `version`.**
   That's expected, and it's the point. Note it in the manual-edit runbook. No other change to how
   you edit.
9. **Rollback**, if ever needed: `drop trigger if exists _auth_store_history on public.auth_store;
   drop function if exists public.auth_store_cas_write(text, jsonb, integer, text);` and redeploy
   the previous function versions. The `version` column and the history table can stay, since they're harmless.
