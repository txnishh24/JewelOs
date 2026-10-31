# Karigar 2.0 ledger — rollout runbook (phase 5a)

Status 31 Oct 2026: **applied to the TEST project `jewelos-test` (`mdqgbrcueedbieawxild`) only and checked there. NOT applied to production, `store-proxy` NOT deployed anywhere.**

## What exists
| Piece | File | Tested by |
|---|---|---|
| Immutable journal tables + `kg_post_journal`, `kg_balances`, `kg_journal_list` | `supabase/migrations/010_karigar_ledger.sql` | `tests/sql-kg-ledger.test.mjs` (real Postgres via PGlite) |
| `store-proxy` actions `kg_post`, `kg_balances`, `kg_journal_list`, `kg_export`; optional old-build guard | `supabase/functions/store-proxy/index.ts` | `tests/edge-functions.test.js` (needs `sucrase`) |
| Client: journal builders, validator, mirror reversals, offline outbox, replay | `js/12-karigar-data.js` | `tests/karigar-ledger-client.test.js` |
| Build number sent with every save and ledger post | `APP_BUILD` in `js/00-config-state.js` | regression suite |

**No screen uses the ledger yet.** The live Karigar V2 screens still read and write the shop blob. The new client code is loaded but idle.

## Order of steps (each one needs the owner's go-ahead)
1. **Test project first.** Create or choose a Supabase project that is NOT production. Apply `001`..`009` then `010` (same order as production) in the SQL editor.
2. Run `node tests/sql-kg-ledger.test.mjs <path to 010>` locally (`npm i --no-save @electric-sql/pglite@0.2` first). It proves the SQL logic; it does not prove the grants on the real project. Then, on the test project, post a journal by hand and confirm `anon` cannot read `kg_journal`.
3. Deploy the changed `store-proxy` to the TEST project. Sign in to a test shop and post one journal through the app console (`kgPostJournal(kgBuildJournal('OPENING',{opId:'...',fineMg:1000}).journal, console.log)`).
4. Production: apply `010`, then deploy `store-proxy`, in that order. The old store-proxy keeps working with the new tables absent, the new one needs them.
5. Only then wire screens to the ledger (phase 5b). The V2 blob ledger is not migrated automatically.
6. **Old-build guard** (optional, later): set the Edge Function secret `MIN_CLIENT_BUILD` to the number in `APP_BUILD` after every phone has reloaded. Phones on an older build are then told to reload instead of saving over newer data. Unset or `0` = off (default).

## Rollback
- Migration 010 only adds tables and functions. To undo before any ledger data exists: drop the `kg_*` tables and functions. **After journals exist they cannot be edited or deleted by design** (triggers block it), so rolling back means keeping the tables and not using them.
- Re-deploy the previous `store-proxy` to remove the new actions.

## Known limits
- Concurrent postings from two phones are serialised by an advisory lock; this was reasoned about, not stress-tested.
- Backups: the ledger is not in `exportFullBackup` yet (it is not live). Phase 5b adds `kg_export` to the backup file; restore replays journals by `op_id` and cannot delete newer ones.
- Roles: owner and manager only; ADJUST and OPENING are owner-only. Enforced on the server (unlike blob data).

## Test-project run (31 Oct 2026, project `jewelos-test`)
Migration 010 applied through the Supabase tool, then these were run as SQL on the real database: issue; same op_id again (reported duplicate, one row); unbalanced journal (refused); return of more gold than held (refused, no rows left behind); receipt; same op_id used by a second shop (allowed, separate); reversal that is not an exact mirror (refused); exact mirror (posted, accounts back to the pre-receipt values); second reversal (refused); UPDATE, DELETE and TRUNCATE on every ledger table (all blocked); paged list and `after` cursor. Privileges: `anon` and `authenticated` have no table select and no execute on any ledger function; `service_role` can execute the functions; RLS is on for all four tables.
Security advisor on the test project: only the expected INFO "RLS enabled, no policy" (default deny is the intent). One WARN (`kg_block_mutation` mutable search_path) was fixed by `set search_path = ''` and re-applied.
**Not covered:** two phones posting at the same instant (the tool runs one statement at a time); `store-proxy` against the real database (not deployed on the test project); performance with large history.
Side effect: to free a project slot on the free plan, `jewelos-ops` (an unrelated AI photo app: profiles, credit wallets, payment tables) was PAUSED at the owner's request. Restore it from the Supabase dashboard (or with `restore_project`) if it is still needed; this may need a free slot (the free plan allows 2 active projects: production + one more).
