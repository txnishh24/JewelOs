# Plan: retire the leaked Supabase service-role key (PLAN ONLY, written 8 Nov 2026)

Nothing in this file has been done. No key value appears here; keys are named by variable or file only.

## 1. What leaked (claims decoded, signature never checked)

- The token is in one Claude Code history file: `~/.claude/projects/C--Users-User/b95561fe-3432-4571-bc66-9cf96072a54b.jsonl` (the copies inside `~/.claude-mem` were deleted on 8 Nov).
- Claims: `role` = `service_role`, `ref` = `uluzuwomwqsqxtejgzmf` (this project), `iss` = `supabase`, `iat` = 1773820686 (18 Mar 2026), `exp` = 2089396686 (17 Mar 2036). Signature length is a normal full one (43 chars).
- It matches the live legacy `anon` key (the one shipped as `SB_KEY` in `js/00-config-state.js`): same `ref`, same `iat`, same `exp`. So both were issued together from the same legacy JWT secret. It does not expire for ten years.
- Not proven: that the signature is valid (that needs the secret or a request with the key; I did neither). Treat as live.
- Also in history: an `anon` key for a DIFFERENT project (`ref` bnwfuukflsxphlcsqcsr). Anon keys are public; ignore.

## 2. Where keys live (names only)

| Place | What | Notes |
|---|---|---|
| `js/00-config-state.js` `SB_KEY` | legacy anon JWT, public by design | sent as `apikey` AND `Authorization: Bearer` in `SB_HEADERS` (line 13) and in three hand-built header sets: `js/08-girvi-viewmode.js` (2) and `js/04-orders-detail.js` (1) |
| Edge Function env `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) | legacy service-role | read by `store-proxy`, `auth-gateway`, `razorpay-webhook` (`createClient(SUPABASE_URL, SERVICE_KEY)`) |
| Edge Function secret `SESSION_SECRET` | OWN HMAC secret | signs and verifies JewelOS session and device tokens. NOT the Supabase JWT secret. Rotating Supabase keys does not sign shops out |
| `RESEND_API_KEY`, `RAZORPAY_WEBHOOK_SECRET`, `MIN_CLIENT_BUILD` | other function secrets | unrelated to this rotation |
| `tools/backup-store.js` | env `SUPABASE_SERVICE_KEY` | backup is postponed to launch day; no such Windows env var and no scheduled task found on this machine |
| `.env.test` | `E2E_*` names only | no Supabase key |
| `tests/edge-functions.test.js` | stubs `SUPABASE_SERVICE_ROLE_KEY` | test stub, no real value |
| SQL migrations | no `pg_net` / webhook / Vault use of a key | `008` mentions `pg_cron` once |
| CI | none (`.github` absent) | |
| Claude Code history | the leaked token (1 file) | |
| Cowork, Supabase MCP, Cloudflare worker secrets, Windows Credential Manager | NOT checked | outside this machine or not readable here |

Live key state (Supabase MCP `get_publishable_keys`): legacy `anon` enabled; two new publishable keys already exist and are enabled (`default`, `backup`). The tool does not list secret (`sb_secret_`) keys, so whether one exists is unknown.

## 3. Answers from the Supabase docs (checked 8 Nov via docs search)

- Do `verify_jwt = true` functions accept `sb_publishable_` keys? **No.** "The platform's built-in `verify_jwt` check only understands the legacy JWT-based keys" and "Edge Functions don't verify the `apikey` header for the new keys". Sending a new key in `Authorization: Bearer` gives `Invalid JWT`; send it in `apikey` only.
- Correct change: `verify_jwt = false` on `store-proxy` and `auth-gateway`, and authorise in our own code. JewelOS already authorises with its own session token; the platform gate only ever checked "is this our public anon key". Replace it with a small `apikey` allowlist check in each function (publishable keys, plus legacy anon during the transition). `razorpay-webhook` is already `verify_jwt = false`.
- The functions' env: the docs say `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` (JSON objects keyed by key name) are added next to the legacy variables. Read the secret as `JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS"))["default"]`. Not confirmed that they exist in this project: Tanish checks Dashboard > Edge Functions > Secrets.
- Downtime: creating new keys and running old and new side by side = none. Deactivating the legacy keys is reversible in the dashboard but breaks anything still using them (old app builds in shops, any script) at that moment. The legacy JWT secret itself: rotating it directly means downtime and signs out Supabase Auth users; JewelOS does not use Supabase Auth sessions (own HMAC), but every legacy key dies at once. The no-downtime route is the JWT signing keys system: create a new signing key, rotate, then revoke the legacy secret, but first the legacy `anon`/`service_role` must be disabled ("Revoking the legacy JWT secret means ... you must disable the anon and service_role API keys").
- Shops signed out? Not by this plan (own session tokens, `SESSION_SECRET` unchanged). A shop on an old cached build would see failed requests after step 9 until it reloads.
- Gap in the docs: not proven that deactivating the legacy keys alone makes PostgREST/Storage/Realtime reject the leaked token; revoking the legacy JWT secret is what makes the signature worthless. This plan does both, in that order.

