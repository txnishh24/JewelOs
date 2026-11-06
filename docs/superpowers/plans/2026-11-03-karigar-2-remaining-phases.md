# Karigar 2.0 — Remaining Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Karigar 2.0 as an auditable manufacturing accounting subsystem by moving metal custody from the shop blob onto the immutable server ledger, then adding transfers, split/merge, external workshops, loss standards, QC/rework, integration, reports and backup.

**Architecture:** Build on what exists. Phases 1-4 (profiles, agreements, jobs, stages, routes, Today dashboard) are live in `js/11-karigar.js` and keep their data in the shop blob (`S.kg*`). Phase 5a (branch `karigar-2-phase5a`, test project only) adds an append-only journal in Postgres (`010_karigar_ledger.sql`, `js/12-karigar-data.js`, store-proxy `kg_*` actions). This plan merges 5a, migrates blob balances in as `OPENING` journals, switches screens to the ledger, and extends the ledger for the unbuilt features. The blob stays as a read-only fallback until reconciliation passes.

**Tech Stack:** ES5 vanilla JS, Supabase Postgres + Edge Function `store-proxy`, Cloudflare worker, Node test scripts (`tests/*.test.js`, PGlite for SQL), `check.bat`.

**Spec:** The request pasted 3 Nov 2026 ("BUILD JEWELOS KARIGAR 2.0 — COMPLETE REBUILD"); `docs/superpowers/specs/2026-10-27-karigar-management-design.md`; `docs/KARIGAR-2-LEDGER-ROLLOUT.md` (on `karigar-2-phase5a`); `Documents/JewelOS-Karigar-V2-Plan.md` (Q1-Q24, outside the repo).

## What the audit found (read before approving)

1. **Not a rebuild.** Already live (batch67): agreements with effective dates, % + fixed-gold-per-job + per-gram labour, job lines, routes per category, stages, overdue/Today dashboard, salary register wired into the Day Book (`js/10-daybook.js:284`), audit entries, integer arithmetic (milligrams and paise, so no float error). Rebuilding would throw this away.
2. **The six ledgers already exist in 010.** Accounts: `VAULT, KCUST` (physical custody), `WIP, FG, SCRAP, LOSS, TRANSIT, ENT, EARNED, PAYOUT, OPENING, ADJ`, plus a separate labour-paise table. Fine-metal is the signed `fine_mg` per line. Idempotency (`op_id`), balanced journals, no-negative custody, mirror-only reversals, immutability triggers and RLS are in the SQL and tested. Gap list is Task 1.
3. **Blob vs ledger is the main risk.** Live screens read the blob; the ledger is idle. Until Task 4 both cannot disagree silently.
4. **Known live hazard.** A device on old JS erases `kgAgreements`/`kgRoutes` on its next save (batch67 note). The `MIN_CLIENT_BUILD` guard in 5a fixes this once deployed.
5. **Roles on blob data are client-side only.** The ledger enforces owner/manager on the server; blob data does not.
6. **Blocked on owner answers:** Q7 (external workshop as a ledger party), Q10 (rules for moving gold between jobs/karigars), Q6-Q24 generally.
7. **Priority.** Per `CLAUDE.md`, the launch gate agreed 3 Nov is XSS Batch 1 (done), backup rehearsal (done), security headers (committed, not deployed). Karigar 2.0 is not on that gate. This plan is post-launch unless Tanish says otherwise; only Tasks 1-2 are done and safe before launch (Tanish, 3 Nov). Task 2.5 (security findings) must be finished before Task 3, and Task 3 is a production migration plus two deploys that needs a separate GO for each step, so it is not pre-approved.

## Engineering review decisions (5 Nov 2026)

- **D1 (approved):** Tasks 5, 6, 7 (transfer vouchers, split/merge, external workshops) are DEFERRED until owner questions Q7 and Q10 are answered.
- **D2 (approved):** Tasks 8, 9 (loss standards and approval queue, QC and rework) are DEFERRED until the ledger has run clean. The Task 2.5 hard refusal of an unapproved LOSS stays as the rule.
- **D3 (approved):** smaller arrangement: no new migration, no separate audit document, e2e spec kept. Active scope: Tasks 2.5, 3, 4, 10, 11, 12.
- **D4 (approved):** staff see an explainer card, not hidden buttons (Task 4 Step 5b).
- **Design review D1-D11 (approved 5 Nov, carried into Task 4):** two-tier job actions; plain-language entry labels; staff explainer card; inline pending row plus banner for unconfirmed sends; empty states with one button (needs an add-karigar form); "Needs you" tile and attention list for refused journals; result line after saving; remove the "2.0" pill; map `.kg2-*` CSS to tokens (nothing under 12px); Enter/Space on job rows; dialog role, focus and Escape in `kgForm`.
- **Not decided, recorded:** the owner-only type list and plain-id pattern live in three places (`kg_post_journal`, `checkKgJournal`, `js/12-karigar-data.js`). The SQL test is the guard; `store-proxy` has no automated test (Task 3 Step 5 relies on the live test journal). Reality-row check could not run (`bun` missing).

## Global Constraints

