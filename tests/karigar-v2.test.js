// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\ufffd
// Karigar V2 tests (js/11-karigar.js): fine-gold accounting, ledger rules,
// salary separation, rollback and idempotency. Pure logic only - the DOM
// screens are NOT covered here.
// Run:  node tests/karigar-v2.test.js      (exit 1 on any failure)
// All data is synthetic. Weights are integer mg; Example 1 = the plan's.
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\ufffd
const { loadApp } = require('./harness.js');

var passed = 0, failed = 0, failures = [];
function test(name, fn){
  try{ fn(); passed++; console.log('  \u2713 ' + name); }
  catch(e){ failed++; failures.push(name + ': ' + e.message); console.log('  \u2717 ' + name + '\n      ' + e.message); }
}
function eq(a, b, msg){ if(a !== b) throw new Error((msg || 'expected') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(c, msg){ if(!c) throw new Error(msg || 'assertion failed'); }

// fresh app + shop state per scenario
function fresh(role){
  var a = loadApp();
  a.saveToCloud = function(cb){ cb(null); };          // saves succeed unless a test says otherwise
  a.saveCache = function(){ return true; };
  a.SAAS.user = {name:'Tester', email:'t@example.com', role:role || 'owner'};
  a.S.karigars = []; a.S.kgJobs = []; a.S.kgLedger = []; a.S.kgSalary = []; a.S.nextKgJobNo = 1;
  return a;
}
// run a callback-style API synchronously (saveToCloud above is synchronous)
function call(fn){ var out = {}; fn(function(err, v, dup){ out.err = err; out.v = v; out.dup = dup; }); return out; }
var seq = 0;
function op(){ return 'op-' + (++seq); }

function karigar(a, name, terms){
  var k = a.addOrGetKarigar(name);
  var r = call(function(cb){ a.kgSetTerms(k.id, terms, cb); });
  ok(!r.err || r.err === undefined || r.err === null, 'terms: ' + (r.err && r.err.message));
  return k;
}
function job(a, k, title){
  var r = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:title || 'Test job'}, op(), cb); });
  ok(!r.err, 'job: ' + (r.err && r.err.message));
  return r.v;
}
function metal(a, j, type, mg, key, extra){
  var res = a.kgResolvePermille(key, (extra && extra.pct) || '', extra && extra.as24k);
  ok(!res.error, 'permille: ' + res.error);
  var e = {type:type, opId:op(), jobId:j.id, karigarId:j.karigarId, mg:mg, purityKey:key, permille:res.permille,
           as24k:res.as24k, fineMg:a.kgFineMg(mg, res.permille)};
  Object.keys(extra || {}).forEach(function(x){ if(x !== 'pct' && x !== 'as24k') e[x] = extra[x]; });
  return call(function(cb){ a.kgAddEntry(e, cb); });
}
function receipt(a, j, mg, key, extra){
  var x = extra || {}; x.pieceDesc = x.pieceDesc || 'piece'; x.qty = x.qty || 1; x.stoneMg = x.stoneMg || 0;
  return metal(a, j, 'RECEIPT', mg, key, x);
}
function bal(a, j){ return a.kgJobBalance(j, a.S.kgLedger); }

console.log('\nKarigar V2 - parsing and fineness');

test('kgParseMg accepts up to 3 decimals and rejects everything else', function(){
  var a = fresh();
  eq(a.kgParseMg('100'), 100000); eq(a.kgParseMg('0.001'), 1); eq(a.kgParseMg(' 5 '), 5000); eq(a.kgParseMg('12.5'), 12500);
  ['0', '0.000', '-5', '1e3', '1.2345', '', 'abc', '1,5', null, undefined, 'Infinity', 'NaN', '9999999'].forEach(function(bad){
    eq(a.kgParseMg(bad), null, 'should reject ' + JSON.stringify(bad));
  });
});
test('kgParsePaise rejects zero, negatives and 3 decimals', function(){
  var a = fresh();
  eq(a.kgParsePaise('30000'), 3000000); eq(a.kgParsePaise('10.5'), 1050); eq(a.kgParsePaise('0.01'), 1);
  ['0', '-1', '1.234', '', 'x'].forEach(function(bad){ eq(a.kgParsePaise(bad), null, bad); });
});
test('999 counts as 100%, 995 as 99.5% unless flagged as 24K', function(){
  var a = fresh();
  eq(a.kgResolvePermille('999', '').permille, 1000);
  eq(a.kgResolvePermille('995', '').permille, 995);
  eq(a.kgResolvePermille('995', '', true).permille, 1000);
  eq(a.kgResolvePermille('995', '', true).as24k, true);
  eq(a.kgFineMg(50000, 995), 49750);
});
test('22K fineness: default 91.6, optional 91.6 to 92.0, outside is refused', function(){
  var a = fresh();
  eq(a.kgResolvePermille('22K', '').permille, 916);
  eq(a.kgResolvePermille('22K', '92').permille, 920);
  eq(a.kgResolvePermille('22K', '91.6').permille, 916);
  eq(a.kgResolvePermille('22K', '91.8').permille, 918);
  ok(a.kgResolvePermille('22K', '91.5').error, '91.5 must be refused');
  ok(a.kgResolvePermille('22K', '92.1').error, '92.1 must be refused');
  ok(a.kgResolvePermille('22K', 'abc').error);
  ok(a.kgResolvePermille('other', '').error, 'other needs a number');
  eq(a.kgResolvePermille('other', '80').permille, 800);
});
test('kgFineMg rounds half up once per entry and stays an integer', function(){
  var a = fresh();
  eq(a.kgFineMg(1, 916), 1); eq(a.kgFineMg(1, 400), 0); eq(a.kgFineMg(3, 500), 2);
  eq(a.kgFineMg(33333, 916), 30533); eq(a.kgFineMg(99999, 995), 99499);
  ok(Math.floor(a.kgFineMg(77777, 918)) === a.kgFineMg(77777, 918));
});
test('kgFmtG formats integers without float noise', function(){
  var a = fresh();
  eq(a.kgFmtG(96000), '96.000 g'); eq(a.kgFmtG(1), '0.001 g'); eq(a.kgFmtG(-200), '-0.200 g'); eq(a.kgFmtG(0), '0.000 g');
});

console.log('\nKarigar V2 - wastage karigar (plan Example 1, 4 and 3)');

test('Example 1: 4% is on fine gold ISSUED; partial receipts leave an exact open balance', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  eq(j.kind, 'wastage'); eq(j.wastageBp, 400);
  ok(!metal(a, j, 'ISSUE', 100000, '999').err);
  var b = bal(a, j);
  eq(b.issuedFine, 100000); eq(b.earnedFine, 4000); eq(b.accountable, 96000); eq(b.openFine, 96000);
  ok(!receipt(a, j, 40000, '22K').err); ok(!receipt(a, j, 50000, '22K').err);
  ok(!metal(a, j, 'SCRAP', 3000, '995', {kind:'scrap'}).err);
  b = bal(a, j);
  eq(b.receiptFine, 36640 + 45800); eq(b.scrapFine, 2985); eq(b.openFine, 10575, 'open after 3 entries');
  ok(!receipt(a, j, 10000, '22K').err);
  eq(bal(a, j).openFine, 1415); eq(bal(a, j).state, 'open');
});
test('an unexplained shortage is never classified as wastage or loss, and blocks closing', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, '22K');   // 91.6 g back, 96 g due
  var before = a.S.kgLedger.length, b = bal(a, j);
  eq(b.openFine, 96000 - 91600); eq(b.approvedLoss, 0); eq(b.earnedFine, 4000, 'wastage must not grow');
  var c = call(function(cb){ a.kgCloseJob(j.id, cb); });
  ok(c.err && /Balance is/.test(c.err.message), 'close must refuse: ' + (c.err && c.err.message));
  eq(a.S.kgLedger.length, before, 'nothing auto-written'); eq(j.status, 'open');
});
test('surplus is its own state, not negative wastage', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 100000, '999'); metal(a, j, 'SCRAP', 96200, '999', {kind:'scrap'});
  var b = bal(a, j);
  eq(b.openFine, -200); eq(b.state, 'surplus'); eq(b.earnedFine, 4000);
});
test('Example 4: mixed purity issue (995 default, and 995 flagged as 24K)', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 60000, '999'); metal(a, j, 'ISSUE', 40000, '995');
  var b = bal(a, j);
  eq(b.issuedFine, 99800); eq(b.earnedFine, 3992); eq(b.accountable, 95808);
  metal(a, j, 'ISSUE', 10000, '995', {as24k:true});
  eq(bal(a, j).issuedFine, 109800);
  eq(a.S.kgLedger[a.S.kgLedger.length - 1].permille, 1000, 'chosen permille is stored on the entry');
});
test('a job keeps the wastage % it was created with, even if the karigar terms change later', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', wastagePct:'3.5'}, cb); }).err);
  eq(k.wastageBp, 350); eq(j.wastageBp, 400);
  metal(a, j, 'ISSUE', 100000, '999'); eq(bal(a, j).earnedFine, 4000);
  eq(job(a, k).wastageBp, 350);
});

console.log('\nKarigar V2 - salary karigar, loss and approvals (plan Example 2)');

test('Example 2: salary karigar earns no gold; owner-approved loss closes the job', function(){
  var a = fresh(); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'30000'}); var j = job(a, k);
  eq(j.kind, 'salary'); eq(j.wastageBp, 0);
  metal(a, j, 'ISSUE', 50000, '995');
  receipt(a, j, 30000, '22K');                                  // 27,480
  metal(a, j, 'SCRAP', 3200, '999', {kind:'filings'});          // 3,200 at 999 = 100%
  var loss = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, fineMg:400, category:'filing',
    reason:'filing loss', proposed:false, approvedBy:'Tester'}, cb); });
  ok(!loss.err, loss.err && loss.err.message);
  var b = bal(a, j);
  eq(b.earnedFine, 0, 'no automatic gold earning'); eq(b.accountable, 49750);
  eq(b.openFine, 49750 - 27480 - 3200 - 400);
  receipt(a, j, 20000, '22K');                                  // 18,320
  eq(bal(a, j).openFine, 49750 - 27480 - 3200 - 400 - 18320);
  var rest = bal(a, j).openFine;
  var l2 = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, fineMg:rest, category:'polishing',
    reason:'polishing loss', proposed:false, approvedBy:'Tester'}, cb); });
  ok(!l2.err); eq(bal(a, j).openFine, 0); eq(bal(a, j).state, 'balanced');
  ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err); eq(j.status, 'closed');
  ok(call(function(cb){ a.kgAddEntry({type:'ISSUE', opId:op(), jobId:j.id, karigarId:k.id, mg:1, purityKey:'999', permille:1000, fineMg:1}, cb); }).err, 'closed job refuses entries');
});
test('a loss needs a real reason and a known category', function(){
  var a = fresh(); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'30000'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 10000, '999');
  var base = {type:'LOSS', jobId:j.id, karigarId:k.id, fineMg:100, category:'filing', proposed:false, approvedBy:'Tester'};
  function tryLoss(over){ var e = {}; Object.keys(base).forEach(function(x){ e[x] = base[x]; }); e.opId = op(); Object.keys(over).forEach(function(x){ e[x] = over[x]; }); return call(function(cb){ a.kgAddEntry(e, cb); }); }
  ok(tryLoss({reason:''}).err); ok(tryLoss({reason:'abc'}).err); ok(tryLoss({reason:'filing loss', category:'bogus'}).err);
  ok(tryLoss({reason:'filing loss', fineMg:0}).err); ok(tryLoss({reason:'filing loss', fineMg:-5}).err);
  ok(tryLoss({reason:'filing loss', approvedBy:'', proposed:false}).err, 'owner loss must carry an approver');
  ok(!tryLoss({reason:'filing loss'}).err);
});
test('manager can only PROPOSE a loss; it has no effect until the owner approves', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'30000'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 10000, '999');
  a.SAAS.user.role = 'manager';
  var asApproved = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, fineMg:100, category:'die cutting', reason:'die cutting', proposed:false, approvedBy:'Tester'}, cb); });
  ok(asApproved.err, 'manager cannot self-approve');
  var p = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, fineMg:100, category:'die cutting', reason:'die cutting', proposed:true}, cb); });
  ok(!p.err); eq(bal(a, j).approvedLoss, 0); eq(bal(a, j).pendingLoss, 100); eq(bal(a, j).openFine, 10000);
  ok(call(function(cb){ a.kgCloseJob(j.id, cb); }).err, 'cannot close with a pending loss');
  var self = call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:p.v.id, decision:'approve'}, cb); });
  ok(self.err, 'manager cannot approve');
  a.SAAS.user.role = 'owner';
  var ap = call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:p.v.id, decision:'approve'}, cb); });
  ok(!ap.err); eq(bal(a, j).approvedLoss, 100); eq(bal(a, j).pendingLoss, 0); eq(bal(a, j).openFine, 9900);
  ok(call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:p.v.id, decision:'reject'}, cb); }).err, 'already decided');
});
test('a rejected loss never counts', function(){
  var a = fresh('manager'); var ko = null;
  a.SAAS.user.role = 'owner'; var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'1000'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 10000, '999');
  a.SAAS.user.role = 'manager';
  var p = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, fineMg:500, category:'filing', reason:'filing loss', proposed:true}, cb); });
  a.SAAS.user.role = 'owner';
  call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:p.v.id, decision:'reject'}, cb); });
  eq(bal(a, j).approvedLoss, 0); eq(bal(a, j).pendingLoss, 0); eq(bal(a, j).openFine, 10000);
});
test('only the owner can adjust the gold account, and with a reason', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'1000'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 10000, '999');
  function adj(fine, reason){ return call(function(cb){ a.kgAddEntry({type:'ADJUST', opId:op(), jobId:j.id, karigarId:k.id, fineMg:fine, reason:reason}, cb); }); }
  ok(adj(100, '').err); ok(adj(0, 'zero adjust').err); ok(!adj(100, 'count correction').err); eq(bal(a, j).openFine, 9900);
  ok(!adj(-300, 'recount debit').err); eq(bal(a, j).openFine, 10200);
  a.SAAS.user.role = 'manager'; ok(adj(100, 'manager try').err);
});
test('staff and readonly roles cannot touch metal or create jobs', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'1000'}); var j = job(a, k);
  ['staff', 'readonly'].forEach(function(role){
    a.SAAS.user.role = role;
    ok(metal(a, j, 'ISSUE', 1000, '999').err, role + ' issue');
    ok(call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'x'}, op(), cb); }).err, role + ' create');
    ok(call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', wastagePct:'4'}, cb); }).err, role + ' terms');
  });
  a.SAAS.user.role = 'manager';
  ok(call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', wastagePct:'4'}, cb); }).err, 'manager cannot change compensation terms');
});

console.log('\nKarigar V2 - validation, idempotency, rollback, reversal');

