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

> Nobody. batch67 (Karigar 2.0 phases 3-4) is LIVE on the Cloudflare worker (deployed 31 Oct, Version ID `9bb23a74-04ab-463a-a296-e588478b3837`, rollback tag `batch66-live`). Older deploy history is in the archive.

---

## WAITING ON TANISH

Neither Claude can decide these. Don't re-litigate them each session; just surface them.

**Open:**

- **Backup of `public.store` (`tools/backup-store.js`, docs/BACKUP-SETUP.md) — deliberately postponed to the last day of launch (Tanish, 22 Oct).** Not an oversight, don't chase it early. Known cost, accepted: until then the Free-plan database has no backups, so Sri Sai's shop (`3720af09`, 12 girvi loans, 0 sales, last save 23 Oct) is a single unbacked row. [Corrected 30 Oct, 108th/111th entry: this line used to name `77c4aefe` with 411 sales / 124 girvi loans, but that is the E2E test shop, not a customer.] Do flag it again if a real shop starts billing heavily before launch day.
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
**Closed (don't re-ask):** the full list of past decisions is in `docs/handoff-archive/HANDOFF-LOG-through-2026-11-05.md` (section "WAITING Closed list and notes", at the end of that file). Still relevant: the Netlify badge is still visible, nothing hides it (don't claim it is hidden); session tokens stay in `localStorage`; `razorpay-webhook` is left as is.

**Closed 9 Sep — billing.** Not free: JewelOS is a **paid monthly subscription, collected
outside the app.** Tanish demos in person, the shop pays by UPI, he sets `paidUntil` in
Supabase. There is no in-app payment and none planned. Enforcement shipped 9 Sep
(`paidUntil`), and the in-app upgrade path was removed the same day. Do not re-open this
or re-add tier UI.

---

## LOG — newest first

### 2026-11-06 (hundred-and-seventieth entry) · Claude Code (Sonnet) — migrations 011 and 012 APPLIED to the TEST project `jewelos-test` (`mdqgbrcueedbieawxild`) on Tanish's say-so; `store-proxy` NOT deployed (cannot be); live project untouched; NOT merged

**Tanish said (6 Nov): deploy to the test project only.** `/careful` run first. State found: `jewelos-test` is a **SQL-only sandbox**: only the four `kg_*` tables from 010 (plus the `010_trigger_search_path` fix) and **no edge functions, no `store`/`auth_store`/session tables**. **Applied, in order:** `karigar_ledger_011_hardening` (the 011 function, comments left out of the call, logic identical) and `karigar_ledger_012_flag_and_owner_labour` (012, with `set search_path = public` added to the trigger function; the repo file now matches). `list_migrations` shows all four. **Smoke test on the test project (one transaction, rolled back on purpose, nothing left):** flag defaults off and is per shop; owner can set it; owner OPENING posts; a manager's LABOUR_ACCRUE is refused "labour entries are owner only"; the owner's labour posts; a manager cannot reverse it; a manager's ISSUE posts; the same op_id with another date is refused "different content". `get_advisors` security: only 5 INFO "RLS enabled, no policy" lints (the `kg_*` tables, intended default-deny). **`store-proxy` was not deployed:** it needs the base schema and secrets this project does not have, so the new `kg_status`/`kg_set_ledger` actions and the owner-only labour rule in `store-proxy` have still never run anywhere, and `tests/edge-functions.test.js` still cannot run (no `sucrase`). **Decision for Tanish before an end-to-end test is possible:** either build a full second backend on `jewelos-test` (all migrations 001-012, secrets, the three edge functions, a test shop) or test `store-proxy` against the live project with the flag off. Neither was done. **Live project `uluzuwomwqsqxtejgzmf`: nothing applied, nothing deployed.** On the live project the app runs the old `store-proxy`, which does not know `kg_status` (answers 400 = ledger off), so the new app build is safe there with the ledger off.

**Verified:** `list_migrations`, smoke test, advisors as above. **Not verified:** any call through `store-proxy`; the app against a backend that has the ledger; 010-012 on the live project.

→ FOR COWORK: the SQL half is done on `jewelos-test`; do not repeat it. Open for Tanish: how to test `store-proxy` end to end (second full backend vs live project with the flag off). Do NOT merge `karigar-2-task-2-5` and do NOT apply 010-012 or deploy `store-proxy` to the live project until that is decided.

### 2026-11-06 (hundred-and-sixty-ninth entry) · Claude Code (Sonnet) — Opus whole-branch review: one ship-blocker and five more findings, all fixed with tests that failed first; NOT merged, NOT applied, NOT deployed

