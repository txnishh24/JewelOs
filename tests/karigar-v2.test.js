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
function ok(c, msg){ if(!c) throw new Error(msg || ('assertion failed at line ' + ((new Error().stack.split('\n')[2] || '').match(/:(\d+):\d+\)?$/) || [0, '?'])[1])); }

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
  eq(a.kgReport(d, d).wastage.length, 0, 'an issue and its reversal on the same day net to nothing');
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
  eq(d.withKarigarFine, (50000 - 2000) + (10000 - 400) - 400, 'what he holds in all: j2 and j4 still out, net of the 0.4 g he returned over on j3');
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
  a.SAAS.user = {name:'Another Manager', role:'manager'}; ok(cancel(j, 'customer changed mind').err, 'a manager who did not make the job cannot cancel'); a.SAAS.user = {name:'Tester', email:'t@example.com', role:'owner'};
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
  var p = pk(a, 'C9', 'salary'); var j = pjob(a, p); issueV(a, j, '5', '92'); a.S.kgLedger.push({id:'legacy1', opId:'legacy1', type:'RECEIPT', jobId:j.id, stageId:'', karigarId:p.id, metal:'gold', mg:6000, grossMg:6000, stoneMg:0, pu:9200, purityKey:'92', fineMg:5520, actualFineMg:5520, creditFineMg:5520, kind:'salary', pointsPu:0, pieceDesc:'x', qty:1, date:a.kgToday(), ts:'t', by:'t', role:'owner'});   // returned 5.52 > 4.6 issued (older data: the app now refuses to record this)
  ok(bal(a, j).openFine < 0); ok(closeV(a, j, {settle:'loss', reason:'cannot do this'}).err);
});
test('quarterly count: due only for a trusted karigar carrying a balance, 90 days after the last count', function(){
  var a = fresh(); var k = pk(a, 'C10'); eq(a.kgCountDue(k.id), false, 'not trusted');
  trust(a, k); eq(a.kgCountDue(k.id), false, 'nothing carried');
  var j = pjob(a, k); issueV(a, j, '10', '92'); closeV(a, j, {settle:'carry'});
  eq(a.kgCountDue(k.id), false, 'a balance carried today is not due for a count at 0 days');
  a.S.kgLedger.forEach(function(x){ if(x.type === 'CARRY_IN') x.date = '2026-01-01'; }); eq(a.kgCountDue(k.id), true, 'never counted and the carried balance is older than the count interval');
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
  a.S.kgLedger[a.S.kgLedger.length - 1].date = '2026-11-12';   // the reversal happened on the 12th
  var st = a.kgStatementRange(k.id, 'gold', '2026-11-01', '2026-11-30');
  eq(st.openingMg, 9200, 'opening balance of 10 g at 92 before the range');
  eq(st.rows.length, 4); eq(st.rows[0].type, 'ISSUE'); eq(st.rows[0].balanceMg, 9200 + 9200);
  eq(st.rows[1].type, 'RECEIPT'); eq(st.rows[1].deltaMg, -4800); eq(st.rows[1].balanceMg, 18400 - 4800);
  eq(st.rows[2].type, 'ISSUE'); eq(st.rows[2].deltaMg, 920, 'the original row keeps its figure'); eq(st.rows[3].type, 'REVERSAL'); eq(st.rows[3].state, 'reversal'); eq(st.rows[3].deltaMg, -920); eq(st.rows[3].reason, 'entered twice by mistake');
  var early = a.kgStatementRange(k.id, 'gold', '2026-11-01', '2026-11-11'); eq(early.rows.length, 3, 'a past range does not change after a later reversal'); eq(early.closingMg, 14520);
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
  ok(open('sideways', '1').err && /owe him or he owes the shop/.test(open('sideways', '1').err.message), 'direction must be owe or advance');
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
  eq(st.openingPaise, 100000); eq(st.rows.length, 4); eq(st.rows[0].balancePaise, 400000); eq(st.rows[1].balancePaise, 350000); eq(st.rows[2].state, 'reversal'); eq(st.rows[2].deltaPaise, 50000); eq(st.rows[2].reason, 'wrong person'); eq(st.rows[3].balancePaise, 380000);
  eq(a.kgRupeeStatementRange(k.id, '2026-11-01', '2026-11-05').closingPaise, 350000, 'a range ending before the reversal does not change');
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
  issueV(a, j3, '5', '92', u1.id); issueV(a, j3, '5', '92', u2.id);
  a.S.kgLedger.push({id:'legacy2', opId:'legacy2', type:'RECEIPT', jobId:j3.id, stageId:u2.id, karigarId:B.id, metal:'gold', mg:10000, grossMg:10000, stoneMg:0, pu:9200, purityKey:'92', fineMg:9200, actualFineMg:9200, creditFineMg:9200, kind:'salary', pointsPu:0, pieceDesc:'x', qty:1, date:a.kgToday(), ts:'t', by:'t', role:'owner'});   // older data; the app now refuses this return
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

console.log('\nKarigar profile screens (kg3) - markup, switch, statement text');

test('people list: hostile name is escaped, totals shown, nothing breaks with no karigars', function(){
  var a = fresh(); ok(a.kg3PeopleHtml().indexOf('No karigars yet') !== -1);
  var k = pk(a, '<img src=x onerror=alert(1)>'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var h = a.kg3PeopleHtml();
  ok(h.indexOf('<img') === -1, 'name escaped'); ok(h.indexOf('&lt;img') !== -1);
  ok(h.indexOf('9.200') !== -1, 'fine total shown');
});
test('profile: owner sees payment and carry buttons, manager does not; order work stays separate', function(){
  var a = fresh('owner'); var k = pk(a, 'Prof'); var j = pjob(a, k); issueV(a, j, '10', '92');
  a._kg2.more = 'p:' + k.id; var h = a.kg3ProfileHtml(k.id);   // 11 Nov: the owner's less-used buttons sit under More
  ok(h.indexOf('Record payment') !== -1 && h.indexOf('Carry settings') !== -1, 'owner buttons'); ok(h.indexOf('9.200') !== -1);
  ok(h.indexOf('Order work') === -1, 'no order card when there is no order work');
  a.SAAS.user.role = 'manager'; h = a.kg3ProfileHtml(k.id);
  ok(h.indexOf('Record payment') === -1 && h.indexOf('Carry settings') === -1, 'manager sees no payment or carry buttons');
  ok(h.indexOf('You owe him') === -1 && h.indexOf('Rupees') === -1 && h.indexOf('\u20b9') === -1, 'a manager sees no rupee tile (round 20)');
});
test('profile of an unknown karigar does not throw', function(){
  var a = fresh(); ok(a.kg3ProfileHtml('nope').indexOf('not found') !== -1);
});
test('statement text equals the ledger and marks a reversed line', function(){
  var a = fresh(); var k = pk(a, 'Stm'); var j = pjob(a, k); var e = issueV(a, j, '10', '92'); issueV(a, j, '5', '92');
  var d = a.kgToday();
  var t = a.kg3StatementText(k.id, 'gold', d, d);
  ok(t.indexOf('Opening: 0.000') !== -1 && t.indexOf('Closing: 13.800') !== -1 && /fine$/.test(t), t);
  var r = call(function(cb){ a.kgReverse(e.id, 'wrong entry', op(), cb); }); ok(!r.err, r.err && r.err.message);
  t = a.kg3StatementText(k.id, 'gold', d, d);
  ok(t.indexOf('Reversed: given') !== -1 && t.indexOf('Reason: wrong entry') !== -1 && t.indexOf('+9.200') !== -1 && t.indexOf('-9.200') !== -1 && t.indexOf('Closing: 4.600') !== -1 && !/ISSUE|RECEIPT|TRANSFER/.test(t), t);
  ok(a.kg3StatementData(k.id, 'rupees', d, d).rows.length === 0);
});
test('statement view refuses bad dates instead of showing a wrong total', function(){
  var a = fresh(); var k = pk(a, 'Dt'); a._kg2.stFrom = '2026-13-45'; a._kg2.stTo = '2026-01-01';
  ok(a.kg3StatementHtml(k.id).indexOf('must be real days') !== -1);
  a._kg2.stFrom = '2026-02-01'; a._kg2.stTo = '2026-01-01'; ok(a.kg3StatementHtml(k.id).indexOf('must be real days') !== -1);
});
test('odd purity asks for a tick; the 999 chip and a saved touch do not', function(){
  var a = fresh();
  eq(a.kg3NeedsConfirm({purity:'92'}), false); eq(a.kg3NeedsConfirm({purity:'91.82'}), true); eq(a.kg3NeedsConfirm({purity:'40'}), false, 'hard reject is an error, not a confirm');
  eq(a.kg3NeedsConfirm({purity:'', chip:true}), false); eq(a.kg3NeedsConfirm({purity:'99.95'}), true);
  var v = a.kg3PuV({purity:'92', chip:true, confirmed:false}); eq(v.chip, '999'); eq(v.confirmed, false);
});
test('job page: points job shows holders, slip and reverse buttons; old job keeps the old page', function(){
  var a = fresh(); var k = pk(a, 'Jp'); var j = pjob(a, k, {title:'<b>Set</b>'}); issueV(a, j, '10', '92');
  var h = a.kg3JobHtml(j);
  ok(h.indexOf('<b>Set') === -1 && h.indexOf('&lt;b&gt;Set') !== -1, 'title escaped');
  ok(h.indexOf('Slip') !== -1 && h.indexOf('Reverse') !== -1 && h.indexOf('Give metal') !== -1 && h.indexOf('Close job') !== -1);
  a.SAAS.user.role = 'owner'; var c = closeV(a, j, {settle:'loss', reason:'melted in the furnace', opId:'x1'}); ok(!c.err, c.err && c.err.message);
  h = a.kg3JobHtml(j); ok(h.indexOf('Give metal') === -1 && h.indexOf('Reverse') === -1, 'closed job has no action buttons');
});
test('issue slip text carries date, weight, purity and fine, and no photo field', function(){
  var a = fresh(); var k = pk(a, 'Slip'); var j = pjob(a, k); var e = issueV(a, j, '10', '91.82');
  var t = a.kg3SlipText(e); ok(t.indexOf('10.000') !== -1 && t.indexOf('91.82%') !== -1 && t.indexOf('Fine: 9.182') !== -1, t);
});
test('shop metal block lists a pending refining lot with an assay button', function(){
  var a = fresh(); var k = pk(a, 'Rf'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var b = a.kgBuildScrap(j.id, '', {wt:'1', purity:'50', confirmed:true, kind:'dust', opId:op()}); ok(b.entry, b.error || b.confirm);
  var r = call(function(cb){ a.kgAddEntry(b.entry, cb); }); ok(!r.err, r.err && r.err.message);
  var h = a.kg3ShopMetalHtml('gold'); ok(h.indexOf('Assay result') !== -1 && h.indexOf('dust') !== -1, h);
});

test('manager sees no owner-only buttons: opening balances, assay result', function(){
  var a = fresh('owner'); var k = pk(a, 'Gate'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var b = a.kgBuildScrap(j.id, '', {wt:'1', purity:'50', confirmed:true, kind:'dust', opId:op()}); call(function(cb){ a.kgAddEntry(b.entry, cb); });
  a._kg2.more = 'p:' + k.id; ok(a.kg3ProfileHtml(k.id).indexOf('Opening balance') !== -1 && a.kg3ShopMetalHtml('gold').indexOf('Assay result') !== -1, 'owner has them');
  a.SAAS.user.role = 'manager';
  ok(a.kg3ProfileHtml(k.id).indexOf('Opening balance') === -1 && a.kg3ProfileHtml(k.id).indexOf('Rupee opening') === -1, 'no opening buttons');
  ok(a.kg3ShopMetalHtml('gold').indexOf('Assay result') === -1, 'no assay button');
});

console.log('\nKarigar redesign - rounding over many small returns, and 999 returned at 999');

test('rounding: 21 small returns on one job - every line whole mg, each within 0.5 mg of exact, open = issued - sum of credits', function(){
  var a = fresh(); var k = pk(a, 'Rnd'); var j = pjob(a, k); issueV(a, j, '10', '91.82');
  var sumReal = 0, sumCredit = 0, i;
  for(i = 0; i < 21; i++){
    var e = receiptV(a, j, {gross:'0.333', purity:'91.82'}).entry;
    eq(e.creditFineMg, 319); eq(e.actualFineMg, 306);                       // 333 x 95.82% = 319.08, 333 x 91.82% = 305.76, half-up once per line
    ok(Math.abs(e.creditFineMg - 333 * 9582 / 10000) < 0.5 && Math.abs(e.actualFineMg - 333 * 9182 / 10000) < 0.5, 'line error under 0.5 mg');
    sumReal += e.actualFineMg; sumCredit += e.creditFineMg;
  }
  eq(sumCredit, 6699); eq(sumReal, 6426);
  eq(bal(a, j).openFine, 9182 - 6699, 'open is exactly issued minus the sum of the stored credits');
  ok(Math.abs(sumCredit - 6993 * 9582 / 10000) <= 21 * 0.5 && Math.abs(sumReal - 6993 * 9182 / 10000) <= 21 * 0.5, 'drift against the exact total is bounded by 0.5 mg per line');
});
test('999 returned at 999: no wastage, credit = the weight returned (touch + points stops at 100%)', function(){
  var a = fresh(); var k = pk(a, 'Pure'); var j = pjob(a, k); issueV(a, j, '10', '', '', '999');
  var e = receiptV(a, j, {gross:'4', chip:'999', purity:''}).entry;
  eq(e.actualFineMg, 4000); eq(e.creditFineMg, 4000); eq(bal(a, j).openFine, 6000);
  var w = a.kgWastageCredit(4000, 10000, 400, 1e9); eq(w.creditMg, 4000); eq(w.rawMg, 4000);
  eq(a.kgWastageCredit(4000, 9900, 400, 1e9).creditMg, 4000, '99.00 + 4 points also stops at 100%');
  eq(a.kgWastageCredit(4000, 9600, 400, 1e9).creditMg, 4000, '96.00 + 4 points reaches 100% exactly');
  eq(a.kgWastageCredit(4000, 9200, 400, 1e9).creditMg, 3840, '92.00 + 4 points = 96%');
});

test('screens: a credited assay shows in the shop block with Reverse for the owner only', function(){
  var a = fresh('owner'); var k = pk(a, 'Scr'); var j = pjob(a, k); issueV(a, j, '10', '', '', '999');
  var b = a.kgBuildScrap(j.id, '', {wt:'1', purity:'90', confirmed:true, kind:'dust', opId:op()}); call(function(cb){ a.kgAddEntry(b.entry, cb); });
  var id = a.kgRefineLots('gold')[0].scrapId;
  ok(a.kg3ShopMetalHtml('gold').indexOf('Reverse assay') === -1, 'nothing to reverse yet');
  ok(!call(function(cb){ a.kgRefineCredit({scrapId:id, fineText:'0.85', opId:op()}, cb); }).err);
  ok(a.kg3ShopMetalHtml('gold').indexOf('Reverse assay') !== -1 && a.kg3ShopMetalHtml('gold').indexOf('assay 0.850') !== -1, 'owner sees the credited lot with Reverse');
  a.SAAS.user.role = 'manager'; ok(a.kg3ShopMetalHtml('gold').indexOf('Reverse assay') === -1, 'manager does not');
});

console.log('\nKarigar review round (11 Nov) - P1 fixes');

function openG(a, k, metal, wt, pur, chip){
  var r = call(function(cb){ a.kgAddOpening({karigarId:k.id, metal:metal, wt:wt, purity:pur || '92', chip:chip, confirmed:true, opId:op()}, cb); });
  if(r.err) throw new Error('opening: ' + r.err.message); return r.v;
}
test('P1.1 opening balance is consumed by receipts (drawn after what he holds on the job), and a reversal gives it back', function(){
  var a = fresh('owner'); var k = pk(a, 'O1'); openG(a, k, 'gold', '50', '92');                           // 46.000 fine
  var j = pjob(a, k); issueV(a, j, '10', '92');                                                           // 9.200 on the job
  var r = receiptV(a, j, {gross:'15', purity:'92'});                                                      // credit 15 x 96% = 14.400
  eq(r.entry.creditFineMg, 14400); eq(r.entry.openingUseMg, 5200, 'the part above what he holds on the job comes out of the opening');
  var ac = a.kgAccount(k.id).gold; eq(ac.openingMg, 40800); eq(ac.inJobsMg, 0); eq(ac.totalMg, 40800);
  eq(bal(a, j).openFine, 0, 'the job itself balances');
  ok(!call(function(cb){ a.kgReverse(r.entry.id, 'weighed the wrong ring', op(), cb); }).err);
  eq(a.kgAccount(k.id).gold.openingMg, 46000); eq(a.kgAccount(k.id).gold.totalMg, 55200);
});
test('P1.1 a return with nothing issued on the job still draws from the opening; more than he holds in all is capped / refused', function(){
  var a = fresh('owner'); var k = pk(a, 'O2'); openG(a, k, 'gold', '5', '92');                            // 4.600
  var j = pjob(a, k);
  var r = receiptV(a, j, {gross:'4', purity:'92'});                                                       // 4 x 96% = 3.840
  eq(r.entry.openingUseMg, 3840); eq(a.kgAccount(k.id).gold.totalMg, 760);
  var r2 = receiptV(a, j, {gross:'5', purity:'92'});                                                      // raw 4.8 but only 0.76 left
  eq(r2.entry.creditFineMg, 760); eq(r2.entry.openingUseMg, 760); eq(a.kgAccount(k.id).gold.totalMg, 0);
  var s = pk(a, 'O3', 'salary'); var j2 = pjob(a, s); openG(a, s, 'gold', '1', '92');
  ok(a.kgBuildReceipt(j2.id, '', {gross:'2', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()}).error, 'a salary karigar cannot return more fine than he holds in all');
});
test('P1.2 a points job refuses old-style entries (permille, no pu); an old job refuses points entries', function(){
  var a = fresh(); var k = pk(a, 'V1'); var j = pjob(a, k);
  ok(metal(a, j, 'ISSUE', 10000, '999').err, 'old-style issue on a points job');
  ok(metal(a, j, 'SCRAP', 1000, '999', {kind:'scrap'}).err, 'old-style scrap');
  issueV(a, j, '10', '92');
  ok(metal(a, j, 'RECEIPT', 1000, '999', {pieceDesc:'x', qty:1, stoneMg:0}).err, 'old-style receipt');
  var ok2 = karigar(a, 'V2', {kind:'wastage', wastagePct:'4'}); var oj = job(a, ok2);
  var b = a.kgBuildIssue(j.id, '', {wt:'1', purity:'92', confirmed:true, opId:op()}); b.entry.jobId = oj.id; b.entry.karigarId = ok2.id;
  ok(call(function(cb){ a.kgAddEntry(b.entry, cb); }).err, 'points entry on an old-rules job');
});
test('P1.3 khata, dashboard and report never add gold and silver together and include opening and carry', function(){
  var a = fresh('owner'); var k = pk(a, 'H1'); openG(a, k, 'gold', '50', '92');
  var j = pjob(a, k); issueV(a, j, '10', '92');
  var js = pjob(a, k, {metal:'silver'}); issueV(a, js, '100', '', '', '999');
  var kh = a.kgKhata(k.id); eq(kh.openFine, 46000 + 9200, 'gold only, opening included'); eq(kh.openSilver, 100000);
  var d = a.kgDashboard(); eq(d.withKarigarFine, 55200); eq(d.withKarigarSilver, 100000);
  var b = a.kgBuildScrap(js.id, '', {wt:'5', purity:'90', confirmed:true, kind:'filings', opId:op()}); call(function(cb){ a.kgAddEntry(b.entry, cb); });
  var b2 = a.kgBuildScrap(j.id, '', {wt:'1', purity:'90', confirmed:true, kind:'dust', opId:op()}); call(function(cb){ a.kgAddEntry(b2.entry, cb); });
  var rp = a.kgReport('2000-01-01', '2999-12-31'); eq(rp.scrapTotal, 900, 'gold scrap only'); eq(rp.scrapSilverTotal, 4500);
});
test('P1.3 the blob-to-ledger migration and the reconcile are blocked while a points job exists', function(){
  var a = fresh('owner'); var k = pk(a, 'M1'); pjob(a, k);
  var r = call(function(cb){ a.kgMigrateBlobToLedger(cb, {dryRun:true}); }); ok(r.err && /points/i.test(r.err.message), r.err && r.err.message);
  var rc = a.kgReconcile([]); ok(rc.blocked, 'reconcile says it cannot compare');
});
test('P1.4 scrap, loss and approval cannot take more than he holds on the job', function(){
  var a = fresh('owner'); var k = pk(a, 'L1'); var j = pjob(a, k); issueV(a, j, '10', '92');            // holds 9.200
  var big = a.kgBuildScrap(j.id, '', {wt:'11', purity:'92', confirmed:true, kind:'scrap', opId:op()});
  ok(big.error || call(function(cb){ a.kgAddEntry(big.entry, cb); }).err, 'scrap 10.12 fine > 9.2');
  function loss(mg, extra){ var e = {type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, metal:'gold', fineMg:mg, category:'other', reason:'filing loss', proposed:false, approvedBy:'Tester'};
    Object.keys(extra || {}).forEach(function(x){ e[x] = extra[x]; }); return call(function(cb){ a.kgAddEntry(e, cb); }); }
  ok(loss(9300).err, 'loss above what he holds');
  a.SAAS.user.role = 'manager'; var pr = loss(5000, {proposed:true, approvedBy:''}); ok(!pr.err, pr.err && pr.err.message);
  ok(loss(9000, {proposed:true, approvedBy:''}).err, 'proposals together above what he holds');
  a.SAAS.user.role = 'owner'; var adj = call(function(cb){ a.kgAddEntry({type:'ADJUST', opId:op(), jobId:j.id, karigarId:k.id, fineMg:4800, reason:'count corrected'}, cb); });   // would leave 4.4 against a 5.0 proposal
  ok(adj.err && /waiting for approval/.test(adj.err.message), 'a credit that starves a pending loss is refused up front (R7.24)');
  ok(!call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:pr.v.id, decision:'reject'}, cb); }).err, 'rejecting is always possible');
  ok(!loss(9200).err, 'exactly what he holds is fine');
});
test('P1.5 a salary karigar cannot return more fine than he holds', function(){
  var a = fresh(); var k = pk(a, 'S9', 'salary'); var j = pjob(a, k); issueV(a, j, '5', '92');
  var b = a.kgBuildReceipt(j.id, '', {gross:'6', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()});
  ok(b.error && /hold/i.test(b.error), b.error);
});
test('P1.6 wastage points set after the job was made reach the job until he first holds metal; blank points can be fixed later', function(){
  var a = fresh(); var k = karigar(a, 'T1', {kind:'wastage', wastagePct:'4'}); var j = pjob(a, k);
  ok(a.kgBuildReceipt(j.id, '', {gross:'1', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()}).error, 'no points yet');
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4'}, cb); }).err);
  issueV(a, j, '10', '92');                                                                                 // first metal: points were refreshed to 4 and are now frozen
  eq(a.kgTermsFor(j, k.id).pointsPu, 400);
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'6'}, cb); }).err);
  eq(a.kgTermsFor(j, k.id).pointsPu, 400, 'frozen once he holds metal');
  var k2 = karigar(a, 'T2', {kind:'wastage', wastagePct:'4'}); var j2 = pjob(a, k2); issueV(a, j2, '10', '92');   // issued with blank points
  ok(!call(function(cb){ a.kgSetTerms(k2.id, {kind:'wastage', points:'4'}, cb); }).err);
  eq(a.kgTermsFor(j2, k2.id).pointsPu, 400, 'a job whose points were never set can still pick them up');
  ok(a.kgBuildReceipt(j2.id, '', {gross:'5', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()}).entry);
});
test('P1.7 re-saving terms never wipes wastage points; the subtitle shows points, not a percent', function(){
  var a = fresh(); var k = karigar(a, 'P7', {kind:'wastage', points:'4'});
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', wastagePct:'4'}, cb); }).err);
  eq(a.kgAgreementFor(k.id, a.kgToday()).wastagePoints, 400, 'points kept when the form does not send them');
  eq(k.wastagePoints, 400);
  var txt = a.kgAgreementText(a.kgAgreementFor(k.id, a.kgToday()));
  ok(/4 points/.test(txt) && !/%/.test(txt), txt);
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'5.5'}, cb); }).err); eq(k.wastagePoints, 550);
});
test('P1.8 a points job carries no labour; conceded wastage is shown on the job and in the report', function(){
  var a = fresh('owner'); var k = karigar(a, 'P8', {kind:'wastage', points:'4', labourRate:'10', labourBase:'net'}); var j = pjob(a, k);
  eq(j.labour, null); eq(j.wastageBp, 0); eq(j.fixedMg, 0);
  issueV(a, j, '10', '92'); receiptV(a, j, {gross:'5', purity:'92'});                                       // credit 4.800 - real 4.600 = 0.200 conceded
  eq(bal(a, j).concededFine, 200);
  a._kg2Month = a.kgToday().slice(0, 7); ok(a.kg2ReportsHtml().indexOf('Total allowed') !== -1, 'report page shows the wastage allowed');
  var rp = a.kgReport('2000-01-01', '2999-12-31'); eq(rp.concededTotal, 200); eq(rp.conceded[0].karigarId, k.id); eq(rp.conceded[0].fineMg, 200);
  var html = a.kg3JobHtml(j); ok(html.indexOf('0.200') !== -1 && /conceded|allowed/i.test(html), 'job page shows it');
});

test('P1.9 the old Today / Jobs / Khata pages and the old karigar cards are gone for everyone', function(){
  var a = fresh('owner'); var k = pk(a, 'One'); openG(a, k, 'gold', '50', '92');
  var nav = a.kg2NavHtml(); ok(nav.indexOf('Today') === -1 && nav.indexOf('Khata') === -1 && nav.indexOf('>Jobs<') === -1, 'old tabs hidden: ' + nav);
  ok(nav.indexOf('Karigars') !== -1 && nav.indexOf('Reports') !== -1 && nav.indexOf('Terms') !== -1);
  var wrap = {innerHTML:'x'}; var realGet = a.document.getElementById;
  a.document.getElementById = function(id){ return id === 'karigar-list' ? wrap : realGet.call(a.document, id); };
  a.renderKarigarList(); eq(wrap.innerHTML, '', 'old cards not drawn');
  a.document.getElementById = realGet;
});
test('P1.9 the profile keeps what the old cards were used for: edit details and paying for order work', function(){
  var a = fresh('owner'); var k = pk(a, 'Two');
  ok(a.kg3ProfileHtml(k.id).indexOf('Edit details') !== -1);
});

console.log('\nKarigar review round (11 Nov) - P2 and P3 fixes');

test('P2 a stage cannot be given to another karigar once metal is recorded on it', function(){
  var a = fresh(); var A = pk(a, 'SA'), B = pk(a, 'SB'), C = pk(a, 'SC'); var j = pjob(a, A);
  var st = call(function(cb){ a.kgAddStage(j.id, 'Make', B.id, cb); }).v;
  ok(!call(function(cb){ a.kgStageAction(j.id, st.id, 'who', C.id, cb); }).err, 'free to change before any metal');
  issueV(a, j, '5', '92', st.id);
  var r = call(function(cb){ a.kgStageAction(j.id, st.id, 'who', B.id, cb); }); ok(r.err && /already been recorded/.test(r.err.message), r.err && r.err.message);
});
test('P2 plain words and a sign instead of raw codes (rows, statement, WhatsApp text)', function(){
  var a = fresh('owner'); var A = pk(a, 'Imran'), B = pk(a, 'Pooja'); trust(a, A); var j = pjob(a, A);
  var st = call(function(cb){ a.kgAddStage(j.id, 'Set', B.id, cb); }).v;
  issueV(a, j, '10', '92');
  var t = call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:st.id, wt:'2', purity:'92', confirmed:true, opId:op()}, cb); }); ok(!t.err, t.err && t.err.message);
  var d = a.kgToday(), txt = a.kg3StatementText(A.id, 'gold', d, d);
  ok(txt.indexOf('Handed to Pooja') !== -1 && txt.indexOf('+9.200') !== -1 && txt.indexOf('-1.840') !== -1 && !/ISSUE|TRANSFER_OUT|CARRY_|RECEIPT/.test(txt), txt);
  var html = a.kg3JobHtml(j); ok(html.indexOf('Given') !== -1 && html.indexOf('Handed to Pooja') !== -1 && html.indexOf('Taken over from Imran') !== -1 && !/>(ISSUE|TRANSFER_OUT|TRANSFER_IN)</.test(html), 'job rows use words');
  eq(html.split('Reverse</button>').length - 1, 2, 'one Reverse for the issue and ONE for the transfer pair, not two');
  var r = pjob(a, A); issueV(a, r, '10', '92'); receiptV(a, r, {gross:'5', purity:'92'}); closeV(a, r, {settle:'carry'});
  ok(a.kg3StatementText(A.id, 'gold', d, d).indexOf('Carried forward') !== -1, 'carry rows in words');
});
test('P2 weight errors say what is wrong', function(){
  var a = fresh(); var k = pk(a, 'W'); var j = pjob(a, k);
  function msg(w){ var b = a.kgBuildIssue(j.id, '', {wt:w, purity:'92', confirmed:true, opId:op()}); return b.error || ''; }
  ok(/cannot be zero/.test(msg('0')), msg('0')); ok(/cannot be negative/.test(msg('-5')), msg('-5')); ok(/dot, not a comma/.test(msg('1,5')), msg('1,5'));
  ok(/too large/.test(msg('9999999')), msg('9999999')); ok(/at most 3 decimals/.test(msg('1.2345')), msg('1.2345')); ok(/Enter the weight/.test(msg('')), msg('')); ok(/must be a number/.test(msg('abc')), msg('abc'));
  var g = a.kgBuildReceipt(j.id, '', {gross:'0', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()}); ok(/Gross weight cannot be zero/.test(g.error), g.error);
  var m = {}; ['0', '-5', '1,5', '9999999', '1.2345', ''].forEach(function(w){ m[msg(w)] = 1; }); eq(Object.keys(m).length, 6, 'six different messages');
});
test('P2 the preview shows no fine for a purity the save refuses; silver sheets say silver', function(){
  var a = fresh();
  ['49.99', '100', '120'].forEach(function(p){ var h = a.kg3FineLine({wt:'10', purity:p}, 'Fine given'); ok(/warn/.test(h) && h.indexOf('<b>') === -1, p + ': ' + h); });
  ok(a.kg3FineLine({wt:'10', purity:'92'}, 'Fine given').indexOf('9.200') !== -1);
  ok(a.kg3FineLine({wt:'10', chip:true}, 'Fine given').indexOf('10.000') !== -1);
  ok(/silver/.test(a.kg3PurFields('Purity %', 'silver')[0].label) && !/gold/.test(a.kg3PurFields('Purity %', 'silver')[0].label), 'silver label');
  ok(/gold/.test(a.kg3PurFields('Purity %', 'gold')[0].label));
});
test('P3 a failed save says nothing was saved; closing respects the ledger flag; retry with the same operation id is a duplicate, not an error', function(){
  var a = fresh('owner'); var k = pk(a, 'R1'); var j = pjob(a, k); issueV(a, j, '10', '92');
  a.saveToCloud = function(cb){ cb(new Error('Failed to fetch')); };
  var b = a.kgBuildIssue(j.id, '', {wt:'1', purity:'92', confirmed:true, opId:op()});
  var f = call(function(cb){ a.kgAddEntry(b.entry, cb); }); ok(f.err && /Nothing was saved/.test(f.err.message) && f.err.transient === true, f.err && f.err.message);
  a.saveToCloud = function(cb){ cb(null); };
  a.S.kgLedgerOn = true; var c = closeV(a, j, {settle:'loss', reason:'accepted loss here'}); ok(c.err && /ledger is on/.test(c.err.message), c.err && c.err.message); a.S.kgLedgerOn = false;
  var o1 = {karigarId:k.id, metal:'gold', wt:'5', purity:'92', confirmed:true, opId:'dup-open'};
  ok(!call(function(cb){ a.kgAddOpening(o1, cb); }).err); var again = call(function(cb){ a.kgAddOpening(o1, cb); }); ok(!again.err && again.dup === true, 'opening retry: ' + (again.err && again.err.message));
  var cl = closeV(a, j, {settle:'loss', reason:'accepted loss here', opId:'dup-close'}); ok(!cl.err, cl.err && cl.err.message);
  var cl2 = closeV(a, j, {settle:'loss', reason:'accepted loss here', opId:'dup-close'}); ok(!cl2.err && cl2.dup === true, 'close retry: ' + (cl2.err && cl2.err.message));
  var ro = {karigarId:k.id, dir:'owe', amountText:'100', note:'old khata', opId:'dup-rup'};
  ok(!call(function(cb){ a.kgAddRupeeOpening(ro, cb); }).err); var again2 = call(function(cb){ a.kgAddRupeeOpening(ro, cb); }); ok(!again2.err && again2.dup === true, 'rupee opening retry: ' + (again2.err && again2.err.message));
});

