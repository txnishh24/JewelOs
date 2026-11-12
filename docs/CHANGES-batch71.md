# batch71 - Karigar redesign screens + phone round

- Karigar redesign (logic batches 1-6, review fixes, worked examples) is merged. The new screens (people list, profile, statement, sheets) stay OFF behind the per-device switch `kgProfileUi` (Karigars > Reports > Switch on). Nothing changes for a shop until an owner switches it on, on that device.
- Server ledger flag `kgLedgerOn` stays OFF for every shop. No migration in this deploy; the database already has migrations through 014.
- Phone round: the Back button closes an open Karigar sheet (one permanent popstate listener with an echo counter); sheets keep the focused field and the Save bar visible when the keyboard opens (visualViewport, scroll-padding, dvh); sheet inputs are 16px; `viewport-fit=cover` with safe-area padding for the sheet footer and, in landscape (>=640px), the top bar, rail and content.
- `viewport-fit=cover` applies to the whole app (a notched phone in landscape is now padded by the safe-area insets).
- `APP_BUILD` 71, `sw.js` cache `jewelos-v26`. `MIN_CLIENT_BUILD` is not set.
- Not verified before deploy: `npm run test:e2e` (no env file), a real phone (iOS keyboard vs Save).
- Rollback: redeploy tag `batch70-live` (`git checkout batch70-live`, `node build-cf-deploy-stage.js batch70`, `npx wrangler deploy`), or `npx wrangler rollback`. No data migration is involved.
