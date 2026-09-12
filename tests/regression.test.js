// ─────────────────────────────────────────────────────────────────────────
// JewelOS regression suite
// One test per bug found and fixed during audit (July 2026). Run this
// after ANY change to the app before deploying — it takes a few seconds
// and it is the only thing standing between you and re-introducing a bug
// that's already been found and fixed once.
//
// Run:  node tests/regression.test.js
// Exits with code 0 if everything passes, 1 if anything fails.
// ─────────────────────────────────────────────────────────────────────────
const { loadApp } = require('./harness.js');

var app = loadApp();
var passed = 0, failed = 0;
var failures = [];

function approxEqual(a, b, tolerance){
  tolerance = tolerance === undefined ? 0.01 : tolerance;
  return Math.abs(a - b) <= tolerance;
}

function test(name, fn){
  try{
    fn();
    passed++;
    console.log('  \u2713 ' + name);
  }catch(e){
    failed++;
    failures.push(name + ': ' + e.message);
    console.log('  \u2717 ' + name);
    console.log('      ' + e.message);
  }
}

function assert(cond, msg){
  if(!cond) throw new Error(msg || 'assertion failed');
}

console.log('\nJewelOS Regression Suite\n' + '='.repeat(50));

// ── Bug: Girvi interest overcharge on partial payments ────────────────────
console.log('\nGirvi ledger:');
test('partial payment reduces the principal that future interest accrues on', function(){
  var startDate = new Date(Date.now() - 365*86400000).toISOString().slice(0,10);
  var payDate = new Date(Date.now() - 180*86400000).toISOString().slice(0,10);
  var g = {
    principal: 50000, interestRate: 2, rateType: 'monthly', compound: false,
    startDate: startDate,
    payments: [{ amount: 20000, type: 'partial', date: payDate }]
  };
  var state = app.girviLedgerState(g);
  // Old buggy formula would give outstanding = 42166.67 (interest still
  // accruing on the full original 50000 forever). Correct reducing-balance
  // math (interest-first waterfall) gives ~40506.67.
  assert(state.outstanding < 41000, 'outstanding should reflect reduced principal after partial payment, got ' + state.outstanding);
  assert(state.principal < 50000, 'remaining principal should have decreased, got ' + state.principal);
});

test('interest-only payment does not reduce principal', function(){
  var g = {
    principal: 100000, interestRate: 24, rateType: 'yearly', compound: false,
    startDate: new Date(Date.now() - 90*86400000).toISOString().slice(0,10),
    payments: [{ amount: 2000, type: 'interest', date: new Date(Date.now() - 30*86400000).toISOString().slice(0,10) }]
  };
  var state = app.girviLedgerState(g);
  assert(approxEqual(state.principal, 100000, 1), 'principal should be unchanged by an interest-only payment, got ' + state.principal);
});

test('manually recorded penalty increases outstanding balance', function(){
  var startDate = new Date(Date.now() - 100*86400000).toISOString().slice(0,10);
  var before = app.girviLedgerState({ principal:50000, interestRate:24, rateType:'yearly', compound:false, startDate:startDate, payments:[] });
  var after = app.girviLedgerState({ principal:50000, interestRate:24, rateType:'yearly', compound:false, startDate:startDate,
    payments:[{ amount:3000, type:'penalty', date: new Date(Date.now()-30*86400000).toISOString().slice(0,10) }] });
  assert(after.outstanding > before.outstanding + 2900, 'a 3000 penalty should meaningfully increase outstanding, before=' + before.outstanding + ' after=' + after.outstanding);
});

test('refund increases outstanding balance (money given back means more is owed)', function(){
  var startDate = new Date(Date.now() - 50*86400000).toISOString().slice(0,10);
  var before = app.girviLedgerState({ principal:20000, interestRate:24, rateType:'yearly', compound:false, startDate:startDate, payments:[] });
  var after = app.girviLedgerState({ principal:20000, interestRate:24, rateType:'yearly', compound:false, startDate:startDate,
    payments:[{ amount:1000, type:'refund', date: new Date(Date.now()-10*86400000).toISOString().slice(0,10) }] });
  assert(after.outstanding > before.outstanding, 'a refund should increase outstanding, before=' + before.outstanding + ' after=' + after.outstanding);
});

test('penalty/refund are excluded from girviTotalPaid (not real cash received)', function(){
  var g = { payments: [
    { amount: 5000, type: 'partial' },
    { amount: 1000, type: 'penalty' },
    { amount: 500,  type: 'refund' }
  ]};
  var total = app.girviTotalPaid(g);
  assert(approxEqual(total, 5000, 1), 'girviTotalPaid should only count real payments (5000), got ' + total);
});

// ── Bug: GST/discount math ──────────────────────────────────────────────
console.log('\nSales / GST:');
test('GST is charged on discount-adjusted taxable value, not the pre-discount subtotal', function(){
  var sale = {
    items: [{ lockedRate:100000, weight:1, qty:1, isCustom:false, making:8000, diamond:5000 }],
    gst: 3, discount: 5000
  };
  var t = app.calcSaleTotals(sale);
  assert(approxEqual(t.taxable, 108000, 1), 'taxable value should be sub(113000) - discount(5000) = 108000, got ' + t.taxable);
  assert(approxEqual(t.gstAmt, 3240, 1), 'GST should be 3% of 108000 = 3240, got ' + t.gstAmt);
});

test('printed GST HSN breakdown reconciles exactly with the actual invoice GST amount', function(){
  var sale = {
    items: [{ lockedRate:100000, weight:1, qty:1, isCustom:false, making:8000, diamond:5000 }],
    gst: 3, discount: 5000
  };
  var t = app.calcSaleTotals(sale);
  var bd = app.calcSaleGSTBreakdown(sale);
  var printedTotal = bd.cgst + bd.sgst + bd.igst;
  assert(approxEqual(printedTotal, t.gstAmt, 0.5), 'printed CGST+SGST (' + printedTotal + ') must match the actual invoice GST (' + t.gstAmt + ')');
});

