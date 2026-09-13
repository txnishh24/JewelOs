# JewelOS security review — 14 September 2026

Claude Code (Opus), read-only. No code changed, no request sent to production, no
database touched. Scope: the three Edge Functions, both migrations, the ten client
modules and `index.html`, as they sit in this folder at commit `82705b4`.

Done in two passes the same day. Pass 1 read the server side line by line and the
client's auth-critical paths. Pass 2 read `index.html`, backup restore, local device
storage, the service worker, photo storage, exports and staff-role checks. It also
replaced pass 1's text search for unescaped output with a full syntax-tree inventory
(finding 2). Findings 9–11 come from pass 2.

## How to read this

Severity is about **what an attacker gets and what they need to already have**:

- **Critical / High** — needs little or nothing (an email address, a staff login) and
  gets another person's account or a shop's data.
- **Medium** — needs an unusual situation (a fired employee, two saves at once) or does
  limited damage.
- **Low / FYI** — worth knowing, not worth blocking launch on.

Where a finding depends on something only visible in the live system (secrets,
deployed versions, extra tables), it says so.

---

## 1. Password-reset codes can be guessed → any account taken over from just an email · HIGH

> **Status: fixed and deployed.** `migrations/003_reset_code_guess_limit.sql` + `auth-gateway`
> v3, deployed by Cowork (see `HANDOFF.md`). Only the newest code is accepted; 5 wrong guesses
> burn it. Covered by `tests/edge-functions.test.js`; Cowork verified the database function
> directly against the live project.

**Where:** `supabase/functions/auth-gateway/index.ts`, route `reset-password` (lines 435–473).
The client uses this flow (`js/05-auth-login.js:171`, `:201`), so the endpoint is live.

**What's wrong.** A reset code is 6 digits (900,000 possibilities), valid 15 minutes, and
up to 3 can be live per email per hour. `request-password-reset` is rate-limited.
`reset-password` — the route that *checks* a guess — has **no limit on wrong guesses at
all**, and a guess matching *any* of the 3 live codes succeeds.

**Attack.** Know an owner's email (a shop's printed bill or WhatsApp message is enough).
Ask for 3 codes. Fire guesses at `reset-password`. At a modest 50 guesses/second — one
laptop — that's ~45,000 guesses per 15-minute window against 3 codes, roughly a 15%
chance per window, repeated every hour. Parallel requests make it faster. Success sets a
new password: full access to the shop's sales, girvi loans and customer KYC, plus the
ability to add staff.

**Fix (small, server-only, no client change needed):** count failed `reset-password`
attempts per email in a table (same pattern as `login_attempts`); after ~5 wrong guesses
mark every live code for that email `used`. Also accept only the most recent code.
Because request/response shapes don't change, this Edge Function can deploy on its own.

## 2. Stored XSS — a staff account can hijack the owner's session · HIGH once a shop has staff

> **Status 14 Sep: partly fixed in batch19, NOT deployed.** Every field in the table below
> is now escaped, as are activity-log entries, and `auth-gateway` refuses `<`/`>` in names
> and shop details (server, deploys with the other two fixes). **Still open:** the remaining
> unescaped values reachable only by writing to the server directly — dropdown values,
> record ids in `onclick`, photo `dataUrl`s.

**What's wrong.** The app builds screens by joining strings into `innerHTML`. Text that
people type is supposed to pass through `escHtml()` first. Many places don't. If that text
contains HTML, the browser runs it.

**Reachable through normal screens, no technical skill needed to plant:**

| Field typed by a user | Who can type it | Rendered raw at |
|---|---|---|
| Girvi pledged-item description | any write role | `js/07-settings-plans.js:1012`, `js/08-girvi-viewmode.js:318`, `:1090` (receipt) |
| Order payment Ref and Note | any write role | `js/04-orders-detail.js:95`, `:423` (receipt) |
| Order item description | any write role | `js/04-orders-detail.js:413` (receipt), `:419`, `js/03-billing-numbers.js:1482` (orders dashboard) |
| **Shop name, city, phone, GSTIN** | owner **and manager** (`update-shop` allows both) | **every sale invoice** `js/02-ui-inactivity-modals.js:1729`, `:1830–1908`; order receipt `js/04-orders-detail.js:468`, `:470`; stock labels `js/01-sync-core.js:1652`; monthly report `js/07-settings-plans.js:21`, `:67`, `:84` (inside `<title>`) |

