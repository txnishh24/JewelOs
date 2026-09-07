// Verifies making charges: gross-weight basis on new sales, net on pre-existing
// records, and that historical GST is not restated.
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2];

// pull the real helpers + calcSaleTotals out of the source
const sync = fs.readFileSync(path.join(ROOT, 'js', '01-sync-core.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'js', '02-ui-inactivity-modals.js'), 'utf8');

const helpers = sync.match(/function itemMakingWeight[\s\S]*?\n\}\n\n\/\/ Full making[\s\S]*?\n\}/)[0];
const totals = ui.match(/function calcSaleTotals\(sale\)\{[\s\S]*?\n\}/)[0];
eval(helpers);
eval('function getItemRate(i){ return i.lockedRate || 0; }');
eval(totals);

const item = (extra) => Object.assign({
  name: 'Bangle', qty: 1, isCustom: true,
  grossWeight: 20, blackBeads: 3, diamondWt: 2, weight: 15, // net = 20 - 3 - 2
  making: 500, diamond: 0, lockedRate: 7200
}, extra);

function show(label, sale) {
  const t = calcSaleTotals(sale);
  console.log('  ' + label);
  console.log('     metal value  ' + t.gv.toFixed(0) + '   making ' + t.mc.toFixed(0) +
              '   taxable ' + t.taxable.toFixed(0) + '   GST ' + t.gstAmt.toFixed(2) +
              '   grand ' + t.grand.toFixed(2));
  return t;
}

console.log('One custom bangle: gross 20g, black beads 3g, diamond 2g -> net 15g');
console.log('Rate 7200/g, making 500/g, GST 3%\n');

const oldSale = { items: [item()], gst: 3 };                          // no makingBasis
const newSale = { items: [item({ makingBasis: 'gross' })], gst: 3 };

const a = show('EXISTING record (no makingBasis) - must stay on NET 15g:', oldSale);
const b = show('NEW sale (makingBasis: gross)    - must use GROSS 20g:', newSale);

console.log('');
let fail = 0;
function check(cond, msg) { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) fail++; }

check(a.mc === 500 * 15, 'old record making = 500 x 15g net = 7,500 (got ' + a.mc + ')');
check(b.mc === 500 * 20, 'new sale making  = 500 x 20g gross = 10,000 (got ' + b.mc + ')');
check(a.gv === b.gv, 'metal value unchanged by the switch - still valued on net weight');
check(b.mc - a.mc === 2500, 'the beads+diamond 5g now carry making: +2,500 per bangle');
check(a.gstAmt !== b.gstAmt, 'GST differs between the two bases (so not restating old bills matters)');
check(a.taxable === 115500 && a.gstAmt === 3465, 'old bill reproduces its original taxable 115,500 / GST 3,465');

// a stock (non-custom) item must be untouched: making is a flat amount
const stock = { items: [{ name: 'Ring', qty: 2, isCustom: false, weight: 5, making: 800, diamond: 0, lockedRate: 7200 }], gst: 3 };
const s = calcSaleTotals(stock);
check(s.mc === 1600, 'stock item making stays flat: 800 x 2 qty = 1,600 (got ' + s.mc + ')');

// gross missing on a record that claims the gross basis -> fall back to net, never 0
const noGross = { items: [item({ makingBasis: 'gross', grossWeight: undefined })], gst: 3 };
check(calcSaleTotals(noGross).mc === 500 * 15, 'missing gross falls back to net rather than charging 0');

// ── the locked total: what buildSaleObj() stamps onto the sale record ──
// buildSaleObj's own loop is what becomes lockedGrand, and lockedGrand wins
// over calcSaleTotals forever after. The two must agree or the invoice shows
// one making charge and bills another.
const buildLoop = ui.match(/var gv=0,mc=0,dc=0;\n  saleItems\.forEach[\s\S]*?\n  \}\);/)[0];
function lockedMaking(items) {
  const saleItems = items;
  const getRate = () => 7200;
  eval(buildLoop);   // declares gv/mc/dc itself, exactly as the app does
  return mc;
}
console.log('');
const newItem = item({ makingBasis: 'gross' });
check(lockedMaking([newItem]) === 10000,
  'locked total charges making on gross: 500 x 20g = 10,000 (got ' + lockedMaking([newItem]) + ')');
check(lockedMaking([newItem]) === calcSaleTotals({ items: [newItem], gst: 0 }).mc,
  'locked total and the displayed breakdown agree - no silent gap between them');
const stockItem = { name: 'Ring', qty: 2, isCustom: false, weight: 5, making: 800, diamond: 0, lockedRate: 7200 };
check(lockedMaking([stockItem]) === 1600, 'stock item still locks flat making 800 x 2 = 1,600');

console.log('');
console.log(fail === 0 ? 'ALL CHECKS PASSED' : fail + ' CHECK(S) FAILED');
process.exit(fail === 0 ? 0 : 1);
