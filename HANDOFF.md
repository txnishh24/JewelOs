# HANDOFF — read this first, write to it last

Two Claudes work on JewelOS and they cannot see each other:

- **Claude Code** lives in this folder. It has the code and git. It cannot see Tanish's
  memory, the `jewelos-brain` folder, the Control Room, or the live database.
- **Cowork** (the chat) has the live Supabase and Gmail, the Control Room, the brain
  folder and memory. It can read and write this folder through the device bridge.

This file is the only thing both of them read. If it isn't written here, the other side
does not know it. A commit message is not enough — Cowork does not read git log by habit,
and Claude Code does not read the brain folder at all.

**Claim the NOW line before you start, release it when you stop, and append a LOG entry
before you hand back.** End every entry with `→ FOR COWORK:` / `→ FOR TANISH:` (or
`→ FOR CLAUDE CODE:` from Cowork's side) — "nothing" is a valid, required answer, not an
omission. Read the WHOLE file before writing, not just NOW — this file has twice been
partly clobbered by a session saving from a stale copy (1 Oct, two separate incidents);
re-open it immediately before you write and confirm your entry is still there after.

---

## NOW — who is working, on what

> nobody

---

## WAITING ON TANISH

Neither Claude can decide these. Don't re-litigate them each session; just surface them.

**Open:**

- **`RESEND_API_KEY` / domain — deliberately postponed to deployment day.** Tanish wants to buy a
  domain (picked `jewelos.co`, still unregistered), verify it in Resend, and set the two Supabase
  secrets (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) all at once when he deploys. Not an oversight —
  don't chase it early.
- **Karigar cost on orders** (for real profit on order bills) — Tanish said not now (1 Oct). Order
  bills still show Profit ₹0 because there's no recorded cost for an order line (batch41, confirmed
  still the case through the premium redesign).
- **[uncertain — resurfaced 3 Oct, not previously in this section] Hinglish vs English empty-state
  copy.** batch42 (1 Oct) converted the app's own Hinglish strings to English; batch46/the redesign
  then *added new* Hinglish empty-state copy in Reports/Orders/Purchases. Cowork flagged this as a
  conflict needing Tanish's confirmation on 2 Oct; still listed as "pending from Tanish" in Cowork's
  3 Oct batch47 entry. **This was never actually added to this WAITING ON TANISH section** — it only
  ever lived inside LOG entries, which is how it nearly got lost. Surfacing it here now.
- **[uncertain — resurfaced 3 Oct] Phone test of the new (premium redesign) design.** Listed as
  pending in Cowork's 3 Oct batch47 entry; not previously tracked here.
