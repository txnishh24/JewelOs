# batch72 - the new Karigar module is on for every shop

- The profile-first Karigars tab (people list, profile, statement, New job / Close job / Receive sheets, Add karigar) replaces the old Karigar cards for ALL shops. The per-device switch `kgProfileUi` is gone; nothing reads it any more. Old order-side data (`karigarStages`, `karigarPayments`) is untouched and shows as "Order work" on each profile; payments still use the same checked pay path.
- Labour for wastage karigars: a rate per gram of NET weight (paid in rupees, on top of the wastage points), posted once at Close job, reversed on Reopen. Owner-only to set. Salary karigars get none. Silver labour is unchanged (same per-gram rate).
- Money fixes: paise shown exactly; order-cash statement rows with reversals on their own day; a rupee payment can never exceed what is owed; one save per operation id (a repeat waits for the first save); a failed save leaves the data as it was.
- Managers and staff see no rupee amounts for karigars (profile, list, statement, Day Book names on salary/advance lines, audit trail amounts, JSON Backup owner-only).
- Back button: from a profile, job or statement it goes up one level; sheets still close first.
- Server ledger flag `kgLedgerOn` stays OFF for every shop. No migration; the database already has migrations through 014.
- `APP_BUILD` 72, `sw.js` cache `jewelos-v27`. `MIN_CLIENT_BUILD` is not set.
- Not verified before deploy: `npm run test:e2e` (no env file), a real phone.
- Rollback: redeploy the batch71 commit `f763218` (`git checkout f763218`, `node build-cf-deploy-stage.js batch71` needs docs/CHANGES-batch71.md which it has, then `npx wrangler deploy`), or `npx wrangler rollback`. No data migration is involved.
