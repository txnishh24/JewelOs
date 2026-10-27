# Karigar Management — design spec

27 October 2026. Follows the same-day "Karigar Cost" work (per-item cash/wastage
payment terms feeding real profit — see `js/01-sync-core.js`'s `karigarCostOf()`
and the HANDOFF.md entry for that change). This spec extends it into a full
karigar-tracking subsystem: who is doing the work, their current workload,
and a running account you settle with them.

## Why

Tanish (verbatim, 27 Oct): "I want separate field of karigar so I can monitor
the karigar work — how much he worked this month and overall work he has
done, currently working orders, and how much he worked and earned." Target
workflow: order created → assigned to a specific karigar → sits in his
queue → he submits finished work → it updates his account automatically →
Tanish sees insights/reports.

## Decisions already made (don't re-litigate)

Confirmed in brainstorming, 27 Oct:

1. **Internal only.** The karigar never opens JewelOS. No login, no new auth
   role. Tanish/staff do every status change on his behalf (told verbally/
   WhatsApp in real life).
2. **Unbounded karigar count.** No assumed fixed small list — design for
   "however many," same as Suppliers already does.
3. **Assignment is per stage within an item, not per order.** An order can
   have several items; an item itself can pass through **a sequential chain
   of karigars**, each doing a different task (the motivating case: a
   necklace karigar does the gold work, then a separate diamond karigar sets
   the stones). One active stage at a time, in order — not parallel.
4. **Running balance + payments, like Suppliers/Girvi**, not a bare earnings
   report. Each submitted stage adds to what's owed; payments are recorded
   against it over time.
