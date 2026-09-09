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

### 2026-09-09 · Claude Code (model-selection policy)
**Tanish's model-switching policy is written into both `CLAUDE.md` files, not just told
to us once.** Sonnet is the default in both places now; Opus is for architecture,
unclear/repeated-failure bugs, and anything touching Girvi interest, the ledger,
financial math, auth, or a schema change — plus a pre-launch review. Cowork's mirror
copy: Sonnet for routine folder/document work, Opus for a full audit or
launch-readiness pass. Condensed from the policy he pasted — the full text lives in his
message, not duplicated here.

Placed as its own `## Model selection` section, right after `## Priority framing` in
both files, so it is read early and is enforced by the document rather than by memory
— the same reasoning as the hand-back line two entries ago.

No code touched. Ten modules parse, 50/50 regression tests, all nine checks identical
to the previous baseline.

→ FOR COWORK: nothing to do — the policy is already in `jewelos-brain/CLAUDE.md` under
`## Model selection`. Worth reading once so you know the Opus triggers on your side.

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
