# HANDOFF — read this first, write to it last

Two Claudes work on JewelOS and they cannot see each other:

- **Claude Code** lives in this folder. It has the code and git. It cannot see Tanish's
  memory, the `jewelos-brain` folder, the Control Room, or the live database.
- **Cowork** (the chat) has the live Supabase and Gmail, the Control Room, the brain
  folder and memory. It can read and write this folder through the device bridge.

This file is the only thing both of them read. If it isn't written here, the other side
does not know it. A commit message is not enough — Cowork does not read git log by habit,
and Claude Code does not read the brain folder at all.

**Claim the NOW line before you start, release it when you stop, and append a LOG entry
before you hand back.** End every entry with `→ FOR COWORK:` / `→ FOR TANISH:` (or
`→ FOR CLAUDE CODE:` from Cowork's side) — "nothing" is a valid, required answer, not an
omission. Read the WHOLE file before writing, not just NOW — this file has twice been
partly clobbered by a session saving from a stale copy (1 Oct, two separate incidents);
re-open it immediately before you write and confirm your entry is still there after.

---

## NOW — who is working, on what

> Nobody (released 22 Oct by Cowork/Sonnet after trimming this file). Where things stand: JEWELOS-2 crash fix `d02b968` is verified (428/0, check.bat clean) but local only — not pushed, not deployed, not phone-tested, waiting on Tanish's go (66th entry). Sentry replay masking: config confirmed, the visual look at a replay is Tanish's alone (64th entry). The 60th entry's low-priority polish list is still open for Claude Code. Older history was trimmed on 22 Oct; see the note at the bottom of this file.

---

## WAITING ON TANISH

Neither Claude can decide these. Don't re-litigate them each session; just surface them.

**Open:**

- **`RESEND_API_KEY` / domain — deliberately postponed to deployment day.** Tanish wants to buy a
  domain (picked `jewelos.co`, still unregistered), verify it in Resend, and set the two Supabase
  secrets (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) all at once when he deploys. Not an oversight —
  don't chase it early.
- **Karigar cost on orders** (for real profit on order bills) — Tanish said not now (1 Oct). Order
  bills still show Profit ₹0 because there's no recorded cost for an order line (batch41, confirmed
  still the case through the premium redesign).
- **[uncertain — resurfaced 3 Oct, not previously in this section] Hinglish vs English empty-state
  copy.** batch42 (1 Oct) converted the app's own Hinglish strings to English; batch46/the redesign
  then *added new* Hinglish empty-state copy in Reports/Orders/Purchases. Cowork flagged this as a
  conflict needing Tanish's confirmation on 2 Oct; still listed as "pending from Tanish" in Cowork's
  3 Oct batch47 entry. **This was never actually added to this WAITING ON TANISH section** — it only
  ever lived inside LOG entries, which is how it nearly got lost. Surfacing it here now.
- **[uncertain — resurfaced 3 Oct] Phone test of the new (premium redesign) design.** Listed as
  pending in Cowork's 3 Oct batch47 entry; not previously tracked here.
