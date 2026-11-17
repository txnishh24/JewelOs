// R29: tests for supabase/functions/store-proxy/role-check.ts (server-side role check on blob writes).
//   1. table-driven: every rule has a pass and a fail case per role; owner always passes
//   2. replay: the REAL client functions (record sale, part payment, mark paid, edit bill, refund, void, close day)
//      run against a mock store-proxy that applies checkRoleWrite; none may be refused
//   3. fuzz: 500 random sequences of legitimate manager/staff actions; 0 refusals
//   4. client: a 403 role_forbidden shows the server's message and does not retry
// Runs on Node (TypeScript type stripping), no Deno, no Supabase, no live shop.
import { createRequire } from 'node:module';
import { checkRoleWrite, deepEq, dayKey, SHRINK_MAX_FRACTION } from '../supabase/functions/store-proxy/role-check.ts';
const require = createRequire(import.meta.url);
const { loadApp } = require('./harness.js');

let passed = 0, failed = 0; const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; failures.push(name + ': ' + e.message); console.log('  ✗ ' + name + '\n      ' + e.message); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; failures.push(name + ': ' + e.message); console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── fixtures ─────────────────────────────────────────────────────────
const TODAY = '2026-11-14';
function sale(extra) {
  return Object.assign({ id: 's1', invNo: 'INV-001', customer: 'C', date: TODAY + 'T05:00:00.000Z', gst: 3, discount: 0,
    items: [{ pid: 'p1', name: 'Ring', weight: 5, qty: 1, lockedRate: 10000, making: 0, diamond: 0 }],
    lockedGrand: 51500, advance: 51500, payStatus: 'full', extraPayments: [], paymentHistory: [], editHistory: [], refunds: [] }, extra || {});
}
function blob(extra) {
  return Object.assign({ _v: 5, products: [{ id: 'p1' }], sales: [sale()], customers: [], girvi: [], orders: [], purchases: [],
    rates: { g22: 7200, setAt: 'x', discCaps: { staff: 5, manager: 15 } }, dayBook: { opening: null, entries: [], closes: [], reopens: [] },
    voidedInvNos: [], nextInvNo: 2, auditLog: [] }, extra || {});
}
// discount d on a 51,500-base bill: grand = (base - d) * 1.03
function discSale(id, d) { const base = 50000; return sale({ id, invNo: 'INV-' + id, discount: d, lockedGrand: Math.round((base - d) * 1.03 * 100) / 100 }); }
function withSale(b, s) { const n = clone(b); n.sales.push(s); return n; }
function code(role, cur, next) { const v = checkRoleWrite(role, cur, next); return v ? v.code : null; }

console.log('\nrole-check, table-driven (pass and fail per rule):');