- ES5 only: no arrow functions, `let`/`const`, template literals, `async/await`.
- `escHtml()` into `innerHTML`; `jsAttrEsc()` into inline `onclick`.
- Shop state keys through `shopScopedKey()`, never raw `localStorage` keys.
- Weights are integer milligrams (`*_mg`), money integer paise. No floating-point accumulation.
- Posted journals are never edited or deleted; corrections are mirror `REVERSAL` journals only.
- Do not rewrite the Girvi interest engine.
- Do not create another `js/` module without Tanish's explicit sign-off. `js/12-karigar-data.js` already exists on the 5a branch; new ledger UI goes in `js/11-karigar.js` or `js/12-karigar-data.js`.
- No production migration, `store-proxy` deploy or worker deploy without Tanish saying GO for that specific step.
- Verified backup (`node tools/backup-store.js`) before any production migration.
- Run `check.bat` plus `node tests/karigar-v2.test.js`, `node tests/regression.test.js`, `node tests/karigar-ledger-client.test.js` before every hand-back. State what was not verified.
- Claim the NOW line in `HANDOFF.md` first; end every LOG entry with `→ FOR COWORK:`.

## Review Focus

1. Two phones post the same `op_id` (retry after a flaky network): one row, second reports duplicate.
2. A transfer where the sender holds less than the voucher weight: refused, no half-written rows, no TRANSIT balance left.
3. Offline outbox replay of a journal whose target was reversed from another phone meanwhile: replay is rejected and parked in the rejected list, never applied twice.
4. A karigar's agreement changes mid-job: the job keeps the terms copied on creation; the new agreement applies only to jobs created on or after its effective date.
5. A `staff` user tries to post OPENING/ADJUST/transfer-accept via the API directly: server refuses (not just the button hidden).
6. Rounding: 22K at 916 permille on 1 mg, 3 mg, 999,999 mg — fine mg is integer and sum of parts equals the whole after a split.

---

## File Structure

| File | Responsibility |
|---|---|
| ~~`docs/KARIGAR-2-ARCHITECTURE-AUDIT.md` (new)~~ | Dropped (eng review D3, 5 Nov): Task 1 becomes a short audit section at the top of this plan |
| ~~`supabase/migrations/011_karigar_ledger_ext.sql` (new)~~ | Dropped (eng review D3, 5 Nov): `011_karigar_ledger_hardening.sql` already holds number 011, and Tasks 5-9 are deferred. Any later table goes in `012_*` |
| `js/12-karigar-data.js` (modify, from 5a) | Journal builders, validator, outbox. New builders per task |
| `js/11-karigar.js` (modify) | Screens and blob logic; switched to read the ledger in Task 4 |
| `supabase/functions/store-proxy/index.ts` (modify) | New `kg_*` actions only where a task needs them |
| `tests/karigar-v2.test.js`, `tests/karigar-ledger-client.test.js`, `tests/sql-kg-ledger.test.mjs` (modify) | One test block per task |
| `tests/e2e/karigar.spec.js` (new) | Task 12 |

---

### Task 1: Architecture audit report and gap list

**Files:**
- Create: `docs/KARIGAR-2-ARCHITECTURE-AUDIT.md`

**Interfaces:**
- Produces: a table "required feature → existing function/account → gap" that Tasks 5-9 cite when they say what migration 011 must add.

