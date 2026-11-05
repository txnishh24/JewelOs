---
paths:
  - "js/**"
  - "index.html"
---

# JewelOS module map

`index.html` plus numbered `js/` modules, loaded in order. ~18,000 lines.

| File | Owns |
|---|---|
| `00-config-state.js` | Supabase config, constants, the `S` state object, shared helpers |
| `01-sync-core.js` | Cloud load/save, store-proxy calls, debounced renderers |
| `02-ui-inactivity-modals.js` | Inventory item modals, sale item entry, PIN inactivity |
| `03-billing-numbers.js` | Bills, GST, sale totals, order item rows |
| `04-orders-detail.js` | Orders, the `SAAS` object, PIN key helpers, `PLAN_LIMITS` |
| `05-auth-login.js` | Login/signup, staff, Razorpay, settings panel, digest |
| `06-inventory-stock.js` | Inventory list, stock, onboarding checklist |
| `07-settings-plans.js` | Settings tabs, audit views, girvi list rendering |
| `08-girvi-viewmode.js` | Girvi detail, receipts, `cloudDiag()` |
| `09-purchases.js` | Purchase bills, suppliers, purchase→stock sync |
| `10-daybook.js` | Day Book (rojmel): cash-in/out, Close Day, locked-day adjustments |
| `11-karigar.js`, `12-karigar-data.js` | Karigar (artisan) accounts and the ledger client |

Grep before assuming placement — `SAAS`, `PLAN_LIMITS` and the PIN helpers live in the
*orders* file. **Do not create a new module file** without Tanish's explicit sign-off and a
new feature domain too large for any existing file (`10-daybook.js` was a one-time exception,
20 Sep 2026).
