# Karigar Management Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated top-level Karigar Management module (new bottom-nav tab, own file) that handles two genuinely different karigar types — piece-rate ("wastage") and fixed-salary — with a per-karigar account page, an "Assign to Worker" entry point from Orders, and retirement of the Settings-card v1.

**Architecture:** Extends the already-shipped `S.karigars`/`S.karigarPayments`/`karigarStages` data model (no new top-level state arrays, no new persistence wiring needed — new fields on already-registered objects round-trip automatically). A new `js/11-karigar.js` owns the module's rendering; `js/01-sync-core.js` gains the type-aware cost/ledger math; `js/03-billing-numbers.js` and `js/04-orders-detail.js` get small, surgical additions at their existing karigar touchpoints; `js/05-auth-login.js` loses the Settings-card v1 it's replacing.

**Tech Stack:** Vanilla ES5 JavaScript, no framework, no build step. Test harness: `tests/regression.test.js` (Node VM sandbox loading the real `js/*.js` files — see `tests/harness.js`).

**Spec:** `docs/superpowers/specs/2026-10-28-karigar-management-module-design.md`

## Global Constraints

- **ES5 only.** No arrow functions, `let`/`const`, template literals, `async/await` (CLAUDE.md).
- **`escHtml()`** into any `innerHTML`; **`jsAttrEsc()`** into any inline `onclick="fn('...')"` (CLAUDE.md).
- **New module file is pre-approved.** Tanish signed off on `js/11-karigar.js` specifically (spec decision 7) — no further sign-off needed before Task 4.
- **No new persistence wiring required.** `S.karigars`/`S.karigarPayments` are already registered across all three persistence paths (cloud sync, offline cache, manual backup) — new fields on their existing objects (`type`, `monthlySalary`, `createdAt`, `period`, `haathLossPct`) need no additional code; `normaliseData()` does not strip unknown fields.
- **A salary-type karigar's stage is never cash/wastage-payable** — `karigarPayMode` must be forced to `'salary'` the instant a salary-type karigar is picked, in every entry point (spec decision 1).
- **Haath loss carries zero rupee value** — it must never be added to `karigarCostOf()`'s return value (spec decision 2/3).
- Run `node --check` on every touched file, then the full regression suite, after every task. `backup-check` and `roundtrip` (via `check.bat`) must stay clean.

## Review Focus

- A salary-type karigar assigned through the **old order-item form picker** (`js/03-billing-numbers.js`, predates this plan) must not be left payable in cash/wastage-% — that picker has no karigar-type awareness today.
- `karigarSalaryOwed()` must not throw or return `NaN` for a **brand-new salary karigar with zero payment history** — the first-use path, not just steady state.
- Switching a karigar's `type` **after** they already have real submitted wastage-mode stages (or vice versa) must not corrupt or misattribute that historical stage data — old stages keep their own locked `karigarPayMode`; only new assignments respect the karigar's current type.
- `karigarStats()` must report exactly `0` for cash/gold/silver on a salary-type karigar in every case, never leaking haath-loss weight into the earnings columns (a report reading the wrong field would make a salaried worker look piece-paid).
- The three **index-matched arrays** in `js/02-ui-inactivity-modals.js`'s `switchTab()` (scroll-save loop, panel-toggle loop, `.dtab`-active loop) must stay in exact lockstep with the new `.dtab` button's position in `index.html` — a mismatch breaks the desktop active-tab highlight for **every** tab, not just Karigar.

---

## Task 1: Type-aware karigar data model and cost/ledger math

**Files:**
- Modify: `js/01-sync-core.js:1025` (`addOrGetKarigar`), `:1794` (`karigarOwed`), `:1816` (`karigarStats`), `:1840` (`recordKarigarPayment`)
- Create (new functions, placed immediately after `karigarStageGrams` at `js/01-sync-core.js:1777` and immediately before `karigarOwed` at `:1794`): `updateKarigar`, `karigarForcesSalaryMode`, `karigarHaathLossGrams`, `karigarCreatedAt`, `karigarSalaryOwed`, `recordKarigarSalaryPayment`
- Test: `tests/regression.test.js` (append after the existing `recordKarigarPayment` test, before `Promise.all(asyncTests)`)

**Interfaces:**
- Consumes: `findKarigar(id)`, `S.karigars`, `S.karigarPayments`, `dbDayKey(date)`, `saveToCloud(cb)` — all pre-existing.
- Produces (for Tasks 2–6):
  - `updateKarigar(id, fields)` → merged karigar object, or `undefined` if `id` is unknown. `fields` may contain `name`/`phone`/`type`/`monthlySalary`.
  - `karigarForcesSalaryMode(karigarId)` → `true`/`false`. `true` means the UI must lock to salary mode and hide cash/wastage controls.
  - `karigarHaathLossGrams(item, stage)` → grams lost (`0` unless `stage.status==='submitted'` and `stage.karigarPayMode==='salary'`).
  - `karigarSalaryOwed(karigarId)` → ₹ due (`0` for a non-salary or unknown karigar).
  - `recordKarigarSalaryPayment(karigarId, period, amount, note)` → records a `type:'salary'` payment with that `period`.
  - `karigarOwed(karigarId)` → unchanged shape `{cash, gold, silver}`, now branches to `karigarSalaryOwed` for a salary-type karigar.
  - `karigarStats(karigarId, monthKey)` → shape grows to `{piecesSubmitted, cash, gold, silver, haathLossGold, haathLossSilver}`.
  - `recordKarigarPayment(karigarId, type, amount, note, period)` — gains an optional 5th `period` arg (backward compatible; existing 3-arg and 4-arg callers are unaffected).

- [ ] **Step 1: Write the failing tests**

Append to `tests/regression.test.js`, immediately before `Promise.all(asyncTests)`:

