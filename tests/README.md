# JewelOS Regression Suite

Run this **every time** before deploying a change, and every time after
making one — it takes about 2 seconds.

```
node tests/regression.test.js
```

Exits with code 0 if everything passes, code 1 if anything fails (so it
can gate a deploy script if you ever set one up).

## What this does and doesn't do

It loads your actual `js/*.js` files into a sandboxed environment and
tests the real calculation functions directly — not a copy of the logic,
the actual code that runs in the browser. If you edit `girviLedgerState`
or `calcSaleTotals` and break something, this catches it before your
customers do.

It does **not** test the UI, DOM rendering, button clicks, or anything
visual. It only tests the math and logic functions. You still need to
click through the app on a real phone before shipping — this suite and
manual testing are not substitutes for each other.

## When you add a new bug fix

Add a new `test(...)` block to `regression.test.js` describing the bug in
plain English, matching the pattern of the existing tests. Future-you (or
whoever works on this next) will thank present-you.

## Requires

Node.js (any reasonably recent version). No npm install needed — zero
dependencies, uses only Node's built-in `vm` module.

## Server-side: `edge-functions.test.js`

```
node tests/edge-functions.test.js
```

The suite above tests the app in the browser. This one tests the **Edge
Functions** (`supabase/functions/auth-gateway` and `store-proxy`) — the login
and data-access code that runs on Supabase. Run it before deploying any change
there. It is not part of `check.bat`, because nothing in `check.bat` touches
the server.

It runs the real function code against a fake database, so it proves the
functions behave correctly — but not that the SQL in `supabase/migrations/`
works. That still has to be checked against the live project.

Unlike the browser suite it needs one tool, `sucrase`, to read TypeScript. It
finds a copy on its own if one is installed; otherwise it prints `SKIPPED`
rather than failing.

## Browser: `tests/e2e/`

Both suites above load code directly — nothing here opens a screen. `tests/e2e/`
(Playwright, `npm run test:e2e` from the repo root) has 10 specs — login, sale,
Girvi, Day Book, purchase, offline billing, invoice numbers/dates, session restore
and failed saves — against a real permanent test shop. See `tests/e2e/README.md`
for the current list.

## `tests/cowork-live-check.js`

```
node tests/cowork-live-check.js
```

Despite the name, this is **local and offline** like the suite above — no network,
no live Supabase. "Live" means it drives the real UI-facing functions (`recordSale()`,
`renderDayBook()`) through the harness's fake DOM, one level past the regression
suite's direct calls to inner helpers. Written 26 Sep; **not currently part of
`check.bat`** and, as of 3 Oct, fails standalone (`recordSale()` doesn't save —
most likely a stale fixture that predates the 30 Sep rates-required-before-a-sale
change, not confirmed as a real app bug). Needs a look before it's trusted or wired
into `check.bat`. Run via the `jewelos-test-runner` agent.
