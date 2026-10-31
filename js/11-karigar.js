// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// KARIGAR V2 \u2014 fine-gold jobs, khata and salary register (31 Oct 2026)
// Spec: Documents/JewelOS-Karigar-V2-Plan.md. Additive: V1 karigarStages /
// S.karigarPayments are untouched and still drive the profit engine.
//
//  * S.kgJobs    independent job records (orderId is an optional link)
//  * S.kgLedger  APPEND-ONLY gold ledger: ISSUE RECEIPT SCRAP LOSS ADJUST
//                APPROVAL REVERSAL. Never edited or deleted; a mistake is a
//                REVERSAL entry plus a new entry.
//  * S.kgSalary  salary register (ACCRUAL ADVANCE PAYMENT DEDUCTION REVERSAL).
//                Shares no field and no total with the gold ledger.
//
// Units: weights are INTEGER MILLIGRAMS, fine gold is integer mg (fineMg),
// money is integer PAISE. No float ever reaches a balance. Every balance is
// derived on read from the ledger; nothing is stored pre-computed.
//
// Owner rules (31 Oct): 999 issue counts as 100% (1000 permille); 995 counts
// 99.5% unless the issue is flagged "count as 24K"; a 22K receipt may carry an
// optional fineness of 91.6-92.0% (default 91.6%); wastage karigar keeps 4% of
// the fine gold ISSUED (basis points, editable per karigar); an unexplained
// shortage is never auto-classified as wastage or loss.
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

var KG_PURITIES = [
  {key:'999', permille:1000, label:'999 (24K, counted 100%)'},
  {key:'995', permille:995,  label:'995'},
  {key:'22K', permille:916,  label:'22K'},
  {key:'18K', permille:750,  label:'18K'},
  {key:'other', permille:0,  label:'Other (type fineness %)'}
];
var KG_22K_MIN = 916, KG_22K_MAX = 920;      // permille: 91.6% .. 92.0%
var KG_MAX_MG = 100000000;                    // 100 kg: anything bigger is a typo
var KG_DEFAULT_WASTAGE_BP = 400;              // 4% of fine gold issued
var KG_LOSS_CATEGORIES = ['die cutting','filing','polishing','other'];
var KG_SCRAP_KINDS = ['scrap','dust','filings'];
var KG_WASTAGE_NOTE = 'Karigar keeps this share of the fine gold issued';

