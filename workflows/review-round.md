# Workflow: a Cowork review round

## Objective
Cowork reviews the app on a local copy, writes findings; Claude Code fixes them on a branch and hands back with a HANDOFF entry. Nothing goes live in this loop.

## Inputs
- Cowork's review on a LOCAL copy with a mock backend (never a customer shop), or its reports (`R29-reviews/` in `E:\jewelos` is the model).
- A brief named `TO-CLAUDE-CODE-R<n>.md` in `E:\jewelos`. **A new filename every round** (R31, R32, ...). Never append to a file Claude Code already read: it will not re-read it.

## Steps
1. (Cowork) Write the findings, ranked, with steps, expected vs seen, file and line where known. Write `TO-CLAUDE-CODE-R<n>.md`. Put a line in HANDOFF: `→ FOR CLAUDE CODE: read TO-CLAUDE-CODE-R<n>.md`.
2. (Claude Code) Read the brief. Read HANDOFF NOW, WAITING ON TANISH, newest 3 log entries. `git status`, `git log --oneline -5`. Claim NOW.
3. Branch: `git switch -c claude/r<n>-<topic>` from `main`. If the checkout has other sessions' dirty `js/` or `tests/` files, use `git worktree add -b claude/r<n>-<topic> .claude/worktrees/r<n>-<topic> main` instead.
4. Fix one finding at a time. A test with each fix where a test can reach it (`tests/regression.test.js`, `tests/role-check.test.mjs`). Follow the house rules in `CLAUDE.md` and `skills/jewelos-dev.md`.
5. Run the tests as in `workflows/ship-batch.md` step 3 and the agents in step 4. UI change: click it through (`skills/verify-ui.md`).
6. Commit on the branch. HANDOFF entry per `workflows/handoff-entry.md`: per finding, fixed / not fixed / disagree, with why. End with `→ FOR COWORK` and `→ FOR TANISH`. Release NOW.
7. (Cowork) Re-walks the fixed items on a fresh local copy (see `workflows/role-walk.md`), writes the next brief if needed.

## Expected output
A branch (not merged, not deployed) with commits, a HANDOFF entry listing each finding's outcome and real test counts.

## Edge cases and failure handling
- A finding is wrong or already fixed: say so with the evidence; do not "fix" it.
- A finding needs a decision (policy, e.g. may staff reverse a payment): do not guess; put it under `→ FOR TANISH`.
- A finding needs a deploy, migration or `ROLE_CHECK_MODE` change: write it as a proposal, do not do it.
- Cowork's copy differs from this tree (a check names a function that does not exist here): a newer working copy exists somewhere; stop and ask.

## Learned
(empty)

## Stop conditions needing Tanish's word
Merging the branch, deploy, migration, pushing, any policy decision, deleting `TO-CLAUDE-CODE*.md` files.

## Safety (same block in every workflow; do not weaken)
- **Never put a secret, API key or credential value** in a report, committed file or HANDOFF.md — name the variable, not the value.
- **Deploy only when Tanish says so.** Never run `/ship`, `/land-and-deploy` or `/canary`.
- No migration, deploy or key rotation without Tanish's explicit word.
- Never test on a real shop: a local build or E2E test shop `77c4aefe` only (`3720af09` is Tanish's own empty shop, phone checks only; `65a3ce29` is production, untouched).
- Delete nothing without Tanish's say.
- Ledger flag `kgLedgerOn` stays OFF.
- No dark mode yet.
