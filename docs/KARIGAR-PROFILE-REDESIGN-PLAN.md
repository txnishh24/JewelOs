# Karigar profile-first redesign: Phase 1 plan (9 Nov 2026)

Status: PLAN ONLY. No `js/`, `tests/`, `supabase/` or `index.html` edit has been made. Spec: `Documents/assistant/projects/karigar/karigar-rules-v1.md` (locked 9 Nov). Read from: `js/11-karigar.js`, `js/12-karigar-data.js`, `js/05-auth-login.js` (`renderKarigarList`), `js/01-sync-core.js` (order-stage functions), `index.html` panel `#panel-karigars`, migrations 010/011.

Not run: the app, `check.bat`, any test. This is a code read.

## 1. What exists versus the spec

Legend: YES = covers the spec rule, PART = partly, NO = absent, CONFLICT = built differently from the spec.

| Spec rule | Karigar 2.0 (`S.kgJobs`, `S.kgLedger`, `S.kgSalary`) | Old order-stage code (`karigarStages`, `S.karigarPayments`) |
|---|---|---|
| Gold in fine (999) | YES: `fineMg` integer mg on every entry | PART: float grams, `karigarFineOf` uses a fineness table |
| Weight as integer mg | YES (`kgParseMg`, 3 decimals) | NO: floats |
| Purity free entry, 0.01% units | CONFLICT: stored as `permille` (0.1% steps), pick-list plus "Other"; 91.82 cannot be stored. 22K limited to 91.6 to 92.0, Other 10 to 100 | NO: fixed table |
| Guard 50 to 99.99, confirm odd values | CONFLICT: different limits (see above); no confirm step | NO |
| Round once per line, half-up | PART: `Math.round(mg * permille / 1000)` once per entry (correct for positives); the new unit changes the divisor | NO |
| Two balances, never netted | YES: gold in `kgLedger`, rupees in `kgSalary` (own register, no shared total) | PART: `karigarOwed` returns cash, gold, silver as separate buckets |
| Append-only, reversal with reason, user, time | YES for `kgLedger` and `kgSalary` (`REVERSAL`, reason 5+ letters, `by`, `ts`). A job line void is a flag on the job, not a ledger entry | NO: payments cannot be reversed |
| Issue posts fine immediately | YES (derived on read) | PART |
| Wastage = points added to touch, credit = min(net x (touch + points) / 100, fine issued) | CONFLICT: wastage is a share of fine gold ISSUED in basis points (default 4%), plus optional fixed gold per job, plus optional labour per gram. No touch, no points, no measured touch, no min() cap | CONFLICT: % of net weight valued at the 24K rate |
| Agreed touch and measured touch stored separately | NO | NO |
| Salary karigar: no wastage, fine = weight x purity, owner accepts loss at close | PART: `kind:'salary'` exists with a rupee register; `LOSS` needs owner approval; close demands balance exactly 0 | NO |
| Loss settled as gold or as a cash bill into the rupee balance | NO (loss is gold only) | NO |
| Job = container of stages, each stage its own issue/receive and own karigar, returns to shop first | CONFLICT: a stage is a status label (pending/active/done) with an optional `who`. Ledger entries carry `jobId` and `karigarId` but no `stageId`, and `kgValidateEntry` forces `entry.karigarId === job.karigarId` (one karigar per job) | PART: each order item has `karigarStages` with its own karigar; no metal return-to-shop step |
| Partial returns | YES: many RECEIPT entries per job | NO |
| Job closes only on owner confirm | PART: `kgCloseJob` allows manager or owner | n/a |
| Stones, two modes, net = gross - stones | CONFLICT: receipt `stoneMg` is "info only"; fine is worked out on GROSS weight | NO |
| Sweepings, filings, dust belong to the shop; own entry type; refining = pending lot | PART: `SCRAP` entry (kinds scrap/dust/filings) credits the returned fine to the karigar and posts to the SCRAP account. No refining lot, no assay credit | NO |
| Carry-forward, ageing, ceiling, quarterly count | NO (close needs balance 0) | NO |
| Opening balances | PART: only as ledger-mode `OPENING` journals built from the blob (`kgMigrateBlobToLedger`); the blob has no OPENING entry, and the ledger flag is OFF | NO |
| Piece count and design/tag per job | PART: job `lines` (desc, qty, target weight) and receipt `pieceDesc`, `qty`; no tag number | NO |
| Karigar-to-karigar transfer | PART: server journal types `TRANSFER_OUT/IN` exist; no blob entry, no screen | NO |
| Statement for a date range, print/PDF/WhatsApp | PART: `kgStatement` (running balance, no range, wastage not shown), `kgReport(from,to)` (period report); no print/share | NO |
| Issue slip, WhatsApp share, optional photo | NO | NO |
| Karigar-held metal counted as shop stock | NO (not checked where shop stock is computed; needs a grep in the build step) | NO |
| Who can close or post a correction | PART: fixed rules (`kgCan` manager/owner; salary owner only). No per-shop setting | n/a |
| Not in v1 items | Not built, good | n/a |

