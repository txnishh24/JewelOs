# Karigar Provenance & Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the metal physically handed to a karigar (weight + purity), weigh it back in on submit and compare, give karigars an editable profile, and show two derived performance numbers. Before any of that, fix two live bugs underneath it.

**Architecture:** Every new field is nested and optional: `issued[]`, `receivedWt`, `receivedScrapWt`, `receiptNote` on a `karigarStages` entry, and `skills`/`note` on an `S.karigars` entry. Every new view is derived on read in `01-sync-core.js`, the same derived-not-stored pattern as `karigarOwed`. There are no new top-level `S` keys, no new status values, no new module file, and no `index.html` change. `karigarStageCost`/`karigarCostOf` are not edited, so profit cannot move.

**Tech Stack:** Vanilla ES5, no build step. Tests: `node tests/regression.test.js` against `tests/harness.js`'s `loadApp()` VM sandbox, plus the `_orderFormApp()` helper already in `tests/regression.test.js` (~line 2908).

**Spec:** `docs/superpowers/specs/2026-10-29-karigar-provenance-profile-design.md`

**Not this:** `docs/superpowers/{specs,plans}/2026-10-28-karigar-management-module*.md` is an unrelated, never-built design. Ignore it.

## Global Constraints

- ES5 only. No arrow functions, `let`/`const`, template literals, `async/await`. No `Object.assign` either: old Android WebViews lack it, and `Object.keys` is fine.
- `escHtml()` into `innerHTML`, `jsAttrEsc()` into inline `onclick="fn('...')"`. New free text (`skills`, `note`, `phone`, `name`, `receiptNote`, `task`) is always escaped. Native `prompt()` text is plain text and needs no escaping.
- **Byte-exact edits.** `js/03-billing-numbers.js` `saveOrder()` contains `'✓'`, and `js/04-orders-detail.js` has `'—'` at line 5 plus literal `₹ ✓ —` inside `assignOrderToKarigar()`. If an Edit's `old_string` doesn't match verbatim, or the diff shows any escape changed, redo the edit with a Python read-modify-write script.
- Line numbers below are as of `afceea5` and **will drift**. Anchor every edit by function name and quoted code, not by line number.
- After every task, run `node --check` on each changed file, then `node tests/regression.test.js` (0 failed), then `cd checks && node backup-check.js .. && node roundtrip.js ..`. Both checks must stay clean. This plan adds no top-level key, so their output must be **identical** to the baseline.
- Absent new fields mean "not logged", never 0-as-fact (spec invariant 6). Every reader tolerates absence.
- Every new numeric input goes through `parseFloat` + `isFinite` + a sign check before it is written (spec invariant 7).
- Per task, run `jewelos-bug-pattern-reviewer` and then `jewelos-test-runner` (the CLAUDE.md routing, max two agents). Tasks marked **[Opus review]** also get an Opus review, per the memory rule and MODEL-POLICY §8 🔴.
- Do not edit `HANDOFF.md` while executing this plan, except for the final task's entry, which the build session writes per CLAUDE.md.

## Review Focus

- **B2 changes a live number.** After Task 2, any shop that billed an order with a submitted stage will see a smaller "Owed". That is correct, but it is visible. Deployment is gated on the Cowork data check in Task 10.
- **A whitelist dropping a new field**, the family that already bit `buildSaleObj` on 27 Oct and `saveOrder` (B1). `buildSaleObj` is *intentionally* left alone (spec gap 1 not-build). Any other copy of a stage object that the builder discovers must be flagged, not silently extended.
- **`safeConfirm` is async.** `promptStageReceipt` must re-render inside the callback, never inline after the call.
- **Gold and silver fine grams never summed**, and fineness is always looked up under the **item's** metal.
- **Legacy stages** (no `issued`) must take exactly today's Mark Submitted path: no prompts, immediate submit.

---

## Task 0: Record the baseline

- [ ] **Step 1:** `git status` must be clean apart from the known untracked files (`COWORK-BRAIN.md`, `bash.exe.stackdump`, `skills-lock.json`). If anything else is dirty, stop and ask.
- [ ] **Step 2:** Run `check.bat` and save the output to a scratch file (not committed). Note the regression pass count (the 97th HANDOFF entry recorded 456/0; use what you actually see) and every hit from `ids.js`, `unquoted-args.js`, `unescaped-ids.js`, and `css.js`. Later tasks compare against this, not against zero.

---

## Task 1: B1 — `saveOrder()` keeps karigar stages from the order form  🟡

**Files:** Modify `js/03-billing-numbers.js` (`saveOrder()`). Test: `tests/regression.test.js`.

- [ ] **Step 1: Failing test** (add near the other `_orderFormApp` tests):

```js
test('29 Oct B1: saveOrder keeps karigarStages typed in the order form, drops rows with no karigar', function(){
  var t = _orderFormApp({ 'oi-desc-0':'Ring', 'of-cust':'Asha', 'of-delivery':'2099-01-01' });
  t.a.ordItems[0].karigarStages = [
    { task:'Gold work', karigarId:'kar1', karigarPayMode:'cash', karigarCost:500, karigarWastagePct:0, status:'assigned', assignedDate:'2026-10-29' },
    { task:'', karigarId:'', karigarPayMode:'', karigarCost:0, karigarWastagePct:0, status:'assigned', assignedDate:'2026-10-29' }
  ];
  t.a.saveOrder();
  assert(t.saves() === 1, 'sanity: the order should have saved');
  var st = t.a.S.orders[t.a.S.orders.length-1].items[0].karigarStages;
  assert(Array.isArray(st) && st.length === 1, 'expected exactly the one filled stage, got ' + JSON.stringify(st));
  assert(st[0].karigarId === 'kar1' && st[0].karigarCost === 500 && st[0].status === 'assigned', 'stage fields lost: ' + JSON.stringify(st[0]));
});
```

- [ ] **Step 2:** Run it and confirm it fails: `st` is `undefined`.
- [ ] **Step 3: Implement.** In `saveOrder()`'s `items:validItems.map(...)`, change
```js
             makingType:i.makingType||'flat',qty:i.qty||1,note:i.note||''};
```
to
```js
             makingType:i.makingType||'flat',qty:i.qty||1,note:i.note||'',
             // 29 Oct B1: the order form's Karigar Stages editor was never
             // saved -- this field list silently dropped it. Rows the owner
             // added but never named a karigar on are left out, or they'd
             // sit forever as an "Unassigned task" active stage.
             karigarStages:(i.karigarStages||[]).filter(function(st){ return st.karigarId; })};
```
- [ ] **Step 4: Verify.** Run `node --check js/03-billing-numbers.js`. Then run the regression suite: the new test passes and the count is baseline + 1. The existing `_orderFormApp` tests still pass, because their items have no `karigarStages`, which gives `[]`. Run backup-check and roundtrip; both are identical to baseline.
- [ ] **Step 5: Commit.** `git commit -m "Fix: saveOrder dropped karigar stages typed in the order form"`

---

## Task 2: B2 — billed orders counted once in karigar views  🔴 [Opus review]

**Files:** Modify `js/01-sync-core.js` (`_allKarigarStageEntries`). Test: `tests/regression.test.js`.

- [ ] **Step 1: Failing test**

```js
test('29 Oct B2: a billed order\'s stages count once in karigarOwed/karigarStats/karigarQueue, not once per copy', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  var st = function(status){ return { karigarId:k.id, karigarPayMode:'cash', karigarCost:500, status:status, assignedDate:'2026-10-15', submittedDate: status==='submitted' ? '2026-10-20' : '' }; };
  a.S.orders = [{ id:'o1', ordNo:'ORD-1', billedSaleId:'s1', items:[
    { desc:'Ring',  metal:'gold', estWt:5, qty:1, karigarStages:[st('submitted')] },
    { desc:'Chain', metal:'gold', estWt:8, qty:1, karigarStages:[st('assigned')] } ]}];
  a.S.sales = [{ id:'s1', items:[   // convertToSale/buildSaleObj copies of the same stages
    { name:'Ring',  metal:'gold', weight:5, qty:1, karigarStages:[st('submitted')] },
    { name:'Chain', metal:'gold', weight:8, qty:1, karigarStages:[st('assigned')] } ]}];
  assert(a.karigarOwed(k.id).cash === 500, 'owed should be 500 once, got ' + JSON.stringify(a.karigarOwed(k.id)));
  assert(a.karigarStats(k.id).piecesSubmitted === 1, 'stats should count the billed stage once: ' + JSON.stringify(a.karigarStats(k.id)));
  assert(a.karigarQueue(k.id).length === 1, 'the assigned stage should be in the queue once, not twice: ' + JSON.stringify(a.karigarQueue(k.id)));
});
```
The existing test "sums submitted-stage cost across orders and sales" uses an *unlinked* sale. It must still pass unchanged, which proves unlinked sales are still counted.

