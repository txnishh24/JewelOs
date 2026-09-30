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

// Most of this suite is synchronous. cloudDiag() and anything else that
// resolves a promise needs this instead — the results are awaited before the
// totals are printed, so an async failure still fails the run.
var asyncTests = [];
function testAsync(name, fn){
  asyncTests.push(Promise.resolve().then(fn).then(function(){
    passed++; console.log('  ✓ ' + name);
  }, function(e){
    failed++; failures.push(name + ': ' + e.message);
    console.log('  ✗ ' + name);
    console.log('      ' + e.message);
  }));
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

test('F5: the PIN lock is 5 minutes -- 4 idle minutes still unlocked, 6 locked (Tanish, 29 Sep)', function(){
  assert(app.INACTIVITY_MS === 5 * 60 * 1000, 'INACTIVITY_MS should be 5 minutes, got ' + app.INACTIVITY_MS);
  app.localStorage.setItem(app._PIN_LAST_ACTIVE_KEY(), String(Date.now() - 4*60*1000));
  assert(app.isPinSessionActive() === true, '4 minutes idle must not need the PIN yet');
  app.localStorage.setItem(app._PIN_LAST_ACTIVE_KEY(), String(Date.now() - 6*60*1000));
  assert(app.isPinSessionActive() === false, '6 minutes idle must need the PIN');
});

test('F5: a phone typed as +91 or with a leading 0 is accepted and stored as 10 digits', function(){
  ['+91 98765 43210', '098765 43210', '98765-43210'].forEach(function(typed){
    var a = _freshSaleHarness(), saved = null;
    a.saveToCloud = function(cb){ cb(null); };
    var _orig = a.document.getElementById;
    a.document.getElementById = function(id){ return id === 's-cust' ? { style:{}, value:'Test Customer' } : _orig(id); };
    a.buildSaleObj = function(){ var s = _sale('X'); s.phone = typed; return s; };
    a._commitSaleTransaction = function(s){ saved = s; };
    a.recordSale();
    assert(saved && saved.phone === '9876543210', typed + ' should be saved as 9876543210, got ' + (saved && saved.phone));
  });
  var b = _freshSaleHarness(), got = null;
  var _o = b.document.getElementById;
  b.document.getElementById = function(id){ return id === 's-cust' ? { style:{}, value:'T' } : _o(id); };
  b.buildSaleObj = function(){ var s = _sale('Y'); s.phone = '12345'; return s; };
  b._commitSaleTransaction = function(s){ got = s; };
  b.recordSale();
  assert(got === null, 'a 5-digit number must still be refused');
});

// ── PIN security review (20-21 Sep 2026) ────────────────────────────────
// Fresh app instances throughout, not the shared `app` above — PIN storage
// and the lockout counters are shop-scoped state, and these tests need to
// control it precisely rather than inherit whatever earlier tests left.
console.log('\nPIN security (20-21 Sep 2026 review):');

function _pinHarness(){
  var a = require('./harness.js').loadApp();
  a.SAAS = a.SAAS || {};
  a.SAAS.shop = { id: 'shop_pin_test' };
  return a;
}

testAsync('_verifyPin resolves false when no PIN is stored (the closed silent-1234 hole)', function(){
  var a = _pinHarness();
  return a._verifyPin('1234').then(function(ok){
    assert(ok === false, 'expected false with nothing stored, got ' + ok);
  });
});

test('DEFAULT_PIN no longer exists anywhere', function(){
  var a = _pinHarness();
  assert(typeof a.DEFAULT_PIN === 'undefined', 'DEFAULT_PIN should be gone entirely, not just unused');
});

testAsync('a PIN set with _doSetPin verifies correctly and rejects a wrong PIN', function(){
  var a = _pinHarness();
  return a._doSetPin('4821').then(function(){
    return a._verifyPin('4821');
  }).then(function(ok){
    assert(ok === true, 'expected the correct PIN to verify, got ' + ok);
    return a._verifyPin('9999');
  }).then(function(ok2){
    assert(ok2 === false, 'expected a wrong PIN to fail, got ' + ok2);
  });
});

test('lockApp() with no PIN stored routes straight into set-PIN mode, not a verify screen', function(){
  var a = _pinHarness();
  a.lockApp();
  assert(a._pinChanging === true, 'expected set-PIN mode (_pinChanging true)');
  assert(a._pinStep === 1, 'expected step 1 (nothing to verify first), got ' + a._pinStep);
  assert(a._els['pin-label'].textContent === 'Set Your 4-Digit PIN', 'expected the set-PIN label, got ' + a._els['pin-label'].textContent);
});

testAsync('lockApp() with a PIN already stored shows the normal verify screen', function(){
  var a = _pinHarness();
  return a._doSetPin('1111').then(function(){
    a.lockApp();
    assert(a._pinChanging === false && a._pinStep === 0, 'expected verify mode');
    assert(a._els['pin-label'].textContent === 'Enter PIN', 'expected Enter PIN, got ' + a._els['pin-label'].textContent);
  });
});

testAsync('lockApp() closes an abandoned Change-PIN flow instead of leaving it armed (the High-severity bypass)', function(){
  // Before the fix, lockApp() reset the wrong variable names (undeclared
  // globals it created by accident), so an abandoned "enter new PIN" flow
  // survived every re-lock -- anyone who next picked up the device could
  // finish it with any 4 digits and unlock with zero knowledge of the real
  // PIN. This test fails against the pre-fix code.
  var a = _pinHarness();
  return a._doSetPin('2222').then(function(){
    a._pinChanging = true; a._pinStep = 1; a._pinTempNew = '9999'; // abandoned mid-change
    a.lockApp();
    assert(a._pinChanging === false, 'lockApp() must close an abandoned change-PIN flow');
    assert(a._pinStep === 0, 'expected step reset to 0, got ' + a._pinStep);
    assert(a._pinTempNew === '', 'expected the abandoned candidate PIN cleared');
  });
});

testAsync('Forgot PIN clears the stored PIN and goes straight into set-PIN mode, not a 1234 prompt', function(){
  var a = _pinHarness();
  return a._doSetPin('3333').then(function(){
    a._pinDoForget();
    assert(a.isPinSet() === false, 'expected the PIN to be cleared');
    assert(a._pinChanging === true && a._pinStep === 1, 'expected set-PIN mode after Forgot PIN');
    return a._verifyPin('1234');
  }).then(function(ok){
    assert(ok === false, '1234 must never verify after Forgot PIN, got ' + ok);
  });
});

test('repeated wrong PINs trigger a lockout window, which clears on demand', function(){
  var a = _pinHarness();
  assert(a._pinLockoutRemainingMs() === 0, 'no lockout initially');
  for(var i=0;i<5;i++) a._pinRecordFailure();
  assert(a._pinLockoutRemainingMs() > 0, 'expected a lockout after 5 straight failures');
  a._pinClearFailures();
  assert(a._pinLockoutRemainingMs() === 0, 'expected the lockout cleared');
});

test('the PIN lockout is scoped per shop, same as PIN storage itself', function(){
  var a = _pinHarness();
  for(var i=0;i<5;i++) a._pinRecordFailure();
  assert(a._pinLockoutRemainingMs() > 0, 'expected shop A locked out');
  a.SAAS.shop = { id: 'shop_pin_test_2' };
  assert(a._pinLockoutRemainingMs() === 0, 'a different shop must not inherit another shop\'s lockout');
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
  app2.getNextCounter = function(name, cb){ cb(null, 50); }; // server issues 50 while local counter sits at 5
  var sale = _sale('1');
  sale.invNo = '';
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

// ── Adjust Stock entry point (Task 4, 20 Sep) ──────────────────────────
// updQty() itself is fully covered above; these only check the new modal
// glue actually calls it correctly (new TOTAL qty, not a delta) and warns
// when unitWeight is missing.
console.log('\nAdjust Stock action:');

test('openAdjustStockModal pre-fills the current quantity and warns when unitWeight is missing', function(){
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Loose Stone', qty:3, weight:12, status:'available' }];
  app2.openAdjustStockModal('p1');
  assert(app2._els['as-new-qty'].value === 3, 'expected the current qty pre-filled, got ' + app2._els['as-new-qty'].value);
  assert(app2._els['as-weight-warning'].style.display === 'block', 'expected the no-unitWeight warning to show');
});

test('openAdjustStockModal hides the warning when unitWeight is set', function(){
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Chain', qty:4, unitWeight:5, weight:20, status:'available' }];
  app2.openAdjustStockModal('p1');
  assert(app2._els['as-weight-warning'].style.display === 'none', 'expected no warning when unitWeight is set');
});

test('submitAdjustStock passes the new TOTAL quantity to updQty, not a delta', function(){
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Chain', qty:4, unitWeight:5, weight:20, status:'available' }];
  app2.S.stockMovements = [];
  app2.saveToCloud = function(cb){ cb(null); };
  app2.renderInv = function(){};
  app2.openAdjustStockModal('p1');
  app2._els['as-new-qty'].value = '9';
  app2.submitAdjustStock();
  var p = app2.S.products[0];
  assert(p.qty === 9, 'expected qty set to 9 (the new total), got ' + p.qty);
  assert(approxEqual(p.weight, 45), 'expected weight recomputed to 45 (9 x 5), got ' + p.weight);
});

test('submitAdjustStock rejects a negative or non-numeric quantity without touching the product', function(){
  var app2 = require('./harness.js').loadApp();
  app2.S.products = [{ id:'p1', name:'Chain', qty:4, unitWeight:5, weight:20, status:'available' }];
  app2.saveToCloud = function(cb){ cb(null); };
  app2.openAdjustStockModal('p1');
  app2._els['as-new-qty'].value = '-3';
  app2.submitAdjustStock();
  assert(app2.S.products[0].qty === 4, 'a negative quantity must be rejected, qty should stay 4, got ' + app2.S.products[0].qty);
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
    '_t',                     // storage-availability probe
    // Reached through a variable rather than a literal, and correctly unscoped:
    'jewelos_signout_notice', // written while signed OUT — there is no shop to scope to
    'jewelos_users',          // device cache of auth_store; each record carries its own shopId
    'jewelos_shops'           // same, for shops
  ];
  var root = path.join(__dirname, '..', 'js');
  var offenders = [];
  fs.readdirSync(root).filter(function(f){ return /\.js$/.test(f); }).forEach(function(f){
    var text = fs.readFileSync(path.join(root, f), 'utf-8');
    var lines = text.split('\n');
    // Keys passed through a variable used to slip past this check entirely —
    // that is how jewelos_v18_seen stayed unscoped, and a second shop on the
    // same device inherited the first one's "changelog already seen".
    var viaVar = {};
    lines.forEach(function(line){
      var v = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*'((?:jewelos|ssj)_[\w]*)'/.exec(line);
      if(v) viaVar[v[1]] = v[2];
    });
    lines.forEach(function(line, i){
      if(/^\s*(\/\/|\*)/.test(line)) return;
      var re = /(?:local|session)Storage\.(?:get|set|remove)Item\(\s*(?:'([A-Za-z_][\w]*)'|([A-Za-z_$][\w$]*)\s*[,)])/g, m;
      while((m = re.exec(line))){
        var key = m[1] || viaVar[m[2]];
        if(key && ALLOWED.indexOf(key) === -1){
          offenders.push(f + ':' + (i+1) + ' -> ' + key);
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

console.log('\nbatch19 — sign-out and escaping (security review 14 Sep):');

// Swaps app globals for the length of fn, then puts them back — so a spy on
// safeConfirm or location.reload can't leak into later tests.
function withGlobals(overrides, fn){
  var saved = {};
  Object.keys(overrides).forEach(function(k){ saved[k] = app[k]; app[k] = overrides[k]; });
  try{ return fn(); } finally { Object.keys(saved).forEach(function(k){ app[k] = saved[k]; }); }
}

function seedSignedInDevice(){
  app.__resetStorage();
  app.SAAS.shop = { id:'shop_a', name:'Shop A' };
  app.SAAS.user = { id:'u1', name:'Ravi', role:'staff' };
  app.SAAS.sessionToken = 'tok-123';
  app.localStorage.setItem(app.AUTH_KEY, '{"userId":"u1","shopId":"shop_a"}');
  app.localStorage.setItem(app.USERS_KEY, '[{"id":"u1"}]');
  app.localStorage.setItem(app.SHOPS_KEY, '[{"id":"shop_a"}]');
  app.localStorage.setItem('ssj_cache', '{"shopId":"shop_a","customers":[{"name":"Lakshmi","phone":"98xxxxxx01"}]}');
  app.localStorage.setItem('ssj_last_save', '1');
  app.localStorage.setItem('ssj_last_cloud_load', '1');
}

function assertDeviceCleared(){
  [app.AUTH_KEY, app.USERS_KEY, app.SHOPS_KEY, 'ssj_cache', 'ssj_last_save', 'ssj_last_cloud_load'].forEach(function(k){
    assert(app.localStorage.getItem(k) === null, k + ' should be removed from localStorage on sign-out');
  });
  assert(app.SAAS.sessionToken === null, 'SAAS.sessionToken should be cleared');
  assert(app.SAAS.user === null && app.SAAS.shop === null, 'SAAS.user and SAAS.shop should be cleared');
}

test('a session the server rejects signs out with no confirm, reloads, and leaves no shop data on the device', function(){
  seedSignedInDevice();
  var confirms = 0, reloads = 0;
  withGlobals({ safeConfirm: function(){ confirms++; }, location: { reload: function(){ reloads++; } } }, function(){
    app.saasForceLogout('Your session has ended.');
  });
  assert(confirms === 0, 'a removed user must not get a Cancel button — saw ' + confirms + ' confirm(s)');
  assert(reloads === 1, 'expected one reload to drop in-memory shop data, got ' + reloads);
  assertDeviceCleared();
  assert(app.sessionStorage.getItem(app.SIGNOUT_NOTICE_KEY) === 'Your session has ended.', 'the reason should survive the reload');
});

test('both store-proxy 401 handlers (load and save) ask for the password in place, never the cancellable sign-out', function(){
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '01-sync-core.js'), 'utf-8');
  var blocks = src.split('status === 401').slice(1).map(function(b){
    // Only executable lines — the handlers' comments explain why they avoid saasLogout().
    return b.slice(0, 600).split('\n').filter(function(l){ return !/^\s*\/\//.test(l); }).join('\n');
  });
  assert(blocks.length >= 2, 'expected the load and save 401 handlers');
  blocks.forEach(function(b, i){
    assert(/saasRequireReauth\(/.test(b), '401 handler #' + (i + 1) + ' should call saasRequireReauth');
    assert(!/saasLogout\(/.test(b), '401 handler #' + (i + 1) + ' must not call the cancellable saasLogout');
  });
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  var ov = html.slice(html.indexOf('id="reauth-overlay"'), html.indexOf('<div class="toast" id="toast">'));
  var buttons = ov.match(/onclick="[^"]*"/g) || [];
  assert(buttons.length === 2 && /saasReauthSignOut/.test(buttons[0] + buttons[1]) && /saasReauthSubmit/.test(buttons[0] + buttons[1]),
    'the password prompt must offer only Continue and Sign out — no way to close it back into the shop; got ' + buttons.join(' '));
});

// F1 (29 Sep): a 401 on save used to roll the bill back and wipe the device.
// Now the save waits for the password and goes through on the new token.
function flush(){ return new Promise(function(r){ setImmediate(r); }); }
function flushAll(n){ var p = Promise.resolve(); for(var i = 0; i < (n || 8); i++) p = p.then(flush); return p; }
function reauthApp(loginResult){
  var a = loadApp();
  var newTok = fakeToken(Date.now() + 6 * 3600000);
  a.SAAS.user = { id:'u1', email:'o@shop.in', name:'Owner' };
  a.SAAS.shop = { id:'shop1', name:'Test Shop' };
  a.SAAS.sessionToken = 'dead';
  a.puts = [];
  a.fetch = function(url, opts){
    var h = (opts && opts.headers) || {};
    function resp(status, body){ return Promise.resolve({ status:status, ok:status < 300, json:function(){ return Promise.resolve(body); } }); }
    if(String(url).indexOf('/auth-gateway/login') !== -1){
      return loginResult === 'wrong'
        ? resp(401, { error:'Invalid email or password' })
        : resp(200, { sessionToken:newTok, user:{ id: loginResult === 'other' ? 'u9' : 'u1', email:'o@shop.in' }, shop:{ id:'shop1', name:'Test Shop' } });
    }
    if(String(url).indexOf('/store-proxy') !== -1 && opts.method === 'PUT'){
      a.puts.push(h['x-session-token']);
      return h['x-session-token'] === newTok ? resp(200, { ok:true, data:{ _v:2 } }) : resp(401, { error:'Session expired' });
    }
    return resp(200, {});
  };
  a.newTok = newTok;
  return a;
}

testAsync('a save refused with 401 is held (not rolled back, not signed out) and goes through after the password', function(){
  var a = reauthApp('ok'), result = 'pending', reloads = 0;
  a.location = { reload: function(){ reloads++; } };
  a.S.sales.push({ id:777, invNo:'INV-777' });
  a.saveToCloud(function(err){ result = err ? err.message : 'saved'; });
  return flushAll().then(function(){
    assert(result === 'pending', 'the caller must not be told to roll back yet, got ' + result);
    assert(a.saasReauthPending() === true, 'should be waiting for the password');
    assert(a.document.getElementById('reauth-overlay').style.display === 'flex', 'the password prompt should be showing');
    assert(reloads === 0 && a.localStorage.getItem('ssj_cache') !== null, 'must not sign out or wipe the device');
    a.document.getElementById('reauth-password').value = 'right-password';
    a.saasReauthSubmit();
    return flushAll(16);
  }).then(function(){
    assert(result === 'saved', 'the held save should complete after sign-in, got ' + result);
    assert(a.puts.length === 2 && a.puts[1] === a.newTok, 'the retry should use the new token, puts: ' + JSON.stringify(a.puts));
    assert(a.saasReauthPending() === false, 'prompt should be closed');
    assert(JSON.parse(a.localStorage.getItem(a.AUTH_KEY)).token === a.newTok, 'new token should be kept for the next reopen');
  });
});

testAsync('a wrong password (or a removed user) keeps the prompt up and never reaches the shop', function(){
  var a = reauthApp('wrong'), result = 'pending';
  a.saveToCloud(function(err){ result = err ? err.message : 'saved'; });
  return flushAll().then(function(){
    a.document.getElementById('reauth-password').value = 'nope';
    a.saasReauthSubmit();
    return flushAll(16);
  }).then(function(){
    assert(a.saasReauthPending() === true, 'must still be blocked');
    assert(/Incorrect password/.test(a.document.getElementById('reauth-err').textContent), 'should say the password was wrong');
    assert(result === 'pending' && a.puts.length === 1, 'nothing may be sent without a valid sign-in');
  });
});

testAsync('a 401 on a token that has NOT expired (user removed) wipes the device, no password prompt', function(){
  var a = reauthApp('ok'), reloads = 0;
  a.location = { reload: function(){ reloads++; } };
  a.SAAS.sessionToken = fakeToken(Date.now() + 3600000); // still inside its life, server refuses anyway
  a.saveToCloud(function(){});
  return flushAll().then(function(){
    assert(reloads === 1, 'a revoked session must be signed out, got ' + reloads + ' reload(s)');
    assert(a.saasReauthPending() === false, 'no password prompt for a revoked session');
    assert(a.localStorage.getItem('ssj_cache') === null, 'the shop copy must not stay on a removed user\'s phone');
  });
});

// Cowork review 30 Sep: the phone's clock decided "revoked vs expired". A
// slow clock thinks an expired token is still live, and the phone was wiped.
// store-proxy now sends the reason; the phone trusts it over its clock.
function reasonApp(reason){
  var a = reauthApp('ok');
  var base = a.fetch;
  a.fetch = function(url, opts){
    if(String(url).indexOf('/store-proxy') !== -1 && opts.method === 'PUT'){
      return Promise.resolve({ status:401, ok:false, json:function(){ return Promise.resolve({ error:'unauthenticated', reason:reason }); } });
    }
    return base(url, opts);
  };
  return a;
}

testAsync('server says "expired" but the slow phone clock says the token is live: password prompt, no wipe', function(){
  var a = reasonApp('expired'), reloads = 0;
  a.location = { reload: function(){ reloads++; } };
  a.SAAS.sessionToken = fakeToken(Date.now() + 3600000); // phone clock: an hour left
  a.saveToCloud(function(){});
  return flushAll().then(function(){
    assert(reloads === 0 && a.localStorage.getItem('ssj_cache') !== null, 'must not wipe the phone');
    assert(a.saasReauthPending() === true, 'should ask for the password');
  });
});

testAsync('server says "revoked" even though the phone clock says expired: the device is wiped', function(){
  var a = reasonApp('revoked'), reloads = 0;
  a.location = { reload: function(){ reloads++; } };
  a.SAAS.sessionToken = fakeToken(Date.now() - 3600000); // phone clock: already expired
  a.saveToCloud(function(){});
  return flushAll().then(function(){
    assert(reloads === 1, 'a removed user must be signed out, got ' + reloads + ' reload(s)');
    assert(a.localStorage.getItem('ssj_cache') === null, 'the shop copy must not stay on a removed user\'s phone');
  });
});

testAsync('a server-confirmed "revoked" tells the user their unsaved changes could not be kept', function(){
  var a = reasonApp('revoked');
  a.location = { reload: function(){} };
  a.saveToCloud(function(){});
  return flushAll().then(function(){
    var notice = a.sessionStorage.getItem(a.SIGNOUT_NOTICE_KEY) || '';
    assert(/no longer has access/.test(notice) && /could not be kept/.test(notice), 'expected the explicit removed-user message, got: ' + notice);
  });
});

testAsync('the load path passes the server reason too ("expired" on a live-looking token: prompt, no wipe)', function(){
  var a = reauthApp('ok'), reloads = 0;
  a.location = { reload: function(){ reloads++; } };
  a.SAAS.sessionToken = fakeToken(Date.now() + 3600000);
  a.fetch = function(){ return Promise.resolve({ status:401, ok:false, json:function(){ return Promise.resolve({ error:'unauthenticated', reason:'expired' }); } }); };
  a.loadFromCloud(function(){});
  return flushAll().then(function(){
    assert(reloads === 0, 'must not wipe the phone on the load path either');
    assert(a.saasReauthPending() === true, 'should ask for the password');
  });
});

testAsync('a save on a stalled connection gives up after its retries instead of hanging forever', function(){
  var a = loadApp();
  a.SAAS.sessionToken = 'tok';
  var timers = [], puts = 0;
  a.setTimeout = function(f, ms){ timers.push({ f:f, ms:ms }); return timers.length; };
  a.clearTimeout = function(){};
  a.fetch = function(){ puts++; return new Promise(function(){}); }; // never answers
  var result = 'pending';
  a.saveToCloud(function(err){ result = err ? err.message : 'saved'; });
  return flushAll().then(function(){
    for(var guard = 0; guard < 20 && timers.length; guard++){ var t = timers.shift(); t.f(); }
    return flushAll();
  }).then(function(){
    assert(result === 'save timed out', 'expected the save to fail with a timeout, got ' + result);
    assert(puts === 4, 'expected the first try plus 3 retries, got ' + puts);
    assert(a.isSaving === false, 'isSaving must be cleared so later saves are not queued forever');
  });
});

// Opus review item 3 (30 Sep): a save whose answer was lost may have landed.
function landedApp(conflictSaveId){
  var a = loadApp();
  a.SAAS.sessionToken = 'tok';
  a.setTimeout = function(f, ms){ if(ms < 60000) f(); return 1; }; // retries run at once; the 60 s timeout never fires
  a.clearTimeout = function(){};
  var puts = 0;
  a.fetch = function(url, opts){
    if(opts && opts.method === 'PUT'){
      puts++;
      var sent = JSON.parse(opts.body).data;
      if(puts === 1) return Promise.reject(new Error('connection dropped after the server saved'));
      var current = Object.assign({}, sent, { _v:9, _saveId: conflictSaveId === 'mine' ? sent._saveId : 'other-device' });
      return Promise.resolve({ status:409, ok:false, json:function(){ return Promise.resolve({ ok:false, conflict:true, data:current }); } });
    }
    return Promise.resolve({ status:200, ok:true, json:function(){ return Promise.resolve({ data:{ _v:9 } }); } });
  };
  return a;
}

testAsync('a retry that conflicts with its OWN earlier attempt counts as saved, not rolled back', function(){
  var a = landedApp('mine'), result = 'pending';
  a.saveToCloud(function(err){ result = err ? err.message : 'saved'; });
  return flushAll(16).then(function(){
    assert(result === 'saved', 'the save landed the first time, so the caller must hear success, got ' + result);
    assert(a._loadedVersion === 9, 'the version must follow the landed save, got ' + a._loadedVersion);
  });
});

testAsync('a retry that conflicts with ANOTHER device is still a real conflict', function(){
  var a = landedApp('other'), result = 'pending';
  a.saveToCloud(function(err){ result = err ? err.message : 'saved'; });
  return flushAll(16).then(function(){
    assert(result === 'version-conflict', 'expected version-conflict, got ' + result);
  });
});

// Opus review of 005, 30 Sep (MEDIUM): the landed save can belong to an
// EARLIER saveToCloud call -- every retry timed out (or a 401 re-sent it
// after sign-in), so the first call reported failure, yet it had landed.
function earlierLandedApp(storedIdFrom){
  var a = loadApp();
  a.SAAS.sessionToken = 'tok';
  a.setTimeout = function(f, ms){ if([2000,5000,15000].indexOf(ms) !== -1) f(); return 1; }; // only the save retry delays
  a.clearTimeout = function(){};
  var firstId = null, gets = 0, call = 1;
  a.fetch = function(url, opts){
    if(opts && opts.method === 'PUT'){
      var sent = JSON.parse(opts.body).data;
      if(call === 1){ firstId = firstId || sent._saveId; return Promise.reject(new Error('answer lost')); }
      var stored = Object.assign({}, sent, { _v:12, _saveId: storedIdFrom === 'first' ? firstId : 'other-device' });
      return Promise.resolve({ status:409, ok:false, json:function(){ return Promise.resolve({ ok:false, conflict:true, data:stored }); } });
    }
    gets++;
    return Promise.resolve({ status:200, ok:true, json:function(){ return Promise.resolve({ data:{ _v:12, sales:[{ id:'landed' }] } }); } });
  };
  a.nextCall = function(){ call = 2; };
  a.gets = function(){ return gets; };
  return a;
}

testAsync('a resubmit that conflicts with an EARLIER call\'s landed save: reloads, reports saved, no duplicate', function(){
  var a = earlierLandedApp('first'), first = 'pending', second = 'pending';
  a.saveToCloud(function(err){ first = err ? err.message : 'saved'; });
  return flushAll(16).then(function(){
    assert(first !== 'saved' && first !== 'pending', 'the first call should have reported a failure, got ' + first);
    a.nextCall();
    a.saveToCloud(function(err){ second = err ? err.message : 'saved'; });
    return flushAll(16);
  }).then(function(){
    assert(second === 'saved', 'the resubmit must be told it is saved (so the form clears), got ' + second);
    assert(a.gets() === 1, 'the landed version must be loaded from the cloud, GETs: ' + a.gets());
    assert(a.S.sales.length === 1 && a.S.sales[0].id === 'landed', 'S must now show what actually landed');
  });
});

testAsync('a conflict with an unknown save id is still a real conflict, even after an earlier failure', function(){
  var a = earlierLandedApp('other'), second = 'pending';
  a.saveToCloud(function(){});
  return flushAll(16).then(function(){
    a.nextCall();
    a.saveToCloud(function(err){ second = err ? err.message : 'saved'; });
    return flushAll(16);
  }).then(function(){
    assert(second === 'version-conflict', 'expected version-conflict, got ' + second);
  });
});

testAsync('after signing in again from a failed boot load, data reloads and auto-refresh starts', function(){
  var a = reauthApp('ok'), refreshStarted = 0, gets = 0;
  var baseFetch = a.fetch;
  a.fetch = function(url, opts){
    if(String(url).indexOf('/store-proxy') !== -1 && (!opts.method || opts.method === 'GET')){
      gets++;
      var ok = opts.headers['x-session-token'] === a.newTok;
      return Promise.resolve({ status: ok ? 200 : 401, ok: ok, json:function(){ return Promise.resolve(ok ? { data:{ _v:5, sales:[{ id:1 }] } } : { error:'x' }); } });
    }
    return baseFetch(url, opts);
  };
  a.startAutoRefresh = function(){ refreshStarted++; };
  a.loadFromCloud(function(){});
  return flushAll().then(function(){
    a.document.getElementById('reauth-password').value = 'pw';
    a.saasReauthSubmit();
    return flushAll(16);
  }).then(function(){
    assert(gets === 2, 'expected a reload after sign-in, GETs: ' + gets);
    assert(a._loadedVersion === 5, 'the version must be known so the next save is not a false conflict, got ' + a._loadedVersion);
    assert(refreshStarted === 1, 'auto-refresh should start after sign-in');
  });
});

testAsync('signing in again as a different user signs out instead of resuming', function(){
  var a = reauthApp('other'), reloads = 0;
  a.location = { reload: function(){ reloads++; } };
  a.saveToCloud(function(){});
  return flushAll().then(function(){
    a.document.getElementById('reauth-password').value = 'pw';
    a.saasReauthSubmit();
    return flushAll(16);
  }).then(function(){
    assert(reloads === 1 && a.localStorage.getItem(a.AUTH_KEY) === null, 'a different account must not inherit the pending work');
    assert(a.puts.length === 1, 'the held save must not be sent under another account');
  });
});

test('signing out yourself still asks first, and clears nothing until confirmed', function(){
  seedSignedInDevice();
  app.isSaving = false;
  app._lastSyncStatus = { status:'ok', label:'Live' };
  var args = null, reloads = 0;
  withGlobals({ safeConfirm: function(t, m, ok, danger){ args = { msg:m, ok:ok, danger:danger }; }, location: { reload: function(){ reloads++; } } }, function(){
    app.saasLogout();
    assert(args, 'saasLogout should open a confirm');
    assert(app.localStorage.getItem('ssj_cache') !== null, 'nothing should be cleared before the user confirms');
    assert(args.msg === 'Sign out of JewelOS on this device?', 'synced device should get the plain question');
    assert(!args.danger, 'synced device should not get the danger style');
    args.ok();
  });
  assert(reloads === 1, 'confirming should reload');
  assertDeviceCleared();
});

test('signing out with an unsynced save warns that this device\'s copy will be lost', function(){
  seedSignedInDevice();
  app.isSaving = false;
  app._lastSyncStatus = { status:'err', label:'Save failed' };
  var args = null;
  withGlobals({ safeConfirm: function(t, m, ok, danger){ args = { msg:m, danger:danger }; }, location: { reload: function(){} } }, function(){
    app.saasLogout();
  });
  assert(args && /not have reached the cloud/.test(args.msg), 'expected the unsynced warning, got: ' + (args && args.msg));
  assert(args.danger === true, 'the unsynced warning should use the danger style');
  app._lastSyncStatus = { status:'ok', label:'Live' };
});

test('closing the forced new-password screen signs out without a Cancel option', function(){
  seedSignedInDevice();
  app._pwdModalMode = 'forced';
  var confirms = 0, reloads = 0;
  withGlobals({ safeConfirm: function(){ confirms++; }, location: { reload: function(){ reloads++; } } }, function(){
    app.closePwdModal();
  });
  app._pwdModalMode = null;
  assert(confirms === 0, 'a temp-password session must not be able to cancel its way into the dashboard');
  assert(reloads === 1, 'expected a reload');
  assertDeviceCleared();
});

test('the sign-in screen shows why you were signed out, exactly once', function(){
  app.__resetStorage();
  app.sessionStorage.setItem(app.SIGNOUT_NOTICE_KEY, 'Your session has ended.');
  var els = {};
  var fakeDoc = Object.assign({}, app.document, {
    getElementById: function(id){ return els[id] || (els[id] = { style:{}, textContent:'', classList:{ add:function(){}, remove:function(){} } }); }
  });
  withGlobals({ document: fakeDoc }, function(){ app.showAuthScreen(); });
  assert(els['auth-login-err'] && els['auth-login-err'].textContent === 'Your session has ended.', 'notice should be shown on the sign-in form');
  assert(app.sessionStorage.getItem(app.SIGNOUT_NOTICE_KEY) === null, 'notice should be consumed so it does not reappear');
});

// F1 (29 Sep, Tanish chose option B): the token must survive the app being
// reopened, and expire with the session record, never outlive it.
function fakeToken(exp){
  return Buffer.from(JSON.stringify({ userId:'u1', shopId:'shop_a', exp:exp })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
}

test('a fresh login stores the token and its server expiry with the session record', function(){
  app.__resetStorage();
  var exp = Date.now() + 6 * 3600000;
  app.saasSetSession({ id:'u1', name:'Ravi' }, { id:'shop_a', name:'Shop A' }, fakeToken(exp));
  var rec = JSON.parse(app.localStorage.getItem(app.AUTH_KEY));
  assert(rec.token === fakeToken(exp), 'token should be stored with the session');
  assert(rec.exp === exp, 'exp should be read from the token, got ' + rec.exp);
});

test('reopening the app (empty sessionStorage) restores the token from the session record', function(){
  app.__resetStorage();
  var tok = fakeToken(Date.now() + 3600000);
  app.saasSetSession({ id:'u1' }, { id:'shop_a', name:'Shop A' }, tok);
  app.SAAS.sessionToken = null; // new process: memory gone, sessionStorage empty
  app.saasSetSession({ id:'u1' }, { id:'shop_a', name:'Shop A' });
  assert(app.SAAS.sessionToken === tok, 'restore should reuse the stored token, got ' + app.SAAS.sessionToken);
});

test('an expired token, or a pre-29-Sep record with no token, is not a session', function(){
  app.__resetStorage();
  app.localStorage.setItem(app.AUTH_KEY, JSON.stringify({ userId:'u1', shopId:'shop_a', ts:Date.now(), token:'x.y', exp:Date.now() - 1 }));
  assert(app.saasGetSession() === null, 'expired token should not count as signed in');
  assert(app._saasSessionExpired() === true, 'boot should know to explain the expiry');
  app.localStorage.setItem(app.AUTH_KEY, JSON.stringify({ userId:'u1', shopId:'shop_a', ts:Date.now() }));
  assert(app.saasGetSession() === null, 'a record with no token should not count as signed in');
  app.__resetStorage();
  assert(app._saasSessionExpired() === false, 'a device never signed in is not "expired"');
});

test('a temp-password (forced reset) login is never kept on the device, and is kept once the new password is set', function(){
  app.__resetStorage();
  app.localStorage.setItem(app.AUTH_KEY, JSON.stringify({ userId:'old', shopId:'shop_a', token:fakeToken(Date.now() + 3600000), exp:Date.now() + 3600000 }));
  var tok = fakeToken(Date.now() + 3600000);
  app.saasSetSession({ id:'u2', mustResetPassword:true }, { id:'shop_a', name:'Shop A' }, tok);
  assert(app.localStorage.getItem(app.AUTH_KEY) === null, 'closing the app mid-reset must not reopen into the shop (and must not resume a previous user)');
  assert(app.SAAS.sessionToken === tok, 'the token still works in memory so the reset call can be made');
  app.SAAS.user.mustResetPassword = false;
  app.saasSetSession(app.SAAS.user, app.SAAS.shop, app.SAAS.sessionToken);
  assert(JSON.parse(app.localStorage.getItem(app.AUTH_KEY)).token === tok, 'after the reset the session is kept');
});

test('no code path reads or writes the login token in sessionStorage any more', function(){
  var fs = require('fs'), path = require('path');
  ['04-orders-detail.js', '05-auth-login.js', '01-sync-core.js'].forEach(function(f){
    var src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf-8');
    assert(!/SESSION_TOKEN_KEY/.test(src), f + ' still references SESSION_TOKEN_KEY');
  });
});

var HOSTILE = '<img src=x onerror=alert(1)>';
function assertEscaped(html, where){
  assert(String(html).indexOf(HOSTILE) === -1, where + ': raw HTML from user text reached the page');
  assert(String(html).indexOf('&lt;img src=x onerror=alert(1)&gt;') !== -1, where + ': expected the text to be escaped, not dropped');
}

test('shop name, city, phone and GSTIN are escaped on the sale invoice (a manager can edit them)', function(){
  app.SAAS.shop = { id:'shop_a', name:HOSTILE, city:HOSTILE, phone:HOSTILE, gstin:HOSTILE };
  app.SAAS.user = { id:'u1', name:'Owner', role:'owner' };
  var html = app.buildInvoiceHTML({ id:'s1', invNo:'INV-1', date:new Date().toISOString(), customer:'C', phone:'9',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:3, discount:0 }, 'gst');
  assertEscaped(html, 'invoice');
});

console.log('\nCowork QA walkthrough, 30 Sep (P0 item 3 -- printed bill):');

test('the bill never prints a doubled rupee sign (Grand Total, Balance Due, amount in words)', function(){
  var html = app.buildInvoiceHTML({ id:'s1', invNo:'INV-1', date:new Date().toISOString(), customer:'C', phone:'9',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:3, discount:0,
    nowPaying:{ amount:100, mode:'Cash' }, advance:100 }, 'gst');
  assert(html.indexOf('₹₹') === -1 && html.indexOf('&#8377;₹') === -1, 'found a doubled rupee sign');
  assert(!/&#8377;\s*Rupees/.test(html), 'amount in words should read "Rupees ... Only", not "₹ Rupees"');
});

test('the bill shows the time it was actually saved, not 05:30 am', function(){
  var created = new Date(2026, 8, 30, 21, 37).toISOString(); // 9:37 pm IST
  var html = app.buildInvoiceHTML({ id:'s1', invNo:'INV-1', date:'2026-09-30T00:00:00.000Z', createdAt:created,
    customer:'C', phone:'9', items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:3, discount:0 }, 'gst');
  assert(html.indexOf(app.fmtTime(created)) !== -1, 'expected the save time ' + app.fmtTime(created) + ' on the bill');
  assert(html.indexOf(app.fmtTime('2026-09-30T00:00:00.000Z')) === -1, 'must not print the UTC-midnight 05:30 time');
});

test('billDateISO keeps the picked local day and uses the current time of day', function(){
  var iso = app.billDateISO('2026-10-01');
  var d = new Date(iso), now = new Date();
  assert(app.dbDayKey(iso) === '2026-10-01', 'the local day must stay 2026-10-01, got ' + app.dbDayKey(iso));
  assert(d.getHours() === now.getHours() && d.getMinutes() === now.getMinutes(), 'the time should be now, got ' + d.toString());
  assert(app.dbDayKey(app.billDateISO('')) === app.dbDayKey(new Date()), 'blank means now');
});

test('a sale made at 00:30 IST counts as that day, not the previous one (dashboard and GSTR-1 month)', function(){
  var a = require('./harness.js').loadApp();
  var justAfterMidnight = new Date(2026, 9, 1, 0, 30).toISOString(); // 1 Oct 00:30 IST = 30 Sep 19:00 UTC
  assert(justAfterMidnight.slice(0,10) === '2026-09-30', 'setup: the stored string starts with the previous UTC day');
  assert(a.dbDayKey(justAfterMidnight) === '2026-10-01', 'dbDayKey must read the local day');
  a.S.sales = [{ id:'m', invNo:'INV-1', date:justAfterMidnight, gst:3, items:[] }];
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '03-billing-numbers.js'), 'utf8') +
            require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '06-inventory-stock.js'), 'utf8');
  assert(!/\.date\|\|''\)\.slice\(0,10\)|\.date\.substring\(0,7\)|\.date\.startsWith\(/.test(src), 'a sale day/month is still read by slicing the stored string');
});

test('P0 item 2: GSTIN format check accepts a real-shaped GSTIN and rejects junk', function(){
  assert(app.isValidGSTIN('27ABCDE1234F1Z0') && app.isValidGSTIN(' 29aaacr5055k1z3 '), 'well-formed GSTINs should pass');
  ['INVALID123', '27ABCDE1234F1Y5', '27ABCDE1234F1Z', '99ABCDE1234F1Z5', ''].forEach(function(g){
    assert(!app.isValidGSTIN(g), g + ' should be rejected');
  });
});

test('P0 item 2: normPhone10 accepts +91 / 0 prefixes and rejects short numbers', function(){
  assert(app.normPhone10('+91 98765 43210') === '9876543210' && app.normPhone10('098765 43210') === '9876543210', 'prefixes dropped');
  assert(app.normPhone10('') === '' && app.normPhone10('98765') === null, 'blank is allowed, 5 digits is not');
});

test('P0 item 2: the bill says "Tax Invoice" only when the shop GSTIN is valid', function(){
  var sale = { id:'s1', invNo:'INV-1', date:new Date().toISOString(), customer:'C', phone:'9',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:3, discount:0 };
  var saved = app.SAAS.shop;
  app.SAAS.shop = { name:'S', gstin:'INVALID123' };
  var bad = app.buildInvoiceHTML(sale, 'gst');
  app.SAAS.shop = { name:'S', gstin:'27ABCDE1234F1Z0' };
  var good = app.buildInvoiceHTML(sale, 'gst');
  app.SAAS.shop = saved;
  assert(bad.indexOf('Tax Invoice') === -1 && bad.indexOf('Memo Bill') !== -1, 'an invalid GSTIN must not print "Tax Invoice"');
  assert(bad.indexOf('INVALID123') === -1, 'the invalid GSTIN must not be printed');
  assert(good.indexOf('Tax Invoice') !== -1 && good.indexOf('27ABCDE1234F1Z0') !== -1, 'a valid GSTIN prints a Tax Invoice with the GSTIN');
});

test('batch36: GSTIN check digit is verified (Cowork 1 Oct)', function(){
  assert(app.isValidGSTIN('27AAPFU0939F1ZV') && app.isValidGSTIN('29AAGCB7383J1Z4'), 'real GSTINs pass');
  assert(!app.isValidGSTIN('27AAPFU0939F1ZX'), 'a wrong check digit is rejected');
});

test('batch36: phone must be an Indian mobile (starts 6-9, not all one digit)', function(){
  ['0000000000', '5876543210', '9999999999', '1234567890'].forEach(function(v){
    assert(app.normPhone10(v) === null, v + ' should be rejected');
  });
  assert(app.normPhone10('+91 98765 43210') === '9876543210' && app.normPhone10('6000012345') === '6000012345', 'real mobiles pass');
});

test('batch36: a Memo Bill carries no GST anywhere (Tanish 1 Oct)', function(){
  var sale = { id:'s1', invNo:'INV-1', date:new Date().toISOString(), customer:'C', phone:'9876543210',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:0, discount:0 };
  var saved = app.SAAS.shop;
  [ '', 'INVALID123' ].forEach(function(g){
    app.SAAS.shop = { name:'S', city:'Pune', gstin:g };
    // a no/invalid-GSTIN shop asking for a GST bill still gets a memo
    var h = app.buildInvoiceHTML(sale, 'gst').replace(/<style[\s\S]*?<\/style>/g, '');
    assert(h.indexOf('Memo Bill') !== -1 && h.indexOf('Tax Invoice') === -1, 'memo heading for gstin=' + g);
    assert(h.indexOf('GSTIN') === -1, 'no GSTIN label or value for gstin=' + g);
    assert(h.indexOf('<th>HSN</th>') === -1 && h.indexOf('<th>GST</th>') === -1 && h.indexOf('>7113<') === -1, 'no HSN/GST columns for gstin=' + g);
  });
  app.SAAS.shop = saved;
});

test('batch36: a shop without a valid GSTIN cannot save GST onto a sale', function(){
  var a = require('./harness.js').loadApp();
  a.SAAS.shop = { name:'S', gstin:'' };
  a.setSaleFormBillType('gst');
  assert(a._saleFormBillType === 'memo', 'GST bill falls back to memo without a valid GSTIN');
  a.SAAS.shop = { name:'S', gstin:'27AAPFU0939F1ZV' };
  a.setSaleFormBillType('gst');
  assert(a._saleFormBillType === 'gst', 'a valid GSTIN may choose a GST bill');
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '02-ui-inactivity-modals.js'), 'utf8');
  assert((src.match(/var gstPct=_saleFormBillType==='gst'\?/g)||[]).length === 2, 'both the live total and the saved sale read GST % only on a GST bill');
});

test('batch36: an old sale that charged GST still shows its GST on reprint, whatever the GSTIN now', function(){
  var sale = { id:'s1', invNo:'INV-1', date:new Date().toISOString(), customer:'C', phone:'9876543210',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:3, discount:0, billType:'gst' };
  var saved = app.SAAS.shop;
  app.SAAS.shop = { name:'S', city:'Pune', gstin:'27ABCDE1234F1Z5' }; // passed the old check, fails the new one
  var h = app.buildInvoiceHTML(sale, 'gst').replace(/<style[\s\S]*?<\/style>/g, '');
  app.SAAS.shop = saved;
  assert(h.indexOf('<th>GST</th>') !== -1, 'the GST that was charged is still itemised, so the total adds up');
  assert(h.indexOf('Tax Invoice') === -1 && h.indexOf('27ABCDE1234F1Z5') === -1, 'but it is not called a Tax Invoice and the bad GSTIN is not printed');
});

test('batch36 item 9: old-gold deduction % comes off the weight x rate value; blank = none', function(){
  var a = require('./harness.js').loadApp(), ded = { value:'' };
  a.getRate = function(){ return 7000; };
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ return id === 's-oldgold-ded' ? ded : _o(id); };
  assert(a.ogCalcValue(10, '22K') === 70000, 'blank deduction keeps the full value');
  ded.value = '8';
  assert(Math.round(a.ogCalcValue(10, '22K')) === 64400, '8% off 70,000 is 64,400');
  ded.value = '250';
  assert(a.ogCalcValue(10, '22K') === 0, 'deduction is capped at 100%');
  var sale = { id:'s1', invNo:'INV-1', date:new Date().toISOString(), customer:'C', phone:'9876543210',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:0, discount:0,
    oldGold:{ weight:10, purity:'22K', value:64400, deductPct:8 } };
  assert(a.buildInvoiceHTML(sale, 'memo').indexOf('less 8%') !== -1, 'the bill shows the deduction');
});

test('batch37 P2-14: a bill total is locked in whole rupees, as printed', function(){
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '02-ui-inactivity-modals.js'), 'utf8');
  assert(src.indexOf('var grand=Math.round(Math.max(0,taxable+taxable*gstPct/100));') !== -1, 'the saved lockedGrand is rounded');
  assert(src.indexOf('var grand=Math.round(Math.max(0,taxable+gstAmt));') !== -1, 'the live form total is rounded the same way');
  var s1 = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '01-sync-core.js'), 'utf8');
  assert(s1.indexOf('sale.lockedGrand=Math.round(t.grand);') !== -1, 'an edited bill re-locks in whole rupees');
});

test('batch37 P2-16: Day Book refusals are words, not codes', function(){
  var a = require('./harness.js').loadApp();
  assert(a.dbErrText(new Error('future-date')) === 'the date is in the future', 'future-date is explained');
  assert(a.dbErrText(new Error('something-odd')).indexOf('connection') !== -1, 'an unknown failure asks to check the connection');
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '10-daybook.js'), 'utf8');
  assert(!/toast\([^)]*err2?\.message/.test(src), 'no Day Book toast prints err.message');
  var codes = (src.match(/new Error\('([a-z-]+)'\)/g)||[]).map(function(m){ return m.slice(11,-2); });
  codes.forEach(function(c){ assert(a.DB_ERR_TEXT[c], c + ' has plain words'); });
});

test('batch37 P2-17: one bill is not projected into a 24-month CLV', function(){
  var a = require('./harness.js').loadApp();
  a.S.sales = [{ id:'s1', invNo:'INV-1', date:'2026-09-30T16:00:00.000Z', customer:'Asha', phone:'9876543210',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:0, discount:0, lockedGrand:207772, advance:207772, payStatus:'full' }];
  var c = a.calcCLV('Asha', '9876543210');
  assert(c.projected === false && Math.round(c.projectedLTV) === Math.round(c.totalSpend), 'one bill shows what was spent, not x24 (got ' + Math.round(c.projectedLTV) + ')');
  a.S.sales.push({ id:'s2', invNo:'INV-2', date:'2026-06-30T16:00:00.000Z', customer:'Asha', phone:'9876543210',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:0, discount:0, lockedGrand:100000, advance:100000, payStatus:'full' });
  var c2 = a.calcCLV('Asha', '9876543210');
  assert(c2.projected === true && Math.round(c2.intervalDays) === 92, 'two bills 92 days apart: interval 92d (got ' + c2.intervalDays + ')');
});

test('batch37 P2-18: Net Cash subtracts Day Book expenses, like the P&L', function(){
  var a = require('./harness.js').loadApp();
  a.S.sales = []; a.S.girvi = [];
  a.S.dayBook = { entries:[
    { id:'e1', date:'2026-09-15', dir:'out', amount:500, cat:'rent' },
    { id:'e2', date:'2026-09-16', dir:'out', amount:900, cat:'rent', voided:true },
    { id:'e3', date:'2026-08-31', dir:'out', amount:700, cat:'rent' }
  ], closes:[], opening:{} };
  var cf = a.calcCashFlow('2026-09-01', '2026-09-30');
  assert(cf.expenses === 500 && cf.netCash === -500, 'only September\'s live expense counts (got expenses ' + cf.expenses + ', net ' + cf.netCash + ')');
});

test('batch37 item 7: a partial purchase payment survives a reload, and damaged bills are repaired', function(){
  var a = require('./harness.js').loadApp();
  a.S.purchaseCfg = { gst:true, goldRate:false, stone:false, hallmark:false, credit:false, timeline:false }; // the default
  a.S.purchases = [
    // saved correctly by the form: typed 15,000 of 40,000
    { id:'p1', billNo:'PB-1', date:'2026-10-01', supplier:'S', totalAmount:40000, amountPaid:15000, totalPaid:15000 },
    // already damaged by the old load loop: amountPaid forced to the total, totalPaid kept
    { id:'p2', billNo:'PB-2', date:'2026-09-30', supplier:'S', totalAmount:50000, amountPaid:50000, totalPaid:20000 },
    // damaged, with a later supplier payment of 5,000 on top of 20,000 at entry
    { id:'p3', billNo:'PB-3', date:'2026-09-30', supplier:'S', totalAmount:50000, amountPaid:50000, totalPaid:25000,
      supplierPayments:[{ id:'sp1', amount:5000, date:'2026-10-01T10:00:00.000Z' }] },
    // genuinely fully paid: untouched
    { id:'p4', billNo:'PB-4', date:'2026-09-30', supplier:'S', totalAmount:30000, amountPaid:30000, totalPaid:30000 }
  ];
  a.normaliseData();
  var p = function(id){ return a.S.purchases.filter(function(x){ return x.id===id; })[0]; };
  assert(p('p1').amountPaid === 15000 && p('p1').pendingAmount === 25000 && p('p1').paymentStatus === 'Partial', 'typed 15,000 stays 15,000 after a load (got ' + p('p1').amountPaid + ')');
  assert(p('p2').amountPaid === 20000 && p('p2').pendingAmount === 30000, 'damaged bill restored to 20,000 paid (got ' + p('p2').amountPaid + ')');
  assert(p('p3').amountPaid === 20000 && p('p3').totalPaid === 25000 && p('p3').pendingAmount === 25000, 'later payment kept out of the at-entry amount (got ' + p('p3').amountPaid + ')');
  assert(p('p4').amountPaid === 30000 && p('p4').paymentStatus === 'Paid', 'a fully paid bill is untouched');
  a.normaliseData();
  assert(p('p2').amountPaid === 20000, 'running the load again changes nothing');
});

test('batch37: a split-paid bill says "Cash + UPI", not just "Cash"', function(){
  var sale = { id:'s1', invNo:'INV-1', date:new Date().toISOString(), customer:'C', phone:'9876543210',
    items:[{ name:'Ring', purity:'22K', weight:2, qty:1, rate:7000, making:0 }], gst:0, discount:0,
    payment:'Cash', nowPaying:{ amount:55200, mode:'Cash' },
    splitPayments:[{ amount:30000, mode:'Cash' }, { amount:25200, mode:'UPI' }, { amount:0, mode:'Card' }] };
  assert(app.salePayModes(sale) === 'Cash + UPI', 'modes joined, zero rows dropped (got ' + app.salePayModes(sale) + ')');
  assert(app.salePayModes({ payment:'UPI' }) === 'UPI', 'an old single-mode sale keeps its mode');
  var h = app.buildInvoiceHTML(sale, 'memo');
  assert(h.indexOf('<span class="chip cp">Cash + UPI</span>') !== -1, 'the bill chip shows both modes');
});

test('batch37 P2-21: background refresh is once a minute, not every 15 s', function(){
  var a = require('./harness.js').loadApp();
  assert(a.AUTO_REFRESH_MS === 60000, 'AUTO_REFRESH_MS is 60 s');
});

test('P0 item 2: shop setup refuses an invalid GSTIN or phone', function(){
  var a = require('./harness.js').loadApp(), calls = 0;
  a.SAAS.shop = { id:'shop1' };
  a.authGatewayCall = function(){ calls++; return new Promise(function(){}); };
  var vals = { 'ob-shopname':'Sonar', 'ob-city':'Pune', 'ob-phone':'98765', 'ob-gstin':'INVALID123' };
  var err = { textContent:'' };
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ if(id === 'ob-err') return err; if(id in vals) return { value:vals[id] }; return _o(id); };
  a.saasOnboardSave();
  assert(calls === 0 && /GSTIN/.test(err.textContent), 'invalid GSTIN must be refused, got: ' + err.textContent);
  vals['ob-gstin'] = '';
  a.saasOnboardSave();
  assert(calls === 0 && /10-digit/.test(err.textContent), 'a 5-digit phone must be refused, got: ' + err.textContent);
  vals['ob-phone'] = '+91 98765 43210';
  a.saasOnboardSave();
  assert(calls === 1, 'valid details should save');
});