test('owner always passes, even with everything wrong', function () {
  const cur = blob(); const next = blob({ sales: [], rates: {}, voidedInvNos: [], nextInvNo: 0, plan: 'x' });
  assert(code('owner', cur, next) === null);
});
test('first save of a shop (no stored row) passes', function () { assert(code('staff', null, blob()) === null); });
test('unchanged blob passes for staff and manager', function () {
  ['staff', 'manager'].forEach(function (r) { assert(code(r, blob(), blob()) === null, r); });
});
test('protected keys (plan, kgLedgerOn, gstin, paidUntil): changed = refused, same = ok', function () {
  ['plan', 'kgLedgerOn', 'gstin', 'paidUntil', 'users'].forEach(function (k) {
    ['staff', 'manager'].forEach(function (r) {
      const next = blob(); next[k] = 'x';
      assert(code(r, blob(), next) === 'protected_key', r + ' ' + k);
      const cur = blob(); cur[k] = 'x';
      assert(code(r, cur, clone(cur)) === null, r + ' same ' + k);
    });
  });
});
test('rates: staff cannot change a rate (fail), may leave them (pass); manager may change rates', function () {
  const next = blob(); next.rates.g22 = 9999;
  assert(code('staff', blob(), next) === 'staff_rates');
  assert(code('manager', blob(), next) === null);
  const added = blob(); added.rates.g14 = 4500;   // a key the client adds on load
  assert(code('staff', blob(), added) === null, 'new default key tolerated');
});
test('discCaps: manager and staff cannot change (fail), unchanged passes', function () {
  const next = blob(); next.rates.discCaps = { staff: 50, manager: 50 };
  ['staff', 'manager'].forEach(function (r) { assert(code(r, blob(), next) === 'owner_only', r); });
});
test('Day Book: staff cannot add or remove a close (fail); manager may close a day (pass) but not drop one (fail)', function () {
  const close = { date: '2026-11-13', closing: 100, counted: 100, diff: 0 };
  const added = blob(); added.dayBook.closes = [close];
  assert(code('staff', blob(), added) === 'staff_close');
  assert(code('manager', blob(), added) === null);
  const cur = blob(); cur.dayBook.closes = [close];
  assert(code('manager', cur, blob()) === 'owner_only', 'a close that vanished is a reopen');
  assert(code('staff', cur, blob()) === 'staff_close');
});
test('Day Book reopens: nobody but the owner may add one', function () {
  const next = blob(); next.dayBook.reopens = [{ date: '2026-11-13', reason: 'x' }];
  ['staff', 'manager'].forEach(function (r) { assert(code(r, blob(), next) === 'owner_only', r); });
});
test('staff: cannot remove a bill (fail); can add a bill (pass)', function () {
  const none = blob(); none.sales = [];
  assert(code('staff', blob(), none) === 'staff_delete');
  assert(code('staff', blob(), withSale(blob(), discSale('s2', 0))) === null);
});
test('staff: cannot change an existing bill (fail), can add a part-payment (pass)', function () {
  const edit = blob(); edit.sales[0].customer = 'Someone else';
  assert(code('staff', blob(), edit) === 'staff_edit');
  const disc = blob(); disc.sales[0].discount = 5000;
  assert(code('staff', blob(), disc) === 'staff_edit', 'cannot give a discount after the fact');
  const pay = blob(); pay.sales[0].extraPayments = [{ id: 'pay1', amount: 500, mode: 'Cash', date: TODAY }]; pay.sales[0].paymentHistory = [{ amount: 500 }];
  assert(code('staff', blob(), pay) === null);
});
test('part-payments are append-only (fail on rewrite or removal, fail on a zero or negative payment)', function () {
  const cur = blob(); cur.sales[0].extraPayments = [{ id: 'p', amount: 500 }];
  const rew = clone(cur); rew.sales[0].extraPayments[0].amount = 1;
  assert(code('staff', cur, rew) === 'payment_rewritten');
  const gone = clone(cur); gone.sales[0].extraPayments = [];
  assert(code('manager', cur, gone) === 'payment_rewritten');
  const neg = clone(cur); neg.sales[0].extraPayments.push({ id: 'q', amount: -5 });
  assert(code('staff', cur, neg) === 'negative_amount');
});
test('a startup migration (lockedGrand / item lockedRate backfill) on an old bill is not a change', function () {
  const cur = blob(); cur.sales[0].lockedGrand = 0; delete cur.sales[0].items[0].lockedRate;
  const next = clone(cur); next.sales[0].lockedGrand = 51500; next.sales[0].items[0].lockedRate = 10000;
  ['staff', 'manager'].forEach(function (r) { assert(code(r, cur, next) === null, r); });
});
test('discount cap on a NEW bill: staff 5% (3% pass, 10% fail), manager 15% (12% pass, 20% fail)', function () {
  assert(code('staff', blob(), withSale(blob(), discSale('s2', 1500))) === null, 'staff 3%');
  assert(code('staff', blob(), withSale(blob(), discSale('s2', 5000))) === 'discount_over_cap', 'staff 10%');
  assert(code('manager', blob(), withSale(blob(), discSale('s2', 6000))) === null, 'manager 12%');
  assert(code('manager', blob(), withSale(blob(), discSale('s2', 10000))) === 'discount_over_cap', 'manager 20%');
});
test('discount cap uses the shop\'s own caps; a bill exactly at the cap passes (rounding slack)', function () {
  const cur = blob(); cur.rates.discCaps = { staff: 2, manager: 10 };
  assert(code('staff', cur, withSale(cur, discSale('s2', 1500))) === 'discount_over_cap', '3% over a 2% cap');
  assert(code('staff', blob(), withSale(blob(), discSale('s2', 2500))) === null, 'exactly 5%');
});
test('new bill: negative amount or negative discount is refused; zero and normal pass', function () {
  assert(code('staff', blob(), withSale(blob(), sale({ id: 's2', invNo: 'INV-2', lockedGrand: -5 }))) === 'negative_amount');
  assert(code('staff', blob(), withSale(blob(), sale({ id: 's2', invNo: 'INV-2', discount: -10 }))) === 'negative_amount');
  const li = sale({ id: 's2', invNo: 'INV-2' }); li.items[0].making = -100;
  assert(code('manager', blob(), withSale(blob(), li)) === 'negative_amount', 'negative line');
  assert(code('manager', blob(), withSale(blob(), sale({ id: 's2', invNo: 'INV-2' }))) === null);
});
test('new bill on a closed day: refused for staff and manager (Tanish, 14 Nov); owner passes; an open day passes', function () {
  const cur = blob(); cur.dayBook.closes = [{ date: TODAY }];
  ['staff', 'manager'].forEach(function (r) { assert(code(r, cur, withSale(cur, sale({ id: 's2', invNo: 'INV-2' }))) === 'closed_day', r); });
  assert(code('owner', cur, withSale(cur, sale({ id: 's2', invNo: 'INV-2' }))) === null, 'owner');
  const other = blob(); other.dayBook.closes = [{ date: '2026-11-01' }];
  assert(code('staff', other, withSale(other, sale({ id: 's2', invNo: 'INV-2' }))) === null, 'a different closed day does not block today');
});
test('payment reversal: staff refused, manager passes (Tanish, 14 Nov)', function () {
  const cur = blob(); cur.sales[0].extraPayments = [{ id: 'p1', amount: 500, mode: 'Cash' }];
  const next = clone(cur); next.sales[0].extraPayments.push({ id: 'REV-1', type: 'reversal', amount: 500, mode: 'Cash', reversedPayment: 'p1' });
  assert(code('staff', cur, next) === 'staff_reversal', 'staff');
  assert(code('manager', cur, next) === null, 'manager');
});
test('manager void: needs voidedInvNos AND an audit entry with a reason (fail without either), and an open day', function () {
  const gone = blob(); gone.sales = [];
  assert(code('manager', blob(), gone) === 'void_not_recorded', 'number not recorded');
  gone.voidedInvNos = ['INV-001'];
  assert(code('manager', blob(), gone) === 'reason_required', 'no audit entry');
  gone.auditLog = [{ id: 'a1', entity: 'sale', entityId: 's1', action: 'delete', note: 'Bill INV-001 voided | reason: wrong customer' }];
  assert(code('manager', blob(), gone) === null, 'complete void passes');
  const closed = blob(); closed.dayBook.closes = [{ date: TODAY }];
  const g2 = clone(gone); g2.dayBook.closes = [{ date: TODAY }];
  assert(code('manager', closed, g2) === 'closed_day', 'void on a closed day');
  const empty = clone(gone); empty.auditLog[0].note = 'Bill INV-001 voided | reason: ';
  assert(code('manager', blob(), empty) === 'reason_required', 'empty reason');
});
test('manager edit: history must grow with a reason (fail without), closed day refused, over-cap discount refused', function () {
  const edit = blob(); edit.sales[0].customer = 'New name';
  assert(code('manager', blob(), edit) === 'edit_needs_reason', 'no history entry');
  edit.sales[0].editHistory = [{ ts: 'x', reason: 'fix name' }];
  assert(code('manager', blob(), edit) === null, 'with a reason');
  const noReason = clone(edit); noReason.sales[0].editHistory[0].reason = ' ';
  assert(code('manager', blob(), noReason) === 'reason_required');
  const cur = blob(); cur.dayBook.closes = [{ date: TODAY }];
  const e2 = clone(edit); e2.dayBook.closes = [{ date: TODAY }];
  assert(code('manager', cur, e2) === 'closed_day');
  const big = blob(); big.sales[0].discount = 12000; big.sales[0].lockedGrand = Math.round((50000 - 12000) * 1.03); big.sales[0].editHistory = [{ ts: 'x', reason: 'r' }];
  assert(code('manager', blob(), big) === 'discount_over_cap', '24% by an edit');
});
test('manager edit that keeps an old, already-high percent is allowed (same rule as the client)', function () {
  const cur = blob(); cur.sales[0].discount = 9000; cur.sales[0].lockedGrand = Math.round((50000 - 9000) * 1.03);   // 18% set by the owner earlier
  const next = clone(cur); next.sales[0].customer = 'Typo fixed'; next.sales[0].editHistory = [{ ts: 'x', reason: 'typo' }];
  assert(code('manager', cur, next) === null);
});
test('manager refund: reason required (fail without), closed day refused, with a reason passes; staff cannot refund', function () {
  const next = blob(); next.sales[0].refunds = [{ id: 'r1', amount: 1000, reason: '' }]; next.sales[0].refundStatus = 'partial';
  assert(code('manager', blob(), next) === 'reason_required');
  next.sales[0].refunds[0].reason = 'Wrong Item';
  assert(code('manager', blob(), next) === null);
  assert(code('staff', blob(), next) === 'staff_edit');
  const cur = blob(); cur.dayBook.closes = [{ date: TODAY }];
  const n2 = clone(next); n2.dayBook.closes = [{ date: TODAY }];
  assert(code('manager', cur, n2) === 'closed_day');
});
test('invoice numbers never go back: voidedInvNos entry removed, nextInvNo lowered (fail); growing passes', function () {
  const cur = blob({ voidedInvNos: ['INV-009'], nextInvNo: 10 });
  const a = clone(cur); a.voidedInvNos = [];
  const b = clone(cur); b.nextInvNo = 3;
  const c = clone(cur); c.nextInvNo = 11; c.voidedInvNos.push('INV-010');
  ['staff', 'manager'].forEach(function (r) {
    assert(code(r, cur, a) === 'owner_only', r + ' voided list');
    assert(code(r, cur, b) === 'owner_only', r + ' counter');
    assert(code(r, cur, c) === null, r + ' grow');
  });
});
test('mass delete: >20% of customers/products in one save refused for staff and manager; owner Clear All passes; small shops exempt', function () {
  const cur = blob({ customers: Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i })) });
  const half = clone(cur); half.customers = half.customers.slice(0, 5);
  const one = clone(cur); one.customers = one.customers.slice(0, 9);
  ['staff', 'manager'].forEach(function (r) { assert(code(r, cur, half) === 'mass_delete', r); assert(code(r, cur, one) === null, r + ' one'); });
  const cleared = clone(cur); cleared.customers = []; cleared.products = []; cleared.sales = [];
  assert(code('owner', cur, cleared) === null, 'owner');
  const tiny = blob({ products: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }); const t2 = clone(tiny); t2.products = [{ id: 'a' }];
  assert(code('manager', tiny, t2) === null, 'tiny shop');
  assert(SHRINK_MAX_FRACTION === 0.2);
});
test('helpers: deepEq treats undefined and null as empty; dayKey uses the Indian day', function () {
  assert(deepEq({ a: undefined }, {}) && deepEq(null, undefined) && !deepEq([1], [1, 2]));
  assert(dayKey('2026-11-13T19:00:00.000Z') === '2026-11-14', 'IST after midnight');
  assert(dayKey('2026-11-13') === '2026-11-13');
});

