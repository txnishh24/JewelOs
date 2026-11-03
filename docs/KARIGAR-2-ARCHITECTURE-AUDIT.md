# Karigar 2.0 — architecture and dependency audit (3 Nov 2026)

Audit only. Nothing here changes behaviour. Plan that uses it: `docs/superpowers/plans/2026-11-03-karigar-2-remaining-phases.md`.
Sources read: `js/11-karigar.js` (1,473 lines, on `main`), `js/12-karigar-data.js`, `supabase/migrations/010_karigar_ledger.sql`, `docs/KARIGAR-2-LEDGER-ROLLOUT.md` (all three on branch `karigar-2-phase5a`), `js/00`, `01`, `04`, `05`, `10`.
Not read in depth: `supabase/functions/store-proxy/index.ts` (only its commit summary), the orders Karigar V1 code (37 mentions in `js/04-orders-detail.js`), `tests/e2e/`.

## 1. Two systems exist side by side

| | Live on `main` (batch67) | On branch `karigar-2-phase5a` (not merged, not in production) |
|---|---|---|
| Storage | Shop blob: `S.kgJobs, kgLedger, kgSalary, kgPurities, kgAgreements, kgRoutes, nextKgJobNo` | Postgres tables `kg_journal`, `kg_journal_line`, `kg_labour_line` |
| Immutability | By convention in client code (append-only array, reversals) | By trigger (`kg_block_mutation`): update, delete and truncate are refused |
| Atomicity / idempotency | `kgTxn` with undo, client-side | `kg_post_journal`: one transaction, `unique(shop_id, op_id)` |
| Roles | Client-side only (`kgCan`) | Server-side: owner and manager; `ADJUST`, `OPENING` owner only |
| Used by screens | Yes | **No.** Loaded but idle. |

**Consequence:** today's "no metal created or destroyed" guarantee depends on the browser. The ledger is what makes it enforceable. The blob keeps the metal totals until the migration in plan Task 4.

## 2. Reusable functions (all in `js/11-karigar.js` unless noted)

- **Units:** `kgParseMg`, `kgParsePaise`, `kgPctToPermille`, `kgFineMg(mg, permille)`, `kgFmtG`, `kgFmtRs`. Integer mg and paise throughout, so the "exact decimal arithmetic" requirement is already met.
- **Purity:** `kgPurityList`, `kgResolvePermille`, `kgAddPurity`.
- **Balances:** `kgIndex`, `kgJobBalance`, `kgKhata`, `kgStatement`, `kgReport`, `kgSalaryBalance`, `kgDashboard`.
- **Posting:** `kgTxn`, `kgAddEntry`, `kgValidateEntry`, `kgValidateSalary`, `kgAddSalary`, `kgCreateJob`, `kgCloseJob`, `kgReopenJob`, `kgCancelJob`, `kgAudit`.
- **Agreements:** `kgAgreementFor(karigarId, dateKey)`, `kgAddAgreement`, `kgParseAgreementTerms`, `kgSetTerms`.
- **Jobs and routes:** `kgRouteFor`, `kgSetRoute`, `kgAddLine`, `kgVoidLine`, `kgStageAction`.
- **Ledger client (`js/12-karigar-data.js`, branch only):** `kgBuildJournal`, `kgBuildReversal`, `kgValidateJournal`, `kgPostJournal`, outbox and replay.

## 3. Data shapes (live blob)

- `S.kgLedger` entry types: `ISSUE, RECEIPT, SCRAP, LOSS, ADJUST, APPROVAL, REVERSAL`.
- `S.kgSalary` entry types: `ACCRUAL, ADVANCE, PAYMENT, DEDUCTION, JOB_LABOUR, REVERSAL`.
- Agreement terms (`kgParseAgreementTerms`): `kind` is `wastage` (wastage basis points, default 400; optional fixed gold mg per job; optional labour `{perGramPaise, base: 'net'|'fine'}`) or `salary` (`monthly` or `daily`, rate paise).
- Loss categories: `die cutting, filing, polishing, other`. Scrap kinds: `scrap, dust, filings`.
- Loss already has a pending / approved / rejected flow via `APPROVAL` entries (`kgLossState`, owner button at `kg2Detail`).

## 4. Integration points

| Area | Where | State |
|---|---|---|
| Day Book | `js/10-daybook.js:284-300`, section E reads `S.kgSalary` | Salary only. Advances and settlements for **gold** are not in the Day Book (correct, they are not cash). |
| Inventory cost | `karigarCostOf` (`js/01-sync-core.js:1769`), used from `js/06-inventory-stock.js:65` | Reads **V1** karigar data. V2 jobs do not feed it. |
| Orders | 37 Karigar mentions in `js/04-orders-detail.js` | V1. V2 job has an optional `orderId` link only. |
| Sales / billing | none | No link from a V2 finished piece to stock or a bill. |
| Backup / restore | `exportFullBackup` (`js/05-auth-login.js:1203`), restore at `js/05-auth-login.js:1312` | Carries all six `kg*` arrays. The server ledger is **not** in it (rollout doc, "Known limits"). |
| Cloud sync | `js/01-sync-core.js:141-145` (load), `:313-317` (save) | Same six arrays. |
| Other copies of the key list | `js/00-config-state.js:80`, `js/04-orders-detail.js:756` and `:979-983` | **Seven places** must change together when a new `kg*` key is added (see risk R3). |