test('opening draw: statement closing equals the account through a receipt and a scrap that draw from the opening, and each reversal row restores it exactly', function(){
  var a = fresh('owner'); var k = pk(a, 'OD1'); openG(a, k, 'gold', '50', '92');                         // 46.000 fine
  var j = pjob(a, k); issueV(a, j, '10', '92');                                                           // 9.200 on the job
  var r = receiptV(a, j, {gross:'15', purity:'92'});                                                      // 14.400 credit, 5.200 from the opening
  var sb = a.kgBuildScrap(j.id, '', {wt:'2', purity:'92', confirmed:true, kind:'dust', opId:op()});      // job is empty, all 1.840 from the opening
  eq(sb.entry.openingUseMg, 1840); ok(!call(function(cb){ a.kgAddEntry(sb.entry, cb); }).err);
  var acc = a.kgAccount(k.id).gold; eq(acc.openingMg, 46000 - 5200 - 1840); eq(acc.inJobsMg, 0); eq(acc.totalMg, 38960);
  eq(acc.totalMg, acc.openingMg + acc.inJobsMg + acc.carryMg, 'total = opening left + on jobs + carried');
  var st = a.kgStatementRange(k.id, 'gold', '2000-01-01', '2999-12-31'); eq(st.closingMg, acc.totalMg, 'statement closing = account');
  ok(!call(function(cb){ a.kgReverse(sb.entry.id, 'weighed the wrong dust', op(), cb); }).err);
  eq(a.kgAccount(k.id).gold.totalMg, 38960 + 1840); eq(a.kgAccount(k.id).gold.openingMg, 46000 - 5200);
  ok(!call(function(cb){ a.kgReverse(r.entry.id, 'weighed the wrong ring', op(), cb); }).err);
  var ac2 = a.kgAccount(k.id).gold; eq(ac2.openingMg, 46000); eq(ac2.inJobsMg, 9200); eq(ac2.totalMg, 55200, 'back to opening + issue, nothing counted twice');
  var st2 = a.kgStatementRange(k.id, 'gold', '2000-01-01', '2999-12-31');
  eq(st2.closingMg, ac2.totalMg); eq(st2.rows.filter(function(x){ return x.state === 'reversal'; }).length, 2, 'each reversal is its own row');
});
test('opening draw: a forged openingUseMg is refused, an issue cannot carry one, and silver and rupees stay out of the gold account', function(){
  var a = fresh('owner'); var k = pk(a, 'OD2'); openG(a, k, 'gold', '5', '92'); openG(a, k, 'silver', '100', '', '999');
  a.kgAddRupeeOpening({karigarId:k.id, dir:'owe', amountText:'500', note:'old', opId:op()}, function(){});
  var j = pjob(a, k);
  var b = a.kgBuildReceipt(j.id, '', {gross:'2', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()}); ok(b.entry, b.error || b.confirm);
  var good = b.entry.openingUseMg; eq(good, 1920); b.entry.openingUseMg = 0; ok(call(function(cb){ a.kgAddEntry(b.entry, cb); }).err, 'receipt that hides its opening draw');
  var i = a.kgBuildIssue(j.id, '', {wt:'1', purity:'92', confirmed:true, opId:op()}); i.entry.openingUseMg = 500;
  ok(call(function(cb){ a.kgAddEntry(i.entry, cb); }).err, 'issue with an opening draw');
  b.entry.openingUseMg = good; var rr = call(function(cb){ a.kgAddEntry(b.entry, cb); }); ok(!rr.err, rr.err && rr.err.message);
  eq(a.kgAccount(k.id).gold.totalMg, 4600 - 1920); eq(a.kgAccount(k.id).silver.totalMg, 100000, 'silver untouched'); eq(a.kgAccount(k.id).rupees.payablePaise, 50000, 'rupees untouched');
  eq(a.kgStatementRange(k.id, 'silver', '2000-01-01', '2999-12-31').closingMg, 100000);
});

test('opening balance cannot be reversed while receipts or scrap have drawn from it', function(){
  var a = fresh('owner'); var k = pk(a, 'RO'); var o = openG(a, k, 'gold', '5', '92');                      // 4.600
  var j = pjob(a, k); var r = receiptV(a, j, {gross:'4', purity:'92'});                                      // draws 3.840 from the opening
  var bad = call(function(cb){ a.kgReverse(o.id, 'typed the wrong weight', op(), cb); }); ok(bad.err && /drawn from|reverse those first/i.test(bad.err.message), bad.err && bad.err.message);
  eq(a.kgAccount(k.id).gold.openingMg, 760, 'nothing changed');
  ok(!call(function(cb){ a.kgReverse(r.entry.id, 'weighed the wrong ring', op(), cb); }).err);
  ok(!call(function(cb){ a.kgReverse(o.id, 'typed the wrong weight', op(), cb); }).err, 'allowed once the receipt is reversed'); eq(a.kgAccount(k.id).gold.totalMg, 0);
});

console.log('\nKarigar review round 3 (11 Nov) - group A maths');

test('R3.A1 a receipt that draws opening freezes the points: terms changed before it apply to it and to every later receipt', function(){
  var a = fresh('owner'); var k = pk(a, 'A1'); openG(a, k, 'gold', '50', '92');
  var j = pjob(a, k);                                                                                       // made at 4 points, nothing issued
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'6'}, cb); }).err);
  var r1 = receiptV(a, j, {gross:'5', purity:'92'}); eq(r1.entry.pointsPu, 600); ok(r1.entry.openingUseMg > 0, 'drew from the opening');
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'8'}, cb); }).err);
  eq(receiptV(a, j, {gross:'5', purity:'92'}).entry.pointsPu, 600, 'same points for the whole job');
  var s = pjob(a, k); ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'3'}, cb); }).err);
  var sb = a.kgBuildScrap(s.id, '', {wt:'1', purity:'92', confirmed:true, kind:'scrap', opId:op()}); ok(sb.entry, sb.error);
  ok(!call(function(cb){ a.kgAddEntry(sb.entry, cb); }).err);                                              // scrap that draws opening also freezes (at 3 points)
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'2'}, cb); }).err);
  eq(receiptV(a, s, {gross:'2', purity:'92'}).entry.pointsPu, 300, 'frozen by the scrap that drew opening');
});
test('R3.A2 a job made with blank points freezes at the first receipt after points are set', function(){
  var a = fresh('owner'); var k = karigar(a, 'A2', {kind:'wastage', wastagePct:'4'}); var j = pjob(a, k); issueV(a, j, '20', '92');
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4'}, cb); }).err);
  eq(receiptV(a, j, {gross:'5', purity:'92'}).entry.pointsPu, 400);
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'6'}, cb); }).err);
  eq(a.kgTermsFor(j, k.id).pointsPu, 400, 'never changes after the first receipt'); eq(receiptV(a, j, {gross:'5', purity:'92'}).entry.pointsPu, 400);
});
test('R3.A2b a failed save of the first receipt does not freeze blank points', function(){
  var a = fresh('owner'); var k = karigar(a, 'A2b', {kind:'wastage', wastagePct:'4'}); var j = pjob(a, k); issueV(a, j, '20', '92');
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4'}, cb); }).err);
  var b = a.kgBuildReceipt(j.id, '', {gross:'5', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()}); ok(b.entry, b.error);
  var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('offline')); };
  ok(call(function(cb){ a.kgAddEntry(b.entry, cb); }).err, 'save failed'); a.saveToCloud = good;
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'6'}, cb); }).err);
  eq(receiptV(a, j, {gross:'5', purity:'92'}).entry.pointsPu, 600, 'nothing was saved, so the points were not frozen');
});
test('R3.A3 openingUseMg is refused on every entry type except RECEIPT and SCRAP, and is ignored in what is left of the opening', function(){
  var a = fresh('owner'); var k = pk(a, 'A3'); openG(a, k, 'gold', '10', '92'); var j = pjob(a, k); issueV(a, j, '5', '92');
  var i = a.kgBuildIssue(j.id, '', {wt:'1', purity:'92', confirmed:true, opId:op()}); i.entry.openingUseMg = 100;
  ok(call(function(cb){ a.kgAddEntry(i.entry, cb); }).err, 'issue');
  var l = {type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, metal:'gold', fineMg:100, category:'filing', reason:'melting loss here', approvedBy:'Tester', openingUseMg:100};
  ok(call(function(cb){ a.kgAddEntry(l, cb); }).err, 'loss');
  var e = a.kgValidateEntry({type:'OPENING', opId:op(), jobId:'', karigarId:k.id, metal:'gold', mg:1000, pu:9200, purityKey:'92', fineMg:920, openingUseMg:5}, {job:null, role:'owner', ledger:a.S.kgLedger, karigar:k, salary:[]});
  ok(e && /opening/i.test(e), e);
  a.S.kgLedger.push({id:'fx', opId:'fx', type:'ISSUE', jobId:j.id, karigarId:k.id, metal:'gold', fineMg:50, mg:50, pu:10000, openingUseMg:999, date:a.kgToday(), ts:'t'});
  eq(a.kgOpeningLeft(a.S.kgLedger, a.kgIndex(a.S.kgLedger), k.id, 'gold'), 9200, 'a stray field on an issue does not eat the opening');
});
test('R3.A4 a job cannot be cancelled while a receipt or scrap on it drew from the opening balance', function(){
  var a = fresh('owner'); var k = pk(a, 'A4'); openG(a, k, 'gold', '10', '92'); var j = pjob(a, k);
  var r = receiptV(a, j, {gross:'2', purity:'92'}); ok(r.entry.openingUseMg > 0);
  var c = call(function(cb){ a.kgCancelJob(j.id, 'made by mistake', cb); }); ok(c.err && /receipt/i.test(c.err.message), c.err && c.err.message);   // 11 Nov: any live receipt blocks a cancel, not only one that drew opening
  eq(j.status, 'open'); eq(a.kgAccount(k.id).gold.openingMg, 9200 - r.entry.openingUseMg);
  ok(!call(function(cb){ a.kgReverse(r.entry.id, 'weighed the wrong ring', op(), cb); }).err);
  ok(!call(function(cb){ a.kgCancelJob(j.id, 'made by mistake', cb); }).err, 'allowed once the draw is reversed'); eq(a.kgAccount(k.id).gold.openingMg, 9200);
});
test('R3.A5 receipts and scrap count a loss that is waiting for approval in what he holds', function(){
  var a = fresh('owner'); var k = pk(a, 'A5'); var j = pjob(a, k); issueV(a, j, '10', '92');                 // 9.200 on the job
  a.SAAS.user.role = 'manager';
  var l = {type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, metal:'gold', fineMg:2000, category:'filing', reason:'melting loss here', proposed:true};
  ok(!call(function(cb){ a.kgAddEntry(l, cb); }).err); a.SAAS.user.role = 'owner';
  var b = a.kgBuildReceipt(j.id, '', {gross:'9', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()});
  ok(b.entry && b.capped && b.entry.creditFineMg === 7200, 'wastage credit is capped at what is free (7.200), not 9.2 less nothing: ' + (b.error || (b.entry && b.entry.creditFineMg)));
  var s = a.kgBuildScrap(j.id, '', {wt:'8', purity:'92', confirmed:true, kind:'scrap', opId:op()}); ok(s.error && /hold/i.test(s.error), s.error);
  var forged = a.kgBuildScrap(j.id, '', {wt:'5', purity:'92', confirmed:true, kind:'scrap', opId:op()}); ok(forged.entry, forged.error);
  forged.entry.fineMg = 8000; forged.entry.mg = 8696; ok(call(function(cb){ a.kgAddEntry(forged.entry, cb); }).err, 'validation refuses it too');
  var okB = a.kgBuildReceipt(j.id, '', {gross:'7', purity:'92', confirmed:true, piece:'x', qty:'1', opId:op()}); ok(okB.entry, okB.error);
});
test('R3.A6 a report for a past range does not change after a later reversal; the reversal shows in the period it happened', function(){
  var a = fresh('owner'); var k = pk(a, 'A6'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var sc = a.kgBuildScrap(j.id, '', {wt:'1', purity:'92', confirmed:true, kind:'scrap', opId:op()}); ok(!call(function(cb){ a.kgAddEntry(sc.entry, cb); }).err);
  var today = a.kgToday();
  a.S.kgLedger.forEach(function(e){ e.date = '2026-01-10'; });
  function period(from, to){ var r = a.kgReport(from, to); delete r.open; delete r.surplus; return JSON.stringify(r); }   // open / surplus are today's state, not the period
  var before = period('2026-01-01', '2026-01-31');
  ok(!call(function(cb){ a.kgReverse(sc.entry.id, 'wrong scrap tin', op(), cb); }).err);
  eq(period('2026-01-01', '2026-01-31'), before, 'January is unchanged');
  eq(a.kgReport(today, today).scrapTotal, -sc.entry.fineMg, 'the reversal is in today\'s period');
  eq(a.kgReport('2000-01-01', '2999-12-31').scrapTotal, 0, 'whole range nets to zero');
});
test('R3.A7 the points subtitle says +1 point / +N points, and "not set" when blank', function(){
  var a = fresh('owner'); eq(a.kgPointsLabel(100), '+1 point'); eq(a.kgPointsLabel(400), '+4 points'); eq(a.kgPointsLabel(450), '+4.5 points'); eq(a.kgPointsLabel(0), '+0 points');
  eq(a.kgPointsLabel(null), 'Wastage points not set');
  var k = pk(a, 'A7', 'wastage', '1'); var j = pjob(a, k);
  ok(/\+1 point(?!s)/.test(a.kg2JobHtml(j)), 'job subtitle singular');
  var k2 = karigar(a, 'A7b', {kind:'wastage', wastagePct:'4'}); var j2 = pjob(a, k2);
  ok(a.kg2JobHtml(j2).indexOf('Wastage points not set') !== -1, 'blank');
});

test('R3.A8 a loss proposed in one period and approved in a later one is in the statement and the report of the approval period, and no period loses it', function(){
  var a = fresh('owner'); var k = pk(a, 'A8'); var j = pjob(a, k); issueV(a, j, '10', '92');
  a.SAAS.user.role = 'manager';
  var pr = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, metal:'gold', fineMg:2000, category:'filing', reason:'filing loss here', proposed:true}, cb); }); ok(!pr.err);
  a.SAAS.user.role = 'owner';
  var ap = call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:pr.v.id, decision:'approve'}, cb); }); ok(!ap.err, ap.err && ap.err.message);
  a.S.kgLedger.forEach(function(e){ e.date = '2026-01-01'; }); pr.v.date = '2026-01-01'; ap.v.date = '2026-01-10';
  var mid = a.kgStatementRange(k.id, 'gold', '2026-01-06', '2026-01-10'), after = a.kgStatementRange(k.id, 'gold', '2026-01-11', '2026-01-31');
  eq(mid.rows.filter(function(r){ return r.type === 'LOSS'; }).length, 1, 'the loss is in the period it was approved');
  eq(mid.closingMg, after.openingMg, 'closing of one period = opening of the next');
  eq(a.kgReport('2026-01-06', '2026-01-10').lossTotal, 2000); eq(a.kgReport('2026-01-01', '2026-01-05').lossTotal, 0);
});
test('R3.A9 an old-rules receipt cannot carry an opening draw, and a reversed issue in a later month nets to nothing in the old wastage report', function(){
  var a = fresh('owner'); var k = karigar(a, 'A9', {kind:'wastage', wastagePct:'10'}); var j = job(a, k);
  var r = metal(a, j, 'RECEIPT', 1000, '999', {pieceDesc:'x', qty:1, stoneMg:0, openingUseMg:500}); ok(r.err && /opening/i.test(r.err.message), r.err && r.err.message);
  var i = metal(a, j, 'ISSUE', 250, '999'); ok(!i.err); i.v.date = '2026-01-10';
  ok(!call(function(cb){ a.kgAddEntry({type:'REVERSAL', opId:op(), jobId:j.id, karigarId:k.id, reversesId:i.v.id, reason:'wrong issue here'}, cb); }).err);
  var jan = a.kgReport('2026-01-01', '2026-01-31').wastage[0], tod = a.kgReport(a.kgToday(), a.kgToday()).wastage[0];
  eq((jan ? jan.keptFine : 0) + (tod ? tod.keptFine : 0), 0, 'kept wastage cancels exactly');
});

console.log('\nKarigar review round 3 (11 Nov) - group B screens');

test('R3.B8 a closed points job shows Reopen job to the owner only, an open one does not', function(){
  var a = fresh('owner'); var k = pk(a, 'B8'); var j = pjob(a, k); issueV(a, j, '10', '92');
  ok(a.kg3JobHtml(j).indexOf('kg2Reopen') === -1, 'open job');
  j.status = 'closed';
  ok(a.kg3JobHtml(j).indexOf('kg2Reopen(') !== -1, 'owner sees Reopen'); a.SAAS.user.role = 'manager'; ok(a.kg3JobHtml(j).indexOf('kg2Reopen(') === -1, 'manager does not');
});
test('R3.B9 a points job can be linked to a customer order; the page shows it; an unknown order is refused; the order stage is never added to his account', function(){
  var a = fresh('owner'); var k = pk(a, 'B9'); openG(a, k, 'gold', '10', '92');
  a.S.orders = [{id:'o9', ordNo:'OR-9', customer:'Mrs Shah', status:'open', items:[{desc:'Ring', metal:'gold', karigarStages:[{task:'Make', karigarId:k.id, status:'assigned', issued:[{date:a.kgToday(), wt:10, purity:'22K'}]}]}]}];
  var before = a.kgAccount(k.id).gold.totalMg, heldBefore = a.kgHeldFine('gold');
  var bad = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'L', model:'points', orderId:'nope'}, op(), cb); }); ok(bad.err && /order/i.test(bad.err.message), bad.err && bad.err.message);
  var j = pjob(a, k, {orderId:'o9'}); eq(j.orderRef.orderId, 'o9');
  var html = a.kg3JobHtml(j); ok(html.indexOf('OR-9') !== -1 && html.indexOf('Mrs Shah') !== -1, 'linked order shown');
  issueV(a, j, '5', '92');
  eq(a.kgAccount(k.id).gold.totalMg, before + 4600, 'only the ledger metal is in his account'); eq(a.kgHeldFine('gold'), heldBefore + 4600);
  ok(a.kgOrderWork(k.id).held.gold > 0, 'order stage metal is shown apart'); ok(a.kgOrderWork(k.id).held.gold < 100, 'in its own units, not added');
  ok(a.kg3ProfileHtml(k.id).indexOf('Order work') !== -1);
  a.S.orders[0].items[0].karigarStages[0].karigarId = k.id; ok(a.kg3JobHtml(j).indexOf('also has a stage on order OR-9') !== -1, 'overlap warning shown');
  a.S.orders[0].status = 'delivered'; var late = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'L2', model:'points', orderId:'o9'}, op(), cb); }); ok(late.err, 'a delivered order cannot be linked');
});
test('R3.B10 statement tiles match the rows: a reversal is not Given, a hand-over is not Returned, closing is unchanged', function(){
  var a = fresh('owner'); var A = pk(a, 'B10a'); var B = pk(a, 'B10b'); var j = pjob(a, A); issueV(a, j, '10', '92');                  // given 9.200
  var r = receiptV(a, j, {gross:'5', purity:'92'});                                                                                  // returned 4.800
  ok(!call(function(cb){ a.kgReverse(r.entry.id, 'weighed the wrong ring', op(), cb); }).err);                                        // +4.800 back to him (a reversal)
  var s = a.kgStatementRange(A.id, 'gold', '2000-01-01', '2999-12-31');
  eq(s.issuedMg, 9200, 'only the issue is Given'); eq(s.returnedMg, 0, 'the receipt and its reversal net to nothing in Returned'); eq(s.otherMg, 0, 'nothing is left in Other');
  eq(s.openingMg + s.issuedMg - s.returnedMg + s.otherMg, s.closingMg, 'tiles add up to closing'); eq(s.closingMg, 9200);
  var h = call(function(cb){ a.kgAddStage(j.id, 'Setting', B.id, cb); }); ok(!h.err, h.err && h.err.message);
  var t = call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:j.stages[0].id, wt:'2', purity:'92', chip:'', confirmed:true, opId:op(), note:''}, cb); }); ok(!t.err, t.err && t.err.message);
  var s2 = a.kgStatementRange(A.id, 'gold', '2000-01-01', '2999-12-31');
  eq(s2.returnedMg, 0, 'a hand-over is not Returned'); eq(s2.otherMg, -1840); eq(s2.openingMg + s2.issuedMg - s2.returnedMg + s2.otherMg, s2.closingMg);
  var html = a.kg3StatementHtml(A.id); ok(html.indexOf('Other changes') !== -1);
  var C = pk(a, 'B10c'); var jc = pjob(a, C); issueV(a, jc, '1', '92'); ok(a.kg3StatementHtml(C.id).indexOf('Other changes') === -1, 'no empty Other tile');
});
test('R3.B11 reports: gold on open points jobs is per karigar like the job page; the owner ledger tools stay', function(){
  var a = fresh('owner'); var A = pk(a, 'B11a'); var B = pk(a, 'B11b'); var j = pjob(a, A); issueV(a, j, '10', '92');
  call(function(cb){ a.kgAddStage(j.id, 'Setting', B.id, cb); });
  call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:j.stages[0].id, wt:'4', purity:'92', chip:'', confirmed:true, opId:op(), note:''}, cb); });
  var r = a.kgReport('2000-01-01', '2999-12-31'); eq(r.open.length, 1); eq(r.open[0].openFine, 9200, 'both karigars hold in all what was issued');
  eq(r.open[0].byKarigar.length, 2); eq(r.open[0].byKarigar[0].fine + r.open[0].byKarigar[1].fine, 9200);
  var on = a.kg2ReportsHtml();
  ok(on.indexOf('Opening balances') !== -1 && on.indexOf('Ledger switch') !== -1, 'the owner ledger tools stay in Reports'); ok(on.indexOf('Switch off') === -1 && on.indexOf('Switch on') === -1, 'no per-device switch row');
  ok(on.indexOf('B11b') !== -1, 'per-karigar line');
});
test('R3.B12 silver 92.5 and 80 are known touches beside 91.6, 75 and 99.9', function(){
  var a = fresh('owner'); var saved = a.kgSavedPus();
  ['92.5', '80', '91.6', '75', '99.9', '92'].forEach(function(t){ var c = a.kgCheckPurity(t, saved); ok(c.pu && !c.confirm && !c.error, t + ' should not ask'); });
  ok(a.kgCheckPurity('93', saved).confirm, 'an unknown touch still asks');
});
test('R3.B13 the receive preview says how much is drawn from his opening balance', function(){
  var a = fresh('owner'); var k = pk(a, 'B13'); openG(a, k, 'gold', '30', '92'); var j = pjob(a, k);
  var t = a.kg3ReceivePreview(j.id, {stage:'', gross:'20', purity:'92', piece:'x', qty:'1'});
  ok(t.indexOf('Drawn from his opening balance: 19.200 g') !== -1, t);
  issueV(a, j, '30', '92'); var t2 = a.kg3ReceivePreview(j.id, {stage:'', gross:'5', purity:'92', piece:'x', qty:'1'}); ok(t2.indexOf('opening balance') === -1, 'not when the job holds enough');
});
test('R3.B14 Pay for order work is a sheet, checked against what is owed, not prompt() / confirm()', function(){
  var a = fresh('owner'); var k = pk(a, 'B14');
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Ring', metal:'gold', karigarStages:[{task:'Make', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:500}]}]}];
  eq(a.kgOrderWork(k.id).owed.cash, 500);
  ok(a.kg3PayOrderCheck(k.id, 'cash', '600').error, 'more than owed'); ok(a.kg3PayOrderCheck(k.id, 'cash', '500.005').error, 'not whole paise'); eq(a.kg3PayOrderCheck(k.id, 'cash', '500').amount, 500); ok(a.kg3PayOrderCheck(k.id, 'cash', 'abc').error, 'not a number'); ok(a.kg3PayOrderCheck(k.id, 'cash', '0').error, 'zero');
  ok(a.kg3PayOrderCheck(k.id, 'gold', '1').error, 'no gold owed'); eq(a.kg3PayOrderCheck(k.id, 'cash', '300').amount, 300);
  var r = call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 300, 'part', op(), cb); }); ok(!r.err, r.err && r.err.message); eq(a.kgOrderWork(k.id).owed.cash, 200);
  var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('offline')); };
  ok(call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 100, '', op(), cb); }).err); a.saveToCloud = good; eq(a.kgOrderWork(k.id).owed.cash, 200, 'a failed save changes nothing');
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 100, '', op(), cb); }).err, 'owner only');
  ok(a.kg3ProfileHtml(k.id).indexOf('promptKarigarPayment') === -1); a.SAAS.user.role = 'owner'; ok(a.kg3ProfileHtml(k.id).indexOf('kg3PayOrder(') !== -1);
});
test('R3.B15 job page: no "Use carried balance" when nothing is carried, at most 5 buttons up front, the rest under More', function(){
  var a = fresh('owner'); var k = pk(a, 'B15'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var html = a.kg3JobHtml(j); ok(html.indexOf('kg3UseCarry') === -1, 'nothing carried');
  function firstRow(h){ var m = h.match(/<div class="kg2-row" id="kg3-actions">([\s\S]*?)<\/div>/); ok(m, 'actions row'); return m[1]; }
  var row = firstRow(html); ok((row.match(/<button/g) || []).length <= 5, 'at most 5 buttons: ' + (row.match(/<button/g) || []).length);
  ok(html.indexOf('kg3More(') !== -1, 'More button');
  a._kg2.jobId = j.id; a.kg3More(); var more = a.kg3JobHtml(j); ok(a.kg3JobHtml(pjob(a, k)).indexOf('kg3Transfer(') === -1, 'More is per job'); ok(more.indexOf('kg3Close(') !== -1 && more.indexOf('kg3Transfer(') !== -1, 'the rest after More');
  var o = pk(a, 'B15c'); call(function(cb){ a.kgSetCarry(o.id, {trusted:true, ceilingGold:'100', ceilingSilver:''}, cb); });
  var j2 = pjob(a, o); issueV(a, j2, '10', '92'); receiptV(a, j2, {gross:'4', purity:'92'});
  ok(!call(function(cb){ a.kgCloseJob(j2.id, cb, {settle:'carry', ackCeiling:true, opId:op()}); }).err); var j3 = pjob(a, o); a._kg2.more = j3.id;
  ok(a.kg3JobHtml(j3).indexOf('kg3UseCarry') !== -1, 'shown when something is carried');
});
test('R3.B16 the statement has a Print / PDF button and print rules that show only the statement', function(){
  var a = fresh('owner'); var k = pk(a, 'B16'); var html = a.kg3StatementHtml(k.id);
  ok(html.indexOf('kg3PrintStatement(') !== -1 && html.indexOf('id="kg3-print"') !== -1, 'button and printable block');
  var css = require('fs').readFileSync(__dirname + '/../index.html', 'utf8'); ok(/kg-printing/.test(css), 'print css'); ok(/\.kg2-chk[^{]*\{[^}]*display:flex/.test(css) && /label\.kg2-chk/.test(css), 'tick box row stays a flex row');
});

console.log('\nKarigar payments - legacy path on the hardened core, Day Book posting');

function owedShop(a, k, cost){
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Ring', metal:'gold', karigarStages:[{task:'Make', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:cost || 500}]}]}];
}
var LEGACY_SHAPE = ['amount', 'date', 'id', 'karigarId', 'note', 'type'];
test('PAY.1 recordKarigarPayment goes through the hardened core: owner only, capped at what is owed, opId dedupe, rollback with audit', function(){
  var a = fresh('owner'); var k = pk(a, 'PAY1'); owedShop(a, k, 500);
  var r = call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 300, 'part', cb); }); ok(!r.err, r.err && r.err.message);
  eq(a.S.karigarPayments.length, 1); var p = a.S.karigarPayments[0];
  eq(Object.keys(p).filter(function(x){ return x !== 'opId'; }).sort().join(), LEGACY_SHAPE.join(), 'same fields as before (plus the dedupe id)');
  eq(p.type, 'cash'); eq(p.amount, 300); eq(p.note, 'part'); ok(!p.dbPost, 'the old path does not post to the Day Book'); eq(a.karigarOwed(k.id).cash, 200);
  ok(call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 250, '', cb); }).err, 'over what is owed'); eq(a.S.karigarPayments.length, 1);
  ok(call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 200.005, '', cb); }).err, 'not whole paise');
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 10, '', cb); }).err, 'owner only'); a.SAAS.user.role = 'staff'; ok(call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 10, '', cb); }).err); a.SAAS.user.role = 'owner';
  function viaOp(){ return call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 50, '', cb, 'fixed-op'); }); } ok(!viaOp().err); ok(!viaOp().err, 'a repeat of the same operation is a duplicate'); eq(a.S.karigarPayments.length, 2, 'recorded once'); eq(a.karigarOwed(k.id).cash, 150);
  var audits = (a.S.auditLog || []).length, good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('offline')); };
  ok(call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 100, '', cb); }).err); a.saveToCloud = good;
  eq(a.S.karigarPayments.length, 2, 'a failed save leaves nothing'); eq(a.karigarOwed(k.id).cash, 150); eq((a.S.auditLog || []).length, audits, 'and no audit row');
  ok(call(function(cb){ a.recordKarigarPayment(k.id, 'gold', 1, '', cb); }).err, 'no gold owed');
});
test('PAY.2 existing payment records are never touched: two shops, one payment each, same totals and byte-identical after new payments', function(){
  var real = [{id:'kp1699000000001', karigarId:'K-A', date:'2026-10-30', type:'cash', amount:1500, note:''}];   // the shape recordKarigarPayment has always written
  var real2 = [{id:'kp1699000000002', karigarId:'K-B', date:'2026-10-31', type:'gold', amount:2.5, note:'advance'}];
  [[real, 'K-A'], [real2, 'K-B']].forEach(function(c){
    var a = fresh('owner'); var k = pk(a, 'PAY2'); c[0][0].karigarId = k.id;
    var before = JSON.stringify(c[0]); a.S.karigarPayments = JSON.parse(before);
    a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Ring', metal:'gold', karigarStages:[{task:'Make', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:3000}]}]}];
    var owedBefore = JSON.stringify(a.karigarOwed(k.id));
    eq(JSON.stringify(a.S.karigarPayments), before, 'loaded as is');
    ok(!call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 100, '', cb); }).err);
    eq(JSON.stringify(a.S.karigarPayments.slice(0, 1)), before, 'the old record is byte-identical');
    eq(JSON.stringify(a.dbAutoLines(a.kgToday()).filter(function(l){ return l.cat === 'karigar-payment'; })), '[]', 'old records and old-path payments post nothing');
    eq(a.karigarOwed(k.id).cash, JSON.parse(owedBefore).cash - 100, 'owed moved by exactly the new payment');
  });
});
test('PAY.3 promptKarigarPayment shows the refusal and records nothing when the cap or the role says no', function(){
  var a = fresh('owner'); var k = pk(a, 'PAY3'); owedShop(a, k, 500); var toasts = []; a.toast = function(m){ toasts.push(m); };
  var n = 0; a.prompt = function(){ n++; return n === 1 ? 'cash' : (n === 2 ? '900' : ''); }; a.confirm = function(){ return true; };
  a.promptKarigarPayment(k.id); eq(a.S.karigarPayments.length, 0); ok(/more than is owed/i.test(toasts[toasts.length - 1]), toasts[toasts.length - 1]);
  n = 0; a.prompt = function(){ n++; return n === 1 ? 'cash' : (n === 2 ? '400' : ''); }; a.promptKarigarPayment(k.id); eq(a.S.karigarPayments.length, 1); ok(/recorded/i.test(toasts[toasts.length - 1]));
  a.SAAS.user.role = 'manager'; var asked = 0; a.prompt = function(){ asked++; return ''; }; a.promptKarigarPayment(k.id);
  eq(asked, 0, 'a manager is refused before any question is asked'); ok(/only the owner/i.test(toasts[toasts.length - 1])); eq(a.S.karigarPayments.length, 1);
  a.SAAS.user.role = 'owner'; ok(/plain number/.test(a.kg3PayOrderCheck(k.id, 'cash', '100.555').error), 'a clear message for too many decimals'); ok(/above zero/.test(a.kg3PayOrderCheck(k.id, 'cash', '0').error));
  var ids = {}; for(var q = 0; q < 40; q++){ var idq = a.kgPayId('kp'); ok(!ids[idq]); ids[idq] = 1; a.S.karigarPayments.push({id:idq}); } a.S.karigarPayments.length = 1;
});
test('PAY.4 Day Book: a payment from the new sheet is one outflow line (cash in the totals, UPI as a non-cash line); repeated reads never double post', function(){
  var a = fresh('owner'); var k = pk(a, 'PAY4'); owedShop(a, k, 1000); var d = a.kgToday();
  var c = call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 300, 'n', op(), cb, {mode:'cash', dbPost:true}); }); ok(!c.err, c.err && c.err.message);
  var u = call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 200, 'n', op(), cb, {mode:'UPI', dbPost:true}); }); ok(!u.err);
  var lines = a.dbAutoLines(d).filter(function(l){ return l.cat === 'karigar-payment'; }); eq(lines.length, 2); a.dbAutoLines(d); a.dbAutoTotals(d); eq(a.dbAutoLines(d).filter(function(l){ return l.cat === 'karigar-payment'; }).length, 2, 'derived, not stored');
  var cash = lines.filter(function(l){ return !l.nonCash; })[0], upi = lines.filter(function(l){ return l.nonCash; })[0];
  eq(cash.dir, 'out'); eq(cash.amount, 300); ok(/Karigar payment/.test(cash.label)); eq(upi.mode, 'UPI'); eq(upi.amount, 200); eq(a.dbAutoTotals(d).out, 300, 'only cash in the cash totals');
  var g = call(function(cb){ a.kg3PayOrderSave(k.id, 'gold', 1, '', op(), cb, {dbPost:true}); }); ok(g.err, 'no gold owed, so none posted');
  eq(a.S.karigarPayments.length, 2);
});
test('PAY.5 reversing a payment posts the opposite line on the day of the reversal; payment and reversal net to zero; owed comes back; once only, owner only, with a reason', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'PAY5'); owedShop(a, k, 1000); var d = a.kgToday();
  var c = call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 300, 'n', op(), cb, {mode:'cash', dbPost:true}); }); var pay = a.S.karigarPayments[0];
  eq(a.karigarOwed(k.id).cash, 700);
  ok(call(function(cb){ a.kg3PayOrderReverse(pay.id, 'no', op(), cb); }).err, 'a reason of at least 5 letters');
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kg3PayOrderReverse(pay.id, 'paid twice by mistake', op(), cb); }).err, 'owner only'); a.SAAS.user.role = 'owner';
  var r = call(function(cb){ a.kg3PayOrderReverse(pay.id, 'paid twice by mistake', op(), cb); }); ok(!r.err, r.err && r.err.message);
  eq(a.karigarOwed(k.id).cash, 1000, 'owed is back');
  var ls = a.dbAutoLines(d).filter(function(l){ return /^karigar-payment/.test(l.cat); }); eq(ls.length, 2); eq(ls.filter(function(l){ return l.dir === 'out'; }).length, 1); eq(ls.filter(function(l){ return l.dir === 'in' && l.cat === 'karigar-payment-reversal'; }).length, 1);
  eq(a.dbNetMovement(d), 0, 'nets to zero in the Day Book');
  ok(call(function(cb){ a.kg3PayOrderReverse(pay.id, 'paid twice by mistake', op(), cb); }).err, 'already reversed');
  var rev = a.S.karigarPayments[1]; ok(call(function(cb){ a.kg3PayOrderReverse(rev.id, 'reversing the reversal', op(), cb); }).err, 'a reversal is not reversed');
  // a reversal on a LATER day: the original day keeps its outflow, the later day gets the inflow, the two together net to zero
  var a2 = fresh('owner'); a2.dbInit(); var k2 = pk(a2, 'PAY5b'); owedShop(a2, k2, 1000);
  call(function(cb){ a2.kg3PayOrderSave(k2.id, 'cash', 400, '', op(), cb, {mode:'cash', dbPost:true}); }); var p2 = a2.S.karigarPayments[0]; p2.date = '2026-11-01';
  call(function(cb){ a2.kg3PayOrderReverse(p2.id, 'wrong karigar paid', op(), cb); });
  eq(a2.dbNetMovement('2026-11-01'), -400); eq(a2.dbNetMovement(a2.kgToday()), 400); eq(a2.dbNetMovement('2026-11-01') + a2.dbNetMovement(a2.kgToday()), 0);
  // old-path payment: reversible (owed back), but posts nothing either way
  var a3 = fresh('owner'); var k3 = pk(a3, 'PAY5c'); owedShop(a3, k3, 1000); call(function(cb){ a3.recordKarigarPayment(k3.id, 'cash', 100, '', cb); });
  var r3 = call(function(cb){ a3.kg3PayOrderReverse(a3.S.karigarPayments[0].id, 'entered by mistake', op(), cb); }); ok(!r3.err); eq(a3.karigarOwed(k3.id).cash, 1000);
  eq(a3.dbAutoLines(a3.kgToday()).filter(function(l){ return /^karigar-payment/.test(l.cat); }).length, 0);
});
test('PAY.6 the sheet and the profile: pay sheet has a paid-by choice for cash, recent payments with Reverse (owner only)', function(){
  var a = fresh('owner'); var k = pk(a, 'PAY6'); owedShop(a, k, 1000);
  call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 300, '', op(), cb, {mode:'UPI', dbPost:true}); });
  var h = a.kg3ProfileHtml(k.id); ok(/kg3PayOrderReverseSheet\(/.test(h) && /UPI/.test(h), 'recent payment with Reverse');
  a.SAAS.user.role = 'manager'; ok(a.kg3ProfileHtml(k.id).indexOf('kg3PayOrderReverseSheet(') === -1, 'not for a manager');
});
test('PAY.7 closed Day Book day: a payment or reversal landing on a closed day is restated once by the sweep; a reversal made today leaves the closed day frozen', function(){
  function setup(){
    var a = fresh('owner'); a.dbInit(); var k = pk(a, 'PAY7'); owedShop(a, k, 5000);
    call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 400, '', op(), cb, {mode:'cash', dbPost:true}); });
    a.S.karigarPayments[0].date = '2026-11-01';
    ok(!call(function(cb){ a.dbCloseDay('2026-11-01', 0, cb); }).err, 'close the payment day');
    return {a:a, k:k};
  }
  var s = setup(), a = s.a, c = a.dbCloseFor('2026-11-01'); eq(c.autoOut, 400); eq(c.autoIn, 0);
  // 1. reversal made TODAY: the closed day stays frozen, the sweep has nothing to do, today carries the inflow
  var pay = a.S.karigarPayments[0]; ok(!call(function(cb){ a.kg3PayOrderReverse(pay.id, 'paid twice by mistake', op(), cb); }).err);
  eq(a.dbCloseFor('2026-11-01').autoOut, 400, 'closed totals not rewritten'); eq(a.dbDayView('2026-11-01').totalOut, 400);
  var sw = call(function(cb){ a.dbSweepRestatements(cb); }); eq(sw.err, null); eq(sw.v, 0, 'nothing restated'); eq((a.S.dayBook.entries || []).filter(function(e){ return e.kind === 'adjust'; }).length, 0);
  eq(a.dbNetMovement(a.kgToday()), 400);
  // 2. a new payment BACKDATED into the closed day: the sweep posts one visible adjustment on the first open day, and only once
  var s2 = setup(), b = s2.a;
  call(function(cb){ b.kg3PayOrderSave(s2.k.id, 'cash', 100, '', op(), cb, {mode:'cash', dbPost:true}); }); b.S.karigarPayments[1].date = '2026-11-01';
  var r1 = call(function(cb){ b.dbSweepRestatements(cb); }); eq(r1.v, 1);
  var adj = b.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; }); eq(adj.length, 1); eq(adj[0].dir, 'out'); eq(adj[0].amount, 100); eq(adj[0].srcDate, '2026-11-01');
  eq(b.dbCloseFor('2026-11-01').autoOut, 500, 're-baselined');
  eq(call(function(cb){ b.dbSweepRestatements(cb); }).v, 0, 'second sweep posts nothing'); eq(b.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; }).length, 1);
  // 3. a reversal dated INTO the closed day: restated as an inflow, so payment + reversal net to zero across the close and its adjustment
  var s3 = setup(), d = s3.a;
  call(function(cb){ d.kg3PayOrderReverse(d.S.karigarPayments[0].id, 'paid twice by mistake', op(), cb); }); d.S.karigarPayments[1].date = '2026-11-01';
  eq(call(function(cb){ d.dbSweepRestatements(cb); }).v, 1); var ad = d.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; });
  eq(ad.length, 1); eq(ad[0].dir, 'in'); eq(ad[0].amount, 400); eq(d.dbCloseFor('2026-11-01').autoIn, 400);
});
test('PAY.8 month range: trend and totals count a payment once and a reversal once (no double count across days or views)', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'PAY8'); owedShop(a, k, 5000); var today = a.kgToday();
  call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 400, '', op(), cb, {mode:'cash', dbPost:true}); }); call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 250, '', op(), cb, {mode:'UPI', dbPost:true}); });
  a.S.karigarPayments[0].date = '2026-11-01';
  call(function(cb){ a.kg3PayOrderReverse(a.S.karigarPayments[0].id, 'wrong karigar paid', op(), cb); });
  var tr = a.dbBuildTrend('2026-11-01', today), sumIn = 0, sumOut = 0;
  tr.forEach(function(t){ sumIn += t.totalIn; sumOut += t.totalOut; });
  eq(sumOut, 400, 'cash payment counted once; the UPI one is non-cash and not in cash totals'); eq(sumIn, 400, 'reversal counted once');
  eq(a.dbAutoTotals('2026-11-01').out, 400); eq(a.dbAutoTotals(today).in, 400); eq(a.dbAutoTotals(today).out, 0); eq(a.dbAutoTotals(today).nonCashAmount, 250);
  eq(tr.reduce(function(n, t){ return n + a.dbNetMovement(t.date); }, 0), 0, 'net over the month is zero');
});

