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
// the owner's two steps: preview (dry run), then confirm exactly that list
function migrate(a, confirmed){
  return new Promise(function(res){
    function run(list){ a.kgMigrateBlobToLedger(function(err, rep){ res({err:err, rep:rep}); }, {confirmed:list}); }
    if(confirmed) return run(confirmed);
    a.kgMigrateBlobToLedger(function(err, pre){ if(err) return res({err:err}); run(pre.would); }, {dryRun:true});
  });
}
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
await test('a rerun on a later day: a "different content" answer is explained, not shown raw', async function(){
  var a = fresh(); blobShop(a);
  server(a, [{status:422, body:{ok:false, error:'rejected', message:'op_id already used with different content'}}, {status:200, body:{ok:true, duplicate:true, journal_id:5}}]);
  var r = await migrate(a); var f = r.rep.failed[0];
  ok(f && f.karigarId === 'karA' && /already opened/i.test(f.why) && !/op_id/.test(f.why), 'plain words, got: ' + (f && f.why));
});
await test('a refused or offline opening journal is reported, and the other karigars still go through', async function(){
  var a = fresh(); blobShop(a); a.S.kgLedger.push({id:9, jobId:'jB', type:'ISSUE', fineMg:700});
  server(a, [{status:422, body:{ok:false, error:'rejected', message:'refused'}}, {status:200, body:{ok:true, duplicate:false, journal_id:5}}]);
  var r = await migrate(a); ok(!r.err); eq(a.calls.length, 2); eq(r.rep.failed.length, 1); eq(r.rep.failed[0].karigarId, 'karA'); eq(r.rep.posted.length, 1);
  eq(r.rep.posted[0].karigarId, 'karB');
});
await test('the real run needs the list the owner confirmed: with none it is refused and nothing is sent', async function(){
  var a = fresh(); blobShop(a); server(a, [{status:200, body:{ok:true, journal_id:1}}]);
  var r = await new Promise(function(res){ a.kgMigrateBlobToLedger(function(err, rep){ res({err:err, rep:rep}); }); });
  ok(r.err && /confirm/i.test(r.err.message), r.err && r.err.message); eq(a.calls.length, 0);
});
await test('a balance that changed after the preview is not posted; it goes to needsReview', async function(){
  var a = fresh(); blobShop(a); server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]);
  var pre = await new Promise(function(res){ a.kgMigrateBlobToLedger(function(err, rep){ res(rep); }, {dryRun:true}); });
  a.S.kgLedger.push({id:20, jobId:'jA', type:'ISSUE', fineMg:5000}); // a manager edits the blob after the owner looked
  var r = await migrate(a, pre.would); ok(!r.err); eq(a.calls.length, 0, 'the changed figure was never posted');
  eq(r.rep.posted.length, 0); var n = r.rep.needsReview.filter(function(x){ return x.karigarId === 'karA'; })[0];
  ok(n && n.fineMg === 17345 && n.was === 12345, 'reports the new figure and the confirmed one');
});
await test('a karigar added after the preview is not posted; it goes to needsReview', async function(){
  var a = fresh(); blobShop(a); server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]);
  var pre = await new Promise(function(res){ a.kgMigrateBlobToLedger(function(err, rep){ res(rep); }, {dryRun:true}); });
  a.S.karigars.push({id:'karD', name:'Devi'}); a.S.kgJobs.push({id:'jD', karigarId:'karD', status:'open', kind:'other'}); a.S.kgLedger.push({id:21, jobId:'jD', type:'ISSUE', fineMg:900});
  var r = await migrate(a, pre.would); ok(!r.err); eq(r.rep.posted.length, 1, 'only the confirmed karigar'); eq(r.rep.posted[0].karigarId, 'karA');
  ok(r.rep.needsReview.some(function(x){ return x.karigarId === 'karD'; }), 'the new one waits for the owner');
});
await test('a dry run lists what would be opened, with names, and sends nothing, so the owner can check it first', async function(){
  var a = fresh(); blobShop(a); server(a, [{status:200, body:{ok:true, journal_id:1}}]);
  var r = await new Promise(function(res){ a.kgMigrateBlobToLedger(function(err, rep){ res({err:err, rep:rep}); }, {dryRun:true}); });
  ok(!r.err); eq(a.calls.length, 0, 'no request at all'); eq(r.rep.posted.length, 0);
  eq(r.rep.would.length, 1); eq(r.rep.would[0].karigarId, 'karA'); eq(r.rep.would[0].name, 'Asha'); eq(r.rep.would[0].fineMg, 12345);
  eq(r.rep.needsReview.length, 1, 'the negative balance is still reported');
});
await test('the migr: op_id is reserved for the owner\'s OPENING journals, on the phone as well as the server', async function(){
  var a = fresh(), j = build(a, 'ISSUE', {karigarId:'karA', fineMg:100, opId:'migr:karA'}).journal;
  ok(/reserved/.test(a.kgValidateJournal(j, 'owner')), 'not for an ordinary journal, even the owner\'s');
  var o = build(a, 'OPENING', {into:'karigar', karigarId:'karA', fineMg:100, opId:'migr:karA'}).journal;
  eq(a.kgValidateJournal(o, 'owner'), '', 'the owner\'s opening journal is fine');
  ok(a.kgValidateJournal(o, 'manager') !== '', 'a manager is refused');
});
function entryShop(a, on){
  blobShop(a); a.S.kgLedger = []; a.S.kgLedgerOn = on; a.saveToCloud = function(cb){ cb(null); };
}
function issueEntry(o){ var e = {type:'ISSUE', opId:'op-entry-' + (++seq) + '-xx', jobId:'jA', karigarId:'karA', mg:10000, purityKey:'999', permille:1000, fineMg:10000};
  Object.keys(o || {}).forEach(function(x){ e[x] = o[x]; }); return e; }
