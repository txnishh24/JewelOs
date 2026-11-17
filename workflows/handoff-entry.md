# Workflow: write a HANDOFF entry

## Objective
Leave Cowork and Tanish what they need. `HANDOFF.md` is the only thing both Claudes read.

## Inputs
- What you did, the real test output, the final commit hash.
- `HANDOFF.md`: read the WHOLE file before writing (it has been clobbered twice by a stale copy). Re-open it just before you write and confirm your entry is still there after.

## Steps
1. Claim NOW before the work: replace the NOW line with `Claude Code - <what> - since <time>`. At the end set it back to `Nobody ...` with the live build, version ID and anything open.
2. Add the entry at the TOP of `## LOG — newest first`. Heading: `### YYYY-MM-DD (<ordinal> entry) - Claude Code (<model>) - <one-line summary, including what is NOT merged, deployed or migrated>`. The ordinal is the previous entry's number plus one.
3. Body, short labelled lines:
   - **What changed:** files and behaviour, in plain words.
   - **Tests:** exact counts from the run you just did (e.g. `536 passed, 0 failed`), not remembered ones. Say which suites you did not run.
   - **Not verified:** what you could not check (phone, real browser, other edges). Never let the entry sound more tested than it is.
   - **Rollback:** the commit, tag or Version ID to go back to; "nothing to roll back" if nothing shipped.
   - Dirty files you did not touch, if any.
4. End with the two tags, one line each; "nothing" is a valid answer:
   - `→ FOR COWORK: <the one thing to do next, or "nothing — FYI only">`
   - `→ FOR TANISH: <the one decision or action, or "nothing">`
5. Never put a secret, key or credential value in the entry. Name the variable only.
6. Commit the HANDOFF change with the work. Run `jewelos-handoff-writer` at session end.

## Expected output
A new top entry, NOW released, both tags present.

## Edge cases and failure handling
- Entry missing after you saved: someone saved from a stale copy; re-add it from your text and tell Tanish.
- Two sessions claim NOW: stop and ask.
- An older entry is wrong: add a correction in the new entry; do not rewrite history.

## Learned
(empty)

## Stop conditions needing Tanish's word
Trimming or archiving old entries (never delete; move to `docs/HANDOFF-ARCHIVE.md` only when he asks).

## Safety (same block in every workflow; do not weaken)
- **Never put a secret, API key or credential value** in a report, committed file or HANDOFF.md — name the variable, not the value.
- **Deploy only when Tanish says so.** Never run `/ship`, `/land-and-deploy` or `/canary`.
- No migration, deploy or key rotation without Tanish's explicit word.
- Never test on a real shop: a local build or E2E test shop `77c4aefe` only (`3720af09` is Tanish's own empty shop, phone checks only; `65a3ce29` is production, untouched).
- Delete nothing without Tanish's say.
- Ledger flag `kgLedgerOn` stays OFF.
- No dark mode yet.
