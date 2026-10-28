# batch63 — Karigar Management feature (assignment, multi-stage work tracking, ledger + payments)

Base: the Cloudflare Worker's content as of batch62's deploy (`f126f36`, 24 Oct). Ten
substantive commits since, all shipping a new feature:

- `b4050ab` — Design spec for Karigar Management (assignment, sequential multi-stage
  chain, running balance + payments)
- `e43067b` — Register `S.karigars` and `S.karigarPayments` across all three persistence
  paths (cloud sync, offline cache, manual backup)
- `c788608` — Per-item Karigar Cost (cash or wastage-%) feeding real order/bill profit
- `c8d9123` — Karigar directory (`addOrGetKarigar`/`findKarigar`), same auto-create
  pattern as suppliers
- `a2c929e` — Replace single-karigar flat fields with a `karigarStages` array (supports a
  chain of karigars per item — e.g. gold work then diamond setting)
- `48fafc2` — Order item form: repeatable karigar-stage list replaces the single
  karigar-payment row
- `7a84410` — `markStageSubmitted()` and a "Mark Submitted" action in the order detail view
- `d3a24bb` — Derived karigar views (owed balance, monthly/lifetime stats, queue) and
  payment recording
- `3c86f23` — Fix `karigarOwed`/`karigarStats`: wastage is owed in grams, not rupees
  (unit-mismatch bug caught by Task 6's code review, before this ever shipped)
- `6429512` — Karigar list UI (Settings → Team): per-karigar queue, monthly/lifetime
  stats, owed balance, record payment
- `176b352` — Guard `promptKarigarPayment()`'s amount/type input and add a confirm step
  (Opus review of `6429512`, run after it had already landed — see below)

`7109b39` (Netlify decommission) also sits in this range but touches no `js/`/`index.html`
file — docs and `CLAUDE.md` only — and its edge-function side (auth-gateway v11,
store-proxy v12) was already deployed separately. Nothing for this Worker deploy to pick up.

## ✨ What changed

A full new feature, built spec-first and implemented as 7 SDD tasks:

- A karigar (jewellery craftsman) can be assigned to an order item, either paid in cash
  or in wastage-% of metal, with a locked rate captured at assignment time.
- An item can carry a **chain** of karigar stages (e.g. gold work → diamond setting),
  each with its own payment mode and locked rate.
- A stage is marked "Submitted" from the order detail view once the karigar hands the
  work back; only submitted stages count toward cost/profit and owed balance.
- Settings → Team now shows a card per karigar: pieces and amounts this month and
  lifetime (cash/gold/silver kept in separate buckets, never summed across metals), what's
  currently owed, and a "Record Payment" action.

**Task 7 fix round (`176b352`):** an Opus-model review (run after `6429512` had already
been committed — the only one of the 7 tasks that shipped without the project's standard
review gate) found `promptKarigarPayment()` would accept `Infinity` as an amount (owed
balance goes to `-Infinity`, then desyncs to `0`/`null` after a cloud round-trip), was
case-sensitive and didn't trim the payment-type prompt, and recorded a payment the moment
the last dialog closed — a typo'd amount or wrong metal permanently skewed the owed
balance with no way to undo it. Fixed: `isFinite` check, `.trim().toLowerCase()` on the
type, and a `confirm()` step before recording. Two regression tests added for the parts
Task 7 had shipped with zero test coverage.

## Not in this batch

Nothing else. No billing/GST/Girvi/Day Book logic touched; `karigarCostOf()` only adds a
cost line that was previously hardcoded to 0, it doesn't change how existing bills
without karigar stages are priced.

## 🔍 How this was checked

Full regression suite: 456/456 (453 pre-existing + 3 new from the Task 7 fix round). All
9 `checks/*.js` AST scripts run via `check.bat` — same documented-false-positive hits as
the batch62 baseline, nothing new; `backup-check` and `roundtrip` both clean.

**Verified against a real screen this session**, unlike recent batches: a throwaway
Playwright run against the local dev build (`localhost:4173`, the project's own isolated
E2E test shop) seeded a karigar with a submitted cash stage, confirmed the Settings → Team
card renders the name HTML-escaped and the cash/gold/silver owed amounts in separate
buckets, then clicked "Record Payment" through the real `prompt()`/`confirm()` dialogs —
the new confirm step appeared, the payment recorded, and the owed balance updated live
without a reload. Screenshots and the spec were discarded after use (not a permanent
suite addition). `jewelos-deploy-verifier` runs immediately after this deploy to confirm
the live origin actually serves it.
