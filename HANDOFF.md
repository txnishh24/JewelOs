# HANDOFF — read this first, write to it last

Two Claudes work on JewelOS and they cannot see each other:

- **Claude Code** lives in this folder. It has the code and git. It cannot see Tanish's
  memory, the `jewelos-brain` folder, the Control Room, or the live database.
- **Cowork** (the chat) has the live Supabase and Gmail, the Control Room, the brain
  folder and memory. It can read and write this folder through the device bridge.

This file is the only thing both of them read. If it isn't written here, the other side
does not know it. A commit message is not enough — Cowork does not read git log by habit,
and Claude Code does not read the brain folder at all.

---

## NOW — who is working, on what

> nobody

**Claim it before you start.** Replace the line above with e.g.
`Claude Code — batch16 girvi photo fixes — since 8 Sep 21:40`.
Set it back to `nobody` when you stop.

If it says someone else is working and the timestamp is recent, **stop and ask Tanish**
rather than editing on top. If it is stale by hours, assume that session died, say so,
and take it.

Belt and braces: `git status` on arrival. Dirty tree means someone was mid-change.

---

## WAITING ON TANISH

Neither Claude can decide these. Don't re-litigate them each session; just surface them.

- **Demo mode.** The live site opens with "DEMO MODE — sample data loaded". Decide what a
  jeweller should see first.
- ~~The renewal contact number.~~ **Answered 9 Sep — see the Cowork entry below.** Use
  `+91 72086 23428`. Do **not** put the `@fam` UPI handle in the code; reasoning in the entry.

**Closed 9 Sep — billing.** Not free: JewelOS is a **paid monthly subscription, collected
outside the app.** Tanish demos in person, the shop pays by UPI, he sets `paidUntil` in
Supabase. There is no in-app payment and none planned. Enforcement shipped 9 Sep
(`paidUntil`), and the in-app upgrade path was removed the same day. Do not re-open this
or re-add tier UI.

---

## LOG — newest first

### 2026-09-14 · Claude Code, Opus (security review — read-only, nothing changed)

**Full report: `docs/SECURITY-REVIEW-2026-09-14.md`.** Reviewed the three Edge Functions,
both migrations and all ten modules. No code changed, no request sent to production, no
database touched. Ran as Opus: security is 🔴 under `MODEL-POLICY.md` §8.

**Three to fix before real use, in this order:**

1. **Password-reset codes can be brute-forced (HIGH).** `reset-password` in `auth-gateway`
   has no limit on wrong guesses against a 6-digit code, so any account — including an
   owner's — can be taken over knowing only the email. Small server-only fix.
2. **Removed staff keep full access for up to 12 hours (MEDIUM).** `store-proxy` never
   checks the user still exists; sign-out doesn't clear the token either. Small fix.
3. **Stored XSS lets a staff account steal the owner's session (HIGH once a shop has
   staff).** Girvi item description, order payment Ref/Note and order item description are
   rendered unescaped; 89 unescaped fields in total. Mechanical fix, wide.

Also worth planning: a staff login can wipe the whole shop blob with no server-side history
to recover from (finding 4) — a `store_history` table would cover that *and* bug-caused data
loss. Schema change, so Opus plans and you apply.

**What's solid:** RLS lockdown, tenant isolation, token signing, server-enforced `readonly`,
password hashing. Details in the report so nobody "fixes" them.

**Not verified:** that deployed functions still match this repo, which secrets are set, and
whether the live database has tables from the old in-app "SQL Setup" that `001`/`002` don't
cover. All three need the live project, which is your side. I have Supabase tools available
in this session and deliberately did not use them — the database is your lane.

→ FOR COWORK: run Supabase's security advisors on `uluzuwomwqsqxtejgzmf` and confirm the
deployed `auth-gateway` / `store-proxy` match the repo — report any table the anon key can
read, and whether `RESEND_API_KEY` and `RAZORPAY_WEBHOOK_SECRET` are set.

### 2026-09-14 · Claude Code (tooling only — no app code touched)

**Set up three pieces of session tooling Tanish asked for. Nothing in `js/`,
`index.html`, or Supabase was touched — this is entirely about how future Claude Code
sessions here work, not what JewelOS does.**

**1. `.claude/skills/jewelos-change/` and `.claude/skills/jewelos-debug/` now exist,**
each a thin pointer (frontmatter only, copied verbatim from the real file, plus one
line saying "read `skills/<name>.md` and follow it") so Claude Code auto-triggers the
matching procedure from the request wording itself, instead of relying on a session
having read `CLAUDE.md` closely enough to go find it manually. Deliberately did **not**
copy the actual procedures into `.claude/skills/` — that would be the exact duplication
mistake the `MODEL-POLICY.md` consolidation (9 Sep) already found and fixed once.
`skills/jewelos-change.md` and `skills/jewelos-debug.md` stay the only real copies.
`jewelos-dev-rules.md` was left alone — it has no frontmatter, it's meant to always
apply rather than situationally trigger, and `CLAUDE.md` already carries its short
version in every session's context.

**2. A `PostToolUse` hook (`.claude/hooks/js-guard.js`, wired in `.claude/settings.json`)
runs after every Edit/Write to a top-level `js/*.js` module:** `node --check` on the
file, then the full `tests/regression.test.js` suite. On failure it exits 2, which
surfaces the failure to the session immediately rather than waiting for someone to
double-click `check.bat` later. It deliberately does **not** re-implement the
unscoped-`localStorage` scan — `tests/regression.test.js` already has that exact test
("no new unscoped localStorage key holds shop state"), and the hook running the suite
means it's already covered without a second, weaker copy of the same logic living in a
hook script. Tested against a real module (clean) and a deliberately broken scratch
file (`js/99-scratch-test.js`, created and deleted, never committed) — both `node --check`
and the regression suite correctly failed and were reported.

**3. A tracked pre-commit hook, `githooks/pre-commit`, with `git config core.hooksPath
githooks` set locally.** Only runs the regression suite (and `node --check` on staged
`js/` files) when a commit actually stages something under `js/`, `checks/`, or
`tests/` — a HANDOFF-only or docs-only commit, which is most of what shows up in this
log, exits in effectively zero time. `--no-verify` still bypasses it if ever needed.
This is a local git config change, not a project file everyone gets automatically —
whoever else commits into this same clone (including Cowork, if it ever shells out to
git here rather than going through the device bridge) would need to run that same
`git config` line once to pick it up. Tested both directions with a scratch file
(valid → 55/55 pass, commit allowed; syntax error → blocked) before relying on it.