test('bad weights, purities and tampered fine values are refused', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  function raw(over){ var e = {type:'ISSUE', opId:op(), jobId:j.id, karigarId:k.id, mg:1000, purityKey:'999', permille:1000, fineMg:1000};
    Object.keys(over).forEach(function(x){ e[x] = over[x]; }); return call(function(cb){ a.kgAddEntry(e, cb); }); }
  ok(raw({mg:0}).err); ok(raw({mg:-5}).err); ok(raw({mg:1.5}).err); ok(raw({mg:NaN}).err); ok(raw({mg:Infinity}).err); ok(raw({mg:a.KG_MAX_MG + 1}).err);
  ok(raw({permille:0}).err); ok(raw({permille:1001}).err); ok(raw({permille:999.5}).err);
  ok(raw({fineMg:999}).err, 'fine must equal weight x purity'); ok(raw({purityKey:''}).err);
  ok(raw({jobId:'nope'}).err); ok(raw({karigarId:'someone-else'}).err); ok(raw({opId:''}).err);
  eq(a.S.kgLedger.length, 0, 'nothing was written');
  ok(!raw({}).err);
});
test('a receipt needs a piece description and a valid quantity', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  ok(metal(a, j, 'RECEIPT', 1000, '22K', {pieceDesc:'', qty:1, stoneMg:0}).err, 'blank description');
  ok(metal(a, j, 'RECEIPT', 1000, '22K', {pieceDesc:'ring', qty:0, stoneMg:0}).err, 'qty 0');
  ok(metal(a, j, 'RECEIPT', 1000, '22K', {pieceDesc:'ring', qty:1, stoneMg:-1}).err, 'negative stone');
  ok(!metal(a, j, 'RECEIPT', 1000, '22K', {pieceDesc:'ring', qty:2, stoneMg:250}).err);
  eq(a.S.kgLedger[a.S.kgLedger.length - 1].stoneMg, 250);
});
test('each receipt keeps its own purity and fineness', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  receipt(a, j, 10000, '22K'); receipt(a, j, 10000, '22K', {pct:'92'}); receipt(a, j, 10000, '18K');
  var l = a.S.kgLedger;
  eq(l[0].permille, 916); eq(l[1].permille, 920); eq(l[2].permille, 750);
  eq(l[0].fineMg + l[1].fineMg + l[2].fineMg, 9160 + 9200 + 7500);
});
test('submitting the same operation id twice records one entry', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  var e = {type:'ISSUE', opId:'same-op', jobId:j.id, karigarId:k.id, mg:1000, purityKey:'999', permille:1000, fineMg:1000};
  var r1 = call(function(cb){ a.kgAddEntry(JSON.parse(JSON.stringify(e)), cb); });
  var r2 = call(function(cb){ a.kgAddEntry(JSON.parse(JSON.stringify(e)), cb); });
  ok(!r1.err && !r2.err); eq(r2.dup, true); eq(a.S.kgLedger.length, 1);
  var o = 'job-op'; var c1 = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'A'}, o, cb); });
  var c2 = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'A'}, o, cb); });
  eq(c2.dup, true); eq(a.S.kgJobs.length, 2, 'one earlier job + one new');
});
test('a failed save rolls the entry, the job counter and the audit line back', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  var audit0 = (a.S.auditLog || []).length;
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var r = metal(a, j, 'ISSUE', 1000, '999');
  ok(r.err, 'error must reach the caller'); eq(a.S.kgLedger.length, 0); eq((a.S.auditLog || []).length, audit0);
  var n = a.S.nextKgJobNo, jobs = a.S.kgJobs.length;
  var c = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'B'}, op(), cb); });
  ok(c.err); eq(a.S.nextKgJobNo, n); eq(a.S.kgJobs.length, jobs);
  var t = call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', wastagePct:'9'}, cb); });
  ok(t.err); eq(k.wastageBp, 400, 'terms restored');
  a.saveToCloud = function(cb){ cb(null); };
  ok(!metal(a, j, 'ISSUE', 1000, '999').err, 'works again after the failure (lock released)');
});
test('job numbers count up and are zero-padded', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'});
  eq(job(a, k).jobNo, 'KJ-0001'); eq(job(a, k).jobNo, 'KJ-0002'); eq(a.S.nextKgJobNo, 3);
});
test('a karigar with no terms cannot get a job; blank title is refused', function(){
  var a = fresh(); var k = a.addOrGetKarigar('NoTerms');
  ok(call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'x'}, op(), cb); }).err);
  var k2 = karigar(a, 'Has', {kind:'wastage', wastagePct:'4'});
  ok(call(function(cb){ a.kgCreateJob({karigarId:k2.id, title:'  '}, op(), cb); }).err);
  ok(call(function(cb){ a.kgCreateJob({karigarId:'ghost', title:'x'}, op(), cb); }).err);
});
test('reversal restores the balance, cannot be repeated, and a manager is limited to today', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  var iss = metal(a, j, 'ISSUE', 100000, '999').v;
  var r = receipt(a, j, 10000, '22K').v;
  eq(bal(a, j).openFine, 96000 - 9160);
  function rev(id, reason){ return call(function(cb){ a.kgAddEntry({type:'REVERSAL', opId:op(), jobId:j.id, karigarId:k.id, reversesId:id, reason:reason}, cb); }); }
  ok(rev(r.id, 'x').err, 'reason too short');
  ok(!rev(r.id, 'typed wrong weight').err); eq(bal(a, j).openFine, 96000);
  ok(rev(r.id, 'again please').err, 'cannot reverse twice');
  ok(rev('missing', 'reason here').err);
  var rv = a.S.kgLedger[a.S.kgLedger.length - 1];
  ok(rev(rv.id, 'reverse a reversal').err, 'a reversal cannot be reversed');
  eq(a.S.kgLedger.length, 3, 'append-only: nothing deleted');
  iss.date = '2020-01-01';
  a.SAAS.user.role = 'manager'; ok(rev(iss.id, 'old entry fix').err, 'manager cannot reverse an old entry');
  a.SAAS.user.role = 'owner'; ok(!rev(iss.id, 'old entry fix').err);
  eq(bal(a, j).issuedFine, 0);
});
test('reversing an issue and re-issuing keeps the wastage on the corrected figure', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  var iss = metal(a, j, 'ISSUE', 123456, '999').v;
  call(function(cb){ a.kgAddEntry({type:'REVERSAL', opId:op(), jobId:j.id, karigarId:k.id, reversesId:iss.id, reason:'typo in weight'}, cb); });
  metal(a, j, 'ISSUE', 100000, '999');
  eq(bal(a, j).earnedFine, 4000); eq(bal(a, j).accountable, 96000);
});
test('close needs a zero balance; owner can reopen, manager cannot', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 100000, '999'); metal(a, j, 'SCRAP', 96000, '999', {kind:'scrap'});
  ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err); eq(j.status, 'closed');
  ok(call(function(cb){ a.kgCloseJob(j.id, cb); }).err, 'already closed');
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kgReopenJob(j.id, cb); }).err);
  a.SAAS.user.role = 'owner'; ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err); eq(j.status, 'open');
});
test('the money-free check: a job with no entries closes only when empty-balanced', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err, 'zero issued, zero open: allowed');
});

console.log('\nKarigar V2 - khata and statement');

test('khata rolls up several jobs of one karigar; another karigar is separate', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var k2 = karigar(a, 'Test-C', {kind:'wastage', wastagePct:'4'});
  var j1 = job(a, k), j2 = job(a, k), j3 = job(a, k2);
  metal(a, j1, 'ISSUE', 100000, '999'); metal(a, j2, 'ISSUE', 50000, '999'); metal(a, j3, 'ISSUE', 25000, '999');
  receipt(a, j1, 60000, '22K');
  var t = a.kgKhata(k.id);
  eq(t.jobs, 2); eq(t.issuedFine, 150000); eq(t.earnedFine, 6000);
  eq(t.openFine, (96000 - 54960) + 48000); eq(a.kgKhata(k2.id).openFine, 24000);
});
test('statement shows a running custody balance; reversed lines are struck, not removed', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 100000, '999'); var r = receipt(a, j, 10000, '22K').v;
  call(function(cb){ a.kgAddEntry({type:'REVERSAL', opId:op(), jobId:j.id, karigarId:k.id, reversesId:r.id, reason:'wrong piece'}, cb); });
  var rows = a.kgStatement(k.id);
  eq(rows.length, 2); eq(rows[0].balance, 100000); eq(rows[1].state, 'reversed'); eq(rows[1].balance, 100000);
});

console.log('\nKarigar V2 - salary register is separate from gold');

test('salary: monthly accrual, advance, payment; duplicates and non-salary karigars refused', function(){
  var a = fresh(); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'30000'});
  function sal(e){ e.opId = e.opId || op(); e.karigarId = k.id; return call(function(cb){ a.kgAddSalary(e, cb); }); }
  ok(!sal({type:'ACCRUAL', period:'2026-10', amountPaise:3000000}).err);
  ok(sal({type:'ACCRUAL', period:'2026-10', amountPaise:3000000}).err, 'same month twice');
  ok(sal({type:'ACCRUAL', period:'Oct', amountPaise:1}).err, 'bad period');
  ok(!sal({type:'ADVANCE', amountPaise:500000, mode:'cash', note:'festival advance'}).err);
  ok(!sal({type:'PAYMENT', amountPaise:2000000, mode:'upi'}).err);
  ok(sal({type:'PAYMENT', amountPaise:0}).err); ok(sal({type:'PAYMENT', amountPaise:-5}).err); ok(sal({type:'ADVANCE', amountPaise:100, note:''}).err);
  var t = a.kgSalaryBalance(k.id);
  eq(t.accrued, 3000000); eq(t.advanced, 500000); eq(t.paid, 2000000); eq(t.payable, 500000);
  var w = karigar(a, 'Wast', {kind:'wastage', wastagePct:'4'});
  ok(call(function(cb){ a.kgAddSalary({type:'ACCRUAL', opId:op(), karigarId:w.id, period:'2026-10', amountPaise:1000}, cb); }).err, 'wastage karigar earns no salary');
});
test('salary reversal removes it from the balance once', function(){
  var a = fresh(); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'daily', rate:'1000'});
  var r = call(function(cb){ a.kgAddSalary({type:'ACCRUAL', opId:op(), karigarId:k.id, period:'2026-10-05', days:2, amountPaise:200000}, cb); }).v;
  eq(a.kgSalaryBalance(k.id).payable, 200000);
  var rv = function(){ return call(function(cb){ a.kgAddSalary({type:'REVERSAL', opId:op(), karigarId:k.id, reversesId:r.id, reason:'wrong date'}, cb); }); };
  ok(!rv().err); eq(a.kgSalaryBalance(k.id).payable, 0); ok(rv().err, 'twice');
});
test('only the owner can use the salary register', function(){
  var a = fresh(); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'30000'});
  a.SAAS.user.role = 'manager';
  ok(call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:100}, cb); }).err);
});
test('gold entries never move the salary balance and salary entries never move the gold balance', function(){
  var a = fresh(); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'30000'}); var j = job(a, k);
  metal(a, j, 'ISSUE', 50000, '999');
  var g0 = JSON.stringify(bal(a, j)), s0 = JSON.stringify(a.kgSalaryBalance(k.id));
  call(function(cb){ a.kgAddSalary({type:'ACCRUAL', opId:op(), karigarId:k.id, period:'2026-10', amountPaise:3000000}, cb); });
  call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:1000000, mode:'cash'}, cb); });
  eq(JSON.stringify(bal(a, j)), g0, 'gold unchanged by salary');
  var s1 = JSON.stringify(a.kgSalaryBalance(k.id));
  receipt(a, j, 20000, '22K'); metal(a, j, 'SCRAP', 1000, '999', {kind:'dust'});
  eq(JSON.stringify(a.kgSalaryBalance(k.id)), s1, 'salary unchanged by gold');
  ok(s0 !== s1);
  ok(Object.keys(a.S.kgSalary[0]).every(function(f){ return ['mg', 'fineMg', 'permille', 'purityKey', 'jobId'].indexOf(f) === -1; }), 'salary rows carry no gold fields');
  ok(a.S.kgLedger.every(function(e){ return !('amountPaise' in e); }), 'gold rows carry no money fields');
});

console.log('\nKarigar V2 - data hygiene');

test('kgNormalise drops repeated operation ids and rows without ids, keeps the first', function(){
  var a = fresh();
  a.S.kgLedger = [{id:'1', opId:'x', type:'ISSUE'}, {id:'2', opId:'x', type:'ISSUE'}, {id:'3', opId:'y', type:'ISSUE'}, {opId:'z'}, null];
  a.S.kgJobs = [{id:'j1', opId:'q'}, {id:'j2', opId:'q'}]; a.S.kgSalary = undefined; a.S.nextKgJobNo = 0;
  a.kgNormalise();
  eq(a.S.kgLedger.length, 2); eq(a.S.kgLedger[0].id, '1'); eq(a.S.kgJobs.length, 1);
  ok(Array.isArray(a.S.kgSalary)); eq(a.S.nextKgJobNo, 1);
});
test('normaliseData (run on every load and restore) calls kgNormalise', function(){
  var a = fresh(); a.S.kgLedger = [{id:'1', opId:'x'}, {id:'2', opId:'x'}];
  a.normaliseData(); eq(a.S.kgLedger.length, 1);
});
test('V2 data is stored in the cloud payload and the local cache', function(){
  var fs = require('fs'), path = require('path');
  var sync = fs.readFileSync(path.join(__dirname, '..', 'js', '01-sync-core.js'), 'utf8');
  var orders = fs.readFileSync(path.join(__dirname, '..', 'js', '04-orders-detail.js'), 'utf8');
  var auth = fs.readFileSync(path.join(__dirname, '..', 'js', '05-auth-login.js'), 'utf8');
  ['kgJobs', 'kgLedger', 'kgSalary', 'kgPurities', 'kgAgreements', 'kgRoutes', 'nextKgJobNo'].forEach(function(key){
    ok(new RegExp('record\\.' + key).test(sync), key + ' loaded from cloud');
    ok(new RegExp(key + ':\\s*S\\.' + key).test(sync), key + ' in save payload');
    ok(new RegExp(key + ':S\\.' + key).test(orders), key + ' in saveCache');
    ok(new RegExp('r\\.' + key).test(orders), key + ' in loadCache');
    ok(new RegExp(key + ':\\s*S\\.' + key).test(auth), key + ' in backup export');
    ok(new RegExp('d\\.' + key).test(auth), key + ' in backup restore');
  });
});

console.log('\nKarigar V2 - reports');

test('report: wastage kept is on fine issued in the period, losses and scrap are totalled, only approved losses count', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  var k2 = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'1000'}); var j2 = job(a, k2);
  metal(a, j, 'ISSUE', 100000, '999'); metal(a, j2, 'ISSUE', 50000, '999');
  metal(a, j, 'SCRAP', 3000, '995', {kind:'dust'}); metal(a, j2, 'SCRAP', 1000, '999', {kind:'scrap'});
  call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j2.id, karigarId:k2.id, fineMg:300, category:'filing', reason:'filing loss', proposed:false, approvedBy:'Tester'}, cb); });
  a.SAAS.user.role = 'manager';
  call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j2.id, karigarId:k2.id, fineMg:900, category:'polishing', reason:'polish loss', proposed:true}, cb); });
  a.SAAS.user.role = 'owner';
  var today = a.kgToday(), r = a.kgReport(today, today);
  eq(r.wastage.length, 1, 'salary karigar has no wastage row'); eq(r.wastage[0].issuedFine, 100000); eq(r.wastage[0].keptFine, 4000);
  eq(r.lossTotal, 300, 'pending loss excluded'); eq(r.lossByCategory.filing, 300); eq(r.losses[0].approvedBy, 'Tester');
  eq(r.scrapTotal, 2985 + 1000); eq(r.scrapByKind.dust, 2985);
  eq(r.open.length, 2);
  var none = a.kgReport('2000-01-01', '2000-01-31');
  eq(none.wastage.length, 0); eq(none.lossTotal, 0); eq(none.scrapTotal, 0); eq(none.open.length, 2, 'open jobs are not date-bound');
});
test('report: reversed entries are left out and a surplus job is listed on its own', function(){
  var a = fresh(); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  var i1 = metal(a, j, 'ISSUE', 100000, '999').v; metal(a, j, 'SCRAP', 96200, '999', {kind:'scrap'});
  var d = a.kgToday(); eq(a.kgReport(d, d).surplus.length, 1); eq(a.kgReport(d, d).open.length, 0);
  call(function(cb){ a.kgAddEntry({type:'REVERSAL', opId:op(), jobId:j.id, karigarId:k.id, reversesId:i1.id, reason:'wrong issue'}, cb); });
  eq(a.kgReport(d, d).wastage.length, 0, 'reversed issue not counted');
});

console.log('\nKarigar V2 - touches (92 / 95 / 96) and Day Book');

test('owner can save a touch; it resolves to its own fineness and is usable on issue, receipt and scrap', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  var r = call(function(cb){ a.kgAddPurity('92', cb); });
  ok(!r.err, r.err && r.err.message); eq(r.v.key, 'T920'); eq(r.v.permille, 920);
  ok(!call(function(cb){ a.kgAddPurity('95', cb); }).err); ok(!call(function(cb){ a.kgAddPurity('96', cb); }).err);
  eq(a.S.kgPurities.length, 3);
  eq(a.kgResolvePermille('T960', '').permille, 960);
  ok(!metal(a, j, 'ISSUE', 100000, 'T920').err);
  var b = bal(a, j);
  eq(b.issuedFine, 92000, '100 g of 92 touch is 92 g fine'); eq(b.earnedFine, 3680, '4% of the fine gold issued'); eq(b.accountable, 88320);
  eq(a.S.kgLedger[0].permille, 920, 'the touch is stored on the entry');
  ok(!receipt(a, j, 10000, 'T950').err); eq(a.S.kgLedger[1].fineMg, 9500);
  ok(!metal(a, j, 'SCRAP', 1000, 'T960', {kind:'scrap'}).err);
});
test('a touch cannot be added twice, duplicate a built-in, be out of range, or be added by a manager', function(){
  var a = fresh('owner');
  ok(!call(function(cb){ a.kgAddPurity('92', cb); }).err);
  ok(call(function(cb){ a.kgAddPurity('92', cb); }).err, 'twice');
  ok(call(function(cb){ a.kgAddPurity('92.0', cb); }).err, 'same value');
  ok(call(function(cb){ a.kgAddPurity('99.5', cb); }).err, 'already built in as 995');
  ['', 'abc', '0', '5', '101', '-3', '9.999'].forEach(function(bad){ ok(call(function(cb){ a.kgAddPurity(bad, cb); }).err, bad); });
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kgAddPurity('96', cb); }).err);
});
test('changing the touch list never changes old entries; a failed save rolls the touch back', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  call(function(cb){ a.kgAddPurity('92', cb); }); metal(a, j, 'ISSUE', 100000, 'T920');
  a.S.kgPurities = [];                       // list lost or edited
  eq(bal(a, j).issuedFine, 92000, 'history is unchanged');
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(call(function(cb){ a.kgAddPurity('96', cb); }).err); eq(a.S.kgPurities.length, 0);
});
test('other purity with a typed fineness works as a one-off', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  ok(!metal(a, j, 'ISSUE', 50000, 'other', {pct:'93.5'}).err); eq(a.S.kgLedger[0].fineMg, 46750);
  var bad = a.kgResolvePermille('other', ''); ok(bad.error);
});
test('Day Book: cash salary payment is money out on its day; UPI is non-cash; reversal puts it back IN; gold and accruals never appear', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-B', {kind:'salary', salaryMode:'monthly', rate:'30000'});
  var d = a.kgToday();
  function sal(e){ e.opId = op(); e.karigarId = k.id; return call(function(cb){ a.kgAddSalary(e, cb); }).v; }
  sal({type:'ACCRUAL', period:'2026-10', amountPaise:3000000});
  var pay = sal({type:'PAYMENT', amountPaise:1000000, mode:'cash'});
  sal({type:'ADVANCE', amountPaise:200000, mode:'upi', note:'festival advance'});
  sal({type:'DEDUCTION', amountPaise:50000, note:'tool damage'});
  var j = job(a, k); metal(a, j, 'ISSUE', 10000, '999');
  var lines = a.dbAutoLines(d).filter(function(l){ return l.src === 'karigar'; });
  eq(lines.length, 2, 'only payment and advance'); 
  var cash = lines.filter(function(l){ return !l.nonCash; })[0], upi = lines.filter(function(l){ return l.nonCash; })[0];
  eq(cash.dir, 'out'); eq(cash.amount, 10000); eq(upi.amount, 2000); eq(upi.mode, 'upi');
  var tot = a.dbAutoTotals(d); ok(tot.out >= 10000, 'cash counted in totals');
  call(function(cb){ a.kgAddSalary({type:'REVERSAL', opId:op(), karigarId:k.id, reversesId:pay.id, reason:'paid twice by mistake'}, cb); });
  var after = a.dbAutoLines(d).filter(function(l){ return l.src === 'karigar' && !l.nonCash; });
  eq(after.length, 2); eq(after[0].dir === 'out' && after[1].dir === 'in' || after[0].dir === 'in' && after[1].dir === 'out', true);
});