- [ ] **Step 2:** Run and confirm it fails: owed 1000, stats 2, queue 2.
- [ ] **Step 3: Implement.** Replace the body of `_allKarigarStageEntries()`:
```js
function _allKarigarStageEntries(){
  // 29 Oct B2: a billed order stays in S.orders (billedSaleId set) AND its
  // stages are copied onto the sale lines -- scanning both counted every
  // billed stage twice and left a never-submittable copy in the queue. The
  // ORDER is canonical (it's where stages are edited and submitted); a sale
  // that some order was billed into is skipped here. Profit is unaffected:
  // calcItemProfit reads sale lines directly, not through this function.
  var out = [], billed = {};
  (S.orders||[]).forEach(function(o){ if(o.billedSaleId) billed[o.billedSaleId] = true; });
  var sales = (S.sales||[]).filter(function(s){ return !billed[s.id]; });
  (S.orders||[]).concat(sales).forEach(function(rec){
    (rec.items||[]).forEach(function(item){
      (item.karigarStages||[]).forEach(function(stage){
        out.push({ item:item, stage:stage, ordNo:rec.ordNo, orderId:rec.id, itemName:item.desc||item.name||'' });
      });
    });
  });
  return out;
}
```
Keep the existing comment block above the function as it is.
- [ ] **Step 4: Verify.** Run `node --check`, then the full suite (all 5 existing `karigarOwed`/`karigarStats`/`karigarQueue` tests plus the new one pass), then backup-check and roundtrip, identical to baseline.
- [ ] **Step 5: Opus review prompt:** "Does any reader of `_allKarigarStageEntries` *need* the sale-side copy? Is any sale reachable that holds stages but whose order has no `billedSaleId`?" Expected answer: no. Stages only reach sales through `convertToSale`, and `_commitSaleTransaction` sets `billedSaleId` in the same save.
- [ ] **Step 6: Commit.** `git commit -m "Fix: billed orders' karigar stages were counted twice (order + sale copy)"`

---

## Task 3: Fineness constants + derived provenance views  🔴 [Opus review]

**Files:** Modify `js/00-config-state.js` and `js/01-sync-core.js`. Test: `tests/regression.test.js`.

**Produces:** `PURITY_FINENESS`, `KARIGAR_WEIGH_TOL_G`, `karigarFineOf(metal,purity,grams)`, `karigarPurityKey(metal,typed)`, `karigarIssuedFine(item,stage)`, `karigarReceiptCheck(item,stage[,receivedWt,receivedScrapWt])`, `karigarMetalHeld(karigarId)`.

- [ ] **Step 1: Failing tests**

```js
test('29 Oct provenance: karigarFineOf / karigarPurityKey are metal-aware, plated and wrong-metal give null/empty', function(){
  var a = loadApp();
  assert(approxEqual(a.karigarFineOf('gold','22K',10), 9.16, 1e-9), '22K fine');
  assert(a.karigarFineOf('gold','Gold Plated',10) === null, 'plated has no fineness');
  assert(a.karigarFineOf('gold','925 Sterling',10) === null, 'silver purity on gold metal -> null, not a number');
  assert(approxEqual(a.karigarFineOf('silver','925 Sterling',100), 92.5, 1e-9), 'silver fine');
  assert(a.karigarPurityKey('gold',' 24k ') === '24K', 'case/space-insensitive');
  assert(a.karigarPurityKey('silver','925') === '925 Sterling', 'first-word match');
  assert(a.karigarPurityKey('gold','925') === '', 'wrong metal -> empty');
});

test('29 Oct provenance: karigarReceiptCheck bands -- match, cross-purity match, allowance, short, over', function(){
  var a = loadApp(), T = a.KARIGAR_WEIGH_TOL_G;
  var item = { metal:'gold', purity:'22K', estWt:10, qty:1 };
  var cash = function(iss){ return { karigarPayMode:'cash', issued:iss }; };
  assert(a.karigarReceiptCheck(item, cash([{wt:10,purity:'22K'}]), 10).band === 'match', 'same purity, same weight');
  assert(a.karigarReceiptCheck(item, cash([{wt:10,purity:'24K'}]), 10.9).band === 'match', '24K 10g out (9.99 fine) vs 22K 10.9g back (9.984 fine)');
  var wst = { karigarPayMode:'wastage', karigarWastagePct:4, issued:[{wt:10,purity:'22K'}] }; // allowance 0.04*10 = 0.4
  var c1 = a.karigarReceiptCheck(item, wst, 9.7);
  assert(c1.band === 'allowance' && approxEqual(c1.allowanceFine, 0.4, 1e-9), 'within wastage allowance: ' + JSON.stringify(c1));
  var c2 = a.karigarReceiptCheck(item, cash([{wt:10,purity:'22K'}]), 8);
  assert(c2.band === 'short' && approxEqual(c2.shortFine, 2*0.916, 1e-9), 'cash stage, 2g 22K missing: ' + JSON.stringify(c2));
  assert(a.karigarReceiptCheck(item, cash([{wt:10,purity:'22K'}]), 10.5).band === 'over', 'more back than issued');
  assert(a.karigarReceiptCheck(item, cash([{wt:10,purity:'22K'}]), 9, 1).band === 'match', 'leftover scrap counts toward returned');
  assert(a.karigarReceiptCheck(item, cash([{wt:10,purity:'22K'}]), 0).band === 'short', 'receivedWt 0 is a real answer, not "unknown"');
  assert(T > 0, 'tolerance constant defined');
});

test('29 Oct provenance: karigarReceiptCheck returns null for every "unknown" case (legacy stages)', function(){
  var a = loadApp();
  var item = { metal:'gold', purity:'22K', estWt:10, qty:1 };
  assert(a.karigarReceiptCheck(item, { karigarPayMode:'cash' }, 10) === null, 'no issued field (every pre-29-Oct stage)');
  assert(a.karigarReceiptCheck(item, { issued:[] }, 10) === null, 'empty issued');
  assert(a.karigarReceiptCheck(item, { issued:[{wt:10,purity:'22K'}] }) === null, 'no receivedWt stored, none passed');
  assert(a.karigarReceiptCheck({ metal:'gold', purity:'Gold Plated' }, { issued:[{wt:10,purity:'22K'}] }, 10) === null, 'plated item');
  assert(a.karigarReceiptCheck(item, { issued:[{wt:10,purity:'925 Sterling'}] }, 10) === null, 'wrong-metal issued entry -> null, never a number');
  var stored = { issued:[{wt:10,purity:'22K'}], receivedWt:10, receivedScrapWt:0 };
  assert(a.karigarReceiptCheck(item, stored).band === 'match', 'reads stored fields when no override passed');
});

test('29 Oct provenance: karigarMetalHeld sums active issued fine per metal, includes cancelled orders, excludes submitted/other karigars', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh'), k2 = a.addOrGetKarigar('Suresh');
  a.S.orders = [
    { id:'o1', items:[{ metal:'gold', purity:'22K', karigarStages:[{ karigarId:k.id, status:'assigned', issued:[{wt:10,purity:'24K'},{wt:2,purity:'24K'}] }] }] },
    { id:'o2', status:'cancelled', items:[{ metal:'silver', purity:'925 Sterling', karigarStages:[{ karigarId:k.id, status:'assigned', issued:[{wt:100,purity:'925 Sterling'}] }] }] },
    { id:'o3', items:[{ metal:'gold', purity:'22K', karigarStages:[{ karigarId:k.id, status:'submitted', issued:[{wt:50,purity:'24K'}] }] }] },
    { id:'o4', items:[{ metal:'gold', purity:'22K', karigarStages:[{ karigarId:k.id, status:'assigned' }] }] },
    { id:'o5', items:[{ metal:'gold', purity:'22K', karigarStages:[{ karigarId:k2.id, status:'assigned', issued:[{wt:7,purity:'24K'}] }] }] }
  ];
  var h = a.karigarMetalHeld(k.id);
  assert(approxEqual(h.gold, 12*0.999, 1e-9), 'gold held = 12g 24K fine: ' + JSON.stringify(h));
  assert(approxEqual(h.silver, 92.5, 1e-9), 'silver held separately, cancelled order still counts: ' + JSON.stringify(h));
});

test('29 Oct invariant 1: new provenance fields never change karigarStageCost / karigarCostOf / orderProfitEst', function(){
  var a = loadApp();
  var mk = function(extra){ var s = { karigarId:'kar1', karigarPayMode:'wastage', karigarWastagePct:4, status:'submitted' }; for(var p in extra) s[p] = extra[p]; return s; };
  var plain = { metal:'gold', purity:'22K', estWt:10, qty:2, karigarStages:[mk({})] };
  var rich  = { metal:'gold', purity:'22K', estWt:10, qty:2, karigarStages:[mk({ issued:[{date:'2026-10-29',wt:25,purity:'24K'}], receivedWt:19, receivedScrapWt:1, receiptNote:'x' })] };
  assert(a.karigarCostOf(plain) === a.karigarCostOf(rich), 'karigarCostOf moved');
  assert(a.karigarStageGrams(plain, plain.karigarStages[0]) === a.karigarStageGrams(rich, rich.karigarStages[0]), 'wastage grams moved');
  assert(a.orderProfitEst({ quote:150000, items:[plain] }) === a.orderProfitEst({ quote:150000, items:[rich] }), 'orderProfitEst moved');
});
```

