// Runs supabase/migrations/010_karigar_ledger.sql against real Postgres (PGlite, in-process).
// Run: npm run test:sql  (pglite is a devDependency)
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

// ── Task 2.5: security rules inside kg_post_journal ──────────────────
const ymd = (d) => new Date(Date.now() + 5.5 * 3600e3 + d * 86400e3).toISOString().slice(0, 10);
const jcount = async () => count('kg_journal');
let before = await jcount();

// 14 finding 1: the type label alone must not let a manager mint metal
r = await post('M', 'RECEIPT', [L('KCUST', 'k1', 5000), L('ADJ', 'k1', -5000)], { role: 'manager', date: ymd(0) });
ok(!r.ok && /owner only|not allowed/.test(r.error), 'manager cannot post ADJ lines under a RECEIPT label');
r = await post('M', 'REVERSAL', [L('KCUST', 'k1', 5000), L('OPENING', '', -5000)], { role: 'manager', date: ymd(0), reverses: first });
ok(!r.ok, 'manager cannot post OPENING lines under a REVERSAL label');
r = await post('M', 'ADJUST', [L('KCUST', 'k1', 5000), L('ADJ', 'k1', -5000)], { role: 'manager', date: ymd(0) });
ok(!r.ok && /owner only/.test(r.error), 'manager cannot post ADJUST');
r = await post('M', 'ISSUE', [L('VAULT', '', -10), L('PAYOUT', 'k1', 10)], { role: 'manager', date: ymd(0) });
ok(!r.ok && /not allowed/.test(r.error), 'an account that does not belong to the type is refused');
r = await post('M', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'k1', 10)], { role: 'manager', date: ymd(0), labour: [{ karigar_id: 'k1', amount_paise: 5 }] });
ok(!r.ok && /labour not allowed/.test(r.error), 'labour on a metal type is refused');
r = await post('M', 'LABOUR_ACCRUE', [L('VAULT', '', -10), L('KCUST', 'k1', 10)], { role: 'manager', date: ymd(0), labour: [{ karigar_id: 'k1', amount_paise: 5 }] });
ok(!r.ok && /not allowed/.test(r.error), 'metal lines on a labour type are refused');
ok(await jcount() === before, 'refused journals left no rows');
r = await post('M', 'ADJUST', [L('KCUST', 'k1', 5000), L('ADJ', 'k1', -5000)], { role: 'owner' });
ok(r.ok, 'owner may adjust');
r = await post('M', 'OPENING', [L('KCUST', 'k9', 7000), L('OPENING', '', -7000)], { role: 'owner' });
ok(r.ok, 'owner may open a karigar balance (OPENING with KCUST)');

// 15 finding 2: only ledger refusals are answers; other faults propagate with no raw text in a row
let threw = false;
try { await post('M', 'ISSUE', [L('VAULT', '', 'abc'), L('KCUST', 'k1', 'abc')], { role: 'manager', date: ymd(0) }); } catch (e) { threw = true; }
ok(threw, 'a non-business fault propagates instead of becoming a refusal row');
ok(await jcount() === before + 2, 'and writes nothing');

// 16 finding 3: LOSS needs an approver
r = await post('A', 'LOSS', [L('KCUST', 'k1', -1), L('LOSS', 'k1', 1)]);
ok(!r.ok && /approval/.test(r.error), 'LOSS without approver refused');

// 17 D8: reversal must mirror labour
r = await post('A', 'LABOUR_PAY', [], { labour: [{ karigar_id: 'k5', amount_paise: -30000 }] });
const lp = r.journal_id;
r = await post('A', 'REVERSAL', [], { reverses: lp });
ok(!r.ok && /labour/.test(r.error), 'labour-only reversal with no labour refused');
r = await post('A', 'REVERSAL', [], { reverses: lp, labour: [{ karigar_id: 'k5', amount_paise: 29999 }] });
ok(!r.ok && /labour/.test(r.error), 'labour reversal with the wrong amount refused');
r = await post('A', 'REVERSAL', [], { reverses: lp, labour: [{ karigar_id: 'k5', amount_paise: 30000 }] });
ok(r.ok, 'exact labour mirror reverses');

// 18 D9: op_id reuse with different content is a conflict; identical is a duplicate
r = await post('A', 'ISSUE', [L('VAULT', '', -1000), L('KCUST', 'k7', 1000)], { op: 'fpop' }); ok(r.ok, 'fingerprint journal posts');
r = await post('A', 'ISSUE', [L('KCUST', 'k7', 1000), L('VAULT', '', -1000)], { op: 'fpop' });
ok(r.ok && r.duplicate, 'identical resend (any line order) is a duplicate');
r = await post('A', 'ISSUE', [L('VAULT', '', -1001), L('KCUST', 'k7', 1001)], { op: 'fpop' });
ok(!r.ok && !r.duplicate && /different content/.test(r.error), 'same op_id with a different weight is a conflict');

