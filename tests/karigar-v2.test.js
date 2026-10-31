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
  ['kgJobs', 'kgLedger', 'kgSalary', 'kgPurities', 'kgAgreements', 'nextKgJobNo'].forEach(function(key){
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if(failed){ console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
