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
| `docs/KARIGAR-2-ARCHITECTURE-AUDIT.md` (new) | Audit report: reusable functions, data shapes, integration points, risks, migration strategy |
| `supabase/migrations/011_karigar_ledger_ext.sql` (new) | Only what Task 1 finds missing: voucher table, loss standards, QC, job split/merge links |
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

- [ ] **Step 1:** Run `jewelos-security-auditor` on the phase 5a diff (`79a4169..94388f1` for the ledger files). For each of the three findings below, record CONFIRMED or REJECTED with the line that proves it. Also read `store-proxy/index.ts` `kg_*` actions in full; the 3 Nov audit did not.
- [ ] **Step 2 (finding 1, HIGH: gate checks the type label, not the lines):** Failing test first: a `manager` posts type `REVERSAL` or `RECEIPT` with a line on `OPENING` or `ADJ`; expect refusal and zero new rows. Then enforce inside `kg_post_journal` a per-type table of allowed (account, sign) pairs: `OPENING` and `ADJ` lines only for types `OPENING` / `ADJUST`; mirrored accounts only for `REVERSAL`; labour lines rejected on non-labour types; and refuse any `OPENING` / `ADJ` line unless the caller is owner. The `store-proxy` check stays as a first line of defence, not the only one.
- [ ] **Step 3 (finding 2, MEDIUM: catch-all exception handler):** Failing test first: force a non-business error (for example a dropped connection or a serialization failure) and assert the client receives a generic failure and keeps the journal in its outbox for retry, with no raw `sqlerrm` text in the response. Then catch only the ledger's own refusals (raise them with a dedicated SQLSTATE) and let every other exception propagate.
- [ ] **Step 4 (finding 3, MEDIUM: LOSS without approval):** Failing test first: a `LOSS` journal with `p_approved_by` null is refused. Then refuse it in `kg_post_journal`. This is the interim rule until Task 8 builds the pending-approval flow; Task 8 then replaces it with `PENDING_APPROVAL` instead of a hard refusal. Check that the live blob's `APPROVAL` flow is not broken: the blob path does not call the ledger while `S.kgLedgerOn` is false.
- [ ] **Step 5:** Run `check.bat`, `node tests/karigar-v2.test.js`, `node tests/regression.test.js`, `node tests/karigar-ledger-client.test.js`, and the SQL ledger test. All pass; `backup-check` and `roundtrip` clean. Then `jewelos-invariant-tester`, and `jewelos-security-auditor` again on the fix.
- [ ] **Step 6:** Commit. Log the results in `HANDOFF.md`, including which findings were rejected and why. No deploy and no production migration in this task.

**Gate:** Task 3 does not start until Step 6 is committed and Tanish has seen the result. Review Focus #5 is covered by Step 2's test.

### Task 3: Production ledger enablement (needs Tanish's GO, separate for each sub-step; blocked until Task 2.5 is committed)

**Files:** none changed; follow `docs/KARIGAR-2-LEDGER-ROLLOUT.md` steps 4-6.

- [ ] **Step 1:** Run `node tools/backup-store.js`; confirm the file parses and shop `3720af09` is present.
- [ ] **Step 2:** GO #1 — apply `010` to production. Verify as `anon`: select on `kg_journal` fails; `service_role` can call `kg_balances`.
- [ ] **Step 3:** GO #2 — deploy `store-proxy`. Verify `kg_balances` returns `[]` for a test shop.
- [ ] **Step 4:** GO #3 — deploy worker (build includes `APP_BUILD`). After every phone has reloaded, set `MIN_CLIENT_BUILD`.
- [ ] **Step 5:** Run `jewelos-deploy-verifier`; log in HANDOFF.

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
- [ ] **Step 6:** Add a Reports line "Blob vs ledger" showing any mismatch per karigar. Flag stays off until a real shop shows zero mismatches for a week.
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

- [ ] **Step 1: Failing test** `backup includes kg_export; restore replays by op_id and never deletes newer journals`.
- [ ] **Step 2:** Implement; `checks/backup-check` and `roundtrip` must pass cleanly.
- [ ] **Step 3:** Write the e2e spec (issue → partial receipt → transfer → close → reconcile). Run `npm run test:e2e`.
- [ ] **Step 4:** Agents per `CLAUDE.md`: `jewelos-bug-pattern-reviewer`, `jewelos-invariant-tester`, `jewelos-test-runner`; pre-release `jewelos-security-auditor`, `jewelos-readiness-auditor`, `jewelos-deploy-verifier`.
- [ ] **Step 5:** Restore rehearsal on the test project from a real backup file. Only then ask Tanish for deploy GO.

---

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