- [ ] **Step 1:** Write the report with sections: reusable functions (`kgFineMg`, `kgAgreementFor`, `kgCloseJob`, `kgTxn`, `kgBuildJournal`, `kgBuildReversal`), data shapes (`S.kgLedger`, `S.kgSalary`, `S.kgAgreements`, `S.kgRoutes`, jobs), integration points (Day Book salary lines `js/10-daybook.js:284`, `karigarCostOf` in `js/01-sync-core.js`, orders karigar fields in `js/04-orders-detail.js`, `exportFullBackup`), breaking-change risks, migration strategy (this plan's Task 4).
- [ ] **Step 2:** Include the gap table. Starting hypotheses to confirm or reject against `010`: no voucher table (TRANSIT uses voucher id only), no loss-standard store, no QC records, no job split/merge link, no external-party concept.
- [ ] **Step 3:** Verify: every file path and function named in the report exists (`grep` each). Expected: zero missing.
- [ ] **Step 4:** Commit `docs: Karigar 2.0 architecture audit`.

### Task 2: Merge phase 5a to main (no deploy)

**Files:** Modify: `check.bat`, `checks/globals.json`, `index.html`, `sw.js` (all via merge).

- [ ] **Step 1:** `git status` clean on `main` (stash or commit `checks/globals.json` first).
- [ ] **Step 2:** `git merge karigar-2-phase5a`; resolve conflicts by keeping both sides' `HANDOFF.md` entries.
- [ ] **Step 3:** Run `check.bat`, `node tests/regression.test.js`, `node tests/karigar-v2.test.js`, `node tests/karigar-ledger-client.test.js`. Expected: all pass, `backup-check` and `roundtrip` clean.
- [ ] **Step 4:** Commit merge. Do not deploy.

### Task 2.5: Resolve the three security-review findings (added 4 Nov; blocks Task 3)

Source: the automated review of the phase 5a push (4 Nov), logged in `HANDOFF.md` (133rd entry). The three findings are UNVERIFIED leads. Step 1 decides which are real; do not fix a finding that Step 1 rejects.

**Files:** Modify: `supabase/migrations/010_karigar_ledger.sql` (or a new `011` if 010 is already applied anywhere), `supabase/functions/store-proxy/index.ts`, `js/12-karigar-data.js`; Test: `tests/sql-kg-ledger.test.mjs`, `tests/karigar-ledger-client.test.js`.

- [x] **Step 0 (D4, approved 4 Nov by eng review):** Make the SQL ledger test runnable. `node tests/sql-kg-ledger.test.mjs` currently fails with `ERR_MODULE_NOT_FOUND` for `@electric-sql/pglite` (not in `package.json`, not installed). Add it as a `devDependency`, add an `npm run test:sql` script, and add that test to `check.bat`'s list. Verify: the existing 137-line test runs and passes before any Task 2.5 change. Note for Step 2: the per-type account template must allow type `OPENING` to carry `KCUST` or `WIP` lines against the `OPENING` account (needed by Task 4, Step 3b, D3), as well as the existing `VAULT` shape.
- [ ] **Step 1:** Run `jewelos-security-auditor` on the phase 5a diff (`79a4169..94388f1` for the ledger files). For each of the three findings below, record CONFIRMED or REJECTED with the line that proves it. Also read `store-proxy/index.ts` `kg_*` actions in full; the 3 Nov audit did not.
- [ ] **Step 2 (finding 1, HIGH: gate checks the type label, not the lines):** Failing test first: a `manager` posts type `REVERSAL` or `RECEIPT` with a line on `OPENING` or `ADJ`; expect refusal and zero new rows. Then enforce inside `kg_post_journal` a per-type table of allowed (account, sign) pairs: `OPENING` and `ADJ` lines only for types `OPENING` / `ADJUST`; mirrored accounts only for `REVERSAL`; labour lines rejected on non-labour types; and refuse any `OPENING` / `ADJ` line unless the caller is owner. The `store-proxy` check stays as a first line of defence, not the only one.
- [ ] **Step 3 (finding 2, MEDIUM: catch-all exception handler):** Failing test first: force a non-business error (for example a dropped connection or a serialization failure) and assert the client receives a generic failure and keeps the journal in its outbox for retry, with no raw `sqlerrm` text in the response. Then catch only the ledger's own refusals (raise them with a dedicated SQLSTATE) and let every other exception propagate.
- [ ] **Step 4 (finding 3, MEDIUM: LOSS without approval):** Failing test first: a `LOSS` journal with `p_approved_by` null is refused. Then refuse it in `kg_post_journal`. This is the interim rule until Task 8 builds the pending-approval flow; Task 8 then replaces it with `PENDING_APPROVAL` instead of a hard refusal. Check that the live blob's `APPROVAL` flow is not broken: the blob path does not call the ledger while `S.kgLedgerOn` is false.
- [ ] **Step 4a (D8, approved 4 Nov: reversals also mirror labour):** Failing test first: a `REVERSAL` whose `p_labour` is missing, partial, or not the exact negation of the original's `kg_labour_line` rows is refused, and a labour-only journal can only be reversed by its exact labour mirror. Then add that check beside the existing metal-mirror check (`010_karigar_ledger.sql`, near the `REVERSAL` block).
- [ ] **Step 4b (D9, approved 4 Nov: op_id reuse with different content is refused):** Failing test first: re-sending an existing `op_id` with different lines or labour returns a conflict (not `duplicate: true`); an identical resend still returns `duplicate: true`. Then store a content fingerprint of the lines, labour, type and date in `kg_journal.meta` and compare it on a duplicate `op_id`. Compute the fingerprint the same way on the client (`js/12-karigar-data.js`) and server. Task 4's deterministic `migr:` ids rely on this: a rerun with a changed balance must report a conflict, not silently post nothing.
- [ ] **Step 4d (D10, approved 4 Nov: business date limits):** Failing test first: a `manager` posting a `business_date` later than today or more than 7 days before today is refused; the owner is not limited. Enforce it inside `kg_post_journal`, using the posting role it already receives, not only in `store-proxy`.
- [ ] **Step 4c (verified 4 Nov by static read, not by running):** findings 1, 2 and 3 are CONFIRMED against `010_karigar_ledger.sql:223` (catch-all returns raw `sqlerrm`), `supabase/functions/store-proxy/index.ts:77` and `:98` (gate checks the type, lines are only checked against the account list) and `:125` (`approved` is set only when the caller is owner; the SQL never requires it). Step 1 should still confirm them with the auditor.
- [ ] **Step 5:** Run `check.bat`, `node tests/karigar-v2.test.js`, `node tests/regression.test.js`, `node tests/karigar-ledger-client.test.js`, and the SQL ledger test. All pass; `backup-check` and `roundtrip` clean. Then `jewelos-invariant-tester`, and `jewelos-security-auditor` again on the fix.
- [ ] **Step 6:** Commit. Log the results in `HANDOFF.md`, including which findings were rejected and why. No deploy and no production migration in this task.

**Status 4 Nov (built on branch `karigar-2-task-2-5`, NOT merged to `main`, NOT applied to any database):** Steps 0, 2, 3, 4, 4a, 4b, 4d are built in a NEW migration `supabase/migrations/011_karigar_ledger_hardening.sql` (it replaces `kg_post_journal` from 010; 010 is unchanged because it is already applied to the test project). `tests/sql-kg-ledger.test.mjs` went from 37 to 111 checks, run with `npm run test:sql` and now part of `check.bat`. Every new check failed first, then passed. Two independent runs of `jewelos-security-auditor` found real holes that were fixed: a loose `ENTITLEMENT_SETTLE` (exact shape now required, `ENT` never below zero), no labour template, a non-reversal naming a journal, an ambiguous op_id fingerprint, empty metal journals. Decisions after the second audit (4 Nov, Tanish): D1 an `ENTITLEMENT_ACCRUE` is owner only, and a reversal needs the original's authority; D2 owner references must fit the account (VAULT and OPENING blank, KCUST/ENT/EARNED/PAYOUT named), impossible dates are refused in `store-proxy`, a null type or role is refused up front. Deviations from the steps above: (a) the op_id fingerprint is computed by the server only; the client does not compute one (Step 4b said both). (b) Step 1 was done by running the auditor after the build, not before. `store-proxy` changed in two places only: it refuses a client-set meta key `h`, and it validates `business_date` as a real calendar date between 2000 and 2100.

**Still open before 011 can be applied (Task 3):** (1) Opus-level review sign-off (`MODEL-POLICY.md` marks this 🔴; the auditor said it is not an approval). (2) Whether a manager may reverse an owner-approved `LOSS`. (3) The client's `kgToday()` (`js/11-karigar.js:109`) uses the phone's date while the server uses India time, so a wrong phone clock near midnight gets a manager's entry refused. (4) ISSUE from an UNTRACKED vault is unlimited for a manager by design, so the custody-minting guard is complete only for vault-tracked shops. (5) Refusal messages echo the raw `owner_ref`; any screen that shows the rejected list must use `escHtml()`. (6) Nothing was run against real Postgres, only PGlite, and `store-proxy` was not executed. (7) Task 4 Step 3b (the app's karigar OPENING builder) is not built.