What is reusable as is: `kgParseMg`, `kgTxn` (lock, snapshot, save, rollback), `kgIndex`/reversal logic, `kgValidateEntry` (extend), `kgStamp`, `kgAudit`, the `kgForm` sheet helper, `kgAgreement*` (versioned terms), `kgSalary*`, Day Book link for salary payments, the outbox/ledger client in `12-karigar-data.js` (untouched while the flag is OFF).

## 2. Data rule between old order-stage data and Karigar 2.0

Agree with your recommendation, with four additions.

Rule: the profile's four tiles, NOW, ACCOUNT and HISTORY read only `S.kgJobs`, `S.kgLedger`, `S.kgSalary`. Order-side stages appear in one separate card, "Order work (old way)", with its own figures (`karigarQueue`, `karigarMetalHeld`, `karigarOwed`) and the words "from orders". No sum, no merge, no migration of real data.

Why this is safe: the two sides use different units (float grams versus integer mg), different wastage models and different payment records. Any combined figure would need a conversion rule that does not exist and could show a jeweller a wrong number.

Additions:
1. A 2.0 job with an `orderRef` whose order also has a stage for the same karigar gets a small chip, "also on order OR-xxx (old way)". This is the one place double counting could confuse a person, so it is named, not hidden.
2. The "Record payment" button in the profile writes to `kgSalary` (`PAYMENT`, rupees, owner only, reversible, feeds the Day Book). The order card keeps its own "Record payment" that calls the existing `recordKarigarPayment`. Two buttons, two labelled places, never one total. The old `prompt()` flow stays untouched for the order card.
3. Tiles show "You owe (₹)" from `kgSalary` only. The order-side owed amount shows inside the order card.
4. If a shop has no order-stage data for a karigar, the order card is not rendered at all.

I do not disagree. One risk to accept: a karigar who is used on both sides will show two different "gold with him" figures (one in a tile, one in the labelled order card). That is why the order card is labelled and kept visually secondary.

Open fact: I cannot see live data. Whether any real shop has order-side karigar stages decides how careful this must be (question 1).

## 3. Proposed data model

Principle: additive. Every new field is optional and old entries read as they always did. No blob rewrite, no migration of real data.

### 3.1 Units
- Weight: integer mg (unchanged).
- Purity: new field `pu`, integer in 0.01% units (91.82 -> 9182, 92 -> 9200, 99.9 -> 9990). Old entries have `permille`; a reader uses `pu = (e.pu != null) ? e.pu : e.permille * 10`. Old entries are never edited.
- Fine: `fineMg = floor((mg * pu + 5000) / 10000)`. That is half-up on a non-negative integer, with no float. Largest value is 1e8 mg x 1e4 = 1e12, safe in a JS number.
- Guard (one function, `kgCheckPurity(text)`): accepts up to 2 decimals; rejects below 50 or above 99.99; asks for confirm when outside 58.3 to 99.9 or not in the shop's usual list (exact "odd value" rule: question 6).
- Stones: store `stoneMg` (integer). Carat input is converted at 0.2 g per carat (1 ct = 200 mg), rounded once.
- Rupees: integer paise (unchanged).

### 3.2 Entry types in `S.kgLedger` (gold, fine mg)

Existing, kept: `ISSUE`, `RECEIPT`, `SCRAP`, `LOSS`, `ADJUST`, `APPROVAL`, `REVERSAL`.

New fields on existing types (all optional):
- Every metal entry: `stageId`, `pu`, `grossMg`.
- `ISSUE`: `slipNo`, `carryUsedMg` is NOT stored here (see CARRY_APPLY).
- `RECEIPT`: `grossMg`, `stoneMg`, `stoneMode` ('A' shop weighed, 'B' karigar slip), `netMg = grossMg - stoneMg`, `agreedPu`, `measuredPu`, `actualFineMg = floor((netMg * measuredPu + 5000) / 10000)`, `creditFineMg` (what reduces his account). Wastage stage: `creditFineMg = min(floor((netMg * (measuredPu + points) + 5000) / 10000), fine issued on the stage)`. Salary stage: `creditFineMg = actualFineMg`. `fineMg` (the field the balance code already reads) is set equal to `creditFineMg` on new entries, so `kgJobBalance` needs no new term for new-model receipts.
- `piece`: `tag`, `qty`, `pieceDesc`.