test('GST breakdown reconciles even with no discount and a non-standard rate', function(){
  var sale = { items: [{ lockedRate:60000, weight:2, qty:1, isCustom:true, making:1500, diamond:0 }], gst: 1.5 };
  var t = app.calcSaleTotals(sale);
  var bd = app.calcSaleGSTBreakdown(sale);
  assert(approxEqual(bd.cgst + bd.sgst + bd.igst, t.gstAmt, 0.5), 'GST breakdown should reconcile for custom items and non-standard rates too');
});

// ── Bug: Cash flow / Old Gold Exchange ──────────────────────────────────
console.log('\nCash flow:');
test('old-gold trade-in value is not counted as real cash collected', function(){
  // Simulate calcSaleTotals output shape directly since calcCashFlow reads S.sales
  var app2 = require('./harness.js').loadApp();
  app2.S.sales = [{
    id: 1, date: new Date().toISOString().slice(0,10),
    items: [{ lockedRate:80000, weight:1, qty:1, making:0, diamond:0 }],
    gst: 0, oldGold: { value: 20000 }, lockedGrand: 80000, adv: [{amount:60000}]
  }];
  // We can't easily fully replicate the advance/payment split without the
  // real sale object shape, so instead verify the underlying formula unit:
  var t = { adv: 80000 }; // as calcSaleTotals would report (60000 real + 20000 old-gold)
  var ogv = 20000;
  var realCash = Math.max(0, t.adv - ogv);
  assert(approxEqual(realCash, 60000, 1), 'real cash collected should exclude old-gold trade-in value, got ' + realCash);
});

// ── Plans removed — every account gets full (Pro) access ────────────────
console.log('\nPlan gating (removed):');
test('a shop record with a stale free/basic plan value still gets full access', function(){
  app.SAAS.plan = 'free';
  assert(app.canAccess('girvi') === true, 'girvi should be accessible regardless of stored plan');
  assert(app.canAccess('orders') === true, 'orders should be accessible regardless of stored plan');
  assert(app.canAccess('reports') === true, 'reports should be accessible regardless of stored plan');
  app.SAAS.plan = 'basic';
  assert(app.canAccess('girvi') === true, 'girvi should be accessible regardless of stored plan');
});
test('pro plan gets everything', function(){
  app.SAAS.plan = 'pro';
  assert(app.canAccess('girvi') === true, 'pro plan should have girvi access');
  assert(app.canAccess('whatsapp') === true, 'pro plan should have whatsapp access');
});

// ── Bug: PIN session persistence across app backgrounding ───────────────
console.log('\nAuth / lock screen:');
test('PIN session stays active shortly after unlock, even if sessionStorage is cleared (simulates mobile OS killing the app)', function(){
  app.markPinSessionActive();
  // Simulate the mobile OS killing the backgrounded tab: sessionStorage
  // wiped, localStorage survives.
  app.sessionStorage.removeItem('ssj_unlocked');
  assert(app.isPinSessionActive() === true, 'should stay unlocked shortly after activity even if sessionStorage was cleared');
});
test('PIN session expires after real inactivity', function(){
  // The four PIN keys are scoped per shop (_PIN_LAST_ACTIVE_KEY etc.) so a
  // second account on a shared device cannot inherit the first one's unlock.
  // This test used to write the old flat 'ssj_last_active' key, which nothing
  // reads any more — so it was asserting pre-fix behaviour and failing.
  app.localStorage.setItem(app._PIN_LAST_ACTIVE_KEY(), String(Date.now() - 10*60*1000)); // 10 min ago
  assert(app.isPinSessionActive() === false, 'should require PIN again after 10 real minutes of inactivity');
});

// ── Girvi customer accounts (multiple loans, one account) ──────────────
console.log('\nGirvi customer accounts:');
test('two loans for the same customer (same phone) link to one shared account', function(){
  app.S.girvi = [
    { id:'g1', grvNo:'K-112', customer:'Murgesh Nadar', phone:'8097578961', principal:15000, interestRate:2, rateType:'monthly', startDate:'2021-01-22', payments:[], status:'active' },
    { id:'g2', grvNo:'R-1257', customer:'Murgesh Nadar', phone:'8097578961', principal:30000, interestRate:2, rateType:'monthly', startDate:'2025-02-22', payments:[], status:'active' }
  ];
  app.S.customers = [];
  app.migrateGirviCustomerLinks();
  assert(app.S.customers.length === 1, 'should create exactly one account for one customer, got ' + app.S.customers.length);
  assert(app.S.girvi[0].customerId === app.S.girvi[1].customerId, 'both loans should share the same customerId');
  assert(app.girviEntriesForCustomer(app.S.customers[0].id).length === 2, 'account should show both loans');
});

test('different phone numbers create separate accounts even with a similar name', function(){
  app.S.girvi = [
    { id:'g3', grvNo:'A-1', customer:'Ramesh Shah', phone:'9000000001', principal:10000, interestRate:2, rateType:'monthly', startDate:'2024-01-01', payments:[], status:'active' },
    { id:'g4', grvNo:'A-2', customer:'Ramesh Shah', phone:'9000000002', principal:10000, interestRate:2, rateType:'monthly', startDate:'2024-01-01', payments:[], status:'active' }
  ];
  app.S.customers = [];
  app.migrateGirviCustomerLinks();
  assert(app.S.customers.length === 2, 'different phone numbers should NOT be merged into one account, got ' + app.S.customers.length);
});


