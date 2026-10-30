# Karigar Provenance & Profile — design spec

29 October 2026. Builds on the shipped Karigar Management feature (batch63,
spec `2026-10-27-karigar-management-design.md`) and the 28 Oct reshape
(own nav tab + order-level `assignOrderToKarigar()`, commit `a17e63e`, not yet
deployed). Closes four gaps found by comparing against GehnaERP / Online
Munim. Tanish's instruction: "build all 4 it looks important spec that out".

**Unrelated docs, do not mix up:** `2026-10-28-karigar-management-module-design.md`
and its plan are an earlier, never-built idea (salary-vs-wastage pay *types*,
"haath-loss", a new `js/11-karigar.js`). Nothing here depends on or revives
them. This spec adds **no new module file**.

Risk class (MODEL-POLICY §8): 🔴 High. This touches a ledger-style balance
(`karigarOwed`) and the physical-gold record. Build at Sonnet tier, with Opus
review on the tasks the plan marks.

---

## 0. Two live bugs found while reading the current code (fix first)

These two are not among the four gaps. Both sit directly under the gaps,
though, and building on top of them would carry their errors into the new
issuance/receipt numbers. The plan fixes them first, as separate tasks that
can each be reviewed alone.

### B1 — `saveOrder()` drops every karigar stage typed in the order form

`js/03-billing-numbers.js` `saveOrder()` builds each saved item with an
explicit field list:

```js
items:validItems.map(function(i){
  return{desc:i.desc,cat:i.cat,metal:i.metal||'gold',purity:i.purity||'22K',
         orderWt:i.orderWt||0,estWt:i.estWt||0,making:i.making||0,
         makingType:i.makingType||'flat',qty:i.qty||1,note:i.note||''};
}),
```

`karigarStages` is not in that list. The per-item "Karigar Stages" editor
(`buildOrdItemRow()`, Row 4b) renders and edits `ordItems[i].karigarStages`
fine, but nothing typed there ever reaches `S.orders`. In practice only
`assignOrderToKarigar()` persists stages today. This is the same
whitelist-drops-the-new-field family that `buildSaleObj()` hit on 27 Oct. Gap
#1 needs the order form to carry issuance data, so this has to be fixed
first. Fix: carry `karigarStages`, and drop stage rows that never got a
karigar, which would otherwise show as a permanent "Unassigned task" active
stage. A typed-in name is enough to get a stage kept, because the name
input's `onchange` already sets `karigarId`.

### B2 — `_allKarigarStageEntries()` counts every billed order twice

When an order is billed, `convertToSale()` copies `karigarStages` onto the
sale lines, and `buildSaleObj()` writes them onto `sale.items[]`. The order
itself stays in `S.orders`, with `billedSaleId` pointing at that sale.
`_allKarigarStageEntries()` scans `S.orders.concat(S.sales)` with no dedupe,
so for every billed order:

- `karigarOwed()` / `karigarStats()` count each submitted stage **twice**:
  once from the order item, and once per split sale line.
- `karigarQueue()` shows any stage still `assigned` at bill time twice. The
  sale-side copy can never be submitted (`markStageSubmitted()` only looks in
  `S.orders`), so it stays in the queue forever.

The existing test ("sums submitted-stage cost across orders and sales") passes
because its order and sale are unrelated records. It never builds a billed
pair.

**Fix: the order is the single source of truth for karigar views.** Skip any
sale whose `id` is some order's `billedSaleId`. The reason is that the order
is where stages are edited and submitted. Sale copies are frozen snapshots
that exist only so `calcItemProfit()` can read a locked `karigarRate`, and
that profit path reads sale items directly, not through
`_allKarigarStageEntries`, so it is unaffected. Stages only ever reach a sale
through `convertToSale()`, so no sale-only stage is lost.

**This changes a number live shops can already see.** batch63 is deployed, so
any shop that billed an order with a submitted stage is showing an inflated
"Owed" figure right now. If it recorded payments against that figure, it will
see a smaller (or negative, meaning overpaid) balance after the fix. Before
deploying: Cowork, which has DB access, should count shops with
`orders[].billedSaleId` set **and** a submitted `karigarStages` entry. If the
count is non-zero, Tanish tells those shops before the number moves. The
HANDOFF entry for the build session must say this.

---

## 1. Gap 1 — Metal-issuance log (highest priority)

### Why