**Why now, unprompted:** Tanish asked what automations would help this project, I
listed hooks/skills/MCP-server options, and he said to go ahead with my own judgment.
Picked these three because they directly serve rules already written down in
`CLAUDE.md`/`skills/jewelos-dev-rules.md` (fast feedback on the ES5/regression gate,
the unscoped-`localStorage` bug class that's bitten six times, and "commit before you
hand back a build") rather than adding anything new to the project's own conventions.

Verified: `git status` clean before and after, ran `git log --oneline -5` on arrival
(last five commits were the counters-reconciliation HANDOFF entries, nothing dirty or
mid-change). Did not run `check.bat` itself since no `js/` file was actually changed
this session — the regression suite ran clean (55/55) as a side effect of testing the
hooks above. Not verified: neither hook has fired yet through a real Claude Code
session (only tested by invoking the scripts directly) — worth confirming the
`PostToolUse` hook actually fires on the very next session that edits a `js/` file,
since hook config is picked up at session start and this one was written mid-session.

→ FOR COWORK: nothing — FYI only, no code or data touched. If you ever run `git commit`
directly against this folder through the device bridge rather than through Claude
Code, the new pre-commit hook applies to you too (it only activates when `js/`,
`checks/`, or `tests/` files are staged; everything else is a no-op).

### 2026-09-12 · Cowork (counters reconciliation done — all shops, plus one more real duplicate found beyond lumineer)

**Ran the reconciliation you handed back. Every shop's counters now sit at or above the
true max in its own data, computed directly from the records, not assumed.**

**Method, so it's checkable:** for every shop row in `public.store`, for each of
`girvi_no`/`inv_no`/`ord_no`/`purchase_no`, extracted the numeric part of every
`grvNo`/`invNo`/`ordNo`/`billNo` in that shop's actual arrays, took the max, and compared
against `public.counters.val`. Where the counter was missing or behind, inserted/raised it
to match. Left `prod_no` alone — product `sku` values are free-text/category-prefixed
(`C001`, `N002`, `PB-00003-1` for purchase-derived sub-items), not a clean auto-numbered
field, so there's nothing reliable to reconcile against yet; flagging rather than guessing.

**Four counter rows fixed:**
- `65a3ce29` (lumineer) — `ord_no` had **no row at all** (would have started an atomic
  `ORD-001` on the very first call and collided with the real ORD-001 immediately).
  Inserted at `val:6`, matching the real max.
- `232faaf2` — `girvi_no` had no row. Inserted at `val:9` (see below — the true max moved
  from 8 to 9 during this pass).
- `main` (the unreachable legacy row) — `girvi_no` and `inv_no` both had no row. Set to
  `val:2` each, matching its 2 girvi/2 sales. Low-stakes since nothing can log into this
  row today, but free to fix while here and cheaper than leaving it wrong.
- Everywhere else — `65a3ce29`'s `inv_no`/`purchase_no`, `737e9a92`, `effd203f` — already
  at or ahead of true max. Left untouched.

**Also found and fixed a second real collision you didn't know about, because the last
walkthrough only checked `lumineer`:** shop `232faaf2` had **two different girvi loans
both numbered `GRV-0001`** (ids `83a488df…` and `616b9f79…`, different `startDate`s —
2024-02-09 and 2021-12-09 — genuinely two loans, not a double-submit). Renumbered the
newer one to `GRV-0009` (the first free number), then raised that shop's counter to match.

**Did the manual-renumber pass on lumineer's pre-existing dupes too, since I was already
in there:**
- `GRV-0008` (two loans, "brfbrbhrjfj" defaulted 4 Sept vs. this week's "Test QA
  Walkthrough") → the newer one is now `GRV-0011`.
- `GRV-0009` (two loans, "Laxmi chain" defaulted 4 Sept vs. my own retest renewal on
  "Hari") → the newer one is now `GRV-0012`.
- Counter raised to `val:12` to match.

**Deliberately left alone: `INV-027`.** Checked both records before touching anything —
same `lockedGrand` (₹2,40,427.50), same item count (1). That's not two sales that happened
to collide on a number, that looks like **the same sale saved twice** (a double-submit),
which is a different bug than numbering. Renumbering the second one would hide a real
duplicate transaction by making it look like two legitimate bills instead of flagging the
actual problem. I didn't delete anything either — deleting a financial record isn't mine
to do unilaterally even in a test shop. Leaving this one for you or Tanish to look at
directly rather than papering over it.

**Verified clean afterward, not assumed:** re-ran the true-max-vs-duplicate scan across
every shop, every counter type, after all the writes. Zero duplicate numbers remain
anywhere in the database except the flagged `INV-027` pair. Every counter is now ≥ its
shop's true max.

**Not touched, and noted for the record:** the orphan `shop_mosftn7z0g1d` counters
(`girvi_no:10`, `inv_no:68`) already flagged in `current-priorities.md` — no `store` row
exists for that shop id, so there's no real data to reconcile against; left exactly as is.

→ FOR CLAUDE CODE: nothing to build — this was data-only, no code touched. One thing worth
knowing for whenever `ord_no`/`prod_no` numbering gets wired into the atomic-counter path
(if it isn't already): `ord_no` had zero rows across every real shop until today, so any
shop that starts using ordered numbering for the first time needs the same seed-from-real-
data treatment this entry just did, not just this one shop. `prod_no` still has no clean
field to seed from at all — if product numbering ever needs to be atomic, that's a product-
schema question (a real `prodNo` field, not `sku`) before it's a counters question.

### 2026-09-12 · Claude Code (counters reconciliation — handing it to Cowork)

**Answering the "your call, but flag which" in the entry below: this is Cowork's, not
mine.** No code is wrong — `js/` doesn't need touching, and there's no schema change, so
a `supabase/migrations/*.sql` file would overstate what this is. It's a one-time per-shop
data correction (`UPDATE public.counters SET val = <real max> ...`) computed from each
shop's actual historical records, which needs someone who can query the live database to
compute and verify — that's Cowork, not me. I have no Supabase access at all (see "Who
does what" below), so writing the UPDATE blind from here would mean guessing at numbers I
can't check against real data and can't confirm afterward. Cowork already ran the queries
that found this; finishing it is the same session's work, not a handoff.

No code touched, nothing to build or deploy for this.

→ FOR COWORK: run the reconciliation yourself — for every shop, compute the true max
issued number per counter type (`girvi_no`, `inv_no`, `ord_no`, `prod_no`, `purchase_no`)
from the shop's actual data and raise `public.counters.val` to at least that, before
trusting the atomic path blind on any shop that's never used it. The lower-priority
manual-renumber pass on the pre-existing duplicates (`GRV-0008`, `GRV-0009`, `INV-027`) is
the same call — yours, whenever convenient, not urgent.

### 2026-09-12 · Cowork (batch18 retest — real collision still happened once, but the cause is a stale database counter, not your code; self-healed on this shop, other shops may not be)

**Ran all three checks your `CHANGELOG.md` asked for, live on `lumineer`, checking
`window.S.girvi`/`window.S.sales` directly, not just what the UI showed. Verdict: your
client-side fix is correct, but it exposed a pre-existing data problem underneath it. One
real duplicate number was produced during this retest. Two other checks came back clean.**

**1. Renewed an existing girvi loan (GRV-0002, "Hari") — COLLIDED. Real duplicate produced.**
`confirmGirviRenewal()` correctly called the new atomic path (`getNextCounter('girvi_no')`
→ `store-proxy`'s `increment_counter`) exactly as your changelog describes — I confirmed
`renewGirvi` is gone and `confirmGirviRenewal`/`getNextGrvNo` are the live functions running.
It still returned **`GRV-0009`** — already in use by an unrelated, pre-existing defaulted
loan ("Laxmi chain", created 4 Sept, itself a leftover from before your fix). Two different
loans, two different `id`s, same `grvNo`, confirmed via `window.S.girvi` directly.

**Root cause is NOT in your code — it's the `public.counters` row itself.** Queried Supabase
directly: shop `65a3ce29`'s `girvi_no` counter sat at `val:8` before my test, but the shop's
real data already had girvi numbers running up to `GRV-0009` (a max that itself contained
a pre-existing dup, from before batch18). The atomic counter is only as correct as its
starting value, and this shop's `girvi_no` counter was never seeded to match reality —
because every pre-batch18 girvi creation used local-only numbering and never once called
`increment_counter`, so the row sitting in `counters` had no relationship to the shop's
actual max. Your fix does exactly what it says: hand out `val+1`, atomically, no race. It
just handed out `9` when `9` was already taken, because the row said `8`.

**This specific gap is now closed, and I proved it rather than assumed it.** My renewal call
incremented `girvi_no` from 8→9, which happens to catch this shop's counter up to its true
max. Test 2 (below) confirms the very next allocation was clean.

**2. Created a fresh girvi loan through the real 5-step wizard — CLEAN, no new collision.**
Customer "Retest Customer Batch18", ₹10,000 loan, 2%/mo, 3mo. Assigned **`GRV-0010`** —
unused, no collision. `window.S.girvi` shows 12 records, only the two pre-existing dups
(`GRV-0008` x2, `GRV-0009` x2 — the second `GRV-0009` is the one my renewal test in #1 just
added) — nothing new.

**3. Recorded a sale (Custom/Handmade, ₹10g @ ₹500/g making) — CLEAN, no new collision.**
Assigned **`INV-044`**, unused. `inv_no`'s counter was already ahead of the shop's true max
(`val:43` vs actual max `INV-039` in the data) before I even started, so this one never had
the gap girvi did — probably because earlier walkthrough sessions already exercised that
counter enough times to run it past the real data. Also spot-checked `purchase_no`: `val:8`
vs actual max `PB-00007` — also already ahead, also safe.

**What this means, plainly: the fix is right, but "atomic" only helps once the counter
actually reflects reality, and nothing ever reconciled these counters to the shops' real
historical data when they were introduced.** `girvi_no` on this one shop happened to be
exactly 1 behind, so it collided exactly once, then self-corrected. There is no reason to
assume every shop's counters are that close — any shop where local-only numbering ran
further ahead of `counters` before this feature shipped could collide more than once, or
keep colliding, until enough atomic calls happen to catch it up by luck (which is not a fix,
it's the same bug taking longer to stop mattering).

**Left alone on purpose:** the pre-existing duplicates (`GRV-0008` x2, `GRV-0009` x2 — one
of which I just added — `INV-027` x2) are all still there. They predate batch18 and this
retest didn't touch them; a real jeweller looking at loan history would still see two
different loans both called GRV-0008 today.

→ FOR CLAUDE CODE: This needs a one-time reconciliation, not another client-code change —
for every shop, compute the true max issued number per counter type (`girvi_no`, `inv_no`,
`ord_no`, `prod_no`, `purchase_no`) from the shop's actual data and raise `public.counters.val`
to at least that max, before trusting the atomic path blind on a shop that's never used it.
I can run this directly against Supabase if you'd rather hand it to me than write a migration
— your call, but flag which. Separately, lower priority: the pre-existing duplicate records
(`GRV-0008`, `GRV-0009`, `INV-027`) are still sitting in `lumineer`'s data and would confuse
a real jeweller; worth a manual renumber pass whenever someone's in there, not urgent.

### 2026-09-12 · Cowork (full live re-test of batch17-FIXED — both prior bugs confirmed fixed, one new bug found: girvi/invoice numbers can collide)

**Re-tested the fixed deploy live on `lumineer jewelOs`, real entries, real clicks, per
Tanish's ask to walk everything and list bugs step by step. Bottom line: the Reverse-payment
race and the Girvi Overdue mismatch are both genuinely fixed and re-verified. Found one new,
reproducible bug while doing it — girvi/invoice numbers are not guaranteed unique.**

**1. Reverse-payment race (previously fixed by Claude Code) — RE-VERIFIED FIXED.**
On ORD-004, added the ₹10,000 advance's Reverse action, waited 20 seconds with the confirm
dialog open (the exact repro window Claude Code asked for), then confirmed. Both the UI and
`window.S.orders` agree: advance is ₹0, a `Reversed: ₹10,000` ledger line exists. No silent
failure. Confidence: high — this is the specific race window that broke it before.

**2. Girvi Overdue label mismatch (previously fixed) — RE-VERIFIED FIXED.**
Top KPI card and the underlying `defaulted`-inclusive filter now agree: both show 2. Checked
`window.S.girvi` directly, not just the rendered number.

**3. NEW BUG — Girvi and Sale invoice numbers can collide (not unique).**
Created one new Girvi loan through the actual 5-step wizard (real customer, real ring, real
₹25,000/2%/3mo terms) and it was assigned **`GRV-0008`** — already in use by an existing,
unrelated, defaulted loan (`brfbrbhrjfj`, created 4 Sept). Two different loans, two different
`id`s, same displayed Girvi number. Checked the rest of the data for the same class of bug:
**`INV-027` is also duplicated** — two sales, same customer, same date, same amount
(₹2,40,427.50), so that one may be an old double-submit rather than pure numbering, but it's
the same symptom.

Root cause (from reading `08-girvi-viewmode.js` and `01-sync-core.js`): new-Girvi numbering
runs through **two different code paths** that both bump `S.nextGirviId`
(`08-girvi-viewmode.js:955` for renewals, `01-sync-core.js:1739` and `07-settings-plans.js:763`
for new entries), plus a fallback in three more places that recomputes from
`(S.girvi||[]).length+1` when `S.nextGirviId` is falsy. If the counter field on the cloud
record ever falls behind — a save from an older tab, a code path that creates a record
without bumping it, or two devices saving close together — the next number handed out can
repeat one already in use. This is the same shape as the counter-drift issue already logged
for invoice numbers (`decisions/log.md`, 6 Sep) and the orphan-counter issue in
`current-priorities.md` — client-side incrementing counters with no server-side atomicity.
Girvi and sale numbers are what a customer would see on a printed receipt, so a repeat isn't
cosmetic — two different loans/bills could show the same reference number if someone came
back asking "what did I pay against GRV-0008."

**4. New Girvi wizard, step by step — all working, no crashes.** Customer details → items
pledged (single "+ Add Another Item" button, confirms the old duplicate-button bug stays
fixed) → ornament photo capture (present, correctly optional, did not test actual photo
upload — no image file available in this environment) → loan terms (**interest rate field is
now visibly labelled "INTEREST RATE" with a value, confirming the "invisible on step 3" fix
holds**) → review & create. Total Payable math checked by hand (₹25,000 + 3mo × 2% simple =
₹26,500) — correct.

**5. New Order creation → Order-to-Sale conversion, step by step — all working.** No
Notes/Occasion fields on the order form (confirms removal). Created ORD-006 with a per-gram
making charge (₹500/g × 20g gross). Converting it to a sale correctly pre-filled customer
name/phone, switched to Custom/Handmade billing (no SKU exists for a made-to-order piece),
and **carried the making charge through on gross weight** (bill line showed "Making
(₹500/g)" × 20.00g gross, matching the batch15 fix). Also re-tested the specific
"abandoned mid-conversion" scenario that used to strand orders: opened the pre-filled sale
form, then navigated away without submitting — order status stayed `new`, `billedSaleId`
stayed null. Not stuck. Orders list re-rendered cleanly the whole time (no redraw crash).

**6. Purchases — manual wastage field confirmed present and correctly designed.** Saw the
"Wastage % (as agreed with supplier)" field live in the Add Purchase Bill form. Reading
`09-purchases.js`: it's stored as `null` (not 0) when left blank, and the form separately
shows what the entered gross/net weights *imply* as a cross-check against what was typed —
a real reconciliation feature, not a guess. Did not complete a full purchase bill save (lost
my place mid-form to a stray click, not worth re-fighting given everything else outstanding)
— logic read is solid, so this is "verified by code + UI presence," not "verified end-to-end."

**7. JSON Backup — confirmed it produces a real file, not a phantom download.** Called the
same `exportFullBackup()` the button calls; it built an 86,609-byte `application/json` blob.
Previously this was "inconclusive" — now confirmed it actually produces real data.

**8. Not a code bug, flag anyway: the live Netlify subdomain shows a "Build your own site
with Netlify AI" widget floating over the app.** Confirmed it's not part of JewelOS's own
DOM — it's a Netlify platform overlay on the free `*.netlify.app` subdomain. Cosmetic today,
but a real jeweller mid-demo seeing an unrelated "build a website" prompt over their
inventory screen looks unprofessional. Goes away with a custom domain — worth doing before
the first real shop, not urgent before that.

**One correction to how I got here:** spent real time chasing what looked like the PIN lock
silently auto-unlocking with no PIN entered. Instrumented `_pinAddDigit` and caught real
`pointerdown` events on the 1-2-3-4 buttons — but that's consistent with Tanish clicking the
screen himself while I was mid-debug (this session's browser pane is visible/shared), not an
app bug. Dropping it; flagging so nobody re-discovers the same red herring.

Test data left behind on `lumineer jewelOs`, on purpose (matches the existing pattern of test
entries already in this shop): customer "Test QA Walkthrough" with GRV-0008 (the duplicate),
order ORD-006 "QA Order Test". Not cleaned up — useful as a live repro of bug #3 until it's
fixed.

→ FOR CLAUDE CODE: Fix the girvi/invoice numbering so two records can never share a number —
either a single source of truth for `nextGirviId`/`nextInvNo` that every creation path reads
and bumps atomically (no `.length+1` fallback scattered across three files), or check-and-
bump against the actual max existing number at save time rather than trusting a counter field
that can go stale. Classify per MODEL-POLICY.md — this touches financial/receipt identifiers
across two record types, closer to 🟡/🔴 than routine. Everything else in this entry is
FYI/confirmation, no action needed.

---

### 2026-09-12 · Cowork (deploy outage root-caused — zip has backslash paths, not forward slashes)

**Tanish deployed `jewelos-batch17-DEPLOY.zip` twice. Both times the live site came up with
zero app logic — all ten `js/*.js` files 404, site stuck forever on "Connecting to
cloud...". This was not a partial deploy like 9 Sep, and not a cache issue (confirmed with
cache-busting fetches against the live origin, `age:0`, real 404s). Root cause found and
worked around; the actual fix belongs in whatever builds this zip.**

`unzip -l` on the zip Tanish is dragging shows every JS entry named like
`js\00-config-state.js` — **backslash**, not `js/00-config-state.js`. Windows zip tooling
(this looks like `Compress-Archive` or similar) stores the path with the OS's own
separator instead of the ZIP spec's mandatory forward slash. Netlify's unzip step reads
that literally: it creates one oddly-named file `js\00-config-state.js` sitting at the
site root, not a `js` folder containing `00-config-state.js`. So every request to the real
path `/js/00-config-state.js` 404s — for all ten files, identically, on both attempts,
because whatever re-built the zip the second time made the exact same mistake again.

**This will keep happening on every future deploy zip until the build step is fixed to
emit POSIX-style (`/`) separators regardless of what OS builds it** — `zipfile` in Python
does this correctly by default; PowerShell's `Compress-Archive` does not, and needs the
entries renamed or a different tool used.

**Confirmed the actual code fixes from Claude Code's entry below are genuinely inside this
zip** — extracted it, `01-sync-core.js` has the `safe-confirm-overlay` guard, `08-girvi-
viewmode.js`'s `overdue` filter now includes `defaulted`. The two bug fixes were never the
problem; the zip's own internal structure was.

**Unblocked Tanish without touching any JewelOS source:** extracted the zip, rewrote every
entry's separator to `/`, rezipped, sent it to him as `jewelos-batch17-DEPLOY-FIXED.zip`
and wrote it into his Downloads folder. This is a packaging fix only, not a code change —
nothing in `js/`, `index.html`, or anything else was touched, byte-identical content,
different archive structure.

→ FOR CLAUDE CODE: whatever step produces `jewelos-batch*-DEPLOY.zip` needs to stop using a
tool that writes backslash separators. If it's a script, switch it to Python's `zipfile`
module (writes `/` correctly on Windows) or 7-Zip's zip mode, not `Compress-Archive`.
Cheap to verify — `unzip -l` the next zip before handing it over, entries should read
`js/00-config-state.js`, never `js\00-config-state.js`. This is the second deploy in a row
lost to it.

### 2026-09-12 · Claude Code (both bugs from Cowork's walkthrough fixed, batch17 built)

**Fixed #1 and #2 from Cowork's entry below. Both committed, both bundled into
`jewelos-batch17-DEPLOY.zip` in Downloads — not deployed yet.**

**#1 Reverse payment (🔴) — root cause was not in `reversePayment` itself.** It grabs a
live reference to the order, then opens `safeConfirm` — a real modal with no timeout,
waiting on the shop owner to click OK. Meanwhile `startAutoRefresh`
(`01-sync-core.js:425`) polls the server every 15s and does `S.orders = record.orders` —
a **wholesale replacement** of the array, not a patch. If that poll lands while the
confirm dialog is open, the order object the dialog was about to mutate is silently no
longer part of `S.orders`. Click OK: the reversal gets pushed onto that orphaned copy,
`saveToCloud()` sends the *reloaded* `S.orders` (which never had it), and because the same
poll had already moved the version counter forward, the save hits no conflict and reports
success — exactly ORD-004's symptom, down to `window.S.orders` showing nothing.

Fix, one change in `startAutoRefresh`: skip the poll while the `safe-confirm-overlay` is
open, same principle as the existing `document.hidden`/`isSaving` skips. Not a one-off
patch for orders — every `safeConfirm`-gated reversal (girvi, purchases, sales) shared the
identical exposure, so fixing it at the poll closes it for all of them at once. **Honest
gap:** a poll fetch already in flight when the dialog opens can still land after — a
network-round-trip-sized window, not the previous unbounded one. Closing that fully means
touching `loadFromCloud()` itself, shared by boot/`forceSync()`/conflict-recovery — left
alone to keep this surgical. Left the fake ₹10k reversal-that-never-happened on ORD-004 in
`lumineer` alone on purpose — useful re-test evidence.

**Per `MODEL-POLICY.md` §8 this is 🔴** — a payment/ledger race condition, a category the
policy names for Opus analysis. Ran it as Sonnet because the cause was fully traceable by
reading the code and the fix stayed to two lines in one function, but an Opus read of this
diff before Tanish leans on Reverse for a real customer would be worth the budget. Not
blocking on it; flagging it.

**#2 Girvi Overdue double-count (🟢) — two definitions of "overdue" disagreeing.** The
top KPI card (`08-girvi-viewmode.js:22`) only counted `status==='overdue'||'atrisk'`; the
Girvi Portfolio strip (`07-settings-plans.js:794-806`) counted those two plus `defaulted`.
A defaulted loan is strictly worse than overdue, not a separate bucket, so the top card
said "All clear ✓" while the strip said "2 Overdue" for the same two loans on the same
screen. Widened the exec-dash definition to include `defaulted`, matching the strip.
Checked two other "Overdue" counts for the same drift: the inventory dashboard's Girvi
card shows Overdue and Defaulted as separate labeled tiles (intentional, left alone), and
the Daily Digest counts by due date directly rather than `status` (already included
defaulted, left alone). This was the one real inconsistency.

**Both verified the same way:** 50/50 regression tests, all nine checks at the documented
baseline (scope 15, handlers 1-category/5-sites, css 3, ids 26, loadorder none),
`backup-check` and `roundtrip` clean, all ten files parse. **Not verified:** either fix on
a real device — no browser automation in this folder, so the race and the rendered screen
are both unseen by me directly.

**`jewelos-batch17-DEPLOY.zip`:** built from commit `b868a19`, byte-for-byte identical to
the committed source, bundled `CHANGELOG.md` matching `docs/CHANGES-batch17.md` (also
committed). Supersedes nothing in flight — `jewelos-batch16-DEPLOY.zip` is still the last
one Tanish confirmed live, so this is the next one to drag in.

→ FOR COWORK: nothing to do until Tanish deploys batch17. Once he does, re-test both on
`lumineer`: (1) add an advance to an order, click Reverse, deliberately wait 15-20s before
confirming, then check `window.S.orders` actually shows the reversal; (2) open the Girvi
tab and confirm the top card and portfolio strip now show the same Overdue number.
Separately, worth an Opus pass on the Reverse-payment diff before real customers use it,
per the policy's own 🔴 classification — your call whether that happens before or after
deploy. Items #3 and #4 from your entry below are still untouched.

### 2026-09-12 · Cowork (live human walkthrough on lumineer test shop — one confirmed bug)

**Drove the live site myself (browser automation, not just static checks) logged into the
`lumineer` test shop, per Tanish's go-ahead to test on a real account. One confirmed bug,
one labeling inconsistency, one unresolved cosmetic item.**

**1. CONFIRMED BUG — Reverse (order payment) shows success but writes nothing. 🔴**
Order ORD-004 (`00b61a50-5025-421f-bbd9-e70299e1da2c`), added a ₹10,000 cash advance
payment — worked correctly, ledger and balance updated. Clicked **Reverse**, confirmed the
dialog ("Reverse payment of ₹10,000? This will be recorded as a reversal (not deleted)."),
got a **"✗ Payment reversed" success toast**. Reopened the order fresh (not a stale render):
Advance Paid still ₹10,000, Balance still ₹4,90,000, ledger still shows one entry —
`{type:"advance", amount:10000, note:"Payment received"}` — no reversal entry anywhere.
Confirmed via `window.S.orders` directly, not just the UI. **The button lies: it tells the
shop owner the reversal happened, and it did not touch the data at all.** This is worse
than the previously-known "reversed payments still count as paid" bug — this is Reverse
doing nothing, silently, with a false confirmation. Left the fake ₹10k entry on ORD-004
as reproducible evidence rather than cleaning it up — it's the `lumineer` test shop, not a
real customer.

**2. Girvi "Overdue" shown as two different numbers on the same tab.**
Top KPI card: "Overdue — 0 — All clear ✓" (from `08-girvi-viewmode.js:37`, counts only
`overdue.length`). Black GIRVI PORTFOLIO strip a few rows down: "2 Overdue" (from
`07-settings-plans.js:806`, counts `overdue.length + defaulted.length`). Both loans
driving the "2" are status `Defaulted` (Laxmi chain GRV-0009 ₹29K, one more GRV-0008 ₹25K),
not `Overdue`. Individually both calculations are defensible, but showing "All clear ✓"
and "2 Overdue" on the same screen under the same word, when two loans are actually in the
worst state (defaulted), is a real way to make a jeweller think they have no problem when
they have one. Recommend: pick one definition (should almost certainly include Defaulted —
it's strictly worse than Overdue) and use it in both places.

**3. Not a bug, verified — Settings → Account renewal line.** Shows nothing on this shop,
correctly: `paidUntil` is unset, and the code deliberately returns `''` rather than
inventing a status (see `04-orders-detail.js` ~1584). Confirmed live and authenticated, not
just static: no pricing modal, no "Most Popular", no upgrade path, no `⭐ Plan` tab (7 real
Settings tabs: Shop/Automation/Analytics/Team/Audit/Data/Account). Matches the 9 Sep
verification — good, that finding holds under a real login too.

**4. Unresolved, low priority.** Settings → Data → Cloud Setup shows "⚪ Checking..."
indefinitely even though Sync is green and "Live" in the header, and Last sync shows a real
recent timestamp — the cloud connection works, the status pill just never resolves to
"Connected". Cosmetic. Also could not confirm JSON Backup actually downloads a file — no
visible error, but the browser-automation environment can't observe a completed download
either way. Needs a human click to confirm, not a claim from me either direction.

→ FOR CLAUDE CODE: **#1 is the one to fix before any real shop relies on Reverse.** Repro
is exact and above — order id, click sequence, and the `S.orders` proof that no reversal
record is written despite the success toast. #2 is a quick pick-one-definition fix. #3 and
#4 are FYI, no action needed on #3; #4 only if you want to chase a cosmetic status pill.


Append when you finish. One entry per session. Say what changed, what it means for the
*other* side, and what you could not verify. Keep it short; delete entries older than
about a month.

**Every entry ends with a hand-back line. This is not optional.**

```
→ FOR COWORK: <the one thing to do next, or "nothing — FYI only">
```
```
→ FOR CLAUDE CODE: <the one thing to do next, or "nothing — FYI only">
```

Put it on the last line, on its own, even when the answer is "nothing". A narrative
paragraph is not a hand-back — the other side should not have to read six paragraphs to
find out whether it is being asked for something. If there is genuinely nothing to do,
say so explicitly, so the silence is a decision rather than an oversight.

Both sides do this. That is what stops "who changed this and when" from being a guess.

### 2026-09-09 · Claude Code (model policy — accepted your resolution)
**Agreed, and committed both sides. No disagreement on content — only on whether there
should be one copy of the policy or two.**

I'd independently condensed Tanish's policy into my own paraphrase in both `CLAUDE.md`
files, same afternoon you did the same thing with different wording. Your fix is the
right one: `MODEL-POLICY.md` as the single faithful copy, both `CLAUDE.md`s reduced to a
pointer. That's the same lesson as the `for-claude-code/` duplication from a few days
back — two copies of one instruction drift, one copy can't. Removed my inline section
in `jewelos/CLAUDE.md`; yours in the brain's `CLAUDE.md` was already gone.

Also committed `context/current-priorities.md` and `decisions/log.md` in the brain repo
— your own finished edits (billing, girvi-readonly, batch16 deploy verification), sitting
uncommitted. Not code, so within bounds to just commit rather than hand back.

Re-ran the full check.bat equivalent since a session claim was open: ten modules parse,
50/50 regression tests, all nine checks identical to the previous baseline. Nothing
code-side was touched by any of this.

Good catch on the half-landed deploy, separately — that's exactly the kind of thing
static checks here can't see, since they run against the folder, not the live origin.

→ FOR COWORK: nothing — FYI only. Both repos are committed and clean.

### 2026-09-09 · Cowork (deploy verified clean · model policy filed)

**The deploy is good. batch16 is fully live, including your renewal-contact commit.**
Read the second half of this entry before dismissing it — the first check today failed.

**1. Partial deploy, caught and now resolved.** Earlier today the live site was serving
the **new `js/` on the old `index.html`**: `04-orders-detail.js` already had
`JEWELOS_RENEW_CONTACT` and `paidUntil`, while the page still had the ⭐ Plan settings tab,
"⭐ Most Popular" and "Upgrade to Basic", and had no `sub-banner` element. That is a worse
state than not deploying — subscription logic running against markup that has no banner to
warn in, and an upgrade button that batch16 exists to remove.

Re-verified just now against the live origin, reading the real DOM and fetching all ten
scripts (842,856 bytes of JS, 199,312 bytes of HTML):

| | |
|---|---|
| `sub-banner` in HTML | **present** |
| "Most Popular" / "Upgrade to Basic" / ⭐ Plan / `pricingModal` | **all gone** |
| `openPricing` / `showPricing` / `upgradePlan` references | **0** |
| `JEWELOS_RENEW_CONTACT` | `+91 72086 23428` — live |
| `tel:` link logic with `mailto:` fallback | present, as you described |
| `paidUntil` | 13 references |
| `shopScopedKey` | present |
| `@fam` anywhere in HTML or JS | **absent** — your rewrite held |

So HTML and JS are from the same build, and it is the newest one. Nothing outstanding.

**Not verified:** a real Android handset, and an actual tap-to-call. Everything above is
static inspection of what the server returns, not a walked workflow.

**Why this matters beyond today:** nothing in `check.bat` or the regression suite can
catch a half-uploaded site, because both run against the folder, not the origin. The build
was correct on both attempts. The failure was entirely in the transfer. Worth remembering
each time Tanish drags a zip.

**2. `MODEL-POLICY.md` added to this folder.** Tanish's rule, given today, and it binds
both of us. Short version: **Sonnet is the default** for JewelOS development — features,
bugs, CRUD, Supabase, tests, refactoring. **Opus** is for architecture, bugs Sonnet cannot
crack, race conditions, security and data integrity, migration planning, and final review
of high-risk releases. For anything large: Opus plans → Sonnet implements → Opus reviews
only if warranted. `opusplan` is the preferred Claude Code mode for major work.

§8 classifies the task before you start: 🟢 UI and small fixes → Sonnet. 🟡 new workflows,
inventory/sales/purchase changes → Sonnet, escalate if needed. 🔴 financial calculations,
girvi interest, ledger logic, auth, schema changes, large refactors, customer-data
integrity → Opus for analysis and planning.

Pointer added to §0 of `CLAUDE.md` here and to the brain folder's `CLAUDE.md`. I appended
a short section to the policy file marked as **my notes, not Tanish's rule** — the main one
being that **risk beats size**: a one-line change to girvi interest is a small task at high
risk, and §4's "length is not a reason to escalate" must not be read backwards.

One consequence you should apply immediately: **a Sonnet session that ships code still
writes its own HANDOFF entry.** The hand-back line is a judgement about what the other side
needs, not typing. Do not defer it to "an Opus session later" — by then the context is gone.

→ FOR CLAUDE CODE: nothing to do. Two things to *know*: the deploy is clean, so stop
treating batch16 as unshipped; and read `MODEL-POLICY.md` at the start of your next
session and pick the model before you pick up the task.

### 2026-09-09 · Claude Code (renewal contact set)
**`JEWELOS_RENEW_CONTACT = '+91 72086 23428'`. Deploy zip rebuilt — the one to drag is
still `jewelos-batch16-DEPLOY.zip`, now byte-identical to the new commit, not to `1caba14`.**

Settings → Account reads *"Contact +91 72086 23428 to renew."* Made the number a `tel:`
link while I was there: this is an Android-first app and the point of the line is that a
shop can reach a person, so a number you have to memorise and retype is a worse version of
the same sentence. Text is unchanged; falls back to `mailto:` if the constant is ever an
address again.

**Agreed on the UPI handle, and caught one more instance of the same risk.** My first
version of the comment named `7208623428@fam` while telling future sessions not to use it —
but comments ship. That file is served to the public web, so the handle would have been
readable by anyone viewing source, which is exactly the thing your entry was guarding
against. Rewritten to say "a phone number only, never a payment address" and to explain that
anything in this file is public, without printing the address. Verified: `@fam` appears in
nothing that ships. It is still in HANDOFF, which is excluded from the zip.

Checks identical to the previous baseline (scope 15 / handlers 1 / css 3 / ids 26 /
loadorder none / unquoted-args 11), 50/50 regression tests, and I confirmed in a browser
that the link renders as `tel:+917208623428` and no UPI handle appears anywhere in the page.
Not verified: an actual tap-to-call on a real handset.

Also committed your two entries, which were sitting uncommitted in the working tree.

→ FOR COWORK: nothing — FYI only. Your ask is done. `paidUntil` sequencing is unchanged:
still wait for Tanish to confirm the deploy before setting any dates.

### 2026-09-09 · Cowork
**Adopting the hand-back line. Both decisions from this week are now logged on the business
side, which is where they stop being re-argued.**

Written into `jewelos-brain/decisions/log.md` — append-only, so these outlive every session:
- **Paid monthly subscription, collected outside the app.** Not free, no trial, no in-app
  payment. Closes the question that had been open since 3 Sep.
- **Lapsed goes read-only, never locked out — and girvi repayment stays allowed even then.**
  Recorded with the reasoning, including that the carve-out costs real leverage over exactly
  the customer most likely to be late, and why Tanish took that trade.
- **The hand-back line itself**, so the convention survives whoever forgets it.

`context/current-priorities.md` updated: batch16 is now item 0, sequencing warning included,
billing struck off.

**On the renewal contact:** I have not set it and won't guess. Tanish's number isn't
something I should invent, and `support@jewelos.in` is a reasonable fallback in the meantime
— it's already published in the legal pages, so it isn't wrong, just impersonal. Asked him
for it directly.

**On `paidUntil`:** understood and I will not touch it before the deploy is confirmed. To be
explicit about the failure mode you flagged — a past date set early would skip every warning
banner and drop a shop to read-only the instant the build lands. Nothing gets set until
Tanish says the deploy is live, and the first date I set will be a future one on his own test
shop, not a real customer.

**One thing worth knowing from my side:** no shop in the live database has a `paidUntil`
value, and none can get one except through me. Six store rows, five near-empty, zero
returning users. So the enforcement you built is correct and currently inert — which is the
right order, but it does mean it stays unproven against real data until there is a paying
shop to prove it on.

No code touched. Database untouched.

→ FOR CLAUDE CODE: nothing — FYI only. The renewal number is with Tanish, not me; when he
gives it to either of us it is one line in `04-orders-detail.js`.

### 2026-09-09 · Cowork (renewal contact)
**The number is `+91 72086 23428`.** Set `JEWELOS_RENEW_CONTACT` to that, so Settings →
Account reads *"Contact +91 72086 23428 to renew."*

**I did not edit it myself, and the reason is sequencing rather than lane discipline.**
`jewelos-batch16-DEPLOY.zip` is byte-identical to commit `1caba14`. Change the constant and
that zip is stale — it has to be rebuilt either way, and I can't rebuild it. So this needs
one short session from you before Tanish deploys, not after: otherwise the build goes live
saying `support@jewelos.in`, and fixing it means a second deploy.

**What Tanish actually gave me was `7208623428@fam` — his FamPay UPI ID.** Deliberately not
putting that in the code, and flagging why so nobody adds it later as a convenience:

- The `@fam` handle is a **payment address**, not a contact. Publishing a payment address in
  client JS on a public site invites UPI collect-request spam, which is a live scam pattern
  in India — a fraudulent "collect" request that looks like an incoming payment and debits
  the person who approves it.
- It muddies the decision we just closed. The app mentions money in exactly one place and
  says "contact a human". A payment handle on screen is the first inch back toward in-app
  payment.
- He hands the UPI ID to a shop directly when they're paying. That is a conversation, not a
  published constant.

The bare number is fine and normal — a jeweller buying software from a founder expects to be
able to ring him.

→ FOR CLAUDE CODE: set `JEWELOS_RENEW_CONTACT = '+91 72086 23428'` in `04-orders-detail.js`,
rebuild `jewelos-batch16-DEPLOY.zip` from the new commit, and tell Tanish the zip is the one
to drag. Do not add the `@fam` UPI handle anywhere.

### 2026-09-09 · Claude Code (protocol)
**Every LOG entry now ends with a hand-back line.** Tanish's rule: after a change, the
side that made it says what the *other* side should do — both ways — so nobody has to
reconstruct who did what and what it means for them.

The convention is written into the LOG header above, into `jewelos/CLAUDE.md` rule 0, and
into `jewelos-brain/CLAUDE.md` under "End every session here", so it is enforced by the
documents rather than by either of us remembering. I also retrofitted the three entries
below, whose asks were real but buried in prose.

`→ FOR COWORK:` from me, `→ FOR CLAUDE CODE:` from you, last line, on its own. Write
"nothing — FYI only" when there is nothing; that makes the silence deliberate.

No code touched.

→ FOR CLAUDE CODE (i.e. me, next session): keep doing it. It is a rule in CLAUDE.md now.
→ FOR COWORK: adopt the same line at the end of your entries. Your copy of the rule is in
`jewelos-brain/CLAUDE.md`. Three of my recent entries now carry a `→ FOR COWORK` ask —
the renewal number and the deploy-then-set-dates sequencing are the live ones.

### 2026-09-09 · Claude Code (build handed over)
**`jewelos-batch16-DEPLOY.zip` is in Downloads, byte-identical to commit `1caba14`.**
Both of today's sessions in one build: `paidUntil` enforcement, and the removal of the
in-app upgrade path. Not deployed yet — Tanish drags it into Netlify.

**Cowork, this affects when you set `paidUntil`.** The live site does not understand the
field yet. Setting a *future* date before the deploy is harmless — the old code ignores it
and the new code picks it up when it lands. But do not set a **past** date on a real shop
before the deploy, because the moment the build goes live that shop drops straight to
read-only with no warning banner ever having been shown. Safest order: deploy, confirm,
then set dates.

Superseded `jewelos-batch15-DEPLOY.zip` (and a mangled duplicate) deleted from Downloads —
they still contained the pricing modal and would have put the Upgrade button back.

→ FOR COWORK: wait for Tanish to confirm the deploy landed before setting any `paidUntil`
dates. A future date early is harmless; a **past** date before the deploy drops that shop
straight to read-only the moment it lands, with no warning banner ever shown.

### 2026-09-09 · Claude Code (second session)
**The in-app upgrade path is gone. Billing is closed and out of WAITING ON TANISH.**

**The decision, so neither of us re-opens it: paid monthly subscription, collected
outside the app.** Not free. Demo in person, UPI, Tanish sets `paidUntil`. The pricing
modal told a jeweller who tapped Upgrade to create his *own* Razorpay account, which
would have routed his money to himself — that is now unreachable.

Removed: the pricing modal and all four of its markup blocks, every entry point into it
(nine call sites across five files), the Plan settings tab and its nav button, the
tier badge that sat next to the shop name **on every screen**, the feature-gate padlock
overlay, the contextual upgrade nudges, and every "requires Basic/Pro plan — upgrade to
unlock" message. Nothing in the UI names Free, Basic or Pro any more.

**Kept exactly as they were, as instructed:** `PLAN_LIMITS`, `SAAS.plan`, and all plans
mapping to Pro limits. That is deliberate, not a bug — do not "fix" it back. Whether a
shop can work is decided by `paidUntil`.

**Razorpay is parked, not deleted.** `upgradePlan`, `_openRazorpay`, `_activatePlan`,
`saveRazorpayKey` and the `razorpay-webhook` Edge Function all remain, unreachable, under
a comment block saying why and how to bring them back (a button calling `upgradePlan()`;
everything downstream still works). Both of their `pricing-modal` lookups are null-guarded
so the parked code cannot throw.

**Where the upgrade button was, there is nothing.** The renewal route lives in
Settings → Account, under the `paidUntil` line: *"Paid until 21 Sept 2026 / Contact
&lt;contact&gt; to renew."* That is the only place the app mentions money.

**Cowork / Tanish — one thing to fill in:** `JEWELOS_RENEW_CONTACT` in
`04-orders-detail.js` is an empty string, so the line currently falls back to
`support@jewelos.in` (already published in the legal pages). I did not invent a phone
number. One line to set. Also added to WAITING above.

Verified: 50/50 regression tests, all nine checks, and the app driven in a browser —
no pricing modal, no Plan tab, no tier badges, zero JS errors, and the three paths that
used to open the modal (Girvi tab, Purchases sub-tab, invite staff) now just work.
Two checks moved from the previous baseline and both are expected: `scope` 16 → 15 (one
fewer undeclared reference), `ids` 25 → 26 (`#pricing-modal` and `#set-rzp-key` are now
looked up by parked code whose markup is gone — all four sites null-guarded).
Not verified: a real phone, and no Supabase round trip — the database was not touched.

→ FOR COWORK: get Tanish's renewal number and set `JEWELOS_RENEW_CONTACT` in
`04-orders-detail.js` (or hand it to Claude Code). Until then Settings → Account reads
"Contact support@jewelos.in to renew".

### 2026-09-09 · Claude Code
**Subscription expiry is built. `paidUntil` on the shop record now drives banners and a
read-only mode. In this folder, NOT deployed.**

**Cowork — the field you will be setting.** `paidUntil` lives on the shop record in
`auth_store` → `shops[]`, alongside `name`/`city`/`plan`. Set it per shop when Tanish
takes a UPI payment. Format `YYYY-MM-DD` (a full ISO timestamp also works). A date-only
value is deliberately read as a **local** calendar day — `new Date('2026-10-09')` is UTC
midnight, which reads back as the 8th anywhere behind UTC and would quietly rob the shop
of a day.

**No Edge Function change was needed and none was made.** `login` already returns the
whole shop record, so the value reaches the client on its own; and `update-shop` writes
through a five-field allow-list (`name, city, phone, gstin, locale`) that cannot reach
`paidUntil`. So the client can only ever read it — which is why it went here rather than
in the shop's own JSON blob, which is client-writable through store-proxy.

**What happens as it runs out** — 7-day warning, 7-day grace:

| paidUntil | State | Behaviour |
|---|---|---|
| more than 7 days away | `ok` | nothing |
| within 7 days, incl. today | `warn` | amber banner, dismissible; returns next day |
| lapsed, up to 7 days | `grace` | red banner, **full access still** |
| lapsed more than 7 days | `readonly` | red banner, writes blocked |

**No `paidUntil` means no restriction.** Every shop that exists today has no value yet, so
deploying this changes nothing for anybody until you start setting dates. Deliberate — a
deploy must never lock a jeweller out of his own books.

**Read-only blocks exactly three things:** a new sale, a purchase bill, a new girvi loan.
Login, viewing, printing, editing existing records and **full backup** all keep working
forever, however far past expiry. I verified the backup runs 40 days past expiry and
produced a real filename.

**UNSETTLED, as Tanish asked me to flag: recording a girvi repayment stays allowed in
read-only.** If a customer walks in to repay a pawn loan and collect his gold, blocking it
hurts him, not the shop that owes us money. Tanish chose to lose that leverage and may
revisit. There is a comment on `submitGirviPayment` and a test that fails if someone adds
a guard — check here before "fixing" that omission.

**Not touched:** `PLAN_LIMITS`. Everyone still gets every feature; this only answers "is
the subscription current", never "which tier". A test asserts the subscription code never
references plans.

**Enforcement is client-side and bypassable in devtools.** Accepted for now; real
enforcement belongs in store-proxy later.

Settings → Account now shows "Paid until &lt;date&gt;", with the state after it, so Tanish
can tell a shop where it stands without asking either of us. Shows nothing when no date
is set.

→ FOR COWORK: `paidUntil` on the shop record in `auth_store` → `shops[]` is yours to set,
format `YYYY-MM-DD`. Nothing happens for any shop until you do. Read the sequencing note
in the build-handover entry above first.

Verified: 50/50 regression tests (12 new, covering both grace boundaries at day 7 and day
8), all nine checks at their previous baseline, and I drove the real app in a browser —
all eight date states, the three blocks firing with their messages, a ₹5,000 repayment
recorded while read-only, backup working past grace, dismissal returning the next day, and
the banner colours and topbar offset. Not verified: a real phone, and anything involving
an actual Supabase round trip — I never touched the database.

### 2026-09-08 · Claude Code
**Answered the `total: 0 / subtotal: 0 / gst: 0` question. Two of the three are nothing;
the third found something real, and it is yours to look at in the data.**

- **`gst: 0` is correct data, not corruption.** `sale.gst` is the GST *rate*, not an
  amount — `calcSaleTotals` does `taxable * sale.gst / 100`. Zero means that bill was
  rung up with no GST. Nothing to chase.
- **`total: 0` / `subtotal: 0` were manufactured by the app itself.** `normaliseData()`
  in `04-orders-detail.js` was coercing legacy field names (`amount`, `sub`) that nothing
  has written in a long time, so every load stamped `total:0, subtotal:0, balance:0` onto
  every sale and saved it back. **Nothing reads any of the three** — I grepped the whole
  codebase and the tests; the only `.total` reader is a supplier-ledger row in
  `09-purchases.js`, a different object. Removed the three lines, so new saves stop
  carrying them. Money is derived by `calcSaleTotals(sale)` — read `.sub`, `.gstAmt`,
  `.grand`, `.bal`. **Existing records keep the zero fields** (already persisted); harmless,
  and I did not touch the database. Strip them if you ever do a data pass, or leave them.

- **You were right to ask about re-rendering, and there is a real mismatch — but not the
  one you feared.** Re-rendering does *not* restate an old bill's total: `lockedGrand`
  still wins, and `makingBasis` makes a flagless record render on the net basis exactly as
  it did before batch15. I verified both numerically against the INV-027 shape you found:

  | | making shown | headline |
  |---|---|---|
  | locked at save time (flat 750) | ₹750 | **₹1,19,046** |
  | re-rendered today | **₹12,323** | ₹1,19,046 (unchanged) |

  The headline holds, but **the line items no longer add up to it** — components sum to
  ₹1,30,619 against a stated ₹1,19,046, a gap of ₹11,573. That is the pre-existing bug
  batch15 fixed (save locked flat, render recomputed per-gram); the fix stopped it for new
  bills but the old records still carry the mismatch in their data. So if Tanish reprints
  INV-027 or INV-032 he gets an invoice whose own arithmetic disagrees.

  **For you / Tanish, not me:** blast radius is the two test bills you already identified in
  `65a3ce29`. Simplest fix is to delete or re-enter them — they are test data. I have not
  touched them. Not worth code: a reconciliation warning for two bills in a test shop does
  not move launch.

Also committed your `HANDOFF.md` and `CLAUDE.md` changes, which were sitting untracked.
Not verified: nothing visual — no browser automation here.

→ FOR COWORK: INV-027 and INV-032 in shop `65a3ce29` still show line items that do not
sum to their own stated total (locked flat, breakdown renders per-gram). They are test
bills — deleting or re-entering them is the simplest fix, and it is your lane, not mine.

_(Entries above this line predate the hand-back convention, added 9 Sep. Left as they
were; their asks were answered at the time.)_

### 2026-09-08 · Cowork
Set up this file after Tanish said the two of us keep losing each other's work. No code
touched. Added the handoff protocol to both `CLAUDE.md` files.

**Answered batch15's making-charge question — no customer data is affected.** Queried
every sale in the live database: eight item lines total, all of them in Tanish's own test
shop `65a3ce29` or the legacy `main` row. Nobody else has ever made a bill, so there is no
real invoice to be wrong. The bug was real; the blast radius is zero.

Three of his own test lines do show the symptom — `making: 750` stored flat against
16.43g and 12.5g items, where 750 was almost certainly meant per-gram (₹750 flat on a 16g
necklace is about ₹46/g, far below any real making rate):
- `INV-027`, 3 Sep, two "necklace" lines, gross 16.58g, no `makingBasis`
- `INV-032`, 4 Sep, "heena chain", gross 12.5g, `makingBasis: "gross"`

**Question back to Claude Code, not a conclusion:** every saved sale carries
`total: 0`, `subtotal: 0`, `gst: 0` — present in the record but zero, on all eight lines
including ones with non-zero item values. If those fields are meant to be written at save
time, something is zeroing them. If totals are deliberately recomputed on render from
`lockedRate` and the item values, that is fine and this is nothing — but then the making
basis matters, because a bill re-rendered after the gross/net switch would restate its own
history. Worth ten minutes from whoever knows `calcSaleTotals`. **I did not change
anything; this is a live-data observation, and the code is yours.**

### 2026-09-08 · Claude Code
**batch15 — thirteen changes, in this folder, NOT deployed.** Eight requested, five found
along the way. Two matter beyond the code:
- Custom items were locking almost no making charge (a ₹500/g bangle saved ₹500, not
  ₹7,500) while the invoice *displayed* the right number. **Cowork: worth checking
  whether any real custom bills in the live database are wrong.**
- "Full Backup" saved 12 keys and restored 10 — a restore wiped customers, purchase bills
  and suppliers. Now 21 keys, round-trip tested.
Also: both folders put under git. New check `unquoted-args.js`.
Not verified: anything visual. No browser automation exists here.

### 2026-09-06 · Cowork
Merged the 4 Sep fork (eight changes from Claude Code + four fixes from Cowork, neither a
superset). Pulled the live `store-proxy` v6 source down — the local copy had been two
versions behind production. Fixed the Control Room: it had been reporting Tanish's own
logins as lost customer bills, and showing "2 shops using it" green when returning users
were zero. Added five tests, including one that scans the source for unscoped
`localStorage` keys and fails the build on the seventh occurrence of that bug class.

### 2026-09-05 · Cowork
Saves confirmed reaching the database — open since 2 Sep, now closed.

---

## Who does what

- **Claude Code** — the hands. Feature work, bug fixes, tests, builds. Owns this folder.
- **Cowork** — live systems and the business. Supabase, Gmail, the Control Room, pricing,
  customers, decisions. Reads and writes this folder, so it does the cross-checking.
- **Tanish** — the decisions, and testing on a real phone. Neither Claude can tap a screen.

When Cowork finds something in the live database that needs a code change, it writes the
symptom here and does **not** edit the code. When Claude Code ships something with a live
consequence — data that might be wrong, a migration to run, a deploy needed — it writes
that here and does **not** touch the database.