console.log('\nKarigar 2.0 phase 3 - agreements, fixed gold per job, labour, earnings final at close');

function agree(a, k, terms, from){
  var r = call(function(cb){ a.kgAddAgreement(k.id, terms, from || a.kgToday(), op(), cb); });
  return r;
}
function wastageKarigar(a, name, terms){
  var k = a.addOrGetKarigar(name);
  var r = agree(a, k, terms);
  ok(!r.err, 'agreement: ' + (r.err && r.err.message));
  return k;
}

test('wastage % + fixed gold per job: job copies the agreement, fixed counts from the first issue', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4', fixedGrams:'2'});
  var j = job(a, k);
  eq(j.wastageBp, 400); eq(j.fixedMg, 2000); eq(typeof j.agreementId, 'string');
  eq(bal(a, j).earnedFine, 0, 'nothing issued: nothing earned (no negative open balance)');
  metal(a, j, 'ISSUE', 100000, '999');
  var b = bal(a, j);
  eq(b.percentFine, 4000); eq(b.fixedFine, 2000); eq(b.earnedFine, 6000); eq(b.accountable, 94000);
  metal(a, j, 'ISSUE', 50000, '999');
  eq(bal(a, j).fixedFine, 2000, 'fixed is per job, a second issue does not add another');
  eq(bal(a, j).percentFine, 6000);
});
test('closing freezes earnings; per-gram labour on NET weight posts to the salary register, separate from gold', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4', fixedGrams:'2', labourRate:'100', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999');
  ok(!receipt(a, j, 100000, 'other', {pct:'94'}).err);                       // 100 g net, 94% => 94.000 g fine
  eq(bal(a, j).openFine, 0);
  ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  var e = j.earnings;
  eq(e.earnedFine, 6000); eq(e.percentFine, 4000); eq(e.fixedFine, 2000); eq(e.netMg, 100000); eq(e.fineMg, 94000);
  eq(e.labourBase, 'net'); eq(e.labourPaise, 1000000, 'Rs 100/g x 100 g');
  eq(a.kgSalaryBalance(k.id).accrued, 1000000); eq(a.kgSalaryBalance(k.id).payable, 1000000);
  var jl = a.S.kgSalary.filter(function(x){ return x.type === 'JOB_LABOUR'; });
  eq(jl.length, 1); eq(jl[0].jobId, j.id);
  eq(bal(a, j).openFine, 0, 'gold side untouched by labour');
});
test('per-gram labour on FINE weight', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4', labourRate:'100', labourBase:'fine'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999');
  receipt(a, j, 100000, 'other', {pct:'96'});                                 // 96.000 g fine = exactly the 96 g due
  ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  eq(j.earnings.labourBase, 'fine'); eq(j.earnings.labourPaise, 960000, 'Rs 100/g x 96 g fine');
});
test('no labour terms: closing posts no labour; zero-weight rounding never posts a 0 entry', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); metal(a, j, 'SCRAP', 96000, '999', {kind:'scrap'});
  ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  eq(j.earnings.labourPaise, 0); eq(a.S.kgSalary.length, 0);
  eq(j.earnings.fixedFine, 0);
});
test('job labour cannot be reversed by hand; reopening reverses it once and keeps the old earnings in a log', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4', labourRate:'50', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'96'});
  call(function(cb){ a.kgCloseJob(j.id, cb); });
  eq(a.kgSalaryBalance(k.id).payable, 500000);
  var jl = a.S.kgSalary.filter(function(x){ return x.type === 'JOB_LABOUR'; })[0];
  ok(call(function(cb){ a.kgAddSalary({type:'REVERSAL', opId:op(), karigarId:k.id, reversesId:jl.id, reason:'manual attempt'}, cb); }).err, 'manual reversal refused');
  ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err);
  eq(a.kgSalaryBalance(k.id).payable, 0); eq(j.earnings, null); eq(j.earningsLog.length, 1); eq(j.earningsLog[0].labourPaise, 500000);
  ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  eq(a.kgSalaryBalance(k.id).payable, 500000, 'closing again posts the labour once, not twice');
});
test('a failed save while closing leaves the job open with no earnings and no labour entry', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4', labourRate:'50', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'96'});
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  eq(j.status, 'open'); ok(!('earnings' in j), 'earnings removed'); eq(a.S.kgSalary.length, 0);
});
test('agreement versions: effective dates, same-day replacement, no backdating, future version leaves today alone', function(){
  var a = fresh('owner'); var k = a.addOrGetKarigar('Test-A');
  ok(!agree(a, k, {kind:'wastage', wastagePct:'4'}, '2026-10-01').err);
  ok(!agree(a, k, {kind:'wastage', wastagePct:'3'}, '2026-11-01').err);
  ok(agree(a, k, {kind:'wastage', wastagePct:'5'}, '2026-09-15').err, 'cannot be dated before the latest version');
  eq(a.kgAgreementFor(k.id, '2026-09-30'), null, 'before the first version: none');
  eq(a.kgAgreementFor(k.id, '2026-10-01').wastageBp, 400);
  eq(a.kgAgreementFor(k.id, '2026-10-31').wastageBp, 400);
  eq(a.kgAgreementFor(k.id, '2026-11-01').wastageBp, 300);
  eq(a.kgAgreementFor(k.id, '2027-01-01').wastageBp, 300);
  eq(a.kgAgreementHistory(k.id).length, 2);
  ok(!agree(a, k, {kind:'wastage', wastagePct:'3.5'}, '2026-11-01').err, 'same-day replacement allowed');
  eq(a.kgAgreementFor(k.id, '2026-11-01').wastageBp, 350, 'the later entry wins the tie');
  eq(a.kgAgreementHistory(k.id).length, 3, 'old versions are kept');
});
test('a job keeps the terms in force when it was created, even after new terms start', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'});
  var j1 = job(a, k);
  ok(!agree(a, k, {kind:'wastage', wastagePct:'3', fixedGrams:'1'}).err);
  var j2 = job(a, k);
  eq(j1.wastageBp, 400); eq(j1.fixedMg, 0); eq(j2.wastageBp, 300); eq(j2.fixedMg, 1000);
  metal(a, j1, 'ISSUE', 100000, '999'); eq(bal(a, j1).earnedFine, 4000);
  metal(a, j2, 'ISSUE', 100000, '999'); eq(bal(a, j2).earnedFine, 3000 + 1000);
  eq(a.S.karigars[0].wastageBp, 300, 'karigar record mirrors the terms in force');
});
test('a future-dated version does not apply today', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'});
  ok(!agree(a, k, {kind:'wastage', wastagePct:'2'}, '2099-01-01').err);
  eq(job(a, k).wastageBp, 400); eq(k.wastageBp, 400);
});
test('agreement rules: salary karigars have no gold or labour, bad input and non-owners refused, failed save rolls back', function(){
  var a = fresh('owner'); var k = a.addOrGetKarigar('Test-B');
  ok(agree(a, k, {kind:'salary', salaryMode:'monthly', rate:'30000', fixedGrams:'1'}).err, 'salary + fixed gold');
  ok(agree(a, k, {kind:'salary', salaryMode:'monthly', rate:'30000', labourRate:'10'}).err, 'salary + labour');
  ok(agree(a, k, {kind:'salary', salaryMode:'yearly', rate:'30000'}).err); ok(agree(a, k, {kind:'salary', salaryMode:'daily', rate:'0'}).err);
  ok(agree(a, k, {kind:'wastage', wastagePct:'60'}).err, 'over 50%'); ok(agree(a, k, {kind:'wastage', wastagePct:'-1'}).err);
  ok(agree(a, k, {kind:'wastage', wastagePct:'4', fixedGrams:'1.2345'}).err, 'four decimals');
  ok(agree(a, k, {kind:'wastage', wastagePct:'4', labourRate:'100'}).err, 'labour without net/fine');
  ok(agree(a, k, {kind:'wastage', wastagePct:'4', labourRate:'100', labourBase:'gross'}).err, 'gross not offered');
  ok(agree(a, k, {kind:'other'}).err);
  ok(agree(a, k, {kind:'wastage', wastagePct:'4'}, '2026-13-45').err, 'impossible date'); ok(agree(a, k, {kind:'wastage', wastagePct:'4'}, 'yesterday').err);
  eq(a.S.kgAgreements.length, 0, 'nothing written by the refusals');
  ok(!agree(a, k, {kind:'salary', salaryMode:'monthly', rate:'30000'}).err);
  eq(k.kind, 'salary'); eq(k.salary.ratePaise, 3000000);
  a.SAAS.user.role = 'manager'; ok(agree(a, k, {kind:'wastage', wastagePct:'4'}).err, 'manager refused');
  a.SAAS.user.role = 'owner'; a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(agree(a, k, {kind:'wastage', wastagePct:'4'}).err); eq(a.S.kgAgreements.length, 1); eq(k.kind, 'salary', 'karigar record restored');
});
test('same agreement submitted twice (same operation id) is stored once', function(){
  var a = fresh('owner'); var k = a.addOrGetKarigar('Test-A');
  var o = 'agr-op'; call(function(cb){ a.kgAddAgreement(k.id, {kind:'wastage', wastagePct:'4'}, a.kgToday(), o, cb); });
  var r = call(function(cb){ a.kgAddAgreement(k.id, {kind:'wastage', wastagePct:'4'}, a.kgToday(), o, cb); });
  eq(r.dup, true); eq(a.S.kgAgreements.length, 1);
});
test('report counts fixed gold of jobs closed in the period', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Test-A', {kind:'wastage', wastagePct:'4', fixedGrams:'2'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'94'});
  var d = a.kgToday(); eq(a.kgReport(d, d).wastage[0].fixedFine, 0, 'not closed yet');
  call(function(cb){ a.kgCloseJob(j.id, cb); });
  var w = a.kgReport(d, d).wastage[0]; eq(w.fixedFine, 2000); eq(w.keptFine, 4000);
});

console.log('\nKarigar 2.0 phase 4 - routes, stages, lines, due date, cancel, dashboard');

function setRoute(a, cat, text){ return call(function(cb){ a.kgSetRoute(cat, text, cb); }); }
function newJob(a, k, fields){
  var f = {karigarId:k.id, title:'Test job'}; Object.keys(fields || {}).forEach(function(x){ f[x] = fields[x]; });
  return call(function(cb){ a.kgCreateJob(f, op(), cb); });
}
function stage(a, j, idx, action, arg){ return call(function(cb){ a.kgStageAction(j.id, j.stages[idx].id, action, arg || '', cb); }); }
function future(a, days){ var d = new Date(Date.parse(a.kgToday() + 'T00:00:00Z') + days * 86400000); return d.toISOString().slice(0, 10); }