- [ ] **Step 2:** Run and confirm all five fail (`a.karigarFineOf is not a function`). The invariant test may pass already; that is fine, since it guards the future.
- [ ] **Step 3: Constants.** In `js/00-config-state.js`, after the `var S_PUR=[...]` line, add:
```js
// Karigar provenance (29 Oct): fineness per purity, by metal -- used ONLY to
// compare metal issued to a karigar vs metal received back when the purities
// differ (24K fine out, 22K piece back). Never used for pricing. Plated
// purities are absent on purpose: there is no karigar metal account for plating.
var PURITY_FINENESS = {
  gold:   {'24K':0.999, '22K':0.916, '18K':0.750, '14K':0.585},
  silver: {'999 Pure':0.999, '925 Sterling':0.925, '800':0.800}
};
// Scale noise floor for the receipt check, fine grams. A calibration knob:
// raise it if a shop's scale reads coarser.
var KARIGAR_WEIGH_TOL_G = 0.05;
```
- [ ] **Step 4: Derivations.** In `js/01-sync-core.js`, directly after `karigarStageGrams()`, add:
```js
// ── KARIGAR PROVENANCE (29 Oct) — issued vs received metal, derived ──
// stage.issued = [{date, wt, purity, note?}] (append-only; wt is grams as
// weighed for the WHOLE item line, negative only for a typo correction).
// Absent/empty = issuance not logged (every stage from before 29 Oct) --
// readers return null/0, never a guessed number. None of this feeds
// karigarStageCost/karigarOwed: issuance is custody, not pay.
function karigarFineOf(metal, purity, grams){
  var f = PURITY_FINENESS[metal === 'silver' ? 'silver' : 'gold'][purity];
  if(!f) return null;
  return (parseFloat(grams)||0) * f;
}

// Canonical purity key for a typed answer ('24k', '925') or '' if it isn't a
// valid purity for that metal.
function karigarPurityKey(metal, typed){
  var t = String(typed||'').trim().toLowerCase();
  if(!t) return '';
  var keys = Object.keys(PURITY_FINENESS[metal === 'silver' ? 'silver' : 'gold']);
  for(var i=0; i<keys.length; i++){
    if(keys[i].toLowerCase() === t || keys[i].split(' ')[0].toLowerCase() === t) return keys[i];
  }
  return '';
}

// Fine grams issued on one stage, under the ITEM's metal (never the stage's).
// 0 when nothing logged; null if any entry has no fineness for that metal.
function karigarIssuedFine(item, stage){
  var metal = item.metal || 'gold', total = 0, bad = false;
  (stage.issued||[]).forEach(function(e){
    var f = karigarFineOf(metal, e.purity, e.wt);
    if(f === null) bad = true; else total += f;
  });
  return bad ? null : total;
}

// Receipt check for one stage. receivedWt / receivedScrapWt override the
// stored fields so the UI can check BEFORE writing. allowanceFine uses the
// same weight base as karigarStageGrams on purpose -- the allowance shown at
// receipt is exactly the wastage this stage is paid.
function karigarReceiptCheck(item, stage, receivedWt, receivedScrapWt){
  if(!(stage.issued && stage.issued.length)) return null;
  var rw = (receivedWt === undefined) ? stage.receivedWt : receivedWt;
  var sw = (receivedScrapWt === undefined) ? stage.receivedScrapWt : receivedScrapWt;
  if(rw === undefined || rw === null || rw === '' || !isFinite(parseFloat(rw))) return null;
  var metal = item.metal === 'silver' ? 'silver' : 'gold';
  var issuedFine = karigarIssuedFine(item, stage);
  var pieceFine  = karigarFineOf(metal, item.purity, rw);
  var scrapFine  = karigarFineOf(metal, stage.issued[0].purity, sw || 0);
  if(issuedFine === null || pieceFine === null || scrapFine === null) return null;
  var allowance = 0;
  if(stage.karigarPayMode === 'wastage'){
    var qty = parseInt(item.qty) || 1;
    var wt  = parseFloat(item.weight||item.estWt||item.orderWt) || 0;
    allowance = (parseFloat(stage.karigarWastagePct)||0)/100 * wt * qty;
  }
  var shortFine = issuedFine - pieceFine - scrapFine, tol = KARIGAR_WEIGH_TOL_G, band;
  if(shortFine < -tol) band = 'over';
  else if(shortFine <= tol) band = 'match';
  else if(shortFine <= allowance + tol) band = 'allowance';
  else band = 'short';
  return { metal:metal, issuedFine:issuedFine, receivedFine:pieceFine+scrapFine, shortFine:shortFine, allowanceFine:allowance, band:band };
}

// Metal physically with this karigar now: issued fine on every stage not yet
// submitted. Includes cancelled orders on purpose -- cancelling the order
// does not bring the gold back. Gold and silver are never summed together.
function karigarMetalHeld(karigarId){
  var held = { gold:0, silver:0 };
  _allKarigarStageEntries().forEach(function(e){
    if(e.stage.karigarId !== karigarId || e.stage.status === 'submitted') return;
    var f = karigarIssuedFine(e.item, e.stage);
    if(!f) return; // 0 (nothing logged) or null (invalid entry -- don't guess)
    if(e.item.metal === 'silver') held.silver += f; else held.gold += f;
  });
  return held;
}
```
Check this before moving on: `00-config-state.js` loads first, and the constants are only read inside functions, so there is no load-order hazard. `checks/loadorder.js` should still show no new hit.
- [ ] **Step 5: Verify.** Run `node --check` on both files, then the suite (baseline + 1 + 1 + 5), then backup-check and roundtrip identical, then `node checks/scope.js .` with no new undeclared names.
- [ ] **Step 6: Opus review prompt:** spec §6 invariants 1, 4, 5 and 6, and the band edges at exactly `±TOL` and `allowance+TOL`.
- [ ] **Step 7: Commit.** `git commit -m "Karigar provenance: fineness constants + derived issued/received/held views"`

---

## Task 4: Stage data writes — receipt arg + `logStageIssue`  🔴 [Opus review]

**Files:** Modify `js/04-orders-detail.js` (`markStageSubmitted`, new `logStageIssue` right below it). Test: `tests/regression.test.js`.

- [ ] **Step 1: Failing tests**

```js
test('29 Oct receipt: markStageSubmitted writes receipt fields when given, behaves exactly as before when not', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  a.S.orders = [{ id:'o1', items:[
    { karigarStages:[{ task:'Gold work', status:'assigned', issued:[{wt:10,purity:'22K'}] }] },
    { karigarStages:[{ task:'Polish', status:'assigned' }] } ]}];
  assert(a.markStageSubmitted('o1', 0, { receivedWt:9.5, receivedScrapWt:0.3, receiptNote:'short, told him' }) === true, 'should submit');
  var s0 = a.S.orders[0].items[0].karigarStages[0];
  assert(s0.status === 'submitted' && s0.receivedWt === 9.5 && s0.receivedScrapWt === 0.3 && s0.receiptNote === 'short, told him', JSON.stringify(s0));
  assert(a.markStageSubmitted('o1', 1) === true, 'legacy call still works');
  var s1 = a.S.orders[0].items[1].karigarStages[0];
  assert(!('receivedWt' in s1) && !('receiptNote' in s1), 'no receipt arg -> no receipt fields written: ' + JSON.stringify(s1));
  assert(saved === 2, 'one save per submit');
});

test('29 Oct issuance: logStageIssue appends top-ups and corrections, refuses bad input without mutating', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  a.S.orders = [{ id:'o1', items:[{ metal:'gold', purity:'22K', karigarStages:[{ status:'submitted' }, { status:'assigned' }] }] }];
  var st = function(){ return a.S.orders[0].items[0].karigarStages[1]; };
  assert(a.logStageIssue('o1', 0, 10, '24K') === '', 'first issue');
  assert(a.logStageIssue('o1', 0, 2, '24K') === '', 'top-up');
  assert(a.logStageIssue('o1', 0, -0.5, '24K') === '', 'typo correction');
  assert(st().issued.length === 3 && st().issued[2].note === 'correction' && !!st().issued[0].date, JSON.stringify(st().issued));
  assert(a.S.orders[0].items[0].karigarStages[0].issued === undefined, 'went to the ACTIVE stage, not the submitted one');
  var before = JSON.stringify(st());
  assert(a.logStageIssue('o1', 0, -20, '24K') !== '', 'correction below zero refused');
  assert(a.logStageIssue('o1', 0, 5, '925 Sterling') !== '', 'wrong-metal purity refused');
  assert(a.logStageIssue('o1', 0, 0, '24K') !== '', 'zero refused');
  assert(a.logStageIssue('o1', 0, Infinity, '24K') !== '', 'Infinity refused');
  assert(a.logStageIssue('o1', 0, 'abc', '24K') !== '', 'non-number refused');
  assert(JSON.stringify(st()) === before, 'refusals must not mutate');
  assert(a.logStageIssue('nope', 0, 5, '24K') !== '', 'unknown order -> error string, no throw');
  assert(saved === 3, 'only the 3 accepted writes saved, got ' + saved);
});
```

