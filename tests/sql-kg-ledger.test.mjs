// Runs supabase/migrations/010_karigar_ledger.sql against real Postgres (PGlite, in-process).
// Not in npm deps on purpose -- one-off: npm i --no-save @electric-sql/pglite@0.2 && node tests/sql-kg-ledger.test.mjs
// Optional argv[2]: path to the migration (to test a different copy).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';
const MIG = process.argv[2] || fileURLToPath(new URL('../supabase/migrations/010_karigar_ledger.sql', import.meta.url));
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec(fs.readFileSync(MIG, 'utf8'));
await db.exec(fs.readFileSync(MIG, 'utf8'));            // idempotent: second run must not fail
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

let n = 0;
async function post(shop, type, lines, o = {}) {
  const op = o.op || ('op' + (++n));
  const r = await db.query(
    'select * from kg_post_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [shop, op, type, o.job || 'J1', o.voucher || null, o.reverses || null, '2026-10-31', o.note || '', 'tester', o.role || 'owner',
     o.approved || null, '{}', JSON.stringify(lines), JSON.stringify(o.labour || [])]);
  return r.rows[0];
}
const L = (account, owner, fine) => ({ account, owner_ref: owner, fine_mg: fine });
const bal = async (shop, account, owner) => {
  const r = await db.query('select fine_mg from kg_balances($1) where account=$2 and owner_ref=$3', [shop, account, owner]);
  return r.rows.length ? Number(r.rows[0].fine_mg) : 0;
};
const count = async (t) => Number((await db.query(`select count(*) c from ${t}`)).rows[0].c);

// 1 issue 100 g fine from an UNTRACKED vault (vault may go negative: stock not tracked)
let r = await post('A', 'ISSUE', [L('VAULT', '', -100000), L('KCUST', 'k1', 100000)]);
ok(r.ok && !r.duplicate && r.journal_id, 'issue posts');
ok(await bal('A', 'KCUST', 'k1') === 100000, 'karigar custody = 100.000 g');
ok(await bal('A', 'VAULT', '') === -100000, 'untracked vault is only a source');

// 2 idempotency
const first = r.journal_id;
r = await post('A', 'ISSUE', [L('VAULT', '', -100000), L('KCUST', 'k1', 100000)], { op: 'op1' });
ok(r.ok && r.duplicate && Number(r.journal_id) === Number(first), 'same op_id returns the same journal');
ok(await count('kg_journal') === 1, 'duplicate wrote nothing');

// 3 must balance
r = await post('A', 'ISSUE', [L('VAULT', '', -5), L('KCUST', 'k1', 6)]);
ok(!r.ok && /does not balance/.test(r.error), 'unbalanced journal refused');
ok(await count('kg_journal') === 1, 'nothing written for the refused journal');

// 4 cannot receive more than the karigar holds; refusal leaves no trace
r = await post('A', 'RECEIPT', [L('KCUST', 'k1', -100001), L('FG', 'J1', 100001)]);
ok(!r.ok && /negative/.test(r.error), 'metal cannot be created: custody would go negative');
ok(await count('kg_journal') === 1 && await count('kg_journal_line') === 2, 'refused journal fully rolled back (header and lines)');

// 5 normal flow: receipt, scrap, loss, all conserve
r = await post('A', 'RECEIPT', [L('KCUST', 'k1', -36640), L('FG', 'J1', 36640)]); ok(r.ok, 'receipt');
r = await post('A', 'SCRAP', [L('KCUST', 'k1', -2985), L('SCRAP', 'k1', 2985)]); ok(r.ok, 'scrap');
r = await post('A', 'LOSS', [L('KCUST', 'k1', -400), L('LOSS', 'k1', 400)], { approved: 'owner' }); ok(r.ok, 'approved loss');
ok(await bal('A', 'KCUST', 'k1') === 100000 - 36640 - 2985 - 400, 'custody = issued - receipt - scrap - loss');

// 6 entitlement (4% of 100 g fine = 4 g) accrue then settle by keeping: both balanced, claim cleared
r = await post('A', 'ENTITLEMENT_ACCRUE', [L('ENT', 'k1', 4000), L('EARNED', 'k1', -4000)]); ok(r.ok, 'entitlement accrues without moving custody');
ok(await bal('A', 'KCUST', 'k1') === 59975, 'custody untouched by accrual');
r = await post('A', 'ENTITLEMENT_SETTLE', [L('KCUST', 'k1', -4000), L('PAYOUT', 'k1', 4000), L('ENT', 'k1', -4000), L('EARNED', 'k1', 4000)]);
ok(r.ok, 'settle by keeping');
ok(await bal('A', 'ENT', 'k1') === 0 && await bal('A', 'EARNED', 'k1') === 0, 'claim and clearing account back to zero');
ok(await bal('A', 'PAYOUT', 'k1') === 4000 && await bal('A', 'KCUST', 'k1') === 55975, 'payout recorded, custody reduced');

// 7 transfer k1 -> k2 through TRANSIT, then confirmation
r = await post('A', 'TRANSFER_OUT', [L('KCUST', 'k1', -10000), L('TRANSIT', 'TV1', 10000)], { voucher: 'TV1' }); ok(r.ok, 'transfer out');
r = await post('A', 'TRANSFER_IN', [L('TRANSIT', 'TV1', -10000), L('KCUST', 'k2', 10000)], { voucher: 'TV1' }); ok(r.ok, 'transfer in');
ok(await bal('A', 'TRANSIT', 'TV1') === 0 && await bal('A', 'KCUST', 'k2') === 10000, 'in-transit clears, receiver holds it');
r = await post('A', 'TRANSFER_IN', [L('TRANSIT', 'TV1', -10000), L('KCUST', 'k2', 10000)]);
ok(!r.ok && /negative/.test(r.error), 'a voucher cannot be confirmed twice');

