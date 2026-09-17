# batch21 — fix a wrong making charge, and demo data that can't be mistaken for real

Base: batch20 (deployed 17 Sep and re-tested live). Two changes, both small. This is a
full site zip, so it contains everything batch20 had as well — dragging it in is safe
whether or not batch20 is still live.

Nothing here changes an existing bill or an existing product. If you deploy this and
change nothing in the app, every number stays exactly where it was.

---

## 1. A making charge can now be corrected

**Before:** "Making Charge ₹/g" only existed on the **Add Product** form. Once an item was
saved, the rate was stuck. Since batch20 that rate is what the customer actually pays, so a
typo — ₹5,000/g instead of ₹500/g — could only be fixed by deleting the product and adding
it again, which throws away that item's history.

**Now:** the same field is on the **Edit Product** form. Open any product, change the rate,
Save.

**What it does and does not affect:**

- **Bills you have already printed do not change.** A sale records the making charge as a
  rupee amount at the moment it is billed, so correcting the product afterwards cannot move
  an invoice a customer has already paid. Worth testing yourself — step 2 below.
- **The next sale of that item uses the new rate.** That is the point of it.
- **A negative rate is refused.** It would put a line on the bill that pays the customer.
- **The change is recorded in the item's history,** alongside weight and purity changes, so
  you can see later that a rate was corrected and when.

## 2. Demo data no longer looks like a real shop's records

**Before:** "Load Demo Data" seeded customers called Priya Mehta, Rahul Sharma, Mohan Patel
and so on, with realistic mobile numbers, real Mumbai addresses, notes like "Urgent for
wedding", and — on the Girvi records — ID proofs written as `AADHAAR 1234` and
`PAN ABCDE1234F`. Nothing on the screen said any of it was invented, so a demo shop could
be mistaken for a live one.

**Now:** the six demo people are `Demo Customer 1` to `Demo Customer 6`, phone numbers are
`0000000001`–`0000000006`, addresses and notes read `Sample address` / `Sample note`, and the
ID proofs are `SAMPLE-ID-001` / `-002`.

The phone numbers are deliberately **different from each other** rather than all zeros —
JewelOS uses the phone number to tie a customer's bills and loans together, so a single
shared number would have merged all six demo customers into one and made the demo
misleading about how the app actually works.

**Product names are unchanged** — "22K Gold Chain", "Diamond Ring" and so on are ordinary
item types, not anybody's personal details, and renaming them would only make the demo worse
at showing what JewelOS does.

"Load Demo Data" and "Clear All Data" are both still in **Settings → Shop**, and Clear
removes everything the demo added.

---

## What is NOT in this zip

- **Nothing server-side.** No Supabase change, no migration. The password-reset fix went live
  separately on 17 Sep.
- **Password reset is still switched off deliberately** until `RESEND_API_KEY` is set in
  Supabase. Until then "Forgot password" answers "Password reset is unavailable right now."
  That is the safe behaviour, not a fault — but it is worth setting that key.
- **The floating "Build your own site with Netlify" badge** is not part of JewelOS. It comes
  with the free `*.netlify.app` address and goes away with a custom domain.

## After you deploy — two minutes

1. **Open any product → Edit.** The Making Charge field should be there and already filled in
   with that product's current rate.
2. **The one worth checking properly:** note the total on an invoice you printed before today.
   Now change that product's making charge, save, and open the same invoice again. **The total
   must be identical.** If it moved, stop and say so.
3. **Sell that item again.** The new rate should appear on the new bill.
4. **Try a negative rate** (e.g. -100). It should be refused.
5. **Settings → Shop → Load Demo Data.** Every customer should read "Demo Customer N". Then
   **Clear All Data** and confirm the demo records are gone.

## Verified before shipping

Regression suite 99/99, all nine static checks at the batch20 baseline, every file parses, and
the zip was extracted and compared file-by-file against the source. Entry paths were checked to
use `/` separators — the thing that broke two deploys in September.

**Not verified:** anything needing a real phone or a real signed-in session. The making-charge
field was driven in a desktop browser and the demo data was checked after a real load, but the
Customers screen itself and everything touch-related is still only tested by hand.