Opus review of `d31e7a3..c13437f` (verdict SHIP-BLOCKER FOUND, only matters once a shop's ledger is on; the flag is off by default and 010-012 are on no database). **Fixed:** (1) **BLOCKER, stale flag:** a phone open when the owner switched the ledger on kept posting to the shop data only (the flag was read once at start). The flag is now asked again on every refresh tick; and a device that has never had an answer (no cached flag) whose first ask fails no longer guesses "off": `_kgFlagUnknown` makes gold entries wait with "Checking whether the ledger is on" until it knows. A server that answers 400 (does not know `kg_status`) means off even if the cache said on. (2) **Direct-path loss:** when the ledger accepted an entry and the shop-data save then failed or refused it, nothing was queued or parked; it now goes through `kgFinishQueued` (re-queued if the save failed, parked and shown on Reports if the shop data refused it). (3) **Double opening:** the opening-balances screen could post a second OPENING after the ledger was on; it is now refused, and the screen says why. (4) **Sign-out:** the refused list and other shops' queued entries on the phone were deleted without warning; the confirm and `kgLostNote` now count both. (5) **Wrong wording:** a "different content" refusal landed in the refused list as "in neither place"; it now says the ledger may already have it, and the accepted-date memory (`kg_outbox_posted`) is no longer wiped by sign-out. **Accepted, not fixed (Opus point 6):** the server cannot refuse blob-only gold writes (the shop data is one JSON blob), so a phone can still post blob-only for up to one refresh tick (~60 s) after the owner switches; "Blob vs ledger" will show it. **Test honesty:** the old "an old server means off" test passed only because it had just cached "off"; replaced with a real one. **Not checked by Opus:** migration 010's exception handler when 011 is skipped, `kg_balances`/`kg_journal_list` SQL, the full `saveToCloud` conflict path, `store-proxy` outside `kg_*`, e2e, a real browser, non-India timezones.

**Verified:** ledger client 90/0, `regression` 489/0, `karigar-v2` 66/0, `sql-kg-ledger` all passed, `scope`, `loadorder`, `unescaped-ids`, `backup-check`, `roundtrip` clean. **Not verified:** `tests/edge-functions.test.js` (still no `sucrase`: `kg_status`/`kg_set_ledger` untested); no browser run of the new messages; the 60 s tick was tested by source, not by running the timer.

→ FOR COWORK: unchanged from the 167th entry: apply 010, 011, 012 to `jewelos-test`, deploy `store-proxy`, E2E shop only first. Do NOT merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixty-eighth entry) · Claude Code (Sonnet) — opening-balances screen: the owner previews and posts what each karigar holds to the ledger before switching it on; NOT merged, NOT applied, NOT deployed

Reports (owner only), in this order: **Opening balances** (Preview, then "Post these balances" with a confirm; karigars below zero are listed as "needs review" and not posted; the result lists opened, already-there and failed with reasons), **Blob vs ledger** ("Check now" should show no difference), **Ledger switch**. It is a screen over the existing `kgMigrateBlobToLedger` (owner only, preview-then-confirm, op_id `migr:<karigar>`, safe to repeat); the engine is unchanged. So the whole path for a shop is now: apply 010-012 and deploy `store-proxy` (Cowork), then on the phone: opening balances, check, switch on. Browser-checked on the E2E shop with state injected and no post (preview list, negative balance flagged, turn-on confirm text, no page errors); the real post was not run.

**Verified:** ledger client 83/0 (2 new tests), `regression` 489/0 after the earlier run; browser check above. **Not verified:** a real post to a real ledger (010-012 are on no database); a karigar whose first post fails offline is reported "not opened" but its journal stays queued and sends later (known, the message says it is saved and will be retried).

→ FOR COWORK: nothing new beyond the 167th entry: apply 010, 011, 012 to `jewelos-test`, deploy `store-proxy`, then Tanish tries opening balances + switch on in the E2E shop only. Do NOT merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixty-seventh entry) · Claude Code (Sonnet) — the ledger flag is wired: held by the server, switched by the owner on Reports; new migration 012 (NOT APPLIED); labour owner-only now in the database too; NOT merged, NOT deployed

