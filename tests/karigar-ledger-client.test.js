// ─────────────────────────────────────────────�
// Karigar 2.0 ledger client (js/12-karigar-data.js): journal builders, validator, mirror
// reversals, offline outbox and replay against a fake server. No network, no database.
// Run:  node tests/karigar-ledger-client.test.js      (exit 1 on any failure)
// ─────────────────────────────────────────────�
const { loadApp } = require('./harness.js');

var passed = 0, failed = 0, failures = [];
async function test(name, fn){
  try{ await fn(); passed++; console.log('  ✓ ' + name); }
  catch(e){ failed++; failures.push(name + ': ' + e.message); console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function eq(a, b, msg){ if(a !== b) throw new Error((msg || 'expected') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(c, msg){ if(!c) throw new Error(msg || 'assertion failed'); }

function fresh(role){
  var a = loadApp();
  a.SAAS.user = {name:'Tester', email:'t@example.com', role:role || 'owner'};
  a.SAAS.sessionToken = 'tok-123';
  a.SB_FUNCTIONS = 'http://fake/functions/v1';
  a.localStorage.removeItem(a.kgOutboxKey()); a.localStorage.removeItem(a.kgRejectedKey());
  a.calls = [];
  return a;
}
// fake server: answers = list of {status, body} | 'netfail', used in order, last one repeats
function server(a, answers){
  var n = 0;
  a.fetch = function(url, opts){
    var ans = answers[Math.min(n++, answers.length - 1)];
    a.calls.push({url:url, opts:opts, body:JSON.parse(opts.body)});
    if(ans === 'netfail') return Promise.reject(new Error('offline'));
    return Promise.resolve({status:ans.status, json:function(){ return Promise.resolve(ans.body); }});
  };
}
var seq = 0;
function op(){ return 'op-client-' + (++seq) + '-xxxx'; }
function build(a, type, o){ o = o || {}; o.opId = o.opId || op(); return a.kgBuildJournal(type, o); }
function post(a, j){ return new Promise(function(res){ a.kgPostJournal(j, function(err, r){ res({err:err, r:r}); }); }); }
function flush(a){ return new Promise(function(res){ a.kgOutboxFlush(function(err, r){ res({err:err, r:r}); }); }); }
// fold journals into account balances to check mirrors cancel exactly
function fold(journals){
  var b = {};
  journals.forEach(function(j){ j.lines.forEach(function(l){ var k = l.account + '|' + l.owner_ref; b[k] = (b[k] || 0) + l.fine_mg; }); });
  return b;
}

(async function(){
console.log('\nKarigar 2.0 ledger client - builders and validation');

await test('every builder returns a journal that sums to zero and passes the validator', async function(){
  var a = fresh();
  var cases = [
    ['ISSUE', {karigarId:'k1', mg:100000, permille:1000, jobId:'J1'}], ['RETURN', {karigarId:'k1', mg:5000, permille:1000}],
    ['RECEIPT', {karigarId:'k1', jobId:'J1', mg:40000, permille:916}], ['SCRAP', {karigarId:'k1', mg:3000, permille:995}],
    ['LOSS', {karigarId:'k1', fineMg:400}], ['TRANSFER_OUT', {karigarId:'k1', voucherId:'TV1', fineMg:10000}],
    ['TRANSFER_IN', {toKarigarId:'k2', voucherId:'TV1', fineMg:10000}], ['ENTITLEMENT_ACCRUE', {karigarId:'k1', fineMg:4000}],
    ['ENTITLEMENT_SETTLE', {karigarId:'k1', fineMg:4000}], ['ENTITLEMENT_SETTLE', {karigarId:'k1', fineMg:4000, from:'vault'}],
    ['OPENING', {fineMg:50000}], ['ADJUST', {karigarId:'k1', fineMg:-300, note:'recount found less'}], ['ADJUST', {karigarId:'k1', fineMg:300, note:'recount found more'}]];
  cases.forEach(function(c){
    var r = build(a, c[0], c[1]);
    ok(r.journal, c[0] + ': ' + r.error); eq(a.kgJournalSum(r.journal.lines), 0, c[0] + ' balances');
    eq(a.kgValidateJournal(r.journal, 'owner'), '', c[0] + ' validates');
    r.journal.lines.forEach(function(l){ ok(Math.floor(l.fine_mg) === l.fine_mg && l.fine_mg !== 0, c[0] + ' whole non-zero mg'); });
  });
  var lab = build(a, 'LABOUR_ACCRUE', {karigarId:'k1', amountPaise:250000}).journal;
  eq(lab.labour[0].amount_paise, 250000); eq(lab.lines.length, 0); eq(a.kgValidateJournal(lab, 'owner'), '');
  eq(build(a, 'LABOUR_PAY', {karigarId:'k1', amountPaise:100000}).journal.labour[0].amount_paise, -100000, 'a payment reduces what is owed');
});
await test('the posting templates put the metal where the design says', async function(){
  var a = fresh();
  var iss = build(a, 'ISSUE', {karigarId:'k1', mg:100000, permille:1000}).journal;
  eq(JSON.stringify(iss.lines.map(function(l){ return [l.account, l.owner_ref, l.fine_mg]; })), JSON.stringify([['VAULT', '', -100000], ['KCUST', 'k1', 100000]]));
  eq(iss.lines[1].gross_mg, 100000); eq(iss.lines[1].permille, 1000, 'gross and fineness ride on the custody line');
  var rc = build(a, 'RECEIPT', {karigarId:'k1', jobId:'J9', mg:40000, permille:916}).journal;
  eq(rc.lines[0].fine_mg, -36640); eq(rc.lines[1].account, 'FG'); eq(rc.lines[1].owner_ref, 'J9'); eq(rc.lines[1].fine_mg, 36640);
  var st = build(a, 'ENTITLEMENT_SETTLE', {karigarId:'k1', fineMg:4000}).journal;
  eq(JSON.stringify(st.lines.map(function(l){ return l.account + ':' + l.fine_mg; })), JSON.stringify(['KCUST:-4000', 'PAYOUT:4000', 'ENT:-4000', 'EARNED:4000']));
  var tin = build(a, 'TRANSFER_IN', {toKarigarId:'k2', voucherId:'TV1', fineMg:10000}).journal;
  eq(tin.lines[0].account, 'TRANSIT'); eq(tin.lines[1].owner_ref, 'k2');
});
await test('weights: whole milligrams only; fine must match weight x fineness; zero and missing refused', async function(){
  var a = fresh();
  ok(build(a, 'ISSUE', {karigarId:'k1', mg:100000, permille:1000, fineMg:99999}).error, 'fine does not match');
  ok(build(a, 'ISSUE', {karigarId:'k1', fineMg:0}).error, 'zero'); ok(build(a, 'ISSUE', {karigarId:'k1', fineMg:-5}).error, 'negative issue');
  ok(build(a, 'ISSUE', {karigarId:'k1', fineMg:1.5}).error, 'fraction'); ok(build(a, 'ISSUE', {karigarId:'k1'}).error, 'missing');
  ok(build(a, 'TRANSFER_OUT', {karigarId:'k1', fineMg:5}).error, 'transfer needs a voucher');
  ok(build(a, 'ADJUST', {karigarId:'k1', fineMg:5}).error, 'adjust needs a reason'); ok(build(a, 'ADJUST', {karigarId:'k1', fineMg:0, note:'zero adjust'}).error);
  ok(build(a, 'LABOUR_ACCRUE', {karigarId:'k1', amountPaise:0}).error); ok(build(a, 'LABOUR_ACCRUE', {karigarId:'k1', amountPaise:1.5}).error);
  ok(build(a, 'STEAL', {}).error);
  eq(build(a, 'ISSUE', {karigarId:'k1', mg:1, permille:916}).journal.lines[1].fine_mg, 1, 'rounds once like the rest of V2');
});
await test('a receipt journal carries its job id, and the FG line names that same job (the database refuses any other pairing)', async function(){
  var a = fresh(), rc = build(a, 'RECEIPT', {karigarId:'k1', jobId:'J9', mg:40000, permille:916}).journal;
  eq(rc.job_id, 'J9', 'journal job id'); eq(rc.lines[1].owner_ref, rc.job_id, 'FG owner is the journal job');
  eq(a.kgValidateJournal(rc, 'manager'), '');
  var bare = build(a, 'RECEIPT', {karigarId:'k1', mg:40000, permille:916}).journal;
  eq(a.kgValidateJournal(bare, 'manager'), 'A receipt must name its job', 'no job id is refused on the phone');
  var bad = build(a, 'RECEIPT', {karigarId:'k1', jobId:'J 9', mg:40000, permille:916}).journal;
  eq(a.kgValidateJournal(bad, 'manager'), 'A receipt must name its job', 'job id with a space is refused');
});
await test('the validator refuses unbalanced, malformed and role-forbidden journals', async function(){
  var a = fresh(), good = build(a, 'ISSUE', {karigarId:'k1', fineMg:1000}).journal;
  function clone(){ return JSON.parse(JSON.stringify(good)); }
  function withEdit(fn){ var j = clone(); fn(j); return a.kgValidateJournal(j, 'owner'); }
  eq(a.kgValidateJournal(good, 'owner'), '');
  ok(withEdit(function(j){ j.lines[1].fine_mg = 999; }), 'unbalanced'); ok(/balance/.test(withEdit(function(j){ j.lines[1].fine_mg = 999; })));
  ok(withEdit(function(j){ j.op_id = 'short'; })); ok(withEdit(function(j){ j.op_id = 'has space in it'; }));
  ok(withEdit(function(j){ j.type = 'STEAL'; })); ok(withEdit(function(j){ j.lines[0].account = 'MINT'; }));
  ok(withEdit(function(j){ j.lines[0].fine_mg = 0; j.lines[1].fine_mg = 0; }), 'zero lines');
  ok(withEdit(function(j){ j.lines[0].fine_mg = -1000.5; j.lines[1].fine_mg = 1000.5; }), 'fractions');
  ok(withEdit(function(j){ j.lines[1].permille = 0; })); ok(withEdit(function(j){ j.lines[1].permille = 1001; }));
  ok(withEdit(function(j){ j.lines = []; }), 'empty'); ok(withEdit(function(j){ j.lines = new Array(21).fill({account:'KCUST', owner_ref:'k', fine_mg:1}); }), '21 lines');
  ok(withEdit(function(j){ j.business_date = '31/10/2026'; })); ok(withEdit(function(j){ j.business_date = '2026-02-30'; }));
  ok(withEdit(function(j){ j.reverses_id = 4; }), 'non-reversal naming a journal');
  ok(withEdit(function(j){ j.type = 'REVERSAL'; delete j.reverses_id; }), 'reversal without target');
  ok(withEdit(function(j){ j.labour = [{karigar_id:'', amount_paise:5}]; }));
  var open = build(a, 'OPENING', {fineMg:5000}).journal;
  ok(a.kgValidateJournal(open, 'manager'), 'manager cannot post OPENING'); eq(a.kgValidateJournal(open, 'owner'), '');
  var accrue = build(a, 'ENTITLEMENT_ACCRUE', {karigarId:'k1', fineMg:4000}).journal;
  ok(a.kgValidateJournal(accrue, 'manager'), 'manager cannot post an entitlement accrual (owner only, as in the database)'); eq(a.kgValidateJournal(accrue, 'owner'), '');
  var settle = build(a, 'ENTITLEMENT_SETTLE', {karigarId:'k1', fineMg:4000}).journal;
  eq(a.kgValidateJournal(settle, 'manager'), '', 'a manager may still settle what the owner accrued');
});
await test('a reversal is the exact mirror: the journal plus its reversal leaves every account at zero', async function(){
  var a = fresh();
  var kinds = [['ISSUE', {karigarId:'k1', mg:77777, permille:918}], ['RECEIPT', {karigarId:'k1', jobId:'J1', mg:12345, permille:916}],
    ['ENTITLEMENT_SETTLE', {karigarId:'k1', fineMg:3996}], ['TRANSFER_OUT', {karigarId:'k1', voucherId:'TV9', fineMg:777}],
    ['LABOUR_ACCRUE', {karigarId:'k1', amountPaise:123456}]];
  kinds.forEach(function(c, i){
    var orig = build(a, c[0], c[1]).journal; orig.id = 40 + i;
    var rv = a.kgBuildReversal(orig, op(), 'entered by mistake');
    ok(rv.journal, c[0] + ': ' + rv.error); eq(rv.journal.type, 'REVERSAL'); eq(rv.journal.reverses_id, 40 + i);
    eq(a.kgValidateJournal(rv.journal, 'owner'), '', 'mirror validates');
    var b = fold([orig, rv.journal]); Object.keys(b).forEach(function(k){ eq(b[k], 0, c[0] + ' ' + k + ' nets to zero'); });
    if(orig.labour.length) eq(orig.labour[0].amount_paise + rv.journal.labour[0].amount_paise, 0, 'labour nets to zero');
  });
  var rvOfRv = a.kgBuildReversal({id:1, type:'REVERSAL', lines:[]}, op(), 'second reversal'); ok(rvOfRv.error, 'a reversal cannot be reversed');
  ok(a.kgBuildReversal({id:1, type:'ISSUE', lines:[]}, op(), 'no').error, 'reason needed');
  var srv = {id:5, type:'ISSUE', job_id:'J1', lines:[{account:'VAULT', owner_ref:'', fine_mg:'-5000', gross_mg:null, permille:null}, {account:'KCUST', owner_ref:'k1', fine_mg:'5000', gross_mg:'5000', permille:1000}], labour:[]};
  var rs = a.kgBuildReversal(srv, op(), 'server shaped input');
  eq(rs.journal.lines[0].fine_mg, 5000, 'string numbers from the server become integers'); eq(rs.journal.lines[1].gross_mg, -5000);
});

console.log('\nKarigar 2.0 ledger client - sending, outbox and replay');

await test('a post is stored in the outbox first, sent with the session token and build number, then removed on success', async function(){
  var a = fresh(); server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:11}}]);
  var j = build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal;
  var seenBefore = null; var orig = a.fetch; a.fetch = function(u, o){ seenBefore = a.kgOutboxList().length; return orig(u, o); };
  var r = await post(a, j);
  ok(!r.err, r.err && r.err.message); eq(r.r.journal_id, 11); eq(seenBefore, 1, 'already in the outbox while the request was in flight'); eq(a.kgOutboxList().length, 0, 'removed after success');
  eq(a.calls[0].url, 'http://fake/functions/v1/store-proxy'); eq(a.calls[0].opts.method, 'POST');
  eq(a.calls[0].opts.headers['x-session-token'], 'tok-123'); eq(a.calls[0].body.action, 'kg_post'); eq(a.calls[0].body._build, a.APP_BUILD);
  eq(a.calls[0].body.op_id, j.op_id); eq(a.calls[0].body.lines.length, 2);
  ok(!('shop_id' in a.calls[0].body), 'the client never names a shop');
});
await test('offline: the journal stays in the outbox; flushing later sends it once; a repeated post is not stored twice', async function(){
  var a = fresh(); server(a, ['netfail']);
  var j = build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal;
  var r = await post(a, j); eq(r.err.code, 'offline'); eq(a.kgOutboxList().length, 1);
  await post(a, j); eq(a.kgOutboxList().length, 1, 'same op_id is stored once');
  var f1 = await flush(a); eq(f1.err.code, 'offline'); eq(f1.r.left, 1, 'still waiting while offline');
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]); a.calls = [];
  var f2 = await flush(a); ok(!f2.err); eq(f2.r.sent, 1); eq(f2.r.left, 0); eq(a.calls.length, 1);
  var f3 = await flush(a); eq(f3.r.sent, 0, 'nothing left to send');
});
await test('a server that already has the journal answers duplicate: treated as success, outbox cleared', async function(){
  var a = fresh(); server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:3}}]);
  var r = await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal);
  ok(!r.err); eq(r.r.duplicate, true); eq(a.kgOutboxList().length, 0);
});
await test('the ledger refusing a journal (422) removes it from the outbox, records why, and does not retry', async function(){
  var a = fresh(); server(a, [{status:422, body:{ok:false, error:'rejected', message:'account KCUST k1 would go negative (-5)'}}]);
  var r = await post(a, build(a, 'RETURN', {karigarId:'k1', fineMg:5000}).journal);
  eq(r.err.code, 'rejected'); ok(/negative/.test(r.err.message)); eq(a.kgOutboxList().length, 0);
  eq(a.kgRejectedList().length, 1); ok(/negative/.test(a.kgRejectedList()[0].why));
  var f = await flush(a); eq(a.calls.length, 1, 'never re-sent');
});
await test('a queued journal is only ever sent by the user who made it (shared shop computer)', async function(){
  var a = fresh('manager'); a.SAAS.user = {name:'Mgr', email:'Mgr@Example.com', role:'manager'};
  server(a, ['netfail']);
  var j = build(a, 'LOSS', {karigarId:'k1', fineMg:5000, approve:true}).journal;
  var r = await post(a, j); eq(r.err.code, 'offline'); eq(a.kgOutboxList().length, 1);
  a.SAAS.user = {name:'Owner', email:'owner@example.com', role:'owner'};
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]); a.calls = [];
  var f = await flush(a); ok(!f.err); eq(f.r.sent, 0, 'the owner does not send the manager\'s journal'); eq(a.calls.length, 0, 'nothing reached the server'); eq(f.r.left, 1, 'still waiting for its own user');
  a.SAAS.user = {name:'Mgr', email:'mgr@example.com', role:'manager'};
  var f2 = await flush(a); eq(f2.r.sent, 1, 'the manager sends it (e-mail case ignored)'); eq(a.calls.length, 1);
  ok(!('_by' in a.calls[0].body), 'the owner tag is local only and is never sent to the server');
});
await test('a journal that must wait for its own user does not block another user\'s journals', async function(){
  var a = fresh('manager'); a.SAAS.user = {name:'Mgr', email:'mgr@example.com', role:'manager'};
  server(a, ['netfail']); await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal);
  a.SAAS.user = {name:'Owner', email:'owner@example.com', role:'owner'};
  await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:7000}).journal); eq(a.kgOutboxList().length, 2);
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:2}}]); a.calls = [];
  var f = await flush(a); eq(f.r.sent, 1, 'only the owner\'s own entry'); eq(f.r.left, 1);
});
await test('a 403 is recorded in the rejected list, not lost without a trace', async function(){
  var a = fresh(); server(a, [{status:403, body:{error:'forbidden'}}]);
  await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal);
  eq(a.kgOutboxList().length, 0); eq(a.kgRejectedList().length, 1, 'visible to the owner afterwards');
});
await test('OPENING into a karigar posts KCUST against OPENING by an explicit option; the default stays the vault; ADJ is never used', async function(){
  var a = fresh();
  var k = build(a, 'OPENING', {into:'karigar', karigarId:'kar1', fineMg:12345}).journal;
  eq(k.type, 'OPENING'); eq(k.lines.length, 2); eq(k.lines[0].account, 'KCUST'); eq(k.lines[0].owner_ref, 'kar1'); eq(k.lines[0].fine_mg, 12345);
  eq(k.lines[1].account, 'OPENING'); eq(k.lines[1].fine_mg, -12345); eq(a.kgValidateJournal(k, 'owner'), '');
  ok(!k.lines.some(function(l){ return l.account === 'ADJ'; }), 'ADJ stays reserved for real corrections');
  var v = build(a, 'OPENING', {fineMg:5000}).journal; eq(v.lines[0].account, 'VAULT', 'no option, no change of behaviour');
  eq(a.kgValidateJournal(k, 'manager'), 'Only the owner can post this', 'a manager is refused on the phone too');
});
function blobShop(a){
  a.S.karigars = [{id:'karA', name:'Asha'}, {id:'karB', name:'Bela'}, {id:'karC', name:'Chitra'}];
  a.S.kgJobs = [{id:'jA', karigarId:'karA', status:'open', kind:'other'}, {id:'jB', karigarId:'karB', status:'open', kind:'other'}, {id:'jC', karigarId:'karC', status:'open', kind:'other'}];
  a.S.kgLedger = [{id:1, jobId:'jA', type:'ISSUE', fineMg:12345}, {id:2, jobId:'jC', type:'ISSUE', fineMg:1000}, {id:3, jobId:'jC', type:'ADJUST', fineMg:1500}];
}
function migrate(a){ return new Promise(function(res){ a.kgMigrateBlobToLedger(function(err, rep){ res({err:err, rep:rep}); }); }); }
await test('migration opens each karigar\'s blob balance on the ledger once; zero is skipped, negative is reported for owner review', async function(){
  var a = fresh(); blobShop(a); server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]);
  var r = await migrate(a); ok(!r.err, r.err && r.err.message);
  eq(a.calls.length, 1, 'only Asha has gold with her (Bela is zero, Chitra is negative)');
  var j = a.calls[0].body; eq(j.type, 'OPENING'); eq(j.op_id, 'migr:karA'); eq(j.lines[0].account, 'KCUST'); eq(j.lines[0].owner_ref, 'karA'); eq(j.lines[0].fine_mg, 12345);
  eq(r.rep.posted.length, 1); eq(r.rep.needsReview.length, 1); eq(r.rep.needsReview[0].karigarId, 'karC'); eq(r.rep.needsReview[0].fineMg, -500);
  eq(r.rep.skippedZero, 1, 'Bela\'s zero is skipped without noise');
});
await test('running the migration again re-sends the same op_id, so the server posts nothing new', async function(){
  var a = fresh(); blobShop(a); server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]);
  await migrate(a);
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:1}}]); a.calls = [];
  var r = await migrate(a); eq(a.calls[0].body.op_id, 'migr:karA', 'same deterministic id'); eq(r.rep.duplicates, 1); eq(r.rep.posted.length, 0, 'nothing newly posted');
});
await test('migration refuses a manager before anything is sent', async function(){
  var a = fresh('manager'); blobShop(a); server(a, [{status:200, body:{ok:true, journal_id:1}}]);
  var r = await migrate(a); ok(r.err && /owner/i.test(r.err.message)); eq(a.calls.length, 0, 'no request at all');
});
await test('a refused or offline opening journal is reported, and the other karigars still go through', async function(){
  var a = fresh(); blobShop(a); a.S.kgLedger.push({id:9, jobId:'jB', type:'ISSUE', fineMg:700});
  server(a, [{status:422, body:{ok:false, error:'rejected', message:'refused'}}, {status:200, body:{ok:true, duplicate:false, journal_id:5}}]);
  var r = await migrate(a); ok(!r.err); eq(a.calls.length, 2); eq(r.rep.failed.length, 1); eq(r.rep.failed[0].karigarId, 'karA'); eq(r.rep.posted.length, 1);
  eq(r.rep.posted[0].karigarId, 'karB');
});
await test('signing out warns first when gold entries are still waiting to be sent', async function(){
  var a = fresh(); a.SAAS.shop = {id:'shop-1'}; var seen = null;
  a.safeConfirm = function(title, msg, yes, danger){ seen = {msg:msg, danger:danger}; };
  a.saasLogout(); ok(seen && !/gold entr/i.test(seen.msg), 'no warning when nothing is waiting');
  server(a, ['netfail']); await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal);
  seen = null; a.saasLogout();
  ok(seen && /1 gold entry/i.test(seen.msg) && /lost/i.test(seen.msg), 'warns that 1 gold entry will be lost: ' + (seen && seen.msg));
  eq(seen.danger, true, 'shown as a danger confirm');
});
await test('signing out of the device clears the outbox and the rejected list', async function(){
  var a = fresh(); a.SAAS.shop = {id:'shop-1'}; server(a, ['netfail']);
  await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal);
  a.kgRejectedAdd(build(a, 'ISSUE', {karigarId:'k1', fineMg:1000}).journal, 'x');
  eq(a.kgOutboxList().length, 1); eq(a.kgRejectedList().length, 1);
  var ok1 = a.kgOutboxKey(), ok2 = a.kgRejectedKey();
  a._clearDeviceSession();
  eq(a.localStorage.getItem(ok1), null, 'outbox key removed'); eq(a.localStorage.getItem(ok2), null, 'rejected key removed');
});
await test('forbidden role, old build, expired session and server faults: right outcome for each', async function(){
  var a = fresh(); var j = build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal;
  server(a, [{status:403, body:{error:'forbidden'}}]); var r1 = await post(a, j);
  eq(r1.err.code, 'forbidden'); eq(a.kgOutboxList().length, 0, 'not kept: it can never succeed');
  server(a, [{status:409, body:{error:'client_outdated'}}]); var r2 = await post(a, j);
  eq(r2.err.code, 'outdated'); eq(a.kgOutboxList().length, 1, 'kept until the app is reloaded');
  server(a, [{status:401, body:{error:'unauthenticated'}}]); var r3 = await post(a, j); eq(r3.err.code, 'offline'); eq(a.kgOutboxList().length, 1);
  server(a, [{status:500, body:{error:'kg_post failed'}}]); var r4 = await post(a, j); eq(r4.err.code, 'offline'); eq(a.kgOutboxList().length, 1);
});
await test('flush sends in order, stops at the first network failure, and keeps the rest', async function(){
  var a = fresh(); server(a, ['netfail']);
  var js = [1, 2, 3].map(function(n){ return build(a, 'ISSUE', {karigarId:'k1', fineMg:n * 1000, opId:'op-order-000' + n}).journal; });
  for(var i = 0; i < js.length; i++) await post(a, js[i]);
  eq(a.kgOutboxList().length, 3);
  server(a, [{status:200, body:{ok:true, journal_id:1}}, {status:200, body:{ok:true, journal_id:2}}, 'netfail']); a.calls = [];
  var f = await flush(a); eq(f.err.code, 'offline'); eq(f.r.sent, 2); eq(f.r.left, 1);
  eq(a.calls.map(function(c){ return c.body.op_id; }).join(','), 'op-order-0001,op-order-0002,op-order-0003', 'oldest first');
  eq(a.kgOutboxList()[0].op_id, 'op-order-0003');
});
await test('an invalid journal is refused before it is stored or sent; a full device storage is reported, not hidden', async function(){
  var a = fresh(); server(a, [{status:200, body:{ok:true}}]);
  var bad = build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal; bad.lines[1].fine_mg = 4999;
  var r = await post(a, bad); eq(r.err.code, 'invalid'); eq(a.kgOutboxList().length, 0); eq(a.calls.length, 0);
  var mgr = fresh('manager'); server(mgr, [{status:200, body:{ok:true}}]);
  var open = build(mgr, 'OPENING', {fineMg:5000}).journal;
  eq((await post(mgr, open)).err.code, 'invalid', 'manager blocked before sending'); eq(mgr.calls.length, 0);
  var full = fresh(); server(full, [{status:200, body:{ok:true}}]);
  full.localStorage.setItem = function(){ throw new Error('QuotaExceededError'); };
  var rf = await post(full, build(full, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal);
  eq(rf.err.code, 'invalid'); ok(/storage/.test(rf.err.message)); eq(full.calls.length, 0, 'never sent what could not be kept safe');
});
await test('the shop blob save now carries the build number (so the server can refuse a stale phone)', async function(){
  var fs = require('fs'), path = require('path');
  var sync = fs.readFileSync(path.join(__dirname, '..', 'js', '01-sync-core.js'), 'utf8');
  ok(/_build:\s*APP_BUILD/.test(sync), 'saveToCloud sends _build');
  var a = fresh(); ok(a.APP_BUILD >= 67, 'APP_BUILD defined');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if(failed){ console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
