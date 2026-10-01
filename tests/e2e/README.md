# JewelOS end-to-end tests (Playwright)

This is the layer `docs/TESTING-STRATEGY.md` calls "Manual: real phone" —
the one that was "not automated" until this suite existed (26 Sep 2026).
`tests/regression.test.js` and `tests/edge-functions.test.js` test logic and
server code; this suite is the first thing in the repo that actually opens
a browser and clicks the app, the way `skills/verify-ui.md`'s ad-hoc
Playwright-MCP checks do, except persisted as a real suite you re-run.

**This does not replace phone testing.** It catches DOM/wiring regressions
before a build ships; a real phone on real network conditions is still the
final check, same as `skills/verify-ui.md` says.

## Setup (one-time)

`.env.test` lives at the **repo root** (`Desktop\jewelos\.env.test`), not in this
`tests/e2e/` folder — `playwright.config.js` loads it from there. Run these from the
repo root, not from `tests/e2e/`:

```
npm install
cp .env.test.example .env.test   # only if .env.test doesn't already exist
```

Fill in `.env.test` with the test shop's credentials (see "The test shop"
below — they should already be in the copy on this machine; check
`HANDOFF.md` if not).

## Running

```
npm run test:e2e          # headless, once
npm run test:e2e:headed   # watch it click through the app
npm run test:e2e:ui       # Playwright's interactive UI mode
npm run test:e2e:report   # open the HTML report from the last run
```

No separate `npm start` needed — Playwright's `webServer` config spins up
`tests/e2e/static-server.js` (a zero-dependency static file server, since
this app has no build step) automatically and tears it down after.

## The test shop

Every spec runs against ONE real, permanent shop on the live production
Supabase backend: **"E2E Test Shop (do not delete)"**
(`mysticmedia2407+jewelos-e2e@gmail.com`). There is no local/offline mode
for JewelOS to test against, so this is deliberate, not a shortcut:

- **One shop, not one-per-run.** JewelOS has a documented history of
  throwaway QA shops piling up in the live DB and nobody cleaning them up
  (seven of them, as of the 26 Sep 2026 cleanup). Using a single permanent,
  clearly-named shop avoids repeating that.
- **Isolation without deletion.** Instead of resetting the shop's data
  before each run, every piece of data a test creates is tagged with a
  unique run marker (`E2E-<timestamp>`, from `fixtures/testShop.js`'s
  `runId()`) in its name/description. Runs never collide, and any test
  shop record is instantly recognizable as test data, by anyone, without
  needing to know which run made it.
- **Never delete this shop.** If it ever needs to be recreated, sign up a
  new one through the live site exactly like `HANDOFF.md` describes, set
  its 4-digit owner PIN, and update `.env.test`.

## Why `fullyParallel: false` / `workers: 1`

All specs share that one live shop and its one Day Book. Two tests writing
sales into the same shop at the same time would make the Day Book
arithmetic checks (`daybook.spec.js`) flaky for reasons that have nothing
to do with a real bug. Serial execution trades speed for not chasing
phantom failures — the whole suite still runs in well under a minute.

## Selector strategy — read this before adding a spec

JewelOS renders every screen's markup into the DOM up front and toggles
visibility with CSS rather than mounting/unmounting per route. Two
consequences that aren't obvious from the outside:

1. **Placeholder and button-text selectors are NOT reliably unique.** The
   login, signup and forgot-password forms all have an email field with
   the placeholder `you@email.com`, for example — three different real
   ids (`#auth-email` / `#signup-email` / `#forgot-email`), same visible
   placeholder text. `getByPlaceholder`/`getByText` across the whole page
   will throw Playwright's strict-mode "multiple elements match" error.
2. **Real element ids are the reliable selector**, and this codebase has
   good, stable ones (`#s-cust`, `#gf-principal`, `#bn-daybook`, etc. — one
   per field, matching the `js/*.js` module that owns that screen). Prefer
   `page.locator('#some-id')` over text/placeholder/role selectors
   whenever a field has one.
3. **Dynamically-added rows** (sale line items, girvi pledged items, split
   payment rows) don't have their own ids — but their *container* does
   (`#custom-sale-items`, `#gf-items-list`, `#split-payments-wrap`). Scope
   a `placeholder=`/`select`/`input[type=]` lookup inside that container
   rather than searching the whole page.
4. **Repeating list rows** (a Girvi loan card, a Day Book line) use a
   stable CSS class per row (`.girvi-card`, `.gl-entry`) with no nesting —
   `page.locator('.girvi-card', { hasText: customerName })` finds one row
   unambiguously; a bare `div` selector with `hasText` would also match
   every ancestor container that happens to contain that text.

All of the above was confirmed against the live DOM on 26 Sep 2026, not
guessed from the HTML source. If a selector in this suite starts failing,
that's either a real regression or the id got renamed in a later batch —
check the live DOM (`document.getElementById(...)` in the browser console,
or a JS snippet like the ones used to build this suite) before assuming
the test is simply wrong.

## What's covered so far

| Spec | Covers |
|---|---|
| `auth.spec.js` | Login form, wrong password, login, logout, owner-PIN gate on Settings |
| `sale.spec.js` | Cash sale end-to-end incl. gold-value math; UPI sale; both checked against Day Book |
| `girvi.spec.js` | Full 5-step Girvi wizard; a backdated Ledger payment reduces the balance correctly |
| `daybook.spec.js` | Closing = Opening + Cash In − Cash Out, always |
| `invoice-date.spec.js` | New Sale date defaults to the local IST day even just after midnight (deterministic clock-freeze regression test) |

## What's NOT covered (same gaps `docs/TESTING-STRATEGY.md` names)

Purchases, Orders, Customers, Reports/GST export, staff PIN / multi-user
role gating, Close Day / locked-day adjustments, the Netlify-badge
nav-overlap bug (confirmed still live 26 Sep 2026 — a hosting/deploy issue,
not something a DOM test can fix), and anything about how it actually
feels on a real phone. Add specs here as these get prioritized — follow
the selector strategy above and this repo's `skills/jewelos-dev-rules.md`.
