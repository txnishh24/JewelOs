# batch57 — explicit Sentry Session Replay masking

Base: the Cloudflare worker's content as of batch56's 16 Oct deploy. This batch changes
only `index.html` on top of that base. Commit: `89b3824`.

## ✨ What changed

**Session Replay masking made explicit** (`index.html` lines 8-22, the `Sentry.init`
call): added an `integrations` array with `Sentry.replayIntegration({ maskAllText: true,
maskAllInputs: true, blockAllMedia: true })`. Previously no `integrations` option was
set at all, so Replay ran on whatever the SDK's own built-in defaults happen to be for
the loaded version — likely already masking (current SDK defaults are `maskAllText:
true`/`blockAllMedia: true`), but implicit, not a decision anyone made or could see.

**Why now:** flagged on the 14 Oct recon (HANDOFF.md 18th entry) — Session Replay is
live in prod (10% of normal sessions, 100% of error sessions) and JewelOS screens show
real customer names, bill amounts, and jewellery weights. Leaving masking to an
unstated SDK default is the kind of thing that silently stops being true on an SDK
version bump.

No other file touched — no `js/*.js` logic, no calculation, save/sync, or auth change.

## 🔍 How this was checked

`check.bat` clean on `89b3824`: syntax OK on all 11 `js/*.js` files (unchanged),
regression suite pass, backup-check and roundtrip both PASS — none of this exercises
`index.html`'s inline script, since it's HTML/script-tag content, not a `js/*.js`
module.

**Not verified against a live recorded replay.** No browser access this session to
open the deployed app, trigger a Replay-recorded session, and confirm the replay
actually renders masked rather than erroring, silently no-op'ing, or showing real data.
This is the one thing worth checking once live — see HANDOFF.md 38th entry.

## sw.js — intentionally untouched

Same reasoning as batch55/56: `sw.js` (`jewelos-v20`) is network-first, so an
already-installed device picks up this batch's `index.html` on its next online fetch.
No cache-name bump needed.

## Not in this batch

Server-side: no `auth-gateway`/`store-proxy`/`razorpay-webhook` change, no migration,
no Supabase write. The Netlify-vs-Cloudflare host decision (HANDOFF.md 37th entry) and
the open phone-test/Tanish items are unrelated and untouched.
