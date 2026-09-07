# JewelOS security fixes — deployment guide

## Aug 2026 P0 hardening pass — addendum

A follow-up pass closed five more issues on top of everything below:

1. **The `counters` table gap called out in "What this does NOT fix"
   below is now closed.** `supabase/migrations/002_atomic_transactions.sql`
   locks `counters` down the same way `001_lockdown_rls.sql` locked
   `store`/`auth_store` (RLS enabled, no anon/authenticated policy —
   service_role only), and adds `increment_shop_counter()`, a single
   atomic Postgres statement. `store-proxy` now exposes it via
   `POST { action:'increment_counter', counter:'inv_no' }`, and
   `js/01-sync-core.js`'s `getNextCounter()` calls that instead of
   hitting `/rest/v1/counters` with the anon key. Deploy
   `002_atomic_transactions.sql` and the updated `store-proxy` together
   with this pass.
2. **`store-proxy`'s PUT handler was never actually atomic** — it did a
   `SELECT` then a separate `UPSERT`, so two concurrent saves could both
   pass the version check before either wrote. It now calls
   `store_cas_write()` (same migration file), which does the whole
   read-compare-write inside one `SELECT ... FOR UPDATE`-locked
   statement. The client-facing contract (200 `{ok:true,data}` / 409
   `{ok:false,conflict:true,data}`) is unchanged, so `js/01-sync-core.js`
   needed no changes for this part.
3. **Sale + stock deduction are now one write, not two.**
   `recordSale()` used to save the sale, then — only after that
   succeeded — deduct stock and fire a second, separate, fire-and-forget
   `saveToCloud()` for the stock change. A crash/network drop between
   those two calls left a sale on record with stock not yet deducted in
   the cloud. It's now `_commitSaleTransaction()`: stock is deducted and
   the sale is pushed in memory first, then a single `saveToCloud()`
   call persists both together (and rolls both back together on
   failure/conflict). A `_saleSubmitLock` flag also hard-blocks a second
   `recordSale()` call while one is still in flight (double-click /
   double-tap protection), on top of the existing content-based
   `isDuplicateSale()` check for a second *separate* click.
4. **The insecure `CREATE POLICY ... USING (true)` SQL block** shown in
   Settings → Data → Cloud Setup (copy-pasteable, meant to be run
   verbatim in the Supabase SQL Editor) is removed. It's replaced with
   setup notes pointing at the two migration files and the three Edge
   Functions — there is no anon-access SQL left anywhere in the app.
5. **`cloudDiag()` tested the wrong architecture.** It GET'd `store`
   directly via the anon key, which — after `001_lockdown_rls.sql` —
   always fails, so the diagnostic reported "Cloud connection FAILED"
   even when `store-proxy` (the only path the browser actually uses)
   was completely healthy. It now checks `store-proxy` and
   `auth-gateway` reachability instead.

None of the above required schema changes to `store` or `auth_store`
themselves, and no existing row in any table is touched — `002_atomic_transactions.sql` is additive/idempotent like `001_lockdown_rls.sql` before it.

---

This addresses the four unresolved findings from the July 21, 2026 audit.
**Read this fully before running anything — the migration will take your
app offline for existing users until the client is updated to match.**

## What's included

- `supabase/migrations/001_lockdown_rls.sql` — closes the critical
  finding: locks `store` and `auth_store` so the public anon key
  (embedded in your client JS — anyone can view-source it) can no
  longer read or write any shop's data. Also creates `login_attempts`
  and `payment_events` tables for the other two fixes below.
- `supabase/functions/store-proxy/` — the only thing that can touch
  `store` after the lockdown. Enforces per-shop isolation using each
  shop's `rowKey` (a real secret) instead of the shared anon key.
- `supabase/functions/auth-gateway/` — replaces direct client access
  to `auth_store`. Adds real server-side login rate limiting (5 failed
  attempts / 15 min, tracked in Postgres — a page refresh can't reset
  it) and enforces that only an owner's *session* (not just their
  client-side role flag) can add or remove staff.
- `supabase/functions/razorpay-webhook/` — plan upgrades now only
  happen when Razorpay's own signed webhook says a payment succeeded,
  not when the browser says so.
- Client fix already applied in this codebase: shop signup now
  generates `rowKey` with `crypto.randomUUID()` instead of
  `Date.now() + 4 random chars` (~20 bits, brute-forceable in minutes).

## Why RLS policies alone couldn't fix the critical finding