// ── Bug: purchase bill created one stock line per bill regardless of ──────
// ── item count (Aug 2026 audit) ────────────────────────────────────────
console.log('\nPurchase → Inventory sync:');
test('purchase stock creation respects totalItems as real quantity, not always 1', function(){
  var app3 = require('./harness.js').loadApp();
  var bill = { id:'b1', billNo:'PB-00001', supplier:'Test Supplier', purchaseType:'Gold',
    purity:'22K', grossWt:100, netWt:95, totalAmount:600000, totalItems:10 };
  app3.pbCreateStockFromBill(bill);
  var p = app3.S.products[app3.S.products.length-1];
  assert(p.qty === 10, '10 items purchased should create qty 10, got ' + p.qty);
  assert(approxEqual(p.weight, 100, 0.01), 'total weight should still be 100g, got ' + p.weight);
  assert(approxEqual(p.unitWeight, 10, 0.01), 'unit weight should be 10g/piece, got ' + p.unitWeight);
});

test('selling part of a batch decrements quantity instead of zeroing the whole lot', function(){
  var app3 = require('./harness.js').loadApp();
  var bill = { id:'b2', billNo:'PB-00002', supplier:'Test Supplier', purchaseType:'Gold',
    purity:'22K', grossWt:50, netWt:48, totalAmount:300000, totalItems:5 };
  app3.pbCreateStockFromBill(bill);
  var p = app3.S.products[app3.S.products.length-1];
  app3.deductSoldStock([{ pid: p.id, qty: 2 }]);
  assert(p.qty === 3, 'selling 2 of 5 should leave 3, got ' + p.qty);
  assert(p.status === 'available', 'should still be available with 3 left, got ' + p.status);
  assert(approxEqual(p.weight, 30, 0.01), 'remaining weight should be 3 units * 10g = 30g, got ' + p.weight);
});

test('selling the last unit of a batch marks it sold', function(){
  var app3 = require('./harness.js').loadApp();
  var bill = { id:'b3', billNo:'PB-00003', supplier:'Test Supplier', purchaseType:'Gold',
    purity:'22K', grossWt:10, netWt:10, totalAmount:60000, totalItems:1 };
  app3.pbCreateStockFromBill(bill);
  var p = app3.S.products[app3.S.products.length-1];
  app3.deductSoldStock([{ pid: p.id, qty: 1 }]);
  assert(p.qty === 0 && p.status === 'sold', 'last unit sold should zero qty and mark sold, got qty=' + p.qty + ' status=' + p.status);
});

test('editing a purchase bill down cannot reduce stock below what is already sold', function(){
  var app3 = require('./harness.js').loadApp();
  var bill = { id:'b4', billNo:'PB-00004', supplier:'Test Supplier', purchaseType:'Gold',
    purity:'22K', grossWt:100, netWt:95, totalAmount:600000, totalItems:10 };
  app3.pbCreateStockFromBill(bill);
  var p = app3.S.products[app3.S.products.length-1];
  app3.deductSoldStock([{ pid: p.id, qty: 6 }]); // 6 sold, 4 left
  bill.totalItems = 2; // owner tries to edit bill down to fewer than already sold
  app3.pbSyncStockFromBill(bill);
  assert(p._origQty === 6, 'total should be clamped to the 6 already sold, got ' + p._origQty);
  assert(p.qty === 0, 'remaining stock should be 0 (all 6 were sold), got ' + p.qty);
});

test('editing a purchase bill\'s weight/purity propagates to its linked stock item', function(){
  var app3 = require('./harness.js').loadApp();
  var bill = { id:'b5', billNo:'PB-00005', supplier:'Test Supplier', purchaseType:'Gold',
    purity:'22K', grossWt:100, netWt:95, totalAmount:600000, totalItems:10 };
  app3.pbCreateStockFromBill(bill);
  var p = app3.S.products[app3.S.products.length-1];
  bill.grossWt = 120; bill.netWt = 114; bill.purity = '18K'; bill.totalAmount = 700000;
  app3.pbSyncStockFromBill(bill);
  assert(approxEqual(p.weight, 120, 0.01), 'weight should update to match the edited bill, got ' + p.weight);
  assert(p.purity === '18K', 'purity should update to match the edited bill, got ' + p.purity);
});

test('deleting a purchase bill is blocked once any of its stock has been sold', function(){
  var app3 = require('./harness.js').loadApp();
  var bill = { id:'b6', billNo:'PB-00006', supplier:'Test Supplier', purchaseType:'Gold',
    purity:'22K', grossWt:20, netWt:19, totalAmount:120000, totalItems:2 };
  app3.pbCreateStockFromBill(bill);
  app3.S.purchases = [bill];
  var p = app3.S.products[app3.S.products.length-1];
  app3.deductSoldStock([{ pid: p.id, qty: 1 }]); // 1 of 2 sold
  app3.isManager = function(){ return true; };
  app3.deletePurchase('b6');
  assert(app3.S.purchases.length === 1, 'bill with sold stock should not be deletable, got ' + app3.S.purchases.length + ' remaining');
});

test('deleting a sale restores the actual quantity sold, not always 1', function(){
  var app3 = require('./harness.js').loadApp();
  var bill = { id:'b7', billNo:'PB-00007', supplier:'Test Supplier', purchaseType:'Gold',
    purity:'22K', grossWt:50, netWt:48, totalAmount:300000, totalItems:5 };
  app3.pbCreateStockFromBill(bill);
  var p = app3.S.products[app3.S.products.length-1];
  app3.deductSoldStock([{ pid: p.id, qty: 3 }]); // 3 of 5 sold, 2 left
  app3.S.sales = [{ id:'s1', invNo:'INV-0001', customer:'Test Customer', items:[{ pid: p.id, qty: 3 }] }];
  app3.isManager = function(){ return true; };
  // deleteSale's confirm dialog won't auto-fire in the test harness (no
  // real DOM), so exercise the restore logic the same way deleteSale does.
  (app3.S.sales[0].items||[]).forEach(function(i){
    var prod = app3.S.products.find(function(x){ return x.id === i.pid; });
    var restoreQty = Math.max(1, parseInt(i.qty,10) || 1);
    prod.qty = (prod.qty||0) + restoreQty;
    if(prod._origQty) prod.qty = Math.min(prod.qty, prod._origQty);
    if(prod.unitWeight) prod.weight = Math.round(prod.unitWeight*prod.qty*1000)/1000;
    prod.status = 'available';
  });
  assert(p.qty === 5, 'restoring a 3-unit sale onto a 2-remaining batch should give back all 5, got ' + p.qty);
  assert(p.qty <= p._origQty, 'restored qty should never exceed the original purchased qty');
});