// \u2500\u2500 parsing: text in, integers out, null when invalid (never a silent guess) \u2500\u2500
function kgParseMg(v){
  var t = String(v == null ? '' : v).trim();
  if(!/^\d{1,6}(\.\d{1,3})?$/.test(t)) return null;
  var p = t.split('.');
  var mg = parseInt(p[0], 10) * 1000 + parseInt(((p[1] || '') + '000').slice(0, 3), 10);
  return (mg > 0 && mg <= KG_MAX_MG) ? mg : null;
}
function kgParsePaise(v){
  var t = String(v == null ? '' : v).trim();
  if(!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  var p = t.split('.');
  var n = parseInt(p[0], 10) * 100 + parseInt(((p[1] || '') + '00').slice(0, 2), 10);
  return n > 0 ? n : null;
}
// percent text -> permille ('91.6' -> 916). null when not a plain number.
function kgPctToPermille(v){
  var t = String(v == null ? '' : v).trim();
  if(!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 10);
}
function kgFineMg(mg, permille){ return Math.round(mg * permille / 1000); }

function kgPurityDef(key){
  for(var i = 0; i < KG_PURITIES.length; i++) if(KG_PURITIES[i].key === key) return KG_PURITIES[i];
  return null;
}
// Resolve the fineness actually used. Returns {permille, as24k} or {error}.
function kgResolvePermille(key, pctText, as24k){
  var def = kgPurityDef(key);
  if(!def) return {error:'Unknown purity'};
  var hasPct = String(pctText == null ? '' : pctText).trim() !== '';
  if(key === '999') return {permille:1000, as24k:false};
  if(key === '995') return {permille: as24k ? 1000 : 995, as24k: !!as24k};
  if(key === '18K') return {permille:750, as24k:false};
  if(key === '22K'){
    if(!hasPct) return {permille:KG_22K_MIN, as24k:false};
    var p = kgPctToPermille(pctText);
    if(p === null || p < KG_22K_MIN || p > KG_22K_MAX) return {error:'22K fineness must be between 91.6 and 92.0'};
    return {permille:p, as24k:false};
  }
  // 'other': fineness must be typed
  if(!hasPct) return {error:'Type the fineness % for Other purity'};
  var q = kgPctToPermille(pctText);
  if(q === null || q < 100 || q > 1000) return {error:'Fineness must be between 10 and 100'};
  return {permille:q, as24k:false};
}

function kgFmtG(mg){
  var n = parseInt(mg, 10) || 0, neg = n < 0, a = Math.abs(n);
  var r = String(a % 1000); while(r.length < 3) r = '0' + r;
  return (neg ? '-' : '') + Math.floor(a / 1000) + '.' + r + ' g';
}
function kgFmtRs(paise){ return fmt((parseInt(paise, 10) || 0) / 100); }
function kgToday(){ return dbDayKey(new Date()); }
function kgNewId(){
  if(typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function kgUser(){
  var u = (typeof SAAS !== 'undefined' && SAAS.user) ? SAAS.user : null;
  return u ? {name:(u.name || u.email || 'user'), role:(u.role || 'staff')} : {name:'system', role:'staff'};
}
function kgRoleRank(role){ return role === 'owner' ? 3 : role === 'manager' ? 2 : role === 'staff' ? 1 : 0; }
function kgCan(role, need){ return kgRoleRank(role) >= kgRoleRank(need); }

function kgFindJob(id){
  var a = S.kgJobs || [];
  for(var i = 0; i < a.length; i++) if(a[i].id === id) return a[i];
  return null;
}

// \u2500\u2500 derived views \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function kgIndex(ledger){
  var idx = {reversed:{}, approvals:{}, byId:{}};
  (ledger || []).forEach(function(e){
    idx.byId[e.id] = e;
    if(e.type === 'REVERSAL') idx.reversed[e.reversesId] = true;
    else if(e.type === 'APPROVAL') idx.approvals[e.refId] = e.decision;
  });
  return idx;
}
// 'approved' | 'pending' | 'rejected' | 'reversed'
function kgLossState(e, idx){
  if(idx.reversed[e.id]) return 'reversed';
  if(!e.proposed) return 'approved';
  var a = idx.approvals[e.id];
  return a === 'approve' ? 'approved' : (a === 'reject' ? 'rejected' : 'pending');
}

function kgJobBalance(job, ledger){
  var idx = kgIndex(ledger);
  var b = {issuedFine:0, receiptFine:0, scrapFine:0, returnedFine:0, approvedLoss:0, pendingLoss:0, adjust:0};
  (ledger || []).forEach(function(e){
    if(e.jobId !== job.id || idx.reversed[e.id]) return;
    if(e.type === 'ISSUE') b.issuedFine += e.fineMg;
    else if(e.type === 'RECEIPT') b.receiptFine += e.fineMg;
    else if(e.type === 'SCRAP') b.scrapFine += e.fineMg;
    else if(e.type === 'ADJUST') b.adjust += e.fineMg;
    else if(e.type === 'LOSS'){
      var st = kgLossState(e, idx);
      if(st === 'approved') b.approvedLoss += e.fineMg;
      else if(st === 'pending') b.pendingLoss += e.fineMg;
    }
  });
  b.returnedFine = b.receiptFine + b.scrapFine;
  // The wastage share is of fine gold ISSUED, never of the finished weight.
  b.earnedFine = (job.kind === 'wastage') ? Math.round(b.issuedFine * (job.wastageBp || 0) / 10000) : 0;
  b.accountable = b.issuedFine - b.earnedFine;
  b.openFine = b.accountable - b.returnedFine - b.approvedLoss - b.adjust;
  b.state = b.openFine > 0 ? 'open' : (b.openFine < 0 ? 'surplus' : 'balanced');
  return b;
}

// All jobs of one karigar rolled up (cancelled jobs ignored).
function kgKhata(karigarId){
  var t = {jobs:0, openJobs:0, issuedFine:0, earnedFine:0, returnedFine:0, approvedLoss:0, adjust:0, openFine:0};
  (S.kgJobs || []).forEach(function(j){
    if(j.karigarId !== karigarId || j.status === 'cancelled') return;
    var b = kgJobBalance(j, S.kgLedger || []);
    t.jobs++; if(j.status === 'open') t.openJobs++;
    t.issuedFine += b.issuedFine; t.earnedFine += b.earnedFine; t.returnedFine += b.returnedFine;
    t.approvedLoss += b.approvedLoss; t.adjust += b.adjust; t.openFine += b.openFine;
  });
  return t;
}

// Custody statement with a running balance. Wastage share is not a movement:
// the karigar keeps it out of the metal, so it never appears as a line.
function kgStatement(karigarId){
  var idx = kgIndex(S.kgLedger || []), run = 0, rows = [];
  var list = (S.kgLedger || []).filter(function(e){
    return e.karigarId === karigarId && ['ISSUE','RECEIPT','SCRAP','LOSS','ADJUST'].indexOf(e.type) !== -1;
  }).sort(function(a, b){ return String(a.ts).localeCompare(String(b.ts)); });
  list.forEach(function(e){
    var st = e.type === 'LOSS' ? kgLossState(e, idx) : (idx.reversed[e.id] ? 'reversed' : 'ok');
    var delta = 0;
    if(st === 'ok' || st === 'approved'){
      delta = e.type === 'ISSUE' ? e.fineMg : -e.fineMg;
    }
    run += delta;
    rows.push({entry:e, state:st, delta:delta, balance:run});
  });
  return rows;
}

function kgSalaryBalance(karigarId){
  var rev = {}, t = {accrued:0, deducted:0, advanced:0, paid:0};
  (S.kgSalary || []).forEach(function(e){ if(e.type === 'REVERSAL') rev[e.reversesId] = true; });
  (S.kgSalary || []).forEach(function(e){
    if(e.karigarId !== karigarId || e.type === 'REVERSAL' || rev[e.id]) return;
    if(e.type === 'ACCRUAL') t.accrued += e.amountPaise;
    else if(e.type === 'DEDUCTION') t.deducted += e.amountPaise;
    else if(e.type === 'ADVANCE') t.advanced += e.amountPaise;
    else if(e.type === 'PAYMENT') t.paid += e.amountPaise;
  });
  t.payable = t.accrued - t.deducted - t.advanced - t.paid;
  return t;
}

// \u2500\u2500 validation (pure: no S access beyond what ctx carries) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function kgValidateEntry(e, ctx){
  var job = ctx.job, role = ctx.role, ledger = ctx.ledger || [];
  if(!e || !e.type) return 'Missing entry type';
  if(!e.opId) return 'Missing operation id';
  if(!job) return 'Job not found';
  if(job.status !== 'open') return 'Job is ' + job.status + ' - reopen it first';
  if(e.karigarId !== job.karigarId) return 'Karigar does not match the job';
  var t = e.type, idx = kgIndex(ledger), tgt;
  if(t === 'ISSUE' || t === 'RECEIPT' || t === 'SCRAP'){
    if(!kgCan(role, 'manager')) return 'Only owner or manager can record metal';
    if(!(e.mg > 0) || Math.floor(e.mg) !== e.mg || e.mg > KG_MAX_MG) return 'Weight is not valid';
    if(!(e.permille >= 1 && e.permille <= 1000) || Math.floor(e.permille) !== e.permille) return 'Fineness is not valid';
    if(!e.purityKey) return 'Purity missing';
    if(e.fineMg !== kgFineMg(e.mg, e.permille)) return 'Fine weight does not match weight and purity';
    if(t === 'RECEIPT'){
      if(!String(e.pieceDesc || '').trim()) return 'Describe the piece received';
      if(!(e.qty >= 1) || Math.floor(e.qty) !== e.qty) return 'Quantity is not valid';
      if(e.stoneMg != null && (e.stoneMg < 0 || Math.floor(e.stoneMg) !== e.stoneMg)) return 'Stone weight is not valid';
    }
    if(t === 'SCRAP' && KG_SCRAP_KINDS.indexOf(e.kind) === -1) return 'Scrap kind is not valid';
    return '';
  }
  if(t === 'LOSS'){
    if(!kgCan(role, 'manager')) return 'Only owner or manager can record a loss';
    if(!(e.fineMg > 0) || Math.floor(e.fineMg) !== e.fineMg) return 'Loss weight is not valid';
    if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required for a loss';
    if(KG_LOSS_CATEGORIES.indexOf(e.category) === -1) return 'Loss category is not valid';
    if(role === 'owner'){
      if(e.proposed || !e.approvedBy) return 'Owner loss must be approved by the owner';
    } else if(!e.proposed || e.approvedBy){
      return 'A manager can only propose a loss; the owner approves it';
    }
    return '';
  }
  if(t === 'ADJUST'){
    if(role !== 'owner') return 'Only the owner can adjust the gold account';
    if(!e.fineMg || Math.floor(e.fineMg) !== e.fineMg) return 'Adjustment weight is not valid';
    if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    return '';
  }
  if(t === 'APPROVAL'){
    if(role !== 'owner') return 'Only the owner can approve or reject a loss';
    tgt = idx.byId[e.refId];
    if(!tgt || tgt.type !== 'LOSS' || tgt.jobId !== job.id) return 'Loss not found on this job';
    if(kgLossState(tgt, idx) !== 'pending') return 'This loss is already decided';
    if(e.decision !== 'approve' && e.decision !== 'reject') return 'Decision is not valid';
    return '';
  }
  if(t === 'REVERSAL'){
    tgt = idx.byId[e.reversesId];
    if(!tgt || tgt.jobId !== job.id) return 'Entry not found on this job';
    if(tgt.type === 'REVERSAL' || tgt.type === 'APPROVAL') return 'This entry cannot be reversed';
    if(idx.reversed[tgt.id]) return 'Already reversed';
    if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    if(role === 'owner') return '';
    if(role === 'manager' && tgt.date === kgToday()) return '';
    return 'Only the owner can reverse an entry from an earlier day';
  }
  return 'Unknown entry type';
}

function kgValidateSalary(e, ctx){
  var k = ctx.karigar, role = ctx.role, all = ctx.all || [];
  if(role !== 'owner') return 'Only the owner can use the salary register';
  if(!e.opId) return 'Missing operation id';
  if(!k) return 'Karigar not found';
  if(e.type === 'REVERSAL'){
    var tgt = null, already = false;
    all.forEach(function(x){ if(x.id === e.reversesId) tgt = x; if(x.type === 'REVERSAL' && x.reversesId === e.reversesId) already = true; });
    if(!tgt || tgt.karigarId !== k.id || tgt.type === 'REVERSAL') return 'Entry not found';
    if(already) return 'Already reversed';
    if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    return '';
  }
  if(['ACCRUAL','ADVANCE','PAYMENT','DEDUCTION'].indexOf(e.type) === -1) return 'Unknown entry type';
  if(!(e.amountPaise > 0) || Math.floor(e.amountPaise) !== e.amountPaise) return 'Amount is not valid';
  if(e.type === 'ACCRUAL'){
    if(k.kind !== 'salary') return 'Only a salary karigar earns a salary accrual';
    var mode = k.salary && k.salary.mode;
    if(mode === 'monthly' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(e.period || '')) return 'Period must be a month';
    if(mode === 'daily' && !/^\d{4}-\d{2}-\d{2}$/.test(e.period || '')) return 'Period must be a date';
    if(mode !== 'monthly' && mode !== 'daily') return 'Set the salary terms first';
    var rev = {};
    all.forEach(function(x){ if(x.type === 'REVERSAL') rev[x.reversesId] = true; });
    for(var i = 0; i < all.length; i++){
      var x = all[i];
      if(x.type === 'ACCRUAL' && x.karigarId === k.id && x.period === e.period && !rev[x.id]) return 'Salary for ' + e.period + ' is already recorded';
    }
  } else if(e.type === 'DEDUCTION' || e.type === 'ADVANCE'){
    if(String(e.note || '').trim().length < 3) return 'A note is required';
  }
  return '';
}

// \u2500\u2500 transactions: one lock per key, snapshot/undo, saveToCloud, rollback \u2500\u2500
var _kgLocks = {};
function kgTxn(lockKey, apply, undo, onDone){
  if(_kgLocks[lockKey]){ onDone(new Error('Another save is in progress - try again')); return; }
  _kgLocks[lockKey] = true;
  var err = apply();
  if(err){ delete _kgLocks[lockKey]; onDone(new Error(err)); return; }
  saveToCloud(function(e){
    delete _kgLocks[lockKey];
    if(e){
      undo();
      saveCache();
      if(e.message !== 'version-conflict') toast(SAVE_RETRY_MSG);
    }
    onDone(e || null);
  });
}
function kgStamp(entry){
  var u = kgUser();
  entry.id = entry.id || kgNewId();
  entry.ts = new Date().toISOString();
  entry.date = kgToday();
  entry.by = u.name; entry.role = u.role;
  return entry;
}
function kgAudit(action, entity, id, note){
  var a = auditLog(action, entity, id, note);
  return a ? a.id : null;
}
function kgUndoAudit(auditId){
  if(auditId && Array.isArray(S.auditLog)) S.auditLog = S.auditLog.filter(function(x){ return x.id !== auditId; });
}

// done(err, entry, duplicate)
function kgAddEntry(entry, done){
  S.kgLedger = S.kgLedger || [];
  for(var i = 0; i < S.kgLedger.length; i++){
    if(S.kgLedger[i].opId === entry.opId){ done(null, S.kgLedger[i], true); return; }
  }
  var job = kgFindJob(entry.jobId), u = kgUser(), auditId = null;
  kgStamp(entry);
  if(job && !entry.karigarId) entry.karigarId = job.karigarId;
  kgTxn('job:' + entry.jobId, function(){
    var err = kgValidateEntry(entry, {job:job, ledger:S.kgLedger, role:u.role});
    if(err) return err;
    S.kgLedger.push(entry);
    auditId = kgAudit('kg_' + entry.type.toLowerCase(), 'kgJob', entry.jobId,
      entry.type + (entry.fineMg != null ? ' ' + kgFmtG(entry.fineMg) + ' fine' : ''));
    return '';
  }, function(){
    S.kgLedger = S.kgLedger.filter(function(x){ return x.id !== entry.id; });
    kgUndoAudit(auditId);
  }, function(err){ done(err, entry, false); });
}

// fields: {karigarId, title, orderId?}
function kgCreateJob(fields, opId, done){
  S.kgJobs = S.kgJobs || [];
  for(var i = 0; i < S.kgJobs.length; i++){
    if(S.kgJobs[i].opId === opId){ done(null, S.kgJobs[i], true); return; }
  }
  var u = kgUser(), k = findKarigar(fields.karigarId), job = null, prevNo = S.nextKgJobNo || 1, auditId = null;
  kgTxn('newjob', function(){
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can create a job';
    if(!k) return 'Choose a karigar';
    if(k.kind !== 'wastage' && k.kind !== 'salary') return 'Set this karigar\'s terms (wastage or salary) first';
    var title = String(fields.title || '').trim();
    if(!title || title.length > 80) return 'Give the job a short title';
    var no = String(prevNo); while(no.length < 4) no = '0' + no;
    job = {id:kgNewId(), opId:opId, jobNo:'KJ-' + no, karigarId:k.id, title:title,
           kind:k.kind, wastageBp:(k.kind === 'wastage' ? (k.wastageBp != null ? k.wastageBp : KG_DEFAULT_WASTAGE_BP) : 0),
           status:'open', orderRef:(fields.orderId ? {orderId:fields.orderId} : null),
           createdAt:new Date().toISOString(), createdBy:u.name};
    S.kgJobs.push(job);
    S.nextKgJobNo = prevNo + 1;
    auditId = kgAudit('kg_job_new', 'kgJob', job.id, job.jobNo + ' ' + title);
    return '';
  }, function(){
    S.kgJobs = S.kgJobs.filter(function(x){ return x.id !== job.id; });
    S.nextKgJobNo = prevNo;
    kgUndoAudit(auditId);
  }, function(err){ done(err, job, false); });
}

function kgCloseJob(jobId, done){
  var job = kgFindJob(jobId), u = kgUser(), auditId = null;
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can close a job';
    if(job.status !== 'open') return 'Job is not open';
    var b = kgJobBalance(job, S.kgLedger || []);
    if(b.pendingLoss > 0) return 'A proposed loss is waiting for owner approval';
    if(b.openFine !== 0) return 'Balance is ' + kgFmtG(b.openFine) + ' fine - record the metal, an owner-approved loss or an owner adjustment first';
    job.status = 'closed'; job.closedAt = new Date().toISOString(); job.closedBy = u.name;
    auditId = kgAudit('kg_job_close', 'kgJob', jobId, job.jobNo);
    return '';
  }, function(){
    job.status = 'open'; delete job.closedAt; delete job.closedBy; kgUndoAudit(auditId);
  }, function(err){ done(err); });
}
function kgReopenJob(jobId, done){
  var job = kgFindJob(jobId), u = kgUser(), auditId = null;
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(u.role !== 'owner') return 'Only the owner can reopen a job';
    if(job.status !== 'closed') return 'Job is not closed';
    job.status = 'open'; job.reopenedAt = new Date().toISOString();
    auditId = kgAudit('kg_job_reopen', 'kgJob', jobId, job.jobNo);
    return '';
  }, function(){ job.status = 'closed'; delete job.reopenedAt; kgUndoAudit(auditId); },
  function(err){ done(err); });
}