**Third audit pass (4 Nov) and decisions, built on the same branch:** no new way for a manager to create metal, settle another karigar's entitlement, or get round owner authority; the real client builders all pass the templates; the `store-proxy` date check matched Postgres on all 36,890 dates from 2000 to 2100. Decisions by Tanish: (1) karigar references on KCUST, ENT, EARNED, PAYOUT, SCRAP and LOSS must be a plain id (`^[A-Za-z0-9_-]{1,64}$`; existing ids are "kar" + digits or a UUID), `store-proxy` applies the same pattern, a TRANSIT line must carry its own voucher id, and SCRAP/LOSS must name the same karigar as the custody line. The database has no karigar list, so a well-formed made-up id still passes; the Task 4 mismatch report (Step 6) is what catches it. (2) A manager's journal refused for its date must not vanish into the rejected list: it becomes a visible "needs the owner to post" item (see Task 4 Step 6a; no screen exists yet, so nothing was built for this). (3) A reversal of any journal that carries an approver (for example an approved loss) needs the owner; ordinary journals can still be reversed by a manager. Also done: `ENTITLEMENT_ACCRUE` added to the owner-only lists in `store-proxy` and `js/12-karigar-data.js`, so a manager's accrual is refused before it is queued. SQL test: 129 checks.

**Fix after an automated review of the pairing rule (4 Nov):** "SCRAP/LOSS name the same karigar" had been written as "a matching pair exists", so extra lines in the same journal could still move another karigar's custody into a third karigar's bucket (reproduced: the test failed before the fix). A single metal event (ISSUE, RETURN, RECEIPT, SCRAP, LOSS, TRANSFER_OUT, TRANSFER_IN, OPENING, ADJUST) is now exactly two lines. SQL test: 135 checks. **FG job rule (built 4 Nov, Tanish's go-ahead):** a `RECEIPT` must carry a job id, every `FG` line's owner reference must equal that job id, and `FG` references follow the plain-id pattern (so metal cannot sit in a blank or look-alike `FG` bucket). `store-proxy` applies the same pattern to `job_id`. Effect on the app: a receipt posted with no job is now refused, and the client builder (`kgBuildJournal('RECEIPT', ...)`, `js/12-karigar-data.js:87`) must always be given `jobId` (it already is in the live flow design). SQL test: 142 checks.

**Findings NOT acted on (third audit):** the custody balance check ignores the business date, so a back-dated entry can make custody negative "as of" an earlier day (low; any day-wise custody report must account for it); a null `op_id`, user or shop id sent straight to the database raises a non-KG001 error, which `store-proxy` prevents today. Resolved by the decisions above: the manager-reverses-approved-loss question.

**Gate:** Task 3 does not start until Step 6 is committed and Tanish has seen the result. Review Focus #5 is covered by Step 2's test.

### Task 3: Production ledger enablement (needs Tanish's GO, separate for each sub-step; blocked until Task 2.5 is committed)

**Files:** none changed; follow `docs/KARIGAR-2-LEDGER-ROLLOUT.md` steps 4-6.

- [ ] **Step 1:** Run `node tools/backup-store.js`; confirm the file parses and shop `3720af09` is present.
- [ ] **Step 2:** GO #1 — apply `010` to production. Verify as `anon`: select on `kg_journal` fails; `service_role` can call `kg_balances`.
- [ ] **Step 3:** GO #2 — deploy `store-proxy`. Verify `kg_balances` returns `[]` for a test shop.
- [ ] **Step 4:** GO #3 — deploy worker (build includes `APP_BUILD`). After every phone has reloaded, set `MIN_CLIENT_BUILD`.
- [ ] **Step 5:** Run `jewelos-deploy-verifier`; log in HANDOFF. Per D14 (approved 4 Nov), it also posts a test journal on the E2E test shop and reverses it, to prove the live role gate and the ledger path. The TypeScript shape checks in `checkKgJournal` have no separate automated test; the SQL tests are the safety net.

### Task 4: Phase 5b — switch custody to the ledger (migration)

**Files:** Modify: `js/11-karigar.js` (`kgIndex`, `kgJobBalance`, `kgKhata`, `kgStatement`, `kgAddEntry`), `js/12-karigar-data.js`; Test: `tests/karigar-v2.test.js`, `tests/karigar-ledger-client.test.js`.

**Interfaces:**
- Consumes: `kgBuildJournal(type, o)`, `kgPostJournal(journal, cb)`, `kg_balances`, `kg_journal_list`, `kg_export`.
- Produces: `kgMigrateBlobToLedger(done: function(err, report))` where `report = {karigars: n, openingPostedMg: n, mismatches: []}`; `kgLedgerBalance(account: string, ownerRef: string) -> integer mg`.

- [ ] **Step 1: Failing test** `reconciles blob to ledger per karigar`: seed a blob with two karigars (A holds 12,345 mg fine, B holds 0), run the migration against the PGlite harness, assert `kgLedgerBalance('KCUST','A') === 12345` and `mismatches.length === 0`; second run posts nothing (same `op_id`).
- [ ] **Step 2:** Run, confirm FAIL (function not defined).
- [ ] **Step 3:** Implement `kgMigrateBlobToLedger`: for each karigar, one owner-only `OPENING` journal into `KCUST`, `op_id = 'migr:'+shopId+':'+karigarId` (deterministic, so reruns are no-ops). Also seed `WIP` for open jobs.
- [ ] **Step 4:** Run test, expect PASS. Add test: migration refuses for a non-owner.
- [ ] **Step 5:** Behind a shop-level flag `S.kgLedgerOn` (default false), make `kgAddEntry` post a journal and the blob entry together under `kgTxn`; if the journal is rejected, the blob entry is rolled back. Test: rejected journal leaves blob unchanged.
- [ ] **Step 3b (D3, approved 4 Nov by eng review: karigar OPENING builder):** `kgBuildJournal('OPENING', ...)` in `js/12-karigar-data.js:97` builds only `VAULT +f / OPENING -f`. Add a karigar variant that posts `KCUST[k] +f / OPENING -f` (and `WIP[job] +f / OPENING -f` for open jobs), selected by an explicit option, not by guessing. Do NOT use `ADJUST` for opening balances: the `ADJ` account stays reserved for real owner corrections. Test: the migration's journal has `OPENING` as its counter-account, `ADJ` stays at zero, and a non-owner is refused.
- [ ] **Step 3a (D12, approved 4 Nov: zero and negative balances):** A karigar whose blob balance is zero posts nothing. A karigar with a negative blob balance posts nothing and is listed in the mismatch report as "needs owner review"; the owner resolves it with a dated adjustment. The migration completes for all other karigars. Test: a shop with balances 12,345 / 0 / -500 mg migrates the first, skips the other two, and the report names both.
- [ ] **Step 5b (D13, approved 4 Nov; REPLACED by eng review D4 and design review D3, 5 Nov):** `renderKgV2` (`js/11-karigar.js:859`) shows nothing to anyone below manager, so there are no gold buttons to hide. Instead, staff and read-only users see one explainer card: "Karigar is for the owner and managers. Ask the owner for access." No staff read-only view. This is a display rule only; the server stays the real guard.
- [ ] **Step 5a (D7, approved 4 Nov: gold movements need internet while the ledger is on):** While `S.kgLedgerOn` is true for a shop, issuing, receiving or transferring gold is refused when the phone is offline, with a plain message, and nothing is saved to the blob. This removes the case where an offline entry is saved to the blob and later refused by the server. **Extended by D1 (approved 4 Nov by eng review): mid-send failures.** `kgRemote` (`js/12-karigar-data.js:128`) gives up after 20 seconds and `kgSendJournal` (`:171`) then reports "saved and will be retried", but the server may already have posted the journal. While the ledger is on, a timeout or network loss after sending leaves the entry PENDING: show "sending, not confirmed", do not commit the blob entry, and retry the same `op_id` until the server gives a definite answer (success, duplicate, or refusal). Test: a send that times out after the server posted it ends with one ledger row, one blob entry, and no "saved" message in between. Test: with the flag on and the network down, `kgAddEntry` saves nothing and shows the message; with the flag off, offline behaviour is unchanged.
- [ ] **Step 6:** Add a Reports line "Blob vs ledger" showing any mismatch per karigar. Flag stays off until a real shop shows zero mismatches for a week. Per D11 (approved 4 Nov), the same report also lists any ledger `owner_ref` that matches no karigar in the shop data.
- [ ] **Step 6a (D15, approved 4 Nov: rejected posts are visible):** `store-proxy` logs each refused journal (shop, type, `op_id`, reason; never amounts). The Today tile from SCOPE-5 shows "N journals rejected" to the owner, counted from the client's rejected list. **Extended by D2 (approved 4 Nov by eng review):** `kgRejectedAdd` (`js/12-karigar-data.js:159`) keeps only `slice(-50)` and ignores a failed storage write, so older refusals vanish silently. Keep every rejected journal until the owner dismisses it (cap 500, with a visible warning when nearly full or when a save fails). Test: 51 rejections leave 51 entries and a count of 51; a failed `localStorage` write is reported, not swallowed. **Also (third audit, approved 4 Nov):** a journal refused only for its business date ("business date out of range", a manager's entry that waited offline over 7 days or came from a fast phone clock) is shown to the owner as "needs the owner to post", with the original details, and is not left as an ordinary rejection. Test: a date-refused journal appears in that owner list with its lines intact.
- [ ] **Step 7:** Commit.

