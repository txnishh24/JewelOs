# batch52 — client-side half of the login-lockout and session-versioning Phase 5 fixes

Base: the Cloudflare worker's content as of the 11 Oct 1:48 AM redeploy (commit
`0f9329e` — everything through the unescaped-onclick-id fix, including the partial-sale
stock/billing fix from `4a2fda3`, 9 Oct, which was already part of that deploy). This
batch is for the **Cloudflare** deploy specifically — Netlify production deploys are
still paused on credits; batch51 (the motion pass) is separately what's packaged there.

**Confirmed by the actual deploy, not assumed:** `wrangler deploy` only uploaded 3
changed files (`CHANGELOG.md` plus the two below) and left the other 14 untouched —
matching this base exactly.

## 🔒 Security — client-side pieces of two Phase 5 fixes (server halves ship separately, with store-proxy/auth-gateway)

- **Login lockout device token** (`js/04-orders-detail.js`, `authGatewayCall`). Stores a
  small per-email, intentionally shop-unscoped token (must exist before any shop is
  known, must survive sign-out) so a device that's signed in before gets its own lockout
  bucket — a stranger guessing that email's password can no longer lock the real owner
  out of their own phone.
- **Session stays valid after a password change on the same device** (`js/05-auth-login.js`,
  `submitPwdModal`). Changing your own password used to require signing back in on the
  device that made the change, same as every other device. Now adopts the fresh session
  token the server returns immediately; other devices still correctly need to sign in
  again. Falls back gracefully if talking to an older server.

Neither change is visible — same screens, same messages. Both are forward- and
backward-compatible with whichever `auth-gateway`/`store-proxy` happen to be live at the
time (the currently-deployed functions keep working either way); the matching server-side
halves are a separate, later step in this same deploy order.

## 🔍 How this was checked

`node --check` clean on all 11 `js/` files; regression suite 422/422 (2 new, for
`submitPwdModal`'s token adoption); 70 edge-function tests covering both security fixes,
including a `remove-staff` gap an Opus review caught independently; `check.bat` clean.
Live e2e (`auth.spec.js`, `session-restore.spec.js`) 8/9 against the still-undeployed
server at the time — the 1 failure is the documented pre-existing flake this
session-versioning fix targets, expected to clear once the server side deploys too.

## Not in this batch

The server-side halves (`auth-gateway`, `store-proxy`), migrations 008/009 (already
applied and confirmed live separately), login-timing and `auth_store` CAS (server-only,
nothing for the client to ship). Deploy order: this batch → `store-proxy` → `auth-gateway`.
