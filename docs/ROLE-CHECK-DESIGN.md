# Server-side role check (R29)

Status: code and tests on branch `claude/r29-role-check`. NOT deployed. `store-proxy` v18 is still live.

## What it does
`store-proxy` PUT, for role `manager` / `staff` only, reads the stored blob and calls
`checkRoleWrite(role, cur, next)` (`supabase/functions/store-proxy/role-check.ts`, pure, no Deno).
- Skipped for the owner (no extra read, no change in behaviour or speed).
- Skipped when `cur._v !== expectedVersion` (the CAS answers 409 and the client retries on fresh data).
- Fails OPEN: if the stored row cannot be read or the check throws, the save goes through.
- `ROLE_CHECK_MODE`: `off` (skip), `log` (default: log `role=… code=… user=…`, never block), `enforce` (403 `{error:"role_forbidden", code, message}`).
- Cost: one extra read of the shop row (0.5-3 MB) per manager/staff save.

## Rules implemented (first violation wins)
| Who | Rule | Code |
|---|---|---|
| manager, staff | `plan`, `gstin`, `kgLedgerOn`, `paidUntil`, `users`, `team`, `shop` unchanged (none of these are in the blob today; guard only) | protected_key |
| manager, staff | `rates.discCaps` unchanged | owner_only |
| staff | existing `rates` keys unchanged (a key the client newly adds on load is tolerated) | staff_rates |
| manager, staff | `dayBook.reopens` unchanged | owner_only |
| staff | `dayBook.closes` unchanged | staff_close |
| manager | no existing close removed (that is a reopen); adding a close is allowed | owner_only |
| manager, staff | no id removed from `voidedInvNos`; `nextInvNo` never lowered | owner_only |
| staff | no bill removed | staff_delete |
| manager, staff | `customers/products/girvi/orders/purchases` may not shrink by more than 20% in one save (lists under 5 records exempt) | mass_delete |
| staff | an existing bill may only gain payments (`extraPayments`, `paymentHistory` append-only, amount > 0; `payStatus`, `paidAt`) | staff_edit, payment_rewritten, negative_amount |
| manager | existing bill: payment changes as above; a refund (`refunds` append-only, each with a reason, amount > 0, bill's day open); an edit (`editHistory` grows, new entry has a reason, bill's day open, discount percent not over the manager cap unless not above the bill's earlier percent + 0.05) | reason_required, closed_day, discount_over_cap, edit_needs_reason |
| manager | removing a bill is a void: number in `voidedInvNos`, a new `auditLog` entry for that sale with `\| reason: <text>`, bill's day open | void_not_recorded, reason_required, closed_day |
| manager, staff | new bill: no negative amount, discount percent within the cap (staff 5, manager 15, or the shop's own `discCaps`) | negative_amount, discount_over_cap |

Discount percent = `discount / base`, `base = lockedGrand / (1 + gst/100) + discount` (falls back to the item lines when there is no `lockedGrand`). Slack 0.1 percent point so a bill the client accepted at the cap is never refused. Day of a bill = its IST calendar day.

## What I could NOT implement as written, and why
1. **"Void = status change, voidReason; deleting a bill is refused for managers."** In this app a void IS a removal: `deleteSale` filters the bill out of `S.sales`, adds its number to `voidedInvNos` and writes an audit entry `... | reason: <text>`. There is no `status`/`voidReason` field. Refusing removal would stop managers voiding. Implemented as "removal allowed only when it is a recorded void" (above). The reason lives in the audit note, so the server checks the note, which a console user can fake, but not without a trace.
2. **"New sale not on a closed day."** DECIDED by Tanish, 14 Nov: no bill after the day is closed, for staff or manager; the owner reopens the day. Now ON (`BLOCK_NEW_SALE_ON_CLOSED_DAY = true`) and the client refuses it too (`recordSale`). Known edge: an offline bill made before the close and synced after it is refused by the server; the phone sets it aside (`quarantineOfflineSales`) and the owner must reopen the day. Until the client with this guard (batch75) is deployed, a batch74 phone still lets staff record such a bill; in log mode the server only logs it as `code=closed_day`.
3. **"date not on a closed day" for staff payments** is not needed: a payment is dated when taken.
4. **Old-bill part-payments (the question you asked):** the client does NOT edit the old sale's money fields. `submitSalePayment` appends to `sale.extraPayments` and `sale.paymentHistory`; `markSalePaid` (manager) appends a payment and sets `payStatus='full'`, `paidAt`, and fills `lockedGrand`/item `lockedRate` if missing. There is no `paid`/`due` field (balance is derived by `calcSaleTotals`). So the rule is: append-only on those two arrays plus `payStatus`/`paidAt`. A startup migration that fills a missing `lockedGrand`/`lockedRate` is ignored as a change.
5. **Reason on a refund/edit** is checked in the new `refunds[]` / `editHistory[]` entries (fields `reason`), not in a separate place. An owner edit with no reason is stored as "Edited", so for managers the server can only require non-empty (a typed reason of one letter passes).
6. **Profit hiding on GET:** phase 2, below. Not built.

## Client gaps found (not fixed here, for Tanish)
- **Payment reversal** was open to staff (button shown to every role, no check in `reverseSalePayment`). DECIDED by Tanish, 14 Nov: staff cannot reverse. Server refuses it (`staff_reversal`); client change (button hidden, function refuses) is on this branch, not yet deployed (batch75). A batch74 phone still shows the button; in log mode the server logs the attempt.
- **Offline bills refused by the server** would have been replayed and refused on every load. Fixed on the client: a `forbidden` answer to the replay save now moves those bills to `jewelos_sale_outbox_rejected::<shop>` on the phone, empties the outbox and reloads the cloud data (`quarantineOfflineSales`).
- Any other flow that writes a refused change leaves that change in the phone's memory until the next load; the 403 toast shows the server's sentence and nothing retries (`js/01-sync-core.js` 403 branch: no retry, `_clearUnsynced`, callback gets `forbidden`).

## Biggest false-refusal risks (watch these in the logs)
1. A phone that never reloads keeps a stale `S` from before the owner changed something, then the version check passes only if it is current, so this cannot refuse on stale data (stale = 409 instead).
2. Time zone: a bill's day is computed in IST; a shop outside India would see wrong closed-day matches.
3. Discount percent on a bill whose `lockedGrand` was later backfilled by migration.
4. A very old shop blob with sales missing `id`s: such sales are ignored by the by-id rules (cannot be matched).
5. Any new client feature that edits an old bill's non-payment fields as staff. The tests would not know; the log will.

## Rollout (each step needs Tanish's word)
a. This branch: code + tests. **Done, stop.**
b. Save the live v18 source (`E:\jewelos\backup\store-proxy-v18.ts`, copied from `main`; structure matched the live v18 fetched read-only, byte-equality not proven), deploy with `ROLE_CHECK_MODE=log` (default if unset). Needs `store-proxy` deploy permission.
c. Watch the function logs for `[store-proxy] role-check log` a few days. Zero false positives, then set `ROLE_CHECK_MODE=enforce` (an env change; flip back to `log` to roll back instantly).

## Phase 2 (design only): hiding profit from manager/staff on GET
Goal: manager/staff GET returns no `costRate`, purchase cost, or other profit fields.
Why it is risky: the client PUTs the **whole blob** back. If GET strips `costRate` from products and the client saves, the stored costs would be overwritten with nothing.
Needs a **server-side merge on PUT** for non-owner roles: for every record with an id, copy each stripped field from the stored record into the incoming one (and keep stored records that the client was never shown). Failure cases to design for:
1. New record created by staff (no stored match): no cost to restore, fine; but then the owner never learns the cost: define where it comes from.
2. A record staff edits that legitimately needs a cost (add stock): staff would be setting `costRate` on a product they cannot see.
3. A client that sends the field back as `0`/`null` vs omitted: the merge must treat "absent" and "stripped sentinel" the same and never accept a non-owner's value for a protected field.
4. Version conflict (409) returns `current_data`: that body must be stripped too, or it leaks.
5. `purchases`, `suppliers`, karigar labour rates, Day Book profit lines: every profit-bearing path, not only `costRate`. Missing one means a silent leak; the UI profit gates (R26) already hide them in the app, so this phase only protects against console use.
6. Backups/exports downloaded by a manager must be stripped too, or they bypass it.
7. Performance: two reads and a merge per save on a 3 MB blob.
Recommendation: do not build until the phase-1 log shows zero false positives for a few weeks; then build it behind its own flag with a replay test that PUTs a stripped blob and asserts every stored cost survives.

## Security audit round (jewelos-security-auditor) - fixed and still open
Fixed (each has a test, "audit:" in `tests/role-check.test.mjs`): a crash inside the check no longer lets the save through (it refuses as `malformed`; owner never runs the check); a bill with id `__proto__` can no longer hide changes (maps built with `Object.create(null)`); bills without an id or with a duplicate id are refused; money fields must be real numbers; a new or edited bill whose total is far below its own item value is refused (`total_below_items`, 3% slack); a made-up `lockedGrand` on an old bill no longer counts as the startup migration; staff cannot flip paid status without a payment; payment-history amounts must be positive; a manager edit cannot move a bill onto a closed day or rewrite earlier refunds; a new bill cannot reuse a live or voided invoice number; a mistyped `ROLE_CHECK_MODE` logs a warning (it still behaves as `log`).
Still open (known, not fixed; low enough for log mode, decide before `enforce`):
- Staff can edit `dayBook.entries` (including entries on closed days); no rule covers them.
- `girvi`, `products`, `purchases` shrink guard is per save: repeated saves can empty a list 19% at a time.
- A manager can rewrite the figures of an existing Day Book close as long as its date stays.
- A part-payment can be dated on a closed day (the app dates it "now"; the server does not check).
- `lockedRate` backfill on an old bill accepts any positive number (the real migration writes today's rate).
- The role check needs `get_advisors` / RLS review on the live project; not run (waiting for Tanish).

## Tests
`node tests/role-check.test.mjs` (Node, no Deno, no network). 31 table-driven rule cases (23 plus 8 from the audit), 4 replay flows through the real client functions against a mock store-proxy (1,250 flow runs including the fuzz), 500 fuzz sequences (2,450 operations, 0 refusals), the client 403 path, and the offline-outbox quarantine.
