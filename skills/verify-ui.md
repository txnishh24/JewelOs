---
name: verify-ui
description: Use when verifying a UI change, or before any release, once check.bat has passed. Click through the app in a real browser with Playwright — check.bat and the regression suite only test logic, never the screen.
---

# Verifying JewelOS in a browser

`check.bat` tests syntax, math, and dead references. It does not open a screen. This
closes that gap using whichever Playwright MCP tools are available in your environment
(the exact tool-name prefix differs between Claude Code and Cowork's device bridge —
check your own tool list rather than assuming a specific name) — actually load and
click the app instead of reading code and assuming it renders.

This is the ad-hoc, exploratory version of that check — for the specific flow a
change touches, right now, in this session. `tests/e2e/` (`npm run test:e2e`) is the
persisted version: a real Playwright suite, re-run every time, now 10 specs covering
login, sale, Girvi, Day Book, purchase, offline billing, invoice numbers/dates,
session restore and failed saves. Run both when they overlap — the suite catches a
regression on the NEXT change even if nobody thinks to walk that flow by hand again;
this skill is still how you check the one flow you just touched, or anything the
suite doesn't cover yet. See `tests/e2e/README.md`'s "What's covered so far" table
for the current list, especially its selector-strategy section, before adding a new
persisted spec instead of writing another one-off manual pass here.

## When

- Any change touching `js/` that isn't a pure backend/logic fix
- Before handing back a build (pairs with the `Evidence Collector` agent routing in `CLAUDE.md`)
- After a Girvi, billing, or daybook change specifically — these have the deepest DOM state

## How

1. `check.bat` must be green first. This is the next step after that, not a replacement.
2. Serve the folder locally (e.g. `npx serve .`, or any static server — this is a PWA
   with no build step) and navigate Playwright to it.
3. Walk the flow the change touches, not the whole app:

| Change touches | Walk this flow |
|---|---|
| `03-billing-numbers.js` | Create a sale, add items, confirm GST/total, save the bill |
| `04-orders-detail.js` | Open Orders, check PIN gating, plan-limit banners |
| `05-auth-login.js` | Log out, log back in, staff PIN entry |
| `06-inventory-stock.js` | Add stock, edit an item, confirm weight recomputes from qty |
| `08-girvi-viewmode.js` | Open a Girvi item, view interest/receipt — do not touch the interest engine itself |
| `09-purchases.js` | Record a purchase, confirm it lands in stock |
| `10-daybook.js` | Close Day, confirm cash-in/out derivation, check a locked-day adjustment |

4. Screenshot anything that looks wrong and report it — do not silently retry.
5. State plainly what you clicked and what you didn't. "Verified billing, did not touch
   Girvi" is a real report. "Looks fine" is not.

## What this does not replace

A real phone, on real network conditions, is still the final check before shipping to
Tanish's customers. This catches layout/rendering breaks Claude would otherwise only
guess about — it is not a substitute for Tanish's own pass.
