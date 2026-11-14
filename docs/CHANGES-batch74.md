# batch74 - Role permissions and review fixes (R26, R27, R28)

- Owner-only: Clear/Load Demo (typed word, backup first), Restore Backup, Team invite/remove, Audit trail, Activity log, Reopen Day.
- Profit is owner-only on Home, Reports, exports and summaries. Staff see no girvi totals, Purchases or Day Book girvi detail.
- Discount limits per role (staff 5%, manager 15%, owner sets them). Edit/refund/void need a reason; staff cannot edit, refund, void or change rates.
- Day Book: Reopen reverses the close's shortfall/excess; closed-day refunds are owner-only; demo records never post cash.
- Clear All keeps invoice numbers, shows a "Clearing..." cover, and restores data and cache if the save fails.
- Forgot PIN needs the account password. Reason box closes on Esc and phone Back. Fresh sale GST defaults to 3%.
- Staff Bill Preview hides Edit/Refund/Delete. Overpayment shows "Paying more than the bill".
- All role gates are client-side only; server-side enforcement is a later round.
- `APP_BUILD` 74, `sw.js` cache `jewelos-v29`. No migration. `kgLedgerOn` untouched.
- Rollback: redeploy batch73 (commit `37659bb`, tag if present; live version `5c8eddff-bdb5-47b7-bbc6-8c7065e21f6b`).
