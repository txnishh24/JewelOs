---
name: jewelos-change
description: Use when adding, changing or removing a feature in the JewelOS client — any request phrased as "add X", "make X do Y", "remove X", or a numbered master-prompt item. Covers locating the right module, the batching convention, and what must be verified before handing back a build.
---

# Changing JewelOS

## Before writing anything

1. **Get the real latest build.** Builds are handed over as `jewelos-*.zip` in
   `~/Downloads`. Sort by modification time, not by batch number — a `-fix` or
   `-copy` zip is often newer than the highest number. Confirm with Tanish which
   one he last deployed if it is ambiguous.
2. **Check `~/Downloads/jewelos-checks/`.** Read its README. Those scripts are the
   single biggest time-saver in this project; do not rebuild them. If a check
   references a function that does not exist in the build you were handed, that
   means a newer working copy exists — stop and ask before patching.
3. **Ask what the change is worth.** Every request gets weighed against launch.
   If it does not move JewelOS closer to sellable, say so plainly before building it.

## Finding the right module

Ten files, loaded in numeric order. Never create a new module file.

| File | Owns |
|---|---|
| `00-config-state.js` | Supabase config, constants, the `S` state object, shared helpers |
| `01-sync-core.js` | Cloud load/save, store-proxy calls, debounced renderers |
| `02-ui-inactivity-modals.js` | Inventory item modals, sale item entry, PIN inactivity |
| `03-billing-numbers.js` | Bills, GST, sale totals, order item rows |
| `04-orders-detail.js` | Orders, the SAAS state object, PIN key helpers, plan limits |
| `05-auth-login.js` | Login/signup, staff, Razorpay, settings panel, digest |
| `06-inventory-stock.js` | Inventory list, stock, onboarding checklist |
| `07-settings-plans.js` | Settings tabs, audit views, girvi list rendering |
| `08-girvi-viewmode.js` | Girvi detail, receipts, `cloudDiag()` |
| `09-purchases.js` | Purchase bills, supplier records, purchase→stock sync |

Grep before assuming. Functions live in surprising places — `SAAS`, `PLAN_LIMITS`
and the PIN key helpers are all in the orders file.

## House rules that are easy to violate

- **ES5 only.** Deliberate constraint for older Android WebViews in tier-2 cities.
  No arrow functions, `let`/`const`, template literals or `async/await` in `js/`.
- **Escape everything user-supplied.** `escHtml()` into `innerHTML`,
  `jsAttrEsc()` into inline `onclick="fn('...')"`. These are two different
  helpers for two different contexts; using the wrong one is a live XSS.
- **Never add a raw `localStorage` key for shop state.** Use `shopScopedKey(base)`
  from `00-config-state.js`. An unscoped key leaks one shop's data to the next
  account that logs in on the same device. This bug class has been found and
  fixed six separate times.
- **Do not rewrite the Girvi interest engine.** `girviLedgerState`'s
  reducing-balance interest-first waterfall is the strongest code in the app and
  encodes real historical bug fixes. Build additive views on top of it instead.
- **Weight is derived, never hand-maintained.** Anything that changes a product's
  `qty` must recompute `weight = unitWeight * qty`.
- **Byte-exact edits.** This codebase is full of `\uXXXX` escapes. String-replace
  tools mangle them; use a Python read-modify-write script for edits near them.

## Batching

Large multi-item requests get split into batches, one theme per batch, riskiest
item isolated on its own. Ship each batch as its own zip with a changelog
describing what changed and why — not just what file moved.

## Before handing back

Run all of these. A build that fails any of them is not ready:

```
node --check js/*.js                       # each file individually
cd ~/Downloads/jewelos-checks
node scope.js /path/to/build               # writes globals.json
node handlers.js /path/to/build            # needs scope.js first
node css.js /path/to/build
node ids.js /path/to/build
node loadorder.js /path/to/build
node backup-check.js /path/to/build
node roundtrip.js /path/to/build
```

Compare against the previous build's output rather than reading hits as absolute
failures — most are known false positives, documented in the checks README.
`backup-check` and `roundtrip` must pass cleanly; a failure there means the backup
is silently dropping shop data.

Then say plainly what you could **not** verify. There is no browser automation
here and no UI test coverage — every DOM-level change is unverified until Tanish
clicks it. Never imply otherwise.

## Delivering

Zip the build, send it, and write it back to `~/Downloads`. Include a changelog
file in the zip. If server-side work is involved, say explicitly that the Edge
Function and the client must deploy together — either alone breaks sync.
