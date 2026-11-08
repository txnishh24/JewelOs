# batch70 — Karigar reverse-confirm shows the ledger journal

- `js/11-karigar.js`: the parked-entry Reverse screen now asks the server for the journal and shows its type, day, author, role and lines (`kgJournalSummary`) before the owner confirms. A staff login can no longer plant a fake parked row that tricks the owner into reversing a real entry without seeing what it is (pre-release audit, 7 Nov).
- Inert for every shop: the ledger flag is OFF everywhere, so the screen is not reachable until an owner switches a shop's ledger on.
- `APP_BUILD` 70, `sw.js` cache `jewelos-v25`. `MIN_CLIENT_BUILD` is not set.
- Server side already live before this deploy: migrations through 014 (applied 8 Nov: store-history anchor, entitlement accrual owner-only in the database), `store-proxy` v18.
- Rollback: redeploy tag `batch69-live` (the app is backward compatible with the current server).