Today the only weight JewelOS knows for karigar work is the item's own
`weight`/`estWt`/`orderWt`, read at submit time to compute wastage grams.
Nothing records what physically left the shop. If a karigar is given 20 g of
fine gold and brings back a 17 g piece, the app has no way to notice.

### Data model — additive fields on a `karigarStages` entry

```js
{
  // ...existing: task, karigarId, karigarPayMode, karigarCost,
  //    karigarWastagePct, status, assignedDate, submittedDate, karigarRate
  issued: [                                   // NEW, append-only log
    { date:'2026-10-29', wt:20,  purity:'24K' },
    { date:'2026-11-02', wt:2,   purity:'24K' },               // top-up mid-job
    { date:'2026-11-02', wt:-0.5, purity:'24K', note:'correction' } // typo fix
  ]
}
```

- `wt` is grams of metal **as weighed**, at `purity`, **for the whole item
  line** (all `qty` pieces). That is what goes on the scale. It is not per
  piece, unlike `estWt`.
- `purity` must have a fineness for the **item's** metal (see
  `PURITY_FINENESS` below). Plated purities are not allowed: plating has no
  karigar metal account.
- It is append-only, same convention as the order payment ledger's
  `reversal` entries and `S.karigarPayments`. A typo is fixed with a negative
  `correction` entry, never by editing or deleting an earlier one. A
  correction may not take that purity's running total below 0.
- An array rather than a scalar because karigars ask for top-ups mid-job, and
  a top-up can come at a different purity than the first issue. The array
  costs the readers one `reduce` and needs no "purities must match" branch.

New constants in `js/00-config-state.js`, next to `G_PUR`/`S_PUR`:

```js
var PURITY_FINENESS = {
  gold:   {'24K':0.999, '22K':0.916, '18K':0.750, '14K':0.585},
  silver: {'999 Pure':0.999, '925 Sterling':0.925, '800':0.800}
};
var KARIGAR_WEIGH_TOL_G = 0.05; // scale noise floor, fine grams -- calibration knob
```

Fineness is needed because the issued purity and the returned purity often
differ. The usual case is 24K fine issued and a 22K piece returned, after the
karigar alloys it. Raw grams then are not comparable, and fine grams are.
`PURITY_FINENESS` is used **only** for issued-vs-received comparison and
metal-held totals. It never touches pricing, and it does not replace
`getRate()`.

### Backward compatibility

Every stage stored before this ships has no `issued` field. Every reader
treats absent / empty `issued` as "issuance not logged". The derived view
returns `null` for that stage, and the UI behaves exactly as it does today.
No migration and no backfill. Issuance is never asked for, retroactively, on
a stage that is already `submitted`.

### UI flow

Three entry points, all writing the same `issued` shape.

1. **Order form, per-item stage editor** (`buildOrdItemRow()` Row 4b,
   `03-billing-numbers.js`). Each stage row gets a second line: an
   `Issued (g)` input and a purity `<select>`. The select lists that item's
   metal's purities that have a fineness, and defaults to the item's own
   purity. Blank weight means nothing is logged. Non-blank means
   `stage.issued = [{date: today, wt, purity}]`. On save, `saveOrder()`
   refuses with a toast if any issued purity is not valid for the item's
   *current* metal. This covers the case where the owner changed the item's
   metal after picking a purity: stage rows don't re-render on a metal
   change, so the check belongs at save, not at render.
2. **`assignOrderToKarigar()` bulk prompt flow** (`04-orders-detail.js`).
   The existing prompts keep their order (name, task, mode, amount). Then:
   - **One weight prompt per target item**, in item order:
     `Metal handed over for item 2 of 3 — "Ring" (grams, total for all
     pieces). Leave blank if not handing metal over yet.` Blank means none
     for that item. Anything else must be finite and > 0, or the whole flow
     cancels with a toast, the same validation style as the amount prompt
     already uses.
   - **Then one purity prompt, only if at least one weight was entered**:
     `Purity of the metal handed over (e.g. 24K, 22K, 925 Sterling)? Leave
     blank to use each item's own purity.` If an explicit purity is not valid
     for some weighted item's metal (24K typed for a silver payal), the whole
     flow cancels with a toast naming the item. It never silently skips. A
     blank answer uses each item's own purity, which must itself have a
     fineness. A plated item with a weight cancels with a toast.
   - Weights come before purity so the common "not issuing metal yet" path
     costs N Enter presses and no purity question. One purity for the batch
     matches real life: one lump of metal handed over for the order.
   - All-or-nothing, as today: nothing is pushed until every prompt passes.
   - `prompt()` is used rather than a form to stay consistent with the
     existing v1 karigar flows (`assignOrderToKarigar`, `promptKarigarPayment`).
     Prompt text is plain text, not HTML, so item names need no escaping
     there.
