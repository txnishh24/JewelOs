# batch65 — Karigars tab and order-form stage box redesign (presentation only)

Base: batch64 as deployed to the Cloudflare Worker (`63eb88a`, tag `batch64-live`). Presentation
only: no Edge Function change, no schema change, no new shop-data key, no change to any
calculation, stage field, element id or handler. The service worker is network-first, so
phones pick up the new files without a cache-version bump.

## What jewellers will see

- **Karigar card.** A dark circle with the karigar's initials next to the name, an "N in
  progress" pill, and a shaded panel with **Gold in hand** and **Silver in hand** in large
  type (greyed at 0.00g). Below it one plain line: "You owe ₹X" / "You owe Xg gold" in red, or
  "✓ Settled — you owe nothing" in green. One primary gold button, "Record payment".
- **Details (collapsed).** This month, all time, average turnaround, "Returned less than allowed"
  (was "Short beyond allowance"), notes, and Edit details with its form.
- **Tab header.** Icon and title on one line; subtitle now "Metal in hand, what you owe, and work
  in progress".
- **Order-form Karigar Stage box.** Every input has its label above it (Task, Karigar, How you
  pay, Wastage / Cash, Metal issued now (grams), Purity of metal issued), one field per row on a
  phone, no truncated placeholders; the tick-box text is shorter and in sentence case.

## Not in this batch

- No "Give metal" button on the card: there is no standalone give-metal flow, and adding one
  needs new logic and a new data path. Metal is still issued from an order stage or "Issue Metal".

## Files changed

`index.html` (new `.kg-*` CSS, tab header), `js/05-auth-login.js` (`renderKarigarList`,
new `karigarInitials`), `js/03-billing-numbers.js` (stage row in `buildOrdItemRow`),
`tests/regression.test.js` (one assertion reworded: "Owed cash" → "You owe ₹300").

## Rollback

`git checkout batch64-live`, `node build-cf-deploy-stage.js batch64`, `npx wrangler deploy`,
then return to `main`.
