# batch32 — launch blockers F1–F4, plus two rounds of review fixes

Base: batch31 (the last zip built; `jewelos-deploy-verifier` should confirm what is live
before and after). Everything below is in `js/` and `index.html` only.

**Server side, already live (Cowork, 30 Sep):** migration `004` then `005` (invoice
counter), `store-proxy` v8 (tells the app *why* a login was refused). **Not yet live:**
`auth-gateway` with the 6-hour login — until it is deployed, logins keep lasting 12 hours;
this build works with either.

## 🔴 Invoice numbers can no longer repeat (F3)

Only the first bill after logging in used to ask the server for a number; every later bill
used the phone's own count, which other phones can't see — the test shop really did get
INV-030 twice.
- The **Invoice No.** box is now blank ("Assigned on save"). The number is fetched from the
  server the moment **Record Sale** is tapped. The bill preview before saving says **DRAFT**.
- If the server can't be reached, the sale is refused with "Could not get an invoice
  number — check your internet". A sale couldn't be saved offline anyway; this just stops
  a guessed number going on a GST bill.
- A number typed by hand is kept exactly as typed ("2025-26/001" is fine) and never moves
  the series. It is refused if already used (INV-40 and INV-040 count as the same), or if it
  is an `INV-` number more than 1000 ahead of the series (almost certainly a typo).
- Convert to Sale no longer pre-fills a number either.

## 🔴 Reopening the app keeps you logged in (F1)

Swiping the app away (or Android closing it) used to sign you out completely every time.
Now: used in the last few minutes → straight back in; idle → PIN screen → in; login
expired → the sign-in page, with a message saying so.

If the login runs out **while you're working**, a password prompt appears instead of
throwing you out. The bill you were saving waits, and goes through after the password.
A removed staff member is still signed out and their phone wiped, as before. A phone whose
clock runs slow is no longer mistaken for a removed user (the server now says which it is).

## 🔴 A failed save never looks saved (F4)

Creating a Girvi loan or an order with a bad connection used to show "Saved locally —
will retry". Nothing retried, and 15 seconds later the loan vanished along with its
ornament photos. Now the wizard/form **stays open with everything typed** and says
**"Not saved — tap to retry"**; tapping again once online saves it once. Editing, closing,
defaulting, archiving and recovering a loan roll back cleanly on failure too.
An abandoned "Convert to sale" can no longer attach itself to the next, unrelated sale.

Saves on a stalled connection now give up after a minute per try (instead of hanging and
locking every Record/Save button until a reload). If a save that looked failed had in fact
reached the server, the app notices, shows it, and says so — instead of inviting a re-entry
that would make a duplicate bill.

## 🟡 History that was being lost now syncs (F2)

The audit log, activity log and WhatsApp rules were wiped for the whole shop by the first
save from any freshly logged-in phone. The per-item stock history was never saved at all,
and disappeared every time the app was reopened. All four now sync and survive reopening.
History already lost can't be brought back.

## 🟡 Dates are the Indian day, not the UTC day (27 Sep)

29 places used the UTC date, so anything done between midnight and 5:30am IST landed on
the previous day (sale dates, reports, Day Book). All now use the local IST day.

## After you deploy

1. **Record two bills in a row**, then one on a second phone or browser: three different
   INV- numbers, one after the other. The box should say "Assigned on save" each time.
2. **Swipe the app away and reopen it** within a few minutes: straight in, no password.
   Leave it idle longer, reopen: PIN screen, then in.
3. **Turn on airplane mode, create a Girvi loan**, tap Create: after about 25 seconds,
   "Not saved — tap to retry", wizard still open. Airplane mode off, tap again: created once.
4. **Type an invoice number** like `2025-26/001` on a bill: saves as typed. The next blank
   bill still gets the next INV- number, not a jump.
5. Check the Activity/Audit log on a second phone shows the same entries as the first.

Not verified by anyone yet: a real phone for any of the above.
