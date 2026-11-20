# batch77 - Tanish's 14-item list (20 Nov): dashboard, stock, sale, orders, Girvi, financiers, Day Book, supplier, barcode, PDF bill, Excel

Built in worktree `claude/yoo-7f546b` (commits 72adb58 to 4303f63 plus the build bump). DEPLOYED 21 Nov 2026 (Version ID a51b34a1-f2fb-4187-b5e7-f75dbe0c2fd4). Not tried on a real phone.

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
- Estimates: the order pipeline total and the purchase wastage card show a shortfall as red words ("Est. loss", no minus sign) and zero/unknown as a dash. Display only: how `orderProfitEst` is calculated is unchanged (it still treats the making charge as cost when no karigar cost is recorded), so a real fix may still need Tanish's screenshot.
- NOT done: karigar data in the Excel export.
- `APP_BUILD` 77, `sw.js` cache `jewelos-v32`. No migration. `ROLE_CHECK_MODE` untouched.
- Rollback: batch76 is commit `80e8a35`, Version ID `7ccb9598-0692-48c6-839e-b82ac302bac1` (`npx wrangler rollback 7ccb9598-0692-48c6-839e-b82ac302bac1`, needs Tanish's word). No migration, so the old code redeploys cleanly, but the shop data does not go back with it: a code rollback is safe only until a shop records a Girvi top-up or a money-account (GPay/bank) Day Book entry. After that batch76 shows them wrongly (a top-up reads as a repayment, so the loan looks too low; money-account entries count as cash and break Close Day). Once a shop has used them, roll forward with a fix instead of rolling back.
- Also shipped in this build: F1 (optional Girvi extra interest after 1 year, off by default, commit d746b09).