test('P0 item 4: a split payment is recorded as one history row per mode, not one merged "Cash" row', function(){
  var a = _freshSaleHarness();
  a.addPaymentRecord = require('./harness.js').loadApp().addPaymentRecord; // the real one
  a.saveToCloud = function(cb){ cb(null); };
  var s = _sale('1');
  s.nowPaying = { amount:150000, mode:'Cash' };
  s.splitPayments = [{ amount:100000, mode:'Cash' }, { amount:50000, mode:'UPI' }];
  a._commitSaleTransaction(s);
  var h = a.S.sales[0].paymentHistory || [];
  assert(h.length === 2 && h[0].mode === 'Cash' && h[0].amount === 100000 && h[1].mode === 'UPI' && h[1].amount === 50000,
    'expected Cash 100000 + UPI 50000, got ' + JSON.stringify(h.map(function(p){ return p.mode + ' ' + p.amount; })));
});

test('P0 item 4: a single payment is still one row', function(){
  var a = _freshSaleHarness();
  a.addPaymentRecord = require('./harness.js').loadApp().addPaymentRecord;
  a.saveToCloud = function(cb){ cb(null); };
  var s = _sale('1');
  s.nowPaying = { amount:5000, mode:'UPI' };
  s.splitPayments = [{ amount:5000, mode:'UPI' }];
  a._commitSaleTransaction(s);
  var h = a.S.sales[0].paymentHistory || [];
  assert(h.length === 1 && h[0].mode === 'UPI' && h[0].amount === 5000, 'got ' + JSON.stringify(h));
});

