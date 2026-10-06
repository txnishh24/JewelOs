# batch50 — offline mode actually works now, two "every shop" hard-coded-name bugs, and a backlog cleanup

Base: batch49 (already live). Everything below is new on top of what's currently deployed.
Includes the held-over toast fix from the batch49 session, plus a full pass through the old
3 Oct QA backlog (M2/M6/M9, L1–L13) that had sat unassigned since then.

## 🟢 Low

- **Two success toasts showed a raw HTML entity (`&#10003;`) instead of a checkmark.**
  `toast()` sets `textContent`, not `innerHTML`, so an HTML entity never decodes — only a
  real Unicode escape does. Fixed the Edit Bill save toast and the product-update toast
  (`js/01-sync-core.js`, `js/03-billing-numbers.js`). Held from the previous session so it
  could ship with this batch instead of alone.

- **Sharing a bill via WhatsApp put `"SRI SAI JEWELLERS"` at the top of the message for
  every shop**, regardless of whose shop sent it — a leftover dev/demo name. A sibling bug
  (order receipts) was fixed in batch19 with its own regression test; this one was never
  covered. Now reads the shop's own name, same pattern already used two lines later in the
  same function (`js/03-billing-numbers.js`, `shareWhatsApp()`).

- **The PWA's "Add to Home Screen" name was hard-coded to `"JewelOS — Sri Sai Jewellers"`**
  in `manifest.json` for every shop. Changed to a neutral `"JewelOS — Jewellery Shop
  Management"` — a static manifest can't be per-shop without server-side generation, so this
  is the best fix available without a bigger architecture change.

- **The GSTIN example placeholder failed the app's own validation rule.** `"22AAAAA0000A1Z5"`
  does not pass `isValidGSTIN()`'s checksum — a jeweller copying the example format to see
  what's expected would get rejected by the exact validator it's meant to demonstrate. Fixed
  to `"22AAAAA0000A1ZC"` (brute-forced the correct check digit) in both places it appears
  (onboarding, Settings).

- **The HUID example placeholder was the wrong length.** `"e.g. ABC123456"` is 9 characters;
  the app's own rule requires exactly 6 (`HUID_REGEX`). Changed to `"e.g. AB1234"`, matching
  the 6-char example already used in the validator's own error message, on both the
  inventory-item and order-item HUID fields.

- **Enter did nothing on the login screen.** `#auth-email`/`#auth-password` had no submit
  path — only clicking "Sign In" worked. Added the same `onkeydown="if(event.key==='Enter')…"`
  pattern already used elsewhere in the app (the reauth password field, a Girvi note input)
  to both fields.

- **A new order item silently defaulted to category "Rings"**, so an untouched order (a
  necklace, a bangle, anything left on the default) reported as "Rings" in category
  breakdowns. The app already has a convention for "no category chosen" — `saleItemCat()`
  falls back to `"Other"` — so the five order-item reset/default sites now use that same
  value instead of inventing a new one.

## 🟢 Low — the service worker fix (its own section: not cosmetic, changes real runtime behavior)

- **Offline mode has never worked, in any browser, ever — not a flaky network path, a
  guaranteed failure.** `registerServiceWorker()` built the worker script as a `Blob` and
  registered it from a `blob:` URL. A blob URL has its own opaque origin, which can never
  equal the page's origin — the Service Worker spec requires same-origin, so every browser
  rejects this registration with a `SecurityError`, unconditionally. Moved the worker code
  into a real file, **`sw.js`**, served from the site root like `manifest.json` already is,
  and registered that instead — no Blob, no `createObjectURL`. Added `sw.js` to this build
  script's own file list (previously missing — would have 404'd after deploy). Verified live
  in a real Chromium tab against a local static server: registration reaches `activated`,
  `controller: true`, and a reload populates Cache Storage with all 19 real app-shell
  requests (every `js/` module, `index.html`, `manifest.json`, the icon, even the Sentry/
  Google Fonts CDN calls) — the fetch handler's own cache-then-network logic was already
  correct, only the registration was dead code until now.

## Investigated, decided no code change needed

- **L4 (default gold/silver rates look realistic, not obviously fake):** checked how
  `S.rates` is actually used before building anything, and found an existing, tested gate
  (`ratesConfirmed()` / `needRatesFirst()`, `js/02-ui-inactivity-modals.js`) already blocks
  `recordSale()` and Girvi loan creation until real rates have been explicitly saved once.
  The realistic defaults are safe as-is; nothing to change.
- **L1, L6, L8, L9, L10:** each traced against current code and could not be reproduced as
  described, or already fixed by an earlier, differently-named session (full detail in
  `HANDOFF.md`, 2026-10-07 entries). L11–L13 need a concrete repro or are Tanish's prior
  decisions, not re-litigated here.

## Deliberately untouched

- **L7's sibling, L4,** and anything in `WAITING ON TANISH` in `HANDOFF.md` — product
  decisions, not bugs with one right answer.
- The Sentry CDN SDK's data capture (mentioned alongside the old M9 note) — flagged as
  "unclear what it captures" in the original QA pass, not a bug, not investigated here.

## Before you deploy

Regression suite **375/375** (was 374 going into this batch — +1 new test, for the
`shareWhatsApp()` shop-name fix, confirmed via `git stash` to fail against the pre-fix code).
All 11 `js/*.js` files syntax-clean, plus `sw.js` checked by hand (`node --check`, not part
of `check.bat`'s loop, which only walks `js/*.js`). `check.bat` clean against the documented
baseline, `backup-check`/`roundtrip` both pass.

**Not covered by any of this:** nobody has clicked through the WhatsApp share, the login
Enter-key fix, or the category default on a real phone this batch — the service worker fix is
the only piece verified live (in a real Chromium tab against this exact code), everything
else is logic-level/placeholder-text verification only. Full detail, including what was
checked and how, is in `HANDOFF.md`'s 2026-10-07 entries.