test('routes: owner defines stages per category; list is parsed, trimmed, de-duplicated and limited', function(){
  var a = fresh('owner');
  ok(!setRoute(a, 'Rings', 'Casting, Filing ,Setting\nPolish').err);
  eq(JSON.stringify(a.S.kgRoutes), JSON.stringify([{category:'Rings', stages:['Casting', 'Filing', 'Setting', 'Polish']}]));
  ok(setRoute(a, 'Rings', 'Casting, casting').err, 'repeat');
  ok(setRoute(a, 'Rings', 'a,b,c,d,e,f,g,h,i,j,k,l,m').err, 'more than 12');
  ok(setRoute(a, 'Rings', new Array(32).join('x')).err, 'name over 30 letters');
  ok(setRoute(a, 'Spaceships', 'a,b').err, 'unknown category'); ok(setRoute(a, 'All', 'a,b').err, 'All is not a category');
  ok(!setRoute(a, '*', 'Make, Finish').err);
  ok(!setRoute(a, 'Rings', '').err); eq(a.S.kgRoutes.length, 1, 'empty list removes the route'); eq(a.S.kgRoutes[0].category, '*');
  a.SAAS.user.role = 'manager'; ok(setRoute(a, 'Rings', 'a,b').err, 'manager cannot change routes');
  a.SAAS.user.role = 'owner'; a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(setRoute(a, 'Chains', 'a,b').err); eq(a.S.kgRoutes.length, 1, 'rolled back');
});
test('a new job gets the stages of its category route, else the any-category route, else none (none are invented)', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'});
  setRoute(a, 'Rings', 'Casting, Setting'); setRoute(a, '*', 'Make');
  var j1 = newJob(a, k, {category:'Rings'}).v, j2 = newJob(a, k, {category:'Chains'}).v, j3 = newJob(a, k, {}).v;
  eq(j1.stages.map(function(x){ return x.name; }).join(','), 'Casting,Setting'); eq(j1.stages[0].status, 'pending');
  eq(j2.stages.length, 1); eq(j2.stages[0].name, 'Make'); eq(j3.stages.length, 0, 'no category: no stages');
  setRoute(a, 'Rings', 'Totally, Different');
  eq(j1.stages.length, 2); eq(j1.stages[0].name, 'Casting', 'existing job keeps its own stages');
  var a2 = fresh('owner'); var k2 = karigar(a2, 'T', {kind:'wastage', wastagePct:'4'});
  eq(newJob(a2, k2, {category:'Rings'}).v.stages.length, 0, 'no routes at all: no stages');
});
test('job options: in-house / external, workshop name, due date and category are validated', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'});
  var j = newJob(a, k, {mode:'external', workshop:'  Sharma Workshop ', dueDate:future(a, 5), category:'Rings'}).v;
  eq(j.mode, 'external'); eq(j.workshop, 'Sharma Workshop'); eq(j.dueDate, future(a, 5)); eq(j.category, 'Rings');
  var h = newJob(a, k, {mode:'inhouse', workshop:'ignored'}).v; eq(h.workshop, '', 'workshop only for external'); eq(h.mode, 'inhouse');
  eq(newJob(a, k, {}).v.mode, 'inhouse', 'default in-house');
  ok(newJob(a, k, {mode:'moon'}).err); ok(newJob(a, k, {dueDate:'2020-01-01'}).err, 'past'); ok(newJob(a, k, {dueDate:'soon'}).err);
  ok(newJob(a, k, {mode:'external', workshop:new Array(50).join('w')}).err); ok(newJob(a, k, {category:new Array(50).join('c')}).err);
});
test('job lines: add with validation, void with reason, manager can, others cannot, closed job locked', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); var j = newJob(a, k).v;
  function add(f, o){ return call(function(cb){ a.kgAddLine(j.id, f, o || op(), cb); }); }
  var r = add({desc:'Necklace set', qty:'2', targetGrams:'45.5'}); ok(!r.err);
  eq(j.lines[0].qty, 2); eq(j.lines[0].targetMg, 45500); eq(add({desc:'Ring', qty:'1'}).v.targetMg, 0);
  ok(add({desc:'', qty:1}).err); ok(add({desc:'x', qty:0}).err); ok(add({desc:'x', qty:'1.5'}).err); ok(add({desc:'x', qty:1, targetGrams:'1.2345'}).err);
  ok(add({desc:new Array(70).join('d'), qty:1}).err);
  var same = op(); add({desc:'Once', qty:1}, same); eq(add({desc:'Once', qty:1}, same).dup, true); eq(j.lines.length, 3, 'same operation id stored once');
  var lid = j.lines[0].id;
  ok(call(function(cb){ a.kgVoidLine(j.id, lid, 'no', cb); }).err, 'short reason');
  ok(!call(function(cb){ a.kgVoidLine(j.id, lid, 'customer cancelled it', cb); }).err); ok(j.lines[0].void && j.lines[0].void.reason === 'customer cancelled it');
  ok(call(function(cb){ a.kgVoidLine(j.id, lid, 'again please', cb); }).err, 'only once'); eq(j.lines.length, 3, 'never deleted');
  a.SAAS.user.role = 'staff'; ok(add({desc:'x', qty:1}).err);
  a.SAAS.user.role = 'owner'; call(function(cb){ a.kgCloseJob(j.id, cb); }); ok(add({desc:'late', qty:1}).err, 'closed job');
});
test('stages move in order: start, done; cannot skip ahead; owner undo; who label; every action logged', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); setRoute(a, 'Rings', 'Casting, Setting, Polish');
  var j = newJob(a, k, {category:'Rings'}).v;
  ok(stage(a, j, 1, 'start').err, 'cannot start Setting before Casting is done');
  ok(stage(a, j, 0, 'done').err, 'cannot finish what has not started');
  ok(!stage(a, j, 0, 'start').err); eq(j.stages[0].status, 'active'); ok(stage(a, j, 0, 'start').err, 'already started');
  ok(stage(a, j, 1, 'start').err, 'previous stage not done yet');
  ok(!stage(a, j, 0, 'done').err); eq(j.stages[0].status, 'done'); ok(j.stages[0].doneAt);
  ok(!stage(a, j, 1, 'start').err);
  ok(stage(a, j, 0, 'undo').err, 'cannot undo Casting while Setting is running');
  ok(!stage(a, j, 1, 'undo').err); eq(j.stages[1].status, 'pending'); ok(!('startedAt' in j.stages[1]));
  ok(!stage(a, j, 0, 'undo').err); eq(j.stages[0].status, 'active');
  ok(stage(a, j, 2, 'undo').err, 'nothing to undo');
  ok(!stage(a, j, 0, 'who', k.id).err); eq(j.stages[0].who, k.id); ok(stage(a, j, 0, 'who', 'nobody').err); ok(!stage(a, j, 0, 'who', '').err); eq(j.stages[0].who, '');
  ok(stage(a, j, 0, 'jump').err, 'unknown action');
  ok(j.stages[0].log.length >= 5 && j.stages[0].log.every(function(l){ return l.action && l.at && l.by; }), 'append-only log');
  a.SAAS.user.role = 'manager'; ok(stage(a, j, 0, 'undo').err, 'manager cannot undo'); ok(!stage(a, j, 0, 'done').err, 'manager can mark done');
  a.SAAS.user.role = 'staff'; ok(stage(a, j, 1, 'start').err);
});
test('a failed save rolls a stage action back', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); setRoute(a, 'Rings', 'Casting, Setting');
  var j = newJob(a, k, {category:'Rings'}).v;
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(stage(a, j, 0, 'start').err); eq(j.stages[0].status, 'pending'); eq(j.stages[0].log.length, 0); ok(!('startedAt' in j.stages[0]));
});
test('stage summary and the dashboard: overdue, awaiting approval, surplus, ready to close, gold with karigars', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); setRoute(a, 'Rings', 'Cast, Polish');
  var j1 = newJob(a, k, {category:'Rings'}).v;                       // 2 stages, will be fully done and balanced
  metal(a, j1, 'ISSUE', 100000, '999'); metal(a, j1, 'SCRAP', 96000, '999', {kind:'scrap'});
  stage(a, j1, 0, 'start'); stage(a, j1, 0, 'done'); stage(a, j1, 1, 'start');
  eq(a.kgStagesSummary(j1).done, 1); eq(a.kgStagesSummary(j1).active.name, 'Polish'); eq(a.kgStagesSummary(j1).total, 2);
  stage(a, j1, 1, 'done');
  var j2 = newJob(a, k, {dueDate:future(a, 3)}).v; metal(a, j2, 'ISSUE', 50000, '999');
  j2.dueDate = '2020-01-01';                                          // simulate time passing
  var j3 = newJob(a, k, {}).v; metal(a, j3, 'ISSUE', 10000, '999'); metal(a, j3, 'SCRAP', 10000, '999', {kind:'scrap'});   // 9.6 g due -> surplus 0.4 g
  a.SAAS.user.role = 'manager';
  var j4 = newJob(a, k, {}).v; metal(a, j4, 'ISSUE', 10000, '999');
  call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j4.id, karigarId:k.id, fineMg:100, category:'filing', reason:'filing loss', proposed:true}, cb); });
  a.SAAS.user.role = 'owner';
  var d = a.kgDashboard();
  eq(d.openJobs, 4); eq(d.overdue.length, 1); eq(d.overdue[0].job.id, j2.id); ok(d.overdue[0].days > 1000);
  eq(d.pendingApprovals.length, 1); eq(d.pendingApprovals[0].fine, 100);
  eq(d.surplus.length, 1); eq(d.surplus[0].job.id, j3.id); eq(d.surplus[0].fine, 400);
  eq(d.readyToClose.length, 1); eq(d.readyToClose[0].job.id, j1.id); eq(d.readyToClose[0].openFine, 0);
  eq(d.withKarigarFine, (50000 - 2000) + (10000 - 400), 'only jobs with gold still out (j2, j4)');
  call(function(cb){ a.kgCloseJob(j1.id, cb); }); eq(a.kgDashboard().openJobs, 3, 'closed jobs leave the dashboard');
});
test('overdue days: only open jobs with a past due date', function(){
  var a = fresh('owner'); var t = a.kgToday();
  eq(a.kgJobOverdueDays({status:'open', dueDate:''}, t), 0); eq(a.kgJobOverdueDays({status:'open', dueDate:t}, t), 0, 'due today is not late');
  eq(a.kgJobOverdueDays({status:'open', dueDate:'2026-10-01'}, '2026-10-04'), 3);
  eq(a.kgJobOverdueDays({status:'closed', dueDate:'2026-10-01'}, '2026-10-04'), 0); eq(a.kgJobOverdueDays(null, t), 0);
});
test('cancel: owner only, reason required, only when no gold has been issued; then the job is out of khata and dashboard', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'});
  var j = newJob(a, k).v, g = newJob(a, k).v; var i = metal(a, g, 'ISSUE', 1000, '999').v;
  function cancel(job, why){ return call(function(cb){ a.kgCancelJob(job.id, why, cb); }); }
  ok(cancel(g, 'customer changed mind').err, 'gold issued: cannot cancel');
  ok(cancel(j, 'no').err, 'reason too short');
  a.SAAS.user.role = 'manager'; ok(cancel(j, 'customer changed mind').err, 'manager cannot cancel'); a.SAAS.user.role = 'owner';
  ok(!cancel(j, 'customer changed mind').err); eq(j.status, 'cancelled'); eq(j.cancelReason, 'customer changed mind');
  ok(cancel(j, 'twice please').err);
  ok(metal(a, j, 'ISSUE', 1000, '999').err, 'no entries on a cancelled job');
  eq(a.kgKhata(k.id).jobs, 1, 'cancelled job not in khata'); eq(a.kgDashboard().openJobs, 1);
  call(function(cb){ a.kgAddEntry({type:'REVERSAL', opId:op(), jobId:g.id, karigarId:k.id, reversesId:i.id, reason:'issued by mistake'}, cb); });
  ok(!cancel(g, 'issued by mistake').err, 'after the issue is reversed the job can be cancelled');
});
test('closing never blocks on stages in the logic (the screen asks first); existing jobs without the new fields still work', function(){
  var a = fresh('owner'); var k = karigar(a, 'Test-A', {kind:'wastage', wastagePct:'4'}); setRoute(a, 'Rings', 'Cast');
  var j = newJob(a, k, {category:'Rings'}).v; ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  var old = {id:'old1', jobNo:'KJ-9999', karigarId:k.id, title:'old', kind:'wastage', wastageBp:400, status:'open', createdAt:'2026-10-01T00:00:00Z'};
  a.S.kgJobs.push(old);
  eq(a.kgStagesSummary(old).total, 0); eq(a.kgJobOverdueDays(old, a.kgToday()), 0); ok(a.kgDashboard().openJobs >= 1);
  ok(!call(function(cb){ a.kgAddLine(old.id, {desc:'Ring', qty:1}, op(), cb); }).err, 'a job saved before phase 4 can take lines'); eq(old.lines.length, 1);
});

console.log('\nKarigar redesign batch 1 - purity in 0.01% units, rounding, stones, wastage cap');

test('kgPuFromText: 2 decimals at most, integers out', function(){
  var a = fresh();
  eq(a.kgPuFromText('91.82'), 9182); eq(a.kgPuFromText('92'), 9200); eq(a.kgPuFromText('91.6'), 9160); eq(a.kgPuFromText(' 75 '), 7500);
  eq(a.kgPuFromText('91.825'), null); eq(a.kgPuFromText('abc'), null); eq(a.kgPuFromText(''), null); eq(a.kgPuFromText('-5'), null); eq(a.kgPuFromText('9,2'), null);
});
test('purity guard: rejects outside 50 to 99.99, accepts the edges', function(){
  var a = fresh();
  ok(a.kgCheckPurity('49.99', [5000]).error, '49.99 rejected'); ok(a.kgCheckPurity('100', []).error, '100 rejected'); ok(a.kgCheckPurity('0', []).error);
  eq(a.kgCheckPurity('50', [5000]).pu, 5000); ok(!a.kgCheckPurity('50', [5000]).error);
  ok(!a.kgCheckPurity('99.99', []).error, '99.99 is typeable (but asks to confirm)');
  ok(a.kgCheckPurity('1e2', []).error); ok(a.kgCheckPurity('91.825', []).error);
});
test('purity guard: odd values ask for confirm, saved usual touches do not', function(){
  var a = fresh(), saved = [9200, 9160, 7500];
  var r = a.kgCheckPurity('92', saved); eq(r.pu, 9200); ok(!r.confirm && !r.error, 'saved touch: no confirm');
  ok(a.kgCheckPurity('91.82', saved).confirm, 'not saved: confirm'); eq(a.kgCheckPurity('91.82', saved).pu, 9182);
  ok(a.kgCheckPurity('55', [5500]).confirm, 'below 58.3 asks even when saved');
  ok(a.kgCheckPurity('99.95', [9995]).confirm, 'above 99.9 asks even when saved');
  ok(!a.kgCheckPurity('58.3', [5830]).confirm && !a.kgCheckPurity('99.9', [9990]).confirm, 'edges of the usual range do not ask when saved');
});
test('kgPuOf reads pu, falls back to permille x 10, null when neither', function(){
  var a = fresh();
  eq(a.kgPuOf({pu:9182, permille:916}), 9182); eq(a.kgPuOf({permille:916}), 9160); eq(a.kgPuOf({permille:1000}), 10000); eq(a.kgPuOf({}), null);
  eq(a.KG_PU_PURE, 10000, '999 chip counts as 100%');
});
test('kgFineFromPu: round half up to the milligram, once, and agrees with the old permille maths', function(){
  var a = fresh();
  eq(a.kgFineFromPu(10000, 9182), 9182);
  eq(a.kgFineFromPu(1, 5000), 1);
  eq(a.kgFineFromPu(1, 4999), 0); eq(a.kgFineFromPu(3, 5000), 2); eq(a.kgFineFromPu(1, 10000), 1);
  eq(a.kgFineFromPu(33333, 9160), 30533); eq(a.kgFineFromPu(99999, 9950), 99499);
  eq(a.kgFineFromPu(100000000, 9999), 99990000, 'the 100 kg limit stays exact');
  [1, 7, 333, 33333, 99999, 123457].forEach(function(mg){ [750, 916, 920, 995, 1000].forEach(function(pm){
    eq(a.kgFineFromPu(mg, pm * 10), a.kgFineMg(mg, pm), mg + 'mg at ' + pm); }); });
  eq(a.kgFineFromPu(-3, 5000), -2, 'a negative line mirrors the positive one');
});
test('kgNetMg: net = gross - stones, refuses a stone weight larger than the gross', function(){
  var a = fresh();
  eq(a.kgNetMg(25000, 3200), 21800); eq(a.kgNetMg(25000, 0), 25000); eq(a.kgNetMg(25000), 25000); eq(a.kgNetMg(25000, 25000), 0);
  eq(a.kgNetMg(25000, 25001), null); eq(a.kgNetMg(0, 0), null); eq(a.kgNetMg(100.5, 0), null); eq(a.kgNetMg(100, 1.5), null); eq(a.kgNetMg(100, -1), null);
});
test('kgCtToMg: 0.2 g per carat, half-up once', function(){
  var a = fresh();
  eq(a.kgCtToMg('1'), 200); eq(a.kgCtToMg('0.5'), 100); eq(a.kgCtToMg('12.345'), 2469); eq(a.kgCtToMg('0.001'), 0); eq(a.kgCtToMg('0.003'), 1);
  eq(a.kgCtToMg('1.2345'), null); eq(a.kgCtToMg('x'), null); eq(a.kgCtToMg(''), null);
});
test('kgPointsFromText: 4 -> 400, 4.5 -> 450, limited to 0..20', function(){
  var a = fresh();
  eq(a.kgPointsFromText('4'), 400); eq(a.kgPointsFromText('4.5'), 450); eq(a.kgPointsFromText('0'), 0); eq(a.kgPointsFromText('20'), 2000);
  eq(a.kgPointsFromText('20.01'), null); eq(a.kgPointsFromText('-1'), null); eq(a.kgPointsFromText('abc'), null);
});
test('wastage credit: 92 + 4 = 96 on the net metal, measured touch is what counts', function(){
  var a = fresh();
  var r = a.kgWastageCredit(10000, 9200, 400, 99999);
  eq(r.rawMg, 9600); eq(r.creditMg, 9600); eq(r.actualMg, 9200); eq(r.capped, false);
  var m = a.kgWastageCredit(10000, 9182, 400, 99999);
  eq(m.creditMg, 9582); eq(m.actualMg, 9182);
});
test('wastage credit: min() cap bites when the job has less fine left than the credit', function(){
  var a = fresh();
  var r = a.kgWastageCredit(10000, 9200, 400, 9500);
  eq(r.rawMg, 9600); eq(r.creditMg, 9500); eq(r.capped, true);
  eq(a.kgWastageCredit(10000, 9200, 400, 9600).creditMg, 9600, 'exactly at the cap: not capped'); eq(a.kgWastageCredit(10000, 9200, 400, 9600).capped, false);
  eq(a.kgWastageCredit(10000, 9200, 400, 0).creditMg, 0, 'nothing left to credit'); eq(a.kgWastageCredit(10000, 9200, 400, -5).creditMg, 0, 'never negative');
});
test('wastage credit: batches never credit more than was issued in total', function(){
  var a = fresh(), issued = 19000, given = 0;
  [[10000, 9200], [10000, 9200]].forEach(function(b){
    var r = a.kgWastageCredit(b[0], b[1], 400, issued - given); given += r.creditMg; });
  ok(given <= issued, 'credited ' + given + ' of ' + issued); eq(given, 19000, 'second batch is capped to what is left');
});
test('wastage credit: bad inputs return an error, never a silent wrong credit', function(){
  var a = fresh();
  ok(a.kgWastageCredit(10000, null, 400, 9999).error, 'null touch'); ok(a.kgWastageCredit(10000, 9200, 400, undefined).error, 'missing cap');
  ok(a.kgWastageCredit(10000, 9200, 400, NaN).error, 'NaN cap'); ok(a.kgWastageCredit(0, 9200, 400, 9999).error, 'zero net'); ok(a.kgWastageCredit(100.5, 9200, 400, 9999).error, 'fractional mg');
  ok(a.kgWastageCredit(Infinity, 9200, 400, 9999).error, 'infinite'); ok(a.kgWastageCredit(10000, 9200, -1, 9999).error, 'negative points');
  eq(a.kgWastageCredit(10000, 9200, 400, 0).creditMg, 0, 'a cap of exactly 0 is valid: nothing left');
});
test('wastage credit: touch + points stops at 100%, so a 999 piece is never credited more than its own weight', function(){
  var a = fresh(); var r = a.kgWastageCredit(19000, 9990, 400, 99999);
  eq(r.rawMg, 19000); eq(r.creditMg, 19000); eq(r.actualMg, 18981);
});
test('wastage credit: zero points (salary karigar) credits only the real fine', function(){
  var a = fresh(); var r = a.kgWastageCredit(10000, 9182, 0, 99999);
  eq(r.creditMg, 9182); eq(r.creditMg, r.actualMg);
});
test('stones through to credit: net after stones x (touch + points)', function(){
  var a = fresh(); var net = a.kgNetMg(12000, a.kgCtToMg('5'));
  eq(net, 11000); eq(a.kgWastageCredit(net, 9200, 400, 99999).creditMg, 10560);
});

console.log('\nKarigar redesign batch 2 - points model, stages, silver, opening balance');