- [ ] **Step 2:** Run and confirm they fail.
- [ ] **Step 3: Implement.** In `markStageSubmitted`, change the signature to `function markStageSubmitted(ordId, itemIdx, receipt){`. Directly after `if(!stage) return false;`, add:
```js
  // 29 Oct receipt verification: weigh-in fields, written only when the
  // caller (promptStageReceipt) collected them. Receipt date = submittedDate.
  if(receipt){
    stage.receivedWt = receipt.receivedWt;
    stage.receivedScrapWt = receipt.receivedScrapWt || 0;
    if(receipt.receiptNote) stage.receiptNote = receipt.receiptNote;
  }
```
Below `markStageSubmitted`, add:
```js
// Karigar provenance (29 Oct): append one entry to the ACTIVE stage's
// issued[] log -- first issue, mid-job top-up, or (negative wt) a typo
// correction. Append-only, same convention as the order ledger's reversals.
// Returns '' on success, else an error string, without mutating anything.
function logStageIssue(ordId, itemIdx, wt, purity){
  var o = (S.orders||[]).find(function(x){ return x.id===ordId; });
  var item = o && o.items && o.items[itemIdx];
  if(!item) return 'Item not found';
  var stage = (item.karigarStages||[]).find(function(s){ return s.status !== 'submitted'; });
  if(!stage) return 'No active karigar stage on this item';
  wt = parseFloat(wt);
  if(!isFinite(wt) || wt === 0) return 'Enter a weight in grams';
  var metal = item.metal || 'gold';
  if(karigarFineOf(metal, purity, 1) === null) return (purity||'That') + ' is not a valid purity for ' + metal;
  var sameTotal = (stage.issued||[]).reduce(function(s, e){ return e.purity === purity ? s + (parseFloat(e.wt)||0) : s; }, 0);
  if(sameTotal + wt < -1e-9) return 'Correction is more than the ' + fmtW(sameTotal) + ' of ' + purity + ' issued';
  stage.issued = stage.issued || [];
  var entry = { date:dbDayKey(new Date()), wt:wt, purity:purity };
  if(wt < 0) entry.note = 'correction';
  stage.issued.push(entry);
  saveToCloud(function(){});
  return '';
}
```
- [ ] **Step 4: Verify.** Run `node --check`. In the suite, the two existing `markStageSubmitted` tests still pass unchanged (receipt arg optional). Run backup-check and roundtrip.
- [ ] **Step 5: Commit.** `git commit -m "Karigar provenance: markStageSubmitted receipt arg + append-only logStageIssue"`

---

## Task 5: Order detail UI — Issue Metal, weigh-in on Mark Submitted, receipt lines  🟡

**Files:** Modify `js/04-orders-detail.js` (`showOrderDetail` item row, plus new top-level `_issuedSummary`, `_stageLinesHtml`, `promptStageIssue`, `promptStageReceipt`). Test: `tests/regression.test.js`.

- [ ] **Step 1: Failing tests** (`prompt`/`safeConfirm`/`toast`/`showOrderDetail` stubbed):

```js
function _karigarUiApp(stage, item){
  var a = loadApp(), saved = 0, toasts = [], confirms = [], q = [];
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  a.toast = function(m){ toasts.push(m); };
  a.safeConfirm = function(t, m, ok, d){ confirms.push({ t:t, m:m, ok:ok, d:d }); };
  a.showOrderDetail = function(){};
  a.prompt = function(){ return q.length ? q.shift() : null; };
  var it = item || { desc:'Ring', metal:'gold', purity:'22K', estWt:10, qty:1 };
  it.karigarStages = [stage];
  a.S.orders = [{ id:'o1', items:[it] }];
  return { a:a, q:q, toasts:toasts, confirms:confirms, saved:function(){ return saved; }, stage:function(){ return a.S.orders[0].items[0].karigarStages[0]; } };
}

test('29 Oct receipt UI: legacy stage (no issuance) submits immediately, no prompts', function(){
  var t = _karigarUiApp({ task:'Gold work', status:'assigned' });
  t.a.prompt = function(){ throw new Error('must not prompt for a legacy stage'); };
  t.a.promptStageReceipt('o1', 0);
  assert(t.stage().status === 'submitted' && !('receivedWt' in t.stage()) && t.saved() === 1, JSON.stringify(t.stage()));
});

test('29 Oct receipt UI: blank or cancelled weigh-in cancels the submit', function(){
  var t = _karigarUiApp({ status:'assigned', karigarPayMode:'cash', issued:[{wt:10,purity:'22K'}] });
  t.q.push('');  t.a.promptStageReceipt('o1', 0);
  t.q.push(null); t.a.promptStageReceipt('o1', 0);
  t.q.push('-3'); t.a.promptStageReceipt('o1', 0);
  assert(t.stage().status === 'assigned' && t.saved() === 0, 'nothing saved: ' + JSON.stringify(t.stage()));
});

test('29 Oct receipt UI: match submits with a toast, no confirm', function(){
  var t = _karigarUiApp({ status:'assigned', karigarPayMode:'cash', issued:[{wt:10,purity:'22K'}] });
  t.q.push('10', '');
  t.a.promptStageReceipt('o1', 0);
  assert(t.stage().status === 'submitted' && t.stage().receivedWt === 10 && t.confirms.length === 0, JSON.stringify(t.stage()));
  assert(/matches/.test(t.toasts[t.toasts.length-1]), t.toasts.join(' | '));
});

test('29 Oct receipt UI: short beyond allowance asks via safeConfirm(warn); cancel saves nothing, OK saves with note', function(){
  var t = _karigarUiApp({ status:'assigned', karigarPayMode:'cash', issued:[{wt:10,purity:'22K'}] });
  t.q.push('8', '');
  t.a.promptStageReceipt('o1', 0);
  assert(t.confirms.length === 1 && t.confirms[0].d === 'warn' && /short/i.test(t.confirms[0].t), 'expected one warn confirm');
  assert(t.stage().status === 'assigned' && t.saved() === 0, 'nothing written before OK (= cancel path)');
  t.q.push('weighed twice');
  t.confirms[0].ok();
  assert(t.stage().status === 'submitted' && t.stage().receivedWt === 8 && t.stage().receiptNote === 'weighed twice' && t.saved() === 1, JSON.stringify(t.stage()));
});

test('29 Oct issue UI: a negative correction needs a warn confirm; a positive top-up does not', function(){
  var t = _karigarUiApp({ status:'assigned', issued:[{wt:10,purity:'24K'}] });
  t.q.push('2', '24K');  t.a.promptStageIssue('o1', 0);
  assert(t.stage().issued.length === 2 && t.confirms.length === 0, 'top-up straight through');
  t.q.push('-1', '24K'); t.a.promptStageIssue('o1', 0);
  assert(t.stage().issued.length === 2 && t.confirms.length === 1 && t.confirms[0].d === 'warn', 'correction waits for confirm');
  t.confirms[0].ok();
  assert(t.stage().issued.length === 3 && t.stage().issued[2].note === 'correction', JSON.stringify(t.stage().issued));
});
```