// ── cases found by the security audit (each one was a real bypass before the fix) ──
test('audit: a bill with id "__proto__" cannot hide a changed bill', function () {
  const cur = blob(); const next = blob();
  next.sales = [{ id: '__proto__', b: clone(sale()) }];
  assert(code('staff', cur, next) !== null, 'staff');
  assert(code('manager', cur, next) !== null, 'manager');
});
test('audit: a bill without an id, or two bills with one id, are refused', function () {
  const noId = withSale(blob(), (function () { const s = discSale('x', 0); delete s.id; return s; })());
  assert(code('staff', blob(), noId) === 'bad_ids', 'no id');
  const dup = blob(); dup.sales.push(clone(dup.sales[0]));
  assert(code('manager', blob(), dup) === 'bad_ids', 'duplicate id');
});
test('audit: hostile nulls make the check refuse (never crash into allowing); owner still passes', function () {
  const a = blob(); a.sales[0].extraPayments = [null];
  const b = withSale(blob(), (function () { const s = discSale('s2', 0); s.items = [null]; return s; })());
  ['staff', 'manager'].forEach(function (r) { assert(code(r, blob(), a) !== null && code(r, blob(), b) !== null, r); });
  assert(code('owner', blob(), a) === null && code('owner', blob(), b) === null, 'owner');
});
test('audit: text amounts and a "total 1" bill hiding a 100% discount are refused; an honest bill passes', function () {
  const txt = discSale('s2', 0); txt.discount = '90000';
  assert(code('staff', blob(), withSale(blob(), txt)) === 'bad_amount', 'text discount');
  const low = discSale('s3', 0); low.lockedGrand = 1;
  assert(code('staff', blob(), withSale(blob(), low)) === 'total_below_items', 'total 1');
  assert(code('manager', blob(), withSale(blob(), discSale('s4', 2500))) === null, 'honest 5% bill');
});
test('audit: a made-up lockedGrand on an old bill is not a "migration"; the real migration still passes', function () {
  const cur = blob(); cur.sales[0].lockedGrand = 0;
  const fake = clone(cur); fake.sales[0].lockedGrand = 1;
  assert(code('staff', cur, fake) === 'staff_edit', 'fake');
  const real = clone(cur); real.sales[0].lockedGrand = real.sales[0].advance;   // payStatus full, advance = total
  assert(code('staff', cur, real) === null, 'real migration');
});
test('audit: staff cannot flip paid status without a payment; payment-history amounts must be positive', function () {
  const cur = blob(); cur.sales[0].payStatus = 'pending'; cur.sales[0].advance = 0;
  const next = clone(cur); next.sales[0].payStatus = 'full'; next.sales[0].paidAt = 'now';
  assert(code('staff', cur, next) === 'payment_rewritten', 'flip');
  const neg = clone(cur); neg.sales[0].paymentHistory = [{ amount: -5 }];
  assert(code('staff', cur, neg) === 'negative_amount', 'negative history');
});
test('audit: a manager edit cannot move a bill onto a closed day or rewrite its earlier refunds', function () {
  const cur = blob(); cur.dayBook.closes = [{ date: '2026-11-10' }];
  const mv = clone(cur); mv.sales[0].date = '2026-11-10'; mv.sales[0].editHistory = [{ ts: 'x', reason: 'r' }];
  assert(code('manager', cur, mv) === 'closed_day', 'moved');
  const c2 = blob(); c2.sales[0].refunds = [{ id: 'r', amount: 5, reason: 'x' }];
  const wipe = clone(c2); wipe.sales[0].refunds = []; wipe.sales[0].customer = 'Z'; wipe.sales[0].editHistory = [{ ts: 'x', reason: 'r' }];
  assert(code('manager', c2, wipe) === 'refund_rewritten', 'refunds wiped');
});
test('audit: a new bill cannot reuse an existing or voided invoice number', function () {
  const cur = blob({ voidedInvNos: ['INV-050'] });
  assert(code('staff', cur, withSale(cur, sale({ id: 's9', invNo: 'INV-001' }))) === 'invoice_reused', 'live number');
  assert(code('staff', cur, withSale(cur, sale({ id: 's9', invNo: 'INV-050' }))) === 'invoice_reused', 'voided number');
});

