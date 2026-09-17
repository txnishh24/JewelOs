# JewelOS — Testing Strategy

_Written 16 Sep 2026, against the live repo: `checks/` (9 static scripts), `tests/regression.test.js` (66 tests), `tests/edge-functions.test.js` (20 tests), as of batch19._

This is not a "start from zero" plan — JewelOS already has a real, three-layer test setup, and it's better than most solo projects this size. This document maps what exists onto the standard testing pyramid, says what each layer actually buys you, and lists the specific gaps worth closing next — in priority order, with example test cases Claude Code can implement directly.

## 1. What you already have, mapped to the pyramid

```
        /   Manual: real phone    \    Not automated. Required before every ship.
       /------------------------- \
      /  Integration: edge-fns.test \  20 tests, fake DB, Supabase functions
     /------------------------------ \
    /   Unit: regression.test.js      \  66 tests, real js/*.js loaded in a VM
   /---------------------------------- \
  /  Static: checks/ (9 scripts)        \  Structural — catches silent breakage
 /---------------------------------------\
```

**Static layer — `checks/*.js`.** Not tests in the usual sense: they read source and flag references to things that were never defined (`scope.js`, `handlers.js`, `css.js`, `ids.js`, `loadorder.js`), plus three narrower checks (`backup-check.js`, `roundtrip.js`, `making-basis.js`, `unquoted-args.js`). This layer exists because JewelOS is plain ES5 with no build step and no TypeScript — nothing else would catch a dead button or an undefined global before a customer hits it. Genuinely unusual to have this for a project this size, and it's already paid for itself (`unquoted-args.js` was built after it silently broke order payments).

**Unit layer — `regression.test.js`.** 66 tests, run against the actual `js/*.js` files in a sandboxed VM — not reimplemented copies of the logic. Strong coverage of the parts that lose money or data if wrong: girvi interest/penalty/refund math, GST reconciliation, subscription/`paidUntil` gating (including the 7-day grace boundary), atomic counters under simulated concurrency, CAS-write conflict handling, stock quantity math across purchase/sale/edit/delete, and — since batch19 — the escaping fixes and forced-signout behavior.

**Integration layer — `edge-functions.test.js`.** 20 tests against `store-proxy` and `auth-gateway` running for real against a fake database. Covers the two deployed security fixes well: removed-staff cutoff, role-from-current-record (not token), the reset-code guess cap, and the `hasMarkup` guard's exact boundary (rejects `<`/`>`, still accepts `&` and apostrophes).

**Manual layer — real phone.** Deliberately not automated, and the README is explicit that this suite and phone-testing aren't substitutes for each other. This is the layer least exercised recently — `current-priorities.md` still carries "not verified: a real phone" as an open caveat on the last two ships.

## 2. What this setup does NOT tell you (by design, per its own README)

- The SQL in `supabase/migrations/` — `edge-functions.test.js` tests function *code* against a fake DB, not the real migration running on the real project.
- Anything visual, DOM, or touch-driven. No click simulation, no rendering.
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
| Concurrent writes to the same stock item, two devices | Simulated only (single-process) | **Partial gap** | See 4.2 |
| Backdated girvi payments | None found in either suite | **Gap** | See 4.3 |
| `readonly` role write-blocking | Not explicitly named in the 20 edge-fn tests | **Possible gap** | See 4.4 |
| Live RLS / anon-access posture | Ad hoc (`get_advisors`, `pg_policies`) | **Gap — not repeatable** | See 4.5 |
| UI / visual / real phone | Manual only | Known, accepted gap | Keep manual; don't pretend otherwise |

## 4. Specific gaps, with example test cases

### 4.1 `razorpay-webhook` has zero tests
This function is currently "parked, not deleted" per your own notes, and the open question is whether to take it offline while payments aren't live. Either way, it's the one server function with no coverage at all. Before it's ever live for a real transaction:

- Valid HMAC signature → 200, payment recorded.
- Missing/wrong `x-razorpay-signature` → rejected, nothing written.
- `RAZORPAY_WEBHOOK_SECRET` unset → fails closed (throws), not silently accepted — you reasoned this by code inspection earlier; a test would prove it instead of relying on reading the code correctly.
- Replay of the same webhook payload → doesn't double-record the payment.

### 4.2 Two devices selling the last unit of the same item
`current-priorities.md` lists this as a known, unresolved limitation ("No server-side stock reservation — two devices can both sell the last item"). The regression suite's CAS-write test proves a *stale version* gets rejected in principle, but there's no test that simulates two concurrent `recordSale()` calls against the same batch racing for the last unit and confirms exactly one wins and the loser gets a clean, handled failure (not a silent oversell). Worth writing even if the fix itself is deferred — so the failure mode is *known and tested*, not just known.

### 4.3 Backdated girvi payments silently clamp to today
Listed as a known limitation but no test asserts the actual clamping behavior (e.g., a payment dated to a past date gets recorded as today, and — the real question — does that change interest already accrued for the intervening days?). A test here turns a vague "known issue" into a documented, checked behavior.

### 4.4 `readonly` role and writes
`store-proxy` defines `CAN_WRITE = {owner, manager, staff}` excluding `readonly`, and one test confirms role comes from the live record rather than the token — but skimming the 20 test names, none is explicitly "a readonly-role user's PUT/POST is rejected with 403." Worth confirming this is actually covered before treating it as settled; if it isn't, it's a five-minute test to add given the fixture setup already exists.

### 4.5 Live RLS / anon-access posture has no repeatable check
The zero-policies, RLS-enabled-on-everything posture was confirmed by hand this cycle (`get_advisors`, `pg_policies` query) but there's nothing that re-checks this automatically after a migration. A lightweight script — even just `select count(*) from pg_policies where schemaname='public'` gated to expect `0`, run after every `apply_migration` — would catch a future migration that accidentally opens a table back up, instead of relying on someone remembering to check.

## 5. What to skip, deliberately

Per the standard pyramid guidance and this app's actual risk profile: no load/performance testing yet (you have effectively zero concurrent real users — this becomes relevant only once a shop is live and using it daily, not before); no accessibility test suite (internal tool for one shop owner and staff, not a public-facing product); no visual regression tooling (ES5 + no build step makes screenshot-diffing more setup than it's worth at this scale). Revisit all three once there's more than one paying shop.

## 6. The one thing that actually matters more than any of this

Every suite here — static, unit, integration — tests logic. None of them have run against a real phone with a real jeweller's hands on it recently. That gap isn't a testing-strategy problem to solve with more test code; it's the actual next step already sitting at the top of `current-priorities.md`. Closing the gaps in section 4 is worth doing. It is not a substitute for that.