**Decided by Tanish (6 Nov): server-held flag** (not in the shop data, per the audit). **New `supabase/migrations/012_karigar_ledger_flag.sql` (NOT APPLIED):** table `kg_ledger_flag` (closed to anon/authenticated), `kg_ledger_status(shop)` and `kg_set_ledger(shop, on, by)` (service_role only); plus a trigger on `kg_journal` that makes `LABOUR_ACCRUE`/`LABOUR_PAY`, and reversing them, owner-only in the database (answers the automated review that wanted layer parity; the 011 posting function is untouched). **`store-proxy`:** new actions `kg_status` (owner or manager) and `kg_set_ledger` (owner only, `on` must be boolean). **App:** `S.kgLedgerOn` stays in memory only (a test checks `00`, `01`, `04`, `05` never store or restore it); `kgLoadLedgerFlag()` asks the server at `startAutoRefresh`; if the ask fails it falls back to the last answer this device got (`kg_ledger_flag::<shop>`), and an old server (unknown action) means off; Reports has a "Ledger switch" section, owner button with a confirm. Default is OFF everywhere until an owner turns it on. **Order for Cowork, all of it, nothing done yet:** apply 010, 011, 012 to `jewelos-test` (in that order), deploy this `store-proxy` after 012, run a real gold issue with the ledger on in the E2E shop, compare "Blob vs ledger", only then production. **Turning it on later does not move existing gold:** the shop's current balances must be posted as opening balances first (`kgMigrateBlobToLedger`, no screen calls it yet), otherwise "Blob vs ledger" will show every karigar as different. That screen is still to build.

**Verified:** `sql-kg-ledger` all passed against real Postgres (PGlite) including 012 (idempotent, flag, labour owner-only at the database); ledger client 81/0; `regression` 489/0; `karigar-v2` 66/0; `roundtrip`, `backup-check`, `loadorder`, `unescaped-ids`, `scope` clean. **Not verified:** `store-proxy` (no `sucrase`, so `tests/edge-functions.test.js` cannot run; the two new actions are untested and unrun); no browser run of the switch; no live call; 010/011/012 not on any database.

→ FOR COWORK: apply 010, 011, 012 to `jewelos-test` in order, then deploy `store-proxy`, then tell Tanish; do NOT merge `karigar-2-task-2-5`, do NOT touch production yet. The opening-balance move (`kgMigrateBlobToLedger` screen) must be built before any shop's ledger is turned on.

### 2026-11-06 (hundred-and-sixty-sixth entry) · Claude Code (Sonnet) — security audit A3 decided by Tanish: labour accrue and pay are owner-only on `store-proxy` and in the client; NOT merged, NOT applied, NOT deployed

**Decided by Tanish (6 Nov): A3 = yes, scope "labour only".** `LABOUR_ACCRUE` and `LABOUR_PAY` added to `KG_OWNER_ONLY` in `supabase/functions/store-proxy/index.ts` and `KG_J_OWNER_ONLY` in `js/12-karigar-data.js`; a manager now gets "owner only". Managers still reverse ordinary gold entries on the job screen (the earlier "approver reversals" decision, commit 56d76d8, stands). The parked-entry reverse button stays owner-only in the browser only, safe because A1 makes it refuse forged rows. **Side effect to know:** `store-proxy` stamps `approved_by` on every owner-only type posted by the owner, so an owner's labour journal can now only be reversed by the owner (011's "anything the owner approved" rule). **Not changed:** the SQL (011 `kg_post_journal` still lets a manager post labour at the database layer; its tests deliberately do that; access is only through `store-proxy`, which now blocks it). Needs a `store-proxy` deploy to take effect on the server; the client half is live with the next app build.

**Verified:** ledger client 78/0 (new test failed first), `regression` 489/0, `karigar-v2` 66/0. **Not verified:** `tests/edge-functions.test.js` (needs `sucrase`, not installed), so no automated test of the new server rule exists yet and `store-proxy` was edited without running it; no live call.

→ FOR COWORK: when 011 is applied and `store-proxy` is deployed, deploy this `store-proxy` version (owner-only labour). Still do NOT merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixty-fifth entry) · Claude Code (Sonnet) — security audit of the Karigar branch: two medium findings fixed, deploy-order rule and three decisions for Tanish; NOT merged, NOT applied, NOT deployed