// 19 D10: manager date window; owner unlimited
r = await post('M', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'k1', 10)], { role: 'manager', date: ymd(1) });
ok(!r.ok && /date/.test(r.error), 'manager cannot post a future date');
r = await post('M', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'k1', 10)], { role: 'manager', date: ymd(-8) });
ok(!r.ok && /date/.test(r.error), 'manager cannot post 8 days back');
r = await post('M', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'k1', 10)], { role: 'manager', date: ymd(-7) });
ok(r.ok, 'manager may post 7 days back');
r = await post('M', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'k1', 10)], { role: 'manager', date: ymd(0) });
ok(r.ok, 'manager may post today');
r = await post('M', 'ISSUE', [L('VAULT', '', -10), L('KCUST', 'k1', 10)], { role: 'owner', date: '2020-01-01' });
ok(r.ok, 'owner has no date limit');

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
    ok(r.ok, role + ': client ' + t + (o.from ? ' from vault' : '') + ' accepted by the ledger' + (r.ok ? '' : ' (' + r.error + ')'));
  }
  ok(await bal(S, 'VAULT', '') === 500000 - 100000 + 5000 - 2000, role + ': vault moved only by issue, return, vault settle');
  ok(await bal(S, 'ENT', 'k1') === 0 + 4000 - 2000 - 2000, role + ': settle (both sources) cleared the claim');
  // reversal of every journal shape, built from the server-shaped list, incl. labour
  const all2 = (await db.query('select kg_journal_list($1,0,1000) j', [S])).rows[0].j.filter(x => !['OPENING', 'REVERSAL'].includes(x.type));
  for (const orig of all2) {
    const rb = app.kgBuildReversal(orig, 'cr' + (++n), 'client test reversal', ymd(0));
    r = await post(S, 'REVERSAL', rb.journal.lines, { op: rb.journal.op_id, reverses: orig.id, date: ymd(0), role, labour: rb.journal.labour, job: orig.job_id, voucher: orig.voucher_id });
    ok(r.ok || /negative/.test(r.error), role + ': client reversal of ' + orig.type + ' shape accepted (' + (r.ok ? 'posted' : r.error) + ')');
  }
}
// LOSS: manager without approver refused even when built by the client
r = await bj('CB-manager', 'LOSS', { karigarId: 'k1', fineMg: 1 }, 'manager');
ok(!r.ok && /approval/.test(r.error), 'client LOSS with no approver is refused');

// 21 auditor bypasses (4 Nov): sign/shape per type, one-to-one reversal mirror
const mgr = { role: 'manager', date: ymd(0) };
r = await post('P', 'ENTITLEMENT_SETTLE', [L('VAULT', '', 50000), L('EARNED', 'x', -50000)], mgr);
ok(!r.ok, 'SETTLE with a gaining vault and negative EARNED (mints vault metal) refused');
r = await post('P', 'ENTITLEMENT_SETTLE', [L('KCUST', 'k9', 7000), L('PAYOUT', 'k9', -7000)], mgr);
ok(!r.ok, 'SETTLE that books custody against a negative PAYOUT refused');
r = await post('P', 'ISSUE', [L('VAULT', '', 10), L('KCUST', 'k1', -10)], mgr);
ok(!r.ok, 'ISSUE with flipped signs refused');
r = await post('P', 'ISSUE', [L('VAULT', '', -10000), L('KCUST', 'k1', 5000), L('KCUST', 'k1', 5000)], mgr);
ok(r.ok, 'issue with two identical lines posts');
r = await post('P', 'REVERSAL', [L('VAULT', '', 10000), L('KCUST', 'k1', -5000), L('EARNED', 'k1', -5000)], { ...mgr, reverses: r.journal_id });
ok(!r.ok && /mirror/.test(r.error), 'reversal that swaps one of two identical lines for another account refused');
await post('P', 'LABOUR_ACCRUE', [], { ...mgr, labour: [{ karigar_id: 'a', amount_paise: 100 }, { karigar_id: 'a', amount_paise: 100 }] });
const lj = (await db.query("select max(id) m from kg_journal where shop_id='P'")).rows[0].m;
r = await post('P', 'REVERSAL', [], { ...mgr, reverses: lj, labour: [{ karigar_id: 'a', amount_paise: -100 }, { karigar_id: 'zzz', amount_paise: -100 }] });
ok(!r.ok && /labour/.test(r.error), 'labour reversal with a different karigar in a duplicate slot refused');
r = await post('P', 'LOSS', [L('KCUST', 'k1', 1), L('LOSS', 'k1', -1)], { ...mgr, approved: 'o' });
ok(!r.ok, 'LOSS with flipped signs (negative LOSS accumulator) refused');
r = await post('P', 'ISSUE', [L('VAULT', '', -5), L('KCUST', 'k2', 5)], { ...mgr, op: 'jobop', job: 'JA' });
r = await post('P', 'ISSUE', [L('VAULT', '', -5), L('KCUST', 'k2', 5)], { ...mgr, op: 'jobop', job: 'JB' });
ok(!r.ok && /different content/.test(r.error), 'same op_id with a different job is a conflict');

