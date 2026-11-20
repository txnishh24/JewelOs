# R36 fix queue (WAITING: nothing here is started)

Written 20 Nov 2026 after the Opus review of commit `5cdb9dc` (branch `claude/r36-role-check`).
Tanish asked to hold all of this and start everything at once, after his own changes are done.
Nothing below is built, merged, deployed or pushed. `ROLE_CHECK_MODE` stays `log`.

Reviews behind this list: two `jewelos-security-auditor` rounds and one Opus review (all in the 248th HANDOFF entry
and this file). Finding ids F1-F8 are the Opus review's.

## A. Blockers before `enforce` (small, each has a failing input)

| # | Fix | Where | Failing input today |
|---|---|---|---|
| F1 | A correction (`kind:'adjust'`) entry may have amount 0 when the restated change is within 0.01 (cash in and out moved equally). Or the client skips posting the entry but still re-baselines the close. | `role-check.ts` ~307; `js/10-daybook.js` 812-815, 847 | Stored close `{autoIn:1000, autoOut:500}`; manager sweep adds entry amount 0 with restatement in+1000, out+1000. Refused `negative_amount` on every Day Book open. |
| F2 | Refund checks: `r.items` unique, valid indices, not already returned; `returnedItemIdx` only grows, no duplicates, only by this refund's items; total refunds not above `lockedGrand` + 1 (client cap `js/01` 2695). | `role-check.ts` 240-250 | Manager refund `{amount:1, items:[0,0,0,0,0,0,0,0,0,0]}` on a Rs 60,000-cost item: allowed, profit up about Rs 6 lakh (`calcRefundAdj`, `js/01` 2252-2260). |
| F3 | Money fields must be real numbers, zero or more: add `stoneCost` to item keys in `badMoneyType` and `negativeAmount`; same for `karigarStages[].karigarCost`, `karigarWastagePct`, `karigarRate`. One shared money-field list. | `role-check.ts` 111-135 | Staff new bill with `stoneCost:-500000`: allowed, profit up Rs 5 lakh. |
| F4 | `dayBook.opening` may change only for a manager and only while no close exists; otherwise equal. | `role-check.ts` 401-410; client `dbSetOpening` `js/10` 607-616 | Staff changes opening amount 1000 to 900000: allowed. |

## B. Should fix before `enforce`

| # | Fix | Note |
|---|---|---|
| F6 | New sale: if the product's cost is above 0 and the item has `costSnap:true`, require the product's cost (cost 0 or negative drops a loss-making sale out of profit via `saleItemCostMissing`, `js/01` 2140). | Conflicts with the offline case below; decide together. |
| F7 | Edit Bill: skip items whose `pid`, `costRate` and `metal` are unchanged from `before`, so an owner restock that changes a product's metal (`js/09` 1096) does not refuse a plain rename. | Part of design (a) below. |
| F8 | Offline replay: one refused bill sets aside the whole outbox (`quarantineOfflineSales`, `js/02` 1839-1848). Either quarantine only the refused bill, or make the server accept the offline cost (see "Decisions"). Purchase restock re-costs products (`js/09` 1104), so this is routine, not rare. | Client change, then needs a deploy. |
| F5 | Accept and document as residual risk: a staff sale can name a cheaper product of the same metal; an older lower cost can be reused after the owner raises it. Cannot be closed in this design. | Say it in the Settings note for shops; do NOT claim costs are protected. |

## C. Minor (batch with the above)

- A manager can add `cat:'adjust'` with `kind:'manual'`, or a future-dated entry. The client refuses both (`js/10` 635, 641). Add the same two checks.
- A forged correction with an invented `newIn` passes and cannot be voided. Tie the close's new `autoIn`/`autoOut` to the restatement's `newIn`/`newOut`.
- A non-owner can set a text product cost (`"6800"`) to 0 (`costOf` reads text as 0). Compare raw values.
- Server matches `pid` with `String()`, client with `===`. Make the server strict.
- `deepEq(undefined, [])` is false: a stored `dayBook` with no `reopens` refuses every non-owner save (`dbInit` adds `reopens:[]` on load, `js/10` 106). Same for a shop with no `rates` (client keeps default `S.rates`, `js/00` 84, `js/01` 172). Treat missing as empty on the stored side. Read live data first (section F).
- Stored products with text `costRate` refuse every non-owner sale of that product. Read live data first.
- Staff opening the Day Book after a stale close is refused each time (`staff_close`, also before R36). Client: skip `dbSweepRestatements` for staff (`js/10` 977).
- Open from the 248th entry: purity not compared (Edit Product changes it legitimately); a manager can rewrite an existing close's `closing` and `counted`.