- [ ] **Step 2:** Run and confirm they fail.
- [ ] **Step 3: Implement the wrappers** (top level, after `logStageIssue`):
```js
// Per-purity totals of a stage's issued[] log, for the order detail line.
function _issuedSummary(stage){
  var by = {};
  (stage.issued||[]).forEach(function(e){ by[e.purity] = (by[e.purity]||0) + (parseFloat(e.wt)||0); });
  return Object.keys(by).map(function(p){ return fmtW(by[p]) + ' (' + escHtml(p) + ')'; }).join(' + ');
}

// Issue Metal button: first issue, top-up, or typo correction (negative,
// behind a warn confirm) on the active stage.
function promptStageIssue(ordId, itemIdx){
  var o = (S.orders||[]).find(function(x){ return x.id===ordId; });
  var item = o && o.items && o.items[itemIdx];
  var stage = item && (item.karigarStages||[]).find(function(s){ return s.status !== 'submitted'; });
  if(!stage) return;
  var qty = parseInt(item.qty) || 1;
  var wRaw = prompt('Metal handed over now (grams' + (qty>1 ? ', total for all ' + qty + ' pieces' : '') + ')? Use a negative number only to fix a typo.', '');
  if(wRaw === null || String(wRaw).trim() === ''){ toast('Cancelled'); return; }
  var wt = parseFloat(wRaw);
  if(!isFinite(wt) || wt === 0){ toast('Cancelled — enter a weight in grams'); return; }
  var last = (stage.issued && stage.issued.length) ? stage.issued[stage.issued.length-1].purity : (item.purity||'');
  var pRaw = prompt('Purity of that metal (e.g. 24K, 22K, 925 Sterling)?', last);
  if(pRaw === null){ toast('Cancelled'); return; }
  var purity = karigarPurityKey(item.metal||'gold', pRaw);
  if(!purity){ toast('Cancelled — ' + String(pRaw).trim() + ' is not a valid purity for ' + (item.metal||'gold')); return; }
  function go(){
    var err = logStageIssue(ordId, itemIdx, wt, purity);
    if(err){ toast(err); return; }
    showOrderDetail(ordId);
    toast(wt < 0 ? 'Correction recorded' : '✓ Metal issue recorded');
  }
  if(wt < 0){
    safeConfirm('Reduce metal issued?', 'This reduces metal issued by ' + fmtW(-wt) + ' of ' + purity + '. Only use this to fix a typo.', go, 'warn');
    return;
  }
  go();
}

// Mark Submitted button. No issuance logged -> exactly the old path. With
// issuance -> weigh-in required, then warn-and-let-through on a shortfall
// beyond the stage's wastage allowance (spec gap 2). safeConfirm is async,
// so every re-render happens inside done(), never after this returns.
function promptStageReceipt(ordId, itemIdx){
  var o = (S.orders||[]).find(function(x){ return x.id===ordId; });
  var item = o && o.items && o.items[itemIdx];
  var stage = item && (item.karigarStages||[]).find(function(s){ return s.status !== 'submitted'; });
  if(!stage) return;
  if(!(stage.issued && stage.issued.length)){
    markStageSubmitted(ordId, itemIdx);
    showOrderDetail(ordId);
    return;
  }
  var qty = parseInt(item.qty) || 1;
  var rwRaw = prompt('Net metal weight received back (grams, exclude stones' + (qty>1 ? '; total for all ' + qty + ' pieces' : '') + ')?', '');
  if(rwRaw === null || String(rwRaw).trim() === ''){ toast('Cancelled'); return; }
  var rw = parseFloat(rwRaw);
  if(!isFinite(rw) || rw < 0){ toast('Cancelled — enter a weight in grams'); return; }
  var swRaw = prompt('Leftover metal returned (grams at ' + stage.issued[0].purity + ')? Leave blank if none.', '');
  if(swRaw === null){ toast('Cancelled'); return; }
  var sw = String(swRaw).trim() === '' ? 0 : parseFloat(swRaw);
  if(!isFinite(sw) || sw < 0){ toast('Cancelled — enter a weight in grams'); return; }
  var chk = karigarReceiptCheck(item, stage, rw, sw);
  function done(note){
    markStageSubmitted(ordId, itemIdx, { receivedWt:rw, receivedScrapWt:sw, receiptNote:note||'' });
    showOrderDetail(ordId);
  }
  if(chk && chk.band === 'short'){
    safeConfirm('Metal short by ' + fmtW(chk.shortFine) + ' fine',
      'Issued ' + fmtW(chk.issuedFine) + ' fine · received ' + fmtW(chk.receivedFine) + ' fine · wastage allowance ' + fmtW(chk.allowanceFine) + '. Record this receipt anyway?',
      function(){ done(String(prompt('Note for the record (optional)?', '') || '').trim()); toast('Receipt recorded with shortfall'); }, 'warn');
    return;
  }
  done();
  if(!chk) toast('✓ Received');
  else if(chk.band === 'match') toast('✓ Received — matches metal issued');
  else if(chk.band === 'allowance') toast('✓ Received — ' + fmtW(chk.shortFine) + ' fine short, within this stage\'s ' + fmtW(chk.allowanceFine) + ' wastage allowance');
  else toast('Received ' + fmtW(-chk.shortFine) + ' fine MORE than issued — check stones were not weighed in');
}

// One line per weighed-in submitted stage, then the active stage with its
// buttons. Sequential stages, so at most one active line per item.
function _stageLinesHtml(ordId, item, n){
  var stages = item.karigarStages || [], html = '';
  stages.forEach(function(s){
    if(s.status !== 'submitted') return;
    var chk = karigarReceiptCheck(item, s);
    if(!chk) return;
    var verdict = chk.band === 'match' ? 'matches issued'
                : chk.band === 'over'  ? fmtW(-chk.shortFine) + ' fine over'
                : fmtW(chk.shortFine) + ' fine short' + (chk.band === 'allowance' ? ' (within allowance)' : '');
    html += '<div style="margin-top:4px;font-size:11px;color:' + (chk.band === 'short' ? 'var(--danger)' : 'var(--text3)') + ';">' +
            escHtml(s.task || 'Stage') + ' — received ' + fmtW(s.receivedWt) + ' · ' + verdict + (s.receiptNote ? ' · ' + escHtml(s.receiptNote) : '') + '</div>';
  });
  var active = stages.filter(function(s){ return s.status !== 'submitted'; })[0];
  if(active){
    var iss = _issuedSummary(active);
    html += '<div style="margin-top:6px;">' +
      '<span style="font-size:11px;color:var(--text3);">Active: ' + escHtml(active.task || 'Unassigned task') + (iss ? ' · Issued ' + iss : '') + '</span> ' +
      '<button class="btn btn-sm" onclick="promptStageIssue(\'' + jsAttrEsc(ordId) + '\',' + n + ');">Issue Metal</button> ' +
      '<button class="btn btn-sm" onclick="promptStageReceipt(\'' + jsAttrEsc(ordId) + '\',' + n + ');">Mark Submitted</button>' +
    '</div>';
  }
  return html;
}
```
- [ ] **Step 4: Wire it into `showOrderDetail`.** Keep the existing three-line `// Karigar Management (27 Oct): the active stage...` comment. Replace only the expression under it, from `((item.karigarStages||[]).some(` through `: '');`, with:
```js
        _stageLinesHtml(o.id, item, n);
```
The old inline `markStageSubmitted(...);showOrderDetail(...)` onclick goes away. `promptStageReceipt` re-renders itself.
- [ ] **Step 5: Verify (logic).** Run `node --check`, then the suite (baseline + all new tests), then `node checks/handlers.js .` (both new onclick targets must resolve), then `unescaped-ids.js` (no new hits; every id goes through `jsAttrEsc`), then `unquoted-args.js` (at most the same kind of hit as baseline, on the numeric `n` only; README calls this harmless).
- [ ] **Step 6: Verify (screen), per `skills/verify-ui.md`.** No e2e spec covers Orders. If Playwright MCP is down, use the 97th-entry fallback: an ad hoc `@playwright/test` script with `tests/e2e/fixtures/testShop.js`'s `login()`, data tagged `E2E-UICHK-<timestamp>`, and the script deleted afterwards. Native `prompt()` answers go through `page.on('dialog', d => d.accept(answers.shift()))`. `safeConfirm` is a DOM overlay, so click `#safe-confirm-ok` / `#safe-confirm-cancel`; it is not a dialog. Walk this:
  1. Open a tagged order with an already-assigned legacy stage. Mark Submitted gives no prompts, and the stage flips (backward compat).
  2. On another item, Issue Metal 10 with `24k` makes the active line read `Issued 10.00g (24K)`. Issue Metal again with `-1` shows the amber confirm. OK makes it read `9.00g`.
  3. Mark Submitted with `8.2` and blank gives the toast "matches"/"within…". Screenshot the submitted-stage line.
  4. Repeat with a short weight (`5`). The amber confirm appears. Cancel, and the stage is still active. Retry, OK, enter a note, and a red receipt line appears with the escaped note. Use `<b>x</b>` as the note to prove it renders as text.

  Screenshot every step. Report what you clicked and what you did not.