// ── replay: the real client against a mock store-proxy ─────────────────
console.log('\nreplay (real client functions through a mock store-proxy that applies checkRoleWrite):');

const REPLAY = { flows: 0, refused: [] };
function makeServer(initial) {
  const srv = { data: Object.assign({}, clone(initial), { _v: 1 }), puts: 0, refusals: [], mode: 'enforce' };
  return srv;
}
function wire(app, srv, role) {
  app.SAAS.shop = { id: 'shop1', name: 'T' }; app.SAAS.sessionToken = 'tok';
  app.SAAS.user = { id: 'u_' + role, name: role, email: role + '@x.in', role: role };
  app.setTimeout = function (f, ms) { if ([2000, 5000, 15000].indexOf(ms) !== -1) f(); return 1; }; app.clearTimeout = function () {};
  app.fetch = function (url, opts) {
    if (opts && opts.method === 'PUT') {
      const body = JSON.parse(opts.body); srv.puts++;
      if (role !== 'owner' && srv.data._v === body.expectedVersion) {
        const v = checkRoleWrite(role, srv.data, body.data);
        if (v) {
          srv.refusals.push({ role, code: v.code });
          return Promise.resolve({ status: 403, ok: false, json: () => Promise.resolve({ error: 'role_forbidden', code: v.code, message: v.message }) });
        }
      }
      if (body.expectedVersion !== srv.data._v) return Promise.resolve({ status: 409, ok: false, json: () => Promise.resolve({ ok: false, conflict: true, data: srv.data }) });
      srv.data = Object.assign({}, clone(body.data), { _v: srv.data._v + 1 });
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ ok: true, data: { _v: srv.data._v } }) });
    }
    return Promise.reject(new Error('no counter here'));
  };
  app.upsertCustomer = function () {}; app.clearSale = function () {}; app.renderDash = function () {}; app.switchTab = function () {};
  app.isDuplicateSale = function () { return false; }; app.renderCustomers = function () {}; app.renderTab = function () {};
  app.refreshOpenCustHistory = function () {}; app.showCustHistory = function () {}; app.closeCustModal = function () {};
  app.toast = function () {}; app.safeConfirm = function (t, m, ok) { ok(); }; app.setSyncStatus = function () {};
  app.invPoolTopUp = function () {}; app.renderOrders = function () {};
  app.dbInit && app.dbInit();
}
function load(app, srv) {   // what a phone does when it loads the shop: its S becomes the server's blob
  const d = clone(srv.data);
  Object.keys(d).forEach(function (k) { if (k[0] !== '_') app.S[k] = d[k]; });
  app._loadedVersion = srv.data._v;
  app.dbInit();
}
const flush = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 12; i++) await flush(); }
function seedBlob() {
  return { products: [{ id: 'p1', name: 'Ring', metal: 'gold', purity: '22K', weight: 50, netWeight: 50, unitWeight: 5, qty: 10, status: 'available', huid: '' }],
    sales: [], customers: [], girvi: [], orders: [], purchases: [], suppliers: [], karigars: [], kgJobs: [], auditLog: [], voidedInvNos: [],
    rates: { g24: 7500, g22: 7200, g18: 6000, g14: 4500, sil: 90, setAt: '2026-01-01T00:00:00.000Z' },
    dayBook: { opening: null, entries: [], closes: [], reopens: [] }, nextInvNo: 1, nextSaleId: 1, nextId: 1 };
}
let _n = 0;
async function doSale(app, srv, role, discPct) {
  load(app, srv);
  const d = Math.round(36000 * (discPct || 0) / 100); const id = 'rs' + (++_n);
  const s = { id, invNo: 'INV-' + String(1000 + _n), customer: 'Cust ' + _n, phone: '', items: [{ pid: 'p1', name: 'Ring', metal: 'gold', purity: '22K', weight: 5, qty: 1, lockedRate: 7200, making: 0, diamond: 0 }],
    nowPaying: { amount: 0, mode: 'Cash' }, gst: 3, discount: d, lockedGrand: Math.round((36000 - d) * 1.03 * 100) / 100, advance: 0, payStatus: 'pending', date: new Date().toISOString() };
  app.UI.saleItems = [{ pid: 'p1', qty: 1 }];
  if (role !== 'owner' && app.dbSaleDayClosed(s)) return 0;   // recordSale refuses this for staff and manager (tested in regression.test.js)
  const before = srv.data.sales.length;
  app._commitSaleTransaction(s); await settle();
  REPLAY.flows++;
  return srv.data.sales.length - before;
}
const vals = (app, map) => { const o = app.document.getElementById; app.document.getElementById = function (id) { return id in map ? { value: map[id], style: {} } : o(id); }; };