console.log('\nKarigar advance - owner-only, reason, confirm, Day Book, reversible, never netted with metal');

function adv(a, kid, amount, o){
  o = o || {};
  return call(function(cb){ a.kg3PayOrderSave(kid, o.type || 'cash', amount, '', op(), cb, {advance:true, reason:(o.reason == null ? 'festival advance' : o.reason), confirmed:(o.confirmed == null ? true : o.confirmed), mode:o.mode || 'cash', dbPost:true}); });
}
test('ADV.1 a plain payment is still refused when nothing is owed; an owner can give an advance with a reason and a confirm; it makes the payable negative (he owes the shop)', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'ADV1'); a.S.orders = [];
  ok(call(function(cb){ a.recordKarigarPayment(k.id, 'cash', 500, '', cb); }).err, 'old button: refused'); ok(a.kg3PayOrderCheck(k.id, 'cash', '500').error, 'sheet payment: refused');
  var r = adv(a, k.id, '500'); ok(!r.err, r.err && r.err.message); eq(a.karigarOwed(k.id).cash, -500, 'he owes the shop 500');
  var p = a.S.karigarPayments[0]; eq(p.advance, true); eq(p.reason, 'festival advance'); eq(p.type, 'cash'); eq(p.amount, 500); eq(p.dbPost, true);
  ok(adv(a, k.id, '100', {reason:'no'}).err, 'reason of 5+ letters'); ok(adv(a, k.id, '100', {reason:''}).err); ok(adv(a, k.id, '100', {confirmed:false}).err, 'confirm step is required');
  ok(adv(a, k.id, '100', {type:'gold'}).err, 'cash only: never a metal advance'); ok(adv(a, k.id, '0').err); ok(adv(a, k.id, '10.555').err); ok(adv(a, k.id, 'abc').err);
  a.SAAS.user.role = 'manager'; ok(adv(a, k.id, '100').err, 'owner only'); a.SAAS.user.role = 'staff'; ok(adv(a, k.id, '100').err); a.SAAS.user.role = 'owner';
  eq(a.S.karigarPayments.length, 1, 'only the good one was recorded');
  var same = call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '50', '', 'adv-fixed', cb, {advance:true, reason:'advance again', confirmed:true, dbPost:true}); }); ok(!same.err);
  call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '50', '', 'adv-fixed', cb, {advance:true, reason:'advance again', confirmed:true, dbPost:true}); }); eq(a.S.karigarPayments.length, 2, 'a repeated operation is a duplicate');
  var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('offline')); }; var audits = (a.S.auditLog || []).length;
  ok(adv(a, k.id, '70').err); a.saveToCloud = good; eq(a.S.karigarPayments.length, 2, 'failed save leaves nothing'); eq((a.S.auditLog || []).length, audits);
});
test('ADV.2 an advance posts a Day Book outflow like a payment (cash or UPI), reversing posts the opposite, and the two net to zero', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'ADV2'); a.S.orders = []; var d = a.kgToday();
  var c = adv(a, k.id, '400'); var u = adv(a, k.id, '250', {mode:'UPI'}); ok(!c.err && !u.err);
  var ls = a.dbAutoLines(d).filter(function(l){ return l.cat === 'karigar-payment'; }); eq(ls.length, 2); ls.forEach(function(l){ eq(l.dir, 'out'); ok(/Karigar advance/.test(l.label), l.label); });
  eq(ls.filter(function(l){ return !l.nonCash; })[0].amount, 400); eq(ls.filter(function(l){ return l.nonCash; })[0].mode, 'UPI'); eq(a.dbAutoTotals(d).out, 400);
  eq(a.dbAutoLines(d).filter(function(l){ return l.cat === 'karigar-payment'; }).length, 2, 're-reading never double posts');
  var id = a.S.karigarPayments[0].id; ok(call(function(cb){ a.kg3PayOrderReverse(id, 'no', op(), cb); }).err, 'reversal needs a reason');
  a.SAAS.user.role = 'manager'; ok(call(function(cb){ a.kg3PayOrderReverse(id, 'given by mistake', op(), cb); }).err, 'owner only'); a.SAAS.user.role = 'owner';
  var r = call(function(cb){ a.kg3PayOrderReverse(id, 'given by mistake', op(), cb); }); ok(!r.err, r.err && r.err.message);
  eq(a.karigarOwed(k.id).cash, -250, 'only the UPI advance is left'); eq(a.dbAutoTotals(d).out, 400); eq(a.dbAutoTotals(d).in, 400); eq(a.dbNetMovement(d), 0, 'the cash advance and its reversal net to zero');
  ok(call(function(cb){ a.kg3PayOrderReverse(id, 'given by mistake', op(), cb); }).err, 'once only');
});
test('ADV.3 never netted with gold or silver, the salary register or the metal ledger', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'ADV3'); openG(a, k, 'gold', '10', '92'); a.S.orders = [];
  a.S.karigarPayments = [{id:'kp-old', karigarId:k.id, date:'2026-10-30', type:'gold', amount:2, note:''}];
  var acBefore = JSON.stringify(a.kgAccount(k.id)); var oBefore = a.karigarOwed(k.id);
  ok(!adv(a, k.id, '300').err); var o = a.karigarOwed(k.id);
  eq(o.gold, oBefore.gold, 'gold bucket untouched'); eq(o.silver, oBefore.silver); eq(o.cash, -300);
  eq(JSON.stringify(a.kgAccount(k.id)), acBefore, 'ledger account (gold, silver, rupees) untouched'); eq(a.S.kgSalary.length, 0, 'not in the salary register');
  eq(JSON.stringify(a.S.karigarPayments[0]), JSON.stringify({id:'kp-old', karigarId:k.id, date:'2026-10-30', type:'gold', amount:2, note:''}), 'old record byte-identical');
});
test('ADV.4 the next order work is adjusted against the advance first; the next payment is capped at what is left; the profile says so', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'ADV4'); a.S.orders = []; ok(!adv(a, k.id, '300').err);
  var i0 = a.kg3OrderAdvanceInfo(k.id); eq(i0.given, 300); eq(i0.adjusted, 0); eq(i0.outstanding, 300);
  ok(a.kg3ProfileHtml(k.id).indexOf('owes the shop') !== -1, 'the profile says he owes the shop'); ok(/Advance/.test(a.kg3ProfileHtml(k.id)));
  owedShop(a, k, 1000);                                                                                    // order work of 1000 is submitted
  eq(a.karigarOwed(k.id).cash, 700, 'labour 1000 less the advance 300'); var i1 = a.kg3OrderAdvanceInfo(k.id); eq(i1.adjusted, 300); eq(i1.outstanding, 0);
  ok(/adjusted/i.test(a.kg3ProfileHtml(k.id)), 'profile shows the advance adjusted');
  ok(a.kg3PayOrderCheck(k.id, 'cash', '800').error, 'capped at the 700 that is really owed'); ok(!a.kg3PayOrderCheck(k.id, 'cash', '700').error);
  ok(a.kg3PayOrderPreviewText(k.id, 'cash', '700').indexOf('300') !== -1, 'the sheet preview mentions the advance');
  var recent = a.kg3PayOrderRecentHtml(k.id); ok(/advance/i.test(recent) && /festival advance/.test(recent), 'recent list shows the advance and its reason');
  var b = fresh('owner'); var k2 = pk(b, 'ADV4b'); b.S.orders = []; b._kg2.more = 'p:' + k2.id; ok(b.kg3ProfileHtml(k2.id).indexOf("'advance')") !== -1, 'owner can reach Give advance (under More) even when nothing is owed'); b.SAAS.user.role = 'manager'; ok(b.kg3ProfileHtml(k2.id).indexOf("'advance')") === -1, 'not a manager');
});
test('ADV.5 closed Day Book day: an advance or its reversal landing on a closed day is restated once by the sweep; a reversal made today leaves the closed day frozen', function(){
  function setup(){
    var a = fresh('owner'); a.dbInit(); var k = pk(a, 'ADV5'); a.S.orders = [];
    ok(!adv(a, k.id, '400').err); a.S.karigarPayments[0].date = '2026-11-01';
    ok(!call(function(cb){ a.dbCloseDay('2026-11-01', 0, cb); }).err, 'close the advance day');
    return {a:a, k:k};
  }
  var s = setup(), a = s.a; eq(a.dbCloseFor('2026-11-01').autoOut, 400);
  ok(!call(function(cb){ a.kg3PayOrderReverse(a.S.karigarPayments[0].id, 'given by mistake', op(), cb); }).err);
  eq(a.dbCloseFor('2026-11-01').autoOut, 400, 'closed totals not rewritten'); eq(call(function(cb){ a.dbSweepRestatements(cb); }).v, 0, 'nothing restated');
  eq(a.dbNetMovement(a.kgToday()), 400, 'today carries the inflow');
  var s2 = setup(), b = s2.a; ok(!adv(b, s2.k.id, '100').err); b.S.karigarPayments[1].date = '2026-11-01';
  eq(call(function(cb){ b.dbSweepRestatements(cb); }).v, 1); var adj = b.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; });
  eq(adj.length, 1); eq(adj[0].dir, 'out'); eq(adj[0].amount, 100); eq(b.dbCloseFor('2026-11-01').autoOut, 500);
  eq(call(function(cb){ b.dbSweepRestatements(cb); }).v, 0, 'second sweep posts nothing'); eq(b.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; }).length, 1);
  var s3 = setup(), d = s3.a; call(function(cb){ d.kg3PayOrderReverse(d.S.karigarPayments[0].id, 'given by mistake', op(), cb); }); d.S.karigarPayments[1].date = '2026-11-01';
  eq(call(function(cb){ d.dbSweepRestatements(cb); }).v, 1); var ad = d.S.dayBook.entries.filter(function(e){ return e.kind === 'adjust'; });
  eq(ad.length, 1); eq(ad[0].dir, 'in'); eq(ad[0].amount, 400); eq(d.dbCloseFor('2026-11-01').autoIn, 400);
});
test('ADV.6 reversing an advance after later labour absorbed it, two advances, and advance then plain payment cap', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'ADV6'); a.S.orders = [];
  ok(!adv(a, k.id, '300').err); ok(!adv(a, k.id, '200').err); eq(a.karigarOwed(k.id).cash, -500); var i = a.kg3OrderAdvanceInfo(k.id); eq(i.given, 500); eq(i.outstanding, 500);
  owedShop(a, k, 400); eq(a.karigarOwed(k.id).cash, -100); i = a.kg3OrderAdvanceInfo(k.id); eq(i.adjusted, 400, 'labour 400 absorbed 400 of the 500'); eq(i.outstanding, 100);
  var first = a.S.karigarPayments[0].id; ok(!call(function(cb){ a.kg3PayOrderReverse(first, 'given by mistake', op(), cb); }).err);
  eq(a.karigarOwed(k.id).cash, 200, 'reversing the 300 advance after the labour: he is owed 400 - 200'); i = a.kg3OrderAdvanceInfo(k.id); eq(i.given, 200); eq(i.adjusted, 200); eq(i.outstanding, 0);
  ok(a.kg3PayOrderCheck(k.id, 'cash', '201').error, 'plain payment capped at the 200 really owed'); ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 200, '', op(), cb, {mode:'cash', dbPost:true}); }).err);
  eq(a.karigarOwed(k.id).cash, 0); ok(a.kg3PayOrderCheck(k.id, 'cash', '1').error, 'nothing owed after the cap is paid');
  eq(a.kg3OrderAdvanceInfo(k.id).given, 200); eq(a.kg3OrderAdvanceInfo(k.id).labour, 400, 'labour is the same however it was settled');
  eq(a.dbNetMovement(a.kgToday()), -400, 'out 300+200+200, in 300 (the reversal): no double posting');
});

test('ADV.7 advance adjusted after earlier payments; owed has no float dust; negative balance reads plainly; the sheet opens on cash', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'ADV7'); owedShop(a, k, 1000);
  ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 800, '', op(), cb, {mode:'cash', dbPost:true}); }).err);              // 800 of the 1000 labour paid
  ok(!adv(a, k.id, '500').err); eq(a.karigarOwed(k.id).cash, -300, 'he owes the shop 300');
  var i = a.kg3OrderAdvanceInfo(k.id); eq(i.adjusted, 200, 'only 200 of the advance was absorbed by labour not yet paid'); eq(i.outstanding, 300, 'the profile and the balance agree');
  ok(a.kg3ProfileHtml(k.id).indexOf('he owes the shop \u20b9300') !== -1 || a.kg3ProfileHtml(k.id).indexOf('he owes the shop ₹300') !== -1);
  ok(/^<b>He owes the shop/.test(a.kg3PayOrderPreviewText(k.id, 'cash', '', false)), 'plain wording on the pay path');
  var d = fresh('owner'); var k2 = pk(d, 'ADV7b');
  d.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Ring', metal:'gold', karigarStages:[{task:'A', karigarId:k2.id, status:'submitted', karigarPayMode:'cash', karigarCost:0.7}, {task:'B', karigarId:k2.id, status:'submitted', karigarPayMode:'cash', karigarCost:0.1}]}]}];
  d.S.karigarPayments = [{id:'kp-x', karigarId:k2.id, date:'2026-10-30', type:'cash', amount:0.8, note:''}];
  eq(d.kgOrderWork(k2.id).owed.cash, 0, 'rounded to paise'); eq(d.kgOrderWork(k2.id).any, false, 'no empty Order work block');
  var e = fresh('owner'); var k3 = pk(e, 'ADV7c'); e.S.orders = []; var sheet = ''; e.kgForm = function(o){ sheet = o; };
  e.kg3PayOrder(k3.id); eq(sheet.fields[0].value, 'cash', 'nothing owed: opens on cash, not silver'); e.kg3PayOrder(k3.id, 'advance'); eq(sheet.submitLabel, 'Give advance');
});

console.log('\nTO-CLAUDE-CODE (11 Nov) - group A money, group B smaller maths');

test('TC.A1 a job cannot be cancelled while any live issue, carry, transfer, receipt, scrap, adjust or loss entry exists', function(){
  var a = fresh('owner'); var k = pk(a, 'TA1'); openG(a, k, 'gold', '10', '92'); var j = pjob(a, k);                      // points job, nothing issued
  var ad = call(function(cb){ a.kgAddEntry({type:'ADJUST', opId:op(), jobId:j.id, karigarId:k.id, fineMg:-2000, reason:'count corrected'}, cb); }); ok(!ad.err, ad.err && ad.err.message);
  var before = a.kgAccount(k.id).gold.totalMg;
  var c = call(function(cb){ a.kgCancelJob(j.id, 'made by mistake', cb); }); ok(c.err && /entries|reverse/i.test(c.err.message), c.err && c.err.message);
  eq(j.status, 'open'); eq(a.kgAccount(k.id).gold.totalMg, before, 'the gold account did not move');
  ok(!call(function(cb){ a.kgReverse(ad.v.id, 'entered by mistake', op(), cb); }).err);
  ok(!call(function(cb){ a.kgCancelJob(j.id, 'made by mistake', cb); }).err, 'allowed once the entry is reversed');
  var b = fresh('owner'); var k2 = pk(b, 'TA1b'); var j2 = pjob(b, k2); issueV(b, j2, '10', '92');
  ok(call(function(cb){ b.kgCancelJob(j2.id, 'made by mistake', cb); }).err, 'an issue blocks it too');
  var c3 = fresh('owner'); var k3 = pk(c3, 'TA1c'); var j3 = pjob(c3, k3); issueV(c3, j3, '10', '92'); c3.SAAS.user.role = 'manager';
  call(function(cb){ c3.kgAddEntry({type:'LOSS', opId:op(), jobId:j3.id, karigarId:k3.id, metal:'gold', fineMg:1000, category:'filing', reason:'filing loss here', proposed:true}, cb)});
  c3.SAAS.user.role = 'owner'; ok(call(function(cb){ c3.kgCancelJob(j3.id, 'made by mistake', cb); }).err, 'a pending loss blocks it too');
});
test('TC.A2 a pending loss is never starved: reversing the issue, carrying out or handing over more than he holds free is refused', function(){
  var a = fresh('owner'); var A = pk(a, 'TA2a'); var B = pk(a, 'TA2b'); var j = pjob(a, A); var it = issueV(a, j, '10', '99.9');           // 9.990 fine
  a.SAAS.user.role = 'manager';
  var pr = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:A.id, metal:'gold', fineMg:4000, category:'filing', reason:'filing loss here', proposed:true}, cb); }); ok(!pr.err, pr.err && pr.err.message);
  a.SAAS.user.role = 'owner';
  var rv = call(function(cb){ a.kgReverse(it.id, 'issued the wrong bar', op(), cb); }); ok(rv.err && /returned or passed on|hold/i.test(rv.err.message), 'reversing the issue: ' + (rv.err && rv.err.message));
  var co = call(function(cb){ a.kgAddEntry({type:'CARRY_OUT', opId:op(), jobId:j.id, karigarId:A.id, metal:'gold', fineMg:8000, carryId:'c-1'}, cb); }); ok(co.err, 'carrying out 8 g leaves the 4 g loss without metal');
  ok(!call(function(cb){ a.kgAddStage(j.id, 'Setting', B.id, cb); }).err);
  var tr = call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:j.stages[0].id, wt:'8', purity:'99.9', chip:'', confirmed:true, opId:op(), note:''}, cb); }); ok(tr.err, 'handing over 8 g likewise');
  var ok1 = call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:j.stages[0].id, wt:'5', purity:'99.9', chip:'', confirmed:true, opId:op(), note:''}, cb); }); ok(!ok1.err, 'what is really free can go: ' + (ok1.err && ok1.err.message));
  var ap = call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:A.id, refId:pr.v.id, decision:'approve'}, cb); }); ok(!ap.err, 'the loss can still be approved: ' + (ap.err && ap.err.message));
});
test('TC.A3 reopening a job whose labour was already paid needs a confirm that names the amount', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'TA3', {kind:'wastage', wastagePct:'4', labourRate:'9.6', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'96'}); ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  var lab = a.kgSalaryBalance(k.id).payable; ok(lab > 0, 'labour posted');
  var i0 = a.kgReopenInfo(j.id); eq(i0.needsConfirm, false, 'not paid yet: no confirm');
  call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:lab, mode:'cash'}, cb); });
  var i1 = a.kgReopenInfo(j.id); eq(i1.needsConfirm, true); eq(i1.labourPaise, lab); eq(i1.owesShopPaise, lab);
  var r = call(function(cb){ a.kgReopenJob(j.id, cb); }); ok(r.err && /already paid|confirm/i.test(r.err.message), r.err && r.err.message); eq(j.status, 'closed'); eq(a.kgSalaryBalance(k.id).payable, 0);
  var shown = null; a.kgForm = function(o){ shown = o; }; a.kg2Reopen(j.id); ok(shown && /already paid/i.test(shown.preview({})) && shown.preview({}).indexOf(a.kgFmtRs(lab)) !== -1, 'the sheet names the amount');
  var r2 = call(function(cb){ a.kgReopenJob(j.id, cb, {confirmed:true}); }); ok(!r2.err, r2.err && r2.err.message); eq(j.status, 'open'); eq(a.kgSalaryBalance(k.id).payable, -lab);
});

test('TC.B4 terms freeze only on live entries: a reversed issue frees them again', function(){
  var a = fresh('owner'); var k = pk(a, 'TB4'); var j = pjob(a, k); var it = issueV(a, j, '10', '92');
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'salary', salaryMode:'monthly', rate:'30000'}, cb); }).err);
  eq(a.kgTermsFor(j, k.id).kind, 'wastage', 'frozen while the issue is live');
  ok(!call(function(cb){ a.kgReverse(it.id, 'issued the wrong bar', op(), cb); }).err);
  eq(a.kgTermsFor(j, k.id).kind, 'salary', 'the reversed issue no longer freezes him'); issueV(a, j, '5', '92'); eq(a.kgTermsFor(j, k.id).kind, 'salary', 'and the next issue freezes the current terms');
});
test('TC.B5 a failed save restores close and reopen exactly', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'TB5', {kind:'wastage', wastagePct:'4', labourRate:'50', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'96'}); ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  ok(j.closedAt && j.closedBy, 'closed'); function sj(o){ return JSON.stringify(o, function(k, v){ if(v && typeof v === 'object' && !Array.isArray(v)){ var r = {}; Object.keys(v).sort().forEach(function(x){ r[x] = v[x]; }); return r; } return v; }); }   // same content, key order ignored
  var snap1 = sj(j);
  var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('offline')); };
  ok(call(function(cb){ a.kgReopenJob(j.id, cb); }).err); eq(sj(j), snap1, 'a failed reopen leaves the job exactly as it was (no empty earningsLog)'); ok(!('earningsLog' in j), 'no stray earningsLog');
  a.saveToCloud = good; ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err); ok(!j.closedAt && !j.closedBy, 'a real reopen clears closedAt and closedBy'); eq(j.status, 'open');
  var snap2 = sj(j); a.saveToCloud = function(cb){ cb(new Error('offline')); };
  ok(call(function(cb){ a.kgCloseJob(j.id, cb); }).err); eq(sj(j), snap2, 'a failed close restores closedAt, closedBy, earnings and earningsLog as they were');
});
test('TC.B6 a karigar payment under 50 paise dated into a closed day is restated', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'TB6'); owedShop(a, k, 1000);
  a.S.dayBook.closes = [{date:'2026-11-01', opening:0, autoIn:0, autoOut:0, manualIn:0, manualOut:0, closing:0, counted:0, diff:0, restatements:[], countCorrections:[]}];
  call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '0.40', '', op(), cb, {mode:'cash', dbPost:true}); }); a.S.karigarPayments[0].date = '2026-11-01';
  var n = 0; a.dbSweepRestatements(function(e, c){ n = c; }); eq(n, 1, 'restated'); var adj = a.S.dayBook.entries.filter(function(x){ return x.kind === 'adjust'; }); eq(adj.length, 1); eq(adj[0].dir, 'out'); eq(adj[0].amount, 0.4);
  a.dbSweepRestatements(function(e, c){ n = c; }); eq(n, 0, 'once only');
});
test('TC.B7 promptKarigarPayment rejects text that is not a plain number, and no longer says it cannot be undone', function(){
  var a = fresh('owner'); var k = pk(a, 'TB7'); owedShop(a, k, 5000); var toasts = []; a.toast = function(m){ toasts.push(m); }; var asked = [];
  a.confirm = function(m){ asked.push(m); return true; };
  ['1,500', '1500abc', '1e3', '-5', '1.234'].forEach(function(txt){ var n = 0; a.prompt = function(){ n++; return n === 1 ? 'cash' : (n === 2 ? txt : ''); }; a.promptKarigarPayment(k.id); eq(a.S.karigarPayments.length, 0, txt + ' must not be recorded'); ok(/plain number|positive amount/i.test(toasts[toasts.length - 1]), txt + ': ' + toasts[toasts.length - 1]); });
  var m = 0; a.prompt = function(){ m++; return m === 1 ? 'cash' : (m === 2 ? '1500' : ''); }; a.promptKarigarPayment(k.id); eq(a.S.karigarPayments.length, 1); eq(a.S.karigarPayments[0].amount, 1500);
  ok(asked.length === 1 && !/cannot be undone/i.test(asked[0]), asked[0]);
});
test('TC.B8 kgOrderWork never returns -0 and rounds owed to paise', function(){
  var a = fresh('owner'); var k = pk(a, 'TB8');
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'R', metal:'gold', karigarStages:[1, 2, 3].map(function(){ return {task:'M', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:10.005}; })}]}];
  a.S.karigarPayments = [{id:'kp-1', karigarId:k.id, date:'2026-10-30', type:'cash', amount:30.02, note:''}];
  var o = a.kgOrderWork(k.id).owed; ok(!(o.cash === 0 && 1 / o.cash < 0), 'not -0'); ok(Math.abs(o.cash * 100 - Math.round(o.cash * 100)) < 1e-9, 'whole paise: ' + o.cash);
  var z = fresh('owner'); var kz = pk(z, 'TB8b'); z.S.orders = []; z.S.karigarPayments = []; var oz = z.kgOrderWork(kz.id).owed; ok(1 / oz.cash > 0 && 1 / oz.gold > 0 && 1 / oz.silver > 0, 'zero is +0');
});
test('TC.B9 the pay core refuses a bad opId or types, and a repeated opId waits for the first save instead of answering OK early', function(){
  var a = fresh('owner'); var k = pk(a, 'TB9'); owedShop(a, k, 1000);
  ok(call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 100, '', undefined, cb, {mode:'cash'}); }).err, 'undefined opId'); ok(call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 100, '', '', cb, {mode:'cash'}); }).err, 'empty opId');
  ok(call(function(cb){ a.kg3PayOrderSave(k.id, {}, 100, '', op(), cb, {mode:'cash'}); }).err, 'type must be text'); ok(call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', {}, '', op(), cb, {mode:'cash'}); }).err, 'amount must be text or a number');
  ok(call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', null, '', op(), cb, {mode:'cash'}); }).err); eq(a.S.karigarPayments.length, 0);
  ok(a.kg3PayOrderCheck(k.id, 'cash', '1000.01').error, 'one paisa over'); ok(!a.kg3PayOrderCheck(k.id, 'cash', '1000').error);
  var held = null, results = []; a.saveToCloud = function(cb){ held = cb; };                                       // the first save is still in flight
  a.kg3PayOrderSave(k.id, 'cash', 100, '', 'same-op', function(e){ results.push(['first', e ? 'err' : 'ok']); }, {mode:'cash'});
  a.kg3PayOrderSave(k.id, 'cash', 100, '', 'same-op', function(e){ results.push(['second', e ? 'err' : 'ok']); }, {mode:'cash'});
  eq(results.length, 0, 'the repeat does not answer before the first save lands'); held(null); eq(results.length, 2); eq(results[0][1], 'ok'); eq(results[1][1], 'ok'); eq(a.S.karigarPayments.length, 1);
  var b = fresh('owner'); var kb = pk(b, 'TB9b'); owedShop(b, kb, 1000); var h2 = null, res2 = []; b.saveToCloud = function(cb){ h2 = cb; };
  b.kg3PayOrderSave(kb.id, 'cash', 100, '', 'op-f', function(e){ res2.push(e ? 'err' : 'ok'); }, {mode:'cash'}); b.kg3PayOrderSave(kb.id, 'cash', 100, '', 'op-f', function(e){ res2.push(e ? 'err' : 'ok'); }, {mode:'cash'});
  h2(new Error('offline')); eq(res2.join(), 'err,err', 'both hear that the save failed'); eq(b.S.karigarPayments.length, 0);
});
test('TC.B10 a reprinted statement for an old range keeps the pending-loss row; the money counts on the approval day', function(){
  var a = fresh('owner'); var k = pk(a, 'TB10'); var j = pjob(a, k); issueV(a, j, '10', '92'); a.SAAS.user.role = 'manager';
  var pr = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, metal:'gold', fineMg:2000, category:'filing', reason:'filing loss here', proposed:true}, cb); }); a.SAAS.user.role = 'owner';
  a.S.kgLedger.forEach(function(e){ e.date = '2026-01-01'; });
  var before = JSON.stringify(a.kgStatementRange(k.id, 'gold', '2026-01-01', '2026-01-05').rows.map(function(r){ return [r.type, r.state, r.deltaMg, r.balanceMg, r.date]; }));
  var ap = call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:pr.v.id, decision:'approve'}, cb); }); ap.v.date = '2026-01-10';
  var after = JSON.stringify(a.kgStatementRange(k.id, 'gold', '2026-01-01', '2026-01-05').rows.map(function(r){ return [r.type, r.state, r.deltaMg, r.balanceMg, r.date]; }));
  eq(after, before, 'the old range prints the same, pending row included'); ok(/LOSS/.test(after) && /pending/.test(after));
  var mid = a.kgStatementRange(k.id, 'gold', '2026-01-06', '2026-01-10'), nxt = a.kgStatementRange(k.id, 'gold', '2026-01-11', '2026-01-31');
  eq(mid.rows.filter(function(r){ return r.type === 'LOSS' && r.deltaMg === -2000; }).length, 1, 'the money row is in the approval period'); eq(mid.closingMg, nxt.openingMg);
  eq(a.kgStatementRange(k.id, 'gold', '2026-01-01', '2026-01-31').closingMg, 9200 - 2000); eq(a.kgStatementRange(k.id, 'gold', '2026-01-01', '2026-01-31').rows.filter(function(r){ return r.type === 'LOSS'; }).length, 2, 'proposal row and approval row');
});

