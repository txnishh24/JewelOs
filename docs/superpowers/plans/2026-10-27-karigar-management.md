# Karigar Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Tanish assign each order item to a sequential chain of karigars (e.g. necklace karigar → diamond-setter), track each karigar's current queue and a running ₹/gold-gram/silver-gram balance, and settle it with recorded payments.

**Architecture:** Replace the single-karigar flat fields on an order item (`karigarPayMode`/`karigarCost`/`karigarWastagePct`, added earlier today, still uncommitted) with a `karigarStages` array — one entry per task/karigar, submitted independently. `karigarCostOf()` stays the one seam `calcItemProfit`/`saleItemCost`/`orderProfitEst` read through; only its internals change, from reading flat fields to summing stages. A new `S.karigars` directory (auto-create-on-type, same pattern as `S.suppliers`) and `S.karigarPayments` (flat append-only log, same pattern as Girvi's `ledger[]`) back a set of pure derivation functions — nothing is stored pre-computed.

**Tech Stack:** Vanilla ES5, no build step, no framework. Tests run via `node tests/regression.test.js` against `tests/harness.js`'s `loadApp()` VM sandbox.

**Spec:** `docs/superpowers/specs/2026-10-27-karigar-management-design.md`

## Global Constraints

- ES5 only — no arrow functions, `let`/`const`, template literals, `async/await` (CLAUDE.md).
- `escHtml()` into `innerHTML`; `jsAttrEsc()` into inline `onclick="fn('...')"` (CLAUDE.md). Karigar names/task labels are free text and must go through `escHtml()` wherever rendered.
- Byte-exact edits near any `\uXXXX` escape — use a Python read-modify-write script, not a plain string replace (CLAUDE.md). None of the exact strings being edited in this plan contain one, but check before editing if a task's `old_string` doesn't match verbatim.
- No raw `localStorage` keys for shop state — use `shopScopedKey()` (CLAUDE.md). Not applicable here (no new localStorage keys this plan adds directly — `S.karigars`/`S.karigarPayments` ride the existing `ssj_cache` key).
- Internal tracking only — the karigar never opens the app, no new login/auth/session (spec decision 1).
- Sequential stages only, one active at a time — not parallel (spec decision 3 / brainstorm follow-up).
- No ₹-equivalent conversion for wastage balances — gold grams and silver grams stay their own units, never summed into one number (spec decision 5).
- `karigarCostOf()` must only count a stage once it is `submitted` — an assigned-but-unfinished stage has earned nothing yet.
- After every task: `node --check` on changed files, then `node tests/regression.test.js`, then from `checks/`: `node backup-check.js ..` and `node roundtrip.js ..` must both stay clean (CLAUDE.md's two non-negotiable checks).

## Review Focus

- **A karigar assigned to a stage is later deleted from `S.karigars`** (if a delete action is ever added) — orphaned `karigarId` on old stages must not crash a derivation function; every lookup must tolerate "not found" (Task 2 test covers this).
- **An order item with zero stages** (every order item created before this ships, and any new item where the owner never opens the karigar picker) — `karigarCostOf()` must return exactly 0, not throw on `(undefined||[]).reduce` (Task 3 test covers this explicitly, it's the single most common case in production).
- **A stage with `karigarPayMode` set but the matching amount field left blank** (e.g. `payMode:'cash'` but `karigarCost` never typed) — must cost 0 for that stage, not `NaN` propagating through a sum (Task 3 test).
- **Two stages on the same item use different metals** — explicitly impossible per the data model (stages share the item's metal), but nothing in the code currently *enforces* that a stage can't carry a stray `metal` field of its own; `karigarCostOf()` must read the metal from the **item**, not from the stage, so a future bug that puts a metal field on a stage object is silently ignored rather than silently wrong (Task 3 implementation detail, covered by test reading the item's metal explicitly).
- **A karigar with a nonzero balance who has never received a payment** (`S.karigarPayments` has no entries for him at all) — `karigarOwed()` must not throw on an empty filter/reduce, must report the full submitted total as owed (Task 6 test).

---

## Task 1: Register `S.karigars` and `S.karigarPayments` as persisted state

This repo has three independent persistence mechanisms, and a top-level array only survives all three if it's wired into every one: cloud sync (`01-sync-core.js`), the offline localStorage cache (`04-orders-detail.js`), and the manual backup/restore file (`05-auth-login.js`). `checks/backup-check.js` and `checks/roundtrip.js` exist specifically to catch a key present in one but not another — this task's test is running those two scripts clean, not a regression.test.js assertion.

**Files:**
- Modify: `js/00-config-state.js:65-72` (initial `S` object)
- Modify: `js/01-sync-core.js:137` (cloud load), `js/01-sync-core.js:300` (cloud save payload)
- Modify: `js/04-orders-detail.js:530` (cache save), `js/04-orders-detail.js:748` (cache load)
- Modify: `js/05-auth-login.js:1147` (manual backup export), `js/05-auth-login.js:1205` (manual backup import)
- Modify: `checks/roundtrip.js:16` (test fixture)

**Interfaces:**
- Consumes: nothing new.
- Produces: `S.karigars` (array of `{id, name, phone}`), `S.karigarPayments` (array of `{id, karigarId, date, type, amount, note}`) — every later task reads/writes these two arrays directly on `S`.

- [ ] **Step 1: Add the two arrays to the initial `S` object**

In `js/00-config-state.js`, change:
```js
var S = {
  products:[], sales:[], orders:[], girvi:[], customers:[],
  purchases:[], suppliers:[], purchaseAuditLog:[],
```
to:
```js
var S = {
  products:[], sales:[], orders:[], girvi:[], customers:[],
  purchases:[], suppliers:[], purchaseAuditLog:[],
  karigars:[], karigarPayments:[],
```

- [ ] **Step 2: Wire cloud load/save in `js/01-sync-core.js`**

At line 137, after the `suppliers` line, add:
```js
    if(Array.isArray(record.karigars))        S.karigars        = record.karigars;
    if(Array.isArray(record.karigarPayments))  S.karigarPayments = record.karigarPayments;
```

At line 300, after the `suppliers:` line in the save payload, add:
```js
    karigars:        S.karigars || [],
    karigarPayments: S.karigarPayments || [],
```

- [ ] **Step 3: Wire the local cache in `js/04-orders-detail.js`**

At line 530 (`saveCache()`), change:
```js
      purchases:S.purchases||[],suppliers:S.suppliers||[],purchaseAuditLog:S.purchaseAuditLog||[],purchaseCfg:S.purchaseCfg||{},rates:S.rates,
```
to:
```js
      purchases:S.purchases||[],suppliers:S.suppliers||[],purchaseAuditLog:S.purchaseAuditLog||[],purchaseCfg:S.purchaseCfg||{},rates:S.rates,
      karigars:S.karigars||[],karigarPayments:S.karigarPayments||[],
```

At line 748 (`loadCache()`), after the `suppliers` line, add:
```js
    if(Array.isArray(r.karigars)) S.karigars=r.karigars;
    if(Array.isArray(r.karigarPayments)) S.karigarPayments=r.karigarPayments;
```

- [ ] **Step 4: Wire the manual backup file in `js/05-auth-login.js`**

At line 1147 (export `data:` block), after `suppliers:  S.suppliers||[],`, add:
```js
      karigars:        S.karigars||[],
      karigarPayments: S.karigarPayments||[],
```

At line 1205 (import, after `if(d.suppliers)  S.suppliers   = d.suppliers;`), add:
```js
        if(d.karigars)        S.karigars        = d.karigars;
        if(d.karigarPayments) S.karigarPayments = d.karigarPayments;
```

- [ ] **Step 5: Update the roundtrip test fixture**

In `checks/roundtrip.js`, after the `suppliers: [{ id: 1, name: 'Mehta Bullion' }],` line, add:
```js
  karigars: [{ id: 1, name: 'Ramesh', phone: '9000000001' }],
  karigarPayments: [{ id: 1, karigarId: 1, date: '2026-10-27', type: 'cash', amount: 500, note: 'advance' }],
```

- [ ] **Step 6: Verify**

```bash
node --check js/00-config-state.js
node --check js/01-sync-core.js
node --check js/04-orders-detail.js
node --check js/05-auth-login.js
cd checks && node backup-check.js .. && node roundtrip.js .. && cd ..
```
Expected: `OK every exported key is restored`, `OK no orphan restore keys`, `PASS all 24 shop-data keys survived export -> wipe -> restore` (24, not 22 — two new keys).

- [ ] **Step 7: Commit**

```bash
git add js/00-config-state.js js/01-sync-core.js js/04-orders-detail.js js/05-auth-login.js checks/roundtrip.js
git commit -m "Register S.karigars and S.karigarPayments across all three persistence paths"
```

---

## Task 2: Karigar directory — auto-create-on-type helper

Mirrors the existing supplier pattern (`09-purchases.js:888`, inline rather than a function — this task makes it a real named function since both the order-item karigar picker (Task 4) and the karigar list UI (Task 7) need to call it).

**Files:**
- Modify: `js/01-sync-core.js` (new function, placed near other shared helpers — e.g. just above `getRate()`)
- Test: `tests/regression.test.js`

**Interfaces:**
- Consumes: `S.karigars` (Task 1).
- Produces: `addOrGetKarigar(name)` — returns the existing karigar object (matched case-insensitively, trimmed) if one exists, otherwise creates and returns a new `{id, name, phone:''}` pushed onto `S.karigars`. `findKarigar(id)` — returns the karigar object for an id, or `undefined` if not found (never throws).

- [ ] **Step 1: Write the failing tests**

Add to `tests/regression.test.js` (anywhere after the existing supplier-adjacent tests, or simply at the end of the file before the final summary print):

```js
test('addOrGetKarigar: creates a new karigar on first use, reuses an existing one by name (case/whitespace-insensitive)', function(){
  var a = loadApp();
  var k1 = a.addOrGetKarigar('Ramesh');
  assert(k1 && k1.id && k1.name === 'Ramesh', 'should create a karigar with an id: ' + JSON.stringify(k1));
  assert(a.S.karigars.length === 1, 'should push exactly one karigar');

  var k2 = a.addOrGetKarigar('  ramesh  ');
  assert(k2.id === k1.id, 'same name (trimmed, case-insensitive) should reuse the existing karigar, not duplicate it');
  assert(a.S.karigars.length === 1, 'still only one karigar after the "duplicate" call');

  var k3 = a.addOrGetKarigar('Suresh');
  assert(k3.id !== k1.id, 'a genuinely different name creates a second karigar');
  assert(a.S.karigars.length === 2, 'two distinct karigars now exist');
});

test('findKarigar: returns undefined for an unknown or deleted id, never throws', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  assert(a.findKarigar(k.id) === k, 'should find the karigar just created');
  assert(a.findKarigar('does-not-exist') === undefined, 'unknown id -> undefined, not a throw');
  assert(a.findKarigar(undefined) === undefined, 'no id at all -> undefined, not a throw');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node tests/regression.test.js 2>&1 | grep -A2 "addOrGetKarigar\|findKarigar"
```
Expected: both tests report a failure (`a.addOrGetKarigar is not a function`), since neither function exists yet.

- [ ] **Step 3: Implement**

In `js/01-sync-core.js`, near `getRate()` (or any other small shared helper), add:

```js
// Karigar directory — same auto-create-on-type pattern as S.suppliers
// (09-purchases.js:888), now a named function since both the order-item
// karigar picker and the karigar list UI need to call it, not just one
// inline save handler.
function addOrGetKarigar(name){
  name = (name||'').trim();
  var existing = (S.karigars||[]).find(function(k){ return (k.name||'').trim().toLowerCase() === name.toLowerCase(); });
  if(existing) return existing;
  var k = { id: 'kar' + (Date.now()) + Math.floor(Math.random()*1000), name: name, phone: '' };
  S.karigars = S.karigars || [];
  S.karigars.push(k);
  return k;
}

function findKarigar(id){
  if(!id) return undefined;
  return (S.karigars||[]).find(function(k){ return k.id === id; });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --check js/01-sync-core.js
node tests/regression.test.js 2>&1 | grep -A2 "addOrGetKarigar\|findKarigar"
```
Expected: both show `✓`.

- [ ] **Step 5: Commit**

```bash
git add js/01-sync-core.js tests/regression.test.js
git commit -m "Add karigar directory (addOrGetKarigar/findKarigar), same auto-create pattern as suppliers"
```

---

## Task 3: Migrate order items to `karigarStages`; rewrite `karigarCostOf()`

This is the core data-model change. The three flat fields added earlier today (`karigarPayMode`/`karigarCost`/`karigarWastagePct`) are **replaced outright** by a `karigarStages` array — per the spec's explicit note, nothing live depends on the old flat shape yet (still uncommitted in the working tree as of this plan), so there is no migration-of-old-data step, only a replacement of the in-progress shape.

**Files:**
- Modify: `js/01-sync-core.js` (rewrite `karigarCostOf()`)
- Modify: `js/03-billing-numbers.js` (the 3 `ordItems` default-object literals — remove the 3 flat fields, add `karigarStages:[]`)
- Modify: `js/04-orders-detail.js` (`convertToSale()` — carry `karigarStages` instead of the 3 flat fields)
- Modify: `js/02-ui-inactivity-modals.js` (`buildSaleObj()` — carry `karigarStages` + lock `karigarRate` per stage, instead of the 3 flat fields)
- Modify: `tests/regression.test.js` (update the 8 existing karigar-cost tests to the new shape — they test real behavior, not the old field names, so update their fixtures rather than deleting them)

**Interfaces:**
- Consumes: `getRate(metal, purity)` (existing, `01-sync-core.js:1017`).
- Produces: `karigarCostOf(item)` — same name and single-argument signature as before, now reads `item.karigarStages` (array) instead of 3 flat fields on `item` directly. Every existing caller (`calcItemProfit`, `saleItemCost`, `orderProfitEst`) is unchanged — this is the point of the seam.

- [ ] **Step 1: Update the existing tests to the new shape (write them failing first)**

In `tests/regression.test.js`, find and replace each of these 8 tests (they currently use the flat `karigarPayMode`/`karigarCost`/`karigarWastagePct` fields directly on an item — update the fixtures to wrap them in a one-entry `karigarStages` array, `status:'submitted'` so they still count):

Replace:
```js
test('karigarCostOf: cash mode is a flat per-piece amount times qty, 0 when unset', function(){
  var a = require('./harness.js').loadApp();
  assert(a.karigarCostOf({ karigarPayMode:'cash', karigarCost:500, qty:3 }) === 1500, 'cash cost should scale with qty');
  assert(a.karigarCostOf({ karigarPayMode:'', qty:3 }) === 0, 'unset mode -> 0, not a guess');
  assert(a.karigarCostOf({ qty:1 }) === 0, 'no mode field at all -> 0');
});
```
with:
```js
test('karigarCostOf: cash mode is a flat per-piece amount times qty, 0 when unset or unsubmitted', function(){
  var a = require('./harness.js').loadApp();
  assert(a.karigarCostOf({ qty:3, karigarStages:[{ karigarPayMode:'cash', karigarCost:500, status:'submitted' }] }) === 1500, 'cash cost should scale with qty: ' + a.karigarCostOf({ qty:3, karigarStages:[{ karigarPayMode:'cash', karigarCost:500, status:'submitted' }] }));
  assert(a.karigarCostOf({ qty:3, karigarStages:[{ karigarPayMode:'cash', karigarCost:500, status:'assigned' }] }) === 0, 'an assigned-but-unsubmitted stage has earned nothing yet');
  assert(a.karigarCostOf({ qty:1, karigarStages:[] }) === 0, 'no stages at all -> 0');
  assert(a.karigarCostOf({ qty:1 }) === 0, 'no karigarStages field at all (every pre-existing order item) -> 0, not a throw');
});
```

Replace:
```js
test('karigarCostOf: wastage mode is pct of weight at the pure 24K rate, not the item\'s own purity rate', function(){
  var a = require('./harness.js').loadApp();
  var g24 = a.getRate('gold','24K');
  assert(a.karigarCostOf({ karigarPayMode:'wastage', karigarWastagePct:4, weight:15, qty:1 }) === 0.04*15*g24, 'should price wastage at 24K, not 22K');
  assert(a.karigarCostOf({ karigarPayMode:'wastage', karigarWastagePct:4, estWt:15, qty:2 }) === 0.04*15*2*g24, 'estWt used when weight is absent, scaled by qty');
});
```
with:
```js
test('karigarCostOf: wastage mode is pct of weight at the pure 24K rate (from the item\'s own metal), not the item\'s own purity rate', function(){
  var a = require('./harness.js').loadApp();
  var g24 = a.getRate('gold','24K');
  assert(a.karigarCostOf({ metal:'gold', weight:15, qty:1, karigarStages:[{ karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }] }) === 0.04*15*g24, 'should price wastage at 24K, not 22K');
  assert(a.karigarCostOf({ metal:'gold', estWt:15, qty:2, karigarStages:[{ karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }] }) === 0.04*15*2*g24, 'estWt used when weight is absent, scaled by qty');
});
```

Replace:
```js
test('orderProfitEst: real karigar cost overrides the old billed-making guess once set', function(){
  var a = require('./harness.js').loadApp();
  var rGold = a.getRate('gold','22K'), g24 = a.getRate('gold','24K');
  var order = { quote:120000, items:[{ metal:'gold', purity:'22K', orderWt:15, qty:1, making:650, makingType:'per_gram' }] };
  var oldEst = a.orderProfitEst(order); // no karigar field -> old guess (full making charge as cost)
  assert(oldEst === 120000 - 15*rGold - 650*15, 'old guess unchanged when field unused');
  order.items[0].karigarPayMode = 'wastage';
  order.items[0].karigarWastagePct = 4;
  var newEst = a.orderProfitEst(order);
  assert(newEst === 120000 - 15*rGold - 0.04*15*g24, 'real karigar cost replaces the old making-charge guess');
});
```
with:
```js
test('orderProfitEst: real karigar cost overrides the old billed-making guess once a stage is submitted', function(){
  var a = require('./harness.js').loadApp();
  var rGold = a.getRate('gold','22K'), g24 = a.getRate('gold','24K');
  var order = { quote:120000, items:[{ metal:'gold', purity:'22K', orderWt:15, qty:1, making:650, makingType:'per_gram' }] };
  var oldEst = a.orderProfitEst(order); // no karigarStages -> old guess (full making charge as cost)
  assert(oldEst === 120000 - 15*rGold - 650*15, 'old guess unchanged when field unused');
  order.items[0].karigarStages = [{ karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }];
  var newEst = a.orderProfitEst(order);
  assert(newEst === 120000 - 15*rGold - 0.04*15*g24, 'real karigar cost replaces the old making-charge guess');
  order.items[0].karigarStages[0].status = 'assigned';
  var notYetEst = a.orderProfitEst(order);
  assert(notYetEst === oldEst, 'an assigned-but-unsubmitted stage must NOT replace the old guess yet');
});
```

Replace:
```js
test('calcItemProfit: mcCost comes from karigarCostOf(), 0 for a manual custom sale with no order behind it', function(){
  var a = require('./harness.js').loadApp();
  var noOrder = a.calcItemProfit({ weight:15, qty:1, lockedRate:a.getRate('gold','22K'), making:650 });
  assert(noOrder.mcCost === 0, 'manual custom sale item, no karigar field -> 0 cost, unchanged');
  var g24 = a.getRate('gold','24K');
  var fromOrder = a.calcItemProfit({ weight:15, qty:1, lockedRate:a.getRate('gold','22K'), making:650, karigarPayMode:'wastage', karigarWastagePct:4 });
  assert(fromOrder.mcCost === 0.04*15*g24, 'bill line carried from an order with a recorded karigar cost shows the real figure');
});
```
with:
```js
test('calcItemProfit: mcCost comes from karigarCostOf(), 0 for a manual custom sale with no order/stages behind it', function(){
  var a = require('./harness.js').loadApp();
  var noOrder = a.calcItemProfit({ weight:15, qty:1, lockedRate:a.getRate('gold','22K'), making:650 });
  assert(noOrder.mcCost === 0, 'manual custom sale item, no karigarStages field -> 0 cost, unchanged');
  var g24 = a.getRate('gold','24K');
  var fromOrder = a.calcItemProfit({ metal:'gold', weight:15, qty:1, lockedRate:a.getRate('gold','22K'), making:650, karigarStages:[{ karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }] });
  assert(fromOrder.mcCost === 0.04*15*g24, 'bill line carried from an order with a recorded karigar cost shows the real figure');
});
```

Replace:
```js
test('27 Oct, bug-pattern review: a karigar cost carried onto an order-derived custom line survives buildSaleObj(), not dropped on the floor', function(){
  var a = loadApp();
  a.UI.saleMode = 'custom';
  a.customSaleItems = [{ name:'Order necklace', cat:'Necklaces / Haar', metal:'gold', purity:'22K', grossWt:15, blackBeads:0, diamond:0, making:650, stoneCharges:0,
                          karigarPayMode:'wastage', karigarCost:0, karigarWastagePct:4 }];
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ return /^csi-/.test(id) ? null : _o(id); };
  var s = a.buildSaleObj();
  assert(s.items[0].karigarPayMode === 'wastage' && s.items[0].karigarWastagePct === 4, 'karigar fields dropped by buildSaleObj(): ' + JSON.stringify(s.items[0]));
  var g24 = a.getRate('gold','24K');
  var profit = a.calcItemProfit(s.items[0]);
  assert(profit.mcCost === 0.04 * s.items[0].weight * g24,
         'real karigar cost must reach the final bill\'s profit calc, not revert to 0: ' + JSON.stringify(profit));
});
```
with:
```js
test('27 Oct, bug-pattern review (now stage-shaped): a karigar stage carried onto an order-derived custom line survives buildSaleObj(), not dropped on the floor', function(){
  var a = loadApp();
  a.UI.saleMode = 'custom';
  a.customSaleItems = [{ name:'Order necklace', cat:'Necklaces / Haar', metal:'gold', purity:'22K', grossWt:15, blackBeads:0, diamond:0, making:650, stoneCharges:0,
                          karigarStages:[{ task:'Gold work', karigarId:'kar1', karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }] }];
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ return /^csi-/.test(id) ? null : _o(id); };
  var s = a.buildSaleObj();
  assert(Array.isArray(s.items[0].karigarStages) && s.items[0].karigarStages.length === 1 && s.items[0].karigarStages[0].karigarWastagePct === 4,
    'karigarStages dropped by buildSaleObj(): ' + JSON.stringify(s.items[0]));
  assert(s.items[0].karigarStages[0].karigarRate > 0, 'buildSaleObj should lock a karigarRate on the stage');
  var profit = a.calcItemProfit(s.items[0]);
  assert(profit.mcCost === 0.04 * s.items[0].weight * s.items[0].karigarStages[0].karigarRate,
         'real karigar cost must reach the final bill\'s profit calc, not revert to 0: ' + JSON.stringify(profit));
});
```

Replace:
```js
test('27 Oct, Opus review #1: karigar cost reduces calcSaleProfit (dashboard/reports), not just the category table', function(){
  var a = loadApp();
  a.UI.saleMode = 'custom';
  a.customSaleItems = [{ name:'Order necklace', cat:'Rings', metal:'gold', purity:'22K', grossWt:15, blackBeads:0, diamond:0, making:650, stoneCharges:0,
                          karigarPayMode:'wastage', karigarCost:0, karigarWastagePct:4 }];
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ return /^csi-/.test(id) ? null : _o(id); };
  var sale = a.buildSaleObj();
  var withKarigar = a.calcSaleProfit(sale).profit;

  sale.items[0].karigarPayMode = ''; // same bill, karigar cost unset -> old behaviour
  var withoutKarigar = a.calcSaleProfit(sale).profit;

  var g24 = a.getRate('gold','24K');
  var expectedCost = 0.04 * sale.items[0].weight * g24;
  assert(approxEqual(withoutKarigar - withKarigar, expectedCost, 1),
    'karigar cost should reduce calcSaleProfit by exactly the wastage cost (' + expectedCost + '), got a difference of ' + (withoutKarigar - withKarigar));
});
```
with:
```js
test('27 Oct, Opus review #1 (now stage-shaped): karigar cost reduces calcSaleProfit (dashboard/reports), not just the category table', function(){
  var a = loadApp();
  a.UI.saleMode = 'custom';
  a.customSaleItems = [{ name:'Order necklace', cat:'Rings', metal:'gold', purity:'22K', grossWt:15, blackBeads:0, diamond:0, making:650, stoneCharges:0,
                          karigarStages:[{ task:'Gold work', karigarId:'kar1', karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }] }];
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ return /^csi-/.test(id) ? null : _o(id); };
  var sale = a.buildSaleObj();
  var withKarigar = a.calcSaleProfit(sale).profit;

  sale.items[0].karigarStages[0].status = 'assigned'; // same bill, stage not yet submitted -> old behaviour
  var withoutKarigar = a.calcSaleProfit(sale).profit;

  var rate = sale.items[0].karigarStages[0].karigarRate;
  var expectedCost = 0.04 * sale.items[0].weight * rate;
  assert(approxEqual(withoutKarigar - withKarigar, expectedCost, 1),
    'karigar cost should reduce calcSaleProfit by exactly the wastage cost (' + expectedCost + '), got a difference of ' + (withoutKarigar - withKarigar));
});
```

Replace:
```js
test('27 Oct, Opus review #2: wastage on a silver item is priced at the silver rate, not gold', function(){
  var a = loadApp();
  var sil = a.getRate('silver','22K'); // getRate ignores purity for silver -> same as S.rates.sil
  var g24 = a.getRate('gold','24K');
  assert(sil !== g24, 'test fixture should have different gold/silver rates to actually prove this');
  var silverCost = a.karigarCostOf({ karigarPayMode:'wastage', karigarWastagePct:4, metal:'silver', weight:20, qty:1 });
  assert(silverCost === 0.04 * 20 * sil, 'silver wastage must use the silver rate: expected ' + (0.04*20*sil) + ', got ' + silverCost);
  assert(silverCost !== 0.04 * 20 * g24, 'silver wastage must NOT be priced at the gold 24K rate');
});
```
with:
```js
test('27 Oct, Opus review #2 (now stage-shaped): wastage on a silver item is priced at the silver rate, not gold', function(){
  var a = loadApp();
  var sil = a.getRate('silver','22K');
  var g24 = a.getRate('gold','24K');
  assert(sil !== g24, 'test fixture should have different gold/silver rates to actually prove this');
  var silverCost = a.karigarCostOf({ metal:'silver', weight:20, qty:1, karigarStages:[{ karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }] });
  assert(silverCost === 0.04 * 20 * sil, 'silver wastage must use the silver rate: expected ' + (0.04*20*sil) + ', got ' + silverCost);
  assert(silverCost !== 0.04 * 20 * g24, 'silver wastage must NOT be priced at the gold 24K rate');
});
```

Replace:
```js
test('27 Oct, Opus review #3: karigar cost on a saved bill uses the rate locked at sale time, not today\'s rate', function(){
  var a = loadApp();
  a.UI.saleMode = 'custom';
  a.customSaleItems = [{ name:'Order necklace', cat:'Rings', metal:'gold', purity:'22K', grossWt:15, blackBeads:0, diamond:0, making:650, stoneCharges:0,
                          karigarPayMode:'wastage', karigarCost:0, karigarWastagePct:4 }];
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ return /^csi-/.test(id) ? null : _o(id); };
  var sale = a.buildSaleObj();
  var lockedRate = sale.items[0].karigarRate;
  assert(lockedRate > 0, 'buildSaleObj should lock a karigarRate on the sale item, got ' + lockedRate);

  var profitAtSaveTime = a.calcItemProfit(sale.items[0]).mcCost;
  a.S.rates.g24 = a.S.rates.g24 * 2; // the gold rate moves after this bill was already saved
  var profitLater = a.calcItemProfit(sale.items[0]).mcCost;
  assert(profitAtSaveTime === profitLater,
    'an already-saved bill\'s karigar cost must not drift when today\'s rate changes: was ' + profitAtSaveTime + ', now ' + profitLater);
});
```
with:
```js
test('27 Oct, Opus review #3 (now stage-shaped): karigar cost on a saved bill uses the rate locked at sale time, not today\'s rate', function(){
  var a = loadApp();
  a.UI.saleMode = 'custom';
  a.customSaleItems = [{ name:'Order necklace', cat:'Rings', metal:'gold', purity:'22K', grossWt:15, blackBeads:0, diamond:0, making:650, stoneCharges:0,
                          karigarStages:[{ task:'Gold work', karigarId:'kar1', karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }] }];
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ return /^csi-/.test(id) ? null : _o(id); };
  var sale = a.buildSaleObj();
  var lockedRate = sale.items[0].karigarStages[0].karigarRate;
  assert(lockedRate > 0, 'buildSaleObj should lock a karigarRate per stage, got ' + lockedRate);

  var profitAtSaveTime = a.calcItemProfit(sale.items[0]).mcCost;
  a.S.rates.g24 = a.S.rates.g24 * 2; // the gold rate moves after this bill was already saved
  var profitLater = a.calcItemProfit(sale.items[0]).mcCost;
  assert(profitAtSaveTime === profitLater,
    'an already-saved bill\'s karigar cost must not drift when today\'s rate changes: was ' + profitAtSaveTime + ', now ' + profitLater);
});
```

Also add one new test for multi-stage summing and the Review Focus items not yet covered by any existing test:

```js
test('karigarCostOf: sums across multiple stages on one item, mixed cash and wastage, skipping unsubmitted ones', function(){
  var a = loadApp();
  var g24 = a.getRate('gold','24K');
  var item = { metal:'gold', weight:10, qty:1, karigarStages:[
    { task:'Gold work',      karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' },
    { task:'Diamond setting', karigarPayMode:'cash', karigarCost:300, status:'submitted' },
    { task:'Polishing',      karigarPayMode:'cash', karigarCost:100, status:'assigned' } // not yet earned
  ]};
  var expected = 0.04*10*g24 + 300; // polishing's 100 excluded -- not submitted
  assert(a.karigarCostOf(item) === expected, 'expected ' + expected + ', got ' + a.karigarCostOf(item));
});

test('karigarCostOf: a stage with a pay mode but no amount typed costs 0 for that stage, not NaN', function(){
  var a = loadApp();
  var item = { metal:'gold', weight:10, qty:1, karigarStages:[{ task:'Gold work', karigarPayMode:'cash', status:'submitted' }] }; // karigarCost never set
  var result = a.karigarCostOf(item);
  assert(result === 0, 'blank cash amount should cost 0, got ' + result);
  assert(!isNaN(result), 'must never be NaN');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node tests/regression.test.js 2>&1 | grep -B1 "✗\|AssertionError" | head -60
```
Expected: every updated/new karigar test fails (fixtures now pass `karigarStages`, which `karigarCostOf()` doesn't read yet).

- [ ] **Step 3: Rewrite `karigarCostOf()`**

In `js/01-sync-core.js`, replace the current function:
```js
function karigarCostOf(item){
  var qty = parseInt(item.qty) || 1;
  if(item.karigarPayMode==='cash') return (parseFloat(item.karigarCost)||0) * qty;
  if(item.karigarPayMode==='wastage'){
    var wt = parseFloat(item.weight||item.estWt||item.orderWt) || 0;
    // karigarRate is locked at bill time (buildSaleObj, same convention as
    // lockedRate) so an old bill's profit doesn't move every time today's
    // rate changes; the live order estimate has no locked rate yet, so it
    // reads the current one. metal-aware: a silver order wastes silver, not
    // gold (Opus review, 27 Oct -- this used to hardcode 'gold' for every metal).
    var rate = item.karigarRate || getRate(item.metal||'gold','24K');
    return (parseFloat(item.karigarWastagePct)||0)/100 * wt * qty * rate;
  }
  return 0;
}
```
with:
```js
// Karigar Management (27 Oct): a single karigar per item couldn't express a
// piece passing through a chain (necklace karigar, then a separate
// diamond-setter) -- karigarStages replaces the single flat
// karigarPayMode/karigarCost/karigarWastagePct fields this same function
// used to read directly. Only a SUBMITTED stage has actually been earned;
// an assigned-but-unfinished stage costs nothing yet.
function karigarCostOf(item){
  var qty = parseInt(item.qty) || 1;
  var wt  = parseFloat(item.weight||item.estWt||item.orderWt) || 0;
  return (item.karigarStages||[]).reduce(function(sum, stage){
    if(stage.status !== 'submitted') return sum;
    if(stage.karigarPayMode === 'cash') return sum + (parseFloat(stage.karigarCost)||0) * qty;
    if(stage.karigarPayMode === 'wastage'){
      // karigarRate is locked at bill time (buildSaleObj, same convention as
      // lockedRate) so an old bill's profit doesn't move every time today's
      // rate changes; the live order estimate has no locked rate yet, so it
      // reads the current one. Read from the ITEM's metal, never the stage --
      // all stages on one item share one physical piece's metal.
      var rate = stage.karigarRate || getRate(item.metal||'gold','24K');
      return sum + (parseFloat(stage.karigarWastagePct)||0)/100 * wt * qty * rate;
    }
    return sum;
  }, 0);
}
```

- [ ] **Step 4: Update the `ordItems` default-object literals**

In `js/03-billing-numbers.js`, there are 3 occurrences of the default order-item literal (added earlier today via `replace_all`). Find each:
```js
making:0,makingType:'flat',karigarPayMode:'',karigarCost:0,karigarWastagePct:0,qty:1,note:''
```
and replace with:
```js
making:0,makingType:'flat',karigarStages:[],qty:1,note:''
```
(3 occurrences in this file — use a find-and-replace-all across the file, not a single edit, since the string is identical at all 3 sites).

In `js/04-orders-detail.js`, the same literal appears once (also added earlier today):
```js
making:0,makingType:'flat',karigarPayMode:'',karigarCost:0,karigarWastagePct:0,qty:1,note:''
```
replace with:
```js
making:0,makingType:'flat',karigarStages:[],qty:1,note:''
```

- [ ] **Step 5: Update `convertToSale()` in `js/04-orders-detail.js`**

Find:
```js
        for(var p=0; p<pieces; p++){
          lines.push({name:it.desc||'Custom item', cat:it.cat||'', metal:metal, purity:purity,
                      grossWt:wt, blackBeads:0, diamond:0,
                      making:perGram, stoneCharges:0,
                      // Carried straight through, same per-piece convention as
                      // `making` above — karigarCostOf() (01-sync-core.js)
                      // reads these on the final bill the same way
                      // orderProfitEst() already did on the order estimate.
                      karigarPayMode:it.karigarPayMode, karigarCost:it.karigarCost,
                      karigarWastagePct:it.karigarWastagePct});
        }
```
replace with:
```js
        for(var p=0; p<pieces; p++){
          lines.push({name:it.desc||'Custom item', cat:it.cat||'', metal:metal, purity:purity,
                      grossWt:wt, blackBeads:0, diamond:0,
                      making:perGram, stoneCharges:0,
                      // Carried straight through, same per-piece convention as
                      // `making` above — karigarCostOf() (01-sync-core.js)
                      // reads this array on the final bill the same way
                      // orderProfitEst() already did on the order estimate.
                      karigarStages:(it.karigarStages||[]).slice()});
        }
```
(`.slice()` copies the array so each of the `pieces` split lines gets its own array reference, not all `pieces` lines sharing and mutating the same one later.)

- [ ] **Step 6: Update `buildSaleObj()` in `js/02-ui-inactivity-modals.js`**

Find:
```js
      var lockedRate=getRate(item.metal||'gold',item.purity||'22K');
      // makingBasis records what this bill was actually charged on, so the
      // figures stay reproducible if the shop's basis ever changes again.
      return{pid:null,name:item.name,qty:1,grossWeight:parseFloat(item.grossWt)||0,blackBeads:parseFloat(item.blackBeads)||0,diamondWt:parseFloat(item.diamond)||0,weight:net,purity:item.purity||'22K',metal:item.metal||'gold',making:parseFloat(item.making)||0,makingBasis:'gross',diamond:parseFloat(item.stoneCharges)||0,huid:'',isCustom:true,lockedRate:lockedRate,cat:item.cat||'',
             // Carried from convertToSale()'s customSaleItems line if this came
             // from an order — buildSaleObj() re-derives everything else above
             // from DOM inputs, which silently dropped these three on the floor.
             karigarPayMode:item.karigarPayMode,karigarCost:parseFloat(item.karigarCost)||0,karigarWastagePct:parseFloat(item.karigarWastagePct)||0,
             // Locked the same way lockedRate is, two lines up -- karigarCostOf()
             // (01-sync-core.js) prefers this over the live rate so a bill's
             // profit doesn't drift every time today's gold/silver rate changes.
             karigarRate:getRate(item.metal||'gold','24K')};
```
replace with:
```js
      var lockedRate=getRate(item.metal||'gold',item.purity||'22K');
      var k24Rate=getRate(item.metal||'gold','24K');
      // Each stage locks its own karigarRate the same way lockedRate is
      // locked, one line up -- karigarCostOf() (01-sync-core.js) prefers this
      // over the live rate so a bill's profit doesn't drift every time
      // today's gold/silver rate changes.
      var lockedStages=(item.karigarStages||[]).map(function(st){
        return {task:st.task||'', karigarId:st.karigarId, karigarPayMode:st.karigarPayMode,
                karigarCost:parseFloat(st.karigarCost)||0, karigarWastagePct:parseFloat(st.karigarWastagePct)||0,
                status:st.status||'', assignedDate:st.assignedDate||'', submittedDate:st.submittedDate||'',
                karigarRate:k24Rate};
      });
      // makingBasis records what this bill was actually charged on, so the
      // figures stay reproducible if the shop's basis ever changes again.
      return{pid:null,name:item.name,qty:1,grossWeight:parseFloat(item.grossWt)||0,blackBeads:parseFloat(item.blackBeads)||0,diamondWt:parseFloat(item.diamond)||0,weight:net,purity:item.purity||'22K',metal:item.metal||'gold',making:parseFloat(item.making)||0,makingBasis:'gross',diamond:parseFloat(item.stoneCharges)||0,huid:'',isCustom:true,lockedRate:lockedRate,cat:item.cat||'',
             // Carried from convertToSale()'s customSaleItems line if this came
             // from an order — buildSaleObj() re-derives everything else above
             // from DOM inputs, which silently dropped these on the floor once
             // already (27 Oct), fixed here for the stage-array shape from the start.
             karigarStages:lockedStages};
```

- [ ] **Step 7: Run the full suite**

```bash
node --check js/01-sync-core.js && node --check js/02-ui-inactivity-modals.js && node --check js/03-billing-numbers.js && node --check js/04-orders-detail.js
node tests/regression.test.js 2>&1 | tail -10
cd checks && node backup-check.js .. && node roundtrip.js .. && cd ..
```
Expected: all `node --check` clean, regression suite `0 failed`, both checks clean.

- [ ] **Step 8: Commit**

```bash
git add js/01-sync-core.js js/02-ui-inactivity-modals.js js/03-billing-numbers.js js/04-orders-detail.js tests/regression.test.js
git commit -m "Replace single-karigar flat fields with karigarStages array (supports a chain of karigars per item)"
```

---

## Task 4: Order item form — repeatable stage list

Replaces the single "Karigar Payment" row built earlier today with a repeatable list, same add/remove interaction already used for order items themselves (`addOrdItem`/`removeOrdItem`), one level deeper.

**Files:**
- Modify: `js/03-billing-numbers.js` (`buildOrdItemRow()`)

**Interfaces:**
- Consumes: `addOrGetKarigar(name)` (Task 2), `ordItems[i].karigarStages` (Task 3), `calcOrdEst()` (existing, unchanged signature).
- Produces: nothing new consumed elsewhere — this is a leaf UI task.

- [ ] **Step 1: Replace the single karigar-payment block**

In `js/03-billing-numbers.js`, find the block starting `// Row 4b: Karigar payment` (currently lines ~1442-1469) and replace it entirely with:

```js
  // Row 4b: Karigar stages (27 Oct, Karigar Management) -- a repeatable
  // chain of tasks/karigars per item (e.g. gold work, then diamond setting),
  // same add/remove interaction as addOrdItem/removeOrdItem one level up.
  // Sequential only: the FIRST stage with status !== 'submitted' is the
  // active one; marking it submitted (order detail view, a later task)
  // simply makes the next stage first-unsubmitted.
  var stagesWrap=document.createElement('div'); stagesWrap.className='fg'; stagesWrap.style.gridColumn='1 / -1';
  stagesWrap.innerHTML='<label>Karigar Stages</label>';
  var stagesList=document.createElement('div'); stagesList.id='oi-stages-'+i; stagesList.style.cssText='display:flex;flex-direction:column;gap:6px;';
  function _renderStages(){
    stagesList.innerHTML='';
    (item.karigarStages||[]).forEach(function(stage, si){
      var row=document.createElement('div'); row.style.cssText='display:flex;gap:6px;align-items:center;border:1px dashed var(--border-gold,#b39257);border-radius:8px;padding:6px 8px;';
      var taskI=document.createElement('input'); taskI.type='text'; taskI.placeholder='Task (e.g. Gold work)';
      taskI.value=stage.task||''; taskI.style.flex='1';
      (function(idx){taskI.oninput=function(){ordItems[i].karigarStages[idx].task=this.value;};})(si);
      var karI=document.createElement('input'); karI.type='text'; karI.placeholder='Karigar name';
      karI.value=(findKarigar(stage.karigarId)||{}).name||''; karI.style.flex='1';
      (function(idx){karI.onchange=function(){ordItems[i].karigarStages[idx].karigarId=addOrGetKarigar(this.value).id;};})(si);
      var modeSel=document.createElement('select'); modeSel.style.cssText='width:auto;padding:9px 28px 9px 8px;font-size:12px;';
      [['','Not set'],['cash','Cash ₹'],['wastage','Wastage %']].forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];if(o[0]===(stage.karigarPayMode||''))op.selected=true;modeSel.appendChild(op);});
      var cashI=document.createElement('input'); cashI.type='text'; cashI.setAttribute('inputmode','decimal');
      cashI.placeholder='₹ per piece'; cashI.value=stage.karigarCost>0?stage.karigarCost:''; cashI.style.cssText='width:80px;display:'+(stage.karigarPayMode==='cash'?'':'none');
      var wastI=document.createElement('input'); wastI.type='text'; wastI.setAttribute('inputmode','decimal');
      wastI.placeholder='% of weight'; wastI.value=stage.karigarWastagePct>0?stage.karigarWastagePct:''; wastI.style.cssText='width:80px;display:'+(stage.karigarPayMode==='wastage'?'':'none');
      (function(idx){modeSel.onchange=function(){
        ordItems[i].karigarStages[idx].karigarPayMode=this.value;
        cashI.style.display=this.value==='cash'?'':'none';
        wastI.style.display=this.value==='wastage'?'':'none';
        calcOrdEst();
      };})(si);
      (function(idx){cashI.oninput=function(){ordItems[i].karigarStages[idx].karigarCost=parseFloat(this.value)||0;calcOrdEst();};})(si);
      (function(idx){wastI.oninput=function(){
        ordItems[i].karigarStages[idx].karigarWastagePct=parseFloat(this.value)||0;
        var v=parseFloat(this.value)||0;
        wastI.style.borderColor=(v>0&&(v<2||v>12))?'var(--warning)':'';
        calcOrdEst();
      };})(si);
      var rmBtn=document.createElement('button'); rmBtn.type='button'; rmBtn.className='btn btn-sm btn-danger'; rmBtn.textContent='×';
      (function(idx){rmBtn.onclick=function(){ordItems[i].karigarStages.splice(idx,1);_renderStages();};})(si);
      row.appendChild(taskI); row.appendChild(karI); row.appendChild(modeSel); row.appendChild(cashI); row.appendChild(wastI); row.appendChild(rmBtn);
      stagesList.appendChild(row);
    });
  }
  _renderStages();
  var addStageBtn=document.createElement('button'); addStageBtn.type='button'; addStageBtn.className='btn btn-sm';
  addStageBtn.textContent='+ Add Karigar Stage';
  addStageBtn.onclick=function(){
    ordItems[i].karigarStages = ordItems[i].karigarStages || [];
    ordItems[i].karigarStages.push({task:'', karigarId:'', karigarPayMode:'', karigarCost:0, karigarWastagePct:0, status:'assigned', assignedDate:dbDayKey(new Date())});
    _renderStages();
  };
  stagesWrap.appendChild(stagesList); stagesWrap.appendChild(addStageBtn); g.appendChild(stagesWrap);
  // Row 5: Qty + Note
```

- [ ] **Step 2: Verify**

```bash
node --check js/03-billing-numbers.js
node tests/regression.test.js 2>&1 | tail -5
```
Expected: syntax clean, regression suite unaffected (this task touches only DOM-building code the suite's VM harness doesn't exercise — DOM behavior needs a manual pass, not a new automated assertion, same as every other `buildOrdItemRow` field in this codebase per CLAUDE.md's own testing caveat).

- [ ] **Step 3: Manual verification**

Follow `skills/verify-ui.md` — open the Orders tab, add a new order, add an item, click "+ Add Karigar Stage" twice, confirm: both stage rows render with independent task/karigar/mode/amount fields, switching a stage's mode toggles the right amount input, removing one stage leaves the other's data untouched, typing a new karigar name and tabbing away creates it (check `S.karigars` in devtools).

- [ ] **Step 4: Commit**

```bash
git add js/03-billing-numbers.js
git commit -m "Order item form: repeatable karigar-stage list replaces the single karigar-payment row"
```

---

## Task 5: "Mark Submitted" on the active stage

**Files:**
- Modify: `js/04-orders-detail.js` (new function + a button in the order detail view's item rendering)
- Test: `tests/regression.test.js`

**Interfaces:**
- Consumes: `S.orders`, `saveToCloud()` (existing).
- Produces: `markStageSubmitted(ordId, itemIdx)` — finds the first non-submitted stage on that order item, sets its `status` to `'submitted'` and `submittedDate` to today, saves. No-ops (returns `false`) if the item has no stages or all are already submitted.

- [ ] **Step 1: Write the failing tests**

```js
test('markStageSubmitted: submits the first unsubmitted stage, leaves later stages untouched', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  a.S.orders = [{ id:'o1', items:[{ karigarStages:[
    { task:'Gold work', status:'submitted', submittedDate:'2026-10-20' },
    { task:'Diamond setting', status:'assigned' },
    { task:'Polishing', status:'assigned' }
  ]}]}];
  var ok = a.markStageSubmitted('o1', 0);
  assert(ok === true, 'should report success');
  var stages = a.S.orders[0].items[0].karigarStages;
  assert(stages[0].status === 'submitted' && stages[0].submittedDate === '2026-10-20', 'already-submitted first stage must stay untouched');
  assert(stages[1].status === 'submitted' && !!stages[1].submittedDate, 'the first UNSUBMITTED stage (Diamond setting) should now be submitted');
  assert(stages[2].status === 'assigned', 'the stage after the one just submitted must stay assigned');
  assert(saved === 1, 'should persist the change');
});

test('markStageSubmitted: no-ops when every stage is already submitted, or there are no stages', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  a.S.orders = [
    { id:'o1', items:[{ karigarStages:[{ status:'submitted' }] }] },
    { id:'o2', items:[{ karigarStages:[] }] },
    { id:'o3', items:[{}] }
  ];
  assert(a.markStageSubmitted('o1', 0) === false, 'all stages already submitted -> no-op');
  assert(a.markStageSubmitted('o2', 0) === false, 'empty stages array -> no-op');
  assert(a.markStageSubmitted('o3', 0) === false, 'no karigarStages field at all -> no-op, not a throw');
  assert(a.markStageSubmitted('does-not-exist', 0) === false, 'unknown order id -> no-op, not a throw');
  assert(saved === 0, 'none of the no-op cases should trigger a save');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node tests/regression.test.js 2>&1 | grep -A2 "markStageSubmitted"
```
Expected: `a.markStageSubmitted is not a function`.

- [ ] **Step 3: Implement**

In `js/04-orders-detail.js`, near `convertToSale()` (same file, same domain), add:

```js
// Karigar Management (27 Oct): submits the FIRST stage that isn't already
// submitted -- sequential only, so this is always the one currently "with"
// a karigar. Returns false (no save triggered) when there's nothing to
// submit, rather than silently no-op-ing a save call.
function markStageSubmitted(ordId, itemIdx){
  var o = (S.orders||[]).find(function(x){ return x.id===ordId; });
  if(!o || !o.items || !o.items[itemIdx]) return false;
  var stages = o.items[itemIdx].karigarStages;
  if(!stages || !stages.length) return false;
  var stage = stages.find(function(s){ return s.status !== 'submitted'; });
  if(!stage) return false;
  stage.status = 'submitted';
  stage.submittedDate = dbDayKey(new Date());
  saveToCloud(function(){});
  return true;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
node --check js/04-orders-detail.js
node tests/regression.test.js 2>&1 | grep -A2 "markStageSubmitted"
```
Expected: both tests `✓`.

- [ ] **Step 5: Wire a "Mark Submitted" button into the order detail view**

This is `showOrderDetail(ordId)` in `js/04-orders-detail.js:1` — the interactive on-screen modal (not `generateOrderReceipt()`, which is the print view and must stay customer-facing only, no internal karigar cost/status ever printed there). The item loop is `o.items.forEach(function(item,n){...})` at `js/04-orders-detail.js:36`.

Find:
```js
          '<div style="text-align:right;font-size:12px;color:var(--text3);">'+
            (item.orderWt?'<div>Order: <strong>'+fmtW(item.orderWt)+'</strong></div>':'')+
            (item.estWt?'<div>Est: <strong style="color:var(--gold-dark);">'+fmtW(item.estWt)+'</strong></div>':'')+
            (item.making?'<div>Making: '+makingDisplay+'</div>':'')+
          '</div>'+
        '</div>'+
        (item.note?'<div style="font-size:11px;color:var(--text3);margin-top:4px;font-style:italic;">'+escHtml(item.note)+'</div>':'');
```
replace with:
```js
          '<div style="text-align:right;font-size:12px;color:var(--text3);">'+
            (item.orderWt?'<div>Order: <strong>'+fmtW(item.orderWt)+'</strong></div>':'')+
            (item.estWt?'<div>Est: <strong style="color:var(--gold-dark);">'+fmtW(item.estWt)+'</strong></div>':'')+
            (item.making?'<div>Making: '+makingDisplay+'</div>':'')+
          '</div>'+
        '</div>'+
        (item.note?'<div style="font-size:11px;color:var(--text3);margin-top:4px;font-style:italic;">'+escHtml(item.note)+'</div>':'')+
        // Karigar Management (27 Oct): the active stage is the first one not
        // yet submitted -- sequential only, so there's always at most one
        // button live per item.
        ((item.karigarStages||[]).some(function(s){return s.status!=='submitted';})
          ? '<div style="margin-top:6px;">'+
              '<span style="font-size:11px;color:var(--text3);">Active: '+escHtml((item.karigarStages.filter(function(s){return s.status!=='submitted';})[0]||{}).task||'Unassigned task')+'</span> '+
              '<button class="btn btn-sm" onclick="markStageSubmitted(\''+jsAttrEsc(o.id)+'\','+n+');showOrderDetail(\''+jsAttrEsc(o.id)+'\');">Mark Submitted</button>'+
            '</div>'
          : '');
```
(`o` and `n` are already in scope here — `o` from `showOrderDetail`'s own top-level `var o=S.orders.find(...)` at line 2, `n` from the enclosing `o.items.forEach(function(item,n){...})` at line 36.)

- [ ] **Step 6: Verify and commit**

```bash
node --check js/04-orders-detail.js
node tests/regression.test.js 2>&1 | tail -5
```
Manual check per `skills/verify-ui.md`: open an order with a multi-stage item, click "Mark Submitted," confirm the button now targets the next stage and the previous one shows a submitted date.

```bash
git add js/04-orders-detail.js tests/regression.test.js
git commit -m "Add markStageSubmitted() and a Mark Submitted action in the order detail view"
```

---

## Task 6: Derived karigar views + payment recording

**Files:**
- Modify: `js/01-sync-core.js` (new functions, near `calcSaleProfit`/the other Financial Engine functions)
- Test: `tests/regression.test.js`

**Interfaces:**
- Consumes: `S.orders`, `S.sales`, `S.karigarPayments`, `karigarCostOf(item)` (Task 3's rewritten version — but these functions need the PER-STAGE cost, not the item total, since a multi-karigar item's cost must be attributed to the right karigar; see Step 3's helper).
- Produces:
  - `karigarStageCost(item, stage)` — the ₹/grams cost of one specific stage (factored out of `karigarCostOf` so both can share it without duplicating the cash/wastage math).
  - `karigarOwed(karigarId)` — returns `{cash, gold, silver}` still owed (submitted work minus recorded payments), all three always present (0 when none).
  - `karigarStats(karigarId, monthKey)` — `monthKey` optional (`'2026-10'` format); returns `{piecesSubmitted, cash, gold, silver}` for that month, or lifetime when omitted.
  - `karigarQueue(karigarId)` — array of `{orderId, ordNo, itemName, task, assignedDate}` for every currently-assigned (not yet submitted) stage across `S.orders`.
  - `recordKarigarPayment(karigarId, type, amount, note)` — appends to `S.karigarPayments`, saves.

- [ ] **Step 1: Write the failing tests**

```js
test('karigarStageCost: factors the per-stage cash/wastage math out of karigarCostOf without changing its total', function(){
  var a = loadApp();
  var g24 = a.getRate('gold','24K');
  var item = { metal:'gold', weight:10, qty:2, karigarStages:[
    { karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' },
    { karigarPayMode:'cash', karigarCost:50, status:'submitted' }
  ]};
  var stage0Cost = a.karigarStageCost(item, item.karigarStages[0]);
  var stage1Cost = a.karigarStageCost(item, item.karigarStages[1]);
  assert(stage0Cost === 0.04*10*2*g24, 'wastage stage cost: ' + stage0Cost);
  assert(stage1Cost === 100, 'cash stage cost (50 x qty 2): ' + stage1Cost);
  assert(a.karigarCostOf(item) === stage0Cost + stage1Cost, 'karigarCostOf total must still equal the sum of per-stage costs');
});

test('karigarOwed: sums submitted-stage cost across orders and sales, nets against recorded payments, per unit', function(){
  var a = loadApp();
  var g24 = a.getRate('gold','24K');
  var k = a.addOrGetKarigar('Ramesh');
  a.S.orders = [{ id:'o1', items:[{ metal:'gold', weight:10, qty:1, karigarStages:[
    { karigarId:k.id, karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }
  ]}]}];
  a.S.sales = [{ items:[{ metal:'gold', weight:5, qty:1, karigarStages:[
    { karigarId:k.id, karigarPayMode:'cash', karigarCost:300, status:'submitted' },
    { karigarId:k.id, karigarPayMode:'cash', karigarCost:999, status:'assigned' } // not yet earned
  ]}]}];
  a.S.karigarPayments = [{ karigarId:k.id, type:'cash', amount:100 }];

  var owed = a.karigarOwed(k.id);
  assert(owed.gold === 0.04*10*g24, 'gold owed: ' + JSON.stringify(owed));
  assert(owed.silver === 0, 'no silver work recorded -> 0, not undefined');
  assert(owed.cash === 200, 'cash owed should be 300 earned minus 100 paid: ' + JSON.stringify(owed));
});

test('karigarOwed: a karigar with submitted work and no payments ever recorded owes the full amount, not a throw', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  a.S.orders = [{ id:'o1', items:[{ metal:'gold', weight:10, qty:1, karigarStages:[
    { karigarId:k.id, karigarPayMode:'cash', karigarCost:500, status:'submitted' }
  ]}]}];
  a.S.karigarPayments = []; // nobody has ever been paid
  var owed = a.karigarOwed(k.id);
  assert(owed.cash === 500, 'full amount owed with no payment history: ' + JSON.stringify(owed));
});

test('karigarQueue: lists every currently-assigned (not yet submitted) stage for a karigar, across orders', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  a.S.orders = [
    { id:'o1', ordNo:'ORD-1', items:[{ desc:'Necklace', karigarStages:[{ karigarId:k.id, task:'Gold work', status:'assigned', assignedDate:'2026-10-27' }] }] },
    { id:'o2', ordNo:'ORD-2', items:[{ desc:'Ring', karigarStages:[{ karigarId:k.id, task:'Gold work', status:'submitted' }] }] } // already done -> not in queue
  ];
  var queue = a.karigarQueue(k.id);
  assert(queue.length === 1, 'only the unsubmitted stage should appear: ' + JSON.stringify(queue));
  assert(queue[0].ordNo === 'ORD-1' && queue[0].itemName === 'Necklace' && queue[0].task === 'Gold work', 'wrong queue entry: ' + JSON.stringify(queue[0]));
});

test('recordKarigarPayment: appends to S.karigarPayments and persists', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  var k = a.addOrGetKarigar('Ramesh');
  a.recordKarigarPayment(k.id, 'cash', 500, 'advance');
  assert(a.S.karigarPayments.length === 1, 'should append one payment');
  assert(a.S.karigarPayments[0].karigarId === k.id && a.S.karigarPayments[0].amount === 500 && a.S.karigarPayments[0].type === 'cash', 'payment fields wrong: ' + JSON.stringify(a.S.karigarPayments[0]));
  assert(saved === 1, 'should persist');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node tests/regression.test.js 2>&1 | grep -B1 "✗"
```

- [ ] **Step 3: Implement**

First, replace Task 3's `karigarCostOf()` with a version that delegates its per-stage math to a new `karigarStageCost()` — otherwise this task would leave two separate implementations of the same cash/wastage formula that could drift apart. In `js/01-sync-core.js`, replace:
```js
function karigarCostOf(item){
  var qty = parseInt(item.qty) || 1;
  var wt  = parseFloat(item.weight||item.estWt||item.orderWt) || 0;
  return (item.karigarStages||[]).reduce(function(sum, stage){
    if(stage.status !== 'submitted') return sum;
    if(stage.karigarPayMode === 'cash') return sum + (parseFloat(stage.karigarCost)||0) * qty;
    if(stage.karigarPayMode === 'wastage'){
      // karigarRate is locked at bill time (buildSaleObj, same convention as
      // lockedRate) so an old bill's profit doesn't move every time today's
      // rate changes; the live order estimate has no locked rate yet, so it
      // reads the current one. Read from the ITEM's metal, never the stage --
      // all stages on one item share one physical piece's metal.
      var rate = stage.karigarRate || getRate(item.metal||'gold','24K');
      return sum + (parseFloat(stage.karigarWastagePct)||0)/100 * wt * qty * rate;
    }
    return sum;
  }, 0);
}
```
with:
```js
function karigarCostOf(item){
  return (item.karigarStages||[]).reduce(function(sum, stage){ return sum + karigarStageCost(item, stage); }, 0);
}
```

Then, near `calcSaleProfit`, add both `karigarStageCost()` (the one place the actual cash/wastage formula now lives) and the rest of the derived views:

```js
// ── KARIGAR MANAGEMENT — derived views ───────────────────────────────
// Nothing here is stored pre-computed; every view is scanned fresh from
// S.orders/S.sales/S.karigarPayments on read, same reasoning as why
// Suppliers' ledger (09-purchases.js pbSupplierLedgerHtml) is derived from
// purchase bills rather than kept as a separate running total that could
// drift out of sync.

// The one place the per-stage cash/wastage formula lives -- karigarCostOf()
// (above) sums this across an item's stages for the profit engine;
// karigarOwed/karigarStats attribute it to a SPECIFIC karigar below.
function karigarStageCost(item, stage){
  if(stage.status !== 'submitted') return 0;
  var qty = parseInt(item.qty) || 1;
  var wt  = parseFloat(item.weight||item.estWt||item.orderWt) || 0;
  if(stage.karigarPayMode === 'cash') return (parseFloat(stage.karigarCost)||0) * qty;
  if(stage.karigarPayMode === 'wastage'){
    // karigarRate is locked at bill time (buildSaleObj, same convention as
    // lockedRate) so an old bill's profit doesn't move every time today's
    // rate changes; the live order estimate has no locked rate yet, so it
    // reads the current one. Read from the ITEM's metal, never the stage --
    // all stages on one item share one physical piece's metal.
    var rate = stage.karigarRate || getRate(item.metal||'gold','24K');
    return (parseFloat(stage.karigarWastagePct)||0)/100 * wt * qty * rate;
  }
  return 0;
}

// Every item carrying at least one karigarStages entry, across both S.orders
// (pre-sale) and S.sales (post-sale) -- a stage doesn't stop counting once
// the order becomes a bill, since that's how the karigar actually gets paid.
function _allKarigarStageEntries(){
  var out = [];
  (S.orders||[]).concat(S.sales||[]).forEach(function(rec){
    (rec.items||[]).forEach(function(item){
      (item.karigarStages||[]).forEach(function(stage){
        out.push({ item:item, stage:stage, ordNo:rec.ordNo, orderId:rec.id, itemName:item.desc||item.name||'' });
      });
    });
  });
  return out;
}

function karigarOwed(karigarId){
  var totals = { cash:0, gold:0, silver:0 };
  _allKarigarStageEntries().forEach(function(e){
    if(e.stage.karigarId !== karigarId) return;
    var cost = karigarStageCost(e.item, e.stage);
    if(cost <= 0) return;
    if(e.stage.karigarPayMode === 'cash') totals.cash += cost;
    else if(e.stage.karigarPayMode === 'wastage'){
      var metal = e.item.metal || 'gold';
      if(metal === 'silver') totals.silver += cost; else totals.gold += cost;
    }
  });
  (S.karigarPayments||[]).forEach(function(p){
    if(p.karigarId !== karigarId) return;
    if(p.type === 'cash')   totals.cash   -= (parseFloat(p.amount)||0);
    if(p.type === 'gold')   totals.gold   -= (parseFloat(p.amount)||0);
    if(p.type === 'silver') totals.silver -= (parseFloat(p.amount)||0);
  });
  return totals;
}

function karigarStats(karigarId, monthKey){
  var out = { piecesSubmitted:0, cash:0, gold:0, silver:0 };
  _allKarigarStageEntries().forEach(function(e){
    if(e.stage.karigarId !== karigarId) return;
    if(e.stage.status !== 'submitted') return;
    if(monthKey && (e.stage.submittedDate||'').slice(0,7) !== monthKey) return;
    var cost = karigarStageCost(e.item, e.stage);
    out.piecesSubmitted++;
    if(e.stage.karigarPayMode === 'cash') out.cash += cost;
    else if(e.stage.karigarPayMode === 'wastage'){
      var metal = e.item.metal || 'gold';
      if(metal === 'silver') out.silver += cost; else out.gold += cost;
    }
  });
  return out;
}

function karigarQueue(karigarId){
  return _allKarigarStageEntries()
    .filter(function(e){ return e.stage.karigarId === karigarId && e.stage.status !== 'submitted'; })
    .map(function(e){ return { orderId:e.orderId, ordNo:e.ordNo, itemName:e.itemName, task:e.stage.task||'', assignedDate:e.stage.assignedDate||'' }; });
}

function recordKarigarPayment(karigarId, type, amount, note){
  S.karigarPayments = S.karigarPayments || [];
  S.karigarPayments.push({ id:'kp'+Date.now()+Math.floor(Math.random()*1000), karigarId:karigarId, date:dbDayKey(new Date()), type:type, amount:parseFloat(amount)||0, note:note||'' });
  saveToCloud(function(){});
}
```

- [ ] **Step 4: Run to verify pass**

```bash
node --check js/01-sync-core.js
node tests/regression.test.js 2>&1 | tail -10
cd checks && node backup-check.js .. && node roundtrip.js .. && cd ..
```
Expected: all pass, both checks clean.

- [ ] **Step 5: Commit**

```bash
git add js/01-sync-core.js tests/regression.test.js
git commit -m "Add derived karigar views (owed balance, monthly/lifetime stats, queue) and payment recording"
```

---

## Task 7: Karigar list/detail UI (Settings)

**Files:**
- Modify: `js/05-auth-login.js` (new rendering function, placed near `renderSettings()` which actually owns the Settings panel — the CLAUDE.md file table's "settings panel" row points here, not `07-settings-plans.js`; confirmed by reading `renderSettings()` directly rather than assuming from the table)
- Modify: `index.html` (new card markup)

**Interfaces:**
- Consumes: `S.karigars`, `karigarOwed(karigarId)`, `karigarStats(karigarId, monthKey)`, `karigarQueue(karigarId)`, `recordKarigarPayment(karigarId, type, amount, note)` (all Task 6).
- Produces: nothing new consumed elsewhere — leaf UI task, same tier as Task 4.

- [ ] **Step 1: Implement the list renderer**

In `js/05-auth-login.js`, near `renderSettings()` (line 955), add:

```js
// Karigar Management (27 Oct): one card per karigar, same derived-not-stored
// principle as pbSupplierLedgerHtml (09-purchases.js) -- nothing here is
// kept pre-computed, karigarOwed/karigarStats/karigarQueue scan the real
// records fresh every render.
function renderKarigarList(){
  var wrap = document.getElementById('karigar-list');
  if(!wrap) return;
  var monthKey = dbDayKey(new Date()).slice(0,7);
  var cards = (S.karigars||[]).map(function(k){
    var owed = karigarOwed(k.id);
    var month = karigarStats(k.id, monthKey);
    var life = karigarStats(k.id);
    var queue = karigarQueue(k.id);
    return '<div class="card" style="margin-bottom:12px;">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;">'+
        '<strong>'+escHtml(k.name)+'</strong>'+
        '<span style="font-size:12px;color:var(--text3);">'+queue.length+' in progress</span>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px;font-size:13px;">'+
        '<div>This month: <b>'+month.piecesSubmitted+'</b> pieces, '+fmt(month.cash)+' cash, '+month.gold.toFixed(2)+'g gold, '+month.silver.toFixed(2)+'g silver</div>'+
        '<div>Lifetime: <b>'+life.piecesSubmitted+'</b> pieces, '+fmt(life.cash)+' cash, '+life.gold.toFixed(2)+'g gold, '+life.silver.toFixed(2)+'g silver</div>'+
        '<div style="color:'+(owed.cash>0?'var(--danger)':'var(--text2)')+';">Owed cash: '+fmt(owed.cash)+'</div>'+
        '<div style="color:'+((owed.gold>0||owed.silver>0)?'var(--danger)':'var(--text2)')+';">Owed gold: '+owed.gold.toFixed(2)+'g · silver: '+owed.silver.toFixed(2)+'g</div>'+
      '</div>'+
      '<button class="btn btn-sm" style="margin-top:8px;" onclick="promptKarigarPayment(\''+jsAttrEsc(k.id)+'\')">Record Payment</button>'+
    '</div>';
  }).join('') || '<div style="color:var(--text3);padding:12px;">No karigars yet — add one from an order item\'s Karigar Stages.</div>';
  wrap.innerHTML = cards;
}

// A minimal prompt-based entry point for v1 -- a full modal form is a later
// polish pass, not required for the core workflow (assign -> submit -> see
// balance -> settle) this task exists to close.
function promptKarigarPayment(karigarId){
  var type = prompt('Payment type: cash, gold, or silver?', 'cash');
  if(!type || ['cash','gold','silver'].indexOf(type)===-1){ toast('Cancelled — type must be cash, gold, or silver'); return; }
  var amount = parseFloat(prompt(type==='cash' ? 'Amount paid (₹)?' : 'Weight handed over (grams)?'));
  if(!(amount > 0)){ toast('Cancelled — enter a positive amount'); return; }
  var note = prompt('Note (optional):','') || '';
  recordKarigarPayment(karigarId, type, amount, note);
  renderKarigarList();
  toast('✓ Payment recorded');
}
```

- [ ] **Step 2: Add the container and wire it into `renderSettings()`**

In `index.html`, find the Settings panel's existing cards (e.g. the staff list card, whose container is `#set-staff-list` per `renderSettings()` read in Task 7's Files note above) and add a sibling card:
```html
<div class="card">
  <div class="card-title">Karigars</div>
  <div id="karigar-list"></div>
</div>
```

In `js/05-auth-login.js`, `renderSettings()` already follows a `getElementById('set-XXX'); if(el){...}` pattern per field/section (see the staff-list block at line 971-985) — `renderKarigarList()` does its own `getElementById('karigar-list')` null-guard internally, so the only change needed in `renderSettings()` itself is calling it once, anywhere in the function body (e.g. right after the staff-list block at line 985):
```js
  renderKarigarList();
```

- [ ] **Step 3: Verify**

```bash
node --check js/05-auth-login.js
node tests/regression.test.js 2>&1 | tail -5
cd checks && node backup-check.js .. && node roundtrip.js .. && node unescaped-ids.js .. && cd ..
```
Expected: syntax clean, suite unaffected, no new unescaped-id findings (the `jsAttrEsc(k.id)` call is the one inline-onclick value in this task — confirm the check script doesn't flag it).

Manual verification per `skills/verify-ui.md`: open Settings, confirm the Karigars card lists everyone created via the order-item picker, confirm their stats match a manually-checked order, click Record Payment, confirm the owed figure drops by the recorded amount.

- [ ] **Step 4: Commit**

```bash
git add js/05-auth-login.js index.html
git commit -m "Add Karigar list UI (Settings): per-karigar queue, monthly/lifetime stats, owed balance, record payment"
```

---

## Final: whole-feature verification

- [ ] Run the complete JewelOS pre-deploy check: `check.bat` (or the 3 steps it runs: `node --check` on all 11 `js/*.js`, `node tests/regression.test.js`, every script in `checks/` with `..`).
- [ ] Confirm `backup-check.js` and `roundtrip.js` are clean (non-negotiable per CLAUDE.md).
- [ ] Per CLAUDE.md's agent routing: this diff touches sale/stock/billing/orders — delegate to `jewelos-bug-pattern-reviewer` then `jewelos-test-runner` (2 agents, within the normal cap), and per the standing house rule (memory: "always run Opus review on code changes"), an independent Opus review as the third, additive agent — same 3-agent pattern already used and documented for today's earlier Karigar Cost work.
- [ ] Append a HANDOFF.md LOG entry summarizing the feature, linking the spec and this plan, noting it is implemented+tested but **not deployed** (deploy is always a separate explicit-confirmation step per CLAUDE.md).