```js
test('addOrGetKarigar: new karigars default to wastage type with createdAt set', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  assert(k.type === 'wastage', 'a new karigar should default to wastage type: ' + JSON.stringify(k));
  assert(typeof k.createdAt === 'string' && k.createdAt.length > 0, 'a new karigar should have a createdAt timestamp: ' + JSON.stringify(k));
  assert(k.monthlySalary === 0, 'a new karigar should default monthlySalary to 0: ' + JSON.stringify(k));
});

test('updateKarigar: merges fields into an existing karigar and persists', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  var k = a.addOrGetKarigar('Suresh');
  var updated = a.updateKarigar(k.id, { type:'salary', monthlySalary:15000, phone:'9876543210' });
  assert(updated.type === 'salary' && updated.monthlySalary === 15000 && updated.phone === '9876543210', 'fields should merge: ' + JSON.stringify(updated));
  assert(a.findKarigar(k.id).type === 'salary', 'the change should be visible through findKarigar too');
  assert(saved === 1, 'should persist');
});

test('updateKarigar: returns undefined for an unknown id, never throws', function(){
  var a = loadApp();
  var result = a.updateKarigar('not-a-real-id', { type:'salary' });
  assert(result === undefined, 'an unknown id should return undefined, not throw or create a record');
  assert(a.S.karigars.length === 0, 'no karigar should be created');
});

test('karigarForcesSalaryMode: true for a salary-type karigar, false for wastage-type, unselected, or unknown', function(){
  var a = loadApp();
  var salaryK = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(salaryK.id, { type:'salary', monthlySalary:15000 });
  var wastageK = a.addOrGetKarigar('Ramesh');
  assert(a.karigarForcesSalaryMode(salaryK.id) === true, 'a salary-type karigar must force salary mode');
  assert(a.karigarForcesSalaryMode(wastageK.id) === false, 'a wastage-type karigar must not be forced');
  assert(a.karigarForcesSalaryMode('') === false, 'no karigar selected yet should not force anything');
  assert(a.karigarForcesSalaryMode('not-a-real-id') === false, 'an unknown id must not throw or force');
});

test('karigarStageCost: a salary-mode stage already costs 0 through the existing cash/wastage fallthrough (pinning test, no new branch needed)', function(){
  var a = loadApp();
  var item = { metal:'gold', weight:50, qty:3 };
  var stage = { karigarPayMode:'salary', status:'submitted', haathLossPct:5 };
  assert(a.karigarStageCost(item, stage) === 0, 'a salary-mode stage must never contribute an item cost');
});

test('karigarHaathLossGrams: computes the weight lost on a submitted salary-mode stage, 0 for anything else', function(){
  var a = loadApp();
  var item = { metal:'gold', weight:10, qty:2 };
  var submittedSalary = { karigarPayMode:'salary', status:'submitted', haathLossPct:2 };
  assert(a.karigarHaathLossGrams(item, submittedSalary) === 0.4, 'expected 2% of 10g * 2 qty = 0.4g, got ' + a.karigarHaathLossGrams(item, submittedSalary));

  var notSubmitted = { karigarPayMode:'salary', status:'assigned', haathLossPct:2 };
  assert(a.karigarHaathLossGrams(item, notSubmitted) === 0, 'an unsubmitted stage has no recorded loss yet');

  var wastageMode = { karigarPayMode:'wastage', status:'submitted', karigarWastagePct:4 };
  assert(a.karigarHaathLossGrams(item, wastageMode) === 0, 'haath loss only applies to salary-mode stages, not wastage-mode');
});

test('karigarSalaryOwed: a brand-new salary karigar with no history owes exactly one month, nothing paid', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:15000 });
  assert(a.karigarSalaryOwed(k.id) === 15000, 'a brand-new salary karigar should owe exactly one month\'s salary: ' + a.karigarSalaryOwed(k.id));
});

test('karigarSalaryOwed: nets recorded salary payments against months due, and returns 0 for a wastage-type or unknown karigar', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Dinesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:10000 });
  a.recordKarigarSalaryPayment(k.id, '2026-10', 10000, 'Oct salary');
  assert(a.karigarSalaryOwed(k.id) === 0, 'one month due minus one month paid should net to 0: ' + a.karigarSalaryOwed(k.id));

  var wastageKarigar = a.addOrGetKarigar('Ramesh');
  assert(a.karigarSalaryOwed(wastageKarigar.id) === 0, 'a wastage-type karigar owes nothing through the salary path');
  assert(a.karigarSalaryOwed('not-a-real-id') === 0, 'an unknown karigar id should return 0, not throw');
});

test('karigarOwed: branches to the salary ledger for a salary-type karigar, leaving gold/silver at 0', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:15000 });
  var owed = a.karigarOwed(k.id);
  assert(owed.cash === 15000, 'cash should equal the salary-ledger figure: ' + JSON.stringify(owed));
  assert(owed.gold === 0 && owed.silver === 0, 'a salary karigar never owes metal: ' + JSON.stringify(owed));
});

test('karigarStats: a salary-type karigar always reports 0 cash/gold/silver earned, and surfaces haath-loss weight instead', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:15000 });
  a.S.orders = [{ id:'o1', items:[{ metal:'gold', weight:10, qty:1, karigarStages:[
    { karigarId:k.id, karigarPayMode:'salary', status:'submitted', haathLossPct:2, submittedDate:'2026-10-27' }
  ] }] }];
  var stats = a.karigarStats(k.id);
  assert(stats.piecesSubmitted === 1, 'should still count pieces submitted: ' + JSON.stringify(stats));
  assert(stats.cash === 0 && stats.gold === 0 && stats.silver === 0, 'earnings columns must stay 0 for a salaried worker: ' + JSON.stringify(stats));
  assert(stats.haathLossGold === 0.2, 'expected 2% of 10g = 0.2g of gold haath-loss: ' + JSON.stringify(stats));
});

test('recordKarigarPayment: an optional period is stored when given, omitted otherwise', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  a.recordKarigarPayment(k.id, 'cash', 500, 'advance');
  a.recordKarigarPayment(k.id, 'salary', 15000, 'Oct', '2026-10');
  assert(!a.S.karigarPayments[0].period, 'a plain payment should not gain a period field: ' + JSON.stringify(a.S.karigarPayments[0]));
  assert(a.S.karigarPayments[1].period === '2026-10', 'a payment given a period should store it: ' + JSON.stringify(a.S.karigarPayments[1]));
});

test('recordKarigarSalaryPayment: wraps recordKarigarPayment with type salary and the given period', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  var k = a.addOrGetKarigar('Mahesh');
  a.recordKarigarSalaryPayment(k.id, '2026-10', 15000, 'October');
  assert(a.S.karigarPayments.length === 1, 'should append one payment');
  var p = a.S.karigarPayments[0];
  assert(p.karigarId === k.id && p.type === 'salary' && p.period === '2026-10' && p.amount === 15000 && p.note === 'October', 'payment fields wrong: ' + JSON.stringify(p));
  assert(saved === 1, 'should persist');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tests/regression.test.js`
Expected: the 12 new tests above show `✗`, each erroring with something like `a.updateKarigar is not a function` — except the `karigarStageCost` pinning test, which should already show `✓` (confirms the existing fallthrough already does the right thing, no code change needed there).

- [ ] **Step 3: Implement**

In `js/01-sync-core.js`, modify `addOrGetKarigar` (line 1025):

```js
function addOrGetKarigar(name){
  name = (name||'').trim();
  var existing = (S.karigars||[]).find(function(k){ return (k.name||'').trim().toLowerCase() === name.toLowerCase(); });
  if(existing) return existing;
  var k = { id: 'kar' + (Date.now()) + Math.floor(Math.random()*1000), name: name, phone: '', type: 'wastage', monthlySalary: 0, createdAt: new Date().toISOString() };
  S.karigars = S.karigars || [];
  S.karigars.push(k);
  return k;
}

// Explicit edit path for the module's "+ Add Karigar" / account-settings
// flow -- addOrGetKarigar above stays the implicit free-text auto-create
// used by order-item pickers, this is the one that sets type/monthlySalary.
function updateKarigar(id, fields){
  var k = findKarigar(id);
  if(!k) return undefined;
  ['name','phone','type','monthlySalary'].forEach(function(f){
    if(fields && fields[f] !== undefined) k[f] = fields[f];
  });
  saveToCloud(function(){});
  return k;
}

// A salary-type karigar is never paid cash/wastage-% per piece (28 Oct spec,
// decision 1) -- every entry point that lets you pick a karigar for a stage
// calls this first to decide whether to lock the UI to salary mode.
function karigarForcesSalaryMode(karigarId){
  var kg = findKarigar(karigarId);
  return !!(kg && kg.type === 'salary');
}
```

Immediately after `karigarStageGrams` (line 1777), before the `_allKarigarStageEntries` comment, insert:

```js
// Weight lost during a salary-type karigar's work (filing/polishing) -- pure
// metal-accounting, zero rupee value, never owed to the karigar (spec
// decision 2). Mirrors karigarStageGrams' math but keyed off haathLossPct/
// salary mode instead of karigarWastagePct/wastage mode.
function karigarHaathLossGrams(item, stage){
  if(stage.status !== 'submitted' || stage.karigarPayMode !== 'salary') return 0;
  var qty = parseInt(item.qty) || 1;
  var wt  = parseFloat(item.weight||item.estWt||item.orderWt) || 0;
  return (parseFloat(stage.haathLossPct)||0)/100 * wt * qty;
}
```

Immediately before `karigarOwed` (line 1794), insert:

