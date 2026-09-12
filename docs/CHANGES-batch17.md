# batch17 — Reverse payment silent failure + Girvi Overdue double-count

Base: `jewelos-batch16-DEPLOY.zip`. Two fixes, both reported live by Cowork against the
`lumineer` test shop (see `HANDOFF.md`, 12 Sep entries). Verified against `checks/`
(scope / handlers / css / ids / loadorder / backup-check / roundtrip all clean, identical
to the batch16 baseline), 50/50 regression tests, and `node --check` on all 10 files.

---

## 1. Reverse payment — success toast, no write (🔴 high risk)

`js/01-sync-core.js`

`reversePayment()` (orders), `reverseSalePayment()` (sales) and `pbReversePayment()`
(purchases) each grab a live reference to the record and wait, with no timeout, on a
`safeConfirm` dialog before mutating and saving it. The background `startAutoRefresh`
poll (every 15s) reassigns the whole `S.orders`/`S.girvi`/`S.sales` array from the
server — not a patch — so a poll landing while any of those dialogs sat open silently
orphaned the object the confirm callback was about to change. The save that followed
reported success (no version conflict, since the same poll had just advanced the version
counter) while writing data that never included the change.

Confirmed exact repro: order ORD-004 on `lumineer`, ₹10,000 advance added and reversed,
"Payment reversed" toast shown, `window.S.orders` afterward still showed only the
original advance entry.

**Fix:** `startAutoRefresh` now skips its poll while the `safe-confirm-overlay` is open,
the same way it already skips when the tab is hidden or a save is mid-flight. One change
at the shared choke point protects every `safeConfirm`-gated reversal in the app, not
just orders.

**Known residual gap:** a poll *fetch* already in flight when a dialog opens can still
land afterward — a network-round-trip-sized window, not the previous unbounded one.
Closing that fully would mean changing `loadFromCloud()` itself, which is shared by
boot/`forceSync()`/conflict-recovery — left alone to keep this fix surgical.

## 2. Girvi Overdue count disagreeing with itself

`js/08-girvi-viewmode.js`

The exec-dashboard's top "Overdue" KPI card only counted loans with status
`overdue`/`atrisk`. The Girvi Portfolio strip a few rows below counted those two plus
`defaulted`. A defaulted loan is strictly worse than overdue, not a separate bucket, so
the top card said "All clear ✓" while the strip said "2 Overdue" for the same two loans
on the same screen.

**Fix:** widened the exec-dash definition to include `defaulted`, matching the strip.

Checked two other "Overdue" counts in the codebase for the same drift and found neither
needed a fix: the inventory dashboard's Girvi card shows Overdue and Defaulted as two
separate labeled tiles (intentional), and the Daily Digest counts by comparing the due
date directly rather than reading `status`, so defaulted loans were already included.

---

## Not verified

Neither fix has been clicked through on a real device or browser — there is no browser
automation available in this environment. Please re-test on `lumineer` after this
deploys:

- Add an advance payment to an order, click Reverse, wait 15-20 seconds before
  confirming, then check the ledger actually updated.
- Open the Girvi tab and confirm the top card and the portfolio strip show the same
  Overdue number.