The receipt, label and report views are written into a new window with `document.write`.
That window runs with the app's own permissions and can reach the main app window, so
script planted in any of these fields can reach the session token.

**Reachable by anyone with a write-capable login using devtools:** pass 2 parsed all ten
modules into syntax trees and listed every value joined into HTML without `escHtml`,
`jsAttrEsc`, or a number formatter. It found **611: 238 object fields, 273 plain
variables, 100 function results.** Most are harmless in practice: app-defined labels,
icons and colours, counts, or HTML fragments the app built itself. But every value that
comes from the shop's blob is attacker-controlled, because any staff account can `PUT`
an arbitrary blob to `store-proxy`. Notable among them:
- purity, metal, payment mode, status and type, which look safe only because the UI
  uses dropdowns;
- 39 record `id`s spliced into inline `onclick="fn('...')"` (e.g.
  `js/02-ui-inactivity-modals.js:285–289`);
- girvi photo `dataUrl`s in `src` and `href` (`js/07-settings-plans.js:434`, `:1373–1374`);
- activity-log notes and users (`js/05-auth-login.js:838–839`, `js/06-inventory-stock.js:795–796`).

Pass 1's text search had put this at 89. It missed plain variables and any field name
it wasn't looking for, which is why the photo and shop-name spots were only found in
pass 2.

**Attack (staff → owner).** A staff member types `<img src=x onerror="...">` into a girvi item description.
The owner opens the Girvi tab. The script reads `SAAS.sessionToken` and sends it away. For
up to 12 hours the staff member holds an **owner** session: add or remove staff, change
shop details, read and write everything.

**Attack (manager → owner).** A manager puts the same payload in the shop name through
Settings. It runs the next time the owner prints an invoice, receipt, stock labels or
the monthly report.

**Also a plain bug:** a jeweller typing `<` in a description (e.g. `ring <5g`) corrupts
that card on screen today.

**Fix:** wrap each field in `escHtml()`. It's mechanical but wide, so start with the
user-typed fields in the table above. The shop-profile fields also deserve a server-side
guard: `auth-gateway`'s `signup` and `update-shop` should refuse `<` and `>` in name,
city, phone and GSTIN. No real shop name needs them, and it protects every view of
those fields, including future ones. Separately, `escHtml()` (`js/01-sync-core.js:984`) escapes `& < > "`
but **not `'`**, so any single-quoted HTML attribute is unsafe even when escaped. Don't
just add `'` → `&#39;` blindly: check that no caller feeds `escHtml` output into a
non-HTML context (WhatsApp text, `textContent`, a JS string), where `&#39;` would print
literally. `jsAttrEsc()` is correct as written.

## 3. Sessions cannot be revoked · MEDIUM

> **Status: server half fixed and deployed** (`store-proxy` v7, by Cowork). It rejects a
> removed user (401) and takes the role from the current record. **Client half
> fixed in batch19** (`jewelos-batch19-DEPLOY.zip`, not deployed): sign-out clears the
> token, and a 401 signs out with no Cancel. **Still open:** a password change doesn't end
> other sessions.

**What's wrong.** A session token is valid for 12 hours no matter what happens after it
was issued:

- **Removing a staff member doesn't cut them off.** `store-proxy` checks the token's
  signature and looks up the shop, but never checks the user still exists
  (`store-proxy/index.ts:157–167`). A fired employee keeps full read/write for up to 12h.
- **Role comes from the token, not the current record.** Same 12h window for any future
  role change.