```js
// A karigar's id encodes its creation timestamp ('kar'+Date.now()+rand) for
// every karigar created before this field existed -- fall back to parsing
// it rather than treating a pre-existing salary karigar as created "now"
// (which would silently owe them nothing on their very first salary check).
function karigarCreatedAt(k){
  if(k.createdAt) return new Date(k.createdAt);
  var ms = parseInt((k.id||'').replace(/^kar/,''), 10);
  return new Date(isNaN(ms) ? Date.now() : ms);
}

// One full monthlySalary becomes due the calendar month a salary-type
// karigar is created, and one more each month after -- no proration, no
// attendance/leave deduction (spec decision, 28 Oct, chosen over a model
// nothing in the brainstorm asked for). Not derived from stages at all; a
// salary karigar's cost is a fixed recurring expense, not tied to any piece.
function karigarSalaryOwed(karigarId){
  var k = findKarigar(karigarId);
  if(!k || k.type !== 'salary') return 0;
  var start = karigarCreatedAt(k);
  var now = new Date();
  var months = (now.getFullYear()-start.getFullYear())*12 + (now.getMonth()-start.getMonth()) + 1;
  if(months < 1) months = 1;
  var due = months * (parseFloat(k.monthlySalary)||0);
  var paid = (S.karigarPayments||[]).filter(function(p){ return p.karigarId===karigarId && p.type==='salary'; })
    .reduce(function(sum,p){ return sum + (parseFloat(p.amount)||0); }, 0);
  return due - paid;
}
```

Modify `karigarOwed` (now at a shifted line number — find it by its `function karigarOwed(karigarId){` signature) to branch at the top:

```js
function karigarOwed(karigarId){
  var k = findKarigar(karigarId);
  if(k && k.type === 'salary') return { cash: karigarSalaryOwed(karigarId), gold: 0, silver: 0 };
  var totals = { cash:0, gold:0, silver:0 };
  _allKarigarStageEntries().forEach(function(e){
    if(e.stage.karigarId !== karigarId) return;
    if(e.stage.status !== 'submitted') return;
    if(e.stage.karigarPayMode === 'cash'){
      totals.cash += karigarStageCost(e.item, e.stage);
    } else if(e.stage.karigarPayMode === 'wastage'){
      var grams = karigarStageGrams(e.item, e.stage);
      var metal = e.item.metal || 'gold';
      if(metal === 'silver') totals.silver += grams; else totals.gold += grams;
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
```

Modify `karigarStats` to add the haath-loss branch:

```js
function karigarStats(karigarId, monthKey){
  var out = { piecesSubmitted:0, cash:0, gold:0, silver:0, haathLossGold:0, haathLossSilver:0 };
  _allKarigarStageEntries().forEach(function(e){
    if(e.stage.karigarId !== karigarId) return;
    if(e.stage.status !== 'submitted') return;
    if(monthKey && (e.stage.submittedDate||'').slice(0,7) !== monthKey) return;
    out.piecesSubmitted++;
    if(e.stage.karigarPayMode === 'cash'){
      out.cash += karigarStageCost(e.item, e.stage);
    } else if(e.stage.karigarPayMode === 'wastage'){
      var grams = karigarStageGrams(e.item, e.stage);
      var metal = e.item.metal || 'gold';
      if(metal === 'silver') out.silver += grams; else out.gold += grams;
    } else if(e.stage.karigarPayMode === 'salary'){
      var lossGrams = karigarHaathLossGrams(e.item, e.stage);
      var lossMetal = e.item.metal || 'gold';
      if(lossMetal === 'silver') out.haathLossSilver += lossGrams; else out.haathLossGold += lossGrams;
    }
  });
  return out;
}
```

Modify `recordKarigarPayment` to accept the optional `period`, and add `recordKarigarSalaryPayment` right after it:

```js
function recordKarigarPayment(karigarId, type, amount, note, period){
  S.karigarPayments = S.karigarPayments || [];
  var entry = { id:'kp'+Date.now()+Math.floor(Math.random()*1000), karigarId:karigarId, date:dbDayKey(new Date()), type:type, amount:parseFloat(amount)||0, note:note||'' };
  if(period) entry.period = period;
  S.karigarPayments.push(entry);
  saveToCloud(function(){});
}

// Thin wrapper (spec decision): a salary payment is the same ledger entry
// shape as a cash/gold/silver one, just type:'salary' with a period attached.
function recordKarigarSalaryPayment(karigarId, period, amount, note){
  return recordKarigarPayment(karigarId, 'salary', amount, note, period);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/regression.test.js`
Expected: all new tests `✓`, full suite still shows `0 failed`.

- [ ] **Step 5: Verify and commit**

Run: `node --check js/01-sync-core.js`
Then run `check.bat` (or each `checks/*.js` individually) — confirm `backup-check` and `roundtrip` stay clean and no new AST-check hits.

```bash
git add js/01-sync-core.js tests/regression.test.js checks/globals.json
git commit -m "Add type-aware karigar cost/ledger math (wastage + salary)"
```

---

## Task 2: Order-item form picker respects karigar type