### Task 5: Phase 6a — authenticated transfer vouchers (needs Q10 answered)

**Files:** Modify: `supabase/migrations/011_karigar_ledger_ext.sql` (voucher table if Task 1 confirms the gap), `js/12-karigar-data.js`, `js/11-karigar.js`; Test: `tests/sql-kg-ledger.test.mjs`, `tests/karigar-v2.test.js`.

**Interfaces:**
- Consumes: existing `TRANSFER_OUT` / `TRANSFER_IN` builders (account `TRANSIT`, owner_ref = voucher id).
- Produces: `kgCreateVoucher(fromId, toId, jobId, fineMg, note, done) -> voucherId`; `kgAcceptVoucher(voucherId, done)`; voucher states `PENDING | ACCEPTED | CANCELLED`.

- [ ] **Step 1: Failing SQL test** `transfer refused when sender short`: sender holds 1,000 mg, voucher 1,500 mg; expect error and zero new rows in `kg_journal` and `kg_journal_line`.
- [ ] **Step 2:** Failing test `accept refused for staff role, allowed for owner and manager`.
- [ ] **Step 3:** Implement: create posts `TRANSFER_OUT` (gold sits in `TRANSIT`, not with either karigar); accept posts `TRANSFER_IN`; cancel posts a mirror reversal of the OUT. "Authenticated" = the accepting user's id and role are stored on the voucher; the server accepts only `owner` or `manager` (Tanish, Q10, 3 Nov). Staff are refused server-side.
- [ ] **Step 4:** Test: gold in `TRANSIT` is excluded from both karigars' khata and shown on the dashboard as "in transit".
- [ ] **Step 5:** Run SQL and JS suites; expect PASS. Commit.