console.log('\nTO-CLAUDE-CODE (11 Nov) - group C screens');

test('TC.C11 statement Given and Returned net out reversals; the tiles still add up to closing', function(){
  var a = fresh('owner'); var k = pk(a, 'TC11'); var j = pjob(a, k);
  var i1 = issueV(a, j, '10', '', '', '999');
  ok(!call(function(cb){ a.kgReverse(i1.id, 'issued the wrong bar', op(), cb); }).err); issueV(a, j, '5', '', '', '999');
  var s = a.kgStatementRange(k.id, 'gold', '2000-01-01', '2999-12-31');
  eq(s.issuedMg, 5000, 'Given is 5.000 g, not 15.000'); eq(s.returnedMg, 0); eq(s.otherMg, 0, 'nothing left in Other'); eq(s.openingMg + s.issuedMg - s.returnedMg + s.otherMg, s.closingMg); eq(s.closingMg, 5000);
});
test('TC.C12 a wastage karigar with blank points or old percent terms says "Wastage points not set", never "Wastage 4%"', function(){
  var a = fresh('owner'); var k = karigar(a, 'TC12', {kind:'wastage', wastagePct:'4'});
  var t = a.kgAgreementText(a.kgAgreementFor(k.id, a.kgToday())); ok(/Wastage points not set/.test(t) && !/4%/.test(t), t);
  var pt = pk(a, 'TC12b', 'wastage', '4'); ok(/\+4 points/.test(a.kgAgreementText(a.kgAgreementFor(pt.id, a.kgToday()))));
  ok(/Wastage points not set/.test(a.kg3ProfileHtml(k.id)) && a.kg3ProfileHtml(k.id).indexOf('Wastage 4%') === -1, 'profile subtitle');
});
test('TC.C13 receive sheet: no red message while the first fields are still empty, the touch box comes right after the weight', function(){
  var a = fresh('owner'); var k = pk(a, 'TC13'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var p0 = a.kg3ReceivePreview(j.id, {stage:'', gross:'5', purity:'', piece:'', qty:'1'}); ok(p0.indexOf('class="warn"') === -1, 'typing the weight first shows no red text: ' + p0);
  var p1 = a.kg3ReceivePreview(j.id, {stage:'', gross:'5', purity:'abc', piece:'', qty:'1'}); ok(p1.indexOf('class="warn"') !== -1, 'a wrong touch is still reported');
  var p2 = a.kg3ReceivePreview(j.id, {stage:'', gross:'5', purity:'92', piece:'', qty:'1', confirmed:true}); ok(p2.indexOf('class="warn"') === -1, 'a missing piece name is not shouted at: ' + p2);
  var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3Receive(j.id); var ids = sheet.fields.map(function(f){ return f.id; });
  ok(ids.indexOf('purity') !== -1 && ids.indexOf('purity') < ids.indexOf('piece') && ids.indexOf('gross') < ids.indexOf('purity'), 'order: ' + ids.join());
});
test('TC.C14 owner profile: five buttons up front, the rest under More', function(){
  var a = fresh('owner'); var k = pk(a, 'TC14'); call(function(cb){ a.kgSetCarry(k.id, {trusted:true, ceilingGold:'100', ceilingSilver:''}, cb); });
  function row(h){ var m = h.match(/<div class="kg2-row" id="kg3-pactions">([\s\S]*?)<\/div>/); ok(m, 'actions row'); return m[1]; }
  var h = a.kg3ProfileHtml(k.id); var n = (row(h).match(/<button/g) || []).length; ok(n <= 5, 'buttons up front: ' + n); ok(/kg3MoreProfile\(/.test(h));
  ['kg3NewJob', 'kg2Money'].forEach(function(f){ ok(row(h).indexOf(f) !== -1, f + ' is up front'); }); ok(h.indexOf('kg3Statement(') !== -1 && row(h).indexOf('kg3Statement') === -1, 'Statement is the Full statement row in the Account card');
  a._kg2.more = 'p:' + k.id; var h2 = a.kg3ProfileHtml(k.id); ['kg3PayOrder', 'kg3Opening', 'kg3RupeeOpening', 'kg2Money', 'kg3Carry', 'kg3Count'].forEach(function(f){ ok(h2.indexOf(f + '(') !== -1, f + ' under More'); });
  a.SAAS.user.role = 'manager'; var hm = a.kg3ProfileHtml(k.id); ok((row(hm).match(/<button/g) || []).length <= 5); ok(hm.indexOf('kg3Opening(') === -1, 'manager never sees owner buttons');
});
test('TC.C15/16 closing tile is full width; money reads like ₹1,500 everywhere on the pay screens', function(){
  var a = fresh('owner'); var k = pk(a, 'TC1516'); a.S.orders = [];
  ok(/kg2-kpi ?(wide)?"><span>Closing/.test(a.kg3StatementHtml(k.id)), 'closing tile is there (wide, or paired so no tile is alone)');
  var css = require('fs').readFileSync(__dirname + '/../index.html', 'utf8'); ok(/\.kg2-kpi\.wide\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(css), 'wide rule');
  call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '1500', '', op(), cb, {advance:true, reason:'festival advance', confirmed:true, mode:'cash', dbPost:true}); });
  var money = a.fmt(1500); ok(/1,500/.test(money), money);
  var pv = a.kg3PayOrderPreviewText(k.id, 'cash', '200', true); ok(pv.indexOf(a.fmt(1500)) !== -1 || pv.indexOf('1,500') !== -1, pv);
  var prof = a.kg3ProfileHtml(k.id); ok(prof.indexOf('1,500') !== -1 && prof.indexOf('₹1500') === -1, 'profile'); ok(a.kg3PayOrderRecentHtml(k.id).indexOf('1,500') !== -1);
  ok(a.kg3OrderOwedText('cash', 1500).indexOf('1,500') !== -1);
});
test('TC.C17 pay button hidden at zero owed; reversed carry row keeps the amount; statement carries the shop name; old wastage row hidden with the switch on', function(){
  var a = fresh('owner'); var k = pk(a, 'TC17'); a.SAAS.shop = {name:'Shah Jewellers'};
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Ring', metal:'gold', karigarStages:[{task:'Make', karigarId:k.id, status:'assigned', issued:[{date:a.kgToday(), wt:10, purity:'22K'}]}]}]}];
  ok(a.kg3ProfileHtml(k.id).indexOf('kg3PayOrder(' + "'" ) === -1 || a.kg3ProfileHtml(k.id).indexOf('Pay for order work') === -1, 'order work present but nothing owed: no Pay button');
  a.S.orders[0].items[0].karigarStages.push({task:'Cast', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:500}); ok(a.kg3ProfileHtml(k.id).indexOf('Pay for order work') !== -1, 'owed: button shown');
  ok(a.kgJobRowSign({type:'CARRY_OUT', fineMg:4400}, null) === -4400); ok(a.kgJobRowSign({type:'REVERSAL'}, {type:'CARRY_OUT', fineMg:4400}) === 4400, 'a reversed carry shows +4.400, not 0');
  ok(a.kgJobRowSign({type:'REVERSAL'}, {type:'ISSUE', fineMg:9200}) === -9200); ok(a.kgJobRowSign({type:'ISSUE', fineMg:9200}, null) === 9200);
  ok(a.kg3StatementHtml(k.id).indexOf('Shah Jewellers') !== -1, 'shop name on the statement'); ok(a.kg3StatementText(k.id, 'gold', '2026-11-01', '2026-11-30').indexOf('Shah Jewellers') !== -1, 'and in the WhatsApp text');
  var rep = a.kg2ReportsHtml(); ok(rep.indexOf('Wastage kept by karigars') === -1, 'old wastage row hidden');
});

console.log('\nTO-CLAUDE-CODE (11 Nov) - group D advance sheet, wording, print');

test('TC.D18 the advance sheet is titled and labelled as an advance; the payment sheet as a payment', function(){
  var a = fresh('owner'); var k = pk(a, 'TD18'); a.S.orders = []; var sheet = null; a.kgForm = function(o){ sheet = o; };
  a.kg3PayOrder(k.id, 'advance'); eq(sheet.title, 'Give advance to TD18'); eq(sheet.submitLabel, 'Give advance');
  var ids = sheet.fields.map(function(f){ return f.id; }); ok(ids.indexOf('reason') !== -1 && ids.indexOf('confirm') !== -1 && ids.indexOf('type') === -1 && ids.indexOf('kind') === -1, 'advance fields: ' + ids.join());
  a.kg3PayOrder(k.id); eq(sheet.title, 'Pay TD18 for order work'); eq(sheet.submitLabel, 'Record payment'); ids = sheet.fields.map(function(f){ return f.id; }); ok(ids.indexOf('type') !== -1 && ids.indexOf('reason') === -1 && ids.indexOf('kind') === -1, 'payment fields: ' + ids.join());
  a.kg3PayOrder(k.id, 'advance'); var adv = sheet; var out = {}; adv.onSubmit({amount:'300', mode:'cash', reason:'festival advance', confirm:true, note:'', opId:op()}, function(err){ out.err = err; }); ok(!out.err, out.err && out.err.message);
  eq(a.karigarOwed(k.id).cash, -300); ok(a.S.karigarPayments[0].advance === true);
  var out2 = {}; adv.onSubmit({amount:'300', mode:'cash', reason:'no', confirm:true, note:'', opId:op()}, function(err){ out2.err = err; }); ok(out2.err && /reason/i.test(out2.err.message));
  var out3 = {}; adv.onSubmit({amount:'300', mode:'cash', reason:'festival advance', confirm:false, note:'', opId:op()}, function(err){ out3.err = err; }); ok(out3.err && /confirm/i.test(out3.err.message));
});
test('TC.D19 the Rupees tile and the order-work line say the same thing when he owes the shop', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'TD19'); a.S.orders = [];
  ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '300', '', op(), cb, {advance:true, reason:'festival advance', confirmed:true, mode:'cash', dbPost:true}); }).err);
  var h = a.kg3ProfileHtml(k.id); var tile = h.slice(h.indexOf('Rupees'), h.indexOf('Rupees') + 260); ok(/he owes the shop/.test(tile) && tile.indexOf('300') !== -1, 'tile: ' + tile);
  var line = h.slice(h.indexOf('owed to him:')); ok(/he owes the shop/.test(line) && line.indexOf('300') !== -1, 'order-work line');
  ok(h.indexOf('nothing owed') === -1, 'no "nothing owed" next to "he owes the shop"');
});
test('TC.D20 print: the date line never wraps, a leftover toast is hidden', function(){
  var css = require('fs').readFileSync(__dirname + '/../index.html', 'utf8');
  ok(/\.kg3-printdates\s*\{[^}]*white-space:\s*nowrap/.test(css), 'dates nowrap'); ok(/body\.kg-printing\s+\.toast\s*\{[^}]*display:\s*none/.test(css), 'toast hidden in print');
});

console.log('\nTO-CLAUDE-CODE (11 Nov) - group E cancel under More, Owes tile, one phrase');

test('TE.21 job screen: Cancel job sits under More, owner only, open job with nothing issued', function(){
  var a = fresh('owner'); var k = pk(a, 'TE21'); trust(a, k); var j = pjob(a, k); a.kg3Open(k.id); a._kg2.jobId = j.id; a._kg2.more = '';
  var h = a.kg3JobHtml(j); ok(h.indexOf('kg2Cancel(') === -1, 'not up front');
  a._kg2.more = j.id; h = a.kg3JobHtml(j); ok(h.indexOf('kg2Cancel(') !== -1, 'under More');
  issueV(a, j, '10', '92'); h = a.kg3JobHtml(j); ok(h.indexOf('kg2Cancel(') === -1, 'hidden once metal is issued');
  var b = fresh('owner'); var k2 = pk(b, 'TE21b'); var j2 = pjob(b, k2); b.SAAS.user = {name:'Another Manager', role:'manager'}; b._kg2.more = j2.id; ok(b.kg3JobHtml(j2).indexOf('kg2Cancel(') === -1, 'a manager who did not make the job does not see it');
  var c = fresh('owner'); var k3 = pk(c, 'TE21c'); openG(c, k3, 'gold', '50', '92'); var j3 = pjob(c, k3); receiptV(c, j3, {gross:'5', purity:'92'});
  var r = call(function(cb){ c.kgCancelJob(j3.id, 'made by mistake', cb); }); ok(r.err, 'a live receipt still refuses with a message');
});
test('TE.22/23 Rupees tile says Owes when he owes the shop; one phrase "he owes the shop"', function(){
  var a = fresh('owner'); var t = a.kg3RupeeTile({payablePaise:0}, -300); ok(/Owes/.test(t) && t.indexOf('300') !== -1 && t.indexOf('he owes the shop') !== -1, t);
  var t2 = a.kg3RupeeTile({payablePaise:-50000}, 0); ok(/Owes/.test(t2) && t2.indexOf('he owes the shop') !== -1, t2);
  eq(a.kg3RupeeTile({payablePaise:0}, 0).indexOf('Owes'), -1);
  var fs = require('fs'), src = fs.readFileSync(__dirname + '/../js/11-karigar.js', 'utf8') + fs.readFileSync(__dirname + '/../js/05-auth-login.js', 'utf8');
  ok(!/owes you['" ]/i.test(src.replace(/\/\/.*$/mg, '')), 'no owes-you left in the screens');
});

console.log('\nTO-CLAUDE-CODE R7 (11 Nov) - ADJUST reversal, stage terms undo, audit at the cap, busy-map keys');

function adjustV(a, j, k, fine, reason){ return call(function(cb){ a.kgAddEntry({type:'ADJUST', opId:op(), jobId:j.id, karigarId:k.id, fineMg:fine, reason:reason || 'owner correction'}, cb); }); }
test('R7.24 reversing a negative ADJUST after the metal was consumed is refused; a positive ADJUST may not leave less than a pending loss', function(){
  var a = fresh('owner'); var k = pk(a, 'R24'); var j = pjob(a, k);
  var ad = adjustV(a, j, k, -5000); ok(!ad.err, ad.err && ad.err.message);
  receiptV(a, j, {gross:'4', purity:'92'});
  var rv = call(function(cb){ a.kgReverse(ad.v.id, 'put in by mistake', op(), cb); }); ok(rv.err, 'refused'); ok(!(a.S.kgLedger || []).some(function(x){ return x.type === 'REVERSAL'; }), 'nothing written');
  var b = fresh('owner'); var k2 = pk(b, 'R24b'); var j2 = pjob(b, k2); var ad2 = adjustV(b, j2, k2, -5000); ok(!ad2.err);
  ok(!call(function(cb){ b.kgReverse(ad2.v.id, 'put in by mistake', op(), cb); }).err, 'allowed while the metal is still there');
  var c = fresh('owner'); var k3 = pk(c, 'R24c'); var j3 = pjob(c, k3); issueV(c, j3, '10', '99.9'); proposeLoss(c, j3, k3, 4000);
  var big = adjustV(c, j3, k3, 7000); ok(big.err && /waiting for approval/.test(big.err.message), big.err && big.err.message);
  ok(!adjustV(c, j3, k3, 1000).err, 'a credit that leaves the loss covered is fine');
});
test('R7.25 a failed kgAddStage leaves job.terms exactly as it was', function(){
  var a = fresh('owner'); var k = pk(a, 'R25'); var j = pjob(a, k); var before = JSON.stringify(j.terms === undefined ? null : j.terms);
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  var r = call(function(cb){ a.kgAddStage(j.id, 'Setting', k.id, cb); }); ok(r.err); eq(JSON.stringify(j.terms === undefined ? null : j.terms), before); eq((j.stages || []).length, 0);
});
test('R7.26 a failed save at the audit cap brings the dropped oldest line back', function(){
  var a = fresh('owner'); var k = pk(a, 'R26'); var j = pjob(a, k);
  a.S.auditLog = []; for(var i = 0; i < a.AUDIT_MAX; i++) a.S.auditLog.push({id:'old' + i, ts:'x', action:'a', entity:'e', entityId:'', note:''});
  var oldest = a.S.auditLog[a.AUDIT_MAX - 1].id; a.saveToCloud = function(cb){ cb(new Error('network')); };
  var r = call(function(cb){ a.kgAddStage(j.id, 'Setting', k.id, cb); }); ok(r.err);
  eq(a.S.auditLog.length, a.AUDIT_MAX); eq(a.S.auditLog[a.AUDIT_MAX - 1].id, oldest, 'oldest line is back'); ok(!a.S.auditLog.some(function(x){ return x.action === 'kg_stage_add'; }));
});
test('R7.27 an opId like constructor or __proto__ does not throw in the pay lock', function(){
  var a = fresh('owner'); ['constructor', '__proto__', 'toString', 'hasOwnProperty'].forEach(function(id){
    var got = null; a.kgPayOnce(id, function(err){ got = err || 'ok'; }, function(fin){ fin(null); }); ok(got === 'ok', id + ' ' + got);
  });
});

console.log('\nTO-CLAUDE-CODE (11 Nov) - invariant gap tests (money paths)');

function sjson(o){ return JSON.stringify(o, function(k, v){ if(v && typeof v === 'object' && !Array.isArray(v)){ var r = {}; Object.keys(v).sort().forEach(function(x){ r[x] = v[x]; }); return r; } return v; }); }
function proposeLoss(a, j, k, fine){
  var was = a.SAAS.user.role; a.SAAS.user.role = 'manager';
  var pr = call(function(cb){ a.kgAddEntry({type:'LOSS', opId:op(), jobId:j.id, karigarId:k.id, metal:'gold', fineMg:fine, category:'filing', reason:'filing loss here', proposed:true}, cb); });
  a.SAAS.user.role = was; ok(!pr.err, pr.err && pr.err.message); return pr.v;
}
function decide(a, j, k, lossId, d){ return call(function(cb){ a.kgAddEntry({type:'APPROVAL', opId:op(), jobId:j.id, karigarId:k.id, refId:lossId, decision:d}, cb); }); }

test('TX.1 cancel is refused by each live receipt, scrap, carried-balance-used and hand-over entry, and allowed once it is reversed', function(){
  var a = fresh('owner'); var k = pk(a, 'TX1a'); openG(a, k, 'gold', '50', '92'); var j = pjob(a, k);
  var r = receiptV(a, j, {gross:'5', purity:'92'});                                                         // nothing issued: the receipt draws from the opening
  var c = call(function(cb){ a.kgCancelJob(j.id, 'made by mistake', cb); }); ok(c.err && /receipt/.test(c.err.message), c.err && c.err.message); eq(j.status, 'open');
  ok(!call(function(cb){ a.kgReverse(r.entry.id, 'weighed the wrong ring', op(), cb); }).err); ok(!call(function(cb){ a.kgCancelJob(j.id, 'made by mistake', cb); }).err, 'allowed after the reversal'); eq(j.status, 'cancelled');
  var b = fresh('owner'); var k2 = pk(b, 'TX1b'); openG(b, k2, 'gold', '50', '92'); var j2 = pjob(b, k2);
  var sb = b.kgBuildScrap(j2.id, '', {wt:'1', purity:'90', confirmed:true, kind:'dust', opId:op()}); var sc = call(function(cb){ b.kgAddEntry(sb.entry, cb); }); ok(!sc.err, sc.err && sc.err.message);
  var c2 = call(function(cb){ b.kgCancelJob(j2.id, 'made by mistake', cb); }); ok(c2.err && /scrap/.test(c2.err.message), c2.err && c2.err.message); eq(j2.status, 'open');
  ok(!call(function(cb){ b.kgReverse(sc.v.id, 'weighed twice', op(), cb); }).err); ok(!call(function(cb){ b.kgCancelJob(j2.id, 'made by mistake', cb); }).err); eq(j2.status, 'cancelled');
  var d = fresh('owner'); var k3 = pk(d, 'TX1c'); trust(d, k3); var j1 = pjob(d, k3); issueV(d, j1, '10', '92'); ok(!closeV(d, j1, {settle:'carry', opId:'tx1'}).err);
  var j3 = pjob(d, k3); var ap = call(function(cb){ d.kgApplyCarry(j3.id, '', 1000, 'tx1ap', cb); }); ok(!ap.err, ap.err && ap.err.message);
  var c3 = call(function(cb){ d.kgCancelJob(j3.id, 'made by mistake', cb); }); ok(c3.err, 'a carried balance used blocks it'); eq(j3.status, 'open');
  ok(!call(function(cb){ d.kgReverse(ap.v[0].id, 'applied by mistake', op(), cb); }).err); ok(!call(function(cb){ d.kgCancelJob(j3.id, 'made by mistake', cb); }).err); eq(j3.status, 'cancelled'); eq(d.kgCarryTotal(k3.id, 'gold'), 9200, 'the lot is whole again');
  var e = fresh('owner'); var A = pk(e, 'TX1d'), B = pk(e, 'TX1e'); var jt = pjob(e, A); issueV(e, jt, '10', '92'); ok(!call(function(cb){ e.kgAddStage(jt.id, 'Setting', B.id, cb); }).err);
  var tv = {jobId:jt.id, fromStageId:'', toStageId:jt.stages[0].id, wt:'3', purity:'92', chip:'', confirmed:true, opId:'tx1t', note:''}; ok(!call(function(cb){ e.kgTransfer(tv, cb); }).err);
  ok(call(function(cb){ e.kgCancelJob(jt.id, 'made by mistake', cb); }).err, 'hand-over + issue block it'); eq(jt.status, 'open');
  ok(!call(function(cb){ e.kgReverseTransfer('tx1t:v', 'handed to wrong man', op(), cb); }).err); ok(!call(function(cb){ e.kgReverse(e.S.kgLedger.filter(function(x){ return x.type === 'ISSUE'; })[0].id, 'issued the wrong bar', op(), cb); }).err);
  ok(!call(function(cb){ e.kgCancelJob(jt.id, 'made by mistake', cb); }).err, 'allowed once the hand-over and the issue are reversed'); eq(e.kgAccount(A.id).gold.totalMg, 0);
});
test('TX.2 a pending loss keeps its metal: closing with carry is refused while it waits, kgFreeOnJob shows what is free, and carry works after approval', function(){
  var a = fresh('owner'); var k = pk(a, 'TX2'); trust(a, k); var j = pjob(a, k); issueV(a, j, '10', '92');                  // 9.200 fine
  var pr = proposeLoss(a, j, k, 2000), led = a.S.kgLedger;
  eq(a.kgFreeOnJob(j, led, a.kgIndex(led), k.id), 7200, 'free = held less the waiting loss');
  var n = a.S.kgLedger.length, r = closeV(a, j, {settle:'carry', opId:'tx2'}); ok(r.err && /proposed loss/i.test(r.err.message), r.err && r.err.message);
  eq(j.status, 'open'); eq(a.S.kgLedger.length, n, 'no carry entry was left behind'); eq(a.kgCarryTotal(k.id, 'gold'), 0);
  ok(!decide(a, j, k, pr.id, 'approve').err); eq(a.kgFreeOnJob(j, a.S.kgLedger, a.kgIndex(a.S.kgLedger), k.id), 7200, 'approved: held already net of the loss');
  ok(!closeV(a, j, {settle:'carry', opId:'tx2b'}).err); eq(j.status, 'closed'); eq(a.kgCarryTotal(k.id, 'gold'), 7200, 'only what is really left is carried');
  var b = fresh('owner'); var kb = pk(b, 'TX2b'); trust(b, kb); var jb = pjob(b, kb); issueV(b, jb, '10', '92'); var pb = proposeLoss(b, jb, kb, 2000);
  ok(!decide(b, jb, kb, pb.id, 'reject').err); eq(b.kgFreeOnJob(jb, b.S.kgLedger, b.kgIndex(b.S.kgLedger), kb.id), 9200, 'a rejected loss frees the metal again');
  ok(!closeV(b, jb, {settle:'carry', opId:'tx2c'}).err); eq(b.kgCarryTotal(kb.id, 'gold'), 9200);
});
test('TX.3 reopen confirm: labour paid by an ADVANCE counts, a part payment that leaves him owed more does not, and nothing is lost on the way', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'TX3', {kind:'wastage', wastagePct:'4', labourRate:'9.6', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'96'}); ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  var lab = a.kgSalaryBalance(k.id).payable; ok(lab > 0);
  ok(!call(function(cb){ a.kgAddSalary({type:'ADVANCE', opId:op(), karigarId:k.id, amountPaise:lab, mode:'cash', note:'paid ahead of the job'}, cb); }).err);
  var i = a.kgReopenInfo(j.id); eq(i.needsConfirm, true, 'advance-paid labour needs the confirm'); eq(i.owesShopPaise, lab);
  var r = call(function(cb){ a.kgReopenJob(j.id, cb); }); ok(r.err && /advanced/i.test(r.err.message) && !/already paid/i.test(r.err.message), r.err && r.err.message); eq(j.status, 'closed'); eq(a.kgSalaryBalance(k.id).payable, 0);
  ok(!call(function(cb){ a.kgReopenJob(j.id, cb, {confirmed:true}); }).err); eq(a.kgSalaryBalance(k.id).payable, -lab, 'he owes the shop what was advanced');
  var b = fresh('owner'); var kb = wastageKarigar(b, 'TX3b', {kind:'wastage', wastagePct:'4', labourRate:'9.6', labourBase:'net'});
  var j1 = job(b, kb); metal(b, j1, 'ISSUE', 100000, '999'); receipt(b, j1, 100000, 'other', {pct:'96'}); ok(!call(function(cb){ b.kgCloseJob(j1.id, cb); }).err);
  var j2 = job(b, kb); metal(b, j2, 'ISSUE', 100000, '999'); receipt(b, j2, 100000, 'other', {pct:'96'}); ok(!call(function(cb){ b.kgCloseJob(j2.id, cb); }).err);
  var half = Math.floor(lab / 2); ok(!call(function(cb){ b.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:kb.id, amountPaise:half, mode:'cash'}, cb); }).err);
  var ib = b.kgReopenInfo(j1.id); eq(ib.labourPaise, lab); eq(ib.needsConfirm, false, 'payable stays positive: no confirm'); eq(ib.owesShopPaise, 0);
  ok(!call(function(cb){ b.kgReopenJob(j1.id, cb); }).err, 'reopens without a confirm'); eq(b.kgSalaryBalance(kb.id).payable, lab - half, 'one job labour less what was paid');
  eq(b.kgReopenInfo(j2.id).needsConfirm, true, 'the second reopen would push him below zero'); ok(call(function(cb){ b.kgReopenJob(j2.id, cb); }).err); eq(j2.status, 'closed');
});
test('TX.4 terms freeze only on a karigar\'s own live entries: a second karigar on a stage is not frozen by the first', function(){
  var a = fresh('owner'); var A = pk(a, 'TX4a'), B = pk(a, 'TX4b'); var j = pjob(a, A);
  ok(!call(function(cb){ a.kgAddStage(j.id, 'Setting', B.id, cb); }).err); var st = j.stages[0].id;
  var ia = issueV(a, j, '10', '92'); eq(a.kgLiveUsed(j, A.id), true); eq(a.kgLiveUsed(j, B.id), false, 'B has nothing on the job yet');
  var tr = call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:st, wt:'4', purity:'92', chip:'', confirmed:true, opId:'tx4t', note:''}, cb); }); ok(!tr.err, tr.err && tr.err.message);
  eq(a.kgLiveUsed(j, B.id), true, 'the hand-over in freezes B');
  [A, B].forEach(function(x){ ok(!call(function(cb){ a.kgSetTerms(x.id, {kind:'salary', salaryMode:'monthly', rate:'30000'}, cb); }).err); });
  eq(a.kgTermsFor(j, A.id).kind, 'wastage'); eq(a.kgTermsFor(j, B.id).kind, 'wastage');
  ok(!call(function(cb){ a.kgReverseTransfer('tx4t:v', 'handed to wrong man', op(), cb); }).err);
  eq(a.kgLiveUsed(j, B.id), false, 'a reversed hand-in and its reversal row do not count'); eq(a.kgTermsFor(j, B.id).kind, 'salary', 'B is free to follow his new terms'); eq(a.kgTermsFor(j, A.id).kind, 'wastage', 'A still holds the issue: still frozen');
  ok(!call(function(cb){ a.kgReverse(ia.id, 'issued the wrong bar', op(), cb); }).err); eq(a.kgLiveUsed(j, A.id), false); eq(a.kgTermsFor(j, A.id).kind, 'salary');
});
test('TX.5 a job reopened and re-closed twice: a failed reopen and a failed close each leave every close field exactly as it was', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'TX5', {kind:'wastage', wastagePct:'4', labourRate:'50', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'96'});
  function close(id){ return call(function(cb){ a.kgCloseJob(j.id, cb, {opId:id}); }); }
  ok(!close('cl-1').err); ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err); ok(!close('cl-2').err); ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err); ok(!close('cl-3').err);
  eq(j.earningsLog.length, 2, 'two earlier closes are logged'); eq(j.closeOpId, 'cl-3'); ok(j.reopenedAt, 'reopenedAt kept from the last reopen');
  var snap = sjson(j), sal = sjson(a.S.kgSalary), good = a.saveToCloud;
  a.saveToCloud = function(cb){ cb(new Error('offline')); };
  ok(call(function(cb){ a.kgReopenJob(j.id, cb); }).err); eq(sjson(j), snap, 'failed reopen: job as it was'); eq(sjson(a.S.kgSalary), sal, 'failed reopen: labour untouched'); eq(j.earningsLog.length, 2);
  a.saveToCloud = good; ok(!call(function(cb){ a.kgReopenJob(j.id, cb); }).err); ok(!j.closedAt && !j.closedBy && !j.closeOpId, 'real reopen clears the close fields'); eq(j.earningsLog.length, 3);
  var snap2 = sjson(j), sal2 = sjson(a.S.kgSalary); a.saveToCloud = function(cb){ cb(new Error('offline')); };
  ok(close('cl-4').err); eq(sjson(j), snap2, 'failed close: closedAt, closedBy, earnings, earningsLog, closeOpId, reopenedAt as they were'); eq(sjson(a.S.kgSalary), sal2, 'failed close: no stray labour line'); eq(j.status, 'open');
  a.saveToCloud = good; ok(!close('cl-4').err, 'the same close works once the network is back'); eq(j.status, 'closed'); eq(j.closeOpId, 'cl-4');
});
test('TX.6 Day Book sweep: a 40 paise karigar payment is restated, a sub-rupee non-karigar difference is still ignored', function(){
  var a = fresh('owner'); a.dbInit(); var k = pk(a, 'TX6'); owedShop(a, k, 1000);
  a.S.dayBook.closes = [{date:'2026-11-01', opening:0, autoIn:0, autoOut:0, manualIn:0, manualOut:0, closing:0, counted:0, diff:0, restatements:[], countCorrections:[]}];
  call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '0.40', '', op(), cb, {mode:'cash', dbPost:true}); }); a.S.karigarPayments[0].date = '2026-11-01';
  var n = null; a.dbSweepRestatements(function(e, c){ n = c; }); eq(n, 1); var adj = a.S.dayBook.entries.filter(function(x){ return x.kind === 'adjust'; }); eq(adj.length, 1); eq(adj[0].amount, 0.4); eq(a.dbCloseFor('2026-11-01').autoOut, 0.4);
  var b = fresh('owner'); b.dbInit(); b.S.dayBook.closes = [{date:'2026-11-02', opening:0, autoIn:0, autoOut:0.4, manualIn:0, manualOut:0, closing:0, counted:0, diff:0, restatements:[], countCorrections:[]}];
  b.S.dayBook.entries = []; var m = null; b.dbSweepRestatements(function(e, c){ m = c; }); eq(m, 0, 'a 40 paise difference with no karigar line is rounding noise'); eq(b.S.dayBook.entries.length, 0); eq(b.dbCloseFor('2026-11-02').autoOut, 0.4, 'baseline untouched');
  b.S.dayBook.closes[0].autoOut = 0.6; b.dbSweepRestatements(function(e, c){ m = c; }); eq(m, 1, 'a real difference above the allowance is still restated');
});
test('TX.7 kgPayOnce: a repeat waits for the first save, a different opId runs on its own, a failed first save fails both, and the lock map is cleaned', function(){
  var a = fresh('owner'); var k = pk(a, 'TX7'); owedShop(a, k, 1000); var held = [], log = [];
  a.saveToCloud = function(cb){ held.push(cb); };
  a.kg3PayOrderSave(k.id, 'cash', 100, '', 'p1', function(e){ log.push('p1a:' + (e ? 'err' : 'ok')); }, {mode:'cash'});
  a.kg3PayOrderSave(k.id, 'cash', 100, '', 'p1', function(e){ log.push('p1b:' + (e ? 'err' : 'ok')); }, {mode:'cash'});
  ok(a._kgPayBusy['p1'] && a._kgPayBusy['p1'].length === 2, 'both callbacks are queued under p1'); eq(log.length, 0);
  a.kg3PayOrderSave(k.id, 'cash', 50, '', 'p2', function(e){ log.push('p2:' + (e ? 'err' : 'ok')); }, {mode:'cash'});          // a different opId is never answered from p1's save: the karigar lock says busy
  eq(log.join(), 'p2:err', 'p2 hears busy at once, not the answer of p1'); ok(!a._kgPayBusy['p2'], 'and leaves no lock behind');
  held[0](null); eq(log.join(), 'p2:err,p1a:ok,p1b:ok'); ok(!a._kgPayBusy['p1'], 'p1 lock cleaned'); eq(a.S.karigarPayments.length, 1, 'one payment for p1, none for p2');
  a.saveToCloud = function(cb){ cb(null); }; ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 50, '', 'p2', cb, {mode:'cash'}); }).err, 'p2 runs on its own once p1 is done'); eq(a.S.karigarPayments.length, 2);
  eq(Object.keys(a._kgPayBusy).length, 0, 'map is empty');
  var b = fresh('owner'); var kb = pk(b, 'TX7b'); owedShop(b, kb, 1000); var h2 = [], res = [];
  b.saveToCloud = function(cb){ h2.push(cb); };
  b.kg3PayOrderSave(kb.id, 'cash', 100, '', 'f1', function(e){ res.push(e ? 'err' : 'ok'); }, {mode:'cash'}); b.kg3PayOrderSave(kb.id, 'cash', 100, '', 'f1', function(e){ res.push(e ? 'err' : 'ok'); }, {mode:'cash'});
  h2[0](new Error('offline')); eq(res.join(), 'err,err'); eq(Object.keys(b._kgPayBusy).length, 0, 'lock cleaned after a failure'); eq(b.S.karigarPayments.length, 0);
  b.saveToCloud = function(cb){ cb(null); }; var again = call(function(cb){ b.kg3PayOrderSave(kb.id, 'cash', 100, '', 'f1', cb, {mode:'cash'}); }); ok(!again.err, 'the same opId can be tried again after a failure'); eq(b.S.karigarPayments.length, 1);
  ok(call(function(cb){ b.kg3PayOrderSave(kb.id, 'cash', 100, '', 7, cb, {mode:'cash'}); }).err, 'a number is not an opId');
});
test('TX.7b kgPayOnce: a run that throws still answers every waiting caller with an error and frees the lock', function(){
  var a = fresh('owner'); var res = [];
  a.kgPayOnce('t1', function(e){ res.push(e ? 'err' : 'ok'); }, function(){ throw new Error('boom'); });
  eq(res.join(), 'err'); ok(!a._kgPayBusy['t1'], 'lock freed');
  a.kgPayOnce('t1', function(e){ res.push(e ? 'err' : 'ok'); }, function(fin){ fin(null); }); eq(res.join(), 'err,ok');
});
test('TX.8 statement approval rows: rejected loss, loss approved then reversed, and ranges before, inside and after the approval chain up', function(){
  var a = fresh('owner'); var k = pk(a, 'TX8'); var j = pjob(a, k); issueV(a, j, '10', '92'); var pr = proposeLoss(a, j, k, 2000);
  a.S.kgLedger.forEach(function(e){ e.date = '2026-01-01'; });
  var ap = decide(a, j, k, pr.id, 'reject'); ok(!ap.err); ap.v.date = '2026-01-10';
  var s = a.kgStatementRange(k.id, 'gold', '2026-01-01', '2026-01-31'); var lr = s.rows.filter(function(r){ return r.type === 'LOSS'; });
  eq(lr.length, 1, 'a rejected loss is one proposal row'); eq(lr[0].state, 'rejected'); eq(lr[0].deltaMg, 0); eq(s.closingMg, 9200); eq(s.openingMg + s.issuedMg - s.returnedMg + s.otherMg, s.closingMg);
  eq(a.kgStatementRange(k.id, 'gold', '2026-01-01', '2026-01-05').rows.filter(function(r){ return r.type === 'LOSS'; })[0].state, 'pending', 'before the decision date it still prints as pending');
  var b = fresh('owner'); var kb = pk(b, 'TX8b'); var jb = pjob(b, kb); issueV(b, jb, '10', '92'); var pb = proposeLoss(b, jb, kb, 2000);
  b.S.kgLedger.forEach(function(e){ e.date = '2026-01-01'; });
  var ab = decide(b, jb, kb, pb.id, 'approve'); ok(!ab.err); ab.v.date = '2026-01-10';
  var rv = call(function(cb){ b.kgReverse(pb.id, 'proposed against the wrong job', op(), cb); }); ok(!rv.err, 'reversing an approved loss: ' + (rv.err && rv.err.message)); rv.v.date = '2026-01-20';
  var R1 = b.kgStatementRange(kb.id, 'gold', '2026-01-01', '2026-01-05'), R2 = b.kgStatementRange(kb.id, 'gold', '2026-01-06', '2026-01-15'), R3 = b.kgStatementRange(kb.id, 'gold', '2026-01-16', '2026-01-31');
  eq(R1.closingMg, 9200, 'before the approval: only the issue, loss still pending'); eq(R2.openingMg, R1.closingMg); eq(R2.closingMg, 7200, 'inside: the approval takes 2.000 g'); eq(R3.openingMg, R2.closingMg); eq(R3.closingMg, 9200, 'after: the reversal gives it back');
  [R1, R2, R3].forEach(function(r){ eq(r.openingMg + r.issuedMg - r.returnedMg + r.otherMg, r.closingMg, 'tiles add up ' + r.from); });
  eq(b.kgStatementRange(kb.id, 'gold', '2026-01-01', '2026-01-31').closingMg, 9200); eq(b.kgAccount(kb.id).gold.totalMg, 9200, 'statement agrees with the account');
});
test('TX.9 statement tiles add up to closing when a receipt, scrap, hand-over or carry is reversed', function(){
  function tiles(a, k){ var s = a.kgStatementRange(k.id, 'gold', '2000-01-01', '2999-12-31'); eq(s.openingMg + s.issuedMg - s.returnedMg + s.otherMg, s.closingMg, 'tiles add up'); return s; }
  var a = fresh('owner'); var k = pk(a, 'TX9a'); var j = pjob(a, k); issueV(a, j, '10', '92'); var r1 = receiptV(a, j, {gross:'5', purity:'92'}); receiptV(a, j, {gross:'2', purity:'92'});
  var s0 = tiles(a, k); ok(s0.returnedMg > 0); ok(!call(function(cb){ a.kgReverse(r1.entry.id, 'weighed the wrong ring', op(), cb); }).err);
  var s1 = tiles(a, k); eq(s1.issuedMg, 9200); ok(s1.returnedMg > 0 && s1.returnedMg < s0.returnedMg, 'only the reversed receipt left Returned: ' + s1.returnedMg); eq(s1.otherMg, 0);
  var b = fresh('owner'); var kb = pk(b, 'TX9b'); var jb = pjob(b, kb); issueV(b, jb, '10', '92');
  var sb = b.kgBuildScrap(jb.id, '', {wt:'1', purity:'90', confirmed:true, kind:'dust', opId:op()}); var sc = call(function(cb){ b.kgAddEntry(sb.entry, cb); }).v;
  var t0 = tiles(b, kb); ok(t0.returnedMg > 0); ok(!call(function(cb){ b.kgReverse(sc.id, 'weighed twice', op(), cb); }).err); var t1 = tiles(b, kb); eq(t1.returnedMg, 0); eq(t1.otherMg, 0); eq(t1.closingMg, 9200);
  var c = fresh('owner'); var A = pk(c, 'TX9c'), B = pk(c, 'TX9d'); var jc = pjob(c, A); issueV(c, jc, '10', '92'); ok(!call(function(cb){ c.kgAddStage(jc.id, 'Setting', B.id, cb); }).err);
  ok(!call(function(cb){ c.kgTransfer({jobId:jc.id, fromStageId:'', toStageId:jc.stages[0].id, wt:'3', purity:'92', chip:'', confirmed:true, opId:'tx9t', note:''}, cb); }).err);
  var u0 = tiles(c, A); eq(u0.otherMg, -2760, 'hand-over out sits in Other'); ok(!call(function(cb){ c.kgReverseTransfer('tx9t:v', 'handed to wrong man', op(), cb); }).err);
  var u1 = tiles(c, A); eq(u1.otherMg, 0); eq(u1.closingMg, 9200); var ub = tiles(c, B); eq(ub.otherMg, 0); eq(ub.closingMg, 0);
  var d = fresh('owner'); var kd = pk(d, 'TX9e'); trust(d, kd); var jd = pjob(d, kd); issueV(d, jd, '10', '92'); receiptV(d, jd, {gross:'5', purity:'92'}); ok(!closeV(d, jd, {settle:'carry', opId:'tx9c'}).err);
  var w0 = tiles(d, kd); eq(w0.closingMg, 4400); ok(!call(function(cb){ d.kgReopenJob(jd.id, cb); }).err); ok(!call(function(cb){ d.kgReverseCarry('tx9c:c0', 'undo the carry now', op(), cb); }).err);
  var w1 = tiles(d, kd); eq(w1.closingMg, 4400, 'the metal is back on the job'); eq(w1.otherMg, 0, 'carry out, carry in and both reversals net to nothing'); eq(w1.issuedMg, 9200);
});

