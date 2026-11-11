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

## Added 11 Nov 2026 (examples 8 to 16, same method: real functions, synthetic data)

```
=== 8. Salary karigar: close with nothing open ===
Salim is on a monthly salary (Rs 30000). No wastage points. Issue 10.000 g at 92.00% -> fine 9.200 g
Returns the piece: 10.000 g at measured 92.00% -> real fine 9.200 g, credit 9.200 g (salary karigar: points 0, credit = the metal really there)
Open on the job: 0.000 g
Close: ok, job closed
Gold with him: 0.000 g   Salary owed: Rs 30000 (his salary is a rupee register; gold never touches it)
Second job, he returns 9.900 g at 92 (credit 9.108 g, open 0.092 g). Plain close -> REFUSED: Balance is 0.092 g fine - record the metal, an owner-approved loss or an owner adjustment first  (a salary karigar gets no wastage allowance, so a short return must be settled: next two examples)

=== 9. Accepted loss (owner only), wastage karigar ===
Wasim is a WASTAGE karigar (+4 points). Issue 10.000 g at 92 (9.200 fine). Returns 9.000 g at 92 -> real fine 8.280, credit at 96% = 8.640. Open: 0.560 g
Manager tries to accept the loss -> REFUSED: Only the owner can accept a loss
Owner, reason "no" -> REFUSED: A reason (at least 5 letters) is required for a loss
Owner, reason "filing and polishing loss" -> ok, job closed
Open now 0.000 g; approved loss 0.560 g; gold with him 0.000 g. The loss is a ledger entry with who, why and when; nothing is deleted. Rupees untouched: Rs 0

=== 10. Loss as a cash bill, SALARY karigar (rupees go down, gold clears, never netted) ===
Sita is a SALARY karigar (Rs 30000 a month, no wastage points), so a short return gets no allowance. Issue 10.000 g at 92 (9.200 fine). Returns 9.000 g at 92 -> real fine 8.280, credit 8.280 (points 0). Open: 0.920 g
The month's salary is recorded: you owe her Rs 30000.
Close as cash bill without an amount -> REFUSED: Enter the bill amount in rupees
Close with a bill of Rs 1500 -> ok, job closed
Gold open 0.000 g. You now owe her Rs 28500 (Rs 30000 less the Rs 1500 DEDUCTION row). Gold and rupees are two numbers: the bill is not converted from grams.
Reopen, then reverse the loss while the bill stands -> REFUSED: Reverse the loss bill first
Reverse the bill first, then the loss -> ok. You owe her Rs 30000 again; open on the job 0.920 g

=== 11. Stones deducted before the metal is counted ===
Issue 20.000 g at 92 -> fine 18.400 g. Points 4.
Returns a ring: gross 12.000 g with stones 2 ct (2 x 200 mg = 0.400 g). Net metal 11.600 g.
Real fine 10.672 g (11.600 x 92%). Credit 11.136 g (11.600 x 96%). Wastage 0.464 g is on the net only, never on the stones.
Still with him on the job: 7.264 g
Stones heavier than the piece (1 g gross, 2 g stones) -> REFUSED: Stone weight must be less than the gross weight

=== 12. Sweepings -> refining lot -> assay ===
Issue 10.000 g of 999 (counts 100%) -> he holds 10.000 g
He hands in sweepings: 0.500 g at 80% -> fine 0.400 g. His account drops to 9.600 g the moment you weigh it.
Refining lot: pending, estimate 0.400 g. Shop view: with karigars 9.600 g + at refiner 0.400 g = 10.000 g (nothing lost or doubled)
Refiner returns 0.380 g fine -> ok. His account stays 9.600 g (the assay credits the SHOP, not him). Shop: refined 0.380 g, estimate 0.000 g. The 0.020 g difference is the refining loss and is the shop's, not his.
A second assay for the same lot -> REFUSED: The assay is already recorded - reverse it first

=== 13. Opening balances (from the old khata) ===
Gold: he holds 50.000 g at 92 from the old book -> fine 46.000 g
A second gold opening -> REFUSED: An opening balance is already entered - reverse it first
Silver is separate: 100.000 g of 999 silver -> 100.000 g
Rupees: you owe him Rs 12500 -> ok. He owes you instead = "advance" (shown as a negative payable, never netted into gold).
Account now: gold 46.000 g, silver 100.000 g, rupees you owe Rs 12500
A manager tries an opening -> REFUSED: Only the owner can enter opening balances
Owner reverses the gold opening with a reason -> ok; gold 0.000 g. Then a fresh opening is allowed again.

=== 14. Reversing a receipt that was already carried forward ===
Issue 10 g at 92 (9.200 fine). Receipt 5.000 g at 92: credit 4.800 g. Open 4.400 g
Close with carry -> ok. Job closed, open 0.000 g, carried lot 4.400 g, he holds in all 4.400 g
Reverse the receipt straight away -> REFUSED: Job is closed - reopen it first
Undo the carry first (job must be open) -> REFUSED: Job is closed - reopen it first
Reopen the job, then undo the carry -> ok; job open 4.400 g, lot 0.000 g
Then reverse the receipt -> ok; job open 9.200 g (= the full 9.200 issued), total with him 9.200 g

=== 15. Rounding: about 20 small returns on one job ===
Issue 10.000 g at 91.82 (fine 9.182 g). 21 returns of 0.333 g at 91.82, points 4 (touch+points = 95.82).
Each return: real fine 0.306 g (exact 0.305761), credit 0.319 g (exact 0.319081). Rounded half-up ONCE per line.
Sum of 21 lines: real fine 6426 mg, credit 6699 mg.
Same 6.993 g weighed as ONE return: real fine 6421 mg, credit 6701 mg.
Exact maths: real 6.993 x 91.82% = 6420.97 mg; credit 6.993 x 95.82% = 6700.69 mg.
Difference (21 lines vs one): real 5 mg, credit -2 mg  -> each line can be off by under 0.5 mg, so the drift over 21 lines is bounded by 10.5 mg and is never carried as a hidden remainder.
Open on the job = issued - sum of credits = 2.483 g (a whole number of mg, always equals the ledger sum).

=== 16. 999 returned at 999 ===
Issue 10.000 g of 999 (counts 100%). Returns 4.000 g measured as the 999 chip (100%), points 4:
Real fine 4.000 g, wastage credit 4.000 g, capped at the metal in the piece: true. Wastage = 0.000 g.
Open on the job: 6.000 g

```