`jewelos-security-auditor` (Opus) on `d31e7a3..a96df16`: tenant isolation, roles, approvals, 011 rules, outbox keying and sign-out wipe hold; no leaked secret; `npm audit` 0. **Fixed, tests failed first:** (A1) a staff login can rewrite the shop data, so a planted `kgParked` row could make the owner reverse a real ledger entry; `kgReverseParked` now refuses if the shop data already holds that `opId`, or if the ledger journal's KCUST line is not the parked row's karigar. (A2) `e.qty`, `l.qty`, `e.days` went into `innerHTML` unescaped (Karigar 2.0 screens, after the 24 Oct sweep); now `escHtml(String())`. **Deploy-order rule (U1, for Cowork):** the current `store-proxy` relies on migration 011 for which accounts a journal type may use. Against a database with only 010 a manager could post a RECEIPT that creates custody from nothing. **Apply 011 before or with any `store-proxy` that has `kg_*` actions**; whether 011 is on `jewelos-test` or production was not checked. **Decisions for Tanish (not changed):** (A3) the server lets a manager reverse any journal except ADJUST, OPENING, ENTITLEMENT_ACCRUE and owner-approved ones; the owner-only rule for parked reversals is browser-side only; enforce on the server or accept? Also managers can post LABOUR_ACCRUE and LABOUR_PAY with no owner check (money version of the gold rule). (A4/A5, low) labour `karigar_id`, `voucher_id`, `note`, `mode` accept any text and nothing renders them yet: escape them in any future screen; WIP and TRANSIT owner_ref are not on 011's plain-id list (defence in depth only). When `S.kgLedgerOn` is wired it must not come from the shop blob, or a staff login could switch the ledger off.

**Verified:** ledger client 77/0, `regression` 489/0, `karigar-v2` 66/0; the auditor ran `npm run test:sql` (all passed). **Not verified:** live state of 010/011 and the deployed `store-proxy`; e2e; a browser run of the A1/A2 fixes; no Opus review pass of the final diff beyond the auditor.

→ FOR COWORK: before anything else on the ledger, check with `list_migrations` whether 010 and 011 are applied on `jewelos-test`, and apply 011 with or before any `store-proxy` deploy. Still do NOT merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixty-fourth entry) · Claude Code (Sonnet) — branch review round 1: four real bugs fixed (ADJUST sign, two retry-date gaps, refused entries invisible); security audit still running; NOT merged, NOT applied, NOT deployed

Run on `d31e7a3..a96df16`: `jewelos-test-runner` all green; `jewelos-invariant-tester` found one bug and added 2 tests; `jewelos-bug-pattern-reviewer` (no shell, static read) found more, each checked against the code before fixing. **Fixed, each with a test that failed first:** (1) **ADJUST sign inverted between shop data and ledger**: an owner credit lowered what the karigar owes in the blob but raised custody on the ledger, so `kgReconcile` would show a permanent mismatch; `kgLedgerJournalFor` now negates it. (2) **`kgReverseParked` retry date** (invariant tester): now dated on the original journal's own day (`67434d6`). (3) **Save-again-after-midnight date**: once the server accepted a journal its outbox row (and its date) was gone, so a retry after a failed shop save got a new date and the server would call it different content; new device list `kg_outbox_posted::<shop>` (`kgPostedAdd/kgPostedDate`) remembers the accepted date; wiped with the other outbox keys. (4) **A refused queued entry vanished**: nothing read `kgRejectedList`; Reports now shows "Ledger refused these" (device-local, 50 newest). **Checked and not a bug:** the flush at start-up runs only after a successful load. **Not fixed, noted by the reviewer:** `S.kgLedgerOn` is not saved/loaded/backed up (known, must be wired before the flag); numeric fields `e.qty`, `e.days`, `l.qty` skip `escHtml` in `11-karigar.js` (blob numbers, low risk); stale header comment in `12-karigar-data.js`; `kgMigrateBlobToLedger` reports an offline OPENING as failed but leaves it queued (no screen calls it yet).

**Verified:** ledger client 75/0, `regression` 489/0, `karigar-v2` 66/0. **Not verified:** the Opus security audit has not reported yet; no browser run of the new "Ledger refused" section; `check.bat` steps 3 not re-run after these edits.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixty-third entry) · Claude Code (Sonnet) — browser check of the three new Karigar screens on the E2E shop; one wording fix; NOT merged, NOT applied, NOT deployed

Playwright (393x851, E2E shop `77c4aefe`, `saveToCloud` stubbed, state injected in the page, nothing written to the shop): (1) job screen shows "1 gold entry is waiting for confirmation from the ledger..." for a queued entry; (2) Reports shows the parked row and an owner-only "Reverse on ledger" button; clicking it opens the form (reason field, Cancel, Reverse); (3) `salesKeptNote()` returned "2 unsent bills stay on this phone..." for a bill outbox under another shop. No page errors. Found and fixed: the singular waiting line said "They send on their own"; now "It sends". The throwaway spec was deleted.