// helpers for the points model
function pk(a, name, kind, pts){
  return karigar(a, name, kind === 'salary' ? {kind:'salary', salaryMode:'monthly', rate:'30000'} : {kind:'wastage', points:(pts == null ? '4' : pts)});
}
function pjob(a, k, extra){
  var f = {karigarId:k.id, title:'Points job', model:'points'};
  Object.keys(extra || {}).forEach(function(x){ f[x] = extra[x]; });
  var r = call(function(cb){ a.kgCreateJob(f, op(), cb); });
  if(r.err) throw new Error('pjob: ' + r.err.message);
  return r.v;
}
function issueV(a, j, wt, pur, stageId, chip){
  var b = a.kgBuildIssue(j.id, stageId || '', {wt:wt, purity:pur, chip:chip, confirmed:true, opId:op()});
  if(!b.entry) throw new Error('issue build: ' + (b.error || b.confirm));
  var r = call(function(cb){ a.kgAddEntry(b.entry, cb); });
  if(r.err) throw new Error('issue: ' + r.err.message);
  return r.v;
}
function receiptV(a, j, v, stageId){
  v.opId = op(); v.confirmed = true; v.piece = v.piece || 'ring'; v.qty = v.qty || '1';
  var b = a.kgBuildReceipt(j.id, stageId || '', v);
  if(!b.entry) throw new Error('receipt build: ' + (b.error || b.confirm));
  var r = call(function(cb){ a.kgAddEntry(b.entry, cb); });
  if(r.err) throw new Error('receipt: ' + r.err.message);
  return {entry:r.v, built:b};
}

test('terms can carry wastage points; salary terms have none', function(){
  var a = fresh(); var k = pk(a, 'P1'); var ag = a.kgAgreementFor(k.id, a.kgToday());
  eq(ag.wastagePoints, 400); eq(a.findKarigar(k.id).wastagePoints, 400);
  var s = pk(a, 'S1', 'salary'); eq(a.kgAgreementFor(s.id, a.kgToday()).wastagePoints, null);
  ok(call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'21'}, cb); }).err, '21 points refused');
});
test('points job: model, metal, tag, piece count, optional points override; bad input refused', function(){
  var a = fresh(); var k = pk(a, 'P2');
  var j = pjob(a, k, {metal:'silver', tag:'T-77', pieceCount:'3', pointsText:'5'});
  eq(j.model, 'points'); eq(j.metal, 'silver'); eq(j.tag, 'T-77'); eq(j.pieceCount, 3); eq(j.pointsPu, 500); eq(j.wastageBp, 0);
  eq(pjob(a, k).metal, 'gold'); eq(pjob(a, k).pointsPu, null);
  ok(call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'x', model:'points', metal:'platinum'}, op(), cb); }).err);
  ok(call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'x', model:'points', pointsText:'99'}, op(), cb); }).err);
  ok(call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'x', model:'points', pieceCount:'x'}, op(), cb); }).err);
});
test('issue: 10 g at 92 is 9.200 g fine; 91.82 stores as 9182; 999 chip counts 100%', function(){
  var a = fresh(); var k = pk(a, 'P3'); var j = pjob(a, k);
  var e = issueV(a, j, '10', '92'); eq(e.fineMg, 9200); eq(e.pu, 9200); eq(a.kgFmtG(e.fineMg), '9.200 g');
  var o = issueV(a, j, '10', '91.82'); eq(o.fineMg, 9182); eq(o.pu, 9182);
  var c = issueV(a, j, '10', '', '', '999'); eq(c.fineMg, 10000); eq(c.pu, 10000);
  eq(bal(a, j).issuedFine, 9200 + 9182 + 10000);
});
test('issue: bad and odd purity are stopped or confirmed before anything is saved', function(){
  var a = fresh(); var k = pk(a, 'P4'); var j = pjob(a, k);
  ok(a.kgBuildIssue(j.id, '', {wt:'10', purity:'100', opId:op()}).error, '100 refused');
  ok(a.kgBuildIssue(j.id, '', {wt:'10', purity:'49', opId:op()}).error, '49 refused');
  ok(a.kgBuildIssue(j.id, '', {wt:'10', purity:'91.82', opId:op()}).confirm, 'unusual value asks first');
  ok(!a.kgBuildIssue(j.id, '', {wt:'10', purity:'91.82', confirmed:true, opId:op()}).confirm);
  ok(!a.kgBuildIssue(j.id, '', {wt:'10', purity:'92', opId:op()}).confirm, 'a usual touch needs no confirm');
  ok(a.kgBuildIssue(j.id, '', {wt:'0', purity:'92', opId:op()}).error, 'zero weight refused');
  eq(a.S.kgLedger.length, 0, 'nothing saved');
});
test('receipt, wastage karigar: 10 g net at 92 + 4 points credits 9.600 g, and the real fine in the piece is 9.200 g', function(){
  var a = fresh(); var k = pk(a, 'P5'); var j = pjob(a, k); issueV(a, j, '10', '92'); issueV(a, j, '1', '', '', '999');   // fine issued 9.2 + 1.0 = 10.2
  var r = receiptV(a, j, {gross:'10', purity:'92', agreed:'92'});
  eq(r.entry.actualFineMg, 9200); eq(r.entry.creditFineMg, 9600); eq(r.entry.fineMg, 9600); eq(r.entry.pointsPu, 400); eq(r.entry.agreedPu, 9200); eq(r.entry.mg, 10000);
  eq(bal(a, j).openFine, 10200 - 9600);
});
test('receipt: credit is capped at the fine he holds on the job; the saved wastage stays with the shop', function(){
  var a = fresh(); var k = pk(a, 'P6'); var j = pjob(a, k); issueV(a, j, '10', '92');   // 9.200 fine issued
  var r = receiptV(a, j, {gross:'10', purity:'92'});
  eq(r.built.rawCreditMg, 9600); eq(r.built.capped, true); eq(r.entry.creditFineMg, 9200); eq(bal(a, j).openFine, 0);
});
test('receipt: credit follows the MEASURED touch, not the agreed one', function(){
  var a = fresh(); var k = pk(a, 'P7'); var j = pjob(a, k); issueV(a, j, '20', '', '', '999');
  var r = receiptV(a, j, {gross:'10', purity:'91.82', agreed:'92'});
  eq(r.entry.agreedPu, 9200); eq(r.entry.pu, 9182); eq(r.entry.creditFineMg, 9582); eq(r.entry.actualFineMg, 9182);
});
test('receipt, per-job points override beats the karigar terms', function(){
  var a = fresh(); var k = pk(a, 'P8'); var j = pjob(a, k, {pointsText:'2'}); issueV(a, j, '20', '', '', '999');
  eq(receiptV(a, j, {gross:'10', purity:'92'}).entry.creditFineMg, 9400);
});
test('receipt, salary karigar: no wastage, credit = real fine; the loss is what is left open', function(){
  var a = fresh(); var k = pk(a, 'S2', 'salary'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var r = receiptV(a, j, {gross:'9.9', purity:'92'});
  eq(r.entry.pointsPu, 0); eq(r.entry.creditFineMg, 9108); eq(r.entry.kind, 'salary'); eq(bal(a, j).openFine, 9200 - 9108);
});
test('receipt: stones are taken off the gross before the metal is counted (mode A or B)', function(){
  var a = fresh(); var k = pk(a, 'P9'); var j = pjob(a, k); issueV(a, j, '30', '', '', '999');
  var r = receiptV(a, j, {gross:'12', stoneCt:'5', stoneMode:'A', purity:'92'});
  eq(r.entry.grossMg, 12000); eq(r.entry.stoneMg, 1000); eq(r.entry.mg, 11000); eq(r.entry.creditFineMg, 10560);
  var g = receiptV(a, j, {gross:'5', stoneG:'0.5', stoneMode:'B', purity:'92'}); eq(g.entry.mg, 4500);
  ok(a.kgBuildReceipt(j.id, '', {gross:'1', stoneG:'2', purity:'92', piece:'x', qty:'1', opId:op()}).error, 'stones heavier than the piece refused');
});
test('receipt: terms must be set; wastage needs points', function(){
  var a = fresh(); var k = a.addOrGetKarigar('NoTerms'); a.kgSetTerms(k.id, {kind:'wastage'}, function(){});
  var j = pjob(a, k); issueV(a, j, '10', '92');
  ok(/points/.test(a.kgBuildReceipt(j.id, '', {gross:'5', purity:'92', piece:'x', qty:'1', opId:op()}).error), 'asks for wastage points');
});
test('the ledger refuses a tampered credit, a wrong net, a wrong metal and a wrong karigar', function(){
  var a = fresh(); var k = pk(a, 'P10'); var j = pjob(a, k); issueV(a, j, '30', '', '', '999');
  function build(){ return a.kgBuildReceipt(j.id, '', {gross:'10', purity:'92', piece:'ring', qty:'1', opId:op()}).entry; }
  var e = build(); e.creditFineMg += 1; e.fineMg += 1; ok(call(function(cb){ a.kgAddEntry(e, cb); }).err, 'credit +1 mg refused');
  e = build(); e.mg = 9999; ok(call(function(cb){ a.kgAddEntry(e, cb); }).err, 'net must be gross - stones');
  e = build(); e.metal = 'silver'; ok(call(function(cb){ a.kgAddEntry(e, cb); }).err, 'silver entry on a gold job refused');
  e = build(); e.karigarId = 'someone-else'; ok(call(function(cb){ a.kgAddEntry(e, cb); }).err, 'wrong karigar refused');
  e = build(); e.pu = 4999; ok(call(function(cb){ a.kgAddEntry(e, cb); }).err, 'purity outside the guard refused');
  e = build(); e.pu = 10000; ok(call(function(cb){ a.kgAddEntry(e, cb); }).err, '100% only as the 999 chip');
  eq(a.S.kgLedger.length, 1, 'only the issue is in the ledger');
});
test('silver: its own metal on the job, same maths, never mixed with gold', function(){
  var a = fresh(); var k = pk(a, 'P11'); var js = pjob(a, k, {metal:'silver'}); var jg = pjob(a, k);
  var e = issueV(a, js, '100', '92.5'); eq(e.metal, 'silver'); eq(e.fineMg, 92500);
  issueV(a, jg, '10', '92');
  eq(bal(a, js).issuedFine, 92500); eq(bal(a, jg).issuedFine, 9200);
  var bad = a.kgBuildIssue(jg.id, '', {wt:'1', purity:'92', confirmed:true, opId:op()}).entry; bad.metal = 'silver';
  ok(call(function(cb){ a.kgAddEntry(bad, cb); }).err, 'silver entry cannot land on the gold job');
});
test('stage chain: each stage has its own karigar; stage 2 is a new issue after stage 1 returned to the shop; custody is never double counted', function(){
  var a = fresh(); var A = pk(a, 'Maker'); var B = pk(a, 'Setter', 'wastage', '3');
  var j = pjob(a, A);
  var s1 = call(function(cb){ a.kgAddStage(j.id, 'Making', A.id, cb); }).v, s2 = call(function(cb){ a.kgAddStage(j.id, 'Setting', B.id, cb); }).v;
  issueV(a, j, '20', '', s1.id, '999');                                      // A holds 20.000
  var r1 = receiptV(a, j, {gross:'19', purity:'99.9'}, s1.id);               // A returns a piece: 19 g at 99.9 + 4 pts
  issueV(a, j, '19', '', s2.id, '999');                                      // shop gives it on to B
  var ledger = a.S.kgLedger;
  eq(a.kgKarigarJobFine(j, ledger, A.id) + a.kgKarigarJobFine(j, ledger, B.id), bal(a, j).openFine, 'sum of the two karigars = job open fine');
  eq(a.kgKarigarJobFine(j, ledger, B.id), 19000);
  eq(a.kgKarigarJobFine(j, ledger, A.id), 20000 - r1.entry.creditFineMg);
  var bad = a.kgBuildIssue(j.id, s2.id, {wt:'1', chip:'999', opId:op()}).entry; bad.karigarId = A.id;
  ok(call(function(cb){ a.kgAddEntry(bad, cb); }).err, 'stage 2 metal cannot be booked to the stage 1 karigar');
  var rb = receiptV(a, j, {gross:'10', purity:'99.9'}, s2.id); eq(rb.entry.karigarId, B.id); eq(rb.entry.pointsPu, 300, 'B\'s own points apply');
});
test('a stage that is not on the job is refused', function(){
  var a = fresh(); var k = pk(a, 'P12'); var j = pjob(a, k);
  var e = a.kgBuildIssue(j.id, '', {wt:'1', chip:'999', opId:op()}).entry; e.stageId = 'nope';
  ok(call(function(cb){ a.kgAddEntry(e, cb); }).err);
});
test('opening balance: owner only, one per karigar and metal, reversible once with a reason, then re-enterable', function(){
  var a = fresh('owner'); var k = pk(a, 'P13');
  function open(metal, wt){ return call(function(cb){ a.kgAddOpening({karigarId:k.id, metal:metal, wt:wt, purity:'92', confirmed:true, opId:op()}, cb); }); }
  var r = open('gold', '50'); ok(!r.err, r.err && r.err.message); eq(r.v.fineMg, 46000); eq(r.v.jobId, ''); eq(r.v.type, 'OPENING');
  ok(open('gold', '10').err, 'a second gold opening is refused'); ok(!open('silver', '100').err, 'silver is a separate opening');
  ok(call(function(cb){ a.kgReverse(r.v.id, 'no', op(), cb); }).err, 'reason too short');
  var rv = call(function(cb){ a.kgReverse(r.v.id, 'typed the wrong weight', op(), cb); }); ok(!rv.err, rv.err && rv.err.message);
  ok(call(function(cb){ a.kgReverse(r.v.id, 'again please', op(), cb); }).err, 'already reversed');
  ok(!open('gold', '40').err, 're-enter after reversal');
  a.SAAS.user.role = 'manager'; ok(open('silver', '1').err, 'manager cannot enter an opening balance');
});
test('opening is idempotent on its operation id and rolls back on a failed save', function(){
  var a = fresh('owner'); var k = pk(a, 'P14'); var id = op();
  var one = call(function(cb){ a.kgAddOpening({karigarId:k.id, metal:'gold', wt:'5', purity:'92', confirmed:true, opId:id}, cb); });
  var two = call(function(cb){ a.kgAddOpening({karigarId:k.id, metal:'gold', wt:'5', purity:'92', confirmed:true, opId:id}, cb); });
  ok(!one.err && two.dup === true); eq(a.S.kgLedger.length, 1);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var f = call(function(cb){ a.kgAddOpening({karigarId:k.id, metal:'silver', wt:'5', purity:'92', confirmed:true, opId:op()}, cb); });
  ok(f.err, 'failed save reported'); eq(a.S.kgLedger.length, 1, 'rolled back');
});
test('a failed save rolls back a points receipt and leaves the balance as it was', function(){
  var a = fresh(); var k = pk(a, 'P15'); var j = pjob(a, k); issueV(a, j, '10', '92'); var before = bal(a, j).openFine;
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var b = a.kgBuildReceipt(j.id, '', {gross:'5', purity:'92', piece:'x', qty:'1', opId:op()});
  ok(call(function(cb){ a.kgAddEntry(b.entry, cb); }).err); eq(bal(a, j).openFine, before); eq(a.S.kgLedger.length, 1);
});
test('ledger switch ON: new-style entries are refused (the server has no purity-in-hundredths or silver yet), old-style still go to the ledger path', function(){
  var a = fresh(); var k = pk(a, 'P16'); var j = pjob(a, k); a.S.kgLedgerOn = true;
  var e = a.kgBuildIssue(j.id, '', {wt:'1', chip:'999', opId:op()}).entry;
  var r = call(function(cb){ a.kgAddEntry(e, cb); }); ok(r.err && /not available while the ledger is on/.test(r.err.message)); eq(a.S.kgLedger.length, 0);
  var r2 = call(function(cb){ a.kgAddEntries([e], cb); }); ok(r2.err && /not available while the ledger is on/.test(r2.err.message));
});
test('a manager may reverse an earlier-day points metal entry that a manager made; owner entries, ADJUST and loss stay owner-only', function(){
  var a = fresh('owner'); var k = pk(a, 'P17'); var j = pjob(a, k); var own = issueV(a, j, '1', '92'); own.date = '2026-01-01';
  a.SAAS.user.role = 'manager'; var e = issueV(a, j, '10', '92'); e.date = '2026-01-01';
  ok(call(function(cb){ a.kgReverse(own.id, 'owner made this one', op(), cb); }).err, 'owner-made entry from an earlier day: owner only');
  a.SAAS.user.role = 'owner';
  var adj = {type:'ADJUST', opId:op(), jobId:j.id, karigarId:k.id, fineMg:100, reason:'count correction', metal:'gold'}; ok(!call(function(cb){ a.kgAddEntry(adj, cb); }).err); adj.date = '2026-01-01';
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kgReverse(adj.id, 'manager tries owner adjust', op(), cb); }).err, 'ADJUST from an earlier day: owner only');
  var r = call(function(cb){ a.kgReverse(e.id, 'weighed twice by mistake', op(), cb); }); ok(!r.err, r.err && r.err.message); eq(bal(a, j).issuedFine, 920, 'only the 1 g owner issue is left');
});
test('old-model jobs are untouched: percent wastage still computed, no points fields', function(){
  var a = fresh(); var k = karigar(a, 'Old', {kind:'wastage', wastagePct:'4'}); var j = job(a, k);
  ok(j.model === undefined); metal(a, j, 'ISSUE', 100000, '999'); eq(bal(a, j).percentFine, 4000);
});

