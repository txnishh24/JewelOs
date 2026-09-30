# batch37 — purchase "fully paid" bug (item 7) + Cowork QA P2 items 14–21, on top of batch36 (live)

Base: batch36, verified live on 1 Oct. Everything below is in `js/` and `index.html`.
Server side: nothing new.

## 🔴 Purchase bills: a part payment no longer turns into "fully paid" (QA item 7)

Cowork reproduced this on the live site. On a ₹40,000 purchase bill with ₹15,000 typed as
paid, the bill saved correctly. But the **next time the app loaded**, a clean-up step
overwrote "Amount Paid" with the full ₹40,000 (for every shop that hadn't turned on "Supplier
Credit Tracking", which is off by default). So the bill showed Paid / Pending 0, the supplier
seemed settled, and the **Day Book counted the whole ₹40,000 as cash out**.

- Fixed: the clean-up now uses the same payment rule as the purchase form.
- **Existing bills are repaired automatically** the first time batch37 loads. The true amount
  paid was still stored alongside, so the app puts it back: PB-00001 goes back to ₹20,000 paid
  of ₹50,000, and PB-00002 to ₹15,000 of ₹40,000.
  One exception: a bill that got a later supplier payment *after* the damage can't be repaired
  exactly and is left alone.
- If a repaired bill is on a day already closed in the Day Book, the Day Book posts the
  difference as an adjustment on the next open day (its normal rule for changes to a closed day).

## 🟡 Money and reports (P2)

- **14 — Bill totals in whole rupees.** 3% GST made totals like ₹2,07,771.6000000006; the bill
  printed ₹2,07,772 but the payment box showed `57771.600000000006`. New and edited bills now
  store the total in whole rupees, exactly as printed. In the GSTR-1 export, Invoice Value is
  that rounded bill total, so it can differ from Taxable Value + tax by up to ₹1 (normal
  round-off; taxable value and tax themselves are unchanged).
- **15 — Customer account refreshes** after Add Payment or reversing a payment. Before, you had
  to close and reopen it to see the new balance.
- **16 — Plain-language Day Book messages.** "Could not record: future-date" now reads
  "Could not record: the date is in the future" (and so on for every Day Book refusal).
- **17 — Analytics:** one bill is no longer projected into a "24-month CLV" (₹49.9 lakh from
  one ₹2 lakh bill). With fewer than 2 bills a month apart, it shows "spent so far". The
  "average interval" was also miscalculated. Category growth from ₹0 now says "New" instead of "▲0%".
- **18 — Net Cash includes expenses.** Reports and the Dashboard now subtract Day Book expenses
  (rent, salary…) from Net Cash, as the Profit figure already did. The Dashboard lists "Expenses".
- **Split payments:** a bill paid Cash + UPI now says "Cash + UPI" on the bill, its status chip,
  the customer account and the WhatsApp message (it said just "Cash").

## 🟡 Screen and phone (P2)

- **19 — "Low Stock Alerts" replaced by "Pieces in Stock".** The alert went red for any
  category with 2 or fewer pieces, which is normal for one-off jewellery (and it read the
  wrong field, so every piece counted as "Other"). **Tanish: say if you want a real low-stock
  rule instead** (e.g. only for items you stock in quantity).
- **20 — Long shop names fit the header** on a phone. On screens 480px wide or less, the Sync /
  Settings / Sign Out buttons show just their icons, and a long name ends in "…". The "Saved ✓"
  status still shows.
- **21 — Less data use.** The app checks for changes from other phones every 60 seconds instead
  of every 15 (about 30 downloads per half hour instead of 120). Opening the app again still
  refreshes straight away.

## Tests

Regression 295/295 (+8; each fails on the previous code), e2e 18/18. The purchase e2e now
reloads the page and checks the bill again, which is the step that caught item 7.
check.bat clean. Header and Deduction % box checked in a real browser at 375px.
**Not verified:** a real phone, the printed PDF.