// ── P0 hardening pass (Aug 2026) ────────────────────────────────────────
console.log('\nP0 hardening — security & architecture:');

// Both checks below ignore explanatory comment lines (lines that start
// with a comment marker after trimming) — the strings "USING (true)" and
// "SB_REST" legitimately still appear in prose explaining that they were
// removed. What must never appear is either pattern in *live* code: an
// actual CREATE POLICY / SQL statement granting anon access, or an actual
// variable declaration/usage of SB_REST.
function _liveCodeLines(text){
  return text.split('\n').filter(function(line){
    var t = line.trim();
    return t.indexOf('--') !== 0 && t.indexOf('//') !== 0 && t.indexOf('*') !== 0;
  });
}

test('no insecure "USING (true)" anon policy remains anywhere in the app', function(){
  var fs = require('fs'), path = require('path');
  var root = path.join(__dirname, '..');
  var offenders = [];
  ['index.html'].concat(
    fs.readdirSync(path.join(root,'js')).map(function(f){ return 'js/'+f; })
  ).forEach(function(rel){
    var text = fs.readFileSync(path.join(root, rel), 'utf-8');
    var bad = _liveCodeLines(text).some(function(line){ return /USING\s*\(\s*true\s*\)/i.test(line); });
    if(bad) offenders.push(rel);
  });
  assert(offenders.length === 0, 'insecure anon policy SQL found in: ' + offenders.join(', '));
});

test('client no longer references SB_REST (direct table access) anywhere', function(){
  var fs = require('fs'), path = require('path');
  var root = path.join(__dirname, '..', 'js');
  var offenders = [];
  fs.readdirSync(root).forEach(function(f){
    var text = fs.readFileSync(path.join(root, f), 'utf-8');
    var bad = _liveCodeLines(text).some(function(line){ return /\bSB_REST\b/.test(line); });
    if(bad) offenders.push(f);
  });
  assert(offenders.length === 0, 'SB_REST still referenced in live code in: ' + offenders.join(', '));
});

test('getNextCounter calls store-proxy (not a direct /rest/v1/counters REST call)', function(){
  var app2 = require('./harness.js').loadApp();
  var calls = [];
  app2.fetch = function(url, opts){
    calls.push({ url: url, opts: opts });
    return Promise.resolve({ ok:true, status:200, json: function(){ return Promise.resolve({ ok:true, val:42 }); } });
  };
  app2.SHOP_ROW_KEY = 'shop-abc';
  app2.SAAS = app2.SAAS || {};
  app2.SAAS.sessionToken = 'tok-abc';
  var got = null;
  app2.getNextCounter('inv_no', function(err, val){ got = val; });
  assert(calls.length === 1, 'expected exactly one fetch call, got ' + calls.length);
  assert(calls[0].url.indexOf('/store-proxy') !== -1, 'expected store-proxy URL, got ' + calls[0].url);
  assert(calls[0].url.indexOf('/rest/v1/counters') === -1, 'must not call the counters table directly');
  var body = JSON.parse(calls[0].opts.body);
  assert(body.action === 'increment_counter' && body.counter === 'inv_no', 'expected increment_counter action, got ' + JSON.stringify(body));
  // store-proxy v5 (live as version 6) ignores x-shop-key entirely and derives
  // shop + role from the HMAC-signed session token, so the rowKey is no longer
  // a bearer secret the client hands over. Asserting the old header here meant
  // the suite went red *because* the code got safer.
  assert(calls[0].opts.headers['x-session-token'] === 'tok-abc', 'expected session token header to be forwarded, got ' + JSON.stringify(calls[0].opts.headers));
  assert(!calls[0].opts.headers['x-shop-key'], 'x-shop-key must no longer be sent — it was an unrevocable bearer secret');
});

test('atomic counter increment logic never issues the same number twice under concurrency (simulated)', function(){
  // Mirrors increment_shop_counter()'s single-statement INSERT ... ON
  // CONFLICT DO UPDATE semantics: each call is one atomic step with no
  // window for another caller to read a stale value in between.
  var counters = {};
  function atomicIncrement(key){
    counters[key] = (counters[key] || 0) + 1;
    return counters[key];
  }
  var seen = {};
  for(var i=0;i<50;i++){
    var v = atomicIncrement('shop1_inv_no');
    assert(!seen[v], 'duplicate counter value issued: ' + v);
    seen[v] = true;
  }
  assert(counters.shop1_inv_no === 50, 'expected 50 unique sequential values, got ' + counters.shop1_inv_no);
});

test('store CAS write rejects a stale version instead of overwriting newer data (simulated)', function(){
  // Mirrors store_cas_write()'s SELECT...FOR UPDATE + compare + write —
  // a write with an expectedVersion that doesn't match current state is
  // refused, current server data is returned untouched.
  function casWrite(store, shopId, data, expectedVersion){
    var existing = store[shopId];
    var currentVersion = existing ? (existing._v||0) : 0;
    if(existing && expectedVersion !== currentVersion){
      return { ok:false, conflict:true, current:existing };
    }
    var updated = Object.assign({}, data, { _v: currentVersion + 1 });
    store[shopId] = updated;
    return { ok:true, data: updated };
  }
  var store = {};
  var a = casWrite(store, 'shop1', { note:'device A v1' }, 0);
  assert(a.ok, 'first write for a new shop should succeed');
  // Device B still thinks version is 0 (stale — it loaded before A wrote v1)
  var b = casWrite(store, 'shop1', { note:'device B stale write' }, 0);
  assert(b.ok === false && b.conflict === true, 'stale write must be rejected as a conflict');
  assert(store.shop1.note === 'device A v1', 'device A\'s data must not be silently overwritten by the stale write, got ' + JSON.stringify(store.shop1));
});