// ---- phone round 1 (12 Nov): sheet Back button, keyboard and 16px inputs ----
function sheetEnv(){
  var a = fresh('owner'), keyl = [], q = [];
  var h = {stack:[0], idx:0};   // real-browser model: pushState is immediate, back() is QUEUED and fires popstate later, in order
  var reg = {}, body = {kids:[], appendChild:function(e){ e.parentNode = body; body.kids.push(e); }, removeChild:function(e){ e.parentNode = null; body.kids = body.kids.filter(function(x){ return x !== e; }); }};
  function mk(){ return {style:{setProperty:function(){}}, innerHTML:'', textContent:'', value:'', parentNode:null, addEventListener:function(){}, removeEventListener:function(){}, contains:function(){ return false; }, querySelector:function(){ return null; }, firstChild:{style:{setProperty:function(){}}}}; }
  a.document = {
    getElementById: function(id){ if(id === 'kg2-modal') return body.kids[0] || null; if(!reg[id]) reg[id] = mk(); return reg[id]; },
    createElement: mk, body: body, activeElement: null,
    addEventListener: function(t, f){ keyl.push(f); }, removeEventListener: function(t, f){ keyl = keyl.filter(function(x){ return x !== f; }); }
  };
  a.history = {pushState:function(){ h.stack = h.stack.slice(0, h.idx + 1); h.stack.push(1); h.idx++; }, back:function(){ q.push(1); }};
  function step(){ q.shift(); if(h.idx > 0) h.idx--; a.kgPopHandler(); }
  return {a:a, h:h, reg:reg, body:body, userBack:function(){ q.push(1); }, step:step, flush:function(){ while(q.length) step(); }, pending:function(){ return q.length; }, keyCount:function(){ return keyl.length; }, esc:function(){ keyl.slice().forEach(function(f){ f({key:'Escape'}); }); }};
}
function openSheet(e, title){ e.a.kgForm({title:title || 'Test', fields:[{id:'amt', label:'Amount', type:'text', value:''}], onSubmit:function(v, fin){ fin(null); }}); }
test('PH.1 Back (popstate) closes the sheet; its history entry is not popped twice', function(){
  var e = sheetEnv(); openSheet(e); eq(e.body.kids.length, 1); eq(e.h.idx, 1, 'one entry pushed on open');
  e.userBack(); e.flush(); eq(e.body.kids.length, 0, 'sheet closed by Back'); eq(e.h.idx, 0, 'back at baseline'); eq(e.pending(), 0); eq(e.keyCount(), 0);
});
test('PH.2 Cancel, Esc and Save each close their sheet and return history to baseline', function(){
  var e = sheetEnv(); openSheet(e); e.reg['kg2-cancel'].onclick({}); e.flush(); eq(e.body.kids.length, 0); eq(e.h.idx, 0, 'Cancel');
  var f = sheetEnv(); openSheet(f); f.esc(); f.flush(); eq(f.body.kids.length, 0); eq(f.h.idx, 0, 'Esc'); eq(f.keyCount(), 0);
  var g = sheetEnv(); openSheet(g); g.reg['kg2-save'].onclick(); g.flush(); eq(g.body.kids.length, 0); eq(g.h.idx, 0, 'Save');
});
test('PH.3 opening a sheet over a sheet reuses the one history entry', function(){
  var e = sheetEnv(); openSheet(e, 'One'); openSheet(e, 'Two'); eq(e.h.idx, 1, 'no second entry'); eq(e.body.kids.length, 1);
  e.userBack(); e.flush(); eq(e.body.kids.length, 0); eq(e.h.idx, 0);
});
test('PH.5 D1: close then open B BEFORE the echo fires (back, push, pop): Back still closes B and the app stays', function(){
  ['save', 'cancel', 'esc'].forEach(function(how){
    var e = sheetEnv(); openSheet(e, 'A');
    if(how === 'save') e.reg['kg2-save'].onclick(); else if(how === 'cancel') e.reg['kg2-cancel'].onclick({}); else e.esc();
    eq(e.pending(), 1, how + ': A\'s back() is still queued');
    openSheet(e, 'B'); eq(e.body.kids.length, 1);
    e.flush();                                   // the echo fires: it must not close B, and B must still own an entry
    eq(e.body.kids.length, 1, how + ': B survives the echo'); eq(e.h.idx, 1, how + ': B has its entry');
    e.userBack(); e.flush(); eq(e.body.kids.length, 0, how + ': the real Back closes B'); eq(e.h.idx, 0, how + ': app stays, history at baseline');
  });
});
test('PH.6 D1: close, echo fires, then open B, then Back (back, pop, push): Back closes B; both orderings end at baseline', function(){
  var e = sheetEnv(); openSheet(e, 'A'); e.reg['kg2-cancel'].onclick({}); e.flush(); openSheet(e, 'B'); eq(e.h.idx, 1);
  e.userBack(); e.flush(); eq(e.body.kids.length, 0); eq(e.h.idx, 0);
  // user Back queued right behind our own back(): the echo goes first, then the user's Back closes B
  var f = sheetEnv(); openSheet(f, 'A'); f.reg['kg2-save'].onclick(); openSheet(f, 'B'); f.userBack(); f.flush();
  eq(f.body.kids.length, 0, 'B closed by the real Back'); eq(f.h.idx, 0, 'history back at baseline');
  // closing B afterwards by Cancel is also neutral
  var g = sheetEnv(); openSheet(g, 'A'); g.reg['kg2-cancel'].onclick({}); openSheet(g, 'B'); g.flush(); g.reg['kg2-cancel'].onclick({}); g.flush(); eq(g.body.kids.length, 0); eq(g.h.idx, 0, 'both sheets closed: baseline');
});
test('PH.7 D2: landscape safe-area insets on top bar, rail and main, only inside a >=640px query', function(){
  var css = require('fs').readFileSync(__dirname + '/../index.html', 'utf8');
  var blk = css.match(/@media\(min-width:640px\)\{\s*\.topbar\{[^@]*?\r?\n\}/);
  ok(blk, 'a >=640px block holding the three rules');
  ok(/\.topbar\{[^}]*safe-area-inset-left[^}]*safe-area-inset-right/.test(blk[0]), 'topbar');
  ok(/\.dtabs\{[^}]*calc\(var\(--rail-w\) \+ env\(safe-area-inset-left\)\)/.test(blk[0]), 'rail width grows by the inset');
  ok(/\.main\{[^}]*margin-left:calc\(var\(--rail-w\) \+ env\(safe-area-inset-left\)\)[^}]*safe-area-inset-right/.test(blk[0]), 'main margin and right padding');
  ok(!/^\.topbar\{[^}]*safe-area-inset-left/m.test(css), 'no unconditional (portrait) topbar inset');
});
test('PH.4 css: dvh, scroll-padding, safe-area footer, 16px sheet inputs, viewport-fit=cover', function(){
  var css = require('fs').readFileSync(__dirname + '/../index.html', 'utf8');
  ok(/<meta name="viewport"[^>]*viewport-fit=cover/.test(css), 'viewport-fit=cover');
  var box = css.match(/\.kg2-box\{[^}]*\}/)[0]; ok(/90dvh/.test(box) && /scroll-padding-bottom:/.test(box) && /scroll-padding-top:/.test(box), 'box: dvh and scroll-padding');
  ok(/\.modal\{[^}]*max-height:90dvh/.test(css), '.modal has a dvh max-height');
  ok(/\.kg2-foot\{[^}]*padding:10px 16px max\(16px,env\(safe-area-inset-bottom\)\)/.test(css), 'footer safe-area padding');
  ok(/\.kg2-f input\[type=text\],\.kg2-f select\{[^}]*font-size:16px/.test(css), 'sheet inputs and selects are 16px');
});


console.log('\nKarigar always on (round 16) - no switch, add karigar, empty state, statement, order work parity');

function rendered(a){ delete a._els['kg2-root']; a.renderKgV2(); return a._els['kg2-root'].innerHTML; }
test('R16 A: there is no per-device switch; every role lands on the people list; a stored "0" is ignored', function(){
  var a = fresh('owner');
  eq(typeof a.kg3On, 'undefined', 'kg3On is gone'); eq(typeof a.kg3Switch, 'undefined', 'kg3Switch is gone');
  a.localStorage.setItem(a.shopScopedKey('kgProfileUi'), '0');
  ['home', 'jobs', 'khata'].forEach(function(v){ a._kg2.view = v; ok(rendered(a).indexOf('Karigars') !== -1); eq(a._kg2.view, 'people', v + ' goes to the people list'); });
  ok(a.kg2NavHtml().indexOf('Terms') !== -1 && a.kg2NavHtml().indexOf('Today') === -1, 'one nav');
  a.SAAS.user.role = 'manager'; a._kg2.view = 'home'; ok(rendered(a).length > 0, 'manager sees the new screens'); eq(a._kg2.view, 'people');
  a.SAAS.user.role = 'staff'; eq(rendered(a), '', 'staff sees nothing, as before');
});
test('R16 A: Reports has no "Switch on" and no old Karigar 2.0 cards; the profile calls order work just "Order work"', function(){
  var a = fresh('owner'); var k = pk(a, 'R16A');
  a._kg2.view = 'reports'; var h = rendered(a);
  ok(!/Switch on|Switch off|OLD WAY|old way|NOT ADDED|not added/i.test(h), 'no switch or old-way wording in Reports');
  ok(!/Gold in hand|you owe nothing/.test(h), 'no old card wording');
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Chain', metal:'gold', purity:'22K', qty:1, weight:10,
    karigarStages:[{task:'Make', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:500, issued:[{date:a.kgToday(), wt:10, purity:'22K'}]}]}]}];
  var p = a.kg3ProfileHtml(k.id); ok(p.indexOf('Order work') !== -1, 'order work block present');
  ok(!/old way|OLD WAY|not added|NOT ADDED/.test(p), 'no old-way wording on the profile');
  ok(!/Gold in hand|you owe nothing/.test(a.kg3PeopleHtml()), 'no old card wording on the list');
  a.renderKarigarList(); eq(a._els['karigar-list'].innerHTML, '', 'the old cards are not drawn');
});
test('R16 A: order-side numbers are identical to the old ones (real record shapes), and the pay path still works', function(){
  var a = fresh('owner'); var k = pk(a, 'R16P');
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Ring', metal:'gold', purity:'22K', qty:1, weight:10,
    karigarStages:[{task:'Make', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:1200, issued:[{date:a.kgToday(), wt:10, purity:'22K'}]}]}]}];
  a.S.karigarPayments = [{id:'kp1', opId:'x1', karigarId:k.id, date:a.kgToday(), type:'cash', amount:200, note:''}];
  var ow = a.kgOrderWork(k.id), old = a.karigarOwed(k.id);
  eq(ow.owed.cash, Math.round(old.cash * 100) / 100, 'cash owed = the old function'); eq(ow.owed.cash, 1000);
  eq(ow.queue.length, a.karigarQueue(k.id).length);
  eq(JSON.stringify(ow.held), JSON.stringify(a.karigarMetalHeld(k.id)), 'metal held unchanged');
  var p = a.kg3ProfileHtml(k.id); ok(p.indexOf(a.fmt(1000)) !== -1, 'profile shows the same rupee amount');
  var r = call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 300, 'part', op(), cb); }); ok(!r.err, r.err && r.err.message);
  eq(a.kgOrderWork(k.id).owed.cash, 700); eq(a.S.karigarPayments.length, 2);
});
test('R16 D: a shop with no karigars gets a friendly first screen with one big Add karigar button', function(){
  var a = fresh('owner'); a.S.karigars = []; var h = a.kg3PeopleHtml();
  ok(h.indexOf('kg3AddKarigar()') !== -1 && h.indexOf('+ Add karigar') !== -1, 'button present');
  ok(h.indexOf('kgx-empty') !== -1, 'empty-state block'); ok(h.indexOf('assigning a stage') === -1, 'the old ten-tap instruction is gone');
  a.SAAS.user.role = 'manager'; ok(a.kg3PeopleHtml().indexOf('kg3AddKarigar()') !== -1, 'manager can add too');
});
test('R16 C7: the list has a + button, a search box and gold-with-him per row', function(){
  var a = fresh('owner'); var k = pk(a, 'Ramesh Sonar'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var h = a.kg3PeopleHtml();
  ok(h.indexOf('aria-label="Add karigar"') !== -1, 'plus button'); ok(h.indexOf('kg3Search') !== -1, 'search box');
  ok(h.indexOf('>RS<') !== -1, 'initials avatar'); ok(h.indexOf('9.200') !== -1, 'gold with him');
  a._kg2.q = 'zzz'; ok(a.kg3PeopleHtml().indexOf('Ramesh Sonar') === -1, 'search filters'); a._kg2.q = 'ramesh'; ok(a.kg3PeopleHtml().indexOf('Ramesh Sonar') !== -1, 'case-insensitive');
});
test('R16 C7: kgAddKarigar - name, phone, wastage or salary, points; checks and rollback', function(){
  var a = fresh('owner');
  var r = call(function(cb){ a.kgAddKarigar({name:'  Imran Sheikh ', phone:'98200 12345', kind:'wastage', points:'4', skills:'Kundan', opId:op()}, cb); });
  ok(!r.err, r.err && r.err.message); var k = r.v;
  eq(k.name, 'Imran Sheikh'); eq(k.phone, '9820012345'); eq(a.kgAgreementFor(k.id, a.kgToday()).wastagePoints, 400); eq(k.kind, 'wastage');
  var s = call(function(cb){ a.kgAddKarigar({name:'Sal', phone:'', kind:'salary', salaryMode:'monthly', rate:'30000', opId:op()}, cb); });
  ok(!s.err, s.err && s.err.message); eq(a.kgAgreementFor(s.v.id, a.kgToday()).salary.ratePaise, 3000000);
  ok(call(function(cb){ a.kgAddKarigar({name:'imran sheikh', kind:'wastage', opId:op()}, cb); }).err, 'same name refused');
  ok(call(function(cb){ a.kgAddKarigar({name:'', kind:'wastage', opId:op()}, cb); }).err, 'name required');
  ok(call(function(cb){ a.kgAddKarigar({name:'Bad Ph', phone:'12345', kind:'wastage', opId:op()}, cb); }).err, 'bad phone refused');
  ok(call(function(cb){ a.kgAddKarigar({name:'Bad Pts', kind:'wastage', points:'99', opId:op()}, cb); }).err, 'points over 20 refused');
  ok(call(function(cb){ a.kgAddKarigar({name:'Bad Sal', kind:'salary', salaryMode:'monthly', rate:'', opId:op()}, cb); }).err, 'salary needs a rate');
  eq(a.S.karigars.length, 2, 'refused adds leave nothing behind');
  var id = op(); var one = call(function(cb){ a.kgAddKarigar({name:'Twice', kind:'wastage', points:'3', opId:id}, cb); });
  var two = call(function(cb){ a.kgAddKarigar({name:'Twice', kind:'wastage', points:'3', opId:id}, cb); }); ok(!one.err && !two.err); eq(a.S.karigars.length, 3, 'same opId = one karigar');
  var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(call(function(cb){ a.kgAddKarigar({name:'Net Fail', kind:'wastage', points:'2', opId:op()}, cb); }).err, 'failed save reported');
  a.saveToCloud = good; eq(a.S.karigars.length, 3, 'rolled back'); eq((a.S.kgAgreements || []).filter(function(x){ return /Net Fail/.test(JSON.stringify(x)); }).length, 0);
  a.SAAS.user.role = 'manager';
  var m = call(function(cb){ a.kgAddKarigar({name:'Mgr Added', phone:'9820099999', kind:'', opId:op()}, cb); }); ok(!m.err, m.err && m.err.message); eq(m.v.name, 'Mgr Added');
  ok(call(function(cb){ a.kgAddKarigar({name:'Mgr Terms', kind:'wastage', points:'4', opId:op()}, cb); }).err, 'a manager cannot set compensation terms');
  a.SAAS.user.role = 'staff'; ok(call(function(cb){ a.kgAddKarigar({name:'Staff', opId:op()}, cb); }).err, 'staff cannot add');
});
test('R16 C7: Add karigar sheet has the right fields; New job due date is a date picker', function(){
  var a = fresh('owner'); var sheet = null; a.kgForm = function(o){ sheet = o; };
  a.kg3AddKarigar(); var ids = sheet.fields.map(function(f){ return f.id; });
  ['name', 'phone', 'kind', 'points', 'rate'].forEach(function(f){ ok(ids.indexOf(f) !== -1, 'field ' + f); });
  var f = {}; sheet.fields.forEach(function(x){ f[x.id] = x; });
  ok(f.points.show({kind:'wastage'}) && !f.points.show({kind:'salary'}), 'points only for wastage'); ok(f.rate.show({kind:'salary'}) && !f.rate.show({kind:'wastage'}), 'salary rate only for salary');
  var got = null; sheet.onSubmit({name:'Via Sheet', phone:'', kind:'wastage', points:'4', opId:op()}, function(err){ got = err || 'done'; }); eq(got, 'done'); eq(a.S.karigars[0].name, 'Via Sheet');
  sheet = null; a.kg3NewJob(a.S.karigars[0].id); var due = sheet.fields.filter(function(x){ return x.id === 'due'; })[0];
  eq(due.type, 'date', 'due date is a picker, not typed text'); ok(!/YYYY/.test(due.label));
});
test('R16 B: kgForm draws a date field as input type=date', function(){
  var a = fresh('owner'); var html = '';
  a.document.createElement = function(){ var e = { style:{}, classList:{add(){}, remove(){}}, setAttribute(){}, appendChild(){}, addEventListener(){}, removeEventListener(){}, querySelector(){ return null; }, firstChild:null, parentNode:null };
    Object.defineProperty(e, 'innerHTML', {get: function(){ return html; }, set: function(v){ html = v; }}); return e; };
  a.document.getElementById = function(id){ return id === 'kg2-modal' ? null : { style:{}, textContent:'', innerHTML:'', onclick:null, disabled:false, value:'', checked:false, parentNode:null }; };
  a.document.body.appendChild = function(){};
  a.kgForm({title:'T', fields:[{id:'due', label:'Due', type:'date', value:''}], onSubmit:function(v, fin){ fin(null); }});
  ok(/<input type="date" id="kg2f-due"/.test(html), 'date input rendered');
});
test('R16 B: New job sheet - weight + purity can be blank; filled = job created AND metal issued; the fine is shown', function(){
  var a = fresh('owner'); var k = pk(a, 'NJ'); var sheet = null; a.kgForm = function(o){ sheet = o; };
  a.kg3NewJob(k.id); var ids = sheet.fields.map(function(f){ return f.id; });
  ['title', 'metal', 'wt', 'purity', 'due', 'ord'].forEach(function(f){ ok(ids.indexOf(f) !== -1, 'field ' + f); });
  var v0 = {title:'Blank box', metal:'gold', wt:'', purity:'', chip:false, confirmed:false, points:'4', tag:'', pieces:'', due:'', ord:'', opId:op()};
  var did = null; sheet.onSubmit(v0, function(err){ did = err || 'ok'; }); eq(did, 'ok'); eq(a.S.kgJobs.length, 1); eq(a.S.kgLedger.length, 0, 'blank weight = no metal issued');
  var pv = sheet.preview({wt:'10', purity:'91.82', metal:'gold', chip:false}); ok(pv.indexOf('9.182') !== -1 && /Posted to his account/.test(pv), 'Posted to his account 9.182 g fine: ' + pv);
  var v1 = {title:'With metal', metal:'gold', wt:'10', purity:'92', chip:false, confirmed:true, points:'4', tag:'', pieces:'', due:'', ord:'', opId:op()};
  did = null; sheet.onSubmit(v1, function(err){ did = err || 'ok'; }); eq(did, 'ok'); eq(a.S.kgJobs.length, 2); eq(a.S.kgLedger.length, 1); eq(a.S.kgLedger[0].fineMg, 9200);
  eq(a.S.kgLedger[0].jobId, a.S.kgJobs[1].id);
  var bad = {title:'Bad purity', metal:'gold', wt:'10', purity:'120', chip:false, confirmed:true, points:'', tag:'', pieces:'', due:'', ord:'', opId:op()};
  did = null; sheet.onSubmit(bad, function(err){ did = err || 'ok'; }); ok(did && did !== 'ok', 'bad purity refused'); eq(a.S.kgJobs.length, 2, 'nothing created when the purity is wrong');
  var half = {title:'Weight only', metal:'gold', wt:'10', purity:'', chip:false, confirmed:false, points:'', tag:'', pieces:'', due:'', ord:'', opId:op()};
  did = null; sheet.onSubmit(half, function(err){ did = err || 'ok'; }); ok(did && did !== 'ok', 'weight without purity refused'); eq(a.S.kgJobs.length, 2);
});
test('R16 B: New job preview adds the carry-forward line when he holds a carried balance', function(){
  var a = fresh('owner'); var k = pk(a, 'NJC'); trust(a, k); var j = pjob(a, k); issueV(a, j, '1', '92');
  ok(!closeV(a, j, {settle:'carry', opId:op()}).err);
  var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3NewJob(k.id);
  var pv = sheet.preview({wt:'10', purity:'92', metal:'gold', chip:false});
  ok(/already holds 0\.920 g fine/.test(pv), 'carry line: ' + pv); ok(/9\.200 g fine/.test(pv)); ok(/Use carried balance/.test(pv), 'says how to count it: ' + pv);
});
test('R16 B: Close job sheet - shows what he returns and offers Keep with him; same close maths as before', function(){
  var a = fresh('owner'); var k = pk(a, 'CJ'); trust(a, k); var j = pjob(a, k); issueV(a, j, '10', '92');
  var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3Close(j.id);
  var pv = sheet.preview({settle:'carry'}); ok(/He returns to you/.test(pv) && pv.indexOf('9.200') !== -1, pv);
  ok(sheet.fields.some(function(f){ return f.id === 'settle' && f.options.some(function(o){ return /Keep with him/i.test(o[1]); }); }), 'Keep with him option');
  var did = null; sheet.onSubmit({settle:'carry', reason:'', bill:'', ack:true, opId:op()}, function(err){ did = err || 'ok'; }); eq(did, 'ok'); eq(a.kgFindJob(j.id).status, 'closed'); eq(a.kgCarryTotal(k.id, 'gold'), 9200);
});
test('R16 review: Close sheet offers Keep-with-him only when he may carry; a new karigar leaves an audit line, removed on a failed save', function(){
  var a = fresh('owner'); var k = pk(a, 'NoCarry'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3Close(j.id);
  eq(sheet.fields[0].options.some(function(o){ return o[0] === 'carry'; }), false, 'no carry option'); eq(sheet.fields[0].value, 'return', 'the safe choice is the default when he cannot carry'); ok(/not set to keep a balance/.test(sheet.preview({})));
  trust(a, k); a.kg3Close(j.id); eq(sheet.fields[0].value, 'carry'); ok(sheet.fields[0].options[0][0] === 'carry');
  var n = (a.S.auditLog || []).length; ok(!call(function(cb){ a.kgAddKarigar({name:'Audited', kind:'', opId:op()}, cb); }).err);
  ok((a.S.auditLog || []).some(function(x){ return x.action === 'kg_karigar_add'; }), 'audit line');
  var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('net')); }; var m = (a.S.auditLog || []).length;
  ok(call(function(cb){ a.kgAddKarigar({name:'Failed', kind:'', opId:op()}, cb); }).err); a.saveToCloud = good; eq((a.S.auditLog || []).length, m, 'audit rolled back');
});
test('R16 C8: statement text and screen include the rupee advance and payments', function(){
  var a = fresh('owner'); var k = pk(a, 'ST'); var j = pjob(a, k); issueV(a, j, '10', '92'); a.S.orders = [];
  var adv = call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', 5000, 'adv', op(), cb, {advance:true, reason:'festival advance', confirmed:true, mode:'UPI', dbPost:true}); }); ok(!adv.err, adv.err && adv.err.message);
  ok(!call(function(cb){ a.kgAddRupeeOpening({karigarId:k.id, dir:'owe', amountText:'1200', note:'old khata', opId:op()}, cb); }).err);
  var from = '2000-01-01', to = '2999-12-31', t = a.kg3StatementText(k.id, 'gold', from, to);
  ok(/Rupees/.test(t), 'rupee section in the WhatsApp text'); ok(/5000|5,000/.test(t) && /advance/i.test(t), 'advance shown: ' + t); ok(/1200|1,200/.test(t), 'rupee opening shown');
  a._kg2.stFrom = from; a._kg2.stTo = to; a._kg2.stMetal = 'gold'; var h = a.kg3StatementHtml(k.id);
  ok(/Rupees/.test(h) && /advance/i.test(h) && /5,?000/.test(h), 'rupee section on screen');
  var r = a.kg3StatementText(k.id, 'rupees', from, to); ok(/Advance given/.test(r), 'rupee view lists the order advance'); ok((r.match(/Advance given/g) || []).length === 1, 'once');
  var g = a.kg3StatementText(pk(a, 'NoMoney').id, 'gold', from, to); ok(!/Rupees/.test(g), 'no rupee section when nothing in rupees');
});
test('R16 B: profile shows avatar initials, tiles, a sticky primary action, and the demo wording', function(){
  var a = fresh('owner'); var k = pk(a, 'Ramesh Sonar'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var h = a.kg3ProfileHtml(k.id);
  ok(h.indexOf('kgx-avatar') !== -1 && h.indexOf('>RS<') !== -1, 'avatar'); ok(h.indexOf('Fine gold with him') !== -1 && h.indexOf('999 basis') !== -1, 'tile text');
  ok(h.indexOf('kgx-sticky') !== -1 && h.indexOf('Add job') !== -1 && h.indexOf('Record payment') !== -1, 'sticky action bar');
  a.SAAS.user.role = 'manager'; h = a.kg3ProfileHtml(k.id); ok(h.indexOf('Add job') !== -1, 'manager can add a job'); ok(h.indexOf('Record payment') === -1 && h.indexOf('Give advance') === -1, 'no money buttons for a manager');
});
test('R16: no read of the kgProfileUi key remains in the code', function(){
  var fs = require('fs'), dir = __dirname + '/../js/';
  fs.readdirSync(dir).forEach(function(f){ if(/\.js$/.test(f)) ok(fs.readFileSync(dir + f, 'utf8').indexOf('kgProfileUi') === -1, f + ' still mentions kgProfileUi'); });
});


console.log('\nKarigar round 17 A - paise display, order cash rows, audit stack, in-flight duplicates, new job pre-check, input limits');

function orderStage(a, k, cost){
  a.S.orders = [{id:'o1', ordNo:'OR-1', status:'open', items:[{desc:'Ring', metal:'gold', purity:'22K', qty:1, weight:10,
    karigarStages:[{task:'Make', karigarId:k.id, status:'submitted', karigarPayMode:'cash', karigarCost:cost}]}]}];
}
test('R17 A1: paise are shown, never rounded to whole rupees', function(){
  var a = fresh('owner'); var k = pk(a, 'Paise');
  eq(a.kgFmtRs(10040), '₹100.40'); eq(a.kgFmtRs(50), '₹0.50'); eq(a.kgFmtRs(-50), '-₹0.50'); eq(a.kgFmtRs(150000), '₹1,500'); eq(a.kgFmtRs(123456789), '₹12,34,567.89');
  eq(a.kg3OrderOwedText('cash', 100.4), '₹100.40'); eq(a.kg3OrderOwedText('cash', -0.5), 'he owes the shop ₹0.50');
  orderStage(a, k, 699.2);
  var c = a.kg3PayOrderCheck(k.id, 'cash', '699.70', false); ok(c.error && c.error.indexOf('699.20') !== -1, c.error);
  for(var i = 0; i < 3; i++) ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '100.40', '', op(), cb); }).err);
  var t = a.kg3StatementText(k.id, 'gold', '2000-01-01', '2999-12-31'); eq((t.match(/100\.40/g) || []).length >= 3, true, t);
  ok(a.kg3ProfileHtml(k.id).indexOf('398.00') === -1 && a.kg3ProfileHtml(k.id).indexOf('₹398') !== -1, 'owed 699.20 - 301.20 = 398 shown exactly');
  var p = a.kg3PayOrderPreviewText(k.id, 'cash', '0.5', true); ok(p.indexOf('397.50') !== -1, p);
});
test('R17 A2: order cash rows - a reversal is its own row on its own date; a past range never changes; opening / closing / total', function(){
  var a = fresh('owner'); var k = pk(a, 'Rev'); orderStage(a, k, 1000);
  ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '300', 'first', op(), cb); }).err);
  var pay = a.S.karigarPayments[0]; pay.date = '2026-11-01';
  var before = a.kg3StatementText(k.id, 'gold', '2026-11-01', '2026-11-02'), beforeH = (a._kg2.stFrom = '2026-11-01', a._kg2.stTo = '2026-11-02', a._kg2.stMetal = 'gold', a.kg3StatementHtml(k.id));
  ok(!call(function(cb){ a.kg3PayOrderReverse(pay.id, 'paid twice by mistake', op(), cb); }).err);
  a.S.karigarPayments[1].date = '2026-11-05';
  eq(a.kg3StatementText(k.id, 'gold', '2026-11-01', '2026-11-02'), before, 'the printed range is unchanged by a later reversal'); eq(a.kg3StatementHtml(k.id), beforeH);
  ok(!/reversed/i.test(before), 'the original row is not re-labelled');
  var later = a.kg3StatementText(k.id, 'gold', '2026-11-03', '2026-11-30'); ok(/Reversed/.test(later) && /-₹300/.test(later), later); ok(/Opening: ₹300/.test(later) && /Closing: ₹0/.test(later), later);
  var r = a.kgOrderPayRows(k.id, '2026-11-01', '2026-11-30'); eq(r.rows.length, 2); eq(r.openingText, '₹0'); eq(r.totalText, '₹0'); eq(r.closingText, '₹0'); ok(/^\+/.test(r.rows[0].amountText) && /^-/.test(r.rows[1].amountText), JSON.stringify(r.rows));
  ok(/Total/.test(a.kg3StatementText(k.id, 'gold', '2026-11-01', '2026-11-30')), 'a Total line');
});
test('R17 A3: a failed kgAddKarigar leaves the shop data byte-identical, even with the audit log at its 300-line cap', function(){
  var a = fresh('owner'); a.S.kgAgreements = []; a.S.auditLog = []; for(var i = 0; i < 300; i++) a.S.auditLog.push({id:'au' + i, action:'x', ts:'t' + i});
  var snap = JSON.stringify(a.S); var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('net')); };
  ok(call(function(cb){ a.kgAddKarigar({name:'Cap Test', kind:'wastage', points:'4', opId:op()}, cb); }).err); a.saveToCloud = good;
  eq(JSON.stringify(a.S), snap, 'S is byte-identical'); eq(a.S.auditLog.length, 300);
});
test('R17 A3b: with no kgAgreements key at all a failed add leaves S untouched', function(){
  var a = fresh('owner'); delete a.S.kgAgreements; var snap = JSON.stringify(a.S); a.saveToCloud = function(cb){ cb(new Error('net')); };
  ok(call(function(cb){ a.kgAddKarigar({name:'No Key', kind:'wastage', points:'4', opId:op()}, cb); }).err); eq(JSON.stringify(a.S), snap);
});
test('R17 A4: a duplicate opId while the first save is in flight waits for it (job and karigar)', function(){
  var a = fresh('owner'); var k = pk(a, 'Wait'); var pending = []; a.saveToCloud = function(cb){ pending.push(cb); };
  var r1 = {}, r2 = {}, id = op();
  a.kgCreateJob({karigarId:k.id, title:'Dup', model:'points'}, id, function(e, v){ r1.e = e; r1.done = true; });
  a.kgCreateJob({karigarId:k.id, title:'Dup', model:'points'}, id, function(e, v){ r2.e = e; r2.done = true; });
  eq(!!r2.done, false, 'second caller must wait'); eq(pending.length, 1, 'one save only');
  pending[0](new Error('net')); ok(r1.done && r2.done && r1.e && r2.e, 'both are told it failed'); eq(a.S.kgJobs.length, 0);
  pending = []; var s1 = {}, s2 = {}, kid = op();
  a.kgAddKarigar({name:'Same Op', kind:'', opId:kid}, function(e){ s1.e = e; s1.done = true; });
  a.kgAddKarigar({name:'Same Op', kind:'', opId:kid}, function(e){ s2.e = e; s2.done = true; });
  eq(!!s2.done, false); pending[0](null); ok(s1.done && s2.done && !s1.e && !s2.e); eq(a.S.karigars.filter(function(x){ return x.name === 'Same Op'; }).length, 1);
});
test('R17 A5: New job checks the ledger flag BEFORE creating the job; the creating manager may cancel an empty job', function(){
  var a = fresh('owner'); var k = pk(a, 'Pre'); var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3NewJob(k.id);
  var v = {title:'Blocked', metal:'gold', wt:'10', purity:'92', chip:false, confirmed:true, points:'', tag:'', pieces:'', due:'', ord:'', opId:op()};
  a.S.kgLedgerOn = true; var did = null; sheet.onSubmit(v, function(err){ did = err || 'ok'; }); ok(did && did !== 'ok' && /ledger/i.test(did.message), 'refused'); eq(a.S.kgJobs.length, 0, 'no empty job left behind');
  a.S.kgLedgerOn = false; a._kgFlagUnknown = true; did = null; v.opId = op(); sheet.onSubmit(v, function(err){ did = err || 'ok'; }); ok(did && did !== 'ok', 'flag unknown refused'); eq(a.S.kgJobs.length, 0);
  a._kgFlagUnknown = false;
  a.SAAS.user = {name:'Mia', role:'manager'}; var j = pjob(a, k);
  ok(!call(function(cb){ a.kgCancelJob(j.id, 'made by mistake', cb); }).err, 'the manager who made an empty job may cancel it');
  var j2 = pjob(a, k); a.SAAS.user = {name:'Other', role:'manager'}; ok(call(function(cb){ a.kgCancelJob(j2.id, 'not my job', cb); }).err, 'another manager may not');
  a.SAAS.user = {name:'Mia', role:'manager'}; var j3 = pjob(a, k); issueV(a, j3, '1', '92'); ok(call(function(cb){ a.kgCancelJob(j3.id, 'has metal now', cb); }).err, 'not once metal is on it');
  a.SAAS.user = {name:'Mia', role:'manager'}; a._kg2.more = j.id; ok(a.kg3JobHtml(j).indexOf('kg2Cancel(') === -1 || j.status === 'cancelled');
  var j4 = pjob(a, k); a._kg2.more = j4.id; ok(a.kg3JobHtml(j4).indexOf('kg2Cancel(') !== -1, 'the creator sees Cancel job on an empty job');
});
test('R17 A6: input limits - name length, phone shape, cost with at most 2 decimals', function(){
  var a = fresh('owner');
  ok(call(function(cb){ a.kgAddKarigar({name:new Array(62).join('x'), kind:'', opId:op()}, cb); }).err, 'name over 60 refused');
  ok(!call(function(cb){ a.kgAddKarigar({name:new Array(61).join('x'), kind:'', opId:op()}, cb); }).err, '60 is fine');
  ok(call(function(cb){ a.kgAddKarigar({name:'Letters', phone:'abc9876543212xyz', kind:'', opId:op()}, cb); }).err, 'letters in a phone refused');
  var p = call(function(cb){ a.kgAddKarigar({name:'Plus', phone:'+91 98765 43210', kind:'', opId:op()}, cb); }); ok(!p.err, p.err && p.err.message); eq(p.v.phone, '9876543210');
  ok(call(function(cb){ a.kgAddKarigar({name:'Short', phone:'98765', kind:'', opId:op()}, cb); }).err);
  var k = a.S.karigars[0]; ok(a.updateKarigarProfile(k.id, {name:k.name, phone:'abc9876543212xyz', skills:'', note:''}) !== '', 'edit details too'); ok(a.updateKarigarProfile(k.id, {name:new Array(70).join('y'), phone:'', skills:'', note:''}) !== '', 'long name on edit');
  eq(a.karigarCost2('699.2'), 699.2); eq(a.karigarCost2('699.234'), null); eq(a.karigarCost2('-1'), null); eq(a.karigarCost2('abc'), null); eq(a.karigarCost2('0'), null); eq(a.karigarCost2('100'), 100);
  var pay = a.S.karigarPayments = []; var kk = pk(a, 'Undated'); orderStage(a, kk, 500); a.S.karigarPayments = [{id:'old1', opId:'o1', karigarId:kk.id, type:'cash', amount:100, note:''}];
  ok(a.kgOrderPayRows(kk.id, '2000-01-01', '2999-12-31').openingText === '₹100', 'an undated old payment counts in the opening, as it does in owed');
});

