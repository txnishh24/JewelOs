# batch73 - Karigar design fixes (R23 and R24)

- New job: the preselected Gold 22K chip now fills purity 91.6 at once, so a job can be created with just a title and weight.
- Close job sheet shows Given / Counted back / Returned / Carry, and (owner only) the labour that will post; for "He returns it now" it says the labour posts when you close.
- Job page: entry rows stack text above 44 px buttons; "Wastage allowed" now reads "Extra allowed for loss".
- Profile: closed jobs move from Now to History; average days hidden when there is no data; "Returned x g less than allowed" line.
- Tap targets: the "Pure gold 999" checkbox has an invisible 44 px hit area. More room under the last row so the toast never covers it. Desktop statement (header, filters, rows) sits in one 720 px column.
- Back button: after leaving the Karigars tab and returning, Back from a job or statement goes to the profile, then the list.
- A manager calling the order-advance helper directly gets zeros.
- `APP_BUILD` 73, `sw.js` cache `jewelos-v28`. No migration. Not deployed.
- Not verified: `npm run test:e2e` (no env file), a real phone.
- Rollback: redeploy the batch72 commit `e489ea9`.