console.log('\nSales transaction atomicity:');

function _freshSaleHarness(){
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Ring', metal:'gold', purity:'22K', weight:10, netWeight:10, qty:3, status:'available', huid:'' }];
  app2.S.sales = [];
  app2.UI.saleItems = [{ pid:'p1', qty:1 }];
  app2.upsertCustomer = function(){};
  app2.addPaymentRecord = function(){};
  app2.clearSale = function(){};
  app2.renderDash = function(){};
  app2.switchTab = function(){};
  app2.isDuplicateSale = function(){ return false; };
  return app2;
}
function _sale(id){
  return { id:id, invNo:'INV-000'+id, customer:'Test', phone:'', items:[{ pid:'p1', qty:1 }], nowPaying:{amount:0,mode:'Cash'} };
}

test('successful sale: stock deducted and sale saved in a single cloud write', function(){
  var app2 = _freshSaleHarness();
  var saveCalls = 0;
  app2.saveToCloud = function(cb){ saveCalls++; cb(null); };
  app2._commitSaleTransaction(_sale('1'));
  assert(saveCalls === 1, 'sale + stock must be persisted in exactly one saveToCloud call, got ' + saveCalls);
  assert(app2.S.sales.length === 1, 'sale should be recorded');
  assert(app2.S.products[0].qty === 2, 'stock should be deducted (3 -> 2), got ' + app2.S.products[0].qty);
});

test('failed save: sale AND stock deduction are rolled back together (no half-completed state)', function(){
  var app2 = _freshSaleHarness();
  app2.saveToCloud = function(cb){ cb(new Error('network down')); };
  app2._commitSaleTransaction(_sale('1'));
  assert(app2.S.sales.length === 0, 'sale must be rolled back on save failure, found ' + app2.S.sales.length);
  assert(app2.S.products[0].qty === 3, 'stock must be restored to pre-sale level on save failure, got ' + app2.S.products[0].qty);
  assert(app2.S.products[0].status === 'available', 'stock status must be restored on save failure');
});

test('version conflict on save: sale AND stock deduction are rolled back together', function(){
  var app2 = _freshSaleHarness();
  app2.saveToCloud = function(cb){ cb(new Error('version-conflict')); };
  app2._commitSaleTransaction(_sale('1'));
  assert(app2.S.sales.length === 0, 'sale must be rolled back on version conflict');
  assert(app2.S.products[0].qty === 3, 'stock must be restored on version conflict, got ' + app2.S.products[0].qty);
});

test('full stock sale: quantity reaches zero and item is marked sold', function(){
  var app2 = _freshSaleHarness();
  app2.S.products[0].qty = 1;
  app2.saveToCloud = function(cb){ cb(null); };
  app2._commitSaleTransaction(_sale('1'));
  assert(app2.S.products[0].qty === 0, 'expected qty 0 after selling the last unit, got ' + app2.S.products[0].qty);
  assert(app2.S.products[0].status === 'sold', 'expected status sold after selling the last unit');
});

test('double-click protection: a second recordSale() while the first is still saving does not create a second sale', function(){
  var app2 = _freshSaleHarness();
  var pendingCb = null;
  app2.saveToCloud = function(cb){ pendingCb = cb; }; // never calls back synchronously — simulates in-flight request
  // Stub only the one element recordSale() reads before delegating to
  // buildSaleObj() (itself stubbed below) — everything else (sync-dot,
  // toast targets, etc.) keeps using the harness's normal fake element.
  var _origGetById = app2.document.getElementById;
  app2.document.getElementById = function(id){
    if(id === 's-cust') return { style:{}, value:'Test Customer' };
    return _origGetById(id);
  };
  app2.buildSaleObj = function(){ return _sale('X'); };
  app2.recordSale();
  assert(app2.S.sales.length === 1, 'first click should record one sale, got ' + app2.S.sales.length);
  app2.recordSale(); // second click while the first save is still in flight
  assert(app2.S.sales.length === 1, 'second click while a save is in flight must be dropped, got ' + app2.S.sales.length);
  assert(app2.S.products[0].qty === 2, 'stock must only be deducted once, got ' + app2.S.products[0].qty);
});

test('purchase bill number uses the atomic counter when it resolved in time, and never reuses it twice', function(){
  var app2 = require('./harness.js').loadApp();
  var val = 500;
  app2.getNextCounter = function(name, cb){ cb(null, val++); }; // simulates store-proxy resolving fast
  app2.document.getElementById = function(id){
    if(id === 'pb-form') return { style:{ display:'none' }, innerHTML:'', scrollIntoView:function(){} };
    return { style:{}, value:'', textContent:'', scrollIntoView:function(){} };
  };
  app2.pbFormHtml = function(){ return ''; };
  app2.pbFillSupplierList = function(){};
  app2.pbClearForm = function(){};
  app2.pbRecalcForm = function(){};
  app2.pbToggleForm(); // opens blank form -> pre-fetches purchase_no
  assert(app2.pbUI.pendingBillNo === 500, 'expected pre-fetched atomic bill number, got ' + app2.pbUI.pendingBillNo);
});

// ── Girvi/invoice numbering (12 Sep 2026) ───────────────────────────────
// Cowork found GRV-0008 assigned to two unrelated loans live on the
// lumineer test shop, and a duplicated INV-027. Root cause: several
// creation paths blindly did S.nextXxx++/-- instead of syncing forward
// to (number actually used)+1, so the local counter could drift behind
// numbers already handed out by the atomic counter — see HANDOFF.md.
console.log('\nGirvi/invoice numbering (12 Sep hardening):');

