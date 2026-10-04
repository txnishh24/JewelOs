# batch48 — money-correctness pass: edited bills, refunds, Reports, and three Edit Bill / Day Book bugs that shared one root cause

Base: batch47, live since 3 Oct. Everything is in `index.html` and `js/`. Server side: nothing
new to deploy.

**This is a QA-driven correctness pass, not a visual one.** Built from the 3 Oct Playwright
QA pass (`jewelos-qa/01-06`) against a throwaway shop. Every fix below carries its own
regression test, confirmed (via `git stash` against the unfixed code) to actually fail before
the fix and pass after — not just asserted to work. A final whole-chain Opus review ran across
everything in this batch before it was packaged; verdict: clear to build, no blockers. Its
non-blocking findings are listed under "Known, not fixed in this batch" below — read that
section before deploying, two of them need a live-data check first.

## 🔴 Critical / High

- **C1 — Edited bills now re-lock to the real new total.** `saveEditBill()` read back its own
  pre-edit `lockedGrand` before recomputing, so a discount or item-weight edit never actually
  changed the stored total. Printed invoice, balance, Reports and GST all disagreed with each
  other on an edited bill. Now clears the lock before recomputing, and `payStatus` can correctly
  degrade out of `'full'` if an edit raises the total.
- **C2 — An unsynced save held for re-auth no longer gets silently clobbered by the next load.**
  If a save was held waiting for the owner to re-enter their password (session expired) and the
  jeweller reloaded instead, the next load used to overwrite that unsaved change with the
  server's stale copy, with no warning. A shop-scoped local marker now makes the reload retry the
  held save instead of discarding it.
- **H1 / M1 — Negative or absurd gross/net weight is refused on Add and Edit Product.**
- **H2 — Reports now reflect refunds** in Revenue, Profit, GST and Net Cash — a refund used to
  vanish from every one of these.
- **H4 — A central audit trail now covers bill edit, new sale, bill delete, product delete,
  new/cancelled orders, and rate changes** — these 7 real money-adjacent actions had zero audit
  entries before.

## 🟡 Medium

- **M3 — The Edit Bill screen's live total can no longer disagree with what Save actually
  stores.** The running Grand Total/Balance you watch update while editing used to be computed
  by its own separate formula from the one Save uses — missing quantity, charging a custom
  item's making rate as if it were a flat amount (undercounting by thousands of rupees on a
  heavy piece), ignoring bill-level making/diamond charges, and ignoring payments recorded after
  the bill's creation. Now both share one formula, so they can't drift apart. Also: Discount and
  GST% boxes in Edit Bill silently had no live-refresh at all — fixed; and the per-item "Making"
  box is now correctly labeled "Making (₹/g)" for a custom item (it's a rate, not a flat amount).
- **M3 follow-up — three more places shared the same root cause** (clearing a payment field in
  Edit Bill left stale money behind instead of actually clearing it):
  - Clearing Old Gold Value or Advance to 0 left `sale.oldGold`/`sale.prevAdvance` stranded at
    their stale pre-edit figures (`sale.advance` itself was already correct) — now always
    rewritten, matching how a new sale always sets these fields.
  - **Day Book could post old-gold/advance money as a phantom "fresh sale" cash-in line.** Not
    only an Edit Bill problem — reachable from a plain exchange sale at creation (fully paid in
    old gold, nothing fresh collected). Cowork confirmed by live-data query this currently
    affects exactly one shop (`65a3ce29`, 2 sales, looks like a demo/own shop) and zero paying
    shops. See "Before you deploy."
  - Opening Edit Bill on one of those sales pre-filled a payment row showing that old-gold/advance
    money as if it were fresh — saving unchanged would have re-created the Day Book bug. Fixed
    (now pre-fills ₹0 for that case).
- **M4 — The "0" pre-filled in sale-form number boxes (Extra Making, Extra Diamond, GST%,
  Discount, Advance Paid) no longer forces an extra keystroke** before typing your real number.
- **M5 — A discounted bill's printed line items now agree with its own footer.** Each line's GST
  was computed before the discount was applied; the footer's GST was computed after. On any bill
  with both a discount and GST, the printed line and the total disagreed. **Note: reprinting or
  re-sharing an old discounted GST bill now shows the corrected per-line figures, which will
  differ from the copy the customer originally received — the Grand Total itself is unchanged.**
- **M7 — The Reports page no longer scrolls sideways at phone width (390px).** A CSS Grid
  quirk let two of its tables blow out the whole page instead of scrolling within their own card,
  like every other table in the app.
- **M8 — Category Intelligence now matches the Reports page's selected month** instead of always
  showing today's. "Cash In" relabeled to "Total Collected" on Reports/Dashboard where it
  collided with Day Book's different, cash-only metric of the same name.

## 🧹 Tooling (no app behavior changed)

- Two ES5-enforcement git hooks added (blocks a new non-ES5 construct in an edit; blocks
  creating a new `js/` module file without sign-off).
- Two pre-existing ES5 violations fixed: 5 emoji codepoint escapes converted to their exact
  UTF-16 surrogate-pair equivalent (byte-identical characters, zero visual change), and an unused
  `async` keyword removed from `sendStaffInvite` (its body never used `await`).
- `check.bat` now also runs `checks/unquoted-args.js`. Stale docs (Control Room → Office, store-
  proxy version, e2e spec count, live URL) refreshed.

## Deliberately untouched

The Girvi interest-ledger math, Day Book's Close Day / locked-day logic (only the one tier-3
posting bug above was touched), the premium redesign's visual system, and every pricing formula
not named above.