## 999 returned at 999: written confirmation (11 Nov 2026)

Today, a karigar who returns pure gold (the 999 chip, counted as 100%) gets **no wastage**. His credit is exactly the weight he hands back. Reason: the credit is net x (measured touch + points), and touch + points is stopped at 100%, so a piece can never be credited with more fine gold than it holds. Example 16: 4.000 g of 999 back, points 4 -> credit 4.000 g, wastage 0.000 g.

The stop only bites when touch + points reaches 100%: a 96.00 return with 4 points is credited 100% (no extra), a 92.00 return with 4 points is credited 96%. Returning fine bars or pieces of 96% and above therefore earns the karigar no allowance. Tests: `999 returned at 999` in `tests/karigar-v2.test.js`.

This cap was added by Claude (HANDOFF 195th entry), not stated in the plan. **Decision for Tanish:** keep it (recommended: without it, the shop would credit a karigar for more gold than he returned), or give a fixed allowance on pure gold. Nothing changes until he says.

## Rounding finding (example 15)

Every line rounds half-up once, to the whole mg. 21 identical returns of 0.333 g at 91.82: real fine 6,426 mg on the lines against 6,421 mg if weighed once (exact 6,420.97), a 5 mg difference; credit 6,699 mg against 6,701 mg (exact 6,700.69). Each line is within 0.5 mg of exact, so the worst case over 21 lines is 10.5 mg. The job balance always equals issued minus the stored credits, to the mg. Identical lines round the same way every time, so the drift adds up rather than cancelling; for many tiny identical lines, weigh them together if exactness matters.
