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

> nobody

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
- **[uncertain — open since 30 Sep, resurfaced 3 Oct] Call the jeweller of shop `3720af09`** (a real
  shop, 0 saved bills; someone tried a bill 30 Sep and it didn't save). Raised 30 Sep, repeated 3 Oct,
  never tracked here before.
- **[not Tanish's decision, but open and untracked anywhere else] `jewelos-health` / `jewelos-client-queries`
  (Cowork's own account skills) write to the paused Office, and `jewelos-health`'s drift SQL still
  reads `nextInvNo`, stale since migration 005 changed the invoice-floor source.** Flagged by Cowork's
  3 Oct skills audit; explicitly out of scope for Claude Code to touch; Cowork/Tanish's to fix.

**Closed (don't re-ask):** Day Book receipt photos → skipped (needs Supabase Storage if it returns) ·
Demo mode → built, batch21 · renewal contact → `+91 72086 23428`, no UPI handle in code ·
owner-PIN test → built 27 Sep · e2e test shop → reset before a same-day re-run streak, no cleanup
logic in the app · login token (F1) → option B, 6 h life, PIN on reopen within 6 h · old-gold
deduction → jeweller decides · Memo Bill → no GST · (1 Oct) signup → "Start Your Shop →" ·
Aadhaar/PAN → not stored (purged on load) · offline billing → reserved numbers per phone (batch44).
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

## LOG (newest first)

### 2026-10-05 · Claude Code (Sonnet, 3 more Opus review passes) — M3 FOLLOW-UP: three more places where clearing a payment field in Edit Bill left stale money behind — one of them was quietly inflating Day Book cash-in for every exchange sale, not just edited ones

🔴 ledger logic (`js/10-daybook.js`) and financial-calc (`js/01-sync-core.js`), same discipline as the M3 entry below — each piece in this chain got its own Opus review before shipping (3 more passes, on top of M3's own 2).

**How this was found:** after M3 shipped, `jewelos-bug-pattern-reviewer`'s routine pass on it (not asked to go looking, just doing its normal job) flagged that the new "always rewrite oldGold/prevAdvance/nowPaying" fix, while correct, changes *which* wrong thing happens in one specific case — that finding kept leading to one more real, concrete bug each time it was pulled on. Three, in the end, all the same root cause in three places:

1. **`sale.oldGold`/`sale.prevAdvance`/`sale.nowPaying` only got rewritten in Edit Bill when the new value was `>0`.** Clearing "Old Gold Value" or "Advance already paid" to 0 correctly fixed `sale.advance`, but left these three objects stranded at their stale pre-edit values — invisible on the printed receipt (gated on `>0` there too) but read directly by `calcSaleTotals()`'s balance fallback whenever `sale.advance` itself is fully zeroed. Fixed: always rewrite all three, matching `buildSaleObj()`'s own creation-time convention (it always writes these objects, even at 0 — display is what gates on `>0`, not storage).
2. **`dbAutoLines()`'s (`js/10-daybook.js`) tier-3 fallback could post prevAdvance/old-gold money as a fresh "Sale" cash-in line** — exactly what the function's own header comment says must never happen ("deliberate exclusions because posting them double-counts a line posted elsewhere"). This wasn't only an Edit Bill problem: **it was already reachable from a plain, ordinary exchange sale at creation** — any sale fully covered by old gold and/or an advance, with nothing freshly paid, has always been eligible to hit this path. Opus's review: *"live Day Books have been over-stating cash for exchange sales"* going back to before today. Fixed by refusing to let tier 3 treat `sale.advance` as raw cash whenever `oldGold`/`prevAdvance` account for it.
3. **`openEditBill()`'s own payment-row pre-fill used the identical flawed logic** — opening Edit Bill on one of these sales pre-filled a payment row showing the old-gold/advance money as if it were a fresh payment; saving unchanged would have promoted it into `splitPayments`, a tier #2's fix can't see past. Extracted into its own testable function, `_editBillExistingSplits(sale)`, with the same guard: pre-fill ₹0, not the excluded money.

**4 new regression tests** (`tests/regression.test.js`, search "QA M3 follow-up"), each confirmed via `git stash` to fail against the pre-fix code with the exact predicted stale/phantom values — including one exercising the mixed case (prevAdvance kept, split row cleared) that's the actual trigger for #2 and #3.

**Verification:** `node --check` all 11 modules clean; regression 374/374 (was 366 before any M3 work today — +8 total across the whole chain); all `checks/` scripts clean, globals grew by exactly 2 legitimate functions (`_applyEditBillForm`, `_editBillExistingSplits`). Each piece got its own Opus pass before shipping (oldGold/prevAdvance/nowPaying design+implementation combined, the Day Book tier-3 guard, the Edit Bill pre-fill extraction), plus a final `jewelos-bug-pattern-reviewer` + `jewelos-test-runner` pass across the whole chain — confirmed no sixth place in the codebase has a third copy of this three-tier precedence (grepped the whole app), confirmed the extraction is byte-identical to the old inline logic for every case except the new guard (verified directly against commit `6552dfd`), confirmed no interaction with `saleOverpaidBy()` or `sale.extraPayments`' own separate posting logic.

**Not fixed, flagged for its own look:** `sale.payment` (the display-only mode label) is only updated `if(savedSplits.length>0)` — a sale that's cleared to a mixed prevAdvance-only state keeps a stale `payment` string. Doesn't affect any total or Day Book posting (confirmed — nothing money-relevant reads it), purely cosmetic, not touched here to keep this chain's scope to what's actually money-relevant.

**Not verified, said plainly:** the Edit Bill pre-fill fix (`_editBillExistingSplits`) could not be tested by actually opening the modal — the Node test harness has no real DOM/HTML parser, so a dynamically-generated, unregistered element's content is structurally invisible to it (confirmed: no existing test in this suite has ever called `openEditBill()` directly, for the same reason). The regression test instead calls the extracted pure function directly, which is a real, faithful test of the logic — but nobody has watched the Edit Bill screen actually render a ₹0 row on a real phone.

→ FOR COWORK: **Two things need live-data checking before/around deploy, from Opus's review, not checkable from here:**
1. **Finding #2 above means live Day Books may already be over-stated for closed days containing an exchange sale** (old gold and/or advance, nothing freshly paid). The first Day Book open after this deploys will have `dbSweepRestatements()` auto-post a "Correction to `<date>`" cash-out adjustment for every closed day that had one — correct, but will look like an unexplained correction to a shopkeeper unless they're told first. Please check live data for closed days with this shape and give pilot shops a heads-up before this ships.
2. **Whether the `sale.advance = splitAdv+prevAdv+og` identity holds for every live sale**, including ones from before this repo's git history (8 Sep) that might predate `nowPaying` existing at all — Opus's suggested one-query check: count sales where `splitPayments` is empty, `nowPaying.amount` is 0/missing, `prevAdvance`/`oldGold` is `>0`, AND `advance > prevAdvance.amount + oldGold.value`. A non-zero count means some of those sales have real, undifferentiated money this fix's new guard would now wrongly suppress from Day Book — needs a look before trusting #2's fix blindly on old data.
M2, M6, M9 and the L-series from the 3 Oct QA pass remain open and unassigned — same note as every other entry today: no access to the original `jewelos-qa/` report text.
→ FOR TANISH: Found and fixed three more small, related problems while working on the Edit Bill total fix below. The most important one: if a sale was paid entirely with old gold and/or an advance (no fresh cash), Day Book may have been slightly over-counting your cash-in for that sale — Cowork is checking your actual numbers and will give you a heads-up before this goes live, since fixing it will show up as a small "correction" entry on whichever day(s) it affected. Nothing else needs your decision right now.

---

### 2026-10-05 · Claude Code (Sonnet, Opus-designed and -reviewed twice) — M3 FIXED: the Edit Bill live preview can no longer disagree with what Save actually stores

🔴 financial-calculation risk per MODEL-POLICY — same class as C1 (a total shown to/saved for a jeweller using the wrong formula), so this went through Opus for the design BEFORE any code was written, then a second Opus pass on the implemented diff before shipping, same discipline as C1.

**The bug, confirmed by reading both formulas line by line, not guessing from the symptom:** the Edit Bill modal's live preview (`calcEditTotal()`, fires on every keystroke) was a second, independent reimplementation of the bill-total math, instead of reusing `calcSaleTotals()` — the one function `saveEditBill()` actually calls to compute what gets saved and printed. They disagreed in four confirmed ways: (1) no `qty` multiplication anywhere in the preview; (2) `item.making`'s real meaning differs by item type (a flat ₹ amount for a stock item, but a **per-gram rate** for a custom item, per `itemMakingAmount()`) — the preview just summed the raw typed value with zero weight multiplication regardless of type, and the input box was even labeled "Making (₹)" for both, mislabeling a rate as if it were a total; (3) bill-level "extra making"/"extra diamond" charges (set at sale creation, not per item) were added by the real formula but had no field in the Edit Bill modal and were silently dropped from the preview's running total; (4) the preview's balance ignored `extraPayments` — an append-only ledger of payments recorded *after* a bill's creation — so a bill with a later partial payment showed a stale, too-high balance while editing. **Measured, not estimated**: a concrete repro (20g custom item, ₹500/g making rate charged on gross weight, ₹3,000 paid after creation) showed the old preview displaying Grand Total ₹1,10,500 / Balance ₹1,05,500 while the real save produced ₹1,20,000 / ₹1,12,000 — a ₹9,500 gap from the making-rate bug and a further ₹3,000 gap from the ignored extra payment, both confirmed exactly via a regression test run against the unfixed code first.

**The fix (Opus-designed before implementation, approved with changes — "use one shared helper instead of a mirrored copy, so the two can't drift apart again"):** extracted a new shared function, `_applyEditBillForm(sale)`, from `saveEditBill()`'s old body. It applies the Edit Bill form's current field values onto whatever sale object it's handed, re-locks the grand total via the real `calcSaleTotals()` (the same two-pass round-then-recompute `saveEditBill()` already did), and returns the authoritative totals. `saveEditBill()` now calls it on the real sale (unchanged external behavior — confirmed line-by-line identical to the old body by the second Opus pass). `calcEditTotal()` now calls the *same* helper on a `JSON.parse(JSON.stringify(sale))` throwaway clone and renders the preview purely from its returned numbers — the second, divergent formula is gone entirely, so the preview literally cannot show a different number than what Save will store, by construction rather than by two people remembering to keep two formulas in sync.

**Two small fixes bundled in, same symptom family, found while implementing:** `eb-disc`/`eb-gst` (Discount and GST% inputs in Edit Bill) had **no `oninput` handler at all** — editing either one never refreshed the live preview until some unrelated field was touched. Added `oninput="calcEditTotal()"` to both. Also relabeled the per-item "Making" box to "Making (₹/g)" for a custom item (was "Making (₹)" for both types, mislabeling the rate).

**1 new regression test** (`tests/regression.test.js`, search "QA M3"): the exact repro above — a custom item with gross-weight making basis plus a post-creation extra payment — asserting the live preview *and* the actual saved `lockedGrand`/balance are identical (₹1,20,000 / ₹1,12,000). Confirmed by `git stash` to fail against the pre-fix code with the exact predicted wrong numbers.

**Verification:** `node --check` all 11 modules clean; regression 370/370 (was 369, +1); all `checks/` scripts clean, `globals.json` grew by exactly the 1 new function (`_applyEditBillForm`); `backup-check`/`roundtrip`/`making-basis` all clean. Two independent Opus passes: the design (redirected once — the original one-off "mirror saveEditBill" proposal was replaced with the shared-helper approach to prevent future drift) and the implemented diff (verdict: ship as-is, confirmed the extraction is behaviorally identical to the old `saveEditBill()` for every case not touching the preview, confirmed the two refusal paths — overpayment, GST-to-0% — still read the right post-mutation values, confirmed the draft clone can't leak into the real sale). `jewelos-bug-pattern-reviewer` and `jewelos-test-runner` both ran clean independently afterward per the standard `js/`-change routing.

**Two pre-existing gaps, NOT introduced by this diff, confirmed by the bug-pattern reviewer, now worth a closer look since they sit inside the one helper both the preview and Save share:**
1. **Removing a split-payment row that isn't the last one silently drops a later row's amount.** `addEditPayRow()`/`removeEditPayRow()` number rows sequentially (`ebsp-amt-0`, `ebsp-amt-1`, ...); the collection loop stops at the first missing index. Delete row 1 of 3 and row 2's amount is silently excluded from both the preview and the real save — both agree (satisfying M3's actual goal), but both are now silently wrong together. Pre-existing (the exact same loop was in the old `saveEditBill()` before this refactor), just newly visible as a shared-code finding. No regression test covers it.
2. **Zeroing "Old Gold Value" in Edit Bill doesn't clear `sale.oldGold.value` on the sale object**, only the computed total (`sale.advance`) — a receipt or export reading `sale.oldGold.value` directly, rather than through `calcSaleTotals()`, would still show the stale pre-edit figure. Same shape as a pre-existing asymmetric-reset the code already comments on for `prevAdvance`.

**Not verified, said plainly:** nobody has clicked through the Edit Bill modal on a real screen this session — only the logic (both Opus passes, the regression harness) was exercised. Edit Bill isn't in the `tests/e2e/` covered-spec list.

→ FOR COWORK: M3 is fixed, tested, and pushed. The two pre-existing gaps above (split-row index collision, stale `oldGold.value`) are worth their own ticket — small, contained, not urgent, but now living in money-calculation code both the preview and Save depend on. M2, M6, M9 and the L-series from the 3 Oct QA pass remain open and unassigned — same note as M4/M7's entries: no access to the original `jewelos-qa/` report text for those.
→ FOR TANISH: While editing a bill, the numbers you watch update (Grand Total, Balance) used to sometimes disagree with what actually got saved once you hit "Save Changes" — worst case was a custom item's making charge, where the live total could undercount by thousands of rupees until you saved. Now what you see while editing is guaranteed to match what gets saved, because it's the same calculation running both times instead of two separate ones that could drift apart. Also fixed: changing Discount or GST% in Edit Bill now actually updates the total live (it silently didn't before). Nothing needs your decision on this one.

---

### 2026-10-05 · Claude Code (Sonnet) — M7 FIXED: the Reports page no longer scrolls sideways at phone width

🟢 pure CSS, no money-calculation or app logic touched — no Opus needed per MODEL-POLICY §8.

**The bug, confirmed with a real Playwright measurement, not just reading the CSS:** the Reports page's `.two-col` grid (holds "Top products" and "By category" side by side) is a CSS Grid with bare `1fr` tracks. A CSS Grid item's *automatic minimum size* defaults to its content's min-content width — it won't shrink below that no matter how narrow the track wants to be. Both of those cards contain a `<table>`, and tables don't wrap their cell content by default — worse, `index.html:499` has a **global rule applied to every table in the app**, `table{min-width:520px}`, so this isn't data-dependent, it's deterministic for any table in this situation. The existing `.tbl-wrap{overflow-x:auto}` around each table didn't help, because it sits one level *inside* `.card` — the actual grid item — and `.card` itself has no overflow restriction, so the 520px table forced `.card`'s min-content to 520px, which forced the `.two-col` track to grow past its 1fr share, which forced the whole page to grow to accommodate it. **Measured directly**: built a standalone page using the exact live `<style>` block and Reports markup, at a 390px viewport — `document.documentElement.scrollWidth` was 555 (real page-level horizontal scroll, confirmed `pageHorizontalScroll: true`), not just a "looks cramped" complaint.

**The fix** (`index.html`, one rule): `minmax(0,1fr)` in place of `1fr` on both of `.two-col`'s track definitions (mobile single-column and the `min-width:600px` two-column version). This is the standard fix for exactly this CSS Grid behavior — it caps a track's *automatic* minimum at 0 instead of its content's min-content, so the track can actually shrink to its fair share, and the table's own `.tbl-wrap{overflow-x:auto}` then does its job (the table scrolls *inside its card*, same pattern as every other table in the app) instead of the whole page blowing out.

**Confirmed scope, not just asserted:** `.two-col` is used 5 times — the 2 in Reports (the ones with tables, now fixed) and 3 in the Dashboard (Gold/Silver by Purity, Pending Balances/Orders Due, Top Categories) which hold plain wrapping divs/lists, never a table — `minmax(0,1fr)` only lowers the *floor*, it doesn't change how a track grows to fit available space, so there's no behavior change for those 3. Traced every `<table>` in the codebase (12 of them): all the others sit in normal block flow inside a plain `.card` (not a grid/flex item), where `.tbl-wrap{overflow-x:auto}` already worked correctly before this fix — `.two-col` was the only grid container in the app holding a table. One unrelated, pre-existing instance of the same *shape* (table directly inside a bare-`1fr` flex track) exists in the Day Book print-popup (`10-daybook.js:1299`), but that opens as its own unconstrained browser window, so there's no viewport to blow out — not a live bug, just noted for if that's ever made responsive. Also confirmed `.metrics`/`.metric` (the stat-card row above, which can show 8-digit rupee figures) was never at risk here — `.metric` already has `overflow:hidden`, which per the CSS Grid spec already forces its automatic minimum size to 0 independent of this fix; tested directly with an 8-digit revenue figure and confirmed no overflow, with or without the fix.

**Verification:** regression suite 369/369 (unchanged — this touches zero JS); all `checks/` AST scripts clean, same baseline as before. **No regression test added** — this is pure CSS layout and the Node test harness has no real browser/CSS engine (it uses stub DOM elements with no layout), so a "test" there would be decorative, not a real check; said plainly rather than invented. In its place: a real Playwright measurement (ad-hoc, per `verify-ui.md`, not a persisted spec) against the exact live CSS and markup — before the fix, page `scrollWidth` 555px at a 390px viewport (confirmed overflowing); after, 375px, with all 3 Reports tables (Top products, By category, 9-column Sales History) correctly scrolling within their own card instead. Screenshot taken and visually confirmed. `jewelos-bug-pattern-reviewer` independently traced every table and grid/flex container in the app, confirmed the fix's scope claim directly against the source (not just agreeing with the write-up), found none of the five recurring bug families apply, and surfaced the global `table{min-width:520px}` rule as the reason this bug is deterministic rather than data-dependent — worth remembering if a table is ever dropped into a new bare-`1fr` container.

**Not verified, said plainly:** this hasn't been seen on a real phone yet — the Playwright repro uses the real CSS and markup but synthetic data, and it's a standalone page, not the live app with its JS rendering pipeline. Reports isn't in the `tests/e2e/` covered-spec list, so the persisted suite doesn't exercise this either.

→ FOR COWORK: M7 is fixed, tested, and pushed. M2, M6, M9 and the L-series from the 3 Oct QA pass are still open and unassigned — same note as M4's entry: Claude Code has no access to the original `jewelos-qa/` report text for those (it's outside this repo), so whoever picks them up next needs the actual descriptions restated here, not just the bug IDs.
→ FOR TANISH: Fixed a layout bug: on a narrow phone screen, the Reports page used to let you scroll the *whole page* sideways because two of its tables were too wide for the screen. Now only those specific tables scroll sideways (by design, same as everywhere else in the app), and the rest of the page stays put. Nothing needs your decision on this one.

---

### 2026-10-05 · Claude Code (Sonnet) — M4 FIXED: the "0" pre-filled in sale-form number boxes no longer forces an extra keystroke

🟢 pure UI, no money-calculation formula touched — no Opus needed per MODEL-POLICY §8.

**The bug:** 5 inputs in the New Sale form (`s-making`, `s-diamond`, `s-gst`, `s-disc`, `s-prev-advance`) ship with the literal `value="0"`, not a placeholder. Tapping into any of them puts the cursor inside the existing "0" character, so typing e.g. "5" produced "05" — the jeweller then had to notice and delete the leading zero themselves. Confirmed by grep: these 5 are the only visible inputs in the whole app with a real `value="0"` (everywhere else uses `placeholder="0"`, which is a ghost hint that doesn't need deleting).

**The fix:** two small shared helpers in `js/02-ui-inactivity-modals.js`, right before `updateSum()` (which all 5 fields already call on every keystroke):
```js
function zeroFieldFocus(el){ if(el.value==='0') el.value=''; }
function zeroFieldBlur(el){ if(el.value==='') el.value='0'; }
```
Wired via `onfocus="zeroFieldFocus(this)" onblur="zeroFieldBlur(this)"` on all 5 inputs in `index.html`. Tapping in clears a literal "0" so the first digit typed replaces it instead of appending; tabbing away without typing anything restores "0" so every existing reader (`parseFloat(el.value)||0`, confirmed at the 6 call sites that read these fields) never sees an empty string. A field that already has a real value (e.g. GST already set to 3) is left untouched on focus — only a literal "0" is cleared.

**Confirmed safe against the two places that set these fields programmatically, not just by user tap:** `04-orders-detail.js:375/377` (order→sale conversion sets `s-making`/`s-prev-advance` directly) and `02-ui-inactivity-modals.js`'s own form-reset (`clearSale()`, resets all 5 to `'0'`) — both are plain `.value=` assignments, which don't dispatch a `focus`/`blur`/`input` event, so the new handlers never fire from them and there's no interaction. Also confirmed setting `.value` via JS doesn't fire `oninput` either, so there's no momentary flash of wrong totals between the field clearing on focus and the user's first keystroke.

**3 new regression tests** (`tests/regression.test.js`, search "QA M4"): focus clears a literal "0", blur-with-nothing-typed restores "0" (so `parseFloat` never sees `""`), and focus leaves a real value (not "0") untouched. All 3 confirmed to fail against the pre-fix code (`app.zeroFieldFocus is not a function`).

**Verification:** `node --check` all 11 modules clean; regression 369/369 (was 366, +3 new); all `checks/` scripts clean against the same documented false positives as baseline (`handlers.js`, `ids.js`, `scope.js` etc. — nothing new introduced); `backup-check`/`roundtrip` both clean; `scope.js`'s globals baseline (`checks/globals.json`) correctly ticked up by exactly the 2 new top-level functions. `jewelos-bug-pattern-reviewer` ran clean against the five bug families and independently confirmed the "already safe because every reader uses `||0`" claim and the no-event-on-programmatic-`.value=` claim against the real source. `jewelos-test-runner` independently reproduced all counts, and also ran `tests/edge-functions.test.js` (26/26) and `tests/cowork-live-check.js` — the latter fails, but confirmed by stashing this diff and re-running against unmodified `main` that the failure is pre-existing (unrelated to this change; already documented in `tests/README.md` from the 3 Oct session, not wired into `check.bat`).

**Not verified, said plainly:** nobody has actually tapped these 5 fields on a real screen this session — only the logic (the two functions in isolation, and the regression harness's fake DOM) was exercised. New Sale isn't in the e2e-covered spec list, so `tests/e2e/` doesn't cover this either. If you want this clicked through on a real phone before trusting it, that's a `verify-ui`/Playwright pass still owed.

→ FOR COWORK: M4 is fixed, tested, and pushed. M2, M6, M9 and the whole L-series from the 3 Oct QA pass are still open and unassigned — Claude Code has no access to the original `jewelos-qa/` report text for those (it's outside this repo), so whoever picks them up next needs the actual descriptions restated here or in a fresh hand-back, not just the bug IDs.
→ FOR TANISH: Fixed a small annoyance: the Extra Making, Extra Diamond, GST%, Discount, and Advance Paid boxes on the New Sale screen used to show "0" and make you delete it before typing your real number. Now tapping in clears it so you can just type. Nothing needs your decision on this one.

---

### 2026-10-04 · Claude Code (Sonnet, Opus-reviewed) — M5 FIXED: a discounted bill's printed line items now agree with its own footer

(risk) this changes a figure printed on an actual Tax Invoice, so per MODEL-POLICY's "risk beats size" it went through Opus review before shipping even though the diff is ~13 lines, same discipline as C1/C2/H2.

**The bug, confirmed exactly against QA's repro numbers:** buildInvoiceHTML() (02-ui-inactivity-modals.js) computed each line item's own GST and Amount columns from that line's undiscounted taxable value, while the invoice's own footer (Grand Total, CGST/SGST breakdown) correctly used calcSaleTotals()'s discount-adjusted t.taxable. On any bill with both a discount and GST, the two disagreed. QA's exact numbers reproduce it precisely: subtotal Rs 1,05,250, discount Rs 1,000, 3% GST -> pre-discount line GST = 1,05,250x3% = Rs 3,157.50 ~= Rs 3,158 (the line); post-discount footer GST = (1,05,250-1,000)x3% = Rs 3,127.50 ~= Rs 3,128 (the footer) -- exactly QA's reported figures, and the Rs 30 gap is exactly 3% of the Rs 1,000 discount.

**The fix:** one discFactor = t.taxable/t.sub (1 when there's no discount, so this is a no-op on the vast majority of bills), applied to each line's taxable amount before computing that line's GST/Amount -- reusing the exact same ratio calcSaleGSTBreakdown() already uses for the footer's own HSN rows (Opus confirmed this isn't a second, divergent implementation of the idea). Deliberately left the Rate/Making/Stone columns reading the raw per-item values, untouched -- those still match the footer's own undiscounted "Gold Value"/"Making"/"Stone" rows; only the derived GST and Amount columns change to agree with what's actually charged.

**Opus confirmed this is the legally correct direction, not just internally consistent:** CGST Act s.15(3)(a) and Rule 46 require GST to be charged on the value net of a discount recorded at the time of sale -- the old pre-discount per-line GST was the non-compliant figure, not the fix. Also confirmed: a bill has exactly one GST rate for all metal/making/stone (calcSaleGSTBreakdown's own comment says per-part rates were deliberately removed), so applying one uniform discFactor across every line is safe -- there's no mixed-rate scenario anywhere in this codebase that would make that wrong.

**Correction to my own claim, caught by Opus -- recording honestly:** I initially said the prorated line amounts "sum to t.taxable exactly." That's only true when a sale's bill-level making/diamond fields (separate from any per-item making/stone) are zero -- calcSaleTotals folds those into t.sub (hence t.taxable), but no line item includes them, so a bill that actually uses those two fields has never had its line items sum to the footer, before or after this fix. This is a separate, pre-existing gap (not introduced here, not fixed here) -- see below.

**1 new regression test** (tests/regression.test.js, search "QA 3 Oct M5"): a single-item, Rs 1,000-discount, 3% GST bill, asserting the printed line shows the corrected 2970/101970 and NOT the old pre-discount 3000/103000. Confirmed to fail against the unmodified code. Opus confirmed a single-item case is sufficient -- a multi-item case would only exercise ordinary whole-rupee print rounding (+/-Rs 1-class, already an accepted tolerance elsewhere in this codebase), not a real defect, so not worth adding.

**Verification:** node --check all 11 modules clean; regression 366/366 (was 365, +1 new); all checks/ scripts clean, same baseline, globals count unchanged. jewelos-bug-pattern-reviewer ran clean against the five families, independently hand-traced the same numbers, and confirmed (by grepping for taxableAmt/gstItem/discFactor across all of js/) there's no second, unpatched copy of the old pre-discount math anywhere else. jewelos-test-runner independently reproduced all counts.

**Flagged, not fixed -- two pre-existing issues Opus found while reviewing, neither introduced or worsened by this change:**
- **Bill-level making/diamond fields (separate from per-item making/stone, set via the sale form's s-making/s-diamond boxes) are counted in calcSaleTotals's t.sub but never appear on any printed line.** A bill that uses these two fields has never had its line items sum to the Grand Total -- a different, narrower version of the same "lines don't sum to the footer" family of bug M5 was about, still open. Needs its own investigation (does this field see real use? how should it print per-line vs. as its own row?) before touching it.
- **lockedGrand drift.** The footer's Grand Total is t.grand, which uses sale.lockedGrand when set -- if that stored figure ever diverges from a fresh recalculation (the exact class of bug C1 fixed for the edit path specifically), the line items and the footer would disagree regardless of this fix. Not a new risk from this change.

-> FOR COWORK: M5 is fixed, tested, and pushed. Flagging the bill-level making/diamond field gap above as a real, separate follow-up -- worth checking with Tanish whether those two form fields are actually used by real shops before deciding how to fix it.
-> FOR TANISH: A printed GST bill with both a discount and tax now shows the same GST figure on each line as it does in the total at the bottom -- before, the line level showed a slightly higher number (the tax without your discount applied), which is both confusing and not what GST rules actually require. Nothing needs your decision on this one.

---

### 2026-10-04 · Claude Code (Sonnet) — M8 FIXED: Category Intelligence now matches the Reports page's selected month; "Cash In" relabeled where it collided with Day Book's different metric of the same name

🟢/🟡 (a date-window bug in a display function, plus a text relabel — no money-calculation formula changed, no Opus needed).

**QA's M8 was actually two separate things, confirmed by reading the code:**

1. **Real bug — `calcCategoryPerf()` ignored the Reports page's selected month.** It always used `new Date()` (today's real date) to decide "this month," never the `repYear`/`repMonth` the rest of the SAME Reports render already uses (`filterSalesByMonth`, `calcMonthProfit`). Viewing any month other than the real current one showed Category Intelligence's revenue/profit from a completely different time period than the rest of the page — explaining QA's "profit ₹5,250 vs P&L gross profit ₹9,251" (not a math disagreement, a *different months* disagreement). **A second bug in the same function made it worse than it looked**: the "this month" window had a start but no end (`d >= thisMonthStart`, nothing upper-bounding it) — so it wasn't really "this month," it was "this month onward forever." Harmless today only because no sale is ever future-dated; fixing bug 1 alone (pointing it at a past `repMonth`) would have made this *worse* for past months, since a past month's window would then also silently absorb every sale between it and today. Fixed both together: `calcCategoryPerf(year, month)` now takes optional args (defaulting to real-now when omitted, so the dashboard's own call — which legitimately always wants "right now" — is untouched), with both the "this month" and "last month" windows properly closed on both ends.

2. **Not a bug — "Cash In" meant two different, both-correct things.** Reports' "Cash In" (`calcCashFlow().cashIn`) sums payments across every mode (cash, UPI, card); Day Book's "Cash In" is deliberately cash-only (it's a physical cash-drawer rojmel, extensively tested that way — "a UPI-only sale contributes nothing to cash in"). Confirmed both are internally correct for what they're meant to track; the only problem is the shared label. Relabeled the two on-screen widgets where this collision is most visible — Reports' metric card (now "Total Collected", with an explicit note that it isn't Day Book's cash-only figure) and the Dashboard's "Cash Flow — This Month" card (now "Total Collected (all modes)"). Left the WhatsApp-style text digest's compact "Cash In" line alone — lower visual-comparison risk, not what QA was looking at side-by-side.

**3 new regression tests** (`tests/regression.test.js`, search "QA 3 Oct M8"): a past month's figures don't also absorb every later sale (the critical missing-upper-bound case), a middle month doesn't bleed into the next, and the no-argument call (dashboard) still defaults to the real current month. Both bug-catching tests confirmed to fail against the unmodified code — both returned the real-current-month figure regardless of which month was actually requested.

**Verification:** `node --check` all 11 modules clean; regression 365/365 (was 362, +3 new); all `checks/` scripts clean, same baseline, globals count unchanged (no new top-level functions). `jewelos-bug-pattern-reviewer` confirmed the dashboard's call site was correctly left unchanged, the date-window math is correct including December→January rollover (JS's native month-overflow normalization handles it, no hand-rolled year adjustment needed or added), and the repYear/repMonth indexing is consistent with every other Reports figure on the same page. `jewelos-test-runner` independently reproduced all counts.

**Not re-reviewed:** the two label-text changes (item 2 above) were applied after both review passes — purely cosmetic string edits with zero logic touched, so not re-sent for review, consistent with "skip agents for trivial edits." Re-ran the full regression suite and `checks/` sweep after adding them; both clean.

**Not verified, said plainly:** whether Category Intelligence actually renders the right month's data on an actual screen for a past month — logic-only coverage; Reports isn't in the e2e-covered areas.

→ FOR COWORK: M8 is fixed, tested, and pushed. This wasn't explicitly assigned by the 3 Oct hand-back (only C1/C2/H1/H2/H4 were) — picked up as the next logical item from the same QA pass's Medium list. M2–M9 (except M1, already fixed) and the L-series remain open and unassigned.
→ FOR TANISH: The Reports page's "Category Intelligence" table now shows the month you're actually viewing, not always today's. Also relabeled "Cash In" to "Total Collected" on the Reports page and Dashboard, since it was a different number from Day Book's "Cash In" (which is cash-only on purpose) — same two numbers as before, just clearer which is which. Nothing needs your decision on this one.

---

### 2026-10-04 · Claude Code (Sonnet) — H4 FIXED: a central audit trail now covers bill edit, new sale, bill delete, product delete, orders, and rate changes

🟢/🟡 instrumentation (pure logging, no money-calculation or ledger logic touched — no Opus needed).

**What QA found, confirmed by reading the code:** `auditLog()` (`01-sync-core.js`) already existed and was already wired into refund/Girvi/Day Book actions, but these 7 real money-adjacent actions had zero audit entries anywhere: `recordSale` (new sale), `saveEditBill` (bill edit), `deleteSale` (bill delete), `delProd` (product delete), `saveOrder` (new order), `cancelOrder` (order cancel), `saveRates` (rate change). Confirmed by grepping each function's full body for any `auditLog`/`saasActivityLog` call — none found in any of the 7, consistent with QA's "likely" (they read live state, didn't check every source function; this reading confirms it directly). Also confirmed there are genuinely **two separate, parallel logs** in this codebase — `S.auditLog` (structured action/entity/entityId/note, rendered by `renderAuditLog()`) and `S.activityLog` (simpler type/note, rendered by the grouped-by-user `renderActivityLogGrouped()`) — QA's "2 entries (sign-in, Day Book opening)" straddles both screens; not a bug, just two different views that already existed.

**The fix:** one `auditLog(...)` call added at the point of each action's in-memory mutation (before the `saveToCloud`/`_orderCommit` call, matching the exact placement convention already used for refund/Girvi), in each of the 7 functions. For the 4 that already had an established rollback-on-failed-save mechanism (`recordSale`, `delProd`, `saveOrder`/`cancelOrder` via `_orderCommit`), added the same snapshot-before/restore-on-failure pattern Girvi's archive already uses (`_auditSnap=(S.auditLog||[]).slice()` before the call, `S.auditLog=_auditSnap` in the real failure branch) — verified this isn't just copy-pasted but actually wired into each function's real failure path. For the 3 that have **no** existing rollback-on-async-failure at all (`saveEditBill`, `saveRates`, `deleteSale` — all three silently no-op past a `saveToCloud` error already, pre-existing, not something this batch touches), deliberately did **not** add audit-only rollback — that would invent a new asymmetry (log entry rolls back, nothing else does) rather than matching anything that exists. Flagged, not fixed: those 3 functions' total lack of failure handling is a separate, larger issue than "add logging."

**11 regression tests** (`tests/regression.test.js`, search "QA 3 Oct H4"): one "is logged" test per action (all 7 confirmed to fail against the unmodified code — no entry appears at all), plus a "failed save leaves no audit line" test for each of the 4 with rollback.

**Verification:** `node --check` all 11 modules clean; regression 362/362 (was 351, +11 new); `edge-functions.test.js` 26/26; all `checks/` scripts clean, same baseline (globals count unchanged at 759 — correctly, since this diff adds zero new top-level functions, only calls to an existing one). `jewelos-bug-pattern-reviewer` ran clean against the five bug families, and specifically confirmed the XSS angle: the new `note` strings now carry customer/product names that didn't flow into the audit log before, but `renderAuditLog()` already runs every field through `escHtml()` (cell text and the `title` attribute) — no new stored-XSS sink. `jewelos-test-runner` independently reproduced all counts.

**One pre-existing wrinkle, flagged by the bug-pattern reviewer, not introduced by this batch:** `_commitSaleTransaction`'s outer `try/catch` only resets state if `_commitSaleTransactionNow` throws *synchronously* — it doesn't restore `S.auditLog` on that path, same gap the stock snapshot and order-link restore already have there. The async `saveToCloud`-failure path (the realistic failure mode, and what's actually tested) is fully covered. Consistency with an existing imperfection, not a new one.

**Not verified, said plainly:** whether these new audit entries actually render correctly on the Audit Log screen on a real device — logic-only coverage, no `verify-ui`/Playwright pass this batch (Audit Log isn't in the e2e-covered areas, and this change touches no DOM/rendering code).

→ FOR COWORK: H4 is fixed, tested, and pushed. This was the last item explicitly named in the 3 Oct QA pass across all four severities Cowork's hand-back tracked (C1, C2, H1, H2, H4) — what's left from that QA run is lower-priority (M-series, L-series) and wasn't explicitly assigned. The two parallel-log-systems observation above (`S.auditLog` vs `S.activityLog`) might be worth a consolidation someday, but that's a design question for Tanish, not something I decided to touch.
→ FOR TANISH: Bill edits, new sales, bill deletes, product deletes, new/cancelled orders, and rate changes now all show up in the Audit Log screen (Settings). Nothing needs your decision on this one.

---

### 2026-10-04 · Claude Code (Sonnet, Opus-designed and -reviewed) — H2 FIXED: Reports now reflect refunds in Revenue, Profit, GST and Net Cash

🔴 financial-reporting risk per MODEL-POLICY — the GST figure this touches is what a jeweller would actually use for a GSTR-1 filing, so Opus designed the fix and reviewed the implemented diff before it shipped (two rounds: design, then a redirect on the diff with 3 required fixes), same discipline as C1/C2.

**What QA reported vs. the real scope:** QA's H2 said Revenue/Profit/GST Collected/Net Cash on the Reports page didn't move after a refund. Confirmed by reading the code: `sale.refunds[]` (pushed by `_submitRefund`) was read ONLY by the refund modal itself and by Day Book (`10-daybook.js`, already correct — Day Book posts a refund as cash-out on its own date). **Nothing in Reports ever looked at it.** Grepping every caller of `calcSaleTotals(x).grand`/`calcSaleProfit(x)` found the blast radius is wider than QA's four named figures: dashboard today/this-week revenue, and three separate per-customer lifetime-spend totals, all share the identical blindness — same root cause, just not things QA happened to sample.

**The fix (Opus-designed):** a new `calcRefundAdj(sale, from, to)` in `js/01-sync-core.js` nets out refunds dated in a window (or every refund ever, if no window given) — working the GST portion back out of a refund amount via `amount*gst/(100+gst)` (a refund is GST-inclusive), and reversing a returned item's cost only if that item actually came back (tracked by a new `items:[...]` field `_submitRefund` now stamps onto each refund entry). `calcMonthProfit`/`calcAllTimeProfit`/`calcCashFlow` now apply this across **every** sale, not just ones made in the window being reported — a refund belongs to the month it was *paid*, same rule Day Book already follows for its own cash-out line, not the month of the original sale (confirmed: a Sept sale refunded in October now correctly shows negative Revenue for October, not a silent no-op in September). The three per-customer lifetime totals (`03-billing-numbers.js:514`, `05-auth-login.js:1653`, `07-settings-plans.js:64`) were also updated to subtract `calcRefundAdj(x).amount` — these were in Opus's original scope but got missed in the first implementation pass; caught in the Opus diff review, not by me.

**Reports now shows, plainly:** the Revenue card's sub-line appends "− ₹X refunds" on a month with any (so a refund-only month showing negative revenue doesn't read as a bug); the GST Collected card shows "Net of ₹X GST on refunds. Not in the GSTR-1 export — issue credit notes separately." when relevant.

**Opus's review of my implemented diff caught a real test-quality bug, same pattern as C1/C2's reviews:** my first version of the "mixing an old legacy refund with a new item-tagged refund" test had the new-format refund's `items:[]` empty, so the code path that stops a legacy refund's fallback from double-claiming an already-tagged item was never exercised — the test would have passed even with that protection deleted. Fixed by making the new refund actually tag the item (`items:[0]`); verified by temporarily removing the protection and confirming the corrected test fails with exactly the predicted double-count (cost fell by 180000 instead of 90000), then restored.

**10 regression tests** (`tests/regression.test.js`, search "QA 3 Oct H2"): full refund with/without item return (the with-return case nets to exactly zero profit, checked by hand), partial refund, cross-month refund, `calcCashFlow` window in/out, `calcAllTimeProfit` date-independence, legacy (pre-fix) refund with no `items[]`, the corrected mixed-legacy-and-new case, a zero-GST Memo Bill (sanity check, true either way), and QA's own repro number (₹1,06,348). All 9 bug-catching ones confirmed to fail against the unmodified code first; restored, 351/351.

**Verification:** `node --check` all 11 modules clean; regression 351/351 (was 341 after H1, +10 new); all `checks/` scripts clean, same baseline false positives (scope.js globals 757→759, the two new helper functions). `jewelos-bug-pattern-reviewer` ran clean against the five bug families — its one non-blocking FYI is in "Deliberately deferred" below. `jewelos-test-runner` independently reproduced all counts and re-confirmed (via stash/restore) that `cowork-live-check.js`'s pre-existing failure is unrelated.

**Deliberately deferred — in scope conceptually, explicitly NOT fixed this batch (Opus's scope call):**
- Dashboard today/this-week revenue tiles (`06-inventory-stock.js` lines 80/87/223-224/1263, `05-auth-login.js` lines 1575-1576), the month-by-customer table (`03-billing-numbers.js:1244`, will now disagree with the fixed top-line Reports figure on the same page), the recent-sales list (`06-inventory-stock.js:343`) — these count sales made in a time window and would each need their own refund-dated loop, not a one-line change. The invoice CSV export and the GSTR-1 export deliberately stay gross — an invoice listing must show what was actually issued.
- A legacy sale with **two or more** old-format refunds (no `items[]`) that each returned a different item gets all of that cost reversed on `refunds[0]`'s date, not split across the real dates — the all-time total is still exactly right, only which *month's* P&L absorbs it could be off, for old data only. Flagged by the bug-pattern reviewer, confirmed acceptable by Opus, not fixed — rare, and a correct fix needs per-refund item data this old data never recorded.
- A separate, pre-existing issue unrelated to this fix, found by Opus during review: `calcCashFlow(fromDate,...)` reads `fromDate` as UTC midnight, which is 05:30 IST — a sale or refund made between 00:00–05:30 IST on the 1st of a month falls into the *previous* month's Net Cash, while Day Book correctly uses the IST calendar day for the same event. Pre-dates this batch, affects sales too, not just refunds — separate ticket.
- Three known, pre-existing issues NOT from this batch, named by Opus for the follow-up list: the refund limit is the invoice total rather than the amount actually collected (a credit sale can be "refunded" for more than was ever paid); refunding a sale never cancels its remaining unpaid balance; the app issues no credit-note document/number at all, so the in-app GST figure being net of refunds is only legally correct once a real credit note is filed in GSTR-1 for the month it's issued — **Tanish should confirm this whole approach with a CA before telling any customer the in-app number is their GST liability.**

**Not verified, said plainly:** `_submitRefund` actually saving the new `items` field when a real refund is submitted through the UI (needs the page; `tests/e2e/` has no refund spec) — covered by logic tests only. Nobody has looked at the Reports cards (including the two new wording lines) on an actual screen.

→ FOR COWORK: H2 is fixed, tested, and pushed. Please get the GST/credit-note approach in front of Tanish's CA before this becomes something he tells a customer. The deferred dashboard/CLV tiles and the UTC-vs-IST `calcCashFlow` boundary issue above are both real, both untouched — pick either up as its own batch if you want them closed. This was the last of the four items (C1, C2, H1, H2) from the 3 Oct QA pass that Cowork's hand-back named explicitly.
→ FOR TANISH: Reports now correctly show lower Revenue/Profit/GST/Net Cash for any month that had a refund in it — if you'd already looked at a month's numbers before today, re-check them. Three things flagged for later, not blocking: (1) talk to your CA about credit notes — the app doesn't issue one yet, so the in-app GST number isn't automatically what you can file; (2) a refund can currently be issued for more than a customer actually paid on a credit sale; (3) refunding a sale doesn't clear its "balance due" — both are old, separate issues, not from today.

---

### 2026-10-03 · Claude Code (Sonnet) — H1 + M1 FIXED: negative and absurd gross/net weight are now refused on Add and Edit Product

🟢/🟡 input validation (not a financial calculation, no Opus needed) — a pure sanity-check gap matching an already-established pattern elsewhere in the codebase (purchase bill weight fields already correctly reject negative; this was the two places that didn't).

**Root cause:** `addProduct()` (02-ui-inactivity-modals.js) and `saveEditProd()` (03-billing-numbers.js) both only checked `if(!wt){toast('Enter weight');return;}` — `!wt` is only true for exactly `0`/`NaN`; `!(-5)` is `false` in JS, so a negative gross weight sailed straight through on both Add and Edit. Net weight had the same shape of gap: `if(netwt>0 && netwt>wt){...}` never even looks at a negative `netwt`, since `netwt>0` is already false. Matches QA's repro exactly (-5g gross AND net both saved) and M1 (99,999,999,999g accepted — same `!wt` gap, no upper bound either).

**Fix, one place, both callers:** `productExtrasProblem(grossWt, stoneWt, wastagePct)` (01-sync-core.js) is already called by both `addProduct()` and `saveEditProd()` right after they read the weight — extended it to reject `grossWt < 0` and `grossWt > 10000` (a generous per-piece ceiling; input-typo guard, not a business rule, flag if a real jeweller ever needs more). Added an explicit `netwt < 0` check at each of the two call sites directly (net>gross was already call-site-local, not centralized, so kept that convention rather than changing the shared function's signature).

**Checked and deliberately left alone:** purchase bill item weight (`pb-f-grosswt`/`pb-f-netwt`) already correctly checks `< 0` — not part of this bug. Girvi collateral items and custom sale-form items already silently *filter out* non-positive weight entries at save time (`grossWt>0` filter) rather than accepting a negative value — different code shape, not the "accepted and saved" failure QA found, so not touched. M4 ("0"-prefilled numeric inputs causing digit-prefix typos) is a separate UI/UX issue, different root cause — not fixed here, still open.

**8 new regression tests** (search "QA 3 Oct H1" / "QA 3 Oct M1" in `tests/regression.test.js`): a `productExtrasProblem` unit test, 4 end-to-end `addProduct()` tests (negative gross+net, absurd, negative-net-alone, and a baseline confirming normal weights still save), 3 end-to-end `saveEditProd()` tests (same three failure shapes). **Caught my own test bug while verifying against the unmodified code**: the first version of the "saveEditProd negative gross weight" test passed even without the fix — not because the fix was redundant, but because a positive leftover net-weight value trivially satisfied the unrelated "net > gross" comparison when gross went negative, masking the real check. Fixed by setting net weight to 0 in that test so the fix under test is the only thing that can block the save. All 7 bug-reproducing tests then confirmed to fail against the unmodified code, and the baseline confirmed to still pass; restored, 341/341 clean.

**Verification:** `node --check` all 11 modules clean; regression 341/341 (was 333 after C2, +8 new); all `checks/` scripts clean, same baseline false positives. No e2e run — Add/Edit Product isn't in the 10-spec e2e coverage list, and this is a pure logic change (no DOM/rendering touched).

→ FOR COWORK: H1 and M1 are fixed, tested, and pushed. H2 (refunds not reflected in Reports/GST/Net Cash) from the same QA pass is next and still unstarted.
→ FOR TANISH: Two small QA findings fixed — the app no longer accepts a negative or absurdly large weight when adding or editing a stock item. Nothing needs your decision on this one. M4 (the "0" pre-fill in number boxes making you type an extra digit) is still open if you want it picked up separately — it's a different, smaller fix.

---

### 2026-10-03 · Claude Code (Sonnet, Opus-designed and -reviewed) — C2 FIXED: an unsynced save held for re-auth no longer gets silently clobbered by the next load

Cowork's hand-back on C2 said "try to reproduce it, report what actually happens" — not confirmed, Cowork's own code-read said the QA-reported *mechanism* (toast firing before a resend lands) couldn't be real. I confirmed that read is right, then found the real mechanism and fixed it. 🔴 data-integrity risk per MODEL-POLICY — this is the core save path, so it went through two full Opus review rounds (design, then a redirect on the implemented diff) before shipping, same discipline as C1.

**What QA actually hit vs. what's real:** `saveRates()`'s "saved & synced" toast genuinely cannot fire before a held save resolves — `saveToCloud()`'s 401 handler holds the caller's callback via `saasRequireReauth`, it isn't called early. The real bug: `loadFromCloud()` unconditionally overwrote `S.rates` (and every other field) from the server with **zero check for an unsynced local change**. The reauth-hold state (`_reauthPending`/`_reauthWaiters`) lives only in memory — if the jeweller reloaded instead of typing the password into the in-place prompt, that state vanished, and the next load silently replaced the pending local edit with the server's stale value. **Reproduced directly**: set `S.rates.sil=160` locally, called the real `loadFromCloud()` with a fake server answer of `155`, confirmed `S.rates.sil` became `155` with zero toast/warning anywhere. Also found it's wider than rates alone: `_done_err` leaves an unrolled-back local mutation in `S` too, and the *next* auto-refresh poll (no reload needed) clobbers it the same way.

**The fix (Opus-designed, one redirect round on the diff before shipping):** a shop-scoped localStorage marker (`ssj_unsynced`, `{v, id}`) written the moment a save is sent, cleared only on confirmed success/403/a resolved conflict. `loadFromCloud(callback, skipPush)` checks it first and pushes that save (checked against the version it was based on) before doing its normal GET — so a reload-abandoned save gets retried instead of silently overwritten. Three outcomes: push lands (local wins, 1 extra GET) · real conflict (the existing conflict handler's own load wins, marker cleared, no double-GET) · push can't be sent at all, e.g. a 403 role that can never save (cloud copy wins, loaded anyway) · any other failure (stay on the local copy, marker survives, retried on the next load). Two guards against the scary failure mode (an empty/stale local copy getting pushed OVER real shop data): `doStartApp`'s no-accepted-cache branch and `_clearDeviceSession()` (sign-out) both clear the marker first.

**Opus's first-round review of my implemented diff caught a real gap I'd missed**, not just style: `saveCache()` swallows its own failures (quota exceeded is realistic — the blob can reach ~2.5MB against a ~5MB localStorage budget), and a failed cache write combined with the (then-unconditional) marker write meant a *stale* cache could get pushed over real data after a reload. Fixed: `saveCache()` now returns true/false and clears the marker on any failure of its own; `saveToCloud` only writes the marker when the cache write actually succeeded. **Verified this specific gate is load-bearing**, not just defensive: reverted only that one line, confirmed exactly the test built for it failed (and only that one), restored, green again. Also added, per the same review: an offline guard (a marker with the browser's own `navigator.onLine===false` returns immediately instead of burning ~22s of retries every poll while offline — the existing `online` listener already re-triggers a load once the connection returns) and a toast assertion on the real-conflict test.

**9 regression tests added** (`tests/regression.test.js`, search "C2"), reusing the existing `reauthApp`/`fakeToken`/`flushAll` helpers: a real-reload scenario (actually calls `loadCache()` from disk after wiping in-memory state, not just resetting trackers — asserts the literal PUT body, not just the post-load state), a real conflict, an own-save-whose-answer-was-lost, a push that can't reach the server at all, the two shop-wipe guards, a 403, a plain mid-session failure retried on the next load, a baseline (no marker = plain GET), and the stale-cache-write case. **Verified every test actually exercises the new code, not just trivially true**: ran all 9 against the unmodified code first (8 failed outright — the API doesn't exist yet — 1 needed the gate reverted to fail, confirmed above), then restored and confirmed 333/333 clean. Also independently re-ran my original throwaway repro script against the unmodified code to reconfirm the silent-overwrite symptom is real and unchanged by anything else in this session.

**Verification:** `node --check` all 11 modules clean; regression 333/333 (was 321 after C1; +9 new C2 tests); every `checks/` script clean, same known false positives (scope.js's global count ticked up 754→757 across both C1 and C2's new helper functions, expected); `backup-check`/`roundtrip` clean. **e2e `auth.spec.js` + `sale.spec.js` run in a real browser: 7/7 passing** (Opus specifically asked for this given the risk level, since both specs exercise `saveToCloud`).

**Explicitly NOT verified, said plainly rather than oversold:** the actual reauth-overlay → reload → re-login sequence has never been clicked through in a real browser — only simulated with fake fetches in the regression harness. The e2e suite covers login and sale, not this specific multi-step sequence. If anyone wants this fully proven before a jeweller hits it live, that's a `verify-ui`/Playwright pass still owed.

**Deliberately deferred, not bugs introduced by this fix:**
- **Two tabs of the same shop share the marker.** One tab's load can push its own state and silently drop the other tab's unsynced edit — the app already has this class of multi-tab problem elsewhere; not fixed here.
- **QA's exact original repro path is still unconfirmed.** If a token invalidated directly in the database comes back from store-proxy with `reason:'revoked'` (not `'expired'`), the existing code wipes the device on purpose, with a message — meaning QA's observed ₹160 loss may have been *intended* behavior for that specific invalidation method, separate from the real bug this batch fixes. Needs checking against the live database — Cowork's to do, not checkable from here.
- The real-conflict toast ("please redo your last action") is vague specifically for the reload-then-push case. Left as-is; only worth wording differently if jewellers actually report confusion.

→ FOR COWORK: C2 is fixed, tested, and pushed. Two things need your side: (1) check what store-proxy actually returns for a token invalidated directly in the database (`reason:'revoked'` vs `'expired'`) — this tells us whether QA's original repro was ever really this bug, or a separate, already-correct "removed user" wipe. (2) H1 (negative weights) and H2 (refunds not in Reports/GST/Net Cash) from the same QA pass are still open and unstarted.
→ FOR TANISH: C2 (a rate/other change held while your phone asks you to sign in again, if you reload or close the app instead of typing your password, used to silently vanish and get replaced by the old value) is fixed, tested, and pushed to `origin/main`. Not deployed to the live site yet — same as C1, that's a separate step whenever you're ready. Nothing needs your decision on this one.

---

### 2026-10-03 · Claude Code (Sonnet, Opus-reviewed) — C1 FIXED: edited bills now re-lock to the real new total

Cowork's C1 finding (below, "QA report in jewelos-qa/ read") confirmed and fixed. 🔴 financial-calc risk per MODEL-POLICY — Opus designed/reviewed the fix, Sonnet implemented. Only `js/01-sync-core.js` and `tests/regression.test.js` changed; no schema/migration/live-data touched.

**Root cause, confirmed by reading the code (same as Cowork found):** `saveEditBill()` called `calcSaleTotals(sale)` to get the new total after an edit, but `calcSaleTotals()` (02-ui-inactivity-modals.js:71) prefers an already-set `sale.lockedGrand` over the freshly computed total — by design, so a printed invoice never silently drifts just because a future formula change runs against an old bill. `saveEditBill` is the one caller that's supposed to *write* a new snapshot, but it was reading the old one through that same preference before writing, so `sale.lockedGrand=Math.round(t.grand)` just reassigned the stale pre-edit total back onto itself. A discount or item edit never actually changed the stored total.

**My first-pass fix proposal** (expose `calcGrand` as a new key on `calcSaleTotals`'s return object, use it only in `saveEditBill`) went to an Opus review before implementation, per MODEL-POLICY. **Opus redirected it** — my version left `t.bal`/`payStatus` computed against the OLD total (since `t` was captured before the re-lock), and separately exposed that the existing `payStatus` line (`if(t.bal<=0) sale.payStatus='full'`) could only ever *upgrade* a bill to `'full'` — harmless while the total never moved, but a real bug once edits can move it: an edit that *raises* the total above what's been paid would leave a stale `'full'` on a bill that now has a balance.

**What actually shipped** (01-sync-core.js, inside `saveEditBill`):
1. `sale.lockedGrand = 0` immediately before recomputing, forcing `calcSaleTotals` to fall through to the real formula instead of handing back the old lock; re-lock to that result; then a **second** `calcSaleTotals(sale)` pass so `bal`/`adv` are measured against the NEW lock, not the one just superseded.
2. Replaced the full-only `payStatus` line with the same 3-way `full`/`advance`/`pending` rule `buildSaleObj()` already uses at bill creation (02-ui-inactivity-modals.js:1138-1140) — now correctly degrades a bill out of `'full'` if an edit raises its total past what's paid.
3. No change to `calcSaleTotals` itself, `saleOverpaidBy()`, or any of the ~25 other callers that read `.grand` for display/aggregation — all of those are untouched and still correctly show the frozen historical total.

**2 new regression tests added** (`tests/regression.test.js`, "C1: an edited bill re-locks to the NEW total..."): discount case (10,000 → ₹1,000 discount → asserts `lockedGrand===9000` and `bal===0`) and item-weight-raise case (1g→1.5g at locked rate 10,000 → asserts `lockedGrand===15000` and `payStatus==='advance'`, not stuck at `'full'`). **Verified both actually catch the original bug**, not just pass against the fix: stashed the `01-sync-core.js` change, re-ran — both failed exactly as expected (`got 10000` both times), restored the fix, 321/321 green again. Also had to update one pre-existing test's assertion (`batch37 P2-14`) — it string-matched the literal old source line rather than behavior; updated the matched string to the new line, preserving its real intent (whole-rupee rounding on an edit, still true).

**Verification:** `node --check` all 11 modules clean; regression 321/321 (was 319, +2 new); `edge-functions.test.js` 26/26; every `checks/` script including the newly-added `unquoted-args.js` — same known-false-positive hits as baseline, nothing new; `backup-check`/`roundtrip` both clean. `jewelos-bug-pattern-reviewer` found no issues against the five bug families. `jewelos-test-runner` independently reproduced all of the above plus confirmed (by stashing this batch and re-running against unmodified `main`) that `tests/cowork-live-check.js`'s pre-existing failure is NOT caused by this change.

**Deliberately NOT done, flagged per Opus's review:**
- **Historical already-edited live bills still carry a wrong total.** Any bill edited in production before this fix has a `lockedGrand` frozen at its pre-edit value. Claude Code has no live-database access to find or fix these. Opus's suggested detection query: `editHistory.length>0 AND lockedGrand !== round(recomputed total)`. **Cowork: please run this as a read-only report for Tanish — do not auto-repair, re-saving a bill through Edit fixes it going forward.**
- **A separate, smaller total-drift Opus found while reviewing:** for custom items with qty>1, `buildSaleObj()` (creation) charges stone/diamond charges × qty while `calcSaleTotals()` (used everywhere else, including this fix's recompute) charges it once — so an edit to *any* field on such a bill (even just the customer's name) can now move the total slightly, where before the stale lock hid this. Also: the Edit Bill modal's own live preview (01-sync-core.js:1058-1074) uses a third, different formula (ignores qty, flat making charges) — so what the jeweller sees in the preview can now differ from what actually saves, for qty>1 or custom per-gram items. Neither is fixed in this batch — both are pre-existing formula inconsistencies this fix makes newly *visible*, not newly *created*. Follow-up: make the preview use `calcSaleTotals()`.
- **Orders/Girvi:** Opus confirmed (via grep for `locked(Total|Amount|Grand|Bal|Value)`) this exact bug pattern only exists in sale-billing code — orders/Girvi don't share it. No work needed there.
- **No live-browser/Playwright pass** — this change touches zero HTML, rendering, or button-wiring, only the calculation `saveEditBill` already called the same way; `verify-ui.md`'s own criteria ("isn't a pure backend/logic fix") says this doesn't need one. Flagging per CLAUDE.md's honesty rule anyway: DOM/on-screen behavior of the edit-bill flow (print preview, Reports, refund dialog) was not re-clicked in a real browser this session.

→ FOR COWORK: C1 is fixed, tested, committed and pushed — Tanish gave the go to start this session. Please run the historical-bad-data detection query above as a read-only report once you have DB access; do not repair automatically. Also: your C2 (silent loss on session expiry) and H1/H2 from the same QA pass are still open and unstarted — this batch was C1 only, exactly as scoped.
→ FOR TANISH: C1 (edited bills showing the wrong total) is fixed, tested and pushed to `origin/main`. Two small things came out of the fix, not bugs created by it, just newly visible: (1) bills with multiple of the same custom item can shift by a few rupees on any edit now, instead of silently staying wrong — a formula-consistency cleanup, not urgent; (2) old bills edited before this fix shipped still show their old (wrong) total until someone re-saves them through Edit — Cowork will get you a list once they have DB access, no auto-fix without your say. This hasn't been deployed to the live site yet — that's a separate step (drag a zip into Netlify) whenever you're ready.

---

### 2026-10-03 · Claude Code (Sonnet) — Cowork's audit items 1+2 done (check.bat gap + stale docs); items 3+4 reported, nothing deleted

Picked up Cowork's repo-audit entry below. 🟢 docs/check.bat only, no `js/` changes — Sonnet per MODEL-POLICY §8. Did exactly what the hand-back asked: items 1+2 fixed, items 3+4 reported back, nothing deleted.

**Item 1 (real gap) — fixed:** `check.bat` now also runs `checks/unquoted-args.js` (one line added, step 3). Ran it standalone first to confirm it's safe/informational-only (11 known-pattern hits, same as always — numeric-arg false positives, not new). Full `check.bat`-equivalent run after: syntax clean, regression **319 passed, 0 failed**, all 9 `checks/` scripts ran, `backup-check`/`roundtrip` both clean.

**Also found while on item 1 — not fixed, flagging:** `tests/cowork-live-check.js` (referenced by `jewelos-test-runner.md` already) is NOT a live-Supabase check despite its name — it's local/offline, same as `regression.test.js`, just drives `recordSale()`/`renderDayBook()` through the fake DOM one level less isolated. Running it standalone today: **it fails** — `recordSale()` doesn't save (`S.sales.length=0`). Most likely a stale fixture from 26 Sep that never set up shop rates, predating the 30 Sep "no sale without saved rates" change — not confirmed as a real `recordSale()` regression, just flagging since nobody had run it standalone until today. Documented the discrepancy in `tests/README.md` rather than silently wiring it into `check.bat` (wrong move to add a currently-failing check to the pre-deploy gate). Needs a look before it's trusted.

**Item 2 (stale docs) — fixed:** `CLAUDE.md` ("Control Room"→"the Office (paused)"; store-proxy v6→v8, added auth-gateway v6; e2e coverage lines now say "10 specs" instead of naming 4; Cowork-agent-access paragraph updated — the `jewelos-agents` plugin is now installed and in Cowork's agent list, so the old "cannot invoke by name" finding no longer holds). `README.md` (added a dated "current state" note rather than rewriting the 6-Sep assembly narrative — current test count 319, e2e exists now, store-proxy v8/auth-gateway v6, migrations 001-006, plus the live URL since `jewelos-deploy-verifier.md` pointed here for it and it wasn't here: `https://heartfelt-queijadas-eeb356.netlify.app/`, noting the decoy `jewelos-app` project). `tests/README.md`, `tests/e2e/README.md` (10-spec table, one-line descriptions for the 5 undocumented specs, fixed a real contradiction — "Purchases NOT covered" when `purchase.spec.js` exists), `skills/verify-ui.md`, `.claude/agents/jewelos-test-runner.md` (added `unquoted-args` to its checks list) all updated to match. `tests/harness.js` and `.claude/hooks/js-guard.js` comment-only fixes (eleven modules not ten/00-08; reworded the pre-existing-ES5-violations comment to past tense since `5995f9f` already fixed both). **Deliberately left untouched:** `CLAUDE.md`'s "Launch target: late September 2026" line — Cowork flagged it stale but gave no replacement date, and that's Tanish's fact to give, not mine to guess. `.claude/agents/jewelos-deploy-verifier.md` line 16 needed no edit — it already says "check HANDOFF.md and README.md, don't assume unchanged" (good practice, URL has moved before); README.md having the URL now closes the actual gap.

**Item 3 (setup weight) — reported, nothing changed:**
- 3 browser stacks: `chrome-devtools-mcp` is project-scoped (`.claude/settings.json` `enabledPlugins`); Playwright and the built-in browser are account-level, not in this repo's settings — not Claude Code's or this repo's call to trim.
- `ponytail@ponytail` — enabled in `.claude/settings.local.json` (Tanish's own local override, not committed project config). It's a dev-persona skill (forces minimal-diff/YAGNI-style solutions); harmless, just unexplained anywhere in the repo until now.
- 2 static servers, different jobs, not redundant: `.claude/launch.json` (port 8765) is an inline Node one-liner for an IDE "launch" live preview of the app; `tests/e2e/static-server.js` (4173) serves the app specifically for the Playwright e2e suite.
- `block-secret-writes.js` blocks any path matching `/\.env(\..*)?$|\.pem$|credentials/i` — confirmed over-broad as Cowork flagged: it'd block e.g. `docs/old-credentials-notes.md`, unrelated to a real secret file. Conservative direction (blocks too much, not too little) so low urgency; a tighter pattern would need Tanish's sign-off since it's a security-relevant hook.
- `CLAUDE.md`'s ~10 auto-delegated external agents (Agent routing section) — unchanged, no recommendation made; this is Tanish's call per the hand-back, not something to trim unasked.

**Item 4 (leftovers) — `git ls-files` run on each, nothing deleted:**
| Path | Tracked? |
|---|---|
| `.claude/scheduled_tasks.lock` | **untracked** (stale, not in `.gitignore`) |
| `checks/globals.json` | tracked (regenerated every `scope.js` run — arguably shouldn't be tracked at all) |
| `redesign-shots/` (30 PNGs, ~2MB) | tracked (confirmed: referenced nowhere outside `HANDOFF.md`/`docs/CHANGES-batch46.md`) |
| `docs/DAYBOOK-SPEC.md` | tracked (superseded by `-v2`, which still says "proposal, no code written" in its own header) |
| `docs/SECURITY_FIXES_README.md` | tracked (August, no longer checked against current code) |
| `docs/HANDOFF-ARCHIVE.md` | tracked (432KB / 5,661 lines) |
| `.claude/worktrees/` | exists, empty, nothing to track |
| `.claude/skills/_archive/` | tracked, 2 files (`jewelos-change/SKILL.md`, `jewelos-debug/SKILL.md`) |

One thing Cowork didn't flag that I found checking this: `.claude/skills/_archive/` (2 stub dirs) and top-level `skills/_archive/` (3 full files: `jewelos-change.md`, `jewelos-debug.md`, `jewelos-dev-rules.md`) are two *different* archive locations from the same 3-Oct merge — expected, not a bug, per that merge's own HANDOFF entry ("archived the 3 old files and their 2 stub dirs").

→ FOR COWORK: items 1+2 done, pushed. Items 3+4 above are the report you asked for — nothing deleted, nothing changed beyond what's listed. Tanish still needs to decide: (a) item 3's keep/trim call on the agent list and browser stacks, (b) item 4's actual delete list, (c) the `Downloads` leftovers in your item 5 (untouched, outside my reach). Also: `tests/cowork-live-check.js` fails standalone right now — worth a look since it's the one check your own `jewelos-test-runner.md` already told Claude Code to run.
→ FOR TANISH: Three things need you: (1) a real current launch-target date for `CLAUDE.md`'s stale "late September 2026" line — say it and I'll update it. (2) item 4's keep/delete list above — say which of those 7 tracked/untracked paths to actually remove. (3) item 3's setup-weight question (keep or trim the agent list / extra browser plugins) — no change made either way until you say so.

---

### 2026-10-03 · Cowork (Sonnet) — repo instruction/leftover audit (read-only; nothing changed)

Tanish asked: is anything in this folder unnecessary or unused and hurting the setup? I read the instruction + config files (CLAUDE.md, MODEL-POLICY.md, READMEs, check.bat, .gitignore, settings*.json, launch.json, hooks, agents, verify-ui, e2e/tests READMEs, harness, cowork-live-check). **I had no shell** (device shell was still downloading), so I could not run `git`: tracked/untracked status of the leftovers below is UNKNOWN to me. Verify before acting.

**1. Real gap (fix first, one line): `check.bat` does not run `checks/unquoted-args.js`.** `checks/README.md` says check.bat "does all of the above" and CLAUDE.md says it runs "every script in `checks/`", but its step 3 lists scope, handlers, ids, css, loadorder, backup-check, roundtrip, making-basis only. `unquoted-args` exists because of the 8 Sep order-payments bug. Also `tests/cowork-live-check.js` is run by `jewelos-test-runner` but is in neither `check.bat` nor `tests/README.md`.

**2. Stale statements (docs-only fixes):**
- `CLAUDE.md`: "Launch target: late September 2026" (past); `store-proxy` v6 (live v8, auth-gateway v6); "Control Room" (replaced by the Office, now paused); the Cowork-specific note says Cowork cannot use the 4 `jewelos-*` agents and no plugin route exists — the `jewelos-agents` plugin is now installed on Tanish's account and in Cowork's agent list; e2e coverage "login, sale, Girvi and Day Book" (there are 10 specs: also failed-saves, invoice-numbers, offline, purchase, session-restore).
- `README.md`: "38 tests passing", "no UI coverage anywhere", store-proxy "Version 6", migrations "001 and 002" (six exist), "assembled 6 Sep" framing.
- `tests/README.md` and `tests/e2e/README.md` ("What's covered so far") and `skills/verify-ui.md`: list 4-5 specs of 10.
- `.claude/agents/jewelos-test-runner.md`: "No browser automation, no DOM/UI test coverage" (e2e exists); its checks list omits `unquoted-args.js`.
- `.claude/agents/jewelos-deploy-verifier.md`: tells the agent to find the live URL in `README.md`; no file in the repo contains it. Put the URL in the agent file or README.
- Comments: `tests/harness.js` header says modules 00-08 (there are 11); `.claude/hooks/js-guard.js` says "ten numbered modules" and describes pre-existing ES5 violations that were fixed today (re-check the comment).

**3. Setup weight (Tanish's call, do NOT change without his go):**
- CLAUDE.md "Agent routing" auto-delegates to ~10 named external agents (Frontend Developer, Backend Architect, Database Optimizer, Code Reviewer, AI-Generated Code Security Auditor, Evidence Collector, Reality Checker, Incident Response Commander, Sprint Prioritizer, Agents Orchestrator) plus the 4 `jewelos-*` ones, with "at most two per task". These live outside the repo (user-level); Cowork's earlier claim that Evidence Collector / Reality Checker do not exist was WRONG (Claude Code sees them).
- Three browser stacks enabled: `chrome-devtools-mcp` (project `settings.json`), Playwright plugin, built-in browser. `ponytail@ponytail` is enabled in `settings.local.json`; Cowork cannot tell what it does and nothing in the repo mentions it.
- Two static servers: `.claude/launch.json` (port 8765) and `tests/e2e/static-server.js` (4173).
- `block-secret-writes.js` blocks any path containing "credentials" anywhere (over-broad).

**4. Probable leftovers (verify tracked status with git first; propose deletion list to Tanish, do not delete):** `.claude/scheduled_tasks.lock` (stale, 2 Oct, pid 19324, not in `.gitignore`); `checks/globals.json` (generated by scope.js, 48 KB, rewritten every run); `redesign-shots/` (30 PNGs, ~2 MB, referenced nowhere); `docs/DAYBOOK-SPEC.md` (superseded by `-v2`; v2 header still says "proposal, no code written" — update its status); `docs/SECURITY_FIXES_README.md` (August); `docs/HANDOFF-ARCHIVE.md` (432 KB); empty `.claude/worktrees/`; `.claude/skills/_archive/`.

**5. Outside the folder (Tanish's machine, not in git):** `Downloads\` still holds the folders README.md calls "safe to delete" (`jewelos-checks`, `jewelos-client-deploy`, `-deploy-v2`, `jewelos-client-batch4`, `JewelOS-v5-hardened`), a stale `CLAUDE.md` (8 Sep) that would load if Claude Code were opened from Downloads, ~40 old batch zips; and a stray `.git` on the Desktop root (README already flagged it).

→ FOR CLAUDE CODE: One docs-only batch, no `js/` changes, Sonnet is fine (🟢). Do items 1 and 2 now (add `node unquoted-args.js ..` to `check.bat` step 3 and run it to see it passes; fix the stale lines; do NOT edit `CLAUDE.md` content beyond the factual lines in item 2 — Tanish owns its rules and routing). For item 3 only report back what each thing is and whether it is used; change nothing. For item 4 run `git ls-files` on each path and give Tanish a keep/delete list; do not delete. Run `check.bat` after, commit, push, write the HANDOFF entry.
→ FOR TANISH: Decide two things when Claude Code reports back: (a) keep or trim the ~10 auto-delegated agents and the extra browser plugins; (b) approve the delete list for item 4 and the `Downloads` leftovers in item 5. Nothing is deleted until you say so.

---

### 2026-10-03 · Claude Code (Sonnet) — fixed the 2 pre-existing ES5 violations, Opus-approved

Tanish said "fix those then" after I explained the ES5 rule and the two violations found earlier today. Both fixed, both verified clean, no app behavior changed.

1. **`03-billing-numbers.js`** — turned out to be **5** `\u{XXXXX}` ES6 codepoint escapes, not 1 (acorn only reports the first parse error it hits, so fixing #1 exposed #2-5 at the ORD_STATUS icon map, lines 1578-1581). Each replaced with its exact UTF-16 surrogate-pair equivalent (`\u{1F4B3}` → `💳`, etc. — verified by computing `String.fromCodePoint` and comparing). Decodes to the byte-identical emoji. No logic touched.
2. **`05-auth-login.js:715`** — removed `async` from `sendStaffInvite`. Turned out my own earlier flag was wrong on the premise: the function never had an `await` anywhere — it already ran its async work via `.then()/.catch()` — so `async` was pure decoration. This was a 1-word deletion, not the refactor I'd expected.

Because I'd flagged #2 for Opus review in the previous entry (auth-adjacent, per MODEL-POLICY §8) and that flag hadn't been cleared, I didn't close it on my own say-so even after confirming it looked safe. Ran three checks in sequence, not in parallel with judgment skipped:
- `jewelos-bug-pattern-reviewer` (Sonnet): verified both diffs behavior-preserving, correctly refused to self-approve the auth-adjacent one and asked for the Opus sign-off the standing flag called for.
- `jewelos-test-runner`: 319+26 tests pass, `check.bat` clean (same documented false positives as baseline). One test (`cowork-live-check.js`) fails, but proved pre-existing and unrelated by stashing both edits and reproducing the identical failure against unmodified `main`.
- Opus (`AI-Generated Code Security Auditor`, model override): read the function, the global error handlers, and `supabase/functions/auth-gateway/index.ts` itself. **Verdict: approve as closed** — confirmed byte-identical behavior (return value, synchronous-throw timing, error handling all unchanged) and no auth/security impact (server-side authorization unchanged, temp password handling unchanged).

**Backlog items the Opus pass surfaced, not fixed (pre-existing, not from this change):**
- No double-submit guard on "Send Invite" — two fast taps *could* both pass the duplicate-email check against the read-modify-write users blob before either save lands. Low likelihood (owner-only, needs near-simultaneous taps). Fix like `saasSignup` already does: disable the button while the request is in flight.
- `String.prototype.includes` (`05-auth-login.js:721`) and `Object.assign` (`04-orders-detail.js:1945`) are ES2015 *methods*, not syntax — they don't fail an ES5 parse (that's why the new hook didn't catch them) but are worth knowing about if a target device's JS engine is old enough to lack them. Not urgent; the app already depends on `fetch`, and anything with `fetch` has both.

`check.bat` clean, all 11 modules `node --check` clean, all 11 modules now genuinely ES5-clean (verified by parsing each at `ecmaVersion: 5` with the hook's own logic). Committing both files + this entry.

→ FOR COWORK: nothing — FYI only, no app behavior changed, this was a syntax-compliance fix with full review trail above.
→ FOR TANISH: nothing needed now. The 2 backlog items above (double-submit guard, ES2015 methods) are low-priority — say if you want either picked up.

---

### 2026-10-03 · Claude Code (Sonnet) — added 2 hooks (ES5 enforcement, block new module files); found 2 pre-existing ES5 violations

Tanish asked for an automation-recommender pass over the repo, then to build the two hooks it found missing. Tooling only — did not touch `js/*.js` app code or read the Cowork QA entry below until after finishing.

1. **`.claude/hooks/js-guard.js` (PostToolUse, existing hook extended):** now also parses the edited `js/*.js` file at `ecmaVersion: 5` with the `acorn` already bundled in `checks/node_modules` — arrow functions, `let`/`const`, template literals, `async/await` all fail to parse at ES5, so this is free and has zero false positives from comments/strings (a real parser, not regex). Scoped to only block a violation the edit itself introduced: it diffs against `git show HEAD:<file>` first, so the two pre-existing violations below don't block unrelated future edits to those files.
2. **`.claude/hooks/block-new-module.js` (new, PreToolUse on `Write`):** blocks creating a new `js/<number>-name.js` file (existing numbered modules can still be edited freely) with a message pointing at the CLAUDE.md rule that this needs Tanish's explicit sign-off.

Both tested directly via stdin simulation (new module blocked, existing module/unrelated file allowed, edit-introduced arrow function blocked, pre-existing debt not blocked) — see transcript if you want the repro commands. `check.bat` still passes clean, same known false positives as before.

**Found while building check #1 — not fixed, just flagging:** two lines already in the shipped code aren't actually ES5.
- `03-billing-numbers.js:132` — `\u{1F4B3}` is an ES6 codepoint escape; ES5 only has 4-hex `\uXXXX`. Trivial, behavior-preserving fix is the UTF-16 surrogate pair (`💳`) instead — did not touch it since CLAUDE.md flags this file's unicode escapes as needing byte-exact edits and this wasn't the asked task.
- `05-auth-login.js:715` — `async function sendStaffInvite(){...}` is a real `async function`, not just a string issue. Converting it to ES5 (promise chains instead of `await`) is a real refactor of an auth-adjacent function, not something to do silently — flagging for whoever picks this up next, Opus per MODEL-POLICY given it's auth-adjacent.

Neither is a reported bug (both predate any of this), just rule violations the new hook would have caught if it existed earlier.

→ FOR COWORK: nothing — FYI only, this was tooling, no app behavior changed.
→ FOR TANISH: say if/when you want the two ES5 violations above fixed (the emoji one is trivial; the async one needs a real pass). Not urgent, not a live bug.

---

### 2026-10-03 · Cowork (Sonnet) — QA report in `jewelos-qa/` read; C1 CONFIRMED in code, C2 NOT confirmed

Tanish ran a Playwright QA pass on live (batch47) against a throwaway shop; report is `jewelos-qa/01..06`. I read all six and checked the two Criticals against batch47 code. I did not re-run the QA.

**C1 (edited bill keeps stale grand total) — CONFIRMED by reading code, money-integrity.** `saveEditBill` (`01-sync-core.js` ~L1161-1163) does `var t=calcSaleTotals(sale); sale.lockedGrand=Math.round(t.grand);` but `calcSaleTotals` (`02-ui-inactivity-modals.js` L70-71) returns `sale.lockedGrand` as `grand` whenever it is > 0. So the "re-lock" assigns the OLD lockedGrand back to itself; a discount/item edit never changes the total. Result matches QA: printed taxable+GST disagree with GRAND TOTAL, phantom balance with a Remind button, refund pre-fills the old total, Reports revenue vs GST disagree.

**C2 (silent loss on session expiry) — NOT confirmed.** `saveToCloud` on a 401 holds the caller's callback and calls `saasRequireReauth(function(){ saveToCloud(callback); })`, and `saveRates` only toasts "saved & synced" inside `if(!err)`. By code the toast cannot fire before the re-sent save lands. QA's "toast then server overwrote 160 with 155" may be a test artefact (token invalidated by hand) or a path I did not read (re-auth callback not firing / cache-only "Offline" mode). Needs a real repro before any change.

**Unverified by me (taken from the report):** H1 negative/absurd weights accepted, H2 refunds not in Reports/GST/Net Cash (and return-to-stock unticked, no Card refund mode), H4 audit log nearly empty, M3 stale on-screen totals, M7 Reports overflow at 390px, M8 Reports vs Day Book "Cash In" mismatch. Report is one compressed session, staff roles / two-staff / slow network / print / shop isolation NOT TESTED; its 4/10 and price opinion are the tester's judgement, not measured.

→ FOR CLAUDE CODE: (1) C1 first, Opus for the design (money integrity): the fix is to recompute from lines on edit (clear/ignore lockedGrand before `calcSaleTotals`, or compute `calcGrand` separately), plus a regression test: record a bill, edit discount, assert printed total = taxable + GST and balance 0. Check `lockedGrand` consumers (`02` L1357 due calc, `01` L1123 history) and whether already-edited live bills carry a wrong stored `lockedGrand` (needs a data-fix decision from Tanish before any production write). (2) Try to reproduce C2 locally against `store-proxy` with an expired token, report what actually happens. (3) H1 weight validation and H2 refund→Reports are the next candidates; do not start them before C1.
→ FOR TANISH: One thing: say "go" on C1 as the next batch (it blocks any real jeweller). Also the QA shop "QA Test Jewellers (TEST - delete me)" is still on live; say "delete the QA shop" and I will remove it from Supabase after you confirm.

---

### 2026-10-03 · Claude Code — condensed this file (read this before trusting the shorter LOG below)

This file was 2637 lines / 84 LOG entries; it's now ~400. A read-only audit (fork, this
session) found ~6 rounds of the same save-lock review/fix cycle, ~45 closed batch30-47 QA
entries, and 12 premium-redesign phase entries all superseded by their own final state —
condensed each closed group to one entry keeping what still matters (shipped facts,
permanent by-design limits, anything still open), dropping only round-by-round process
detail. Also fixed a wrong WAITING ON TANISH claim ("Netlify badge hidden with CSS" — it
isn't) and promoted 4 items that were only ever mentioned inside LOG entries (never
actually tracked) up into WAITING ON TANISH, where they'd nearly gotten lost: Hinglish
copy decision, phone test of the redesign, call shop `3720af09`, `jewelos-health`/
`jewelos-client-queries` stale SQL.

**Nothing is lost** — full original history is in `git log -- HANDOFF.md` / `git show` on
any commit before `559ce28`. Tanish reviewed the audit (inventory, groups, dead-reference
checks, contradictions) and approved the replacement before this was committed.

Committed `559ce28`, pushed fast-forward to `origin/main` (`86e7d5f..559ce28`).

→ FOR COWORK: the file you're reading is restructured, not just appended to — re-read it
fully rather than assuming the old entry layout/line numbers. If you need the exact
reasoning/timeline behind any closed item (e.g. a specific Opus review round's bug
mechanism), it's in git history, not in this file anymore; ask and I'll pull it back out.
→ FOR TANISH: nothing further.

---

### 2026-10-03 · Claude Code — skills audit executed + pushed

Cowork's 3 Oct skills audit (below, condensed) found `skills/jewelos-change.md` /
`jewelos-debug.md` / `jewelos-dev-rules.md` overlapping 3x, several stale lines, a
tool-name hardcode in `verify-ui.md`, and a `CLAUDE.md` line naming agents it believed
didn't exist. Tanish saved a merged `jewelos-dev` skill directly into the repo at
`skills/jewelos-dev.md`. Claude Code then: repointed `CLAUDE.md` (~L85, Procedures list)
and `tests/e2e/README.md` to it; added the `.claude/skills/jewelos-dev/SKILL.md` pointer
stub; archived the 3 old files and their 2 stub dirs to `skills/_archive/` and
`.claude/skills/_archive/` (`git mv`, not deleted); reworded `verify-ui.md`'s tool-name
line to not hardcode either side's literal MCP prefix (Claude Code and Cowork differ —
confirmed `mcp__plugin_playwright_playwright__*` is what Claude Code actually sees now);
left the `Evidence Collector`/`Reality Checker` `CLAUDE.md` line alone after checking —
both agents **are** in Claude Code's current available-agent list, so the audit's "do not
exist" finding no longer holds (flagged back to Cowork to re-check their side). Did not
touch `jewelos-health`/`jewelos-client-queries` (Cowork's account skills) as instructed.
Committed `606c2a2`, pushed fast-forward to `origin/main` as `606c2a2`→`86e7d5f`
(`66a833c..86e7d5f`). **Verified by this audit:** `skills/jewelos-dev.md` exists and
matches; the 3 old files and 2 stub dirs are genuinely under `_archive/`, not deleted;
`CLAUDE.md`'s Procedures list and Rules line now point at `jewelos-dev.md`; both commits
exist in `git log`.

→ FOR COWORK: done and pushed; pull before assuming the old file layout.
→ FOR TANISH: nothing.

---

### 2026-10-03 · Cowork — skills audit findings (condensed, nothing deleted by Cowork)

Found: the 3 skill files above overlapping; stale "no browser automation" line (false,
`tests/e2e/` exists — this line is gone now, archived with the files it was in); stale
`~/Downloads/jewelos-checks/` reference — **note: that folder does still exist on disk**,
it's just a second, unmanaged copy of the `checks/` scripts outside the repo, not the one
the project actually uses (repo `checks/` + `check.bat` is canonical); `decisions/log.md`
reference — **confirmed: no such folder exists anywhere in the repo**; `verify-ui.md`'s
hardcoded tool name (fixed, see above); the `Evidence Collector`/`Reality Checker` line
(checked above, currently accurate, not fixed). Also flagged the `jewelos-health`/
`jewelos-client-queries` issue now carried into WAITING ON TANISH above.

→ FOR CLAUDE CODE: (done, see entry above.)
→ FOR TANISH: nothing further needed (your "saved" + putting the file in the repo closed this).

---

### 2026-10-03 · Save-path / premium-redesign release cycle — CONDENSED (16 original entries, 2026-10-03, between the "batch47 zip VERIFIED and CLEARED" and "merged premium-redesign into main" entries)

**This replaces a long back-and-forth** (Cowork/Opus review → Claude Code fix → re-review,
repeated ~6 times) over a save-lock redesign (lock token, generation counter, canonical
stringify, superseded-call handling) meant to close rare (~70s-stall) data-loss edge cases
in `saveToCloud()`. Each round closed real findings and opened a new one; after the 6th
round still weren't fully clean, **Tanish picked "Option 2" in chat (15:29 IST, 3 Oct):
ship the premium redesign today on batch46's existing (unmodified) save path, and do the
save-lock rework as its own, separately-reviewed batch later.**

**What Claude Code actually did (verified against the current repo, not just the log):**
1. Branched `save-lock-wip` off `main` and committed the complete lock-token/generation-
   counter/canonical-stringify work + its tests there (`902efa9` — **confirmed exists**,
   confirmed the branch currently still holds 7 occurrences of
   `_canonicalStringify`/`_saveLockGeneration`, nothing lost).
2. Reset the release tree's `js/00-config-state.js` and `js/01-sync-core.js` to the exact
   batch46-deployed bytes (`git checkout aa15ed9 -- ...`; **confirmed**: current `main`'s
   `00`/`01` have **zero** occurrences of any of the save-lock-rework identifiers — the
   revert genuinely stuck).
3. Reverted `tests/regression.test.js` to match (batch46's own 318 tests + the 1
   independent staff-tab-order test), landing at 319/319 on this tree.
4. Checked `08-girvi-viewmode.js`'s `resetSaveLock()` still works harmlessly against
   batch46's `00` (implicit global, same bucket as 6 pre-existing tolerated ones).
5. `check.bat` clean, e2e 19/19 on exactly this tree.
6. Built `jewelos-batch47-DEPLOY.zip` (16 files, 317.2 KB — **confirmed this file exists**
   in `~/Downloads`) and `docs/CHANGES-batch47.md` (**confirmed exists**).
7. Committed the revert as `f9adde2` (**confirmed exists**) and the staff Day-Book/Settings
   tab fix as `4f6e791` (**confirmed exists AND confirmed still live**: `05-auth-login.js`
   line 628's tab array currently includes `'daybook'` — the fix survived the 00/01-only
   revert, as it should, since 05 was never touched by it).

**Cowork then verified** the zip (`jewelos-batch47-DEPLOY.zip`) byte-for-byte against the
folder and against what's live, confirmed the `00`/`01` hashes match batch46-live exactly
(sha256 `bd4e3005…` / `168f7e22…`), spot-checked the staff tab fix, and **cleared it**:
Tanish can drag it into Netlify. As of the last entry in this file, **live was still
batch46** — batch47 had not yet been deployed; Cowork's clearance says drag it, but no
later entry confirms Tanish actually did so or that Cowork re-verified live afterward.
**[uncertain — never confirmed in this file: was batch47 actually deployed?]**

**Known, accepted, still true on `main` today:** `08`'s `resetSaveLock()` assigns an
undeclared `_saveLockToken` under batch46's `00` (harmless, diag-button only; cleanup
belongs with the eventual save-lock batch). The underlying rare-stall save-path edge cases
the whole review cycle was chasing are **not fixed on `main`** — they're exactly batch46's
pre-existing behavior, which is what Option 2 explicitly accepted ("ships no new risk vs.
live"). The full analysis of those edge cases (what exactly goes wrong, in what order,
after how long a stall) lives only in the original file's history if this ever needs
re-deriving; see "what you lose by merging" below.

**Separately in this window:** `main` was pushed to `origin` (`7bb7f60`, confirmed a plain
fast-forward, not force) and the premium redesign (`premium-redesign` branch, see next
entry) was fast-forward-merged into `main`.

**Next batch (not started as of this file):** save-lock rework, designed by Opus first
(single save queue, superseded calls re-queue rather than claim success, no watchdog
freeing a lock under an in-flight request), implemented on `save-lock-wip` with tests for
phone-sleep and Postgres jsonb key-reordering. Ships as its own zip, its own review cycle.

→ FOR COWORK: `save-lock-wip` (`902efa9`) is untouched and ready for the next design pass
whenever Opus is ready; don't extend it before that design exists. Please confirm whether
batch47 actually got dragged into Netlify — this file never says so.
→ FOR TANISH: say if/when you dragged `jewelos-batch47-DEPLOY.zip` in, so this gets logged.

---

### 2026-10-02 → 2026-10-03 · Premium redesign Phases 0–5 + final cleanup + merge — CONDENSED (12 original entries)

**Full scope, done and merged into `main` (confirmed: `premium-redesign` branch still
exists, pointing at the same commit `main` now also contains — fast-forward, zero
conflicts, confirmed by `git log main --oneline --not premium-redesign` being empty at
merge time).** Presentation-only throughout — no money math, no Girvi interest engine, no
Day Book cash-derivation logic touched anywhere in any phase; every phase independently
ran `check.bat` (regression suite held at 318→321/321 as classes were added) and was
live-verified via Playwright against the real e2e test shop, with before/after screenshots
in `redesign-shots/<screen>/{375,768,1440}.png` (**confirmed: all 10 screen folders exist
on disk** — dashboard, daybook, girvi, orders, purchases, reports, sales, settings,
sign-in, stock).

- **Phase 0 (Opus audit, 2 Oct):** found `js/05-auth-login.js:628`'s staff-hide tab list
  missing `'daybook'` — staff lost Day Book, kept Settings (likely backwards). Flagged,
  explicitly NOT fixed as part of the redesign (out of scope) — **fixed later, separately,
  same day as the save-path findings A/B/D, commit `4f6e791`** (see entry above; confirmed
  still live on `main`).
- **Phase 1 (1 Oct):** design tokens only, `index.html` `:root` — new gold tones, 8-step
  spacing scale, radius/font/type tokens, `.btn-warning` class. Nothing repointed yet, zero
  visual change. Full plan approved by Tanish, saved at
  `C:\Users\ADMIN\.claude\plans\dynamic-dreaming-jellyfish.md` (**confirmed this file
  exists** on this machine, outside the repo).
- **Cross-cutting fixes (1 Oct, Opus-reviewed):** `safeConfirm()` gained a 3rd `'warn'`
  (amber) state for 4 misused call sites; "Signing in..." no longer rendered in error-red;
  `.bnav` padding-bottom was given an extra 64px to clear the Netlify badge (**this was
  later found to be a double-reservation and removed — see the mobile-bottom-nav entry
  below and the corrected WAITING ON TANISH Netlify-badge note**).
- **Phase 2 (2 Oct):** shell — login/signup, header, nav, dashboard. Removed the literal
  `' →'` suffix from 10 button-label strings. 375px mobile width **not verified this
  session** (`resize_window` didn't actually resize the viewport) — confirmed later via
  Playwright's own 393px project instead.
- **e2e credentials saga (2 Oct, 3 entries, now fully closed):** Claude Code was blocked on
  missing e2e test-shop credentials; Cowork found `.env.test` was at the **repo root**, not
  `tests/e2e/` as the setup note said (ambiguous wording, now fixed in
  `tests/e2e/README.md`), already fully populated; unblocked once run from the repo root,
  19/19 e2e passed.
- **Phase 3 (2 Oct):** Stock/Sales/Orders/Purchases/Reports/Settings — ~40 stale pre-
  redesign gold/silver `rgba()` literals repointed to the Phase-1 tokens; `.fg label`/`th`
  got the uppercase/muted treatment; new `.btn-ink` class for header "+ Add" buttons.
  Explicitly left out: Customers (no mockup), 2 ad-hoc color families that were never the
  named gold/silver token (flagged as a separate inconsistency, not actioned later —
  **still open, low-stakes, untracked elsewhere**).
- **Phase 4 (2 Oct):** Girvi — same bright-hex-to-token sweep across `index.html` and 4 JS
  files; found (and fixed in the same pass) a gap in Claude Code's own earlier Phase 2/3
  work (`.ib-up`/`.trend-*`/`.itag-*` Dashboard/Stock badges were also unfixed bright hex).
- **Phase 5 (2 Oct):** Day Book — smallest of all 5 phases (no dedicated CSS section;
  inherits Phase 1/3's shared-component fixes automatically). Added
  `font-variant-numeric:tabular-nums` to 5 shared value classes app-wide.
- **Mobile bottom-nav bug (3 Oct, separate from the phase work):** Tanish reported the
  bottom nav buttons floating above the screen bottom. Root cause: `.bnav`'s
  `padding-bottom` had a stray extra 64px (pre-dating the redesign, confirmed via
  `git show` — **this is the same 64px the "cross-cutting fixes" entry above had added
  specifically to clear the Netlify badge**, so removing it may have re-exposed that
  original badge-overlap problem; nothing in this file re-checks that). Fixed to just
  `env(safe-area-inset-bottom,0px)`.
- **Final cleanup (2 Oct):** swept ~40 remaining bright-hex instances across
  `03`/`05`/`06`/`07`/`10`-js and `index.html`; corrected 2 earlier wrong assumptions
  (`.btn-pdf`/`.btn-wa` are NOT dead — they're used as static `class=` attributes in
  `index.html`, invisible to a JS-only grep). **The luxury redesign is complete end to
  end** across all 10 planned screens.
- **Final check.bat + verify-ui pass (3 Oct):** `check.bat` all-green across the whole
  branch; e2e 18/19 (the 1 failure — `invoice-numbers.spec.js` — is the same already-
  documented flaky test, passed alone, **not a regression**, confirmed by grepping this
  file's own history for the phrase, which shows the identical flake pre-dating this
  redesign by weeks).
- **Merge (3 Oct):** `git log main --oneline --not premium-redesign` empty → clean
  fast-forward (`dc82a16..1d113c9`), not a 3-way merge, zero conflicts possible. Re-ran
  `check.bat` on merged `main`: clean, 321/321.

**Still-open, low-stakes items from this whole arc, not resurfaced anywhere since:**
`.btn-dark`'s other 2 call sites with no mockup evidence (asked "say so and it's a
one-line class swap" — never answered); the 2 ad-hoc non-token gold/silver color families
in `02-ui-inactivity-modals.js` (Phase 3); whether `.bnav`'s padding removal (3 Oct)
re-exposes the original Netlify-badge bottom-nav overlap the 64px was added to cover
(nobody re-checked after removing it).

→ FOR COWORK: nothing — FYI only. The whole branch is merged and check-clean; next real
decision is Tanish reviewing it live end-to-end, and confirming the Netlify-badge/bottom-
nav interaction wasn't reintroduced by the 3 Oct padding fix.
→ FOR TANISH: nothing new beyond what's already in WAITING ON TANISH above.

---

### 2026-10-02 · Save-path review cycle #1 (lock token, callback isolation, watchdog/retry race) — CONDENSED (6 original entries)

Separate from (and earlier than) the 3 Oct save-lock cycle above, this was the *first*
round of hardening `saveToCloud()`: a lock-token (`_saveLockToken`) so a stale call's late
response can't clobber a newer save's state, a `_concluded` flag so a throwing callback
can't double-fire, and a watchdog re-stamp fix so a legitimately-retrying save chain isn't
mistaken for a hung one. Went through 2 Opus review rounds (first found a HIGH: the
watchdog freeing the lock mid-retry under a dead connection; second confirmed the fix and
flagged a session-restore e2e test as "most likely a test race, but 2 real reauth gaps" —
a 401 with a non-JSON body falling into the generic network-error path instead of
reauth, and the watchdog's 30s timeout being shorter than a single save attempt's own 60s
budget). All items fixed and tested (regression climbed 319→321 across this arc, e2e
18/19→19/19 after the test-race fix). **This is the predecessor work the 3 Oct cycle
built on and then (for `00`/`01`) reverted back out for Option 2** — i.e. the lock-token/
watchdog fixes from *this* arc are still live on `main` today (they predate and are
independent of the later generation-counter rework that got shelved). Confirmed: none of
*this* arc's identifiers (`_saveLockToken`, `_concluded`) were part of what got reverted —
only the newer `_saveLockGeneration`/`_canonicalStringify` additions were.

→ FOR COWORK: nothing — FYI only, this is historical, already layered under the 3 Oct work.
→ FOR TANISH: nothing.

---

### 2026-10-01 · Touch-target CSS fix

`.btn-sm`/`.btn-xs` row-action buttons (Edit/Delete/Reverse, 52 call sites) were under
Android's 48dp tap-target minimum. `min-height` added, CSS-only. **Not verified on a real
phone** — flagged in the original entry as untested; no later entry confirms a real-phone
check happened.

→ FOR COWORK: nothing — FYI only.
→ FOR TANISH: eyeball row-action buttons on a real Android phone (never confirmed done).

---

### 2026-10-01 → 2026-09-30 · batch30–47 QA/fix history — CONDENSED (≈45 original entries)

**This is the full shipped-bug history from the last QA cycle before the premium
redesign.** All of it is closed/shipped; current production code (and `main`) reflects the
end state only. Condensed here to preserve the facts that still matter — what's live, what
limits are permanent/by-design, what's still genuinely open — without the blow-by-blow of
each Opus review round. If you need the exact reasoning/timeline behind any one of these,
it exists in the original `HANDOFF.md`'s full history (see "what you lose" below) or in the
commit log (`git log --oneline` around 29 Sep–1 Oct covers all of it).

**P0 money bugs found and fixed, in order found:**
- Day Book was dropping most Girvi repayment types (only `payment`/`interest`/`refund`
  posted; the Pay dialog's actual default type is `general`). Fixed to a deny-list
  (skip only `penalty`/`waiver`); Reports' `calcCashFlow` was made to agree.
- Sale bills accepted unlimited overpayment and booked the overpaid amount as real cash.
  Fixed with `saleOverpaidBy()`, refusing anything over ₹1 excess; applied to both
  `recordSale` and `saveEditBill`.
- Purchase bills: a load/normalize loop unconditionally overwrote `amountPaid` to the full
  total whenever `purchaseCfg.credit` was false (the default) — silently erasing every
  partial payment on every load. Root-cause fixed (deleted the override) + existing-data
  repair logic for bills already corrupted this way.
- `splitRows` (the sale form's payment-row array) could go stale after a Girvi
  payment with no sale in between, causing a `TypeError` and `nowPaying.amount` silently
  landing at 0. Root cause: two leftover "clear stale rows" lines that belonged to a
  different form. Deleted.
- Invoice-number integrity, in 2 stages: F3 moved number assignment to a single atomic
  server-side counter at save time (previously only the first sale per session asked the
  counter; the device's own stale copy produced a real, confirmed-live duplicate:
  `INV-030` existed twice in the test shop). Then (30 Sep–3 Oct) a chain of HIGH findings
  on the counter's "floor" logic — a typed FY-style invoice number (`2025-26/001`) could
  permanently jump a shop's whole numbering series into the billions, or a crafted/typed
  huge number could overflow the Postgres integer and brick invoicing for that shop
  entirely. Fixed across 3 migrations (`004`→`005`→`006`, **all 3 confirmed present** in
  `supabase/migrations/`): 005 changed the floor's source from the mutable `nextInvNo`
  blob field to "highest real `INV-<digits>` bill + 1" (so nothing the client sends can
  move it), 006 added a cap so a crafted huge typed number more than 1000 above the real
  series doesn't count toward the floor at all. **Confirmed still applied** (migration
  files present; this was deployed live per multiple "VERIFIED LIVE" entries in the
  original file, not independently re-verified against the live database by this audit —
  no network access).
- A client-side companion fix (`_saveId` tracking, "unconfirmed save ids") stops a save
  that actually landed from being wrongly rolled back and resubmitted as a duplicate when
  its own confirmation response is delayed/lost. **This mechanism is the same one later
  review rounds (2 Oct, 3 Oct) found edge cases in** — see the two save-path review-cycle
  entries above. Its known cross-call misattribution risk (a stale call's leftover
  `_saveId` sitting in the shared, unscoped `_unconfirmedSaveIds` array could in rare cases
  be matched to the wrong save) was flagged twice (30 Sep, 2 Oct) and **is still present on
  `main` today** — scoping/redesigning that array was explicitly deferred both times,
  not fixed. **[uncertain whether this has been addressed since — nothing in the file
  says so; flagging as a standing known limitation, not confirmed resolved.]**
- GST defaulted to 0% on a GST-type bill (fixed: defaults to 3%, refuses saving a GST bill
  at literal 0%); Memo Bill still printed GST/HSN lines for shops with no valid GSTIN
  (fixed: Memo Bill strips all GST presentation); GSTIN/phone format validation added
  (format + mod-36 checksum for GSTIN).
- Market/collateral valuations used gross weight instead of net everywhere (Stock list,
  Girvi collateral/LTV, bill totals) — fixed to use net (`girviItemWt`, `mktVal`)
  throughout except printed labels (deliberately still gross, by design).
- Rates had no sanity bounds (₹0, ₹100, 22K priced above 24K all saved) — fixed with
  range/ordering checks, and **a shop that has never saved real rates now cannot record a
  sale or open a Girvi loan at all** until it does.
- Girvi had no loan-to-value guard at all (one test loan reached 474% LTV before anyone
  noticed) — fixed with a confirm above **75%** (Tanish's decision, the RBI cap, 30 Sep).
- Staff accounts losing Day Book and keeping Settings — flagged 2 Oct (Phase 0 audit),
  fixed 3 Oct (`4f6e791`, confirmed live — see the save-path entry above).

**Offline billing (batch44, 1 Oct):** each phone reserves 5 invoice numbers ahead of time;
an offline sale takes the next reserved number, applies locally, and queues
(`jewelos_sale_outbox`, shop-scoped) until the next successful cloud load replays it. **By-
design, permanent limits (ponytail-flagged, not bugs):** only sales work offline (Girvi,
orders, purchases, Day Book still need internet); 5 bills per outage per phone; 2+ phones
offline simultaneously can interleave/leave number gaps (gaps were already tolerated,
duplicates still impossible); the same item sold on 2 offline phones both succeed and the
stock ends at 0 with both sales recorded (not reconciled).

**Deploy/infra state reached by the end of this arc (30 Sep):** migrations 004/005
applied; `store-proxy` deployed to v8; `auth-gateway` deployed to v6 (session TTL cut from
12h to 6h). **Not independently re-verified live by this audit** (no network access) —
taken from the file's own "VERIFIED LIVE" entries at face value, each of which did its own
live byte/hash comparison at the time.

**Copy/UX fixes across this arc (batch42, etc.):** Hinglish → English on the app's own
screens (badges/toasts; WhatsApp messages to customers deliberately kept Hinglish); Girvi
icon 🥊→🤝; Sign Out ⚠→🚪; "1 orders"/"1 bills" → proper pluralization; VIP+Risky+New badge
clash fixed; Aadhaar/PAN removed entirely (`normaliseData` deletes any stored values on
load — irreversible by design); "Start Your Shop →" signup copy; product/stone-
weight/wastage/hallmark fields added; bill Edit/Refund/Delete surfaced on the bill preview
itself, not just inside the Customer popup.

**Netlify badge: see the corrected WAITING ON TANISH note above — this was never actually
resolved**, despite an early "hide with CSS" fix attempt (batch43) that didn't survive
contact with the real live badge markup.

**File-integrity incidents (1 Oct, Cowork, 2 separate warnings):** this file was partially
overwritten by a stale save at least twice during the heaviest QA period (entries went
missing, then were manually restored from git). Both were caught and repaired at the time;
flagging here as a reason to always re-read before writing, already captured in this
draft's header.

→ FOR COWORK: nothing — FYI only, fully historical.
→ FOR TANISH: nothing beyond what's already open in WAITING ON TANISH above.

---

### 2026-09-30 · F1–F4 hardening (invoice floor, failed-save rollback, cross-device sync gaps) — CONDENSED (10 original entries)

The save/sync foundation work the batch30+ QA cycle above was built on. In order:
**F3** moved invoice numbering to the atomic server counter at save time (superseded by
the 005/006 floor fixes above — same underlying mechanism, hardened further later).
**F4** made Girvi/order creation and edit/close/default/archive/recover all go through a
snapshot-lock-rollback pattern (`_girviCommit`/`_orderCommit`), so a failed cloud save now
rolls back locally and reopens the form for retry instead of silently losing the record —
previously a failed Girvi save would vanish on the next 15s auto-refresh, taking its
customer link and ornament photos with it. **F2** found `loadFromCloud` never read back
`auditLog`/`activityLog`/`waRules` at all (any fresh phone login would wipe them shop-wide
on its first save) and that `stockMovements` wasn't persisted anywhere, even locally —
fixed, all 4 now sync and are capped (activity 200, audit 300, stock 5000). An Opus
second-model review of this whole arc found one HIGH (the typed-FY-invoice-number floor
jump, see above, fixed via migration 004→005→006) and several MEDIUM/LOW items (a phone
clock running behind a token's remaining life being wrongly treated as "revoked" — fixed
by `store-proxy` returning an explicit `reason` field; `saveToCloud` having no fetch
timeout, able to leave locks stuck on a stalled connection — fixed, 60s attempt timeout).

→ FOR COWORK: nothing — FYI only, fully historical and superseded by later hardening above.
→ FOR TANISH: nothing.

---

## What's actually still open right now (cross-referenced against every LOG entry above)

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

*This file was condensed from an 84-entry, 2637-line history on 2026-10-03 by a
read-only audit (see `git log` for the commit). Nothing was deleted from the repo —
the full original history is available via `git log -- HANDOFF.md` / `git show` on any
commit before this one. A per-entry "what you lose by merging" list was produced at
condensation time; ask if you need it restated.*