- [ ] **Step 7: Commit.** `git commit -m "Order detail: Issue Metal + weigh-in on Mark Submitted, receipt lines per stage"`

---

## Task 6: `assignOrderToKarigar()` asks for metal handed over  🟡

**Files:** Modify `js/04-orders-detail.js` (`assignOrderToKarigar`). Test: `tests/regression.test.js`. These are the first tests this function has ever had.

- [ ] **Step 1: Failing tests**

```js
function _assignApp(items, answers){
  var a = loadApp(), saved = 0, toasts = [], q = answers.slice(), asked = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  a.toast = function(m){ toasts.push(m); };
  a.prompt = function(){ asked++; return q.length ? q.shift() : null; };
  a.S.orders = [{ id:'o1', items:items }];
  return { a:a, toasts:toasts, saved:function(){ return saved; }, asked:function(){ return asked; } };
}
function _gItem(desc, metal, purity){ return { desc:desc, metal:metal||'gold', purity:purity||'22K', estWt:5, qty:1 }; }

test('29 Oct assign: all weights blank -> no purity prompt, stages pushed without issued', function(){
  var t = _assignApp([_gItem('Ring'), _gItem('Chain')], ['Ramesh','Gold work','cash','500','','']);
  assert(t.a.assignOrderToKarigar('o1') === true && t.asked() === 6, 'expected exactly 6 prompts, got ' + t.asked());
  var s = t.a.S.orders[0].items[0].karigarStages[0];
  assert(s.karigarCost === 500 && !s.issued, 'no issued field when nothing handed over: ' + JSON.stringify(s));
});

test('29 Oct assign: per-item weights + one explicit purity; blank weight item stays unissued', function(){
  var t = _assignApp([_gItem('Ring'), _gItem('Chain')], ['Ramesh','Gold work','cash','500','10','','24k']);
  assert(t.a.assignOrderToKarigar('o1') === true, t.toasts.join(' | '));
  var s0 = t.a.S.orders[0].items[0].karigarStages[0], s1 = t.a.S.orders[0].items[1].karigarStages[0];
  assert(s0.issued.length === 1 && s0.issued[0].wt === 10 && s0.issued[0].purity === '24K' && !!s0.issued[0].date, JSON.stringify(s0));
  assert(!s1.issued, 'blank-weight item must not get an issued entry: ' + JSON.stringify(s1));
});

test('29 Oct assign: blank purity uses each item\'s own purity', function(){
  var t = _assignApp([_gItem('Payal','silver','925 Sterling')], ['Ramesh','Polish','cash','100','50','']);
  t.a.assignOrderToKarigar('o1');
  assert(t.a.S.orders[0].items[0].karigarStages[0].issued[0].purity === '925 Sterling', JSON.stringify(t.a.S.orders[0].items[0]));
});

test('29 Oct assign: wrong-metal purity or a bad weight cancels the WHOLE flow, nothing pushed or saved', function(){
  var t1 = _assignApp([_gItem('Ring'), _gItem('Payal','silver','925 Sterling')], ['Ramesh','Work','cash','100','5','50','24K']);
  assert(t1.a.assignOrderToKarigar('o1') === false && t1.saved() === 0, 'mixed metal + explicit 24K must cancel');
  assert(!t1.a.S.orders[0].items[0].karigarStages && /Payal/.test(t1.toasts[t1.toasts.length-1]), 'toast names the item: ' + t1.toasts.join(' | '));
  var t2 = _assignApp([_gItem('Ring')], ['Ramesh','Work','cash','100','abc']);
  assert(t2.a.assignOrderToKarigar('o1') === false && t2.saved() === 0, 'non-number weight cancels');
  var t3 = _assignApp([_gItem('Ring','gold','Gold Plated')], ['Ramesh','Work','cash','100','5','']);
  assert(t3.a.assignOrderToKarigar('o1') === false && t3.saved() === 0, 'plated item with a weight cancels');
});
```

