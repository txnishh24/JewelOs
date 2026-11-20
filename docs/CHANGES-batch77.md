# batch77 - Tanish's 14-item list (20 Nov): dashboard, stock, sale, orders, Girvi, financiers, Day Book, supplier, barcode, PDF bill, Excel

Built in worktree `claude/yoo-7f546b` (commits 72adb58 to 4303f63 plus the build bump). NOT deployed. Not tried on a real phone.

- Dashboard: Stock Value is hidden (dots) with an eye button to show it; hides again on reload.
- Stock on phones: smaller cards (3 info columns). Desktop table unchanged.
- Sale: "Adjust X as discount" button when the balance due is up to Rs 2,000 (goes through the discount box, so the role discount limit still applies).
- Orders: pipeline is New / Making / Ready / Done; delivered AND billed orders leave the main list (filter "Done" shows them); Assign to Karigar is a form, not pop-ups.
- Girvi: Top-up on the same pledge (payment type `topup`, adds to principal from its date, cash OUT in the Day Book); optional day-by-day statement of principal and interest at each payment; ornament photos behind "View photos of the ornament" with a zoom viewer; Ledger card button replaced by Financier.
- Financiers (owner only): list and profile per financier, live from the loans (no copies), interest we owe, payments to them (also a Day Book debit), place a loan with a financier at creation or once afterwards. Stored in `S.girviCfg.financiers`.
- Day Book: Credit (left) and Debit (right) columns; no preset categories, owner types what it was for; Money accounts (GPay, bank) with their own balances that never touch cash totals.
- Purchases: supplier profile (bills, pending, payments) opened from the Supplier Ledger; one payment is spread over the oldest unpaid bills.
- Barcode: real Code 128 labels (A4 sheet or 50 x 25 mm tag), "Print the tag?" after adding a product, camera Scan screen (Android native, iPhone via html5-qrcode).
- Bill: real PDF for Download and for WhatsApp share (phone share sheet); text bill kept as fallback.
- Settings: Export everything (Excel), 13 sheets, no library, owner only. Sample-data loader shows progress and now fills customers, supplier bills and a financier; Clear data removes them.
- New CDN scripts, loaded only on first use from cdnjs: jsPDF 2.5.1, html5-qrcode 2.3.8 (html2canvas 1.4.1 was already used). Tanish to sign off.
- NOT done: the "estimate shows negative" fix (needs a screenshot); karigar data in the Excel export.
- `APP_BUILD` 77, `sw.js` cache `jewelos-v32`. No migration. `ROLE_CHECK_MODE` untouched.
- Rollback: redeploy batch76 (see CHANGES-batch76.md).
