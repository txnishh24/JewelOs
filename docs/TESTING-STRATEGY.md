# JewelOS — Testing Strategy

_Written 16 Sep 2026, against the live repo: `checks/` (9 static scripts), `tests/regression.test.js` (66 tests), `tests/edge-functions.test.js` (20 tests), as of batch19._

This is not a "start from zero" plan — JewelOS already has a real, three-layer test setup, and it's better than most solo projects this size. This document maps what exists onto the standard testing pyramid, says what each layer actually buys you, and lists the specific gaps worth closing next — in priority order, with example test cases Claude Code can implement directly.

## 1. What you already have, mapped to the pyramid

```
        /   Manual: real phone    \    Not automated. Still required before every ship.
       /------------------------- \
      /  Browser: tests/e2e/        \  Playwright, added 26 Sep 2026 — login, sale, Girvi, Day Book
     /------------------------------ \
    /  Integration: edge-fns.test     \  20 tests, fake DB, Supabase functions
   /---------------------------------- \
  /  Unit: regression.test.js           \  66 tests, real js/*.js loaded in a VM
 /---------------------------------------\
/  Static: checks/ (9 scripts)            \  Structural — catches silent breakage
--------------------------------------------
```

**Browser layer — `tests/e2e/` (added 26 Sep 2026).** The gap section 2 below used to
call "the biggest gap" — nothing opened a browser and clicked anything. Playwright,
running against a real permanent test shop on live Supabase (not a fake DB, unlike
the integration layer above it). Covers login/logout/owner-PIN, a cash sale's
gold-value math end to end, a UPI sale, the full 5-step Girvi wizard plus a backdated
Ledger payment, Day Book's Closing arithmetic, and a deterministic regression test for
the midnight UTC-vs-IST invoice-date bug. See `tests/e2e/README.md` for what it does
and doesn't cover, and its selector-strategy section before adding to it — this
codebase's render-everything-up-front DOM has real gotchas for selector choice that
aren't obvious from the HTML alone.

**Static layer — `checks/*.js`.** Not tests in the usual sense: they read source and flag references to things that were never defined (`scope.js`, `handlers.js`, `css.js`, `ids.js`, `loadorder.js`), plus three narrower checks (`backup-check.js`, `roundtrip.js`, `making-basis.js`, `unquoted-args.js`). This layer exists because JewelOS is plain ES5 with no build step and no TypeScript — nothing else would catch a dead button or an undefined global before a customer hits it. Genuinely unusual to have this for a project this size, and it's already paid for itself (`unquoted-args.js` was built after it silently broke order payments).

**Unit layer — `regression.test.js`.** 66 tests, run against the actual `js/*.js` files in a sandboxed VM — not reimplemented copies of the logic. Strong coverage of the parts that lose money or data if wrong: girvi interest/penalty/refund math, GST reconciliation, subscription/`paidUntil` gating (including the 7-day grace boundary), atomic counters under simulated concurrency, CAS-write conflict handling, stock quantity math across purchase/sale/edit/delete, and — since batch19 — the escaping fixes and forced-signout behavior.

**Integration layer — `edge-functions.test.js`.** 20 tests against `store-proxy` and `auth-gateway` running for real against a fake database. Covers the two deployed security fixes well: removed-staff cutoff, role-from-current-record (not token), the reset-code guess cap, and the `hasMarkup` guard's exact boundary (rejects `<`/`>`, still accepts `&` and apostrophes).

**Manual layer — real phone.** Deliberately not automated, and the README is explicit that this suite and phone-testing aren't substitutes for each other. This is the layer least exercised recently — `current-priorities.md` still carries "not verified: a real phone" as an open caveat on the last two ships.

## 2. What this setup does NOT tell you (by design, per its own README)

- The SQL in `supabase/migrations/` — `edge-functions.test.js` tests function *code* against a fake DB, not the real migration running on the real project.
- Anything visual, DOM, or touch-driven that `tests/e2e/` doesn't cover yet (see its
  README — Purchases, Orders, Customers, Reports/GST export, multi-user staff PIN
  gating, and Close Day are all still untested at the DOM level, and no suite here
  checks actual rendering/layout — only that the right data reaches the right element).
- `razorpay-webhook` — not present in either suite at all.
- Live Supabase state (RLS policies, advisors, storage buckets) — that's `get_advisors`/`pg_policies` queries run ad hoc, not a repeatable test.

None of this is a criticism of the existing suites — they're doing what they say. It's the honest list of what "all green" does not currently promise you.

## 3. Coverage targets by area