**Verified:** the above in a real browser; ledger client 70/0, `karigar-v2` 66/0. **Not verified:** pressing Reverse (it would call the real ledger, migrations 010/011 are not applied); the sign-out and expired-login notices themselves (only the note text); a real phone; Reports with several parked rows.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixty-second entry) · Claude Code (Sonnet) — Tanish's decision on unsent sales: keep and warn; sign-out and expiry notices now say unsent bills stay on the phone; NOT merged, NOT applied, NOT deployed

**Decided by Tanish (6 Nov): keep and warn** (not sweep). Checked first: `_clearDeviceSession` never deleted `jewelos_sale_outbox::<shop>`, so unsent bills already survive sign-out and are sent when that shop signs in again; the only gap was that nobody was told. New `salesKeptNote()` (`js/02-ui-inactivity-modals.js`) counts bills across every shop on the device and is added to the manual sign-out confirm, the forced sign-out notice and the expired-login notice (`js/05-auth-login.js`). Nothing is deleted. `ssj_unsynced` and `ssj_last_active` unchanged: they are flags, not data; `ssj_cache` is still wiped on sign-out as before (security review 14 Sep, finding 9). Also committed `checks/globals.json` (Tanish said yes; it also held pre-existing additions by others).

**Verified:** ledger client 70/0 (new test: bills survive `_clearDeviceSession`, note counts every shop; I did not run it red first, the function did not exist), `regression` 489/0, `karigar-v2` 66/0. **Not verified:** no browser run of the three notices; a removed employee's unsent bills now stay on that phone until that shop signs in there (already the case before this change, now stated rather than silent).

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixty-first entry) · Claude Code (Sonnet) — fixed a day-boundary bug in the Karigar report: a job closed between midnight and 5:30 am IST was counted on the previous day; NOT merged, NOT applied, NOT deployed

`kgReport` (`js/11-karigar.js`) took the day of a closed job from the first 10 characters of `closedAt`, which is UTC, but compared it with the local date range (`kgToday()`). It now converts `closedAt` to the local day with `dbDayKey`. This was the cause of the `karigar-v2.test.js` failure "report counts fixed gold of jobs closed in the period" (it only failed when run between 00:00 and 05:30 IST); the test needed no change. The same UTC slice is used for display of stage dates (`doneAt`, `startedAt`, line ~1528); not changed, cosmetic.

**Verified:** `karigar-v2` 66/0, ledger client 69/0, `regression` 489/0. **Not verified:** the fixed-gold figure on the live Reports screen; `check.bat` as a whole.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-sixtieth entry) · Claude Code (Sonnet) — owner can now reverse a parked gold entry on the ledger from Reports; NOT merged, NOT applied, NOT deployed

Reports > "Ledger has this, shop data refused it" now shows a "Reverse on ledger" button per row, owner only. `kgReverseParked` (`js/12-karigar-data.js`) reads the ledger (`kg_journal_list`, paged) for the journal with the parked entry's `op_id`, posts its exact mirror via `kgBuildReversal` with `op_id` `rv-<parked op_id>`, then removes the parked row and writes an audit line. A lost answer is safe: the retry sends the same `op_id`, the server says duplicate, and the row is then removed. Manager gets no button and the function refuses. After an automated security note it also refuses when the ledger journal's type, job or gold total differs from the parked row (ledger client 69/0). **Still open before the ledger flag may be wired:** Tanish's decision on unsent sales and the other shop-scoped keys (157th entry), a browser look at both new screens (waiting line, reverse form), and the whole-branch review (reviewer agents run once at the end, Tanish 6 Nov).

**Verified:** ledger client 68/0 (5 new tests, failed first); `regression` 489/0; `roundtrip`, `backup-check`, `loadorder`, `unescaped-ids` clean; `node --check` both files. **Not verified:** no browser run; no real server call (server answers are faked in the test); `karigar-v2.test.js` still fails "report counts fixed gold of jobs closed in the period" (same without my changes, cause not investigated); `check.bat` as a whole not run. Reading the ledger from the start each time is a known shortcut for a large ledger.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-06 (hundred-and-fifty-ninth entry) · Claude Code (Sonnet) — job screen now shows "N gold entries waiting for confirmation" for entries queued on that job; NOT merged, NOT applied, NOT deployed

New `kgQueuedForJob(jobId)` in `js/12-karigar-data.js` counts this user's queued ledger entries for one job; `kg2JobHtml` in `js/11-karigar.js` shows a warning line with it, so nobody re-enters an issue that is only waiting to send. This closes item 2b. **Still open before the ledger flag may be wired:** a reverse button for parked entries, Tanish's decision on unsent sales and the other shop-scoped keys (157th entry), and the whole-branch review. Tanish decided (6 Nov) to run the reviewer agents once, at the end of the whole Karigar work, not per step.