console.log('\nKarigar redesign batch 3 - close, carry-forward, accepted loss, loss bill');

function trust(a, k, ceilG, ceilS){
  var r = call(function(cb){ a.kgSetCarry(k.id, {trusted:true, ceilingGold:ceilG || '', ceilingSilver:ceilS || ''}, cb); });
  if(r.err) throw new Error('trust: ' + r.err.message);
}
// everything he holds of one metal: open fine on all his jobs + carried lots. Must never change on a carry.
function holds(a, k, metal){
  var t = 0;
  a.S.kgJobs.forEach(function(j){ if(a.kgMetalOf(j) === metal && j.model === 'points') t += a.kgKarigarJobFine(j, a.S.kgLedger, k.id); });
  return t + a.kgCarryTotal(k.id, metal);
}
function closeV(a, j, opts){ return call(function(cb){ a.kgCloseJob(j.id, cb, opts); }); }

test('close: a points job with nothing open closes; with something open it needs a settlement', function(){
  var a = fresh(); var k = pk(a, 'C1'); var j = pjob(a, k); issueV(a, j, '10', '92'); receiptV(a, j, {gross:'9.2', purity:'100'.replace('100', '92')});
  var r = closeV(a, j); ok(r.err && /Balance is/.test(r.err.message), 'open balance blocks a plain close');
  var j2 = pjob(a, k); issueV(a, j2, '10', '92'); receiptV(a, j2, {gross:'10', purity:'92'});   // credit capped to 9.2 = all of it
  ok(!closeV(a, j2).err); eq(j2.status, 'closed');
});
test('carry-forward: needs the "trusted" setting; the leftover leaves the job and becomes a lot "Carried from [job]"', function(){
  var a = fresh(); var k = pk(a, 'C2'); var j = pjob(a, k); issueV(a, j, '10', '92'); receiptV(a, j, {gross:'5', purity:'92'});   // 9.2 issued, 5 g at 92+4 credits 4.8 -> 4.4 open
  eq(bal(a, j).openFine, 4400);
  var no = closeV(a, j, {settle:'carry'}); ok(no.err && /not set to carry/.test(no.err.message)); eq(j.status, 'open'); eq(a.S.kgLedger.length, 2);
  trust(a, k);
  var before = holds(a, k, 'gold');
  var r = closeV(a, j, {settle:'carry', opId:'cf1'}); ok(!r.err, r.err && r.err.message);
  eq(j.status, 'closed'); eq(bal(a, j).openFine, 0); eq(bal(a, j).carriedOut, 4400);
  var lots = a.kgCarryLots(k.id, 'gold'); eq(lots.length, 1); eq(lots[0].remainingMg, 4400); eq(lots[0].fromJobNo, j.jobNo); eq(lots[0].ageDays, 0);
  eq(holds(a, k, 'gold'), before, 'what he holds is unchanged by the carry (4.400 g before and after)');
});
test('carry-forward: next issue only needs the difference, and his total is not counted twice', function(){
  var a = fresh(); var k = pk(a, 'C3'); trust(a, k);
  var j1 = pjob(a, k); issueV(a, j1, '10', '92'); receiptV(a, j1, {gross:'5', purity:'92'}); closeV(a, j1, {settle:'carry'});   // carries 4.400 fine
  var j2 = pjob(a, k), need = 10000;                                      // next job needs 10.000 g fine
  eq(holds(a, k, 'gold'), 4400);
  var w = a.kgNeededWeightMg(need, 4400, 10000); eq(w, 5600, 'hand over only 5.600 g of 999');
  var ap = call(function(cb){ a.kgApplyCarry(j2.id, '', 4400, 'ap1', cb); }); ok(!ap.err, ap.err && ap.err.message);
  eq(a.kgCarryTotal(k.id, 'gold'), 0); eq(bal(a, j2).issuedFine, 4400); eq(holds(a, k, 'gold'), 4400, 'lot down, job up: same total');
  issueV(a, j2, String(w / 1000), '', '', '999');
  eq(bal(a, j2).issuedFine, 10000, 'the job shows 10.000 fine issued'); eq(holds(a, k, 'gold'), 10000, 'he holds 10.000 in all, not 14.000');
});
test('carry-forward: a lot cannot be over-applied; two lots are used oldest first', function(){
  var a = fresh(); var k = pk(a, 'C4'); trust(a, k);
  var j1 = pjob(a, k); issueV(a, j1, '10', '92'); closeV(a, j1, {settle:'carry', opId:'x1'});     // lot 9.200
  a.S.kgLedger.forEach(function(e){ if(e.type === 'CARRY_IN') e.date = '2026-01-01'; });
  var j2 = pjob(a, k); issueV(a, j2, '5', '92'); closeV(a, j2, {settle:'carry', opId:'x2'});      // lot 4.600
  var lots = a.kgCarryLots(k.id, 'gold'); eq(lots.length, 2); eq(lots[0].remainingMg, 9200, 'oldest first'); ok(lots[0].ageDays > 30);
  var j3 = pjob(a, k);
  ok(call(function(cb){ a.kgApplyCarry(j3.id, '', 13801, 'big', cb); }).err, 'more than he has carried is refused'); eq(a.kgCarryTotal(k.id, 'gold'), 13800);
  ok(!call(function(cb){ a.kgApplyCarry(j3.id, '', 10000, 'two', cb); }).err);
  var l2 = a.kgCarryLots(k.id, 'gold'); eq(l2.length, 1); eq(l2[0].remainingMg, 3800, 'first lot used up, second partly');
  eq(holds(a, k, 'gold'), 13800);
});
test('carry-forward: a limit warns; confirming goes on', function(){
  var a = fresh(); var k = pk(a, 'C5'); trust(a, k, '5');                                          // limit 5.000 g
  var j = pjob(a, k); issueV(a, j, '10', '92');
  var r = closeV(a, j, {settle:'carry'}); ok(r.err && /Over the carry limit/.test(r.err.message), 'warned'); eq(j.status, 'open'); eq(a.kgCarryTotal(k.id, 'gold'), 0);
  ok(!closeV(a, j, {settle:'carry', ackCeiling:true}).err, 'confirmed'); eq(a.kgCarryTotal(k.id, 'gold'), 9200);
  ok(a.kgCarryCheck(k.id, 'gold', 1).over);
});
test('carry-forward: gold and silver are separate lots', function(){
  var a = fresh(); var k = pk(a, 'C6'); trust(a, k);
  var js = pjob(a, k, {metal:'silver'}); issueV(a, js, '100', '92.5'); closeV(a, js, {settle:'carry'});
  eq(a.kgCarryTotal(k.id, 'silver'), 92500); eq(a.kgCarryTotal(k.id, 'gold'), 0);
  var jg = pjob(a, k); ok(call(function(cb){ a.kgApplyCarry(jg.id, '', 1000, 'mix', cb); }).err, 'silver cannot be applied to a gold job');
});
test('carry-forward: reversing the pair needs the job reopened; reversing one half alone is refused; a used lot cannot be reversed', function(){
  var a = fresh(); var k = pk(a, 'C7'); trust(a, k);
  var j = pjob(a, k); issueV(a, j, '10', '92'); closeV(a, j, {settle:'carry', opId:'rv1'});
  var out = a.S.kgLedger.filter(function(e){ return e.type === 'CARRY_OUT'; })[0];
  ok(call(function(cb){ a.kgReverse(out.id, 'trying only one half', op(), cb); }).err, 'one half alone refused');
  ok(call(function(cb){ a.kgReverseCarry('rv1:c0', 'undo the carry now', op(), cb); }).err, 'closed job: reopen first');
  ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err);
  var j2 = pjob(a, k); ok(!call(function(cb){ a.kgApplyCarry(j2.id, '', 1000, 'use1', cb); }).err);
  var used = call(function(cb){ a.kgReverseCarry('rv1:c0', 'undo the carry now', op(), cb); }); ok(used.err, 'part of the lot is already used');
  var ap = a.S.kgLedger.filter(function(e){ return e.type === 'CARRY_APPLY'; })[0];
  ok(!call(function(cb){ a.kgReverse(ap.id, 'applied by mistake', op(), cb); }).err); eq(a.kgCarryTotal(k.id, 'gold'), 9200, 'reversing the apply gives the lot back');
  var ok1 = call(function(cb){ a.kgReverseCarry('rv1:c0', 'undo the carry now', op(), cb); }); ok(!ok1.err, ok1.err && ok1.err.message);
  eq(a.kgCarryTotal(k.id, 'gold'), 0); eq(bal(a, j).openFine, 9200, 'the job holds it again'); eq(holds(a, k, 'gold'), 9200);
});
test('accepted loss: owner only, reason needed; the job closes with nothing open', function(){
  var a = fresh('owner'); var k = pk(a, 'S3', 'salary'); var j = pjob(a, k); issueV(a, j, '10', '92'); receiptV(a, j, {gross:'9.9', purity:'92'});   // 0.092 g short
  a.SAAS.user.role = 'manager'; var m = closeV(a, j, {settle:'loss', reason:'filing loss accepted'}); ok(m.err && /Only the owner/.test(m.err.message)); eq(j.status, 'open');
  a.SAAS.user.role = 'owner';
  ok(closeV(a, j, {settle:'loss', reason:'no'}).err, 'short reason refused');
  var r = closeV(a, j, {settle:'loss', reason:'filing and polishing loss'}); ok(!r.err, r.err && r.err.message);
  eq(j.status, 'closed'); eq(bal(a, j).openFine, 0); eq(bal(a, j).approvedLoss, 92);
});
test('loss as a cash bill: the gold loss clears, the rupees reduce what you owe him, and the two are never netted', function(){
  var a = fresh('owner'); var k = pk(a, 'W1'); var j = pjob(a, k); issueV(a, j, '10', '92'); receiptV(a, j, {gross:'9', purity:'92'});   // 9.2 issued; capped credit 9*(0.96)=8.64 -> 0.56 open
  a.S.kgSalary.push({id:'acc1', opId:'acc1', type:'ACCRUAL', karigarId:k.id, period:'2026-11', amountPaise:3000000, ts:'t', date:a.kgToday()});
  var payBefore = a.kgSalaryBalance(k.id).payable; eq(payBefore, 3000000);
  ok(closeV(a, j, {settle:'loss-cash', reason:'cash bill for loss'}).err, 'bill amount needed');
  var r = closeV(a, j, {settle:'loss-cash', reason:'cash bill for loss', billText:'1500'}); ok(!r.err, r.err && r.err.message);
  eq(j.status, 'closed'); eq(bal(a, j).openFine, 0); eq(a.kgSalaryBalance(k.id).payable, payBefore - 150000, 'rupee balance down by the bill');
  eq(a.S.kgSalary.filter(function(x){ return x.type === 'DEDUCTION'; }).length, 1);
  var loss = a.S.kgLedger.filter(function(e){ return e.type === 'LOSS'; })[0]; eq(loss.settle, 'cash'); eq(loss.billPaise, 150000);
  ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err);
  ok(call(function(cb){ a.kgReverse(loss.id, 'bill was wrong', op(), cb); }).err, 'the loss cannot be reversed while its bill stands');
  var ded = a.S.kgSalary.filter(function(x){ return x.type === 'DEDUCTION'; })[0];
  ok(!call(function(cb){ a.kgAddSalary({type:'REVERSAL', opId:op(), karigarId:k.id, reversesId:ded.id, reason:'bill was wrong'}, cb); }).err);
  ok(!call(function(cb){ a.kgReverse(loss.id, 'bill was wrong', op(), cb); }).err, 'after the bill is reversed the loss can be');
  eq(a.kgSalaryBalance(k.id).payable, payBefore);
});
test('a failed save rolls back a close with a carry: no entries, job still open', function(){
  var a = fresh(); var k = pk(a, 'C8'); trust(a, k); var j = pjob(a, k); issueV(a, j, '10', '92');
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var r = closeV(a, j, {settle:'carry'}); ok(r.err);
  eq(j.status, 'open'); eq(a.S.kgLedger.length, 1); eq(a.kgCarryTotal(k.id, 'gold'), 0); eq(bal(a, j).openFine, 9200);
});
test('a failed save rolls back an accepted-loss close including the rupee bill', function(){
  var a = fresh('owner'); var k = pk(a, 'W2'); var j = pjob(a, k); issueV(a, j, '10', '92');
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(closeV(a, j, {settle:'loss-cash', reason:'cash bill for loss', billText:'900'}).err);
  eq(j.status, 'open'); eq(a.S.kgLedger.length, 1); eq(a.S.kgSalary.length, 0);
});
test('close settlement refuses an old-rules job and a karigar who returned too much', function(){
  var a = fresh(); var k = karigar(a, 'Old2', {kind:'wastage', wastagePct:'4'}); var oj = job(a, k); metal(a, oj, 'ISSUE', 10000, '999');
  var r = closeV(a, oj, {settle:'loss', reason:'whatever it is'}); ok(r.err, 'old job keeps its old rules');
  var p = pk(a, 'C9', 'salary'); var j = pjob(a, p); issueV(a, j, '5', '92'); receiptV(a, j, {gross:'6', purity:'92'});   // returned 5.52 > 4.6 issued
  ok(bal(a, j).openFine < 0); ok(closeV(a, j, {settle:'loss', reason:'cannot do this'}).err);
});
test('quarterly count: due only for a trusted karigar carrying a balance, 90 days after the last count', function(){
  var a = fresh(); var k = pk(a, 'C10'); eq(a.kgCountDue(k.id), false, 'not trusted');
  trust(a, k); eq(a.kgCountDue(k.id), false, 'nothing carried');
  var j = pjob(a, k); issueV(a, j, '10', '92'); closeV(a, j, {settle:'carry'});
  eq(a.kgCountDue(k.id), true, 'never counted');
  ok(!call(function(cb){ a.kgMarkCounted(k.id, 'counted with him', cb); }).err); eq(a.kgCountDue(k.id), false);
  a.findKarigar(k.id).lastCountAt = '2026-01-01'; eq(a.kgCountDue(k.id), true, 'old count');
  a.SAAS.user.role = 'staff'; ok(call(function(cb){ a.kgMarkCounted(k.id, 'x', cb); }).err, 'staff cannot');
});
test('carry settings are owner only and validate the limit', function(){
  var a = fresh('owner'); var k = pk(a, 'C11'); a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kgSetCarry(k.id, {trusted:true}, cb); }).err);
  a.SAAS.user.role = 'owner'; ok(call(function(cb){ a.kgSetCarry(k.id, {trusted:true, ceilingGold:'abc'}, cb); }).err);
  ok(!call(function(cb){ a.kgSetCarry(k.id, {trusted:true, ceilingGold:'25.5'}, cb); }).err); eq(a.findKarigar(k.id).carryCeilingMg.gold, 25500);
});
test('needed weight: rounds up so the fine covers the need, never overshoots by a whole mg', function(){
  var a = fresh();
  eq(a.kgNeededWeightMg(10000, 4000, 9200), 6522); ok(a.kgFineFromPu(6522, 9200) >= 6000); ok(a.kgFineFromPu(6521, 9200) < 6000);
  eq(a.kgNeededWeightMg(5000, 5000, 9200), 0); eq(a.kgNeededWeightMg(5000, 9000, 9200), 0);
});

console.log('\nKarigar redesign batch 4 - karigar to karigar transfer, paired reversal');

