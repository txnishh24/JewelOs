# batch76 - R30 to R34: role fixes, read-only role, cost-aware profit, phone layout

- Roles: staff and read-only cannot edit stock, adjust, or touch Day Book entries; manager sees Day Book purchase and karigar lines folded; manager cannot delete a product or see the real cost; a manager can change a bill only while its day is open.
- New read-only role: sees Home, Stock, Customers, Reports only; every write path refuses with "view-only account"; Sold toggle, Add Payment, Mark as Paid and Remind are hidden.
- Cost: a sale item keeps the product cost it had at sale time. An item with no cost is "cost missing": left out of profit and margin, never costed at the sale rate. A shop with no costs at all shows "Add product costs to see profit". A returned (refunded) item keeps its cost.
- Reports: mixed shops show "Sales with cost missing (not in profit)" on P&L, PDF, digest and WhatsApp so the lines add up; unknown profit shows a dash or "cost missing", never Rs 0 (Top Customers, Week-over-Week, Category tables, Dashboard tile, charts). "Show them" lists no-cost products of every metal.
- Phone: the bill preview now fits a 360 and 390 px screen (the phone CSS used to sit inside a hover-only block and never applied); "DAY BOOK" label no longer cut.
- Edit product: an old invalid HUID no longer blocks saving the owner's cost (warns instead).
- Customers: an existing customer is never renamed by a new sale; a duplicate phone is refused.
- `APP_BUILD` 76, `sw.js` cache `jewelos-v31`. No migration. `ROLE_CHECK_MODE` untouched (still log).
- Rollback: redeploy batch75 (commit `c1a9d7e`, version `37cdfcaf-44aa-4480-97cc-5d29bd37d58a`): `node build-cf-deploy-stage.js batch75` from that commit, then `npx wrangler deploy`.