// 22 Opus re-audit holes (4 Nov): settle pairing, separator injection, labour signs
r = await post('Q', 'ENTITLEMENT_SETTLE', [L('KCUST', 'k1', -3000), L('PAYOUT', 'k1', 3000)], mgr);
ok(!r.ok, 'settle without ENT/EARNED legs (an unapproved loss) refused');
r = await post('Q', 'ENTITLEMENT_SETTLE', [L('VAULT', '', -2000), L('EARNED', 'x', 2000)], mgr);
ok(!r.ok, 'settle that drains the vault into EARNED refused');
r = await post('Q', 'ENTITLEMENT_SETTLE', [L('ENT', 'k1', -5), L('PAYOUT', 'k1', 5)], mgr);
ok(!r.ok, 'settle with only ENT and PAYOUT refused');
r = await post('Q', 'ENTITLEMENT_ACCRUE', [L('ENT', 'k1', 5000), L('EARNED', 'k1', -5000)], mgr); ok(r.ok, 'accrue 5 g');
r = await post('Q', 'ENTITLEMENT_SETTLE', [L('VAULT', '', -9000), L('PAYOUT', 'k1', 9000), L('ENT', 'k1', -9000), L('EARNED', 'k1', 9000)], mgr);
ok(!r.ok && /negative/.test(r.error), 'cannot settle more than was accrued (ENT floor)');
r = await post('Q', 'ENTITLEMENT_SETTLE', [L('KCUST', 'kX', -5000), L('PAYOUT', 'k1', 5000), L('ENT', 'k1', -5000), L('EARNED', 'k1', 5000)], mgr);
ok(!r.ok, "settle that takes another karigar's custody refused");
// separator injection in owner_ref / karigar_id
r = await post('Q', 'ENTITLEMENT_ACCRUE', [L('EARNED', 'a', -5), L('ENT', 'e,-100000;KCUST,k9,100000;KCUST,k9z', 5)], mgr);
ok(!r.ok && /ids may only/.test(r.error), 'owner_ref with , or ; refused');
r = await post('Q', 'LABOUR_ACCRUE', [], { ...mgr, labour: [{ karigar_id: 'a,9999999;b', amount_paise: 5 }] });
ok(!r.ok && /ids may only/.test(r.error), 'karigar_id with , or ; refused');
// labour signs per type
r = await post('Q', 'LABOUR_ACCRUE', [], { ...mgr, labour: [{ karigar_id: 'a', amount_paise: -5 }] });
ok(!r.ok && /wrong sign/.test(r.error), 'LABOUR_ACCRUE with a payment amount refused');
r = await post('Q', 'LABOUR_PAY', [], { ...mgr, labour: [{ karigar_id: 'a', amount_paise: 5 }] });
ok(!r.ok && /wrong sign/.test(r.error), 'LABOUR_PAY with a payable amount refused');

// 23 round 2: accrual pairing, structured fingerprint
r = await post('Q', 'ENTITLEMENT_ACCRUE', [L('ENT', 'k1', 5), L('EARNED', 'k2', -5)], mgr);
ok(!r.ok && /pair up/.test(r.error), 'accrual that pairs ENT of one karigar with EARNED of another refused');
await post('Q', 'ISSUE', [L('VAULT', '', -5), L('KCUST', 'k3', 5)], { ...mgr, op: 'fp2op', job: 'a' });
r = await post('Q', 'ISSUE', [L('VAULT', '', -5), L('KCUST', 'k3', 5)], { ...mgr, op: 'fp2op', job: 'a', voucher: 'b' });
ok(!r.ok && /different content/.test(r.error), 'same op_id with an added voucher is a conflict');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
