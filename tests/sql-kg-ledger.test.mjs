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
const MIG3 = fileURLToPath(new URL('../supabase/migrations/012_karigar_ledger_flag.sql', import.meta.url));
await db.exec(fs.readFileSync(MIG3, 'utf8'));           // 012: server-held ledger flag + owner-only labour
await db.exec(fs.readFileSync(MIG3, 'utf8'));           // idempotent too
const MIG4 = fileURLToPath(new URL('../supabase/migrations/014_history_anchor_and_accrual_owner_only.sql', import.meta.url));
await db.exec(fs.readFileSync(MIG4, 'utf8'));           // 014: entitlement accrual owner-only in the database
await db.exec(fs.readFileSync(MIG4, 'utf8'));
// Default business date = today by the SAME clock and zone 011 uses for its manager date window
// (now() at time zone 'Asia/Kolkata'), asked of the database itself, so it cannot drift from the rule.
// It was a fixed '2026-10-31', which stopped being inside the 7-day window on 8 Nov 2026.
const TEST_DAY = (await db.query("select ((now() at time zone 'Asia/Kolkata')::date)::text as d")).rows[0].d;
let failed = 0;
const ok =(c, m) => { if (!c) { failed++; console.log('FAIL', m); } else console.log('ok  ', m); };

let n = 0;
async function post(shop, type, lines, o = {}) {
  const op = o.op || ('op' + (++n));
  const r = await db.query(
    'select * from kg_post_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    [shop, op, type, ('job' in o ? o.job : 'J1'), o.voucher || null, o.reverses || null, o.date || TEST_DAY, o.note || '', 'tester', o.role || 'owner',
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
r = await post('A', 'TRANSFER_IN', [L('TRANSIT', 'TV1', -10000), L('KCUST', 'k2', 10000)], { voucher: 'TV1' });
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
r = await post('D', 'OPENING', [L('KCUST', 'k9', 2500), L('OPENING', '', -2500)]);
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
r = await post('H', 'ENTITLEMENT_ACCRUE', [L('ENT', 'kh', 100), L('EARNED', 'kh', -100)], { role: 'manager' });
ok(!r.ok && /owner/.test(r.error), '014 (6 Nov audit A3): a manager cannot record an entitlement accrual, in the database too');
r = await post('H', 'ENTITLEMENT_ACCRUE', [L('ENT', 'kh', 100), L('EARNED', 'kh', -100)]); ok(r.ok, 'D1: the owner accrues');
r = await post('H', 'ENTITLEMENT_SETTLE', [L('KCUST', 'kh', -300), L('PAYOUT', 'kh', 300), L('ENT', 'kh', -300), L('EARNED', 'kh', 300)], { role: 'manager' });
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
r = await post('H', 'LABOUR_PAY', [], { role: 'owner', labour: [{ karigar_id: 'kh', amount_paise: -300 }] }); ok(r.ok, 'audit2: a proper labour payment posts (owner, since 012)');

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


// ── 16 decisions D1/D2 after the second audit: accrual owner only, owner references, null safety ──
// the accrue-then-settle route: a manager cannot start it, so cannot empty a tracked vault or write off a karigar's custody
await db.query("insert into kg_shop_setting (shop_id, vault_tracked) values ('T', true)");
await post('T', 'OPENING', [L('VAULT', '', 10000), L('OPENING', '', -10000)]);
r = await post('T', 'ENTITLEMENT_ACCRUE', [L('ENT', 'kx', 10000), L('EARNED', 'kx', -10000)], { role: 'manager' });
ok(!r.ok && /owner/.test(r.error), '014: a manager accrual is refused (owner only)');
ok(await bal('T', 'VAULT', '') === 10000, 'D1: the tracked vault is untouched');
await post('U', 'ISSUE', [L('VAULT', '', -5000), L('KCUST', 'k1', 5000)]);
r = await post('U', 'ENTITLEMENT_ACCRUE', [L('ENT', 'k1', 5000), L('EARNED', 'k1', -5000)], { role: 'manager' });
ok(!r.ok && await bal('U', 'KCUST', 'k1') === 5000, '014: a refused manager accrual leaves custody untouched');
r = await post('U', 'ENTITLEMENT_ACCRUE', [L('ENT', 'k1', 2000), L('EARNED', 'k1', -2000)]); ok(r.ok, 'D1: owner accrues 2 g');
r = await post('U', 'ENTITLEMENT_SETTLE', [L('KCUST', 'k1', -2000), L('PAYOUT', 'k1', 2000), L('ENT', 'k1', -2000), L('EARNED', 'k1', 2000)], { role: 'manager' });
ok(r.ok, 'D1: a manager may settle what the owner accrued, from the karigar custody');
await post('U', 'ENTITLEMENT_ACCRUE', [L('ENT', 'k1', 1000), L('EARNED', 'k1', -1000)], { op: 'u-acc-2' });
r = await post('U', 'ENTITLEMENT_SETTLE', [L('VAULT', '', -1000), L('PAYOUT', 'k1', 1000), L('ENT', 'k1', -1000), L('EARNED', 'k1', 1000)], { role: 'manager' });
ok(r.ok, 'D1: a manager may settle what the owner accrued, from the vault');
const accId = (await db.query("select id from kg_journal where shop_id='U' and op_id='u-acc-2'")).rows[0].id;
r = await post('U', 'REVERSAL', [L('ENT', 'k1', -1000), L('EARNED', 'k1', 1000)], { reverses: accId, role: 'manager' });
ok(!r.ok && /owner/.test(r.error), '014: a manager cannot reverse an accrual');
await post('U', 'ENTITLEMENT_ACCRUE', [L('ENT', 'k1', 500), L('EARNED', 'k1', -500)], { op: 'u-acc-3' });
const accId3 = (await db.query("select id from kg_journal where shop_id='U' and op_id='u-acc-3'")).rows[0].id;
r = await post('U', 'REVERSAL', [L('ENT', 'k1', -500), L('EARNED', 'k1', 500)], { reverses: accId3, role: 'manager' });
ok(!r.ok && /owner/.test(r.error), '014: a manager cannot reverse a fresh accrual either');
r = await post('U', 'REVERSAL', [L('ENT', 'k1', -500), L('EARNED', 'k1', 500)], { reverses: accId3 });
ok(r.ok, '014: the owner can reverse an accrual (' + (r.ok ? 'posted' : r.error) + ')');

// D2a: owner references fit the account
await post('V', 'ISSUE', [L('VAULT', '', -3000), L('KCUST', 'k1', 3000)]);
r = await post('V', 'RETURN', [L('KCUST', 'k1', -1000), L('VAULT', 'hidden', 1000)], { role: 'manager' });
ok(!r.ok && /owner reference/.test(r.error), 'D2: metal cannot be parked under a made-up vault name');
r = await post('V', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', '', 1000)], { role: 'manager' });
ok(!r.ok && /owner reference/.test(r.error), 'D2: custody must name a karigar');
r = await post('V', 'OPENING', [L('VAULT', '', 100), L('OPENING', 'k1', -100)]);
ok(!r.ok && /owner reference/.test(r.error), 'D2: the OPENING account has no owner reference');

// D2c: a missing role or type is refused up front, not skipped
for (const [t, role, label] of [[null, 'owner', 'type'], ['ISSUE', null, 'role']]) {
  const q = await db.query('select * from kg_post_journal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
    ['V', 'nullchk-' + label, t, 'J1', null, null, ist(0), '', 'tester', role, null, '{}', JSON.stringify([L('VAULT', '', -1), L('KCUST', 'k1', 1)]), '[]']);
  ok(!q.rows[0].ok && /required/.test(q.rows[0].error), 'D2: a missing ' + label + ' is refused');
}


// ── 17 third audit, decisions D1 (reference rules) and D3 (reversal authority) ──
// D1: a karigar reference must be a plain id (letters, digits, _ and -): no spaces, no invisible characters
await db.query("insert into kg_shop_setting (shop_id, vault_tracked) values ('W', true)");
await post('W', 'OPENING', [L('VAULT', '', 20000), L('OPENING', '', -20000)]);
for (const [ref, label] of [['k1 ', 'trailing space'], [' ', 'a space'], ['K1​', 'zero-width space'], ['k 1', 'non-breaking space'], ['a/b', 'a slash']]) {
  r = await post('W', 'ISSUE', [L('VAULT', '', -100), L('KCUST', ref, 100)], { role: 'manager' });
  ok(!r.ok && /owner reference/.test(r.error), 'D1: karigar reference with ' + label + ' is refused');
}
r = await post('W', 'ISSUE', [L('VAULT', '', -100), L('KCUST', 'kar1730000000000123', 100)], { role: 'manager' });
ok(r.ok, 'D1: a real karigar id (kar + digits) is accepted');
r = await post('W', 'ISSUE', [L('VAULT', '', -100), L('KCUST', '3f2b8c1e-9a4d-4e6b-8f10-2c7d5a9e0b11', 100)], { role: 'manager', job: 'x' });
ok(r.ok, 'D1: a UUID karigar id is accepted');

// D1: scrap and loss name the same karigar as the custody they come out of
await post('W', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', 'ka', 1000)]);
r = await post('W', 'SCRAP', [L('KCUST', 'ka', -50), L('SCRAP', 'kb', 50)], { role: 'manager' });
ok(!r.ok && /same karigar/.test(r.error), 'D1: scrap cannot be booked against a different karigar');
r = await post('W', 'LOSS', [L('KCUST', 'ka', -50), L('LOSS', 'kb', 50)], { approved: 'owner1' });
ok(!r.ok && /same karigar/.test(r.error), 'D1: a loss cannot be booked against a different karigar');
r = await post('W', 'SCRAP', [L('KCUST', 'ka', -50), L('SCRAP', 'ka', 50)], { role: 'manager' }); ok(r.ok, 'D1: scrap for the same karigar posts');

// D1: a transit line belongs to its voucher
r = await post('W', 'TRANSFER_OUT', [L('KCUST', 'ka', -100), L('TRANSIT', '', 100)], { role: 'manager' });
ok(!r.ok && /voucher/.test(r.error), 'D1: a transfer into a blank transit pool is refused');
r = await post('W', 'TRANSFER_OUT', [L('KCUST', 'ka', -100), L('TRANSIT', 'TV9', 100)], { role: 'manager' });
ok(!r.ok && /voucher/.test(r.error), 'D1: a transfer with no voucher id is refused');
r = await post('W', 'TRANSFER_OUT', [L('KCUST', 'ka', -100), L('TRANSIT', 'TV9', 100)], { role: 'manager', voucher: 'TV9' }); ok(r.ok, 'D1: a transfer out with its voucher posts');
r = await post('W', 'TRANSFER_IN', [L('TRANSIT', 'TV9', -100), L('KCUST', 'kc', 100)], { role: 'manager', voucher: 'OTHER' });
ok(!r.ok && /voucher/.test(r.error), 'D1: a transfer in cannot name a different voucher than its transit line');
r = await post('W', 'TRANSFER_IN', [L('TRANSIT', 'TV9', -100), L('KCUST', 'kc', 100)], { role: 'manager', voucher: 'TV9' }); ok(r.ok, 'D1: the matching transfer in posts');

// D3: a reversal of anything that carries an approver needs the owner; ordinary journals can still be reversed by a manager
await post('K', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', 'kk', 1000)], { op: 'k-issue-1' });
r = await post('K', 'LOSS', [L('KCUST', 'kk', -100), L('LOSS', 'kk', 100)], { approved: 'owner1', op: 'k-loss-01' });
const kLoss = r.journal_id;
r = await post('K', 'REVERSAL', [L('KCUST', 'kk', 100), L('LOSS', 'kk', -100)], { reverses: kLoss, role: 'manager' });
ok(!r.ok && /owner/.test(r.error), 'D3: a manager cannot reverse an owner-approved loss');
r = await post('K', 'REVERSAL', [L('KCUST', 'kk', 100), L('LOSS', 'kk', -100)], { reverses: kLoss }); ok(r.ok, 'D3: the owner can reverse it');
const kIssue = (await db.query("select id from kg_journal where shop_id='K' and op_id='k-issue-1'")).rows[0].id;
r = await post('K', 'REVERSAL', [L('VAULT', '', 1000), L('KCUST', 'kk', -1000)], { reverses: kIssue, role: 'manager' });
ok(r.ok, 'D3: a manager can still reverse an ordinary journal that had no approver');


// ── 18 automated review of the pairing rule: it must be a universal check, not "one matching pair exists" ──
await post('X', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', 'k2', 1000)]);
await post('X', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', 'k1', 1000)]);
r = await post('X', 'SCRAP', [L('KCUST', 'k1', -50), L('SCRAP', 'k1', 50), L('KCUST', 'k2', -400), L('SCRAP', 'k3', 400)], { role: 'manager' });
ok(!r.ok && /exactly two/.test(r.error), 'pairing: a scrap with extra lines cannot move another karigar\'s custody into a third karigar\'s scrap');
r = await post('X', 'LOSS', [L('KCUST', 'k1', -50), L('LOSS', 'k1', 50), L('KCUST', 'k2', -400), L('LOSS', 'k3', 400)], { approved: 'owner1' });
ok(!r.ok && /exactly two/.test(r.error), 'pairing: the same for a loss');
r = await post('X', 'ISSUE', [L('VAULT', '', -1), L('VAULT', '', -1), L('KCUST', 'k1', 2)], { role: 'manager' });
ok(!r.ok && /exactly two/.test(r.error), 'pairing: a metal event is exactly two lines (extra lines are refused for every pair type)');
r = await post('X', 'RECEIPT', [L('KCUST', 'k1', -10), L('FG', 'J1', 5), L('FG', 'J2', 5)], { role: 'manager' });
ok(!r.ok && /exactly two/.test(r.error), 'pairing: a receipt cannot split into several jobs in one journal');
ok(await bal('X', 'KCUST', 'k2') === 1000 && await bal('X', 'SCRAP', 'k3') === 0, 'pairing: nothing moved');
r = await post('X', 'SCRAP', [L('KCUST', 'k1', -50), L('SCRAP', 'k1', 50)], { role: 'manager' }); ok(r.ok, 'pairing: the normal two-line scrap still posts');


// ── 19 finished goods belong to a job: a receipt names its job, and its FG line carries exactly that id ──
await post('Y', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', 'ky', 1000)]);
r = await post('Y', 'RECEIPT', [L('KCUST', 'ky', -100), L('FG', '', 100)], { role: 'manager' });
ok(!r.ok && /owner reference/.test(r.error), 'FG: finished goods with a blank owner are refused (no invisible bucket)');
r = await post('Y', 'RECEIPT', [L('KCUST', 'ky', -100), L('FG', 'J 1', 100)], { role: 'manager', job: 'J 1' });
ok(!r.ok && /owner reference/.test(r.error), 'FG: a job id with a space is refused');
r = await post('Y', 'RECEIPT', [L('KCUST', 'ky', -100), L('FG', 'J2', 100)], { role: 'manager', job: 'J1' });
ok(!r.ok && /job/.test(r.error), 'FG: the FG line must name the journal\'s own job');
r = await post('Y', 'RECEIPT', [L('KCUST', 'ky', -100), L('FG', 'J1', 100)], { role: 'manager', job: null });
ok(!r.ok && /job/.test(r.error), 'FG: a receipt with no job id is refused');
ok(await bal('Y', 'FG', 'J2') === 0 && await bal('Y', 'KCUST', 'ky') === 1000, 'FG: nothing moved');
r = await post('Y', 'RECEIPT', [L('KCUST', 'ky', -100), L('FG', 'J1', 100)], { role: 'manager', job: 'J1' });
ok(r.ok && await bal('Y', 'FG', 'J1') === 100, 'FG: a proper receipt for its job posts');
r = await post('Y', 'RECEIPT', [L('KCUST', 'ky', -50), L('FG', '3f2b8c1e-9a4d-4e6b-8f10-2c7d5a9e0b11', 50)], { role: 'manager', job: '3f2b8c1e-9a4d-4e6b-8f10-2c7d5a9e0b11' });
ok(r.ok, 'FG: a UUID job id (what the app generates) posts');

// ── 20 the migr: op_id namespace belongs to the owner's opening balances (nobody can pre-empt a migration id) ──
r = await post('Z', 'ISSUE', [L('VAULT', '', -100), L('KCUST', 'kz', 100)], { role: 'manager', op: 'migr:karZ1' });
ok(!r.ok && /reserved/.test(r.error), 'migr: a manager cannot take a migr: op_id with an ordinary journal');
r = await post('Z', 'OPENING', [L('KCUST', 'karZ1', 100), L('OPENING', '', -100)], { role: 'manager', op: 'migr:karZ1' });
ok(!r.ok, 'migr: a manager cannot post OPENING at all');
r = await post('Z', 'ISSUE', [L('VAULT', '', -100), L('KCUST', 'kz', 100)], { role: 'owner', op: 'migr:karZ1' });
ok(!r.ok && /reserved/.test(r.error), 'migr: even the owner may use migr: only for OPENING');
r = await post('Z', 'OPENING', [L('KCUST', 'karZ1', 100), L('OPENING', '', -100)], { role: 'owner', op: 'migr:karZ1' });
ok(r.ok && await bal('Z', 'KCUST', 'karZ1') === 100, 'migr: an owner opening balance posts under its migr: id');
r = await post('Z', 'OPENING', [L('KCUST', 'karZ1', 100), L('OPENING', '', -100)], { role: 'owner', op: 'migr:karZ1' });
ok(r.ok && r.duplicate, 'migr: a rerun is a duplicate, nothing new');

// ── 21 an old row under a migr: id (posted before the reservation existed) is never reported as an opening balance ──
await db.query("insert into kg_journal(shop_id, op_id, type, business_date, by_user, by_role) values ('Z','migr:legacy01','ISSUE','" + TEST_DAY + "','old','manager')");
r = await post('Z', 'OPENING', [L('KCUST', 'legacy01', 100), L('OPENING', '', -100)], { role: 'owner', op: 'migr:legacy01' });
ok(!r.ok && /reserved/.test(r.error), 'migr: an existing non-OPENING row under a migr: id is refused, not reported as a duplicate');
r = await post('Z', 'ISSUE', [L('VAULT', '', -100), L('KCUST', 'kz', 100)], { role: 'manager', op: 'migr:legacy01' });
ok(!r.ok && /reserved/.test(r.error), 'migr: a manager re-sending that id is refused as reserved');

// ── 012: the ledger flag is held by the server, not the shop data ─────────────────────────
r = (await db.query("select kg_ledger_status('F1') as on")).rows[0]; ok(r.on === false, '012: a shop with no row has the ledger off');
await db.query("select kg_set_ledger('F1', true, 'owner-user')");
r = (await db.query("select kg_ledger_status('F1') as on")).rows[0]; ok(r.on === true, '012: owner switched it on');
r = (await db.query("select kg_ledger_status('F2') as on")).rows[0]; ok(r.on === false, '012: another shop is unaffected');
await db.query("select kg_set_ledger('F1', false, 'owner-user')");
r = (await db.query("select kg_ledger_status('F1') as on")).rows[0]; ok(r.on === false, '012: and off again');
ok(await count('kg_ledger_flag') === 1, '012: one row per shop, updated in place');
for (const t of ['kg_ledger_flag']) {
  const g = (await db.query("select has_table_privilege('anon', $1, 'select') a, has_table_privilege('authenticated', $1, 'select') b", [t])).rows[0];
  ok(!g.a && !g.b, '012: the flag table is closed to anon and authenticated');
}
r = await post('L', 'LABOUR_ACCRUE', [], { role: 'manager', labour: [{ karigar_id: 'kl', amount_paise: 1000 }] });
ok(!r.ok && /owner/.test(r.error), '012: a manager cannot accrue labour (database layer): ' + r.error);
r = await post('L', 'LABOUR_PAY', [], { role: 'manager', labour: [{ karigar_id: 'kl', amount_paise: -100 }] });
ok(!r.ok && /owner/.test(r.error), '012: a manager cannot pay labour');
r = await post('L', 'LABOUR_ACCRUE', [], { role: 'owner', labour: [{ karigar_id: 'kl', amount_paise: 1000 }] });
ok(r.ok, '012: the owner can accrue labour'); const lj12 = r.journal_id;
r = await post('L', 'REVERSAL', [], { role: 'manager', reverses: lj12, labour: [{ karigar_id: 'kl', amount_paise: -1000 }] });
ok(!r.ok && /owner/.test(r.error), '012: a manager cannot reverse a labour journal');
r = await post('L', 'REVERSAL', [], { role: 'owner', reverses: lj12, labour: [{ karigar_id: 'kl', amount_paise: -1000 }] });
ok(r.ok, '012: the owner can reverse it');
r = await post('L', 'ISSUE', [L('VAULT', '', -5), L('KCUST', 'kl', 5)], { role: 'manager' });
ok(r.ok, '012: a manager can still post gold entries');
const ymd = (d) => new Date(Date.now() + 5.5 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
// (r is declared above)
// 20 client builders (js/12-karigar-data.js) vs the per-type account table: post what the real client builds
import { createRequire } from 'module';
const app = createRequire(import.meta.url)('./harness.js').loadApp();
const bj = async (shop, type, o, role, extra = {}) => {
  o.opId = 'cb' + (++n); o.date = ymd(0);
  const b = app.kgBuildJournal(type, o);
  if (!b.journal) return { ok: false, error: 'builder: ' + b.error };
  const j = b.journal;
  return post(shop, type, j.lines, { op: j.op_id, job: j.job_id, voucher: j.voucher_id, date: j.business_date, role, labour: j.labour, ...extra });
};
for (const role of ['owner', 'manager']) {
  const S = 'CB-' + role;
  await post(S, 'OPENING', [L('VAULT', '', 500000), L('OPENING', '', -500000)], { role: 'owner' });
  for (const [t, o, extra] of [
    ['ISSUE', { karigarId: 'k1', fineMg: 100000, jobId: 'J1' }], ['RETURN', { karigarId: 'k1', fineMg: 5000 }],
    ['RECEIPT', { karigarId: 'k1', jobId: 'J1', fineMg: 40000 }], ['SCRAP', { karigarId: 'k1', fineMg: 3000 }],
    ['LOSS', { karigarId: 'k1', fineMg: 400 }, { approved: 'owner' }],
    ['TRANSFER_OUT', { karigarId: 'k1', voucherId: 'TV1', fineMg: 10000 }], ['TRANSFER_IN', { toKarigarId: 'k2', voucherId: 'TV1', fineMg: 10000 }],
    ['ENTITLEMENT_ACCRUE', { karigarId: 'k1', fineMg: 4000 }], ['ENTITLEMENT_SETTLE', { karigarId: 'k1', fineMg: 2000 }],
    ['ENTITLEMENT_SETTLE', { karigarId: 'k1', fineMg: 2000, from: 'vault' }],
    ['LABOUR_ACCRUE', { karigarId: 'k1', amountPaise: 90000 }], ['LABOUR_PAY', { karigarId: 'k1', amountPaise: 30000 }]]) {
    r = await bj(S, t, { ...o }, role, extra);
    if (role === 'manager' && t === 'ENTITLEMENT_ACCRUE') { ok(!r.ok && /owner/.test(r.error), role + ': client ENTITLEMENT_ACCRUE refused by the ledger (owner only)'); r = await bj(S, t, { ...o }, 'owner', extra); ok(r.ok, role + ': the owner posts the accrual the settles need'); continue; }
    if (role === 'manager' && /^LABOUR_/.test(t)) { ok(!r.ok && /owner/.test(r.error), role + ': client ' + t + ' refused by the ledger (labour is owner only)'); continue; }
    ok(r.ok, role + ': client ' + t + (o.from ? ' from vault' : '') + ' accepted by the ledger' + (r.ok ? '' : ' (' + r.error + ')'));
  }
  ok(await bal(S, 'VAULT', '') === 500000 - 100000 + 5000 - 2000, role + ': vault moved only by issue, return, vault settle');
  ok(await bal(S, 'ENT', 'k1') === 0 + 4000 - 2000 - 2000, role + ': settle (both sources) cleared the claim');
  // reversal of every journal shape, built from the server-shaped list, incl. labour
  const all2 = (await db.query('select kg_journal_list($1,0,1000) j', [S])).rows[0].j.filter(x => !['OPENING', 'REVERSAL'].includes(x.type));
  for (const orig of all2) {
    const rb = app.kgBuildReversal(orig, 'cr' + (++n), 'client test reversal', ymd(0));
    r = await post(S, 'REVERSAL', rb.journal.lines, { op: rb.journal.op_id, reverses: orig.id, date: ymd(0), role, labour: rb.journal.labour, job: orig.job_id, voucher: orig.voucher_id });
    ok(r.ok || /negative/.test(r.error) || (role === 'manager' && (orig.type === 'LOSS' || orig.type === 'ENTITLEMENT_ACCRUE') && /owner/.test(r.error)), role + ': client reversal of ' + orig.type + ' shape accepted (' + (r.ok ? 'posted' : r.error) + ')');
  }
}
// LOSS: manager without approver refused even when built by the client
r = await bj('CB-manager', 'LOSS', { karigarId: 'k1', fineMg: 1 }, 'manager');
ok(!r.ok && /approval/.test(r.error), 'client LOSS with no approver is refused');


console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);