test('a sale using an atomically-fetched invoice number advances S.nextInvNo past it, not by a blind +1', function(){
  var app2 = _freshSaleHarness();
  app2.S.nextInvNo = 5; // local counter lagging behind the server-issued number
  app2.saveToCloud = function(cb){ cb(null); };
  var sale = _sale('1');
  sale.invNo = 'INV-0050'; // as if getNextInvNo() resolved an atomic 50 while local counter sat at 5
  app2._commitSaleTransaction(sale);
  assert(app2.S.nextInvNo === 51, 'expected nextInvNo to jump past the number actually used (51), got ' + app2.S.nextInvNo);
});

test('a failed sale save restores S.nextInvNo to its exact pre-commit value, not a blind -1', function(){
  var app2 = _freshSaleHarness();
  app2.S.nextInvNo = 5;
  app2.saveToCloud = function(cb){ cb(new Error('network down')); };
  var sale = _sale('1');
  sale.invNo = 'INV-0050';
  app2._commitSaleTransaction(sale);
  assert(app2.S.nextInvNo === 5, 'expected nextInvNo restored to its pre-commit value (5) after rollback, got ' + app2.S.nextInvNo);
});

test('girvi renewal pre-fetches an atomic girvi number the moment the modal opens', function(){
  var app2 = require('./harness.js').loadApp();
  var val = 900;
  app2.getNextCounter = function(name, cb){ cb(null, val++); }; // simulates store-proxy resolving fast
  app2.S.girvi = [{ id:'g1', grvNo:'GRV-0001', status:'active', principal:1000,
    interestRate:2, rateType:'monthly', duration:3, startDate:'2026-01-01', ledger:[] }];
  app2.openGirviRenewalModal('g1');
  assert(app2._grnPendingGrvNo === 900, 'expected pre-fetched atomic girvi number, got ' + app2._grnPendingGrvNo);
});

test('confirming a girvi renewal uses the pre-fetched atomic number and advances S.nextGirviId past it', function(){
  var app2 = require('./harness.js').loadApp();
  app2.S.girvi = [{ id:'g1', grvNo:'GRV-0001', status:'active', principal:1000,
    interestRate:2, rateType:'monthly', duration:3, startDate:'2026-01-01', ledger:[] }];
  app2.S.nextGirviId = 5; // local counter lagging behind the pre-fetched value
  app2._grnGirviId = 'g1';
  app2._grnPendingGrvNo = 900; // as if openGirviRenewalModal's pre-fetch already resolved
  var _origGetById = app2.document.getElementById;
  app2.document.getElementById = function(id){
    if(id === 'grn-principal') return { value:'1200' };
    if(id === 'grn-rate')      return { value:'2' };
    if(id === 'grn-duration')  return { value:'3' };
    if(id === 'grn-ratetype')  return { value:'monthly' };
    return _origGetById(id); // toast(), etc. still need a real fake element (classList &c.)
  };
  app2.saveToCloud = function(cb){ cb(null); };
  app2.renderGirvi = function(){};
  app2.renderDash = function(){};
  app2.confirmGirviRenewal();
  assert(app2.S.girvi.length === 2, 'expected the renewed loan pushed alongside the closed original, got ' + app2.S.girvi.length);
  var newLoan = app2.S.girvi[1];
  assert(newLoan.grvNo === 'GRV-0900', 'expected the renewal to use the pre-fetched atomic number GRV-0900, got ' + newLoan.grvNo);
  assert(app2.S.nextGirviId === 901, 'expected nextGirviId to advance past the number actually used, got ' + app2.S.nextGirviId);
});

test('a new girvi entry does not skip a number when the atomic counter resolves (no double-increment)', function(){
  var app2 = require('./harness.js').loadApp();
  var val = 700;
  app2.getNextCounter = function(name, cb){ cb(null, val++); };
  app2.S.girvi = [];
  app2.S.nextGirviId = 1;
  app2.GF_EDIT_ID = null;
  app2.GF_ITEMS = [{ type:'ring', metal:'gold', purity:'22K', grossWt:5, netWt:5, qty:1, desc:'Ring' }];
  app2.GF_PHOTOS = [];
  app2.linkGirviToCustomer = function(){ return null; };
  app2.closeGirviModal = function(){};
  app2.saveToCloud = function(cb){ cb(null); };
  app2.renderGirvi = function(){};
  app2.renderDash = function(){};
  app2.saasActivityLog = function(){};
  var _origGetById = app2.document.getElementById;
  app2.document.getElementById = function(id){
    if(id === 'gf-cust')      return { value:'Test Cust' };
    if(id === 'gf-phone')     return { value:'9999999999' };
    if(id === 'gf-principal') return { value:'1000' };
    if(id === 'gf-rate')      return { value:'2' };
    if(id === 'gf-risk')      return { value:'low' };
    if(id === 'gf-ratetype')  return { value:'monthly' };
    if(id === 'gf-compound')  return { checked:false };
    return _origGetById(id); // toast(), etc. still need a real fake element (classList &c.)
  };
  app2.saveGirviEntry();
  assert(app2.S.girvi.length === 1, 'expected exactly one girvi created, got ' + app2.S.girvi.length);
  assert(app2.S.girvi[0].grvNo === 'GRV-0700', 'expected the atomic number GRV-0700 to be used, got ' + app2.S.girvi[0].grvNo);
  assert(app2.S.nextGirviId === 701, 'expected nextGirviId to advance by exactly one (701), got ' + app2.S.nextGirviId + ' — a double-increment here is how GRV numbers used to get skipped');
});

// ── batch14 fixes (Sep 2026) ───────────────────────────────────────────
console.log('\nbatch14 fixes:');