### Task 6: Phase 6b — job split/merge and multi-karigar jobs (needs Q10)

**Files:** Modify: `js/11-karigar.js`, `js/12-karigar-data.js`, migration 011 (job link table); Test: `tests/karigar-v2.test.js`.

**Interfaces:**
- Produces: `kgSplitJob(jobId, parts: [{fineMg, karigarId?}], done)`; `kgMergeJobs(jobIds, intoJobId, done)`. Both post `WIP` → `WIP` journals only; fine mg conserved.

- [ ] **Step 1: Failing test** `split conserves fine metal`: job WIP 10,000 mg split 6,000 / 4,000, sum of child WIP === parent WIP before; parent WIP after === 0; amounts that don't sum to the parent are refused.
- [ ] **Step 2:** Failing test `merge refused if jobs have different purity unless owner converts` (purity is a property of the lines; no silent mixing).
- [ ] **Step 3:** Implement; each child job copies the parent's agreement snapshot; the parent job closes with status `SPLIT`.
- [ ] **Step 4:** Multi-karigar: a stage's `who` stays a label; real custody moves only through Task 5 vouchers. Test: assigning a stage to another karigar changes no balance.
- [ ] **Step 5:** Commit.

### Task 7: External workshops as ledger parties (needs Q7)

**Files:** Modify: `js/11-karigar.js` (karigar `kind: 'INHOUSE'|'EXTERNAL'`), migration 011 if party separation is required.

- [ ] **Step 1: Failing test** `external karigar uses same custody path but is excluded from salary`: an EXTERNAL party cannot be given a salary agreement; can be given wastage/labour terms.
- [ ] **Step 2:** Implement `kind` on the karigar record (blob shape change goes through all six touchpoints plus the roundtrip fixture — see `js/00`, `01`, `05`, `06`, backup/restore, `checks/roundtrip`).
- [ ] **Step 3:** Run `checks/roundtrip`; expect pass. Commit.