// 8 reversal: exact mirror only, once only
const loss = (await db.query("select id from kg_journal where type='LOSS'")).rows[0].id;
r = await post('A', 'REVERSAL', [L('KCUST', 'k1', 300), L('LOSS', 'k1', -300)], { reverses: loss });
ok(!r.ok && /mirror/.test(r.error), 'reversal that is not an exact mirror refused');
r = await post('A', 'REVERSAL', [L('KCUST', 'k1', 400), L('LOSS', 'k1', -400)], { reverses: loss }); ok(r.ok, 'exact mirror reversal posts');
r = await post('A', 'REVERSAL', [L('KCUST', 'k1', 400), L('LOSS', 'k1', -400)], { reverses: loss });
ok(!r.ok && /already reversed/.test(r.error), 'cannot reverse twice');
const rev = (await db.query("select id from kg_journal where type='REVERSAL'")).rows[0].id;
r = await post('A', 'REVERSAL', [L('KCUST', 'k1', -400), L('LOSS', 'k1', 400)], { reverses: rev });
ok(!r.ok && /reverse a reversal/.test(r.error), 'cannot reverse a reversal');
ok(await bal('A', 'LOSS', 'k1') === 0, 'loss account back to zero after reversal');

// 9 immutability
for (const [sql, label] of [
  ["update kg_journal set note='x'", 'update journal'], ['delete from kg_journal', 'delete journal'],
  ['update kg_journal_line set fine_mg = 1', 'update line'], ['delete from kg_journal_line', 'delete line'],
  ['truncate kg_journal_line', 'truncate lines']]) {
  let blocked = false; try { await db.exec(sql); } catch (e) { blocked = /immutable/.test(String(e.message)); }
  ok(blocked, label + ' is blocked');
}

// 10 tenant isolation
r = await post('B', 'ISSUE', [L('VAULT', '', -7), L('KCUST', 'k1', 7)], { op: 'op1' });
ok(r.ok && !r.duplicate, 'another shop may reuse the same op_id');
ok(await bal('B', 'KCUST', 'k1') === 7 && await bal('A', 'KCUST', 'k1') !== 7, 'balances never mix across shops');
r = await post('B', 'REVERSAL', [L('KCUST', 'k1', -100000), L('VAULT', '', 100000)], { reverses: first });
ok(!r.ok && /not found/.test(r.error), "a shop cannot reverse another shop's journal");

// 11 tracked vault cannot go negative
await db.query("insert into kg_shop_setting (shop_id, vault_tracked) values ('C', true)");
r = await post('C', 'OPENING', [L('VAULT', '', 50000), L('OPENING', '', -50000)]); ok(r.ok, 'opening vault balance posts');
r = await post('C', 'ISSUE', [L('VAULT', '', -60000), L('KCUST', 'k1', 60000)]);
ok(!r.ok && /negative/.test(r.error), 'tracked vault cannot issue more than it holds');
r = await post('C', 'ISSUE', [L('VAULT', '', -50000), L('KCUST', 'k1', 50000)]); ok(r.ok, 'issue up to the vault balance is fine');

// 12 labour lines are a separate table and never touch metal balances
r = await post('A', 'LABOUR_ACCRUE', [], { labour: [{ karigar_id: 'k1', amount_paise: 250000 }] });
ok(r.ok, 'labour-only journal (no metal lines) posts');
ok(Number((await db.query("select sum(amount_paise) s from kg_labour_line where karigar_id='k1'")).rows[0].s) === 250000, 'labour payable recorded in paise');

// 12b paged list / export shape, tenant isolation
const page1 = (await db.query('select kg_journal_list($1,0,3) j', ['A'])).rows[0].j;
ok(page1.length === 3 && page1[0].id < page1[1].id, 'list is paged and ordered');
ok(page1[0].lines.length === 2 && page1[0].lines[0].account && Number.isInteger(Number(page1[0].lines[0].fine_mg)), 'each journal carries its lines');
const page2 = (await db.query('select kg_journal_list($1,$2,100) j', ['A', page1[2].id])).rows[0].j;
ok(page2.length > 0 && page2[0].id > page1[2].id, 'list continues after a given id');
const all = (await db.query('select kg_journal_list($1,0,100000) j', ['A'])).rows[0].j;
const countA = Number((await db.query("select count(*) c from kg_journal where shop_id='A'")).rows[0].c);
ok(all.every(x => x.op_id) && all.length === countA, 'export returns every journal of the shop');
const labourJ = all.find(x => x.type === 'LABOUR_ACCRUE');
ok(labourJ && labourJ.labour.length === 1 && Number(labourJ.labour[0].amount_paise) === 250000 && labourJ.lines.length === 0, 'labour lines are exported separately');
ok((await db.query('select kg_journal_list($1,0,100) j', ['nobody'])).rows[0].j.length === 0, 'an unknown shop sees nothing');
ok(JSON.stringify(all).indexOf('shop_id') === -1, 'shop id is not echoed back');

// 13 permissions
for (const role of ['anon', 'authenticated']) {
  let denied = false;
  try { await db.exec(`set role ${role}; select * from kg_journal;`); } catch (e) { denied = true; }
  await db.exec('reset role');
  ok(denied, role + ' cannot read the ledger');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