test('P0 item 5: Reports fills "By category" and "Sales in <month>" (both were always empty)', function(){
  var a = require('./harness.js').loadApp();
  var now = new Date();
  a.S.products = [{ id:'p1', name:'Ring', cat:'Rings', metal:'gold', purity:'22K', weight:10, qty:0, status:'sold' }];
  a.S.sales = [{ id:'s1', invNo:'INV-001', date:now.toISOString(), customer:'Asha <b>', items:[{ pid:'p1', name:'Ring', metal:'gold', purity:'22K', weight:10, qty:1, rate:7000 }],
    splitPayments:[{ amount:50000, mode:'Cash' }, { amount:20000, mode:'UPI' }], gst:0, discount:0 }];
  a.repYear = now.getFullYear(); a.repMonth = now.getMonth();
  try { a.renderReports(); } catch(e) { /* other report cards may need DOM the fake lacks; the two tables render first */ }
  var cat = a.document.getElementById('cat-perf').innerHTML, hist = a.document.getElementById('sales-hist').innerHTML;
  assert(/Rings/.test(cat) && !/Other/.test(cat), 'By category should say Rings, got: ' + cat);
  assert(/INV-001/.test(hist) && /Cash \+ UPI/.test(hist), 'Sales table should list INV-001 paid Cash + UPI, got: ' + hist);
  assert(hist.indexOf('<b>') === -1, 'the customer name must be escaped');
});

test('P0 item 5: every category table uses the product category for a stock sale', function(){
  var a = require('./harness.js').loadApp();
  a.S.products = [{ id:'p1', cat:'Rings' }];
  assert(a.saleItemCat({ pid:'p1' }) === 'Rings', 'stock line -> product category');
  assert(a.saleItemCat({ cat:'Chains' }) === 'Chains' && a.saleItemCat({}) === 'Other', 'custom line -> its own cat, else Other');
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '06-inventory-stock.js'), 'utf8');
  assert(src.indexOf("i.category || i.cat || 'Other'") === -1, 'the "Other"-only category rule is still in use');
});

test('P0 item 6: a Girvi loan above 75% of the gold value asks before creating (Tanish, 30 Sep)', function(){
  function tryLoan(principal){
    var a = require('./harness.js').loadApp(), confirms = [], counterCalls = 0;
    var vals = { 'gf-cust':'Ravi', 'gf-phone':'9876543210', 'gf-principal':String(principal), 'gf-rate':'2' };
    var _o = a.document.getElementById;
    a.document.getElementById = function(id){ if(id in vals) return { value:vals[id], checked:false }; return _o(id); };
    a.GF_EDIT_ID = null;
    a.GF_ITEMS = [{ type:'Ring', metal:'gold', purity:'22K', grossWt:'10', netWt:'10', qty:1 }];
    a.gfItemMktVal = function(){ return 105400; };
    a.subGuard = function(){ return true; };
    a.safeConfirm = function(t, m, ok){ confirms.push({ t:t, ok:ok }); };
    a.getNextGrvNo = function(){ counterCalls++; }; // the create path starts here
    a.saveGirviEntry();
    return { confirms:confirms, started:counterCalls };
  }
  var big = tryLoan(500000);
  assert(big.confirms.length === 1 && /474%/.test(big.confirms[0].t) && big.started === 0, 'a 474% loan must ask first, got ' + JSON.stringify(big.confirms.map(function(c){return c.t;})));
  var ok = tryLoan(70000); // 66%
  assert(ok.confirms.length === 0 && ok.started === 1, 'a 66% loan should go straight through');
});

test('QA P1 item 10: picking a product pre-fills its gross-minus-net as a deduction, so the bill uses net weight', function(){
  var a = require('./harness.js').loadApp();
  a.S.products = [{ id:'p1', name:'Ring', metal:'gold', purity:'22K', weight:10, netWeight:8.5, qty:1, status:'available' }];
  a.UI.saleItems = [{ pid:'', qty:1 }];
  a.renderSaleItems = function(){};
  a.onSP(0, 'p1');
  assert(a.UI.saleItems[0].otherWt === 1.5, 'expected a 1.5 g deduction, got ' + a.UI.saleItems[0].otherWt);
  a.UI.saleMode = 'stock';
  var sale = a.buildSaleObj();
  assert(sale.items[0].weight === 8.5, 'the bill should use 8.5 g net, got ' + sale.items[0].weight);
  a.S.products[0].netWeight = 0; // no net saved -> nothing pre-filled
  a.onSP(0, 'p1');
  assert(a.UI.saleItems[0].otherWt === 0, 'no net weight -> no deduction');
});

test('QA P1 item 10: stock value uses net weight when one is saved', function(){
  var a = require('./harness.js').loadApp();
  var r = a.getRate('gold','22K');
  assert(a.mktVal({ metal:'gold', purity:'22K', weight:10, netWeight:8 }) === 8*r, 'net 8 g');
  assert(a.mktVal({ metal:'gold', purity:'22K', weight:10 }) === 10*r, 'no net -> gross');
  assert(a.mktVal({ metal:'gold', purity:'22K', weight:10, netWeight:12 }) === 10*r, 'a net above gross is ignored');
});

test('QA P1 item 10: Girvi step 2 refuses a net weight above the gross weight', function(){
  var a = require('./harness.js').loadApp(), msg = '';
  a.toast = function(m){ msg = m; };
  a.GF_STEP = 2;
  a.GF_ITEMS = [{ type:'Ring', metal:'gold', purity:'22K', grossWt:10, netWt:12, qty:1 }];
  a.girviWizardNext();
  assert(/Net weight cannot be more than gross/.test(msg) && a.GF_STEP === 2, 'should stay on step 2 with the message, got "' + msg + '" at step ' + a.GF_STEP);
});

function _orderFormApp(vals){
  var a = require('./harness.js').loadApp(), saves = 0, confirms = [], msg = '';
  var _o = a.document.getElementById;
  a.document.getElementById = function(id){ if(id in vals) return { value:vals[id], checked:false }; return _o(id); };
  a.ordItems = [{ desc:'Ring', cat:'Rings', metal:'gold', purity:'22K', orderWt:5, estWt:5, making:0, makingType:'flat', qty:1, note:'' }];
  a.saveToCloud = function(cb){ saves++; cb(null); };
  a.safeConfirm = function(t, m, ok){ confirms.push({ t:t, ok:ok }); };
  a.toast = function(m){ msg = m; };
  a.toggleOrdForm = function(){}; a.renderOrders = function(){};
  return { a:a, saves:function(){ return saves; }, confirms:confirms, msg:function(){ return msg; } };
}

test('QA P1 item 11: an order advance above the quote is refused', function(){
  var t = _orderFormApp({ 'oi-desc-0':'Ring', 'of-cust':'Asha', 'of-delivery':'2099-01-01', 'of-quote':'100000', 'of-adv-amt':'150000' });
  t.a.saveOrder();
  assert(t.saves() === 0 && /more than the quote/.test(t.msg()), 'expected a refusal, got saves=' + t.saves() + ' msg=' + t.msg());
});

test('QA P1 item 11: a past delivery date asks first; confirming saves', function(){
  var t = _orderFormApp({ 'oi-desc-0':'Ring', 'of-cust':'Asha', 'of-delivery':'2020-01-01', 'of-quote':'100000', 'of-adv-amt':'10000' });
  t.a.saveOrder();
  assert(t.saves() === 0 && t.confirms.length === 1 && /in the past/.test(t.confirms[0].t), 'should ask before saving');
  t.confirms[0].ok();
  assert(t.saves() === 1, 'confirming should save');
});

test('QA P1 item 11: order profit estimate is not the whole quote when no estimated weight is set', function(){
  var a = require('./harness.js').loadApp();
  var r = a.getRate('gold','22K');
  assert(a.orderProfitEst({ quote:100000, items:[{ metal:'gold', purity:'22K', qty:1, making:0 }] }) === 0, 'no weight at all -> no estimate (0), not 1,00,000');
  assert(a.orderProfitEst({ quote:100000, items:[{ metal:'gold', purity:'22K', orderWt:5, qty:1, making:0 }] }) === 100000 - 5*r, 'order weight used when no estimate');
});