- **[uncertain — open since 30 Sep, resurfaced 3 Oct] Call the jeweller of shop `3720af09`** (a real
  shop, 0 saved bills; someone tried a bill 30 Sep and it didn't save). Raised 30 Sep, repeated 3 Oct,
  never tracked here before.
- **[not Tanish's decision, but open and untracked anywhere else] `jewelos-health` / `jewelos-client-queries`
  (Cowork's own account skills) write to the paused Office, and `jewelos-health`'s drift SQL still
  reads `nextInvNo`, stale since migration 005 changed the invoice-floor source.** Flagged by Cowork's
  3 Oct skills audit; explicitly out of scope for Claude Code to touch; Cowork/Tanish's to fix.

**Closed (don't re-ask):** Day Book receipt photos → skipped (needs Supabase Storage if it returns) ·
Demo mode → built, batch21 · renewal contact → `+91 72086 23428`, no UPI handle in code ·
owner-PIN test → built 27 Sep · e2e test shop → reset before a same-day re-run streak, no cleanup
logic in the app · login token (F1) → option B, 6 h life, PIN on reopen within 6 h · old-gold
deduction → jeweller decides · Memo Bill → no GST · (1 Oct) signup → "Start Your Shop →" ·
Aadhaar/PAN → not stored (purged on load) · offline billing → reserved numbers per phone (batch44).
- **⚠ CORRECTED, was wrong in the original file: "Netlify badge → hidden with CSS" is NOT what
  actually happened.** batch43 tried `iframe.nl-badge-frame{display:none!important}`, but Cowork's
  live batch45 check (1 Oct) found the real badge has no class, so it stayed visible
  (`#nl-badge-frame`, no fix landed for that). Tanish's actual, later decision (recorded 2 Oct) was
  to **leave the badge visible and pad the bottom nav around it** (`.bnav` padding-bottom reserves
  64px for its footprint) — then on 3 Oct that same 64px was found to be a *double* reservation
  (safe-area-inset already covered it) and was removed as a separate mobile-nav bug fix. Net
  current state: **the badge is still live and visible**; nothing hides it. Don't claim it's hidden.

**Closed 9 Sep — billing.** Not free: JewelOS is a **paid monthly subscription, collected
outside the app.** Tanish demos in person, the shop pays by UPI, he sets `paidUntil` in
Supabase. There is no in-app payment and none planned. Enforcement shipped 9 Sep
(`paidUntil`), and the in-app upgrade path was removed the same day. Do not re-open this
or re-add tier UI.

---

## LOG (newest first)

### 2026-10-03 · Claude Code — condensed this file (read this before trusting the shorter LOG below)

This file was 2637 lines / 84 LOG entries; it's now ~400. A read-only audit (fork, this
session) found ~6 rounds of the same save-lock review/fix cycle, ~45 closed batch30-47 QA
entries, and 12 premium-redesign phase entries all superseded by their own final state —
condensed each closed group to one entry keeping what still matters (shipped facts,
permanent by-design limits, anything still open), dropping only round-by-round process
detail. Also fixed a wrong WAITING ON TANISH claim ("Netlify badge hidden with CSS" — it
isn't) and promoted 4 items that were only ever mentioned inside LOG entries (never
actually tracked) up into WAITING ON TANISH, where they'd nearly gotten lost: Hinglish
copy decision, phone test of the redesign, call shop `3720af09`, `jewelos-health`/
`jewelos-client-queries` stale SQL.

**Nothing is lost** — full original history is in `git log -- HANDOFF.md` / `git show` on
any commit before `559ce28`. Tanish reviewed the audit (inventory, groups, dead-reference
checks, contradictions) and approved the replacement before this was committed.

Committed `559ce28`, pushed fast-forward to `origin/main` (`86e7d5f..559ce28`).

→ FOR COWORK: the file you're reading is restructured, not just appended to — re-read it
fully rather than assuming the old entry layout/line numbers. If you need the exact
reasoning/timeline behind any closed item (e.g. a specific Opus review round's bug
mechanism), it's in git history, not in this file anymore; ask and I'll pull it back out.
→ FOR TANISH: nothing further.

---

### 2026-10-03 · Claude Code — skills audit executed + pushed

Cowork's 3 Oct skills audit (below, condensed) found `skills/jewelos-change.md` /
`jewelos-debug.md` / `jewelos-dev-rules.md` overlapping 3x, several stale lines, a
tool-name hardcode in `verify-ui.md`, and a `CLAUDE.md` line naming agents it believed
didn't exist. Tanish saved a merged `jewelos-dev` skill directly into the repo at
`skills/jewelos-dev.md`. Claude Code then: repointed `CLAUDE.md` (~L85, Procedures list)
and `tests/e2e/README.md` to it; added the `.claude/skills/jewelos-dev/SKILL.md` pointer
stub; archived the 3 old files and their 2 stub dirs to `skills/_archive/` and
`.claude/skills/_archive/` (`git mv`, not deleted); reworded `verify-ui.md`'s tool-name
line to not hardcode either side's literal MCP prefix (Claude Code and Cowork differ —
confirmed `mcp__plugin_playwright_playwright__*` is what Claude Code actually sees now);
left the `Evidence Collector`/`Reality Checker` `CLAUDE.md` line alone after checking —
both agents **are** in Claude Code's current available-agent list, so the audit's "do not
exist" finding no longer holds (flagged back to Cowork to re-check their side). Did not
touch `jewelos-health`/`jewelos-client-queries` (Cowork's account skills) as instructed.
Committed `606c2a2`, pushed fast-forward to `origin/main` as `606c2a2`→`86e7d5f`
(`66a833c..86e7d5f`). **Verified by this audit:** `skills/jewelos-dev.md` exists and
matches; the 3 old files and 2 stub dirs are genuinely under `_archive/`, not deleted;
`CLAUDE.md`'s Procedures list and Rules line now point at `jewelos-dev.md`; both commits
exist in `git log`.

→ FOR COWORK: done and pushed; pull before assuming the old file layout.
→ FOR TANISH: nothing.

---

### 2026-10-03 · Cowork — skills audit findings (condensed, nothing deleted by Cowork)

Found: the 3 skill files above overlapping; stale "no browser automation" line (false,
`tests/e2e/` exists — this line is gone now, archived with the files it was in); stale
`~/Downloads/jewelos-checks/` reference — **note: that folder does still exist on disk**,
it's just a second, unmanaged copy of the `checks/` scripts outside the repo, not the one
the project actually uses (repo `checks/` + `check.bat` is canonical); `decisions/log.md`
reference — **confirmed: no such folder exists anywhere in the repo**; `verify-ui.md`'s
hardcoded tool name (fixed, see above); the `Evidence Collector`/`Reality Checker` line
(checked above, currently accurate, not fixed). Also flagged the `jewelos-health`/
`jewelos-client-queries` issue now carried into WAITING ON TANISH above.

→ FOR CLAUDE CODE: (done, see entry above.)
→ FOR TANISH: nothing further needed (your "saved" + putting the file in the repo closed this).

---

### 2026-10-03 · Save-path / premium-redesign release cycle — CONDENSED (16 original entries, 2026-10-03, between the "batch47 zip VERIFIED and CLEARED" and "merged premium-redesign into main" entries)

**This replaces a long back-and-forth** (Cowork/Opus review → Claude Code fix → re-review,
repeated ~6 times) over a save-lock redesign (lock token, generation counter, canonical
stringify, superseded-call handling) meant to close rare (~70s-stall) data-loss edge cases
in `saveToCloud()`. Each round closed real findings and opened a new one; after the 6th
round still weren't fully clean, **Tanish picked "Option 2" in chat (15:29 IST, 3 Oct):
ship the premium redesign today on batch46's existing (unmodified) save path, and do the
save-lock rework as its own, separately-reviewed batch later.**

**What Claude Code actually did (verified against the current repo, not just the log):**
1. Branched `save-lock-wip` off `main` and committed the complete lock-token/generation-
   counter/canonical-stringify work + its tests there (`902efa9` — **confirmed exists**,
   confirmed the branch currently still holds 7 occurrences of
   `_canonicalStringify`/`_saveLockGeneration`, nothing lost).
2. Reset the release tree's `js/00-config-state.js` and `js/01-sync-core.js` to the exact
   batch46-deployed bytes (`git checkout aa15ed9 -- ...`; **confirmed**: current `main`'s
   `00`/`01` have **zero** occurrences of any of the save-lock-rework identifiers — the
   revert genuinely stuck).
3. Reverted `tests/regression.test.js` to match (batch46's own 318 tests + the 1
   independent staff-tab-order test), landing at 319/319 on this tree.
4. Checked `08-girvi-viewmode.js`'s `resetSaveLock()` still works harmlessly against
   batch46's `00` (implicit global, same bucket as 6 pre-existing tolerated ones).
5. `check.bat` clean, e2e 19/19 on exactly this tree.
6. Built `jewelos-batch47-DEPLOY.zip` (16 files, 317.2 KB — **confirmed this file exists**
   in `~/Downloads`) and `docs/CHANGES-batch47.md` (**confirmed exists**).
7. Committed the revert as `f9adde2` (**confirmed exists**) and the staff Day-Book/Settings
   tab fix as `4f6e791` (**confirmed exists AND confirmed still live**: `05-auth-login.js`
   line 628's tab array currently includes `'daybook'` — the fix survived the 00/01-only
   revert, as it should, since 05 was never touched by it).

**Cowork then verified** the zip (`jewelos-batch47-DEPLOY.zip`) byte-for-byte against the
folder and against what's live, confirmed the `00`/`01` hashes match batch46-live exactly
(sha256 `bd4e3005…` / `168f7e22…`), spot-checked the staff tab fix, and **cleared it**:
Tanish can drag it into Netlify. As of the last entry in this file, **live was still
batch46** — batch47 had not yet been deployed; Cowork's clearance says drag it, but no
later entry confirms Tanish actually did so or that Cowork re-verified live afterward.
**[uncertain — never confirmed in this file: was batch47 actually deployed?]**

**Known, accepted, still true on `main` today:** `08`'s `resetSaveLock()` assigns an
undeclared `_saveLockToken` under batch46's `00` (harmless, diag-button only; cleanup
belongs with the eventual save-lock batch). The underlying rare-stall save-path edge cases
the whole review cycle was chasing are **not fixed on `main`** — they're exactly batch46's
pre-existing behavior, which is what Option 2 explicitly accepted ("ships no new risk vs.
live"). The full analysis of those edge cases (what exactly goes wrong, in what order,
after how long a stall) lives only in the original file's history if this ever needs
re-deriving; see "what you lose by merging" below.

**Separately in this window:** `main` was pushed to `origin` (`7bb7f60`, confirmed a plain
fast-forward, not force) and the premium redesign (`premium-redesign` branch, see next
entry) was fast-forward-merged into `main`.

**Next batch (not started as of this file):** save-lock rework, designed by Opus first
(single save queue, superseded calls re-queue rather than claim success, no watchdog
freeing a lock under an in-flight request), implemented on `save-lock-wip` with tests for
phone-sleep and Postgres jsonb key-reordering. Ships as its own zip, its own review cycle.

→ FOR COWORK: `save-lock-wip` (`902efa9`) is untouched and ready for the next design pass
whenever Opus is ready; don't extend it before that design exists. Please confirm whether
batch47 actually got dragged into Netlify — this file never says so.
→ FOR TANISH: say if/when you dragged `jewelos-batch47-DEPLOY.zip` in, so this gets logged.

---

### 2026-10-02 → 2026-10-03 · Premium redesign Phases 0–5 + final cleanup + merge — CONDENSED (12 original entries)

**Full scope, done and merged into `main` (confirmed: `premium-redesign` branch still
exists, pointing at the same commit `main` now also contains — fast-forward, zero
conflicts, confirmed by `git log main --oneline --not premium-redesign` being empty at
merge time).** Presentation-only throughout — no money math, no Girvi interest engine, no
Day Book cash-derivation logic touched anywhere in any phase; every phase independently
ran `check.bat` (regression suite held at 318→321/321 as classes were added) and was
live-verified via Playwright against the real e2e test shop, with before/after screenshots
in `redesign-shots/<screen>/{375,768,1440}.png` (**confirmed: all 10 screen folders exist
on disk** — dashboard, daybook, girvi, orders, purchases, reports, sales, settings,
sign-in, stock).

- **Phase 0 (Opus audit, 2 Oct):** found `js/05-auth-login.js:628`'s staff-hide tab list
  missing `'daybook'` — staff lost Day Book, kept Settings (likely backwards). Flagged,
  explicitly NOT fixed as part of the redesign (out of scope) — **fixed later, separately,
  same day as the save-path findings A/B/D, commit `4f6e791`** (see entry above; confirmed
  still live on `main`).
- **Phase 1 (1 Oct):** design tokens only, `index.html` `:root` — new gold tones, 8-step
  spacing scale, radius/font/type tokens, `.btn-warning` class. Nothing repointed yet, zero
  visual change. Full plan approved by Tanish, saved at
  `C:\Users\ADMIN\.claude\plans\dynamic-dreaming-jellyfish.md` (**confirmed this file
  exists** on this machine, outside the repo).
- **Cross-cutting fixes (1 Oct, Opus-reviewed):** `safeConfirm()` gained a 3rd `'warn'`
  (amber) state for 4 misused call sites; "Signing in..." no longer rendered in error-red;
  `.bnav` padding-bottom was given an extra 64px to clear the Netlify badge (**this was
  later found to be a double-reservation and removed — see the mobile-bottom-nav entry
  below and the corrected WAITING ON TANISH Netlify-badge note**).
- **Phase 2 (2 Oct):** shell — login/signup, header, nav, dashboard. Removed the literal
  `' →'` suffix from 10 button-label strings. 375px mobile width **not verified this
  session** (`resize_window` didn't actually resize the viewport) — confirmed later via
  Playwright's own 393px project instead.
- **e2e credentials saga (2 Oct, 3 entries, now fully closed):** Claude Code was blocked on
  missing e2e test-shop credentials; Cowork found `.env.test` was at the **repo root**, not
  `tests/e2e/` as the setup note said (ambiguous wording, now fixed in
  `tests/e2e/README.md`), already fully populated; unblocked once run from the repo root,
  19/19 e2e passed.
- **Phase 3 (2 Oct):** Stock/Sales/Orders/Purchases/Reports/Settings — ~40 stale pre-
  redesign gold/silver `rgba()` literals repointed to the Phase-1 tokens; `.fg label`/`th`
  got the uppercase/muted treatment; new `.btn-ink` class for header "+ Add" buttons.
  Explicitly left out: Customers (no mockup), 2 ad-hoc color families that were never the
  named gold/silver token (flagged as a separate inconsistency, not actioned later —
  **still open, low-stakes, untracked elsewhere**).
- **Phase 4 (2 Oct):** Girvi — same bright-hex-to-token sweep across `index.html` and 4 JS
  files; found (and fixed in the same pass) a gap in Claude Code's own earlier Phase 2/3
  work (`.ib-up`/`.trend-*`/`.itag-*` Dashboard/Stock badges were also unfixed bright hex).
- **Phase 5 (2 Oct):** Day Book — smallest of all 5 phases (no dedicated CSS section;
  inherits Phase 1/3's shared-component fixes automatically). Added
  `font-variant-numeric:tabular-nums` to 5 shared value classes app-wide.
- **Mobile bottom-nav bug (3 Oct, separate from the phase work):** Tanish reported the
  bottom nav buttons floating above the screen bottom. Root cause: `.bnav`'s
  `padding-bottom` had a stray extra 64px (pre-dating the redesign, confirmed via
  `git show` — **this is the same 64px the "cross-cutting fixes" entry above had added
  specifically to clear the Netlify badge**, so removing it may have re-exposed that
  original badge-overlap problem; nothing in this file re-checks that). Fixed to just
  `env(safe-area-inset-bottom,0px)`.
- **Final cleanup (2 Oct):** swept ~40 remaining bright-hex instances across
  `03`/`05`/`06`/`07`/`10`-js and `index.html`; corrected 2 earlier wrong assumptions
  (`.btn-pdf`/`.btn-wa` are NOT dead — they're used as static `class=` attributes in
  `index.html`, invisible to a JS-only grep). **The luxury redesign is complete end to
  end** across all 10 planned screens.
- **Final check.bat + verify-ui pass (3 Oct):** `check.bat` all-green across the whole
  branch; e2e 18/19 (the 1 failure — `invoice-numbers.spec.js` — is the same already-
  documented flaky test, passed alone, **not a regression**, confirmed by grepping this
  file's own history for the phrase, which shows the identical flake pre-dating this
  redesign by weeks).
- **Merge (3 Oct):** `git log main --oneline --not premium-redesign` empty → clean
  fast-forward (`dc82a16..1d113c9`), not a 3-way merge, zero conflicts possible. Re-ran
  `check.bat` on merged `main`: clean, 321/321.

**Still-open, low-stakes items from this whole arc, not resurfaced anywhere since:**
`.btn-dark`'s other 2 call sites with no mockup evidence (asked "say so and it's a
one-line class swap" — never answered); the 2 ad-hoc non-token gold/silver color families
in `02-ui-inactivity-modals.js` (Phase 3); whether `.bnav`'s padding removal (3 Oct)
re-exposes the original Netlify-badge bottom-nav overlap the 64px was added to cover
(nobody re-checked after removing it).

→ FOR COWORK: nothing — FYI only. The whole branch is merged and check-clean; next real
decision is Tanish reviewing it live end-to-end, and confirming the Netlify-badge/bottom-
nav interaction wasn't reintroduced by the 3 Oct padding fix.
→ FOR TANISH: nothing new beyond what's already in WAITING ON TANISH above.

---

### 2026-10-02 · Save-path review cycle #1 (lock token, callback isolation, watchdog/retry race) — CONDENSED (6 original entries)

Separate from (and earlier than) the 3 Oct save-lock cycle above, this was the *first*
round of hardening `saveToCloud()`: a lock-token (`_saveLockToken`) so a stale call's late
response can't clobber a newer save's state, a `_concluded` flag so a throwing callback
can't double-fire, and a watchdog re-stamp fix so a legitimately-retrying save chain isn't
mistaken for a hung one. Went through 2 Opus review rounds (first found a HIGH: the
watchdog freeing the lock mid-retry under a dead connection; second confirmed the fix and
flagged a session-restore e2e test as "most likely a test race, but 2 real reauth gaps" —
a 401 with a non-JSON body falling into the generic network-error path instead of
reauth, and the watchdog's 30s timeout being shorter than a single save attempt's own 60s
budget). All items fixed and tested (regression climbed 319→321 across this arc, e2e
18/19→19/19 after the test-race fix). **This is the predecessor work the 3 Oct cycle
built on and then (for `00`/`01`) reverted back out for Option 2** — i.e. the lock-token/
watchdog fixes from *this* arc are still live on `main` today (they predate and are
independent of the later generation-counter rework that got shelved). Confirmed: none of
*this* arc's identifiers (`_saveLockToken`, `_concluded`) were part of what got reverted —
only the newer `_saveLockGeneration`/`_canonicalStringify` additions were.

→ FOR COWORK: nothing — FYI only, this is historical, already layered under the 3 Oct work.
→ FOR TANISH: nothing.

---

### 2026-10-01 · Touch-target CSS fix

`.btn-sm`/`.btn-xs` row-action buttons (Edit/Delete/Reverse, 52 call sites) were under
Android's 48dp tap-target minimum. `min-height` added, CSS-only. **Not verified on a real
phone** — flagged in the original entry as untested; no later entry confirms a real-phone
check happened.

→ FOR COWORK: nothing — FYI only.
→ FOR TANISH: eyeball row-action buttons on a real Android phone (never confirmed done).

---

### 2026-10-01 → 2026-09-30 · batch30–47 QA/fix history — CONDENSED (≈45 original entries)

**This is the full shipped-bug history from the last QA cycle before the premium
redesign.** All of it is closed/shipped; current production code (and `main`) reflects the
end state only. Condensed here to preserve the facts that still matter — what's live, what
limits are permanent/by-design, what's still genuinely open — without the blow-by-blow of
each Opus review round. If you need the exact reasoning/timeline behind any one of these,
it exists in the original `HANDOFF.md`'s full history (see "what you lose" below) or in the
commit log (`git log --oneline` around 29 Sep–1 Oct covers all of it).

**P0 money bugs found and fixed, in order found:**
- Day Book was dropping most Girvi repayment types (only `payment`/`interest`/`refund`
  posted; the Pay dialog's actual default type is `general`). Fixed to a deny-list
  (skip only `penalty`/`waiver`); Reports' `calcCashFlow` was made to agree.
- Sale bills accepted unlimited overpayment and booked the overpaid amount as real cash.
  Fixed with `saleOverpaidBy()`, refusing anything over ₹1 excess; applied to both
  `recordSale` and `saveEditBill`.
- Purchase bills: a load/normalize loop unconditionally overwrote `amountPaid` to the full
  total whenever `purchaseCfg.credit` was false (the default) — silently erasing every
  partial payment on every load. Root-cause fixed (deleted the override) + existing-data
  repair logic for bills already corrupted this way.
- `splitRows` (the sale form's payment-row array) could go stale after a Girvi
  payment with no sale in between, causing a `TypeError` and `nowPaying.amount` silently
  landing at 0. Root cause: two leftover "clear stale rows" lines that belonged to a
  different form. Deleted.
- Invoice-number integrity, in 2 stages: F3 moved number assignment to a single atomic
  server-side counter at save time (previously only the first sale per session asked the
  counter; the device's own stale copy produced a real, confirmed-live duplicate:
  `INV-030` existed twice in the test shop). Then (30 Sep–3 Oct) a chain of HIGH findings
  on the counter's "floor" logic — a typed FY-style invoice number (`2025-26/001`) could
  permanently jump a shop's whole numbering series into the billions, or a crafted/typed
  huge number could overflow the Postgres integer and brick invoicing for that shop
  entirely. Fixed across 3 migrations (`004`→`005`→`006`, **all 3 confirmed present** in
  `supabase/migrations/`): 005 changed the floor's source from the mutable `nextInvNo`
  blob field to "highest real `INV-<digits>` bill + 1" (so nothing the client sends can
  move it), 006 added a cap so a crafted huge typed number more than 1000 above the real
  series doesn't count toward the floor at all. **Confirmed still applied** (migration
  files present; this was deployed live per multiple "VERIFIED LIVE" entries in the
  original file, not independently re-verified against the live database by this audit —
  no network access).
- A client-side companion fix (`_saveId` tracking, "unconfirmed save ids") stops a save
  that actually landed from being wrongly rolled back and resubmitted as a duplicate when
  its own confirmation response is delayed/lost. **This mechanism is the same one later
  review rounds (2 Oct, 3 Oct) found edge cases in** — see the two save-path review-cycle
  entries above. Its known cross-call misattribution risk (a stale call's leftover
  `_saveId` sitting in the shared, unscoped `_unconfirmedSaveIds` array could in rare cases
  be matched to the wrong save) was flagged twice (30 Sep, 2 Oct) and **is still present on
  `main` today** — scoping/redesigning that array was explicitly deferred both times,
  not fixed. **[uncertain whether this has been addressed since — nothing in the file
  says so; flagging as a standing known limitation, not confirmed resolved.]**
- GST defaulted to 0% on a GST-type bill (fixed: defaults to 3%, refuses saving a GST bill
  at literal 0%); Memo Bill still printed GST/HSN lines for shops with no valid GSTIN
  (fixed: Memo Bill strips all GST presentation); GSTIN/phone format validation added
  (format + mod-36 checksum for GSTIN).
- Market/collateral valuations used gross weight instead of net everywhere (Stock list,
  Girvi collateral/LTV, bill totals) — fixed to use net (`girviItemWt`, `mktVal`)
  throughout except printed labels (deliberately still gross, by design).
- Rates had no sanity bounds (₹0, ₹100, 22K priced above 24K all saved) — fixed with
  range/ordering checks, and **a shop that has never saved real rates now cannot record a
  sale or open a Girvi loan at all** until it does.
- Girvi had no loan-to-value guard at all (one test loan reached 474% LTV before anyone
  noticed) — fixed with a confirm above **75%** (Tanish's decision, the RBI cap, 30 Sep).
- Staff accounts losing Day Book and keeping Settings — flagged 2 Oct (Phase 0 audit),
  fixed 3 Oct (`4f6e791`, confirmed live — see the save-path entry above).

**Offline billing (batch44, 1 Oct):** each phone reserves 5 invoice numbers ahead of time;
an offline sale takes the next reserved number, applies locally, and queues
(`jewelos_sale_outbox`, shop-scoped) until the next successful cloud load replays it. **By-
design, permanent limits (ponytail-flagged, not bugs):** only sales work offline (Girvi,
orders, purchases, Day Book still need internet); 5 bills per outage per phone; 2+ phones
offline simultaneously can interleave/leave number gaps (gaps were already tolerated,
duplicates still impossible); the same item sold on 2 offline phones both succeed and the
stock ends at 0 with both sales recorded (not reconciled).

**Deploy/infra state reached by the end of this arc (30 Sep):** migrations 004/005
applied; `store-proxy` deployed to v8; `auth-gateway` deployed to v6 (session TTL cut from
12h to 6h). **Not independently re-verified live by this audit** (no network access) —
taken from the file's own "VERIFIED LIVE" entries at face value, each of which did its own
live byte/hash comparison at the time.

**Copy/UX fixes across this arc (batch42, etc.):** Hinglish → English on the app's own
screens (badges/toasts; WhatsApp messages to customers deliberately kept Hinglish); Girvi
icon 🥊→🤝; Sign Out ⚠→🚪; "1 orders"/"1 bills" → proper pluralization; VIP+Risky+New badge
clash fixed; Aadhaar/PAN removed entirely (`normaliseData` deletes any stored values on
load — irreversible by design); "Start Your Shop →" signup copy; product/stone-
weight/wastage/hallmark fields added; bill Edit/Refund/Delete surfaced on the bill preview
itself, not just inside the Customer popup.

**Netlify badge: see the corrected WAITING ON TANISH note above — this was never actually
resolved**, despite an early "hide with CSS" fix attempt (batch43) that didn't survive
contact with the real live badge markup.

**File-integrity incidents (1 Oct, Cowork, 2 separate warnings):** this file was partially
overwritten by a stale save at least twice during the heaviest QA period (entries went
missing, then were manually restored from git). Both were caught and repaired at the time;
flagging here as a reason to always re-read before writing, already captured in this
draft's header.

→ FOR COWORK: nothing — FYI only, fully historical.
→ FOR TANISH: nothing beyond what's already open in WAITING ON TANISH above.

---

### 2026-09-30 · F1–F4 hardening (invoice floor, failed-save rollback, cross-device sync gaps) — CONDENSED (10 original entries)

The save/sync foundation work the batch30+ QA cycle above was built on. In order:
**F3** moved invoice numbering to the atomic server counter at save time (superseded by
the 005/006 floor fixes above — same underlying mechanism, hardened further later).
**F4** made Girvi/order creation and edit/close/default/archive/recover all go through a
snapshot-lock-rollback pattern (`_girviCommit`/`_orderCommit`), so a failed cloud save now
rolls back locally and reopens the form for retry instead of silently losing the record —
previously a failed Girvi save would vanish on the next 15s auto-refresh, taking its
customer link and ornament photos with it. **F2** found `loadFromCloud` never read back
`auditLog`/`activityLog`/`waRules` at all (any fresh phone login would wipe them shop-wide
on its first save) and that `stockMovements` wasn't persisted anywhere, even locally —
fixed, all 4 now sync and are capped (activity 200, audit 300, stock 5000). An Opus
second-model review of this whole arc found one HIGH (the typed-FY-invoice-number floor
jump, see above, fixed via migration 004→005→006) and several MEDIUM/LOW items (a phone
clock running behind a token's remaining life being wrongly treated as "revoked" — fixed
by `store-proxy` returning an explicit `reason` field; `saveToCloud` having no fetch
timeout, able to leave locks stuck on a stalled connection — fixed, 60s attempt timeout).

→ FOR COWORK: nothing — FYI only, fully historical and superseded by later hardening above.
→ FOR TANISH: nothing.

---

## What's actually still open right now (cross-referenced against every LOG entry above)

- The 2 items in WAITING ON TANISH → Open (RESEND_API_KEY/domain, Karigar cost).
- The 4 items this audit added to WAITING ON TANISH that were previously only buried in
  LOG entries (Hinglish copy decision, phone test of the redesign, call shop `3720af09`,
  `jewelos-health`/`jewelos-client-queries` stale-SQL cleanup).
- The Netlify badge is still live and visible — nothing in this file's history actually
  hides it, despite one closed-item note claiming otherwise (now corrected above).
- `_unconfirmedSaveIds`'s cross-call misattribution risk — flagged twice, fixed never,
  standing limitation in production code today (unless resolved outside this file).
- The save-lock rework (`save-lock-wip` branch) — designed-but-shelved, no current ETA.
- Whether `jewelos-batch47-DEPLOY.zip` was actually dragged into Netlify — Cowork cleared
  it, nobody in this file confirms the deploy happened.
- Whether removing the 3 Oct mobile-bottom-nav 64px padding re-exposed the original
  Netlify-badge/bottom-nav tap-target overlap it had been added to cover.
- `.btn-dark`'s 2 un-mockuped call sites, and 2 ad-hoc non-token color families in
  `02-ui-inactivity-modals.js` — both explicitly flagged as "say so if you want this
  changed," never answered.

---

*This file was condensed from an 84-entry, 2637-line history on 2026-10-03 by a
read-only audit (see `git log` for the commit). Nothing was deleted from the repo —
the full original history is available via `git log -- HANDOFF.md` / `git show` on any
commit before this one. A per-entry "what you lose by merging" list was produced at
condensation time; ask if you need it restated.*
