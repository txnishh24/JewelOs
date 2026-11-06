# batch69 — Karigar 2.0 ledger on top of batch68

- `main` = batch68 (security headers, cheaper auto-refresh, ledger client) + the rest of Karigar 2.0: server-held ledger flag with an owner switch on Reports, opening-balances screen, "Blob vs ledger" check, owner-only labour and entitlement accrual, re-sign-in handling for ledger posts, parked/refused entry handling.
- Inert for every shop: the ledger flag is OFF everywhere (`kg_ledger_flag` is empty on live). A shop's ledger only turns on when its owner flips the switch on Reports.
- `APP_BUILD` 69, `sw.js` cache `jewelos-v24`. `MIN_CLIENT_BUILD` is not set.
- Server side already live before this deploy: migrations 010, 011, 012 (flag + owner labour), 013 (`store_history`), `store-proxy` v18.
- Rollback: redeploy tag `batch68-live` (the app is backward compatible with the v18 server).