## D. Logging (needed to read the log-mode baseline)

`index.ts` ~399 logs only the FIRST violation's code, with no bill or entry id. Log every violation with the bill or entry id (and role, no amounts of customers' data), so the log-mode days tell us something. This is a `store-proxy` change, so it needs the deploy.

## E. Design simplification (the Opus review's main advice)

The server guesses intent from a whole-blob diff, so every new client flow needs a special case (F1 and F7 are that drift). Before `enforce`:
- (a) For non-owners, make an existing bill's cost fields read-only: `pid`, `metal`, `costRate`, `costSnap`, `isCustom`, `stoneCost`, `karigarStages`. Replaces the `had`/`hadRaw` logic; fixes F7, repointing a line, flipping `costSnap`.
- (b) One shared money-field list (numbers, at least 0) for sales, items, stages, entries (F3).
- (c) One rule per top-level `dayBook` key: `opening`, `entries`, `closes` (figures read-only except a new restatement whose `new*` equals the new `autoIn`/`autoOut`; `countCorrections` only grow).
- (d) Long run: refund, rates and Day Book as action endpoints, not blob PUTs. Bigger change. **Needs Tanish's word.**

## F. Tests to add (the existing "1131 flows, 0 refusals" does not touch R36)

- Seed shop with costed products (`seedBlob` has no `costRate`, `tests/role-check.test.mjs` ~494).
- Sales built through the real item builder (`js/02` 1511-1529), not by hand (`doSale` ~503).
- Fuzz and replay: manager refund with a ticked item on a costed shop (`.rfnd-item-chk`, `_submitRefund`), `dbAddEntry`, `dbVoidEntry`, `dbSweepRestatements` (include equal in/out, F1), `dbCorrectCount`, the rate fill, Edit Bill after an owner restock.
- One probe case per finding above (F1-F8 and the section C items), each failing on `5cdb9dc`.

## G. Things only Tanish or Cowork can do

Tanish:
1. Finish his own changes first (the reason for this hold), then say "start R36 fixes".
2. Decide: merge `claude/r36-role-check` into local `main` now (log mode is harmless) or after the fixes.
3. Decide F8: quarantine only the refused bill (client change), or accept that enforce may set aside a phone's outbox after a restock.
4. Decide section E(d) (action endpoints) later; not needed for log mode.
5. Say "deploy `store-proxy` in log mode" when ready (I run `/careful` first). Needs the Supabase deploy permission.
6. Test env file for `npm run test:e2e` (never run on this branch).

Cowork (read-only, live database):
1. Count shops whose products or sale items hold a text `costRate`.
2. Count shops whose stored blob has no `dayBook.reopens` or no `rates`.
3. After a log-mode deploy: read the function logs for `role-check` lines and list every `code=` seen.

## H. Verification still owed

- `tests/cowork-live-check.js` fails ("first recordSale() call actually saved a sale", GST % toast). Run it on clean `HEAD` (not run: permission was denied once) to see if it is older than R36. It is not in `check.bat`.
- `check.bat` does not launch from the Bash shell here; run its steps by hand or from a Windows prompt.
- e2e, a phone check and the AST hit lists diffed against the last run: not done.
- After the fixes: `jewelos-security-auditor` again, `jewelos-invariant-tester`, `jewelos-test-runner`, and a second Opus read of the Day Book and refund rules.

## I. Order when we start

1. Tests first (section F), each failing on `5cdb9dc`.
2. A, then B, then C in `role-check.ts` (one pass), plus the two small client changes (staff skips the sweep; quarantine only the refused bill if Tanish picks it).
3. D (logging).
4. Full checks, reviewers, Opus read.
5. Merge to local `main`; deploy in log mode only with Tanish's word; read logs for a few days; decide on `enforce`.