**Verified:** ledger client 63/0 (new test failed first); `node --check` on both files; `loadorder`, `unescaped-ids` clean. **Not verified:** full `check.bat` (not run; `regression`, `roundtrip`, `backup-check` skipped); no browser look at the new line; `tests/karigar-v2.test.js` fails "report counts fixed gold of jobs closed in the period: expected: 0 !== 2000", and it fails the same with this change stashed, so it is not from this change, cause not investigated.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fifty-eighth entry) · Claude Code (Sonnet) — ledger flush trigger: queued gold entries are now sent at app start, on every auto-refresh tick and when the phone comes back online; NOT merged, NOT applied, NOT deployed

New `kgTryFlush()` in `js/12-karigar-data.js`: does nothing unless this user has a queued entry, the phone is online, and no sign-in prompt is open (`saasReauthPending`); otherwise `kgOutboxFlush()`. Called from `startAutoRefresh()` (once at start and each tick, `js/01-sync-core.js`) and from an `online` listener (`kgOnlineHook`). With this, an entry left "pending" after its form was closed is now finished without waiting for a 401. **Still open before the ledger flag may be wired:** the job-screen "waiting for confirmation" line (needs a browser check), a reverse button for parked entries, Tanish's decision on unsent sales and the other shop-scoped keys (see 157th entry), and the Opus review of the whole Task 4 branch. Nothing sets `S.kgLedgerOn` yet.

**Verified:** `check.bat` clean, ledger client 62/0; both new tests fail without the change. **Not verified:** the real `online` event and the 60 s timer have not been run in a browser; the tick calls the flush even while the tab is hidden (it is a no-op when the queue is empty).

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fifty-seventh entry) · Claude Code (Sonnet) — audit of blockers 1-6: three medium findings fixed; ledger flag still must NOT be wired; NOT merged, NOT applied, NOT deployed

`jewelos-security-auditor` (Opus) on 87f781e..dd62be8: `_entry` never reaches the server or logs, parked entries are escaped, `kgParked` save/load/backup/restore complete. Three new medium findings, all fixed with tests that failed first: (1) `kgCommitEntry` could add the same `opId` twice (flush plus a slow Save-again); it now adds nothing if the `opId` is already there, and its undo only removes what it added. (2) `kgFinishQueued` parked an entry on any error, including a network failure or a busy lock; `kgTxn` now marks those errors `transient`, and the entry goes back in the outbox and the flush stops (the server answers duplicate on the retry). Only a real refusal is parked. (3) A boot after an expired login deleted every shop's queued gold with only the generic notice; new `kgLostNote()` counts all shops' queues and is used by both that path and `saasForceLogout`. `jewelos-invariant-tester`: no gap needing a new test; minor untested: a 401 mid multi-entry flush, a changed `type`/`job_id` under a queued op_id.

**Open, needs Tanish's decision:** the automated review noted that other shop-scoped keys (unsent-sales outbox, `ssj_unsynced`, last-active) have the same boot-time gap. Older than this work and out of ledger scope; a sweep would delete unsent sales silently, so it needs a decision (warn, keep, or sweep). **Still open before the flag is wired:** nothing flushes the outbox at app start or when the phone comes back online (only the 401 sign-in path does); job-screen "waiting for confirmation" line (needs a browser check); a reverse button for parked entries; restore uses `if(d.kgParked)` without `Array.isArray` (matches its neighbours); the Opus review of the whole Task 4 branch.

**Verified:** `check.bat` clean, ledger client 60/0. **Not verified:** no browser run; `tests/edge-functions.test.js` still needs `sucrase`.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fifty-sixth entry) · Claude Code (Sonnet) — ledger blocker 6: clearing the device now removes every shop's outbox keys; NOT merged, NOT applied, NOT deployed

`_clearDeviceSession` now also sweeps all `kg_outbox::*` and `kg_outbox_rejected::*` keys. Before, a boot after an expired session (`SAAS.shop` null) removed only the `noshop` copies and left the real shop's gold entries on the phone. PIN keys are untouched (per-device lock). `tests/harness.js` gained `localStorage.key()` and `length` so the sweep can be tested (additive). **All six audit blockers (1-6) are now fixed in code.** **Still open before the ledger flag may be wired:** 2b job-screen "waiting for confirmation" line (UI, needs a browser check), a reverse button for parked entries, the Opus review of the whole Task 4 branch, and nothing calls `kgOutboxFlush` from a screen yet (boot, online event, after sign-in is wired for 401 only).