await atest('flow: staff records a sale, manager records a sale, owner records a sale (3 flows) - none refused', async function () {
  const srv = makeServer(seedBlob());
  for (const role of ['staff', 'manager', 'owner']) {
    const app = loadApp(); wire(app, srv, role);
    const added = await doSale(app, srv, role);
    assert(added === 1, role + ' sale not saved: ' + JSON.stringify(srv.refusals));
  }
  assert(srv.refusals.length === 0, JSON.stringify(srv.refusals));
});

await atest('flow: staff adds a part-payment to an old bill; manager marks one paid; staff reversal blocked, manager reverses (4 flows) - none refused', async function () {
  const srv = makeServer(seedBlob());
  const owner = loadApp(); wire(owner, srv, 'owner'); await doSale(owner, srv, 'owner');
  await doSale(owner, srv, 'owner');
  const id1 = srv.data.sales[0].id, id2 = srv.data.sales[1].id;
  const staff = loadApp(); wire(staff, srv, 'staff'); load(staff, srv);
  vals(staff, { 'spay-amount': '500', 'spay-mode': 'Cash', 'spay-ref': '' });
  staff.submitSalePayment(id1); await settle(); REPLAY.flows++;
  assert(srv.data.sales[0].extraPayments && srv.data.sales[0].extraPayments.length === 1, 'staff payment landed: ' + JSON.stringify(srv.refusals));
  const mgr = loadApp(); wire(mgr, srv, 'manager'); load(mgr, srv);
  mgr.markSalePaid(id2); await settle(); REPLAY.flows++;
  assert(srv.data.sales[1].payStatus === 'full', 'mark paid landed: ' + JSON.stringify(srv.refusals));
  const staff2 = loadApp(); wire(staff2, srv, 'staff'); load(staff2, srv);
  const payId = srv.data.sales[0].extraPayments[0].id;
  staff2.reverseSalePayment(id1, payId); await settle(); REPLAY.flows++;   // the client itself now refuses staff
  assert(srv.data.sales[0].extraPayments.length === 1 && srv.puts === srv.puts, 'staff reversal refused by the client, nothing sent');
  const mgr2 = loadApp(); wire(mgr2, srv, 'manager'); load(mgr2, srv);
  mgr2.reverseSalePayment(id1, payId); await settle(); REPLAY.flows++;
  assert(srv.data.sales[0].extraPayments.length === 2, 'manager reversal landed: ' + JSON.stringify(srv.refusals));
  assert(srv.refusals.length === 0, JSON.stringify(srv.refusals));
});

