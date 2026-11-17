# Workflow: server role check (`ROLE_CHECK_MODE`)

## Objective
Decide, from real logs, whether `store-proxy` may move from `log` to `enforce`. Never change the mode without Tanish.

## Inputs
- `docs/ROLE-CHECK-DESIGN.md` (rules, open items, rollout).
- `supabase/functions/store-proxy/role-check.ts`, `index.ts`, `tests/role-check.test.mjs`, `tests/edge-functions.test.js`.
- Function logs of `store-proxy` for project `uluzuwomwqsqxtejgzmf`, read-only: Supabase MCP `query_logs`, or the dashboard Logs.
- State on 15 Nov: `store-proxy` v19 in `ROLE_CHECK_MODE=log`; batch75 (the client guards) live.

## Steps
1. Read the logs for lines containing `[store-proxy] role-check log`. Each line: `role=<role> code=<code> user=<id>`. Count by `code` and role, per day, since batch75 went live (15 Nov).
2. Judge each line: a real violation (a staff edit, a closed-day edit by a manager) or a false positive (a legitimate action the rules refused)? Compare with "Biggest false-refusal risks" in `docs/ROLE-CHECK-DESIGN.md`.
3. Run `node tests/role-check.test.mjs` and `node tests/edge-functions.test.js` on the deployed commit. Both must pass.
4. Report to Tanish against the criteria below. Do not change the env var.

### Criteria to recommend `enforce` (all must hold; Tanish decides)
- Several days of **clean real logs** from real manager and staff use. The design doc says "a few days" for `enforce` and "a few weeks" before the profit-hiding phase 2. Real use, not only test shops.
- **Zero `malformed`** lines. Under `enforce` a `malformed` blob is a refusal.
- Only **expected codes** (`staff_edit`, `closed_day`, `staff_reversal`, `owner_only`, `staff_rates`, `protected_key`, `total_below_items`), and each one a true violation, none a false positive.
- No line from a phone running batch75 for an action the client now blocks (that would be a client gap).
- The open items in the 237th HANDOFF entry are decided: the `_v ?? 0` comparison in `index.ts`, no screen for set-aside offline bills, a refused online sale keeping its stock change on screen, the missing `loadFromCloud` to quarantine test, migration 015's "DRAFT" header.
- A **phone pass** by Tanish on `3720af09` as manager and staff (`workflows/phone-check.md`).

## Rollback
Flip the env var back: `ROLE_CHECK_MODE=log` (instant; no code deploy). Mode values: `off`, `log` (default when unset), `enforce` (lower-cased; a trailing space is NOT enforce; an unknown value counts as `log`). Setting the variable is Tanish's step.

## Expected output
A short table: date, role, code, count, true or false positive; and a yes / not yet on `enforce`.

## Edge cases and failure handling
- No log lines at all: either no manager or staff saved (not proof of safety) or logging is broken. Check that a known staff save on the e2e shop produces a line before trusting silence.
- Under `enforce`, only trouble outside the rules fails open; a throw inside the rules is refused as `malformed`.
- A bill from an offline phone dated before a day close is a known bypass edge (see `role-check.ts`).

## Learned
(empty)

## Stop conditions needing Tanish's word
Changing `ROLE_CHECK_MODE` (either direction), deploying `store-proxy`, applying a migration.

## Safety (same block in every workflow; do not weaken)
- **Never put a secret, API key or credential value** in a report, committed file or HANDOFF.md — name the variable, not the value.
- **Deploy only when Tanish says so.** Never run `/ship`, `/land-and-deploy` or `/canary`.
- No migration, deploy or key rotation without Tanish's explicit word.
- Never test on a real shop: a local build or E2E test shop `77c4aefe` only (`3720af09` is Tanish's own empty shop, phone checks only; `65a3ce29` is production, untouched).
- Delete nothing without Tanish's say.
- Ledger flag `kgLedgerOn` stays OFF.
- No dark mode yet.
