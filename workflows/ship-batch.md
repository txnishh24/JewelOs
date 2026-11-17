# Workflow: ship a batch

## Objective
Put a tested batch of `js/` changes on the live Cloudflare worker, prove the live files match, and leave a rollback path. Every step after the tests needs Tanish's word.

## Inputs
- A clean branch with the finished change, committed.
- A batch name `batchNN` (next number after the last `batchNN-live` tag: `git tag | tail`).
- `docs/CHANGES-batchNN.md` written (the build script refuses without it).
- Tanish's "yes, deploy".

## Steps
1. Claim NOW in `HANDOFF.md`. `git status` and `git log --oneline -5`. If `js/`, `tests/`, `supabase/` or `checks/` are dirty and not yours: stop and ask.
2. Bump `APP_BUILD` in `js/00-config-state.js` and the cache name in `sw.js` (`var CACHE='jewelos-vNN'`). Same commit as `docs/CHANGES-batchNN.md`.
3. Tests (run each; `check.bat` ends on `pause` and the shell has refused it before, so run its steps one by one):
   - Syntax: `node --check js/<file>.js` for every file in `js/`.
   - `node tests/regression.test.js`, `node tests/karigar-v2.test.js`, `node tests/karigar-ledger-client.test.js`
   - `node tests/edge-functions.test.js` (needs `sucrase`; with none it FAILS, which is correct)
   - `node tests/role-check.test.mjs`
   - `node tests/sql-kg-ledger.test.mjs`, `node tests/sql-store-history.test.mjs`
   - From `checks/`: `node scope.js ..`, `handlers.js`, `ids.js`, `css.js`, `loadorder.js`, `backup-check.js`, `roundtrip.js`, `making-basis.js`, `unquoted-args.js`, `unescaped-ids.js` (all take `..`). `backup-check` and `roundtrip` must be clean; read the others against the last build's output.
   - `scope.js` rewrites `checks/globals.json`. If you did not mean to change it: `git checkout checks/globals.json`.
   - e2e, shop `77c4aefe` only, run from `E:\jewelos` (that folder has `node_modules` and the test env file): `npm run test:e2e`. Required if the change touches login, sale, Girvi, Day Book, purchase, offline billing, invoice numbers, session restore or failed saves.
4. Agents: `jewelos-bug-pattern-reviewer` on the `js/` diff, then `jewelos-test-runner`. Add `jewelos-invariant-tester` (sale/stock, billing, girvi, purchases, daybook, sync) and `jewelos-security-auditor` (auth, session, payment, RLS, per-shop data) when the diff touches them. Fix findings, re-run step 3.
5. `/careful` on. Commit. Tell Tanish the counts and what you could not verify. **Stop. Wait for his yes.**
6. `node build-cf-deploy-stage.js batchNN` (stages 20 files into gitignored `cf-deploy-stage/`).
7. `npx wrangler deploy --dry-run` (must end `--dry-run: exiting now.`).
8. `npx wrangler deploy`. Note the Version ID it prints.
9. `jewelos-deploy-verifier`: every public file byte-identical (SHA-256) to `cf-deploy-stage/`, `sw.js` cache and `APP_BUILD` match, `/wrangler.jsonc` and `/.wrangler/` are 404. Do not say "live" before it passes.
10. `git tag batchNN-live`. HANDOFF entry per `workflows/handoff-entry.md`, with the Version ID and rollback. Release NOW.

## Expected output
Wrangler prints a Version ID; the verifier reports all files identical; HANDOFF names the Version ID, commit and tag.

## Rollback (put the exact line in the HANDOFF entry)
- Fast: `npx wrangler rollback <previous-version-id>` (needs Tanish's word, same as a deploy).
- Or from the previous batch commit: `git checkout <previous-commit>`, `node build-cf-deploy-stage.js <previousBatch>`, `npx wrangler deploy`.
- Known pairs: batch75 = commit `c1a9d7e`, Version ID `37cdfcaf-44aa-4480-97cc-5d29bd37d58a`. batch74 = commit `972033d`, Version ID `04eac635-76bb-4012-89fe-c932f3819a6b`. Code-only rollback; a migration is not undone by it.

## Edge cases and failure handling
- `npx wrangler deploy` was DENIED by the Claude Code permission classifier in batch73 and batch74 (batch75 ran after Tanish said so). If denied: do not retry or find another route. Say so in the HANDOFF; Tanish runs `! npx wrangler deploy` himself, or adds a permission rule. Then run the verifier. Never write "live" before that.
- `build-cf-deploy-stage.js` says `missing docs/CHANGES-batchNN.md`: write the changelog first.
- A test fails: do not deploy. A flaky e2e timeout: re-run that one spec alone, then the full suite once; report both results.
- `edge-functions.test.js` prints `FAILED ... did not run`: `sucrase` missing; find it next to `node.exe`, set `SUCRASE_PATH`.
- Partial upload suspected: re-run the verifier; it compares every file.

## Learned
(empty)

## Stop conditions needing Tanish's word
Deploy, rollback, `ROLE_CHECK_MODE` change, any migration, pushing to GitHub, deleting tags or branches.

## Safety (same block in every workflow; do not weaken)
- **Never put a secret, API key or credential value** in a report, committed file or HANDOFF.md — name the variable, not the value.
- **Deploy only when Tanish says so.** Never run `/ship`, `/land-and-deploy` or `/canary`.
- No migration, deploy or key rotation without Tanish's explicit word.
- Never test on a real shop: a local build or E2E test shop `77c4aefe` only (`3720af09` is Tanish's own empty shop, phone checks only; `65a3ce29` is production, untouched).
- Delete nothing without Tanish's say.
- Ledger flag `kgLedgerOn` stays OFF.
- No dark mode yet.
