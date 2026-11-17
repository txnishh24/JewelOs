# Workflow: owner / manager / staff walk

## Objective
Walk every role through the app on a local copy and find places where a role can do, or see, what it must not. Phone width first.

## Inputs
- A local copy of the current build with a mock backend and synthetic data. Not a customer shop; `77c4aefe` only if a local copy is not possible.
- Three logins on the local copy: owner, manager, staff. Phone viewport 390 px, then 360 px.
- The earlier reports: `R29-reviews/R29-staff-report.md`, `R29-manager-report.md`, `R29-newshop-report.md` (in `E:\jewelos`, Cowork's folder, not committed) and `docs/ROLE-CHECK-DESIGN.md`.

## Steps (checklist; tick each per role, write what you saw)
1. **Sales**: stock and custom item, GST and memo, cash / UPI / card, split payment, old gold. Saved bill number and totals right.
2. **Discount caps**: staff cap **5%**, manager cap **15%** of the subtotal before GST. Try exactly at the cap (accepted), just over (refused with a message), far over. Owner has no cap.
3. **Edit / refund / void / delete a saved bill**: staff cannot edit, refund or delete and the buttons are hidden; manager can with a reason (void and refund need a reason); owner can. Check the console-only path too (`openEditBill`, `deleteSale`, `markSalePaid`): refused, nothing changed.
4. **Payment reversal**: staff cannot (decided 14 Nov); button hidden and the function refuses. Manager and owner can.
5. **Closed-day rules**: after Day Book close, staff and manager cannot add or edit a bill on that day ("That day is closed"); only the owner reopens.
6. **Day Book fold**: the day's lines (Opening, sales, expenses, Girvi, karigar lines, Closing) add up; run a short close and an excess close; reopen is owner only.
7. **Owner-only items**: Settings, Team, Audit log, backup, restore, Clear All, Load Demo, discount limits, rates. A manager or staff must not reach them by tap or by `switchTab('settings')`.
8. **Money-privacy scan, every tab, as manager and as staff**: search visible text for labour, salary, advance, owes, payable, profit, cost, margin, purchase, stock value, P&L, and for the seeded rupee values. Manager and staff see no karigar rupees and no cost price; staff sees no purchases. Cover Home, Stock, Orders, Day Book, Girvi, Customers, Reports, Karigars, Bill Preview, the printed invoice, Day Book activity lines.
9. **Layout at 390 and 360 px**: header (shop name and user line), sale form labels, Bill Preview full width with one WhatsApp button, split-payment amount box shows a 6-digit amount, toast not covering Grand Total or the Record button, Reports "View" column reachable.
10. **Console bypass list**: set `SAAS.user.role='owner'` in the console as manager or staff and list what the client then allows. List only, do not fix here: the server check decides (`workflows/server-role-check.md`).
11. Write the report: findings by severity (blocker / high / medium / low), steps, expected vs seen, and what was NOT tested.

## Expected output
One report per role, a findings index and a verdict, in `R<n>-reviews/` in `E:\jewelos`, then a new `TO-CLAUDE-CODE-R<n>.md` for the fixes (`workflows/review-round.md`).

## Edge cases and failure handling
- Local copy differs from the live build: record `APP_BUILD` in the report.
- A leak only shows with seeded data: seed distinctive rupee values (31337, 9876, 45678) so a regex finds them.
- Cannot reach a screen: write it under NOT TESTED, never "pass".

## Learned
(empty)

## Stop conditions needing Tanish's word
Any login to a real shop, any change to a cap or a role right, any deploy.

## Safety (same block in every workflow; do not weaken)
- **Never put a secret, API key or credential value** in a report, committed file or HANDOFF.md — name the variable, not the value.
- **Deploy only when Tanish says so.** Never run `/ship`, `/land-and-deploy` or `/canary`.
- No migration, deploy or key rotation without Tanish's explicit word.
- Never test on a real shop: a local build or E2E test shop `77c4aefe` only (`3720af09` is Tanish's own empty shop, phone checks only; `65a3ce29` is production, untouched).
- Delete nothing without Tanish's say.
- Ledger flag `kgLedgerOn` stays OFF.
- No dark mode yet.
