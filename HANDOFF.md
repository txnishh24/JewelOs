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

- **Billing: with it, or free and invoiced by hand?** Open since 3 Sep. Every account
  currently gets Pro, and the Upgrade button tells the customer to create their own
  Razorpay account — money would route to themselves. Either answer is fine. The
  dead-end button is not.
- **Demo mode.** The live site opens with "DEMO MODE — sample data loaded". Decide what a
  jeweller should see first.

---

## LOG — newest first

Append when you finish. One entry per session. Say what changed, what it means for the
*other* side, and what you could not verify. Keep it short; delete entries older than
about a month.

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