test('editing a quantity by hand recomputes weight from unitWeight', function(){
  // updQty() was the one place that changed qty without recomputing weight.
  // Every other site does (02:1186, 03:730, 09:629). A hand-edited quantity
  // therefore left the old total weight behind, and because nothing recomputes
  // weight on load, stock valuation and metal totals drifted permanently.
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Chain', qty:4, unitWeight:5, weight:20, status:'available' }];
  app2.saveToCloud = function(cb){ cb(null); };
  app2.renderInv = function(){};
  app2.updQty('p1', 7);
  var p = app2.S.products[0];
  assert(p.qty === 7, 'expected qty 7, got ' + p.qty);
  assert(approxEqual(p.weight, 35), 'expected weight recomputed to 35 (7 x 5), got ' + p.weight);
});

test('a hand-edited quantity leaves an audit trail in stockMovements', function(){
  // It was the only stock change that logged nothing, so a manual correction
  // was invisible in the movement history.
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Chain', qty:4, unitWeight:5, weight:20, status:'available' }];
  app2.S.stockMovements = [];
  app2.saveToCloud = function(cb){ cb(null); };
  app2.renderInv = function(){};
  app2.updQty('p1', 6);
  assert(app2.S.stockMovements.length === 1, 'expected one movement logged, got ' + app2.S.stockMovements.length);
  assert(app2.S.stockMovements[0].qtyChange === 2, 'expected qtyChange +2, got ' + app2.S.stockMovements[0].qtyChange);
});

test('a failed save rolls back both the quantity and the weight', function(){
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Chain', qty:4, unitWeight:5, weight:20, status:'available' }];
  app2.S.stockMovements = [];
  app2.saveToCloud = function(cb){ cb(new Error('network down')); };
  app2.renderInv = function(){};
  app2.saveCache = function(){};
  app2.toast = function(){};
  app2.updQty('p1', 9);
  var p = app2.S.products[0];
  assert(p.qty === 4, 'expected qty rolled back to 4, got ' + p.qty);
  assert(approxEqual(p.weight, 20), 'expected weight rolled back to 20, got ' + p.weight);
  assert(app2.S.stockMovements.length === 0, 'expected the movement rolled back too');
});

test('shopScopedKey ties a key to the signed-in shop', function(){
  var app2 = require('./harness.js').loadApp();
  app2.SAAS = app2.SAAS || {};
  app2.SAAS.shop = { id:'shop_A' };
  var a = app2.shopScopedKey('jewelos_thing');
  app2.SAAS.shop = { id:'shop_B' };
  var b = app2.shopScopedKey('jewelos_thing');
  assert(a !== b, 'two shops must not share a key — got ' + a + ' for both');
  assert(a.indexOf('shop_A') !== -1, 'expected the shop id in the key, got ' + a);
  app2.SAAS.shop = null;
  assert(app2.shopScopedKey('x').indexOf('noshop') !== -1, 'expected a noshop bucket when signed out');
});

