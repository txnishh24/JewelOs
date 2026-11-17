# tools/ — what runs each workflow step

The WAT layers in JewelOS terms: `workflows/` = the instructions, Claude = the one who reads them and runs the steps, **tools = the deterministic commands below**. Look here first before writing anything new. Every command was run, or confirmed to exist, on 18 Nov 2026 (build 75); the HANDOFF entry says which.

Not all tools live in `tools/`: JewelOS's real tools are the Node scripts in `tests/` and `checks/`, `check.bat`, the build script and `npx wrangler`. Only `backup-store.js` and its test live in this folder. No new script was written for R31.

## Existing tools

| Used by workflow step | Command (from the repo root) | Inputs | Output | On failure |
|---|---|---|---|---|
| ship-batch 3, syntax | `node --check js/<file>.js` (every file in `js/`) | the file | nothing, or a syntax error with line | exit 1; fix before anything else |
| ship-batch 3, logic | `node tests/regression.test.js` | none (loads `js/*.js` in a VM) | `N passed, M failed` (536/0 on 18 Nov) | exit 1 if any fail |
| ship-batch 3 | `node tests/karigar-v2.test.js` | none | `N passed, M failed` (339/0) | exit 1 |
| ship-batch 3 | `node tests/karigar-ledger-client.test.js` | none | `N passed, M failed` (91/0) | exit 1 |
| ship-batch 3, server wiring | `node tests/edge-functions.test.js` | `sucrase` (found next to `node.exe`, or `SUCRASE_PATH`) | `N passed, M failed` (94/0) | **FAILS loudly** if `sucrase` is missing (0 tests ran, exit 1) |
| ship-batch 3, server-role-check 3 | `node tests/role-check.test.mjs` | none | `39 passed, 0 failed` plus flow and fuzz counts | exit 1 |
| ship-batch 3 | `node tests/sql-kg-ledger.test.mjs`, `node tests/sql-store-history.test.mjs` | `@electric-sql/pglite` from `node_modules` | `ok ...` lines and `all passed` (no counts) | non-zero exit, or a line without `ok` |
| ship-batch 3, when migrations changed | `node tests/sql-rls-auto-enable.test.mjs` (also `sql-auth-store-cas`, `sql-inv-counter-floor`, `sql-login-throttle`) | same | `all passed` | non-zero exit. **Not in `check.bat`** |
| ship-batch 3, all of it | `check.bat` | none | syntax, six test files, ten `checks/` scripts, ends on `pause` | prints `SOMETHING FAILED`. The shell has refused to run it before: run the steps one by one |
| ship-batch 3, static checks | in `checks/`: `node scope.js ..`, `handlers.js`, `ids.js`, `css.js`, `loadorder.js`, `backup-check.js`, `roundtrip.js`, `making-basis.js`, `unquoted-args.js`, `unescaped-ids.js` | `..` = repo root; `acorn` from `checks/node_modules` (`npm ci` in `checks/`) | lists of things referenced but never created; most hits are known false positives | `backup-check` and `roundtrip` must be clean (`PASS all 32 shop-data keys`). `scope.js` rewrites `checks/globals.json` (revert with `git checkout checks/globals.json`) |
| ship-batch 3, role-walk, phone | `npm run test:e2e` (also `:headed`, `:ui`, `:report`) | the e2e test env file (same name as the `.example` file, without `.example`) with the shop `77c4aefe` login; `npm install` | 23 tests in 11 files, 3.6 to 4.5 min | one 30 s timeout flake seen (15 Nov); re-run that spec alone. Run from `E:\jewelos` (has `node_modules` and the env file) |
| ship-batch 6 | `node build-cf-deploy-stage.js batchNN` | `docs/CHANGES-batchNN.md`; `index.html`, `manifest.json`, icons, `sw.js`, `js/*.js`, `_headers` | `staged 20 files into ...\cf-deploy-stage` (gitignored) | exit 1 `missing docs/CHANGES-...` |
| ship-batch 7 | `npx wrangler deploy --dry-run` | `wrangler.jsonc`, the staged folder | `Read 21 files from the assets directory`, `--dry-run: exiting now.` | wrangler error text |
| ship-batch 8 | `npx wrangler deploy` | Cloudflare login on this machine; **Tanish's word** | Version ID | may be DENIED by the permission classifier (batch73, batch74): Tanish runs `! npx wrangler deploy` |
| ship-batch rollback | `npx wrangler rollback <version-id>` | a Version ID from HANDOFF; **Tanish's word** | wrangler output | or rebuild the previous batch from its commit and deploy |
| ship-batch 9 | agent `jewelos-deploy-verifier` (`.claude/agents/`) | the live URL `https://jewelos.jewelos-e2e.workers.dev`, the staged folder | per-file SHA-256 match, `APP_BUILD`, cache name, 404 on `/wrangler.jsonc` | reports mismatches; an agent, not a script (see gaps) |
| review-round, handoff | agents `jewelos-bug-pattern-reviewer`, `jewelos-test-runner`, `jewelos-invariant-tester`, `jewelos-security-auditor`, `jewelos-handoff-writer` | the diff or the HANDOFF | review text, exact counts, a drafted entry | see `.claude/rules/agents.md` |
| db-readonly-check 1 to 4 | Supabase MCP tools `get_advisors`, `execute_sql` (SELECT only), `query_logs`, `list_migrations`, `list_edge_functions` | project `uluzuwomwqsqxtejgzmf` | advisors list, rows, log lines | the permission classifier may refuse; report, do not retry another way |
| backup (postponed to launch day, `docs/BACKUP-SETUP.md`) | `node tools/backup-store.js [folder]` and `node tools/backup-store.test.js` | env var `SUPABASE_SERVICE_KEY` (name only, set on Tanish's machine) | `store-YYYY-MM-DD-HHMM.json`, read-only | prints the error; never deletes old backups |
| local viewing | `node tests/e2e/static-server.js <port>` | none | serves the repo as static files | port busy: pick another |
| code map | graphify on a throwaway copy (see `CLAUDE.md`) | `index.html`, `js/` | call graph | never run inside the repo |

## Gaps (no script yet — a proposal only, nothing built without Tanish's yes)

| Step | Today | Proposed tool |
|---|---|---|
| server-role-check 1: count `role-check log` lines by `code` and role per day | by hand through `query_logs` or the dashboard | `tools/role-check-log-summary.js` (reads an exported log file, prints counts) |
| ship-batch 9: compare live files with the staged folder | the `jewelos-deploy-verifier` agent does it each time | `tools/verify-live.js <batchName>` (SHA-256 of each file against the live URL, exit 1 on mismatch) |
| db-readonly-check 2: ledger flag SELECT | typed each time | `tools/sql/ledger-flag-check.sql` (one saved read-only query) |
| handoff-entry 2: next entry number | read the top of the LOG | `tools/next-handoff-number.js` |
| ship-batch 2: bump `APP_BUILD` and the `sw.js` cache together | by hand | `tools/bump-build.js <NN>` (edit both, print the diff) |
| ship-batch 3: run the whole gate and print a count table | `check.bat` ends on `pause` and prints no counts | `tools/gate.js` (run every suite, print `N passed, M failed` per suite, compare with the last run) |
| phone-check, role-walk | manual | none; they need a person or a browser session |