### Task 8: Process loss standards with owner-approved overrides

**Files:** Modify: `js/11-karigar.js` (`kgLossState`, `kg2Loss`), `js/12-karigar-data.js`; Test: `tests/karigar-v2.test.js`.

**Interfaces:**
- Produces: `S.kgLossStd = {<processKey>: permilleOfFineIssued}`; `kgLossAllowed(jobId, processKey) -> mg`; `kgApproveLossOverride(jobId, lossEntryId, reason, done)` (owner only).

- [ ] **Step 1: Failing test** `loss above standard needs owner approval`: standard 15 permille on 10,000 mg = 150 mg; a 200 mg loss is stored as `PENDING_APPROVAL`, not posted; owner approval posts `LOSS` (account `LOSS`, never `EARNED`).
- [ ] **Step 2:** Failing test `loss, wastage earning and unreturned balance are three separate numbers` on the job statement.
- [ ] **Step 3:** Implement; commit.

### Task 9: Quality control, rework and scrap recovery

**Files:** Modify: `js/11-karigar.js`, `js/12-karigar-data.js`, migration 011 (`kg_qc` table, append-only like the journal).

**Interfaces:**
- Produces: `kgRecordQc(jobId, stageId, result: 'PASS'|'FAIL', note, done)`; `kgStartRework(jobId, stageId, done)`; scrap recovery reuses existing `SCRAP` journal and a new `kgRecoverScrap(karigarId, fineMg, done)` moving `SCRAP` → `VAULT`.

- [ ] **Step 1: Failing test** `QC fail blocks job close until rework or owner waives`.
- [ ] **Step 2:** Failing test `scrap recovery cannot exceed SCRAP balance`.
- [ ] **Step 3:** Implement; commit.

### Task 10: Integration — Inventory, Orders, Sales, Day Book

**Files:** Modify: `js/11-karigar.js` (close-job handoff), `js/06-inventory-stock.js` (confirm entry point), `js/10-daybook.js` (advances/settlements, extend section E), `js/04-orders-detail.js`.

- [ ] **Step 1:** Confirm how a finished piece enters stock today (read `js/06-inventory-stock.js` and `karigarCostOf` in `js/01-sync-core.js`); write the finding at the top of this task before coding.
- [ ] **Step 2: Failing test** `closing a job never changes stock unless the owner confirms the handoff`, and `weight = unitWeight * qty` holds on the new item.
- [ ] **Step 3: Failing test** `advance and settlement appear once in the Day Book; reversing them removes both`.
- [ ] **Step 4:** Implement; run e2e for Day Book and sale specs. Commit.

### Task 11: Reports and reconciliation

**Files:** Modify: `js/11-karigar.js` (`kgReport`, `kg2ReportsHtml`).

- [ ] **Step 1: Failing test** `ledger trial balance`: sum of `fine_mg` over all accounts for a shop equals 0 after any sequence of journals.
- [ ] **Step 2:** Add reports: metal reconciliation (vault + custody + WIP + FG + scrap + loss + transit = opening + net adjustments), karigar ledger, aging of custody, loss vs standard, labour payable. Test each against a seeded fixture with hand-computed numbers.
- [ ] **Step 3:** Commit.

### Task 12: Backup, restore, end-to-end tests, release

**Files:** Modify: `exportFullBackup` and restore (`js/05-auth-login.js` area; grep to confirm), `tools/backup-store.js`; Create: `tests/e2e/karigar.spec.js`.

- [ ] **Step 1: Failing test** `backup includes the full ledger; restore replays by op_id and never deletes newer journals`. Per D16 (approved 4 Nov), the backup pages `kg_journal_list` with the `after` cursor, 1000 at a time, and checks the last id, instead of one `kg_export` call of up to 100,000 journals. Test: a ledger of 2,500 journals is backed up in 3 pages with none missing.
- [ ] **Step 2:** Implement; `checks/backup-check` and `roundtrip` must pass cleanly.
- [ ] **Step 3:** Write the e2e spec (issue → partial receipt → transfer → close → reconcile). Run `npm run test:e2e`.
- [ ] **Step 4:** Agents per `CLAUDE.md`: `jewelos-bug-pattern-reviewer`, `jewelos-invariant-tester`, `jewelos-test-runner`; pre-release `jewelos-security-auditor`, `jewelos-readiness-auditor`, `jewelos-deploy-verifier`.
- [ ] **Step 5:** Restore rehearsal on the test project from a real backup file. Only then ask Tanish for deploy GO.

---

## CEO review additions (4 Nov 2026, /plan-ceo-review, SCOPE EXPANSION mode)

Mode: SCOPE EXPANSION, chosen by Tanish over the recommended HOLD SCOPE. Each addition below was approved individually (D2, D3, D4, D6). Review Sections 1-10 and the outside voice have NOT been run yet; these are scope decisions only.

