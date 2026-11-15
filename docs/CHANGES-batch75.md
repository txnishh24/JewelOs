# batch75 - R29 client guards (server role check is already live in log mode)

- A new bill on a closed day is refused on the phone for staff and manager (owner can still add; the owner reopens the day first).
- Staff cannot reverse a payment: the Reverse button is hidden and the action refuses.
- If the server ever refuses saved-offline bills for the phone's role (403 `role_forbidden`), they move to a separate list on the phone instead of being replayed on every load, and the screen reloads cloud data. If the phone cannot store that list, the bills stay in the outbox.
- A refused save now carries the server's error code to the client (`err.code`).
- Server side (already live, not part of this deploy): `store-proxy` v19 in `ROLE_CHECK_MODE=log` (records, never refuses), migration 015.
- `APP_BUILD` 75, `sw.js` cache `jewelos-v30`. No migration. `kgLedgerOn` untouched. `ROLE_CHECK_MODE` untouched.
- Rollback: redeploy batch74 (commit `972033d`, live version `04eac635-76bb-4012-89fe-c932f3819a6b`).
