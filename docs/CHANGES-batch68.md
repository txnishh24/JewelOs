# batch68 — security response headers

- New `_headers` (repo root, copied into the Cloudflare asset stage by `build-cf-deploy-stage.js`).
- Enforced on every path: `Strict-Transport-Security` (1 year, no subdomains/preload), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `Content-Security-Policy-Report-Only` only — it blocks nothing; violations show in the browser console. Allow-list: self, Razorpay (checkout/api), Supabase project, Sentry, cdnjs, Google Fonts.
- No `js/*.js` change. Rollback: redeploy tag `batch67-live` or delete `_headers` and redeploy.