## 5. Gap table: requested feature against what exists

| Requested | Exists | Gap |
|---|---|---|
| Percentage, fixed, combined earning | Yes (wastage bp + fixed mg per job) | none |
| Per-gram labour | Yes (net or fine base) | none |
| **Per-piece labour** | **No** (searched `js/11-karigar.js`) | Add to agreement terms and `JOB_LABOUR` calculation |
| Monthly salary, hybrid | Monthly and daily salary. A karigar is **either** wastage **or** salary (owner decision, batch67) | "Hybrid" in the request contradicts that decision; confirm with Tanish |
| Effective-dated agreements | Yes | none |
| Physical custody, fine accountability | Blob: one ledger. 010: `VAULT, KCUST` with `fine_mg`, `gross_mg`, `permille` | Not live |
| Entitlement, labour payable | 010: `ENT, EARNED`, `kg_labour_line`; blob: wastage frozen on `job.earnings`, `S.kgSalary` | Two homes until Task 4 |
| WIP, finished goods, scrap, loss | 010: `WIP, FG, SCRAP, LOSS` | Not live |
| **Loss pending approval** | Blob: `APPROVAL` entries. 010: **no pending state**; `LOSS` posts immediately, `approved_by` is a column | Pending loss must stay client-side or get a pending table (migration 011) |
| Transfers | 010: `TRANSFER_OUT/IN` via `TRANSIT` keyed by voucher id | No voucher table, no accept step, no UI |
| Split / merge | none | Needs a job-link table and WIP→WIP journals |
| External workshop as party | Label only (Q7 answered: must become its own party) | Karigar `kind` field, six-touchpoint change |
| QC / rework | none | New table (append-only) |
| Process loss standards | Categories only, no per-process standard | `S.kgLossStd` |
| Scrap recovery to vault | `SCRAP` account only | `SCRAP → VAULT` journal |
| Reports | `kgReport`, Reports tab | Reconciliation, trial balance, aging |
| Audit trail | `kgAudit`, ledger itself | OK |
| Finished piece → inventory | none | Needs owner-confirmed handoff |

## 6. Risks and existing bugs

- **R1 — blob and ledger can disagree.** Mitigation: deterministic `OPENING` op ids and a mismatch report before the flag `S.kgLedgerOn` is turned on (plan Task 4).
- **R2 — old device erases new keys.** A phone still on pre-batch67 JS drops `kgAgreements` and `kgRoutes` on its next save (stated in batch67 notes). Fix exists on the branch (`MIN_CLIENT_BUILD`, `APP_BUILD`) but is off.
- **R3 — seven-place key list.** Missing one place silently loses data on sync or restore. `checks/roundtrip` is the guard; keep it in every task that adds a key.
- **R4 — blob roles are not enforced.** Anyone who can call the save API can write `kg*` data. The ledger closes this only for metal.
- **R5 — blob size.** About 250 bytes per ledger line against the 2.5 MB warning (batch66 note). Moving metal to the server ledger removes this.
- **R6 — Q6, Q8-Q9, Q11-Q24 unanswered** (half-day pay, manager reversal window, where V1 payments go). They block only the tasks that depend on them; Q7 and Q10 are answered.
- **R7 — repo hygiene found during this audit:** `checks/globals.json` is rewritten by `check.bat` on every run (line-ending churn); git reports `refs/stash does not point to a valid object`. Neither affects Karigar data.

## 7. Migration strategy (summary of plan Tasks 2-4)

1. Merge branch `karigar-2-phase5a` into `main`. No deploy. Ledger code stays idle.
2. With Tanish's GO and a verified backup: apply `010`, deploy `store-proxy`, deploy worker, then set `MIN_CLIENT_BUILD` once phones reload.
3. Post one `OPENING` journal per karigar from the blob balance. Reruns are no-ops.
4. Show "blob vs ledger" mismatches in Reports. Flip `S.kgLedgerOn` per shop only after a clean week.
5. Keep the blob as a read-only fallback; never delete it.

## 8. What this audit did not verify

- `store-proxy` behaviour against a real database (the rollout doc says it was never deployed to the test project).
- Two phones posting at the same instant.
- Karigar V1 code paths and their effect on profit calculations.
- Any browser or phone behaviour.
