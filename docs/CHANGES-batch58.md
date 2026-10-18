# batch58 — Edit Bill money bugs, ORD_STATUS crash guard, reset-email diagnostics, polish

Base: the Cloudflare worker's content as of batch57's 17 Oct deploy (`89b3824`). This
batch covers everything committed since: `96dfb36`, `3db6878`, `950f3cb`, `839d72e`
(HANDOFF-only commits in between touch no served file).

## ✨ What changed

**1. Edit Bill money bugs (`js/01-sync-core.js`, `js/02-ui-inactivity-modals.js`) —
queue item 2, implemented and independently re-reviewed by two separate Opus passes
before this deploy.**
- Removing a split-payment row left a gap in the `ebsp-amt-N` DOM ids; the collection
  loop in `_applyEditBillForm()` stopped at the first gap, silently dropping every row
  after it from both Save and the live preview. Now queries every amount input actually
  present in `#eb-splits-wrap` instead of assuming contiguous ids.
- Bills with a refund (full OR partial) were still editable, even though
  `calcSaleTotals()` never accounts for `sale.refunds` — editing re-locks a grand total
  existing refunds were never checked against. New `_saleHasRefund()` guard in
  `openEditBill()` and `saveEditBill()`.
- Bill-level "Extra making"/"Extra diamond" (`sale.making`/`sale.diamond`, set via New
  Sale) had no field in Edit Bill at all, and the invoice's item table never showed them
  as a line even though the totals footer already included them — so the item rows
  never summed to the Grand Total. Added `eb-making`/`eb-diamond` fields and an "Extra
  charges" invoice row.

**2. `ORD_STATUS` unknown-status crash risk (`js/03-billing-numbers.js`,
`js/04-orders-detail.js`) — queue item 4.** `ordStatusOf()` (added 16 Oct) existed but
was wired into only 1 of 7 `ORD_STATUS[...]` lookups. Generalized it to accept a bare
status string too (not just an order object), and routed the 5 genuinely unguarded sites
in `04-orders-detail.js` through it — the order-detail badge, `updateOrdStatus()`'s
notify/toast lines, and the order receipt.

**3. Operator-only reset-email diagnostics (`js/08-girvi-viewmode.js` client half;
`supabase/functions/auth-gateway/index.ts` server half — see "Two deploy targets"
below) — queue item 3.** Traced the "false reset code sent" report end to end: the
generic "a reset code has been sent" response surviving a genuine send failure is
deliberate, tested anti-enumeration design, not a bug — changing it would reopen
account enumeration. Added a new `email-status` route instead (account-independent,
reveals nothing new) and a matching line in `cloudDiag()` (Settings → About → Run Cloud
Diagnostics) so Tanish can tell when the reset-email pipeline is dead or stuck on
Resend's sandbox sender.

**4. Polish (`index.html`, `js/08-girvi-viewmode.js`) — queue item 5, 3 of Cowork's 4
36th-entry findings (the 4th, hiding the Cloud Setup SQL block, was already shipped 15
Oct).**
- Dropped the dev-only "Run SQL setup in Settings → Data → Cloud Setup" banner from the
  v18.1 "What's New" modal — it reached every user via `bootApp()` with no role check,
  pointing at a screen now hidden behind `?dev=1` and never an owner's task anyway.
- `#s-phone`/`#of-phone` placeholders changed from "98765 43210" (looks like a real
  saved number) to "Mobile number".
- Sale screen's card title/subtitle shortened ("New Sale / Invoice" / "Enter customer
  and item details" → "New Sale" / "customer & items") to stop it wrapping to 2 lines at
  390px — argued by length comparison to a sibling card-title known to fit, **not
  screen-verified**.

## 🔍 How this was checked

`check.bat` on `839d72e`: syntax OK on all 11 `js/*.js` files, regression suite **427
passed, 0 failed** (423 before this session), backup-check and roundtrip both PASS, AST/
scope checks clean (only `checks/globals.json`'s own auto-regenerated variable cache
changed). `tests/edge-functions.test.js` run separately (not part of `check.bat`): 73
passed, 0 failed, including 3 new tests for the `email-status` route.

The Edit Bill fix specifically: implemented by one Opus agent, then independently
re-reviewed by a second, fresh Opus agent against the diff (refund-guard coverage
across every caller, the split-row selector's edge cases, invoice GST math agreement,
edit-history snapshot completeness) — verdict: no confirmed bugs, one condition (run the
real Playwright e2e spec). That spec could not be run from this session — login step
times out, `.env.test` likely missing but categorically inaccessible to every tool this
session has. Tanish reviewed and said deploy anyway.

**Not verified against a live screen:** the Sale-title-wrap fix (polish item 4) and the
full Edit Bill flow on a real device — no way to render a logged-in screen from this
session. Worth both on the next phone pass.

## sw.js — intentionally untouched

Same reasoning as batch55/56/57: `sw.js` (`jewelos-v20`) is network-first, so an
already-installed device picks up this batch's files on its next online fetch. No
cache-name bump needed.

## Two deploy targets, not one

Unlike batch55-57 (Cloudflare-only), this batch also needs a Supabase Edge Function
deploy: `supabase functions deploy auth-gateway`, for the new `email-status` route (#3
above). Without it, `cloudDiag()`'s new "Reset-email" line will report "could not check"
(it's wrapped in a `.catch()`, not a hard failure) until that function redeploys.

## Not in this batch

`tools/backup-store.js` (committed earlier this session, queue item 1) is a local Node
script, never served — no deploy implication. No migration, no RLS change, no
`store-proxy`/`razorpay-webhook` touch.