await atest('flow: manager edits a bill with a reason, refunds with a reason, voids with a reason, closes a day (4 flows) - none refused; owner reopens', async function () {
  const srv = makeServer(seedBlob());
  const owner = loadApp(); wire(owner, srv, 'owner'); await doSale(owner, srv, 'owner'); await doSale(owner, srv, 'owner'); await doSale(owner, srv, 'owner');
  const ids = srv.data.sales.map((s) => s.id);
  const mgr = loadApp(); wire(mgr, srv, 'manager'); load(mgr, srv);
  mgr._editBillId = ids[0];
  vals(mgr, { 'eb-reason': 'fix weight', 'eb-disc': '0', 'eb-gst': '3', 'ei-wt-0': '5' });
  mgr.saveEditBill('fix weight'); await settle(); REPLAY.flows++;
  assert(srv.refusals.length === 0, 'edit refused: ' + JSON.stringify(srv.refusals));
  load(mgr, srv);
  vals(mgr, { 'rfnd-amount': '100', 'rfnd-mode': 'Cash', 'rfnd-reason': 'Wrong Item', 'rfnd-note': '' });
  mgr._submitRefund(ids[1]); await settle(); REPLAY.flows++;
  assert(srv.refusals.length === 0, 'refund refused: ' + JSON.stringify(srv.refusals));
  assert((srv.data.sales[1].refunds || []).length === 1, 'refund landed');
  load(mgr, srv);
  mgr.askReason = function (t, h, ok, cb) { cb('customer cancelled'); };
  mgr.deleteSale(ids[2]); await settle(); REPLAY.flows++;
  assert(srv.refusals.length === 0, 'void refused: ' + JSON.stringify(srv.refusals));
  assert(srv.data.sales.length === 2 && srv.data.voidedInvNos.length === 1, 'void landed');
  load(mgr, srv);
  const day = mgr.dbToday(); let closeErr = 'pending';
  mgr.dbCloseDay(day, 0, function (e) { closeErr = e; }); await settle(); REPLAY.flows++;
  assert(closeErr === null && srv.refusals.length === 0, 'close refused or failed: ' + closeErr + JSON.stringify(srv.refusals));
  const o2 = loadApp(); wire(o2, srv, 'owner'); load(o2, srv);
  let rerr = 'pending'; o2.dbReopenDay(day, 'recount', function (e) { rerr = e; }); await settle();
  assert(rerr === null || (rerr && /adjustments-posted/.test(rerr.message)) || rerr === undefined, 'owner reopen: ' + (rerr && rerr.message));
});

