# batch66 — Karigar V2 (fine-gold jobs, khata, salary register)

Base: batch65 as deployed (tag `batch65-live`, `18212bd`). New file `js/11-karigar.js`; service
worker cache v20 to v21 and the new file added to its shell list. No Edge Function or schema
change. **New shop-data keys in the blob:** `kgJobs`, `kgLedger`, `kgSalary`, `kgPurities`,
`nextKgJobNo` (all additive; shops without them load as empty).

## What jewellers will see

- Karigars tab: below the existing cards, a new "Fine-gold jobs" section. The old cards and
  order-form karigar stages are unchanged.
- Set a karigar's terms (wastage % of fine gold issued, default 4, or salary monthly/daily).
- Create a job (optionally linked to an order). Issue gold (999 counts 100%, 995 counts 99.5%
  or "as 24K", saved touches such as 92/95/96, or Other with a typed %), receive finished
  pieces (each with its own purity; 22K fineness optional 91.6 to 92), record scrap/dust,
  loss (manager proposes, owner approves, reason required), owner adjustment, reverse, close.
- A job never closes while gold is unaccounted for, and a shortage is never turned into
  wastage or loss automatically.
- Fine-gold khata per karigar, monthly Reports, and an owner-only Salary register.
- Day Book: salary advances/payments appear as money out (cash) or non-cash; reversals as money in.

## Tests

`tests/karigar-v2.test.js` 44 pass; `tests/regression.test.js` 489 pass; check scripts clean.
Not run: `tests/e2e`; not tried on a phone.

## Rollout caution

A phone still running the previous JS would save the blob WITHOUT the new keys and wipe V2
data. After deploy, reopen the app on every device before recording anything in V2.
