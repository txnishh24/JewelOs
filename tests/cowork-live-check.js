// Cowork independent live-behavior check, 26 Sep 2026.
// Goes one level past the regression suite: drives the REAL UI-facing
// functions (recordSale(), renderDayBook()) through the harness's fake DOM,
// the same way a click would, instead of calling the inner helper
// functions (isDuplicateSale, dbGroupByParty) directly in isolation.
const { loadApp } = require('./harness.js');
const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ✓ ' + msg); };

console.log('=== b5: recordSale() end-to-end duplicate-bill guard ===');
{
  const a = loadApp();
  a.S.shopId = 'cowork-live-check';
  a.S.products = [];
  a.S.sales = [];
  a.S.customers = [];
  a.UI.saleMode = 'custom';
  a.customSaleItems = [{ name: 'Test Ring', grossWt: '5', blackBeads: '0', diamond: '0', making: '500', stoneCharges: '0' }];
  // buildSaleObj() re-reads custom item fields straight from these DOM ids
  // (see js/02-ui-inactivity-modals.js buildSaleObj) rather than trusting
  // customSaleItems directly, so the fake elements must carry real values.
  a._els['csi-gw-0'] = { value: '5' };
  a._els['csi-bb-0'] = { value: '0' };
  a._els['csi-dw-0'] = { value: '0' };
  a._els['csi-mk-0'] = { value: '500' };
  a._els['csi-sc-0'] = { value: '0' };
  a._els['csi-name-0'] = { value: 'Test Ring' };
  a._els['s-cust'] = { value: 'Ramesh Test' };
  a._els['s-phone'] = { value: '' };
  a._els['s-addr'] = { value: '' };
  a._els['s-invno'] = { value: 'INV-TEST-1' };
  a._els['s-date'] = { value: new Date().toISOString().slice(0, 10) };
  a._els['s-making'] = { value: '0' };
  a._els['s-diamond'] = { value: '0' };
  a._els['s-oldgold-direct'] = { value: '' };
  a._els['s-advance'] = { value: '0' };
  a._els['s-pay'] = { value: 'Cash' };
  a._els['s-prev-advance'] = { value: '0' };
  a._els['s-prev-advance-mode'] = { value: 'Cash' };

  a.toast = function (msg) { console.log('    [toast] ' + msg); };
  let confirmShown = null, confirmYes = null;
  a.safeConfirm = function (title, body, onYes) { confirmShown = { title, body }; confirmYes = onYes; };
  // saveToCloud is network I/O in the real app; stub it to succeed so the
  // sale actually commits into S.sales the way a real save would.
  a.saveToCloud = function (cb) { if (cb) cb(null); };

  a.recordSale();
  assert(a.S.sales.length === 1, 'first recordSale() call actually saved a sale (S.sales.length=' + a.S.sales.length + ')');
  assert(!!a.S.sales[0].createdAt, 'saved sale carries a real createdAt timestamp');
  assert(confirmShown === null, 'first save of the day does NOT show the duplicate-bill dialog');

  // Second click, same customer, same item count, well within 60s — a real
  // "double-submit" scenario (accidental double-tap, or a genuine second bill).
  // recordSale() clears the form fields in place after a successful save
  // (the same fake DOM objects are reused), so re-fill them exactly as a
  // cashier re-typing the next bill would.
  a._saleSubmitLock = false; // the in-flight lock only guards concurrent clicks; this is a later, separate click
  // clearSale() (called after every successful save, just like a real
  // cashier's next blank bill) resets UI.saleMode to 'stock' — switch back
  // to custom the way a cashier tapping "Custom item" again would. (Not
  // calling setSaleMode() itself: its DOM-building path — appendChild-ing
  // real item-card elements — needs a real DOM the harness's fake
  // appendChild() no-ops on, which isn't what's under test here.)
  a.UI.saleMode = 'custom';
  a._els['s-cust'].value = 'Ramesh Test';
  a._els['s-invno'].value = 'INV-TEST-2';
  a.customSaleItems = [{ name: 'Test Ring', grossWt: '5', blackBeads: '0', diamond: '0', making: '500', stoneCharges: '0' }];
  a._els['csi-gw-0'] = { value: '5' };
  a._els['csi-bb-0'] = { value: '0' };
  a._els['csi-dw-0'] = { value: '0' };
  a._els['csi-mk-0'] = { value: '500' };
  a._els['csi-sc-0'] = { value: '0' };
  a._els['csi-name-0'] = { value: 'Test Ring' };
  a.recordSale();
  assert(confirmShown !== null, 'second recordSale() for the same customer+item-count within 60s DOES trigger "Duplicate bill?"');
  assert(confirmShown.title === 'Duplicate bill?', 'the dialog shown is actually the duplicate-bill one, got: ' + confirmShown.title);
  assert(a.S.sales.length === 1, 'the duplicate is NOT auto-saved — it waits on the confirm callback (S.sales.length=' + a.S.sales.length + ')');

  // Tapping "Yes" on the dialog should still go on to actually save it —
  // the guard is a speed bump, not a block.
  confirmYes();
  assert(a.S.sales.length === 2, 'confirming "Duplicate bill? > Yes" actually commits the second sale (S.sales.length=' + a.S.sales.length + ')');
  assert(a.S.sales[1].invNo === 'INV-TEST-2', 'the second sale saved under its own invoice number');
}

console.log('\n=== t9: Day Book party link, rendered through the real screen paint ===');
{
  const a = loadApp();
  a.S.shopId = 'cowork-live-check-2';
  a.S.dayBook = { entries: [], closes: [], opening: { date: '2026-09-01', amount: 10000, ts: new Date().toISOString() } };
  a.S.customers = [{ id: 'cust-1', name: 'Priya Sharma', phone: '9876500000' }];
  a.saveToCloud = function (cb) { if (cb) cb(null); };
  a.saasActivityLog = function () {};
  a.auditLog = function () {};

  let err1 = null, err2 = null;
  a.dbAddEntry('2026-09-10', 'out', 5000, 'rent', 'linked to a real customer', function (e) { err1 = e; }, { name: 'Priya Sharma', phone: '9876500000', customerId: 'cust-1' });
  a.dbAddEntry('2026-09-12', 'out', 1200, 'tea', 'free-text party', function (e) { err2 = e; }, { name: 'Local Chai Wala', phone: '' });
  assert(!err1 && !err2, 'both dbAddEntry calls (linked + free-text) succeeded with no error');
  assert(a.S.dayBook.entries.find(e => e.party && e.party.customerId === 'cust-1'), 'the linked entry actually stored customerId cust-1');
  assert(a.S.dayBook.entries.find(e => e.party && e.party.name === 'Local Chai Wala' && !e.party.customerId), 'the free-text entry stored a name but no fabricated customerId');

  // Drive the REAL screen: switch to Month view, turn on By Person, and
  // render through renderDayBook() -> _dbPaint() -> _dbPaintMonth(), exactly
  // what tapping the "📅 Month" then "👤 By Person" buttons does.
  a.dbSetViewMode('month');
  a._dbByPerson = true;
  a.renderDayBook();
  const html = a._els['db-body'].innerHTML;
  assert(html.indexOf('By Person') !== -1, 'the rendered screen shows the "👤 By Person" toggle');
  assert(html.indexOf('Priya Sharma') !== -1, 'the rendered card shows the linked customer\'s name');
  assert(html.indexOf('Local Chai Wala') !== -1, 'the rendered card shows the free-text party\'s name');
  assert(html.indexOf('9876500000') !== -1, 'the linked customer\'s phone is shown on their card');
}

console.log('\nAll live-behavior checks passed.');