New types:
- `OPENING`: opening balance for an existing karigar (owner only, once per karigar unless reversed). Carries `fineMg`.
- `CARRY_OUT`: at close, leftover fine leaves the job (job balance goes to 0). Carries `fineMg`, `fromJobId`.
- `CARRY_IN`: the same fine becomes a karigar-level lot labelled "Carried from [job]" with `date` for ageing. Written in the same transaction as `CARRY_OUT`.
- `CARRY_APPLY`: on the next issue, `fineMg` of a lot moves to the new job. Effect on the karigar: zero; effect on the new job: counts as issued. Next issue only needs the difference.
- `TRANSFER` (pair `TRANSFER_OUT` and `TRANSFER_IN` with a `voucher`): karigar to karigar.
- `REFINE_LOT`: a scrap lot sent for refining (pending); `REFINE_CREDIT`: assay result, credits real fine to SHOP stock, not to the karigar.
- `LOSS_CASH`: a loss settled as a cash bill. Writes a debit to the karigar in `kgSalary` (a new `type:'LOSS_BILL'`, owner only) and removes the gold loss from his gold open balance. This is the bridge between the two balances; it is one explicit entry, never a net.

Stage object on the job (`job.stages[]`), extended: `{id, name, status, karigarId, kind, wastagePoints, agreedPu, stoneMode}`. `who` stays as an alias read for old jobs. Terms (kind, points) are copied from the stage karigar's agreement on the day the stage is created, with a per-job override stored on the stage.