**Files:**
- Modify: `js/03-billing-numbers.js:1458-1472` (the per-stage picker inside `buildOrdItemRow`'s `_renderStages`)

**Interfaces:**
- Consumes: `findKarigar` (existing), `karigarForcesSalaryMode` (Task 1), `addOrGetKarigar` (existing).
- Produces: no new global functions — only DOM-wiring behavior inside the existing closure. (Task 1's `karigarForcesSalaryMode` is what's actually tested; this task's DOM output is not unit-testable through the harness's no-op `appendChild` — see `tests/harness.js`'s `makeFakeElement`. Covered instead by the live-screen check in Task 7.)

- [ ] **Step 1: Implement**

In `js/03-billing-numbers.js`, inside `buildOrdItemRow`'s `_renderStages` (around line 1458), replace:

```js
      var karI=document.createElement('input'); karI.type='text'; karI.placeholder='Karigar name';
      karI.value=(findKarigar(stage.karigarId)||{}).name||''; karI.style.flex='1';
      (function(idx){karI.onchange=function(){ordItems[i].karigarStages[idx].karigarId=addOrGetKarigar(this.value).id;};})(si);
      var modeSel=document.createElement('select'); modeSel.style.cssText='width:auto;padding:9px 28px 9px 8px;font-size:12px;';
      [['','Not set'],['cash','Cash ₹'],['wastage','Wastage %']].forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];if(o[0]===(stage.karigarPayMode||''))op.selected=true;modeSel.appendChild(op);});
      var cashI=document.createElement('input'); cashI.type='text'; cashI.setAttribute('inputmode','decimal');
      cashI.placeholder='₹ per piece'; cashI.value=stage.karigarCost>0?stage.karigarCost:''; cashI.style.cssText='width:80px;display:'+(stage.karigarPayMode==='cash'?'':'none');
      var wastI=document.createElement('input'); wastI.type='text'; wastI.setAttribute('inputmode','decimal');
      wastI.placeholder='% of weight'; wastI.value=stage.karigarWastagePct>0?stage.karigarWastagePct:''; wastI.style.cssText='width:80px;display:'+(stage.karigarPayMode==='wastage'?'':'none');
```

with:

```js
      var karI=document.createElement('input'); karI.type='text'; karI.placeholder='Karigar name';
      karI.value=(findKarigar(stage.karigarId)||{}).name||''; karI.style.flex='1';
      var modeSel=document.createElement('select'); modeSel.style.cssText='width:auto;padding:9px 28px 9px 8px;font-size:12px;';
      [['','Not set'],['cash','Cash ₹'],['wastage','Wastage %']].forEach(function(o){var op=document.createElement('option');op.value=o[0];op.textContent=o[1];if(o[0]===(stage.karigarPayMode||''))op.selected=true;modeSel.appendChild(op);});
      var cashI=document.createElement('input'); cashI.type='text'; cashI.setAttribute('inputmode','decimal');
      cashI.placeholder='₹ per piece'; cashI.value=stage.karigarCost>0?stage.karigarCost:''; cashI.style.cssText='width:80px;display:'+(stage.karigarPayMode==='cash'?'':'none');
      var wastI=document.createElement('input'); wastI.type='text'; wastI.setAttribute('inputmode','decimal');
      wastI.placeholder='% of weight'; wastI.value=stage.karigarWastagePct>0?stage.karigarWastagePct:''; wastI.style.cssText='width:80px;display:'+(stage.karigarPayMode==='wastage'?'':'none');
      var salaryNote=document.createElement('span'); salaryNote.textContent='Salary — haath loss recorded on submit'; salaryNote.style.cssText='font-size:11px;color:var(--text3);display:none;';
      // A salary-type karigar is never cash/wastage-paid per piece -- lock
      // the mode to 'salary' and hide the cash/wastage controls the moment
      // a salary-type karigar is picked (28 Oct, Karigar module spec).
      function applyKarigarTypeUI(karigarId){
        var isSalary = karigarForcesSalaryMode(karigarId);
        modeSel.style.display = isSalary ? 'none' : '';
        cashI.style.display   = (!isSalary && stage.karigarPayMode==='cash')    ? '' : 'none';
        wastI.style.display   = (!isSalary && stage.karigarPayMode==='wastage') ? '' : 'none';
        salaryNote.style.display = isSalary ? '' : 'none';
        if(isSalary) ordItems[i].karigarStages[si].karigarPayMode = 'salary';
      }
      applyKarigarTypeUI(stage.karigarId);
      (function(idx){karI.onchange=function(){
        var k = addOrGetKarigar(this.value);
        ordItems[i].karigarStages[idx].karigarId = k.id;
        applyKarigarTypeUI(k.id);
      };})(si);
```

Then find the line appending these elements to `row` (`row.appendChild(taskI); row.appendChild(karI); ...`) and add `row.appendChild(salaryNote);` to it, right after `row.appendChild(wastI);` and before `row.appendChild(rmBtn);`.

- [ ] **Step 2: Verify**

Run: `node --check js/03-billing-numbers.js`
Run: `node tests/regression.test.js` — expect no change in pass count (this task adds no new unit-testable surface, per the Interfaces note above); confirm `0 failed`.

- [ ] **Step 3: Commit**

```bash
git add js/03-billing-numbers.js
git commit -m "Order-item form: lock a salary-type karigar's stage to salary mode"
```

---

## Task 3: Order Detail — "Assign to Worker" and salary-aware "Mark Submitted"

**Files:**
- Modify: `js/04-orders-detail.js` (the item-row rendering inside `showOrderDetail`, around line 61-66; add new functions near `markStageSubmitted` at line 320)
- Test: `tests/regression.test.js`

**Interfaces:**
- Consumes: `addOrGetKarigar`, `findKarigar`, `karigarForcesSalaryMode` (Task 1), `markStageSubmitted` (existing, unchanged, still directly callable and still covered by its own 23 existing tests), `dbDayKey`, `saveToCloud`, `toast`.
- Produces: `promptAssignWorker(ordId, itemIdx)` → `boolean`. `promptMarkStageSubmitted(ordId, itemIdx)` → `boolean` (wraps `markStageSubmitted`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/regression.test.js`, after Task 1's tests:

```js
test('promptAssignWorker: wastage-type assignment prompts for mode and rate, pushes a stage', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', items:[{ desc:'Ring', karigarStages:[] }] }];
  var calls = 0;
  a.prompt = function(){ calls++; return ['Ramesh','wastage','4','Gold work'][calls-1]; };
  var ok = a.promptAssignWorker('o1', 0);
  assert(ok === true, 'should succeed');
  var stage = a.S.orders[0].items[0].karigarStages[0];
  assert(stage.karigarPayMode === 'wastage' && stage.karigarWastagePct === 4 && stage.status === 'assigned' && stage.task === 'Gold work', 'stage fields wrong: ' + JSON.stringify(stage));
});

test('promptAssignWorker: a salary-type karigar skips the mode/rate prompts entirely and locks to salary mode', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:15000 });
  a.S.orders = [{ id:'o1', items:[{ desc:'Ring', karigarStages:[] }] }];
  var calls = 0;
  a.prompt = function(){ calls++; return ['Mahesh','Gold work'][calls-1]; }; // only 2 prompts, no mode/rate
  var ok = a.promptAssignWorker('o1', 0);
  assert(ok === true, 'should succeed');
  var stage = a.S.orders[0].items[0].karigarStages[0];
  assert(stage.karigarPayMode === 'salary', 'a salary-type karigar\'s stage must be forced into salary mode: ' + JSON.stringify(stage));
  assert(calls === 2, 'should only prompt for name and task, never mode/rate, for a salary-type karigar: ' + calls + ' prompts');
});

test('promptAssignWorker: a non-finite or non-positive wastage rate cancels without pushing a stage', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', items:[{ desc:'Ring', karigarStages:[] }] }];
  var calls = 0;
  a.prompt = function(){ calls++; return ['Ramesh','wastage','Infinity'][calls-1]; };
  var ok = a.promptAssignWorker('o1', 0);
  assert(ok === false, 'an Infinity rate must cancel the assignment');
  assert(a.S.orders[0].items[0].karigarStages.length === 0, 'nothing should be pushed');
});

test('promptMarkStageSubmitted: a salary-mode stage prompts for haath-loss %, then submits', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', items:[{ metal:'gold', weight:10, qty:1, karigarStages:[
    { karigarPayMode:'salary', status:'assigned', task:'Polish' }
  ] }] }];
  a.prompt = function(){ return '1.5'; };
  var ok = a.promptMarkStageSubmitted('o1', 0);
  assert(ok === true, 'should succeed');
  var stage = a.S.orders[0].items[0].karigarStages[0];
  assert(stage.status === 'submitted' && stage.haathLossPct === 1.5, 'stage should be submitted with haath loss recorded: ' + JSON.stringify(stage));
});

test('promptMarkStageSubmitted: a wastage-mode stage submits without any haath-loss prompt', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', items:[{ metal:'gold', weight:10, qty:1, karigarStages:[
    { karigarPayMode:'wastage', karigarWastagePct:4, status:'assigned', task:'Setting' }
  ] }] }];
  var calls = 0;
  a.prompt = function(){ calls++; return '0'; };
  var ok = a.promptMarkStageSubmitted('o1', 0);
  assert(ok === true, 'should succeed');
  assert(calls === 0, 'a wastage-mode stage must not be asked for haath loss: ' + calls + ' prompts');
  assert(a.S.orders[0].items[0].karigarStages[0].status === 'submitted', 'should still submit');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/regression.test.js`
Expected: all 5 new tests `✗` (functions don't exist yet).

- [ ] **Step 3: Implement**

In `js/04-orders-detail.js`, immediately after `markStageSubmitted` (after its closing `}` at line 331), add:

```js
// A quick-assign entry point from Order Detail -- the item-form picker
// (03-billing-numbers.js) still works for setting this up at order-creation
// time; this is the after-the-fact path (28 Oct, Karigar module spec).
function promptAssignWorker(ordId, itemIdx){
  var o = (S.orders||[]).find(function(x){ return x.id===ordId; });
  if(!o || !o.items || !o.items[itemIdx]) return false;
  var name = prompt('Karigar name?');
  name = (name||'').trim();
  if(!name) return false;
  var k = addOrGetKarigar(name);
  var stage = { task:'', karigarId:k.id, karigarPayMode:'', karigarCost:0, karigarWastagePct:0, status:'assigned', assignedDate:dbDayKey(new Date()) };
  if(karigarForcesSalaryMode(k.id)){
    stage.karigarPayMode = 'salary';
  } else {
    var mode = prompt('Pay mode: cash or wastage?', 'wastage');
    mode = (mode||'').trim().toLowerCase();
    if(mode !== 'cash' && mode !== 'wastage'){ toast('Cancelled — pay mode must be cash or wastage'); return false; }
    stage.karigarPayMode = mode;
    if(mode === 'cash'){
      var cost = parseFloat(prompt('₹ per piece?'));
      if(!(cost > 0) || !isFinite(cost)){ toast('Cancelled — enter a positive amount'); return false; }
      stage.karigarCost = cost;
    } else {
      var pct = parseFloat(prompt('Wastage % of weight?'));
      if(!(pct > 0) || !isFinite(pct)){ toast('Cancelled — enter a positive percentage'); return false; }
      stage.karigarWastagePct = pct;
    }
  }
  stage.task = prompt('Task (e.g. Gold work)?', '') || '';
  o.items[itemIdx].karigarStages = o.items[itemIdx].karigarStages || [];
  o.items[itemIdx].karigarStages.push(stage);
  saveToCloud(function(){});
  return true;
}