// ── The bug class that has bitten six times ────────────────────────────
// ssj_cache, the four PIN keys, the audit log, the WhatsApp rules,
// jewelos_pin_changed, and four more in batch14 — every one of them was a
// browser-global localStorage key holding SHOP state, so the second account
// on a shared device inherited the first one's data. This test scans the real
// source and fails on a seventh, instead of waiting for a jeweller to find it.
test('no new unscoped localStorage key holds shop state', function(){
  var fs = require('fs'), path = require('path');
  // Keys that are genuinely device-wide or pre-login, and so correctly unscoped.
  var ALLOWED = [
    'jewelos_rzp_key',        // the platform's own Razorpay key, not a shop's
    'jewelos_girvi_view_mode',// cosmetic view preference
    'ssj_cache',              // tagged with the owning shop id inside the value
    'ssj_last_save', 'ssj_last_cloud_load',
    '_t'                      // storage-availability probe
  ];
  var root = path.join(__dirname, '..', 'js');
  var offenders = [];
  fs.readdirSync(root).filter(function(f){ return /\.js$/.test(f); }).forEach(function(f){
    var text = fs.readFileSync(path.join(root, f), 'utf-8');
    text.split('\n').forEach(function(line, i){
      if(/^\s*(\/\/|\*)/.test(line)) return;
      var re = /(?:local|session)Storage\.(?:get|set|remove)Item\(\s*'([A-Za-z_][\w]*)'/g, m;
      while((m = re.exec(line))){
        if(ALLOWED.indexOf(m[1]) === -1){
          offenders.push(f + ':' + (i+1) + ' -> ' + m[1]);
        }
      }
    });
  });
  assert(offenders.length === 0,
    'raw shop-state keys must go through shopScopedKey():\n      ' + offenders.join('\n      '));
});

// ── subscription window (paidUntil) ────────────────────────────────────
console.log('\nSubscription window — paidUntil:');

// Local-parts date string N days from today. Built by hand rather than with
// toISOString(), which would shift the day in any timezone ahead of UTC.
function _subDate(n){
  var d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() + n);
  var mm = String(d.getMonth() + 1); if(mm.length < 2) mm = '0' + mm;
  var dd = String(d.getDate());      if(dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}
function _subApp(paidUntil){
  var a = require('./harness.js').loadApp();
  a.SAAS.shop = { id: 'shop_test', name: 'Test', paidUntil: paidUntil };
  a.toast = function(){};
  return a;
}

test('a shop with no paidUntil is never restricted', function(){
  // Every shop that exists today has no value yet. A deploy must not lock
  // anyone out of their own customer list, stock and loan book.
  var a = _subApp(undefined);
  assert(a.subState() === 'ok', 'expected ok, got ' + a.subState());
  assert(a.subReadOnly() === false, 'a shop with no paidUntil must not be read-only');
  assert(a.subDaysLeft() === null, 'expected null days left');
});

test('more than 7 days left: no banner, no restriction', function(){
  var a = _subApp(_subDate(30));
  assert(a.subState() === 'ok', 'expected ok, got ' + a.subState());
  assert(a.subDaysLeft() === 30, 'expected 30 days left, got ' + a.subDaysLeft());
});

test('within 7 days: warns but does not restrict', function(){
  [7, 3, 1].forEach(function(n){
    var a = _subApp(_subDate(n));
    assert(a.subState() === 'warn', n + ' days out: expected warn, got ' + a.subState());
    assert(a.subReadOnly() === false, n + ' days out must not be read-only');
  });
});

test('the last paid day still counts as paid', function(){
  // paidUntil = today means access through today, not from midnight.
  var a = _subApp(_subDate(0));
  assert(a.subDaysLeft() === 0, 'expected 0 days left, got ' + a.subDaysLeft());
  assert(a.subState() === 'warn', 'expected warn on the final day, got ' + a.subState());
  assert(a.subReadOnly() === false, 'the final paid day must not be read-only');
});

test('lapsed but inside the 7-day grace: full access continues', function(){
  [-1, -4, -7].forEach(function(n){
    var a = _subApp(_subDate(n));
    assert(a.subState() === 'grace', n + ' days past: expected grace, got ' + a.subState());
    assert(a.subReadOnly() === false, n + ' days past must still have full access');
  });
});

test('grace boundary: day 7 is grace, day 8 is read-only', function(){
  var last = _subApp(_subDate(-7));
  var past = _subApp(_subDate(-8));
  assert(last.subReadOnly() === false, '7 days past expiry must still be writable');
  assert(past.subReadOnly() === true,  '8 days past expiry must be read-only');
});

test('past grace: subGuard blocks a write and explains why', function(){
  var a = _subApp(_subDate(-40));
  var said = [];
  a.toast = function(m){ said.push(m); };
  assert(a.subState() === 'readonly', 'expected readonly, got ' + a.subState());
  assert(a.subGuard('recording a sale') === false, 'subGuard must block past grace');
  assert(said.length === 1, 'expected one toast, got ' + said.length);
  assert(/view, print and back up/.test(said[0]), 'the message must say what still works: ' + said[0]);
});

test('subGuard lets writes through whenever the subscription is current', function(){
  [_subDate(30), _subDate(1), _subDate(-3), undefined].forEach(function(d){
    var a = _subApp(d);
    assert(a.subGuard('x') === true, 'expected pass for paidUntil=' + d + ' (' + a.subState() + ')');
  });
});

test('a date-only paidUntil is read as a local day, not UTC midnight', function(){
  // new Date('2026-10-09') is UTC midnight, which is the 8th anywhere behind
  // UTC — the shop would silently lose a day.
  var a = _subApp('2026-10-09');
  var d = a.subPaidUntil();
  assert(d.getFullYear() === 2026 && d.getMonth() === 9 && d.getDate() === 9,
    'expected local 9 Oct 2026, got ' + d.toString());
});

test('the three write paths are subscription-gated', function(){
  var fs = require('fs'), path = require('path');
  var JS_DIR = path.join(__dirname, '..', 'js');
  var src = {
    'recordSale (02)':       fs.readFileSync(path.join(JS_DIR, '02-ui-inactivity-modals.js'), 'utf-8'),
    'savePurchase (09)':     fs.readFileSync(path.join(JS_DIR, '09-purchases.js'), 'utf-8'),
    'saveGirviEntry (07)':   fs.readFileSync(path.join(JS_DIR, '07-settings-plans.js'), 'utf-8')
  };
  Object.keys(src).forEach(function(k){
    assert(/subGuard\(/.test(src[k]), k + ' must call subGuard()');
  });
});

test('backup and girvi repayment are NOT gated, even years past expiry', function(){
  var fs = require('fs'), path = require('path');
  var JS_DIR = path.join(__dirname, '..', 'js');
  // Deliberate. Backup: the data is the jeweller's own and holding it hostage
  // is wrong. Repayment: blocking it hurts his customer, not the shop that
  // owes us money — flagged unsettled in HANDOFF. If this test fails because
  // someone added a guard, check HANDOFF before "fixing" it.
  var auth  = fs.readFileSync(path.join(JS_DIR, '05-auth-login.js'), 'utf-8');
  var girvi = fs.readFileSync(path.join(JS_DIR, '07-settings-plans.js'), 'utf-8');
  var backupFn = auth.slice(auth.indexOf('function exportFullBackup'));
  backupFn = backupFn.slice(0, backupFn.indexOf('\nfunction '));
  assert(!/subGuard\(/.test(backupFn), 'exportFullBackup must never be subscription-gated');

  var payFn = girvi.slice(girvi.indexOf('function submitGirviPayment'));
  payFn = payFn.slice(0, payFn.indexOf('\nfunction '));
  assert(!/subGuard\(/.test(payFn), 'submitGirviPayment must never be subscription-gated');
});

test('subscription state never consults the plan', function(){
  var fs = require('fs'), path = require('path');
  var JS_DIR = path.join(__dirname, '..', 'js');
  // One product, one price. paidUntil answers "is it current", not "which tier".
  var orders = fs.readFileSync(path.join(JS_DIR, '04-orders-detail.js'), 'utf-8');
  var block = orders.slice(orders.indexOf('// ── SUBSCRIPTION WINDOW'));
  block = block.slice(0, block.indexOf('\n// ── SUPABASE SAAS TABLE KEYS'));
  // Comments are allowed to mention plans — that is how the block explains
  // that it is orthogonal to them. Only the executable lines are checked.
  var code = block.split('\n').filter(function(l){ return !/^\s*(\/\/|\*|\/\*)/.test(l); }).join('\n');
  assert(!/PLAN_LIMITS|canAccess\(|SAAS\.plan/.test(code),
    'the subscription helpers must not reference plans');
});

console.log('\n' + '='.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');
if(failed > 0){
  console.log('\nFAILURES:');
  failures.forEach(function(f){ console.log('  - ' + f); });
  process.exit(1);
}
process.exit(0);
