# batch33 — F5 mobile fixes, 5-minute PIN lock, last invoice-number review items

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

## After you deploy

1. On your phone, look at the bottom bar: all nine buttons visible, **Settings** at the
   right edge, nothing running off the screen.
2. Leave the app untouched for 4 minutes: still open. Leave it 6 minutes: PIN screen.
3. On a sale, type the customer phone as `+91 98765 43210`: it saves.
4. Delete a test bill, then make a new one: the deleted bill's number is not reused.

Not verified by anyone yet: a real phone for any of the above.
