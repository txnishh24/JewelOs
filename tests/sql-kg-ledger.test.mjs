// Runs supabase/migrations/010_karigar_ledger.sql against real Postgres (PGlite, in-process).
// @electric-sql/pglite is a devDependency: npm install, then npm run test:sql
// Optional argv[2]: path to the migration (to test a different copy).
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { fileURLToPath } from 'url';
const MIG = process.argv[2] || fileURLToPath(new URL('../supabase/migrations/010_karigar_ledger.sql', import.meta.url));
const MIG2 = fileURLToPath(new URL('../supabase/migrations/011_karigar_ledger_hardening.sql', import.meta.url));
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
await db.exec(fs.readFileSync(MIG, 'utf8'));
await db.exec(fs.readFileSync(MIG, 'utf8'));            // idempotent: second run must not fail
await db.exec(fs.readFileSync(MIG2, 'utf8'));           // 011 replaces kg_post_journal (hardening)
await db.exec(fs.readFileSync(MIG2, 'utf8'));           // and is idempotent too
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

let n = 0;
async function post(shop, type, lines, o = {}) {
  const op = o.op || ('op' + (++n));
  const r = await db.query(
    'select * from kg_post_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [shop, op, type, o.job || 'J1', o.voucher || null, o.reverses || null, o.date || '2026-10-31', o.note || '', 'tester', o.role || 'owner',
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

// ── 14 Task 2.5 hardening (migration 011) ─────────────────────────────
const ist = (off = 0) => new Date(Date.now() + 5.5 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);

// F1: the journal TYPE decides which accounts a journal may touch, and who may touch the owner-only ones
r = await post('D', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', 'kd', 1000)]); ok(r.ok, 'D: seed issue');
let jD = await count('kg_journal');
r = await post('D', 'RECEIPT', [L('KCUST', 'kd', 500), L('ADJ', 'kd', -500)], { role: 'manager' });
ok(!r.ok && /not allowed/.test(r.error), 'F1: a manager cannot mint custody through ADJ lines under a RECEIPT');
r = await post('D', 'RECEIPT', [L('KCUST', 'kd', 500), L('OPENING', '', -500)], { role: 'manager' });
ok(!r.ok && /not allowed/.test(r.error), 'F1: a manager cannot mint custody through OPENING lines under a RECEIPT');
r = await post('D', 'ISSUE', [L('VAULT', '', 1000), L('KCUST', 'kd', -1000)]);
ok(!r.ok && /not allowed/.test(r.error), 'F1: right accounts, wrong direction is refused (a balanced journal is not enough)');
r = await post('D', 'ADJUST', [L('KCUST', 'kd', 500), L('ADJ', 'kd', -500)], { role: 'manager' });
ok(!r.ok && /owner/.test(r.error), 'F1: ADJUST is owner only inside the database, not just in store-proxy');
r = await post('D', 'OPENING', [L('KCUST', 'kd', 500), L('OPENING', 'kd', -500)], { role: 'manager' });
ok(!r.ok && /owner/.test(r.error), 'F1: OPENING is owner only inside the database');
ok(await count('kg_journal') === jD, 'F1: no refused journal left a row');
r = await post('D', 'OPENING', [L('KCUST', 'k9', 2500), L('OPENING', 'k9', -2500)]);
ok(r.ok, 'D3: owner can post a karigar opening balance (KCUST against OPENING)');
ok(await bal('D', 'KCUST', 'k9') === 2500 && await bal('D', 'ADJ', 'k9') === 0, 'D3: an opening balance does not touch the ADJ account');
r = await post('D', 'ADJUST', [L('KCUST', 'k9', -500), L('ADJ', 'k9', 500)]); ok(r.ok, 'owner ADJUST (either direction) still posts');
const adjId = (await db.query("select id from kg_journal where shop_id='D' and type='ADJUST'")).rows[0].id;
r = await post('D', 'REVERSAL', [L('KCUST', 'k9', 500), L('ADJ', 'k9', -500)], { reverses: adjId, role: 'manager' });
ok(!r.ok && /owner/.test(r.error), 'F1: a manager cannot reverse an owner adjustment');

// F3: a loss needs an approver
r = await post('D', 'LOSS', [L('KCUST', 'kd', -100), L('LOSS', 'kd', 100)]);
ok(!r.ok && /approv/.test(r.error), 'F3: a LOSS with no approver is refused');
r = await post('D', 'LOSS', [L('KCUST', 'kd', -100), L('LOSS', 'kd', 100)], { approved: 'owner1' }); ok(r.ok, 'F3: an approved LOSS posts');

// F2: only the ledger's own refusals are answered; any other database error must propagate, not become a refusal
await db.exec(`create function kg_test_boom() returns trigger language plpgsql as $f$ begin
  if new.owner_ref = 'boom' then raise exception 'simulated serialization failure' using errcode = '40001'; end if; return new; end $f$;
  create trigger kg_test_boom before insert on kg_journal_line for each row execute function kg_test_boom();`);
let jBefore = await count('kg_journal'), thrown = null;
try { await post('D', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'boom', 10)]); } catch (e) { thrown = e; }
ok(thrown && /simulated/.test(String(thrown.message)), 'F2: a transient database error propagates instead of becoming a permanent refusal');
ok(await count('kg_journal') === jBefore, 'F2: and nothing was written');
await db.exec('drop trigger kg_test_boom on kg_journal_line; drop function kg_test_boom();');
r = await post('D', 'ISSUE', [{ account: 'VAULT', owner_ref: '', fine_mg: 'abc' }, L('KCUST', 'kd', 1)]);
ok(!r.ok && /malformed/.test(r.error), 'F2: a malformed line is a clear refusal, not a raw database error');
r = await post('D', 'RECEIPT', [L('KCUST', 'kd', -999999999), L('FG', 'J1', 999999999)]);
ok(!r.ok && /negative/.test(r.error) && !/P0001|KG001|sqlstate/i.test(r.error), 'F2: a business refusal still returns its plain message');

// D8: a reversal mirrors labour as well as metal
r = await post('E', 'LABOUR_ACCRUE', [], { labour: [{ karigar_id: 'ke1', amount_paise: 1000 }] });
const lj = r.journal_id;
r = await post('E', 'REVERSAL', [], { reverses: lj });
ok(!r.ok && /labour/.test(r.error), 'D8: a reversal with no labour lines does not cancel the labour');
r = await post('E', 'REVERSAL', [], { reverses: lj, labour: [{ karigar_id: 'ke1', amount_paise: 1000 }] });
ok(!r.ok && /labour/.test(r.error), 'D8: labour that is not the exact negation is refused');
r = await post('E', 'REVERSAL', [], { reverses: lj, labour: [{ karigar_id: 'ke1', amount_paise: -1000 }, { karigar_id: 'ke1', amount_paise: 5 }] });
ok(!r.ok && /labour/.test(r.error), 'D8: extra labour lines on a reversal are refused');
r = await post('E', 'REVERSAL', [], { reverses: lj, labour: [{ karigar_id: 'ke1', amount_paise: -1000 }] });
ok(r.ok, 'D8: the exact labour mirror posts');
ok(Number((await db.query("select coalesce(sum(amount_paise),0) s from kg_labour_line where karigar_id='ke1'")).rows[0].s) === 0, 'D8: labour nets to zero after the reversal');

// D9: re-sending an op_id with different content is a loud refusal, an identical resend is still a quiet duplicate
r = await post('F', 'ISSUE', [L('VAULT', '', -100), L('KCUST', 'kf', 100)], { op: 'fp-op-1' }); ok(r.ok && !r.duplicate, 'D9: first post');
r = await post('F', 'ISSUE', [L('VAULT', '', -100), L('KCUST', 'kf', 100)], { op: 'fp-op-1' }); ok(r.ok && r.duplicate, 'D9: identical resend is a duplicate');
r = await post('F', 'ISSUE', [L('VAULT', '', -200), L('KCUST', 'kf', 200)], { op: 'fp-op-1' });
ok(!r.ok && /different content/.test(r.error), 'D9: same op_id with different amounts is refused, not reported as a duplicate');
ok(await bal('F', 'KCUST', 'kf') === 100, 'D9: and the ledger still holds the original amount');

// D10: managers are limited to today (IST) back 7 days; the owner is not
await post('G', 'ISSUE', [L('VAULT', '', -100), L('KCUST', 'kg', 100)], { date: ist(0), op: 'g-seed-01' });
r = await post('G', 'SCRAP', [L('KCUST', 'kg', -1), L('SCRAP', 'kg', 1)], { role: 'manager', date: ist(1) });
ok(!r.ok && /date/.test(r.error), 'D10: a manager cannot post a future date');
r = await post('G', 'SCRAP', [L('KCUST', 'kg', -1), L('SCRAP', 'kg', 1)], { role: 'manager', date: ist(-8) });
ok(!r.ok && /date/.test(r.error), 'D10: a manager cannot post more than 7 days back');
r = await post('G', 'SCRAP', [L('KCUST', 'kg', -1), L('SCRAP', 'kg', 1)], { role: 'manager', date: ist(-7) }); ok(r.ok, 'D10: 7 days back is allowed');
r = await post('G', 'SCRAP', [L('KCUST', 'kg', -1), L('SCRAP', 'kg', 1)], { role: 'manager', date: ist(0) }); ok(r.ok, 'D10: today is allowed');
r = await post('G', 'SCRAP', [L('KCUST', 'kg', -1), L('SCRAP', 'kg', 1)], { role: 'owner', date: ist(-30) }); ok(r.ok, 'D10: the owner may back-date');

// ── 15 audit follow-up (4 Nov): settlement shape, labour template, cross-shop reverses_id, fingerprint, empty journals ──
// a manager must not be able to write off custody or empty a tracked vault through an ENTITLEMENT_SETTLE
await post('H', 'ISSUE', [L('VAULT', '', -50000), L('KCUST', 'kh', 50000)]);
r = await post('H', 'ENTITLEMENT_SETTLE', [L('KCUST', 'kh', -20000), L('PAYOUT', 'kh', 20000)], { role: 'manager' });
ok(!r.ok && /settlement/.test(r.error), 'audit1: a settlement without ENT/EARNED cannot write off custody');
r = await post('H', 'ENTITLEMENT_SETTLE', [L('KCUST', 'kh', -1000), L('EARNED', 'zz', 1000)], { role: 'manager' });
ok(!r.ok && /settlement/.test(r.error), 'audit1: a settlement that pays nobody is refused');
r = await post('H', 'ENTITLEMENT_SETTLE', [L('ENT', 'kh', -7), L('PAYOUT', 'kh', 7)], { role: 'manager' });
ok(!r.ok && /settlement/.test(r.error), 'audit1: ENT cannot be driven negative by a two-line settlement');
r = await post('H', 'ENTITLEMENT_SETTLE', [L('KCUST', 'kh', -500), L('PAYOUT', 'kh', 500), L('ENT', 'kx', -500), L('EARNED', 'kh', 500)], { role: 'manager' });
ok(!r.ok && /settlement/.test(r.error), 'audit1: a settlement must be for one karigar');
r = await post('H', 'ENTITLEMENT_ACCRUE', [L('ENT', 'kh', 100), L('EARNED', 'zz', -100)], { role: 'manager' });
ok(!r.ok && /one karigar/.test(r.error), 'audit1: an accrual must clear against the same karigar');
r = await post('H', 'ENTITLEMENT_ACCRUE', [L('ENT', 'kh', 100), L('EARNED', 'kh', -100)], { role: 'manager' }); ok(r.ok, 'audit1: a proper accrual posts');
r = await post('H', 'ENTITLEMENT_SETTLE', [L('KCUST', 'kh', -200), L('PAYOUT', 'kh', 200), L('ENT', 'kh', -200), L('EARNED', 'kh', 200)], { role: 'manager' });
ok(!r.ok && /negative/.test(r.error), 'audit1: a settlement cannot pay out more than was accrued (ENT never below zero)');
r = await post('H', 'ENTITLEMENT_SETTLE', [L('KCUST', 'kh', -100), L('PAYOUT', 'kh', 100), L('ENT', 'kh', -100), L('EARNED', 'kh', 100)], { role: 'manager' });
ok(r.ok, 'audit1: a settlement up to the accrued amount posts');
await db.query("insert into kg_shop_setting (shop_id, vault_tracked) values ('I', true)");
await post('I', 'OPENING', [L('VAULT', '', 9000), L('OPENING', '', -9000)]);
r = await post('I', 'ENTITLEMENT_SETTLE', [L('VAULT', '', -9000), L('PAYOUT', 'x', 9000)], { role: 'manager' });
ok(!r.ok && /settlement/.test(r.error) && await bal('I', 'VAULT', '') === 9000, 'audit1: a manager cannot empty a tracked vault through a settlement');

// labour lines must fit the journal type and direction
r = await post('H', 'LABOUR_PAY', [], { role: 'manager', labour: [{ karigar_id: 'kh', amount_paise: 999999 }] });
ok(!r.ok && /labour/.test(r.error), 'audit2: LABOUR_PAY must reduce what is owed (negative)');
r = await post('H', 'LABOUR_ACCRUE', [], { role: 'manager', labour: [{ karigar_id: 'kh', amount_paise: -5 }] });
ok(!r.ok && /labour/.test(r.error), 'audit2: LABOUR_ACCRUE must add to what is owed (positive)');
r = await post('H', 'ISSUE', [L('VAULT', '', -1), L('KCUST', 'kh', 1)], { role: 'manager', labour: [{ karigar_id: 'kh', amount_paise: -5000 }] });
ok(!r.ok && /labour/.test(r.error), 'audit2: a metal journal cannot carry labour lines (no quiet erasing of a payable)');
r = await post('H', 'LABOUR_ACCRUE', [], { role: 'manager', labour: [] });
ok(!r.ok && /labour/.test(r.error), 'audit2: a labour journal with no labour is refused');
r = await post('H', 'LABOUR_PAY', [], { role: 'manager', labour: [{ karigar_id: 'kh', amount_paise: -300 }] }); ok(r.ok, 'audit2: a proper labour payment posts');

// only a reversal may name a journal, enforced in the database
const anyA = (await db.query("select id from kg_journal where shop_id='A' limit 1")).rows[0].id;
r = await post('B', 'LABOUR_ACCRUE', [], { reverses: anyA, labour: [{ karigar_id: 'kb', amount_paise: 1 }] });
ok(!r.ok && /reverse/.test(r.error), 'audit6: a non-reversal cannot name a journal (so it cannot use up another shop\'s reversal slot)');

// the fingerprint is unambiguous about where one field ends
r = await post('J', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'kj', 10)], { op: 'fp-sep-01', job: 'a|b' }); ok(r.ok, 'audit5: seed');
r = await post('J', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'kj', 10)], { op: 'fp-sep-01', job: 'a', voucher: 'b|' });
ok(!r.ok && /different content/.test(r.error), 'audit5: job a|b and job a + voucher b| are different content');

// an empty metal journal is not a journal
r = await post('J', 'ISSUE', []);
ok(!r.ok && /at least one line/.test(r.error), 'a metal journal with no lines is refused');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
