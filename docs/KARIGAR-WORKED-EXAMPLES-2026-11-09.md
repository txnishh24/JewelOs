# Karigar redesign: worked examples on the new code (9 Nov 2026)

Produced by running the real functions in `js/11-karigar.js` with synthetic data (saves stubbed to succeed). No screens exist yet; nothing deployed; ledger flag untouched.

```

=== 1. 10 g at 92 = 9.20 g fine ===
Issue 10.000 g at 92.00%  ->  fine 9.200 g  (stored as mg 9200, purity stored as 9200 = 0.01% units)
Karigar account (gold with him): 9.200 g

=== 2. A 91.82 purity entry ===
Typed 91.82 (the app asks "is it right?" first; not a saved touch) -> pu 9182, fine 9.182 g  (10000 mg x 9182 / 10000, half-up once)
Typed 100 or 49.99 -> Purity must be between 50 and 99.99
Typed 91.82 without confirming -> asks: "This purity is not one you use often. Is it right?"

=== 3. Wastage credit: 92 + 4 points = 96, and the cap at the fine he holds ===
Issued 10.000 g of 999 (counts 100%) -> he holds 10.000 g fine
Receives a piece: 5.000 g net at measured 92 -> real fine in the piece 4.600 g, credit at 96% = 4.800 g  (capped? false)
He still holds 5.200 g fine on the job
CAP: issued 10.000 g at 92 = 9.200 fine. Returns 10.000 g net at 92: 10 x 96% would be 9.600 g, credit is capped at what he holds = 9.200 g  (capped? true); open balance 0.000 g
Measured vs agreed: agreed 92.00, measured 91.82 -> credit uses measured: 9.582 g (91.82 + 4 = 95.82%)

=== 4. Carry-forward adjusted against the next issue ===
Job A: issued 9.200 fine, returned a piece credited 4.800 -> 4.400 g still open
Total with him before closing: 4.400 g
Close Job A with "carry": job is closed, open 0.000 g; carried lot "Carried from KJ-0005" = 4.400 g (0 days old)
Total with him after the carry: 4.400 g   (unchanged: it moved from the job to the carried lot)
Job B needs 10.000 g fine. Carried 4.400 is applied, so only 5.600 g of 999 has to be handed over (not 10.000)
Job B shows 10.000 g fine issued; total with him 10.000 g (carried lot left: 0.000 g)
Ceiling: limit 20.000 g; carrying 17 g more would be over? false

=== 5. Reversal ===
Issue 9.200 g fine -> account 9.200 g
Reverse with reason "no" -> refused: A reason (at least 5 letters) is required
Reverse with a reason -> account 0.000 g. Nothing was deleted: the ledger now has 2 entries for this job (the issue and its reversal, with reason, who, when).
Reverse it a second time -> refused: Already reversed

=== 6. Stage transfer: making -> diamond setting, each stage its own karigar ===
Stage 1 Making: shop issues 20.000 g of 999 to Imran -> Imran holds 20.000 g
Imran returns the piece to the SHOP first: 19.000 g at 99.9 -> credited 19.000 g (99.9 + 4 points stops at 100% of the weight); Imran still holds 1.000 g
Stage 2 Setting: shop issues 18.981 fine (19 g at 99.9) to Pooja -> Pooja holds 18.981 g
Job open fine 19.981 g = Imran 1.000 g + Pooja 18.981 g  (never counted twice; the job page shows each stage on its own)
Direct hand-over without going back to the shop, e.g. Imran -> Pooja 0.200 g of 99.9 (a voucher, one save, both sides):
   Imran 0.800 g, Pooja 19.181 g, job open still 19.981 g

=== 7. Gold, silver and rupees stay three separate numbers ===
Gold with him 9.200 g   Silver with him 92.500 g   You owe him (rupees) Rs 30000
```