## Known, not fixed in this batch

From the whole-chain Opus review. None of these blocked the build; two need a live-data check
**before deploying** (not before building):

1. **Pre-deploy data check needed.** C1/M3 means *any* Edit Bill save — even one only changing a
   phone number — now recalculates and re-locks the bill's total, not just the qty>1 custom-item
   case the C1 entry originally named. Two legacy groups could restate on their next edit: bills
   the old rate migration touched (stamped with that day's rate), and custom bills locked before
   the per-gram-making fix (could move by thousands of rupees on a heavy piece). **Ask Cowork to
   run a read-only check across all sales — not just edited ones — before deploying**: any bill
   where the recomputed total disagrees with its stored `lockedGrand` by more than ₹1. If that
   hits a real bill in a paying shop, Tanish should decide before this goes live; it doesn't
   block having the zip built.
2. **A second, related live-data check.** The old (pre-batch48) Edit Bill pre-fill bug could have
   let someone move old-gold/advance money into a real `splitPayments` entry by saving an
   exchange-sale edit unchanged, doubling `sale.advance`. Cowork's first query didn't catch this
   shape. Exposure looks low (only `65a3ce29` has any exchange/advance sales at all), but worth
   one more query before trusting Day Book numbers on a shop that's actually traded.
3. Bill-level "extra making"/"extra diamond" charges (separate fields from per-item
   making/stone) are counted in the total but never printed on an invoice line — still open,
   not this batch's to fix (needs Tanish's input on whether real shops use those fields).
4. Removing a non-last split-payment row in Edit Bill can silently drop a later row's amount
   (index-gap bug) — still open, no regression test yet.
5. A refunded bill can still be edited, and `refundStatus` isn't recalculated — a rare edge
   case, noted for a future pass.
6. Products with a gross/net weight over 10,000g (H1's sanity cap) can't be saved through Edit
   Product until corrected — intentional, but flagging in case a real listing (unlikely) hits it.

## Before you deploy

Regression suite **374/374** on this exact tree; all 11 files syntax-clean; every `checks/`
script clean against the documented baseline, `backup-check`/`roundtrip` both pass. A final
whole-chain Opus review ran across every change since batch47 and found no interaction between
fixes that needed addressing before shipping. **Not covered by any of this**: nobody has clicked
through Edit Bill, Reports, or the New Sale number-box fix on a real phone this batch — DOM/
screen behavior for those is unverified. Run the two live-data checks above with Cowork before
deploying, and give the one shop affected by the Day Book correction (item 1 under M3 follow-up
above) a heads-up before they open Day Book on this build.