console.log('\nKarigar round 17 B - design: close sheet, job page, statement, actions, list, new job, dates, back, css');

function readIndex(){ return require('fs').readFileSync(__dirname + '/../index.html', 'utf8'); }
test('R17 B7: Close sheet shows Given / counted / He returns, the Keep / He returns it now choice, the record-returns-first line, and a default loss reason', function(){
  var a = fresh('owner'); var k = pk(a, 'CS'); trust(a, k); var j = pjob(a, k); issueV(a, j, '10', '92'); receiptV(a, j, {gross:'4', purity:'92', agreed:'92'});
  var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3Close(j.id);
  var pv = sheet.preview({settle:'carry'}); ok(/Given 9\.200 g/.test(pv), pv); ok(/counted/i.test(pv), 'counted line'); ok(/He returns to you/.test(pv)); ok(/Receive piece/.test(pv) && /Scrap/.test(pv), 'record returns first: ' + pv);
  var opts = sheet.fields[0].options.map(function(o){ return o[0]; }); ok(opts.indexOf('carry') !== -1 && opts.indexOf('return') !== -1 && opts.indexOf('loss') !== -1, opts.join());
  var reason = sheet.fields.filter(function(f){ return f.id === 'reason'; })[0]; ok(String(reason.value || '').length >= 5, 'loss reason is pre-filled so a small close is three taps');
  ok(/Close job/.test(sheet.submitText({settle:'carry'})) && /Scrap|Receive|record/i.test(sheet.submitText({settle:'return'})), sheet.submitText({settle:'return'}));
  var opened = null; a.kg3Scrap = function(id){ opened = id; }; var did = null; sheet.onSubmit({settle:'return', reason:'', bill:'', ack:false, opId:op()}, function(err){ did = err || 'ok'; });
  eq(did, 'ok'); eq(opened, j.id, 'He returns it now opens the Scrap sheet'); eq(a.kgFindJob(j.id).status, 'open', 'nothing is closed or posted by that choice');
  var nt = fresh('owner'); var k2 = pk(nt, 'NC'); var j2 = pjob(nt, k2); issueV(nt, j2, '10', '92'); nt.kgForm = function(o){ sheet = o; }; nt.kg3Close(j2.id);
  eq(sheet.fields[0].options.some(function(o){ return o[0] === 'carry'; }), false, 'cannot carry: no carry choice'); ok(/not set to keep a balance/.test(sheet.preview({})));
});
test('R17 B8: job page and statement use the profile look (text Back, date pickers side by side, no orphan tile)', function(){
  var a = fresh('owner'); var k = pk(a, 'Look'); var j = pjob(a, k); issueV(a, j, '10', '92');
  var h = a.kg3JobHtml(j); ok(h.indexOf('class="kgx-back"') !== -1 && h.indexOf('kgx-h2') !== -1, 'job page head'); ok(h.indexOf('kg2-row">' + a.kg2Btn('←')) === -1);
  a._kg2.stFrom = '2000-01-01'; a._kg2.stTo = '2999-12-31'; a._kg2.stMetal = 'gold'; var st = a.kg3StatementHtml(k.id);
  ok(st.indexOf('class="kgx-back"') !== -1 && st.indexOf('kgx-dates') !== -1, 'statement head and the two dates in one row');
  var kp = st.match(/<div class="kg2-kpis">([\s\S]*?)<\/div><\/div>/); var tiles = (st.match(/class="kg2-kpi ?(wide)?"/g) || []);
  var wide = tiles.filter(function(t){ return /wide/.test(t); }).length, normal = tiles.length - wide; ok(tiles.length >= 3, 'tiles counted'); eq(normal % 2, 0, 'an even number of half tiles, no orphan: ' + tiles.join());
  a._kg2.stMetal = 'rupees'; st = a.kg3StatementHtml(k.id); tiles = (st.match(/class="kg2-kpi ?(wide)?"/g) || []); eq((tiles.length - tiles.filter(function(t){ return /wide/.test(t); }).length) % 2, 0, 'rupee view too');
});
test('R17 B10: three visible actions at most (Add job, Record payment, More); Give advance is under More', function(){
  var a = fresh('owner'); var k = pk(a, 'Act'); var h = a.kg3ProfileHtml(k.id); var row = h.match(/<div class="kg2-row" id="kg3-pactions">([\s\S]*?)<\/div>/)[1];
  eq((row.match(/<button/g) || []).length, 3, row); ok(row.indexOf('kg3NewJob') !== -1 && row.indexOf('kg2Money') !== -1 && row.indexOf('kg3MoreProfile') !== -1); ok(row.indexOf('kg3PayOrder') === -1);
  a._kg2.more = 'p:' + k.id; h = a.kg3ProfileHtml(k.id); ok(/id="kg3-pmore">[\s\S]*kg3PayOrder\(/.test(h), 'Give advance under More');
  a.SAAS.user.role = 'manager'; h = a.kg3ProfileHtml(k.id); row = h.match(/<div class="kg2-row" id="kg3-pactions">([\s\S]*?)<\/div>/)[1]; ok((row.match(/<button/g) || []).length <= 3 && row.indexOf('kg2Money') === -1);
});
test('R17 B11: settled karigar shows "Settled" and no empty-gold line; the section pills are 44 px and scroll in one row', function(){
  var a = fresh('owner'); var k = pk(a, 'Quiet'); var h = a.kg3RowsHtml(); ok(h.indexOf('Settled') !== -1 && h.indexOf('No active jobs') === -1 && h.indexOf('0.000 g gold') === -1, h);
  var j = pjob(a, k); issueV(a, j, '10', '92'); h = a.kg3RowsHtml(); ok(h.indexOf('9.200 g gold') !== -1 && h.indexOf('1 job') !== -1);
  var css = readIndex(); ok(/\.kg2-nav\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/.test(css), 'nav scrolls'); ok(/#kg2-root \.kg2-nav \.btn\{[^}]*min-height:44px/.test(css), '44 px pills');
});
test('R17 B12: New job sheet - four metal chips, a For row, due beside weight and purity, More details, a button that says what happens', function(){
  var a = fresh('owner'); var k = pk(a, 'Chips'); var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3NewJob(k.id);
  var m = sheet.fields.filter(function(f){ return f.id === 'metal'; })[0]; eq(m.type, 'chips'); eq(m.options.map(function(o){ return o[1]; }).join('|'), 'Gold 22K|Gold 18K|Silver|Other');
  ok(sheet.fields[0].type === 'note' && /Chips/.test(sheet.fields[0].html), 'For row'); ok(m.options[0][2].purity === '91.6' && m.options[1][2].purity === '75', 'chips pre-fill the purity');
  var by = {}; sheet.fields.forEach(function(f){ by[f.id] = f; }); ok(by.points.more && by.tag.more && by.pieces.more, 'optional fields under More details'); ok(by.wt.row && by.wt.row === by.purity.row && !by.due.row && by.due.type === 'date', 'weight and purity share a row; the due date has a full-width line of its own');
  eq(sheet.submitText({title:'x', wt:'', purity:''}), 'Create job'); eq(sheet.submitText({metal:'gold22', wt:'10', purity:'92'}), 'Create job and issue gold'); eq(sheet.submitText({metal:'silver', wt:'10', purity:'92.5'}), 'Create job and issue silver');
  var did = null; sheet.onSubmit({title:'Silver ring', metal:'silver', wt:'10', purity:'92.5', chip:false, confirmed:true, points:'', tag:'', pieces:'', due:'', ord:'', opId:op()}, function(err){ did = err || 'ok'; }); eq(did, 'ok'); eq(a.S.kgJobs[0].metal, 'silver');
  sheet.onSubmit({title:'Gold 18', metal:'gold18', wt:'', purity:'', chip:false, confirmed:false, points:'', tag:'', pieces:'', due:'', ord:'', opId:op()}, function(err){ did = err || 'ok'; }); eq(a.S.kgJobs[1].metal, 'gold');
});
test('R17 B13: days read like 13 Nov, in the job chips and account rows', function(){
  var a = fresh('owner'); var yr = a.kgToday().slice(0, 4);
  eq(a.kgDay(yr + '-11-13'), '13 Nov'); eq(a.kgDay(yr + '-01-05'), '5 Jan'); eq(a.kgDay('2019-03-09'), '9 Mar 2019'); eq(a.kgDay(''), ''); eq(a.kgDay('bad'), 'bad');
  var k = pk(a, 'Dates'); var j = pjob(a, k, {dueDate:yr + '-12-30'}); issueV(a, j, '10', '92'); var h = a.kg3ProfileHtml(k.id); ok(/Due 30 Dec/.test(h), 'due chip'); ok(!/\d{4}-\d{2}-\d{2}/.test(h.replace(/value="[^"]*"/g, '')), 'no ISO date left on the profile');
});
test('R17 B14/B9/B16: css - gutter, sheet title, gold focus ring, ellipsis, grey page, no dead "Karigar 2.0" text', function(){
  var css = readIndex(); ok(/#kg2-root\{[^}]*padding:16px 0 140px/.test(css), 'no second gutter'); ok(/\.kgx-sheethead \.kg2-title\{[^}]*color:#1D1D1F[^}]*text-overflow:ellipsis/.test(css), 'sheet title');
  ok(/\.kg2-ov input:focus[^{]*\{[^}]*#B8892B/.test(css), 'gold focus ring'); ok(/body:has\(#panel-karigars\.active\)\{background:#F5F5F7/.test(css), 'no cream around the card'); ok(css.indexOf('.kg2-new') === -1, '.kg2-new removed');
  var a = fresh('owner'); ok(a.kg2TodayHtml().indexOf('2.0') === -1, 'Karigar 2.0 text removed');
});
test('R17 review: a throw inside a once-guarded save never leaves the op id busy; the same page twice needs one Back; a stale stack is forgotten when the panel is not showing', function(){
  var a = fresh('owner'); var k = pk(a, 'Thr'); var id = op(); var first = a.saveToCloud; a.saveToCloud = function(){ throw new Error('boom'); };
  var r = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'Throws', model:'points'}, id, cb); }); ok(r.err, 'told it failed'); a.saveToCloud = first;
  var r2 = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'Throws', model:'points'}, id, cb); }); ok(!r2.err, 'the same op id can be retried: ' + (r2.err && r2.err.message));
  var e = sheetEnv(), b = e.a, pend = [], st = 0; b.history = {pushState:function(){ st++; }, back:function(){ pend.push(1); }, go:function(n){ pend.push(-n); }}; b.renderKgV2 = function(){};
  var kk = pk(b, 'Same'); b.kg3Open(kk.id); b._kg2.jobId = 'j1'; b.kgSetView('job'); b.kgSetView('job'); eq(st, 2, 'the same page twice is one entry');
  var panelOn = false; b.document.getElementById = (function(orig){ return function(id){ if(id === 'panel-karigars') return {classList:{contains:function(){ return panelOn; }}}; return orig(id); }; })(b.document.getElementById);
  pend.push(1); st -= 1; b.kgPopHandler(); eq(b._kg2.view, 'people', 'a Back while the panel is hidden only forgets the stack');
});
test('R17 B15: Back on a profile returns to the list; Back on the list leaves as before; in-app Back unwinds the pushed entries; sheets keep working on top', function(){
  var e = sheetEnv(), a = e.a, log = [], depthStack = 0, pend = [];
  a.history = {pushState:function(){ depthStack++; log.push('push'); }, back:function(){ pend.push(1); log.push('back'); }, go:function(n){ pend.push(-n); log.push('go' + n); }};
  function fire(){ var n = pend.shift(); depthStack -= n; a.kgPopHandler(); }
  var k = pk(a, 'Nav'); a.renderKgV2 = function(){};
  a.kg3Open(k.id); eq(a._kg2.view, 'profile'); eq(depthStack, 1, 'profile pushed one entry');
  pend.push(1); fire(); eq(a._kg2.view, 'people', 'Back from a profile goes to the list'); eq(depthStack, 0);
  a.kg3Open(k.id); a.kg2Go('people'); eq(a._kg2.view, 'people'); eq(pend.length, 1, 'the in-app Back pops its entry'); fire(); eq(depthStack, 0); eq(a._kg2.view, 'people', 'the echo is not a second Back');
  a.kg3Open(k.id); a.kg3Statement(k.id); eq(depthStack, 2); pend.push(1); fire(); eq(a._kg2.view, 'profile', 'Back from the statement goes to the profile'); pend.push(1); fire(); eq(a._kg2.view, 'people');
  a.kg3Open(k.id); openSheet(e, 'Sheet'); eq(depthStack, 2, 'a sheet adds its own entry'); pend.push(1); fire(); eq(e.body.kids.length, 0, 'Back closes the sheet'); eq(a._kg2.view, 'profile', 'and stays on the profile');
  pend.push(1); fire(); eq(a._kg2.view, 'people');
  a.kg3Open(k.id); openSheet(e, 'S2'); e.reg['kg2-cancel'].onclick({}); while(pend.length) fire(); eq(a._kg2.view, 'profile'); eq(depthStack, 1);
});

console.log('\nKarigar round 18 - labour per gram of net weight for wastage karigars');

function lk(a, name, rate, kind){
  var k = a.addOrGetKarigar(name);
  var terms = (kind === 'salary') ? {kind:'salary', salaryMode:'monthly', rate:'30000'} : {kind:'wastage', points:'4', labourRate:rate || '', labourBase:'net'};
  var r = call(function(cb){ a.kgSetTerms(k.id, terms, cb); }); if(r.err) throw new Error('terms: ' + r.err.message);
  return k;
}
function labRows(a, job){ var gone = {}; a.S.kgSalary.forEach(function(x){ if(x.type === 'REVERSAL') gone[x.reversesId] = true; }); return a.S.kgSalary.filter(function(x){ return x.type === 'JOB_LABOUR' && (!job || x.jobId === job.id) && !gone[x.id]; }); }
function labJob(a, k, rate, issueG){
  var j = pjob(a, k, rate ? {labourText:rate} : {}); issueV(a, j, issueG || '30', '', '', '999'); return j;
}
function closeCarry(a, j){ return closeV(a, j, {settle:'carry', opId:op()}); }

