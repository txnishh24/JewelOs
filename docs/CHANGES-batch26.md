# batch26 — supersedes batch25: adds the PIN security fix and Adjust Stock

Base: batch24 (deployed live, confirmed). This is a full site zip — everything since then is
in it, including batch25's contents. **If you haven't deployed batch25 yet, ignore it and use
this one instead** — it has everything batch25 had plus the PIN fix that landed afterward.

## What's in this zip, by risk

### 🔴 Fixed a real security bug — the PIN screen (see HANDOFF.md, 20-21 Sep, for the full review)

The device-unlock PIN had a live authentication bypass: if someone tapped "Change PIN,"
entered the correct current PIN, then walked away before finishing, locking the screen again
never closed that flow — anyone who next picked up the device could finish it with any 4
digits and set themselves a brand-new PIN, unlocking the app with **zero knowledge of the
real PIN.** This existed before this batch, not introduced by it.

Also fixed: no PIN set no longer means the app silently accepts `1234` — it routes into a
proper "set your PIN" screen instead. Repeated wrong PINs now trigger a short wait (4 free
attempts, then 30s-300s backoff) instead of unlimited guessing. "Change PIN" was removed from
the lock screen (it's now in Settings only); "Forgot PIN" still works from the lock screen.

**This is the one thing in this zip worth testing on a real phone before anything else`:**
set a PIN, change it from Settings, use Forgot PIN to reset it, and try a few wrong PINs to
see the lockout message.

### 🟡 New feature: Day Book (rojmel) — still not tapped by anyone

Cash-in/cash-out tracking, Close Day, print and WhatsApp sharing, reachable from a new tab
between Reports and Settings. 168 regression tests, all passing — but as of this zip, nobody
has opened the tab, tapped a button, or opened a modal. See the Day Book HANDOFF entries
(batches A-G, 20 Sep) for exactly what to check.

### 🟢 New feature: Adjust Stock

A "±" button on each inventory row opens a small modal to correct a product's quantity,
calling the existing `updQty()` function (unchanged, already tested since batch14) — this
just gives it a button. Warns if the product has no per-unit weight set, since quantity
changes won't auto-update weight in that case.

### 🟢 Cleanup

Two unused password-hashing functions deleted (`saasHashPassword`/`saasVerifyPassword`) —
confirmed zero callers; real login/signup/reset already routes elsewhere. No behavior change.

## After you deploy — what to actually check, in priority order

1. **PIN screen** (see above) — highest stakes, most likely to be hit by mistake.
2. **Day Book** — set an opening balance, add and void an expense, close a day, correct a
   count, print, share to WhatsApp.
3. **Adjust Stock** — the ± button on an inventory row, correcting a quantity.
4. Confirm nothing else regressed: a normal sale, a girvi payment, an order advance.

## Verified before shipping

Regression suite 181/181, all eleven files parse, zip built with 7-Zip (paths use `/`,
required — see `build-deploy-zip.js`'s own header), extracted zip byte-matches this folder.

**Not verified:** anything visual or interactive, on anything in this zip. There is no
browser automation in this project. Every DOM-level change here — the PIN screen, Day Book,
Adjust Stock — is unverified until someone taps it on a real device.
