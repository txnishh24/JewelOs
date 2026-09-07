# JewelOS — the working folder

Assembled 6 September 2026. Before this, JewelOS existed as five partial copies
scattered across `Downloads`, and no single one had both the current client and the
tests. **This is now the only folder that matters.** Open it in Claude Code.

## Before you deploy: double-click `check.bat`

Ten seconds. It checks every file for typos, runs the regression tests, and sweeps for
things the code refers to that were never created. You don't need a terminal.

**38 tests passing** as of assembly.

If it says something failed, don't deploy — scroll up and read what. If step 3 prints a
list, that's a list and not a verdict: most entries are known false positives, documented
in `checks/README.md`. Compare it against the previous run. The two that must always be
clean are `backup-check` and `roundtrip` — a failure there means the backup is silently
dropping shop data, which has happened before.

**It tests nothing visual.** No button, no layout, no tap. There is no UI coverage
anywhere in this project. Open the app on a real Android phone before you trust it.

## What's in here, and where each piece came from

| | Source | Note |
|---|---|---|
| `index.html`, `js/`, icons, manifest | **batch14-eight-changes**, merged | Their 4 Sep work + my five fixes on top |
| `check.bat` | new | Double-click. Runs everything below |
| `tests/` | `JewelOS-v5-hardened`, 18 Aug | Was stranded there. Two stale tests fixed, five new ones added |
| `checks/` | `Downloads\jewelos-checks` | Your AST harness, brought in so it's all one folder |
| `supabase/functions/store-proxy/` | **pulled live from production** | Version 6. Your local copy was pre-v5 |
| `supabase/functions/auth-gateway/` | `JewelOS-v5-hardened` | Deployed v2, unchanged since May — local matched |
| `supabase/functions/razorpay-webhook/` | `JewelOS-v5-hardened` | Deployed v2, unchanged — local matched |
| `supabase/migrations/` | `JewelOS-v5-hardened` | 001 and 002, both already applied live |
| `CLAUDE.md`, `skills/` | the brain folder | Read automatically by Claude Code |
| `docs/` | | batch14 changelog, security notes |

## The test suite

```
node tests\regression.test.js
```

Or just use `check.bat`. Two seconds, no install, zero dependencies.

### Two tests were failing, and neither was a bug

Running this for the first time since 18 August gave two reds. Both were the *tests*
being out of date — both had been fixed in a chat session and never written back.

- **`getNextCounter`** asserted the client sends `x-shop-key`. It deliberately doesn't
  any more: store-proxy v5 stopped trusting that header, because a rowKey is a bearer
  secret with no expiry and no revocation. The suite went red *because the code got safer.*
- **PIN expiry** wrote the flat `ssj_last_active` key. PIN storage is scoped per shop, so
  the test was writing somewhere nothing reads.

### Five new tests

Four cover the batch14 fixes — weight recomputing on a hand-edited quantity, the audit
trail it now leaves, rollback on a failed save, and `shopScopedKey` separating two shops.

The fifth is the useful one. **It scans the real source for unscoped `localStorage` keys
holding shop state** — the bug class that has bitten six times (`ssj_cache`, the four PIN
keys, the audit log, the WhatsApp rules, `jewelos_pin_changed`, and four more in batch14).
Every time, the symptom was the second account on a shared device inheriting the first
one's data. Now a seventh fails the build instead of reaching a jeweller.

It caught two on its first run — dead `ssj_unlocked` fallbacks in `08-girvi-viewmode.js`
that read a key nothing writes. Fixed.

If you add a legitimately device-wide key, add it to that test's `ALLOWED` list with a
comment saying why. That list is the record of which keys are deliberately global.

## Two things to know

**The suite has 38 tests, not 64.** Sessions since August grew it to 64 in chat and never
wrote it back, so those extra tests exist nowhere on disk. If a future session claims
"64/64 passing", it rebuilt them in memory and they died with the session. Add new tests
to `tests/regression.test.js` or they aren't real.

**`checks/making-basis.js` is back and passing.** It referenced `itemMakingWeight()`, which
didn't exist in batch13 — that missing function was the clue that a newer build existed
somewhere. It does now, and all twelve of its making-charge assertions pass.

## The merge, 6 September

This folder was first built on batch13 plus five fixes. That was wrong. A Claude Code
session on **4 September had already shipped eight changes** on top of batch13 —
`jewelosbatch14eightchanges.zip` — and none of that work was in here.

The two had genuinely diverged. Neither was a superset of the other:

- **Theirs added** making-charge basis (`itemMakingWeight`, `itemMakingAmount`), girvi photo
  attachments (`gfAddPhotos`, `gfCompressPhoto`, `gfRenderPhotos`, `gfRemovePhoto`) and an
  editable WhatsApp template editor — around 375 changed lines, heaviest in settings,
  orders, inventory and purchases.
- **Mine added** `shopScopedKey`, the `updQty` weight-and-audit fix, the `cloudDiag` header
  fix and the dead `ssj_unlocked` fallbacks — none of which they had.

Their work is the base. My five fixes were re-applied on top; all fourteen edits landed
cleanly. 38 tests and every check pass on the merged result.

`jewelos-batch14-eight-changes.zip` — the 544 KB one from 6 Sep — is that same build with a
copy of `jewelos-batch11-regression-fixes.zip` accidentally zipped inside it. That nested
zip is the entire reason it is twice the size. Nothing in it is unique.

**The lesson worth keeping:** two sessions edited batch13 in parallel and neither knew about
the other. That is precisely what one folder prevents. From now on work *here*, and zip out
of this folder rather than building fresh copies in Downloads.

## Superseded — safe to delete

- `Downloads\JewelOS-v5-hardened\`
- `Downloads\jewelos-client-deploy\`, `...-deploy-v2\`, `...-batch4\`
- `Downloads\jewelos-checks\` — now lives here as `checks/`

The loose `.git` folder at the root of your Desktop is unrelated to JewelOS. Probably an
accidental `git init`. Harmless.