5. **Two balance units, not one.** Cash-mode work is owed in ₹. Wastage-mode
   work is owed in **grams, split by metal** (gold grams ≠ silver grams —
   same metal-awareness bug already fixed once today in `karigarCostOf()`,
   don't reintroduce it here). Converting wastage to a ₹ snapshot was
   explicitly rejected — it drifts as the rate moves and isn't how the
   karigar is actually paid.

## Data model

### `S.karigars` — new top-level array

```js
{ id, name, phone }
```

Flat list, same shape and same auto-create-on-first-use pattern as
`S.suppliers` (`09-purchases.js:888`) — typing a new name on an order item's
karigar picker adds it here if it doesn't already exist. No dedicated
"Add Karigar" screen needed, matching how Suppliers works today.

### Order item — `karigarStages` array (replaces the 3 flat fields)

Today's Karigar Cost work put `karigarPayMode` / `karigarCost` /
`karigarWastagePct` directly on the order item. That only supports one
karigar per item, which the diamond-setting case already breaks. Before this
ships, those 3 fields move from the item into a stage object, and the item
gets one new array field:

```js
item.karigarStages = [
  {
    task: 'Gold work',            // free text, not an enum — shops vary
    karigarId: 'k1',
    karigarPayMode: 'wastage',    // '' | 'cash' | 'wastage', same 2 modes
    karigarCost: 0,               // ₹, when payMode === 'cash'
    karigarWastagePct: 4,         // %, when payMode === 'wastage'
    status: 'submitted',          // '' | 'assigned' | 'submitted'
    assignedDate: '2026-10-27',
    submittedDate: '2026-10-29',
    karigarRate: 7850             // 24K/silver rate locked at bill time, wastage mode only -- same lockedRate convention as today's flat version, now per stage
  },
  {
    task: 'Diamond setting',
    karigarId: 'k2',
    karigarPayMode: 'cash',
    karigarCost: 300,
    status: 'assigned',
    assignedDate: '2026-10-29'
  }
]
```

Metal/purity is not a stage field — all stages on one item share that
item's own `metal`/`purity` (a necklace karigar and a diamond-setter are both
working the same physical gold necklace, not different metals). Wastage %
at each stage is valued against the item's metal, same `getRate(item.metal,
'24K')` call as today's flat version.

Current/active stage = first entry with `status !== 'submitted'`. Item fully
done = every stage `submitted`. This array exists on the order item (pre-sale)
and is carried, unchanged, onto the generated sale line when the order
converts — the same place three flat karigar fields were nearly dropped on
the floor earlier today (`buildSaleObj()`'s custom-item branch,
`js/02-ui-inactivity-modals.js:1406`). This spec's implementation must carry
`karigarStages` there from the start, not discover the gap via a second
review pass.

### `karigarCostOf(item)` — same seam, new internals

`js/01-sync-core.js`'s `karigarCostOf()` is already the single place
`calcItemProfit`, `saleItemCost`, and `orderProfitEst` read a karigar cost
through. None of those three callers change. Only `karigarCostOf()`'s body
changes, from reading `item.karigarPayMode` directly to summing across
`item.karigarStages`:

```js
function karigarCostOf(item){
  return (item.karigarStages||[]).reduce(function(sum, stage){
    // ... same cash/wastage math as today, per stage, metal-aware,
    // using stage.karigarRate (locked at bill time) same as before
  }, 0);
}
```

Profit math is unaffected by *who* did each stage — it only needs the total
cost across all stages, submitted or not (an assigned-but-unsubmitted stage
should NOT count as a cost yet, since nothing's been earned — `karigarCostOf`
must skip stages where `status !== 'submitted'`, which is new behaviour vs.
today's flat-field version that didn't have a submitted concept at all).

### `S.karigarPayments` — new top-level array, append-only

```js
{ id, karigarId, date, type: 'cash' | 'gold' | 'silver', amount, note }
```

Same shape as Girvi's per-loan `ledger[]` — a flat log, never mutated after
the fact, balance is always a derived sum. `amount` is ₹ for `type:'cash'`,
grams for `type:'gold'`/`type:'silver'`.

## Derived views (nothing stored, everything computed on read)

For a given `karigarId`, scanning every order item + sale item's
`karigarStages`:

- **Owed now**: sum `karigarCostOf`-equivalent per stage where
  `karigarId` matches and `status==='submitted'`, split into
  `{ cash: ₹total, gold: grams, silver: grams }`, minus the matching
  `S.karigarPayments` sums for that karigar.
- **This month**: same sum, filtered to stages with `submittedDate` in the
  current calendar month — count of pieces, grams, ₹ earned.
- **Currently assigned**: every stage across every open order where
  `karigarId` matches and `status==='assigned'` — his active queue.
- **Lifetime**: same sums, unfiltered by date.

No new state to keep in sync; the derivation always reflects whatever
`karigarStages`/`S.karigarPayments` currently say, same reasoning as why
Suppliers' ledger is derived from purchase bills rather than stored
separately (`09-purchases.js:177`, `pbSupplierLedgerHtml()`).

## UI touchpoints

1. **Order item form** (`buildOrdItemRow()`, `03-billing-numbers.js`): the
   single "Karigar Payment" row built earlier today becomes a repeatable
   stage list — add/remove stage, each stage has its own task label, karigar
   picker (autocomplete against `S.karigars`, same auto-create-on-type as
   Suppliers), pay mode, and amount/%. Same add/remove pattern already used
   for order items themselves (`addOrdItem`/`removeOrdItem`), one level
   deeper.
2. **Order detail view**: a "Mark Submitted" action on the current active
   stage. Marking it submitted stamps `submittedDate` and — if another stage
   follows — makes that next stage the active one (no separate "start next
   stage" action needed; becoming active IS the next stage simply being
   first-unsubmitted).
3. **Karigar list/detail** (new section, likely under Settings alongside
   where Suppliers already live, not a new top-level nav tab): a card per
   karigar — currently assigned items, this-month submitted count/earned,
   lifetime totals, owed (₹ / gold g / silver g), a "Record Payment" button
   that appends to `S.karigarPayments`.

## Explicit non-goals (scope guard — don't drift into these)

- No karigar login or any new auth/session/role.
- An item's `karigarStages` status does **not** auto-drive the order's own
  `ORD_STATUS` (`new`/`progress`/`ready`/`delivered`) — Tanish still sets
  that manually, same as today. A 3-item order with 2 stages submitted and 1
  still out is not auto-marked "Ready."
- No explicit per-job ledger *entity* (rejected heavier Approach B from the
  brainstorm) — balances stay derived, not stored, matching Suppliers/Girvi
  precedent already in this codebase.
- No concurrent/parallel stages — sequential only, confirmed in brainstorm.
- No wastage→₹ conversion for settlement — two units stay two units.

## Testing

Same conventions as today's Karigar Cost tests
(`tests/regression.test.js`, loadApp()/harness pattern):

- `karigarCostOf()` sums correctly across a multi-stage item, skipping
  unsubmitted stages.
- A stage's cost is metal-aware (gold vs silver wastage), same check as
  today's existing test for the flat-field version.
- `buildSaleObj()` carries `karigarStages` onto the saved sale line (the
  exact regression class that was missed once already today — a dedicated
  test for this specific field, not an assumption it'll "just work" because
  the other fields were fixed).
- Derived "owed" math nets correctly against `S.karigarPayments` entries,
  per unit (₹ stays separate from grams, gold grams stay separate from
  silver grams).
- Current/active stage selection (first non-submitted) on a 1-stage,
  2-stage, and all-submitted item.

## What this does NOT cover yet

Migration of already-shipped data: as of this spec, the flat
`karigarPayMode`/`karigarCost`/`karigarWastagePct` fields from today's
earlier Karigar Cost work are still **uncommitted** in the working tree —
no live shop has this schema yet. If that work ships before this one, a
migration step (wrap the 3 flat fields into a single-stage
`karigarStages` array) would be needed; as of today it is not, since nothing
real depends on the old shape yet. Flag this explicitly if the order of
shipping changes.