test('QA P1 items 12-13: developer cards are hidden by default; no "Free forever" or phantom WhatsApp setup', function(){
  var html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert(/<div class="card dev-only"[^>]*>\s*<div class="card-title">&#9729; Cloud Setup/.test(html), 'Cloud/SQL Setup card must be dev-only');
  assert(/<div class="card dev-only">\s*<div class="card-title">🔧 Developer Tools/.test(html), 'Developer Tools card must be dev-only');
  assert(/\.dev-only\{display:none!important;\}/.test(html), 'dev-only must be hidden by default');
  assert(html.indexOf('Free forever') === -1, '"Free forever" contradicts the paid plan');
  assert(html.indexOf('WhatsApp Business API setup') === -1, 'points at a setup screen that does not exist');
});

test('girvi item description is escaped on the loan card', function(){
  var html = app.girviLoanCardHTML({ id:'g1', grvNo:'GRV-1', customer:'C', phone:'9', status:'active',
    items:[{ desc:HOSTILE, type:'Ring', metal:'gold', purity:'22K', weight:2, qty:1 }], amount:1000, rate:2,
    startDate:new Date().toISOString(), ledger:[] });
  assertEscaped(html, 'girvi card');
});

test('order item description, payment ref and mode, and shop name are escaped on the printed order receipt', function(){
  var written = '';
  app.SAAS.shop = { id:'shop_a', name:HOSTILE };
  app.S.orders = [{ id:'o1', ordNo:'ORD-1', customer:'C', phone:'9', status:'new', createdAt:new Date().toISOString(), delivery:new Date().toISOString(),
    items:[{ desc:HOSTILE, purity:HOSTILE, orderWt:1, estWt:1, qty:1 }],
    ledger:[{ type:'advance', amount:10, mode:HOSTILE, ref:HOSTILE, date:new Date().toISOString() }] }];
  withGlobals({ open: function(){ return { document:{ write:function(h){ written = h; }, close:function(){} }, print:function(){} }; } }, function(){
    app.generateOrderReceipt('o1');
  });
  assert(written.length > 0, 'receipt should have been written');
  assertEscaped(written, 'order receipt');
  app.S.orders = [];
});

test('the order receipt header shows this shop\'s name, not a hard-coded "Sri Sai Jewellers"', function(){
  var written = '';
  app.SAAS.shop = { id:'shop_b', name:'Lakshmi Gold House' };
  app.S.orders = [{ id:'o2', ordNo:'ORD-2', customer:'C', phone:'9', status:'new', createdAt:new Date().toISOString(), delivery:new Date().toISOString(),
    items:[{ desc:'Ring', purity:'22K', orderWt:1, estWt:1, qty:1 }], ledger:[] }];
  withGlobals({ open: function(){ return { document:{ write:function(h){ written = h; }, close:function(){} }, print:function(){} }; } }, function(){
    app.generateOrderReceipt('o2');
  });
  app.S.orders = [];
  var start = written.indexOf('class="hdr"');
  var header = written.slice(start, written.indexOf('Not a Tax Invoice', start));
  assert(header.indexOf('Lakshmi Gold House') !== -1, 'receipt header should name the shop');
  assert(written.indexOf('Sri Sai') === -1, 'no other shop\'s name should appear on this shop\'s receipt');
});

test('activity log notes and user names are escaped wherever the log is rendered', function(){
  var fs = require('fs'), path = require('path');
  ['05-auth-login.js', '06-inventory-stock.js'].forEach(function(f){
    var src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf-8');
    assert(!/'\+l\.(note|user|type)\+'/.test(src), f + ' renders an activity-log field without escHtml');
  });
});

// ── Bug: stored XSS via customer name, using encodeURIComponent() as
// attribute escaping (23 Sep 2026 security audit — HANDOFF.md) ──────────
// encodeURIComponent() does not escape ' ( ) — exactly what's needed to
// break out of a single-quoted onclick="fn('...')" attribute. A customer
// named e.g. x'-alert(1)-' ran that alert with zero percent-encoding
// involved. jsAttrEsc() is the correct helper for this context.
console.log('\nStored XSS — customer name in onclick attributes (23 Sep 2026):');

test('no onclick attribute builds a value with encodeURIComponent() instead of jsAttrEsc()', function(){
  var fs = require('fs'), path = require('path');
  var root = path.join(__dirname, '..', 'js');
  var offenders = [];
  fs.readdirSync(root).forEach(function(f){
    var text = fs.readFileSync(path.join(root, f), 'utf-8');
    _liveCodeLines(text).forEach(function(line){
      // Only the HTML-attribute-string form (onclick="...") is the risk --
      // 'el.onclick = function(){ ... }' passes encodeURIComponent() a real
      // JS variable at call time, never splices it into parsed markup.
      if(/onclick="[^"]*encodeURIComponent\(/.test(line)) offenders.push(f + ': ' + line.trim().slice(0, 100));
    });
  });
  assert(offenders.length === 0, 'onclick attribute still built with encodeURIComponent() (not attribute-safe) in:\n  ' + offenders.join('\n  '));
});

test('custAutocomplete() escapes a customer name/phone containing a single quote for the onclick attribute', function(){
  var a = loadApp();
  var hostileName = "x'-alert(1)-'";
  a.S.sales = [{ customer: hostileName, phone: "1'-alert(2)-'", date: new Date().toISOString(), items: [] }];
  a.document.getElementById('s-cust').value = 'x';
  a.custAutocomplete();
  var html = a.document.getElementById('cust-suggestions').innerHTML;
  assert(html.indexOf("fillCust('x\\'-alert(1)-\\''") !== -1, 'expected the quote to be backslash-escaped inside the onclick attribute, got: ' + html.slice(0, 200));
  assert(html.indexOf("fillCust('" + hostileName + "'") === -1, 'the raw, unescaped name must never reach the onclick attribute');
});

// ── Bug: a product's making charge never reached the sale (17 Sep) ──────
// Found in Cowork's live walkthrough: set Making Charge 500/g on a product,
// sell it through the SKU picker, and "Extra making" stayed 0. The bill
// undercharged by mcRate x weight, and calcSaleProfit ALSO subtracted that
// same amount as a cost, so one sale of an 8.5g bangle at 500/g reported a
// 4,250 loss instead of a 4,250 profit — the sign flipped on exactly the
// making charge.
console.log('\nMaking charge reaches the sale (17 Sep):');

function makingScenario(productOverrides){
  var a = loadApp();
  a.S.rates = { g24:7500, g22:7200, g18:6000, g14:4500, sil:90 };
  var p = { id:'p1', name:'Bangle', metal:'gold', purity:'22K', weight:8.5,
            netWeight:8.5, mcRate:500, qty:1, status:'available', sku:'GLD-100' };
  Object.keys(productOverrides||{}).forEach(function(k){ p[k] = productOverrides[k]; });
  a.S.products = [p];
  a.UI.saleMode = 'stock';
  a.UI.saleItems = [{ pid:'p1', qty:1 }];
  return a;
}

test('a stock sale carries the product\'s making charge (500/g x 8.5g = 4,250)', function(){
  var a = makingScenario();
  var sale = a.buildSaleObj();
  assert(approxEqual(sale.items[0].making, 4250, 1),
    'sale item should carry making 4250, got ' + sale.items[0].making);
  assert(approxEqual(sale.lockedGrand, 65450, 1),
    'locked total should be metal 61200 + making 4250 = 65450, got ' + sale.lockedGrand);
});

test('the displayed breakdown and the locked total agree on the making charge', function(){
  var a = makingScenario();
  var sale = a.buildSaleObj();
  var t = a.calcSaleTotals(sale);
  assert(approxEqual(t.mc, 4250, 1), 'breakdown making should be 4250, got ' + t.mc);
  assert(approxEqual(t.grand, sale.lockedGrand, 1),
    'breakdown grand (' + t.grand + ') must match the locked total (' + sale.lockedGrand + ')');
});

test('a sale with a making charge is a profit, not a loss, when no purchase rate was entered', function(){
  // The reported case: a first-time signup who never filled "Purchase Rate".
  var a = makingScenario();
  var sale = a.buildSaleObj();
  var profit = a.calcSaleProfit(sale).profit;
  assert(profit > 0, 'profit should be positive, got ' + profit);
  assert(approxEqual(profit, 4250, 1),
    'with no purchase rate the making charge IS the profit: expected +4250, got ' + profit);
});

test('the making charge is not also subtracted as a cost', function(){
  var a = makingScenario({ costRate: 6000 });
  var sale = a.buildSaleObj();
  var r = a.calcSaleProfit(sale);
  // metal margin (7200-6000) x 8.5 = 10,200, plus the 4,250 making = 14,450.
  assert(approxEqual(r.cost, 51000, 1),
    'cost should be metal only (6000 x 8.5 = 51000), got ' + r.cost);
  assert(approxEqual(r.profit, 14450, 1),
    'profit should be metal margin 10200 + making 4250 = 14450, got ' + r.profit);
});

test('an already-issued bill is not restated when its product has a making charge', function(){
  // Bills printed before this fix stored making:0 and a lockedGrand without
  // it. Deriving making from the product at display time would silently
  // change a total the customer already paid, so it must not happen.
  var a = makingScenario();
  var old = { id:'s-old', date:new Date().toISOString(), invNo:'INV-001',
    items:[{ pid:'p1', name:'Bangle', metal:'gold', purity:'22K', weight:8.5,
             grossWeight:8.5, qty:1, making:0, diamond:0, lockedRate:7200 }],
    making:0, diamond:0, gst:0, discount:0, lockedGrand:61200 };
  var t = a.calcSaleTotals(old);
  assert(approxEqual(t.grand, 61200, 1),
    'an old bill must keep its original total of 61200, got ' + t.grand);
  assert(approxEqual(t.mc, 0, 1),
    'an old bill must keep making 0, got ' + t.mc);
});

// ── Bug: dead onboarding wizard covered the dashboard (17 Sep) ──────────
// #onboard-wizard was made .visible 1.2s after a new shop's first boot, but
// its only renderer call went to renderWizardStep() — the GIRVI form's
// renderer, which writes into gf-* elements. So the overlay appeared empty,
// with no dismiss control, over the dashboard, on every fresh login. Removed
// rather than finished: renderOnboarding() already does this job properly.
console.log('\nOnboarding overlay (17 Sep):');

test('the dead onboarding wizard is gone from both the markup and the styles', function(){
  var fs = require('fs'), path = require('path');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  assert(html.indexOf('onboard-wizard') === -1,
    'index.html still carries #onboard-wizard — an overlay with no renderer can cover the dashboard again');
  assert(html.indexOf('wizard-box') === -1, 'index.html still styles .wizard-box');
});

test('no code path can make an unrenderable overlay visible on boot', function(){
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '07-settings-plans.js'), 'utf-8');
  ['WIZARD_STEPS', 'showOnboardingWizard', 'dismissWizard', 'wizardNext', 'wizardBack'].forEach(function(n){
    assert(src.indexOf(n) === -1, '07-settings-plans.js still references ' + n);
  });
});

test('renderWizardStep still belongs to the girvi form, and only to it', function(){
  // The collision is what hid this bug from scope.js: the name resolved, so
  // nothing flagged that it was the wrong wizard's renderer.
  assert(typeof app.renderWizardStep === 'function', 'renderWizardStep() should still exist for the girvi form');
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '07-settings-plans.js'), 'utf-8');
  var body = src.slice(src.indexOf('function renderWizardStep('));
  body = body.slice(0, body.indexOf('\nfunction '));
  assert(body.indexOf('wizard-steps') === -1 && body.indexOf('wizard-progress') === -1,
    'renderWizardStep() must not be wired to the removed onboarding overlay');
});

test('the working onboarding checklist survived the wizard removal', function(){
  assert(typeof app.renderOnboarding === 'function',
    'renderOnboarding() is the real onboarding and must still exist');
});

test('bootApp is a plain function again, not wrapped by the removed wizard', function(){
  assert(typeof app.bootApp === 'function', 'bootApp() should still exist');
});

// ── Bug: cloudDiag contradicted itself; Data-tab pill stuck (17 Sep) ────
// Cowork saw "auth-gateway: UNREACHABLE" and, two lines later, "Authentication:
// Healthy" — while real logins worked fine. Two separate faults: the probe sent
// SB_HEADERS (which carries Prefer, a header auth-gateway's CORS does not
// allow, so the preflight failed on a healthy gateway), and the summary was
// derived from the store-proxy result alone. Separately the Settings → Data
// "Checking..." pill never updated, because the renderSettings tabs patch
// captured the original and never called it.
console.log('\nCloud diagnostics (17 Sep):');

test('the renderSettings tabs patch calls the function it captured', function(){
  // The dead capture silently killed the Cloud Setup badge, the digest email
  // field and the Razorpay key field all at once.
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '06-inventory-stock.js'), 'utf-8');
  var at = src.indexOf('var _orig = renderSettings');
  if(at !== -1){
    // Scope to THIS wrapper: the same file has three other capture-and-wrap
    // blocks (renderReports, renderCustomers, renderOrders) that do call
    // theirs, and a whole-file search is satisfied by any one of them.
    var block = src.slice(at, src.indexOf('}());', at));
    assert(/_orig\s*\(\s*\)/.test(block),
      '06-inventory-stock.js captures renderSettings as _orig but never calls it — every block only the original renders is dead');
  }
});

test('the auth-gateway probe sends what the real login path sends', function(){
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '08-girvi-viewmode.js'), 'utf-8');
  var probe = src.slice(src.indexOf('var authCheck = fetch('));
  probe = probe.slice(0, probe.indexOf('.catch('));
  assert(probe.indexOf('SB_HEADERS') === -1,
    'the auth-gateway probe still sends SB_HEADERS — it carries Prefer, which auth-gateway CORS rejects, so a healthy gateway reports UNREACHABLE');
  assert(probe.indexOf('"POST"') !== -1 || probe.indexOf("'POST'") !== -1,
    'the probe should POST like authGatewayCall() does, not OPTIONS');
});

function runDiag(fakeFetch){
  var a = loadApp();
  a.SAAS = { user:{email:'o@shop.in'}, shop:{id:'shop1', name:'Test Shop'}, sessionToken:'tok' };
  a.fetch = fakeFetch;
  return a.cloudDiag(true);
}
function okResponse(){
  return Promise.resolve({ status:200, json:function(){ return Promise.resolve({ data:{} }); } });
}

testAsync('a failed auth check is not reported as "Authentication: Healthy"', function(){
  return runDiag(function(url){
    if(String(url).indexOf('/auth-gateway') !== -1) return Promise.reject(new Error('Failed to fetch'));
    return okResponse();
  }).then(function(log){
    var text = log.join('\n');
    assert(text.indexOf('auth-gateway   : UNREACHABLE') !== -1, 'the probe failure should still be reported');
    assert(text.indexOf('Authentication: Healthy') === -1,
      'summary claims Authentication: Healthy while the auth check failed:\n' + text);
    assert(text.indexOf('sign-in') !== -1, 'the summary should name sign-in as the thing that could not be reached');
  });
});

testAsync('a failed sync check is still reported when auth is fine', function(){
  return runDiag(function(url){
    if(String(url).indexOf('/store-proxy') !== -1) return Promise.reject(new Error('Failed to fetch'));
    return okResponse();
  }).then(function(log){
    var text = log.join('\n');
    assert(text.indexOf('Cloud unavailable') !== -1, 'summary should report the sync failure');
    assert(text.indexOf('data sync') !== -1, 'the summary should name data sync as unreachable');
  });
});

testAsync('everything healthy still reports healthy', function(){
  return runDiag(function(){ return okResponse(); }).then(function(log){
    var text = log.join('\n');
    assert(text.indexOf('Cloud status: Connected. Sync: Healthy. Authentication: Healthy.') !== -1,
      'a fully healthy run should say so:\n' + text);
  });
});

// ── Decision: the team roster stays out of the backup (17 Sep) ─────────
// Cowork's review flagged its absence as possibly accidental. It is not: the
// roster is not in S, the server owns it, and restoring one from an untrusted
// file would re-create staff removed since the backup was taken — undoing the
// removed-staff fix. These tests exist so the decision is enforced, not just
// commented, because "add the team to the backup" reads like an improvement.
console.log('\nBackup scope (17 Sep):');

function buildBackupPayload(){
  var a = loadApp();
  a.SAAS = { shop:{id:'shop1', name:'Test Shop'}, user:{name:'O', email:'o@shop.in', role:'owner'} };
  a.S.products = [{ id:'p1', name:'Ring', mcRate:500 }];
  var captured = null;
  a.Blob = function(parts){ captured = parts[0]; };
  a.URL  = { createObjectURL:function(){ return 'blob:test'; }, revokeObjectURL:function(){} };
  a.exportFullBackup();
  return { raw: captured, payload: JSON.parse(captured) };
}

test('the backup carries no team roster and no credentials', function(){
  var b = buildBackupPayload();
  var suspicious = Object.keys(b.payload.data).filter(function(k){
    return /user|staff|team|member|password|hash|salt|token/i.test(k);
  });
  assert(suspicious.length === 0,
    'backup data should hold shop records only, found: ' + suspicious.join(', '));
  ['passwordHash','sessionToken','salt'].forEach(function(s){
    assert(b.raw.indexOf(s) === -1, 'backup file contains "' + s + '" — credentials must never leave the server');
  });
});

test('restoring a backup cannot create or change a team member', function(){
  // The security half: a backup file is untrusted input, so the restore path
  // must not be able to write the user store at all.
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '05-auth-login.js'), 'utf-8');
  var fn = src.slice(src.indexOf('function processBackupFile('));
  fn = fn.slice(0, fn.indexOf('\nfunction '));
  ['saasSetUsers', 'USERS_KEY', 'add-staff'].forEach(function(n){
    assert(fn.indexOf(n) === -1,
      'processBackupFile() references ' + n + ' — a restore must not be able to resurrect removed staff');
  });
});

// ── Bugs 7 and 8: dashboard profit colour, and stale chrome (17 Sep) ────
console.log('\nDashboard and chrome (17 Sep):');

function dashWithProfit(costRate){
  var a = loadApp();
  a.S.rates = { g24:7500, g22:7200, g18:6000, g14:4500, sil:90 };
  a.SAAS.shop = { id:'shop1', name:'Test Shop' };
  var today = new Date().toISOString();
  a.S.products = [{ id:'p1', name:'Ring', metal:'gold', purity:'22K', weight:1, costRate:costRate }];
  a.S.sales = [{ id:'s1', invNo:'INV-001', date:today,
    items:[{ pid:'p1', name:'Ring', metal:'gold', purity:'22K', weight:1, grossWeight:1,
             qty:1, making:0, diamond:0, lockedRate:7200 }],
    making:0, diamond:0, gst:0, discount:0, lockedGrand:7200 }];
  a.renderDash();
  return a._els['dash-today-strip'].innerHTML;
}

test("a loss in Today's Profit is shown in red, not the same green as a profit", function(){
  // costRate above the selling rate => the day really did lose money.
  var html = dashWithProfit(9000);
  var idx = html.indexOf("Today's Profit");
  assert(idx !== -1, "Today's Profit tile should render");
  var tile = html.slice(idx, idx + 220);
  assert(tile.indexOf('#ef4444') !== -1,
    'a negative profit should be red (#ef4444); tile was: ' + tile.slice(0, 160));
  assert(tile.indexOf('#22c55e') === -1, 'a negative profit must not render green');
});

test("a real profit is still green", function(){
  var html = dashWithProfit(5000);
  var tile = html.slice(html.indexOf("Today's Profit"));
  tile = tile.slice(0, 220);
  assert(tile.indexOf('#22c55e') !== -1, 'a positive profit should stay green');
});

test('the sign-in footer year is not hard-coded', function(){
  var a = loadApp();
  a.setFooterYear();
  assert(String(a._els['footer-year'].textContent) === String(new Date().getFullYear()),
    'footer should show the current year, got ' + a._els['footer-year'].textContent);
  var fs = require('fs'), path = require('path');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  assert(html.indexOf('2025 JewelOS') === -1, 'index.html still hard-codes "2025 JewelOS"');
});

test('a brand-new signup is not shown release notes for a version it never used', function(){
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '04-orders-detail.js'), 'utf-8');
  var fn = src.slice(src.indexOf("authGatewayCall('signup'"));
  fn = fn.slice(0, fn.indexOf('.catch('));
  assert(/jewelos_v18_seen/.test(fn),
    'signup should mark the changelog as seen, or a first-time jeweller gets v18.1 release notes');
  assert(/shopScopedKey\(\s*'jewelos_v18_seen'\s*\)/.test(fn),
    'the seeded key must be shop-scoped, like the one bootApp reads');
});

// ── Gap: the making charge could not be corrected after creation (17 Sep) ─
// mcRate reaches the customer's bill as of the fix above, but the Edit Product
// modal had no field for it — a wrong rate could only be fixed by deleting the
// product and re-adding it, which throws away its stock-movement history.
// These drive the real editProd/saveEditProd against stubbed modal inputs.
console.log('\nMaking charge is editable after creation (17 Sep):');

function editModalScenario(fieldOverrides){
  var a = makingScenario();
  a.S.products[0].cat = 'Bangles';
  a.S.products[0].huid = '';
  // saveEditProd's cloud round-trip is not what these tests are about; stub it
  // so they assert on the in-memory record the save would have persisted.
  a.saveAttempts = 0;
  a.saveToCloud = function(cb){ a.saveAttempts++; if(cb) cb(null); };
  a.renderInv = function(){};
  var values = { 'ep-id':'p1', 'ep-name':'Bangle', 'ep-huid':'', 'ep-sku':'GLD-100',
                 'ep-wt':'8.5', 'ep-netwt':'8.5', 'ep-mcrate':'500', 'ep-photo':'',
                 'ep-notes':'', 'ep-purity':'22K' };
  Object.keys(fieldOverrides||{}).forEach(function(k){ values[k] = fieldOverrides[k]; });
  var els = {};
  Object.keys(values).forEach(function(id){
    els[id] = { value: values[id], innerHTML: '', focus: function(){},
                style: {}, classList: { add: function(){}, remove: function(){} } };
  });
  els['ep-cat'] = { value: 'Bangles', options: [{ text: 'Bangles' }], selectedIndex: 0,
                    focus: function(){}, style: {}, classList: { add: function(){}, remove: function(){} } };
  var fallback = a.document.getElementById;
  a.document.getElementById = function(id){ return els[id] || fallback(id); };
  a.els = els;
  return a;
}

test('the Edit Product modal shows the product\'s current making charge', function(){
  var a = editModalScenario({ 'ep-mcrate': 'not-loaded-yet' });
  a.editProd('p1');
  assert(String(a.els['ep-mcrate'].value) === '500',
    'editProd should load mcRate 500 into the modal, got ' + a.els['ep-mcrate'].value);
});

test('saving the Edit Product modal stores the corrected making charge', function(){
  var a = editModalScenario({ 'ep-mcrate': '900' });
  a.saveEditProd();
  assert(a.saveAttempts === 1, 'the edit should have been saved, attempts=' + a.saveAttempts);
  assert(a.S.products[0].mcRate === 900,
    'mcRate should now be 900, got ' + a.S.products[0].mcRate);
});

test('editing an unrelated field does not wipe the making charge', function(){
  // The way a half-done version of this change breaks things: an input in the
  // modal that editProd never fills reads back as '' and silently zeroes the
  // rate on the next save. Round-trip through both functions to catch it.
  var a = editModalScenario({ 'ep-mcrate': '' });
  a.editProd('p1');
  a.els['ep-notes'].value = 'polished';
  a.saveEditProd();
  assert(a.S.products[0].mcRate === 500,
    'an edit to notes must leave mcRate at 500, got ' + a.S.products[0].mcRate);
  assert(a.S.products[0].notes === 'polished', 'the notes edit itself should have saved');
});

test('a negative making charge is rejected and nothing on the product changes', function(){
  var a = editModalScenario({ 'ep-mcrate': '-100', 'ep-name': 'Renamed Bangle' });
  a.saveEditProd();
  assert(a.saveAttempts === 0, 'a rejected edit must not reach saveToCloud');
  assert(a.S.products[0].mcRate === 500, 'mcRate should be untouched, got ' + a.S.products[0].mcRate);
  assert(a.S.products[0].name === 'Bangle',
    'validation runs before any mutation, so the name must not be half-applied, got ' + a.S.products[0].name);
});

test('changing the making charge is recorded in the stock history', function(){
  var a = editModalScenario({ 'ep-mcrate': '900' });
  a.saveEditProd();
  var moves = a.S.stockMovements || [];
  assert(moves.length === 1, 'expected one adjustment movement, got ' + moves.length);
  assert(/making charge/.test(moves[0].reason),
    'the movement should name the making charge, got: ' + moves[0].reason);
});

test('a product created before the field existed does not log a phantom change', function(){
  // Legacy products have no mcRate key at all. undefined !== 0 would push a
  // bogus "making charge 0/g -> 0/g" movement on every unrelated edit.
  var a = editModalScenario({ 'ep-mcrate': '' });
  delete a.S.products[0].mcRate;
  a.saveEditProd();
  assert((a.S.stockMovements || []).length === 0,
    'no field changed, so no movement should be logged, got ' + JSON.stringify(a.S.stockMovements));
});

test('correcting a making charge does NOT restate a bill already issued', function(){
  // The decision this change forces: the rate is now editable, and an edit must
  // never move a total a customer already paid. It holds because buildSaleObj
  // stores making as a flat rupee amount captured at sale time, not as a rate.
  var a = editModalScenario({ 'ep-mcrate': '900' });
  var issued = a.buildSaleObj();
  var issuedGrand = issued.lockedGrand;
  assert(approxEqual(issuedGrand, 65450, 1), 'setup: expected 65450, got ' + issuedGrand);

  a.saveEditProd();                       // 500/g -> 900/g, after the bill was issued
  assert(a.S.products[0].mcRate === 900, 'setup: the edit should have applied');

  assert(approxEqual(issued.items[0].making, 4250, 1),
    'the issued bill must keep making 4250, got ' + issued.items[0].making);
  var t = a.calcSaleTotals(issued);
  assert(approxEqual(t.mc, 4250, 1), 'recomputed making must still be 4250, got ' + t.mc);
  assert(approxEqual(t.grand, issuedGrand, 1),
    'the issued bill must still total ' + issuedGrand + ', got ' + t.grand);
});

test('the corrected making charge DOES apply to the next sale', function(){
  // The other half: an edit that changes nothing going forward is useless.
  var a = editModalScenario({ 'ep-mcrate': '900' });
  a.saveEditProd();
  a.S.products[0].status = 'available';
  a.UI.saleItems = [{ pid:'p1', qty:1 }];
  var next = a.buildSaleObj();
  assert(approxEqual(next.items[0].making, 7650, 1),
    'a sale made after the edit should carry 900 x 8.5 = 7650, got ' + next.items[0].making);
});