// Wraps markStageSubmitted: a salary-mode stage needs a haath-loss figure
// recorded at submit time (it's a post-hoc measurement of actual metal
// lost, not knowable at assignment) -- everything else is unchanged.
function promptMarkStageSubmitted(ordId, itemIdx){
  var o = (S.orders||[]).find(function(x){ return x.id===ordId; });
  if(!o || !o.items || !o.items[itemIdx]) return false;
  var stages = o.items[itemIdx].karigarStages;
  if(!stages || !stages.length) return false;
  var stage = stages.find(function(s){ return s.status !== 'submitted'; });
  if(!stage) return false;
  if(stage.karigarPayMode === 'salary'){
    var pct = parseFloat(prompt('Haath loss % of weight (0 if none)?', '0'));
    if(!isFinite(pct) || pct < 0){ toast('Cancelled — enter 0 or a positive percentage'); return false; }
    stage.haathLossPct = pct;
  }
  return markStageSubmitted(ordId, itemIdx);
}
```

Then in `showOrderDetail` (around line 61-66), replace:

```js
        ((item.karigarStages||[]).some(function(s){return s.status!=='submitted';})
          ? '<div style="margin-top:6px;">'+
              '<span style="font-size:11px;color:var(--text3);">Active: '+escHtml((item.karigarStages.filter(function(s){return s.status!=='submitted';})[0]||{}).task||'Unassigned task')+'</span> '+
              '<button class="btn btn-sm" onclick="markStageSubmitted(\''+jsAttrEsc(o.id)+'\','+n+');showOrderDetail(\''+jsAttrEsc(o.id)+'\');">Mark Submitted</button>'+
            '</div>'
          : '');