- [ ] **Step 2:** Run and confirm they fail (no weight prompts exist yet, so the answers misalign).
- [ ] **Step 3: Implement.** In `assignOrderToKarigar`, insert directly **before** `var karigar = addOrGetKarigar(name);`:
```js
  // Karigar provenance (29 Oct): metal handed over, one weight per item
  // (blank = not yet), then ONE purity for the lump -- asked only if any
  // weight was entered, so the "not issuing yet" path costs only Enters.
  // All-or-nothing like the prompts above: nothing is pushed until all pass.
  var issueWts = [], issuePur = [], anyIssue = false;
  for(var ti=0; ti<targets.length; ti++){
    var tq = parseInt(targets[ti].qty) || 1;
    var wRaw = prompt('Metal handed over for item ' + (ti+1) + ' of ' + targets.length + ' — "' + (targets[ti].desc||'Item') + '" (grams' + (tq>1 ? ', total for all ' + tq + ' pieces' : '') + '). Leave blank if not handing metal over yet.', '');
    if(wRaw === null){ toast('Cancelled'); return false; }
    if(String(wRaw).trim() === ''){ issueWts.push(0); continue; }
    var w = parseFloat(wRaw);
    if(!(w > 0) || !isFinite(w)){ toast('Cancelled — enter a positive weight or leave it blank'); return false; }
    issueWts.push(w); anyIssue = true;
  }
  if(anyIssue){
    var pRaw = prompt('Purity of the metal handed over (e.g. 24K, 22K, 925 Sterling)? Leave blank to use each item\'s own purity.', '');
    if(pRaw === null){ toast('Cancelled'); return false; }
    var typed = String(pRaw).trim();
    for(var pi=0; pi<targets.length; pi++){
      if(!issueWts[pi]){ issuePur.push(''); continue; }
      var m = targets[pi].metal || 'gold';
      var key = karigarPurityKey(m, typed || targets[pi].purity);
      if(!key){ toast('Cancelled — ' + (typed || targets[pi].purity || 'that purity') + ' is not a valid purity for "' + (targets[pi].desc||'Item') + '" (' + m + ')'); return false; }
      issuePur.push(key);
    }
  }
```
Then change the push loop from `targets.forEach(function(it){` to:
```js
  targets.forEach(function(it, idx){
    it.karigarStages = it.karigarStages || [];
    var st = {task:task, karigarId:karigar.id, karigarPayMode:mode, karigarCost:cost, karigarWastagePct:pct, status:'assigned', assignedDate:dbDayKey(new Date())};
    if(issueWts[idx]) st.issued = [{ date:dbDayKey(new Date()), wt:issueWts[idx], purity:issuePur[idx] }];
    it.karigarStages.push(st);
  });
```
This replaces the existing two-line body exactly. Keep the existing `toast('✓ Assigned ...')` line byte-exact.
- [ ] **Step 4: Verify.** Run `node --check`, then the suite, then backup-check and roundtrip. For the screen check (Task 5's method), assign a 2-item tagged order: weight on item 1, blank on item 2, `24K`. Item 1's active line shows `Issued 10.00g (24K)` and item 2 shows nothing.
- [ ] **Step 5: Commit.** `git commit -m "Assign to Karigar: ask metal handed over per item + one purity for the lump"`

---

## Task 7: Order form stage editor — issuance inputs + save-time purity check  🟡

**Files:** Modify `js/03-billing-numbers.js` (`buildOrdItemRow()` Row 4b `_renderStages`, `saveOrder()`). Test: `tests/regression.test.js`.

- [ ] **Step 1: Failing tests**

```js
test('29 Oct form: saveOrder carries a stage\'s issued entry', function(){
  var t = _orderFormApp({ 'oi-desc-0':'Ring', 'of-cust':'Asha', 'of-delivery':'2099-01-01' });
  t.a.ordItems[0].karigarStages = [{ task:'Gold work', karigarId:'kar1', karigarPayMode:'cash', karigarCost:500, status:'assigned', assignedDate:'2026-10-29',
                                     issued:[{ date:'2026-10-29', wt:6, purity:'24K' }] }];
  t.a.saveOrder();
  var st = t.a.S.orders[t.a.S.orders.length-1].items[0].karigarStages[0];
  assert(t.saves() === 1 && st.issued[0].wt === 6 && st.issued[0].purity === '24K', JSON.stringify(st));
});

test('29 Oct form: an issued purity that no longer fits the item\'s metal blocks the save with a toast', function(){
  var t = _orderFormApp({ 'oi-desc-0':'Ring', 'of-cust':'Asha', 'of-delivery':'2099-01-01' });
  t.a.ordItems[0].karigarStages = [{ karigarId:'kar1', status:'assigned', issued:[{ date:'2026-10-29', wt:6, purity:'925 Sterling' }] }]; // gold item
  t.a.saveOrder();
  assert(t.saves() === 0 && /purity/i.test(t.msg()), 'expected a refusal, got saves=' + t.saves() + ' msg=' + t.msg());
  assert(!t.a._orderLocked('__new'), 'refusal must happen BEFORE the save lock is taken');
});
```
Check that `_orderLocked` is reachable from the harness (a top-level function in `04`). If it is not, drop that one assertion and say so.

- [ ] **Step 2:** Run. The second test fails. The first may already pass after Task 1, which is fine.
- [ ] **Step 3: Save-time check.** In `saveOrder()`, directly after the `if(_q>0 && _adv>_q){...return;}` line (before the past-date `safeConfirm` and before `_orderLock`), add:
```js
  // Karigar provenance (29 Oct): stage rows don't re-render when an item's
  // metal is changed, so an issued purity is re-checked against the item's
  // CURRENT metal here, before anything is locked or saved.
  var _badIssue=null;
  validItems.forEach(function(it){ (it.karigarStages||[]).forEach(function(st){ (st.issued||[]).forEach(function(e){
    if(!_badIssue && karigarFineOf(it.metal||'gold', e.purity, 1)===null) _badIssue=it;
  }); }); });
  if(_badIssue){toast('The metal-issued purity on "'+_badIssue.desc+'" does not match its metal ('+(_badIssue.metal||'gold')+') -- re-pick it in Karigar Stages.');return;}
```
- [ ] **Step 4: Inputs.** In `_renderStages`, inside the per-stage `forEach`, after the `rmBtn` lines and before `row.appendChild(taskI)...`, add:
```js
      // 29 Oct provenance: metal handed over with this stage (blank = none yet).
      // Wraps to its own line so the row stays usable on a phone.
      var issueLine=document.createElement('div'); issueLine.style.cssText='display:flex;gap:6px;align-items:center;flex-basis:100%;';
      var issLbl=document.createElement('span'); issLbl.style.cssText='font-size:11px;color:var(--text3);'; issLbl.textContent='Metal issued now:';
      var issW=document.createElement('input'); issW.type='text'; issW.setAttribute('inputmode','decimal'); issW.placeholder='g (blank = none)'; issW.style.width='110px';
      var issP=document.createElement('select'); issP.style.cssText='width:auto;padding:9px 28px 9px 8px;font-size:12px;';
      var _first=(stage.issued&&stage.issued[0])||null;
      issW.value=_first?_first.wt:'';
      Object.keys(PURITY_FINENESS[ordItems[i].metal==='silver'?'silver':'gold']).forEach(function(p){var op=document.createElement('option');op.value=p;op.textContent=p;if(p===((_first&&_first.purity)||ordItems[i].purity))op.selected=true;issP.appendChild(op);});
      (function(idx){
        function sync(){
          var w=parseFloat(issW.value);
          ordItems[i].karigarStages[idx].issued=(w>0&&isFinite(w))?[{date:dbDayKey(new Date()),wt:w,purity:issP.value}]:[];
        }
        issW.oninput=sync; issP.onchange=sync;
      })(si);
      issueLine.appendChild(issLbl); issueLine.appendChild(issW); issueLine.appendChild(issP);
      row.style.flexWrap='wrap';
```
and change the append line to end with `... row.appendChild(rmBtn); row.appendChild(issueLine);`.
- [ ] **Step 5: Verify.** Run `node --check`, then the suite, then `checks/ids.js` (no new hit: these elements have no ids), then backup-check and roundtrip. For the screen check: on New Order, add an item, add a stage, and type a karigar name. The second line shows the purity options for the item's metal. Enter 6 at `24K` and save. Open the order: the active line reads `Issued 6.00g (24K)`. That proves B1 and this task end to end. Also switch the item's metal to silver after picking `24K`, then save. You get the refusal toast, the form stays open, and Save works after re-picking. Check the layout at 375 px width.
- [ ] **Step 6: Commit.** `git commit -m "Order form: metal-issued weight+purity per karigar stage, checked on save"`

---

## Task 8: Karigar profile — editable name/phone/skills/note  🟢

**Files:** Modify `js/01-sync-core.js` (`updateKarigarProfile`, next to `findKarigar`) and `js/05-auth-login.js` (`renderKarigarList` card, new `toggleKarigarProfile`, `saveKarigarProfileForm`). Test: `tests/regression.test.js`.

- [ ] **Step 1: Failing test**

```js
test('29 Oct profile: updateKarigarProfile validates phone and name clash, mutates nothing on error', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  var k = a.addOrGetKarigar('Ramesh'); a.addOrGetKarigar('Suresh');
  var before = JSON.stringify(k);
  assert(a.updateKarigarProfile(k.id, { name:'Ramesh', phone:'12345' }) !== '', 'bad phone refused');
  assert(a.updateKarigarProfile(k.id, { name:' suresh ', phone:'' }) !== '', 'name clash refused (case/space-insensitive)');
  assert(a.updateKarigarProfile(k.id, { name:'', phone:'' }) !== '', 'blank name refused');
  assert(a.updateKarigarProfile('nope', { name:'X' }) !== '', 'unknown id -> error, no throw');
  assert(JSON.stringify(k) === before && saved === 0, 'errors must not mutate or save');
  assert(a.updateKarigarProfile(k.id, { name:'Ramesh Soni', phone:'+91 98765 43210', skills:' Kundan ', note:'20 yrs' }) === '', 'valid update');
  assert(k.name === 'Ramesh Soni' && k.phone === '9876543210' && k.skills === 'Kundan' && k.note === '20 yrs' && saved === 1, JSON.stringify(k));
  assert(a.updateKarigarProfile(k.id, { name:'Ramesh Soni', phone:'' }) === '' && k.phone === '', 'blank phone allowed');
});
```

- [ ] **Step 2:** Run and confirm it fails.
- [ ] **Step 3: Data function** (`01-sync-core.js`, after `findKarigar`):
```js
// Karigar profile (29 Oct): name/phone/skills/note. Returns '' on success
// (and saves), else an error string without mutating. Renaming is safe --
// stages reference karigarId -- but a clash is refused, or addOrGetKarigar
// would match either of the two by name from then on.
function updateKarigarProfile(id, f){
  var k = findKarigar(id);
  if(!k) return 'Karigar not found';
  var name = String(f.name||'').trim();
  if(!name) return 'Name is required';
  var clash = (S.karigars||[]).some(function(x){ return x.id !== id && String(x.name||'').trim().toLowerCase() === name.toLowerCase(); });
  if(clash) return 'Another karigar is already called ' + name;
  var ph = normPhone10(f.phone);
  if(ph === null) return 'Phone should be a 10-digit mobile number starting 6-9, like 98765 43210.';
  k.name = name; k.phone = ph; k.skills = String(f.skills||'').trim(); k.note = String(f.note||'').trim();
  saveToCloud(function(){});
  return '';
}
```
- [ ] **Step 4: Card UI** (`05-auth-login.js`). In `renderKarigarList`'s card string, directly after the header `</div>` (the one closing the name/"in progress" flex row), add:
```js
      ((k.phone||k.skills) ? '<div style="font-size:12px;color:var(--text3);margin-top:2px;">'+[k.phone?escHtml(k.phone):'', k.skills?escHtml(k.skills):''].filter(Boolean).join(' · ')+'</div>' : '')+
      (k.note ? '<div style="font-size:12px;color:var(--text3);font-style:italic;">'+escHtml(k.note)+'</div>' : '')+
```
After the Record Payment button, add an `Edit details` button and the hidden form:
```js
      '<button class="btn btn-sm" style="margin-top:8px;margin-left:6px;" onclick="toggleKarigarProfile(\''+jsAttrEsc(k.id)+'\')">Edit details</button>'+
      '<div id="kp-form-'+escHtml(k.id)+'" style="display:none;margin-top:8px;display:none;gap:8px;">'+
        ['name','phone','skills','note'].map(function(f){
          var ph = {name:'Name', phone:'Phone (10-digit mobile)', skills:'Skills, e.g. Kundan setting', note:'Notes: experience, address...'}[f];
          return '<input id="kp-'+f+'-'+escHtml(k.id)+'" type="text" placeholder="'+ph+'" value="'+escHtml(k[f]||'')+'" style="display:block;width:100%;margin-bottom:6px;padding:9px 12px;border-radius:9px;border:1px solid var(--border);background:var(--card2);color:var(--text1);font-family:inherit;">';
        }).join('')+
        '<div style="display:flex;gap:8px;"><button class="btn" style="flex:1;" onclick="toggleKarigarProfile(\''+jsAttrEsc(k.id)+'\')">Cancel</button>'+
        '<button class="btn btn-gold" style="flex:2;" onclick="saveKarigarProfileForm(\''+jsAttrEsc(k.id)+'\')">Save</button></div>'+
      '</div>'+
```
(Use a single `display:none;` in the style. The duplicate above is a typo to fix while editing.) The input styling is copied from `#set-invite-form`. After `renderKarigarList`, add:
```js
function toggleKarigarProfile(id){
  var f = document.getElementById('kp-form-'+id);
  if(f) f.style.display = (f.style.display === 'none') ? 'block' : 'none';
}

function saveKarigarProfileForm(id){
  function v(f){ var el = document.getElementById('kp-'+f+'-'+id); return el ? el.value : ''; }
  var err = updateKarigarProfile(id, { name:v('name'), phone:v('phone'), skills:v('skills'), note:v('note') });
  if(err){ toast(err); return; }
  renderKarigarList();
  toast('✓ Karigar details saved');
}
```
- [ ] **Step 5: Verify.** Run `node --check` on both files, then the suite, then `handlers.js` (the 3 new onclick targets resolve), then `unescaped-ids.js` (no new hits), then `ids.js` (`kp-*` string-joined ids are expected false positives; list them in the report). For the screen check: Karigars tab, Edit details, save a bad phone (toast, form stays), then a valid phone and skills `<i>x</i>` (rendered as literal text), then rename to an existing karigar's name (refused).
- [ ] **Step 6: Commit.** `git commit -m "Karigars tab: editable profile (name, phone, skills, note) inline on the card"`

---

## Task 9: Holding-now + minimal performance line  🟡

**Files:** Modify `js/01-sync-core.js` (`karigarStats`, additive keys only) and `js/05-auth-login.js` (`renderKarigarList`). Test: `tests/regression.test.js`.

- [ ] **Step 1: Failing test**

```js
test('29 Oct performance: karigarStats adds turnaround + per-metal shortfall keys, existing keys unchanged', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  a.S.orders = [{ id:'o1', items:[
    { metal:'gold', purity:'22K', estWt:10, qty:1, karigarStages:[{ karigarId:k.id, karigarPayMode:'cash', karigarCost:100, status:'submitted', assignedDate:'2026-10-01', submittedDate:'2026-10-07',
        issued:[{wt:10,purity:'22K'}], receivedWt:8 }] },                                   // 6 days, 1.832g gold short
    { metal:'silver', purity:'925 Sterling', estWt:50, qty:1, karigarStages:[{ karigarId:k.id, karigarPayMode:'cash', karigarCost:50, status:'submitted', assignedDate:'2026-10-10', submittedDate:'2026-10-12',
        issued:[{wt:50,purity:'925 Sterling'}], receivedWt:40 }] },                          // 2 days, 9.25g silver short
    { metal:'gold', purity:'22K', estWt:5, qty:1, karigarStages:[{ karigarId:k.id, karigarPayMode:'cash', karigarCost:10, status:'submitted', submittedDate:'2026-10-12' }] } // legacy: no assignedDate, no issuance
  ]}];
  var s = a.karigarStats(k.id);
  assert(s.piecesSubmitted === 3 && s.cash === 160, 'existing keys unchanged: ' + JSON.stringify(s));
  assert(s.daysTotal === 8 && s.daysCount === 2, 'turnaround only where both dates exist: ' + JSON.stringify(s));
  assert(approxEqual(s.shortGold, 2*0.916, 1e-9) && approxEqual(s.shortSilver, 10*0.925, 1e-9) && s.shortJobs === 2, 'gold and silver short kept apart: ' + JSON.stringify(s));
});
```

- [ ] **Step 2:** Run and confirm it fails.
- [ ] **Step 3: Implement.** In `karigarStats`, change the `out` initialiser to
```js
  var out = { piecesSubmitted:0, cash:0, gold:0, silver:0, daysTotal:0, daysCount:0, shortGold:0, shortSilver:0, shortJobs:0 };
```
and directly after `out.piecesSubmitted++;` add:
```js
    // 29 Oct, minimal performance (spec gap 4): turnaround from dates we
    // already store, and metal short beyond allowance from the receipt check.
    // Derived only -- no rating/score is stored anywhere.
    if(e.stage.assignedDate && e.stage.submittedDate){
      var days = (new Date(e.stage.submittedDate) - new Date(e.stage.assignedDate)) / 86400000;
      if(isFinite(days) && days >= 0){ out.daysTotal += days; out.daysCount++; }
    }
    var chk = karigarReceiptCheck(e.item, e.stage);
    if(chk && chk.band === 'short'){
      out.shortJobs++;
      if(chk.metal === 'silver') out.shortSilver += chk.shortFine; else out.shortGold += chk.shortFine;
    }
```
In `renderKarigarList`, add `var held = karigarMetalHeld(k.id);` next to `var queue = ...`. After the stats grid's closing `'</div>'+` (before the Record Payment button), add:
```js
      ((held.gold>0||held.silver>0) ? '<div style="margin-top:6px;font-size:13px;color:var(--warning);font-weight:600;">Holding now: '+fmtW(held.gold)+' gold · '+fmtW(held.silver)+' silver (fine)</div>' : '')+
      ((life.daysCount||life.shortJobs) ? '<div style="margin-top:4px;font-size:12px;color:var(--text3);">'+
        [life.daysCount ? 'Avg turnaround: '+(life.daysTotal/life.daysCount).toFixed(1)+' days ('+life.daysCount+' jobs)' : '',
         life.shortJobs ? 'Short beyond allowance: '+[life.shortGold>0?fmtW(life.shortGold)+' gold':'', life.shortSilver>0?fmtW(life.shortSilver)+' silver':''].filter(Boolean).join(' + ')+' ('+life.shortJobs+' jobs)' : ''
        ].filter(Boolean).join(' · ')+'</div>' : '')+
```
- [ ] **Step 4: Verify.** Run `node --check`. In the suite, the existing `karigarStats` month/lifetime test still passes unchanged. For the screen check, after Task 5's walk the Karigars card shows `Holding now:` while a stage is active and issued, and it disappears after Mark Submitted. The turnaround/short line appears. A karigar with only legacy data shows neither line.
- [ ] **Step 5: Commit.** `git commit -m "Karigars card: holding-now metal + turnaround/shortfall line (derived only)"`

---

## Task 10: Final gate before handing back  🔴 [Opus review]

- [ ] **Step 1:** Run `check.bat`. Diff it against Task 0's baseline. Expected changes: regression count = baseline + every new test, 0 failed. `ids.js` gains only the `kp-*` string-join false positives. `unescaped-ids.js` has no new hits. `unquoted-args.js` gains at most hits on the numeric `n` index. `backup-check` and `roundtrip` are **byte-identical** to baseline (no new top-level key). Anything else is a finding.
- [ ] **Step 2:** `npm run test:e2e`. None of its specs cover Orders/Karigars, but `sale.spec.js`/`failed-saves.spec.js` exercise `saveOrder`/billing paths near Tasks 1 and 7. They must stay green.
- [ ] **Step 3:** Agents: `jewelos-invariant-tester` (spec §6 invariants 1–7; it touches the order→sale path and a ledger balance), then `jewelos-test-runner` for an independent count. Then the Opus final review over the whole diff (memory standing rule).
- [ ] **Step 4: Screen walk** (`skills/verify-ui.md`), one pass across Tasks 5–9 in order: new order with an issued stage in the form, Assign to Karigar with metal, Issue Metal top-up and correction, receipt in each band, the Karigars card (holding, performance, profile edit), and **bill the order** (`convertToSale`, then Record Sale). Confirm the karigar's owed/stats did **not** double after billing (B2, on screen). Screenshot each step.
- [ ] **Step 5: Deploy gate (do not skip).** B2 lowers "Owed" for any live shop with a billed order carrying a submitted stage. The HANDOFF entry's `→ FOR COWORK:` line must ask Cowork to count shops with `orders[].billedSaleId` set **and** a submitted `karigarStages` entry, before deploy. If the count is non-zero, Tanish warns those shops first. One deploy zip, at session end only (`build-deploy-zip.js`, changelog per `skills/jewelos-dev.md`).
- [ ] **Step 6:** Write the HANDOFF entry (CLAUDE.md, the build session's job, not this plan's author). It says plainly what was **not** verified: no persisted e2e for Orders/Karigars (screen walk only), real-phone layout of the wrapped stage row, and the open wastage-convention question (spec gap 2). End with both hand-back lines.