- **[open since 30 Sep, resurfaced 3 Oct, root cause found 22 Oct] Call the jeweller of shop `3720af09`**
  (a real shop, 0 saved bills ever; someone tried a bill 30 Sep and it didn't save). Raised 30 Sep,
  repeated 3 Oct. **22 Oct: likely root cause found** — a captured Sentry crash (`JEWELOS-2`, 1 Oct,
  on the Netlify URL) shows a `splitRows` crash in New Sale firing right as Save is clicked, before the
  save call ever fires — no error banner, looks like Save just does nothing (see 65th LOG entry). Still
  worth the call, now with a concrete question to ask instead of a generic one.
- **[not Tanish's decision, but open and untracked anywhere else] `jewelos-health` / `jewelos-client-queries`
  (Cowork's own account skills) write to the paused Office, and `jewelos-health`'s drift SQL still
  reads `nextInvNo`, stale since migration 005 changed the invoice-floor source.** Flagged by Cowork's
  3 Oct skills audit; explicitly out of scope for Claude Code to touch; Cowork/Tanish's to fix.
**Closed (don't re-ask):** (13 Oct) session token storage → Tanish confirmed keep
`localStorage`, no change · (13 Oct) `razorpay-webhook` → Tanish confirmed leave as is,
no disable/pause · Day Book receipt photos → skipped (needs Supabase Storage if it returns) ·
Demo mode → built, batch21 · renewal contact → `+91 72086 23428`, no UPI handle in code ·
owner-PIN test → built 27 Sep · e2e test shop → reset before a same-day re-run streak, no cleanup
logic in the app · login token (F1) → option B, 6 h life, PIN on reopen within 6 h · old-gold
deduction → jeweller decides · Memo Bill → no GST · (1 Oct) signup → "Start Your Shop →" ·
Aadhaar/PAN → not stored (purged on load) · offline billing → reserved numbers per phone (batch44) ·
(8 Oct) save-conflict trade-off → **Tanish chose Option A: keep current behaviour** (a conflict
matching an old "unconfirmed" save id always reports "saved," never a duplicate bill). Accepted
risk: in a rare case a genuinely different, later action can be silently dropped while reported
as saved — no code change, `js/01-sync-core.js`'s `_unconfirmedSaveIds.indexOf` branch stays as
is. **Superseded, same day: Tanish said "build it."** The rebase fix is now built and shipped —
see today's LOG entry. `js/01-sync-core.js`'s old `_unconfirmedSaveIds.indexOf` guess is gone,
replaced by the rebase branch; this Option A note is kept only for the history.
- **⚠ CORRECTED, was wrong in the original file: "Netlify badge → hidden with CSS" is NOT what
  actually happened.** batch43 tried `iframe.nl-badge-frame{display:none!important}`, but Cowork's
  live batch45 check (1 Oct) found the real badge has no class, so it stayed visible
  (`#nl-badge-frame`, no fix landed for that). Tanish's actual, later decision (recorded 2 Oct) was
  to **leave the badge visible and pad the bottom nav around it** (`.bnav` padding-bottom reserves
  64px for its footprint) — then on 3 Oct that same 64px was found to be a *double* reservation
  (safe-area-inset already covered it) and was removed as a separate mobile-nav bug fix. Net
  current state: **the badge is still live and visible**; nothing hides it. Don't claim it's hidden.

**Closed 9 Sep — billing.** Not free: JewelOS is a **paid monthly subscription, collected
outside the app.** Tanish demos in person, the shop pays by UPI, he sets `paidUntil` in
Supabase. There is no in-app payment and none planned. Enforcement shipped 9 Sep
(`paidUntil`), and the in-app upgrade path was removed the same day. Do not re-open this
or re-add tier UI.

---

## LOG — newest first

### 2026-10-22 (sixty-seventh entry) · Cowork (Sonnet) — trimmed this file at Tanish's request: old entries out, the newest and the open items kept

Tanish asked for all old entries removed and only the newest needed ones kept. Done in one pass, nothing lost:
- Full original (5,667 lines, sha256 `0579b3a7…a7d9`) copied byte-for-byte to `jewelos-brain/HANDOFF-ARCHIVE-2026-10-22.md` and hash-verified before the trim. That copy includes the uncommitted 65th/66th text. Git history also holds everything up to the 64th entry.
- Kept: header, WAITING ON TANISH (verbatim), LOG entries 60th–66th (the 60th still has open follow-ups for Claude Code), and the 3 Oct "still open" list, relabelled as unverified.
- Removed: entries 1st–59th plus the orphaned 49th entry that sat above the 65th. NOW was a ~20 KB running paragraph; replaced with a short current-state line.
- Not changed: the WAITING ON TANISH text. One item there is now partly stale (the `jewelos-health` drift SQL no longer reads `nextInvNo`; the skill's drift rule and constants were rewritten 21 Oct). The Office-write part of that item is still true. Left as is so this pass stays a pure trim.

→ FOR CLAUDE CODE: nothing — FYI only. Lookups for anything older than the 60th: `git log -p -- HANDOFF.md`, or ask Tanish for the brain-folder archive.
→ FOR TANISH: file is trimmed. If you ever need an old entry back, it is in `jewelos-brain\HANDOFF-ARCHIVE-2026-10-22.md`.

### 2026-10-22 (sixty-fifth entry) · Claude Code (Sonnet) — pre-launch resilience scan: found the root cause of the open "shop 3720af09 can't bill" item, confirmed by an independent Opus review

User asked a broad pre-launch question ("will this survive going live"). Ran the `jewelos-health` DB checks, then went further into the actual code and Sentry, since "will it survive" is a code-reliability question, not just a DB-state one.

**What the DB showed (not new — matches the existing WAITING ON TANISH note about shop `3720af09`):** blob last saved 2026-10-01 21:40 IST, `inv_no` counter last touched 2026-10-11 18:37 IST (10-day gap), 20-number drift, `sales:0`, `girvi:7`. The shop's owner (`srisaijewellers83@gmail.com`) kept logging in successfully through 16 Oct, but nothing has saved since 1 Oct.

**What's new — the actual mechanism, caught on tape.** `allocInvNo()` → `getNextCounter()` (`01-sync-core.js:849/913`) burns the server-side invoice number in its own `store-proxy` call; the sale itself is saved by a second, separate `saveToCloud()` call. The devs' own comment (`01-sync-core.js:910-911`) accepts gaps between the two as fine ("possible and acceptable; duplicates are not") — but the bill itself isn't supposed to vanish, since `saveToCloud` writes to `localStorage` before it ever touches the network and shows a persistent "Save failed" banner on final failure.

Checked Sentry for anything in that window: one unresolved issue, **`JEWELOS-2`**, first/last seen 2026-10-01 07:59:56 UTC (13:29 IST) — `TypeError: Cannot set properties of undefined (setting 'amount')` at `01-sync-core.js:852`, the `oninput` handler for a New Sale split-payment row (`splitRows[idx].amount=...`). Geo: Nashik, India. **URL: `heartfelt-queijadas-eeb356.netlify.app`** — the secondary Netlify deploy, not the Cloudflare Worker, so a real shop is actually using that stale URL day-to-day (not just parked, as I'd assumed earlier in the same session). The attached replay's breadcrumbs show the crash firing at the same timestamp as a click on the Sales panel's gold full-width button (the Save/Complete-Sale button) — i.e. the exception happens exactly where a sale-completion click would trigger it, and it happens in client-side code that runs *before* `saveToCloud` is ever called. That means this failure mode shows **no error banner at all** — `showSaveError()` only fires from inside `saveToCloud`'s own error path, which an uncaught exception upstream of it never reaches. From the jeweller's side this would look like clicking Save and nothing happening.

Root cause candidate in the surrounding code (not yet fixed, just diagnosed): `splitRows` is a module-level array (`01-sync-core.js:1087`); `removeSplitRow()` (`:1101-1102`) splices it and a reset path (`:1090`) replaces it outright, but the DOM nodes rendered by `renderSplitRows()` (`:1112`) close over the index at render time (`:1122`/`:1129`). If a row is removed or the array is reset without every stale input element being torn down first, a surviving old input's `oninput` fires against an index the (now shorter) array no longer has — exactly this crash. Same bug *family* as the already-fixed Edit Bill split-row bug (49th entry), different screen (New Sale, not Edit Bill), not yet fixed here.

**Independent Opus review of the whole audit (ran before this root-cause dig):** confirmed 4 of 5 findings as reported; downgraded the framing of the drift finding from "20 bills silently lost" to "this shop has never completed a single sale save since 27 Sep" (saves aren't silently dropped by `saveToCloud` itself — its own failures show a banner), and confirmed the Netlify-staleness finding but called it lower severity *assuming* Netlify was parked — which this entry's Sentry find contradicts. Also confirmed: `rls_auto_enable()`'s anon/authenticated RPC exposure is low-risk (event-trigger functions error if called outside a DDL trigger context), and RLS/`payment_events` are fine as designed.

**Not done:** no code fix attempted — this was a diagnosis pass. `JEWELOS-2` is Sentry's only captured instance (1 event, 1 user); can't rule out other unlogged crashes in the same `splitRows` pattern, since Sentry's `errorSampleRate` is 1 but a crash still has to be *seen* by a loaded Sentry SDK to be captured, and this shop was on the secondary Netlify URL at the time, not necessarily every session.

→ FOR COWORK: nothing blocking — FYI only, written from the Claude Code side using DB/Sentry MCP access, not the Office (still paused).
→ FOR TANISH: two things, not urgent-today but both open: (1) the `3720af09` call is now worth making with a concrete question to ask — "did Save just do nothing when you tried to complete a sale?" — rather than a generic "didn't save." (2) worth finding out why a real shop is still being pointed at the Netlify URL instead of the Cloudflare Worker, since that's the one Sentry actually caught a crash on.

**CORRECTION (same day, sixty-sixth entry below): "no code fix attempted" above is stale — a fix for this exact crash landed in `d02b968`, logged properly below.**

### 2026-10-22 (sixty-sixth entry) · Claude Code (Sonnet) — JEWELOS-2 fix verified; HANDOFF's own "not yet fixed" note from the 65th entry was stale

Picked this up on "go ahead" after the phone-test/HANDOFF review. Found the fix already existed: `d02b968` (local, 1 commit ahead of `origin/main`, authored under Tanish's own git identity with Claude co-authorship — a separate session, not this one) rewrote `renderSplitRows()` in `js/01-sync-core.js` so its `oninput`/`onchange` handlers and the remove button close over the row *object* instead of the index `i` captured at render time. A stale handler now writes into an orphaned object nothing reads, instead of indexing past a shrunk `splitRows` array. Also closes a second path the fix's own commit message flagged: a stale handler surviving a full form reset (`initSplitPayments` replacing the array) could previously have silently written a previous sale's amount into the new sale's model, not just crashed.

That commit's own HANDOFF edit only re-logged the 65th entry's diagnosis text verbatim — it never added a fix entry, so the file still claimed "not yet fixed" while the code said otherwise. Re-verified independently this session: read the current `renderSplitRows()`/`removeSplitRow()`/`initSplitPayments()` in full, matches the commit message exactly; `node tests/regression.test.js` → 428 passed, 0 failed; `check.bat` → clean, same pre-existing false-positive list as baseline, backup-check and roundtrip both clean.

**Not done:** not pushed to `origin/main` (stayed local, matching the "ask before push" default), not deployed, not phone-tested. The `3720af09` call and the Netlify-vs-Cloudflare question from the 65th entry are still open and unaffected by this — the fix stops the *next* crash, it doesn't retroactively restore the bills already lost to it.

→ FOR COWORK: the JEWELOS-2 crash fix is real and verified, not just diagnosed — update anything downstream that was tracking this as "diagnosis only."
→ FOR TANISH: this is a client-only fix (no Edge Function involved), ready to push/deploy whenever you say go.

### 2026-10-21 (sixty-fourth entry) · Claude Code (Sonnet) — re-checked Sentry Session Replay masking via MCP + a real login attempt; the visual check is still Tanish's alone to do

Picking the Session Replay masking item back up (38th/39th/40th/44th/45th entries). Two things tried, both already done before in some form, repeated here to make sure nothing changed and nothing new was missed:

**1. Sentry MCP (`find_organizations`/`find_projects`/`search_replays`/`get_sentry_resource`), no dashboard login required.** Found 10 replays in the last 30 days. The newest, `a8c8d68f500f4d67937b5d86397bc982` (started 2026-10-21 09:02:30 UTC, production, `jewelos.jewelos-e2e.workers.dev`), lines up with this session's own earlier Edit Bill live-verification pass. Its activity feed shows `options · payload="sessionSampleRate=0.1, errorSampleRate=1"` — matches `index.html`'s `Sentry.init` call exactly. 0 errors, 0 rage/dead clicks across all 10 replays checked. This is the same kind of config-level confirmation the 17 Oct re-check already gave; nothing contradicts it.

**2. Tried the actual replay player in a real browser** (Claude-in-Chrome, not just the API) — navigated straight to the replay's `jewelos.sentry.io/explore/replays/<id>/` URL. Hit Sentry's own sign-in wall (Google/GitHub/Azure SSO or jewelos SSO/email+password) — not authenticated in this browser, and no credentials available to this session. Did not attempt to log in.

**Still true, unchanged from the 40th entry:** the Sentry MCP's structured tools (`get_sentry_resource`, `search_replays`) return breadcrumbs, error counts, and config values — never the actual rendered rrweb frames. There is no way to confirm "the customer's name/phone/amount renders as a gray block, not real text" without a logged-in human opening the player and looking at it. That is categorically Tanish's (or whoever owns the Sentry account's) task, not something any amount of API access from here closes.

→ FOR COWORK: nothing new — FYI only, same gap as before, now re-confirmed current.
→ FOR TANISH: open https://jewelos.sentry.io/explore/replays/a8c8d68f500f4d67937b5d86397bc982/ (or any recent one) and eyeball it — that single look is the only thing left on this item.

### 2026-10-21 (sixty-third entry) · Claude Code (Sonnet) — Tanish's GO: CORS localhost carve-out (97b2c03) deployed to BOTH functions, verified live end-to-end

`auth-gateway` v9→v10, `store-proxy` v10→v11, exact committed source, `verify_jwt: true` unchanged on both (matches the prior version's setting — not touched).

**Verified live, not just deployed:**
- Preflight (`OPTIONS`) against both functions with `Origin: http://localhost:4173` — `Access-Control-Allow-Origin` correctly reflects it on both.
- Same preflight with the production origin (`jewelos.jewelos-e2e.workers.dev`) — still correctly reflected, unchanged.
- Same preflight with the look-alike `http://localhost.evil.com` — correctly falls back to the default origin, NOT reflected. The regex holds under live testing, not just the unit test.
- End-to-end: served the actual repo from `localhost:4173` in a real browser (not the sandboxed Playwright from the 61st entry — that sandbox has its own unrelated network restriction on spawned Chromium), submitted a real login with a bogus email/password. Got back "Incorrect email or password. 4 attempt(s) remaining before lockout." — a real `auth-gateway` response, not the old "Could not reach the server" CORS failure. The original gap from the 61st entry is confirmed closed.

Local server and browser tab both cleaned up after.

→ FOR COWORK: nothing blocking — FYI only. Local dev (yours or anyone's) can now log in against the real backend from any `http://localhost:*` or `http://127.0.0.1:*` origin; production origins are unaffected.
→ FOR TANISH: done and verified live, both functions. Nothing further needed on this one.

### 2026-10-21 (sixty-second entry) · Claude Code (Opus) — CORS localhost/127.0.0.1 carve-out in auth-gateway + store-proxy. Committed `97b2c03`, NOT deployed

Fixes finding 1 of the 61st entry: since the 14 Oct lockdown (`2518c79`) no local page (`npx serve`, `npm run test:e2e` on 4173 or any other port) could pass the browser's CORS preflight, so no local session could log in against the real backend.

- **Change (identical in both `supabase/functions/auth-gateway/index.ts` and `supabase/functions/store-proxy/index.ts`):** the 3-origin `ALLOWED_ORIGINS` list and its exact-match check are untouched. Added `LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/`; `corsHeaders()` now reflects the origin if it is in the list OR matches that regex, otherwise falls back to `ALLOWED_ORIGINS[0]` as before.
- **Why it is safe:** a browser only sends `Origin: http://localhost:…` from a page served on that same machine, so a random website still can't complete a login from a victim's browser — the 14 Oct reason holds. The regex is anchored at both ends: `http://localhost.evil.com`, `http://localhost:4173.evil.com`, `http://localhost:80@evil.com`, `http://evil.com/?http://localhost`, `http://evil.localhost`, `https://localhost:4173`, a trailing `/`, `127.0.0.2` and `null` all get the default origin back. Plain `http` only, port optional. `[::1]` not included (nothing here uses it).
- **Tests:** one new test in `tests/edge-functions.test.js` sends an OPTIONS preflight with each of those origins (plus the 2 non-default production origins and 3 local ones) to BOTH real handlers and checks `Access-Control-Allow-Origin`. **74 passed, 0 failed** (73 before). Against the old HEAD code the new test fails on `http://localhost:4173`, so it really checks the change. The pre-commit hook's regression suite: 427 passed, 0 failed. check.bat doesn't cover `supabase/`, so it was not run.
- **Not verified:** a real browser login from localhost. That needs the deploy first.
- Also committed in this HANDOFF commit: the 59th–61st entries, which were sitting uncommitted in the working tree when I arrived (text only, NOW was released).

**NOT deployed.** Same pattern as the 14/15 Oct CORS change: committed, waiting on Tanish. On GO: `supabase functions deploy auth-gateway` and `supabase functions deploy store-proxy` (keep `verify_jwt` as it is now, as the 54th entry did), then check one localhost preflight and one production-origin preflight against the live functions.

→ FOR COWORK: nothing — FYI only. Once this is deployed, local Playwright runs can log in against the real backend.
→ FOR TANISH: say GO when you want this live. It only changes which websites are allowed to call login/save. Production sites behave exactly as before; it adds your own computer (localhost) so local tests can log in.

### 2026-10-21 (sixty-first entry) · Claude Code (Sonnet) — Tanish's GO: Edit Bill fix (96dfb36) confirmed already live, verified end-to-end in a real browser against the Cloudflare Worker (all 3 bugs fixed)

Picking up the Edit Bill verification queue item (49th/50th entries). Two findings before any testing happened:

**1. Local dev (Playwright or a plain static server) cannot log in at all — root cause, not the ".env.test inaccessible" guess from the 50th entry.** `auth-gateway`'s CORS allowlist (`supabase/functions/auth-gateway/index.ts:102-106`, commit `2518c79`, 14 Oct) only allows three origins (`jewelos.jewelos-e2e.workers.dev`, `heartfelt-queijadas-eeb356.netlify.app`, `jewelos-test.pages.dev`) — `localhost` was never on it. The browser's preflight correctly reflects `jewelos.jewelos-e2e.workers.dev` back, so any `http://localhost:*` origin's real login POST is silently blocked client-side ("Could not reach the server" / `TypeError: Failed to fetch`). `curl` doesn't enforce CORS, which is why the edge function looked reachable. This has been true since 14 Oct — it blocks every local e2e spec, not just Edit Bill's. Not fixed (touches a live security control, out of scope for a verification pass) — flagging as a real gap in the local dev workflow.

**2. The Edit Bill fix turned out to already be live — no deploy needed.** Byte-compared every served file (`index.html` + all 11 `js/*.js`) against the Worker: all identical to current `main`. `96dfb36` (18 Oct) predates and is an ancestor of `4397bb9` (20 Oct, batch59's base), and `build-cf-deploy-stage.js` stages every `js/*.js` file on every deploy, not just the batch's own diff — so the Edit Bill fix rode along in the 20 Oct batch59 deploy and has been live since then. It was never flagged as deployed because nobody was looking for it specifically.

**Verification: logged into the live Worker (real browser, not sandboxed Playwright — same CORS issue applies there) as Lumineer JewelOS (Tanish confirmed safe to use for this).** Created a real Memo bill (₹1,56,500: 10g 22K custom item + ₹500/g making + ₹2,000 diamond, 3 split-payment rows: Cash ₹56,500 / UPI ₹50,000 / UPI ₹50,000), then:
- **(a) split-row removal:** removed the middle UPI row in Edit Bill. Live preview and the saved/reloaded bill both still show both remaining rows (Cash ₹56,500, UPI ₹50,000) — nothing dropped. Balance math checks out (₹1,57,500 − ₹56,500 − ₹50,000 = ₹51,000, confirmed on the printed invoice).
- **(c) bill-level extra making/diamond:** added Extra Making ₹300 / Extra Diamond ₹700 in the same edit. Saved invoice shows "Extra charges" row, Making Charges ₹5,300, Diamond/Stone ₹2,700, Grand Total ₹1,57,500 — all correct and persisted.
- **(b) refund locks edit:** issued a partial refund (₹1,000) on the same bill, then tried Edit again — refused with the toast "Bill has a refund against it — it can no longer be edited."

All 3 bugs confirmed fixed on the live production Worker. check.bat was already clean (11/11, backup-check/roundtrip pass) before this pass — no code changed this session, verification only.

**Cleanup:** the test bill (`INV-140`, "E2E VerifyEditBill") was deleted from the Lumineer JewelOS shop after verification — confirmed gone (dashboard back to ₹0 today's sales / ₹0 outstanding, no longer in Recent Activity).

→ FOR COWORK: nothing blocking — FYI only. The CORS/localhost gap (finding 1) affects your local Playwright runs too if you ever try them against a live-backed flow instead of the network-blocked/demo-data approach the 59th/60th entries used.
→ FOR TANISH: Edit Bill is confirmed fixed and live, verified end-to-end (not just code-reviewed) — same item you said GO on. Test data cleaned up, nothing left in Lumineer. The `jewelos-test.pages.dev` origin is still in the CORS allowlist but has no deploy script in this repo; worth confirming whether that origin is still in use or safe to drop from `ALLOWED_ORIGINS` next time auth-gateway changes.

### 2026-10-20 (sixtieth entry) · Cowork (Sonnet) — local Playwright run of batches 55–59 (HEAD d19c9db): no crashes, 3 real findings, all low
Local only (static server, all network blocked, client-side login bypass, no production, no credentials). 4 widths × 9 screens with demo data, plus sale / Edit Bill / orders flows.
- **Passes:** no page errors on any screen at 320/360/390/768 (only expected `loadFromCloud` fetch failures, network was blocked). Overpay blocked ("more than the bill due"). Sale saved with correct total (₹76,500 on 10 g 22K + ₹500 making at the locked rate). Edit Bill opens with `eb-making`/`eb-diamond`/split fields. Removing split row 1 of 3 keeps rows 0 and 2 with their values (49th entry fix confirmed). Bill with a refund is refused by `openEditBill` ("can no longer be edited"). `ordStatusOf` survives unknown/empty/null status; Orders renders a bad-status order and shows the Urgent pill.
- **Finding 1 (low):** text still below 11px after batch59 — `.fsn-label`, `.lbl`, `.ged-label`, `.bnav-label` (bottom nav) are 9px; some Reports DIVs 9–10px; ~130 `font-size:9px/10px` declarations remain in `js/*.js` inline styles. Batch59 only fixed `index.html` CSS. Same as the 58th entry's "8 uncaught 9px selectors", but bigger than 8.
- **Finding 2 (low):** at 320px Stock and Reports scroll sideways by ~9–17px (a `btn btn-sm` and report DIVs reach 329–337px). 360px and up are clean. Demo banner still wraps to 2 lines at 360px (already logged).
- **Finding 3 (info):** emoji still render as icons in the UI (🌟 💸 ✅ ✕ on the dashboard; ✏️ 📲 in Customers; ~18 on Girvi). Intentional or leftover from the batch56 emoji→svgIcon pass is Claude Code's call.
- **Not covered:** real Record & Sync against Supabase, real phone, VIP pill, Girvi loan save, add-product/customer save, GST bill, print/PDF. The sale test stubbed `takePoolInvNo` because offline invoice numbers need a network reservation. Not a bug.
- Test scripts live in Cowork scratch, not in the repo.
→ FOR CLAUDE CODE: optional, any order — (1) sweep the 9–10px values in `js/*.js` inline styles and the four 9px classes up to `var(--text-xs)`; (2) fix the two 320px overflows (Stock `btn-sm` row, Reports table wrapper); (3) tell Tanish whether the remaining emoji are intentional. Nothing blocking.
→ FOR TANISH: nothing is broken. Still needed from you: one real sale on your phone, then one VIP and one Urgent order. The 9px nav labels are readable but small, so judge them on your phone.

---

## Carried forward from the 3 Oct condensation (NOT re-verified since; check before relying on any line)

- The 2 items in WAITING ON TANISH → Open (RESEND_API_KEY/domain, Karigar cost).
- The 4 items this audit added to WAITING ON TANISH that were previously only buried in
  LOG entries (Hinglish copy decision, phone test of the redesign, call shop `3720af09`,
  `jewelos-health`/`jewelos-client-queries` stale-SQL cleanup).
- The Netlify badge is still live and visible — nothing in this file's history actually
  hides it, despite one closed-item note claiming otherwise (now corrected above).
- `_unconfirmedSaveIds`'s cross-call misattribution risk — flagged twice, fixed never,
  standing limitation in production code today (unless resolved outside this file).
- The save-lock rework (`save-lock-wip` branch) — designed-but-shelved, no current ETA.
- Whether `jewelos-batch47-DEPLOY.zip` was actually dragged into Netlify — Cowork cleared
  it, nobody in this file confirms the deploy happened.
- Whether removing the 3 Oct mobile-bottom-nav 64px padding re-exposed the original
  Netlify-badge/bottom-nav tap-target overlap it had been added to cover.
- `.btn-dark`'s 2 un-mockuped call sites, and 2 ad-hoc non-token color families in
  `02-ui-inactivity-modals.js` — both explicitly flagged as "say so if you want this
  changed," never answered.

---

*Trimmed 22 Oct 2026 (67th entry) from a 5,667-line history. Earlier condensation: 3 Oct 2026, 84 entries to ~2,600 lines. Entries 1st–59th are in `git log -p -- HANDOFF.md` and in `jewelos-brain/HANDOFF-ARCHIVE-2026-10-22.md` (full pre-trim copy). Nothing was deleted from the repo history.*