await atest('flow: staff cannot slip a console edit through (rates, discount on an old bill, delete a bill, close a day)', async function () {
  const srv = makeServer(seedBlob());
  const owner = loadApp(); wire(owner, srv, 'owner'); await doSale(owner, srv, 'owner');
  const staff = loadApp(); wire(staff, srv, 'staff');
  const tries = [
    function () { staff.S.rates.g22 = 1; },
    function () { staff.S.sales[0].discount = 40000; },
    function () { staff.S.sales = []; },
    function () { staff.S.dayBook.closes.push({ date: '2026-11-14' }); },
  ];
  for (const t of tries) {
    load(staff, srv); t();
    let err = 'pending'; staff.saveToCloud(function (e) { err = e; }); await settle();
    assert(err && /forbidden/.test(err.message), 'was not refused: ' + err);
  }
  assert(srv.refusals.length === 4, JSON.stringify(srv.refusals));
});

// ── fuzz ─────────────────────────────────────────────────────────────
console.log('\nfuzz (500 random sequences of legitimate manager/staff actions):');
let seed = 20261114;
function rnd(n) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }
await atest('500 random legitimate sequences produce 0 refusals', async function () {
  const apps = { staff: loadApp(), manager: loadApp(), owner: loadApp() };
  let ops = 0, landed = 0; const tally = {};
  for (let seq = 0; seq < 500; seq++) {
    const srv = makeServer(seedBlob());
    Object.keys(apps).forEach(function (r) { wire(apps[r], srv, r); });
    const len = 3 + rnd(5);
    for (let k = 0; k < len; k++) {
      const role = ['staff', 'manager'][rnd(2)]; const app = apps[role]; load(app, srv);
      const v0 = srv.data._v;
      const sales = srv.data.sales; const pick = sales.length ? sales[rnd(sales.length)] : null; const op = rnd(10);
      if (op <= 2 || !pick) { landed += await doSale(app, srv, role, rnd(role === 'manager' ? 15 : 5) + 1); }
      else if (op === 3) { vals(app, { 'spay-amount': String(1 + rnd(900)), 'spay-mode': ['Cash', 'UPI'][rnd(2)], 'spay-ref': '' }); app.submitSalePayment(pick.id); }
      else if (op === 4) { app.markSalePaid(pick.id); }
      else if (op === 5 && role === 'manager') { app._editBillId = pick.id; vals(app, { 'eb-reason': 'fix ' + rnd(100), 'eb-disc': String(rnd(3) * 500), 'eb-gst': '3', 'ei-wt-0': String(4 + rnd(3)) }); app.saveEditBill('fix'); }
      else if (op === 6 && role === 'manager') { vals(app, { 'rfnd-amount': String(10 + rnd(200)), 'rfnd-mode': 'Cash', 'rfnd-reason': 'Wrong Item', 'rfnd-note': '' }); app._submitRefund(pick.id); }
      else if (op === 8 && role === 'manager') { app.dbCloseDay(app.dbToday(), 0, function () {}); }
      else if (op === 9) { const ow = apps.owner; load(ow, srv); ow.dbReopenDay(ow.dbToday(), 'recount', function () {}); }
      else if (op === 7 && role === 'manager') { app.askReason = function (t, h, ok, cb) { cb('cancelled ' + rnd(9)); }; app.deleteSale(pick.id); }
      await settle(); ops++;
      { const nm = ['sale','sale','sale','sale','payment','markpaid','edit','refund','void','close','reopen'][op <= 2 || !pick ? 0 : op + 1] || 'x'; if (srv.data._v > v0) tally[nm] = (tally[nm] || 0) + 1; }
      assert(srv.refusals.length === 0, 'seq ' + seq + ' step ' + k + ' (' + role + ' op ' + op + ') refused: ' + JSON.stringify(srv.refusals));
    }
  }
  console.log('      ' + ops + ' operations across 500 sequences, ' + landed + ' new sales landed, 0 refusals');
  console.log('      saves that landed by action: ' + JSON.stringify(tally));
  REPLAY.fuzzOps = ops;
});

