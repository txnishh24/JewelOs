# batch14 — post-batch13 fixes

Base: `jewelos-batch13-undeclared-refs-fix.zip`. Four edits, all verified against
`jewelos-checks` (scope / handlers / css / ids / loadorder / backup-check / roundtrip
all clean, identical to the batch13 baseline) and `node --check` on all 10 files.

> **Rebase note:** `making-basis.js` in your checks folder references
> `itemMakingWeight()`, which does not exist in batch13. You appear to have a newer
> working copy with making-charge changes in it. Apply these four edits onto that
> copy rather than deploying this zip over it.

---

## 1. Cross-account leak: four more unscoped localStorage keys
`00-config-state.js`, `05-auth-login.js`, `06-inventory-stock.js`, `07-settings-plans.js`

This is the **sixth** appearance of the bug class already fixed in `ssj_cache`, the
PIN keys, the audit log, the WhatsApp rules and `jewelos_pin_changed`. Four keys were
still global to the browser rather than scoped to the shop:

| Key | Effect on a second shop logging in on the same device |
|---|---|
| `jewelos_digest_email` | Sees the **first shop's owner email** prefilled in Settings |
| `jewelos_digest_time` | Inherits the first shop's digest schedule |
| `jewelos_onboarding_done` | Onboarding checklist silently skipped |
| `jewelos_wizard_done` | Setup wizard silently skipped |

The digest email one is an actual cross-tenant data disclosure, not just a stale flag.

Added `shopScopedKey(base)` to `00-config-state.js` (loads first, so it is safe from
anywhere) and routed all four keys through it. Use it for any future browser-local key
that is not genuinely device-global — that is what keeps this bug from returning a
seventh time.

`jewelos_rzp_key` and `jewelos_girvi_view_mode` were deliberately left device-global.

## 2. Cloud Diagnostics reported a false failure on every healthy install
`08-girvi-viewmode.js`

`cloudDiag()` authenticated to store-proxy with `x-shop-key`. The v5 deploy stopped
reading that header — it derives shop and role from the signed session token. So the
diagnostic got a 401 and printed *"shop key rejected — try logging out/in"* even when
sync was working perfectly.

This is the same failure mode the comment block above that function was written to fix
in the first place: a diagnostic testing a path that no longer exists. Now sends
`x-session-token`, matching what the three real sync calls send.

## 3. `updQty()` left weight stale and left no audit trail
`02-ui-inactivity-modals.js`

Every other place that changes a product's quantity recomputes weight from
`unitWeight × qty` (`02:1186`, `03:730`, `09:629`). The manual inventory quantity editor
did not. Editing a quantity by hand left the old total weight in place, so stock
valuation, metal totals and reports all drifted silently — and the drift persisted,
because nothing recomputes weight on load.

It was also the only stock change with no `stockMovements` entry, so a hand-edited
quantity was invisible in the movement history. Both fixed, plus rollback-on-save-failure
matching the pattern `toggleStatus()` already uses.

## 4. Stale comment
`05-auth-login.js` — `saveDigestEmail()` was labelled "configure Razorpay key".

---

## Not fixed — needs your decision (see the billing section of the report)

Plan gating is currently switched off in this build:
`PLAN_LIMITS = { free:_PRO_LIMITS, basic:_PRO_LIMITS, pro:_PRO_LIMITS }` and
`SAAS.plan: 'pro' // plans removed — always pro`.

The pricing modal is still reachable, and the upgrade button still tells the customer
to go get their own Razorpay account. That needs a decision before launch, not a patch.