// terms: {kind:'wastage'|'salary', wastagePct:'4', salaryMode:'monthly'|'daily', rate:'30000'}
function kgSetTerms(karigarId, terms, done){
  var k = findKarigar(karigarId), u = kgUser(), before = k ? JSON.stringify(k) : null, auditId = null;
  kgTxn('karigar:' + karigarId, function(){
    if(u.role !== 'owner') return 'Only the owner can change compensation terms';
    if(!k) return 'Karigar not found';
    if(terms.kind === 'wastage'){
      var txt = String(terms.wastagePct == null ? '' : terms.wastagePct).trim();
      var bp = KG_DEFAULT_WASTAGE_BP;
      if(txt !== ''){
        if(!/^\d{1,2}(\.\d{1,2})?$/.test(txt)) return 'Wastage % is not valid';
        bp = Math.round(parseFloat(txt) * 100);
      }
      if(bp < 0 || bp > 5000) return 'Wastage % must be 0 to 50';
      k.kind = 'wastage'; k.wastageBp = bp; delete k.salary;
    } else if(terms.kind === 'salary'){
      if(terms.salaryMode !== 'monthly' && terms.salaryMode !== 'daily') return 'Choose monthly or daily';
      var paise = kgParsePaise(terms.rate);
      if(paise === null) return 'Salary rate is not valid';
      k.kind = 'salary'; k.salary = {mode:terms.salaryMode, ratePaise:paise}; delete k.wastageBp;
    } else return 'Choose wastage or salary';
    auditId = kgAudit('kg_terms', 'karigar', karigarId, k.kind);
    return '';
  }, function(){
    var old = JSON.parse(before);
    Object.keys(k).forEach(function(x){ if(!(x in old)) delete k[x]; });
    Object.keys(old).forEach(function(x){ k[x] = old[x]; });
    kgUndoAudit(auditId);
  }, function(err){ done(err); });
}

