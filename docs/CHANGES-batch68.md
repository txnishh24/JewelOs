# batch68 — security response headers

- New `_headers` (repo root, copied into the Cloudflare asset stage by `build-cf-deploy-stage.js`).
- Enforced on every path: `Strict-Transport-Security` (1 year, no subdomains/preload), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `Content-Security-Policy-Report-Only` only — it blocks nothing; violations show in the browser console. Allow-list: self, Razorpay (checkout/api), Supabase project, Sentry, cdnjs, Google Fonts.
- No `js/*.js` change. Rollback: redeploy tag `batch67-live` or delete `_headers` and redeploy.

## Added to batch68 before it shipped (4 Nov 2026)

batch68 now ships three things together, because none had been deployed since batch67:

1. **Security headers** (above). Report-Only CSP, blocks nothing.
2. **Karigar 2.0 ledger client** (`js/12-karigar-data.js`, new script in `index.html`, cached by `sw.js`). It is inert: the ledger stays off for every shop (`S.kgLedgerOn` is false) until Task 4 switches custody over. A 403 from the ledger is now logged as a rejected journal instead of being dropped. The server side (migrations 010 + 011, `store-proxy` v16) is already live.
3. **Cheaper auto-refresh** (`js/01-sync-core.js`): the minute poll sends `?known=<version>` and the server answers `{unchanged:true}` instead of the whole shop when nothing changed. Needs `store-proxy` v15 or later (live since 4 Nov); an older server just ignores the parameter.

Also: `APP_BUILD` 68, `sw.js` cache `jewelos-v23`. `MIN_CLIENT_BUILD` is not set yet.

Rollback: redeploy tag `batch67-live`. The server is backward compatible with batch67 clients (checked: it reads only `data._v` from a save reply).