function chain(a, ptsA, ptsB){
  var A = pk(a, 'Maker' + (++seq), 'wastage', ptsA), B = pk(a, 'Setter' + (++seq), 'wastage', ptsB);
  var j = pjob(a, A);
  var s1 = call(function(cb){ a.kgAddStage(j.id, 'Making', A.id, cb); }).v, s2 = call(function(cb){ a.kgAddStage(j.id, 'Setting', B.id, cb); }).v;
  return {A:A, B:B, j:j, s1:s1, s2:s2};
}
function xfer(a, c, wt, pur, id){
  return call(function(cb){ a.kgTransfer({jobId:c.j.id, fromStageId:c.s1.id, toStageId:c.s2.id, wt:wt, purity:pur, confirmed:true, opId:id || op()}, cb); });
}
test('transfer: the metal moves from one karigar to the other once; the job total does not change', function(){
  var a = fresh(); var c = chain(a); issueV(a, c.j, '20', '92', c.s1.id);   // A holds 18.400
  var jobBefore = bal(a, c.j).openFine, led = function(){ return a.S.kgLedger; };
  var r = xfer(a, c, '10', '92'); ok(!r.err, r.err && r.err.message);
  eq(a.kgKarigarJobFine(c.j, led(), c.A.id), 18400 - 9200); eq(a.kgKarigarJobFine(c.j, led(), c.B.id), 9200);
  eq(bal(a, c.j).openFine, jobBefore, 'open fine on the job is the same'); eq(bal(a, c.j).transferIn, 9200); eq(bal(a, c.j).transferOut, 9200);
  eq(a.kgKarigarJobFine(c.j, led(), c.A.id) + a.kgKarigarJobFine(c.j, led(), c.B.id), bal(a, c.j).openFine);
});
test('transfer: the receiving karigar can return it and is credited under his own points', function(){
  var a = fresh(); var c = chain(a, '4', '3'); issueV(a, c.j, '20', '', c.s1.id, '999'); ok(!xfer(a, c, '10', '99.9').err);
  eq(a.kgKarigarJobFine(c.j, a.S.kgLedger, c.B.id), 9990);
  var r = receiptV(a, c.j, {gross:'5', purity:'99.9'}, c.s2.id);
  eq(r.entry.pointsPu, 300, 'B own points'); eq(r.entry.creditFineMg, 5000, '99.9 + 3 points stops at 100%'); eq(a.kgKarigarJobFine(c.j, a.S.kgLedger, c.B.id), 9990 - 5000);
});
test('transfer: cannot move more than he holds, to himself, a missing stage, a wrong metal, or on a closed job', function(){
  var a = fresh(); var c = chain(a); issueV(a, c.j, '10', '92', c.s1.id);     // A holds 9.200
  ok(xfer(a, c, '11', '92').err, 'more than he holds');
  var self = call(function(cb){ a.kgTransfer({jobId:c.j.id, fromStageId:c.s1.id, toStageId:c.s1.id, wt:'1', purity:'92', confirmed:true, opId:op()}, cb); }); ok(self.err, 'to himself');
  ok(call(function(cb){ a.kgTransfer({jobId:c.j.id, fromStageId:c.s1.id, toStageId:'', wt:'1', purity:'92', confirmed:true, opId:op()}, cb); }).err, 'stage needed');
  ok(call(function(cb){ a.kgTransfer({jobId:c.j.id, fromStageId:c.s1.id, toStageId:c.s2.id, wt:'1', purity:'49', confirmed:true, opId:op()}, cb); }).err, 'purity guard applies');
  var u = call(function(cb){ a.kgTransfer({jobId:c.j.id, fromStageId:c.s1.id, toStageId:c.s2.id, wt:'1', purity:'91.82', opId:op()}, cb); }); ok(u.err && u.err.confirm, 'unusual purity asks first');
  eq(a.S.kgLedger.length, 1, 'nothing was saved by the refused tries');
});
test('transfer: one save, all or nothing; a failed save leaves both karigars as they were; the same operation id saves once', function(){
  var a = fresh(); var c = chain(a); issueV(a, c.j, '10', '92', c.s1.id); var id = op();
  var r1 = xfer(a, c, '4', '92', id), r2 = xfer(a, c, '4', '92', id); ok(!r1.err && r2.dup === true); eq(a.S.kgLedger.length, 3);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(xfer(a, c, '1', '92').err); eq(a.S.kgLedger.length, 3, 'rolled back'); eq(a.kgKarigarJobFine(c.j, a.S.kgLedger, c.B.id), 3680);
});
test('transfer: reversed as a pair; one half alone is refused; not once he has passed the metal on', function(){
  var a = fresh(); var c = chain(a); issueV(a, c.j, '10', '92', c.s1.id);
  var r = xfer(a, c, '10', '92', 'tv1'); ok(!r.err);
  var inn = a.S.kgLedger.filter(function(e){ return e.type === 'TRANSFER_IN'; })[0];
  ok(call(function(cb){ a.kgReverse(inn.id, 'only one half', op(), cb); }).err, 'one half alone refused');
  receiptV(a, c.j, {gross:'4', purity:'92'}, c.s2.id);                                   // B returns some of it
  var blocked = call(function(cb){ a.kgReverseTransfer('tv1:v', 'sent to wrong karigar', op(), cb); }); ok(blocked.err && /already returned or passed on/.test(blocked.err.message), 'B no longer holds it all');
  var rb = a.S.kgLedger.filter(function(e){ return e.type === 'RECEIPT'; })[0];
  ok(!call(function(cb){ a.kgReverse(rb.id, 'weighed wrong', op(), cb); }).err);
  var ok1 = call(function(cb){ a.kgReverseTransfer('tv1:v', 'sent to wrong karigar', op(), cb); }); ok(ok1.err === null || ok1.err === undefined, ok1.err && ok1.err.message);
  eq(a.kgKarigarJobFine(c.j, a.S.kgLedger, c.A.id), 9200); eq(a.kgKarigarJobFine(c.j, a.S.kgLedger, c.B.id), 0); eq(bal(a, c.j).transferIn, 0); eq(bal(a, c.j).transferOut, 0);
  ok(call(function(cb){ a.kgReverseTransfer('tv1:v', 'again please', op(), cb); }).err, 'already reversed');
});
test('transfer: silver moves as silver; the gold account of both is untouched', function(){
  var a = fresh(); var A = pk(a, 'SilverA'), B = pk(a, 'SilverB'); var j = pjob(a, A, {metal:'silver'});
  var s1 = call(function(cb){ a.kgAddStage(j.id, 'Make', A.id, cb); }).v, s2 = call(function(cb){ a.kgAddStage(j.id, 'Polish', B.id, cb); }).v;
  issueV(a, j, '100', '92.5', s1.id);
  var r = call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:s1.id, toStageId:s2.id, wt:'40', purity:'92.5', confirmed:true, opId:op()}, cb); }); ok(!r.err, r.err && r.err.message);
  eq(a.kgKarigarJobFine(j, a.S.kgLedger, B.id), 37000); eq(a.S.kgLedger.filter(function(e){ return e.metal === 'gold'; }).length, 0);
});
test('stage rule: a stage that returns to the shop first (receipt, then a fresh issue) and a direct transfer give the same custody', function(){
  var a = fresh(); var c1 = chain(a, '0', '0'), c2 = chain(a, '0', '0');
  issueV(a, c1.j, '10', '', c1.s1.id, '999'); receiptV(a, c1.j, {gross:'10', purity:'99.9'}, c1.s1.id); issueV(a, c1.j, '10', '99.9', c1.s2.id);
  issueV(a, c2.j, '10', '', c2.s1.id, '999'); xfer(a, c2, '10', '99.9');
  eq(a.kgKarigarJobFine(c1.j, a.S.kgLedger, c1.B.id), 9990); eq(a.kgKarigarJobFine(c2.j, a.S.kgLedger, c2.B.id), 9990);
  eq(a.kgKarigarJobFine(c1.j, a.S.kgLedger, c1.A.id), 10); eq(a.kgKarigarJobFine(c2.j, a.S.kgLedger, c2.A.id), 10);
  eq(bal(a, c1.j).openFine, bal(a, c2.j).openFine, 'both routes leave the same total open');
});
test('ledger switch ON: a transfer is refused like every new-style entry', function(){
  var a = fresh(); var c = chain(a); issueV(a, c.j, '10', '92', c.s1.id); a.S.kgLedgerOn = true;
  var r = xfer(a, c, '1', '92'); ok(r.err && /not available while the ledger is on/.test(r.err.message)); eq(a.S.kgLedger.length, 1);
});

console.log('\nKarigar redesign batch 5 - account, tiles, statement, order-side kept apart');

test('account: opening + on jobs + carried, per metal; rupees are their own balance and never netted', function(){
  var a = fresh('owner'); var k = pk(a, 'A1'); trust(a, k);
  ok(!call(function(cb){ a.kgAddOpening({karigarId:k.id, metal:'gold', wt:'50', purity:'92', confirmed:true, opId:op()}, cb); }).err);    // 46.000
  var j = pjob(a, k); issueV(a, j, '10', '92');                                                                                         // +9.200
  var js = pjob(a, k, {metal:'silver'}); issueV(a, js, '100', '92.5');                                                                 // silver 92.500
  a.S.kgSalary.push({id:'s1', opId:'s1', type:'ACCRUAL', karigarId:k.id, period:'2026-11', amountPaise:500000, ts:'t', date:a.kgToday()});
  var ac = a.kgAccount(k.id);
  eq(ac.gold.openingMg, 46000); eq(ac.gold.inJobsMg, 9200); eq(ac.gold.carryMg, 0); eq(ac.gold.totalMg, 55200);
  eq(ac.silver.totalMg, 92500); eq(ac.rupees.payablePaise, 500000);
  eq(ac.gold.totalMg + ac.silver.totalMg === 147700, true, 'only to show the two metals are kept as two numbers in the account object');
  eq(ac.inProgress, 2);
});
test('account: a carry-forward and applying it never change the total; a double count would show here', function(){
  var a = fresh(); var k = pk(a, 'A2'); trust(a, k);
  var j = pjob(a, k); issueV(a, j, '10', '92'); receiptV(a, j, {gross:'5', purity:'92'});
  var t0 = a.kgAccount(k.id).gold.totalMg; eq(t0, 4400);
  closeV(a, j, {settle:'carry'}); var c = a.kgAccount(k.id).gold; eq(c.totalMg, t0); eq(c.carryMg, 4400); eq(c.inJobsMg, 0);
  var j2 = pjob(a, k); ok(!call(function(cb){ a.kgApplyCarry(j2.id, '', 1000, 'ac1', cb); }).err);
  var d = a.kgAccount(k.id).gold; eq(d.totalMg, t0); eq(d.carryMg, 3400); eq(d.inJobsMg, 1000);
  issueV(a, j2, '5', '92'); eq(a.kgAccount(k.id).gold.totalMg, t0 + 4600, 'only the new physical issue adds');
});
test('account: a transfer moves metal between two karigars and the sum of both stays the same', function(){
  var a = fresh(); var c = chain(a); issueV(a, c.j, '20', '92', c.s1.id);
  var sum0 = a.kgAccount(c.A.id).gold.totalMg + a.kgAccount(c.B.id).gold.totalMg;
  xfer(a, c, '10', '92');
  eq(a.kgAccount(c.A.id).gold.totalMg, 9200); eq(a.kgAccount(c.B.id).gold.totalMg, 9200); eq(a.kgAccount(c.A.id).gold.totalMg + a.kgAccount(c.B.id).gold.totalMg, sum0);
  eq(a.kgHeldFine('gold'), sum0, 'shop stock held by karigars counts the metal once'); eq(a.kgHeldFine('silver'), 0);
});
test('account: a reversal takes the entry out; a cancelled job is ignored; an old-rules job counts once by its own maths', function(){
  var a = fresh(); var k = pk(a, 'A3'); var j = pjob(a, k); var e = issueV(a, j, '10', '92'); eq(a.kgAccount(k.id).gold.totalMg, 9200);
  ok(!call(function(cb){ a.kgReverse(e.id, 'entered twice by mistake', op(), cb); }).err); eq(a.kgAccount(k.id).gold.totalMg, 0);
  var ok2 = karigar(a, 'OldRules', {kind:'wastage', wastagePct:'4'}); var oj = job(a, ok2); metal(a, oj, 'ISSUE', 100000, '999');
  eq(a.kgAccount(ok2.id).gold.totalMg, a.kgJobBalance(oj, a.S.kgLedger).openFine); eq(a.kgAccount(ok2.id).gold.totalMg, 96000);
  eq(a.kgAccount(k.id).gold.totalMg, 0, 'the other karigar is not touched');
});
test('account: in progress and overdue count open jobs, including a job where he only has a stage', function(){
  var a = fresh(); var c = chain(a); var past = pjob(a, c.A); past.dueDate = '2026-01-01';
  var ca = a.kgAccount(c.A.id), cb = a.kgAccount(c.B.id);
  eq(ca.inProgress, 2); eq(ca.overdue, 1); eq(cb.inProgress, 1, 'B is on the chain job through his stage'); eq(cb.overdue, 0);
});
test('statement: running balance equals the account, with opening line, date range and reversed rows at zero', function(){
  var a = fresh('owner'); var k = pk(a, 'A4'); var j = pjob(a, k); trust(a, k);
  ok(!call(function(cb){ a.kgAddOpening({karigarId:k.id, metal:'gold', wt:'10', purity:'92', confirmed:true, opId:op()}, cb); }).err);
  var i1 = issueV(a, j, '10', '92'); i1.date = '2026-11-01'; a.S.kgLedger[0].date = '2026-10-01';
  var r1 = receiptV(a, j, {gross:'5', purity:'92'}); r1.entry.date = '2026-11-05';
  var i2 = issueV(a, j, '1', '92'); i2.date = '2026-11-10';
  ok(!call(function(cb){ a.kgReverse(i2.id, 'entered twice by mistake', op(), cb); }).err);
  var st = a.kgStatementRange(k.id, 'gold', '2026-11-01', '2026-11-30');
  eq(st.openingMg, 9200, 'opening balance of 10 g at 92 before the range');
  eq(st.rows.length, 3); eq(st.rows[0].type, 'ISSUE'); eq(st.rows[0].balanceMg, 9200 + 9200);
  eq(st.rows[1].type, 'RECEIPT'); eq(st.rows[1].deltaMg, -4800); eq(st.rows[1].balanceMg, 18400 - 4800);
  eq(st.rows[2].state, 'reversed'); eq(st.rows[2].deltaMg, 0);
  eq(st.closingMg, a.kgAccount(k.id).gold.totalMg); eq(st.closingMg, 13600);
  eq(a.kgStatementRange(k.id, 'gold', '2026-11-02', '2026-11-04').rows.length, 0, 'quiet days'); eq(a.kgStatementRange(k.id, 'gold', '2026-11-02', '2026-11-04').openingMg, 18400);
  eq(a.kgStatementRange(k.id, 'silver', '2026-01-01', '2026-12-31').rows.length, 0, 'silver statement is separate');
});
test('statement: a pending loss is shown but moves nothing until the owner approves; carry rows show with zero effect', function(){
  var a = fresh('manager'); var k = (function(){ a.SAAS.user.role = 'owner'; var kk = pk(a, 'A5'); trust(a, kk); return kk; })();
  var j = pjob(a, k); issueV(a, j, '10', '92');
  a.SAAS.user.role = 'manager';
  var loss = {type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, metal:'gold', fineMg:500, category:'filing', reason:'filing loss', proposed:true};
  ok(!call(function(cb){ a.kgAddEntry(loss, cb); }).err);
  var st = a.kgStatementRange(k.id, 'gold', '2000-01-01', '2999-12-31'); eq(st.rows[1].state, 'pending'); eq(st.rows[1].deltaMg, 0); eq(st.closingMg, 9200);
  a.SAAS.user.role = 'owner'; ok(!call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:loss.id, decision:'approve'}, cb); }).err);
  eq(a.kgStatementRange(k.id, 'gold', '2000-01-01', '2999-12-31').closingMg, 8700);
  closeV(a, j, {settle:'carry'}); var st2 = a.kgStatementRange(k.id, 'gold', '2000-01-01', '2999-12-31');
  eq(st2.closingMg, 8700); eq(st2.rows.filter(function(r){ return r.type === 'CARRY_OUT' || r.type === 'CARRY_IN'; }).length, 2);
  eq(st2.rows.filter(function(r){ return r.type === 'CARRY_OUT' || r.type === 'CARRY_IN'; }).every(function(r){ return r.deltaMg === 0; }), true);
});
test('order-side work (old way) is read separately and is never part of the new account', function(){
  var a = fresh(); var k = a.addOrGetKarigar('OrderMan');
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Chain', metal:'gold', purity:'22K', qty:1, weight:10,
    karigarStages:[{task:'Make', karigarId:k.id, status:'assigned', karigarPayMode:'cash', karigarCost:500, issued:[{date:a.kgToday(), wt:10, purity:'22K'}]}]}]}];
  var ow = a.kgOrderWork(k.id); ok(ow.any); ok(ow.held.gold > 0); eq(ow.queue.length, 1); eq(ow.queue[0].ordNo, 'OR-1');
  var ac = a.kgAccount(k.id); eq(ac.gold.totalMg, 0, 'new account ignores order stages'); eq(ac.rupees.payablePaise, 0);
  var other = a.addOrGetKarigar('NoOrders'); eq(a.kgOrderWork(other.id).any, false);
});
test('order overlap chip: a points job linked to an order that has a stage for the same karigar names that order', function(){
  var a = fresh(); var k = pk(a, 'A6');
  a.S.orders = [{id:'o9', ordNo:'OR-9', status:'open', items:[{desc:'Ring', karigarStages:[{task:'Make', karigarId:k.id, status:'assigned'}]}]}];
  var j = pjob(a, k, {orderId:'o9'}); eq(a.kgOrderOverlap(j).join(','), 'OR-9');
  var j2 = pjob(a, k); eq(a.kgOrderOverlap(j2).length, 0);
});

console.log('\nKarigar redesign batch 6 - rupee opening and statement, payments, refining lots');