3. **Order detail, active stage** (`showOrderDetail()`, `04-orders-detail.js`).
   A new `Issue Metal` button sits next to `Mark Submitted` on the active
   stage. It covers stages created before this ships, stages created without
   a weight, top-ups, and corrections. It prompts for weight (a negative
   value is allowed only here, and needs a `safeConfirm(...,'warn')`:
   "This reduces metal issued by X g — only use this to fix a typo"), then
   purity (defaulting to the last issued purity, or the item purity if none).
   It appends one entry. When the active stage has issuance, the "Active:"
   line also shows `Issued 22.00g (24K)` (per-purity totals, via `fmtW`).

### Derived views (nothing stored, `01-sync-core.js`)

- `karigarFineOf(metal, purity, grams)` returns fine grams, or `null` if the
  purity has no fineness for that metal.
- `karigarIssuedFine(item, stage)` returns the sum of fine grams over
  `stage.issued`. It returns `0` when absent or empty, and `null` if any entry
  is invalid (write-time validation should make that unreachable, but readers
  must not turn it into a wrong number).
- `karigarMetalHeld(karigarId)` returns `{gold, silver}` fine grams, summed
  over that karigar's stages with `status !== 'submitted'`. This is metal
  that is physically his right now. It deliberately includes stages on
  cancelled orders: cancelling the order does not bring the gold back.

### What NOT to build (gap 1)

- No backfill/migration and no prompt for issuance on already-submitted stages.
- No separate "metal account" entity or new top-level `S.` array. Issuance
  lives on the stage it belongs to, and everything else is derived.
- No metal value in ₹ for issued/held metal. Grams stay grams, gold and
  silver stay separate (batch63 decision 5).
- No issuance on the sale-line copies of stages (`buildSaleObj()`'s stage
  whitelist stays as is). After B2, nothing reads provenance from sale copies.
  Carrying it there would create a second copy that can drift.
- No stock-ledger link (issuing from a purchase lot or bullion inventory).
  JewelOS has no bullion stock; this is a karigar-side record only.
- No per-top-up karigar signature/photo. Upgrade path if disputes need it.

---

## 2. Gap 2 — Receipt verification

### Why

Competitors run Issuance → WIP → Receipt (weighed, checked against issued) →
Settlement. JewelOS has assigned → submitted, one flip, no weigh-in. Once gap
1 records what went out, the receipt check is the same data plus one
comparison.

### Mapping to existing statuses — no new status values

| Competitor step | JewelOS |
|---|---|
| Issuance | `issued[]` on the stage (gap 1) |
| WIP | `status:'assigned'` with non-empty `issued` (derived, not stored) |
| Receipt | "Mark Submitted", now with a weigh-in when the stage has issuance |
| Settlement | existing Record Payment (`S.karigarPayments`), unchanged |