**Verified:** `check.bat` clean, ledger client 56/0; the new test fails without the change. **Not verified:** no browser run.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5` until the open list above is done and an Opus review signs off.

### 2026-11-05 (hundred-and-fifty-fifth entry) · Claude Code (Sonnet) — review fix on blocker 4: a 401 with no reason is treated as expired, not guessed; replay of queued entries is by design; NOT merged, NOT applied, NOT deployed

The automated commit review of `52108b0` raised two points. (1) Valid, fixed: `kgSendJournal` passed `body.reason` straight to `saasRequireReauth`, which guesses from the phone's clock when it is missing and can pick 'revoked' (device wipe). It now passes `|| 'expired'`; test added, failed first. (2) Acknowledged, no code change: after sign-in `kgOutboxFlush` also sends older queued entries. That is intended: a queued journal may already be on the ledger, so removing it on Cancel would split the ledger from the shop data (blocker 1). The real gap is that the user cannot see what is queued: the job-screen "waiting for confirmation" line (2b) is still open and is the fix. `saasRequireReauth`'s clock-based guess is still there for other callers; not touched.

**Verified:** `check.bat` clean, ledger client 55/0. **Not verified:** no browser run.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fifty-fourth entry) · Claude Code (Sonnet) — second trim of HANDOFF.md (268→~140 lines); nothing deleted

Moved to the end of `docs/handoff-archive/HANDOFF-LOG-through-2026-11-05.md`, verbatim: LOG entries 140th–148th, the old long NOW block, the answered stored-XSS item, and the whole WAITING "Closed" list. Live file now has NOW (short), the still-open WAITING items, the newest 5 LOG entries and the 3 Oct carried-forward section.

**Verified:** removed text is appended to the archive in full; live counts: 138 lines before this entry. **Not verified:** whether Cowork relies on any removed WAITING closed item; nothing committed. Another session was committing (153rd entry) while I trimmed, so re-open HANDOFF.md before writing to it.

→ FOR COWORK: nothing — FYI only. Look in `docs/handoff-archive/` for any entry or closed decision that is no longer in this file.

### 2026-11-05 (hundred-and-fifty-fourth entry) · Claude Code (Sonnet) — ledger blocker 5: a forced sign-out now says how many gold entries never reached the ledger; NOT merged, NOT applied, NOT deployed

`saasForceLogout` (used by the sign-in prompt's Sign out button, a revoked session, and session end) counts the outbox before the wipe and appends "N gold entries had not reached the ledger. Check the karigar ledger before entering them again." to the notice shown on the sign-in screen. The wipe itself is unchanged on purpose: a removed user's device must still be cleared (14 Sep review, finding 9). **Still open:** 2b (job-screen waiting line), 6 (outbox keys for the real shop survive when the session expires while the app is closed, because `SAAS.shop` is null at boot so `kgOutboxKey()` points at `noshop`), a reverse button for parked entries, and the Opus review before the flag is wired.

**Verified:** `check.bat` clean, ledger client 54/0; the new test fails without the change. **Not verified:** no browser run of the sign-in screen notice.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fifty-third entry) · Claude Code (Sonnet) — ledger blocker 4: a 401 on a gold entry now raises the sign-in prompt and says so; NOT merged, NOT applied, NOT deployed

`kgSendJournal` on 401 now calls `saasRequireReauth` with the server's `reason` (expired or revoked), keeps the journal queued, and returns an error flagged `reauth` with the message "Please sign in again. Your entry is saved and will be sent after you sign in." `kgAddEntryLedger` shows that message instead of the false "may already be recorded". After sign-in the queue is flushed. **Still open:** 2b (job-screen waiting line), 5 (forced sign-out wipes the outbox silently; the revoked path in `saasRequireReauth` also wipes the device, so a queued entry can be lost there), 6 (stale outbox keys), a reverse action for parked entries, and the Opus review. Nothing calls `kgOutboxFlush` from a screen yet.

**Verified:** `check.bat` clean, ledger client 53/0; the new test fails on the old code and passes on the new. **Not verified:** no browser or sign-in prompt run.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fifty-second entry) · Claude Code (Sonnet) — ledger blocker 3: an entry the shop data refuses after the ledger accepted it is parked in `S.kgParked` and shown on Reports; NOT merged, NOT applied, NOT deployed

New shop-data field `S.kgParked` (state init, cloud load/save, export in `04`, restore in `04`, `05` backup and restore, `checks/roundtrip.js` fixture; `roundtrip` failed first with "LOST kgParked", now all 32 keys survive). `kgFinishQueued` (flush) parks the entry with the reason instead of the device-local note; Reports shows "Ledger has this, shop data refused it" (`kg2ParkedHtml`). No reverse button yet: the owner reads it and decides. **Still open:** job-screen "waiting for confirmation" line (2b), 4 (401 treated as offline), 5 (forced sign-out wipes outbox silently), 6 (stale outbox keys), a reverse action for parked entries. Nothing calls `kgOutboxFlush` yet; Opus review still required before the flag is wired.

**Verified:** `check.bat` clean, ledger client 52/0, `backup-check` and `roundtrip` clean. **Not verified:** no browser or server run.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fifty-first entry) · Claude Code (Sonnet) — ledger blocker 2 (core): a queued gold entry keeps its shop-data entry on the device and the flush finishes it; job-screen line and blocker 3 still open; NOT merged, NOT applied, NOT deployed

`kgAddEntryLedger` now stores the entry as `_entry` on the queued journal (device only: `kgSendJournal` strips every `_`-prefixed key). `kgOutboxFlush` calls new `kgFinishQueued` after the ledger confirms: skips if the blob already has that `opId`, else `kgCommitEntry`; if the shop data now refuses (job closed elsewhere), the entry stays out of the blob and a note goes on the device-local rejected list. **Still open:** (2b) a "waiting for confirmation" line on the job screen so nobody re-enters a queued issue; (3) a shop-following `S.kgParked` list on Reports instead of the device-local note (needs `01-sync-core.js` save/load and `backup-check`/`roundtrip`); 4, 5, 6 from the audit entry. Nothing calls `kgOutboxFlush` yet.

**Verified:** `check.bat` clean, ledger client 51/0 (new tests failed first). **Not verified:** no browser or server run.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-fiftieth entry) · Claude Code (Sonnet) — ledger blocker 1 fixed (edit between two Save taps); blockers 2-6 still open; NOT merged, NOT applied, NOT deployed

Tanish confirmed the Karigar ledger is on the launch path (launch after Karigar plus his own small changes). Plan for blockers 1-3 (see the audit entry below): (1) refuse a changed figure under a queued `opId` — done in `kgAddEntryLedger`; (2) store the shop-data entry inside the outbox item so a flush completes the commit even if the form was closed, plus a "waiting for confirmation" line on the job; (3) park an entry the shop data refuses in `S.kgParked`, shown on Reports for the owner to resolve, no automatic reversal. Blockers 2-6 remain; each needs `/plan-eng-review` sign-off and an Opus review before the flag is wired.

**Verified:** `check.bat` clean, ledger client 48/0 (new test failed first). **Not verified:** no browser or server run.

→ FOR COWORK: nothing — FYI only. Still do NOT apply 010/011, deploy `store-proxy`, or merge `karigar-2-task-2-5`.

### 2026-11-05 (hundred-and-forty-ninth entry) · Claude Code (Sonnet) — trimmed CLAUDE.md (225→114 lines) and HANDOFF.md (1596→~230 lines); nothing deleted, all archived

`CLAUDE.md`: full old copy kept at `docs/CLAUDE-MD-FULL-2026-11-05.md`; agent/gstack tables shortened (full version in that file); dirty-tree rule now stops only for unexplained dirty `js/`, `tests/`, `supabase/`, `checks/` files; HANDOFF reading rule is now NOW + WAITING ON TANISH + newest 3 entries. `HANDOFF.md`: 81 older LOG entries moved verbatim to `docs/handoff-archive/HANDOFF-LOG-through-2026-11-05.md`; the live file keeps the newest 10 plus an "Older entries" pointer. Entry numbers cited elsewhere (e.g. "73rd entry") are in the archive. Note: two entries are both numbered "148th" (one is the graphify install, one is the security audit) — harmless, not renumbered.

**Verified:** archive + live line counts add up (no lines lost); first 10 entries intact. **Not verified:** that Cowork's own tooling does not depend on older entries being in this file. Nothing committed.

→ FOR COWORK: when you next read HANDOFF.md, older entries are in `docs/handoff-archive/`; look there for any entry number not found here.

### Older entries

Older LOG entries are archived verbatim in `docs/handoff-archive/HANDOFF-LOG-through-2026-11-05.md` (entries up to the 148th; the second trim is at the end of that file). Search there when an entry is referenced by number (e.g. "73rd entry").

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
