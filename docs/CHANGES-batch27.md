# batch27 — supersedes batch26: Day Book no longer hides non-cash sales/payments

Base: batch26 (not yet confirmed deployed). This is a full site zip — everything since
batch26 is in it, including its PIN fix and Adjust Stock.

## What's in this zip, by risk

### 🟡 Day Book fix: UPI/Card/Bank/Cheque payments no longer vanish from the day's view

Cowork found the real cause behind Tanish's "day book isn't recording sales" report (21 Sep):
the cash book correctly excludes non-cash payments from the cash totals — that's the whole
point of a cash book — but an excluded payment wasn't shown *anywhere*, not even as a line. A
shop that sold mostly UPI/card that day would open Day Book and see it near-empty, with zero
explanation. This was not the 20 Sep "sales don't post" bug — that one is already fixed and
confirmed live.

Now: a non-cash sale/payment shows up as a dimmed line naming its actual mode ("not counted"),
and a gold-bordered banner reads "Also today: ₹X across N sale(s)/payment(s) in UPI, Card or
Bank — correctly not counted in the cash figures above" whenever any exist. Print and WhatsApp
sharing carry the same note, so they can't disagree with the screen. Auto-derived lines (sale/
purchase/girvi/order — the app computed these itself) are now tagged " • auto" in the Lines
list, hand-typed entries " • manual", so it's visible at a glance which is which.

**No cash totals changed.** The locked-day sweep, Close Day math, and every existing cash
figure are byte-for-byte the same as batch26 — this only changes what gets rendered.

### 🟢 Everything from batch26, unchanged

PIN security fix (real device-unlock bypass closed), Day Book Phase 1 itself, Adjust Stock,
the dead-password-hashing cleanup. See `CHANGES-batch26.md` for those in full — none of it was
touched again in this batch.

## After you deploy — what to actually check, in priority order

1. **PIN screen** (carried from batch26) — highest stakes, still nobody's tapped it.
2. **Day Book, including the new part**: do a UPI or card sale, open Day Book, confirm the
   "Also today: non-cash" banner appears with the right amount and count, and that the line
   itself shows dimmed with its mode instead of vanishing. Then the rest of batch26's Day Book
   checklist — opening balance, add/void an expense, close a day, correct a count, print,
   WhatsApp.
3. **Adjust Stock** — the ± button on an inventory row.
4. Confirm nothing else regressed: a normal cash sale, a girvi payment, an order advance.

## Not in this zip

The Netlify free-tier badge overlapping the bottom nav, and a long shop name overlapping the
header at narrow widths — both still open, neither is an app-code fix (see HANDOFF.md, 21 Sep).

## Verified before shipping

Regression suite 187/187 (6 new tests for the non-cash lines), all eleven files parse,
`loadorder`/`backup-check`/`roundtrip` clean, zip built with 7-Zip and byte-verified against
this folder.

**Not verified:** anything visual or interactive. There is no browser automation in this
project. The non-cash banner, the auto/manual tags, and everything else DOM-level in this zip
is unverified until someone taps it on a real device.