| Area | Test type | Current state | Target |
|---|---|---|---|
| Financial math (girvi, GST, stock qty) | Unit (`regression.test.js`) | Strong | Maintain — add a test with every new bug fix, per the suite's own README |
| Auth/session (store-proxy, auth-gateway) | Integration (`edge-functions.test.js`) | Strong for what's deployed | Extend to `razorpay-webhook` (see below) |
| Structural integrity (dead code, missing CSS/ids) | Static (`checks/*.js`) | Strong | Maintain — run `check.bat` before every deploy, not just before some |
| Migrations (SQL itself) | None | **Gap** | At minimum: re-run the relevant `regression`/`edge-functions` suites immediately after every `apply_migration`, against real project data, not just fake-DB |
| `razorpay-webhook` | None | **Gap** | Add before payments go live — see 4.1 |
| Concurrent writes to the same stock item, two devices | Simulated only (single-process), 4 tests added 18 Sep | **Closed at the unit level — real-device race still unverified** | See 4.2 |
| Backdated girvi payments | Simulated only (single-process), tests added 18 Sep | **Closed at the unit level — real-device entry still unverified. Correction: this was never a bug (see 4.3)** | See 4.3 |
| `readonly` role write-blocking | Not explicitly named in the 20 edge-fn tests | **Possible gap** | See 4.4 |
| Live RLS / anon-access posture | Ad hoc (`get_advisors`, `pg_policies`) | **Gap — not repeatable** | See 4.5 |
| UI / visual / real phone | Manual + `tests/e2e/` (login, sale, Girvi, Day Book) | Partially closed 26 Sep 2026 | Extend `tests/e2e/` to Purchases/Orders/Customers/Reports; real phone still required before ship |

## 4. Specific gaps, with example test cases

### 4.1 `razorpay-webhook` has zero tests
This function is currently "parked, not deleted" per your own notes, and the open question is whether to take it offline while payments aren't live. Either way, it's the one server function with no coverage at all. Before it's ever live for a real transaction:

- Valid HMAC signature → 200, payment recorded.
- Missing/wrong `x-razorpay-signature` → rejected, nothing written.
- `RAZORPAY_WEBHOOK_SECRET` unset → fails closed (throws), not silently accepted — you reasoned this by code inspection earlier; a test would prove it instead of relying on reading the code correctly.
- Replay of the same webhook payload → doesn't double-record the payment.

### 4.2 Two devices selling the last unit of the same item — CLOSED at the unit level, 18 Sep
`current-priorities.md` lists this as a known, unresolved limitation ("No server-side stock reservation — two devices can both sell the last item"). **Claude Code wrote the test on 18 Sep**: two simulated devices at store-proxy's shared version, both selling the last unit. Exactly one sale reaches the cloud; the loser's CAS write is rejected and it rolls back its own sale and stock, so quantity never goes negative. A second test pins the actual gap this doesn't close: the *loser* is still showing stale data afterward — the CAS write protects the stored number, it does not stop the second device believing the item is still on the shelf until its next poll. That second test is the real state of "no server-side stock reservation": if it ever starts failing, reservation has been built.

Regression suite is at 103/103 including these. **Still not verified: two real devices, live**, racing for a real last unit — this is two simulated clients in one process against a modelled store, which proves the failure mode but not that production behaves this way under real concurrency.

### 4.3 Backdated girvi payments — this was never a bug; correcting this document
This section originally read "Backdated girvi payments silently clamp to today" and listed it as a limitation needing a test. **That was wrong, and Claude Code's 18 Sep investigation caught it**: nothing clamps a backdated payment to today. `girviLedgerState` sorts on `pay.date` and accrues up to it, so a payment entered with a genuinely past date is honoured — paying two months ago really does stop interest from two months ago, which is correct behaviour for a shop recording a late payment. The `gl-date` input has no `max` either.

What the code actually protects, in depth, is the *other* direction: a payment dated **before the loan itself started** is clamped up to the ledger's start cursor, and `accrueTo()` independently refuses a negative span so the cursor can never rewind. So a payment backdated to before day one is treated as day one — it cannot manufacture interest relief that never accrued. That's a safety property, not a limitation.

Four tests were added 18 Sep pinning both halves: a payment backdated *within* the loan period is honoured (owes less than the same payment entered today), and a payment backdated *before* the loan cannot invent relief (removing both the clamp and `accrueTo`'s guard together makes the difference concrete: ₹14,400 of invented relief on a ₹78,400 balance). Regression suite 103/103. **Still not verified: a real backdated entry typed into a real phone** — the engine is tested, the UI path to it is not.

### 4.4 `readonly` role and writes
`store-proxy` defines `CAN_WRITE = {owner, manager, staff}` excluding `readonly`, and one test confirms role comes from the live record rather than the token — but skimming the 20 test names, none is explicitly "a readonly-role user's PUT/POST is rejected with 403." Worth confirming this is actually covered before treating it as settled; if it isn't, it's a five-minute test to add given the fixture setup already exists.

### 4.5 Live RLS / anon-access posture has no repeatable check
The zero-policies, RLS-enabled-on-everything posture was confirmed by hand this cycle (`get_advisors`, `pg_policies` query) but there's nothing that re-checks this automatically after a migration. A lightweight script — even just `select count(*) from pg_policies where schemaname='public'` gated to expect `0`, run after every `apply_migration` — would catch a future migration that accidentally opens a table back up, instead of relying on someone remembering to check.

## 5. What to skip, deliberately

Per the standard pyramid guidance and this app's actual risk profile: no load/performance testing yet (you have effectively zero concurrent real users — this becomes relevant only once a shop is live and using it daily, not before); no accessibility test suite (internal tool for one shop owner and staff, not a public-facing product); no visual regression tooling (ES5 + no build step makes screenshot-diffing more setup than it's worth at this scale). Revisit all three once there's more than one paying shop.

## 6. The one thing that actually matters more than any of this

Every suite here — static, unit, integration — tests logic. None of them have run against a real phone with a real jeweller's hands on it recently. That gap isn't a testing-strategy problem to solve with more test code; it's the actual next step already sitting at the top of `current-priorities.md`. Closing the gaps in section 4 is worth doing. It is not a substitute for that.
