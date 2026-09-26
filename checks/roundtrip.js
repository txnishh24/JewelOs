// End-to-end proof: fill S with data, run the real export payload builder,
// wipe S, run the real restore assignments, and confirm nothing was lost.
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2];
const auth = fs.readFileSync(path.join(ROOT, 'js', '05-auth-login.js'), 'utf8');

// a shop with data in every list
const before = {
  products: [{ id: 1, name: 'Gold Ring 22K' }],
  sales: [{ id: 1, grand: 45000 }],
  orders: [{ id: 1, ordNo: 'ORD-1', goldPurity: '18K' }],
  girvi: [{ id: 1, grvNo: 'GRV-1', principal: 20000 }],
  customers: [{ id: 1, name: 'R. Kumar' }],
  purchases: [{ id: 1, billNo: 'PB-1', supplier: 'Mehta Bullion' }],
  suppliers: [{ id: 1, name: 'Mehta Bullion' }],
  rates: { g24: 7800, g22: 7200 },
  purchaseCfg: { showWastage: false },
  waRules: { reminder: true },
  dayBook: {
    opening: { date: '2026-09-01', amount: 5000, ts: '2026-09-01T04:00:00.000Z' },
    entries: [
      { id: 'e1', date: '2026-09-05', dir: 'out', amount: 500, cat: 'rent', note: '', party: { name: 'R. Kumar', phone: '9876543210', customerId: 1 }, kind: 'manual', ts: '2026-09-05T06:00:00.000Z', by: 'Tanish', voided: false, voidReason: '' },
      { id: 'e2', date: '2026-09-06', dir: 'in', amount: 2000, cat: 'adjust', note: 'Correction to 2026-09-01', kind: 'adjust', srcDate: '2026-09-01', ts: '2026-09-06T06:00:00.000Z', by: 'system', voided: false, voidReason: '' }
    ],
    closes: [
      { date: '2026-09-01', opening: 5000, autoIn: 12000, autoOut: 3000, manualIn: 0, manualOut: 0, closing: 14000, counted: 13800, diff: -200, ts: '2026-09-01T14:00:00.000Z', by: 'Tanish',
        restatements: [ { ts: '2026-09-06T06:00:00.000Z', by: 'system', prevIn: 12000, prevOut: 3000, newIn: 14000, newOut: 3000, entryId: 'e2' } ],
        countCorrections: [] }
    ]
  },
  stockMovements: [{ productId: 1, type: 'purchase' }],
  activityLog: [{ t: 'login' }],
  auditLog: [{ t: 'update' }],
  purchaseAuditLog: [{ t: 'bill' }],
  nextId: 7, nextSaleId: 3, nextInvNo: 12, nextOrdId: 4,
  nextGirviId: 2, nextPurchaseId: 5, nextPurchaseBillNo: 9
};

// --- run the real export payload, verbatim from the source ---
const S = JSON.parse(JSON.stringify(before));
const SAAS = { shop: { id: 'shop_1', name: 'Sri Sai Jewellers' } };
const dataSrc = auth.match(/var payload = \{[\s\S]*?\n {2}\};/)[0];
let payload;
eval(dataSrc.replace('var payload =', 'payload ='));

// --- wipe, as after data loss, then run the real restore assignments ---
for (const k of Object.keys(S)) {
  S[k] = Array.isArray(before[k]) ? [] : (typeof before[k] === 'object' ? null : 0);
}
const d = payload.data;
const restoreSrc = auth
  .match(/var d = parsed\.data;[\s\S]*?normaliseData\(\);/)[0]
  .replace('var d = parsed.data;', '')
  .replace('normaliseData();', '');
eval(restoreSrc);

// --- compare ---
let bad = 0;
for (const k of Object.keys(before)) {
  const a = JSON.stringify(before[k]), b = JSON.stringify(S[k]);
  if (a !== b) { console.log('  LOST  ' + k + ':  ' + a + '  ->  ' + b); bad++; }
}
console.log('backup version: ' + payload.version);
console.log('keys in payload: ' + Object.keys(d).length);
console.log(bad === 0
  ? 'PASS  all ' + Object.keys(before).length + ' shop-data keys survived export -> wipe -> restore'
  : 'FAIL  ' + bad + ' key(s) lost in the round trip');