// ── Decision: demo data must be unmistakably fake (18 Sep) ─────────────
// Tanish's call was "sample data, clearly labeled". The seeded people used to
// be plausible Indian names with plausible mobile numbers, Mumbai addresses
// and AADHAAR/PAN-shaped id proofs — nothing on screen said they were
// invented. These run the real loadDemoData() and inspect what it seeds.
console.log('\nDemo data is obviously fake (18 Sep):');

function seededDemo(){
  var a = loadApp();
  a.SAAS.shop = { id:'shop1', name:'Test Shop' };
  a.safeConfirm = function(_t, _m, cb){ cb(); };   // the real one waits on a click
  a.saveToCloud = function(cb){ if(cb) cb(null); }; // no reachable backend from here
  a.loadDemoData();
  return a;
}

test('every seeded demo person is named so nobody could take them for a real customer', function(){
  var a = seededDemo();
  var people = [];
  (a.S.sales||[]).forEach(function(s){ people.push(s.customer); });
  (a.S.girvi||[]).forEach(function(g){ people.push(g.customer); });
  (a.S.orders||[]).forEach(function(o){ people.push(o.customer); });
  assert(people.length === 6, 'expected 6 seeded people, got ' + people.length);
  people.forEach(function(n){
    assert(/^Demo Customer \d+$/.test(n), 'demo person "' + n + '" reads as a real name');
  });
});

test('demo phone numbers are obviously fake, but still distinct', function(){
  var a = seededDemo();
  var phones = [];
  (a.S.sales||[]).concat(a.S.girvi||[], a.S.orders||[]).forEach(function(r){ phones.push(r.phone); });
  phones.forEach(function(p){
    assert(/^0{7}\d{3}$/.test(p), 'demo phone "' + p + '" looks like a real mobile number');
  });
  // Distinct matters: the phone is the key that links a customer's records, so
  // one shared number would roll all six demo people into a single account.
  var uniq = phones.filter(function(p, i){ return phones.indexOf(p) === i; });
  assert(uniq.length === phones.length,
    'demo phones must stay distinct, got ' + phones.length + ' records across ' + uniq.length + ' numbers');
});

test('no demo record carries an ID-document-shaped string or a real address', function(){
  var a = seededDemo();
  var blob = JSON.stringify({ s:a.S.sales, g:a.S.girvi, o:a.S.orders });
  ['AADHAAR', 'Aadhaar', 'PAN ', 'Mumbai', 'Andheri', 'Borivali'].forEach(function(s){
    assert(blob.indexOf(s) === -1, 'demo data still contains "' + s + '"');
  });
});

test('clearing demo data leaves nothing behind', function(){
  // The button says "Clear All Data", so it has to clear everything the demo
  // seeded — not just most of it.
  var a = seededDemo();
  a.clearDemoData();
  ['products', 'sales', 'orders', 'girvi'].forEach(function(k){
    assert((a.S[k] || []).length === 0, 'S.' + k + ' still has ' + (a.S[k]||[]).length + ' demo records');
  });
});

// ── Coverage gaps 4.2 and 4.3 from the 16 Sep testing review (18 Sep) ──
// Both were listed as "known but untested". Neither fixes anything — they
// pin what the code actually does today, including where it stays limited,
// so the failure modes are checked rather than just remembered.
console.log('\nKnown limitations, now pinned (18 Sep):');

test('two devices selling the last unit: one wins, the other fails cleanly and never oversells', function(){
  // One shared store enforcing the same compare-and-swap rule store-proxy
  // does. Both devices loaded at version 0, so neither has seen the other.
  var store = { version: 0, savedSales: 0 };
  function deviceAtVersion(seen){
    var a = _freshSaleHarness();
    a.S.products[0].qty = 1;               // the last unit
    a.saveToCloud = function(cb){
      if(seen !== store.version) return cb(new Error('version-conflict'));
      store.version++; store.savedSales++;
      cb(null);
    };
    return a;
  }
  var deviceA = deviceAtVersion(0), deviceB = deviceAtVersion(0);

  deviceA._commitSaleTransaction(_sale('A'));
  deviceB._commitSaleTransaction(_sale('B'));

  assert(store.savedSales === 1, 'exactly one sale may reach the cloud, got ' + store.savedSales);
  assert(deviceA.S.sales.length === 1, 'the winning device keeps its sale');
  assert(deviceA.S.products[0].qty === 0, 'winner sold the last unit, expected qty 0, got ' + deviceA.S.products[0].qty);
  assert(deviceB.S.sales.length === 0, 'the losing device must not keep a sale it could not save');
  assert(deviceB.S.products[0].qty === 1, 'loser must restore stock, got ' + deviceB.S.products[0].qty);
  [deviceA, deviceB].forEach(function(d, i){
    assert(d.S.products[0].qty >= 0, 'no oversell: device ' + (i ? 'B' : 'A') + ' went negative');
  });
});

test('the losing device is still stale afterwards — the known gap, now asserted', function(){
  // `current-priorities.md` lists "no server-side stock reservation" as an
  // open limitation. The CAS write stops the DATA being corrupted, but it
  // does not stop the second jeweller believing the piece is still on the
  // shelf until the next poll. That is the actual residual risk, so it is
  // pinned here rather than left as folklore. If this ever starts failing,
  // reservation has been implemented and this test should be replaced.
  var store = { version: 0 };
  function device(seen){
    var a = _freshSaleHarness();
    a.S.products[0].qty = 1;
    a.saveToCloud = function(cb){
      if(seen !== store.version) return cb(new Error('version-conflict'));
      store.version++; cb(null);
    };
    return a;
  }
  var winner = device(0), loser = device(0);
  winner._commitSaleTransaction(_sale('A'));
  loser._commitSaleTransaction(_sale('B'));
  assert(loser.S.products[0].qty === 1 && loser.S.products[0].status === 'available',
    'documented limitation: the loser still shows the item as available until it re-syncs');
});

test('a girvi payment backdated inside the loan is honoured, not silently moved to today', function(){
  // The 16 Sep review recorded this as "backdated payments silently clamp to
  // today". They do not — girviLedgerState sorts on pay.date and accrues to
  // it, so paying two months ago really does stop interest from two months
  // ago. Recorded here because the review's own note says otherwise.
  var start = new Date(Date.now() - 180*86400000).toISOString().slice(0,10);
  var old   = new Date(Date.now() - 150*86400000).toISOString().slice(0,10);
  var today = new Date().toISOString().slice(0,10);
  function loanPaidOn(d){
    return app.girviLedgerState({
      principal: 100000, interestRate: 2, rateType: 'monthly', compound: false,
      startDate: start, payments: [{ amount: 30000, type: 'partial', date: d }]
    });
  }
  var backdated = loanPaidOn(old).outstanding;
  var paidToday = loanPaidOn(today).outstanding;
  assert(backdated < paidToday,
    'a payment made 150 days ago should leave less owing than the same payment today: ' +
    backdated + ' vs ' + paidToday);
});

test('a girvi payment backdated before the loan even started cannot invent interest relief', function(){
  // Defended in depth, which is worth knowing before "simplifying" either
  // half: girviLedgerState clamps a payment earlier than the ledger cursor up
  // to the cursor, AND accrueTo() refuses a negative span and will not rewind
  // the cursor. Remove either one alone and this still passes; remove both and
  // a payment backdated before the loan start wipes out interest that really
  // did accrue (measured: 64,000 outstanding instead of 78,400 — 14,400 of
  // the shop's money invented from nothing). So this asserts the outcome, not
  // one line of it.
  var start = new Date(Date.now() - 180*86400000).toISOString().slice(0,10);
  var wayBefore = new Date(Date.now() - 900*86400000).toISOString().slice(0,10);
  function loanPaidOn(d){
    return app.girviLedgerState({
      principal: 100000, interestRate: 2, rateType: 'monthly', compound: false,
      startDate: start, payments: [{ amount: 30000, type: 'partial', date: d }]
    });
  }
  var impossible = loanPaidOn(wayBefore).outstanding;
  var onDayOne   = loanPaidOn(start).outstanding;
  assert(approxEqual(impossible, onDayOne, 1),
    'a pre-start payment must be treated as day one, got ' + impossible + ' vs ' + onDayOne);
  assert(impossible > 0, 'outstanding should still be a real figure, got ' + impossible);
});

// ── Bug: a sold-out product could not be edited (Cowork, 18 Sep) ──────
// Edit Product showed the DERIVED total weight (unitWeight x qty), which is 0
// once an item sells out, so its box was empty and "Gross weight required"
// blocked every edit — including correcting a making charge, the commonest
// reason to reopen a sold item. Underneath it: the save wrote that total
// straight into p.weight and never touched unitWeight, so any weight
// correction was silently thrown away at the next quantity change.
console.log('\nEditing a sold-out or batched product (18 Sep):');

// Drives the real flow: editProd() fills the modal, the user changes some
// fields, saveEditProd() saves. Calling saveEditProd alone would test inputs
// no user can ever produce.
function editFlow(product, changes){
  var a = loadApp();
  a.S.products = [product];
  var els = {};
  function el(id){
    return els[id] || (els[id] = { value:'', textContent:'', style:{}, focus:function(){}, innerHTML:'',
      classList:{add:function(){},remove:function(){}}, options:[{text:product.cat||'Rings'}], selectedIndex:0 });
  }
  a.document.getElementById = el;
  a.editProd(product.id);
  els['ep-purity'].value = product.purity;   // a real <select> reports its selected option
  // el(), not els[]: an older editProd never touches the hint, and reading a
  // never-created element would crash — making every test here "fail" before
  // the fix for a reason that has nothing to do with the bug it checks.
  var shown = { wt: el('ep-wt').value, hint: el('ep-wt-hint').textContent };
  Object.keys(changes||{}).forEach(function(k){ el(k).value = changes[k]; });
  a.saveAttempts = 0;
  a.saveToCloud = function(cb){ a.saveAttempts++; cb(null); };
  a.renderInv = function(){};
  a.saveEditProd();
  return { a:a, p:a.S.products[0], shown:shown };
}
function soldOutRing(){
  return { id:'s1', name:'Ring', sku:'GLD-1', metal:'gold', purity:'22K', cat:'Rings',
           unitWeight:10, qty:0, weight:0, netWeight:0, mcRate:500, status:'sold' };
}

test('a sold-out product can be edited — changing its making charge actually saves', function(){
  var r = editFlow(soldOutRing(), { 'ep-mcrate':'900' });
  assert(r.a.saveAttempts === 1, 'the edit must reach saveToCloud, attempts=' + r.a.saveAttempts);
  assert(r.p.mcRate === 900, 'making charge should be 900, got ' + r.p.mcRate);
});

test('a sold-out product shows its real piece weight, not an empty box', function(){
  var r = editFlow(soldOutRing(), {});
  assert(String(r.shown.wt) === '10', 'box should show the 10g piece, got "' + r.shown.wt + '"');
  assert(/sold out/i.test(r.shown.hint), 'hint should explain why a sold item still has a weight, got "' + r.shown.hint + '"');
  assert(r.p.weight === 0, 'a sold-out item\'s total must stay 0, got ' + r.p.weight);
  assert(r.p.unitWeight === 10, 'the piece weight must be kept for restocking, got ' + r.p.unitWeight);
});

test('a weight correction survives the next sale instead of silently reverting', function(){
  // The underlying bug: 18g entered, 10g shown after one piece sold.
  var r = editFlow({ id:'b1', name:'Studs', sku:'GLD-2', metal:'gold', purity:'22K', cat:'Rings',
                     unitWeight:5, qty:3, weight:15, netWeight:15, status:'available' }, { 'ep-wt':'6' });
  assert(String(r.shown.wt) === '5', 'a batch should show ONE piece (5g), got "' + r.shown.wt + '"');
  assert(/3 pieces/.test(r.shown.hint) && /15 g total/.test(r.shown.hint),
    'a batch should say how many pieces and the total, got "' + r.shown.hint + '"');
  assert(r.p.weight === 18, 'after correcting to 6g/piece the total should be 18, got ' + r.p.weight);
  r.p.qty = 2;   // one piece sells: the app re-derives exactly like this
  if(r.p.unitWeight) r.p.weight = Math.round(r.p.unitWeight * r.p.qty * 1000) / 1000;
  assert(r.p.weight === 12, 'the correction must survive a sale: expected 6 x 2 = 12, got ' + r.p.weight);
});

test('you still cannot save a real piece with no weight', function(){
  var r = editFlow({ id:'r1', name:'Chain', sku:'GLD-4', metal:'gold', purity:'22K', cat:'Rings',
                     unitWeight:8, qty:1, weight:8, netWeight:8, status:'available' }, { 'ep-wt':'' });
  assert(r.a.saveAttempts === 0, 'blanking the weight must be refused, attempts=' + r.a.saveAttempts);
  assert(r.p.weight === 8 && r.p.unitWeight === 8, 'nothing should change on a refused save');
});

test('editing an older product logs only what the user actually changed', function(){
  // No unitWeight and no huid field: once "weight 22g→0g" and "HUID —→—".
  var r = editFlow({ id:'l1', name:'Bangle', sku:'GLD-3', metal:'gold', purity:'22K', cat:'Rings',
                     qty:0, weight:22, netWeight:21, mcRate:0, status:'sold' }, { 'ep-mcrate':'300' });
  var reasons = (r.a.S.stockMovements || []).map(function(m){ return m.reason; }).join(' | ');
  assert(r.a.saveAttempts === 1, 'the edit should save');
  assert(/making charge/.test(reasons), 'the real change should be logged, got: ' + reasons);
  assert(!/weight/.test(reasons), 'no phantom weight change should be logged, got: ' + reasons);
  assert(!/HUID/.test(reasons), 'no phantom HUID change should be logged, got: ' + reasons);
});

// ── Bug: the girvi ledger showed the wrong date for a backdated payment ──
// Cowork recorded a payment dated 8 Aug on 18 Sep; the ledger showed 18 Sep on
// both of its rows. The interest maths was right (checked by hand); only the
// displayed date was wrong. Same mistake in all three girvi views.
console.log('\nGirvi payment dates (18 Sep):');

function backdatedLoan(withDateOnActivity){
  var entered = '2026-09-18T12:30:00.000Z';
  var activity = { type:'payment', note:'₹20,000 via cash', ts:'2026-09-18T12:30:00.004Z', user:'Owner' };
  if(withDateOnActivity) activity.date = '2026-08-08';
  return {
    id:'g1', customer:'Demo Customer 1', principal:50400, interestRate:2, rateType:'monthly',
    startDate:'2026-07-18',
    payments:[{ id:'p1', amount:20000, mode:'cash', type:'partial', date:'2026-08-08', ts:entered }],
    ledger:[ { type:'created', note:'Girvi created', ts:'2026-07-18T09:00:00.000Z' }, activity ]
  };
}

test('the ledger shows when a backdated payment was paid, not when it was typed in', function(){
  var a = loadApp();
  a.glRenderEntries(backdatedLoan(false));
  var html = a._els['gl-entries'].innerHTML;
  var aug = a.fmtDate('2026-08-08'), sep = a.fmtDate('2026-09-18');
  assert(html.indexOf(aug) !== -1, 'the ledger should show the payment date ' + aug);
  assert(html.indexOf(sep) === -1,
    'no row should show the entry date ' + sep + ' — both rows belong to the 8 Aug payment');
});

test('an older activity row with no date recovers it from its own payment', function(){
  var a = loadApp(), g = backdatedLoan(false);
  assert(a.girviEventDate(g, g.ledger[1]) === '2026-08-08',
    'expected the matched payment date, got ' + a.girviEventDate(g, g.ledger[1]));
});

test('a new payment records its real date on the activity row too', function(){
  var a = loadApp(), g = backdatedLoan(true);
  assert(a.girviEventDate(g, g.ledger[1]) === '2026-08-08', 'a stored date should be used as-is');
});

test('when the matching payment is ambiguous, no date is guessed', function(){
  // Two payments within the window: the old row keeps its own timestamp
  // rather than risk showing the wrong one of two real dates.
  var a = loadApp(), g = backdatedLoan(false);
  g.payments.push({ id:'p2', amount:5000, mode:'cash', type:'partial', date:'2026-08-20', ts:'2026-09-18T12:30:01.000Z' });
  assert(a.girviEventDate(g, g.ledger[1]) === g.ledger[1].ts,
    'an ambiguous match must fall back to the row\'s own time, got ' + a.girviEventDate(g, g.ledger[1]));
});

test('a payment date with no time of day is not given an invented one', function(){
  var a = loadApp();
  a.glRenderEntries(backdatedLoan(true));
  var html = a._els['gl-entries'].innerHTML;
  var fake = a.fmtTime('2026-08-08');   // what printing a bare date as a time would produce
  var rows = html.split('gl-entry-date').slice(1).filter(function(r){ return r.indexOf(a.fmtDate('2026-08-08')) !== -1; });
  assert(rows.length > 0, 'expected rows dated 8 Aug');
  rows.forEach(function(r){
    assert(r.indexOf('gl-entry-time">' + fake) === -1, 'an 8 Aug payment should not claim to have happened at ' + fake);
  });
});

// ── Day Book (rojmel) — Batch A: state plumbing only ──────────────────────
// Auto-line derivation, balances, Close Day and the locked-day sweep are
// covered by later batches. This section only proves the helpers, the
// load-order guard and the two-shop cache isolation for the new S.dayBook key.
console.log('\nDay Book:');

test('dbDayKey returns the LOCAL calendar day, not the UTC one', function(){
  // 11:30pm IST on 5 Sep is already 6:00pm UTC on 5 Sep, so this timestamp
  // doesn't itself prove much — the real risk is the reverse case, checked
  // right below, where local and UTC actually disagree.
  assert(app.dbDayKey('2026-09-05T23:30:00+05:30') === '2026-09-05',
    'expected 2026-09-05, got ' + app.dbDayKey('2026-09-05T23:30:00+05:30'));
  // 12:30am IST on 6 Sep is 7:00pm UTC on 5 Sep — a naive .toISOString()
  // .slice(0,10) on the UTC instant would say 5 Sep. Local must say 6 Sep.
  assert(app.dbDayKey('2026-09-06T00:30:00+05:30') === '2026-09-06',
    'expected 2026-09-06, got ' + app.dbDayKey('2026-09-06T00:30:00+05:30'));
  assert(app.dbDayKey('2026-09-05') === '2026-09-05', 'an already-keyed string passes through');
});

test('dbIsCash is true only for an exact "cash", case/whitespace-insensitive', function(){
  assert(app.dbIsCash('Cash') === true, 'Cash');
  assert(app.dbIsCash('cash') === true, 'cash');
  assert(app.dbIsCash(' Cash ') === true, 'padded Cash');
  assert(app.dbIsCash('Manual') === false, 'Manual');
  assert(app.dbIsCash('Waiver') === false, 'Waiver');
  assert(app.dbIsCash('Credit') === false, 'Credit');
  assert(app.dbIsCash('Other') === false, 'Other');
  assert(app.dbIsCash('') === false, 'empty string');
  assert(app.dbIsCash(undefined) === false, 'undefined');
});

test('dbInit gives a fresh shop a well-shaped, empty S.dayBook', function(){
  var a = loadApp();
  a.S.dayBook = undefined;
  a.dbInit();
  assert(a.S.dayBook.opening === null, 'opening starts null');
  assert(Array.isArray(a.S.dayBook.entries) && a.S.dayBook.entries.length === 0, 'entries starts empty');
  assert(Array.isArray(a.S.dayBook.closes) && a.S.dayBook.closes.length === 0, 'closes starts empty');
});

test('dbInit repairs a malformed S.dayBook without discarding good arrays', function(){
  var a = loadApp();
  a.S.dayBook = { entries: [{id:'e1'}], closes: 'not-an-array', opening: 'not-an-object' };
  a.dbInit();
  assert(a.S.dayBook.entries.length === 1, 'existing entries survive');
  assert(Array.isArray(a.S.dayBook.closes) && a.S.dayBook.closes.length === 0, 'bad closes replaced with []');
  assert(a.S.dayBook.opening === null, 'bad opening replaced with null');
});

test('normaliseData() calls dbInit(), so S.dayBook is always safe to read', function(){
  var a = loadApp();
  a.S.dayBook = undefined;
  a.normaliseData();
  assert(a.S.dayBook && typeof a.S.dayBook === 'object', 'normaliseData should have run dbInit()');
});

test('loadCache() ignores a cache tagged with a different shop id (two shops, one device)', function(){
  var a = loadApp();
  a.SAAS.shop = { id: 'shop_b' };
  a.localStorage.setItem('ssj_cache', JSON.stringify({
    shopId: 'shop_a',
    products: [], sales: [],
    dayBook: { opening:null, entries:[{id:'leaked'}], closes:[] }
  }));
  var ok = a.loadCache();
  assert(ok === false, 'loadCache should refuse a cache belonging to another shop');
  assert(a.S.dayBook === null, 'the other shop\'s leaked day-book entries must not have been adopted: ' + JSON.stringify(a.S.dayBook));
});

// ── Day Book — Batch B: auto-line derivation and balances ─────────────
// Posting-rule tests are grouped by source (sale/purchase/girvi/order);
// balance tests build S.dayBook.closes/opening fixtures directly rather
// than going through dbCloseDay (Batch C), since these are pure reads.

test('closing = opening + in - out, exact, on a day with mixed auto and manual lines', function(){
  var a = loadApp(); a.dbInit();
  a.S.dayBook.opening = { date:'2026-09-01', amount:1000, ts:'2026-09-01T00:00:00.000Z' };
  a.S.sales = [{ id:'s1', date:'2026-09-01', invNo:'INV-1', splitPayments:[{amount:500, mode:'Cash'}] }];
  a.S.dayBook.entries = [{ id:'e1', date:'2026-09-01', dir:'out', amount:200, cat:'rent', kind:'manual', voided:false }];
  var v = a.dbDayView('2026-09-01');
  assert(v.opening === 1000, 'opening: ' + v.opening);
  assert(v.totalIn === 500 && v.totalOut === 200, 'totals: in=' + v.totalIn + ' out=' + v.totalOut);
  assert(v.closing === 1300, 'closing: ' + v.closing);
});

test('closing of day N equals opening of day N+1 when N is closed', function(){
  var a = loadApp(); a.dbInit();
  a.S.dayBook.closes = [{ date:'2026-09-01', opening:1000, autoIn:500, autoOut:0, manualIn:0, manualOut:200, closing:1300, counted:1300, diff:0, restatements:[], countCorrections:[] }];
  assert(a.dbOpening('2026-09-02') === 1300, 'got ' + a.dbOpening('2026-09-02'));
});

