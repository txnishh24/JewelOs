# batch34 — Cowork QA fixes (P0 2–6) on top of batch33 (never deployed): F5, 5-minute PIN lock, invoice review items

Base: batch32 (verified live by Cowork, 30 Sep). Everything below is in `js/` and
`index.html`. **Server side:** migration `006` (below) is separate and not required by
this build — the app works with or without it.

## 🟡 Fits a phone screen properly (F5)

- **Bottom bar:** on a 375px phone the nine buttons ran 38px off the right edge, so
  **Settings** was cut off. They now fit. On small phones the labels are in normal
  case, "Day Book" sits on two lines and "Customers" shows as "Cust.".
- **Messages (toasts):** long messages used to run off both sides of the screen. They
  now wrap onto a second line, and long ones stay up a little longer so they can be read.
- **Phone number:** the sale and order forms suggested typing "+91 …" and then refused
  it. Typing `+91 98765 43210` or `098765 43210` now just works (saved as 98765 43210).
- **Signup:** the Currency / Locale choice offered US Dollar and UAE Dirham, which did
  nothing anywhere in the app. Removed — JewelOS is rupees and GST.

## 🟡 PIN lock after 5 minutes (was 3)

As Tanish asked on 29 Sep: the app locks behind the PIN after 5 minutes without a tap.

## 🟡 Invoice numbers — the last review items

- A **deleted bill's** invoice number is never given out or accepted again (a cancelled
  GST invoice number must not be reused).
- A typed `INV-` number far above your highest real bill is refused as a likely typo.
- `INV-40` and `INV-040` count as the same invoice.
- If an account is removed from the shop, the message now says plainly that changes not
  yet saved on that phone could not be kept (the phone is still cleared, as before).
- A save that looked failed but had reached the server — even across a re-sign-in — is
  recognised and shown, instead of inviting a re-entry that would duplicate the bill.

## 🔴 Fixes from Cowork's live "strict owner" walkthrough (30 Sep)

- **Printed bill:** Grand Total and Balance Due no longer print `₹₹`; the amount in
  words reads "Rupees … Only". The time on the bill is the real time it was saved (it
  printed **05:30 am** on every bill before). Bills made just after midnight now count
  on the right day in the dashboard and GSTR-1.
- **Shop setup / Settings → Shop:** a GSTIN must be a real-looking 15-character GSTIN, and
  the phone a 10-digit number (+91 or a leading 0 are fine). A bill is titled **"Tax
  Invoice"** only when the shop's GSTIN is valid; otherwise it is a "Memo Bill".
- **Customer payment history:** a bill paid part cash, part UPI shows both payments, not
  one "Cash" line for the total.
- **Reports:** the "By category" and "Sales in <month>" tables were always empty — they
  now fill in. A ring no longer shows as "Rings" in one section and "Other" in another.
  (Sales made in Custom mode have no category, so they show as "Other".)
- **Girvi:** a loan above **75% of the gold's value** now asks "Continue anyway?" before
  it is created (Tanish's choice, 30 Sep — the RBI limit for gold loans). A loan with no
  fixed term no longer shows a 6-month total as "Total Payable".

## After you deploy

1. Print a bill: one ₹ sign on totals, the correct time, "Tax Invoice" only if your
   GSTIN is filled in and valid.
2. Make a sale paid part cash, part UPI; open the customer: two payment lines.
3. Open Reports: "By category" and "Sales in …" both have rows.
4. Start a Girvi loan much bigger than the gold is worth: a warning before it saves.
5. On your phone: bottom bar fits with Settings visible; 6 idle minutes → PIN screen.

Not verified by anyone yet: a real phone for any of the above.