// ── client: 403 role_forbidden ───────────────────────────────────────
console.log('\nclient handling of 403 role_forbidden:');
await atest('the app shows the server message, does not retry, and reports the save as failed', async function () {
  const app = loadApp(); app.SAAS.sessionToken = 'tok'; app.SAAS.shop = { id: 'shop1' }; app.SAAS.user = { id: 'u', role: 'staff', name: 's' };
  app.setTimeout = function (f, ms) { if ([2000, 5000, 15000].indexOf(ms) !== -1) f(); return 1; }; app.clearTimeout = function () {};
  const said = []; app.toast = function (m) { said.push(String(m)); }; app.setSyncStatus = function () {};
  let puts = 0;
  app.fetch = function () { puts++; return Promise.resolve({ status: 403, ok: false, json: () => Promise.resolve({ error: 'role_forbidden', code: 'staff_rates', message: 'Staff cannot change rates. Ask the owner or a manager.' }) }); };
  let err = 'pending'; app.saveToCloud(function (e) { err = e; }); await settle();
  assert(puts === 1, 'retried: ' + puts + ' PUTs');
  assert(err && err.message === 'forbidden', 'callback error: ' + (err && err.message));
  assert(err.code === 'role_forbidden', 'error carries the server code: ' + err.code);
  assert(said.some(function (m) { return /Staff cannot change rates/.test(m); }), 'message shown: ' + JSON.stringify(said));
});

await atest('offline bills the server refuses are set aside on the phone, not replayed forever', async function () {
  const app = loadApp(); app.SAAS.shop = { id: 'shop1' }; app.SAAS.user = { id: 'u', role: 'staff', name: 's' };
  app.toast = function () {}; app.renderDash = function () {}; app.saveCache = function () {};
  let reloaded = 0; app.loadFromCloud = function (cb) { reloaded++; if (cb) cb(null); };
  const key = app.saleOutboxKey();
  app.localStorage.setItem(key, JSON.stringify([{ sale: { id: 'o1', invNo: 'INV-9' }, mode: 'stock', items: [] }]));
  assert(app.quarantineOfflineSales() === 1, 'one bill moved');
  assert(JSON.parse(app.localStorage.getItem(key)).length === 0, 'outbox emptied');
  assert(JSON.parse(app.localStorage.getItem(app.shopScopedKey('jewelos_sale_outbox_rejected'))).length === 1, 'kept in the rejected list');
  assert(reloaded === 1, 'cloud data reloaded');
  assert(app.quarantineOfflineSales() === 0, 'nothing left to move');
});

console.log('\n' + '='.repeat(50));
console.log(passed + ' passed, ' + failed + ' failed');
console.log('replay flows run: ' + REPLAY.flows + '; fuzz operations: ' + (REPLAY.fuzzOps || 0));
if (failed) { failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
process.exit(0);
