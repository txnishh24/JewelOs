# Workflow: Supabase read-only check

## Objective
Look at the live project without changing anything: advisors, the ledger flag, function logs. **Writes are forbidden.**

## Inputs
- Supabase project `uluzuwomwqsqxtejgzmf`, through the Supabase MCP tools (`get_advisors`, `execute_sql`, `query_logs`, `list_migrations`, `list_edge_functions`) or the dashboard.
- Shops: `65a3ce29` production, **untouched**. `3720af09` Tanish's own empty shop (phone checks). `77c4aefe` the e2e shop, used only by the e2e suite.

## Steps
1. `get_advisors` type `security`, then `performance`. Compare to the last count in HANDOFF (15 Nov: 20 INFO, no warnings). Report new ones; fix nothing.
2. Ledger flag: `execute_sql` with one `SELECT` on `public.kg_ledger_flag`. Expected: zero rows (absent = OFF for every shop). A row with the flag on is a finding for Tanish. Also confirm no shop blob has `kgLedgerOn` true: SELECT only, and select the one key, never the whole blob.
3. Function logs: `query_logs` for `store-proxy`, `auth-gateway`, `razorpay-webhook`. Look for 5xx, `role-check log` lines (see `workflows/server-role-check.md`), repeated 401 or 403 patterns.
4. `list_migrations` and `list_edge_functions`: confirm versions match HANDOFF (`store-proxy` v19, migration 015 applied on 15 Nov).
5. Report, ordered by severity: what was checked, what was not.

## Expected output
A list: advisor counts, ledger flag state, log summary, versions. Nothing changed.

## Edge cases and failure handling
- The permission classifier may refuse a tool call (it refused `apply_migration` and `deploy_edge_function` before). Do not retry another way; report.
- A query returns shop data: do not paste it into a report; give the shop id and the count only.
- Unsure a statement is read-only: do not run it. Only `SELECT`.
- Never run `apply_migration`, `deploy_edge_function`, `create_edge_function_secret`, `reset_branch` or any `UPDATE`, `INSERT`, `DELETE` or DDL here.

## Learned
(empty)

## Stop conditions needing Tanish's word
Anything that is not a plain read. Any touch of production shop `65a3ce29`.

## Safety (same block in every workflow; do not weaken)
- **Never put a secret, API key or credential value** in a report, committed file or HANDOFF.md — name the variable, not the value.
- **Deploy only when Tanish says so.** Never run `/ship`, `/land-and-deploy` or `/canary`.
- No migration, deploy or key rotation without Tanish's explicit word.
- Never test on a real shop: a local build or E2E test shop `77c4aefe` only (`3720af09` is Tanish's own empty shop, phone checks only; `65a3ce29` is production, untouched).
- Delete nothing without Tanish's say.
- Ledger flag `kgLedgerOn` stays OFF.
- No dark mode yet.