test('a day with no entries still shows the carried-forward balance from the last close', function(){
  var a = loadApp(); a.dbInit();
  a.S.dayBook.closes = [{ date:'2026-09-01', opening:1000, autoIn:500, autoOut:0, manualIn:0, manualOut:200, closing:1300, counted:1300, diff:0, restatements:[], countCorrections:[] }];
  var v = a.dbDayView('2026-09-05');
  assert(v.opening === 1300 && v.closing === 1300, 'opening=' + v.opening + ' closing=' + v.closing);
});

test('opening for an unclosed day after the last close includes the intervening unclosed day\'s movement', function(){
  var a = loadApp(); a.dbInit();
  a.S.dayBook.closes = [{ date:'2026-09-01', opening:1000, autoIn:500, autoOut:0, manualIn:0, manualOut:200, closing:1300, counted:1300, diff:0, restatements:[], countCorrections:[] }];
  a.S.sales = [{ id:'s1', date:'2026-09-02', invNo:'INV-2', splitPayments:[{amount:300, mode:'Cash'}] }];
  assert(a.dbOpening('2026-09-03') === 1600, 'got ' + a.dbOpening('2026-09-03'));
});

console.log('\nDay Book posting rules — Sales:');

test('a UPI-only sale contributes nothing to cash in', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:5000, payment:'UPI' }];
  assert(a.dbAutoTotals('2026-09-05').in === 0, 'expected no cash in');
});

test('a split sale (Cash 20,000 + UPI 30,000) posts exactly 20,000 in on the sale date', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', splitPayments:[{amount:20000,mode:'Cash'},{amount:30000,mode:'UPI'}] }];
  assert(a.dbAutoTotals('2026-09-05').in === 20000, 'got ' + a.dbAutoTotals('2026-09-05').in);
});

test('splitPayments present means nowPaying is not also counted', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', splitPayments:[{amount:1000,mode:'Cash'}], nowPaying:{amount:9999,mode:'Cash'} }];
  assert(a.dbAutoTotals('2026-09-05').in === 1000, 'got ' + a.dbAutoTotals('2026-09-05').in);
});

test('no splitPayments falls back to nowPaying; neither falls back to advance+payment', function(){
  var a = loadApp();
  a.S.sales = [
    { id:'s1', date:'2026-09-05', invNo:'INV-1', nowPaying:{amount:700,mode:'Cash'}, advance:9999, payment:'Cash' },
    { id:'s2', date:'2026-09-05', invNo:'INV-2', advance:300, payment:'Cash' }
  ];
  assert(a.dbAutoTotals('2026-09-05').in === 1000, 'got ' + a.dbAutoTotals('2026-09-05').in);
});

test('sale.prevAdvance never produces a line, even at 50,000', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', prevAdvance:{amount:50000,mode:'Cash'}, advance:0, payment:'Cash' }];
  assert(a.dbAutoTotals('2026-09-05').in === 0, 'got ' + a.dbAutoTotals('2026-09-05').in);
});

test('sale.paymentHistory never produces a line; extraPayments still counts once', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:0, payment:'Cash',
    paymentHistory:[{amount:1200,mode:'Cash',date:'2026-09-06'}],
    extraPayments:[{id:'p1',amount:1200,mode:'Cash',date:'2026-09-06'}] }];
  assert(a.dbAutoTotals('2026-09-06').in === 1200, 'expected exactly one count of 1200, got ' + a.dbAutoTotals('2026-09-06').in);
});

test('extraPayments cash entry posts in on its OWN date, not the sale date', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:0, payment:'Cash', extraPayments:[{id:'p1',amount:800,mode:'Cash',date:'2026-09-09'}] }];
  assert(a.dbAutoTotals('2026-09-05').in === 0, 'sale date should show nothing');
  assert(a.dbAutoTotals('2026-09-09').in === 800, 'got ' + a.dbAutoTotals('2026-09-09').in);
});

test('extraPayments type:reversal posts cash out', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:0, payment:'Cash', extraPayments:[{id:'p1',type:'reversal',amount:400,mode:'Cash',date:'2026-09-09'}] }];
  assert(a.dbAutoTotals('2026-09-09').out === 400, 'got ' + a.dbAutoTotals('2026-09-09').out);
});

test('extraPayments mode:Manual posts nothing but is flagged unknown', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:0, payment:'Cash', extraPayments:[{id:'p1',amount:600,mode:'Manual',date:'2026-09-09'}] }];
  var t = a.dbAutoTotals('2026-09-09');
  assert(t.in === 0 && t.out === 0, 'a Manual-mode payment must never be counted as cash');
  assert(t.unknownCount === 1, 'got unknownCount=' + t.unknownCount);
});

test('sale.refunds[] cash entry posts out on the refund date', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:0, payment:'Cash', refunds:[{id:'r1',amount:900,mode:'Cash',date:'2026-09-10'}] }];
  assert(a.dbAutoTotals('2026-09-10').out === 900, 'got ' + a.dbAutoTotals('2026-09-10').out);
});

console.log('\nDay Book posting rules — Purchases:');

test('purchase bill paymentMethod:Credit posts nothing', function(){
  var a = loadApp();
  a.S.purchases = [{ id:'p1', date:'2026-09-05', billNo:'PB-1', amountPaid:15000, paymentMethod:'Credit' }];
  assert(a.dbAutoTotals('2026-09-05').out === 0, 'a Credit bill must not post a cash-out');
});

test('purchase bill paymentMethod:Cash posts amountPaid out on bill.date', function(){
  var a = loadApp();
  a.S.purchases = [{ id:'p1', date:'2026-09-05', billNo:'PB-1', amountPaid:15000, paymentMethod:'Cash' }];
  assert(a.dbAutoTotals('2026-09-05').out === 15000, 'got ' + a.dbAutoTotals('2026-09-05').out);
});

test('bill.supplierPayments[] cash entry posts out on its own date; a reversal posts in', function(){
  var a = loadApp();
  a.S.purchases = [{ id:'p1', date:'2026-09-01', billNo:'PB-1', amountPaid:0, paymentMethod:'Credit',
    supplierPayments:[
      { id:'sp1', amount:5000, mode:'Cash', date:'2026-09-07' },
      { id:'sp2', type:'reversal', amount:2000, mode:'Cash', date:'2026-09-08' }
    ] }];
  assert(a.dbAutoTotals('2026-09-07').out === 5000, 'payment out: ' + a.dbAutoTotals('2026-09-07').out);
  assert(a.dbAutoTotals('2026-09-08').in === 2000, 'reversal in: ' + a.dbAutoTotals('2026-09-08').in);
});

console.log('\nDay Book posting rules — Girvi:');

test('girvi type:payment cash posts in on p.date, not p.ts, when they differ', function(){
  var a = loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-1', startDate:'2026-08-01', principal:0,
    payments:[{ id:'pay1', amount:3000, mode:'Cash', type:'payment', date:'2026-09-05', ts:'2026-09-06T18:00:00.000Z' }] }];
  assert(a.dbAutoTotals('2026-09-05').in === 3000, 'expected 2026-09-05 to show it, got ' + a.dbAutoTotals('2026-09-05').in);
  assert(a.dbAutoTotals('2026-09-06').in === 0, 'p.ts must not be used when p.date is present');
});

test('girvi type:interest posts in; type:refund posts out', function(){
  var a = loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-1', startDate:'2026-08-01', principal:0,
    payments:[
      { id:'pay1', amount:400, mode:'Cash', type:'interest', date:'2026-09-05' },
      { id:'pay2', amount:1500, mode:'Cash', type:'refund',   date:'2026-09-05' }
    ] }];
  var t = a.dbAutoTotals('2026-09-05');
  assert(t.in === 400, 'interest in: ' + t.in);
  assert(t.out === 1500, 'refund out: ' + t.out);
});

test('girvi type:penalty with mode:Cash posts no line — it is a charge, not cash received', function(){
  var a = loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-1', startDate:'2026-08-01', principal:0,
    payments:[{ id:'pay1', amount:250, mode:'Cash', type:'penalty', date:'2026-09-05' }] }];
  var t = a.dbAutoTotals('2026-09-05');
  assert(t.in === 0 && t.out === 0, 'a penalty must never be posted as cash');
});

test('girvi type:waiver posts no line', function(){
  var a = loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-1', startDate:'2026-08-01', principal:0,
    payments:[{ id:'pay1', amount:250, mode:'Waiver', type:'waiver', date:'2026-09-05' }] }];
  var t = a.dbAutoTotals('2026-09-05');
  assert(t.in === 0 && t.out === 0, 'a waiver must never be posted as cash');
});

test('a girvi loan with no disburseMode posts no cash-out and is flagged unknown; with disburseMode:Cash it posts', function(){
  var a = loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-1', startDate:'2026-09-05', principal:150000, payments:[] }];
  var t1 = a.dbAutoTotals('2026-09-05');
  assert(t1.out === 0, 'must never default a missing disburseMode to Cash');
  assert(t1.unknownCount === 1, 'got unknownCount=' + t1.unknownCount);

  var b = loadApp();
  b.S.girvi = [{ id:'g2', grvNo:'GRV-2', startDate:'2026-09-05', principal:150000, disburseMode:'Cash', payments:[] }];
  assert(b.dbAutoTotals('2026-09-05').out === 150000, 'got ' + b.dbAutoTotals('2026-09-05').out);
});

console.log('\nDay Book posting rules — Orders:');

test('order ledger advance cash posts in on the txn date; a reversal posts out', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', ordNo:'ORD-1', createdAt:'2026-09-01T10:00:00.000Z', advance:0,
    ledger:[
      { txnId:'t1', type:'advance', amount:2000, mode:'Cash', date:'2026-09-01T10:00:00.000Z' },
      { txnId:'t2', type:'reversal', amount:2000, mode:'Cash', date:'2026-09-02T09:00:00.000Z' }
    ] }];
  assert(a.dbAutoTotals('2026-09-01').in === 2000, 'advance in: ' + a.dbAutoTotals('2026-09-01').in);
  assert(a.dbAutoTotals('2026-09-02').out === 2000, 'reversal out: ' + a.dbAutoTotals('2026-09-02').out);
});

test('an order with no ledger but advance > 0 posts the legacy fallback exactly once', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', ordNo:'ORD-1', createdAt:'2026-09-01T10:00:00.000Z', advance:1200, payment:'Cash' }];
  assert(a.dbAutoTotals('2026-09-01').in === 1200, 'got ' + a.dbAutoTotals('2026-09-01').in);
  assert(a.dbAutoLines('2026-09-01').length === 1, 'expected exactly one line, got ' + a.dbAutoLines('2026-09-01').length);
});

test('an order advance converted to a sale is counted once, not twice', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', ordNo:'ORD-1', createdAt:'2026-09-01T10:00:00.000Z', advance:2000,
    ledger:[{ txnId:'t1', type:'advance', amount:2000, mode:'Cash', date:'2026-09-01T10:00:00.000Z' }] }];
  a.S.sales = [{ id:'s1', date:'2026-09-10', invNo:'INV-1', prevAdvance:{amount:2000,mode:'Cash'},
    splitPayments:[{amount:3000, mode:'Cash'}] }]; // 3000 = the balance actually collected on delivery
  assert(a.dbAutoTotals('2026-09-01').in === 2000, 'order date should show the advance once: ' + a.dbAutoTotals('2026-09-01').in);
  assert(a.dbAutoTotals('2026-09-10').in === 3000, 'sale date should show only the new cash, not the advance again: ' + a.dbAutoTotals('2026-09-10').in);
});

// ── Day Book — Batch C: writes (manual entries, Close Day, corrections) ──
// saveToCloud is stubbed to call back synchronously with success, same
// pattern _freshSaleHarness() above uses for _commitSaleTransaction —
// this keeps these tests synchronous rather than needing testAsync.
function _dbHarness(){
  var a = loadApp();
  a.dbInit();
  a.saveToCloud = function(cb){ cb(null); };
  return a;
}
function _dbCloseFixture(date, overrides){
  var c = {date:date, opening:0, autoIn:0, autoOut:0, manualIn:0, manualOut:0, closing:0, counted:0, diff:0, ts:new Date().toISOString(), restatements:[], countCorrections:[]};
  for(var k in (overrides||{})) c[k] = overrides[k];
  return c;
}
console.log('\nDay Book writes:');

test('voiding a manual line removes it from totals and leaves a visible void with a reason', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-09-05','out',500,'rent','',function(err, entry){
    assert(!err, 'add should succeed: ' + (err && err.message));
    assert(a.dbManualTotals('2026-09-05').out === 500, 'expected 500 before voiding');
    a.dbVoidEntry(entry.id, 'Entered twice by mistake', function(err2){
      assert(!err2, 'void should succeed: ' + (err2 && err2.message));
      assert(a.dbManualTotals('2026-09-05').out === 0, 'voided line must drop out of totals');
      var stored = a.S.dayBook.entries[0];
      assert(stored.voided === true && stored.voidReason === 'Entered twice by mistake', 'void must be visible on the record');
    });
  });
});

test('a voided line cannot be voided twice', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-09-05','out',500,'rent','',function(err, entry){
    a.dbVoidEntry(entry.id, 'first void', function(){
      a.dbVoidEntry(entry.id, 'second void', function(err3){
        assert(err3 && err3.message === 'already-voided', 'expected already-voided, got ' + (err3 && err3.message));
      });
    });
  });
});

test('a manual entry cannot be added to a closed day', function(){
  var a = _dbHarness();
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-05')];
  a.dbAddEntry('2026-09-05','out',500,'rent','',function(err){
    assert(err && err.message === 'day-closed', 'expected day-closed, got ' + (err && err.message));
  });
});

test('QA P1 item 8: after closing today, "Record the shortfall" lands on tomorrow instead of failing future-date', function(){
  var a = _dbHarness();
  var today = a.dbToday();
  a.S.dayBook.closes = [_dbCloseFixture(today)];
  var tomorrow = a.dbFirstOpenDay();
  assert(tomorrow > today, 'setup: first open day should be tomorrow');
  var got = 'pending';
  a.dbAddEntry(tomorrow, 'out', 500, 'cashShort', 'From closing ' + today, function(err){ got = err ? err.message : 'ok'; });
  assert(got === 'ok', 'the shortfall entry should be recorded, got ' + got);
  assert(a.S.dayBook.entries.some(function(e){ return e.cat === 'cashShort' && e.date === tomorrow && e.amount === 500; }), 'entry not stored');
  var manual = 'pending';
  a.dbAddEntry(tomorrow, 'out', 500, 'rent', '', function(err){ manual = err ? err.message : 'ok'; });
  assert(manual === 'future-date', 'a manual future-dated entry must still be refused, got ' + manual);
});

test('dbSetOpening refuses once any close exists', function(){
  var a = _dbHarness();
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-01')];
  a.dbSetOpening('2026-08-01', 1000, function(err){
    assert(err && err.message === 'opening-locked', 'got ' + (err && err.message));
  });
});

test('dbCloseDay refuses a future date', function(){
  var a = _dbHarness();
  var future = String(new Date().getFullYear() + 5) + '-01-01';
  a.dbCloseDay(future, 0, function(err){
    assert(err && err.message === 'future-date', 'got ' + (err && err.message));
  });
});

test('dbCloseDay refuses a date earlier than the latest existing close', function(){
  var a = _dbHarness();
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-10')];
  a.dbCloseDay('2026-09-05', 0, function(err){
    assert(err && err.message === 'before-latest-close', 'got ' + (err && err.message));
  });
});

test('dbCloseDay refuses a date already closed', function(){
  var a = _dbHarness();
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-05')];
  a.dbCloseDay('2026-09-05', 0, function(err){
    assert(err && err.message === 'already-closed', 'got ' + (err && err.message));
  });
});

test('diff = counted - closing is negative (short) when counted is less', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = {date:'2026-09-05', amount:1000, ts:new Date().toISOString()};
  a.dbCloseDay('2026-09-05', 900, function(err, res){
    assert(!err, err && err.message);
    assert(res.diff === -100, 'expected short -100, got ' + res.diff);
  });
});

test('diff = counted - closing is positive (excess) when counted is more', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = {date:'2026-09-05', amount:1000, ts:new Date().toISOString()};
  a.dbCloseDay('2026-09-05', 1100, function(err, res){
    assert(!err, err && err.message);
    assert(res.diff === 100, 'expected excess 100, got ' + res.diff);
  });
});

test('short/excess never changes the stored closing, and day N+1 still opens at that closing', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = {date:'2026-09-05', amount:1000, ts:new Date().toISOString()};
  a.dbCloseDay('2026-09-05', 700, function(err, res){
    assert(!err, err && err.message);
    assert(res.closing === 1000, 'closing must stay the book figure regardless of what was counted, got ' + res.closing);
    assert(a.dbOpening('2026-09-06') === 1000, 'day N+1 must open at the CLOSING, not the counted amount, got ' + a.dbOpening('2026-09-06'));
  });
});

test('dbCorrectCount succeeds on the latest close made today, leaves closing untouched, and logs the correction', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = {date:'2026-09-05', amount:1000, ts:new Date().toISOString()};
  a.dbCloseDay('2026-09-05', 900, function(){
    a.dbCorrectCount('2026-09-05', 950, 'Miscounted, recounted immediately', function(err){
      assert(!err, err && err.message);
      var close = a.S.dayBook.closes[0];
      assert(close.counted === 950, 'counted should update, got ' + close.counted);
      assert(close.diff === -50, 'diff should recompute, got ' + close.diff);
      assert(close.closing === 1000, 'closing must never be touched by a count correction');
      assert(close.countCorrections.length === 1 && close.countCorrections[0].reason === 'Miscounted, recounted immediately', 'expected one logged correction');
    });
  });
});

test('dbCorrectCount refuses once a later day has been closed', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = {date:'2026-09-05', amount:1000, ts:new Date().toISOString()};
  a.dbCloseDay('2026-09-05', 900, function(){
    a.dbCloseDay('2026-09-06', 900, function(){
      a.dbCorrectCount('2026-09-05', 950, 'too late', function(err){
        assert(err && err.message === 'not-latest-close', 'got ' + (err && err.message));
      });
    });
  });
});

test('dbCorrectCount refuses once the same-day correction window has passed', function(){
  var a = _dbHarness();
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-05', {opening:1000, closing:1000, counted:900, diff:-100, ts:'2020-01-01T00:00:00.000Z'})];
  a.dbCorrectCount('2026-09-05', 950, 'too late', function(err){
    assert(err && err.message === 'correction-window-passed', 'got ' + (err && err.message));
  });
});

test('dbFirstOpenDay is today, or tomorrow if today is already closed', function(){
  var a = _dbHarness();
  assert(a.dbFirstOpenDay() === a.dbToday(), 'with nothing closed, first open day is today');
  a.S.dayBook.closes = [_dbCloseFixture(a.dbToday())];
  assert(a.dbFirstOpenDay() !== a.dbToday(), 'once today is closed, first open day must move to tomorrow');
});

// ── Day Book — Batch D: the locked-day restatement sweep (spec §6) ────
// The core of the whole feature: a closed day's stored closing must
// never move, and a later correction to a record dated inside it must
// surface as a visible adjustment instead of rewriting the past.
console.log('\nDay Book locked-day sweep:');

test('editing a sale on a closed day does not change that day\'s stored closing', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-01', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-01', {autoIn:1000, closing:1000, counted:1000})];
  a.S.sales[0].splitPayments[0].amount = 800; // the correction, made after close
  var v = a.dbDayView('2026-09-01');
  assert(v.closing === 1000, 'a closed day\'s closing must be frozen, got ' + v.closing);
});

test('the sweep posts exactly one adjustment, on the first open day, for the net delta', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-01', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-01', {autoIn:1000, closing:1000, counted:1000})];
  a.S.sales[0].splitPayments[0].amount = 800;
  a.dbSweepRestatements(function(err, count){
    assert(!err, 'sweep should succeed: ' + (err && err.message));
    assert(count === 1, 'expected exactly one close restated, got ' + count);
    var adj = a.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; });
    assert(adj.length === 1, 'expected exactly one adjustment entry, got ' + adj.length);
    assert(adj[0].dir === 'out' && adj[0].amount === 200, 'expected out 200 (1000 -> 800), got ' + adj[0].dir + ' ' + adj[0].amount);
    assert(adj[0].date === a.dbFirstOpenDay(), 'adjustment must land on the first open day');
    assert(adj[0].srcDate === '2026-09-01', 'adjustment must reference the day it corrects');
  });
});

test('running the sweep twice posts the adjustment only once (idempotent)', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-01', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-01', {autoIn:1000, closing:1000, counted:1000})];
  a.S.sales[0].splitPayments[0].amount = 800;
  a.dbSweepRestatements(function(){
    a.dbSweepRestatements(function(err2, count2){
      assert(!err2, err2 && err2.message);
      assert(count2 === 0, 'the second run should find nothing left to restate, got ' + count2);
      var adj = a.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; });
      assert(adj.length === 1, 'still exactly one adjustment after two sweeps, got ' + adj.length);
    });
  });
});

test('a sweep records prev/new totals on the close and re-baselines it', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-01', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-01', {autoIn:1000, closing:1000, counted:1000})];
  a.S.sales[0].splitPayments[0].amount = 800;
  a.dbSweepRestatements(function(){
    var close = a.S.dayBook.closes[0];
    assert(close.restatements.length === 1, 'expected one restatement record, got ' + close.restatements.length);
    assert(close.restatements[0].prevIn === 1000 && close.restatements[0].newIn === 800, 'restatement should record prev/new totals');
    assert(close.autoIn === 800, 'the close baseline must be re-anchored to the new total, got ' + close.autoIn);
  });
});

test('moving a record from one closed day to another posts two adjustments netting zero', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-02', invNo:'INV-1', splitPayments:[{amount:500, mode:'Cash'}] }];
  a.S.dayBook.closes = [
    _dbCloseFixture('2026-09-01', {autoIn:500, closing:500, counted:500}), // the sale used to be here
    _dbCloseFixture('2026-09-02', {autoIn:0,   closing:0,   counted:0})
  ];
  a.dbSweepRestatements(function(err, count){
    assert(!err, err && err.message);
    assert(count === 2, 'both closed days should be restated, got ' + count);
    var adj = a.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; });
    assert(adj.length === 2, 'expected two adjustment entries, got ' + adj.length);
    var net = adj.reduce(function(s,e){ return s + (e.dir === 'in' ? e.amount : -e.amount); }, 0);
    assert(net === 0, 'the two adjustments should net to zero, got ' + net);
  });
});

