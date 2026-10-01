# batch45 — everything from 1 Oct (batches 38–45), on top of batch37 (live)

Base: batch37, live on 1 Oct. **This one zip replaces batch37 and the unused batch38 zip.**
Everything is in `index.html` and `js/`. Server side: nothing new to deploy.

## 🔴 Money and cash book

- **Girvi repayments now reach the Day Book.** "General", "Partial" and "Full Redemption" payments
  (the Pay dialog's default and its two most-used options) never showed as cash in, so the Day Book
  disagreed with Reports. Every Girvi payment now counts as cash in, except a penalty (a charge) and a
  waiver (money forgiven). Reports "Net Cash" follows the same rule.
  **After deploying:** each already-closed day that had one of these payments gets one
  "Correction to <date>" entry on the next open day, the first time the Day Book is opened. That is
  the missing cash being put back, not a duplicate.
- **A bill can't take more money than it's for.** ₹99,999 "Paying now" on a ₹56,650 bill used to save
  and go into the Day Book as cash. New Sale and Edit Bill now refuse it ("enter only what the shop keeps").
- **A payment no longer drops to ₹0 after a Girvi payment.** Opening the Girvi Pay window wiped the
  sale form's payment rows, so the next bill (including Deliver & Create Bill) saved ₹0 paid.
- **Girvi waivers are no longer counted as money received** (customer account, Girvi totals, receipt,
  and the WhatsApp "payment received" message).

## 🟡 Billing rules

- **GST bills default to 3%**, and a GST bill at 0% is refused (New Sale and Edit Bill).
- **Gold rates:** ₹0, ₹100, per-10 g typos and 22K above 24K are refused. **A new shop must save today's
  rates before its first bill or Girvi loan.** Existing shops with real rates are not affected.
- **Net weight everywhere:** stock value, the sale picker and Girvi collateral value / loan-to-value
  use net gold weight. Existing loans with a net weight will show a higher (correct) loan-to-value.
  Loan-to-value also falls as the loan is repaid.
- **Girvi "Interest only":** the quick button offers the interest actually due (hidden at ₹0), and
  paying more as interest asks first and explains it becomes advance interest.
- Bills made from an Order keep the order's category in Reports.

## 🟢 New

- **Offline billing.** Each phone keeps 5 invoice numbers reserved. With no internet a sale saves
  on the phone ("Saved offline: INV-…") and syncs by itself within about a minute of the internet
  returning. Only sales work offline (Girvi, orders, purchases and Day Book still need internet).
- **Products:** Stone Weight, Wastage / VA % (charged on the bill) and Hallmark Centre.
- **Edit / Refund / Delete** on the bill preview, not only inside the customer popup. Tapping a sale
  on the dashboard opens its bill.
- **Aadhaar / PAN is no longer stored.** The field and the card-photo slots are gone, and numbers saved
  earlier are deleted when each shop next opens the app.

## Smaller fixes

- Pending Aging no longer labels unpaid bills "Paid"; Girvi history lists each payment once.
- English on the app's own screens (customer WhatsApp messages stay Hinglish); new Girvi 🤝 and
  Sign Out 🚪 icons; "1 bill" not "1 bills"; VIP needs 2+ bills and no risk; new products default to 22K.
- Signup button: "Start Your Shop →". The "Powered by Netlify" badge is hidden.
- Price labels show what the bill charges before GST.