## 4. Ordered steps (each: owner, action, rollback, check)

1. **Tanish, dashboard.** Settings > API Keys > Publishable and secret: confirm a `default` secret key exists (create it if not; never copy it anywhere). Confirm Edge Functions > Secrets lists `SUPABASE_SECRET_KEYS` and `SUPABASE_PUBLISHABLE_KEYS`. Rollback: delete the new secret key. Check: the two variables are present. Additive, no downtime.
2. **Cowork.** Read-only: look in the brain folder, memory, MCP/connector configs and any notes for the legacy service-role key or `SUPABASE_SERVICE_KEY` and report file names only. Rollback: n/a. Also the Cloudflare worker: confirm no Supabase secret in its settings (`wrangler.jsonc` was not read).
3. **Claude Code, repo only (batch71 prep), no deploy.** Branch. Functions: read the secret from `SUPABASE_SECRET_KEYS["default"]` with a fallback to `SUPABASE_SERVICE_ROLE_KEY` (so a missing variable cannot take the functions down); add an `apikey` allowlist gate that accepts publishable keys AND the legacy anon (for old clients), runs after the OPTIONS preflight, and returns 401 otherwise. Update `tests/edge-functions.test.js` and add gate tests. Client: `SB_KEY` = the `default` publishable key; drop `Authorization` from `SB_HEADERS` and the three hand-built header sets; `APP_BUILD` 71; `sw.js` cache `jewelos-v26`; `docs/CHANGES-batch71.md`; keep ES5. Run `bug-pattern-reviewer`, regression, ledger tests, `checks/`. Rollback: discard the branch. Opus reviews it (MODEL-POLICY: security, auth, deploy).
4. **Claude Code, deploy functions first** (on Tanish's word): `store-proxy` and `auth-gateway` with `verify_jwt` false plus the gate; `razorpay-webhook` with the new key read. Old clients (legacy anon in `apikey`) and new clients both pass. Rollback: redeploy the last good versions with `verify_jwt` true (store-proxy v18, auth-gateway v13, razorpay-webhook v4; rollback files exist in the repo). Check: edge function logs show no new 401/403 spike; the current live app still logs in and saves on the E2E shop.
5. **Claude Code, deploy batch71 to the Cloudflare worker** (on Tanish's word, tag `batch71-live`, rollback `batch70-live`), verified by hash against live. Check: login and a save on the E2E shop (`77c4aefe`), `npm run test:e2e` against the E2E shop only, logs clean.
6. **Everyone waits** while shops pick up batch71 (service worker updates on next open). Use the dashboard "last used" indicator on the legacy anon key as the signal. Once it stays idle, go on. Setting `MIN_CLIENT_BUILD` to 71 on `store-proxy` forces stragglers to update; it only works while the legacy gate still lets them reach the function, so do it before step 9.
7. **Tanish, dashboard.** Deactivate the legacy `anon` and `service_role` keys (reversible). Rollback: re-activate. Check: login and save on the E2E shop; logs; the e2e suite. This is the first moment the leaked token stops working at the API-key layer.
8. **Tanish, dashboard, then Claude Code checks.** Migrate to JWT signing keys: create a new key, rotate, and once nothing needs the legacy secret, revoke the legacy JWT secret. Rollback: move the revoked key back to standby. This kills the leaked token's signature everywhere.
9. **Verify the leak is dead.** With Tanish's explicit word, one request using the leaked token against the REST endpoint, printing only the HTTP status (expect 401), done by Claude Code without echoing the token. Also confirm the anon key shipped before (legacy) is rejected.
10. **Cleanup, Tanish's call.** Delete or redact `~/.claude/projects/C--Users-User/b95561fe-...jsonl`; remove the `gate accepts legacy anon` allowance in a batch72; update `tools/backup-store.js` and `docs/BACKUP-SETUP.md` to say "secret key" (needs `apikey` header, not `Authorization`) before backup is turned on at launch; log everything in HANDOFF.

## 4b. Corrections from the Opus review (8 Nov; items 1, 2, 4 re-checked against the code by me; the rest taken from the review, not all re-checked)

These OVERRIDE the steps above where they differ.

1. **The gate must not answer a bare 401 (data-loss risk).** `js/05-auth-login.js:222` treats a 401 with no `reason` and a still-valid session token as "revoked" and wipes the device (`saasForceLogout`), dropping unsaved bills; the save path passes `res.body.reason` (`js/01-sync-core.js:468`). A gate 401 or the platform's own "Invalid JWT" carries no `reason`. So the gate answers **409 `client_outdated`** (old clients already handle it) or, at minimum, 401 with `reason: 'expired'`. Never a bare 401.
2. **Gate placement in `store-proxy`:** after the full body read (`index.ts:293-308`, the 9 Oct hang fix), never right after OPTIONS. Every gate response carries `corsHeaders(origin)` or the browser shows "Failed to fetch". No gate in `razorpay-webhook` (Razorpay sends no `apikey`).
3. **Rollback is not free after later steps.** After step 5, batch71 clients send no `Authorization`, so redeploying `verify_jwt` true breaks them. After step 7, old function versions read the deactivated `SUPABASE_SERVICE_ROLE_KEY`, so a function rollback is an outage. The repo's rollback files (`store-proxy/index.v9.rollback.ts`, `auth-gateway/index.v6/.v7.rollback.ts`) do not match live v18/v13, and `razorpay-webhook` has none: save a snapshot of each live function (source) after step 4, before step 5. Treat step 8 (revoking the legacy secret) as irreversible.
4. **`verify_jwt` false is not recorded in the repo** (no `supabase/config.toml`). A plain CLI deploy defaults it back to true and locks out every batch71 client. Add `config.toml` entries, or make the flag an explicit part of every deploy, and check `list_edge_functions` after each deploy.
5. **Key fallback must be loud:** log which key source each function uses at boot, and confirm it is `SUPABASE_SECRET_KEYS` before step 7; wrap the `JSON.parse` so a bad value cannot stop the function booting.
6. **The allowlist gate can fail closed:** if `SUPABASE_PUBLISHABLE_KEYS` is missing it rejects everyone, and publishable keys are public so the gate adds almost no security. Prefer failing open with a log line, or drop the gate.
7. **Step numbers:** the "after step 9" in section 3 and "before step 9" in step 6 both mean step 7.
8. **Shorten the exposure:** if the dashboard can deactivate `service_role` apart from `anon`, do it right after step 4 is checked: the service-role key is used only server-side, so shops do not notice. Unverified that the dashboard allows it.
9. `MIN_CLIENT_BUILD` is checked only on PUT and `kg_*` POSTs (`store-proxy:379`, `:433`), not on GETs, counters or `auth-gateway`, so it is a weak straggler tool. Keep the `SB_KEY` variable name (`js/01-sync-core.js:264`). `sw.js` holds no keys; open tablets keep the old build until reloaded.

## 5. Verification list (after steps 4, 5, 7 and 8)

- Login (owner and a staff user) on the E2E shop; one sale saved and reloaded.
- `npm run test:e2e` (E2E shop only), regression, `sql-*` tests, `checks/`.
- Edge function logs (`store-proxy`, `auth-gateway`, `razorpay-webhook`): no 401/403/"Invalid JWT" spike.
- A Razorpay test webhook (if Tanish wants) still verifies.
- Dashboard "last used" on the legacy keys goes quiet before step 7.
- The leaked token is rejected (step 9).

## 6. Could not verify

- Whether the leaked token's signature is valid.
- Whether deactivating the legacy keys alone rejects the leaked token on every service (hence step 8).
- Whether `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` exist in this project's functions, and whether a secret key already exists.
- Whether the legacy anon and service_role can be deactivated separately or only together (the docs describe them together).
- That `jsr:@supabase/supabase-js@2` as resolved today accepts `sb_secret_` keys in `createClient`.
- Copies of the key in Cowork, the Cloudflare worker settings, Windows Credential Manager, other devices.
- Real-world exposure: the key was only seen by local files and by Claude (via claude-mem's summariser); no sign of other leakage.

## 7. Recommendation

Do it now, in stages: steps 1 to 5 are additive and keep every old client working, so start today. The leaked key stays live until step 7, so do not let the rollout drag: schedule step 7 within days, not weeks, and use `MIN_CLIENT_BUILD` for stragglers. Not a reason to rotate the legacy JWT secret directly today: that breaks every shop at once.
