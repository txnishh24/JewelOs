# Karigar review-fixes: merge checklist

Written 12 Nov 2026 by Claude Code (merge PREP only). Nothing here has been merged,
deployed or migrated. The merge happens only when Tanish says so in his own words.

Branch: `karigar-review-fixes` (tip before this doc: `1d61219`). Target: `main` (`c2a79b3`).

## 1. Will it merge cleanly?

Yes. `main` is a direct ancestor of the branch, so the merge is a fast-forward: 18 commits,
no conflicts, no file changed on both sides. Checked with `git merge-tree` (writes nothing
to `main`). `main` was not touched.

## 2. What ships

13 files, about 2,000 lines added. Almost all of it is `js/11-karigar.js` and its tests.

| File | What changed |
|---|---|
| `js/11-karigar.js` | Karigar profile screens (the new owner profile, five buttons with More, advance sheet, receive sheet, printed statement), exact-undo on failed saves, pay lock, payment and advance rules, Cancel job under More |
| `js/12-karigar-data.js` | 3 lines |
| `js/10-daybook.js` | Day Book restates small karigar payments |
| `js/01-sync-core.js`, `js/05-auth-login.js` | small supporting changes (16 and 23 lines) |
| `index.html` | 24 lines (print rules, styles) |
| `checks/*`, `tests/*`, `docs/KARIGAR-WORKED-EXAMPLES-2026-11-09.md`, `HANDOFF.md` | tests, checks, notes. Not shipped to shops. |

No change in `supabase/`, `sw.js` or `wrangler.jsonc`. So: no migration, no `store-proxy`
change. Merging alone changes nothing live; a shop only sees it after a deploy.

### The switch: `kgProfileUi`

- The new profile screens show only while the switch is on. It is stored in the browser as
  `localStorage` key `kgProfileUi` (scoped to the shop with `shopScopedKey`), value `1` or `0`.
- It is **per device**. Turning it on in the owner's phone does not turn it on in the shop
  PC, and clearing browser data turns it off again.
- Default is **off**. A shop that never touches it sees the old screens.
- Where to flip it: Karigar screen, the "Switch on / Switch off" button (`kg3Switch`,
  `js/11-karigar.js` near line 2577).

### The old Karigar 2.0 cards

The Karigar 2.0 home screen with its cards and the old job page stay in the code. They are
what a shop sees while `kgProfileUi` is off, and jobs made under the old rules keep the old
job page even when the switch is on. Nothing was deleted.

## 3. What stays off

| Thing | State | Why it matters |
|---|---|---|
| Ledger flag (`kgLedgerOn`) | **OFF everywhere.** Server-side flag; not in the backup on purpose (decided 11 Nov). Do not call `kg_set_ledger`. | With the flag on, new karigar entries are refused by design ("not available while the ledger is on yet"). |
| Migrations | This merge adds none. Per HANDOFF the live database already has 010, 011 (re-applied 6 Nov), 012, 013 and 014 applied; 010 is not to be re-applied. Re-read `list_migrations` before relying on this, Cowork has the live database. | Merging cannot change the database. |
| `store-proxy` deploy | Not part of this merge. Live is v18 (HANDOFF 7 Nov). | The branch has no edge-function change. |
| App deploy (`APP_BUILD`, `sw.js` cache) | Not part of this merge. | Shops get the code only on a deploy, which needs Tanish's word and `jewelos-deploy-verifier`. |

## 4. Rollback

There is no data migration, so rollback is code only.

1. Before merging, note the tip of `main` (`c2a79b3`). Because the merge is a fast-forward,
   there is no merge commit; if Tanish wants one to revert, merge with `git merge --no-ff`.
2. To undo a no-ff merge that is not deployed: `git revert -m 1 <merge commit>`.
   To undo a fast-forward that was not pushed: `git reset --hard c2a79b3` (only with Tanish's
   word, it discards the 18 commits from `main`; the branch `karigar-review-fixes` still has them).
3. If already deployed: revert on `main`, bump `APP_BUILD`, redeploy (Tanish's word), then
   `jewelos-deploy-verifier`.
4. Shops that turned the profile switch on can also just switch it off. The old screens read
   the same data, so nothing is lost either way (entries written by the new screens are in the
   same `kgLedger`/`kgJobs` structures).

## 5. What Tanish must check by hand

Neither of these has been done. Claude Code cannot do them.

1. **Phone check on shop `3720af09`** (the test shop; not `77c4aefe`, not a customer shop).
   Switch `kgProfileUi` on, then look at:
   - **Give advance**: its own sheet, title "Give advance to <name>", button "Give advance".
   - **Owner profile**: five buttons plus More, Cancel job under More, the Rupees tile
     (shows "Owes X" when he owes the shop), full-width Closing tile.
   - **Printed statement**: header date does not wrap, no leftover toast on the page, shop
     name present, Given/Returned net out reversals.
   - Also at 320 px and 390 px width.
2. **`npm run test:e2e` on his PC** (`tests/e2e/README.md`; needs `.env.test` at the repo
   root). It covers login, sale, Girvi, Day Book and offline billing, which this branch touches
   through `01-sync-core.js`, `05-auth-login.js` and `10-daybook.js`. Run it before the merge.

## 6. What was and was not verified (12 Nov)

Run on the branch, clean tree before and after:

- `check.bat`: exit 0, "Tests and syntax passed". All 13 `js/` files pass the syntax check.
- `tests/regression.test.js`: 493 passed, 0 failed.
- `tests/karigar-v2.test.js`: 254 passed, 0 failed.
- `tests/karigar-ledger-client.test.js`: 91 passed, 0 failed.
- `tests/sql-kg-ledger.test.mjs`, `tests/sql-store-history.test.mjs`: all passed.
- `checks/backup-check.js ..`: exit 0, no "not in backup" line. `checks/roundtrip.js ..`: exit 0,
  all 32 shop-data keys survived export, wipe, restore.
- The "unquoted args" list shows 19 sites (11-karigar.js entries use `kg2Q()`, which quotes);
  "without jsAttrEsc" is none.
- Merge dry run: clean.
- Earlier, by Cowork (not re-run here): maths fuzz about 78k operations; browser pass at 390
  and 320 px.

**Not verified:** no phone, no real device, no `npm run test:e2e`, nothing against the live
database or the live site. `tests/cowork-live-check.js` was not run (it fails on clean HEAD per
the 204th entry).
