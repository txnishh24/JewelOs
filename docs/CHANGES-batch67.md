# batch67 — Karigar 2.0 phases 3 and 4 (agreements, job management, Today dashboard)

Base: batch66 as deployed (tag `batch66-live`). Client only: no Edge Function, schema or service-worker
shell change (no new files). **New shop-data keys in the blob:** `kgAgreements`, `kgRoutes`
(additive; shops without them load as empty).

## What jewellers will see

- **Karigar terms are now dated versions.** Each karigar is either wastage or fixed salary.
  Wastage = a % of the fine gold issued (default 4) + an optional fixed amount of gold per job
  + an optional labour rate per gram on net or fine weight of the finished pieces. A job uses the
  terms in force the day it is created; changing terms never touches jobs already given out.
- **Earnings are final when the job closes.** Closing freezes the gold the karigar keeps and posts the
  labour to the (owner-only) Salary screen. Reopening a job reverses that labour; closing again posts
  it once.
- **Job management.** Pieces to make per job (removable with a reason), stages per product category
  (the owner defines each category's route; nothing is pre-filled), start/done in order with an
  owner undo and a "who" label, in-house or external workshop, due date, owner-only cancel (only
  while no gold has been issued).
- **New Karigar 2.0 navigation:** Today / Jobs / Karigars / Khata / Reports / Salary. Today shows
  fine gold with karigars, open jobs, overdue jobs and losses awaiting approval, with a needs-attention
  list. Closing a job with unfinished stages asks first.
- Reports: wastage kept now also shows fixed gold of jobs closed in the period.

## Tests

`tests/karigar-v2.test.js` 66 pass; `tests/regression.test.js` 489 pass; check scripts clean; headless
browser run at phone and desktop width with no page errors. Not run: `tests/e2e`; not tried on a phone.

## Rollout caution

A phone still running the previous JS would save the shop data WITHOUT `kgAgreements` / `kgRoutes` and
erase them. After deploy, reopen the app on every device before setting terms or routes.
Per-gram labour exists only for wastage karigars (not stated explicitly by the owner).