No `'received'` or `'wip'` status is added. Every existing reader
(`karigarStageCost`, `karigarOwed`, `karigarStats`, `karigarQueue`, the order
detail, `assignOrderToKarigar`'s "has active stage" test) branches on
`status !== 'submitted'`. A new status value would need every one of them
re-checked for no gain.

### Data model — additive fields on a `karigarStages` entry

```js
receivedWt:      19.40,  // NEW: net metal of finished piece(s), grams at ITEM purity, whole line; exclude stones
receivedScrapWt: 0.30,   // NEW: leftover/unused metal returned, grams at the FIRST issued entry's purity; 0 if none
receiptNote:     ''      // NEW: only written when the shortfall is beyond allowance
// receipt date = existing submittedDate; no new date field
```

Backward compat: absent `receivedWt` means "not weighed". That covers every
stage submitted before this ships, and any stage with no issuance. The
receipt check returns `null`, and nothing renders or counts for that stage.

### `karigarReceiptCheck(item, stage, receivedWt, receivedScrapWt)`

A pure function in `01-sync-core.js`. The optional last two arguments let the
UI check a weight *before* writing it. With them omitted, it reads the
stored fields. It returns `null` when `issued` is empty or absent, when there
is no received weight, or when any purity has no fineness (plated item).
Otherwise it returns:

```js
{ metal, issuedFine, receivedFine, shortFine, allowanceFine, band }
// shortFine     = issuedFine - (fine(receivedWt @ item.purity) + fine(receivedScrapWt @ issued[0].purity))
// allowanceFine = wastage-mode stage ? pct/100 * (item.weight||estWt||orderWt) * qty : 0
// band: 'match'     |shortFine| <= KARIGAR_WEIGH_TOL_G
//       'over'      shortFine < -TOL          (returned more than issued -- stones weighed in?)
//       'allowance' TOL < shortFine <= allowanceFine + TOL
//       'short'     shortFine > allowanceFine + TOL
```

`allowanceFine` deliberately uses **the same weight base as
`karigarStageGrams()`** (`item.weight||estWt||orderWt`, times qty, with the
pct treated as fine grams, matching how `karigarStageCost` values it at the
24K rate). The allowance shown at receipt is then exactly the wastage this
stage is being paid. Switching the base to `receivedWt` would make the two
disagree.

### Mismatch handling — warn-and-let-through, not block

**Decision: never block the submit on a mismatch.** Do require a weigh-in on
any stage that has issuance.

- *Weigh-in required when `issued` is non-empty:* "Mark Submitted" first asks
  `Net metal weight received back (grams, exclude stones; total for all N
  pieces)?`. Blank or Cancel cancels the submit (`toast('Cancelled')`), and
  the stage stays assigned. An owner who logged metal out has to weigh it
  back in, otherwise gap 1 is pointless. `0` is accepted (nothing came back)
  and lands in `'short'`. Next comes `Leftover metal returned (grams at
  <purity>)? Leave blank if none.` Blank means 0.
- *Then by band:*
  - `'match'` submits, then `toast('✓ Received — matches metal issued')`.
  - `'allowance'` submits, then `toast('✓ Received — 0.62g fine short,
    within this stage's 0.80g wastage allowance')`.
  - `'over'` submits, then `toast('Received 0.30g fine MORE than issued —
    check stones were not weighed in')`.
  - `'short'` shows `safeConfirm('Metal short by 1.20g fine', 'Issued 20.00g
    fine · received 18.80g fine · wastage allowance 0.00g. Record this
    receipt anyway?', onOk, 'warn')`. OK prompts `Note for the record
    (optional)?` and then submits with `receiptNote`. Cancel saves nothing,
    so the owner can re-weigh.
- *No issuance logged* (every legacy stage, and new ones where it was
  skipped): exactly today's behaviour. Immediate submit, no prompts.

Why warn rather than block. By the time the owner taps Mark Submitted, the
piece is physically back in the shop and the order has to move on to the
customer. A block would only make the owner either lie about the weight to
get past it, or stop logging issuance. Both are worse than a recorded
shortfall. The value here is **the permanent record plus a hard-to-miss
moment**, and `safeConfirm(..., 'warn')` is this app's existing amber
"are you sure" for exactly that kind of step. It is used for the past
delivery date in `saveOrder()`. The in-tolerance and allowance cases use
`toast` only, so the owner is not trained to tap past an amber dialog on
every wastage job. The shortfall number is still shown each time, and it
stays on the karigar's card (gap 4).

Strictness: the `'short'` threshold is the noise floor **plus** the stage's
own wastage allowance, never more. A karigar returning 0.8 g less on a 4 %
wastage job is shown, via the toast, but not alarmed on. Anything beyond the
allowance is alarmed on.

### Implementation shape

- `markStageSubmitted(ordId, itemIdx, receipt)` gains an optional third
  argument `{receivedWt, receivedScrapWt, receiptNote}` and writes those
  fields onto the stage before flipping status. Without it, behaviour is
  identical to today, so the existing tests stay green as they are.
- `promptStageReceipt(ordId, itemIdx)` is a new UI wrapper in
  `04-orders-detail.js`. It runs the prompts and band handling above, calls
  `markStageSubmitted(..., receipt)`, then `showOrderDetail(ordId)`. The
  Mark Submitted button's `onclick` changes from
  `markStageSubmitted(...);showOrderDetail(...)` to `promptStageReceipt(...)`.
  The wrapper re-renders itself, because `safeConfirm` is async and an inline
  re-render would fire before the confirm resolves.
- The order detail shows one line per submitted stage that has a receipt
  check: `Gold work — received 19.40g · 0.62g fine short (within allowance)`.
  Stages without a check render nothing new.

### Open question for Tanish (does not block the build — default chosen)

**Which wastage convention does the shop use?** (a) The karigar keeps the
wastage out of the issued metal, so he returns issued − wastage. (b) He
returns everything and the shop pays wastage separately. `karigarOwed()`
already shipped assuming **(b)**: it shows wastage grams as owed *to* the
karigar. Under (a) that would double-pay. **Default in this spec: change
nothing in `karigarOwed`, and never auto-net a shortfall against the owed
balance.** The receipt `'allowance'` band shows the numbers either way. If
Tanish says (a), the follow-up is one small step: at receipt, offer to record
a `gold` payment equal to `min(shortFine, allowanceFine)` through the
existing `recordKarigarPayment()`. That is new data on the existing ledger,
not new semantics. It is not built here.

### What NOT to build (gap 2)

- No blocking on mismatch. No owner-PIN override for a short receipt.
- No new status values, no partial receipts (half the pieces back now, half
  later). A partial return is a re-weigh at full return. Upgrade path:
  a `received[]` log mirroring `issued[]`.
- No automatic deduction of a shortfall from the karigar's owed balance, and
  no automatic "karigar owes us metal" ledger entry. A shortfall is a fact
  shown and recorded; settling it stays a human Record Payment decision.
- `receivedWt` does **not** overwrite the item's `estWt`/`orderWt`/`weight`,
  and does not feed `karigarStageCost`/`karigarStageGrams`. Doing so would
  retroactively change owed balances and profit for already-submitted work.
- No receipt weigh-in on sale-line copies (B2 makes the order canonical).

---

## 3. Gap 3 — Karigar profile fields

### Data model — additive fields on an `S.karigars` entry

```js
{ id, name, phone,      // existing (phone has always been '' -- never editable until now)
  skills: '',           // NEW: free text, e.g. "Kundan setting, Bengali chains"
  note:   '' }          // NEW: free text -- experience, address, anything else
```

- **Unique ID:** `id` already exists and is unique (`'kar'+timestamp+rand`).
  No human-facing karigar code ("K-001") is added. A shop with 1–3 karigars
  identifies them by name. Pushback recorded, not built.
- **Experience:** goes in `note`. A structured "years of experience" number
  would drive no decision in this app.
- **Contact:** `phone`, validated with the existing `normPhone10()`
  (`01-sync-core.js`). Blank is allowed, anything else must be a valid
  10-digit mobile number. This is the same rule as the shop phone in
  `saveShopProfile()`.
- **Name** becomes editable too, because a name typed into a `prompt()` at
  assign time is the likeliest place for a typo. Renaming is safe: stages
  reference `karigarId`, not the name. A rename that collides
  (case-insensitive, trimmed, same rule as `addOrGetKarigar`) with another
  karigar is refused, because a collision would make `addOrGetKarigar` pick
  one of the two at random from then on.

Backward compat: absent `skills`/`note` read as `''`. Absent or empty
`phone` renders nothing. No migration.

### UI — inline on the Karigars tab card

The Karigars tab (`renderKarigarList()`, `05-auth-login.js`) is now the
karigar's home, since the Settings → Team card was deleted on 28 Oct. The
profile edit goes **inline on that card**, mirroring the Team tab's
hidden-card-toggled-by-a-button pattern (`#set-invite-form`), but rendered
inside each card instead of as static `index.html` markup. Cards are already
built as an `innerHTML` string, so `index.html` needs no change.

- Card header line shows `phone` and `skills` (both `escHtml`'d) when set.
- An `Edit details` button (`onclick="toggleKarigarProfile('<jsAttrEsc id>')"`)
  shows a hidden `<div id="kp-form-<id>">` with four inputs (name, phone,
  skills, note). Values go into `value="..."` through `escHtml()`. The div
  also holds a Save button (`saveKarigarProfileForm('<jsAttrEsc id>')`) and
  a Cancel button.
- Data function `updateKarigarProfile(id, fields)` in `01-sync-core.js`, next
  to `addOrGetKarigar`/`findKarigar`. It returns `''` on success, after
  calling `saveToCloud` (same as `recordKarigarPayment`), or an error string
  without mutating anything. The UI function in `05` reads the inputs, shows
  the error via `toast`, or re-renders.

### What NOT to build (gap 3)

- No "Add Karigar" screen. Karigars are still auto-created on first use, as
  in batch63 (same as Suppliers). Upgrade path: one button calling
  `addOrGetKarigar(prompt(...))`, if Tanish asks.
- No delete/deactivate. Orphaned ids are already tolerated (`findKarigar`
  returns `undefined`), but delete brings up "what about his held metal",
  which is not answered here.
- No photo, ID-proof upload, bank details, address fields, or salary/pay-type
  profile. Pay type stays per stage, as in batch63, and the unrelated 28 Oct
  doc pair is **not** revived.
- No karigar code, no search/filter on the Karigars tab.

---

## 4. Gap 4 — Performance/quality tracking (scope pushed back)

### The tension, stated plainly

Competitors ship karigar ratings, quality scores, rework/rejection tracking
and leaderboards, because their buyers run workshops with large karigar
rosters. JewelOS's actual users are small shops with **1–3 karigars the owner
already knows personally** and talks to daily. A rating form there is data
entry nobody acts on. It is also the "speculative feature" the house rules
forbid. Tanish did say "build all 4". This spec builds gap 4 as **the
smallest version that answers a real question from data the app already
has**, and refuses the rest until a concrete decision it would drive is named.

### What "performance" minimally means here

Two derived numbers, **zero new stored fields**, added to the existing
`karigarStats(karigarId, monthKey)` return object (additive keys; current
callers and tests read named keys and are unaffected):

| New key(s) | Derived from | Answers |
|---|---|---|
| `daysTotal`, `daysCount` (card shows the average) | `submittedDate − assignedDate`, on submitted stages with both dates | "Is he getting slower?" Delivery dates are the shop's real promise to customers |
| `shortGold`, `shortSilver`, `shortJobs` | `karigarReceiptCheck(...).shortFine` on stages whose band is `'short'` | "Is metal going missing with him?" This is gap 1/2's payoff, on the card |

Gold and silver shortfalls stay **separate keys**. Summing fine gold and fine
silver grams together is the unit-mixing bug batch63 already fixed once.

The card renders one extra line, only when there is something to say:
`Avg turnaround: 6.2 days (14 jobs) · Short beyond allowance: 0.42g gold (2 jobs)`.
It also shows a `Holding now: 34.20g gold · 0.00g silver` line from
`karigarMetalHeld()` (gap 1) whenever either value is > 0. That is the single
most useful number on this card for a shop owner.

### What NOT to build (gap 4) — explicit pushback

- No star ratings, quality scores, review text, rework/rejection counts,
  customer-complaint links, or karigar ranking/leaderboard.
- No on-time-vs-promised metric. Stages have no due date of their own, only
  the order's `delivery`. Adding a per-stage due date is new data entry for
  1–3 people.
- No charts, no per-karigar report screen, no month-over-month trend.
- **Re-open condition:** if Tanish can name a decision (who gets the next
  bridal order, whose rate to renegotiate) that the two numbers above can't
  inform, spec the one extra field that would. Not before.

---

## 5. File placement (CLAUDE.md ownership table — no new module)

| File | Change |
|---|---|
| `js/00-config-state.js` | `PURITY_FINENESS`, `KARIGAR_WEIGH_TOL_G` (constants, next to `G_PUR`/`S_PUR`) |
| `js/01-sync-core.js` | B2 fix in `_allKarigarStageEntries`; `karigarFineOf`, `karigarIssuedFine`, `karigarReceiptCheck`, `karigarMetalHeld`; additive keys in `karigarStats`; `updateKarigarProfile` |
| `js/03-billing-numbers.js` | B1 fix + issued-purity validation in `saveOrder()`; issuance inputs in `buildOrdItemRow()` Row 4b |
| `js/04-orders-detail.js` | `markStageSubmitted` receipt arg; new `promptStageReceipt`, `logStageIssue`, `promptStageIssue`; issuance prompts in `assignOrderToKarigar`; active/submitted stage lines + buttons in `showOrderDetail` |
| `js/05-auth-login.js` | `renderKarigarList` card: profile line, holding line, performance line, inline edit form; new `toggleKarigarProfile`, `saveKarigarProfileForm` |
| `js/02-ui-inactivity-modals.js` | **no change**. `buildSaleObj` stage whitelist intentionally not extended (gap 1 not-build) |
| `index.html` | **no change**. Everything renders into the existing `#karigar-list` / `#ord-modal-body` |
| persistence (`saveCache`/`loadCache`/backup/restore/`checks/roundtrip.js`) | **no change**. No new top-level `S` key; new fields are nested in `S.orders[].items[].karigarStages[]` and `S.karigars[]`, which already round-trip whole |

---

## 6. Money/weight correctness — invariants the build must hold

These are what `jewelos-invariant-tester` should gate. Each has a test in the
plan.

1. **`karigarStageCost` / `karigarCostOf` are untouched.** For any stage,
   adding `issued`/`receivedWt`/`receivedScrapWt`/`receiptNote` leaves its
   cost identical, because neither function reads those fields. So
   `orderProfitEst()` (`06-inventory-stock.js`, reads `karigarCostOf`) and
   `calcItemProfit()` / `calcSaleProfit()` (read sale-line copies, which carry
   none of the new fields) cannot move.
2. **`karigarOwed` changes only via B2's dedupe.** Issuance, receipt,
   shortfall and metal-held never enter it. A shortfall is never
   auto-subtracted.
3. **After B2, each submitted stage of a billed order counts exactly once**
   in `karigarOwed`/`karigarStats`, and an assigned stage appears exactly
   once in `karigarQueue`. Unbilled orders and unlinked sales are unchanged.
4. **Units never mix.** Owed ₹, owed gold g, owed silver g, held gold fine g,
   held silver fine g, short gold, and short silver are all separate numbers.
   None is converted to ₹. Gold and silver are never summed.
5. **Fine-gram math is metal-aware from the item.** Fineness is looked up
   under the **item's** metal (same rule as `karigarStageCost` reading
   `item.metal`, never the stage). A gold purity on a silver item is
   rejected at write time. At read time it yields `null`, never a number.
6. **Absent means unknown, never zero-valued-as-fact.** A stage with no
   `issued` gives `karigarReceiptCheck → null` and contributes 0 to
   metal-held. A stage with no `receivedWt` gives `null`, not a 100 %
   shortfall.
7. **No `NaN`/`Infinity` reaches storage.** Every new numeric input goes
   through the existing `parseFloat` + `isFinite` + sign check pattern
   before being written (the 96th-entry `Infinity` bug in
   `promptKarigarPayment`).

---

## 7. Security / escaping

- Every new free-text value rendered into `innerHTML` goes through
  `escHtml()`. That covers `skills`, `note`, `phone`, `name`, `receiptNote`,
  `task`, and purity strings, which are user-chosen from a fixed list but
  escaped anyway.
- Every new inline handler passes ids through `jsAttrEsc()`.
  `checks/unescaped-ids.js` must report no new hits. Item index `n` stays an
  unquoted number, the same as the existing Mark Submitted button.
- Generated element ids that embed a karigar id (`kp-form-<id>`) will show
  as `checks/ids.js` string-join false positives. This is expected; compare
  against the baseline.
- Staff gating is unchanged. The Karigars tab is already staff-blocked, and
  the order detail buttons follow the existing Assign/Mark Submitted
  visibility (no role check), so nothing new is gated or un-gated.

## 8. Testing (conventions: `tests/regression.test.js`, `loadApp()` / `_orderFormApp()` harness)

The plan lists every test with its code. In summary: B1 (stages survive
`saveOrder`, blank rows dropped), B2 (billed pair counted once, stuck queue
copy gone), fineness math (same-purity, cross-purity, plated → null, wrong
metal → null), receipt bands (all four, plus null cases), metal-held
(includes cancelled orders, excludes submitted, gold/silver split),
`markStageSubmitted` receipt arg (and unchanged without it), the
`promptStageReceipt` flow with stubbed `prompt`/`safeConfirm`/`toast` (blank
cancels, short confirms, cancel saves nothing), `assignOrderToKarigar` (its
first tests ever: all-blank weights, explicit purity, wrong-metal purity
cancels, non-finite cancels), `logStageIssue` (top-up appends, correction
can't go negative), `updateKarigarProfile` (bad phone, name clash, success),
`karigarStats` new keys, and **invariant 1 as an explicit test** (cost
identical with and without the new fields).

`tests/e2e/` has **no Orders spec** (README "What's NOT covered"), so every
DOM flow here (order form stage row, order detail buttons, Karigars card
form) can only be verified by a `skills/verify-ui.md` pass. The build's
HANDOFF entry must say so.