- **Sign out doesn't clear the token.** `saasLogout()` (`js/05-auth-login.js:128`)
  removes `AUTH_KEY` but leaves `SAAS.sessionToken` in memory and
  `jewelos_session_token` in `sessionStorage`. On a shared shop computer the token stays
  usable in that tab after "Sign out", and it's still valid on the server.
- **A password reset doesn't end existing sessions**, so it doesn't lock out someone who
  already stole a token.

**Why it matters for a jeweller:** the realistic insider threat is an employee who's just
been let go and wipes or edits records on the way out — exactly the window this leaves open.

**Fix:** in `store-proxy`, after `resolveRowKey`, load the `users` blob (already loaded the
same way for `shops`) and reject if `userId` is missing or `shopId` doesn't match; take the
role from the record, not the token. To kill sessions on password change, add a
`sessionVersion` number to each user, put it in the token, and compare. In `saasLogout()`,
null `SAAS.sessionToken` and remove `SESSION_TOKEN_KEY` from `sessionStorage`. The
server and client halves are independent and can ship separately.

## 4. A staff login can wipe the whole shop, and nothing keeps the old version · MEDIUM (high impact)

**What's wrong.** Each shop is one JSON blob. `store-proxy` lets `owner`, `manager` and
`staff` replace the entire blob (`CAN_WRITE`), and `store_cas_write` overwrites it with no
history. A staff member can delete every sale, loan and customer — or quietly edit the
activity log to hide missing stock — with one request. `CLAUDE.md` already notes
per-module permissions can't be fixed incrementally in this design; that part is accepted.

**What *can* be fixed cheaply:** make the damage recoverable. Keep the previous version
server-side — a `store_history` table that `store_cas_write` writes the old `data` into
before each update (keep the last N, or the last 30 days). This protects against a
malicious staff member **and** against the app's own bugs — the backup that silently
dropped customers and suppliers (8 Sep) is the same class of loss.

**Classification:** schema change → 🔴 under `MODEL-POLICY.md` §8. Opus should plan the
retention and size limits; Claude Code writes the migration; Cowork applies it.

## 5. Login lockout can be abused, and raced · MEDIUM-LOW

- **Locking out an owner on purpose.** The 5-failures/15-minutes lockout is counted per
  email only (`auth-gateway/index.ts:214–223`). Anyone who knows the owner's email can
  send 5 wrong passwords every 15 minutes and keep them out of their own shop all day.
- **Race.** The count is checked *before* the attempt is recorded, so many guesses sent at
  once all pass the check. The limit of 5 isn't enforced against parallel guessing.

**Fix:** record the attempt before verifying and count including it; key the lockout on
email + IP (or use a growing delay instead of a hard lock) so a stranger can't lock out the
owner from elsewhere.

## 6. Account and shop records can lose writes · MEDIUM-LOW (integrity)

`auth_store` holds every user in one `users` row and every shop in one `shops` row. Every
change reads the whole array, edits it in memory, and writes the whole array back
(`getBlob` / `putBlob`), with no version check. Two changes landing together — two signups,
a staff invite during a password change, the Razorpay webhook during a signup — and one
silently disappears: an account vanishes or a password change reverts. Signup also writes
`shops` and `users` as two separate writes. Unlikely at six shops; real as it grows.

**Fix:** the same compare-and-swap pattern `store` already uses, or move users/shops to one
row each.

## 7. `razorpay-webhook` is still deployed though Razorpay is parked · LOW

The in-app payment path was removed on 9 Sep, but the function is still live and still
rewrites the whole `shops` blob (finding 6). It verifies Razorpay's signature, so it isn't
open — but if `RAZORPAY_WEBHOOK_SECRET` is unset in production the behaviour is undefined,
and in any case it's attack surface with no current purpose. **Recommend undeploying it**
until payments come back; the source stays in the repo.

## 8. Known, accepted, or FYI · LOW

- **`paidUntil` is enforced in the browser only** — already accepted on 9 Sep; real
  enforcement belongs in `store-proxy`. Not re-opening.
- **The PIN lock is a device convenience, not a security boundary.** A 4-digit PIN, hashed
  in `localStorage`, bypassable in devtools. Fine as long as nobody describes it as security.
