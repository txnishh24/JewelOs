# batch36 — Tanish's 1 Oct decisions + Cowork's live re-test: everything in batch33–35, plus the below

Base: batch34 is what is live. batch35 was never deployed, so **batch36 carries batch35 too.**
Server side: nothing new; migration `006` is still separate and optional.

## 🔴 Memo Bill has no GST at all (Tanish, 1 Oct)

- A shop **without a valid GSTIN** can no longer make a GST bill. The sale form opens on
  **Memo Bill**, and tapping "GST Bill" explains: "Add a valid GSTIN in Settings → Shop to
  make GST bills". Before this, the form defaulted to GST, so a shop with no GSTIN added 3%
  to the customer's total and printed it on a "Memo Bill".
- A Memo Bill now has no GST anywhere: no GST amount, no HSN column, no GSTIN line and no
  tax breakdown, and the total is the plain amount. This holds even if something was left
  in the GST % box.
- A shop with an **invalid** GSTIN (e.g. `INVALID123`) no longer has it printed in the bill
  footer. That footer line was missed in batch34.
- Shops with a valid GSTIN work exactly as before: they choose GST Bill or Memo Bill.
- Old bills are safe: a sale that **did** charge GST still shows its GST lines when
  reprinted, so its total adds up. It is only called a "Tax Invoice", with the GSTIN
  printed, when the shop's GSTIN is valid.

## 🟡 Old gold: the jeweller's deduction % (QA item 9, Tanish 1 Oct)

- Old gold by **weight + purity** now has a **Deduction %** box next to the value.
  The value is weight × today's rate, less that %. The line under it shows the working,
  e.g. `10.00g × ₹7,000/g − 8% = ₹64,400`.
- Blank = no deduction (the old behaviour). The box is always visible, so it can't be missed.
- The bill shows it: "Old Gold (22K) less 8%".
- You can still type the final value yourself, or use "enter value directly".
- Not built: a per-shop default % in Settings (Tanish marked it optional).

## 🟡 Stricter checks (Cowork, 1 Oct)

- **Phone:** must be an Indian mobile, 10 digits starting 6, 7, 8 or 9. `0000000000`,
  `5876543210` and the like are refused. `+91` and a leading `0` are still accepted.
- **GSTIN:** the last character is now checked (the official check digit), so a GSTIN with
  one wrong character is refused instead of being printed on a Tax Invoice.
- **Existing shops:** if the GSTIN or phone already saved fails the new check, Settings →
  Shop will refuse to save until it is corrected, and the message says which one.
  Real GSTINs pass.

## Tests

Regression 288/288 (+6 new tests; the five that test changed behaviour fail on the previous code), e2e 18/18, backup-check and
roundtrip PASS. **Not verified:** a real phone, the printed PDF, and the new Deduction % box
on screen (it is logic-tested only).