Every JewelOS client currently authenticates to Supabase with the
*same* shared anon key — there's no per-shop identity at the database
layer (your login system is custom, not Supabase Auth). Postgres RLS
decides access by who it thinks is asking; with one shared key, it
cannot tell shop A's browser from shop B's. So the only real fix is to
stop letting the browser touch these tables directly — hence the
Edge Function proxies, which hold the service_role key server-side and
enforce shop identity themselves via each shop's `rowKey` secret.

## Deployment order (do not skip steps)

1. **Deploy the three Edge Functions first**, before touching RLS:
   ```
   supabase functions deploy store-proxy
   supabase functions deploy auth-gateway
   supabase functions deploy razorpay-webhook
   supabase secrets set SESSION_SECRET=$(openssl rand -hex 32)
   supabase secrets set RAZORPAY_WEBHOOK_SECRET=<from Razorpay dashboard>
   ```
   `auth-gateway/index.ts` was extended after the original version of
   this doc — it now also has `change-password` and `update-shop`
   routes (used by the client changes below). Redeploy it even if you
   deployed an earlier version already.
2. **Client rewiring — DONE in this codebase** (previously the
   unfinished step described here). `js/01-sync-core.js`
   (`loadFromCloud`/`saveToCloud`) now calls `store-proxy` with
   `x-shop-key: <shop.rowKey>` instead of hitting `SB_REST` directly.
   `js/05-auth-login.js` / `js/04-orders-detail.js` now call
   `auth-gateway` for login, signup, add-staff, remove-staff,
   change-password, and update-shop instead of reading/writing
   `auth_store` directly. **This has NOT been tested against a real
   deployed project** — it was written against the Edge Functions'
   documented contract, but you (or the next Claude session, with
   these functions actually deployed) need to click through signup →
   onboarding → login-on-a-second-device → invite staff → remove staff
   → change password → edit shop profile before trusting it in
   production. Two things intentionally regressed and are documented
   inline where they happen:
   - **Forgot-password is disabled**, not reimplemented. The old
     version let anyone who knew an email address set that account's
     password — that's not a "wire it to the proxy" fix, it needs a
     real emailed reset-token flow. `showForgotPassword()` now shows
     an honest "not available yet, contact your owner" message instead
     of silently failing.
   - The old "pull everyone's users+shops, merge into local cache"
     background refresh (`saasLoadAuthFromCloud`) is gone — by design,
     a shop's browser should never have had download access to every
     other shop's password hashes. Each device now only ever caches
     its own user+shop, populated from login/signup/staff-management
     responses. One practical effect: if a staff member's role or
     shop-profile fields change on another device, this device won't
     see it until that user logs in again here — there's no more
     background sync of identity data across devices/tabs.
3. **Only after step 2 is confirmed working against your real Supabase
   project**, run `001_lockdown_rls.sql`. Running it before the client
   is confirmed working will lock every shop out immediately, with no
   fallback (the old direct-table code path has been removed, not just
   deprioritized — see `js/04-orders-detail.js` around `USERS_KEY`).
4. **Migrate existing shops' weak rowKeys.** Any shop created before
   this fix has `rowKey === shopId` (guessable). After deploying, add
   a one-time migration that, on next successful login via
   auth-gateway, checks if `shop.rowKey` doesn't match the UUID format
   and if so generates a new `crypto.randomUUID()`, updates the `shops`
   blob, and renames the corresponding `store` row's `id` to match —
   otherwise the store-proxy's `x-shop-key` check will reject every
   pre-existing shop.

## What this does NOT fix

- **Plans were removed separately** (every account is now hardcoded to
  Pro — see `js/05-auth-login.js` `saasSetSession`). That makes the
  Razorpay checkout/plan-activation wiring described in earlier drafts
  of this doc moot for now — there's nothing left to upgrade to. The
  `razorpay-webhook` function and its `notes: { shop_row_key, plan }`
  contract are still there, correctly built, unused. If paid plans come
  back, that's the wiring to revive.
- **In-app feature gating** (girvi/reports/orders tabs, `canAccess()`
  checks) is still enforced client-side only. Because all of a shop's
  business data lives in one JSON blob per row, restricting *which
  parts* of that blob a staff member can read/write server-side would
  require normalizing `store` into per-feature tables with their own
  RLS — a larger schema migration, not done here. What this pass does
  fix is the two places that actually mattered most: cross-*tenant*
  isolation (shop A can't read shop B's data) and staff *role escalation*
  (a staff account can no longer grant itself owner access, since
  auth_store is no longer directly writable).
- **XSS hardening** was handled separately, directly in the client
  code (see prior changes to `js/*.js`), not part of this
  infra/backend pass.