- **CORS reflects any origin.** Harmless here because auth is a header token, not a cookie.
- **No Content-Security-Policy.** Would be good defence against finding 2, but the app uses
  inline `onclick` everywhere, so a meaningful CSP needs a large rework. Not before launch.
- **Signup has no email verification and no rate limit** — someone can register an account
  on another person's email, or flood signups. Low for now.
- **Which emails have accounts can be discovered** (signup says "already exists"; login is
  measurably faster for unknown emails). Low.
- **PBKDF2 at 100,000 iterations** is below today's recommended 600,000 but acceptable;
  raise it later with a rehash-on-login.

## 9. A full copy of the shop stays on the device after sign-out · MEDIUM

> **Status 14 Sep: fixed in batch19, NOT deployed.** Every sign-out clears `ssj_cache`
> and the rest of the device session, then reloads; a 401 does so with no confirmation.

**What's wrong.** To make the app open fast, `saveCache()` (`js/04-orders-detail.js:507`)
keeps the whole shop in the browser's `localStorage` under `ssj_cache`: customers and
phone numbers, girvi loans, sales, purchases, suppliers, ornament photos, the activity
log. `saasLogout()` (`js/05-auth-login.js:128`) doesn't remove it. The cache is tagged
with its shop id, so another JewelOS account on the same device won't *display* it
(this was fixed earlier). But the data stays on the phone indefinitely, readable by
anyone who picks it up and opens devtools, and by any script that finding 2 lets run.

**It also weakens the removed-staff fix (finding 3).** When `store-proxy` rejects a
removed user, the client calls `saasLogout()`, and that opens a **"Sign out?"
confirmation**. The removed employee can tap Cancel and keep browsing the entire shop
from memory and from `ssj_cache`, on their own phone. They can no longer fetch or save,
but they can still see everything.

**Fix (client):**
- On a 401 from `store-proxy`, sign out **without** asking, and clear `ssj_cache`,
  `ssj_last_save` and `ssj_last_cloud_load` along with the token.
- On a voluntary sign-out, clear the same keys.

This belongs in the same zip as finding 3's client half.

## 10. Restoring a backup trusts the file completely · LOW

`processBackupFile()` (`js/05-auth-login.js:989`) checks only that `version` starts with
`jewelos`. It then loads every list from the file into the shop and saves to the cloud,
replacing the real data. A doctored backup can carry anything finding 2 can: hostile
text in any field. The file *name* is also written into the activity log unescaped
(`'Data restored from backup: '+file.name`), and the activity log renders raw, so a file
named with HTML runs script when the log is viewed. This needs someone to restore a file
another person gave them. Fixing finding 2 covers most of it; escaping the log note
covers the filename.

## 11. Exported spreadsheets can carry formulas · LOW

The three CSV exports (monthly sales `js/03-billing-numbers.js:867`, all sales
`js/07-settings-plans.js:94`, purchase bills `js/09-purchases.js:1448`) quote every cell
correctly but don't neutralise cells that begin with `=`, `+`, `-` or `@`. A customer or
supplier name like `=HYPERLINK("http://…","Click")` becomes a live formula when the
owner, or their accountant, opens the file in Excel. Modern Excel warns before doing
anything dangerous, so this is minor. The fix is one line per exporter: prefix such
cells with `'`.

## Also checked in pass 2 — nothing new

- **Staff restrictions are UI-only.** Deleting products (`guardWrite`,
  `js/05-auth-login.js:540`) and the manager-only purchase and billing actions are
  checked in the browser. The server only distinguishes "can write" from "read-only".
  Finding 4 already covers this; there's no separate fix short of the data-model change.
- **The offline service worker never starts.** It's registered from a `blob:` URL
  (`js/08-girvi-viewmode.js:1639–1644`), which browsers refuse. The failure is caught
  silently. So it caches nothing, and it would have skipped Supabase requests anyway.
  Not a security issue, but it means the "works offline" behaviour this was written for
  doesn't exist.