```

with:

```js
        ((item.karigarStages||[]).some(function(s){return s.status!=='submitted';})
          ? '<div style="margin-top:6px;">'+
              '<span style="font-size:11px;color:var(--text3);">Active: '+escHtml((item.karigarStages.filter(function(s){return s.status!=='submitted';})[0]||{}).task||'Unassigned task')+'</span> '+
              '<button class="btn btn-sm" onclick="promptMarkStageSubmitted(\''+jsAttrEsc(o.id)+'\','+n+');showOrderDetail(\''+jsAttrEsc(o.id)+'\');">Mark Submitted</button>'+
            '</div>'
          : '<div style="margin-top:6px;">'+
              '<button class="btn btn-sm" onclick="promptAssignWorker(\''+jsAttrEsc(o.id)+'\','+n+');showOrderDetail(\''+jsAttrEsc(o.id)+'\');">Assign to Worker</button>'+
            '</div>');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/regression.test.js` — expect `✓` on all 5 new tests, `0 failed` overall, and all pre-existing `markStageSubmitted` tests still passing unchanged.

- [ ] **Step 5: Verify and commit**

Run: `node --check js/04-orders-detail.js`

```bash
git add js/04-orders-detail.js tests/regression.test.js checks/globals.json
git commit -m "Order Detail: Assign to Worker, and a salary-aware Mark Submitted"
```

---

## Task 4: Module skeleton — navigation, list view, add-karigar flow

**Files:**
- Modify: `index.html` (`.dtab` row ~1928, `.bnav`/more-menu ~3323, after `#panel-daybook` ~2985, script tags ~3544)
- Modify: `js/02-ui-inactivity-modals.js` (`renderTab` ~115, `switchTab`'s three arrays ~137/141/153, `moreBtn` array ~151, `staffBlocked` ~128)
- Create: `js/11-karigar.js`
- Test: `tests/regression.test.js`

**Interfaces:**
- Consumes: `S.karigars`, `karigarOwed`, `karigarQueue` (existing/Task 1), `addOrGetKarigar`, `updateKarigar` (Task 1), `fmt`, `escHtml`, `jsAttrEsc`, `toast` (existing).
- Produces (for Task 5): `renderKarigarModule()` (dispatch target), `renderKarigarListView()`, `openKarigarAccount(karigarId)`, `closeKarigarAccount()`, `promptAddKarigar()` → `boolean`. A placeholder `renderKarigarAccount(karigarId)` that Task 5 replaces.

- [ ] **Step 1: Write the failing tests**

Append to `tests/regression.test.js`, after Task 3's tests:

```js
test('renderKarigarListView: shows type badge, owed line (salary vs wastage), and a total-owed summary', function(){
  var a = loadApp();
  var w = a.addOrGetKarigar('Ramesh'); // wastage-type (default)
  var s = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(s.id, { type:'salary', monthlySalary:15000 });
  a.renderKarigarListView();
  var html = a.document.getElementById('karigar-list-body').innerHTML;
  assert(/Ramesh/.test(html) && /Wastage/.test(html), 'wastage-type karigar should show its badge: ' + html);
  assert(/Mahesh/.test(html) && /Salary/.test(html), 'salary-type karigar should show its badge: ' + html);
  assert(/Total owed right now/.test(html), 'should show a total-owed summary line: ' + html);
});

test('promptAddKarigar: wastage type skips the salary prompt; salary type requires a positive monthly amount', function(){
  var a = loadApp();
  var calls = 0;
  a.prompt = function(){ calls++; return ['Ramesh','wastage',''][calls-1]; }; // name, type, phone -- no salary prompt
  var ok = a.promptAddKarigar();
  assert(ok === true, 'should succeed');
  assert(calls === 3, 'a wastage-type karigar should only be asked name/type/phone: ' + calls + ' prompts');
  assert(a.findKarigar(a.S.karigars[0].id).type === 'wastage', 'should be wastage type');

  calls = 0;
  a.prompt = function(){ calls++; return ['Mahesh','salary','not-a-number'][calls-1]; };
  var failed = a.promptAddKarigar();
  assert(failed === false, 'a non-numeric salary must cancel, not create a broken karigar');
  assert(a.S.karigars.length === 1, 'the failed attempt must not have added a second karigar');
});

test('openKarigarAccount / closeKarigarAccount: toggles which view is visible', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  a.openKarigarAccount(k.id);
  assert(a.document.getElementById('karigar-list-view').style.display === 'none', 'list view should hide');
  assert(a.document.getElementById('karigar-account-view').style.display === '', 'account view should show');
  a.closeKarigarAccount();
  assert(a.document.getElementById('karigar-list-view').style.display === '', 'list view should show again');
  assert(a.document.getElementById('karigar-account-view').style.display === 'none', 'account view should hide again');
});

test('renderKarigarModule: always lands on the list view, never a stale account view', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh');
  a.openKarigarAccount(k.id); // simulate having been on the account view
  a.renderKarigarModule();
  assert(a.document.getElementById('karigar-list-view').style.display === '', 'should show the list view');
  assert(a.document.getElementById('karigar-account-view').style.display === 'none', 'should hide the account view');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/regression.test.js`
Expected: all 4 new tests `✗` — `document.getElementById('karigar-list-body')` etc. will be `null`/throw since neither the HTML shell nor the JS functions exist yet.

- [ ] **Step 3: Implement — `index.html`**

In the `.dtabs` block (around line 1928), between the Day Book and Settings buttons, insert:

```html
    <button class="dtab" onclick="switchTab('karigar')"><span data-icon="gem"></span> Karigar</button>
```

In the More-sheet (around line 3323), between the Reports and Settings buttons, insert:

```html
      <button class="more-menu-item" onclick="switchTab('karigar');closeMoreMenu();" id="bn-karigar"><span class="bnav-icon" data-icon="gem"></span><span>Karigar</span></button>
```

Immediately after `#panel-daybook`'s closing `</div>` (line 2985), before the `<!-- DAY BOOK MODALS -->` comment, insert:

```html
<div id="panel-karigar" class="panel">
  <div id="karigar-list-view">
    <div class="card-title">Karigars</div>
    <button class="btn btn-gold" onclick="promptAddKarigar()" style="margin-bottom:10px;">+ Add Karigar</button>
    <div id="karigar-list-body"></div>
  </div>
  <div id="karigar-account-view" style="display:none;">
    <button class="btn btn-sm" onclick="closeKarigarAccount()" style="margin-bottom:10px;">&larr; Back to Karigars</button>
    <div id="karigar-account-body"></div>
  </div>
</div>
```

After `<script src="js/10-daybook.js"></script>` (line 3544), insert:

```html
  <script src="js/11-karigar.js"></script>
```

- [ ] **Step 4: Implement — `js/02-ui-inactivity-modals.js`**

In `renderTab` (line 115), add one line before the closing `}`:

```js
  else if(tab==='karigar')renderKarigarModule();
```

In `switchTab`, update `staffBlocked` (line 128):

```js
  var staffBlocked = ['reports','customers','girvi','settings','karigar'];
```

Update the scroll-save loop (line 137), panel-toggle loop (line 141), and `.dtab`-active loop's array literal (inside line 153) — all three must get the identical insertion, `'karigar'` between `'daybook'` and `'settings'`:

```js
  ['dashboard','inventory','sales','orders','girvi','customers','reports','daybook','karigar','settings'].forEach(function(t){
```

(appears at line 137 and again at line 141 — update both)

```js
  document.querySelectorAll('.dtab').forEach(function(el,i){
    el.classList.toggle('active',['dashboard','inventory','sales','orders','girvi','customers','reports','daybook','karigar','settings'][i]===tab);
  });
```

Update the `moreBtn` active-check array (line 151):

```js
  if(moreBtn) moreBtn.classList.toggle('active',['girvi','orders','customers','reports','settings','karigar'].indexOf(tab)!==-1);
```

- [ ] **Step 5: Implement — `js/11-karigar.js` (new file)**

```js
// ── KARIGAR MANAGEMENT MODULE ──────────────────────────────────────────
// Top-level module (28 Oct) -- list + per-karigar account, same standing as
// Girvi/Orders. Everything here is a live derived view over S.karigars/
// S.orders/S.sales/S.karigarPayments (see 01-sync-core.js's karigarOwed/
// karigarStats/karigarQueue) -- nothing is kept pre-computed, same reasoning
// as pbSupplierLedgerHtml (09-purchases.js).

var _karigarActiveId = null;

function renderKarigarModule(){
  closeKarigarAccount(); // always land on the list when entering the tab
  renderKarigarListView();
}

function renderKarigarListView(){
  var wrap = document.getElementById('karigar-list-body');
  if(!wrap) return;
  var totalOwed = (S.karigars||[]).reduce(function(sum,k){
    return sum + karigarOwed(k.id).cash; // cash is the one ₹ figure every karigar type has
  }, 0);
  var summary = '<div style="margin-bottom:10px;font-size:13px;color:var(--text3);">Total owed right now: <strong style="color:var(--gold-dark);">'+fmt(totalOwed)+'</strong></div>';
  var cards = (S.karigars||[]).map(function(k){
    var owed = karigarOwed(k.id);
    var queueLen = karigarQueue(k.id).length;
    var typeLabel = k.type==='salary' ? 'Salary' : 'Wastage';
    var owedLine = k.type==='salary'
      ? 'Owed: <b>'+fmt(owed.cash)+'</b>'
      : 'Owed cash: '+fmt(owed.cash)+' &bull; gold: '+owed.gold.toFixed(2)+'g &bull; silver: '+owed.silver.toFixed(2)+'g';
    return '<div class="card" style="margin-bottom:10px;cursor:pointer;" onclick="openKarigarAccount(\''+jsAttrEsc(k.id)+'\')">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;">'+
        '<strong>'+escHtml(k.name)+'</strong>'+
        '<span class="role-badge" style="font-size:11px;">'+typeLabel+'</span>'+
      '</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:4px;">'+queueLen+' in progress &bull; '+owedLine+'</div>'+
    '</div>';
  }).join('') || '<div style="color:var(--text3);padding:12px;">No karigars yet.</div>';
  wrap.innerHTML = summary + cards;
}

// A minimal prompt-based entry point for v1, same convention as the
// existing prompt-chain flows elsewhere in this app -- a full modal form is
// a later polish pass, not required for the core workflow.
function promptAddKarigar(){
  var name = prompt('Karigar name?');
  name = (name||'').trim();
  if(!name) return false;
  var k = addOrGetKarigar(name);
  var type = prompt('Type: wastage or salary?', 'wastage');
  type = (type||'').trim().toLowerCase();
  if(type !== 'wastage' && type !== 'salary'){ toast('Cancelled — type must be wastage or salary'); return false; }
  var fields = { type: type };
  if(type === 'salary'){
    var salary = parseFloat(prompt('Monthly salary (₹)?'));
    if(!(salary > 0) || !isFinite(salary)){ toast('Cancelled — enter a positive monthly salary'); return false; }
    fields.monthlySalary = salary;
  }
  fields.phone = prompt('Phone (optional):', '') || '';
  updateKarigar(k.id, fields);
  renderKarigarListView();
  toast('✓ Karigar added');
  return true;
}

function openKarigarAccount(karigarId){
  _karigarActiveId = karigarId;
  var listEl = document.getElementById('karigar-list-view');
  var accEl = document.getElementById('karigar-account-view');
  if(!listEl || !accEl) return;
  if(karigarId){
    listEl.style.display = 'none';
    accEl.style.display = '';
    renderKarigarAccount(karigarId);
  } else {
    listEl.style.display = '';
    accEl.style.display = 'none';
  }
}

function closeKarigarAccount(){
  openKarigarAccount(null);
}

// Placeholder -- Task 5 replaces this with the real account view. Kept here
// so openKarigarAccount doesn't throw before Task 5 lands.
function renderKarigarAccount(karigarId){
  var body = document.getElementById('karigar-account-body');
  if(body) body.innerHTML = '';
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node tests/regression.test.js` — expect all 4 new tests `✓`, `0 failed` overall.

- [ ] **Step 7: Verify and commit**

Run: `node --check js/11-karigar.js && node --check js/02-ui-inactivity-modals.js`

Manually confirm the three `switchTab` arrays and the `.dtab` button order are in lockstep (Review Focus item): `grep -n "daybook','karigar','settings" js/02-ui-inactivity-modals.js` should show exactly 3 matches (scroll-save loop, panel-toggle loop, dtab-active loop) plus the `moreBtn` line should separately include `'karigar'`.

```bash
git add index.html js/02-ui-inactivity-modals.js js/11-karigar.js tests/regression.test.js checks/globals.json
git commit -m "Add Karigar module: nav wiring, list view, add-karigar flow"
```

---

## Task 5: Account view and type-aware payment recording

**Files:**
- Modify: `js/11-karigar.js` (replace the `renderKarigarAccount` placeholder, add `promptRecordKarigarPayment`)
- Test: `tests/regression.test.js`

**Interfaces:**
- Consumes: `findKarigar`, `karigarOwed`, `karigarStats`, `karigarQueue`, `recordKarigarPayment`, `recordKarigarSalaryPayment` (Task 1), `openKarigarAccount`/`closeKarigarAccount` (Task 4), `dbDayKey`, `fmt`, `escHtml`, `jsAttrEsc`, `toast`, `confirm`.
- Produces: `renderKarigarAccount(karigarId)` (real implementation, replacing Task 4's placeholder), `promptRecordKarigarPayment(karigarId)` → `boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/regression.test.js`, after Task 4's tests:

```js
test('renderKarigarAccount: shows queue, type-appropriate ledger line, and the right payment button label', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:15000 });
  a.S.orders = [{ id:'o1', ordNo:'ORD-1', items:[{ desc:'Ring', karigarStages:[{ karigarId:k.id, karigarPayMode:'salary', status:'assigned', task:'Polish' }] }] }];
  a.renderKarigarAccount(k.id);
  var html = a.document.getElementById('karigar-account-body').innerHTML;
  assert(/ORD-1/.test(html) && /Polish/.test(html), 'should list the in-progress stage: ' + html);
  assert(/Record Salary Payment/.test(html), 'a salary-type karigar should get the salary-labeled button: ' + html);
  assert(!/Owed cash:/.test(html), 'a salary-type karigar should not show the wastage-style cash/gold/silver breakdown: ' + html);
});

test('renderKarigarAccount: an unknown id shows a not-found message instead of throwing', function(){
  var a = loadApp();
  a.renderKarigarAccount('not-a-real-id');
  var html = a.document.getElementById('karigar-account-body').innerHTML;
  assert(/not found/i.test(html), 'should show a not-found message: ' + html);
});

test('promptRecordKarigarPayment: a salary-type karigar requires a YYYY-MM period and a confirm step', function(){
  var a = loadApp(), saved = 0;
  a.saveToCloud = function(cb){ saved++; cb && cb(null); };
  var k = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:15000 });
  var calls = 0;
  a.prompt = function(){ calls++; return ['2026-10','15000',''][calls-1]; };
  var confirmed = false;
  a.confirm = function(){ confirmed = true; return true; };
  var ok = a.promptRecordKarigarPayment(k.id);
  assert(ok === true, 'should succeed');
  assert(confirmed === true, 'must confirm before recording');
  assert(a.S.karigarPayments[0].type === 'salary' && a.S.karigarPayments[0].period === '2026-10', 'payment fields wrong: ' + JSON.stringify(a.S.karigarPayments[0]));
});

test('promptRecordKarigarPayment: a malformed period is rejected and records nothing', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Mahesh');
  a.updateKarigar(k.id, { type:'salary', monthlySalary:15000 });
  a.prompt = function(){ return 'October'; }; // not YYYY-MM
  var ok = a.promptRecordKarigarPayment(k.id);
  assert(ok === false, 'a malformed period must be rejected');
  assert(a.S.karigarPayments.length === 0, 'nothing should be recorded');
});

test('promptRecordKarigarPayment: a wastage-type karigar still goes through the cash/gold/silver flow unchanged', function(){
  var a = loadApp();
  var k = a.addOrGetKarigar('Ramesh'); // default wastage type
  var calls = 0;
  a.prompt = function(){ calls++; return ['cash','500',''][calls-1]; };
  a.confirm = function(){ return true; };
  var ok = a.promptRecordKarigarPayment(k.id);
  assert(ok === true, 'should succeed');
  assert(a.S.karigarPayments[0].type === 'cash' && a.S.karigarPayments[0].amount === 500, 'should record a plain cash payment: ' + JSON.stringify(a.S.karigarPayments[0]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/regression.test.js`
Expected: all 5 new tests `✗` (`renderKarigarAccount` still the empty placeholder, `promptRecordKarigarPayment` doesn't exist).

- [ ] **Step 3: Implement**

In `js/11-karigar.js`, replace the placeholder `renderKarigarAccount` with:

```js
function renderKarigarAccount(karigarId){
  var body = document.getElementById('karigar-account-body');
  if(!body) return;
  var k = findKarigar(karigarId);
  if(!k){ body.innerHTML = '<div style="color:var(--text3);">Karigar not found.</div>'; return; }
  var owed = karigarOwed(karigarId);
  var month = karigarStats(karigarId, dbDayKey(new Date()).slice(0,7));
  var life = karigarStats(karigarId);
  var queue = karigarQueue(karigarId);
  var typeLabel = k.type==='salary' ? 'Salary — ₹'+fmt(k.monthlySalary)+'/month' : 'Wastage (piece-rate)';

  var html = '<div class="card" style="margin-bottom:10px;">'+
    '<strong style="font-size:16px;">'+escHtml(k.name)+'</strong>'+
    (k.phone?' <span style="font-size:12px;color:var(--text3);">&bull; '+escHtml(k.phone)+'</span>':'')+
    '<div style="font-size:12px;color:var(--text3);margin-top:4px;">'+escHtml(typeLabel)+'</div>'+
  '</div>';

  html += '<div class="card" style="margin-bottom:10px;">'+
    '<div class="card-title">Currently Assigned ('+queue.length+')</div>'+
    (queue.length
      ? queue.map(function(q){ return '<div style="font-size:12px;padding:4px 0;border-bottom:0.5px solid var(--border);">'+escHtml(q.ordNo)+' &bull; '+escHtml(q.itemName)+' &bull; '+escHtml(q.task||'Unassigned task')+'</div>'; }).join('')
      : '<div style="font-size:12px;color:var(--text3);">Nothing in progress.</div>')+
  '</div>';

  var owedLine = k.type==='salary'
    ? 'Owed: <b>'+fmt(owed.cash)+'</b>'
    : 'Owed cash: '+fmt(owed.cash)+' &bull; gold: '+owed.gold.toFixed(2)+'g &bull; silver: '+owed.silver.toFixed(2)+'g';
  var monthLine = k.type==='salary'
    ? month.piecesSubmitted+' pieces this month &bull; haath loss '+month.haathLossGold.toFixed(2)+'g gold, '+month.haathLossSilver.toFixed(2)+'g silver'
    : month.piecesSubmitted+' pieces, '+fmt(month.cash)+' cash, '+month.gold.toFixed(2)+'g gold, '+month.silver.toFixed(2)+'g silver';
  var lifeLine = k.type==='salary'
    ? life.piecesSubmitted+' pieces lifetime &bull; haath loss '+life.haathLossGold.toFixed(2)+'g gold, '+life.haathLossSilver.toFixed(2)+'g silver'
    : life.piecesSubmitted+' pieces, '+fmt(life.cash)+' cash, '+life.gold.toFixed(2)+'g gold, '+life.silver.toFixed(2)+'g silver';

  html += '<div class="card" style="margin-bottom:10px;">'+
    '<div class="card-title">Ledger</div>'+
    '<div style="font-size:13px;">'+owedLine+'</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-top:6px;">This month: '+monthLine+'</div>'+
    '<div style="font-size:12px;color:var(--text3);">Lifetime: '+lifeLine+'</div>'+
    '<button class="btn btn-sm" style="margin-top:8px;" onclick="promptRecordKarigarPayment(\''+jsAttrEsc(k.id)+'\')">'+(k.type==='salary'?'Record Salary Payment':'Record Payment')+'</button>'+
  '</div>';

  body.innerHTML = html;
}

// Type-aware: a wastage-type karigar is paid cash/gold/silver per the
// existing ledger (same guard rails as the retired Settings-card v1's Opus
// review -- confirm before recording, reject a non-finite amount, trim/
// lowercase the type). A salary-type karigar records a period + amount.
function promptRecordKarigarPayment(karigarId){
  var k = findKarigar(karigarId);
  if(!k) return false;
  if(k.type === 'salary'){
    var period = prompt('Which month (YYYY-MM)?', dbDayKey(new Date()).slice(0,7));
    period = (period||'').trim();
    if(!/^\d{4}-\d{2}$/.test(period)){ toast('Cancelled — enter a month as YYYY-MM'); return false; }
    var amount = parseFloat(prompt('Amount paid (₹)?', String(k.monthlySalary||'')));
    if(!(amount > 0) || !isFinite(amount)){ toast('Cancelled — enter a positive amount'); return false; }
    var note = prompt('Note (optional):', '') || '';
    if(!confirm('Record '+fmt(amount)+' salary for '+period+'? This cannot be undone.')) { toast('Cancelled'); return false; }
    recordKarigarSalaryPayment(karigarId, period, amount, note);
    renderKarigarAccount(karigarId);
    renderKarigarListView();
    toast('✓ Salary payment recorded');
    return true;
  }
  var type = prompt('Payment type: cash, gold, or silver?', 'cash');
  type = (type||'').trim().toLowerCase();
  if(!type || ['cash','gold','silver'].indexOf(type)===-1){ toast('Cancelled — type must be cash, gold, or silver'); return false; }
  var amt = parseFloat(prompt(type==='cash' ? 'Amount paid (₹)?' : 'Weight handed over (grams)?'));
  if(!(amt > 0) || !isFinite(amt)){ toast('Cancelled — enter a positive amount'); return false; }
  var note2 = prompt('Note (optional):','') || '';
  if(!confirm('Record '+(type==='cash' ? fmt(amt) : amt+'g '+type)+' to this karigar? This cannot be undone.')) { toast('Cancelled'); return false; }
  recordKarigarPayment(karigarId, type, amt, note2);
  renderKarigarAccount(karigarId);
  renderKarigarListView();
  toast('✓ Payment recorded');
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/regression.test.js` — expect all 5 new tests `✓`, `0 failed` overall.

- [ ] **Step 5: Verify and commit**

Run: `node --check js/11-karigar.js`

```bash
git add js/11-karigar.js tests/regression.test.js checks/globals.json
git commit -m "Add Karigar account view and type-aware payment recording"
```

---

## Task 6: Retire the Settings → Team karigar card

**Files:**
- Modify: `js/05-auth-login.js` (remove `renderKarigarList`, `promptKarigarPayment`, and the `renderKarigarList();` call site)
- Modify: `index.html` (remove the "Karigars" card from `#stab-team`)
- Modify: `tests/regression.test.js` (remove the 3 now-obsolete tests for the retired functions)

This task is pure removal, not new behavior — no TDD red/green cycle; steps go removal → verify nothing references the retired names → full suite → commit.

- [ ] **Step 1: Remove the retired functions from `js/05-auth-login.js`**

Remove the call site:

```js
  // Karigar Management (27 Oct): one card per karigar, same derived-not-stored
  // principle as pbSupplierLedgerHtml (09-purchases.js) -- nothing here is
  // kept pre-computed, karigarOwed/karigarStats/karigarQueue scan the real
  // records fresh every render.
  renderKarigarList();
```

(the 4-line comment plus the call, right before `renderSettings`'s closing `}`)

Remove the two functions in their entirety — from the `// Karigar Management (27 Oct): one card per karigar...` comment immediately above `function renderKarigarList(){` through the closing `}` of `promptKarigarPayment` (inclusive of both functions' leading comments).

- [ ] **Step 2: Remove the card markup from `index.html`**

Remove, from inside `#stab-team`:

```html
    <div class="card">
      <div class="card-title">Karigars</div>
      <div id="karigar-list"></div>
    </div>
```

- [ ] **Step 3: Remove the obsolete tests from `tests/regression.test.js`**

Delete these three tests in their entirety (added in the earlier Task 7 fix round for the now-retired Settings card — their subject matter is fully covered by Task 4/5's `promptAddKarigar`/`promptRecordKarigarPayment`/`renderKarigarListView`/`renderKarigarAccount` tests):

- `'promptKarigarPayment: a non-finite or non-positive amount is rejected and never recorded'`
- `'promptKarigarPayment: trims/lowercases the type and requires confirm before recording'`
- `'renderKarigarList: escapes the karigar name and keeps cash/gold/silver owed buckets separate'`

- [ ] **Step 4: Verify nothing else references the retired names**

Run: `grep -rn "karigar-list\b\|renderKarigarList\|promptKarigarPayment" js/*.js index.html tests/regression.test.js`
Expected: no output (the only remaining `karigar-list-*` ids are `karigar-list-view`/`karigar-list-body` from Task 4, which won't match `karigar-list\b`).

- [ ] **Step 5: Run the full suite**

Run: `node tests/regression.test.js`
Expected: `0 failed`; total test count is 3 lower than after Task 5 (the removed obsolete tests), with every Task 1–5 test still passing.

Run: `node --check js/05-auth-login.js`

- [ ] **Step 6: Commit**

```bash
git add js/05-auth-login.js index.html tests/regression.test.js checks/globals.json
git commit -m "Retire the Settings -> Team karigar card (superseded by the Karigar module)"
```

---

## Task 7: Full-suite verification and a real-screen check

**Files:** none modified — verification only.

- [ ] **Step 1: Run the complete check suite**

Run `check.bat` (or each `checks/*.js` individually). Confirm: `backup-check` and `roundtrip` clean, no new AST-check hits beyond the documented baseline, full regression suite `0 failed`.

- [ ] **Step 2: Real-screen check against the local dev build**

Using the same throwaway-Playwright-against-`localhost:4173` pattern used for the Settings-card v1 (project's own isolated E2E test shop, per `tests/e2e/fixtures/testShop.js`): log in, create one order with two items — one assigned to a wastage-type karigar, one to a salary-type karigar — confirm the Order Detail buttons ("Assign to Worker" / "Mark Submitted") behave correctly for both, mark both stages submitted (confirming the haath-loss prompt appears only for the salary-type one), then open the Karigar tab and confirm both karigars' cards and account views render correctly, record one payment of each type through the real dialogs, and screenshot before/after. Delete the throwaway spec and screenshots after use, same as before — not a permanent suite addition.

- [ ] **Step 3: Report**

Summarize what was and wasn't verified (per CLAUDE.md's "never let a build sound more tested than it is"), including that the live Cloudflare Worker itself is not touched by this task — that's a separate deploy step after Tanish reviews the branch.

---

## Self-Review Notes

**Spec coverage:** every decision in the design spec (1–8) maps to a task — type field + cost math (Task 1), forced salary mode at both entry points (Tasks 2, 3), live derived view / no data duplication (Task 4/5, reusing `karigarQueue`/`karigarOwed` unchanged), Settings card retirement (Task 6), per-item assignment via Order Detail (Task 3), new-file justification (Task 4, pre-approved).

**Placeholder scan:** none — every step has real, complete code; Task 6 is deliberately structured as removal-only rather than forcing a TDD shape onto a deletion.

**Type consistency:** `karigarOwed`/`karigarStats` return shapes are defined once in Task 1 and consumed identically by Task 4/5's rendering — checked against each other. `promptMarkStageSubmitted`/`promptAssignWorker` (Task 3) and `karigarForcesSalaryMode` (Task 1) names match exactly everywhere they're called.

**Review Focus coverage:** all 5 items have an owning test — old-picker salary awareness (Task 2, plus Task 1's `karigarForcesSalaryMode` unit test since Task 2 itself isn't DOM-unit-testable), brand-new salary karigar with no history (Task 1), type-switch-after-history safety (implicit in Task 1's `karigarOwed`/`karigarStats` branching on the karigar's *current* type while stages keep their own locked `karigarPayMode` — not separately pinned with its own test; flagging this as the one gap worth a human's judgment call before implementation starts, not silently shipping it unverified), salary-type zeroing of cash/gold/silver (Task 1), and the three-array lockstep (Task 4, verified by grep in Step 7 rather than a unit test, since the arrays are DOM-rendering plumbing the harness can't exercise the same way).

---

Plan complete and saved to `docs/superpowers/plans/2026-10-28-karigar-management-module.md`. Please review it.

One gap flagged in self-review: no dedicated test pins "switching a karigar's type after they have real history doesn't corrupt old data" — I'm fairly confident it's safe by construction (old stages keep their own `karigarPayMode`, `karigarOwed`/`karigarStats` only branch on the karigar's *current* `type`), but it's not proven the way everything else here is. Want a test added for that before implementation starts, or is the reasoning convincing enough to skip it?

Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

I recommend **Subagent-driven**, same as the prior Karigar Management build: six tasks are strictly sequential (each depends on the last task's exact function signatures), this touches real salary/payment math, and a mistake here means either paying a worker wrong or silently losing haath-loss data — worth the per-task reviewer gate rather than one review at the very end.