test('R18 worked example 1: 5.000 g net at Rs 150/g = Rs 750.00 posted once at Close, shown as owed, on the statement and in the WhatsApp text', function(){
  var a = fresh('owner'); var k = lk(a, 'Lab1', '150'); trust(a, k); var j = labJob(a, k);
  receiptV(a, j, {gross:'5', purity:'92', agreed:'92'});
  eq(labRows(a).length, 0, 'nothing is posted before the job closes'); eq(a.kgSalaryBalance(k.id).payable, 0);
  var c = closeCarry(a, j); ok(!c.err, c.err && c.err.message);
  var rows = labRows(a, j); eq(rows.length, 1); eq(rows[0].amountPaise, 75000); eq(a.kgFmtRs(75000), '₹750'); eq(a.kgSalaryBalance(k.id).payable, 75000); eq(j.earnings.labourPaise, 75000);
  ok(a.kg3ProfileHtml(k.id).indexOf('You owe him') !== -1 && a.kg3ProfileHtml(k.id).indexOf('₹750') !== -1, 'Rupees tile shows the labour owed');
  var t = a.kg3StatementText(k.id, 'gold', '2000-01-01', '2999-12-31'); ok(/Job labour/.test(t) && /₹750/.test(t), t);
  a._kg2.stFrom = '2000-01-01'; a._kg2.stTo = '2999-12-31'; a._kg2.stMetal = 'gold'; ok(/Job labour/.test(a.kg3StatementHtml(k.id)));
});
test('R18 worked example 2: a ring with 2 ct stones, 11.600 g net at Rs 120/g = Rs 1,392.00', function(){
  var a = fresh('owner'); var k = lk(a, 'Lab2', '120'); trust(a, k); var j = labJob(a, k);
  var r = receiptV(a, j, {gross:'12', stoneCt:'2', stoneMode:'A', purity:'92'}); eq(r.entry.mg, 11600);
  ok(!closeCarry(a, j).err); var rows = labRows(a, j); eq(rows[0].amountPaise, 139200); eq(a.kgFmtRs(139200), '₹1,392');
});
test('R18 rounding: 21 small receipts are rounded per receipt line (half up, whole paise); the drift from the exact sum is at most half a paisa per line', function(){
  var a = fresh('owner'); var k = lk(a, 'Lab21', '33.33'); trust(a, k); var j = labJob(a, k);
  for(var i = 0; i < 21; i++) receiptV(a, j, {gross:'0.007', purity:'92', agreed:'92'});
  ok(!closeCarry(a, j).err); var paise = labRows(a, j)[0].amountPaise;
  eq(paise, 21 * Math.round(3333 * 7 / 1000), 'sum of the per-line roundings'); eq(paise, 483);
  var exact = 3333 * 147 / 1000; ok(Math.abs(paise - exact) <= 21 * 0.5, 'drift ' + (exact - paise).toFixed(3) + ' paise stays within 10.5');
  var h = fresh('owner'); var k2 = lk(h, 'Half', '0.50'); trust(h, k2); var j2 = labJob(h, k2); receiptV(h, j2, {gross:'0.001', purity:'92', agreed:'92'}); ok(!closeCarry(h, j2).err);
  eq(h.S.kgSalary.filter(function(x){ return x.type === 'JOB_LABOUR'; }).length, 0, '0.05 paise rounds to 0: no row of zero');
  var q = fresh('owner'); var k3 = lk(q, 'HalfUp', '2.50'); trust(q, k3); var j3 = labJob(q, k3); receiptV(q, j3, {gross:'0.002', purity:'92', agreed:'92'}); receiptV(q, j3, {gross:'0.006', purity:'92', agreed:'92'}); ok(!closeCarry(q, j3).err);
  eq(labRows(q, j3)[0].amountPaise, 3, 'half-up per line (0.5 -> 1, 1.5 -> 2), not 2 from rounding the sum');
});
test('R18 partial return then close: only what came back earns labour; the rest carries', function(){
  var a = fresh('owner'); var k = lk(a, 'Part', '150'); trust(a, k); var j = labJob(a, k, '', '10');
  receiptV(a, j, {gross:'4', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err);
  eq(labRows(a, j)[0].amountPaise, 4 * 15000); ok(a.kgCarryTotal(k.id, 'gold') > 0, 'the rest is carried');
});
test('R18 a receipt cannot be reversed on a closed job; reopen reverses the labour; reverse the receipt; close again posts one fresh row (no stale payable)', function(){
  var a = fresh('owner'); var k = lk(a, 'Rev', '150'); trust(a, k); var j = labJob(a, k);
  var r1 = receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); var r2 = receiptV(a, j, {gross:'3', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err);
  eq(a.kgSalaryBalance(k.id).payable, 8 * 15000);
  ok(call(function(cb){ a.kgReverse(r2.entry.id, 'weighed twice', op(), cb); }).err, 'closed job: reopen first');
  var ro = call(function(cb){ a.kgReopenJob(j.id, cb, {}); }); ok(!ro.err, ro.err && ro.err.message); eq(labRows(a, j).length, 0); eq(a.kgSalaryBalance(k.id).payable, 0, 'labour reversed on reopen');
  ok(!call(function(cb){ a.kgReverse(r2.entry.id, 'weighed twice', op(), cb); }).err);
  ok(!closeCarry(a, j).err); var rows = labRows(a, j); eq(rows.length, 1); eq(rows[0].amountPaise, 5 * 15000); eq(a.kgSalaryBalance(k.id).payable, 5 * 15000);
  eq(a.S.kgSalary.filter(function(x){ return x.type === 'JOB_LABOUR'; }).length, 2, 'the first row stays in the book, reversed');
});
test('R18 paid labour: reopen warns first (he would owe the shop); confirmed reopen reverses it', function(){
  var a = fresh('owner'); var k = lk(a, 'Paid', '100'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err);
  ok(!call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:50000, mode:'cash', note:''}, cb); }).err); eq(a.kgSalaryBalance(k.id).payable, 0);
  var info = a.kgReopenInfo(j.id); eq(info.labourPaise, 50000); eq(info.owesShopPaise, 50000); eq(info.needsConfirm, true);
  var no = call(function(cb){ a.kgReopenJob(j.id, cb, {}); }); ok(no.err && /already paid/.test(no.err.message), no.err && no.err.message); eq(a.kgFindJob(j.id).status, 'closed');
  ok(!call(function(cb){ a.kgReopenJob(j.id, cb, {confirmed:true}); }).err); eq(a.kgSalaryBalance(k.id).payable, -50000, 'he owes the shop what was paid; gold and rupees stay apart');
});
test('R18 rules: only the owner sets a rate; terms freeze after the first entry; a job override beats the karigar terms; salary / zero-labour / old jobs post nothing', function(){
  var a = fresh('owner'); var k = lk(a, 'Frz', '150'); trust(a, k);
  a.SAAS.user = {name:'Mgr', role:'manager'}; ok(call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4', labourRate:'999', labourBase:'net'}, cb); }).err, 'a manager cannot change the rate');
  ok(call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'m', model:'points', labourText:'500'}, op(), cb); }).err, 'nor set one on a job');
  var mj = call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'plain', model:'points'}, op(), cb); }); ok(!mj.err, 'a manager can still make a job that follows the terms');
  a.SAAS.user = {name:'Tester', role:'owner'};
  var j = labJob(a, k); call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4', labourRate:'200', labourBase:'net'}, cb); });
  receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err); eq(labRows(a, j)[0].amountPaise, 75000, 'frozen at 150 when metal was first issued');
  var j2 = labJob(a, k); eq(a.kgTermsFor(j2, k.id).labourPg, 20000, 'a new job takes the new terms');
  var j3 = labJob(a, k, '180'); receiptV(a, j3, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(a, j3).err); eq(labRows(a, j3)[0].amountPaise, 5 * 18000, 'the job rate beats the terms');
  var s = fresh('owner'); var ks = lk(s, 'Sal', '', 'salary'); var js = pjob(s, ks); issueV(s, js, '10', '92'); receiptV(s, js, {gross:'4', purity:'92'}); closeV(s, js, {settle:'loss', reason:'making loss accepted', opId:op()});
  eq(s.S.kgSalary.filter(function(x){ return x.type === 'JOB_LABOUR'; }).length, 0, 'salary karigar: no labour row');
  ok(call(function(cb){ s.kgCreateJob({karigarId:ks.id, title:'x', model:'points', labourText:'100'}, op(), cb); }).err, 'no labour on a salary karigar');
  var z = fresh('owner'); var kz = lk(z, 'Zero', ''); trust(z, kz); var jz = labJob(z, kz); receiptV(z, jz, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(z, jz).err); eq((z.S.kgSalary || []).length, 0, 'labour 0: behaviour as today');
});
test('R18 accepted loss and a cash loss bill leave labour alone; the bill is its own DEDUCTION row', function(){
  var a = fresh('owner'); var k = lk(a, 'Loss', '100'); var j = labJob(a, k, '', '10'); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'});
  var c = closeV(a, j, {settle:'loss-cash', reason:'making loss billed', billText:'120', opId:op()}); ok(!c.err, c.err && c.err.message);
  var lab = labRows(a, j); eq(lab.length, 1); eq(lab[0].amountPaise, 50000);
  var ded = a.S.kgSalary.filter(function(x){ return x.type === 'DEDUCTION'; }); eq(ded.length, 1); eq(ded[0].amountPaise, 12000); eq(a.kgSalaryBalance(k.id).payable, 50000 - 12000);
});
test('R18 sheets: Add karigar, Terms and New job show "Labour Rs per gram (net weight)" for wastage karigars only; a manager does not see it on New job', function(){
  var a = fresh('owner'); var sheet = null; a.kgForm = function(o){ sheet = o; };
  a.kg3AddKarigar(); var f = {}; sheet.fields.forEach(function(x){ f[x.id] = x; }); ok(f.labour && /Labour/.test(f.labour.label) && /net weight/.test(f.labour.label), 'add karigar'); ok(f.labour.show({kind:'wastage'}) && !f.labour.show({kind:'salary'}));
  var g = null; sheet.onSubmit({name:'With Labour', phone:'', kind:'wastage', points:'4', labour:'150.50', opId:op()}, function(err){ g = err || 'ok'; }); eq(g, 'ok');
  var k = a.S.karigars[0]; eq(a.kgAgreementFor(k.id, a.kgToday()).labour.perGramPaise, 15050); eq(a.kgAgreementFor(k.id, a.kgToday()).labour.base, 'net');
  ok(call(function(cb){ a.kgAddKarigar({name:'Three Dec', kind:'wastage', points:'4', labour:'1.005', opId:op()}, cb); }).err, '3 decimals refused');
  ok(call(function(cb){ a.kgAddKarigar({name:'Sal Lab', kind:'salary', salaryMode:'monthly', rate:'1000', labour:'5', opId:op()}, cb); }).err, 'salary + labour refused');
  a.kg2Terms(k.id); var t = {}; sheet.fields.forEach(function(x){ t[x.id] = x; }); ok(t.lab && /net weight/.test(t.lab.label) && t.lab.value === '150.5', 'terms sheet shows the current rate: ' + (t.lab && t.lab.value));
  var gg = null; sheet.onSubmit({from:a.kgToday(), kind:'wastage', points:'4', lab:'175', mode:'monthly', rate:'', opId:op()}, function(err){ gg = err || 'ok'; }); eq(gg, 'ok'); eq(a.kgAgreementFor(k.id, a.kgToday()).labour.perGramPaise, 17500);
  a.kg3NewJob(k.id); var n = {}; sheet.fields.forEach(function(x){ n[x.id] = x; }); ok(n.labour && n.labour.more && n.labour.value === '175', 'New job: prefilled from the terms, under More details');
  var gj = null; sheet.onSubmit({title:'Own rate', metal:'gold22', wt:'', purity:'', chip:false, confirmed:false, points:'4', labour:'180', tag:'', pieces:'', due:'', ord:'', opId:op()}, function(err){ gj = err || 'ok'; }); eq(gj, 'ok'); eq(a.S.kgJobs[0].labourPg, 18000);
  a.SAAS.user = {name:'Mgr', role:'manager'}; a.kg3NewJob(k.id); var m = {}; sheet.fields.forEach(function(x){ m[x.id] = x; }); ok(!m.labour, 'no labour field for a manager');
});
test('R18 fuzz: the rupee balance is exactly labour - payments - advances - deductions, in whole paise, through random jobs, receipts, closes, reopens and payments', function(){
  var a = fresh('owner'); var k = lk(a, 'Fuzz', '37.77'); trust(a, k); var seed = 987654321;
  function rnd(n){ seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }   // xorshift32: deterministic, good low bits
  var jobs = [], expectLabour = 0, pg = 3777;
  function exactBalance(){
    var t = 0, rev = {}; a.S.kgSalary.forEach(function(x){ if(x.type === 'REVERSAL') rev[x.reversesId] = true; });
    a.S.kgSalary.forEach(function(x){ if(x.karigarId !== k.id || x.type === 'REVERSAL' || rev[x.id]) return; if(x.type === 'JOB_LABOUR') t += x.amountPaise; else if(x.type === 'PAYMENT' || x.type === 'ADVANCE' || x.type === 'DEDUCTION') t -= x.amountPaise; });
    return t;
  }
  function independent(){ var t = 0, idx = a.kgIndex(a.S.kgLedger); a.S.kgJobs.forEach(function(j){ if(j.status !== 'closed') return; a.S.kgLedger.forEach(function(e){ if(e.jobId === j.id && e.type === 'RECEIPT' && !idx.reversed[e.id]) t += Math.round(pg * e.mg / 1000); }); }); return t; }
  var payTotal = 0;
  for(var i = 0; i < 200; i++){
    var op1 = rnd(6), open = a.S.kgJobs.filter(function(j){ return j.status === 'open'; }), closed = a.S.kgJobs.filter(function(j){ return j.status === 'closed'; });
    if(op1 === 0 || !open.length){ var j = labJob(a, k, '', '30'); }
    else if(op1 === 1){ var oj = open[rnd(open.length)]; var w = (1 + rnd(900)) / 1000 * (1 + rnd(5)); var wt = (Math.round(w * 1000) / 1000).toFixed(3); var rr = call(function(cb){ var b = a.kgBuildReceipt(oj.id, '', {gross:wt, purity:'92', agreed:'92', piece:'p', qty:'1', confirmed:true, opId:op()}); if(!b.entry) return cb(new Error(b.error || b.confirm)); a.kgAddEntry(b.entry, cb); }); }
    else if(op1 === 2){ var cj = open[rnd(open.length)]; closeCarry(a, cj); }
    else if(op1 === 3 && closed.length){ var rj = closed[rnd(closed.length)]; call(function(cb){ a.kgReopenJob(rj.id, cb, {confirmed:true}); }); }
    else if(op1 === 4){ var bal = a.kgSalaryBalance(k.id).payable; if(bal > 0){ var amt = 1 + rnd(bal); call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:amt, mode:'cash', note:''}, cb); }); } }
    else if(op1 === 5){ var adv = 1 + rnd(20000); call(function(cb){ a.kgAddSalary({type:'ADVANCE', opId:op(), karigarId:k.id, amountPaise:adv, mode:'cash', note:'fuzz advance'}, cb); }); }
    eq(a.kgSalaryBalance(k.id).payable, exactBalance(), 'balance = rows, step ' + i);
    var lab = 0; labRows(a).forEach(function(x){ lab += x.amountPaise; }); eq(lab, independent(), 'posted labour = independent recomputation of the live receipts of closed jobs, step ' + i);
  }
  ok(a.S.kgJobs.length > 3 && labRows(a).length > 0, 'the run did real work: jobs ' + a.S.kgJobs.length + ', receipts ' + a.S.kgLedger.filter(function(e){ return e.type === 'RECEIPT'; }).length + ', labour rows ' + labRows(a).length + ', closed ' + a.S.kgJobs.filter(function(j){ return j.status === 'closed'; }).length);
});
test('R18 two karigars on one job: one labour row each at his own frozen rate; reopen reverses both; a failed close rolls both back; a repeated close op posts nothing twice; gold is untouched by labour', function(){
  var a = fresh('owner'); var A = lk(a, 'LabA', '100'); var B = lk(a, 'LabB', '200'); trust(a, A); trust(a, B); var j = pjob(a, A);
  var s1 = call(function(cb){ a.kgAddStage(j.id, 'Making', A.id, cb); }).v, s2 = call(function(cb){ a.kgAddStage(j.id, 'Setting', B.id, cb); }).v;
  issueV(a, j, '10', '', s1.id, '999'); issueV(a, j, '10', '', s2.id, '999');
  receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}, s1.id); receiptV(a, j, {gross:'3', purity:'92', agreed:'92'}, s2.id);
  var goldA = a.kgAccount(A.id).gold.totalMg, goldB = a.kgAccount(B.id).gold.totalMg;
  a.saveToCloud = function(cb){ cb(new Error('network')); };
  ok(closeCarry(a, j).err, 'failed save reaches the caller'); eq(j.status, 'open'); eq((a.S.kgSalary || []).length, 0, 'both labour rows rolled back');
  a.saveToCloud = function(cb){ cb(null); };
  var id = op(); ok(!closeV(a, j, {settle:'carry', opId:id}).err); closeV(a, j, {settle:'carry', opId:id});
  var rows = labRows(a, j); eq(rows.length, 2, 'one row per receiving karigar, none doubled');
  var byK = {}; rows.forEach(function(x){ byK[x.karigarId] = x.amountPaise; }); eq(byK[A.id], 5 * 10000); eq(byK[B.id], 3 * 20000);
  eq(a.kgSalaryBalance(A.id).payable, 50000); eq(a.kgSalaryBalance(B.id).payable, 60000);
  eq(a.kgAccount(A.id).gold.totalMg, goldA, 'labour never changes his gold'); eq(a.kgAccount(B.id).gold.totalMg, goldB);
  ok(!call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:B.id, amountPaise:60000, mode:'cash', note:''}, cb); }).err);
  var info = a.kgReopenInfo(j.id); eq(info.labourPaise, 110000); eq(info.owesShopPaise, 60000, 'only B would owe the shop'); eq(info.needsConfirm, true);
  ok(call(function(cb){ a.kgReopenJob(j.id, cb, {}); }).err, 'warns before reversing paid labour');
  ok(!call(function(cb){ a.kgReopenJob(j.id, cb, {confirmed:true}); }).err); eq(labRows(a, j).length, 0); eq(a.kgSalaryBalance(A.id).payable, 0); eq(a.kgSalaryBalance(B.id).payable, -60000);
});

console.log('\nKarigar round 19 A - order cost, profile save rollback, key order, signs, creator id, detached save, salary privacy');

test('R19 A1: a cash stage needs a cost above zero (and at most 1e7); blank or 0 is refused with a clear message', function(){
  var a = fresh('owner');
  eq(typeof a.orderStageCostProblem, 'function');
  var st = function(c){ return {karigarId:'k1', karigarPayMode:'cash', karigarCost:c}; };
  ok(a.orderStageCostProblem(st(0)), 'zero'); ok(a.orderStageCostProblem(st(undefined)), 'blank'); ok(a.orderStageCostProblem(st(NaN)), 'NaN'); ok(a.orderStageCostProblem(st(-5)), 'negative'); ok(a.orderStageCostProblem(st(10000001)), 'too big');
  eq(a.orderStageCostProblem(st(500)), ''); eq(a.orderStageCostProblem(st(10000000)), ''); eq(a.orderStageCostProblem({karigarId:'k1', karigarPayMode:'wastage', karigarWastagePct:3}), '', 'a wastage stage needs no cash');
  eq(a.orderStageCostProblem({karigarId:'', karigarPayMode:'cash', karigarCost:0}), '', 'a row with no karigar is dropped on save, never blocks');
  ok(/cash/i.test(a.orderStageCostProblem(st(0))), a.orderStageCostProblem(st(0)));
});
test('R19 A2: a failed save of Details rolls the karigar back and says so; a good save says nothing', function(){
  var a = fresh('owner'); var k = a.addOrGetKarigar('Old Name'); k.phone = '9820012345'; k.skills = 'old skill'; k.note = 'old note';
  var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('net')); }; var out = null;
  eq(a.updateKarigarProfile(k.id, {name:'New Name', phone:'9820099999', skills:'x', note:'y'}, function(msg){ out = msg; }), '', 'the typed values are valid');
  ok(out && /not saved|could not save/i.test(out), 'told: ' + out); eq(k.name, 'Old Name'); eq(k.phone, '9820012345'); eq(k.skills, 'old skill'); eq(k.note, 'old note');
  a.saveToCloud = good; out = null; eq(a.updateKarigarProfile(k.id, {name:'New Name', phone:'', skills:'', note:''}, function(msg){ out = msg; }), ''); eq(out, ''); eq(k.name, 'New Name');
  var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3EditDetails(k.id); a.saveToCloud = function(cb){ cb(new Error('net')); }; var r = null; sheet.onSubmit({name:'Third', phone:'', skills:'', note:''}, function(err){ r = err || 'ok'; }); ok(r && r !== 'ok', 'the sheet shows the error'); eq(k.name, 'New Name');
});
test('R19 A3: a failed reopen keeps the job keys in their old order; signs use one glyph', function(){
  var a = fresh('owner'); var k = lk(a, 'Ord', '150'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err);
  var before = Object.keys(j).join(','); var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('net')); };
  ok(call(function(cb){ a.kgReopenJob(j.id, cb, {}); }).err); a.saveToCloud = good; eq(Object.keys(j).join(','), before, 'same key order'); eq(j.status, 'closed'); ok(j.earnings && j.earnings.labourPaise === 75000);
  eq(a.kgSigned(-500, a.kgFmtRs), '-₹5'); eq(a.kgSigned(500, a.kgFmtRs), '+₹5'); eq(a.kgSigned(-500, a.kgFmtG), '-' + a.kgFmtG(500)); eq(a.kgFmtRs(-500), '-₹5', 'one plain minus everywhere');
});
test('R19 A4: a manager may cancel an empty job only if THEY made it, matched by e-mail when there is one, not by display name', function(){
  var a = fresh('owner'); var k = pk(a, 'Who'); a.SAAS.user = {name:'Sam', email:'sam1@example.com', role:'manager'};
  var j = pjob(a, k); eq(j.createdWho, 'sam1@example.com');
  a.SAAS.user = {name:'Sam', email:'sam2@example.com', role:'manager'}; ok(call(function(cb){ a.kgCancelJob(j.id, 'not my job', cb); }).err, 'another Sam may not');
  a.SAAS.user = {name:'Sam', email:'SAM1@example.com', role:'manager'}; ok(!call(function(cb){ a.kgCancelJob(j.id, 'my own mistake', cb); }).err, 'the same account may (case-insensitive)');
  var old = pjob(a, k); delete old.createdWho; old.createdBy = 'Sam'; a.SAAS.user = {name:'Sam', email:'sam1@example.com', role:'manager'}; ok(!call(function(cb){ a.kgCancelJob(old.id, 'older job, same name', cb); }).err, 'a job from before this round falls back to the name');
});
test('R19 A12: a Save that finishes after its sheet is gone does not throw', function(){
  var e = sheetEnv(); var a = e.a; var done = null;
  a.kgForm({title:'T', fields:[{id:'amt', label:'Amount', type:'text', value:''}], onSubmit:function(v, fin){ done = fin; }});
  e.reg['kg2-save'].onclick(); var real = a.document.getElementById; a.document.getElementById = function(id){ return (id === 'kg2-err' || id === 'kg2-save') ? null : real.call(a.document, id); };
  var threw = null; try{ done(new Error('late')); done(null); }catch(x){ threw = x; } eq(threw, null, threw && threw.message);
});
test('R19 A13: a manager never sees a salary amount (Terms tab, profile line); the owner does', function(){
  var a = fresh('owner'); var s = pk(a, 'Salaried', 'salary');
  ok(/30,000/.test(a.kgAgreementText(a.kgAgreementFor(s.id, a.kgToday()))), 'owner sees it');
  a.SAAS.user.role = 'manager'; var t = a.kgAgreementText(a.kgAgreementFor(s.id, a.kgToday())); ok(!/30,000|monthly/.test(t), t); ok(/Salary/.test(t));
  ok(a.kg2KarigarsHtml().indexOf('30,000') === -1, 'Terms tab'); ok(a.kg3ProfileHtml(s.id).indexOf('30,000') === -1, 'profile'); ok(a.kg3RowsHtml().indexOf('30,000') === -1, 'list');
});

console.log('\nKarigar round 19 B - statement tiles, close sheet, receive sheet, job page, history, tab switch');
test('R19 B5: statement tiles never leave one alone; dates cannot push past the gutter', function(){
  var a = fresh('owner'); var k = pk(a, 'Tiles'); a._kg2.stFrom = '2000-01-01'; a._kg2.stTo = '2999-12-31';
  function shape(metal){ a._kg2.stMetal = metal; var h = a.kg3StatementHtml(k.id), tl = h.match(/class="kg2-kpi ?(wide)?"/g) || []; var wide = tl.filter(function(x){ return /wide/.test(x); }).length; return {n:tl.length, wide:wide}; }
  var g = shape('gold'); ok(g.n >= 3, 'tiles were counted: ' + g.n); eq((g.n - g.wide) % 2, 0, 'gold half tiles even'); var r = shape('rupees'); eq((r.n - r.wide) % 2, 0, 'rupees half tiles even');
  var list = a.kg3KpiHtml([['Opening', '0'], ['Given', '1'], ['Returned', '1'], ['Closing', '0']]); eq((list.match(/kg2-kpi wide/g) || []).length, 0, '2x2 when Closing makes it even');
  var five = a.kg3KpiHtml([['Opening', '0'], ['Given', '1'], ['Returned', '1'], ['Other', '1'], ['Closing', '0']]); eq((five.match(/kg2-kpi wide/g) || []).length, 1, 'Closing is the full last row');
  var css = readIndex(); ok(/\.kgx-dates > \*\{min-width:0;\}/.test(css) && /\.kgx-dates input\[type=date\]\{min-width:0;max-width:100%;\}/.test(css), 'date inputs may shrink'); ok(/@media \(max-width:360px\)\{\.kgx-dates\{grid-template-columns:1fr;\}\}/.test(css), 'dates stack on a very small phone');
});
test('R19 B6: the Close sheet summary is compact: one posted line, one small line, short choices, no tall header', function(){
  var a = fresh('owner'); var k = pk(a, 'Compact'); trust(a, k); var j = pjob(a, k); issueV(a, j, '10', '92'); var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3Close(j.id);
  var pv = sheet.preview({}); eq((pv.match(/class="kgx-lines"/g) || []).length, 1, 'one reconciliation block: ' + pv); eq((pv.match(/class="kgx-posted"/g) || []).length, 1, 'one posted line'); ok(/He returns to you/.test(pv) && /Given 9\.200 g/.test(pv));
  sheet.fields[0].options.forEach(function(o){ ok(String(o[2] || '').length <= 60, o[0] + ' description is one short line'); });
  var css = readIndex(); ok(/\.kgx-posted\{padding:8px 12px;\}/.test(css) && /\.kg2-prev:empty,\.kg2-err:empty\{display:none;\}/.test(css), 'compact box and no blank band');
});
test('R19 B7: Receive sheet - five essentials first, the rest under More details; job page buttons; pages share the profile look', function(){
  var a = fresh('owner'); var k = pk(a, 'Rcv'); var j = pjob(a, k); var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3Receive(j.id);
  var first = sheet.fields.filter(function(f){ return !f.more; }).map(function(f){ return f.id; }), more = sheet.fields.filter(function(f){ return f.more; }).map(function(f){ return f.id; });
  eq(sheet.doneToast, '\u2713 Receipt recorded', 'a real tick, not build-script text'); eq(first.join(','), 'stage,gross,chip,purity,confirmed,stone,piece'); eq(more.join(','), 'unit,stoneMode,agreed,qty,tag');
  var did = null; issueV(a, j, '30', '', '', '999'); sheet.onSubmit({stage:'', gross:'5', unit:'g', stone:'', stoneMode:'A', purity:'92', chip:false, agreed:'92', piece:'ring', qty:'1', tag:'', confirmed:true, opId:op()}, function(err){ did = err || 'ok'; }); eq(did, 'ok', did && did.message);
  var h = a.kg3JobHtml(j); a._kg2.more = ''; ok(/btn btn-sm btn-gold" onclick="kg3Issue/.test(h) && /btn btn-sm kgx-outline" onclick="kg3Receive/.test(h), 'Give metal filled, Receive outlined');
  var css = readIndex(); ok(/#kg2-root \.kg2-head > \.kg2-title\{font-size:28px/.test(css), 'Terms, Reports, Salary titles'); ok(/#kg2-root \.kg2-right\{flex-wrap:nowrap;\}/.test(css), 'Slip / Reverse stay in one line');
});
test('R19 B9/B10: the pay button is "Pay" (still named Record payment for screen readers); History shows jobs closed and the average days', function(){
  var a = fresh('owner'); var k = lk(a, 'Hist', ''); trust(a, k); var h = a.kg3ProfileHtml(k.id); ok(/aria-label="Record payment"[^>]*>Pay<\/button>/.test(h), 'short label'); ok(h.indexOf('History') === -1, 'no History block before a job closed');
  var j = pjob(a, k); issueV(a, j, '10', '92'); j.createdAt = '2026-11-01T10:00:00.000Z'; ok(!closeCarry(a, j).err); a.kgFindJob(j.id).closedAt = '2026-11-04T10:00:00.000Z';
  h = a.kg3ProfileHtml(k.id); ok(/1 job closed &middot; average 3 days/.test(h), h.slice(h.indexOf('History') - 30, h.indexOf('History') + 120));
});
test('R19 B11: leaving the Karigars tab hands back its history entries; coming back puts them back', function(){
  var e = sheetEnv(), a = e.a, st = 0, pend = []; a.history = {pushState:function(){ st++; }, back:function(){ pend.push(1); }, go:function(n){ pend.push(-n); }}; a.renderKgV2 = function(){};
  var k = pk(a, 'Tab'); a._kg2.seen = true; a.kg3Open(k.id); eq(st, 1); a.kgTabChanged('dashboard'); eq(pend.length, 1, 'the entry is handed back'); pend.shift(); st -= 1; a.kgPopHandler(); eq(st, 0);
  a.kgTabChanged('karigars'); eq(st, 1, 'back on the tab: the profile owns an entry again'); eq(a._kg2.view, 'profile');
});

console.log('\nKarigar round 20 - labour: job rate stays on the job karigar, payment cap, wording, frozen-only, rate cap, key order, metal in the row; managers see no rupees');

test('R20 1: a job-level labour rate belongs to the job karigar only; a stage karigar earns at his OWN frozen rate (K2 = 56000 paise), one without a rate earns nothing', function(){
  var a = fresh('owner'); var k1 = lk(a, 'K1', '150'), k2 = lk(a, 'K2', '80'), k3 = lk(a, 'K3', ''); trust(a, k1); trust(a, k2); trust(a, k3);
  var j = pjob(a, k1, {labourText:'180'}); var s2 = call(function(cb){ a.kgAddStage(j.id, 'Setting', k2.id, cb); }).v, s3 = call(function(cb){ a.kgAddStage(j.id, 'Polish', k3.id, cb); }).v;
  issueV(a, j, '30', '', '', '999');
  ok(!call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:s2.id, wt:'10', purity:'', chip:'999', confirmed:true, opId:op()}, cb); }).err);
  ok(!call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:s3.id, wt:'5', purity:'', chip:'999', confirmed:true, opId:op()}, cb); }).err);
  receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); receiptV(a, j, {gross:'7', purity:'92', agreed:'92'}, s2.id); receiptV(a, j, {gross:'3', purity:'92', agreed:'92'}, s3.id);
  var c = closeCarry(a, j); ok(!c.err, c.err && c.err.message);
  var rows = labRows(a, j), by = {}; rows.forEach(function(x){ by[x.karigarId] = x.amountPaise; });
  eq(by[k1.id], 5 * 18000, 'the job karigar uses the job rate'); eq(by[k2.id], 56000, 'K2 uses his own Rs 80'); eq(by[k3.id], undefined, 'K3 has no rate: no row'); eq(rows.length, 2);
  var live = a.kgLiveTerms(j, k2.id); eq(live.labourPg, 8000, 'live terms of a stage karigar ignore the job rate too');
});
test('R20 2: a rupee PAYMENT above what he is owed is refused (exact paise) and points to Give advance', function(){
  var a = fresh('owner'); var k = lk(a, 'Cap', '41.36'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'1', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err); eq(a.kgSalaryBalance(k.id).payable, 4136);
  function pay(p){ return call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:p, mode:'cash', note:''}, cb); }); }
  var big = pay(99999999); ok(big.err && /Give advance/.test(big.err.message), big.err && big.err.message); eq(a.kgSalaryBalance(k.id).payable, 4136, 'nothing recorded');
  ok(pay(4137).err, 'one paisa over'); ok(!pay(4136).err, 'exactly what is owed'); eq(a.kgSalaryBalance(k.id).payable, 0);
  var none = pay(1); ok(none.err && /nothing|Give advance/i.test(none.err.message), 'nothing owed: refused');
  ok(!call(function(cb){ a.kgAddSalary({type:'ADVANCE', opId:op(), karigarId:k.id, amountPaise:50000, mode:'cash', note:'advance for next work'}, cb); }).err, 'an advance is the way to give money before the work');
});
test('R20 3: the reopen warning says what really drew the balance down (paid, deducted, advanced)', function(){
  var a = fresh('owner'); var k = lk(a, 'Word', '100'); var j = labJob(a, k, '', '10'); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'});
  ok(!closeV(a, j, {settle:'loss-cash', reason:'making loss billed', billText:'120', opId:op()}).err);
  var r = call(function(cb){ a.kgReopenJob(j.id, cb, {}); }); ok(r.err && /deducted/i.test(r.err.message) && !/already paid/.test(r.err.message), r.err && r.err.message);
  var b = fresh('owner'); var k2 = lk(b, 'Adv', '100'); trust(b, k2); var j2 = labJob(b, k2); receiptV(b, j2, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(b, j2).err);
  ok(!call(function(cb){ b.kgAddSalary({type:'ADVANCE', opId:op(), karigarId:k2.id, amountPaise:60000, mode:'cash', note:'advance later'}, cb); }).err);
  var r2 = call(function(cb){ b.kgReopenJob(j2.id, cb, {}); }); ok(r2.err && /advanced/i.test(r2.err.message) && !/already paid/.test(r2.err.message), r2.err && r2.err.message);
  var c = fresh('owner'); var k3 = lk(c, 'Pd', '100'); trust(c, k3); var j3 = labJob(c, k3); receiptV(c, j3, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(c, j3).err);
  ok(!call(function(cb){ c.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k3.id, amountPaise:50000, mode:'cash', note:''}, cb); }).err);
  var r3 = call(function(cb){ c.kgReopenJob(j3.id, cb, {}); }); ok(r3.err && /already paid/.test(r3.err.message), r3.err && r3.err.message);
});
test('R20 4: a job with no frozen terms entry earns no labour, even if the karigar has a rate today', function(){
  var a = fresh('owner'); var k = lk(a, 'Nofr', '150'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); delete j.terms;
  ok(!closeCarry(a, j).err); eq(labRows(a, j).length, 0, 'no frozen entry, no labour'); eq(a.kgSalaryBalance(k.id).payable, 0);
});
test('R20 5: the labour rate is capped at Rs 10,000 per gram, on terms, add karigar and job', function(){
  var a = fresh('owner'); var k = a.addOrGetKarigar('Capr');
  ok(call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4', labourRate:'10001', labourBase:'net'}, cb); }).err, 'terms over the cap');
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4', labourRate:'10000', labourBase:'net'}, cb); }).err, 'the cap itself is fine');
  ok(call(function(cb){ a.kgCreateJob({karigarId:k.id, title:'x', model:'points', labourText:'10001'}, op(), cb); }).err, 'job over the cap');
  ok(call(function(cb){ a.kgAddKarigar({name:'Over Cap', kind:'wastage', points:'4', labour:'99999', opId:op()}, cb); }).err, 'add karigar over the cap');
  var big = a.kgParseAgreementTerms({kind:'wastage', points:'4', labourRate:'10000', labourBase:'net'}); eq(big.labour.perGramPaise, 1000000); ok(1000000 * 999999999 < 9007199254740991, 'rate x the largest weight stays a safe integer');
});
test('R20 6: a failed terms change leaves the karigar record with the same content AND key order', function(){
  var a = fresh('owner'); var k = lk(a, 'Ordr', '', 'salary'); var before = JSON.stringify(k); var good = a.saveToCloud; a.saveToCloud = function(cb){ cb(new Error('net')); };
  ok(call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4', labourRate:'120', labourBase:'net'}, cb); }).err); a.saveToCloud = good; eq(JSON.stringify(k), before);
  var w = lk(a, 'Ordw', '90'); var bw = JSON.stringify(w); a.saveToCloud = function(cb){ cb(new Error('net')); };
  ok(call(function(cb){ a.kgSetTerms(w.id, {kind:'salary', salaryMode:'monthly', rate:'30000'}, cb); }).err); a.saveToCloud = good; eq(JSON.stringify(w), bw);
});
test('R20 7: the labour row names the metal ("Job labour, silver"); silver keeps earning at the per-gram rate (unchanged behaviour)', function(){
  var a = fresh('owner'); var k = lk(a, 'Sil', '100'); trust(a, k, '', '1000'); var j = pjob(a, k, {metal:'silver'}); issueV(a, j, '100', '', '', '999');
  receiptV(a, j, {gross:'100', purity:'92.5', agreed:'92.5'}); var c = closeV(a, j, {settle:'carry', opId:op()}); ok(!c.err, c.err && c.err.message);
  var row = labRows(a, j)[0]; ok(row, 'a labour row exists'); eq(row.amountPaise, 1000000, '100 g silver at Rs 100 = Rs 10,000, as before'); eq(a.kgEntryWords(row, null), 'Job labour, silver');
  var g = fresh('owner'); var k2 = lk(g, 'Gld', '150'); trust(g, k2); var jg = labJob(g, k2); receiptV(g, jg, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(g, jg).err); eq(g.kgEntryWords(labRows(g, jg)[0], null), 'Job labour, gold');
  eq(a.kgEntryWords({type:'JOB_LABOUR'}, null), 'Job labour', 'a row with no job keeps the plain words');
});
test('R20 8: a manager sees no rupee amount anywhere (list, profile, statement screen and text, Terms tab, data helpers); the owner still does', function(){
  var a = fresh('owner'); var k = lk(a, 'Mgr', '150'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err);
  ok(!call(function(cb){ a.kgAddRupeeOpening({karigarId:k.id, dir:'owe', amountText:'1200', note:'old khata', opId:op()}, cb); }).err);
  orderStage(a, k, 800); ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '5000', 'adv', op(), cb, {advance:true, reason:'festival advance', confirmed:true, mode:'UPI', dbPost:true}); }).err);
  a._kg2.stFrom = '2000-01-01'; a._kg2.stTo = '2999-12-31';
  function all(){ var out = []; ['gold', 'rupees'].forEach(function(m){ a._kg2.stMetal = m; out.push(a.kg3StatementHtml(k.id)); out.push(a.kg3StatementText(k.id, m, '2000-01-01', '2999-12-31')); }); out.push(a.kg3ProfileHtml(k.id)); out.push(a.kg3RowsHtml()); out.push(a.kg3PeopleHtml()); out.push(a.kg2KarigarsHtml()); return out.join('\n'); }
  var own = all(); ok(/₹/.test(own), 'the owner sees rupees'); ok(/Job labour/.test(own) && /owe/.test(own));
  a.SAAS.user = {name:'Mgr', email:'m@example.com', role:'manager'}; var mg = all(); ok(!/₹/.test(mg), 'no rupee sign for a manager: ' + (mg.match(/.{30}₹.{20}/) || [''])[0]);
  ok(!/\bowes?\b|he owes the shop|you owe/i.test(mg.replace(/<[^>]*>/g, ' ').replace(/\bowes\b[^.]*gold/ig, '')), 'no owes text: ' + (mg.match(/.{20}owe.{20}/i) || [''])[0]);
  eq(a.kgAccount(k.id).rupees.payablePaise, 0, 'kgAccount gives a manager no rupee total'); eq(a.kg3StatementData(k.id, 'rupees', '2000-01-01', '2999-12-31').rows.length, 0, 'nor rupee rows');
  var x = a.kg3RupeeExtra(k.id, 'gold', '2000-01-01', '2999-12-31'); eq(x.led, null); eq(x.ord, null);
  ok(a.kg3StatementHtml(k.id).indexOf('value="rupees"') === -1, 'no Rupees choice in the statement');
  ok(a.kg3ProfileHtml(k.id).indexOf('Fine gold with him') !== -1 && a.kg3RowsHtml().indexOf('gold') !== -1, 'gold and silver stay');
  a.SAAS.user = {name:'Owner', email:'o@example.com', role:'owner'}; ok(/₹/.test(all()), 'owner unchanged');
});
test('R20 fuzz: job karigar + two stage karigars (one with no rate), random receipts / closes / reopens / payments incl. over-payment attempts; every rupee balance is exact, no payment ever exceeds what was owed, stage rates never take the job rate, and a manager reads zero', function(){
  var a = fresh('owner'); var A = lk(a, 'FzA', '100'), B = lk(a, 'FzB', '80'), C = lk(a, 'FzC', ''); [A, B, C].forEach(function(k){ trust(a, k); }); var seed = 24680135;
  function rnd(n){ seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }
  var jobs = [], per = {}; per[A.id] = 18000; per[B.id] = 8000; per[C.id] = 0;
  function mkJob(){
    var j = pjob(a, A, {labourText:'180'}); var sb = call(function(cb){ a.kgAddStage(j.id, 'Set', B.id, cb); }).v, sc = call(function(cb){ a.kgAddStage(j.id, 'Pol', C.id, cb); }).v;
    issueV(a, j, '300', '', '', '999');
    [sb, sc].forEach(function(st){ ok(!call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:st.id, wt:'100', purity:'', chip:'999', confirmed:true, opId:op()}, cb); }).err); });
    j.fzStages = [ '', sb.id, sc.id ]; jobs.push(j); return j;
  }
  function exact(k){ var t = 0, rev = {}; a.S.kgSalary.forEach(function(x){ if(x.type === 'REVERSAL') rev[x.reversesId] = true; }); a.S.kgSalary.forEach(function(x){ if(x.karigarId !== k.id || x.type === 'REVERSAL' || rev[x.id]) return; if(x.type === 'JOB_LABOUR') t += x.amountPaise; else t -= x.amountPaise; }); return t; }
  function indep(k){ var t = 0, idx = a.kgIndex(a.S.kgLedger); a.S.kgJobs.forEach(function(j){ if(j.status !== 'closed') return; a.S.kgLedger.forEach(function(e){ if(e.jobId === j.id && e.type === 'RECEIPT' && !idx.reversed[e.id] && (e.karigarId || j.karigarId) === k.id) t += Math.round(per[k.id] * e.mg / 1000); }); }); return t; }
  function pay(k, p){ return call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:p, mode:'cash', note:''}, cb); }); }
  var refused = 0, paid = 0;
  for(var i = 0; i < 150; i++){
    var o = rnd(7), open = jobs.filter(function(j){ return j.status === 'open'; }), closed = jobs.filter(function(j){ return j.status === 'closed'; });
    if(o === 0 || !open.length) mkJob();
    else if(o <= 2){ var oj = open[rnd(open.length)]; var st = oj.fzStages[rnd(3)]; var w = ((1 + rnd(400)) / 1000 * (1 + rnd(4))).toFixed(3); var b = a.kgBuildReceipt(oj.id, st, {gross:w, purity:'92', agreed:'92', piece:'p', qty:'1', confirmed:true, opId:op()}); if(b.entry) call(function(cb){ a.kgAddEntry(b.entry, cb); }); }
    else if(o === 3) closeCarry(a, open[rnd(open.length)]);
    else if(o === 4 && closed.length) call(function(cb){ a.kgReopenJob(closed[rnd(closed.length)].id, cb, {confirmed:true}); });
    else { var k = [A, B, C][rnd(3)], owed = a.kgSalaryBalance(k.id).payable, before = a.S.kgSalary.length;
      var over = pay(k, Math.max(owed, 0) + 1 + rnd(5000)); ok(over.err, 'over-payment refused, step ' + i); eq(a.S.kgSalary.length, before, 'nothing recorded by a refused payment'); refused++;
      if(owed > 0){ ok(!pay(k, 1 + rnd(owed)).err, 'a payment within what is owed goes through'); ok(a.kgSalaryBalance(k.id).payable >= 0, 'a payment never takes the balance below zero'); paid++; } }
    [A, B, C].forEach(function(k){ eq(a.kgSalaryBalance(k.id).payable, exact(k), 'balance = rows, ' + k.name + ' step ' + i); eq(labRows(a).filter(function(x){ return x.karigarId === k.id; }).reduce(function(s, x){ return s + x.amountPaise; }, 0), indep(k), 'labour = own-rate recomputation, ' + k.name + ' step ' + i); });
    eq(labRows(a).filter(function(x){ return x.karigarId === C.id; }).length, 0, 'the rate-less stage karigar never earns');
  }
  ok(refused > 5 && paid > 0 && labRows(a).length > 3, 'the run did real work: refused ' + refused + ', paid ' + paid + ', labour rows ' + labRows(a).length);
  a.SAAS.user = {name:'Mgr', email:'m@example.com', role:'manager'}; [A, B, C].forEach(function(k){ eq(a.kgAccount(k.id).rupees.payablePaise, 0, 'manager sees no total for ' + k.name); });
  a.SAAS.user = {name:'Owner', email:'o@example.com', role:'owner'};
});