// entry: {type, karigarId, amountPaise?, period?, mode?, note?, reversesId?, reason?, opId}
function kgAddSalary(entry, done){
  S.kgSalary = S.kgSalary || [];
  for(var i = 0; i < S.kgSalary.length; i++){
    if(S.kgSalary[i].opId === entry.opId){ done(null, S.kgSalary[i], true); return; }
  }
  var u = kgUser(), k = findKarigar(entry.karigarId), auditId = null;
  kgStamp(entry);
  kgTxn('salary:' + entry.karigarId, function(){
    var err = kgValidateSalary(entry, {karigar:k, role:u.role, all:S.kgSalary});
    if(err) return err;
    S.kgSalary.push(entry);
    auditId = kgAudit('kg_salary_' + entry.type.toLowerCase(), 'karigar', entry.karigarId,
      entry.type + (entry.amountPaise ? ' ' + kgFmtRs(entry.amountPaise) : ''));
    return '';
  }, function(){
    S.kgSalary = S.kgSalary.filter(function(x){ return x.id !== entry.id; });
    kgUndoAudit(auditId);
  }, function(err){ done(err, entry, false); });
}

// Runs after every load/restore (normaliseData): a retried or replayed save can
// repeat an opId; keep the first, drop the rest. Orphans are never deleted.
function kgNormalise(){
  if(typeof S === 'undefined' || !S) return;
  ['kgJobs', 'kgLedger', 'kgSalary'].forEach(function(key){
    if(!Array.isArray(S[key])) S[key] = [];
    var seen = {};
    S[key] = S[key].filter(function(e){
      if(!e || !e.id) return false;
      if(e.opId){ if(seen[e.opId]) return false; seen[e.opId] = true; }
      return true;
    });
  });
  if(!(S.nextKgJobNo > 0)) S.nextKgJobNo = 1;
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// UI \u2014 rendered into #kg2-root inside the Karigars tab. Logic above is
// unit-tested; everything below is DOM and is only checked by hand/e2e.
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
var _kg2 = {view:'home', jobId:'', karigarId:''};

function kg2Go(view, id){
  _kg2.view = view;
  if(view === 'job') _kg2.jobId = id || _kg2.jobId;
  if(view === 'khata' || view === 'salary') _kg2.karigarId = id || _kg2.karigarId;
  renderKgV2();
}
function kg2OpenJob(id){ kg2Go('job', id); }
function kg2Pick(view, sel){ _kg2.karigarId = sel.value; _kg2.view = view; renderKgV2(); }

function kg2Badge(txt, cls){ return '<span class="kg2-badge ' + (cls || '') + '">' + escHtml(txt) + '</span>'; }
function kg2Btn(label, fn, cls){ return '<button class="btn btn-sm ' + (cls || '') + '" onclick="' + fn + '">' + escHtml(label) + '</button>'; }
function kg2Q(id){ return '\'' + jsAttrEsc(id) + '\''; }

function renderKgV2(){
  var root = document.getElementById('kg2-root');
  if(!root) return;
  if(!kgCan(kgUser().role, 'manager')){ root.innerHTML = ''; return; }
  var html = '';
  if(_kg2.view === 'job' && kgFindJob(_kg2.jobId)) html = kg2JobHtml(kgFindJob(_kg2.jobId));
  else if(_kg2.view === 'khata') html = kg2KhataHtml();
  else if(_kg2.view === 'salary') html = kg2SalaryHtml();
  else { _kg2.view = 'home'; html = kg2HomeHtml(); }
  root.innerHTML = html;
}

function kg2NavHtml(){
  return '<div class="kg2-nav">' +
    kg2Btn('Jobs', 'kg2Go(\'home\')', _kg2.view === 'home' ? 'btn-gold' : '') +
    kg2Btn('Fine-gold khata', 'kg2Go(\'khata\')', _kg2.view === 'khata' ? 'btn-gold' : '') +
    (kgUser().role === 'owner' ? kg2Btn('Salary', 'kg2Go(\'salary\')', _kg2.view === 'salary' ? 'btn-gold' : '') : '') +
  '</div>';
}

function kg2HomeHtml(){
  var u = kgUser(), html = '<div class="kg2-head"><div class="kg2-title">Fine-gold jobs <span class="kg2-new">new</span></div>' +
    '<div class="kg2-sub">Gold is counted in fine grams. Each job has its own balance.</div></div>' + kg2NavHtml();
  html += '<div class="kg2-row">' + kg2Btn('+ New job', 'kg2NewJob()', 'btn-gold') + '</div>';
  var ks = S.karigars || [];
  html += '<div class="kg2-sec">Karigar terms</div>';
  if(!ks.length) html += '<div class="kg2-empty">No karigars yet - add one by assigning from an order, then set terms here.</div>';
  ks.forEach(function(k){
    var kh = kgKhata(k.id);
    var terms = k.kind === 'wastage' ? 'Wastage ' + ((k.wastageBp != null ? k.wastageBp : KG_DEFAULT_WASTAGE_BP) / 100) + '%'
              : k.kind === 'salary' ? 'Salary ' + (k.salary ? k.salary.mode + ' ' + kgFmtRs(k.salary.ratePaise) : '') : 'Terms not set';
    html += '<div class="kg2-line"><div><b>' + escHtml(k.name) + '</b><div class="kg2-sub">' + escHtml(terms) + ' &middot; ' +
      kh.openJobs + ' open job' + (kh.openJobs === 1 ? '' : 's') + ' &middot; with karigar ' + kgFmtG(kh.openFine) + ' fine</div></div>' +
      (u.role === 'owner' ? kg2Btn(k.kind ? 'Change terms' : 'Set terms', 'kg2Terms(' + kg2Q(k.id) + ')') : '') + '</div>';
  });
  html += '<div class="kg2-sec">Jobs</div>';
  var jobs = (S.kgJobs || []).slice().sort(function(a, b){
    if(a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  if(!jobs.length) html += '<div class="kg2-empty">No jobs yet.</div>';
  jobs.forEach(function(j){
    var b = kgJobBalance(j, S.kgLedger || []), k = findKarigar(j.karigarId);
    html += '<div class="kg2-line kg2-click" onclick="kg2OpenJob(' + kg2Q(j.id) + ')"><div><b>' + escHtml(j.jobNo) + ' &middot; ' + escHtml(j.title) + '</b>' +
      '<div class="kg2-sub">' + escHtml(k ? k.name : '?') + ' &middot; ' + escHtml(j.kind) + '</div></div><div class="kg2-right">' +
      kg2Badge(j.status, j.status === 'open' ? 'ok' : '') + '<div class="kg2-num ' + (b.state === 'surplus' ? 'warn' : '') + '">' + kgFmtG(b.openFine) + '</div></div></div>';
  });
  return html;
}

function kg2JobHtml(job){
  var u = kgUser(), k = findKarigar(job.karigarId), led = S.kgLedger || [], idx = kgIndex(led), b = kgJobBalance(job, led);
  var html = '<div class="kg2-row">' + kg2Btn('\u2190 All jobs', 'kg2Go(\'home\')') + '</div>' +
    '<div class="kg2-head"><div class="kg2-title">' + escHtml(job.jobNo) + ' &middot; ' + escHtml(job.title) + '</div>' +
    '<div class="kg2-sub">' + escHtml(k ? k.name : '?') + ' &middot; ' + escHtml(job.kind) +
    (job.kind === 'wastage' ? ' ' + (job.wastageBp / 100) + '%' : '') + ' &middot; ' + escHtml(job.status) +
    (job.orderRef ? ' &middot; linked to order' : '') + '</div></div>';
  function cell(l, v, cls){ return '<div class="kg2-cell ' + (cls || '') + '"><span>' + l + '</span><b>' + v + '</b></div>'; }
  html += '<div class="kg2-grid">' +
    cell('Issued (fine)', kgFmtG(b.issuedFine)) +
    (job.kind === 'wastage' ? cell('Karigar keeps', kgFmtG(b.earnedFine)) + cell('Must return', kgFmtG(b.accountable)) : cell('Must return', kgFmtG(b.accountable))) +
    cell('Returned (pieces + scrap)', kgFmtG(b.returnedFine)) +
    cell('Approved loss', kgFmtG(b.approvedLoss)) +
    (b.adjust ? cell('Owner adjustment', kgFmtG(b.adjust)) : '') +
    cell(b.state === 'surplus' ? 'Surplus' : 'Still with karigar', kgFmtG(Math.abs(b.openFine)), b.state === 'surplus' ? 'warn' : (b.openFine > 0 ? 'due' : 'ok')) +
  '</div>';
  if(b.pendingLoss > 0) html += '<div class="kg2-note warn">A loss of ' + kgFmtG(b.pendingLoss) + ' fine is waiting for owner approval.</div>';
  if(b.openFine > 0 && job.status === 'open') html += '<div class="kg2-note">Any metal not yet returned stays on the karigar. It is never counted as wastage or loss on its own.</div>';
  if(job.status === 'open'){
    html += '<div class="kg2-row">' + kg2Btn('Issue gold', 'kg2Issue(' + kg2Q(job.id) + ')', 'btn-gold') +
      kg2Btn('Receive piece', 'kg2Receipt(' + kg2Q(job.id) + ')') + kg2Btn('Scrap / dust', 'kg2Scrap(' + kg2Q(job.id) + ')') +
      kg2Btn(u.role === 'owner' ? 'Record loss' : 'Propose loss', 'kg2Loss(' + kg2Q(job.id) + ')') +
      (u.role === 'owner' ? kg2Btn('Adjust', 'kg2Adjust(' + kg2Q(job.id) + ')') : '') +
      kg2Btn('Close job', 'kg2Close(' + kg2Q(job.id) + ')') + '</div>';
  } else if(job.status === 'closed' && u.role === 'owner'){
    html += '<div class="kg2-row">' + kg2Btn('Reopen job', 'kg2Reopen(' + kg2Q(job.id) + ')') + '</div>';
  }
  html += '<div class="kg2-sec">Entries</div>';
  var rows = led.filter(function(e){ return e.jobId === job.id; });
  if(!rows.length) html += '<div class="kg2-empty">Nothing recorded yet.</div>';
  rows.slice().reverse().forEach(function(e){
    var st = e.type === 'LOSS' ? kgLossState(e, idx) : (idx.reversed[e.id] ? 'reversed' : '');
    var act = '';
    if(e.type === 'LOSS' && st === 'pending' && u.role === 'owner'){
      act += kg2Btn('Approve', 'kg2Decide(' + kg2Q(job.id) + ',' + kg2Q(e.id) + ',\'approve\')') + kg2Btn('Reject', 'kg2Decide(' + kg2Q(job.id) + ',' + kg2Q(e.id) + ',\'reject\')');
    }
    if(job.status === 'open' && e.type !== 'REVERSAL' && e.type !== 'APPROVAL' && !idx.reversed[e.id]){
      act += kg2Btn('Reverse', 'kg2Reverse(' + kg2Q(job.id) + ',' + kg2Q(e.id) + ')');
    }
    html += '<div class="kg2-line' + (st === 'reversed' ? ' kg2-struck' : '') + '"><div><b>' + escHtml(e.type) + '</b> ' + kg2Badge(st || 'ok', st === 'pending' ? 'warn' : '') +
      '<div class="kg2-sub">' + escHtml(e.date) + ' &middot; ' + escHtml(e.by || '') + ' &middot; ' + kg2Detail(e) + '</div></div>' +
      '<div class="kg2-right">' + act + '</div></div>';
  });
  return html;
}
function kg2Detail(e){
  var p = e.purityKey ? (e.purityKey === 'other' ? 'other ' + (e.permille / 10) + '%' : e.purityKey) + (e.as24k ? ' as 24K' : '') : '';
  if(e.type === 'ISSUE') return kgFmtG(e.mg) + ' ' + escHtml(p) + ' = ' + kgFmtG(e.fineMg) + ' fine';
  if(e.type === 'RECEIPT') return escHtml(e.pieceDesc || '') + ' x' + e.qty + ' &middot; ' + kgFmtG(e.mg) + ' ' + escHtml(p) + ' @' + (e.permille / 10) + '% = ' + kgFmtG(e.fineMg) + ' fine';
  if(e.type === 'SCRAP') return escHtml(e.kind) + ' ' + kgFmtG(e.mg) + ' ' + escHtml(p) + ' = ' + kgFmtG(e.fineMg) + ' fine';
  if(e.type === 'LOSS') return escHtml(e.category) + ' ' + kgFmtG(e.fineMg) + ' fine &middot; ' + escHtml(e.reason || '');
  if(e.type === 'ADJUST') return (e.fineMg > 0 ? 'credit ' : 'debit ') + kgFmtG(Math.abs(e.fineMg)) + ' fine &middot; ' + escHtml(e.reason || '');
  if(e.type === 'APPROVAL') return escHtml(e.decision);
  if(e.type === 'REVERSAL') return 'reverses an earlier entry &middot; ' + escHtml(e.reason || '');
  return '';
}

function kg2KhataHtml(){
  var ks = S.karigars || [];
  if(!_kg2.karigarId && ks.length) _kg2.karigarId = ks[0].id;
  var html = '<div class="kg2-head"><div class="kg2-title">Fine-gold khata</div><div class="kg2-sub">Gold only. Salary is a separate register.</div></div>' + kg2NavHtml();
  html += '<select class="kg2-sel" onchange="kg2Pick(\'khata\',this)">' + ks.map(function(k){
    return '<option value="' + escHtml(k.id) + '"' + (k.id === _kg2.karigarId ? ' selected' : '') + '>' + escHtml(k.name) + '</option>';
  }).join('') + '</select>';
  if(!_kg2.karigarId) return html + '<div class="kg2-empty">No karigars yet.</div>';
  var t = kgKhata(_kg2.karigarId);
  html += '<div class="kg2-grid">' +
    '<div class="kg2-cell"><span>Issued (fine)</span><b>' + kgFmtG(t.issuedFine) + '</b></div>' +
    '<div class="kg2-cell"><span>Karigar kept (wastage)</span><b>' + kgFmtG(t.earnedFine) + '</b></div>' +
    '<div class="kg2-cell"><span>Returned</span><b>' + kgFmtG(t.returnedFine) + '</b></div>' +
    '<div class="kg2-cell"><span>Approved loss</span><b>' + kgFmtG(t.approvedLoss) + '</b></div>' +
    '<div class="kg2-cell ' + (t.openFine > 0 ? 'due' : '') + '"><span>With karigar now</span><b>' + kgFmtG(t.openFine) + '</b></div></div>';
  html += '<div class="kg2-sec">Statement</div>';
  var rows = kgStatement(_kg2.karigarId);
  if(!rows.length) html += '<div class="kg2-empty">No gold movements yet.</div>';
  rows.slice().reverse().forEach(function(r){
    var job = kgFindJob(r.entry.jobId);
    html += '<div class="kg2-line' + (r.state === 'reversed' ? ' kg2-struck' : '') + '"><div><b>' + escHtml(r.entry.type) + '</b> ' + kg2Badge(r.state === 'ok' ? '' : r.state, r.state === 'pending' ? 'warn' : '') +
      '<div class="kg2-sub">' + escHtml(r.entry.date) + ' &middot; ' + escHtml(job ? job.jobNo : '?') + ' &middot; ' + kg2Detail(r.entry) + '</div></div>' +
      '<div class="kg2-right"><div class="kg2-num">' + kgFmtG(r.balance) + '</div></div></div>';
  });
  return html;
}

function kg2SalaryHtml(){
  var ks = S.karigars || [];
  if(kgUser().role !== 'owner') return '<div class="kg2-empty">Only the owner can open the salary register.</div>';
  if(!_kg2.karigarId && ks.length) _kg2.karigarId = ks[0].id;
  var html = '<div class="kg2-head"><div class="kg2-title">Salary register</div><div class="kg2-sub">Money only. Never mixed with gold.</div></div>' + kg2NavHtml();
  html += '<select class="kg2-sel" onchange="kg2Pick(\'salary\',this)">' + ks.map(function(k){
    return '<option value="' + escHtml(k.id) + '"' + (k.id === _kg2.karigarId ? ' selected' : '') + '>' + escHtml(k.name) + '</option>';
  }).join('') + '</select>';
  var k = findKarigar(_kg2.karigarId);
  if(!k) return html + '<div class="kg2-empty">No karigars yet.</div>';
  var t = kgSalaryBalance(k.id), rev = {};
  (S.kgSalary || []).forEach(function(e){ if(e.type === 'REVERSAL') rev[e.reversesId] = true; });
  html += '<div class="kg2-grid"><div class="kg2-cell"><span>Earned</span><b>' + kgFmtRs(t.accrued) + '</b></div>' +
    '<div class="kg2-cell"><span>Advances</span><b>' + kgFmtRs(t.advanced) + '</b></div>' +
    '<div class="kg2-cell"><span>Deductions</span><b>' + kgFmtRs(t.deducted) + '</b></div>' +
    '<div class="kg2-cell"><span>Paid</span><b>' + kgFmtRs(t.paid) + '</b></div>' +
    '<div class="kg2-cell ' + (t.payable > 0 ? 'due' : '') + '"><span>' + (t.payable < 0 ? 'Paid in excess' : 'Payable') + '</span><b>' + kgFmtRs(Math.abs(t.payable)) + '</b></div></div>';
  if(k.kind !== 'salary') html += '<div class="kg2-note">' + escHtml(k.name) + ' is ' + (k.kind === 'wastage' ? 'a wastage karigar: no salary accrues. Advance and payment can still be recorded.' : 'not set up yet. Set terms on the Jobs page.') + '</div>';
  html += '<div class="kg2-row">' + (k.kind === 'salary' ? kg2Btn(k.salary && k.salary.mode === 'daily' ? 'Add day(s)' : 'Add month', 'kg2Accrue(' + kg2Q(k.id) + ')', 'btn-gold') : '') +
    kg2Btn('Advance', 'kg2Money(' + kg2Q(k.id) + ',\'ADVANCE\')') + kg2Btn('Payment', 'kg2Money(' + kg2Q(k.id) + ',\'PAYMENT\')') +
    kg2Btn('Deduction', 'kg2Money(' + kg2Q(k.id) + ',\'DEDUCTION\')') + '</div>';
  html += '<div class="kg2-sec">Entries</div>';
  var list = (S.kgSalary || []).filter(function(e){ return e.karigarId === k.id; });
  if(!list.length) html += '<div class="kg2-empty">Nothing recorded yet.</div>';
  list.slice().reverse().forEach(function(e){
    var isRev = e.type === 'REVERSAL', gone = rev[e.id];
    html += '<div class="kg2-line' + (gone ? ' kg2-struck' : '') + '"><div><b>' + escHtml(e.type) + '</b> ' + (gone ? kg2Badge('reversed') : '') +
      '<div class="kg2-sub">' + escHtml(e.date) + (e.period ? ' &middot; ' + escHtml(e.period) : '') + (e.days ? ' &middot; ' + e.days + ' day(s)' : '') +
      (e.mode ? ' &middot; ' + escHtml(e.mode) : '') + (e.note ? ' &middot; ' + escHtml(e.note) : '') + (e.reason ? ' &middot; ' + escHtml(e.reason) : '') + '</div></div>' +
      '<div class="kg2-right">' + (isRev ? '' : '<div class="kg2-num">' + kgFmtRs(e.amountPaise) + '</div>') +
      (!isRev && !gone ? kg2Btn('Reverse', 'kg2ReverseSalary(' + kg2Q(k.id) + ',' + kg2Q(e.id) + ')') : '') + '</div></div>';
  });
  return html;
}

// \u2500\u2500 modal form builder \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// fields: [{id,label,type:'text'|'select'|'check',options:[[value,label]],value,hint,show(vals)}]
// opts.preview(vals) -> html shown under the fields. opts.onSubmit(vals, finish(err)).
// The operation id is minted when the form OPENS, so a second tap on Save
// re-sends the same id and cannot create a second entry.
function kgForm(opts){
  var old = document.getElementById('kg2-modal'); if(old) old.parentNode.removeChild(old);
  var ov = document.createElement('div'); ov.id = 'kg2-modal'; ov.className = 'kg2-ov';
  var opId = kgNewId();
  var h = '<div class="kg2-box"><div class="kg2-title">' + escHtml(opts.title) + '</div>';
  opts.fields.forEach(function(f){
    h += '<div class="kg2-f" id="kg2w-' + f.id + '"><label for="kg2f-' + f.id + '">' + escHtml(f.label) + '</label>';
    if(f.type === 'select'){
      h += '<select id="kg2f-' + f.id + '">' + f.options.map(function(o){
        return '<option value="' + escHtml(o[0]) + '"' + (String(o[0]) === String(f.value) ? ' selected' : '') + '>' + escHtml(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if(f.type === 'check'){
      h += '<input type="checkbox" id="kg2f-' + f.id + '"' + (f.value ? ' checked' : '') + '>';
    } else {
      h += '<input type="text" id="kg2f-' + f.id + '" inputmode="' + (f.mode || 'text') + '" autocomplete="off" value="' + escHtml(f.value || '') + '">';
    }
    if(f.hint) h += '<div class="kg2-hint">' + escHtml(f.hint) + '</div>';
    h += '</div>';
  });
  h += '<div class="kg2-prev" id="kg2-prev"></div><div class="kg2-err" id="kg2-err"></div>' +
    '<div class="kg2-row"><button class="btn" id="kg2-cancel">Cancel</button><button class="btn btn-gold" id="kg2-save">' + escHtml(opts.submitLabel || 'Save') + '</button></div></div>';
  ov.innerHTML = h; document.body.appendChild(ov);
  function vals(){
    var v = {opId:opId};
    opts.fields.forEach(function(f){
      var el = document.getElementById('kg2f-' + f.id);
      v[f.id] = el ? (f.type === 'check' ? !!el.checked : el.value) : '';
    });
    return v;
  }
  function refresh(){
    var v = vals();
    opts.fields.forEach(function(f){
      var w = document.getElementById('kg2w-' + f.id);
      if(w && f.show) w.style.display = f.show(v) ? '' : 'none';
    });
    var pv = document.getElementById('kg2-prev');
    if(pv) pv.innerHTML = opts.preview ? opts.preview(v) : '';
    var er = document.getElementById('kg2-err');
    if(er) er.textContent = '';   // a typed correction clears the old message
  }
  ov.addEventListener('input', refresh); ov.addEventListener('change', refresh);
  document.getElementById('kg2-cancel').onclick = function(){ ov.parentNode.removeChild(ov); };
  var save = document.getElementById('kg2-save');
  save.onclick = function(){
    if(save.disabled) return;
    save.disabled = true;
    document.getElementById('kg2-err').textContent = '';
    opts.onSubmit(vals(), function(err){
      save.disabled = false;
      if(err){ document.getElementById('kg2-err').textContent = err.message || String(err); return; }
      if(ov.parentNode) ov.parentNode.removeChild(ov);
      renderKgV2();
      if(opts.doneToast) toast(opts.doneToast);
    });
  };
  refresh();
}
function kg2Err(msg, finish){ finish(new Error(msg)); }

var KG2_PUR_OPTS = KG_PURITIES.map(function(p){ return [p.key, p.label]; });

// preview line shared by issue / receipt / scrap forms
function kg2FinePreview(v, label){
  var mg = kgParseMg(v.wt); if(mg === null) return '';
  var r = kgResolvePermille(v.pur, v.pct, v.as24k);
  if(r.error) return '<span class="warn">' + escHtml(r.error) + '</span>';
  return escHtml(label) + ': <b>' + kgFmtG(kgFineMg(mg, r.permille)) + '</b> fine (' + (r.permille / 10) + '%)';
}
function kg2BuildMetal(type, jobId, v){
  var mg = kgParseMg(v.wt);
  if(mg === null) return {error:'Enter the weight in grams (up to 3 decimals)'};
  var r = kgResolvePermille(v.pur, v.pct, v.as24k);
  if(r.error) return {error:r.error};
  var job = kgFindJob(jobId);
  return {entry:{type:type, opId:v.opId, jobId:jobId, karigarId:job ? job.karigarId : '', mg:mg, purityKey:v.pur,
    permille:r.permille, as24k:r.as24k, fineMg:kgFineMg(mg, r.permille), note:String(v.note || '').trim()}};
}

function kg2Issue(jobId){
  kgForm({title:'Issue gold to karigar', submitLabel:'Record issue', doneToast:'\u2713 Gold issue recorded',
    fields:[
      {id:'wt', label:'Weight (grams)', mode:'decimal'},
      {id:'pur', label:'Purity', type:'select', options:[['999', '999 (counted 100%)'], ['995', '995 (counted 99.5%)']], value:'999'},
      {id:'as24k', label:'Count 995 as 24K (100%)', type:'check', show:function(v){ return v.pur === '995'; }},
      {id:'note', label:'Note (optional)'}],
    preview:function(v){ return kg2FinePreview(v, 'Fine gold issued'); },
    onSubmit:function(v, fin){
      var b = kg2BuildMetal('ISSUE', jobId, v); if(b.error) return kg2Err(b.error, fin);
      kgAddEntry(b.entry, function(err){ fin(err); });
    }});
}
function kg2Receipt(jobId){
  kgForm({title:'Receive finished piece', submitLabel:'Record receipt', doneToast:'\u2713 Receipt recorded',
    fields:[
      {id:'desc', label:'Piece (e.g. necklace)'},
      {id:'qty', label:'Quantity', value:'1', mode:'numeric'},
      {id:'wt', label:'Gross metal weight (grams)', mode:'decimal'},
      {id:'stone', label:'Stone weight in grams (info only, optional)', mode:'decimal'},
      {id:'pur', label:'Purity', type:'select', options:KG2_PUR_OPTS.filter(function(o){ return o[0] !== '995'; }), value:'22K'},
      {id:'pct', label:'Fineness % (22K: optional, 91.6 to 92)', mode:'decimal', hint:'Leave blank for the default. Each receipt keeps its own value.',
        show:function(v){ return v.pur === '22K' || v.pur === 'other'; }}],
    preview:function(v){ return kg2FinePreview(v, 'Fine gold credited'); },
    onSubmit:function(v, fin){
      var qty = parseInt(v.qty, 10);
      if(!/^\d{1,4}$/.test(String(v.qty).trim()) || !(qty >= 1)) return kg2Err('Quantity must be 1 or more', fin);
      var stone = 0, st = String(v.stone || '').trim();
      if(st !== ''){ stone = kgParseMg(st); if(stone === null) return kg2Err('Stone weight is not valid', fin); }
      var b = kg2BuildMetal('RECEIPT', jobId, v); if(b.error) return kg2Err(b.error, fin);
      b.entry.pieceDesc = String(v.desc || '').trim(); b.entry.qty = qty; b.entry.stoneMg = stone;
      kgAddEntry(b.entry, function(err){ fin(err); });
    }});
}
function kg2Scrap(jobId){
  kgForm({title:'Scrap / dust returned', submitLabel:'Record scrap', doneToast:'\u2713 Scrap recorded',
    fields:[
      {id:'kind', label:'Kind', type:'select', options:KG_SCRAP_KINDS.map(function(x){ return [x, x]; }), value:'scrap'},
      {id:'wt', label:'Weight (grams)', mode:'decimal'},
      {id:'pur', label:'Purity', type:'select', options:KG2_PUR_OPTS, value:'999'},
      {id:'as24k', label:'Count 995 as 24K (100%)', type:'check', show:function(v){ return v.pur === '995'; }},
      {id:'pct', label:'Fineness % (22K: optional, 91.6 to 92)', mode:'decimal', show:function(v){ return v.pur === '22K' || v.pur === 'other'; }}],
    preview:function(v){ return kg2FinePreview(v, 'Fine gold credited back'); },
    onSubmit:function(v, fin){
      var b = kg2BuildMetal('SCRAP', jobId, v); if(b.error) return kg2Err(b.error, fin);
      b.entry.kind = v.kind;
      kgAddEntry(b.entry, function(err){ fin(err); });
    }});
}
function kg2Loss(jobId){
  var owner = kgUser().role === 'owner';
  kgForm({title: owner ? 'Record manufacturing loss' : 'Propose manufacturing loss', submitLabel: owner ? 'Record loss' : 'Send for approval',
    doneToast: owner ? '\u2713 Loss recorded' : '\u2713 Sent to owner for approval',
    fields:[
      {id:'cat', label:'Where was it lost', type:'select', options:KG_LOSS_CATEGORIES.map(function(x){ return [x, x]; }), value:'filing'},
      {id:'wt', label:'Fine gold lost (grams)', mode:'decimal'},
      {id:'reason', label:'Reason (required)'}],
    onSubmit:function(v, fin){
      var mg = kgParseMg(v.wt); if(mg === null) return kg2Err('Enter the fine weight lost in grams', fin);
      var job = kgFindJob(jobId), u = kgUser();
      var e = {type:'LOSS', opId:v.opId, jobId:jobId, karigarId:job ? job.karigarId : '', fineMg:mg, category:v.cat, reason:String(v.reason || '').trim()};
      if(u.role === 'owner'){ e.proposed = false; e.approvedBy = u.name; e.approvedAt = new Date().toISOString(); } else e.proposed = true;
      kgAddEntry(e, function(err){ fin(err); });
    }});
}
function kg2Adjust(jobId){
  kgForm({title:'Owner adjustment', submitLabel:'Record adjustment', doneToast:'\u2713 Adjustment recorded',
    fields:[
      {id:'dir', label:'Direction', type:'select', options:[['credit', 'Credit (reduces what karigar owes)'], ['debit', 'Debit (adds to what karigar owes)']], value:'credit'},
      {id:'wt', label:'Fine gold (grams)', mode:'decimal'},
      {id:'reason', label:'Reason (required)'}],
    onSubmit:function(v, fin){
      var mg = kgParseMg(v.wt); if(mg === null) return kg2Err('Enter the fine weight in grams', fin);
      var job = kgFindJob(jobId);
      kgAddEntry({type:'ADJUST', opId:v.opId, jobId:jobId, karigarId:job ? job.karigarId : '', fineMg:(v.dir === 'debit' ? -mg : mg), reason:String(v.reason || '').trim()}, function(err){ fin(err); });
    }});
}
function kg2Decide(jobId, lossId, decision){
  var job = kgFindJob(jobId);
  kgAddEntry({type:'APPROVAL', opId:'ap-' + lossId + '-' + decision, jobId:jobId, karigarId:job ? job.karigarId : '', refId:lossId, decision:decision}, function(err){
    if(err){ toast(err.message); return; }
    renderKgV2(); toast(decision === 'approve' ? '\u2713 Loss approved' : 'Loss rejected');
  });
}
function kg2Reverse(jobId, entryId){
  kgForm({title:'Reverse this entry', submitLabel:'Reverse', doneToast:'\u2713 Entry reversed',
    fields:[{id:'reason', label:'Reason (required)'}],
    onSubmit:function(v, fin){
      var job = kgFindJob(jobId);
      kgAddEntry({type:'REVERSAL', opId:v.opId, jobId:jobId, karigarId:job ? job.karigarId : '', reversesId:entryId, reason:String(v.reason || '').trim()}, function(err){ fin(err); });
    }});
}
function kg2Close(jobId){
  kgCloseJob(jobId, function(err){
    if(err){ toast(err.message); return; }
    renderKgV2(); toast('\u2713 Job closed');
  });
}
function kg2Reopen(jobId){
  kgReopenJob(jobId, function(err){
    if(err){ toast(err.message); return; }
    renderKgV2(); toast('Job reopened');
  });
}
function kg2NewJob(){
  var ks = (S.karigars || []).filter(function(k){ return k.kind === 'wastage' || k.kind === 'salary'; });
  if(!ks.length){ toast('Set a karigar\'s terms (wastage or salary) first'); return; }
  var orders = (S.orders || []).filter(function(o){ return o.status !== 'cancelled' && o.status !== 'delivered'; });
  kgForm({title:'New job', submitLabel:'Create job', doneToast:'\u2713 Job created',
    fields:[
      {id:'k', label:'Karigar', type:'select', options:ks.map(function(k){ return [k.id, k.name + ' (' + k.kind + ')']; }), value:ks[0].id},
      {id:'title', label:'Job title (e.g. 22K necklace set)'},
      {id:'ord', label:'Link to customer order (optional)', type:'select', options:[['', 'None']].concat(orders.map(function(o){ return [o.id, o.ordNo + ' - ' + (o.customer || '')]; })), value:''}],
    onSubmit:function(v, fin){
      kgCreateJob({karigarId:v.k, title:v.title, orderId:v.ord}, v.opId, function(err, job){
        if(!err && job){ _kg2.view = 'job'; _kg2.jobId = job.id; }
        fin(err);
      });
    }});
}
function kg2Terms(karigarId){
  var k = findKarigar(karigarId); if(!k) return;
  kgForm({title:'Terms for ' + k.name, submitLabel:'Save terms', doneToast:'\u2713 Terms saved',
    fields:[
      {id:'kind', label:'Type', type:'select', options:[['wastage', 'Wastage (keeps a % of fine gold issued)'], ['salary', 'Salary (no gold earning)']], value:k.kind || 'wastage'},
      {id:'pct', label:'Wastage % of fine gold issued', value:String((k.wastageBp != null ? k.wastageBp : KG_DEFAULT_WASTAGE_BP) / 100), mode:'decimal',
        hint:'Applies to new jobs only. Existing jobs keep their own %.', show:function(v){ return v.kind === 'wastage'; }},
      {id:'mode', label:'Salary is', type:'select', options:[['monthly', 'Monthly'], ['daily', 'Daily']], value:(k.salary && k.salary.mode) || 'monthly', show:function(v){ return v.kind === 'salary'; }},
      {id:'rate', label:'Salary rate (\u20b9 per month / per day)', value:(k.salary ? String(k.salary.ratePaise / 100) : ''), mode:'decimal', show:function(v){ return v.kind === 'salary'; }}],
    onSubmit:function(v, fin){
      kgSetTerms(karigarId, {kind:v.kind, wastagePct:v.pct, salaryMode:v.mode, rate:v.rate}, function(err){ fin(err); });
    }});
}
function kg2Accrue(karigarId){
  var k = findKarigar(karigarId); if(!k || !k.salary) return;
  var daily = k.salary.mode === 'daily', now = kgToday();
  kgForm({title: daily ? 'Add working day(s)' : 'Add month salary', submitLabel:'Record', doneToast:'\u2713 Recorded',
    fields:[
      {id:'period', label: daily ? 'Date (YYYY-MM-DD)' : 'Month (YYYY-MM)', value: daily ? now : now.slice(0, 7)},
      {id:'days', label:'Days worked', value:'1', mode:'numeric', show:function(){ return daily; }}],
    preview:function(v){
      var d = daily ? parseInt(v.days, 10) : 1;
      return d >= 1 ? 'Amount: <b>' + kgFmtRs(k.salary.ratePaise * d) + '</b> (' + kgFmtRs(k.salary.ratePaise) + (daily ? ' x ' + d : '') + ')' : '';
    },
    onSubmit:function(v, fin){
      var d = 1;
      if(daily){
        if(!/^\d{1,2}$/.test(String(v.days).trim()) || parseInt(v.days, 10) < 1 || parseInt(v.days, 10) > 31) return kg2Err('Days must be 1 to 31', fin);
        d = parseInt(v.days, 10);
      }
      kgAddSalary({type:'ACCRUAL', opId:v.opId, karigarId:karigarId, period:String(v.period).trim(), days:daily ? d : 0, amountPaise:k.salary.ratePaise * d}, function(err){ fin(err); });
    }});
}
function kg2Money(karigarId, type){
  var titles = {ADVANCE:'Record advance', PAYMENT:'Record payment', DEDUCTION:'Record deduction'};
  kgForm({title:titles[type], submitLabel:'Record', doneToast:'\u2713 Recorded',
    fields:[
      {id:'amt', label:'Amount (\u20b9)', mode:'decimal'},
      {id:'mode', label:'Paid by', type:'select', options:[['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank']], value:'cash', show:function(){ return type !== 'DEDUCTION'; }},
      {id:'note', label: type === 'PAYMENT' ? 'Note (optional)' : 'Note (required)'}],
    onSubmit:function(v, fin){
      var p = kgParsePaise(v.amt); if(p === null) return kg2Err('Enter the amount in rupees', fin);
      kgAddSalary({type:type, opId:v.opId, karigarId:karigarId, amountPaise:p, mode:(type === 'DEDUCTION' ? '' : v.mode), note:String(v.note || '').trim()}, function(err){ fin(err); });
    }});
}
function kg2ReverseSalary(karigarId, entryId){
  kgForm({title:'Reverse this salary entry', submitLabel:'Reverse', doneToast:'\u2713 Entry reversed',
    fields:[{id:'reason', label:'Reason (required)'}],
    onSubmit:function(v, fin){
      kgAddSalary({type:'REVERSAL', opId:v.opId, karigarId:karigarId, reversesId:entryId, reason:String(v.reason || '').trim()}, function(err){ fin(err); });
    }});
}