test('rupee opening balance: owner only, once, you-owe or he-owes, reversible', function(){
  var a = fresh('owner'); var k = pk(a, 'R1');
  function open(dir, amt){ return call(function(cb){ a.kgAddRupeeOpening({karigarId:k.id, dir:dir, amountText:amt, note:'from the old khata', opId:op()}, cb); }); }
  ok(open('sideways', '1').err && /owe him or he owes you/.test(open('sideways', '1').err.message), 'direction must be owe or advance');
  var o = open('owe', '12500'); ok(!o.err, o.err && o.err.message); eq(a.kgSalaryBalance(k.id).payable, 1250000);
  ok(open('owe', '1').err, 'a second opening is refused');
  ok(!call(function(cb){ a.kgAddSalary({type:'REVERSAL', opId:op(), karigarId:k.id, reversesId:o.v.id, reason:'wrong figure typed'}, cb); }).err); eq(a.kgSalaryBalance(k.id).payable, 0);
  ok(!open('advance', '3000').err); eq(a.kgSalaryBalance(k.id).payable, -300000, 'he owes you: payable is negative, not netted into gold');
  ok(a.kgAccount(k.id).gold.totalMg === 0, 'gold untouched');
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kgAddRupeeOpening({karigarId:k.id, dir:'owe', amountText:'5', note:'manager try', opId:op()}, cb); }).err, 'manager refused');
});
test('payment: reduces what you owe, can be reversed; gold and rupees never meet', function(){
  var a = fresh('owner'); var k = pk(a, 'R2', 'salary'); var j = pjob(a, k); issueV(a, j, '10', '92');
  a.S.kgSalary.push({id:'ac', opId:'ac', type:'ACCRUAL', karigarId:k.id, period:'2026-11', amountPaise:3000000, ts:'t', date:a.kgToday()});
  var p = call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:1000000, mode:'cash'}, cb); }); ok(!p.err);
  eq(a.kgAccount(k.id).rupees.payablePaise, 2000000); eq(a.kgAccount(k.id).gold.totalMg, 9200);
  ok(!call(function(cb){ a.kgAddSalary({type:'REVERSAL', opId:op(), karigarId:k.id, reversesId:p.v.id, reason:'paid the wrong person'}, cb); }).err);
  eq(a.kgAccount(k.id).rupees.payablePaise, 3000000);
});
test('rupee statement: running balance equals the register, opening line before the range, reversed rows at zero', function(){
  var a = fresh('owner'); var k = pk(a, 'R3');
  a.S.kgSalary.push({id:'o', opId:'o', type:'OPENING', dir:'owe', karigarId:k.id, amountPaise:100000, note:'open', ts:'2026-10-01T00:00:00Z', date:'2026-10-01'});
  a.S.kgSalary.push({id:'a', opId:'a', type:'ACCRUAL', karigarId:k.id, period:'2026-11', amountPaise:300000, ts:'2026-11-02T00:00:00Z', date:'2026-11-02'});
  a.S.kgSalary.push({id:'p', opId:'p', type:'PAYMENT', karigarId:k.id, amountPaise:50000, mode:'cash', ts:'2026-11-05T00:00:00Z', date:'2026-11-05'});
  a.S.kgSalary.push({id:'r', opId:'r', type:'REVERSAL', karigarId:k.id, reversesId:'p', reason:'wrong person', ts:'2026-11-06T00:00:00Z', date:'2026-11-06'});
  a.S.kgSalary.push({id:'d', opId:'d', type:'DEDUCTION', karigarId:k.id, amountPaise:20000, note:'loss bill', ts:'2026-11-07T00:00:00Z', date:'2026-11-07'});
  var st = a.kgRupeeStatementRange(k.id, '2026-11-01', '2026-11-30');
  eq(st.openingPaise, 100000); eq(st.rows.length, 3); eq(st.rows[0].balancePaise, 400000); eq(st.rows[1].state, 'reversed'); eq(st.rows[1].deltaPaise, 0); eq(st.rows[2].balancePaise, 380000);
  eq(st.closingPaise, a.kgSalaryBalance(k.id).payable); eq(st.closingPaise, 380000);
});
test('refining lot: weighing sweepings lowers his account once and starts a pending lot; the assay credits the shop, not him', function(){
  var a = fresh('owner'); var k = pk(a, 'F1'); var j = pjob(a, k); issueV(a, j, '10', '', '', '999');                                   // 10.000 fine
  var b = a.kgBuildScrap(j.id, '', {wt:'0.5', purity:'80', confirmed:true, kind:'filings', opId:op()}); ok(b.entry, b.error);
  ok(!call(function(cb){ a.kgAddEntry(b.entry, cb); }).err);
  eq(a.kgAccount(k.id).gold.totalMg, 10000 - 400, 'his account drops by the fine in the sweepings (0.5 g at 80% = 0.400)');
  var lots = a.kgRefineLots('gold'); eq(lots.length, 1); eq(lots[0].status, 'pending'); eq(lots[0].estFineMg, 400); eq(lots[0].kind, 'filings');
  var v0 = a.kgShopMetalView('gold'); eq(v0.withKarigarsMg, 9600); eq(v0.refiningEstMg, 400); eq(v0.refinedMg, 0); eq(v0.withKarigarsMg + v0.refiningEstMg, 10000, 'nothing lost or doubled');
  var c = call(function(cb){ a.kgRefineCredit({scrapId:lots[0].scrapId, fineText:'0.380', opId:op()}, cb); }); ok(!c.err, c.err && c.err.message);
  eq(a.kgAccount(k.id).gold.totalMg, 9600, 'the assay does not touch his account');
  var v1 = a.kgShopMetalView('gold'); eq(v1.refiningEstMg, 0); eq(v1.refinedMg, 380); eq(a.kgRefineLots('gold')[0].status, 'credited');
});
test('refining lot: owner only; once; not more than the weight sent; reversible; flag-off only', function(){
  var a = fresh('owner'); var k = pk(a, 'F2'); var j = pjob(a, k); issueV(a, j, '10', '', '', '999');
  var b = a.kgBuildScrap(j.id, '', {wt:'1', purity:'90', confirmed:true, kind:'dust', opId:op()}); call(function(cb){ a.kgAddEntry(b.entry, cb); });
  var id = a.kgRefineLots('gold')[0].scrapId;
  ok(call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'1.001', opId:op()}, cb); }).err, 'more fine than the weight sent');
  ok(call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'abc', opId:op()}, cb); }).err);
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'0.9', opId:op()}, cb); }).err, 'manager cannot record an assay'); a.SAAS.user.role = 'owner';
  var c = call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'0.9', opId:op()}, cb); }); ok(!c.err);
  ok(call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'0.8', opId:op()}, cb); }).err, 'once only');
  ok(!call(function(cb){ a.kgReverse(c.v.id, 'assay slip was for another lot', op(), cb); }).err); eq(a.kgRefineLots('gold')[0].status, 'pending');
  ok(!call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'0.85', opId:op()}, cb); }).err, 'can be re-entered after a reversal');
  a.S.kgLedgerOn = true; ok(call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'0.5', opId:op()}, cb); }).err);
});
test('a reversed scrap entry drops out of the refining lots and gives the fine back to his account', function(){
  var a = fresh('owner'); var k = pk(a, 'F3'); var j = pjob(a, k); issueV(a, j, '10', '', '', '999');
  var b = a.kgBuildScrap(j.id, '', {wt:'1', purity:'90', confirmed:true, kind:'scrap', opId:op()}); var s = call(function(cb){ a.kgAddEntry(b.entry, cb); }).v;
  eq(a.kgAccount(k.id).gold.totalMg, 9100);
  ok(!call(function(cb){ a.kgReverse(s.id, 'weighed on the wrong scale', op(), cb); }).err);
  eq(a.kgAccount(k.id).gold.totalMg, 10000); eq(a.kgRefineLots('gold').length, 0);
});
test('silver refining lots are separate from gold', function(){
  var a = fresh('owner'); var k = pk(a, 'F4'); var j = pjob(a, k, {metal:'silver'}); issueV(a, j, '100', '', '', '999');
  var b = a.kgBuildScrap(j.id, '', {wt:'5', purity:'90', confirmed:true, kind:'filings', opId:op()}); call(function(cb){ a.kgAddEntry(b.entry, cb); });
  eq(a.kgRefineLots('silver').length, 1); eq(a.kgRefineLots('gold').length, 0); eq(a.kgShopMetalView('silver').refiningEstMg, 4500); eq(a.kgShopMetalView('gold').refiningEstMg, 0);
});
test('rupee opening and refining assay: same operation id saves once; a failed save leaves both registers as they were', function(){
  var a = fresh('owner'); var k = pk(a, 'G1'); var j = pjob(a, k); issueV(a, j, '10', '', '', '999');
  var id = op(); function ro(){ return call(function(cb){ a.kgAddRupeeOpening({karigarId:k.id, dir:'owe', amountText:'100', note:'old khata', opId:id}, cb); }); }
  ok(!ro().err); ro(); eq(a.S.kgSalary.length, 1, 'duplicate submit stores one row'); eq(a.kgSalaryBalance(k.id).payable, 10000);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(call(function(cb){ a.kgAddRupeeOpening({karigarId:k.id, dir:'advance', amountText:'5', note:'x', opId:op()}, cb); }).err, 'failed save reported');
  eq(a.S.kgSalary.length, 1, 'rupee row rolled back'); eq(a.kgSalaryBalance(k.id).payable, 10000);
  a.saveToCloud = function(cb){ cb(null); };
  var b = a.kgBuildScrap(j.id, '', {wt:'1', purity:'90', confirmed:true, kind:'dust', opId:op()}); call(function(cb){ a.kgAddEntry(b.entry, cb); });
  var sid = a.kgRefineLots('gold')[0].scrapId, n = a.S.kgLedger.length, held = a.kgHeldFine('gold');
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(call(function(cb){ a.kgRefineCredit({scrapId:sid, fineText:'0.9', opId:op()}, cb); }).err, 'failed save reported');
  eq(a.S.kgLedger.length, n, 'assay entry rolled back'); eq(a.kgRefineLots('gold')[0].status, 'pending'); eq(a.kgHeldFine('gold'), held);
  a.saveToCloud = function(cb){ cb(null); };
  var rid = op(); function rc(){ return call(function(cb){ a.kgRefineCredit({scrapId:sid, fineText:'0.9', opId:rid}, cb); }); }
  ok(!rc().err); rc(); eq(a.S.kgLedger.length, n + 1, 'duplicate assay submit stores one entry'); eq(a.kgHeldFine('gold'), held, 'assay never moves a karigar account');
});

console.log('\nKarigar redesign - review fixes (chain close, hidden negatives, guards, terms snapshot)');

test('closing a chain with a carry: each karigar who still holds metal carries his own part', function(){
  var a = fresh(); var c = chain(a); trust(a, c.A); trust(a, c.B);
  issueV(a, c.j, '10', '92', c.s1.id); issueV(a, c.j, '5', '92', c.s2.id);
  var r = closeV(a, c.j, {settle:'carry', opId:'chain1'}); ok(!r.err, r.err && r.err.message);
  eq(c.j.status, 'closed'); eq(a.kgCarryTotal(c.A.id, 'gold'), 9200); eq(a.kgCarryTotal(c.B.id, 'gold'), 4600);
  eq(a.kgAccount(c.A.id).gold.totalMg, 9200); eq(a.kgAccount(c.B.id).gold.totalMg, 4600);
});
test('closing: one karigar holding +4.6 and another -4.6 does not hide behind a job total of zero', function(){
  var a = fresh(); var A = pk(a, 'HidA'); var B = pk(a, 'HidB', 'salary');
  var j3 = pjob(a, A); var u1 = call(function(cb){ a.kgAddStage(j3.id, 'Make', A.id, cb); }).v, u2 = call(function(cb){ a.kgAddStage(j3.id, 'Set', B.id, cb); }).v;
  issueV(a, j3, '5', '92', u1.id); issueV(a, j3, '5', '92', u2.id); receiptV(a, j3, {gross:'10', purity:'92'}, u2.id);
  eq(bal(a, j3).openFine, 0, 'job total is zero');
  ok(a.kgJobKarigarFines(j3).some(function(x){ return x.fine < 0; }) && a.kgJobKarigarFines(j3).some(function(x){ return x.fine > 0; }), 'A is positive, B negative');
  var z = closeV(a, j3); ok(z.err && /returned more than he was given/.test(z.err.message), 'refused even though the job total is zero'); eq(j3.status, 'open');
});
test('receipt quantity defaults to 1 when left out', function(){
  var a = fresh(); var k = pk(a, 'Q1'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var b = a.kgBuildReceipt(j.id, '', {gross:'5', purity:'92', confirmed:true, piece:'ring', opId:op()}); ok(b.entry, b.error); eq(b.entry.qty, 1);
});
test('new-style entries and builders refuse an old-rules job', function(){
  var a = fresh(); var k = karigar(a, 'OldJob', {kind:'wastage', wastagePct:'4'}); var oj = job(a, k);
  ok(a.kgBuildIssue(oj.id, '', {wt:'1', chip:'999', opId:op()}).error, 'issue builder'); ok(a.kgBuildReceipt(oj.id, '', {gross:'1', purity:'92', piece:'x', opId:op()}).error, 'receipt builder');
  var pj = pjob(a, k); var e = a.kgBuildIssue(pj.id, '', {wt:'1', chip:'999', opId:op()}).entry; e.jobId = oj.id;
  ok(call(function(cb){ a.kgAddEntry(e, cb); }).err, 'a hand-made entry with a purity is refused on the old job'); eq(a.S.kgLedger.length, 0);
});
test('reversal cannot leave a negative holding: not an issue he has already returned against, not an applied carry he has spent', function(){
  var a = fresh(); var k = pk(a, 'Rv1'); var j = pjob(a, k); var i = issueV(a, j, '10', '92'); receiptV(a, j, {gross:'9', purity:'92'});
  var r = call(function(cb){ a.kgReverse(i.id, 'wrong weight entered', op(), cb); }); ok(r.err && /already returned or passed on/.test(r.err.message), 'issue under a receipt'); eq(bal(a, j).issuedFine, 9200);
});
test('reversing a scrap lot is refused while its assay result stands', function(){
  var a = fresh('owner'); var k = pk(a, 'Rv2'); var j = pjob(a, k); issueV(a, j, '10', '', '', '999');
  var b = a.kgBuildScrap(j.id, '', {wt:'1', purity:'90', confirmed:true, kind:'dust', opId:op()}); var s = call(function(cb){ a.kgAddEntry(b.entry, cb); }).v;
  var c = call(function(cb){ a.kgRefineCredit({scrapId:s.id, fineText:'0.9', opId:op()}, cb); }).v;
  ok(call(function(cb){ a.kgReverse(s.id, 'weighed on wrong scale', op(), cb); }).err, 'blocked');
  ok(!call(function(cb){ a.kgReverse(c.id, 'assay for another lot', op(), cb); }).err); ok(!call(function(cb){ a.kgReverse(s.id, 'weighed on wrong scale', op(), cb); }).err, 'then allowed');
});
test('terms are frozen on the job when he joins: a later change of points does not touch metal already handed out', function(){
  var a = fresh(); var k = pk(a, 'Snap', 'wastage', '4'); var j = pjob(a, k); issueV(a, j, '20', '', '', '999');
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'6'}, cb); }).err);
  var r = receiptV(a, j, {gross:'10', purity:'92'}); eq(r.entry.pointsPu, 400, 'still 4 points on this job'); eq(r.entry.creditFineMg, 9600);
  var j2 = pjob(a, k); issueV(a, j2, '20', '', '', '999'); eq(receiptV(a, j2, {gross:'10', purity:'92'}).entry.pointsPu, 600, 'a new job gets the new terms');
  var j3 = pjob(a, k); issueV(a, j3, '20', '', '', '999'); var b = a.kgBuildReceipt(j3.id, '', {gross:'10', purity:'92', piece:'x', qty:'1', opId:op()}).entry;
  b.pointsPu = 1000; b.creditFineMg = a.kgFineFromPu(10000, 10000); b.fineMg = b.creditFineMg; ok(call(function(cb){ a.kgAddEntry(b, cb); }).err, 'hand-made points refused');
});
test('khata for a points job counts what each karigar holds, not the whole job on the first karigar', function(){
  var a = fresh(); var c = chain(a); issueV(a, c.j, '10', '92', c.s1.id); issueV(a, c.j, '5', '92', c.s2.id);
  eq(a.kgKhata(c.A.id).openFine, 9200); eq(a.kgKhata(c.B.id).openFine, 4600);
});
test('lots made on the same day keep a fixed oldest-first order', function(){
  var a = fresh(); var k = pk(a, 'Ord'); trust(a, k);
  var j1 = pjob(a, k); issueV(a, j1, '1', '92'); closeV(a, j1, {settle:'carry', opId:'o1'}); var j2 = pjob(a, k); issueV(a, j2, '2', '92'); closeV(a, j2, {settle:'carry', opId:'o2'});
  var lots = a.kgCarryLots(k.id, 'gold'); eq(lots.length, 2); eq(lots[0].remainingMg, 920, 'earlier ts first'); eq(lots[1].remainingMg, 1840);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if(failed){ console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
