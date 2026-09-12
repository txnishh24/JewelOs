# batch18 — girvi/invoice number collisions fixed

Base: `jewelos-batch17-DEPLOY-FIXED.zip` (the repackaged zip Cowork shipped after tracing
the batch17 deploy outage to a backslash-path packaging bug — see `HANDOFF.md`, 12 Sep).
This batch fixes the numbering-collision bug Cowork found during the batch17 re-test.
Verified against `checks/` (scope / handlers / css / ids / loadorder / backup-check /
roundtrip all clean, identical to the batch17 baseline), 55/55 regression tests (5 new),
and `node --check` on all 10 files.

**Packaging note:** this zip was built with 7-Zip, not PowerShell's `Compress-Archive` —
see the "why" below and the HANDOFF entry this batch closes out.

---

## Girvi and sale invoice numbers could collide

Reported live: a brand-new Girvi loan was assigned `GRV-0008`, already in use by an
unrelated, defaulted loan — two different records, same customer-facing number. A
duplicated `INV-027` showed the same symptom on the sales side.

Root cause: three separate places advanced their local `S.nextGirviId`/`S.nextInvNo`
counter with a blind `++`/`--` instead of syncing forward to `(number actually used) + 1`:

1. **`confirmGirviRenewal()`** (`js/08-girvi-viewmode.js`) — the wired-up girvi renewal
   flow computed its new loan number straight from the local counter, never touching the
   atomic server-side counter at all. Now pre-fetches an atomic number the moment the
   renewal modal opens (same pattern `pbToggleForm()` already used for purchase bill
   numbers) and forward-syncs the local counter afterward.
2. **`saveGirviEntry()`**'s create path (`js/07-settings-plans.js`) — did call the atomic
   `getNextGrvNo()`, but then incremented the local counter a *second* time on top of the
   sync `getNextGrvNo()` already did internally, silently wasting a number on every girvi
   created through the wizard.
3. **`_commitSaleTransaction()`** (`js/02-ui-inactivity-modals.js`) — blindly incremented
   `S.nextInvNo` regardless of what invoice number the sale actually used, so an
   atomically-fetched higher number left the local counter trailing behind — exactly how
   two separately-opened sales could end up minting the same `INV-` number. A failed save
   now restores the exact pre-commit counter value instead of a blind `-1`.

Also removed `renewGirvi()` (`js/01-sync-core.js`) — a second, entirely unreachable girvi
renewal implementation with the identical non-atomic numbering bug and zero callers
anywhere in the app. Its presence alongside the real, wired-up `confirmGirviRenewal()` was
part of what made this bug look like "two different code paths" worth separately tracing.

Five new regression tests cover the forward-sync and rollback behavior directly.

## Not verified

Neither the fix nor the original bug has been reproduced against the real live counters
or a real device — no browser automation here, and store-proxy's atomic counter endpoint
isn't reachable from this environment. Please re-test on `lumineer`:

- Renew an existing girvi loan and confirm the new GRV number doesn't repeat one already
  on another loan (check `window.S.girvi` for duplicates directly, not just the UI).
- Create a fresh girvi loan through the wizard and confirm the same.
- Record a sale and confirm its invoice number doesn't repeat an existing one.