Jobs: add `tag`, `pieceCount`. `job.karigarId` stays (first stage's karigar) so old code and the Jobs list keep working. New field `job.model: 'points'` marks the new wastage model. Old jobs have no `model` and keep the old `kgJobBalance` branch (percent of issued, fixed gold, labour per gram) untouched.

Karigar record: `carryTrusted` (default false), `carryCeilingMg`, `lastCountAt`, `wastagePoints` default (also versioned inside `S.kgAgreements`).

Shop settings: `kgWhoCanClose`, `kgWhoCanCorrect` (owner / owner+manager).

### 3.3 Balances (all derived on read, nothing stored)
- Fine with him (per karigar) = OPENING + sum of open balance of his stage entries across open jobs + unapplied CARRY lots + TRANSFER_IN - TRANSFER_OUT, excluding reversed entries.
- Per stage: issued - creditFine of receipts - scrap - approved loss - adjust - carried out.
- Job-level "issued" must NOT be summed across stages for display (stage 2 re-issues what stage 1 returned to the shop). Open custody is correct as a sum (it equals the sum of per-karigar opens), but the headline must be per stage. A test pins this.
- You owe (₹) = `kgSalary` payable (existing `kgSalaryBalance`) minus loss bills.
- In progress = open jobs with an active stage for him. Overdue = existing `kgJobOverdueDays`.

### 3.4 Migration
- Blob: none. All fields optional; `kgNormalise` already tolerates new arrays. Add only defaults (`[]`) for any new array.
- Supabase: none needed while the ledger flag is OFF. If it is ever switched on: the server's `permille` column and its check (1 to 1000, migration 010/011 line 91) cannot hold 91.82. The journal builder would omit `permille` when `pu` is not a multiple of 10 (the field is optional and the server balances on `fine_mg`). New entry types (CARRY_*, OPENING in blob, LOSS_CASH, REFINE_*) are refused by `kgLedgerJournalFor` while the flag is on, which is today's behaviour for unsupported types. So: no migration now; a ledger-on build needs its own plan. I will not touch the flag.

### 3.5 Conflicts to decide (spec vs existing code, or inside the spec)
1. Existing wastage (4% of fine ISSUED, fixed gold, labour per gram) versus spec (points on touch, capped by issued fine). Plan: both models coexist; new jobs use points; old jobs untouched. Existing agreements keep `wastageBp`. Question 3.
2. "999 counts as 100%" (owner rule, 31 Oct, in the code header) versus spec fine = weight x purity with a 99.99 cap. 999 would become 99.90. Question 2.
3. Purity pick-list plus 22K 91.6 to 92.0 rule versus free entry with guard. Plan: free entry box; quick chips from `S.kgPurities` (92, 91.6, 75 plus the shop's saved touches). The 22K band rule goes away for new entries.
4. One karigar per job (`kgValidateEntry`) versus a karigar per stage. Plan: validate against the stage's karigar when `stageId` is present.
5. Stone weight informational versus deducted. New entries deduct; old ones do not.
6. Spec "SCRAP belongs to the shop; refining is a pending lot until assay credits real fine" is unclear on one point: does the karigar's account drop at weighing (as `SCRAP` does now) or at assay? Question 4.
7. Salary karigar loss "no fixed %": fine, nothing to build beyond owner confirm at close; but today close needs balance exactly 0, so an accepted loss is a `LOSS` entry the owner approves first. Plan keeps that and adds one "Accept loss and close" action on the Close sheet that posts the approved LOSS and closes in one step.
8. Photo on an issue slip would go into the single-JSON-blob shop record and bloat it. Plan: no stored photo in v1; slip is generated for sharing only. Question 8.
9. Day Book: `kgSalary` payments already feed it as cash-out. LOSS_BILL and any new rupee entry must be checked against `10-daybook.js` so cash is not double counted; plan makes LOSS_BILL non-cash (no Day Book line).

## 4. Build plan: small batches, each with tests and a rollback

Rules for every batch: ES5; one commit per batch; `check.bat` plus the five relevant suites; no deploy; ledger flag OFF; the new profile is behind a local switch `S.kgProfileUi` (default OFF, owner toggle on Reports) until you approve, so rollback is "switch off" without a revert. Bug-pattern reviewer then test runner after each `js/` batch; invariant tester on batches 1 to 5.

| # | Batch | Tests added | Rollback |
|---|---|---|---|
| 0 | Housekeeping done today (MODEL-POLICY removed). Mockup of list, profile, Add job and Close job sheets, phone and desktop, light and dark (static HTML, no app code) for your approval | none | delete the mockup file |
| 1 | Money and metal core, pure functions only, no UI: `kgPu`, `kgCheckPurity`, `kgFineFromPu`, `kgNetMg`, `kgWastageCredit` (min cap), `kgStoneMg`. Reader fallback `permille*10` | purity guard (50, 49.99, 99.99, 100, 91.82, 91.825), half-up rounding to milligrams, min() cap hit and not hit, net = gross - stones, ct to g, old-entry fallback | revert one commit (nothing calls it yet) |
| 2 | Entry types and validation: new fields on RECEIPT/ISSUE, `OPENING`, `CARRY_OUT/IN/APPLY`, `LOSS_CASH`, stage karigar rule, reversal of the new types | carry-forward adjustment (next issue needs only the difference), carry then reverse, reversal restores balance exactly once, no double count between job and lot, opening twice refused, stage 2 re-issue does not inflate custody, existing karigar-v2 tests unchanged | revert; nothing visible changes, flag `model` absent |
| 3 | Balances and views: `kgKarigarAccount(id)` (tiles, running fine statement, ageing, ceiling warning, count-due), date-range `kgStatementRange`, order-side figures kept separate | tile totals equal sum of rows; fine and rupees never netted; ageing buckets; ceiling warning; old jobs balance identical to before (golden test over existing fixtures) | revert |
| 4 | New list and profile UI inside `js/11-karigar.js`: `#kg3` markup replaces both cards in `index.html` behind `S.kgProfileUi`; old `renderKarigarList` kept for the switch-off path and its tests | regression tests that name `#karigar-list`/`kg-card` stay green while switch is off; new render tests for escaping, empty state, role gating | switch off; or revert |
| 5 | Add job and Close job sheets inside the profile (stage route, karigar per stage, piece count and tag, stones mode, carry-forward choice, accept loss and close, who-can-close setting) | close with carry; close with accepted loss; permission refused; stone modes A and B | switch off |
| 6 | Record payment, loss bill (non-cash, Day Book check), opening balances screen, transfer between karigars | payment reversal; loss bill leaves Day Book unchanged; transfer moves fine once | switch off |
| 7 | Statement for a date range (print view, share text for WhatsApp), issue slip (dated, weight, purity, no photo), scrap and refining lot | statement totals equal ledger; slip text escaping | revert |
| 8 | Karigar-held metal in shop stock (after a grep for where stock is computed), quarterly count prompt, remove the old card and "Karigar 2.0" chrome once you approve | stock includes held fine once; count prompt date logic | switch off |
| 9 | UI click-through (`skills/verify-ui.md`) on E2E shop `77c4aefe` only, phone and desktop, light and dark, then `npm run test:e2e` (karigar touches session and saves), readiness review | n/a | n/a |

Estimate: batches 1 to 3 are the risky ones (money and metal); batch 4 onward is mostly presentation. Nothing deploys without your word.

## 5. Questions I need answered

1. Do any real shops (not your test shops) already have order-side karigar stages or `S.karigarPayments`? If yes, how many shops?
2. 999 gold: keep "counts as 100%" (the 31 Oct owner rule) or follow the spec (99.90)? The spec cap of 99.99 means 100% cannot be typed.
3. Existing wastage terms (4% of issued, fixed gold per job, labour per gram): may old jobs and old agreements keep working as they are while new jobs use points? And is "points" always a percentage point of touch (4 = 4.00 points)?
4. Scrap: does the karigar's gold account drop when you weigh the sweepings (as today), or only when the refining assay credits the real fine?
5. Wastage cap "fine issued on the job": per job in total, or per stage? (With a chain, stage 2's issue is what stage 1 returned.)
6. Purity "odd value" rule for the confirm step: confirm anything outside which range, or anything not in the shop's saved list?
7. Who may close a job and who may post a correction, by default: owner only, or owner and manager? Should a manager see the rupee tile (today the salary register is owner only)?
8. Issue slip: is a photo needed in v1? Storing it in the shop record makes the record bigger; sharing without storing is the safe choice.
9. Silver and other metals: gold only in the new profile (per the spec "other metals later")? The old order card still shows silver.
10. Opening balances: one entry per karigar, entered by the owner as fine gold and rupees, from a real khata. Can you give one real karigar khata to test with before the schema freezes, as the spec asks?

## 6. Could not verify
- Anything about live data or shops; whether the live site matches this repo.
- Where shop stock is computed (batch 8 starts with a grep).
- That `kgForm` supports every field type the new sheets need.
- The test count and state of `check.bat` (not run in this phase).
- The trade claims in the spec (points versus percent, hallmark loss rules); the spec itself says confirm with a real karigar.

## 7. Decisions from Tanish (9 Nov) and what they change

1. Order-side data is real: shops `77c4aefe` and `65a3ce29` have order stages (about 17 and 7) and 1 payment each. Karigar 2.0 holds 0 jobs and 0 ledger rows in all 9 shops. The "Order work (old way)" card is mandatory.
2. 999 keeps counting as 100% (`pu` 10000). The purity guard (50 to 99.99) applies to typed values; the 999 chip is a fixed special case. Same for silver 999.
3. Points model confirmed ("92 + 4 = 96"). Because 2.0 has no data, the old wastage model (% of fine issued, fixed gold, labour per gram) is REPLACED, not kept alongside. Removes the legacy branch in `kgJobBalance` and `kgCloseJob`; old tests for it are rewritten.
4. Sweepings, filings and dust belong to the shop. ASSUMPTION, to confirm: the karigar account drops when the sweepings are weighed (as `SCRAP` does today); the refining lot only tracks the shop's pending versus assayed fine.
5. Wastage cap counts the whole job (all stages together), not per stage.
6. Odd purity asks for confirm. ASSUMED rule: confirm outside 58.3 to 99.9, or when the value is not in the shop's saved touches.
7. Owner and manager may close a job and post a correction. ASSUMPTION, to confirm: a manager sees the "You owe" tile but only the owner records a rupee payment (salary register stays owner only, per the 6 Nov audit note).
8. No stored photo on the issue slip.
9. SILVER IS IN v1 (scope grew from the spec, which said other metals later). Each job, stage and entry gets `metal` ("gold" default, "silver"). Fine = weight x purity for both. Balances are per metal and never summed: gold fine, silver fine, rupees. Tiles show silver only for a karigar who has silver. The server ledger has no metal column, so a ledger-on build would need its own plan (flag stays OFF).
10. A real karigar khata sample is still to come from Tanish.

## 8. Final calls (9 Nov, after Tanish's last answers)

- Sweepings, filings and dust belong to the shop (Tanish). Claude's call on timing: the karigar's gold account drops when the sweepings are weighed; the refining lot only tracks the shop's pending versus assayed fine.
- Odd purity (Claude's call): confirm when the value is outside 58.3 to 99.9 or not in the shop's saved touches. Hard reject outside 50 to 99.99.
- Manager sees every tile and every movement, including "You owe" (Tanish: "Show"). Claude's call: only the owner records a rupee payment; owner and manager close jobs and post gold corrections.
- Status: still waiting for the word "approved" before batch 1. Khata sample still to come.
