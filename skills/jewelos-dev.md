---
name: jewelos-dev
description: Use for any JewelOS code work - adding, changing or removing a feature, or fixing anything broken, blank, frozen, not saving or showing wrong data. Covers the house rules, module map, the five recurring bug families, the pre-handback checks, and honest verification.
---

# JewelOS development (change + debug)

## House rules (apply to every edit)

- **ES5 only** in `js/`. No arrow functions, `let`/`const`, template literals, `async/await`. Deliberate: older Android WebViews in tier-2 cities.
- **Escape by context.** `escHtml()` into `innerHTML`; `jsAttrEsc()` into inline `onclick="fn('...')"`. Wrong helper = live XSS.
- **No raw `localStorage` key for shop state.** Use `shopScopedKey(base)` from `00-config-state.js`. Unscoped keys leaked data across accounts six times.
- **Weight is derived.** Anything that changes `qty` recomputes `weight = unitWeight * qty`.
- **Do not rewrite the Girvi interest engine** (`girviLedgerState`, reducing-balance interest-first waterfall). Build additive views on top.
- **Byte-exact edits.** Files are full of `\uXXXX` escapes; string-replace tools mangle them. Use a Python read-modify-write script near them.
- **Server + client deploy together** when an Edge Function is involved. Either alone breaks sync.
- **Weigh every request against launch.** If it does not move JewelOS closer to sellable, say so before building.

## Modules (11 files, loaded in numeric order)

| File | Owns |
|---|---|
| `00-config-state.js` | Supabase config, constants, `S` state, shared helpers, save-lock watchdog |
| `01-sync-core.js` | Cloud load/save (`saveToCloud`), store-proxy calls, debounced renderers |
| `02-ui-inactivity-modals.js` | Inventory item modals, sale item entry, PIN inactivity |
| `03-billing-numbers.js` | Bills, GST, sale totals, order item rows |
| `04-orders-detail.js` | Orders, `SAAS`, PIN key helpers, `PLAN_LIMITS` |
| `05-auth-login.js` | Login/signup, staff, Razorpay, settings panel, digest |
| `06-inventory-stock.js` | Inventory list, stock, onboarding checklist |
| `07-settings-plans.js` | Settings tabs, audit views, girvi list rendering |
| `08-girvi-viewmode.js` | Girvi detail, receipts, `cloudDiag()` |
| `09-purchases.js` | Purchase bills, suppliers, purchase->stock sync |
| `10-daybook.js` | Day Book (rojmel): cash derivation, Close Day, locked-day adjustments |

Grep before assuming placement (`SAAS`, `PLAN_LIMITS`, PIN helpers live in the orders file). A new module file needs Tanish's explicit sign-off (the `10-daybook.js` exception of 20 Sep 2026 is not standing).

## Before writing anything

1. Work from the repo folder (`Desktop\jewelos`), not a stale zip. If a check references a function the build lacks, a newer copy exists: stop and ask.
2. Read `HANDOFF.md` top entries and claim NOW before editing; release after.
3. Large multi-item requests: split into batches, one theme each, riskiest item alone.

## Debugging

**Get a real symptom first:** what he clicked, what happened vs expected, the exact console error or screenshot, and whether it is fresh login / second account / one shop only. If it cannot be reproduced, say so and ask; do not guess (a "duplicate buttons" report once did not exist in code).

**Run the checks before reading code** (`check.bat`, or `scope` + `handlers` from `checks/`). A whole section going blank is almost always a missing reference.

**Five bug families, check these first:**
1. Unscoped `localStorage` key -> second account sees first account's data. Fix: `shopScopedKey()`.
2. Locally-nested function called from outer scope (`ordAdvance` inside `generateOrderReceipt()`). Fix: hoist to top level.
3. Reference to an id/function that never existed (`#add-prod-btn`, `#of-goldpurity`, `window.viewBill`). Button does nothing, no error. Fix: `ids` + `handlers` checks.
4. Position-based matching (settings tabs vs array order; staff tab array). Fix: explicit `data-` attribute.
5. Diagnostic/fallback testing a path that no longer exists (`cloudDiag()` sent the pre-v5 header). Fix: send exactly what the real path sends.

**Isolate:** reproduce -> narrow to one module -> patch that module. No whole-file rewrites unless asked. Follow the data: `S` is the single state object, `saveToCloud()` the single write path, `store-proxy` the single server path. For sync/save use `cloudDiag()` (Settings -> About, or console).

## Before handing back

- `check.bat` passes (syntax per file, scope, handlers, css, ids, load order, backup-check, roundtrip). Compare against the previous baseline: same hits, not new ones. `backup-check` and `roundtrip` must be clean; a failure means backup silently drops shop data.
- `node tests/regression.test.js` passes. Use fresh copies of ALL js files; stale copies give false failures.
- UI-visible changes: run the Playwright suite in `tests/e2e/` and, for new screens, a `verify-ui` click-through.
- Build the zip with `build-deploy-zip.js`; include a changelog saying what changed and why.

## Verifying the fix

State the failure mode in concrete inputs and observed behaviour, confirm the patch changes exactly that, re-run the checks.

Then say plainly what you could NOT verify. Logic is verifiable here; real-phone DOM behaviour is verified only to the extent e2e covers it. Never imply more.

## Logging

If the bug belongs to one of the five families, note it in the `HANDOFF.md` entry: the pattern repeating is the finding. Every HANDOFF entry ends with `-> FOR CLAUDE CODE:` and `-> FOR TANISH:`.