function addEntry(a, e){ return new Promise(function(res){ a.kgAddEntry(e, function(err, ent, dup){ res({err:err, entry:ent, dup:dup}); }); }); }
await test('ledger flag off: a gold entry is saved to the blob only, nothing is sent (behaviour unchanged)', async function(){
  var a = fresh(); entryShop(a, false); server(a, [{status:200, body:{ok:true, journal_id:1}}]);
  var r = await addEntry(a, issueEntry()); ok(!r.err, r.err && r.err.message); eq(a.S.kgLedger.length, 1); eq(a.calls.length, 0);
});
await test('ledger flag on: the journal is posted first, then the blob entry is saved once', async function(){
  var a = fresh(); entryShop(a, true); server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:7}}]);
  var e = issueEntry(), r = await addEntry(a, e); ok(!r.err, r.err && r.err.message);
  eq(a.calls.length, 1); eq(a.calls[0].body.type, 'ISSUE'); eq(a.calls[0].body.op_id, e.opId); eq(a.calls[0].body.lines[0].account, 'VAULT'); eq(a.calls[0].body.lines[1].owner_ref, 'karA');
  eq(a.S.kgLedger.length, 1);
});
await test('ledger flag on: a refused journal leaves the blob unchanged and says why', async function(){
  var a = fresh(); entryShop(a, true); server(a, [{status:422, body:{ok:false, error:'rejected', message:'account VAULT would go negative'}}]);
  var r = await addEntry(a, issueEntry()); ok(r.err && /negative/.test(r.err.message)); eq(a.S.kgLedger.length, 0, 'blob entry not created');
});
await test('ledger flag on: no answer from the server leaves the entry unsaved and pending; Save again with the same id finishes it with one ledger row and one blob entry', async function(){
  var a = fresh(); entryShop(a, true); server(a, ['netfail']);
  var e = issueEntry(), r1 = await addEntry(a, e);
  ok(r1.err && r1.err.code === 'pending' && /not confirmed/i.test(r1.err.message), 'says not confirmed: ' + (r1.err && r1.err.message));
  eq(a.S.kgLedger.length, 0, 'nothing committed to the blob while unconfirmed');
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:7}}]); a.calls = [];
  var r2 = await addEntry(a, issueEntry({opId:e.opId})); ok(!r2.err, r2.err && r2.err.message);
  eq(a.calls[0].body.op_id, e.opId, 'same op_id re-sent'); eq(a.S.kgLedger.length, 1, 'one blob entry'); eq(a.kgOutboxList().length, 0, 'outbox cleared');
});
await test('ledger flag on: editing the figure after a pending answer is refused before sending, and the first journal stays in the outbox', async function(){
  var a = fresh(); entryShop(a, true); server(a, ['netfail']);
  var e = issueEntry(), r1 = await addEntry(a, e); eq(r1.err.code, 'pending');
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:8}}]); a.calls = [];
  var r2 = await addEntry(a, issueEntry({opId:e.opId, mg:11000, fineMg:11000}));
  ok(r2.err && /still being confirmed/i.test(r2.err.message), 'plain refusal, got: ' + (r2.err && r2.err.message));
  eq(a.calls.length, 0, 'nothing sent'); eq(a.kgOutboxList().length, 1, 'the first journal is still queued'); eq(a.kgOutboxList()[0].lines[0].fine_mg, -10000, 'with its original figure');
  eq(a.S.kgLedger.length, 0, 'nothing committed to the blob');
});
await test('blocker 2: a pending entry carries its shop-data entry in the outbox (device only, never sent), and the form being closed loses nothing', async function(){
  var a = fresh(); entryShop(a, true); server(a, ['netfail']);
  var e = issueEntry(), r1 = await addEntry(a, e); eq(r1.err.code, 'pending');
  var q = a.kgOutboxList()[0]; ok(q && q._entry && q._entry.opId === e.opId, 'entry kept with the queued journal');
  eq('_entry' in a.calls[0].body, false, 'never sent to the server');
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:3}}]); a.calls = [];
  var f = await flush(a); ok(!f.err, f.err && f.err.message);
  eq(a.S.kgLedger.length, 1, 'the flush finished the shop-data side'); eq(a.S.kgLedger[0].opId, e.opId); eq(a.kgOutboxList().length, 0);
});
await test('blocker 2: a flush after the user already tapped Save again does not create a second shop-data entry', async function(){
  var a = fresh(); entryShop(a, true); server(a, ['netfail']);
  var e = issueEntry(); await addEntry(a, e);
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:3}}]);
  var r2 = await addEntry(a, issueEntry({opId:e.opId})); ok(!r2.err); eq(a.S.kgLedger.length, 1);
  a.kgOutboxAdd && 0; await flush(a); eq(a.S.kgLedger.length, 1, 'still one');
});
await test('blocker 3: a flush where the shop data now refuses (job closed) parks the entry in the shop data, out of the blob', async function(){
  var a = fresh(); entryShop(a, true); a.S.kgParked = []; server(a, ['netfail']);
  var e = issueEntry(); await addEntry(a, e);
  a.S.kgJobs[0].status = 'closed';
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:4}}]);
  var f = await flush(a); ok(!f.err); eq(a.S.kgLedger.length, 0, 'not committed');
  eq(a.S.kgParked.length, 1, 'parked'); eq(a.S.kgParked[0].opId, e.opId); ok(/closed/i.test(a.S.kgParked[0].why), a.S.kgParked[0].why); eq(a.S.kgParked[0].entry.fineMg, 10000);
  eq(a.kgOutboxList().length, 0, 'the ledger has it, so it is not queued again');
});
await test('blocker 3: the Reports screen shows parked entries to the owner and not to a manager-only view of nothing', async function(){
  var a = fresh(); blobShop(a); a.SAAS.user = {name:'Owner', email:'owner@example.com', role:'owner'}; a.S.kgParked = [];
  ok(!/Ledger has this/.test(a.kg2ReportsHtml()), 'nothing parked, nothing shown');
  a.S.kgParked = [{id:'p1', opId:'o1', at:'2026-11-05T10:00:00.000Z', why:'Job is closed - reopen it first', entry:{type:'ISSUE', jobId:'jA', karigarId:'karA', fineMg:10000}}];
  var h = a.kg2ReportsHtml(); ok(/Ledger has this/.test(h) && /Job is closed/.test(h), 'shows the entry and why');
});
await test('blocker 4: a 401 asks for sign-in with the reason from the server, keeps the entry queued, and says so instead of "may already be recorded"', async function(){
  var a = fresh(); entryShop(a, true); var asked = [];
  a.saasRequireReauth = function(resume, reason){ asked.push({reason:reason, resume:resume}); };
  server(a, [{status:401, body:{error:'unauthenticated', reason:'expired'}}]);
  var r = await addEntry(a, issueEntry());
  eq(r.err.code, 'pending'); ok(/sign in/i.test(r.err.message) && !/may already be recorded/i.test(r.err.message), r.err.message);
  eq(asked.length, 1, 'sign-in prompt raised once'); eq(asked[0].reason, 'expired'); eq(a.kgOutboxList().length, 1, 'still queued');
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:5}}]); a.calls = []; asked[0].resume();
  await new Promise(function(res){ setTimeout(res, 30); });
  eq(a.calls.length, 1, 'after sign-in the queue is sent'); eq(a.S.kgLedger.length, 1, 'and the shop-data side is finished');
});
await test('blocker 4: a 401 with no reason from the server is treated as expired, never as revoked (revoked wipes the device)', async function(){
  var a = fresh(); entryShop(a, true); var asked = [];
  a.saasRequireReauth = function(resume, reason){ asked.push(reason); };
  server(a, [{status:401, body:{error:'unauthenticated'}}]); await addEntry(a, issueEntry());
  eq(asked[0], 'expired');
});
await test('ledger flag on and the phone offline: refused with a plain message, nothing sent, nothing saved', async function(){
  var a = fresh(); entryShop(a, true); a.navigator = {onLine:false}; server(a, [{status:200, body:{ok:true, journal_id:1}}]);
  var r = await addEntry(a, issueEntry()); ok(r.err && /internet/i.test(r.err.message), r.err && r.err.message);
  eq(a.calls.length, 0); eq(a.S.kgLedger.length, 0); eq(a.kgOutboxList().length, 0, 'not even queued');
});
await test('ledger flag on: an entry type the ledger path does not cover yet is refused, never half saved', async function(){
  var a = fresh(); entryShop(a, true); server(a, [{status:200, body:{ok:true, journal_id:1}}]);
  var r = await addEntry(a, {type:'APPROVAL', opId:'op-entry-appr-xx', jobId:'jA', refId:'x', decision:'approve'});
  ok(r.err && /ledger is on/i.test(r.err.message), r.err && r.err.message); eq(a.calls.length, 0); eq(a.S.kgLedger.length, 0);
});
await test('ledger flag on: if saving the shop fails after the ledger accepted it, Save again completes it without a second ledger row', async function(){
  var a = fresh(); entryShop(a, true); server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:7}}]);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var e = issueEntry(), r1 = await addEntry(a, e); ok(r1.err); eq(a.S.kgLedger.length, 0, 'blob entry rolled back');
  a.saveToCloud = function(cb){ cb(null); }; server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:7}}]);
  var r2 = await addEntry(a, issueEntry({opId:e.opId})); ok(!r2.err, r2.err && r2.err.message); eq(a.S.kgLedger.length, 1);
});
function balRow(account, ref, mg){ return {account:account, owner_ref:ref, fine_mg:String(mg)}; }
await test('blob vs ledger: matching karigars are not mismatches; a difference shows both figures; zero on both sides is left out', async function(){
  var a = fresh(); blobShop(a); // karA holds 12,345 in the blob; karB 0; karC -500
  var rec = a.kgReconcile([balRow('KCUST', 'karA', 12345), balRow('KCUST', 'karC', 200)]);
  eq(rec.mismatches.length, 1, 'only karC differs'); var m = rec.mismatches[0];
  eq(m.karigarId, 'karC'); eq(m.blob, -500); eq(m.ledger, 200); eq(m.diff, 700, 'ledger minus blob');
  ok(!rec.rows.some(function(x){ return x.karigarId === 'karB'; }), 'zero on both sides is not listed');
  eq(rec.rows.filter(function(x){ return x.karigarId === 'karA'; })[0].diff, 0);
});
await test('blob vs ledger: a ledger balance for a karigar who is not in the shop data is listed (D11)', async function(){
  var a = fresh(); blobShop(a);
  var rec = a.kgReconcile([balRow('KCUST', 'karA', 12345), balRow('KCUST', 'ghost99', 800), balRow('FG', 'jA', 400), balRow('ENT', 'nobody1', 50)]);
  eq(rec.unknown.length, 2, 'ghost99 and nobody1; FG belongs to a job, VAULT/OPENING have no karigar'); eq(rec.unknown[0].ownerRef, 'ghost99'); eq(rec.unknown[0].fineMg, 800);
});
await test('blob vs ledger: owner references that are also JavaScript property names cannot hide from the unknown list', async function(){
  var a = fresh(); blobShop(a);
  var rec = a.kgReconcile([balRow('KCUST', 'constructor', 900), balRow('LOSS', 'toString', 10), balRow('KCUST', '__proto__', 5), balRow('KCUST', 'hasOwnProperty', 7)]);
  eq(rec.unknown.length, 4, 'all four are unknown people, none treated as known');
});
await test('migration: a karigar whose id is a JavaScript property name is never posted on a confirmed list it is not on', async function(){
  var a = fresh(); a.S.karigars = [{id:'constructor', name:'Odd'}]; a.S.kgJobs = [{id:'jX', karigarId:'constructor', status:'open', kind:'other'}];
  a.S.kgLedger = [{id:1, jobId:'jX', type:'ISSUE', fineMg:500}]; server(a, [{status:200, body:{ok:true, journal_id:1}}]);
  var r = await migrate(a, []); ok(!r.err); eq(a.calls.length, 0, 'not on the confirmed list, so not posted'); eq(r.rep.needsReview.length, 1);
});
await test('blob vs ledger: the balances call returns rows, and says plainly when it cannot reach the ledger', async function(){
  var a = fresh(); server(a, [{status:200, body:{ok:true, balances:[balRow('KCUST', 'karA', 5)]}}]);
  var r1 = await new Promise(function(res){ a.kgFetchBalances(function(e, rows){ res({e:e, rows:rows}); }); });
  ok(!r1.e); eq(r1.rows.length, 1); eq(a.calls[0].body.action, 'kg_balances');
  server(a, ['netfail']); var r2 = await new Promise(function(res){ a.kgFetchBalances(function(e){ res({e:e}); }); });
  ok(r2.e && /ledger/i.test(r2.e.message));
  server(a, [{status:403, body:{error:'forbidden'}}]); var r3 = await new Promise(function(res){ a.kgFetchBalances(function(e){ res({e:e}); }); });
  ok(r3.e && /owner or a manager/i.test(r3.e.message));
});
await test('blob vs ledger: a wastage karigar shows a diff equal to her earned share until accrual is wired (known shortcut)', async function(){
  var a = fresh(); blobShop(a);
  a.S.kgJobs[0].kind = 'wastage'; a.S.kgJobs[0].wastageBp = 400; // 4% of 12,345 = 494 earned; blob holds 11,851, ledger KCUST holds the full 12,345
  var rec = a.kgReconcile([balRow('KCUST', 'karA', 12345), balRow('KCUST', 'karC', -500)]);
  var m = rec.mismatches.filter(function(x){ return x.karigarId === 'karA'; })[0];
  ok(m, 'karA is flagged'); eq(m.blob, 11851); eq(m.ledger, 12345); eq(m.diff, 494, 'diff is exactly the earned share');
});
await test('ledger flag on: Save again after midnight re-sends the first attempt\'s business_date, so the server sees the same content', async function(){
  var a = fresh(); entryShop(a, true);
  var seen = {}; // fake server that fingerprints content like the real one (op_id + business_date + lines)
  a.fetch = function(url, opts){ var b = JSON.parse(opts.body); a.calls.push({body:b});
    var h = b.business_date + JSON.stringify(b.lines), n = a.calls.length;
    if(n === 1) return Promise.reject(new Error('offline')); // first reply lost; assume the server did record it
    if(seen[b.op_id] && seen[b.op_id] !== h) return Promise.resolve({status:422, json:function(){ return Promise.resolve({ok:false, error:'rejected', message:'op_id already used with different content'}); }});
    seen[b.op_id] = h; return Promise.resolve({status:200, json:function(){ return Promise.resolve({ok:true, duplicate:false, journal_id:7}); }}); };
  a.kgToday = function(){ return '2026-11-05'; };
  var e = issueEntry(), r1 = await addEntry(a, e); eq(r1.err.code, 'pending');
  seen[e.opId] = a.calls[0].body.business_date + JSON.stringify(a.calls[0].body.lines); // the server did get it
  a.kgToday = function(){ return '2026-11-06'; };
  var r2 = await addEntry(a, issueEntry({opId:e.opId}));
  ok(!r2.err, 'retry after midnight must finish, got: ' + (r2.err && r2.err.message)); eq(a.S.kgLedger.length, 1, 'one blob entry');
  eq(a.calls[1].body.business_date, '2026-11-05', 'same business_date as the first attempt');
});
await test('Reports does not hang on Checking when the comparison throws: it shows an error and a way to retry', async function(){
  var a = fresh(); blobShop(a); a.SAAS.user = {name:'Owner', email:'owner@example.com', role:'owner'};
  server(a, [{status:200, body:{ok:true, balances:[balRow('KCUST', 'karA', 5)]}}]);
  a.kgReconcile = function(){ throw new Error('bad data'); };
  await new Promise(function(res){ a.kg2Reconcile(); setTimeout(res, 30); });
  eq(a._kgRecon.state, 'error', 'not stuck on loading'); ok(/Try again/.test(a.kg2ReportsHtml()));
});
await test('one identity helper: the outbox tag is the identity from kgUser', async function(){
  var a = fresh(); a.SAAS.user = {name:'Mgr', email:'Mgr@Example.com', role:'manager'};
  eq(a.kgWho(), a.kgUser().who); eq(a.kgWho(), 'mgr@example.com');
  a.SAAS.user = null; eq(a.kgWho(), '', 'nobody signed in');
});
await test('Reports shows a Blob vs ledger section with a state for idle, checking, error, all matching and mismatch', async function(){
  var a = fresh(); blobShop(a); a.SAAS.user = {name:'Owner', email:'owner@example.com', role:'owner'};
  a._kgRecon = {state:'idle'}; var h = a.kg2ReportsHtml(); ok(/Blob vs ledger/.test(h) && /kg2Reconcile\(\)/.test(h), 'a button to run the check');
  a._kgRecon = {state:'loading'}; ok(/Checking the ledger/.test(a.kg2ReportsHtml()));
  a._kgRecon = {state:'error', msg:'Could not reach the ledger. Check the internet and try again.'}; ok(/Could not reach the ledger/.test(a.kg2ReportsHtml()));
  a._kgRecon = {state:'done', rec:a.kgReconcile([balRow('KCUST', 'karA', 12345), balRow('KCUST', 'karC', -500)])}; ok(/All karigars match/.test(a.kg2ReportsHtml()), 'blob and ledger agree');
  a._kgRecon = {state:'done', rec:a.kgReconcile([balRow('KCUST', 'karA', 10000), balRow('KCUST', 'ghost99', 800)])};
  var d = a.kg2ReportsHtml(); ok(/Asha/.test(d) && /2 karigars differ/i.test(d) && /ghost99/.test(d), 'mismatch and unknown reference shown: ' + d.slice(d.indexOf('Blob vs ledger'), d.indexOf('Blob vs ledger') + 200));
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
await test('blocker 5: a forced sign-out (expired or removed) tells the user which gold entries never reached the ledger', async function(){
  var a = fresh(); a.SAAS.shop = {id:'shop-1'}; a._reloadToSignIn = function(){};
  server(a, ['netfail']); await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal); await post(a, build(a, 'ISSUE', {karigarId:'k1', fineMg:6000}).journal);
  a.saasForceLogout('Signed out.');
  var note = a.sessionStorage.getItem(a.SIGNOUT_NOTICE_KEY);
  ok(/Signed out\./.test(note) && /2 gold entries/i.test(note) && /ledger/i.test(note) && /check/i.test(note), 'notice: ' + note);
  var b = fresh(); b.SAAS.shop = {id:'shop-2'}; b._reloadToSignIn = function(){}; b.saasForceLogout('Signed out.');
  ok(!/gold/i.test(b.sessionStorage.getItem(b.SIGNOUT_NOTICE_KEY)), 'nothing waiting, nothing extra');
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
await test('blocker 6: clearing the device also removes outbox keys of a shop that is not loaded (session expired while the app was closed)', async function(){
  var a = fresh(); a.SAAS.shop = null; // boot after expiry: nothing loaded, kgOutboxKey() would say noshop
  a.localStorage.setItem('kg_outbox::shop-9', '[{"op_id":"x"}]'); a.localStorage.setItem('kg_outbox_rejected::shop-9', '[]'); a.localStorage.setItem('pin_hash::shop-9', 'keep');
  a._clearDeviceSession();
  eq(a.localStorage.getItem('kg_outbox::shop-9'), null); eq(a.localStorage.getItem('kg_outbox_rejected::shop-9'), null);
  eq(a.localStorage.getItem('pin_hash::shop-9'), 'keep', 'the PIN stays: it is a per-device lock');
});
await test('audit 1: committing an entry whose opId is already in the blob adds nothing and a failed save does not remove the first one', async function(){
  var a = fresh(); entryShop(a, false);
  var e1 = a.kgStamp(issueEntry({opId:'op-dup-1-xx'})), e2 = a.kgStamp(issueEntry({opId:'op-dup-1-xx'}));
  await new Promise(function(res){ a.kgCommitEntry(e1, a.kgFindJob('jA'), a.kgUser(), res); });
  eq(a.S.kgLedger.length, 1);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  a.toast = function(){}; e2.id = e1.id; // worst case: same id too
  await new Promise(function(res){ a.kgCommitEntry(e2, a.kgFindJob('jA'), a.kgUser(), res); });
  eq(a.S.kgLedger.length, 1, 'still exactly one, and the first was not undone');
});
await test('audit 2: a flush whose shop-data save fails on the network re-queues the entry and stops; it is not parked, and the next flush finishes it', async function(){
  var a = fresh(); entryShop(a, true); a.S.kgParked = []; a.toast = function(){}; server(a, ['netfail']);
  var e = issueEntry(); await addEntry(a, e);
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:3}}]);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var f = await flush(a); ok(f.err, 'the flush reports it could not finish');
  eq(a.S.kgParked.length, 0, 'a network failure is not a refusal'); eq(a.kgOutboxList().length, 1, 'back in the outbox'); ok(a.kgOutboxList()[0]._entry, 'with its shop-data entry');
  eq(a.S.kgLedger.length, 0);
  a.saveToCloud = function(cb){ cb(null); }; var f2 = await flush(a); ok(!f2.err, f2.err && f2.err.message);
  eq(a.S.kgLedger.length, 1); eq(a.kgOutboxList().length, 0);
});
await test('audit 2: a flush that meets another save in progress on the same job re-queues instead of parking', async function(){
  var a = fresh(); entryShop(a, true); a.S.kgParked = []; server(a, ['netfail']);
  var e = issueEntry(); await addEntry(a, e);
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:3}}]);
  a._kgLocks['job:' + e.jobId] = true;
  var f = await flush(a); ok(f.err); eq(a.S.kgParked.length, 0); eq(a.kgOutboxList().length, 1);
});
await test('audit 3: the count of gold entries a device clear will delete covers every shop, even with no shop loaded', async function(){
  var a = fresh(); a.SAAS.shop = null; a.localStorage.setItem('kg_outbox::shop-9', '[{"op_id":"a"},{"op_id":"b"}]');
  ok(/2 gold entries/.test(a.kgLostNote()) && /ledger/.test(a.kgLostNote()), a.kgLostNote());
  a.localStorage.removeItem('kg_outbox::shop-9'); eq(a.kgLostNote(), '');
});
await test('flush trigger: kgTryFlush sends a waiting entry, and does nothing when the queue is empty, the phone is offline, or a sign-in prompt is open', async function(){
  var a = fresh(); entryShop(a, true); a.S.kgParked = []; server(a, ['netfail']);
  var e = issueEntry(); await addEntry(a, e);
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:3}}]); a.calls = [];
  a.navigator = {onLine:false}; a.kgTryFlush(); await new Promise(function(r){ setTimeout(r, 20); }); eq(a.calls.length, 0, 'offline: nothing');
  a.navigator = {onLine:true}; a.saasReauthPending = function(){ return true; }; a.kgTryFlush(); await new Promise(function(r){ setTimeout(r, 20); }); eq(a.calls.length, 0, 'sign-in prompt open: nothing');
  a.saasReauthPending = function(){ return false; }; a.kgTryFlush(); await new Promise(function(r){ setTimeout(r, 40); });
  eq(a.calls.length, 1, 'sent'); eq(a.S.kgLedger.length, 1, 'shop-data side finished'); eq(a.kgOutboxList().length, 0);
  a.calls = []; a.kgTryFlush(); await new Promise(function(r){ setTimeout(r, 20); }); eq(a.calls.length, 0, 'empty queue: no request');
});
await test('flush trigger: starting the auto-refresh tries a flush, and so does the phone coming back online', async function(){
  var a = fresh(); var n = 0; a.kgTryFlush = function(){ n++; };
  a.startAutoRefresh(); eq(n, 1, 'once at start');
  ok(a.kgOnlineHook, 'online hook exists'); a.kgOnlineHook(); eq(n, 2, 'and on online');
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
await test('kgQueuedForJob counts only the signed-in user queued entries for that job', async function(){
  var a = fresh(); server(a, [{status:200, body:{ok:true}}]);
  var j1 = build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal;
  a.kgOutboxAdd(j1);
  var other = Object.assign({}, j1, {op_id:'op-other-0001', job_id:'job-zzz'}); a.kgOutboxAdd(other);
  eq(a.kgQueuedForJob(j1.job_id), 1); eq(a.kgQueuedForJob('job-zzz'), 1); eq(a.kgQueuedForJob('nope'), 0);
  a.kgOutboxRemove(j1.op_id); eq(a.kgQueuedForJob(j1.job_id), 0);
});
function parkedShop(role){
  var a = fresh(); blobShop(a); a.SAAS.user = {name:'Owner', email:'owner@example.com', role:role || 'owner'};
  a.saveToCloud = function(cb){ cb(null); };
  a.S.kgParked = [{id:'p1', opId:'op-parked-0001', at:'2026-11-05T10:00:00.000Z', why:'Job is closed', entry:{type:'ISSUE', jobId:'jA', karigarId:'karA', fineMg:10000}}];
  return a;
}
var srvOrig = {id:7, op_id:'op-parked-0001', type:'ISSUE', job_id:'jA', voucher_id:null, reverses_id:null, business_date:'2026-11-05', note:'',
  lines:[{account:'VAULT', owner_ref:'', fine_mg:-10000, gross_mg:null, permille:null}, {account:'KCUST', owner_ref:'karA', fine_mg:10000, gross_mg:10000, permille:1000}], labour:[]};
function revParked(a, reason){ return new Promise(function(res){ a.kgReverseParked('p1', reason, function(err){ res(err); }); }); }
await test('reverse a parked entry: finds the ledger journal, posts the exact mirror, then removes the parked row', async function(){
  var a = parkedShop(); a.toast = function(){};
  server(a, [{status:200, body:{ok:true, journals:[srvOrig]}}, {status:200, body:{ok:true, duplicate:false, journal_id:8}}]);
  var err = await revParked(a, 'job was closed, entered in error'); ok(!err, err && err.message);
  var sent = a.calls[1].body; eq(sent.action, 'kg_post'); eq(sent.type, 'REVERSAL'); eq(sent.reverses_id, 7);
  eq(JSON.stringify(sent.lines.map(function(l){ return l.fine_mg; })), JSON.stringify([10000, -10000]), 'mirror');
  eq(a.S.kgParked.length, 0, 'parked row gone'); eq(a.kgOutboxList().length, 0);
});
await test('reverse a parked entry: only the owner may; nothing is sent otherwise; a short reason is refused', async function(){
  var m = parkedShop('manager'); server(m, [{status:200, body:{ok:true, journals:[srvOrig]}}]);
  var e1 = await revParked(m, 'long enough reason'); ok(e1, 'manager refused'); eq(m.calls.length, 0); eq(m.S.kgParked.length, 1);
  var a = parkedShop(); server(a, [{status:200, body:{ok:true, journals:[srvOrig]}}, {status:200, body:{ok:true, journal_id:8}}]);
  var e2 = await revParked(a, 'no'); ok(e2, 'short reason refused'); eq(a.S.kgParked.length, 1);
});
await test('reverse a parked entry: the ledger has no such journal -> error, row stays', async function(){
  var a = parkedShop(); server(a, [{status:200, body:{ok:true, journals:[]}}]);
  var err = await revParked(a, 'not on the ledger?'); ok(err && /ledger/i.test(err.message), err && err.message); eq(a.S.kgParked.length, 1);
});
await test('reverse a parked entry: refused when the ledger journal does not match the parked row (type, job or gold total)', async function(){
  var bads = [Object.assign({}, srvOrig, {type:'RECEIPT'}), Object.assign({}, srvOrig, {job_id:'jOther'}),
    Object.assign({}, srvOrig, {lines:[{account:'VAULT', owner_ref:'', fine_mg:-99000}, {account:'KCUST', owner_ref:'karA', fine_mg:99000}]})];
  for(var i = 0; i < bads.length; i++){
    var a = parkedShop(); server(a, [{status:200, body:{ok:true, journals:[bads[i]]}}, {status:200, body:{ok:true, journal_id:8}}]);
    var err = await revParked(a, 'long enough reason'); ok(err && /does not match/.test(err.message), 'case ' + i + ': ' + (err && err.message));
    eq(a.calls.length, 1, 'nothing posted'); eq(a.S.kgParked.length, 1);
  }
});
await test('reverse a parked entry: a network failure keeps the row; the retry (server says duplicate) finishes it', async function(){
  var a = parkedShop(); a.toast = function(){};
  server(a, [{status:200, body:{ok:true, journals:[srvOrig]}}, 'netfail']);
  var e1 = await revParked(a, 'job was closed, entered in error'); ok(e1, 'not confirmed'); eq(a.S.kgParked.length, 1, 'row stays');
  server(a, [{status:200, body:{ok:true, journals:[srvOrig]}}, {status:200, body:{ok:true, duplicate:true, journal_id:8}}]);
  var e2 = await revParked(a, 'job was closed, entered in error'); ok(!e2, e2 && e2.message); eq(a.S.kgParked.length, 0);
  eq(a.calls[1].body.op_id, 'rv-op-parked-0001', 'same op_id on retry, so the server cannot reverse twice');
});
await test('reverse a parked entry: the ledger took the reversal but the shop save failed; Reverse again next day re-sends the first business_date', async function(){
  var a = parkedShop(); a.toast = function(){}; a.kgToday = function(){ return '2026-11-05'; };
  server(a, [{status:200, body:{ok:true, journals:[srvOrig]}}, {status:200, body:{ok:true, duplicate:false, journal_id:8}}]);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var e1 = await revParked(a, 'job was closed, entered in error'); ok(e1, 'shop save failed'); eq(a.S.kgParked.length, 1, 'row stays');
  var first = a.calls[1].body.business_date;
  a.kgToday = function(){ return '2026-11-06'; }; a.saveToCloud = function(cb){ cb(null); };
  server(a, [{status:200, body:{ok:true, journals:[srvOrig]}}, {status:200, body:{ok:true, duplicate:true, journal_id:8}}]); a.calls = [];
  var e2 = await revParked(a, 'job was closed, entered in error'); ok(!e2, e2 && e2.message);
  eq(a.calls[1].body.business_date, first, 'same date, or the server calls it different content and the row can never be cleared');
});
await test('park: when the shop-data save of the park note fails, the entry goes back to the outbox, not lost', async function(){
  var a = fresh(); entryShop(a, true); a.S.kgParked = []; a.toast = function(){}; server(a, ['netfail']);
  var e = issueEntry(); await addEntry(a, e);
  a.S.kgJobs[0].status = 'closed';
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:4}}]);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var f = await flush(a); ok(f.err, 'flush reports it could not finish');
  eq(a.S.kgParked.length, 0, 'park note rolled back'); eq(a.S.kgLedger.length, 0);
  eq(a.kgOutboxList().length, 1, 'still queued so the next flush parks it');
});
await test('reverse a parked entry: Reports shows the button to the owner only', async function(){
  var a = parkedShop(); ok(/kg2ReverseParked\(/.test(a.kg2ReportsHtml()), 'owner sees it');
  var m = parkedShop('manager'); ok(!/kg2ReverseParked\(/.test(m.kg2ReportsHtml()), 'manager does not');
});
await test('unsent bills: sign-out keeps them on the phone, and the notice counts every shop', async function(){
  var a = fresh(); eq(a.salesKeptNote(), '');
  a.localStorage.setItem('jewelos_sale_outbox::shop-1', JSON.stringify([{sale:{id:'s1'}}, {sale:{id:'s2'}}]));
  a.localStorage.setItem('jewelos_sale_outbox::shop-2', JSON.stringify([{sale:{id:'s3'}}]));
  ok(/3 unsent bills stay on this phone/.test(a.salesKeptNote()), a.salesKeptNote());
  a._clearDeviceSession();
  eq(JSON.parse(a.localStorage.getItem('jewelos_sale_outbox::shop-1')).length, 2, 'not deleted by sign-out');
  a.localStorage.removeItem('jewelos_sale_outbox::shop-2');
  ok(/2 unsent bills/.test(a.salesKeptNote()));
  a.localStorage.removeItem('jewelos_sale_outbox::shop-1'); eq(a.salesKeptNote(), '');
});
await test('review: an owner credit (reduces what the karigar holds) lowers custody on the ledger, same direction as the shop data', async function(){
  var a = fresh(); entryShop(a, true);
  var credit = a.kgLedgerJournalFor({type:'ADJUST', opId:'op-adj-credit-1', jobId:'jA', karigarId:'karA', fineMg:500, reason:'recount found less'}).journal;
  var kc = credit.lines.filter(function(l){ return l.account === 'KCUST'; })[0]; eq(kc.fine_mg, -500, 'credit lowers custody');
  var debit = a.kgLedgerJournalFor({type:'ADJUST', opId:'op-adj-debit-1', jobId:'jA', karigarId:'karA', fineMg:-500, reason:'recount found more'}).journal;
  eq(debit.lines.filter(function(l){ return l.account === 'KCUST'; })[0].fine_mg, 500, 'debit raises custody');
});
await test('review: Save again after midnight re-sends the date the ledger already accepted, even though the outbox row is gone', async function(){
  var a = fresh(); entryShop(a, true); a.toast = function(){}; a.kgToday = function(){ return '2026-11-05'; };
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var e = issueEntry(); var r1 = await addEntry(a, e); ok(r1.err, 'shop save failed after the ledger accepted it');
  var first = a.calls[0].body.business_date; a.kgOutboxRemove(e.opId); eq(a.kgOutboxList().length, 0, 'outbox row gone (it is re-queued now, so remove it to test the date memory on its own)');
  a.kgToday = function(){ return '2026-11-06'; }; a.saveToCloud = function(cb){ cb(null); };
  server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:1}}]); a.calls = [];
  var r2 = await addEntry(a, issueEntry({opId:e.opId})); ok(!r2.err, r2.err && r2.err.message);
  eq(a.calls[0].body.business_date, first, 'same date as the first, or the server calls it different content');
});
await test('review: a refused queued entry is shown on Reports and is not silently lost', async function(){
  var a = fresh(); entryShop(a, true); a.SAAS.user = {name:'Owner', email:'owner@example.com', role:'owner'}; a.toast = function(){};
  server(a, ['netfail']); var e = issueEntry(); await addEntry(a, e);
  server(a, [{status:422, body:{ok:false, error:'rejected', message:'Job is not open on the ledger'}}]);
  await flush(a);
  var h = a.kg2ReportsHtml(); ok(/Ledger refused/.test(h) && /Job is not open on the ledger/.test(h), 'shown with the reason');
});
await test('security A2: numbers read back from the shop data are escaped on the Karigar screens', async function(){
  var a = fresh(); blobShop(a); a.SAAS.user = {name:'Owner', email:'owner@example.com', role:'owner'};
  var bad = '<img src=x onerror=alert(1)>';
  ok(a.kg2Detail({type:'RECEIPT', pieceDesc:'ring', qty:bad, mg:1000, permille:916, purityKey:'916', fineMg:916}).indexOf('<img') === -1, 'RECEIPT qty');
  ok(a.kg2JobLinesHtml({status:'open', lines:[{id:'l1', desc:'ring', qty:bad}]}).indexOf('<img') === -1, 'piece line qty');
  a.S.karigars = [{id:'kA', name:'K', kind:'salary', salary:{mode:'daily'}}]; a.S.kgSalary = [{id:'s1', karigarId:'kA', type:'ACCRUE', date:'2026-11-05', days:bad}];
  a._kg2.karigarId = 'kA'; ok(a.kg2SalaryHtml().indexOf('<img') === -1, 'salary days');
});
await test('security A1: a parked row that the shop data already has, or that names another karigar, is not reversed', async function(){
  var a = parkedShop(); server(a, [{status:200, body:{ok:true, journals:[srvOrig]}}, {status:200, body:{ok:true, journal_id:8}}]);
  a.S.kgLedger = [{id:'e1', opId:'op-parked-0001', type:'ISSUE', jobId:'jA', karigarId:'karA', fineMg:10000}];
  var e1 = await revParked(a, 'long enough reason'); ok(e1 && /not parked|already/i.test(e1.message), e1 && e1.message); eq(a.calls.length, 1, 'nothing posted'); eq(a.S.kgParked.length, 1);
  var b = parkedShop(); b.S.kgLedger = []; b.S.kgParked[0].entry.karigarId = 'someoneElse';
  server(b, [{status:200, body:{ok:true, journals:[srvOrig]}}, {status:200, body:{ok:true, journal_id:8}}]);
  var e2 = await revParked(b, 'long enough reason'); ok(e2 && /does not match/.test(e2.message), e2 && e2.message); eq(b.calls.length, 1, 'nothing posted');
});
await test('A3: labour accrue and pay are owner-only in the client validator; the owner is unaffected', async function(){
  var a = fresh();
  var acc = build(a, 'LABOUR_ACCRUE', {karigarId:'k1', amountPaise:250000}).journal, pay = build(a, 'LABOUR_PAY', {karigarId:'k1', amountPaise:100000}).journal;
  ok(/owner/i.test(a.kgValidateJournal(acc, 'manager')), 'manager accrue refused'); ok(/owner/i.test(a.kgValidateJournal(pay, 'manager')), 'manager pay refused');
  eq(a.kgValidateJournal(acc, 'owner'), ''); eq(a.kgValidateJournal(pay, 'owner'), '');
  var iss = build(a, 'ISSUE', {karigarId:'k1', fineMg:5000}).journal; eq(a.kgValidateJournal(iss, 'manager'), '', 'gold entries still open to a manager');
});
function asRole(a, role){ a.SAAS.user = {name:'U', email:role + '@example.com', role:role}; }
function loadFlag(a){ return new Promise(function(res){ a.kgLoadLedgerFlag(function(err, on){ res({err:err, on:on}); }); }); }
function setFlag(a, on){ return new Promise(function(res){ a.kgSetLedger(on, function(err){ res(err); }); }); }
await test('ledger flag: the server decides; a failed ask falls back to what this device last knew; never from the shop data', async function(){
  var a = fresh(); blobShop(a); asRole(a, 'owner'); a.S.kgLedgerOn = false;
  server(a, [{status:200, body:{ok:true, ledger_on:true}}]);
  var r1 = await loadFlag(a); ok(!r1.err); eq(a.S.kgLedgerOn, true); eq(a.calls[0].body.action, 'kg_status');
  server(a, ['netfail']); a.S.kgLedgerOn = false;
  var r2 = await loadFlag(a); ok(r2.err, 'reports the failure'); eq(a.S.kgLedgerOn, true, 'falls back to the last known answer');
  server(a, [{status:200, body:{ok:true, ledger_on:false}}]); await loadFlag(a); eq(a.S.kgLedgerOn, false, 'the server overrides the cache');
  server(a, [{status:200, body:{ok:true, ledger_on:true}}]); await loadFlag(a); eq(a.S.kgLedgerOn, true);
  server(a, [{status:400, body:{error:'unknown action'}}]); await loadFlag(a); eq(a.S.kgLedgerOn, false, 'a server that does not know the action means off, even with a cached on');
  var fs = require('fs'), path = require('path');
  ['00-config-state.js', '01-sync-core.js', '04-orders-detail.js', '05-auth-login.js'].forEach(function(f){
    ok(!/kgLedgerOn/.test(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8').replace(/\/\/.*$/gm, '')), f + ' never stores or restores the flag');
  });
});
await test('ledger flag: only the owner can switch it, and nothing is sent otherwise', async function(){
  var m = fresh(); blobShop(m); asRole(m, 'manager'); server(m, [{status:200, body:{ok:true, ledger_on:true}}]);
  var e = await setFlag(m, true); ok(e && /owner/i.test(e.message), e && e.message); eq(m.calls.length, 0); ok(m.S.kgLedgerOn !== true);
  var a = fresh(); blobShop(a); asRole(a, 'owner'); server(a, [{status:200, body:{ok:true, ledger_on:true}}]);
  var e2 = await setFlag(a, true); ok(!e2, e2 && e2.message); eq(a.calls[0].body.action, 'kg_set_ledger'); eq(a.calls[0].body.on, true); eq(a.S.kgLedgerOn, true);
  server(a, [{status:403, body:{error:'owner only'}}]); var e3 = await setFlag(a, false); ok(e3, 'server refusal is an error'); eq(a.S.kgLedgerOn, true, 'unchanged on refusal');
});
await test('ledger flag: Reports shows the switch to the owner only', async function(){
  var a = parkedShop(); a.S.kgLedgerOn = false; var h = a.kg2ReportsHtml();
  ok(/Ledger is off/i.test(h) && /kg2ToggleLedger\(/.test(h), 'owner sees the status and the button');
  var m = parkedShop('manager'); m.S.kgLedgerOn = true; var hm = m.kg2ReportsHtml();
  ok(/Ledger is on/i.test(hm) && !/kg2ToggleLedger\(/.test(hm), 'manager sees the status, no button');
});
function tick(ms){ return new Promise(function(res){ setTimeout(res, ms || 30); }); }
await test('opening balances screen: owner previews, confirms, and the ledger gets one OPENING per karigar who holds gold', async function(){
  var a = fresh(); blobShop(a); asRole(a, 'owner'); a.safeConfirm = function(t, m, fn){ fn(); }; a.toast = function(){};
  var h0 = a.kg2MigHtml(); ok(/Opening balances/.test(h0) && /kg2MigPreview\(/.test(h0), 'owner sees the first step');
  a.kg2MigPreview(); var h1 = a.kg2MigHtml();
  ok(/Asha/.test(h1) && /12\.345/.test(h1), 'preview lists who holds gold: ' + h1); ok(/Chitra/.test(h1) && /review/i.test(h1), 'a negative balance is shown for review, not posted');
  ok(/kg2MigRun\(/.test(h1), 'and the confirm step is offered');
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]); a.calls = [];
  a.kg2MigRun(); await tick(60);
  eq(a.calls.length, 1, 'one journal posted'); eq(a.calls[0].body.op_id, 'migr:karA'); eq(a.calls[0].body.type, 'OPENING');
  var h2 = a.kg2MigHtml(); ok(/1 opened/.test(h2), 'done summary: ' + h2);
});
await test('opening balances screen: a manager sees nothing to press; a failed post is shown with its reason', async function(){
  var m = fresh(); blobShop(m); asRole(m, 'manager'); ok(!/kg2MigPreview\(/.test(m.kg2MigHtml()), 'no button for a manager');
  var a = fresh(); blobShop(a); asRole(a, 'owner'); a.safeConfirm = function(t, m2, fn){ fn(); }; a.toast = function(){};
  a.kg2MigPreview(); server(a, [{status:422, body:{ok:false, error:'rejected', message:'ledger said no'}}]);
  a.kg2MigRun(); await tick(60);
  var h = a.kg2MigHtml(); ok(/ledger said no/.test(h) && /not opened/i.test(h), 'failure and reason shown: ' + h);
});
await test('opus 1: the flag is asked again on every refresh tick, so a phone that was open when the owner switched it on learns it', async function(){
  var fs = require('fs'), path = require('path');
  var src = fs.readFileSync(path.join(__dirname, '..', 'js', '01-sync-core.js'), 'utf8');
  ok(/setInterval\(function\(\)\{\s*try\{ kgLoadLedgerFlag\(\); \}catch\(e\)\{\}/.test(src), 'the interval body calls kgLoadLedgerFlag');
});
await test('opus 1: a brand-new device whose first ask fails does not guess "off": gold entries wait until it knows', async function(){
  var a = fresh(); entryShop(a, undefined); asRole(a, 'owner'); a.toast = function(){}; a.localStorage.removeItem(a.kgFlagKey());
  server(a, ['netfail']); var r = await loadFlag(a); ok(r.err);
  var e = issueEntry(); var res = await addEntry(a, e);
  ok(res.err && /ledger/i.test(res.err.message), 'refused: ' + (res.err && res.err.message)); eq(a.S.kgLedger.length, 0, 'nothing saved to the shop data');
  server(a, [{status:200, body:{ok:true, ledger_on:false}}]); await loadFlag(a);
  var res2 = await addEntry(a, issueEntry()); ok(!res2.err, res2.err && res2.err.message); eq(a.S.kgLedger.length, 1, 'once it knows (off), the entry saves as before');
});
await test('opus 2: the ledger took the entry but the shop save failed -> it is kept on the phone and finishes by itself', async function(){
  var a = fresh(); entryShop(a, true); a.toast = function(){};
  server(a, [{status:200, body:{ok:true, duplicate:false, journal_id:1}}]);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var e = issueEntry(); var r = await addEntry(a, e);
  ok(r.err && /Tap Save again/.test(r.err.message), r.err && r.err.message); eq(a.S.kgLedger.length, 0);
  eq(a.kgOutboxList().length, 1, 'back in the outbox with its shop-data entry'); ok(a.kgOutboxList()[0]._entry);
  a.saveToCloud = function(cb){ cb(null); }; server(a, [{status:200, body:{ok:true, duplicate:true, journal_id:1}}]);
  var f = await flush(a); ok(!f.err); eq(a.S.kgLedger.length, 1, 'the flush finished it'); eq(a.kgOutboxList().length, 0);
});
await test('opus 2: the ledger took the entry but the shop data now refuses it (job closed during the send) -> parked, not lost', async function(){
  var a = fresh(); entryShop(a, true); a.S.kgParked = []; a.toast = function(){};
  a.fetch = function(url, opts){ a.calls.push({url:url, body:JSON.parse(opts.body)}); a.S.kgJobs[0].status = 'closed';
    return Promise.resolve({status:200, json:function(){ return Promise.resolve({ok:true, duplicate:false, journal_id:2}); }}); };
  var e = issueEntry(); var r = await addEntry(a, e);
  ok(r.err && /Reports/.test(r.err.message), r.err && r.err.message); eq(a.S.kgLedger.length, 0);
  eq(a.S.kgParked.length, 1, 'parked'); eq(a.S.kgParked[0].opId, e.opId); eq(a.kgOutboxList().length, 0);
});
await test('opus 3: opening balances cannot be posted once the ledger is on (they would double the gold)', async function(){
  var a = fresh(); blobShop(a); asRole(a, 'owner'); a.S.kgLedgerOn = true;
  var pre = await new Promise(function(res){ a.kgMigrateBlobToLedger(function(err, rep){ res({err:err, rep:rep}); }, {dryRun:true}); });
  ok(pre.err && /already on/i.test(pre.err.message), pre.err && pre.err.message);
  var h = a.kg2MigHtml(); ok(!/kg2MigPreview\(/.test(h) && /already on/i.test(h), 'no buttons, says why: ' + h);
});
await test('opus 4: signing out warns about refused entries and about queued entries of other shops on this phone', async function(){
  var a = fresh(); a.SAAS.shop = {id:'shop-1'}; var seen = null;
  a.safeConfirm = function(title, msg, yes, danger){ seen = {msg:msg, danger:danger}; };
  a.localStorage.setItem('kg_outbox_rejected::shop-1', JSON.stringify([{journal:{type:'ISSUE', lines:[]}, why:'refused', at:'2026-11-06T00:00:00Z'}]));
  a.saasLogout(); ok(seen && /refused/i.test(seen.msg) && seen.danger === true, 'refused list counted: ' + (seen && seen.msg));
  a.localStorage.removeItem('kg_outbox_rejected::shop-1'); seen = null;
  a.localStorage.setItem('kg_outbox::shop-2', JSON.stringify([{op_id:'op-x-000001', type:'ISSUE', lines:[], _by:'u'}]));
  a.saasLogout(); ok(seen && /1 gold entry/i.test(seen.msg), 'queue of another shop counted: ' + (seen && seen.msg));
  a.localStorage.removeItem('kg_outbox::shop-2');
});
await test('opus 5: a "different content" refusal says the ledger may already have it; the accepted-date memory survives sign-out', async function(){
  var a = fresh(); entryShop(a, true); a.toast = function(){};
  server(a, [{status:422, body:{ok:false, error:'rejected', message:'op_id already used with different content'}}]);
  var e = issueEntry(); await addEntry(a, e);
  var rej = a.kgRejectedList(); eq(rej.length, 1); ok(/may already have/i.test(rej[0].why), rej[0].why);
  a.SAAS.shop = {id:'shop-1'}; a.localStorage.setItem('kg_outbox_posted::shop-1', JSON.stringify([{op:'op-p-000001', d:'2026-11-05'}]));
  a._clearDeviceSession(); ok(a.localStorage.getItem('kg_outbox_posted::shop-1'), 'posted dates are not wiped by sign-out');
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
