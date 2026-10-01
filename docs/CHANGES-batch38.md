# batch38 — two cash-book bugs from Cowork's second walkthrough (P0 1–2), on top of batch37 (live)

Base: batch37, live on 1 Oct. Everything below is in `js/`. Server side: nothing new.

## 🔴 Girvi repayments now reach the Day Book (P0-1)

The Day Book only counted Girvi payments marked "payment", "interest" or "refund". The Pay
dialog saves "General Payment" (the default), "Partial" and "Full Redemption" — so most
repayments never showed up as cash in, and the Day Book disagreed with Reports.

- Fixed: every Girvi payment is cash in, except a **penalty** (a charge, not money received)
  and a **waiver** (money forgiven). A refund is still cash out.
- Reports "Net Cash" now uses the same rule. Before, it counted penalties and waivers as cash
  received, and a refund as money coming in.
- **Heads-up:** days that are already closed and had one of these payments will get one
  "Correction to <date>" entry each, on the next open day, the first time the Day Book is
  opened. That is the Day Book's normal rule for a closed day whose numbers changed. It is the
  missing cash being put back, not a duplicate.

## 🔴 A sale can't record more money than the bill (P0-2)

Typing ₹99,999 in "Paying now" on a ₹56,650 bill saved it and put ₹99,999 into the Day Book
as cash. Girvi and Orders already refused this; sales didn't.

- New Sale and Edit Bill now refuse a payment above what is still due (after old gold and any
  earlier advance), with a message telling the jeweller to enter only what the shop keeps.
  Give the change back in cash. Nothing is saved, and the form stays filled.
