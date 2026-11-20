# R36 plan: server role-check rules for R30-R34

Status: PLAN ONLY. No code written, nothing deployed. `store-proxy` stays in `ROLE_CHECK_MODE=log`.
Target: `supabase/functions/store-proxy/role-check.ts` (324 lines, pure, tested by `tests/role-check.test.mjs`).

## Why
The client hides these things for non-owners (R30-R34). The server does not yet refuse them, so a
manager or staff user with the browser console can still do them. Client gates are display only.

## The four gaps, checked against the current code

| # | Client rule (R30-R34) | Server today | Gap |
|---|---|---|---|
| 1 | Rates are owner-only (`js/02` 284) | `role-check.ts` 268-271 checks existing `rates` keys for staff only. `discCaps` is checked for both. | A manager can change gold or silver rates. |
| 2 | Delete product is owner-only (`js/02` 735) | Only the 20% shrink guard (lists of 5+). | A manager or staff can delete up to 20% of products per save, or any product in a shop with under 5. |
| 3 | Day Book: staff cannot void; staff add manual entries only; closed day is locked | `dayBook.reopens` and `closes` are checked. `dayBook.entries` has NO rule (design doc "still open" list). | Staff can edit, void or delete any entry, including on closed days. |
| 4 | Only the owner sets or sees `costRate` (`canSeeProfit` = `isOwner`, `js/05` 734) | No rule. | A non-owner can send any `costRate` on a product and distort profit for every later sale. |

## Rules to add (each gets a code, a plain-words message and a test that fails without it)

1. **`rates_owner_only`** (gap 1): for manager too, every rate key that existed must be unchanged. Keep the existing tolerance for a key the client newly adds on load. Reuse the staff branch: drop the `!isManager` condition. Smallest diff.
2. **`owner_only` product delete** (gap 2): for non-owner, no product id present in `cur.products` may be missing from `next.products`. Reuse `idMap`. Keep the 20% guard for the other lists.
3. **Day Book entries** (gap 3), non-owner:
   - an existing entry may not be removed (both roles);
   - staff: existing entries unchanged;
   - manager: an existing entry may change only by `voided` false to true with `voidReason`, `voidTs`, `voidBy` set, a non-empty reason, not `kind:'adjust'`, and its day not closed (mirrors `dbVoidEntry`, `js/10` 659-676);
   - a new entry (both roles): amount a finite number above zero, `dir` is `in` or `out`, its day not closed (mirrors `dbAddEntry`, `js/10` 642).
   - Stretch, same area: a manager may not change the figures of an existing close (open item in the design doc).
4. **`costRate`** (gap 4), non-owner:
   - an existing product's `costRate` must be unchanged (compare with `num()`, so missing and 0 are equal);
   - a new product's `costRate` must be missing or 0 (the client clears the field, R34 H);
   - new sale items: the snapshot `costRate` (`js/02` 1529) must equal the product's cost in `cur`. Only possible if the item links to its product by a stable id. CHECK THIS FIRST. If there is no reliable link, skip this sub-rule and write the residual risk down.

## Before writing code (read-only, no approval needed beyond a normal session)
- **Baseline from the logs:** pull the `role-check log` lines from the live function (Supabase `query_logs`, read-only). Count current hits by `code`. That is the real false-positive rate to beat. Not done yet.
- **Rates:** grep every client path that writes `S.rates` as a manager (auto-fetch, `updatedAt` stamps). If one exists, rule 1 would refuse a normal save.
- **Product removals:** grep `S.products = ...filter` and purchase-to-stock sync. If a flow legitimately removes a product (sold-out cleanup, merge), rule 2 needs an exception or the client needs a fix.
- **Day Book:** list every writer of `S.dayBook.entries` (lines 654, 819 and any karigar or girvi poster) so rule 3 allows each real one.

## Tests
Add to `tests/role-check.test.mjs`: one table case per rule for each role, plus one "legitimate save still passes" case per rule (manager voids an entry with a reason; staff adds a cash entry; manager saves with unchanged rates). Extend the fuzz run so real client flows still give 0 refusals. Full `check.bat` and `npm run test:e2e` after.

## Rollout (each step needs Tanish's word)
1. Code and tests on a branch. Opus review of the rule code, then `jewelos-bug-pattern-reviewer`, `jewelos-invariant-tester`, `jewelos-security-auditor`, `jewelos-test-runner`.
2. Deploy `store-proxy` in `ROLE_CHECK_MODE=log` (`/careful` first). **Needs Tanish's word.**
3. Watch the logs for several days of real use. Zero false positives needed.
4. Set `ROLE_CHECK_MODE=enforce`. **Needs Tanish's word.** Rollback is flipping it back to `log`.

## Also in this round (client, small)
- `addProduct()` (`js/02` ~663) reads the cost field for any role. Add a `canSeeProfit()` check. Safe: the field is already hidden and cleared.

## Not in this round
- Hiding `costRate` from manager and staff on GET. Still display-only: every role's browser downloads costs. Phase 2 in `docs/ROLE-CHECK-DESIGN.md`; needs a server-side merge on PUT. Do not tell shops that managers or staff cannot see costs.
- Purchases and Karigar writes by non-owners (owner-only on the client, no server rule). Next round.
- Repeated saves that empty a list 19% at a time.

## Risks, worst first
1. A rule refuses a real save: a bill or entry is lost to the phone's quarantine. This is why log mode runs first and `enforce` waits for clean logs.
2. Old phones on batch74 or earlier send flows the new rules did not expect. Logs will show it.
3. Rule 4's sale-snapshot check cannot be built without a product link on the sale item.

Not run: gstack's full review ceremony (review log, report file); this plan is my own read of the code. Nothing here has been tested.