- **Downloaded invoices are `.html` files** (`js/03-billing-numbers.js:67`) containing
  the same unescaped fields. Opening one from a phone's Downloads folder could run
  planted script, though in the `file://` context, away from the app's session. Covered
  by fixing finding 2.

---

## What's solid — don't "fix" these

- **RLS lockdown is correct.** `store`, `auth_store`, `counters` and the new tables deny
  the public anon key; only Edge Functions (service role) reach them.
- **Tenant isolation holds.** The client never names a shop. `store-proxy` takes the shop
  from the signed token and looks up its storage key itself, rejecting the legacy `main` row.
- **Session tokens are signed properly** and verified with `crypto.subtle.verify`
  (constant-time). They're kept in `sessionStorage`, not `localStorage`.
- **`readonly` is enforced on the server**, not just hidden in the UI.
- **Passwords:** PBKDF2 with a per-user salt; hashes never sent to the browser
  (`sanitizeUser`); the local user cache holds no hashes.
- **Reset codes are stored hashed**, and requesting one doesn't reveal whether the email
  has an account.
- **`jsAttrEsc()` is correct** for its context.
- **The SQL functions are sound:** atomic counter, true row-locked compare-and-swap, and
  `security definer` with `search_path` pinned.
- **`index.html` is clean.** No inline scripts; the only external resource is Google
  Fonts; password fields carry the right `autocomplete` values.
- **No secrets ship to the browser.** The only key in the client is the Supabase anon
  key, which is meant to be public now that RLS denies it everything. Both `service_role`
  mentions are comments. The Razorpay key is a placeholder.
- **Girvi photos are not in public storage.** They're re-encoded through a canvas
  (which strips anything that isn't image pixels) and kept inside the shop's own
  private record.

## Suggested order, against a late-September launch

1. **Finding 1 (reset brute force)** — before the first real shop. It's the only one that
   needs nothing but an email address. Server-only, small.
2. **Finding 3, server half (removed staff keep access)** — small, same deploy as 1.
3. **Finding 2, the user-typed fields in its table** (including the shop-profile fields
   and the server-side `<`/`>` guard) — before any shop gets a staff or manager account.
   Then the remaining unescaped fields as a batch.
4. **Finding 9 + finding 3's client half** — one client zip: sign out without a
   confirmation on 401, clear the token and `ssj_cache` on every sign-out.
5. **Finding 4 (version history)** — plan with Opus; before the first multi-staff shop.
6. Everything else after launch.

1–3 touch authentication, which is 🔴 under `MODEL-POLICY.md` §8. The fixes are narrow
enough for Sonnet to implement, but an Opus read of the diff before deploy is worth it.

## Not verified

- **That the deployed functions match these files.** As of 6 Sep `README.md` said they
  matched (`store-proxy` v6 pulled from production; `auth-gateway` and `razorpay-webhook`
  unchanged since May). Nobody has re-checked since.
- **Secrets:** whether `RESEND_API_KEY` and `RAZORPAY_WEBHOOK_SECRET` are set in
  production. If `RESEND_API_KEY` is unset, reset codes are written to the function logs
  instead of emailed — so real users can't reset, while finding 1 still works.
- **The live database beyond these two migrations.** Older versions of the app offered an
  in-app "SQL Setup" that created `USING (true)` policies. Any table created that way and
  not covered by `001`/`002` could still be publicly readable. Needs Supabase's security
  advisors run against the live project.
- **No live testing.** Nothing here was exploited against production; every finding comes
  from reading the code. The XSS paths are confirmed by tracing input to output, not in a
  browser.
- **Not every one of the 611 unescaped values was traced to its source.** The table in
  finding 2 lists the ones confirmed reachable by typing into the app. For the rest, the
  safe assumption is "reachable by a staff account with devtools", which is why the fix
  is to escape them all rather than to judge each one.
- **Netlify.** The live site's response headers and hosting settings weren't checked;
  there's no `_headers` or `netlify.toml` in this folder.