- **SCOPE-1 (D2, accepted): WhatsApp khata statement per karigar.** New task after Task 4. Opens WhatsApp with issued, returned, loss and balance, following the existing `custBalanceWA` pattern (`js/03-billing-numbers.js:441`). Must read balances from the ledger, and only once Task 4's blob-vs-ledger check is clean. Effort S.
- **SCOPE-2 (D3, accepted): karigar scorecard.** New read-only report, shown only for a karigar with at least 3 closed jobs: actual wastage against the agreed rate, and average days per job. Add to Task 11. Effort S.
- **SCOPE-3 (D4, accepted): overdue-job WhatsApp nudge.** One-tap reminder on an overdue job from the Today dashboard. The button hides when the karigar has no phone number. Effort S.
- **SCOPE-5 (D6, accepted): "gold outside the vault" tile and Close Day mismatch banner.** The tile goes on the Today tab. The banner goes in the Day Book at Close Day and waits for Task 4's reconcile check. It touches `js/10-daybook.js`, so the Day Book e2e spec must stay green. Effort M.

**Review decisions from Sections 1-10 (4 Nov):** D7 offline gold needs internet (Task 4, Step 5a). D8 reversals mirror labour (Task 2.5, Step 4a). D9 reused op_id with different content is refused (Task 2.5, Step 4b). Static-read evidence only; nothing was run.

**Remaining Sections 1-10 findings, decided 4 Nov (all approved as recommended):** D10 business date limits (Task 2.5, Step 4d). D11 unknown karigar ids listed in the mismatch report (Task 4, Step 6). D12 zero and negative balances skipped and listed (Task 4, Step 3a). D13 staff see a message instead of a 403 (Task 4, Step 5b). D14 no separate TypeScript test; SQL tests plus a post-and-reverse after deploy (Task 3, Step 5). D15 rejected posts are logged and counted on the Today tile (Task 4, Step 6a). D16 backup pages the ledger (Task 12, Step 1). D17 design gate: run `/plan-design-review` on the SCOPE-1, 2, 3 and 5 screens before building them (empty, error and phone states).

**Engineering review of the ledger code (4 Nov, /plan-eng-review, target: `010_karigar_ledger.sql`, `store-proxy` `kg_*`, `js/12-karigar-data.js`):** evidence was a static read plus running `node tests/karigar-ledger-client.test.js` (13 passed, 0 failed). The SQL test could not run (D4). Approved: D1 mid-send is pending until confirmed, D2 rejected list is never dropped silently, D3 karigar OPENING builder, D4 make the SQL test runnable. Informational, not decided: the outbox flush (`js/12-karigar-data.js:200-203`) does not track dependencies, so after a refused issue a later receipt on the same job is still sent; the type and account lists exist in three places (`js/12-karigar-data.js:22-25`, `store-proxy/index.ts:49-56`, SQL check constraints). Test gaps in `tests/sql-kg-ledger.test.mjs` (none of these are covered): a manager minting gold through `ADJ`/`OPENING` lines, transient database errors, labour reversal, two phones posting at once.

**Not yet done:** outside voice, spec-review loop, CEO plan archive, final report for either review.

**NOT in scope (deferred):** SCOPE-4 (D5), printable job card. Deferred to `TODOS.md` because print output cannot be verified by the test suite and no shop has asked for it.

## Decisions (Tanish, 3 Nov 2026)

- **Q7 ANSWERED: yes.** An external workshop is its own party with its own khata (Task 7).
- **Q10 ANSWERED: gold may move between jobs and karigars; the owner or any available manager confirms** (Tasks 5-6). Staff cannot. Task 5's "different user than creator" rule is replaced by: confirmer must be owner or manager.
- Execution: subagent-driven, only after launch.
- Still open: Q6, Q8-Q9, Q11-Q24 in the V2 plan doc.

## Original questions (for the record)

1. Is this post-launch? (Recommended: yes. Do Tasks 1-2 now, the rest after the launch gate is green.)
2. Q10: may gold move between jobs/karigars, and who confirms a transfer — the receiving karigar's manager or only the owner?
3. Q7: is an outside workshop a separate party with its own khata?
4. Q6-Q24 in the V2 plan doc: half-day pay, manager reversal window, where V1 payments go.

## Self-review

- **Spec coverage:** dashboard, directory, agreements, job cards, issue/receipt, in-house/external, stages, transfers, reconciliation, earning models, labour, process loss, scrap, QC, advances, ledger, reports, audit, integration all map to existing work or Tasks 4-11. Backup/restore Task 12. "Rebuild everything" deliberately declined (finding 1).
- **Not covered by any task:** per-piece labour beyond what agreements already store; confirm in Task 1 whether it is present (the request lists it; `kgParseAgreementTerms` suggests per-gram only).
- **Proportion:** roadmap-level; each task states signatures and tests, bodies are left to the implementer.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | none | not run |
| Outside Review | `codex` | Independent 2nd opinion | 0 | not run | missing coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 4 findings, 4 decisions (D1-D4) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | issues_open | 3/10 to 8/10, 11 decisions, 4 unresolved |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | none | not applicable |

**VERDICT:** ENG REVIEW NOT CLEARED. 2 critical plan fixes applied; test plan not yet written; outside voice and review log not run.

**UNRESOLVED DECISIONS:**
- Khata vs Karigars tab overlap, loading state, 320px layout, Hinglish vs English labels (from design review)
- Eng review: Karigar e2e coverage for Task 4 flows not yet specified
