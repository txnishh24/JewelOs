# batch53 — sw.js offline-cache fix (install-event precache)

Base: the Cloudflare worker's content as of batch52's 11 Oct deploy (login-lockout +
session-versioning client pieces, already live). This batch changes exactly one file —
`sw.js` — on top of that base.

## 🐛 Bug fix — immediate-offline reload failed outright

**What was wrong.** `sw.js`'s fetch handler only ever cached the app shell (`/`, the 11
`js/*.js` files, `manifest.json`, icons) lazily, one file at a time, the first time each
was requested over the network. There was no guaranteed point at which the whole shell
was cached before the device could go offline — found via a Playwright/CDP network-cut
test (13 Oct) against the live site: a normal offline-reload (after the page had been
open a few seconds) worked fine, but flipping offline **immediately** after the very
first load — the realistic "install, then straight to airplane mode" case — failed
outright with a bare browser error (`ERR_FAILED` / `ERR_INTERNET_DISCONNECTED`), no app,
no custom offline page.

**Fix** (`jewelos-v19` → `jewelos-v20`): added an explicit `install`-event precache
(`e.waitUntil(caches.open(CACHE).then(ca => ca.addAll(SHELL)))`) for exactly those shell
files, so the service worker's own install lifecycle blocks on having them all cached —
by the time it reports "activated," offline is safe. Also wrapped the existing runtime
`cache.put()` in `e.waitUntil()` so the worker can't be torn down mid-write for any other
asset.

## 🔍 How this was checked

Re-ran the identical offline-immediately-after-load test against a local static copy:
fails without the fix (confirmed against the live site before patching — bare browser
error, no app), works with the fix (SW reports `activated` and the shell is fully cached
within the same page-load event; the worst-case immediate-offline reload renders the
login screen correctly).

**Not a real phone, a real install-to-home-screen, or real airplane mode.** It's a
CDP-level network cut on desktop Chromium — strong evidence the underlying bug was real
and is now fixed, but not a substitute for an actual hardware pass. That hardware pass is
still the open item once this is live (see HANDOFF.md).

## Not in this batch

Everything else is untouched — `index.html`, `manifest.json`, icons, and all 11
`js/*.js` files are byte-identical to what batch52 already put live. No server-side
(`auth-gateway`/`store-proxy`) change is part of this batch.