console.log('\nKarigar round 21 - managers and staff see no rupee leaks (audit, Day Book, legacy job page, backup, helpers, sheets); reopen wording; in-flight duplicates');

var AMT = /(₹|Rs\.?)\s?-?\d/;
function money(a){   // an owner builds a shop with every kind of karigar money
  var k = lk(a, 'Leaky', '150'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'8', purity:'92', agreed:'92'}); ok(!closeCarry(a, j).err);
  ok(!call(function(cb){ a.kgSetTerms(k.id, {kind:'wastage', points:'4', labourRate:'150', labourBase:'net'}, cb); }).err);
  ok(!call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k.id, amountPaise:10000, mode:'cash', note:''}, cb); }).err);
  ok(!call(function(cb){ a.kgAddSalary({type:'ADVANCE', opId:op(), karigarId:k.id, amountPaise:250000, mode:'cash', note:'advance for diwali'}, cb); }).err);
  var s = lk(a, 'Salaried', '', 'salary');
  orderStage(a, k, 2000); ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '500', 'adv', op(), cb, {advance:true, reason:'festival advance', confirmed:true, mode:'UPI', dbPost:true}); }).err);
  ok(!call(function(cb){ a.kg3PayOrderSave(k.id, 'cash', '300', 'part', op(), cb, {mode:'cash', dbPost:true}); }).err);
  return {k:k, s:s, j:j};
}
test('R21 A1: the Audit Trail shows a manager the action only, never an amount, a rate or a salary; the owner still sees all', function(){
  var a = fresh('owner'); var m = money(a); var el = function(){ return a._els['audit-log-list'].innerHTML; };
  a.renderAuditLog(); var own = el(); ok(AMT.test(own), 'the owner sees amounts'); ok(/labour/i.test(own));
  a.SAAS.user = {name:'Mgr', email:'m@example.com', role:'manager'};
  a._els['audit-log-list'].innerHTML = ''; a.renderAuditLog(); ok(el() === '', 'R26: a manager cannot open the audit trail at all');
  var mg = a.S.auditLog.map(function(e){ return a.auditNoteFor(e); }).join(' | ');   // the strip rule still holds if a note ever reaches a manager
  ok(!AMT.test(mg), 'no amount for a manager: ' + (mg.match(/.{30}(₹|Rs)\s?\d.{20}/) || [''])[0]); ok(!/\/g on net/.test(mg) && !/monthly/i.test(mg), 'no rate, no salary terms');
  ok(/Labour posted/.test(mg) && /Salary payment/.test(mg) && /Advance given/.test(mg), 'the action words stay');
  ok(!/title="[^"]*(₹|Rs)\s?\d/.test(mg), 'and not in the title attribute');
  a.SAAS.user = {name:'Staff', role:'staff'}; a._els['audit-log-list'].innerHTML = ''; a.renderAuditLog(); ok(el() === '', 'staff too');
});
test('R21 A1b: any other karigar audit note has its rupee amounts stripped for a manager (the fallback really matches)', function(){
  var a = fresh('owner'); a.S.auditLog = [{id:'x1', action:'kg_loss', entity:'kgJob', entityId:'j1', user:'Own', role:'owner', ts:new Date().toISOString(), note:'Loss bill KJ-0001 " + "\u20b91,400.50 and -\u20b9250 for ring Rs 5'}];
  a.SAAS.user = {name:'Mgr', role:'manager'}; var h = a.S.auditLog.map(function(e){ return a.auditNoteFor(e); }).join(' | '); ok(!AMT.test(h), h); ok(/Loss bill KJ-0001/.test(h) && /for ring/.test(h), 'the words stay: ' + h);
  a.SAAS.user = {name:'Own', role:'owner'}; a.renderAuditLog(); ok(/\u20b91,400\.50/.test(a._els['audit-log-list'].innerHTML), 'owner sees it');
});
test('R21 A2: the Day Book keeps the amount but a manager or staff does not see the karigar NAME on salary and advance lines', function(){
  var a = fresh('owner'); var m = money(a); var d = a.kgToday();
  function labels(){ return a.dbAutoLines(d).filter(function(l){ return l.src === 'karigar'; }); }
  var own = labels(); ok(own.length >= 3, 'lines exist: ' + own.length); ok(own.some(function(l){ return /Karigar salary - Leaky/.test(l.label); }), 'owner: salary line has the name'); ok(own.some(function(l){ return /Karigar advance - Leaky/.test(l.label); }), 'owner: advance names him');
  ['manager', 'staff'].forEach(function(role){
    a.SAAS.user = {name:'X', email:'x@example.com', role:role}; var l = labels();
    var sal = l.filter(function(x){ return x.cat === 'karigar-salary'; })[0], adv = l.filter(function(x){ return /advance/i.test(x.label); });
    eq(sal.label, 'Karigar salary', role); eq(sal.amount, 100, 'the amount stays for the cash tally'); ok(adv.length >= 1 && adv.every(function(x){ return !/Leaky/.test(x.label) && x.amount > 0; }), role + ' advance lines have no name');
    var pay = l.filter(function(x){ return x.cat === 'karigar-payment' && !/advance/i.test(x.label); }); ok(pay.length === 1 && /Karigar payment - Leaky/.test(pay[0].label), role + ': order payment lines keep today\'s text');
  });
});
test('R21 A3: the legacy closed-job page hides the labour rupees from a manager', function(){
  var a = fresh('owner'); var k = wastageKarigar(a, 'Leg', {kind:'wastage', wastagePct:'4', labourRate:'9.6', labourBase:'net'});
  var j = job(a, k); metal(a, j, 'ISSUE', 100000, '999'); receipt(a, j, 100000, 'other', {pct:'96'}); ok(!call(function(cb){ a.kgCloseJob(j.id, cb); }).err);
  ok(/labour ₹/.test(a.kg2JobHtml(j)), 'owner sees it'); a.SAAS.user = {name:'Mgr', role:'manager'}; var h = a.kg2JobHtml(j); ok(!AMT.test(h), 'manager: ' + (h.match(/.{20}labour.{30}/) || [''])[0]);
});
test('R21 A4: the JSON backup is owner-only: the button is hidden and the function refuses', function(){
  var a = fresh('owner'); var made = 0, said = ''; a.toast = function(m){ said = m; }; var real = a.document.createElement; a.document.createElement = function(t){ made++; return real.call(a.document, t); };
  a.SAAS.user = {name:'Mgr', role:'manager'}; a.exportFullBackup(); ok(/owner/i.test(said), said); eq(made, 0, 'nothing was built or downloaded'); a.SAAS.user = {name:'Staff', role:'staff'}; said = ''; a.exportFullBackup(); ok(/owner/i.test(said));
  ok(typeof a.applyBackupButtonRole === 'function'); var btn = a.document.getElementById('btn-json-backup'); btn.style.display = '';
  a.SAAS.user = {name:'Mgr', role:'manager'}; a.applyBackupButtonRole(); eq(btn.style.display, 'none'); a.SAAS.user = {name:'Own', role:'owner'}; a.applyBackupButtonRole(); eq(btn.style.display, '');
});
test('R21 A5: helpers and sheet openers give a manager no rupee data and open nothing', function(){
  var a = fresh('owner'); var m = money(a); var k = m.k; var asOwner = {
    bal:a.kgSalaryBalance(k.id).payable, cash:a.kgOrderWork(k.id).owed.cash, owedCash:a.karigarOwed(k.id).cash, rows:a.kgRupeeStatementRange(k.id, '2000-01-01', '2999-12-31').rows.length, pay:a.kgOrderPayRows(k.id, '2000-01-01', '2999-12-31').rows.length, chk:a.kg3PayOrderCheck(k.id, 'cash', '10', true), prev:a.kg3PayOrderPreviewText(k.id, 'cash', '10', true)};
  ok(asOwner.bal !== 0 && asOwner.cash !== 0 && asOwner.owedCash !== 0 && asOwner.rows > 0 && asOwner.pay > 0 && asOwner.chk.amount === 10 && asOwner.prev.length > 0, 'the owner gets real numbers: ' + JSON.stringify(asOwner));
  a.SAAS.user = {name:'Mgr', role:'manager'};
  eq(a.kgSalaryBalance(k.id).payable, 0); eq(a.kgSalaryBalance(k.id).accrued, 0); eq(a.kgRupeeStatementRange(k.id, '2000-01-01', '2999-12-31').rows.length, 0); eq(a.kgRupeeStatementRange(k.id, '2000-01-01', '2999-12-31').closingPaise, 0);
  eq(a.kgOrderWork(k.id).owed.cash, 0); eq(a.karigarOwed(k.id).cash, 0); var pr = a.kgOrderPayRows(k.id, '2000-01-01', '2999-12-31'); eq(pr.rows.length, 0); eq(pr.opening, 0);
  eq(a.kgReopenInfo(m.j.id).labourPaise, 0); eq(a.kgReopenInfo(m.j.id).needsConfirm, false); eq(a.kg3PayOrderPreviewText(k.id, 'cash', '10', true), ''); ok(a.kg3PayOrderCheck(k.id, 'cash', '10', true).error, 'no amount for a manager');
  var opened = 0, said = ''; a.kgForm = function(){ opened++; }; a.toast = function(t){ said = t; };
  [['kg2Terms', [k.id]], ['kg2Reopen', [m.j.id]], ['kg3PayOrder', [k.id]], ['kg3PayOrder', [k.id, 'advance']], ['kg2Money', [k.id, 'PAYMENT']], ['kg2Accrue', [m.s.id]], ['kg3RupeeOpening', [k.id]], ['kg3PayOrderReverseSheet', ['x']]].forEach(function(c){ said = ''; a[c[0]].apply(a, c[1]); ok(/owner/i.test(said), c[0] + ' says owner only: ' + said); });
  eq(opened, 0, 'no sheet opened for a manager');
  ok(a.kg3ProfileHtml(k.id).indexOf('Fine gold with him') !== -1, 'gold and job screens still work for a manager'); var s2 = null; a.kgForm = function(o){ s2 = o; }; a.kg3NewJob(k.id); ok(s2 && s2.title === 'New job', 'a manager can still start a job');
  a.SAAS.user = {name:'Own', role:'owner'}; a.kgForm = function(o){ s2 = o; }; s2 = null; a.kg2Terms(k.id); ok(s2, 'the owner still opens Terms');
});
test('R21 A6: a manager reading every reachable screen, its attributes, share text and exports finds no rupee amount; the owner finds them', function(){
  var a = fresh('owner'); var m = money(a); var k = m.k; a._kg2.stFrom = '2000-01-01'; a._kg2.stTo = '2999-12-31';
  function sweep(){
    var out = [], sheets = []; var keep = a.kgForm; a.kgForm = function(o){ sheets.push(o); };
    ['gold', 'silver', 'rupees'].forEach(function(mt){ a._kg2.stMetal = mt; out.push(a.kg3StatementHtml(k.id)); out.push(a.kg3StatementText(k.id, mt, '2000-01-01', '2999-12-31')); });
    out.push(a.kg3PeopleHtml(), a.kg3RowsHtml(), a.kg3ProfileHtml(k.id), a.kg3JobHtml(m.j), a.kg2KarigarsHtml(), a.kg2ReportsHtml(), a.kg2SalaryHtml(), a.kg3SlipText ? 'x' : '', a.kg2TodayHtml(), a.kg2JobsHtml(), a.kg2KhataHtml());
    a._kg2.more = 'p:' + k.id; out.push(a.kg3ProfileHtml(k.id)); a._kg2.more = '';
    a.kg3NewJob(k.id); a.kg3Close(m.j.id); a.kg3Receive(m.j.id); a.kg3Issue(m.j.id); a.kg3Scrap(m.j.id); a.kg3AddKarigar(); a.kg3EditDetails(k.id); a.kg3Count(k.id); a.kg3Carry(k.id);
    sheets.forEach(function(o){ out.push(o.title, o.submitLabel || '', o.preview ? o.preview({}) : '', o.preview ? o.preview({wt:'10', purity:'92', metal:'gold22'}) : ''); (o.fields || []).forEach(function(f){ out.push(f.label || '', f.hint || '', f.html || '', String(f.value || ''), (f.options || []).map(function(x){ return x.join(' '); }).join(' ')); }); });
    a.kgForm = keep; out.push(a.S.auditLog.map(function(e){ return a.auditNoteFor(e); }).join('\n'));
    a.dbAutoLines(a.kgToday()).forEach(function(l){ if(l.src === 'karigar') out.push(l.label); });
    return out.join('\n');
  }
  var own = sweep(); ok(AMT.test(own), 'the owner sees amounts');
  a.SAAS.user = {name:'Mgr', email:'m@example.com', role:'manager'}; var mg = sweep();
  var leak = (mg.match(/.{40}(₹|Rs\.?)\s?-?\d.{20}/) || [''])[0]; ok(!AMT.test(mg.replace(/Rs 10,000/g, '')), 'no rupee amount anywhere for a manager: ' + leak);
  ok(!/owes the shop|you owe/i.test(mg), 'no owes text');
});
test('R21 B7: the reopen warning names the paying karigar\'s own labour, and a loss bill is called a bill', function(){
  var a = fresh('owner'); var k1 = lk(a, 'R1', '150'), k2 = lk(a, 'R2', '80'); trust(a, k1); trust(a, k2);
  var j = labJob(a, k1); var s2 = call(function(cb){ a.kgAddStage(j.id, 'Setting', k2.id, cb); }).v;
  ok(!call(function(cb){ a.kgTransfer({jobId:j.id, fromStageId:'', toStageId:s2.id, wt:'10', purity:'', chip:'999', confirmed:true, opId:op()}, cb); }).err);
  receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); receiptV(a, j, {gross:'7', purity:'92', agreed:'92'}, s2.id); ok(!closeCarry(a, j).err);
  ok(!call(function(cb){ a.kgAddSalary({type:'PAYMENT', opId:op(), karigarId:k2.id, amountPaise:56000, mode:'cash', note:''}, cb); }).err);
  var r = call(function(cb){ a.kgReopenJob(j.id, cb, {}); }); ok(r.err, 'warned'); ok(/₹560/.test(r.err.message) && !/₹1,310/.test(r.err.message), r.err.message); ok(/R2/.test(r.err.message), 'says which karigar');
  var b = fresh('owner'); var k = lk(b, 'Bill', '100'); var jb = labJob(b, k, '', '10'); receiptV(b, jb, {gross:'5', purity:'92', agreed:'92'}); ok(!closeV(b, jb, {settle:'loss-cash', reason:'making loss billed', billText:'1400', opId:op()}).err);
  var r2 = call(function(cb){ b.kgReopenJob(jb.id, cb, {}); }); ok(r2.err && /₹1,400 deducted by loss bill/.test(r2.err.message), r2.err && r2.err.message);
});
test('R21 B8: a second call with the same opId while the first save is in flight waits and hears the first call\'s real result (salary, close, terms, entries)', function(){
  function twice(a, run1, run2){ var pending = []; var good = a.saveToCloud; a.saveToCloud = function(cb){ pending.push(cb); }; var r1 = {}, r2 = {}; run1(function(e){ r1.e = e; r1.done = true; }); run2(function(e){ r2.e = e; r2.done = true; }); a.saveToCloud = good; return {pending:pending, r1:r1, r2:r2}; }
  var a = fresh('owner'); var k = lk(a, 'Fl', '100'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'});
  var sid = op(), t = twice(a, function(d){ a.kgAddSalary({type:'ADVANCE', opId:sid, karigarId:k.id, amountPaise:5000, mode:'cash', note:'advance first'}, d); }, function(d){ a.kgAddSalary({type:'ADVANCE', opId:sid, karigarId:k.id, amountPaise:5000, mode:'cash', note:'advance first'}, d); });
  eq(!!t.r2.done, false, 'salary: the second waits'); eq(t.pending.length, 1); t.pending[0](new Error('net')); ok(t.r1.e && t.r2.e, 'salary: both told it failed'); eq(a.S.kgSalary.length, 0);
  var cid = op(), c = twice(a, function(d){ a.kgCloseJob(j.id, function(e){ d(e); }, {settle:'carry', opId:cid}); }, function(d){ a.kgCloseJob(j.id, function(e){ d(e); }, {settle:'carry', opId:cid}); });
  eq(!!c.r2.done, false, 'close: the second waits'); c.pending[0](new Error('net')); ok(c.r1.e && c.r2.e, 'close: both told it failed'); eq(a.kgFindJob(j.id).status, 'open'); eq(labRows(a, j).length, 0);
  var gid = op(), g = twice(a, function(d){ a.kgAddAgreement(k.id, {kind:'wastage', points:'4', labourRate:'120', labourBase:'net'}, a.kgToday(), gid, d); }, function(d){ a.kgAddAgreement(k.id, {kind:'wastage', points:'4', labourRate:'120', labourBase:'net'}, a.kgToday(), gid, d); });
  eq(!!g.r2.done, false, 'terms: the second waits'); g.pending[0](new Error('net')); ok(g.r1.e && g.r2.e, 'terms: both told it failed');
  var j2 = pjob(a, k); var eid = op(), mk = function(){ return a.kgBuildIssue(j2.id, '', {wt:'5', chip:'999', opId:eid}).entry; };
  var en = twice(a, function(d){ a.kgAddEntries([mk()], d); }, function(d){ a.kgAddEntries([mk()], d); });
  eq(!!en.r2.done, false, 'entries: the second waits'); en.pending[0](new Error('net')); ok(en.r1.e && en.r2.e, 'entries: both told it failed'); eq(a.S.kgLedger.filter(function(x){ return x.jobId === j2.id; }).length, 0);
  var ok1 = twice(a, function(d){ a.kgAddSalary({type:'ADVANCE', opId:op(), karigarId:k.id, amountPaise:1000, mode:'cash', note:'advance ok'}, d); }, function(d){ d(null); }); ok1.pending[0](null); ok(ok1.r1.done && !ok1.r1.e, 'a good first save still reports success');
});
test('R21 B9: a manager doing gold issue / receipt / close inside a random run gets exactly the owner\'s gold ledger and labour rows; the rupee gates never block gold work', function(){
  function run(role){
    var a = fresh('owner'); var A = lk(a, 'MgA', '100'), B = lk(a, 'MgB', '60'); trust(a, A); trust(a, B); var seed = 13579246;
    function rnd(n){ seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; }
    a.SAAS.user = {name:'X', email:'x@example.com', role:role}; var jobs = [], errs = 0;
    for(var i = 0; i < 80; i++){
      var o = rnd(5), open = jobs.filter(function(j){ return a.kgFindJob(j.id).status === 'open'; });
      if(o === 0 || !open.length){ var j = pjob(a, rnd(2) ? A : B); issueV(a, j, '200', '', '', '999'); jobs.push(j); }
      else if(o <= 2){ var oj = open[rnd(open.length)]; var b = a.kgBuildReceipt(oj.id, '', {gross:((1 + rnd(300)) / 1000 * 3).toFixed(3), purity:'92', agreed:'92', piece:'p', qty:'1', confirmed:true, opId:'mg-' + role + i}); if(b.entry){ var r = call(function(cb){ a.kgAddEntry(b.entry, cb); }); if(r.err) errs++; } }
      else if(o === 3){ var r2 = closeCarry(a, open[rnd(open.length)]); if(r2.err) errs++; }
      else { var b2 = a.kgBuildIssue(open[rnd(open.length)].id, '', {wt:'5', chip:'999', confirmed:true, opId:'mi-' + role + i}); if(b2.entry){ var r3 = call(function(cb){ a.kgAddEntry(b2.entry, cb); }); if(r3.err) errs++; } }
    }
    a.SAAS.user = {name:'Own', email:'o@example.com', role:'owner'};
    return {errs:errs, gold:a.S.kgLedger.map(function(e){ return e.type + ':' + e.mg + ':' + (e.jobId ? a.S.kgJobs.map(function(x){ return x.id; }).indexOf(e.jobId) : ''); }).join('|'), closed:a.S.kgJobs.filter(function(j){ return j.status === 'closed'; }).length, lab:labRows(a).map(function(x){ return x.amountPaise; }).join('|')};
  }
  var o = run('owner'), m = run('manager');
  ok(o.closed > 2 && o.gold.length > 50, 'the run did real work: closed ' + o.closed);
  eq(m.errs, 0, 'the manager hit no error on gold work'); eq(m.closed, o.closed, 'same jobs closed'); eq(m.gold, o.gold, 'same gold ledger'); eq(m.lab, o.lab, 'same labour rows posted for the owner to see');
});
test('R21 B10: a throw inside the save of kgAddSalary / kgCloseJob / kgAddEntry reports the error and leaves the op id free, so a retry with the same id works', function(){
  var a = fresh('owner'); var k = lk(a, 'Th', '100'); trust(a, k); var j = labJob(a, k); receiptV(a, j, {gross:'5', purity:'92', agreed:'92'}); var good = a.saveToCloud;
  function boom(){ a.saveToCloud = function(){ throw new Error('boom'); }; }
  var sid = op(), sal = {type:'ADVANCE', opId:sid, karigarId:k.id, amountPaise:5000, mode:'cash', note:'advance after boom'};
  boom(); var r1 = call(function(cb){ a.kgAddSalary(sal, cb); }); ok(r1.err && /boom/.test(r1.err.message), 'salary: throw reported'); a.saveToCloud = good;
  var r2 = call(function(cb){ a.kgAddSalary(sal, cb); }); ok(!r2.err, 'salary: retry runs, not stuck busy'); eq(a.S.kgSalary.filter(function(x){ return x.type === 'ADVANCE'; }).length, 1, 'recorded once');
  var cid = op(); boom(); var c1 = call(function(cb){ a.kgCloseJob(j.id, cb, {settle:'carry', opId:cid}); }); ok(c1.err, 'close: throw reported'); a.saveToCloud = good;
  var c2 = call(function(cb){ a.kgCloseJob(j.id, cb, {settle:'carry', opId:cid}); }); ok(!c2.err, 'close: retry works, not stuck busy'); eq(a.kgFindJob(j.id).status, 'closed'); eq(labRows(a, j).length, 1, 'one labour row, never two');
  var j2 = pjob(a, k); var eid = op(), mk = function(){ return a.kgBuildIssue(j2.id, '', {wt:'5', chip:'999', opId:eid}).entry; };
  boom(); var e1 = call(function(cb){ a.kgAddEntry(mk(), cb); }); ok(e1.err, 'entry: throw reported'); a.saveToCloud = good;
  var e2 = call(function(cb){ a.kgAddEntry(mk(), cb); }); ok(!e2.err, 'entry: retry answers, not stuck busy'); eq(a.S.kgLedger.filter(function(x){ return x.jobId === j2.id; }).length, 1);
});
// ── Round 23: design QA findings ──
test('R23 1: New job - the preselected Gold 22K chip fills purity 91.6 at once; the job can be created with just title and weight', function(){
  var e = sheetEnv(), a = e.a, k = pk(a, 'R23a'); a.kg3NewJob(k.id);
  eq(e.reg['kg2f-purity'].value, '91.6', 'purity prefilled by the preselected chip');
  e.reg['kg2f-title'].value = 'Chain'; e.reg['kg2f-wt'].value = '10';
  e.reg['kg2-save'].onclick();
  eq(String(e.reg['kg2-err'].textContent || ''), '', 'no "type the purity too" refusal'); ok(a.S.kgJobs.some(function(j){ return j.title === 'Chain'; }), 'job created');
  var f = sheetEnv();   // a value already in the field is not overwritten by the preset
  f.reg['kg2f-purity'] = {style:{setProperty:function(){}}, value:'80', innerHTML:'', textContent:'', addEventListener:function(){}, removeEventListener:function(){}, querySelector:function(){ return null; }};
  f.a.kgForm({title:'T', fields:[{id:'purity', label:'P', value:'80'}, {id:'metal', label:'M', type:'chips', value:'gold22', options:[['gold22', 'G', {purity:'91.6'}]]}], onSubmit:function(v, fin){ fin(null); }});
  eq(f.reg['kg2f-purity'].value, '80', 'typed value kept');
});
test('R23 2: Close sheet shows Given / Counted back / Carry and the labour that will post; a manager sees no rupees', function(){
  var a = fresh('owner'); var k = lk(a, 'R23b', '150'); trust(a, k); var j = labJob(a, k);
  receiptV(a, j, {gross:'5', stoneCt:'', stoneMode:'A', purity:'', chip:'999'});
  var sheet = null; a.kgForm = function(o){ sheet = o; }; a.kg3Close(j.id); var pv = sheet.preview({});
  ok(/Given/.test(pv) && /Counted back/.test(pv) && /Carry/.test(pv), pv);
  ok(/Labour posted/.test(pv) && /₹750/.test(pv), 'owner sees the labour: ' + pv);
  var kr = fresh('owner'); var k3 = lk(kr, 'R24b', '150'); trust(kr, k3); var j3 = labJob(kr, k3); receiptV(kr, j3, {gross:'5', stoneCt:'', stoneMode:'A', purity:'', chip:'999'});
  kr.kgForm = function(o){ sheet = o; }; kr.kg3Close(j3.id); var open0 = sheet.preview({settle:'return'}); ok(/Labour posts when you close/.test(open0) || /He returns/.test(open0), 'return choice: ' + open0);
  ok(/\.kgx-posted \+ \.kgx-posted\{margin-top:12px;\}/.test(readIndex()), '12 px between the two cream panels');
  a.SAAS.user.role = 'manager'; a.kg3Close(j.id); pv = sheet.preview({}); ok(/Given/.test(pv) && !/₹|Labour/.test(pv), 'manager: reconciliation yes, rupees no: ' + pv);
});
test('R23 4: a closed job leaves NOW for History; no "average 0 days"', function(){
  var a = fresh('owner'), k = lk(a, 'R23d', ''); trust(a, k); var j = pjob(a, k); issueV(a, j, '10', '92');
  var h = a.kg3ProfileHtml(k.id); ok(h.indexOf(j.title) !== -1, 'open job listed');
  j.createdAt = '2026-11-01T10:00:00.000Z'; ok(!closeCarry(a, j).err); a.kgFindJob(j.id).closedAt = '2026-11-01T11:00:00.000Z';
  h = a.kg3ProfileHtml(k.id);
  var now = h.slice(h.indexOf('>Now<'), h.indexOf('>Account<')), hist = h.slice(h.indexOf('>History<'));
  ok(now.indexOf(j.title) === -1, 'closed job not under Now'); ok(hist.indexOf(j.title) !== -1, 'closed job under History');
  ok(h.indexOf('average') === -1, 'same-day close: no average shown'); ok(h.indexOf('less than allowed') === -1, 'nothing conceded: no line');
});
test('R23 3,5,6,7: entry rows stack text above 44 px buttons; checkbox hit area 44 px; toast room; statement width; plain wording', function(){
  var css = readIndex();
  ok(/#kg2-root \.kg2-right \.btn\{min-height:44px/.test(css), 'buttons 44');
  ok(/\.kg2-chk input\{width:44px;height:44px/.test(css), 'checkbox hit area 44');
  ok(/\.kgx-stcol\{max-width:720px;margin-left:auto;margin-right:auto;\}/.test(css), 'statement column max width'); ok(/^<div class="kgx-stcol">/.test(fresh('owner').kg3StatementHtml('nobody')), 'header and filters inside the column');
  ok(/#kg2-root\{padding-bottom:140px;\}/.test(css), 'room under the last row');
  var a = fresh('owner'), k = pk(a, 'R23e'); var j = pjob(a, k); issueV(a, j, '10', '92'); var h = a.kg3JobHtml(j);
  ok(/kgx-entry/.test(h) && /kgx-eacts/.test(h) && /kg3ShareSlip/.test(h), 'entry has a text row and an actions row');
  ok(h.indexOf('Wastage allowed') === -1, 'jargon gone');
});
test('R23 8,9: profile subline is skills and phone; kg3OrderAdvanceInfo gives a manager zeros', function(){
  var a = fresh('owner'), k = pk(a, 'R23f'); k.skills = 'Kundan'; k.phone = '9876543210'; var h = a.kg3ProfileHtml(k.id);
  ok(/Kundan &middot; 9876543210/.test(h), 'skills and phone');
  var m = fresh('manager'); var r = m.kg3OrderAdvanceInfo('x'); eq(r.given + r.adjusted + r.outstanding + r.labour, 0);
});
// ── Round 24: Back after a tab round trip lands on the profile ──
test('R24 1 (scenario D): profile > job/statement > other tab > back to Karigars > Back goes to the profile, then the list; also from the profile itself', function(){
  ['job', 'statement', 'profile'].forEach(function(page){
    ['Home', 'Stock', 'Sale', 'Day Book'].forEach(function(tab){
      var e = sheetEnv(), a = e.a; a.renderKgV2 = function(){}; a.kgPanelActive = function(){ return true; }; var hb = a.history; a.history = {pushState:hb.pushState, back:hb.back, go:function(n){ for(var q = 0; q < -n; q++) e.userBack(); }};
      var k = pk(a, 'D' + page + tab); a._kg2.seen = true; a.kg3Open(k.id);
      if(page === 'job'){ a._kg2.jobId = 'j1'; a.kgSetView('job'); } else if(page === 'statement'){ a.kg3Statement(k.id); }
      var depth = page === 'profile' ? 1 : 2; eq(e.h.idx, depth, page + ' pushes ' + depth);
      a.kgTabChanged(tab); e.flush(); eq(e.h.idx, 0, 'entries handed back on leaving');
      a.kgTabChanged('karigars'); e.flush(); eq(e.h.idx, depth, 'entries restored on return: ' + page + '/' + tab); eq(a._kgStack.join(','), page === 'profile' ? 'profile' : 'profile,' + page);
      e.userBack(); e.flush(); eq(a._kg2.view, page === 'profile' ? 'people' : 'profile', 'first Back: ' + page + '/' + tab);
      if(page !== 'profile'){ e.userBack(); e.flush(); eq(a._kg2.view, 'people', 'second Back reaches the list'); }
      eq(e.h.idx, 0, 'back at baseline');
    });
  });
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if(failed){ console.log('\nFAILURES:\n  ' + failures.join('\n  ')); process.exit(1); }