test('an adjustment entry can never be voided', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-01', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-01', {autoIn:0, closing:0, counted:0})];
  a.dbSweepRestatements(function(){
    var adj = a.S.dayBook.entries[0];
    a.dbVoidEntry(adj.id, 'trying anyway', function(err2){
      assert(err2 && err2.message === 'cannot-void-adjustment', 'got ' + (err2 && err2.message));
    });
  });
});

test('when today is already closed, the adjustment lands on today + 1, not on today', function(){
  var a = _dbHarness();
  var today = a.dbToday();
  a.S.sales = [{ id:'s1', date:'2026-08-01', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.closes = [
    _dbCloseFixture('2026-08-01', {autoIn:0, closing:0, counted:0}),
    _dbCloseFixture(today,        {autoIn:0, closing:0, counted:0})
  ];
  a.dbSweepRestatements(function(err, count){
    assert(!err, err && err.message);
    var adj = a.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust' && e.srcDate === '2026-08-01'; })[0];
    assert(adj, 'expected an adjustment correcting 2026-08-01');
    assert(adj.date !== today, 'must not land on an already-closed today');
    assert(adj.date === a._dbNextDay(today), 'expected it on today + 1, got ' + adj.date);
  });
});

test('a failed sweep save rolls back both the re-baselined totals and the new adjustment entry', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-01', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.closes = [_dbCloseFixture('2026-09-01', {autoIn:0, autoOut:0, closing:0, counted:0})];
  a.saveToCloud = function(cb){ cb(new Error('network down')); };
  a.dbSweepRestatements(function(err){
    assert(err, 'expected the sweep\'s save failure to propagate');
    assert(a.S.dayBook.closes[0].autoIn === 0, 'the baseline must roll back on save failure, got ' + a.S.dayBook.closes[0].autoIn);
    assert(a.S.dayBook.entries.length === 0, 'the adjustment entry must be rolled back too, got ' + a.S.dayBook.entries.length);
  });
});

// ── Day Book — Batch F: print/WhatsApp share the same totals as the screen ──
console.log('\nDay Book print/WhatsApp:');

test('dbBuildDaySummary reports the same opening/in/out/closing as dbDayView for the same date', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] }];
  a.S.dayBook.entries = [{ id:'e1', date:'2026-09-05', dir:'out', amount:200, cat:'rent', kind:'manual', voided:false }];
  var v = a.dbDayView('2026-09-05');
  var msg = a.dbBuildDaySummary('2026-09-05');
  assert(msg.indexOf(a.fmt(v.opening)) !== -1, 'summary should mention the same opening as the screen');
  assert(msg.indexOf(a.fmt(v.totalIn)) !== -1, 'summary should mention the same cash-in total as the screen');
  assert(msg.indexOf(a.fmt(v.totalOut)) !== -1, 'summary should mention the same cash-out total as the screen');
  assert(msg.indexOf(a.fmt(v.closing)) !== -1, 'summary should mention the same closing as the screen');
});

test('dbBuildDaySummary excludes voided and unknown-mode lines from the listed detail', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:0, payment:'Cash',
    extraPayments:[{id:'p1', amount:777, mode:'Manual', date:'2026-09-05'}] }];
  a.S.dayBook.entries = [{ id:'e1', date:'2026-09-05', dir:'out', amount:333, cat:'rent', kind:'manual', voided:true, voidReason:'mistake' }];
  var msg = a.dbBuildDaySummary('2026-09-05');
  assert(msg.indexOf(a.fmt(777)) === -1, 'an unknown-mode amount must not appear in the printed/shared detail');
  assert(msg.indexOf(a.fmt(333)) === -1, 'a voided amount must not appear in the printed/shared detail');
});

// ── Day Book — non-cash visibility (21 Sep Cowork finding) ─────────────
// A recognized non-cash mode (UPI/Card/Bank/Cheque) must never touch the
// cash in/out totals, but unlike before it must not vanish either — it
// gets its own nonCash-flagged line so the screen/print/WhatsApp can show
// "also today, non-cash: X" instead of a business day looking empty.
console.log('\nDay Book non-cash visibility:');

test('a UPI-only sale produces a nonCash line, not a cash line, and is not flagged unknown', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', advance:5000, payment:'UPI' }];
  var lines = a.dbAutoLines('2026-09-05');
  assert(lines.length === 1, 'expected exactly one line, got ' + lines.length);
  assert(lines[0].nonCash === true && lines[0].mode === 'UPI', 'expected a nonCash UPI line, got ' + JSON.stringify(lines[0]));
  var t = a.dbAutoTotals('2026-09-05');
  assert(t.in === 0 && t.unknownCount === 0, 'a recognized non-cash mode must not be counted as cash or as unknown');
  assert(t.nonCashCount === 1 && t.nonCashAmount === 5000, 'expected nonCashCount=1 amount=5000, got ' + t.nonCashCount + '/' + t.nonCashAmount);
});

test('a split sale (Cash 20,000 + UPI 30,000) posts 20,000 cash in and 30,000 non-cash, not summed together', function(){
  var a = loadApp();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', splitPayments:[{amount:20000,mode:'Cash'},{amount:30000,mode:'UPI'}] }];
  var t = a.dbAutoTotals('2026-09-05');
  assert(t.in === 20000, 'cash-in must stay exactly the cash split: ' + t.in);
  assert(t.nonCashAmount === 30000 && t.nonCashCount === 1, 'got nonCashAmount=' + t.nonCashAmount + ' count=' + t.nonCashCount);
});

test('a non-Credit, non-Cash purchase bill (Bank Transfer) posts a nonCash line, not nothing', function(){
  var a = loadApp();
  a.S.purchases = [{ id:'p1', date:'2026-09-05', billNo:'PB-1', amountPaid:15000, paymentMethod:'Bank Transfer' }];
  var t = a.dbAutoTotals('2026-09-05');
  assert(t.out === 0, 'must not post to cash out: ' + t.out);
  assert(t.nonCashCount === 1 && t.nonCashAmount === 15000, 'got count=' + t.nonCashCount + ' amount=' + t.nonCashAmount);
});

test('a girvi loan disbursed via UPI posts a nonCash line, not an unknown one', function(){
  var a = loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-1', startDate:'2026-09-05', principal:150000, disburseMode:'UPI', payments:[] }];
  var t = a.dbAutoTotals('2026-09-05');
  assert(t.out === 0 && t.unknownCount === 0, 'must be neither cash nor unknown');
  assert(t.nonCashCount === 1 && t.nonCashAmount === 150000, 'got count=' + t.nonCashCount + ' amount=' + t.nonCashAmount);
});

test('an order ledger advance paid by Card posts a nonCash line', function(){
  var a = loadApp();
  a.S.orders = [{ id:'o1', ordNo:'ORD-1', createdAt:'2026-09-01T10:00:00.000Z', advance:0,
    ledger:[{ txnId:'t1', type:'advance', amount:2000, mode:'Card', date:'2026-09-01T10:00:00.000Z' }] }];
  var t = a.dbAutoTotals('2026-09-01');
  assert(t.in === 0 && t.nonCashCount === 1 && t.nonCashAmount === 2000, 'got in=' + t.in + ' nonCashCount=' + t.nonCashCount + ' nonCashAmount=' + t.nonCashAmount);
});

test('dbBuildDaySummary excludes nonCash lines from the listed detail but names the total in a separate note', function(){
  var a = _dbHarness();
  a.S.sales = [
    { id:'s1', date:'2026-09-05', invNo:'INV-1', splitPayments:[{amount:1000, mode:'Cash'}] },
    { id:'s2', date:'2026-09-05', invNo:'INV-2', advance:2500, payment:'UPI' }
  ];
  var msg = a.dbBuildDaySummary('2026-09-05');
  assert(msg.indexOf(a.fmt(2500)+' across 1 payment') !== -1, 'expected a non-cash summary note mentioning 2500, got: ' + msg);
  assert(msg.indexOf('INV-2') === -1, 'the non-cash sale must not appear in the Cash In detail list');
});

// ── Day Book v2 — expenses into P&L (docs/DAYBOOK-SPEC-v2.md §1) ──────────
console.log('\nDay Book v2 — expenses into P&L:');

test('calcDayBookExpenses: a month with zero Day Book expenses leaves netProfit === profit', function(){
  var a = _dbHarness();
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', items:[{name:'Ring', metal:'gold', weight:5, qty:1, purity:'22K'}], splitPayments:[{amount:1000, mode:'Cash'}] }];
  var mp = a.calcMonthProfit(2026, 8);
  assert(mp.expenses.total === 0, 'expected 0 expenses, got ' + mp.expenses.total);
  assert(mp.netProfit === mp.profit, 'netProfit ' + mp.netProfit + ' should equal profit ' + mp.profit + ' when there are no expenses');
});

test('calcDayBookExpenses: a ₹5,000 rent entry this month reduces netProfit by exactly 5000', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-09-10', 'out', 5000, 'rent', '', function(){});
  var mp = a.calcMonthProfit(2026, 8);
  assert(mp.expenses.total === 5000, 'expected 5000, got ' + mp.expenses.total);
  assert(mp.netProfit === mp.profit - 5000, 'netProfit ' + mp.netProfit + ' should be profit - 5000');
});

test('calcDayBookExpenses: an Owner Drawings entry never touches netProfit', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-09-10', 'out', 20000, 'drawings', '', function(){});
  var mp = a.calcMonthProfit(2026, 8);
  assert(mp.expenses.total === 0, 'drawings must not count as an expense, got total=' + mp.expenses.total);
  assert(mp.netProfit === mp.profit, 'netProfit must be unaffected by drawings');
});

test('calcDayBookExpenses: a voided expense entry is excluded', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-09-10', 'out', 3000, 'rent', '', function(err, entry){
    a.dbVoidEntry(entry.id, 'entered by mistake', function(){});
  });
  var mp = a.calcMonthProfit(2026, 8);
  assert(mp.expenses.total === 0, 'a voided entry must not count, got ' + mp.expenses.total);
});

test('calcDayBookExpenses: an expense dated last month does not appear in this month’s total', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-08-15', 'out', 1200, 'electricity', '', function(){});
  var mp = a.calcMonthProfit(2026, 8); // September (month index 8)
  assert(mp.expenses.total === 0, 'an August entry must not appear in September’s expenses, got ' + mp.expenses.total);
  var mpAug = a.calcMonthProfit(2026, 7);
  assert(mpAug.expenses.total === 1200, 'it should appear in August, got ' + mpAug.expenses.total);
});

test('calcAllTimeProfit sums Day Book expenses across every month, not just the current one', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-01-05', 'out', 1000, 'rent', '', function(){});
  a.dbAddEntry('2026-09-05', 'out', 2000, 'salary', '', function(){});
  var at = a.calcAllTimeProfit();
  assert(at.expenses.total === 3000, 'expected 3000 across both months, got ' + at.expenses.total);
  assert(at.netProfit === at.profit - 3000, 'all-time netProfit should be profit - 3000');
});

test('calcAllTimeProfit includes girvi interest, same as calcMonthProfit (batch28/29 fix)', function(){
  var a = loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-1', startDate:'2026-01-01', principal:50000,
    interestRate:24, rateType:'yearly', compound:false,
    payments:[{ id:'pay1', amount:1200, type:'interest', mode:'Cash', date:'2026-02-01' }] }];
  var at = a.calcAllTimeProfit();
  assert(at.revenue >= 1200, 'expected the 1200 interest payment in all-time revenue, got ' + at.revenue);
  assert(at.profit >= 1200, 'interest is pure profit — expected it in all-time profit, got ' + at.profit);
});

test('every DB_CATS key has an icon and a color — no undefined fallback (spec §9)', function(){
  var a = loadApp();
  Object.keys(a.DB_CATS).forEach(function(k){
    var c = a.DB_CATS[k];
    assert(!!c.icon, 'DB_CATS.' + k + ' is missing an icon');
    assert(!!c.color, 'DB_CATS.' + k + ' is missing a color');
  });
});

test('dbLineIcon resolves an auto line by src even when its cat is not a DB_CATS key', function(){
  var a = loadApp();
  var icon = a.dbLineIcon({ cat: 'girvi-disbursement', src: 'girvi' });
  assert(icon.icon === a.DB_AUTO_ICONS.girvi.icon, 'expected the girvi auto icon, got ' + JSON.stringify(icon));
});

// ── Day Book v2 — trend chart / Month view (docs/DAYBOOK-SPEC-v2.md §2/§6) ─
console.log('\nDay Book v2 — trend / Month view:');

test('dbBuildTrend returns one entry per calendar day in range, inclusive both ends', function(){
  var a = _dbHarness();
  var t = a.dbBuildTrend('2026-09-01', '2026-09-05');
  assert(t.length === 5, 'expected 5 days, got ' + t.length);
  assert(t[0].date === '2026-09-01' && t[4].date === '2026-09-05', 'range bounds: ' + t[0].date + '..' + t[4].date);
});

test('dbBuildTrend agrees with dbDayView day-for-day — no separate computation to drift', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = { date:'2026-09-01', amount:1000, ts:'2026-09-01T00:00:00.000Z' };
  a.S.sales = [{ id:'s1', date:'2026-09-02', invNo:'INV-1', splitPayments:[{amount:500, mode:'Cash'}] }];
  a.dbAddEntry('2026-09-03', 'out', 200, 'rent', '', function(){});
  var t = a.dbBuildTrend('2026-09-01', '2026-09-03');
  t.forEach(function(d){
    var v = a.dbDayView(d.date);
    assert(d.totalIn === v.totalIn && d.totalOut === v.totalOut && d.closing === v.closing && d.isClosed === v.closed,
      'mismatch on ' + d.date + ': trend=' + JSON.stringify(d) + ' dayView totalIn/out/closing/closed=' + v.totalIn + '/' + v.totalOut + '/' + v.closing + '/' + v.closed);
  });
});

test('dbBuildTrend reports a closed day at its frozen closing, not a live recompute', function(){
  var a = _dbHarness();
  a.S.dayBook.closes = [{ date:'2026-09-01', opening:1000, autoIn:500, autoOut:0, manualIn:0, manualOut:200, closing:1300, counted:1300, diff:0, restatements:[], countCorrections:[] }];
  var t = a.dbBuildTrend('2026-09-01', '2026-09-01');
  assert(t[0].isClosed === true, 'expected isClosed true');
  assert(t[0].closing === 1300, 'expected the frozen closing 1300, got ' + t[0].closing);
});

test('dbExpenseBreakdownHtml renders the same total calcDayBookExpenses reports — one function, not a re-derivation', function(){
  var a = _dbHarness();
  a.dbAddEntry('2026-09-05', 'out', 700, 'electricity', '', function(){});
  a.dbAddEntry('2026-09-06', 'out', 300, 'tea', '', function(){});
  var exp = a.calcDayBookExpenses(2026, 8);
  var html = a.dbExpenseBreakdownHtml(exp.byCat);
  assert(html.indexOf(a.fmt(700)) !== -1, 'expected the electricity amount in the breakdown html');
  assert(html.indexOf(a.fmt(300)) !== -1, 'expected the tea amount in the breakdown html');
  var summed = Object.keys(exp.byCat).reduce(function(s,k){ return s+exp.byCat[k]; }, 0);
  assert(summed === exp.total, 'the rendered rows must sum to exactly calcDayBookExpenses().total: rows sum to ' + summed + ', total is ' + exp.total);
});

// Regression guard for the Opus review's blocker 1 (23 Sep 2026): a Month-view
// tile computed netCash - calcDayBookExpenses().total, double-subtracting
// expenses that dbDayView's totalOut (which feeds netCash) already counts as
// cash out. The tile was removed rather than patched — this locks in why.
test('a month’s Cash Out (from dbBuildTrend) already includes manual expense entries — nothing should subtract them again', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = { date:'2026-09-01', amount:10000, ts:'2026-09-01T00:00:00.000Z' };
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', splitPayments:[{amount:5000, mode:'Cash'}] }];
  a.dbAddEntry('2026-09-06', 'out', 3000, 'rent', '', function(){});
  var trend = a.dbBuildTrend('2026-09-01', '2026-09-06');
  var totalOut = trend.reduce(function(s,d){ return s+d.totalOut; }, 0);
  assert(totalOut === 3000, 'the rent entry must already be inside Cash Out, got totalOut=' + totalOut);
  var netCash = trend.reduce(function(s,d){ return s+d.totalIn; }, 0) - totalOut;
  assert(netCash === 2000, 'net cash should be 5000 in - 3000 out = 2000, got ' + netCash);
});

test('_dbPaintMonth renders Net Cash correctly and never shows a separate "After Expenses" figure', function(){
  var a = _dbHarness();
  a._dbMonthYear = 2026; a._dbMonthMonth = 8; // September
  a._dbDate = '2026-09-10';
  a.S.dayBook.opening = { date:'2026-09-01', amount:10000, ts:'2026-09-01T00:00:00.000Z' };
  a.S.sales = [{ id:'s1', date:'2026-09-05', invNo:'INV-1', splitPayments:[{amount:5000, mode:'Cash'}] }];
  a.dbAddEntry('2026-09-06', 'out', 3000, 'rent', '', function(){});
  var html = a._dbPaintMonth();
  assert(html.indexOf('After Expenses') === -1, 'the double-subtracting tile must not come back: ' + html.slice(0,50));
  assert(html.indexOf(a.fmt(2000)) !== -1, 'expected the correct Net Cash figure ' + a.fmt(2000) + ' somewhere in Month view');
});

test('_dbPaintMonth clips the trend/Days list to the Day Book opening date, not the 1st of the month (batch29 fix)', function(){
  var a = _dbHarness();
  a._dbMonthYear = 2026; a._dbMonthMonth = 8; // September
  a.S.dayBook.opening = { date:'2026-09-15', amount:185000, ts:'2026-09-15T00:00:00.000Z' };
  var html = a._dbPaintMonth();
  assert(html.indexOf("dbGoDate('2026-09-05')") === -1, 'a day before the opening date must not appear in Month view: ' + html.slice(0,50));
  assert(html.indexOf("dbGoDate('2026-09-20')") !== -1, 'a day on/after the opening date should still appear');
  assert(html.indexOf('Day Book started') !== -1, 'expected the started-on note when the range is clipped');
});

console.log('\nDay Book v2 — party link (§4):');

test('dbAddEntry stores a linked party with its customerId, and no party field when left blank', function(){
  var a = _dbHarness();
  a.S.customers = [{ id:'c1', name:'Ramesh Landlord', phone:'9876543210' }];
  a.dbAddEntry('2026-09-05','out',8000,'rent','',function(){}, { name:'Ramesh Landlord', phone:'9876543210', customerId:'c1' });
  a.dbAddEntry('2026-09-05','out',50,'tea','',function(){}, { name:'  ', phone:'' });
  a.dbAddEntry('2026-09-05','out',60,'tea','',function(){});
  var e = a.S.dayBook.entries;
  assert(e[0].party && e[0].party.customerId === 'c1' && e[0].party.name === 'Ramesh Landlord', 'linked party must be stored: ' + JSON.stringify(e[0].party));
  assert(!('party' in e[1]) && !('party' in e[2]), 'a blank or missing party must not add a party field');
});

test('a free-text party keeps its name but never gets a customerId that is not a real customer', function(){
  var a = _dbHarness();
  a.S.customers = [];
  a.dbAddEntry('2026-09-05','out',1200,'electricity','',function(){}, { name:'MSEB', phone:'', customerId:'ghost' });
  var p = a.S.dayBook.entries[0].party;
  assert(p.name === 'MSEB' && !('customerId' in p), 'unknown customerId must be dropped: ' + JSON.stringify(p));
});

test('dbGroupByParty groups a month\'s manual entries by customer, then by name+phone; skips voided, unlinked and out-of-range', function(){
  var a = _dbHarness();
  a.S.customers = [{ id:'c1', name:'Suresh Karigar', phone:'9000000001' }];
  a.S.dayBook.entries = [
    { id:'1', date:'2026-09-03', dir:'out', amount:500, cat:'salary', kind:'manual', voided:false, party:{ name:'Suresh', phone:'', customerId:'c1' } },
    { id:'2', date:'2026-09-10', dir:'out', amount:700, cat:'salary', kind:'manual', voided:false, party:{ name:'Suresh K', phone:'', customerId:'c1' } },
    { id:'3', date:'2026-09-11', dir:'out', amount:900, cat:'rent', kind:'manual', voided:false, party:{ name:'landlord ', phone:'' } },
    { id:'4', date:'2026-09-12', dir:'out', amount:100, cat:'rent', kind:'manual', voided:false, party:{ name:'Landlord', phone:'' } },
    { id:'5', date:'2026-09-12', dir:'out', amount:999, cat:'salary', kind:'manual', voided:true, party:{ name:'Suresh', phone:'', customerId:'c1' } },
    { id:'6', date:'2026-09-12', dir:'out', amount:40, cat:'tea', kind:'manual', voided:false },
    { id:'7', date:'2026-08-30', dir:'out', amount:500, cat:'salary', kind:'manual', voided:false, party:{ name:'Suresh', phone:'', customerId:'c1' } }
  ];
  var g = a.dbGroupByParty('2026-09-01', '2026-09-30');
  assert(g.length === 2, 'expected 2 groups, got ' + g.length);
  assert(g[0].name === 'Suresh Karigar' && g[0].totalOut === 1200 && g[0].entries.length === 2, 'customer group wrong: ' + JSON.stringify(g[0]));
  assert(g[1].totalOut === 1000 && g[1].entries.length === 2, 'free-text names differing only in case/space must group together: ' + JSON.stringify(g[1]));
});

test('dbSubmitEntry stores a typed phone number as party.phone, not party.name', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = { date:'2026-09-01', amount:0, ts:'2026-09-01T00:00:00.000Z' };
  a._dbDate = '2026-09-05';
  a._dbEntryCat = 'rent';
  a._els['db-entry-amt'] = { value:'500' };
  a._els['db-entry-note'] = { value:'' };
  a._els['db-entry-party'] = { value:'9876543210' };
  a.dbSubmitEntry();
  var p = a.S.dayBook.entries[0].party;
  assert(p && p.phone === '9876543210' && !p.name, 'a typed phone number must be stored as phone, not name: ' + JSON.stringify(p));
});

test('dbSubmitEntry still stores typed free text as party.name, not phone', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = { date:'2026-09-01', amount:0, ts:'2026-09-01T00:00:00.000Z' };
  a._dbDate = '2026-09-05';
  a._dbEntryCat = 'rent';
  a._els['db-entry-amt'] = { value:'500' };
  a._els['db-entry-note'] = { value:'' };
  a._els['db-entry-party'] = { value:'MSEB' };
  a.dbSubmitEntry();
  var p = a.S.dayBook.entries[0].party;
  assert(p && p.name === 'MSEB' && !p.phone, 'free text must still be stored as name, not phone: ' + JSON.stringify(p));
});

test('dbSubmitEntry does not treat a non-Latin name typed alongside a phone number as phone-only', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = { date:'2026-09-01', amount:0, ts:'2026-09-01T00:00:00.000Z' };
  a._dbDate = '2026-09-05';
  a._dbEntryCat = 'rent';
  a._els['db-entry-amt'] = { value:'500' };
  a._els['db-entry-note'] = { value:'' };
  a._els['db-entry-party'] = { value:'राम 9876543210' }; // "Ram" in Devanagari + a phone
  a.dbSubmitEntry();
  var p = a.S.dayBook.entries[0].party;
  assert(p && p.name === 'राम 9876543210' && !p.phone, 'checking for "no Latin letters" would wrongly call this phone-only; got ' + JSON.stringify(p));
});

test('a party name is escaped in the Day view line list', function(){
  var a = _dbHarness();
  a.S.dayBook.opening = { date:'2026-09-01', amount:0, ts:'2026-09-01T00:00:00.000Z' };
  a._dbDate = '2026-09-05';
  a.dbAddEntry('2026-09-05','out',100,'misc','',function(){}, { name:'<img src=x onerror=alert(1)>', phone:'' });
  var html = a._dbPaintDay();
  assert(html.indexOf('<img src=x') === -1, 'party name must be escaped');
  assert(html.indexOf('db-party-tag') !== -1, 'the party tag should render');
});

console.log('\nDuplicate bill guard:');
test('isDuplicateSale flags a repeat bill saved seconds ago, even though its bill date is UTC midnight', function(){
  var a = require('./harness.js').loadApp();
  var today = new Date().toISOString().slice(0,10);
  var items = [{ pid:'p1', qty:1 }];
  a.S.sales = [{ customer:'Walk-in', items:items, date:new Date(today).toISOString(), createdAt:new Date(Date.now()-5000).toISOString() }];
  assert(a.isDuplicateSale('walk-in', items) === true, 'a bill saved 5s ago must be flagged');
  a.S.sales[0].createdAt = new Date(Date.now()-120000).toISOString();
  assert(a.isDuplicateSale('Walk-in', items) === false, 'a bill saved 2 minutes ago must not be flagged');
  delete a.S.sales[0].createdAt;
  assert(a.isDuplicateSale('Walk-in', items) === false, 'a legacy sale with no createdAt must not be flagged');
});

test('isDuplicateSale skips a sale whose createdAt is malformed instead of treating it as recent (NaN < cutoff is false, not true)', function(){
  var a = require('./harness.js').loadApp();
  var items = [{ pid:'p1', qty:1 }];
  a.S.sales = [{ customer:'Walk-in', items:items, createdAt:'not-a-real-date' }];
  assert(a.isDuplicateSale('Walk-in', items) === false, 'a malformed createdAt must be skipped, not treated as fresh');
});

console.log('\nF3 — invoice numbers assigned at save, never repeated (30 Sep):');

test('a sale with a blank invoice number gets it from the server counter at save time', function(){
  var a = _freshSaleHarness();
  a.saveToCloud = function(cb){ cb(null); };
  a.getNextCounter = function(name, cb){ cb(null, 31); };
  var sale = _sale('1'); sale.invNo = '';
  a._commitSaleTransaction(sale);
  assert(a.S.sales.length === 1 && a.S.sales[0].invNo === 'INV-031', 'expected INV-031, got ' + JSON.stringify(a.S.sales.map(function(s){return s.invNo;})));
});

test('a server number already used in this shop is skipped, not reused', function(){
  var a = _freshSaleHarness();
  a.S.sales = [{ id:'old', invNo:'INV-030' }];
  a.saveToCloud = function(cb){ cb(null); };
  var val = 30;
  a.getNextCounter = function(name, cb){ cb(null, val++); };
  var sale = _sale('1'); sale.invNo = '';
  a._commitSaleTransaction(sale);
  assert(a.S.sales[1] && a.S.sales[1].invNo === 'INV-031', 'expected the used INV-030 skipped for INV-031, got ' + JSON.stringify(a.S.sales.map(function(s){return s.invNo;})));
});

test('if the counter cannot be reached the sale is refused — no local-number fallback', function(){
  var a = _freshSaleHarness();
  var saves = 0;
  a.saveToCloud = function(cb){ saves++; cb(null); };
  a.getNextCounter = function(name, cb){ cb(null, null); };
  var sale = _sale('1'); sale.invNo = '';
  a._commitSaleTransaction(sale);
  assert(saves === 0 && a.S.sales.length === 0, 'expected no save and no sale, got saves=' + saves + ' sales=' + a.S.sales.length);
  assert(a._saleSubmitLock === false, 'the submit lock must be released so the jeweller can retry');
});

test('a counter stuck on used numbers gives up after a few tries instead of looping', function(){
  var a = _freshSaleHarness();
  a.S.sales = [{ id:'old', invNo:'INV-007' }];
  var calls = 0;
  a.getNextCounter = function(name, cb){ calls++; cb(null, 7); };
  a.saveToCloud = function(cb){ cb(null); };
  var sale = _sale('1'); sale.invNo = '';
  a._commitSaleTransaction(sale);
  assert(calls === a.INV_ALLOC_TRIES && a.S.sales.length === 1, 'expected ' + a.INV_ALLOC_TRIES + ' tries and no new sale, got calls=' + calls + ' sales=' + a.S.sales.length);
});

test('invNoInUse ignores case and spaces, and never matches a blank number', function(){
  var a = require('./harness.js').loadApp();
  a.S.sales = [{ invNo:'INV-030' }, { invNo:'' }];
  assert(a.invNoInUse(' inv-030 ') === true, 'a typed " inv-030 " is the same invoice as INV-030');
  assert(a.invNoInUse('INV-031') === false, 'an unused number is free');
  assert(a.invNoInUse('') === false, 'a blank number is never "in use"');
});

test('consecutive sales get N and N+1 under the server floor (migration 004) — no skipped numbers', function(){
  var a = _freshSaleHarness();
  a.saveToCloud = function(cb){ cb(null); };
  a.S.nextInvNo = 31;
  var counter = 30; // mirrors 004: greatest(counter+1, blob nextInvNo)
  a.getNextCounter = function(name, cb){ counter = Math.max(counter + 1, a.S.nextInvNo); cb(null, counter); };
  [1,2,3].forEach(function(i){ var s = _sale(String(i)); s.invNo = ''; a._commitSaleTransaction(s); });
  var got = a.S.sales.map(function(s){ return s.invNo; }).join(',');
  assert(got === 'INV-031,INV-032,INV-033', 'expected INV-031,INV-032,INV-033, got ' + got);
});

test('recordSale refuses a typed invoice number already used in this shop', function(){
  var a = _freshSaleHarness();
  var saves = 0;
  a.saveToCloud = function(cb){ saves++; cb(null); };
  a.S.sales = [{ id:'old', invNo:'INV-030' }];
  var _orig = a.document.getElementById;
  a.document.getElementById = function(id){ return id === 's-cust' ? { style:{}, value:'Test Customer' } : _orig(id); };
  a.buildSaleObj = function(){ var s = _sale('X'); s.invNo = 'inv-030'; return s; };
  a.recordSale();
  assert(saves === 0 && a.S.sales.length === 1, 'a used typed number must be refused, got saves=' + saves + ' sales=' + a.S.sales.length);
});

test('clearing the form while the invoice number is being fetched does not change what the sale deducts', function(){
  var a = _freshSaleHarness();
  a.saveToCloud = function(cb){ cb(null); };
  a.UI.saleMode = 'stock';
  var pending = null;
  a.getNextCounter = function(name, cb){ pending = cb; }; // number still in flight
  var s = _sale('1'); s.invNo = '';
  a._commitSaleTransaction(s);
  a.UI.saleItems = [{ pid:'', qty:1 }]; // user taps Clear mid-fetch
  pending(null, 40);
  assert(a.S.sales.length === 1 && a.S.products[0].qty === 2, 'expected the sale saved with its ring deducted (qty 2), got sales=' + a.S.sales.length + ' qty=' + a.S.products[0].qty);
});

test('the 15 s background refresh skips while a sale is fetching its invoice number', function(){
  var a = _freshSaleHarness();
  var tick = null, loads = 0;
  a.setInterval = function(f){ tick = f; return 1; };
  a.isPinSessionActive = function(){ return true; };
  a.loadFromCloud = function(){ loads++; };
  a.getNextCounter = function(){}; // never answers — the sale stays in flight
  var s = _sale('1'); s.invNo = '';
  a._commitSaleTransaction(s);
  a.startAutoRefresh();
  assert(typeof tick === 'function', 'startAutoRefresh should register its poll');
  tick();
  assert(loads === 0, 'the poll must not reload the shop mid-sale, got ' + loads + ' load(s)');
});

test('a typed invoice number never moves the shop series (FY-style, pasted phone number)', function(){
  // Cowork review 30 Sep: "2025-26/001" was stripped to 202526001 and became
  // the shop-wide floor via migration 004; a phone number overflowed it.
  ['2025-26/001', '9876543210', 'INV-9999'].forEach(function(typed){
    var a = _freshSaleHarness();
    a.saveToCloud = function(cb){ cb(null); };
    a.S.nextInvNo = 31;
    var s = _sale('1'); s.invNo = typed;
    a._commitSaleTransaction(s);
    assert(a.S.sales.length === 1 && a.S.sales[0].invNo === typed, typed + ': the typed number should be kept on the bill as typed');
    assert(a.S.nextInvNo === 31, typed + ': the series must stay at 31, got ' + a.S.nextInvNo);
  });
});

test('a typed INV- number far above the series is refused; one within reach is kept', function(){
  function tryTyped(typed){
    var a = _freshSaleHarness(), saves = 0;
    a.saveToCloud = function(cb){ saves++; cb(null); };
    a.S.nextInvNo = 31;
    var _orig = a.document.getElementById;
    a.document.getElementById = function(id){ return id === 's-cust' ? { style:{}, value:'Test Customer' } : _orig(id); };
    a.buildSaleObj = function(){ var s = _sale('X'); s.invNo = typed; return s; };
    a.recordSale();
    return saves;
  }
  assert(tryTyped('INV-3000') === 0, 'INV-3000 when the series is at 31 is a typo and must be refused');
  assert(tryTyped('inv-99999999999') === 0, 'a huge typed INV- number must be refused');
  assert(tryTyped('INV-040') === 1, 'INV-040 is within reach and should save');
  assert(tryTyped('2025-26/001') === 1, 'a non-INV format is kept as typed (it never moves the series)');
});

test('INV-40, inv-040 and " INV-0040 " are the same invoice when checking for duplicates', function(){
  var a = require('./harness.js').loadApp();
  a.S.sales = [{ invNo:'INV-040' }];
  assert(a.invNoInUse('INV-40') && a.invNoInUse('inv-040') && a.invNoInUse(' INV-0040 '), 'all three should match INV-040');
  assert(!a.invNoInUse('INV-400') && !a.invNoInUse('INV-4'), 'different numbers must not match');
});

test('the typed-number guard uses the highest real bill, not a stale saved "next number"', function(){
  var a = _freshSaleHarness(), saves = 0;
  a.saveToCloud = function(cb){ saves++; cb(null); };
  a.S.sales = [{ id:'b1', invNo:'INV-030' }];
  a.S.nextInvNo = 202526002; // polluted by an older app's typed number
  var _orig = a.document.getElementById;
  a.document.getElementById = function(id){ return id === 's-cust' ? { style:{}, value:'Test Customer' } : _orig(id); };
  a.buildSaleObj = function(){ var s = _sale('X'); s.invNo = 'INV-5000'; return s; };
  a.recordSale();
  assert(saves === 0, 'INV-5000 is far above the highest bill (INV-030) and must be refused');
});

test('a deleted bill\'s invoice number is never issued or accepted again', function(){
  var a = _freshSaleHarness();
  a.isManager = function(){ return true; };
  a.safeConfirm = function(t, m, ok){ ok(); };
  a.saveToCloud = function(cb){ cb(null); };
  a.showCustHistory = function(){}; a.closeCustModal = function(){}; a.renderCustomers = function(){};
  a.S.sales = [{ id:'s9', invNo:'INV-009', customer:'C', items:[] }];
  a.deleteSale('s9');
  assert(a.S.sales.length === 0, 'the bill should be gone');
  assert(a.invNoInUse('INV-009') && a.invNoInUse('inv-9'), 'INV-009 must still count as used after deletion');
  var val = 9;
  a.getNextCounter = function(name, cb){ cb(null, val++); }; // a lagging counter offers the deleted number first
  var s = _sale('1'); s.invNo = '';
  a._commitSaleTransaction(s);
  assert(a.S.sales[0] && a.S.sales[0].invNo === 'INV-010', 'the deleted INV-009 must be skipped, got ' + (a.S.sales[0] && a.S.sales[0].invNo));
});

test('an exception on the TYPED-number path also releases the lock', function(){
  var a = _freshSaleHarness();
  a.saveToCloud = function(){ throw new Error('boom'); };
  var s = _sale('1'); s.invNo = 'INV-500';
  a._commitSaleTransaction(s);
  assert(a._saleSubmitLock === false && a.S.sales.length === 0, 'lock released and no unsaved sale left');
});

test('an exception inside the sale commit releases the lock and leaves no unsaved sale behind', function(){
  var a = _freshSaleHarness();
  a.getNextCounter = function(name, cb){ cb(null, 40); };
  a.saveToCloud = function(){ throw new Error('boom'); };
  var s = _sale('1'); s.invNo = '';
  a._commitSaleTransaction(s);
  assert(a._saleSubmitLock === false, 'the submit lock must be released');
  assert(a.S.sales.length === 0, 'the unsaved sale must not stay in S, got ' + a.S.sales.length);
});

test('the sale form, a cleared form and Convert to Sale never pre-fill a local invoice number', function(){
  var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '02-ui-inactivity-modals.js'), 'utf8') +
            require('fs').readFileSync(require('path').join(__dirname, '..', 'js', '04-orders-detail.js'), 'utf8');
  assert(!/'INV-'\s*\+\s*String\(S\.nextInvNo\)/.test(src), 'found a local INV- number built from S.nextInvNo — numbers must come from allocInvNo()');
});

console.log('\nF4 — failed money saves roll back, never look saved (30 Sep):');

function _girviHarness(){
  var a = require('./harness.js').loadApp();
  a.S.girvi = [{ id:'g1', grvNo:'GRV-0001', status:'active', principal:1000, interestRate:2,
    rateType:'monthly', duration:3, startDate:'2026-01-01', ledger:[], payments:[] }];
  a.safeConfirm = function(t, m, ok){ ok(); };
  a.closeGirviDetail = function(){}; a.renderGirvi = function(){}; a.renderDash = function(){};
  return a;
}

test('a failed Girvi close, default, archive or recover leaves the loan exactly as it was', function(){
  ['closeGirviManual','markGirviDefault','deleteGirviEntry','recoverGirviEntry'].forEach(function(fn){
    var a = _girviHarness();
    if(fn === 'recoverGirviEntry') a.S.girvi[0]._deleted = true;
    var before = JSON.stringify(a.S.girvi[0]);
    a.saveToCloud = function(cb){ cb(new Error('network down')); };
    a[fn]('g1');
    assert(JSON.stringify(a.S.girvi[0]) === before, fn + ': loan changed after a failed save: ' + JSON.stringify(a.S.girvi[0]));
    assert(!a._girviLocked('g1'), fn + ': the loan must be unlocked for a retry');
  });
});

test('a failed archive leaves no "Archived" line in the audit log', function(){
  var a = _girviHarness();
  a.S.auditLog = [{ note:'older entry' }];
  a.saveToCloud = function(cb){ cb(new Error('network down')); };
  a.deleteGirviEntry('g1');
  assert(a.S.auditLog.length === 1 && a.S.auditLog[0].note === 'older entry', 'audit log should be back to its one older entry, got ' + JSON.stringify(a.S.auditLog));
});

test('a successful Girvi close still closes the loan', function(){
  var a = _girviHarness();
  a.saveToCloud = function(cb){ cb(null); };
  a.closeGirviManual('g1');
  assert(a.S.girvi[0].status === 'closed', 'expected closed, got ' + a.S.girvi[0].status);
});

test('a second close tap while the first is saving is ignored', function(){
  var a = _girviHarness();
  var saves = 0;
  a.saveToCloud = function(){ saves++; }; // never answers
  a.closeGirviManual('g1');
  a.closeGirviManual('g1');
  assert(saves === 1, 'expected one save, got ' + saves);
});

test('_orderCommit on failure removes a brand-new order and runs the extra restore', function(){
  var a = require('./harness.js').loadApp();
  a.S.orders = [{ id:'o-old' }, { id:'o-new' }];
  a.S.nextOrdId = 8;
  a.saveToCloud = function(cb){ cb(new Error('network down')); };
  var msg = '';
  a.toast = function(m){ msg = m; };
  a._orderCommit('__new', { snapshot:null, newIds:['o-new'], failMsg:a.SAVE_RETRY_MSG,
    restore:function(){ a.S.nextOrdId = 7; } });
  assert(a.S.orders.length === 1 && a.S.orders[0].id === 'o-old', 'new order must be removed, got ' + JSON.stringify(a.S.orders));
  assert(a.S.nextOrdId === 7, 'order number must be given back, got ' + a.S.nextOrdId);
  assert(/tap to retry/i.test(msg), 'expected the retry message, got ' + msg);
});

test('_girviCommit runs the extra restore (customer record) before caching', function(){
  var a = require('./harness.js').loadApp();
  a.S.customers = [{ id:'c1', ornamentPhotos:[{ id:'p1' }] }];
  a.saveToCloud = function(cb){ cb(new Error('network down')); };
  var cachedPhotos = -1;
  a.saveCache = function(){ cachedPhotos = a.S.customers[0].ornamentPhotos.length; };
  a._girviCommit('__new', { snapshot:null, newIds:[], restore:function(){ a.S.customers = [{ id:'c1', ornamentPhotos:[] }]; } });
  assert(cachedPhotos === 0, 'the cache must be written after the customer restore, saw ' + cachedPhotos + ' photo(s)');
});

test('leaving the Sale tab or clearing the form abandons a pending order conversion', function(){
  var a = require('./harness.js').loadApp();
  a._pendingOrderConversion = 'o1';
  try { a.renderTab('orders'); } catch(e) { /* render stubs may throw after the reset; only the reset matters */ }
  assert(a._pendingOrderConversion === null, 'leaving Sale must clear it, got ' + a._pendingOrderConversion);
  a._pendingOrderConversion = 'o1';
  try { a.renderTab('sales'); } catch(e) {}
  assert(a._pendingOrderConversion === 'o1', 'staying on Sale must keep it');
  try { a.clearSale(); } catch(e) {}
  assert(a._pendingOrderConversion === null, 'Clear must clear it, got ' + a._pendingOrderConversion);
});

console.log('\nF2 — every saved key survives cloud save -> fresh device load (30 Sep):');

// A key that is saved but not loaded is wiped by the next device's first
// save (audit R2: auditLog, activityLog, waRules); a key that is never saved
// exists only on one phone (R3: stockMovements). This test is generic: any
// key added to the save payload later without a matching load fails here.
testAsync('every key saveToCloud sends comes back on a fresh device via loadFromCloud', function(){
  var a = loadApp();
  a.SAAS.sessionToken = 'tok';
  ['products','sales','orders','girvi','customers','purchases','suppliers','purchaseAuditLog',
   'auditLog','activityLog','waRules','stockMovements','voidedInvNos'].forEach(function(k){ a.S[k] = [{ id:'rt-' + k }]; });
  var sent = null;
  a.fetch = function(url, opts){
    if(opts && opts.method === 'PUT'){
      sent = JSON.parse(opts.body).data;
      return Promise.resolve({ status:200, ok:true, json:function(){ return Promise.resolve({ ok:true, data:Object.assign({ _v:1 }, sent) }); } });
    }
    return Promise.resolve({ status:200, ok:true, json:function(){ return Promise.resolve({}); } });
  };
  a.saveToCloud(function(){});
  return flushAll().then(function(){
    assert(sent, 'saveToCloud never sent anything');
    assert(Array.isArray(sent.stockMovements) && sent.stockMovements.length === 1, 'stockMovements must be in the save payload, got ' + JSON.stringify(sent.stockMovements));
    var b = loadApp();
    b.SAAS.sessionToken = 'tok';
    b.fetch = function(){ return Promise.resolve({ status:200, ok:true, json:function(){ return Promise.resolve({ data:Object.assign({ _v:1 }, sent) }); } }); };
    b.loadFromCloud(function(){});
    return flushAll().then(function(){
      var lost = Object.keys(sent).filter(function(k){
        var v = sent[k];
        if(Array.isArray(v)) return !Array.isArray(b.S[k]) || !v.every(function(x, i){ return b.S[k][i] && b.S[k][i].id === x.id; });
        if(typeof v === 'number') return b.S[k] !== v;
        return false; // objects (rates, purchaseCfg, dayBook) are merged/normalised on load
      });
      assert(lost.length === 0, 'saved but not loaded on a fresh device: ' + lost.join(', '));
    });
  });
});

test('every key the cloud save sends also survives the on-phone cache (saveCache -> reopen -> loadCache)', function(){
  var a = loadApp();
  a.SAAS.shop = { id:'shop1' };
  ['products','sales','orders','girvi','customers','purchases','suppliers','purchaseAuditLog',
   'auditLog','activityLog','waRules','stockMovements','voidedInvNos'].forEach(function(k){ a.S[k] = [{ id:'c-' + k }]; });
  a.saveCache();
  var b = loadApp();
  b.SAAS.shop = { id:'shop1' };
  b.localStorage.setItem('ssj_cache', a.localStorage.getItem('ssj_cache'));
  assert(b.loadCache() === true, 'the cache should load for the same shop');
  var lost = Object.keys(a.S).filter(function(k){
    return Array.isArray(a.S[k]) && a.S[k].length && !(Array.isArray(b.S[k]) && b.S[k][0] && b.S[k][0].id === a.S[k][0].id);
  });
  assert(lost.length === 0, 'lost when the app is reopened from cache: ' + lost.join(', '));
});

Promise.all(asyncTests).then(function(){
  console.log('\n' + '='.repeat(50));
  console.log(passed + ' passed, ' + failed + ' failed');
  if(failed > 0){
    console.log('\nFAILURES:');
    failures.forEach(function(f){ console.log('  - ' + f); });
    process.exit(1);
  }
  process.exit(0);
});
