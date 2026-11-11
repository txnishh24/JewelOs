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
// Why a weight text was refused, in plain words (zero, negative, comma, too many decimals, too large).
function kgWeightProblem(text, label){
  var t = String(text == null ? '' : text).trim(), L = label || 'weight', cap = L.charAt(0).toUpperCase() + L.slice(1);
  if(t === '') return 'Enter the ' + L + ' in grams';
  if(/,/.test(t)) return 'Use a dot, not a comma (for example 12.5)';
  if(/^-/.test(t)) return cap + ' cannot be negative';
  if(!/^\d+(\.\d*)?$/.test(t)) return cap + ' must be a number like 12.5 (grams)';
  if(/\.$/.test(t)) return 'Write the decimals after the dot (for example 12.5)';
  if(/\.\d{4,}$/.test(t)) return cap + ' can have at most 3 decimals (milligrams)';
  if(/^0*(\.0*)?$/.test(t)) return cap + ' cannot be zero';
  return cap + ' is too large (the most allowed is ' + (KG_MAX_MG / 1000) + ' g) - check the decimal point';
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

// ── Karigar redesign, batch 1: purity in 0.01% units ("pu"), integers only, round half-up once per line ──
// pu: 9182 = 91.82%. Old entries carry permille (0.1% steps); kgPuOf reads either, so history never changes.
var KG_PU_MIN = 5000, KG_PU_MAX = 9999;       // typed purity guard: 50.00 to 99.99
var KG_PU_PURE = 10000;                         // the 999 chip counts as 100% (owner rule); never reachable by typing
var KG_PU_CONFIRM_LO = 5830, KG_PU_CONFIRM_HI = 9990; // outside this, or not a saved touch, the screen asks first
var KG_MG_PER_CT = 200;                         // 1 carat = 0.2 g
function kgPuOf(e){ return (e && e.pu != null) ? e.pu : ((e && e.permille != null) ? e.permille * 10 : null); }
// '91.82' -> 9182. null unless digits with at most 2 decimals (no float anywhere).
function kgPuFromText(v){
  var t = String(v == null ? '' : v).trim();
  if(!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  var p = t.split('.');
  return parseInt(p[0], 10) * 100 + parseInt(((p[1] || '') + '00').slice(0, 2), 10);
}
// saved: array of pu integers the shop already uses. Returns {pu} or {error} or {pu, confirm:'reason'}.
function kgCheckPurity(text, saved){
  var pu = kgPuFromText(text);
  if(pu === null) return {error:'Purity must be a number like 91.82 (two decimals at most)'};
  if(pu < KG_PU_MIN || pu > KG_PU_MAX) return {error:'Purity must be between 50 and 99.99'};
  var known = (saved || []).indexOf(pu) !== -1;
  if(pu < KG_PU_CONFIRM_LO || pu > KG_PU_CONFIRM_HI) return {pu:pu, confirm:'This purity is unusual. Is it right?'};
  if(!known) return {pu:pu, confirm:'This purity is not one you use often. Is it right?'};
  return {pu:pu};
}
function kgFineFromPu(mg, pu){
  if(mg < 0) return -kgFineFromPu(-mg, pu);
  return Math.floor((mg * pu + 5000) / 10000);
}
// net metal = gross - stones. null when the stone weight is not a whole mg or is more than the gross.
function kgNetMg(grossMg, stoneMg){
  var s = stoneMg || 0;
  if(!(grossMg > 0) || Math.floor(grossMg) !== grossMg || Math.floor(s) !== s || s < 0 || s > grossMg) return null;
  return grossMg - s;
}
// carat text (3 decimals at most) -> mg at 0.2 g per carat, rounded half-up once. null when invalid.
function kgCtToMg(v){
  var t = String(v == null ? '' : v).trim();
  if(!/^\d{1,5}(\.\d{1,3})?$/.test(t)) return null;
  var p = t.split('.');
  var milliCt = parseInt(p[0], 10) * 1000 + parseInt(((p[1] || '') + '000').slice(0, 3), 10);
  return Math.floor((milliCt * KG_MG_PER_CT + 500) / 1000);
}
// wastage points text '4' or '4.5' -> 400 / 450 (0.01 point units). 0 to 20 points. null when invalid.
function kgPointsFromText(v){
  var pt = kgPuFromText(v);
  return (pt === null || pt > 2000) ? null : pt;
}
// Wastage credit for one receipt: min(net x (measured touch + points) / 100, capMg).
// capMg = fine issued on the whole job minus credit already given on it (so batches never credit more than was issued).
// Returns {actualMg: fine really in the piece, rawMg: before the cap, creditMg: what reduces his account, capped}.
function kgWastageCredit(netMg, measuredPu, pointsPu, capMg){
  function whole(n){ return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }
  if(!whole(netMg) || netMg <= 0 || !whole(measuredPu) || measuredPu <= 0 || !whole(pointsPu) || pointsPu < 0 || !whole(capMg)) return {error:'Wastage credit needs whole numbers: net weight, measured touch, points and what is left to credit'};
  var actual = kgFineFromPu(netMg, measuredPu);
  var raw = kgFineFromPu(netMg, Math.min(measuredPu + pointsPu, KG_PU_PURE));   // never more than the metal in the piece (touch + points stops at 100%)
  var cap = Math.max(0, capMg || 0);
  return {actualMg:actual, rawMg:raw, creditMg:Math.min(raw, cap), capped:raw > cap};
}

// Built-in purities plus the touches the owner added (S.kgPurities, e.g. 92, 95, 96).
// Entries copy the permille at write time, so editing this list never changes history.
function kgPurityList(){
  var out = [], seen = {};
  KG_PURITIES.forEach(function(d){ if(d.key !== 'other'){ out.push(d); seen[d.key] = 1; } });
  (S.kgPurities || []).forEach(function(d){ if(d && d.key && !seen[d.key]){ out.push(d); seen[d.key] = 1; } });
  out.push(kgPurityDefBuiltin('other'));
  return out;
}
function kgPurityDefBuiltin(key){
  for(var i = 0; i < KG_PURITIES.length; i++) if(KG_PURITIES[i].key === key) return KG_PURITIES[i];
  return null;
}
function kgPurityDef(key){
  var b = kgPurityDefBuiltin(key);
  if(b) return b;
  var c = S.kgPurities || [];
  for(var i = 0; i < c.length; i++) if(c[i] && c[i].key === key) return c[i];
  return null;
}
// Resolve the fineness actually used. Returns {permille, as24k} or {error}.
function kgResolvePermille(key, pctText, as24k){
  var def = kgPurityDef(key);
  if(!def) return {error:'Unknown purity'};
  var hasPct = String(pctText == null ? '' : pctText).trim() !== '';
  if(def.custom) return {permille:def.permille, as24k:false};
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
  return u ? {name:(u.name || u.email || 'user'), role:(u.role || 'staff'), who:String(u.email || u.name || '').toLowerCase()} : {name:'system', role:'staff', who:''};
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
  var b = {issuedFine:0, receiptFine:0, scrapFine:0, returnedFine:0, approvedLoss:0, pendingLoss:0, adjust:0, carriedOut:0, transferIn:0, transferOut:0, concededFine:0};
  (ledger || []).forEach(function(e){
    if(e.jobId !== job.id || idx.reversed[e.id]) return;
    if(e.type === 'ISSUE' || e.type === 'CARRY_APPLY') b.issuedFine += e.fineMg;
    else if(e.type === 'CARRY_OUT') b.carriedOut += e.fineMg;
    else if(e.type === 'TRANSFER_IN') b.transferIn += e.fineMg;
    else if(e.type === 'TRANSFER_OUT') b.transferOut += e.fineMg;
    else if(e.type === 'RECEIPT'){ b.receiptFine += e.fineMg - (e.openingUseMg || 0); if(e.actualFineMg != null) b.concededFine += e.fineMg - e.actualFineMg; }   // the part drawn from his opening balance is not on the job
    else if(e.type === 'SCRAP') b.scrapFine += e.fineMg - (e.openingUseMg || 0);
    else if(e.type === 'ADJUST') b.adjust += e.fineMg;
    else if(e.type === 'LOSS'){
      var st = kgLossState(e, idx);
      if(st === 'approved') b.approvedLoss += e.fineMg;
      else if(st === 'pending') b.pendingLoss += e.fineMg;
    }
  });
  b.returnedFine = b.receiptFine + b.scrapFine + b.transferOut;
  // The wastage share is of fine gold ISSUED, never of the finished weight.
  b.percentFine = (job.kind === 'wastage' && job.model !== 'points') ? Math.round(b.issuedFine * (job.wastageBp || 0) / 10000) : 0;
  // Fixed gold per job (owner, 31 Oct): counted from the first issue, final when the job closes.
  b.fixedFine = (job.kind === 'wastage' && job.model !== 'points' && b.issuedFine > 0) ? (job.fixedMg || 0) : 0;
  b.earnedFine = b.percentFine + b.fixedFine;
  b.accountable = b.issuedFine + b.transferIn - b.earnedFine;
  b.openFine = b.accountable - b.returnedFine - b.approvedLoss - b.adjust - b.carriedOut;
  b.state = b.openFine > 0 ? 'open' : (b.openFine < 0 ? 'surplus' : 'balanced');
  if(job.model === 'points'){
    // A job is balanced only when every karigar on it is at zero: +2 for one and -2 for another is not balanced.
    var ids = {}, pos = false, neg = false;
    (ledger || []).forEach(function(e){ if(e.jobId === job.id && e.karigarId) ids[e.karigarId] = 1; });
    Object.keys(ids).forEach(function(kid){ var f = kgKarigarJobFine(job, ledger, kid, idx); if(f > 0) pos = true; else if(f < 0) neg = true; });
    b.state = neg ? 'surplus' : (pos ? 'open' : 'balanced');
    b.mixed = pos && neg;
  }
  return b;
}

// All jobs of one karigar rolled up (cancelled jobs ignored).
function kgKhata(karigarId){
  var t = {jobs:0, openJobs:0, issuedFine:0, earnedFine:0, returnedFine:0, approvedLoss:0, adjust:0, openFine:0, openSilver:0};
  (S.kgJobs || []).forEach(function(j){
    if(j.status === 'cancelled') return;
    if(j.model === 'points'){
      if(!kgJobKarigarOk(j, karigarId)) return;
      t.jobs++; if(j.status === 'open') t.openJobs++;
      return;
    }
    if(j.karigarId !== karigarId) return;
    var b = kgJobBalance(j, S.kgLedger || []);
    t.jobs++; if(j.status === 'open') t.openJobs++;
    t.issuedFine += b.issuedFine; t.earnedFine += b.earnedFine; t.returnedFine += b.returnedFine;
    t.approvedLoss += b.approvedLoss; t.adjust += b.adjust;
  });
  // What he holds in all: opening + on jobs + carried lots. Gold and silver are never added together.
  t.openFine = kgMetalAccount(karigarId, 'gold').totalMg;
  t.openSilver = kgMetalAccount(karigarId, 'silver').totalMg;
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

// Period report over the gold ledger. from/to are 'YYYY-MM-DD' (inclusive).
// Wastage kept is worked out per job on the fine gold ISSUED in the period, so a
// job issued across two months is split by when the metal actually went out.
function kgReport(from, to){
  var led = S.kgLedger || [], idx = kgIndex(led);
  var r = {wastage:[], losses:[], lossByCategory:{}, lossTotal:0, scrapByKind:{}, scrapTotal:0, scrapSilverTotal:0, conceded:[], concededTotal:0, open:[], surplus:[]};
  var cByK = {};
  var perJob = {};
  // A past period never changes when something is reversed later: an entry counts on the day it was made, and its reversal counts (as a minus) on the day the reversal was made.
  var apr = {};
  led.forEach(function(x){ if(x.type === 'APPROVAL') apr[x.refId] = x; });
  function inRange(d){ return d >= from && d <= to; }
  function count(e, sign, onDate, rev){
    if(!inRange(onDate)) return;
    if(e.type === 'RECEIPT' && e.actualFineMg != null && kgMetalOf(e) === 'gold' && e.fineMg > e.actualFineMg){ cByK[e.karigarId] = (cByK[e.karigarId] || 0) + sign * (e.fineMg - e.actualFineMg); r.concededTotal += sign * (e.fineMg - e.actualFineMg); }
    if(kgMetalOf(e) !== 'gold'){ if(e.type === 'SCRAP') r.scrapSilverTotal += sign * e.fineMg; return; }   // this report is the gold ledger; silver is never added in
    if(e.type === 'ISSUE') perJob[e.jobId] = (perJob[e.jobId] || 0) + sign * e.fineMg;
    else if(e.type === 'SCRAP') { r.scrapByKind[e.kind] = (r.scrapByKind[e.kind] || 0) + sign * e.fineMg; r.scrapTotal += sign * e.fineMg; }
    else if(e.type === 'LOSS'){
      var job = kgFindJob(e.jobId);
      r.losses.push({date:onDate, jobNo:job ? job.jobNo : '?', karigarId:e.karigarId, category:e.category, fineMg:sign * e.fineMg, reason:(rev ? rev.reason : e.reason), approvedBy:e.approvedBy || (apr[e.id] ? apr[e.id].by : ''), reversed:sign < 0});
      r.lossByCategory[e.category] = (r.lossByCategory[e.category] || 0) + sign * e.fineMg;
      r.lossTotal += sign * e.fineMg;
    }
  }
  led.forEach(function(e){
    if(e.type === 'REVERSAL'){
      var t = idx.byId[e.reversesId];
      if(t && t.type !== 'REVERSAL' && t.type !== 'APPROVAL' && (t.type !== 'LOSS' || !t.proposed || (apr[t.id] && apr[t.id].decision === 'approve'))) count(t, -1, e.date, e);
      return;
    }
    if(e.type === 'LOSS' && e.proposed){ var ap = apr[e.id]; if(ap && ap.decision === 'approve') count(e, 1, ap.date, null); return; }   // a proposed loss counts on the day the owner approved it
    count(e, 1, e.date, null);
  });
  var byK = {};
  Object.keys(perJob).forEach(function(jid){
    var job = kgFindJob(jid); if(!job || job.kind !== 'wastage' || !perJob[jid]) return;
    var t = byK[job.karigarId] || (byK[job.karigarId] = {karigarId:job.karigarId, issuedFine:0, keptFine:0, fixedFine:0});
    t.issuedFine += perJob[jid];
    t.keptFine += (perJob[jid] < 0 ? -1 : 1) * Math.round(Math.abs(perJob[jid]) * (job.wastageBp || 0) / 10000);
  });
  (S.kgJobs || []).forEach(function(j){
    if(j.status !== 'closed' || !j.earnings || !(j.earnings.fixedFine > 0)) return;
    var cd = new Date(j.closedAt), day = isNaN(cd.getTime()) ? '' : dbDayKey(cd); // local day, same as kgToday(); the UTC text is a day behind from midnight to 5:30 am IST
    if(day < from || day > to) return;
    var t = byK[j.karigarId] || (byK[j.karigarId] = {karigarId:j.karigarId, issuedFine:0, keptFine:0, fixedFine:0});
    t.fixedFine += j.earnings.fixedFine;
  });
  Object.keys(byK).forEach(function(k){ r.wastage.push(byK[k]); });
  Object.keys(cByK).forEach(function(k){ if(cByK[k] !== 0) r.conceded.push({karigarId:k, fineMg:cByK[k]}); });
  (S.kgJobs || []).forEach(function(j){
    if(j.status !== 'open' || kgMetalOf(j) !== 'gold') return;
    if(j.model === 'points'){
      // the same per-karigar figures as the job page: what each one holds, and who returned more than he was given
      var fs = kgJobKarigarFines(j), pos = fs.filter(function(f){ return f.fine > 0; }), neg = fs.filter(function(f){ return f.fine < 0; });
      if(pos.length) r.open.push({job:j, openFine:pos.reduce(function(t, f){ return t + f.fine; }, 0), byKarigar:pos});
      if(neg.length) r.surplus.push({job:j, openFine:neg.reduce(function(t, f){ return t + f.fine; }, 0), byKarigar:neg});
      return;
    }
    var b = kgJobBalance(j, led);
    if(b.state === 'open' && b.openFine > 0) r.open.push({job:j, openFine:b.openFine});
    else if(b.state === 'surplus') r.surplus.push({job:j, openFine:b.openFine});
  });
  return r;
}

// Save a gold touch the shop gives out often (92, 95, 96 ...). Owner only.
function kgAddPurity(pctText, done){
  var u = kgUser(), added = null, auditId = null;
  kgTxn('purities', function(){
    if(u.role !== 'owner') return 'Only the owner can add a touch';
    var pm = kgPctToPermille(pctText);
    if(pm === null || pm < 100 || pm > 1000) return 'Touch must be between 10 and 100';
    var key = 'T' + pm;
    if(kgPurityDef(key)) return 'That touch already exists';
    for(var i = 0; i < KG_PURITIES.length; i++) if(KG_PURITIES[i].permille === pm && KG_PURITIES[i].key !== 'other') return 'Already available as ' + KG_PURITIES[i].label;
    added = {key:key, label:(pm / 10) + ' touch', permille:pm, custom:true};
    S.kgPurities = S.kgPurities || [];
    S.kgPurities.push(added);
    auditId = kgAudit('kg_purity_add', 'kgPurity', key, added.label);
    return '';
  }, function(){
    S.kgPurities = S.kgPurities.filter(function(x){ return x.key !== added.key; });
    kgUndoAudit(auditId);
  }, function(err){ done(err, added); });
}

// \u2500\u2500 JOB MANAGEMENT (Karigar 2.0, phase 4) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Job lines (the pieces to make), a route of stages per product category (owner-defined, no
// default stages are invented), in-house/external, due date, cancel. Stages track PROGRESS.
// Gold custody stays on the job's karigar until phase 6 (transfers) -- a stage's "who" is a label.
var KG_MODES = ['inhouse', 'external'];
function kgRouteFor(category){
  var r = S.kgRoutes || [], any = null;
  for(var i = 0; i < r.length; i++){
    if(r[i].category === category) return r[i];
    if(r[i].category === '*') any = r[i];
  }
  return any;
}
function kgParseStages(text){
  var parts = String(text == null ? '' : text).split(/[,\n]/), out = [], seen = {};
  for(var i = 0; i < parts.length; i++){
    var n = parts[i].trim(); if(!n) continue;
    if(n.length > 30) return {error:'A stage name is too long (30 letters at most)'};
    var key = n.toLowerCase();
    if(seen[key]) return {error:'Stage "' + n + '" is repeated'};
    seen[key] = 1; out.push(n);
  }
  if(out.length > 12) return {error:'At most 12 stages in a route'};
  return {stages:out};
}
// category: a product category from CATS, or '*' for "any other category". Empty stages removes the route.
function kgSetRoute(category, stagesText, done){
  var u = kgUser(), before = JSON.stringify(S.kgRoutes || []), auditId = null;
  kgTxn('routes', function(){
    if(u.role !== 'owner') return 'Only the owner can change routes';
    if(category !== '*' && (CATS.indexOf(category) === -1 || category === 'All')) return 'Choose a product category';
    var p = kgParseStages(stagesText);
    if(p.error) return p.error;
    S.kgRoutes = (S.kgRoutes || []).filter(function(r){ return r.category !== category; });
    if(p.stages.length) S.kgRoutes.push({category:category, stages:p.stages});
    auditId = kgAudit('kg_route', 'kgRoute', category, p.stages.join(' > ') || 'removed');
    return '';
  }, function(){ S.kgRoutes = JSON.parse(before); kgUndoAudit(auditId); }, function(err){ done(err); });
}
function kgAddLine(jobId, f, opId, done){
  var job = kgFindJob(jobId), u = kgUser(), line = null, auditId = null;
  if(job){ var all = job.lines || []; for(var i = 0; i < all.length; i++) if(all[i].opId === opId){ done(null, all[i], true); return; } }
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can edit a job';
    if(job.status !== 'open') return 'Job is ' + job.status;
    var desc = String(f.desc || '').trim();
    if(!desc || desc.length > 60) return 'Describe the piece (60 letters at most)';
    if(!/^\d{1,4}$/.test(String(f.qty == null ? '' : f.qty).trim()) || parseInt(f.qty, 10) < 1) return 'Quantity must be 1 or more';
    var tg = String(f.targetGrams == null ? '' : f.targetGrams).trim(), tmg = 0;
    if(tg !== ''){ tmg = kgParseMg(tg); if(tmg === null) return 'Target weight is not valid (grams, up to 3 decimals)'; }
    line = {id:kgNewId(), opId:opId, desc:desc, qty:parseInt(f.qty, 10), targetMg:tmg, void:null, at:new Date().toISOString(), by:u.name};
    job.lines = (job.lines || []).concat([line]);
    auditId = kgAudit('kg_line_add', 'kgJob', jobId, desc + ' x' + line.qty);
    return '';
  }, function(){ job.lines = job.lines.filter(function(x){ return x.id !== line.id; }); kgUndoAudit(auditId); }, function(err){ done(err, line, false); });
}
function kgVoidLine(jobId, lineId, reason, done){
  var job = kgFindJob(jobId), u = kgUser(), line = null, auditId = null;
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can edit a job';
    if(job.status !== 'open') return 'Job is ' + job.status;
    (job.lines || []).forEach(function(l){ if(l.id === lineId) line = l; });
    if(!line) return 'Line not found';
    if(line.void) return 'Already removed';
    if(String(reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    line.void = {reason:String(reason).trim(), by:u.name, at:new Date().toISOString()};
    auditId = kgAudit('kg_line_void', 'kgJob', jobId, line.desc);
    return '';
  }, function(){ line.void = null; kgUndoAudit(auditId); }, function(err){ done(err); });
}
// action: 'start' | 'done' | 'undo' (owner) | 'who' (arg = karigar id or '')
function kgStageAction(jobId, stageId, action, arg, done){
  var job = kgFindJob(jobId), u = kgUser(), st = null, snap = null, auditId = null;
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can update a job';
    if(job.status !== 'open') return 'Job is ' + job.status;
    var stages = job.stages || [], at = -1;
    stages.forEach(function(x, i){ if(x.id === stageId){ st = x; at = i; } });
    if(!st) return 'Stage not found';
    snap = JSON.stringify(st);
    var now = new Date().toISOString(), j;
    if(action === 'start'){
      if(st.status !== 'pending') return 'This stage was already started';
      for(j = 0; j < at; j++) if(stages[j].status !== 'done') return 'Finish "' + stages[j].name + '" first';
      st.status = 'active'; st.startedAt = now;
    } else if(action === 'done'){
      if(st.status !== 'active') return 'Start this stage first';
      st.status = 'done'; st.doneAt = now;
    } else if(action === 'undo'){
      if(u.role !== 'owner') return 'Only the owner can undo a stage';
      for(j = at + 1; j < stages.length; j++) if(stages[j].status !== 'pending') return 'Undo "' + stages[j].name + '" first';
      if(st.status === 'done'){ st.status = 'active'; delete st.doneAt; }
      else if(st.status === 'active'){ st.status = 'pending'; delete st.startedAt; }
      else return 'Nothing to undo';
    } else if(action === 'who'){
      if(arg && !findKarigar(arg)) return 'Karigar not found';
      if((S.kgLedger || []).some(function(x){ return x.jobId === jobId && x.stageId === st.id; })) return 'Metal has already been recorded on this stage. Hand it over to the next karigar instead of changing who it belongs to';
      st.who = arg || ''; kgSnapTerms(job, arg);
    } else return 'Unknown stage action';
    st.log = (st.log || []).concat([{action:action, at:now, by:u.name, arg:(action === 'who' ? (arg || '') : '')}]);
    auditId = kgAudit('kg_stage_' + action, 'kgJob', jobId, job.jobNo + ' ' + st.name);
    return '';
  }, function(){
    var old = JSON.parse(snap);
    Object.keys(st).forEach(function(x){ if(!(x in old)) delete st[x]; });
    Object.keys(old).forEach(function(x){ st[x] = old[x]; });
    kgUndoAudit(auditId);
  }, function(err){ done(err); });
}
// Only a job with no gold out can be cancelled; otherwise it must be returned and closed.
function kgCancelJob(jobId, reason, done){
  var job = kgFindJob(jobId), u = kgUser(), auditId = null;
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(u.role !== 'owner') return 'Only the owner can cancel a job';
    if(job.status !== 'open') return 'Job is ' + job.status;
    if(String(reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    var b = kgJobBalance(job, S.kgLedger || []);
    if(b.issuedFine !== 0) return 'Gold has been issued on this job - return it and close the job instead';
    if(b.pendingLoss > 0) return 'A proposed loss is waiting - reject it first';
    var cIdx = kgIndex(S.kgLedger || []);
    for(var ci = 0; ci < (S.kgLedger || []).length; ci++){
      var ce = S.kgLedger[ci];
      if(ce.jobId === job.id && (ce.type === 'RECEIPT' || ce.type === 'SCRAP') && ce.openingUseMg > 0 && !cIdx.reversed[ce.id]) return 'A receipt or scrap on this job drew from his opening balance - reverse it first';
    }
    job.status = 'cancelled'; job.cancelledAt = new Date().toISOString(); job.cancelledBy = u.name; job.cancelReason = String(reason).trim();
    auditId = kgAudit('kg_job_cancel', 'kgJob', jobId, job.jobNo + ': ' + job.cancelReason);
    return '';
  }, function(){ job.status = 'open'; delete job.cancelledAt; delete job.cancelledBy; delete job.cancelReason; kgUndoAudit(auditId); },
  function(err){ done(err); });
}
function kgJobOverdueDays(job, today){
  if(!job || job.status !== 'open' || !job.dueDate || job.dueDate >= today) return 0;
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(job.dueDate + 'T00:00:00Z')) / 86400000);
}
function kgStagesSummary(job){
  var st = job.stages || [], t = {total:st.length, done:0, active:null, next:null};
  st.forEach(function(x){
    if(x.status === 'done') t.done++;
    else if(x.status === 'active' && !t.active) t.active = x;
    else if(x.status === 'pending' && !t.next) t.next = x;
  });
  return t;
}
// Everything the Today screen shows, derived on read.
function kgDashboard(){
  var led = S.kgLedger || [], today = kgToday();
  var d = {withKarigarFine:kgHeldFine('gold'), withKarigarSilver:kgHeldFine('silver'), openJobs:0, overdue:[], pendingApprovals:[], surplus:[], readyToClose:[]};
  (S.kgJobs || []).forEach(function(j){
    if(j.status !== 'open') return;
    d.openJobs++;
    var b = kgJobBalance(j, led), od = kgJobOverdueDays(j, today), sm = kgStagesSummary(j);
    if(od > 0) d.overdue.push({job:j, days:od});
    if(b.pendingLoss > 0) d.pendingApprovals.push({job:j, fine:b.pendingLoss});
    if(j.model === 'points'){ kgJobKarigarFines(j).forEach(function(x){ if(x.fine < 0) d.surplus.push({job:j, fine:-x.fine}); }); }
    else if(b.state === 'surplus') d.surplus.push({job:j, fine:-b.openFine});
    if(sm.total > 0 && sm.done === sm.total) d.readyToClose.push({job:j, openFine:(j.model === 'points' ? kgJobKarigarFines(j).reduce(function(t, x){ return t + Math.abs(x.fine); }, 0) : b.openFine)});
  });
  d.overdue.sort(function(a, b){ return b.days - a.days; });
  return d;
}

function kgSalaryBalance(karigarId){
  var rev = {}, t = {accrued:0, deducted:0, advanced:0, paid:0};
  (S.kgSalary || []).forEach(function(e){ if(e.type === 'REVERSAL') rev[e.reversesId] = true; });
  (S.kgSalary || []).forEach(function(e){
    if(e.karigarId !== karigarId || e.type === 'REVERSAL' || rev[e.id]) return;
    if(e.type === 'ACCRUAL' || e.type === 'JOB_LABOUR' || (e.type === 'OPENING' && e.dir === 'owe')) t.accrued += e.amountPaise;
    else if(e.type === 'OPENING') t.advanced += e.amountPaise;
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
  if(e.openingUseMg != null && e.openingUseMg !== 0 && e.type !== 'RECEIPT' && e.type !== 'SCRAP') return 'Only a receipt or scrap can draw from an opening balance';
  if(!job && e.jobId === '') return kgValidateKarigarLevel(e, ctx);
  if(!job) return 'Job not found';
  if(e.openingUseMg && job.model !== 'points') return 'Only a points job can draw from an opening balance';
  if(job.status !== 'open') return 'Job is ' + job.status + ' - reopen it first';
  var t = e.type, idx = kgIndex(ledger), tgt;
  var metalType = (t === 'ISSUE' || t === 'RECEIPT' || t === 'SCRAP');
  // route on the job's own rules, never on the shape of the entry: a points job takes only points entries, an old job only old ones
  if(KG_V3_JOB_TYPES[t] || (metalType && (job.model === 'points' || e.pu != null))) return kgValidateV3(e, ctx, idx);
  var ref = (t === 'REVERSAL') ? idx.byId[e.reversesId] : (t === 'APPROVAL' ? idx.byId[e.refId] : null);
  if(job.model === 'points' && !ref){ if(!kgJobKarigarOk(job, e.karigarId)) return 'Karigar is not on this job'; }
  else if(e.karigarId !== (ref ? ref.karigarId : job.karigarId)) return 'Karigar does not match the job';
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
    if(job.model === 'points' && e.fineMg > kgKarigarJobFine(job, ledger, e.karigarId, idx) - kgPendingLoss(ledger, idx, job, e.karigarId, '')) return 'He does not hold that much on this job (losses already waiting for approval count too)';
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
    if(e.decision === 'approve' && job.model === 'points' && tgt.fineMg > kgKarigarJobFine(job, ledger, tgt.karigarId, idx) - kgPendingLoss(ledger, idx, job, tgt.karigarId, tgt.id)) return 'He no longer holds that much on this job';
    return '';
  }
  if(t === 'REVERSAL'){
    tgt = idx.byId[e.reversesId];
    if(!tgt || tgt.jobId !== job.id) return 'Entry not found on this job';
    if(tgt.type === 'REVERSAL' || tgt.type === 'APPROVAL') return 'This entry cannot be reversed';
    if((tgt.type === 'CARRY_OUT' || tgt.type === 'TRANSFER_OUT' || tgt.type === 'TRANSFER_IN') && !e.pair) return 'This entry is reversed together with its pair';
    if(idx.reversed[tgt.id]) return 'Already reversed';
    if(job.model === 'points' && (tgt.type === 'TRANSFER_IN' || tgt.type === 'ISSUE' || tgt.type === 'CARRY_APPLY') && kgKarigarJobFine(job, ledger, tgt.karigarId, idx) < tgt.fineMg) return 'He has already returned or passed on some of that metal - reverse that first';
    if(tgt.type === 'SCRAP'){ for(var rc = 0; rc < ledger.length; rc++) if(ledger[rc].type === 'REFINE_CREDIT' && ledger[rc].refId === tgt.id && !idx.reversed[ledger[rc].id]) return 'Reverse the assay result of this lot first'; }
    if(tgt.type === 'LOSS' && tgt.settle === 'cash' && kgLiveLossBill(ctx.salary, tgt.id)) return 'Reverse the loss bill first';
    if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    if(role === 'owner') return '';
    if(role === 'manager' && tgt.date === kgToday()) return '';
    // points jobs: a manager may also correct an earlier-day metal movement that a manager (not the owner) recorded. ADJUST, loss and owner entries stay owner-only.
    if(role === 'manager' && job.model === 'points' && tgt.role !== 'owner' && ['ISSUE', 'RECEIPT', 'SCRAP', 'CARRY_APPLY', 'CARRY_OUT', 'TRANSFER_OUT', 'TRANSFER_IN'].indexOf(tgt.type) !== -1) return '';
    return 'Only the owner can reverse an entry from an earlier day';
  }
  return 'Unknown entry type';
}

// Losses proposed by a manager and not yet decided, for one karigar on one job (optionally leaving one out).
function kgPendingLoss(ledger, idx, job, kid, exceptId){
  var t = 0;
  (ledger || []).forEach(function(x){
    if(x.type === 'LOSS' && x.jobId === job.id && x.karigarId === kid && x.id !== exceptId && kgLossState(x, idx) === 'pending') t += x.fineMg;
  });
  return t;
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
    if(tgt.type === 'JOB_LABOUR') return 'Reopen the job to reverse its labour';
    if(already) return 'Already reversed';
    if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    return '';
  }
  if(['ACCRUAL','ADVANCE','PAYMENT','DEDUCTION','OPENING'].indexOf(e.type) === -1) return 'Unknown entry type';
  if(!(e.amountPaise > 0) || Math.floor(e.amountPaise) !== e.amountPaise) return 'Amount is not valid';
  if(e.type === 'OPENING'){
    if(e.dir !== 'owe' && e.dir !== 'advance') return 'Say whether you owe him or he owes you';
    if(String(e.note || '').trim().length < 3) return 'A note is required';
    var gone = {};
    all.forEach(function(x){ if(x.type === 'REVERSAL') gone[x.reversesId] = true; });
    for(var q = 0; q < all.length; q++) if(all[q].type === 'OPENING' && all[q].karigarId === k.id && !gone[all[q].id]) return 'An opening balance is already entered - reverse it first';
    return '';
  }
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
  if(_kgLocks[lockKey]){ var busy = new Error('Another save is in progress - try again'); busy.transient = true; onDone(busy); return; }
  _kgLocks[lockKey] = true;
  var err = apply();
  if(err){ delete _kgLocks[lockKey]; onDone(new Error(err)); return; }
  saveToCloud(function(e){
    delete _kgLocks[lockKey];
    if(e){
      undo();
      saveCache();
      if(e.message !== 'version-conflict') toast(SAVE_RETRY_MSG);
      var ne = new Error(e.message === 'version-conflict' ? 'Another device saved changes first. Nothing was saved - reload and try again.' : 'Could not save - check the internet and try again. Nothing was saved.');
      ne.transient = true; // a failed save is worth retrying; a refusal from apply() is not
      ne.cause = e;
      return onDone(ne);
    }
    onDone(null);
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

// With the shop's ledger flag on (S.kgLedgerOn === true), gold entries go to the server ledger first and the blob entry
// is only saved after the server gives a definite answer. The flag is asked of the server (kgLoadLedgerFlag), never stored in the
// shop data; the owner switches it on Reports (kg2ToggleLedger). shortcut: APPROVAL, REVERSAL and proposed-LOSS
// entries are refused while it is on; add them with the Task 4 screens.
function kgLedgerJournalFor(entry){
  var covered = {ISSUE:1, RECEIPT:1, SCRAP:1, ADJUST:1, LOSS:1};
  if(!covered[entry.type] || (entry.type === 'LOSS' && entry.proposed))
    return {error:'This entry is not available while the ledger is on yet. Nothing was saved.'};
  return kgBuildJournal(entry.type, {opId:entry.opId, jobId:entry.jobId, karigarId:entry.karigarId, mg:entry.mg, permille:entry.permille,
    fineMg:(entry.type === 'ADJUST' ? -entry.fineMg : entry.fineMg), // the shop data's credit lowers what the karigar holds; on the ledger that is custody going down
    date:entry.date, note:entry.reason || entry.note || '', approve:entry.type === 'LOSS'});
}
function kgAddEntryLedger(entry, done){
  var job = kgFindJob(entry.jobId), u = kgUser();
  kgStamp(entry);
  if(job && !entry.karigarId) entry.karigarId = job.karigarId;
  // a retry keeps the first attempt's date: the server fingerprints business_date, so a new day would look like new content
  kgOutboxList().forEach(function(x){ if(x.op_id === entry.opId && kgValidDateKey(x.business_date)) entry.date = x.business_date; });
  var postedDay = kgPostedDate(entry.opId); if(postedDay) entry.date = postedDay;
  var jb = kgLedgerJournalFor(entry);
  if(jb.error) return done(new Error(jb.error), entry, false);
  // Same id, changed figures: the first try may already be on the server, and sending the edit would be refused and
  // would drop the queued original. Tell the user to confirm the first one unchanged.
  var queued = kgOutboxList().filter(function(x){ return x.op_id === entry.opId; })[0];
  if(queued && (JSON.stringify(queued.lines) !== JSON.stringify(jb.journal.lines) || queued.type !== jb.journal.type || queued.job_id !== jb.journal.job_id))
    return done(new Error('Your earlier try is still being confirmed. Tap Save without changing anything, or Cancel and check the ledger.'), entry, false);
  var bad = kgValidateEntry(entry, {job:job, ledger:S.kgLedger, role:u.role});
  if(bad) return done(new Error(bad), entry, false);
  if(typeof navigator !== 'undefined' && navigator.onLine === false)
    return done(new Error('Gold entries need internet while the ledger is on. Nothing was saved.'), entry, false);
  jb.journal._entry = entry; // kept with the queued journal on this device so a flush can finish the shop-data side
  kgPostJournal(jb.journal, function(err){
    if(err && (err.code === 'offline' || err.code === 'outdated')){
      var p = new Error(err.code === 'outdated' || err.reauth ? err.message : 'Sending, not confirmed. The gold may already be recorded. Tap Save again to confirm.');
      p.code = 'pending'; return done(p, entry, false);
    }
    if(err) return done(err, entry, false);
    kgCommitEntry(entry, job, u, function(e){
      if(!e) return done(null, entry, false);
      // The ledger has it already. Hand it to the same finisher a flush uses: it re-queues on a failed save and parks a real refusal.
      kgFinishQueued(jb.journal, function(e2){
        for(var d = 0; d < S.kgLedger.length; d++) if(S.kgLedger[d].opId === entry.opId) return done(null, entry, false);
        if(e2) return done(new Error('Recorded on the ledger but not saved to the shop yet. It is kept on this phone and finishes by itself. Tap Save again to finish now.'), entry, false);
        done(new Error('The ledger took this entry but the shop data refused it. It is listed on Reports under "Ledger has this". Check it there.'), entry, false);
      });
    });
  });
}

// done(err, entry, duplicate)
function kgAddEntry(entry, done){
  S.kgLedger = S.kgLedger || [];
  for(var i = 0; i < S.kgLedger.length; i++){
    if(S.kgLedger[i].opId === entry.opId){ done(null, S.kgLedger[i], true); return; }
  }
  if(_kgFlagUnknown){ try{ kgLoadLedgerFlag(); }catch(e){} return done(new Error('Checking whether the ledger is on. Try again in a moment. Nothing was saved.'), entry, false); }
  if(S.kgLedgerOn === true){
    var jOn = kgFindJob(entry.jobId);
    if(entry.pu != null || (jOn && jOn.model === 'points')) return done(new Error('New karigar entries are not available while the ledger is on yet. Nothing was saved.'), entry, false);
    return kgAddEntryLedger(entry, done);
  }
  var job = kgFindJob(entry.jobId), u = kgUser();
  kgStamp(entry);
  if(job && !entry.karigarId) entry.karigarId = job.karigarId;
  kgCommitEntry(entry, job, u, function(err){ done(err, entry, false); });
}
function kgCommitEntry(entry, job, u, onDone){
  var auditId = null, added = false, termsUndo = null;
  kgTxn('job:' + entry.jobId, function(){
    var err = kgValidateEntry(entry, {job:job, ledger:S.kgLedger, role:u.role, karigar:findKarigar(entry.karigarId), salary:S.kgSalary || []});
    if(err) return err;
    for(var d = 0; d < S.kgLedger.length; d++) if(S.kgLedger[d].opId === entry.opId) return ''; // already there: add nothing
    added = true;
    termsUndo = kgFreezeTerms(job, entry);
    S.kgLedger.push(entry);
    auditId = kgAudit('kg_' + entry.type.toLowerCase(), 'kgJob', entry.jobId,
      entry.type + (entry.fineMg != null ? ' ' + kgFmtG(entry.fineMg) + ' fine' : ''));
    return '';
  }, function(){
    if(!added) return; // nothing of ours to undo: the first copy stays
    S.kgLedger = S.kgLedger.filter(function(x){ return x.id !== entry.id; });
    if(termsUndo) termsUndo();
    kgUndoAudit(auditId);
  }, onDone);
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
    var ag = kgAgreementFor(k.id, kgToday()), src = ag || k;
    if(src.kind !== 'wastage' && src.kind !== 'salary') return 'Set this karigar\'s terms (wastage or salary) first';
    var title = String(fields.title || '').trim();
    if(!title || title.length > 80) return 'Give the job a short title';
    var mode = fields.mode || 'inhouse';
    if(KG_MODES.indexOf(mode) === -1) return 'Choose in-house or external';
    var ws = (mode === 'external') ? String(fields.workshop || '').trim() : '';
    if(ws.length > 40) return 'Workshop name is too long';
    var due = String(fields.dueDate || '').trim();
    if(due){ if(!kgValidDateKey(due)) return 'Due date must be a real date (YYYY-MM-DD)'; if(due < kgToday()) return 'Due date is in the past'; }
    var cat = String(fields.category || '').trim();
    if(cat.length > 40) return 'Category is too long';
    if(fields.orderId && !(S.orders || []).some(function(o){ return o.id === fields.orderId && o.status !== 'cancelled' && o.status !== 'delivered'; })) return 'That customer order was not found or is already closed';
    var pts = null, jmetal = 'gold', jtag = '', jpieces = 0;
    if(fields.model === 'points'){
      jmetal = fields.metal || 'gold'; if(KG_METALS.indexOf(jmetal) === -1) return 'Choose gold or silver';
      if(String(fields.pointsText || '').trim() !== ''){ pts = kgPointsFromText(fields.pointsText); if(pts === null) return 'Wastage points must be 0 to 20'; }
      jtag = String(fields.tag || '').trim(); if(jtag.length > 30) return 'Tag is too long';
      if(String(fields.pieceCount || '').trim() !== ''){ if(!/^\d{1,4}$/.test(String(fields.pieceCount).trim())) return 'Piece count must be a whole number'; jpieces = parseInt(fields.pieceCount, 10); }
    }
    var route = cat ? kgRouteFor(cat) : null;
    var no = String(prevNo); while(no.length < 4) no = '0' + no;
    job = {id:kgNewId(), opId:opId, jobNo:'KJ-' + no, karigarId:k.id, title:title,
           kind:src.kind, wastageBp:(src.kind === 'wastage' ? (src.wastageBp != null ? src.wastageBp : KG_DEFAULT_WASTAGE_BP) : 0),
           fixedMg:(src.kind === 'wastage' ? (src.fixedMg || 0) : 0), labour:(src.kind === 'wastage' && src.labour ? src.labour : null),
           agreementId:(ag ? ag.id : null),
           category:cat, mode:mode, workshop:ws, dueDate:due, lines:[],
           stages:(route ? route.stages.map(function(n){ return {id:kgNewId(), name:n, status:'pending', who:'', log:[]}; }) : []),
           status:'open', orderRef:(fields.orderId ? {orderId:fields.orderId} : null),
           createdAt:new Date().toISOString(), createdBy:u.name};
    if(fields.model === 'points'){ job.model = 'points'; job.metal = jmetal; job.pointsPu = pts; job.tag = jtag; job.pieceCount = jpieces; job.wastageBp = 0; job.fixedMg = 0; job.labour = null; kgSnapTerms(job, k.id); }
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

function kgCloseJob(jobId, done, opts){
  var job = kgFindJob(jobId), u = kgUser(), auditId = null, labourEntry = null, pre = null;
  if(job && opts && opts.opId && job.closeOpId === opts.opId) return done(null, job, true);   // a retry of a close that already went through
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can close a job';
    if(job.status !== 'open') return 'Job is not open';
    var b = kgJobBalance(job, S.kgLedger || []);
    if(b.pendingLoss > 0) return 'A proposed loss is waiting for owner approval';
    if(job.model === 'points'){
      var held = kgJobKarigarFines(job);
      for(var hk = 0; hk < held.length; hk++) if(held[hk].fine < 0) return 'A karigar has returned more than he was given - fix it with an owner adjustment first';
    }
    if(opts && opts.settle && b.openFine !== 0){
      pre = kgCloseSettle(job, u, opts);
      if(pre.err){ var pe = pre.err; pre = null; return pe; }
      b = kgJobBalance(job, S.kgLedger || []);
    }
    if(b.openFine !== 0){ if(pre){ pre.undo(); pre = null; } return 'Balance is ' + kgFmtG(b.openFine) + ' fine - record the metal, an owner-approved loss or an owner adjustment first'; }
    // Earnings are final from here (owner, 31 Oct: "when the job closes"). Net and fine weight
    // of the finished pieces are summed once and frozen on the job.
    var idx = kgIndex(S.kgLedger || []), net = 0, fineRet = 0;
    (S.kgLedger || []).forEach(function(e){
      if(e.jobId === job.id && e.type === 'RECEIPT' && !idx.reversed[e.id]){ net += e.mg; fineRet += (e.actualFineMg != null ? e.actualFineMg : e.fineMg); }
    });
    var lab = job.labour, labourPaise = 0;
    if(lab && lab.perGramPaise > 0) labourPaise = Math.round(lab.perGramPaise * (lab.base === 'fine' ? fineRet : net) / 1000);
    job.status = 'closed'; job.closedAt = new Date().toISOString(); job.closedBy = u.name; if(opts && opts.opId) job.closeOpId = opts.opId;
    job.earnings = {at:job.closedAt, by:u.name, issuedFine:b.issuedFine, percentFine:b.percentFine, fixedFine:b.fixedFine,
                    earnedFine:b.earnedFine, netMg:net, fineMg:fineRet, labourBase:(lab ? lab.base : ''), labourPaise:labourPaise};
    if(labourPaise > 0){
      S.kgSalary = S.kgSalary || [];
      labourEntry = kgStamp({type:'JOB_LABOUR', opId:'jl-' + kgNewId(), karigarId:job.karigarId, jobId:job.id, amountPaise:labourPaise, base:lab.base});
      S.kgSalary.push(labourEntry);
    }
    auditId = kgAudit('kg_job_close', 'kgJob', jobId, job.jobNo + (labourPaise > 0 ? ' labour ' + kgFmtRs(labourPaise) : ''));
    return '';
  }, function(){
    if(pre) pre.undo();
    job.status = 'open'; delete job.closedAt; delete job.closedBy; delete job.earnings; delete job.closeOpId;
    if(labourEntry) S.kgSalary = S.kgSalary.filter(function(x){ return x.id !== labourEntry.id; });
    kgUndoAudit(auditId);
  }, function(err){ done(err, job, false); });
}
function kgReopenJob(jobId, done){
  var job = kgFindJob(jobId), u = kgUser(), auditId = null, oldEarnings = null, reversal = null;
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(u.role !== 'owner') return 'Only the owner can reopen a job';
    if(job.status !== 'closed') return 'Job is not closed';
    oldEarnings = job.earnings || null;
    var sal = S.kgSalary || [], gone = {};
    sal.forEach(function(x){ if(x.type === 'REVERSAL') gone[x.reversesId] = true; });
    var jl = null;
    sal.forEach(function(x){ if(x.type === 'JOB_LABOUR' && x.jobId === job.id && !gone[x.id]) jl = x; });
    if(jl){
      reversal = kgStamp({type:'REVERSAL', opId:'jr-' + kgNewId(), karigarId:job.karigarId, reversesId:jl.id, reason:'Job reopened'});
      S.kgSalary.push(reversal);
    }
    job.earningsLog = (job.earningsLog || []).concat(oldEarnings ? [oldEarnings] : []);
    job.earnings = null;
    delete job.closeOpId; job.status = 'open'; job.reopenedAt = new Date().toISOString();
    auditId = kgAudit('kg_job_reopen', 'kgJob', jobId, job.jobNo);
    return '';
  }, function(){
    job.status = 'closed'; delete job.reopenedAt; job.earnings = oldEarnings;
    if(oldEarnings) job.earningsLog = job.earningsLog.slice(0, -1);
    if(reversal) S.kgSalary = S.kgSalary.filter(function(x){ return x.id !== reversal.id; });
    kgUndoAudit(auditId);
  }, function(err){ done(err); });
}

// terms: {kind:'wastage'|'salary', wastagePct:'4', salaryMode:'monthly'|'daily', rate:'30000'}
function kgSetTerms(karigarId, terms, done){
  kgAddAgreement(karigarId, terms, kgToday(), terms.opId || kgNewId(), function(err){ done(err); });
}

// \u2500\u2500 AGREEMENTS (Karigar 2.0, phase 3) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Versioned compensation terms with an effective date. A version is never edited: a newer
// one supersedes it from its date (same-day replacements: the later one wins). A job copies
// the terms in force the day it is created, so changing terms never touches work already
// handed out. Each karigar is EITHER wastage OR fixed salary (owner, 31 Oct), never both.
//   wastage: percent of fine gold issued (default 4) + optional fixed gold per job
//            + optional per-gram labour on net or fine weight of the finished pieces
//   salary : monthly or daily rate; no gold earning and no per-gram labour
function kgValidDateKey(t){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(t || ''))) return false;
  var d = new Date(t + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
}
function kgAgreementFor(karigarId, dateKey){
  var best = null;
  (S.kgAgreements || []).forEach(function(a){
    if(!a || a.karigarId !== karigarId || a.effectiveFrom > dateKey) return;
    if(!best || a.effectiveFrom >= best.effectiveFrom) best = a;
  });
  return best;
}
function kgAgreementHistory(karigarId){
  return (S.kgAgreements || []).filter(function(a){ return a && a.karigarId === karigarId; })
    .sort(function(a, b){ return a.effectiveFrom < b.effectiveFrom ? -1 : (a.effectiveFrom > b.effectiveFrom ? 1 : 0); });
}
// '+1 point' / '+4 points' / 'Wastage points not set'
function kgPointsLabel(pu){
  if(pu == null) return 'Wastage points not set';
  var n = pu / 100;
  return '+' + n + (n === 1 ? ' point' : ' points');
}
function kgAgreementText(a){
  if(!a || (a.kind !== 'wastage' && a.kind !== 'salary')) return 'Terms not set';
  if(a.kind === 'salary') return 'Salary ' + (a.salary ? a.salary.mode + ' ' + kgFmtRs(a.salary.ratePaise) : '');
  var t = (a.wastagePoints != null) ? ('Wastage ' + kgPointsLabel(a.wastagePoints)) : ('Wastage ' + ((a.wastageBp != null ? a.wastageBp : KG_DEFAULT_WASTAGE_BP) / 100) + '%');
  if(a.fixedMg > 0) t += ' + ' + kgFmtG(a.fixedMg) + ' per job';
  if(a.labour && a.labour.perGramPaise > 0) t += ' + labour ' + kgFmtRs(a.labour.perGramPaise) + '/g on ' + a.labour.base + ' weight';
  return t;
}
// terms: {kind, wastagePct, fixedGrams, labourRate, labourBase, salaryMode, rate}. Returns {error} or the fields.
function kgParseAgreementTerms(terms){
  if(terms.kind === 'wastage'){
    var txt = String(terms.wastagePct == null ? '' : terms.wastagePct).trim(), bp = KG_DEFAULT_WASTAGE_BP;
    if(txt !== ''){
      if(!/^\d{1,2}(\.\d{1,2})?$/.test(txt)) return {error:'Wastage % is not valid'};
      bp = Math.round(parseFloat(txt) * 100);
    }
    if(bp < 0 || bp > 5000) return {error:'Wastage % must be 0 to 50'};
    var fixedMg = 0, ft = String(terms.fixedGrams == null ? '' : terms.fixedGrams).trim();
    if(ft !== ''){ fixedMg = kgParseMg(ft); if(fixedMg === null) return {error:'Fixed gold per job is not valid (grams, up to 3 decimals)'}; }
    var labour = null, lt = String(terms.labourRate == null ? '' : terms.labourRate).trim();
    if(lt !== ''){
      var pg = kgParsePaise(lt);
      if(pg === null) return {error:'Labour per gram is not valid'};
      if(terms.labourBase !== 'net' && terms.labourBase !== 'fine') return {error:'Choose net or fine weight for the labour'};
      labour = {perGramPaise:pg, base:terms.labourBase};
    }
    var wp = null, wpt = String(terms.points == null ? '' : terms.points).trim();
    if(wpt !== ''){ wp = kgPointsFromText(wpt); if(wp === null) return {error:'Wastage points must be 0 to 20'}; }
    return {kind:'wastage', wastageBp:bp, fixedMg:fixedMg, labour:labour, salary:null, wastagePoints:wp};
  }
  if(terms.kind === 'salary'){
    if(String(terms.fixedGrams || '').trim() !== '' || String(terms.labourRate || '').trim() !== '') return {error:'A salary karigar has no gold earning or per-gram labour'};
    if(terms.salaryMode !== 'monthly' && terms.salaryMode !== 'daily') return {error:'Choose monthly or daily'};
    var paise = kgParsePaise(terms.rate);
    if(paise === null) return {error:'Salary rate is not valid'};
    return {kind:'salary', wastageBp:null, fixedMg:0, labour:null, salary:{mode:terms.salaryMode, ratePaise:paise}};
  }
  return {error:'Choose wastage or salary'};
}
// keep the karigar record showing the terms in force today (older screens and V1 read these)
function kgMirrorTerms(k, a){
  if(!a) return;
  k.kind = a.kind;
  if(a.kind === 'wastage'){ k.wastageBp = a.wastageBp; k.fixedMg = a.fixedMg; k.labour = a.labour; k.wastagePoints = (a.wastagePoints != null ? a.wastagePoints : null); delete k.salary; }
  else { k.salary = a.salary; delete k.wastageBp; delete k.fixedMg; delete k.labour; delete k.wastagePoints; }
}
function kgAddAgreement(karigarId, terms, effectiveFrom, opId, done){
  S.kgAgreements = S.kgAgreements || [];
  for(var i = 0; i < S.kgAgreements.length; i++){
    if(S.kgAgreements[i].opId === opId){ done(null, S.kgAgreements[i], true); return; }
  }
  var k = findKarigar(karigarId), u = kgUser(), before = k ? JSON.stringify(k) : null, ag = null, auditId = null;
  kgTxn('karigar:' + karigarId, function(){
    if(u.role !== 'owner') return 'Only the owner can change compensation terms';
    if(!k) return 'Karigar not found';
    if(!kgValidDateKey(effectiveFrom)) return 'Effective date must be a real date (YYYY-MM-DD)';
    var p = kgParseAgreementTerms(terms);
    if(p.error) return p.error;
    var prev = kgAgreementHistory(karigarId).pop();
    if(p.kind === 'wastage' && p.wastagePoints == null && prev && prev.kind === 'wastage' && prev.wastagePoints != null) p.wastagePoints = prev.wastagePoints;   // a form that does not send points never wipes them
    if(prev && effectiveFrom < prev.effectiveFrom) return 'Effective date is before the current version (' + prev.effectiveFrom + ')';
    ag = {id:kgNewId(), opId:opId, karigarId:karigarId, effectiveFrom:effectiveFrom, kind:p.kind, wastageBp:p.wastageBp,
          fixedMg:p.fixedMg, labour:p.labour, salary:p.salary, wastagePoints:(p.wastagePoints != null ? p.wastagePoints : null), createdAt:new Date().toISOString(), createdBy:u.name};
    S.kgAgreements.push(ag);
    kgMirrorTerms(k, kgAgreementFor(karigarId, kgToday()));
    auditId = kgAudit('kg_agreement', 'karigar', karigarId, kgAgreementText(ag) + ' from ' + effectiveFrom);
    return '';
  }, function(){
    S.kgAgreements = S.kgAgreements.filter(function(x){ return x.id !== ag.id; });
    var old = JSON.parse(before);
    Object.keys(k).forEach(function(x){ if(!(x in old)) delete k[x]; });
    Object.keys(old).forEach(function(x){ k[x] = old[x]; });
    kgUndoAudit(auditId);
  }, function(err){ done(err, ag, false); });
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


// ══ Karigar redesign (batches 2-6): points model, stages, silver, opening, carry, transfer ══
// A job with job.model === 'points' uses these rules; older jobs keep the old percent rules untouched.
// Every metal entry of the new kind carries metal ('gold'|'silver'), pu (0.01% units) and, inside a chain, stageId.
// Gold fine, silver fine and rupees are three separate balances; nothing here ever adds them together.
var KG_METALS = ['gold', 'silver'];
var KG_V3_JOB_TYPES = {CARRY_OUT:1, CARRY_APPLY:1, TRANSFER_OUT:1, TRANSFER_IN:1};
function kgMetalOf(x){ return (x && x.metal === 'silver') ? 'silver' : 'gold'; }
function kgStageOf(job, stageId){
  var a = job.stages || [];
  for(var i = 0; i < a.length; i++) if(a[i].id === stageId) return a[i];
  return null;
}
// The karigar who holds the metal of a stage: the stage's own karigar, else the job's.
function kgStageKarigarId(job, stageId){
  var st = stageId ? kgStageOf(job, stageId) : null;
  return st ? (st.who || job.karigarId) : job.karigarId;
}
function kgJobKarigarOk(job, kid){
  if(kid === job.karigarId) return true;
  var a = job.stages || [];
  for(var i = 0; i < a.length; i++) if(a[i].who === kid) return true;
  return false;
}
// pu must be a whole number; 10000 (100%) only as the 999 chip.
function kgPuOk(e){
  if(typeof e.pu !== 'number' || Math.floor(e.pu) !== e.pu) return false;
  if(e.pu === KG_PU_PURE) return e.purityKey === '999';
  return e.pu >= KG_PU_MIN && e.pu <= KG_PU_MAX;
}
function kgSavedPus(){
  var out = [9200, 9160, 7500, 9250, 8000, 9990];   // 92, 91.6, 75, 92.5, 80, 99.9
  (S.kgPurities || []).forEach(function(d){ if(d && d.permille > 0) out.push(d.permille * 10); });
  return out;
}
// chip '999' -> 100%. Otherwise the typed text goes through the guard. {pu,purityKey} | {error} | {confirm}
function kgResolvePu(text, chip, confirmed){
  if(chip === '999') return {pu:KG_PU_PURE, purityKey:'999'};
  var r = kgCheckPurity(text, kgSavedPus());
  if(r.error) return {error:r.error};
  if(r.confirm && !confirmed) return {confirm:r.confirm};
  return {pu:r.pu, purityKey:String(text).trim()};
}
function kgParseMgOrZero(v){
  var t = String(v == null ? '' : v).trim();
  return (t === '' || /^0+(\.0{1,3})?$/.test(t)) ? 0 : kgParseMg(t);
}
// What one karigar holds on one job, from his own live entries (fine mg). Points jobs only.
function kgKarigarJobFine(job, ledger, kid, idxIn){
  var idx = idxIn || kgIndex(ledger), t = 0;
  (ledger || []).forEach(function(e){
    if(e.jobId !== job.id || e.karigarId !== kid || idx.reversed[e.id]) return;
    if(e.type === 'ISSUE' || e.type === 'CARRY_APPLY' || e.type === 'TRANSFER_IN') t += e.fineMg;
    else if(e.type === 'RECEIPT' || e.type === 'SCRAP') t -= e.fineMg - (e.openingUseMg || 0);   // the part drawn from his opening balance never sat on the job
    else if(e.type === 'ADJUST' || e.type === 'TRANSFER_OUT' || e.type === 'CARRY_OUT') t -= e.fineMg;
    else if(e.type === 'LOSS' && kgLossState(e, idx) === 'approved') t -= e.fineMg;
  });
  return t;
}
// What is still left of his opening balance (fine mg): the opening less what receipts and scrap have drawn from it.
// What he can hand back from this job right now: what he holds, less any loss still waiting for approval.
function kgFreeOnJob(job, ledger, idx, kid){
  return Math.max(0, kgKarigarJobFine(job, ledger, kid, idx) - kgPendingLoss(ledger, idx, job, kid, ''));
}
function kgOpeningLeft(ledger, idx, kid, metal){
  var t = 0;
  (ledger || []).forEach(function(e){
    if(e.karigarId !== kid || idx.reversed[e.id] || kgMetalOf(e) !== metal) return;
    if(e.type === 'OPENING') t += e.fineMg; else if((e.type === 'RECEIPT' || e.type === 'SCRAP') && e.openingUseMg > 0) t -= e.openingUseMg;
  });
  return t;
}
// Freeze his terms on the job when he is put on it (until he has metal on it), so a later change of terms never touches work already handed out.
function kgSnapTerms(job, kid){
  if(job.model !== 'points' || !kid) return;
  job.terms = job.terms || {};
  var used = (S.kgLedger || []).some(function(e){ return e.jobId === job.id && e.karigarId === kid; });
  if(job.terms[kid] && used) return;
  var ag = kgAgreementFor(kid, kgToday()) || findKarigar(kid) || {};
  var kind = ag.kind === 'salary' ? 'salary' : (ag.kind === 'wastage' ? 'wastage' : '');
  job.terms[kid] = {kind:kind, pointsPu:(kind === 'salary' ? 0 : (job.pointsPu != null ? job.pointsPu : (ag.wastagePoints != null ? ag.wastagePoints : null)))};
}
// Kind and wastage points that apply to this karigar on this job today. A job override beats his terms.
function kgTermsFor(job, karigarId){
  var fr = job.terms && job.terms[karigarId];
  if(fr){
    // frozen once he holds metal on the job, so a later change never touches work already handed out. Until then the job follows his terms.
    // A job whose wastage points were never set stays open to them: no receipt can exist without points, so nothing is rewritten.
    var used = (S.kgLedger || []).some(function(e){ return e.jobId === job.id && e.karigarId === karigarId; });
    if(used && !(fr.kind === 'wastage' && fr.pointsPu == null)) return fr;
    if(used){ var lv = kgLiveTerms(job, karigarId); return lv.kind === 'wastage' ? lv : fr; }
  }
  return kgLiveTerms(job, karigarId);
}
function kgLiveTerms(job, karigarId){
  var k = findKarigar(karigarId), ag = kgAgreementFor(karigarId, kgToday()) || k || {};
  var kind = ag.kind === 'salary' ? 'salary' : (ag.kind === 'wastage' ? 'wastage' : '');
  var pts = (job.pointsPu != null) ? job.pointsPu : (ag.wastagePoints != null ? ag.wastagePoints : null);
  return {kind:kind, pointsPu:(kind === 'salary' ? 0 : pts)};
}

// ── validation of the new entry kinds (pure) ──
function kgMetalEntryOk(e, creditEntry){
  if(!(e.mg > 0) || Math.floor(e.mg) !== e.mg || e.mg > KG_MAX_MG) return 'Weight is not valid';
  if(!kgPuOk(e)) return 'Purity is not valid';
  if(!e.purityKey) return 'Purity missing';
  if(!creditEntry && e.fineMg !== kgFineFromPu(e.mg, e.pu)) return 'Fine weight does not match weight and purity';
  return '';
}
function kgValidateV3(e, ctx, idx){
  var job = ctx.job, role = ctx.role, t = e.type, ledger = ctx.ledger || [], bad;
  if(job.model !== 'points') return 'This job uses the old rules';
  if(!kgCan(role, 'manager')) return 'Only owner or manager can record metal';
  if(KG_METALS.indexOf(e.metal) === -1 || e.metal !== kgMetalOf(job)) return 'Metal does not match the job';
  if(e.stageId && !kgStageOf(job, e.stageId)) return 'Stage not found';
  if(e.karigarId !== kgStageKarigarId(job, e.stageId || '')) return 'Karigar does not match the stage';
  if(t === 'ISSUE' || t === 'SCRAP'){
    bad = kgMetalEntryOk(e); if(bad) return bad;
    if(t === 'ISSUE' && e.openingUseMg) return 'An issue cannot draw from an opening balance';
    if(t === 'SCRAP'){
      if(KG_SCRAP_KINDS.indexOf(e.kind) === -1) return 'Scrap kind is not valid';
      var sHeld = kgFreeOnJob(job, ledger, idx, e.karigarId), sLeft = kgOpeningLeft(ledger, idx, e.karigarId, e.metal);
      if(e.fineMg > sHeld + sLeft) return 'He does not hold that much (' + kgFmtG(sHeld + sLeft) + ' fine on this job and in his opening balance)';
      if((e.openingUseMg || 0) !== Math.max(0, e.fineMg - sHeld)) return 'Opening balance use does not match';
    }
    return '';
  }
  if(t === 'RECEIPT'){
    bad = kgMetalEntryOk(e, true); if(bad) return bad;
    if(!String(e.pieceDesc || '').trim()) return 'Describe the piece received';
    if(!(e.qty >= 1) || Math.floor(e.qty) !== e.qty) return 'Quantity is not valid';
    var gross = e.grossMg, stone = e.stoneMg || 0;
    if(kgNetMg(gross, stone) !== e.mg) return 'Net weight must be gross weight minus stones';
    if(stone > 0 && e.stoneMode !== 'A' && e.stoneMode !== 'B') return 'Say whether the shop or the karigar weighed the stones';
    if(e.agreedPu != null && !(Math.floor(e.agreedPu) === e.agreedPu && e.agreedPu >= KG_PU_MIN && e.agreedPu <= KG_PU_PURE)) return 'Agreed touch is not valid';
    if(e.actualFineMg !== kgFineFromPu(e.mg, e.pu)) return 'Fine in the piece does not match';
    var expect, rHeld = kgFreeOnJob(job, ledger, idx, e.karigarId), rLeft = kgOpeningLeft(ledger, idx, e.karigarId, e.metal);
    if(e.kind === 'salary'){
      if(kgTermsFor(job, e.karigarId).kind !== 'salary') return 'This karigar is not on a salary';
      if(e.pointsPu !== 0) return 'A salary karigar has no wastage points';
      expect = e.actualFineMg;
      if(expect > rHeld + rLeft) return 'He does not hold that much (' + kgFmtG(rHeld + rLeft) + ' fine on this job and in his opening balance)';
    } else if(e.kind === 'wastage'){
      var tm = kgTermsFor(job, e.karigarId);
      if(tm.kind !== 'wastage' || tm.pointsPu !== e.pointsPu) return 'Wastage points do not match this karigar\'s terms on the job';
      var wc = kgWastageCredit(e.mg, e.pu, e.pointsPu, rHeld + rLeft);
      if(wc.error) return wc.error;
      expect = wc.creditMg;
    } else return 'Karigar terms (wastage or salary) are missing';
    if(e.creditFineMg !== expect || e.fineMg !== expect) return 'Credit does not match the rules (' + kgFmtG(expect) + ' fine expected)';
    if((e.openingUseMg || 0) !== Math.max(0, expect - rHeld)) return 'Opening balance use does not match';
    return '';
  }
  if(t === 'TRANSFER_OUT' || t === 'TRANSFER_IN'){
    bad = kgMetalEntryOk(e); if(bad) return bad;
    if(!e.voucherId) return 'A transfer needs a voucher';
    if(t === 'TRANSFER_OUT'){
      if(kgKarigarJobFine(job, ledger, e.karigarId) < e.fineMg) return 'He does not hold that much on this job';
      return '';
    }
    var out = null;
    for(var n = 0; n < ledger.length; n++){
      var y = ledger[n];
      if(y.voucherId !== e.voucherId || idx.reversed[y.id]) continue;
      if(y.type === 'TRANSFER_OUT') out = y; else if(y.type === 'TRANSFER_IN') return 'This transfer is already recorded';
    }
    if(!out || out.jobId !== e.jobId || out.fineMg !== e.fineMg || out.mg !== e.mg || out.pu !== e.pu || kgMetalOf(out) !== e.metal) return 'No matching amount left the other karigar';
    if(out.karigarId === e.karigarId) return 'A transfer needs two different karigars';
    return '';
  }
  if(t === 'CARRY_OUT'){
    if(!(e.fineMg > 0) || Math.floor(e.fineMg) !== e.fineMg) return 'Carry weight is not valid';
    if(!e.carryId) return 'Carry id missing';
    if(kgKarigarJobFine(job, ledger, e.karigarId) < e.fineMg) return 'He does not hold that much on this job';
    return '';
  }
  if(t === 'CARRY_APPLY'){
    if(!(e.fineMg > 0) || Math.floor(e.fineMg) !== e.fineMg) return 'Carry weight is not valid';
    var lot = idx.byId[e.lotId];
    if(!lot || lot.type !== 'CARRY_IN' || idx.reversed[lot.id]) return 'Carried balance not found';
    if(lot.karigarId !== e.karigarId || kgMetalOf(lot) !== e.metal) return 'The carried balance belongs to another karigar or metal';
    if(kgLotRemaining(ledger, idx, lot) < e.fineMg) return 'Only ' + kgFmtG(kgLotRemaining(ledger, idx, lot)) + ' fine is left in that carried balance';
    return '';
  }
  return 'Unknown entry type';
}
function kgValidateKarigarLevel(e, ctx){
  var role = ctx.role, ledger = ctx.ledger || [], idx = kgIndex(ledger), t = e.type, bad;
  if(t === 'OPENING'){
    if(role !== 'owner') return 'Only the owner can enter opening balances';
    if(!ctx.karigar || ctx.karigar.id !== e.karigarId) return 'Karigar not found';
    if(KG_METALS.indexOf(e.metal) === -1) return 'Metal is not valid';
    bad = kgMetalEntryOk(e); if(bad) return bad;
    for(var i = 0; i < ledger.length; i++){
      var x = ledger[i];
      if(x.type === 'OPENING' && x.karigarId === e.karigarId && kgMetalOf(x) === e.metal && !idx.reversed[x.id]) return 'An opening balance is already entered - reverse it first';
    }
    return '';
  }
  if(t === 'REFINE_CREDIT'){
    if(role !== 'owner') return 'Only the owner can record the assay result';
    var sc = idx.byId[e.refId];
    if(!sc || sc.type !== 'SCRAP' || sc.refine !== 'pending' || idx.reversed[sc.id]) return 'Refining lot not found';
    if(kgMetalOf(sc) !== e.metal) return 'Metal does not match the lot';
    if(!(e.fineMg > 0) || Math.floor(e.fineMg) !== e.fineMg) return 'Assay fine weight is not valid';
    if(e.fineMg > sc.mg) return 'The fine gold cannot be more than the weight sent';
    for(var m = 0; m < ledger.length; m++) if(ledger[m].type === 'REFINE_CREDIT' && ledger[m].refId === e.refId && !idx.reversed[ledger[m].id]) return 'The assay is already recorded - reverse it first';
    return '';
  }
  if(t === 'CARRY_IN'){
    if(!kgCan(role, 'manager')) return 'Only owner or manager can close with a carried balance';
    if(KG_METALS.indexOf(e.metal) === -1) return 'Metal is not valid';
    if(!(e.fineMg > 0) || Math.floor(e.fineMg) !== e.fineMg || !e.carryId) return 'Carried weight is not valid';
    var out = null;
    for(var n = 0; n < ledger.length; n++){
      var y = ledger[n];
      if(y.carryId !== e.carryId || idx.reversed[y.id]) continue;
      if(y.type === 'CARRY_OUT') out = y; else if(y.type === 'CARRY_IN') return 'This carry is already recorded';
    }
    if(!out || out.karigarId !== e.karigarId || out.fineMg !== e.fineMg || kgMetalOf(out) !== e.metal || out.jobId !== e.fromJobId) return 'No matching amount left the job';
    return '';
  }
  if(t === 'REVERSAL'){
    var tg = idx.byId[e.reversesId];
    if(tg && tg.type === 'CARRY_IN' && tg.jobId === ''){
      if(!e.pair) return 'This entry is reversed together with its pair';
      if(idx.reversed[tg.id]) return 'Already reversed';
      if(e.karigarId !== tg.karigarId || !kgCan(role, 'manager')) return 'Not allowed';
      if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
      if(kgLotRemaining(ledger, idx, tg) !== tg.fineMg) return 'Part of this carried balance is already used on another job';
      return '';
    }
    if(!tg || tg.jobId !== '' || (tg.type !== 'OPENING' && tg.type !== 'REFINE_CREDIT')) return 'Entry not found';
    if(idx.reversed[tg.id]) return 'Already reversed';
    if(tg.type === 'OPENING' && kgOpeningLeft(ledger, idx, tg.karigarId, kgMetalOf(tg)) < tg.fineMg) return 'Receipts or scrap have already drawn from this opening balance - reverse those first';
    if(e.karigarId !== tg.karigarId) return 'Karigar does not match';
    if(String(e.reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    return role === 'owner' ? '' : 'Only the owner can reverse this entry';
  }
  return 'Unknown entry type';
}

// ── builders: text from a form in, one ready entry out. {entry} | {error} | {confirm:'ask the user first'} ──
// v: {wt, purity, chip, confirmed, opId, note, ...}. Nothing is saved here.
function kgBuildIssue(jobId, stageId, v){
  var job = kgFindJob(jobId); if(!job) return {error:'Job not found'};
  if(job.model !== 'points') return {error:'This job uses the old rules'};
  var mg = kgParseMg(v.wt); if(mg === null) return {error:kgWeightProblem(v.wt, 'weight')};
  var p = kgResolvePu(v.purity, v.chip, v.confirmed); if(p.error || p.confirm) return p;
  return {entry:{type:'ISSUE', opId:v.opId, jobId:jobId, stageId:stageId || '', karigarId:kgStageKarigarId(job, stageId || ''), metal:kgMetalOf(job),
    mg:mg, pu:p.pu, purityKey:p.purityKey, fineMg:kgFineFromPu(mg, p.pu), note:String(v.note || '').trim()}};
}
// v: {gross, stoneG | stoneCt, stoneMode, purity (measured), chip, agreed (typed touch), piece, qty, tag, confirmed, opId}
function kgBuildReceipt(jobId, stageId, v){
  var job = kgFindJob(jobId); if(!job) return {error:'Job not found'};
  if(job.model !== 'points') return {error:'This job uses the old rules'};
  var kid = kgStageKarigarId(job, stageId || ''), terms = kgTermsFor(job, kid);
  if(!terms.kind) return {error:'Set this karigar\'s terms (wastage or salary) first'};
  if(terms.kind === 'wastage' && terms.pointsPu == null) return {error:'Set this karigar\'s wastage points first'};
  var gross = kgParseMg(v.gross); if(gross === null) return {error:kgWeightProblem(v.gross, 'gross weight')};
  var stone = 0;
  if(String(v.stoneCt || '').trim() !== ''){ stone = kgCtToMg(v.stoneCt); if(stone === null) return {error:'Stone weight in carats is not valid'}; }
  else { stone = kgParseMgOrZero(v.stoneG); if(stone === null) return {error:kgWeightProblem(v.stoneG, 'stone weight')}; }
  var net = kgNetMg(gross, stone); if(net === null || net === 0) return {error:'Stone weight must be less than the gross weight'};
  var p = kgResolvePu(v.purity, v.chip, v.confirmed); if(p.error || p.confirm) return p;
  var agreed = null;
  if(String(v.agreed || '').trim() !== ''){ var ap = kgResolvePu(v.agreed, v.agreedChip, true); if(ap.error) return ap; agreed = ap.pu; }
  var qtyText = String(v.qty == null ? '1' : v.qty).trim(), qty = parseInt(qtyText, 10);
  if(!/^\d{1,4}$/.test(qtyText) || !(qty >= 1)) return {error:'Quantity must be 1 or more'};
  var pieceDesc = String(v.piece || '').trim(); if(!pieceDesc) return {error:'Describe the piece received'};
  var actual = kgFineFromPu(net, p.pu), credit = actual, cap = false, raw = actual;
  var led0 = S.kgLedger || [], idx0 = kgIndex(led0), held0 = kgFreeOnJob(job, led0, idx0, kid), left0 = kgOpeningLeft(led0, idx0, kid, kgMetalOf(job));
  if(terms.kind === 'wastage'){
    var wc = kgWastageCredit(net, p.pu, terms.pointsPu, held0 + left0);
    if(wc.error) return {error:wc.error};
    credit = wc.creditMg; cap = wc.capped; raw = wc.rawMg;
  } else if(actual > held0 + left0) return {error:'He does not hold that much: ' + kgFmtG(held0 + left0) + ' fine on this job and in his opening balance, this piece has ' + kgFmtG(actual)};
  return {entry:{type:'RECEIPT', opId:v.opId, jobId:jobId, stageId:stageId || '', karigarId:kid, metal:kgMetalOf(job),
    grossMg:gross, stoneMg:stone, stoneMode:(stone > 0 ? v.stoneMode : ''), mg:net, pu:p.pu, purityKey:p.purityKey, agreedPu:agreed,
    kind:terms.kind, pointsPu:terms.pointsPu, actualFineMg:actual, creditFineMg:credit, fineMg:credit, openingUseMg:Math.max(0, credit - held0),
    pieceDesc:pieceDesc, qty:qty, tag:String(v.tag || '').trim().slice(0, 30), note:String(v.note || '').trim()},
    capped:cap, rawCreditMg:raw};
}
function kgBuildScrap(jobId, stageId, v){
  var b = kgBuildIssue(jobId, stageId, v); if(!b.entry) return b;
  b.entry.type = 'SCRAP'; b.entry.kind = v.kind; b.entry.refine = 'pending';   // belongs to the shop; a pending refining lot until assay
  var job = kgFindJob(jobId), led = S.kgLedger || [], idx = kgIndex(led), kid = b.entry.karigarId;
  var held = kgFreeOnJob(job, led, idx, kid), left = kgOpeningLeft(led, idx, kid, b.entry.metal);
  if(b.entry.fineMg > held + left) return {error:'He does not hold that much: ' + kgFmtG(held + left) + ' fine on this job and in his opening balance'};
  b.entry.openingUseMg = Math.max(0, b.entry.fineMg - held);
  return b;
}

// Until a karigar first holds metal on a points job the job follows his terms; the first metal in freezes them.
// Returns an undo function (a failed save puts the job's terms back exactly as they were).
function kgFreezeTerms(job, e){
  if(!job || job.model !== 'points') return function(){};
  var before = JSON.stringify(job.terms === undefined ? null : job.terms), t = e.type;
  function undo(){ if(before === 'null') delete job.terms; else job.terms = JSON.parse(before); }
  if(t === 'ISSUE' || t === 'CARRY_APPLY' || t === 'TRANSFER_IN') kgSnapTerms(job, e.karigarId);
  else if(t === 'RECEIPT' || t === 'SCRAP'){
    // the first receipt or scrap (even one that only draws his opening balance) freezes his terms; a job whose points were blank takes the points of its first receipt and keeps them
    kgSnapTerms(job, e.karigarId);
    var fr = job.terms && job.terms[e.karigarId];
    if(t === 'RECEIPT' && fr && fr.kind === 'wastage' && fr.pointsPu == null && e.kind === 'wastage' && e.pointsPu != null) fr.pointsPu = e.pointsPu;
  }
  return undo;
}
// Push already-built entries in ONE saved step: all of them or none (rolled back on a failed save).
function kgUndoTerms(undos){ while(undos && undos.length) undos.pop()(); }
// undos: an array the caller owns; each frozen set of terms puts its undo function in it.
function kgPushValidated(list, u, undos){
  var pushed = []; undos = undos || [];
  for(var i = 0; i < list.length; i++){
    var e = list[i], job = e.jobId ? kgFindJob(e.jobId) : null;
    var err = kgValidateEntry(e, {job:job, role:u.role, ledger:S.kgLedger, karigar:findKarigar(e.karigarId), salary:S.kgSalary || []});
    if(err){ S.kgLedger = S.kgLedger.filter(function(x){ return pushed.indexOf(x.id) === -1; }); kgUndoTerms(undos); return err; }
    undos.push(kgFreezeTerms(job, e));
    S.kgLedger.push(e); pushed.push(e.id);
  }
  return '';
}
function kgAddEntries(list, done){
  S.kgLedger = S.kgLedger || [];
  if(!list || !list.length) return done(new Error('Nothing to save'), list, false);
  var live = 0;
  list.forEach(function(e){ for(var i = 0; i < S.kgLedger.length; i++) if(S.kgLedger[i].opId === e.opId){ live++; break; } });
  if(live === list.length) return done(null, list, true);
  if(live) return done(new Error('Part of this was already saved - check the account before trying again'), list, false);
  if(_kgFlagUnknown){ try{ kgLoadLedgerFlag(); }catch(x){} return done(new Error('Checking whether the ledger is on. Try again in a moment. Nothing was saved.'), list, false); }
  if(S.kgLedgerOn === true) return done(new Error('New karigar entries are not available while the ledger is on yet. Nothing was saved.'), list, false);
  var u = kgUser(), first = list[0], key = first.jobId ? 'job:' + first.jobId : 'karigar:' + first.karigarId, ids = [], auditId = null, termsUndos = [];
  list.forEach(function(e){ kgStamp(e); ids.push(e.id); });
  kgTxn(key, function(){
    var err = kgPushValidated(list, u, termsUndos);
    if(err) return err;
    auditId = kgAudit('kg_batch', 'kgJob', first.jobId || first.karigarId, list.map(function(e){ return e.type; }).join('+'));
    return '';
  }, function(){
    S.kgLedger = S.kgLedger.filter(function(x){ return ids.indexOf(x.id) === -1; });
    kgUndoTerms(termsUndos);
    kgUndoAudit(auditId);
  }, function(err){ done(err, list, false); });
}

// Add a stage to a job with its own karigar (ad-hoc chain: making > setting > polish). Manager or owner.
function kgAddStage(jobId, name, karigarId, done){
  var job = kgFindJob(jobId), u = kgUser(), st = null, auditId = null;
  kgTxn('job:' + jobId, function(){
    if(!job) return 'Job not found';
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can update a job';
    if(job.status !== 'open') return 'Job is ' + job.status;
    var nm = String(name || '').trim();
    if(!nm || nm.length > 40) return 'Give the stage a short name';
    if(karigarId && !findKarigar(karigarId)) return 'Karigar not found';
    st = {id:kgNewId(), name:nm, status:'pending', who:karigarId || '', log:[]};
    job.stages = (job.stages || []).concat([st]); kgSnapTerms(job, karigarId);
    auditId = kgAudit('kg_stage_add', 'kgJob', jobId, job.jobNo + ' ' + nm);
    return '';
  }, function(){ job.stages = job.stages.filter(function(x){ return x.id !== st.id; }); kgUndoAudit(auditId); }, function(err){ done(err, st); });
}

// Opening balance of metal a karigar already holds (owner, once per karigar and metal; reverse to redo).
// v: {karigarId, metal, wt, purity, chip, confirmed, opId, note}
function kgAddOpening(v, done){
  var k = findKarigar(v.karigarId);
  var mg = kgParseMg(v.wt); if(mg === null) return done(new Error(kgWeightProblem(v.wt, 'weight')));
  var p = kgResolvePu(v.purity, v.chip, v.confirmed); if(p.error) return done(new Error(p.error)); if(p.confirm){ var c = new Error(p.confirm); c.confirm = true; return done(c); }
  kgAddEntries([{type:'OPENING', opId:v.opId, jobId:'', stageId:'', karigarId:(k ? k.id : ''), metal:v.metal, mg:mg, pu:p.pu, purityKey:p.purityKey,
    fineMg:kgFineFromPu(mg, p.pu), note:String(v.note || '').trim()}], function(err, list, dup){ done(err, list && list[0], dup); });
}

// Undo a carry-forward: both halves together. The job must be open again (owner reopens it) and nothing of the lot may be used yet.
function kgReverseCarry(carryId, reason, opId, done){
  var out = null, inn = null, idx = kgIndex(S.kgLedger || []);
  (S.kgLedger || []).forEach(function(x){ if(x.carryId === carryId && !idx.reversed[x.id]){ if(x.type === 'CARRY_OUT') out = x; else if(x.type === 'CARRY_IN') inn = x; } });
  if(!out || !inn) return done(new Error('Carried balance not found'));
  var why = String(reason || '').trim();
  kgAddEntries([
    {type:'REVERSAL', pair:true, opId:opId + ':o', jobId:out.jobId, stageId:'', karigarId:out.karigarId, metal:kgMetalOf(out), reversesId:out.id, reason:why},
    {type:'REVERSAL', pair:true, opId:opId + ':i', jobId:'', stageId:'', karigarId:inn.karigarId, metal:kgMetalOf(inn), reversesId:inn.id, reason:why}
  ], function(err, list, dup){ done(err, list, dup); });
}

// \u2500\u2500 Karigar to karigar transfer (batch 4): one voucher, two entries, one save \u2500\u2500
// v: {jobId, fromStageId, toStageId, wt, purity, chip, confirmed, opId, note}. The receiving side must be a stage with its own karigar.
function kgTransfer(v, done){
  var job = kgFindJob(v.jobId);
  if(!job) return done(new Error('Job not found'));
  if(job.model !== 'points') return done(new Error('This job uses the old rules'));
  if(!v.toStageId) return done(new Error('Choose the stage the metal goes to'));
  var mg = kgParseMg(v.wt); if(mg === null) return done(new Error(kgWeightProblem(v.wt, 'weight')));
  var p = kgResolvePu(v.purity, v.chip, v.confirmed);
  if(p.error) return done(new Error(p.error));
  if(p.confirm){ var c = new Error(p.confirm); c.confirm = true; return done(c); }
  var from = kgStageKarigarId(job, v.fromStageId || ''), to = kgStageKarigarId(job, v.toStageId), metal = kgMetalOf(job), fine = kgFineFromPu(mg, p.pu);
  var voucher = v.opId + ':v', base = {jobId:job.id, metal:metal, mg:mg, pu:p.pu, purityKey:p.purityKey, fineMg:fine, voucherId:voucher, note:String(v.note || '').trim()};
  var out = {type:'TRANSFER_OUT', opId:v.opId + ':o', stageId:v.fromStageId || '', karigarId:from}, inn = {type:'TRANSFER_IN', opId:v.opId + ':i', stageId:v.toStageId, karigarId:to};
  Object.keys(base).forEach(function(x){ out[x] = base[x]; inn[x] = base[x]; });
  kgAddEntries([out, inn], function(err, list, dup){ done(err, list, dup); });
}
// Undo a transfer: both halves together. The receiving karigar must still hold the metal.
function kgReverseTransfer(voucherId, reason, opId, done){
  var out = null, inn = null, idx = kgIndex(S.kgLedger || []);
  (S.kgLedger || []).forEach(function(x){ if(x.voucherId === voucherId && !idx.reversed[x.id]){ if(x.type === 'TRANSFER_OUT') out = x; else if(x.type === 'TRANSFER_IN') inn = x; } });
  if(!out || !inn) return done(new Error('Transfer not found'));
  var why = String(reason || '').trim();
  kgAddEntries([
    {type:'REVERSAL', pair:true, opId:opId + ':i', jobId:inn.jobId, stageId:inn.stageId || '', karigarId:inn.karigarId, metal:kgMetalOf(inn), reversesId:inn.id, reason:why},
    {type:'REVERSAL', pair:true, opId:opId + ':o', jobId:out.jobId, stageId:out.stageId || '', karigarId:out.karigarId, metal:kgMetalOf(out), reversesId:out.id, reason:why}
  ], function(err, list, dup){ done(err, list, dup); });
}


// ── The karigar account (batch 5): everything the profile shows, derived on read ──
// Fine gold with him, per metal = opening balance + what he holds on each job + his carried lots. Carrying a leftover moves it from
// "on a job" to "carried", applying it moves it back: the total never changes. Rupees are a separate balance (the salary register).
// Order-side stages (the old way) are NOT part of this; see kgOrderWork.
function kgMetalAccount(karigarId, metal){
  var led = S.kgLedger || [], idx = kgIndex(led), opening = kgOpeningLeft(led, idx, karigarId, metal), inJobs = 0;
  (S.kgJobs || []).forEach(function(j){
    if(kgMetalOf(j) !== metal || j.status === 'cancelled') return;
    if(j.model === 'points') inJobs += kgKarigarJobFine(j, led, karigarId, idx);
    else if(j.karigarId === karigarId && metal === 'gold') inJobs += kgJobBalance(j, led).openFine;   // old-rules jobs keep their own maths
  });
  var carry = kgCarryTotal(karigarId, metal), lots = kgCarryLots(karigarId, metal);
  return {openingMg:opening, inJobsMg:inJobs, carryMg:carry, totalMg:opening + inJobs + carry, oldestCarryDays:(lots.length ? lots[0].ageDays : 0)};
}
function kgAccount(karigarId){
  var today = kgToday(), inProgress = 0, overdue = 0, sal = kgSalaryBalance(karigarId);
  (S.kgJobs || []).forEach(function(j){
    if(j.status !== 'open') return;
    var mine = (j.karigarId === karigarId) || (j.model === 'points' && kgJobKarigarOk(j, karigarId));
    if(!mine) return;
    inProgress++;
    if(kgJobOverdueDays(j, today) > 0) overdue++;
  });
  return {gold:kgMetalAccount(karigarId, 'gold'), silver:kgMetalAccount(karigarId, 'silver'),
    rupees:{payablePaise:sal.payable, accruedPaise:sal.accrued, paidPaise:sal.paid, advancedPaise:sal.advanced, deductedPaise:sal.deducted},
    inProgress:inProgress, overdue:overdue, countDue:kgCountDue(karigarId)};
}
// What the shop holds with karigars, per metal: the metal side of "karigar-held metal counts as shop stock".
function kgHeldFine(metal){
  var t = 0; (S.karigars || []).forEach(function(k){ t += kgMetalAccount(k.id, metal).totalMg; });
  return t;
}
// Effect of one entry on the karigar's TOTAL fine with him, ignoring any reversal (a reversal is its own row, on the day it happened).
// Carry entries move metal between "on a job" and "carried": 0. cut(date) says whether a date is inside the period being worked out.
function kgRawDelta(e, apr, cut){
  var t = e.type;
  if(t === 'ISSUE' || t === 'OPENING' || t === 'TRANSFER_IN') return e.fineMg;
  if(t === 'RECEIPT' || t === 'SCRAP' || t === 'ADJUST' || t === 'TRANSFER_OUT') return -e.fineMg;
  if(t === 'LOSS'){ var a = apr[e.id]; return (!e.proposed || (a && a.decision === 'approve' && cut(a.date))) ? -e.fineMg : 0; }
  return 0;
}
var KG_STATEMENT_TYPES = ['OPENING', 'ISSUE', 'RECEIPT', 'SCRAP', 'LOSS', 'ADJUST', 'TRANSFER_OUT', 'TRANSFER_IN', 'CARRY_OUT', 'CARRY_IN', 'CARRY_APPLY'];
// Statement of one metal for a date range ('YYYY-MM-DD', both inclusive). Opening line = balance before 'from'.
// A past range never changes when something is reversed later: the reversal is a row in the period it happened (with its reason).
function kgStatementRange(karigarId, metal, from, to){
  var led = S.kgLedger || [], idx = kgIndex(led), apr = {}, before = 0, run, rows = [], tGiven = 0, tBack = 0, tOther = 0, list = [];
  led.forEach(function(x){ if(x.type === 'APPROVAL') apr[x.refId] = x; });
  function inSet(e){ return e.karigarId === karigarId && kgMetalOf(e) === metal && KG_STATEMENT_TYPES.indexOf(e.type) !== -1; }
  led.forEach(function(e){
    if(e.type === 'REVERSAL'){ var t = idx.byId[e.reversesId]; if(t && inSet(t)) list.push({e:e, t:t}); }
    else if(inSet(e)) list.push({e:e});
  });
  list.sort(function(a, b){ return String(a.e.ts).localeCompare(String(b.e.ts)); });
  function dOf(x, cut){ return x.t ? -kgRawDelta(x.t, apr, cut) : kgRawDelta(x.e, apr, cut); }
  function beforeCut(d){ return d < from; }
  function toCut(d){ return d <= to; }
  // the day a row belongs to: a proposed loss that the owner approved counts on the approval day (so no period loses it); everything else on its own day
  function dayOf(x){ var ap = (!x.t && x.e.type === 'LOSS' && x.e.proposed) ? apr[x.e.id] : null; return (ap && ap.decision === 'approve') ? ap.date : x.e.date; }
  list.forEach(function(x){ if(dayOf(x) < from) before += dOf(x, beforeCut); });
  run = before;
  list.forEach(function(x){
    var e = x.e;
    if(dayOf(x) < from || dayOf(x) > to) return;
    var d = dOf(x, toCut), job = (x.t ? x.t : e).jobId ? kgFindJob((x.t ? x.t : e).jobId) : null;
    run += d;
    // Given = metal issued; Returned = pieces and scrap handed back; everything else (reversals, hand-overs, carry, loss, opening, adjust) is 'other', so the tiles always add up to the closing line
    if(x.t) tOther += d; else if(e.type === 'ISSUE') tGiven += d; else if(e.type === 'RECEIPT' || e.type === 'SCRAP') tBack -= d; else tOther += d;
    var state = 'ok';
    if(x.t) state = 'reversal';
    else if(e.type === 'LOSS' && e.proposed){ var ap = apr[e.id]; state = (!ap || !toCut(ap.date)) ? 'pending' : (ap.decision === 'approve' ? 'ok' : 'rejected'); }
    rows.push({entry:e, target:x.t || null, date:dayOf(x), type:e.type, jobNo:(job ? job.jobNo : ''), state:state, reason:(x.t ? (e.reason || '') : ''), deltaMg:d, balanceMg:run});
  });
  return {karigarId:karigarId, metal:metal, from:from, to:to, openingMg:before, closingMg:run, issuedMg:tGiven, returnedMg:tBack, otherMg:tOther, rows:rows};
}
// The old way, shown on its own (never added to the account above): metal held and money owed from order stages.
function kgOrderWork(karigarId){
  if(typeof karigarMetalHeld !== 'function') return {held:{gold:0, silver:0}, owed:{cash:0, gold:0, silver:0}, queue:[], any:false};
  var held = karigarMetalHeld(karigarId), owed = karigarOwed(karigarId), queue = karigarQueue(karigarId);
  return {held:held, owed:owed, queue:queue, any:(queue.length > 0 || held.gold > 0 || held.silver > 0 || owed.cash !== 0 || owed.gold !== 0 || owed.silver !== 0)};
}
// Order numbers (old way) where this job's karigars also have a stage: the one place two systems could confuse a person.
function kgOrderOverlap(job){
  var out = [];
  if(!job || !job.orderRef || !job.orderRef.orderId) return out;
  var ids = {}; ids[job.karigarId] = 1; (job.stages || []).forEach(function(s){ if(s.who) ids[s.who] = 1; });
  (S.orders || []).forEach(function(o){
    if(o.id !== job.orderRef.orderId) return;
    (o.items || []).forEach(function(it){ (it.karigarStages || []).forEach(function(st){ if(st.karigarId && ids[st.karigarId] && out.indexOf(o.ordNo) === -1) out.push(o.ordNo); }); });
  });
  return out;
}


// ── Rupee opening balance, rupee statement, scrap refining lots (batch 6) ──
// v: {karigarId, dir:'owe'|'advance', amountText, note, opId}. dir 'owe' = you owe him, 'advance' = he owes you. Owner only, once, reversible.
function kgAddRupeeOpening(v, done){
  var p = kgParsePaise(v.amountText);
  if(p === null) return done(new Error('Enter the amount in rupees'));
  kgAddSalary({type:'OPENING', opId:v.opId, karigarId:v.karigarId, dir:v.dir, amountPaise:p, note:String(v.note || '').trim()}, function(err, e, dup){ done(err, e, dup); });
}
// Effect of one salary entry on what you owe him (positive = you owe him more).
function kgSalaryDelta(e){
  if(e.type === 'ACCRUAL' || e.type === 'JOB_LABOUR' || (e.type === 'OPENING' && e.dir === 'owe')) return e.amountPaise;
  if(e.type === 'DEDUCTION' || e.type === 'ADVANCE' || e.type === 'PAYMENT' || e.type === 'OPENING') return -e.amountPaise;
  return 0;
}
function kgRupeeStatementRange(karigarId, from, to){
  var rows = [], before = 0, run, byId = {}, list = [];
  (S.kgSalary || []).forEach(function(e){ byId[e.id] = e; });
  (S.kgSalary || []).forEach(function(e){
    if(e.karigarId !== karigarId) return;
    if(e.type === 'REVERSAL'){ var t = byId[e.reversesId]; if(t) list.push({e:e, t:t}); } else list.push({e:e});
  });
  list.sort(function(a, b){ return String(a.e.ts).localeCompare(String(b.e.ts)); });
  function dOf(x){ return x.t ? -kgSalaryDelta(x.t) : kgSalaryDelta(x.e); }
  list.forEach(function(x){ if(x.e.date < from) before += dOf(x); });
  run = before;
  list.forEach(function(x){
    var e = x.e;
    if(e.date < from || e.date > to) return;
    var d = dOf(x); run += d;
    rows.push({entry:e, target:x.t || null, date:e.date, type:e.type, state:(x.t ? 'reversal' : 'ok'), reason:(x.t ? (e.reason || '') : ''), deltaPaise:d, balancePaise:run});
  });
  return {karigarId:karigarId, from:from, to:to, openingPaise:before, closingPaise:run, rows:rows};
}

// Sweepings, filings and dust belong to the shop. Weighing them returns the fine to the shop and lowers his account (SCRAP);
// each one is a refining lot, pending until the assay says how much real fine came out (REFINE_CREDIT, shop stock, not his account).
function kgRefineLots(metal){
  var led = S.kgLedger || [], idx = kgIndex(led), credit = {}, out = [];
  led.forEach(function(e){ if(e.type === 'REFINE_CREDIT' && !idx.reversed[e.id]) credit[e.refId] = e; });
  led.forEach(function(e){
    if(e.type !== 'SCRAP' || e.refine !== 'pending' || kgMetalOf(e) !== metal || idx.reversed[e.id]) return;
    var c = credit[e.id], job = e.jobId ? kgFindJob(e.jobId) : null;
    out.push({scrapId:e.id, date:e.date, jobNo:(job ? job.jobNo : ''), karigarId:e.karigarId, kind:e.kind, mg:e.mg, estFineMg:e.fineMg,
      status:(c ? 'credited' : 'pending'), assayFineMg:(c ? c.fineMg : 0), creditId:(c ? c.id : '')});
  });
  return out;
}
// What the shop has in each state, per metal. Nothing here is added to anything else: held by karigars, being refined (estimate), refined (assay).
function kgShopMetalView(metal){
  var v = {withKarigarsMg:kgHeldFine(metal), refiningEstMg:0, refinedMg:0};
  kgRefineLots(metal).forEach(function(l){ if(l.status === 'pending') v.refiningEstMg += l.estFineMg; else v.refinedMg += l.assayFineMg; });
  return v;
}
// v: {scrapId, fineText (grams of real fine from the assay), opId, note}
function kgRefineCredit(v, done){
  var sc = null; (S.kgLedger || []).forEach(function(x){ if(x.id === v.scrapId) sc = x; });
  if(!sc) return done(new Error('Refining lot not found'));
  var mg = kgParseMg(v.fineText); if(mg === null) return done(new Error(kgWeightProblem(v.fineText, 'fine weight from the assay')));
  kgAddEntries([{type:'REFINE_CREDIT', opId:v.opId, jobId:'', stageId:'', karigarId:'', metal:kgMetalOf(sc), refId:sc.id, fineMg:mg, note:String(v.note || '').trim()}],
    function(err, list, dup){ done(err, list && list[0], dup); });
}

// Reverse any ledger entry by its own job and karigar (a stage entry belongs to the stage's karigar, not the job's).
function kgReverse(entryId, reason, opId, done){
  var t = null;
  (S.kgLedger || []).forEach(function(x){ if(x.id === entryId) t = x; });
  if(!t) return done(new Error('Entry not found'));
  kgAddEntries([{type:'REVERSAL', opId:opId, jobId:t.jobId, stageId:t.stageId || '', karigarId:t.karigarId, metal:kgMetalOf(t), reversesId:entryId, reason:String(reason || '').trim()}],
    function(err, list, dup){ done(err, list && list[0], dup); });
}


// ── Carry-forward (batch 3) ──
// A "trusted" karigar may keep a leftover when a job closes. CARRY_OUT takes it off the job (job balance 0), CARRY_IN makes it a
// lot on the karigar ("Carried from KJ-0001"). CARRY_APPLY moves part of a lot onto the next job's issue: his total never changes
// (lot down, job up), so nothing is counted twice. Gold and silver lots are separate.
function kgLotRemaining(ledger, idx, lot){
  var left = lot.fineMg;
  (ledger || []).forEach(function(x){ if(x.type === 'CARRY_APPLY' && x.lotId === lot.id && !idx.reversed[x.id]) left -= x.fineMg; });
  return left;
}
// Live lots of one karigar and metal, oldest first, with what is left and how many days old.
function kgCarryLots(karigarId, metal){
  var led = S.kgLedger || [], idx = kgIndex(led), today = kgToday(), out = [];
  led.forEach(function(e){
    if(e.type !== 'CARRY_IN' || e.karigarId !== karigarId || kgMetalOf(e) !== metal || idx.reversed[e.id]) return;
    var left = kgLotRemaining(led, idx, e), job = kgFindJob(e.fromJobId);
    if(left <= 0) return;
    out.push({id:e.id, ts:e.ts, carryId:e.carryId, fromJobId:e.fromJobId, fromJobNo:(job ? job.jobNo : '?'), date:e.date, fineMg:e.fineMg, remainingMg:left,
      ageDays:Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(e.date + 'T00:00:00Z')) / 86400000))});
  });
  out.sort(function(a, b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : (String(a.ts) < String(b.ts) ? -1 : 1)); });
  return out;
}
function kgCarryTotal(karigarId, metal){
  var t = 0; kgCarryLots(karigarId, metal).forEach(function(l){ t += l.remainingMg; }); return t;
}
// Would carrying addMg more take him over his limit? {total, ceiling, over}. ceiling 0 = no limit set.
function kgCarryCheck(karigarId, metal, addMg){
  var k = findKarigar(karigarId) || {}, cap = (k.carryCeilingMg && k.carryCeilingMg[metal]) || 0, total = kgCarryTotal(karigarId, metal) + (addMg || 0);
  return {total:total, ceiling:cap, over:cap > 0 && total > cap};
}
// Weight to hand over so that (fine needed) minus (fine already with him from a lot) is covered at purity pu. Rounds UP to the mg.
function kgNeededWeightMg(totalFineNeededMg, carryFineMg, pu){
  var need = totalFineNeededMg - carryFineMg;
  if(need <= 0) return 0;
  var mg = Math.floor((need * 10000 + pu - 1) / pu);
  while(kgFineFromPu(mg, pu) < need) mg++;
  return mg;
}
// Put part of his carried balance onto this job (oldest lot first). wantFineMg > 0. Several lots = several entries, one save.
function kgApplyCarry(jobId, stageId, wantFineMg, opId, done){
  var job = kgFindJob(jobId);
  if(!job) return done(new Error('Job not found'));
  if(job.model !== 'points') return done(new Error('This job uses the old rules'));
  if(!(wantFineMg > 0) || Math.floor(wantFineMg) !== wantFineMg) return done(new Error('Carry weight is not valid'));
  var kid = kgStageKarigarId(job, stageId || ''), metal = kgMetalOf(job), lots = kgCarryLots(kid, metal), left = wantFineMg, list = [];
  lots.forEach(function(l, i){
    if(left <= 0) return;
    var take = Math.min(left, l.remainingMg); left -= take;
    list.push({type:'CARRY_APPLY', opId:opId + ':' + i, jobId:jobId, stageId:stageId || '', karigarId:kid, metal:metal, lotId:l.id, fineMg:take});
  });
  if(left > 0) return done(new Error('He has only ' + kgFmtG(wantFineMg - left) + ' fine carried'));
  kgAddEntries(list, function(err, l, dup){ done(err, l, dup); });
}

// Close settlement: what to do with whatever is still open when the owner closes a points job.
// What each karigar still holds on a points job: [{kid, fine}], from his own entries.
function kgJobKarigarFines(job){
  var led = S.kgLedger || [], idx = kgIndex(led), ids = {}, out = [];
  led.forEach(function(e){ if(e.jobId === job.id && e.karigarId) ids[e.karigarId] = 1; });
  Object.keys(ids).forEach(function(kid){ out.push({kid:kid, fine:kgKarigarJobFine(job, led, kid, idx)}); });
  return out;
}
// The stage id that belongs to this karigar on the job ('' when he is the job's own karigar with no stage).
function kgHolderStage(job, kid){
  var a = job.stages || [];
  for(var i = 0; i < a.length; i++) if(a[i].who === kid) return a[i].id;
  return '';
}
// opts: {settle:'carry'|'loss'|'loss-cash', reason, billText, ackCeiling, opId}. Returns {err} or {undo}.
function kgCloseSettle(job, u, opts){
  if(S.kgLedgerOn === true) return {err:'New karigar entries are not available while the ledger is on yet. Nothing was saved.'};
  if(job.model !== 'points') return {err:'This job uses the old rules - record the metal or a loss first'};
  var all = kgJobKarigarFines(job), pos = [], i;
  for(i = 0; i < all.length; i++){
    if(all[i].fine < 0) return {err:'A karigar has returned more than he was given - fix it with an owner adjustment first'};
    if(all[i].fine > 0) pos.push(all[i]);
  }
  if(!pos.length) return {undo:function(){}};
  var base = opts.opId || kgNewId(), metal = kgMetalOf(job), list = [], sal = null;
  if(opts.settle === 'carry'){
    for(i = 0; i < pos.length; i++){
      var k = findKarigar(pos[i].kid);
      if(!k || k.carryTrusted !== true) return {err:(k ? k.name : 'This karigar') + ' is not set to carry a balance'};
      var ck = kgCarryCheck(pos[i].kid, metal, pos[i].fine);
      if(ck.over && !opts.ackCeiling) return {err:'Over the carry limit: ' + k.name + ' would carry ' + kgFmtG(ck.total) + ' fine, the limit is ' + kgFmtG(ck.ceiling) + '. Confirm to go on.'};
      var cid = base + ':c' + i;
      list.push({type:'CARRY_OUT', opId:cid + 'o', jobId:job.id, stageId:kgHolderStage(job, pos[i].kid), karigarId:pos[i].kid, metal:metal, carryId:cid, fineMg:pos[i].fine});
      list.push({type:'CARRY_IN', opId:cid + 'i', jobId:'', stageId:'', karigarId:pos[i].kid, metal:metal, carryId:cid, fromJobId:job.id, fineMg:pos[i].fine});
    }
  } else if(opts.settle === 'loss' || opts.settle === 'loss-cash'){
    if(u.role !== 'owner') return {err:'Only the owner can accept a loss'};
    var why = String(opts.reason || '').trim();
    if(why.length < 5) return {err:'A reason (at least 5 letters) is required for a loss'};
    var cash = opts.settle === 'loss-cash', bill = 0;
    if(cash){
      if(pos.length !== 1) return {err:'A cash bill can only settle one karigar at a time'};
      bill = kgParsePaise(opts.billText); if(bill === null) return {err:'Enter the bill amount in rupees'};
    }
    pos.forEach(function(p, n){
      list.push({type:'LOSS', opId:base + ':l' + n, jobId:job.id, stageId:'', karigarId:p.kid, metal:metal, fineMg:p.fine, category:'other', reason:why,
        proposed:false, approvedBy:u.name, settle:(cash ? 'cash' : 'gold'), billPaise:bill});
    });
  } else return {err:'Choose how to settle what is still open'};
  list.forEach(function(e){ kgStamp(e); });
  var closeUndos = [], err = kgPushValidated(list, u, closeUndos);
  if(err) return {err:err};
  if(opts.settle === 'loss-cash'){
    var loss = list[0];
    sal = kgStamp({type:'DEDUCTION', opId:base + ':bill', karigarId:loss.karigarId, jobId:job.id, lossId:loss.id, amountPaise:loss.billPaise, note:'Loss bill ' + job.jobNo});
    var serr = kgValidateSalary(sal, {karigar:findKarigar(loss.karigarId), role:u.role, all:S.kgSalary || []});
    if(serr){ S.kgLedger = S.kgLedger.filter(function(x){ return list.indexOf(x) === -1; }); kgUndoTerms(closeUndos); return {err:serr}; }
    S.kgSalary = S.kgSalary || []; S.kgSalary.push(sal);
  }
  return {undo:function(){
    S.kgLedger = S.kgLedger.filter(function(x){ return list.indexOf(x) === -1; });
    kgUndoTerms(closeUndos);
    if(sal) S.kgSalary = S.kgSalary.filter(function(x){ return x !== sal; });
  }};
}
function kgLiveLossBill(salary, lossId){
  var rev = {}, found = false;
  (salary || []).forEach(function(x){ if(x.type === 'REVERSAL') rev[x.reversesId] = true; });
  (salary || []).forEach(function(x){ if(x.type === 'DEDUCTION' && x.lossId === lossId && !rev[x.id]) found = true; });
  return found;
}

// Owner settings on the karigar: may he carry a balance, and how much (per metal). ceilings are grams text, '' = no limit.
function kgSetCarry(karigarId, v, done){
  var k = findKarigar(karigarId), u = kgUser(), before = k ? JSON.stringify(k) : null, auditId = null;
  kgTxn('karigar:' + karigarId, function(){
    if(u.role !== 'owner') return 'Only the owner can change carry settings';
    if(!k) return 'Karigar not found';
    var cg = String(v.ceilingGold || '').trim() === '' ? 0 : kgParseMg(v.ceilingGold), cs = String(v.ceilingSilver || '').trim() === '' ? 0 : kgParseMg(v.ceilingSilver);
    if(cg === null || cs === null) return 'The limit must be a weight in grams (up to 3 decimals)';
    k.carryTrusted = v.trusted === true; k.carryCeilingMg = {gold:cg, silver:cs};
    auditId = kgAudit('kg_carry_settings', 'karigar', karigarId, (k.carryTrusted ? 'carry on' : 'carry off'));
    return '';
  }, function(){
    var old = JSON.parse(before);
    Object.keys(k).forEach(function(x){ if(!(x in old)) delete k[x]; });
    Object.keys(old).forEach(function(x){ k[x] = old[x]; });
    kgUndoAudit(auditId);
  }, function(err){ done(err); });
}
// Quarterly physical count: due when he carries a balance and has not been counted for 90 days.
var KG_COUNT_DAYS = 90;
function kgCountDue(karigarId){
  var k = findKarigar(karigarId);
  if(!k || k.carryTrusted !== true) return false;
  if(!(kgCarryTotal(karigarId, 'gold') > 0 || kgCarryTotal(karigarId, 'silver') > 0)) return false;
  if(!k.lastCountAt){ var oldest = kgCarryLots(karigarId, 'gold').concat(kgCarryLots(karigarId, 'silver')).reduce(function(m, l){ return Math.max(m, l.ageDays || 0); }, 0); return oldest >= KG_COUNT_DAYS; }   // never counted: due once the carried balance is as old as the count interval
  return (Date.parse(kgToday() + 'T00:00:00Z') - Date.parse(String(k.lastCountAt).slice(0, 10) + 'T00:00:00Z')) / 86400000 >= KG_COUNT_DAYS;
}
function kgMarkCounted(karigarId, note, done){
  var k = findKarigar(karigarId), u = kgUser(), before = k ? JSON.stringify(k) : null, auditId = null;
  kgTxn('karigar:' + karigarId, function(){
    if(!kgCan(u.role, 'manager')) return 'Only owner or manager can record a count';
    if(!k) return 'Karigar not found';
    k.lastCountAt = kgToday(); k.lastCountBy = u.name; k.lastCountNote = String(note || '').trim().slice(0, 120);
    auditId = kgAudit('kg_count', 'karigar', karigarId, k.lastCountNote || 'counted');
    return '';
  }, function(){
    var old = JSON.parse(before);
    Object.keys(k).forEach(function(x){ if(!(x in old)) delete k[x]; });
    Object.keys(old).forEach(function(x){ k[x] = old[x]; });
    kgUndoAudit(auditId);
  }, function(err){ done(err); });
}

// Runs after every load/restore (normaliseData): a retried or replayed save can
// repeat an opId; keep the first, drop the rest. Orphans are never deleted.
function kgNormalise(){
  if(typeof S === 'undefined' || !S) return;
  if(!Array.isArray(S.kgPurities)) S.kgPurities = [];
  if(!Array.isArray(S.kgRoutes)) S.kgRoutes = [];
  ['kgJobs', 'kgLedger', 'kgSalary', 'kgAgreements'].forEach(function(key){
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
function kg2OpenJob(id){ _kg2.more = ''; kg2Go('job', id); }
function kg2Pick(view, sel){ _kg2.karigarId = sel.value; _kg2.view = view; renderKgV2(); }

function kg2Badge(txt, cls){ return '<span class="kg2-badge ' + (cls || '') + '">' + escHtml(txt) + '</span>'; }
function kg2Btn(label, fn, cls){ return '<button class="btn btn-sm ' + (cls || '') + '" onclick="' + fn + '">' + escHtml(label) + '</button>'; }
function kg2Q(id){ return '\'' + jsAttrEsc(id) + '\''; }

function renderKgV2(){
  var root = document.getElementById('kg2-root');
  if(!root) return;
  if(!kgCan(kgUser().role, 'manager')){ root.innerHTML = ''; return; }
  var html = '', on = kg3On();
  if(on && ['home', 'jobs', 'khata'].indexOf(_kg2.view) !== -1) _kg2.view = 'people';   // the old Today / Jobs / Khata pages are hidden: one screen only
  _kg2.seen = true;
  if(_kg2.view === 'job' && kgFindJob(_kg2.jobId)) html = (on && kgFindJob(_kg2.jobId).model === 'points') ? kg3JobHtml(kgFindJob(_kg2.jobId)) : kg2JobHtml(kgFindJob(_kg2.jobId));
  else if(on && _kg2.view === 'people') html = kg3PeopleHtml();
  else if(on && _kg2.view === 'profile') html = kg3ProfileHtml(_kg2.karigarId);
  else if(on && _kg2.view === 'statement') html = kg3StatementHtml(_kg2.karigarId);
  else if(_kg2.view === 'khata') html = kg2KhataHtml();
  else if(_kg2.view === 'reports') html = kg2ReportsHtml();
  else if(_kg2.view === 'salary') html = kg2SalaryHtml();
  else if(_kg2.view === 'jobs') html = kg2JobsHtml();
  else if(_kg2.view === 'karigars') html = kg2KarigarsHtml();
  else { _kg2.view = 'home'; html = kg2TodayHtml(); }
  root.innerHTML = html;
}

function kg2NavHtml(){
  function tab(label, view){ return kg2Btn(label, 'kg2Go(\'' + view + '\')', _kg2.view === view ? 'btn-gold' : ''); }
  var on = kg3On();
  if(on) return '<div class="kg2-nav" role="navigation" aria-label="Karigar sections">' + tab('Karigars', 'people') + tab('Terms', 'karigars') + tab('Reports', 'reports') + (kgUser().role === 'owner' ? tab('Salary', 'salary') : '') + '</div>';
  return '<div class="kg2-nav" role="navigation" aria-label="Karigar sections">' + tab('Today', 'home') + tab('Jobs', 'jobs') + tab('Karigars', 'karigars') +
    tab('Khata', 'khata') + tab('Reports', 'reports') + (kgUser().role === 'owner' ? tab('Salary', 'salary') : '') + '</div>';
}

function kg2Chip(label, kind, mark){
  return '<span class="kg2-chip ' + (kind || '') + '"><span aria-hidden="true">' + (mark || '') + '</span> ' + escHtml(label) + '</span>';
}
function kg2TodayHtml(){
  var u = kgUser(), d = kgDashboard();
  var html = '<div class="kg2-head"><div class="kg2-title">Karigar <span class="kg2-new">2.0</span></div>' +
    '<div class="kg2-sub">Fine gold, jobs and what needs you today.</div></div>' + kg2NavHtml();
  function kpi(label, value, cls){ return '<div class="kg2-kpi ' + (cls || '') + '"><span>' + label + '</span><b>' + value + '</b></div>'; }
  html += '<div class="kg2-kpis">' + kpi('Fine gold with karigars', kgFmtG(d.withKarigarFine), d.withKarigarFine > 0 ? 'due' : '') +
    kpi('Open jobs', String(d.openJobs)) + kpi('Overdue', String(d.overdue.length), d.overdue.length ? 'warn' : '') +
    kpi('Awaiting approval', String(d.pendingApprovals.length), d.pendingApprovals.length ? 'warn' : '') + '</div>';
  html += '<div class="kg2-row">' + kg2Btn('+ New job', 'kg2NewJob()', 'btn-gold') + '</div>';
  html += '<div class="kg2-sec">Needs attention</div>';
  var n = 0;
  function line(job, chip, text){
    n++;
    var k = findKarigar(job.karigarId);
    html += '<div class="kg2-line kg2-click" role="button" tabindex="0" onclick="kg2OpenJob(' + kg2Q(job.id) + ')"><div><b>' + escHtml(job.jobNo) + ' &middot; ' + escHtml(job.title) + '</b>' +
      '<div class="kg2-sub">' + escHtml(k ? k.name : '?') + ' &middot; ' + text + '</div></div><div class="kg2-right">' + chip + '</div></div>';
  }
  d.pendingApprovals.forEach(function(x){ line(x.job, kg2Chip('Needs approval', 'warn', '!'), 'proposed loss ' + kgFmtG(x.fine) + ' fine' + (u.role === 'owner' ? '' : ' (owner decides)')); });
  d.overdue.forEach(function(x){ line(x.job, kg2Chip(x.days + ' day' + (x.days === 1 ? '' : 's') + ' late', 'warn', '!'), 'was due ' + escHtml(x.job.dueDate)); });
  d.surplus.forEach(function(x){ line(x.job, kg2Chip('Surplus', 'warn', '!'), 'returned ' + kgFmtG(x.fine) + ' fine more than due'); });
  d.readyToClose.forEach(function(x){ line(x.job, kg2Chip(x.openFine === 0 ? 'Ready to close' : 'Stages done', x.openFine === 0 ? 'ok' : '', x.openFine === 0 ? '\u2713' : '\u2022'),
    x.openFine === 0 ? 'all stages done, gold balanced' : 'all stages done, ' + kgFmtG(x.openFine) + ' fine still with karigar'); });
  if(!n) html += '<div class="kg2-empty">\u2713 All clear. Nothing is overdue or waiting for you.</div>';
  return html;
}

function kg2JobsHtml(){
  var f = _kg2.jobFilter || 'open', today = kgToday();
  var html = '<div class="kg2-head"><div class="kg2-title">Jobs</div></div>' + kg2NavHtml();
  html += '<div class="kg2-row">' + kg2Btn('+ New job', 'kg2NewJob()', 'btn-gold') + '</div><div class="kg2-row" role="group" aria-label="Filter jobs">' +
    ['open', 'closed', 'cancelled', 'all'].map(function(x){ return kg2Btn(x.charAt(0).toUpperCase() + x.slice(1), 'kg2Filter(\'' + x + '\')', f === x ? 'btn-gold' : ''); }).join('') + '</div>';
  var jobs = (S.kgJobs || []).filter(function(j){ return f === 'all' || j.status === f; })
    .sort(function(a, b){ return String(b.createdAt).localeCompare(String(a.createdAt)); });
  if(!jobs.length) html += '<div class="kg2-empty">No ' + (f === 'all' ? '' : f + ' ') + 'jobs.</div>';
  jobs.forEach(function(j){
    var b = kgJobBalance(j, S.kgLedger || []), k = findKarigar(j.karigarId), sm = kgStagesSummary(j), od = kgJobOverdueDays(j, today);
    var prog = sm.total ? sm.done + '/' + sm.total + (sm.active ? ' &middot; ' + escHtml(sm.active.name) : (sm.next && j.status === 'open' ? ' &middot; next: ' + escHtml(sm.next.name) : '')) : '';
    html += '<div class="kg2-line kg2-click" role="button" tabindex="0" onclick="kg2OpenJob(' + kg2Q(j.id) + ')"><div><b>' + escHtml(j.jobNo) + ' &middot; ' + escHtml(j.title) + '</b>' +
      '<div class="kg2-sub">' + escHtml(k ? k.name : '?') + (j.mode === 'external' ? ' &middot; external' + (j.workshop ? ' (' + escHtml(j.workshop) + ')' : '') : '') +
      (j.category ? ' &middot; ' + escHtml(j.category) : '') + (prog ? ' &middot; ' + prog : '') + '</div></div><div class="kg2-right">' +
      (od > 0 ? kg2Chip(od + 'd late', 'warn', '!') : '') + kg2Chip(j.status, j.status === 'open' ? 'ok' : '', j.status === 'open' ? '\u2022' : (j.status === 'closed' ? '\u2713' : '\u00d7')) +
      '<div class="kg2-num ' + (b.state === 'surplus' ? 'warn' : '') + '">' + kgFmtG(b.openFine) + '</div></div></div>';
  });
  return html;
}
function kg2Filter(x){ _kg2.jobFilter = x; renderKgV2(); }

function kg2KarigarsHtml(){
  var u = kgUser();
  var html = '<div class="kg2-head"><div class="kg2-title">Karigars</div><div class="kg2-sub">Terms, touches and routes.</div></div>' + kg2NavHtml();
  if(u.role === 'owner') html += '<div class="kg2-row">' + kg2Btn('+ Add touch (92, 95, 96...)', 'kg2AddTouch()') + kg2Btn('+ Route for a category', 'kg2Route()') + '</div>';
  var ks = S.karigars || [];
  html += '<div class="kg2-sec">Terms</div>';
  if(!ks.length) html += '<div class="kg2-empty">No karigars yet - add one by assigning from an order, then set terms here.</div>';
  ks.forEach(function(k){
    var kh = kgKhata(k.id), terms = kgAgreementText(kgAgreementFor(k.id, kgToday()) || k);
    html += '<div class="kg2-line"><div><b>' + escHtml(k.name) + '</b><div class="kg2-sub">' + escHtml(terms) + ' &middot; ' +
      kh.openJobs + ' open job' + (kh.openJobs === 1 ? '' : 's') + ' &middot; with karigar ' + kgFmtG(kh.openFine) + ' fine</div></div>' +
      (u.role === 'owner' ? kg2Btn(k.kind ? 'Change terms' : 'Set terms', 'kg2Terms(' + kg2Q(k.id) + ')') : '') + '</div>';
  });
  html += '<div class="kg2-sec">Routes (stages per product category)</div>';
  var routes = S.kgRoutes || [];
  if(!routes.length) html += '<div class="kg2-empty">No routes yet. A job made with no route has no stages.</div>';
  routes.forEach(function(r){
    html += '<div class="kg2-line"><div><b>' + escHtml(r.category === '*' ? 'Any other category' : r.category) + '</b><div class="kg2-sub">' + r.stages.map(escHtml).join(' &rarr; ') + '</div></div>' +
      (u.role === 'owner' ? kg2Btn('Edit', 'kg2Route(' + kg2Q(r.category) + ')') : '') + '</div>';
  });
  return html;
}
function kg2Route(category){
  var r = category ? kgRouteFor(category) : null;
  var cats = [['*', 'Any other category']].concat(CATS.filter(function(c){ return c !== 'All'; }).map(function(c){ return [c, c]; }));
  kgForm({title:'Route for a category', submitLabel:'Save route', doneToast:'\u2713 Route saved',
    fields:[
      {id:'cat', label:'Product category', type:'select', options:cats, value:category || '*'},
      {id:'stages', label:'Stages in order, separated by commas', value:(r && r.category === (category || '*')) ? r.stages.join(', ') : '', hint:'Example: Casting, Filing, Setting, Polish. Leave empty to remove the route.'}],
    onSubmit:function(v, fin){ kgSetRoute(v.cat, v.stages, function(err){ fin(err); }); }});
}

function kg2JobHtml(job){
  var u = kgUser(), k = findKarigar(job.karigarId), led = S.kgLedger || [], idx = kgIndex(led), b = kgJobBalance(job, led);
  var html = '<div class="kg2-row">' + kg2Btn('\u2190 All jobs', 'kg2Go(\'jobs\')') + '</div>' +
    '<div class="kg2-head"><div class="kg2-title">' + escHtml(job.jobNo) + ' &middot; ' + escHtml(job.title) + '</div>' +
    '<div class="kg2-sub">' + escHtml(k ? k.name : '?') + ' &middot; ' + escHtml(job.kind) +
    (job.kind === 'wastage' ? (job.model === 'points' ? ' ' + (kgTermsFor(job, job.karigarId).kind === 'salary' ? 'salary' : kgPointsLabel(kgTermsFor(job, job.karigarId).pointsPu)) : ' ' + (job.wastageBp / 100) + '%') : '') + ' &middot; ' + escHtml(job.status) +
    (job.orderRef ? ' &middot; linked to order' : '') + (job.category ? ' &middot; ' + escHtml(job.category) : '') +
    (job.mode === 'external' ? ' &middot; external' + (job.workshop ? ' (' + escHtml(job.workshop) + ')' : '') : ' &middot; in-house') +
    (job.dueDate ? ' &middot; due ' + escHtml(job.dueDate) : '') + '</div>' +
    (kgJobOverdueDays(job, kgToday()) > 0 ? '<div>' + kg2Chip(kgJobOverdueDays(job, kgToday()) + ' days late', 'warn', '!') + '</div>' : '') +
    (job.status === 'cancelled' ? '<div class="kg2-note warn">Cancelled: ' + escHtml(job.cancelReason || '') + '</div>' : '') + '</div>';
  function cell(l, v, cls){ return '<div class="kg2-cell ' + (cls || '') + '"><span>' + l + '</span><b>' + v + '</b></div>'; }
  html += '<div class="kg2-grid">' +
    cell('Issued (fine)', kgFmtG(b.issuedFine)) +
    (job.model === 'points' ? cell('Wastage allowed', kgFmtG(b.concededFine)) + cell('Must return', kgFmtG(b.accountable)) : (job.kind === 'wastage' ? cell('Karigar keeps', kgFmtG(b.earnedFine)) + cell('Must return', kgFmtG(b.accountable)) : cell('Must return', kgFmtG(b.accountable)))) +
    cell('Returned (pieces + scrap)', kgFmtG(b.returnedFine)) +
    cell('Approved loss', kgFmtG(b.approvedLoss)) +
    (b.adjust ? cell('Owner adjustment', kgFmtG(b.adjust)) : '') +
    cell(b.mixed ? 'Not balanced' : (b.state === 'surplus' ? 'Surplus' : 'Still with karigar'), b.mixed ? 'one karigar over, another short' : kgFmtG(Math.abs(b.openFine)), b.state === 'surplus' || b.mixed ? 'warn' : (b.openFine > 0 ? 'due' : 'ok')) +
  '</div>';
  if(job.earnings) html += '<div class="kg2-note">Final at close: karigar keeps ' + kgFmtG(job.earnings.earnedFine) + ' fine' +
    (job.earnings.fixedFine ? ' (' + kgFmtG(job.earnings.percentFine) + ' percentage + ' + kgFmtG(job.earnings.fixedFine) + ' fixed)' : '') +
    (job.earnings.labourPaise ? ' &middot; labour ' + kgFmtRs(job.earnings.labourPaise) + ' on ' + kgFmtG(job.earnings.labourBase === 'fine' ? job.earnings.fineMg : job.earnings.netMg) + ' ' + escHtml(job.earnings.labourBase) + ' weight' : '') + '</div>';
  var kgQ = kgQueuedForJob(job.id);
  if(kgQ > 0) html += '<div class="kg2-note warn">' + kgQ + ' gold entr' + (kgQ === 1 ? 'y is' : 'ies are') + ' waiting for confirmation from the ledger. Do not enter ' + (kgQ === 1 ? 'it' : 'them') + ' again. ' + (kgQ === 1 ? 'It sends' : 'They send') + ' on their own when the phone is online.</div>';
  if(b.pendingLoss > 0) html += '<div class="kg2-note warn">A loss of ' + kgFmtG(b.pendingLoss) + ' fine is waiting for owner approval.</div>';
  if(b.openFine > 0 && job.status === 'open') html += '<div class="kg2-note">Any metal not yet returned stays on the karigar. It is never counted as wastage or loss on its own.</div>';
  if(job.status === 'open'){
    html += '<div class="kg2-row">' + kg2Btn('Issue gold', 'kg2Issue(' + kg2Q(job.id) + ')', 'btn-gold') +
      kg2Btn('Receive piece', 'kg2Receipt(' + kg2Q(job.id) + ')') + kg2Btn('Scrap / dust', 'kg2Scrap(' + kg2Q(job.id) + ')') +
      kg2Btn(u.role === 'owner' ? 'Record loss' : 'Propose loss', 'kg2Loss(' + kg2Q(job.id) + ')') +
      (u.role === 'owner' ? kg2Btn('Adjust', 'kg2Adjust(' + kg2Q(job.id) + ')') : '') +
      kg2Btn('Close job', 'kg2Close(' + kg2Q(job.id) + ')') +
      (u.role === 'owner' && b.issuedFine === 0 ? kg2Btn('Cancel job', 'kg2Cancel(' + kg2Q(job.id) + ')') : '') + '</div>';
  } else if(job.status === 'closed' && u.role === 'owner'){
    html += '<div class="kg2-row">' + kg2Btn('Reopen job', 'kg2Reopen(' + kg2Q(job.id) + ')') + '</div>';
  }
  html += kg2JobStagesHtml(job) + kg2JobLinesHtml(job);
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
  if(e.type === 'RECEIPT') return escHtml(e.pieceDesc || '') + ' x' + escHtml(String(e.qty)) + ' &middot; ' + kgFmtG(e.mg) + ' ' + escHtml(p) + ' @' + (e.permille / 10) + '% = ' + kgFmtG(e.fineMg) + ' fine';
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
      '<div class="kg2-sub">' + escHtml(e.date) + (e.period ? ' &middot; ' + escHtml(e.period) : '') + (e.days ? ' &middot; ' + escHtml(String(e.days)) + ' day(s)' : '') +
      (e.mode ? ' &middot; ' + escHtml(e.mode) : '') + (e.note ? ' &middot; ' + escHtml(e.note) : '') + (e.reason ? ' &middot; ' + escHtml(e.reason) : '') + '</div></div>' +
      '<div class="kg2-right">' + (isRev ? '' : '<div class="kg2-num">' + kgFmtRs(e.amountPaise) + '</div>') +
      (!isRev && !gone && e.type !== 'JOB_LABOUR' ? kg2Btn('Reverse', 'kg2ReverseSalary(' + kg2Q(k.id) + ',' + kg2Q(e.id) + ')') : '') + '</div></div>';
  });
  return html;
}

// \u2500\u2500 modal form builder \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// fields: [{id,label,type:'text'|'select'|'check',options:[[value,label]],value,hint,show(vals)}]
// opts.preview(vals) -> html shown under the fields. opts.onSubmit(vals, finish(err)).
// The operation id is minted when the form OPENS, so a second tap on Save
// re-sends the same id and cannot create a second entry.
var _kgEscOff = null;
function kgForm(opts){
  if(_kgEscOff){ _kgEscOff(); _kgEscOff = null; }
  var old = document.getElementById('kg2-modal'); if(old) old.parentNode.removeChild(old);
  var ov = document.createElement('div'); ov.id = 'kg2-modal'; ov.className = 'kg2-ov';
  var opId = kgNewId();
  var h = '<div class="kg2-box" role="dialog" aria-modal="true" aria-label="' + escHtml(opts.title) + '"><div class="kg2-top"><div class="kg2-title">' + escHtml(opts.title) + '</div>' +
    '<div class="kg2-prev" id="kg2-prev"></div><div class="kg2-err" id="kg2-err" role="alert"></div></div>';
  opts.fields.forEach(function(f){
    h += '<div class="kg2-f' + (f.type === 'check' ? ' kg2-fchk' : '') + '" id="kg2w-' + f.id + '">' + (f.type === 'check' ? '' : '<label for="kg2f-' + f.id + '">' + escHtml(f.label) + '</label>');
    if(f.type === 'select'){
      h += '<select id="kg2f-' + f.id + '">' + f.options.map(function(o){
        return '<option value="' + escHtml(o[0]) + '"' + (String(o[0]) === String(f.value) ? ' selected' : '') + '>' + escHtml(o[1]) + '</option>';
      }).join('') + '</select>';
    } else if(f.type === 'check'){
      h += '<label class="kg2-chk" for="kg2f-' + f.id + '"><input type="checkbox" id="kg2f-' + f.id + '"' + (f.value ? ' checked' : '') + '><span>' + escHtml(f.label) + '</span></label>';
    } else {
      h += '<input type="text" id="kg2f-' + f.id + '" inputmode="' + (f.mode || 'text') + '" autocomplete="off" value="' + escHtml(f.value || '') + '">';
    }
    if(f.hint) h += '<div class="kg2-hint">' + escHtml(f.hint) + '</div>';
    h += '</div>';
  });
  h += '<div class="kg2-row kg2-foot"><button class="btn" id="kg2-cancel">Cancel</button><button class="btn btn-gold" id="kg2-save">' + escHtml(opts.submitLabel || 'Save') + '</button></div></div>';
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
  function closeSheet(){ if(_kgEscOff){ _kgEscOff(); _kgEscOff = null; } if(ov.parentNode) ov.parentNode.removeChild(ov); }
  function onKey(ev){ if(ev && (ev.key === 'Escape' || ev.keyCode === 27)) closeSheet(); }
  document.addEventListener('keydown', onKey);
  _kgEscOff = function(){ document.removeEventListener('keydown', onKey); };
  document.getElementById('kg2-cancel').onclick = closeSheet;
  var save = document.getElementById('kg2-save');
  save.onclick = function(){
    if(save.disabled) return;
    save.disabled = true;
    document.getElementById('kg2-err').textContent = '';
    opts.onSubmit(vals(), function(err){
      save.disabled = false;
      if(err){ document.getElementById('kg2-err').textContent = err.message || String(err); return; }
      closeSheet();
      renderKgV2();
      if(opts.doneToast) toast(opts.doneToast);
    });
  };
  refresh();
}
function kg2Err(msg, finish){ finish(new Error(msg)); }

function kg2PurOpts(){ return kgPurityList().map(function(p){ return [p.key, p.label + (p.custom ? '' : '')]; }); }

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
      {id:'pur', label:'Purity', type:'select', options:kg2PurOpts(), value:'999'},
      {id:'as24k', label:'Count 995 as 24K (100%)', type:'check', show:function(v){ return v.pur === '995'; }},
      {id:'pct', label:'Fineness % (type it for Other; 22K optional 91.6 to 92)', mode:'decimal', show:function(v){ return v.pur === '22K' || v.pur === 'other'; }},
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
      {id:'pur', label:'Purity', type:'select', options:kg2PurOpts(), value:'22K'},
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
      {id:'pur', label:'Purity', type:'select', options:kg2PurOpts(), value:'999'},
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
  var job = kgFindJob(jobId), sm = job ? kgStagesSummary(job) : null;
  function go(){
    kgCloseJob(jobId, function(err){
      if(err){ toast(err.message); return; }
      renderKgV2(); toast('\u2713 Job closed');
    });
  }
  if(sm && sm.total > sm.done){
    safeConfirm('Close with unfinished stages?', (sm.total - sm.done) + ' of ' + sm.total + ' stages are not marked done. Closing makes the earnings final.', go, 'warn');
    return;
  }
  go();
}
function kg2Reopen(jobId){
  kgReopenJob(jobId, function(err){
    if(err){ toast(err.message); return; }
    renderKgV2(); toast('Job reopened');
  });
}
function kg2NewJob(){
  var ks = (S.karigars || []).filter(function(k){ return k.kind === 'wastage' || k.kind === 'salary' || kgAgreementFor(k.id, kgToday()); });
  if(!ks.length){ toast('Set a karigar\'s terms (wastage or salary) first'); return; }
  var orders = (S.orders || []).filter(function(o){ return o.status !== 'cancelled' && o.status !== 'delivered'; });
  var cats = [['', 'None']].concat(CATS.filter(function(c){ return c !== 'All'; }).map(function(c){ return [c, c]; }));
  kgForm({title:'New job', submitLabel:'Create job', doneToast:'\u2713 Job created',
    fields:[
      {id:'k', label:'Karigar', type:'select', options:ks.map(function(k){ return [k.id, k.name + ' (' + (kgAgreementFor(k.id, kgToday()) || k).kind + ')']; }), value:ks[0].id},
      {id:'title', label:'Job title (e.g. 22K necklace set)'},
      {id:'cat', label:'Product category (sets the stages)', type:'select', options:cats, value:''},
      {id:'mode', label:'Made', type:'select', options:[['inhouse', 'In-house'], ['external', 'External workshop']], value:'inhouse'},
      {id:'ws', label:'Workshop name (optional)', show:function(v){ return v.mode === 'external'; }},
      {id:'due', label:'Due date (YYYY-MM-DD, optional)'},
      {id:'ord', label:'Link to customer order (optional)', type:'select', options:[['', 'None']].concat(orders.map(function(o){ return [o.id, o.ordNo + ' - ' + (o.customer || '')]; })), value:''}],
    preview:function(v){
      var r = v.cat ? kgRouteFor(v.cat) : null;
      return r ? 'Stages: ' + r.stages.map(escHtml).join(' &rarr; ') : '';
    },
    onSubmit:function(v, fin){
      kgCreateJob({karigarId:v.k, title:v.title, orderId:v.ord, category:v.cat, mode:v.mode, workshop:v.ws, dueDate:v.due}, v.opId, function(err, job){
        if(!err && job){ _kg2.view = 'job'; _kg2.jobId = job.id; }
        fin(err);
      });
    }});
}
function kg2Terms(karigarId){
  var k = findKarigar(karigarId); if(!k) return;
  var cur = kgAgreementFor(karigarId, kgToday()) || k;
  var hist = kgAgreementHistory(karigarId).map(function(a){ return a.effectiveFrom + ': ' + kgAgreementText(a); }).join(' | ');
  kgForm({title:'Terms for ' + k.name, submitLabel:'Save terms', doneToast:'\u2713 Terms saved',
    fields:[
      {id:'from', label:'Effective from (YYYY-MM-DD)', value:kgToday(), hint: hist ? 'History: ' + hist : 'A new version never changes earlier ones.'},
      {id:'kind', label:'Type', type:'select', options:[['wastage', 'Wastage (keeps a share of the gold)'], ['salary', 'Fixed salary (no gold earning)']], value:cur.kind || 'wastage'},
      {id:'points', label:'Wastage points on his touch (e.g. 4)', value:(cur.wastagePoints != null ? String(cur.wastagePoints / 100) : ''), mode:'decimal',
        hint:'Measured touch + points = what he is credited. Each new job starts with this; you can change it per job. Existing jobs keep their own.', show:function(v){ return v.kind === 'wastage' && kg3On(); }},
      {id:'pct', label:'Wastage % of fine gold issued', value:String((cur.wastageBp != null ? cur.wastageBp : KG_DEFAULT_WASTAGE_BP) / 100), mode:'decimal',
        hint:'Applies to jobs created from the date above. Existing jobs keep their own terms.', show:function(v){ return v.kind === 'wastage' && !kg3On(); }},
      {id:'fixed', label:'Extra fixed gold per job, grams (optional)', value:(cur.fixedMg ? String(cur.fixedMg / 1000) : ''), mode:'decimal',
        hint:'Counted from the first issue, final when the job closes.', show:function(v){ return v.kind === 'wastage' && !kg3On(); }},
      {id:'lab', label:'Labour per gram, \u20b9 (optional)', value:(cur.labour ? String(cur.labour.perGramPaise / 100) : ''), mode:'decimal', show:function(v){ return v.kind === 'wastage' && !kg3On(); }},
      {id:'labBase', label:'Labour is on', type:'select', options:[['net', 'Net weight of finished pieces'], ['fine', 'Fine weight of finished pieces']], value:(cur.labour && cur.labour.base) || 'net',
        show:function(v){ return v.kind === 'wastage' && !kg3On() && String(v.lab || '').trim() !== ''; }},
      {id:'mode', label:'Salary is', type:'select', options:[['monthly', 'Monthly'], ['daily', 'Daily']], value:(cur.salary && cur.salary.mode) || 'monthly', show:function(v){ return v.kind === 'salary'; }},
      {id:'rate', label:'Salary rate (\u20b9 per month / per day)', value:(cur.salary ? String(cur.salary.ratePaise / 100) : ''), mode:'decimal', show:function(v){ return v.kind === 'salary'; }}],
    onSubmit:function(v, fin){
      var w = v.kind === 'wastage';
      var on = kg3On(), keep = (w && cur.kind === 'wastage');
      // With the new screens on, the old percent / fixed gold / labour fields are hidden: carry the current ones forward, never reset them.
      kgAddAgreement(karigarId, {kind:v.kind, wastagePct:(on ? (keep && cur.wastageBp != null ? String(cur.wastageBp / 100) : '') : v.pct), points:(w && on ? v.points : ''),
        fixedGrams:(w ? (on ? (keep && cur.fixedMg ? String(cur.fixedMg / 1000) : '') : v.fixed) : ''), labourRate:(w ? (on ? (keep && cur.labour ? String(cur.labour.perGramPaise / 100) : '') : v.lab) : ''),
        labourBase:(on ? (keep && cur.labour ? cur.labour.base : 'net') : v.labBase), salaryMode:v.mode, rate:v.rate},String(v.from || '').trim(), v.opId, function(err){ fin(err); });
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

var _kg2Month = '';
function kg2SetMonth(inp){ _kg2Month = inp.value; renderKgV2(); }
var _kgRecon = {state:'idle'};
var _kgMig = {state:'idle'};
function kg2Reconcile(){
  _kgRecon = {state:'loading'}; renderKgV2();
  kgFetchBalances(function(err, rows){
    try{ _kgRecon = err ? {state:'error', msg:err.message} : {state:'done', rec:kgReconcile(rows)}; }
    catch(e){ _kgRecon = {state:'error', msg:'Could not compare the balances. Try again.'}; }
    renderKgV2();
  });
}
// The parked list lives in the shop data, which a staff login can rewrite, so the confirm screen shows what the
// LEDGER itself holds for this entry (author, day, lines), not the text in the shop data.
function kgJournalSummary(j){
  var parts = [];
  (j.lines || []).forEach(function(l){ parts.push(String(l.account) + (l.owner_ref ? ' ' + String(l.owner_ref) : '') + ' ' + kgFmtG(l.fine_mg)); });
  return 'On the ledger: ' + String(j.type) + ' on ' + String(j.business_date) + ' by ' + String(j.by_user || '?') + ' (' + String(j.by_role || '?') + '). ' + parts.join('; ');
}
function kg2ReverseParked(parkedId){
  var p = null;
  (S.kgParked || []).forEach(function(x){ if(x.id === parkedId) p = x; });
  if(!p){ toast('That entry is no longer parked'); return; }
  kgFindServerJournal(p.opId, function(err, orig){
    if(err){ toast(err.message); return; }
    if(!orig){ toast('The ledger has no entry with this id. Check the karigar ledger before doing anything.'); return; }
    kgForm({title:'Reverse this on the ledger', submitLabel:'Reverse', doneToast:'✓ Reversed on the ledger',
      fields:[{id:'reason', label:'Reason (required)', hint:kgJournalSummary(orig)}],
      onSubmit:function(v, fin){ kgReverseParked(parkedId, v.reason, function(err2){ fin(err2); }); }});
  });
}
function kg2ParkedHtml(){
  var list = S.kgParked || [];
  if(!list.length) return '';
  var html = '<div class="kg2-sec">Ledger has this, shop data refused it</div><div class="kg2-note warn">The gold below is on the ledger but is not in the shop data. Check each one before doing anything.</div>';
  list.forEach(function(p){
    var e = p.entry || {}, k = findKarigar(e.karigarId);
    html += '<div class="kg2-line"><div><b>' + escHtml(k ? k.name : String(e.karigarId || '')) + '</b> &middot; ' + escHtml(String(e.type || '')) +
      '<div class="kg2-sub">' + escHtml(p.why || '') + '</div></div><div class="kg2-num warn">' + kgFmtG(e.fineMg || 0) + '</div>' +
      (kgUser().role === 'owner' ? '<div class="kg2-right">' + kg2Btn('Reverse on ledger', 'kg2ReverseParked(' + kg2Q(p.id) + ')') + '</div>' : '') + '</div>';
  });
  return html;
}
function kg2RejectedHtml(){
  var list = kgRejectedList();
  if(!list.length) return '';
  var html = '<div class="kg2-sec">Ledger refused these</div><div class="kg2-note warn">The ledger did not take the gold below. Usually it is in neither the ledger nor the shop data; if the reason says the ledger may already have it, check the ledger first. Check with the karigar before entering it again. This list is kept on this phone only and is deleted when you sign out.</div>';
  list.forEach(function(r){
    var j = r.journal || {}, fine = 0;
    (j.lines || []).forEach(function(l){ if(Number(l.fine_mg) > 0) fine += Number(l.fine_mg); });
    html += '<div class="kg2-line"><div><b>' + escHtml(String(j.type || '')) + '</b><div class="kg2-sub">' + escHtml(String(r.why || '')) + ' &middot; ' + escHtml(String(r.at || '').slice(0, 10)) + '</div></div><div class="kg2-num warn">' + kgFmtG(fine) + '</div></div>';
  });
  return html;
}
function kg2LedgerHtml(){
  var on = S.kgLedgerOn === true, owner = kgUser().role === 'owner';
  return '<div class="kg2-sec">Ledger switch</div><div class="kg2-note' + (on ? '' : ' warn') + '">Ledger is ' + (on ? 'on' : 'off') + '. ' +
    (on ? 'Gold entries go to the server ledger first and need internet.' : 'Gold entries are saved in the shop data only.') + '</div>' +
    (owner ? '<div class="kg2-row">' + kg2Btn(on ? 'Turn ledger off' : 'Turn ledger on', 'kg2ToggleLedger()') + '</div>' : '');
}
// Opening balances: what each karigar holds in the shop data is posted once to the ledger as an OPENING journal, before the
// ledger is switched on. Preview first, then confirm exactly that list (kgMigrateBlobToLedger enforces the same).
function kg2MigPreview(){
  _kgMig = {state:'loading'}; renderKgV2();
  kgMigrateBlobToLedger(function(err, rep){
    _kgMig = err ? {state:'error', msg:err.message} : {state:'preview', pre:rep};
    renderKgV2();
  }, {dryRun:true});
}
function kg2MigRun(){
  if(_kgMig.state !== 'preview') return;
  var list = _kgMig.pre.would;
  safeConfirm('Post these balances to the ledger?', 'Each karigar below gets one opening entry for the gold held now. This is posted once and cannot be edited, only reversed. Check the list first.', function(){
    _kgMig = {state:'loading'}; renderKgV2();
    kgMigrateBlobToLedger(function(err, rep){
      _kgMig = err ? {state:'error', msg:err.message} : {state:'done', rep:rep};
      renderKgV2();
    }, {confirmed:list});
  });
}
function kg2MigHtml(){
  if(kgUser().role !== 'owner') return '';
  var st = _kgMig.state, html = '<div class="kg2-sec">Opening balances</div>';
  if(S.kgLedgerOn === true) return html + '<div class="kg2-note">The ledger is already on, so opening balances can no longer be posted. Fix a difference with an owner adjustment.</div>';
  if(st === 'loading') return html + '<div class="kg2-empty">Working...</div>';
  if(st === 'error') return html + '<div class="kg2-note warn">' + escHtml(_kgMig.msg) + '</div><div class="kg2-row">' + kg2Btn('Try again', 'kg2MigPreview()') + '</div>';
  if(st === 'idle') return html + '<div class="kg2-note">Before the ledger is switched on, post what each karigar holds now as an opening entry. You see the list first.</div><div class="kg2-row">' + kg2Btn('Preview opening balances', 'kg2MigPreview()') + '</div>';
  function rows(list, cls){
    return list.map(function(r){ return '<div class="kg2-line"><div><b>' + escHtml(r.name || r.karigarId) + '</b></div><div class="kg2-num ' + (cls || '') + '">' + kgFmtG(r.fineMg) + '</div></div>'; }).join('');
  }
  if(st === 'preview'){
    var p = _kgMig.pre;
    html += p.would.length ? '<div class="kg2-note">These karigars hold gold now. Posting opens each balance on the ledger.</div>' + rows(p.would) : '<div class="kg2-empty">No karigar holds gold, so there is nothing to open.</div>';
    if(p.needsReview.length) html += '<div class="kg2-note warn">Needs review, not posted: these balances are below zero in the shop data. Fix them first.</div>' + rows(p.needsReview, 'warn');
    return html + '<div class="kg2-row">' + (p.would.length ? kg2Btn('Post these balances', 'kg2MigRun()', 'btn-gold') : '') + kg2Btn('Preview again', 'kg2MigPreview()') + '</div>';
  }
  var r = _kgMig.rep;
  html += '<div class="kg2-note">' + r.posted.length + ' opened' + (r.duplicates ? ', ' + r.duplicates + ' already on the ledger' : '') + '. Now run "Check now" under Blob vs ledger: it should show no difference.</div>';
  if(r.failed.length) html += '<div class="kg2-note warn">' + r.failed.length + ' not opened:</div>' + r.failed.map(function(f){
    var k = findKarigar(f.karigarId); return '<div class="kg2-line"><div><b>' + escHtml(k ? k.name : String(f.karigarId)) + '</b><div class="kg2-sub">' + escHtml(String(f.why)) + '</div></div></div>'; }).join('');
  if(r.needsReview.length) html += '<div class="kg2-note warn">Needs review, not posted:</div>' + rows(r.needsReview, 'warn');
  return html + '<div class="kg2-row">' + kg2Btn('Preview again', 'kg2MigPreview()') + '</div>';
}
function kg2ToggleLedger(){
  var turnOn = S.kgLedgerOn !== true;
  safeConfirm(turnOn ? 'Turn the ledger on?' : 'Turn the ledger off?',
    turnOn ? 'From now on every gold issue, receipt, scrap and adjustment goes to the server ledger first and needs internet. Check that "Blob vs ledger" below shows no difference before you do this.'
           : 'Gold entries will be saved in the shop data only again. What is already on the ledger stays there, and the two will drift apart. Only do this if you were told to.',
    function(){ kgSetLedger(turnOn, function(err){ if(err){ toast(err.message); return; } renderKgV2(); toast(turnOn ? '✓ Ledger is on' : 'Ledger is off'); }); }, !turnOn);
}
function kg2ReconHtml(){
  var st = _kgRecon.state, html = '<div class="kg2-sec">Blob vs ledger</div>';
  if(st === 'loading') return html + '<div class="kg2-empty">Checking the ledger...</div>';
  if(st === 'error') return html + '<div class="kg2-note warn">' + escHtml(_kgRecon.msg) + '</div><div class="kg2-row">' + kg2Btn('Try again', 'kg2Reconcile()') + '</div>';
  if(st !== 'done') return html + '<div class="kg2-note">Compares the gold each karigar holds in the shop data with the ledger. It should show no difference before the ledger is switched on.</div><div class="kg2-row">' + kg2Btn('Check now', 'kg2Reconcile()') + '</div>';
  var rec = _kgRecon.rec;
  if(!rec.mismatches.length && !rec.unknown.length) html += '<div class="kg2-empty">✓ All karigars match. ' + rec.rows.length + ' checked.</div>';
  if(rec.mismatches.length) html += '<div class="kg2-note warn">' + rec.mismatches.length + ' karigar' + (rec.mismatches.length === 1 ? '' : 's') + ' differ between the shop data and the ledger.</div>';
  rec.mismatches.forEach(function(m){
    html += '<div class="kg2-line"><div><b>' + escHtml(m.name) + '</b><div class="kg2-sub">shop data ' + kgFmtG(m.blob) + ' &middot; ledger ' + kgFmtG(m.ledger) + ' fine</div></div>' +
      '<div class="kg2-right"><div class="kg2-num warn">' + (m.diff > 0 ? '+' : '-') + kgFmtG(Math.abs(m.diff)) + '</div></div></div>';
  });
  if(rec.unknown.length) html += '<div class="kg2-note warn">The ledger holds gold for people who are not in the shop data:</div>';
  rec.unknown.forEach(function(u){
    html += '<div class="kg2-line"><div><b>' + escHtml(u.ownerRef) + '</b><div class="kg2-sub">' + escHtml(u.account) + '</div></div><div class="kg2-num">' + kgFmtG(u.fineMg) + '</div></div>';
  });
  return html + '<div class="kg2-row">' + kg2Btn('Check again', 'kg2Reconcile()') + '</div>';
}
function kg2ReportsHtml(){
  var month = /^\d{4}-\d{2}$/.test(_kg2Month) ? _kg2Month : kgToday().slice(0, 7);
  var r = kgReport(month + '-01', month + '-31');
  function name(id){ var k = findKarigar(id); return escHtml(k ? k.name : '?'); }
  var html = '<div class="kg2-head"><div class="kg2-title">Reports</div><div class="kg2-sub">Fine gold only. Pick a month.</div></div>' + kg2NavHtml() +
    '<input type="text" class="kg2-sel" value="' + escHtml(month) + '" placeholder="YYYY-MM" onchange="kg2SetMonth(this)">' +
    (kgUser().role === 'owner' ? '<div class="kg2-note">New karigar screens (profile, statement, points jobs) on this device: <b>' + (kg3On() ? 'ON' : 'OFF') + '</b> ' +
      kg2Btn(kg3On() ? 'Switch off' : 'Switch on', 'kg3Switch(' + (kg3On() ? 'false' : 'true') + ')') + '</div>' : '');
  html += '<div class="kg2-sec">Wastage kept by karigars</div>';
  if(!r.wastage.length) html += '<div class="kg2-empty">No gold issued to wastage karigars this month.</div>';
  r.wastage.forEach(function(w){
    html += '<div class="kg2-line"><div><b>' + name(w.karigarId) + '</b><div class="kg2-sub">issued ' + kgFmtG(w.issuedFine) + ' fine' + (w.fixedFine ? ' &middot; plus ' + kgFmtG(w.fixedFine) + ' fixed (jobs closed)' : '') + '</div></div><div class="kg2-num">' + kgFmtG(w.keptFine + (w.fixedFine || 0)) + '</div></div>';
  });
  html += '<div class="kg2-sec">Wastage allowed on points jobs</div>';
  if(!r.conceded.length) html += '<div class="kg2-empty">None this month.</div>';
  r.conceded.forEach(function(c){ html += '<div class="kg2-line"><div><b>' + name(c.karigarId) + '</b><div class="kg2-sub">credit given above the fine really in the pieces</div></div><div class="kg2-num">' + kgFmtG(c.fineMg) + '</div></div>'; });
  if(r.conceded.length) html += '<div class="kg2-line"><b>Total allowed</b><div class="kg2-num">' + kgFmtG(r.concededTotal) + '</div></div>';
  html += '<div class="kg2-sec">Manufacturing loss register (approved)</div>';
  if(!r.losses.length) html += '<div class="kg2-empty">No approved loss this month.</div>';
  r.losses.forEach(function(l){
    html += '<div class="kg2-line"><div><b>' + escHtml(l.category) + '</b> &middot; ' + name(l.karigarId) + '<div class="kg2-sub">' + escHtml(l.date) + ' &middot; ' + escHtml(l.jobNo) +
      ' &middot; ' + escHtml(l.reason) + (l.reversed ? ' &middot; reversed' : ' &middot; approved by ' + escHtml(l.approvedBy)) + '</div></div><div class="kg2-num">' + kgFmtG(l.fineMg) + '</div></div>';
  });
  if(r.losses.length) html += '<div class="kg2-line"><b>Total loss</b><div class="kg2-num">' + kgFmtG(r.lossTotal) + '</div></div>';
  html += '<div class="kg2-sec">Scrap and dust recovered</div>';
  var kinds = Object.keys(r.scrapByKind);
  if(!kinds.length) html += '<div class="kg2-empty">None this month.</div>';
  kinds.forEach(function(kd){ html += '<div class="kg2-line"><div>' + escHtml(kd) + '</div><div class="kg2-num">' + kgFmtG(r.scrapByKind[kd]) + '</div></div>'; });
  html += '<div class="kg2-sec">Gold still with karigars (open jobs)</div>';
  if(!r.open.length) html += '<div class="kg2-empty">Nothing outstanding.</div>';
  r.open.forEach(function(o){
    html += '<div class="kg2-line kg2-click" onclick="kg2OpenJob(' + kg2Q(o.job.id) + ')"><div><b>' + escHtml(o.job.jobNo) + '</b> &middot; ' + name(o.job.karigarId) +
      (o.byKarigar && (o.byKarigar.length > 1 || o.byKarigar[0].kid !== o.job.karigarId) ? '<div class="kg2-sub">' + o.byKarigar.map(function(f){ return name(f.kid) + ' ' + kgFmtG(f.fine); }).join(' &middot; ') + '</div>' : '') + '</div><div class="kg2-num">' + kgFmtG(o.openFine) + '</div></div>';
  });
  if(r.surplus.length){
    html += '<div class="kg2-sec">Jobs where karigar returned MORE than due</div>';
    r.surplus.forEach(function(o){
      html += '<div class="kg2-line kg2-click" onclick="kg2OpenJob(' + kg2Q(o.job.id) + ')"><div><b>' + escHtml(o.job.jobNo) + '</b> &middot; ' + name(o.job.karigarId) +
        (o.byKarigar && (o.byKarigar.length > 1 || o.byKarigar[0].kid !== o.job.karigarId) ? '<div class="kg2-sub">' + o.byKarigar.map(function(f){ return name(f.kid) + ' ' + kgFmtG(-f.fine); }).join(' &middot; ') + '</div>' : '') + '</div><div class="kg2-num warn">' + kgFmtG(-o.openFine) + '</div></div>';
    });
  }
  return html + kg2ParkedHtml() + kg2RejectedHtml() + (kg3On() ? '' : kg2MigHtml() + kg2ReconHtml() + kg2LedgerHtml());   // with the new screens on, the old migration / reconcile / ledger-switch blocks are hidden
}

function kg2AddTouch(){
  var have = (S.kgPurities || []).map(function(d){ return d.label; }).join(', ');
  kgForm({title:'Add a gold touch', submitLabel:'Add touch', doneToast:'\u2713 Touch added',
    fields:[{id:'pct', label:'Touch / fineness % (e.g. 92, 95, 96)', mode:'decimal', hint: have ? 'Saved: ' + have : 'It then appears in the Purity list when you issue or receive gold.'}],
    onSubmit:function(v, fin){ kgAddPurity(v.pct, function(err){ fin(err); }); }});
}

function kg2JobStagesHtml(job){
  var st = job.stages || [], u = kgUser(), open = job.status === 'open';
  if(!st.length) return '';
  var html = '<div class="kg2-sec">Stages</div><ol class="kg2-steps">';
  st.forEach(function(x, i){
    var who = x.who ? findKarigar(x.who) : null, mark = x.status === 'done' ? '\u2713' : String(i + 1);
    var acts = '';
    if(open){
      if(x.status === 'pending') acts += kg2Btn('Start', 'kg2Stage(' + kg2Q(job.id) + ',' + kg2Q(x.id) + ',\'start\')');
      if(x.status === 'active') acts += kg2Btn('Done', 'kg2Stage(' + kg2Q(job.id) + ',' + kg2Q(x.id) + ',\'done\')', 'btn-gold');
      if(x.status !== 'pending' && u.role === 'owner') acts += kg2Btn('Undo', 'kg2Stage(' + kg2Q(job.id) + ',' + kg2Q(x.id) + ',\'undo\')');
      acts += kg2Btn(who ? 'Change who' : 'Who?', 'kg2StageWho(' + kg2Q(job.id) + ',' + kg2Q(x.id) + ')');
    }
    html += '<li class="kg2-step st-' + escHtml(x.status) + '"><span class="kg2-dot" aria-hidden="true">' + mark + '</span><div class="kg2-stepbody"><b>' + escHtml(x.name) + '</b> ' +
      kg2Chip(x.status === 'done' ? 'Done' : (x.status === 'active' ? 'In progress' : 'Waiting'), x.status === 'done' ? 'ok' : '', '') +
      '<div class="kg2-sub">' + (who ? escHtml(who.name) : 'no one assigned') + (x.doneAt ? ' &middot; finished ' + escHtml(String(x.doneAt).slice(0, 10)) : (x.startedAt ? ' &middot; started ' + escHtml(String(x.startedAt).slice(0, 10)) : '')) + '</div></div>' +
      '<div class="kg2-right">' + acts + '</div></li>';
  });
  return html + '</ol><div class="kg2-hint">A stage\'s person is a label for now. Gold stays with the job\'s karigar until transfers are added.</div>';
}
function kg2JobLinesHtml(job){
  var lines = job.lines || [], open = job.status === 'open';
  var html = '<div class="kg2-sec">Pieces to make</div>';
  if(!lines.length) html += '<div class="kg2-empty">No pieces listed.</div>';
  lines.forEach(function(l){
    html += '<div class="kg2-line' + (l.void ? ' kg2-struck' : '') + '"><div><b>' + escHtml(l.desc) + '</b> x' + escHtml(String(l.qty)) +
      '<div class="kg2-sub">' + (l.targetMg ? 'target ' + kgFmtG(l.targetMg) : 'no target weight') + (l.void ? ' &middot; removed: ' + escHtml(l.void.reason) : '') + '</div></div>' +
      '<div class="kg2-right">' + (open && !l.void ? kg2Btn('Remove', 'kg2VoidLine(' + kg2Q(job.id) + ',' + kg2Q(l.id) + ')') : '') + '</div></div>';
  });
  if(open) html += '<div class="kg2-row">' + kg2Btn('+ Add piece', 'kg2AddLine(' + kg2Q(job.id) + ')') + '</div>';
  return html;
}
function kg2Stage(jobId, stageId, action){
  kgStageAction(jobId, stageId, action, '', function(err){ if(err){ toast(err.message); return; } renderKgV2(); });
}
function kg2StageWho(jobId, stageId){
  var opts = [['', 'No one']].concat((S.karigars || []).map(function(k){ return [k.id, k.name]; }));
  kgForm({title:'Who is doing this stage?', submitLabel:'Save', doneToast:'\u2713 Saved',
    fields:[{id:'who', label:'Karigar', type:'select', options:opts, value:''}],
    onSubmit:function(v, fin){ kgStageAction(jobId, stageId, 'who', v.who, function(err){ fin(err); }); }});
}
function kg2AddLine(jobId){
  kgForm({title:'Add a piece to make', submitLabel:'Add piece', doneToast:'\u2713 Piece added',
    fields:[{id:'desc', label:'Piece (e.g. necklace set)'}, {id:'qty', label:'Quantity', value:'1', mode:'numeric'},
            {id:'tg', label:'Target weight in grams (optional)', mode:'decimal'}],
    onSubmit:function(v, fin){ kgAddLine(jobId, {desc:v.desc, qty:v.qty, targetGrams:v.tg}, v.opId, function(err){ fin(err); }); }});
}
function kg2VoidLine(jobId, lineId){
  kgForm({title:'Remove this piece', submitLabel:'Remove', doneToast:'Piece removed',
    fields:[{id:'reason', label:'Reason (required)'}],
    onSubmit:function(v, fin){ kgVoidLine(jobId, lineId, v.reason, function(err){ fin(err); }); }});
}
function kg2Cancel(jobId){
  kgForm({title:'Cancel this job', submitLabel:'Cancel job', doneToast:'Job cancelled',
    fields:[{id:'reason', label:'Reason (required)', hint:'Only possible while no gold has been issued on it.'}],
    onSubmit:function(v, fin){ kgCancelJob(jobId, v.reason, function(err){ fin(err); }); }});
}


// \u2550\u2550 Karigar profile screens (redesign batches 7-9) \u2550\u2550
// Shown only while the per-device switch is on (kg3On). Everything above (the maths and the ledger) is unchanged; these
// functions only read it and call the same builders. Old-rules jobs keep the old job page.
function kg3On(){
  try{ return localStorage.getItem(shopScopedKey('kgProfileUi')) === '1'; }catch(e){ return false; }
}
function kg3Switch(on){
  try{ localStorage.setItem(shopScopedKey('kgProfileUi'), on ? '1' : '0'); }catch(e){}
  _kg2.view = on ? 'people' : 'home';
  renderKgV2();
}
function kg3Open(kid){ _kg2.karigarId = kid; _kg2.view = 'profile'; renderKgV2(); }
function kg3Name(kid){ var k = findKarigar(kid); return k ? k.name : '?'; }
function kg3G(mg, metal){ return kgFmtG(mg) + (metal === 'silver' ? ' silver' : ''); }
function kg3Tile(label, value, sub, cls){
  return '<div class="kg2-kpi ' + (cls || '') + '"><span>' + escHtml(label) + '</span><b>' + value + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</div>';
}
function kg3RupeeTile(p){
  if(p.payablePaise > 0) return kg3Tile('You owe him', escHtml(kgFmtRs(p.payablePaise)), '', 'due');
  if(p.payablePaise < 0) return kg3Tile('He owes you', escHtml(kgFmtRs(-p.payablePaise)), '', 'warn');
  return kg3Tile('Rupees', escHtml(kgFmtRs(0)), 'nothing owed');
}
function kg3HasMetal(kid, metal){
  if(kgMetalAccount(kid, metal).totalMg !== 0) return true;
  var found = false;
  (S.kgLedger || []).forEach(function(e){ if(e.karigarId === kid && kgMetalOf(e) === metal) found = true; });
  return found;
}

// \u2500\u2500 People list \u2500\u2500
function kg3PeopleHtml(){
  var html = '<div class="kg2-head"><div class="kg2-title">Karigars</div><div class="kg2-sub">Open a karigar to see his account.</div></div>' + kg2NavHtml();
  var ks = S.karigars || [];
  if(!ks.length) html += '<div class="kg2-empty">No karigars yet. Add one by assigning a stage on an order, then open him here.</div>';
  ks.forEach(function(k){
    var a = kgAccount(k.id), right = '<div class="kg2-num">' + escHtml(kgFmtG(a.gold.totalMg)) + '</div>';
    if(kg3HasMetal(k.id, 'silver')) right += '<div class="kg2-sub">' + escHtml(kgFmtG(a.silver.totalMg)) + ' silver</div>';
    if(a.rupees.payablePaise !== 0) right += '<div class="kg2-sub">' + (a.rupees.payablePaise > 0 ? 'owe ' : 'he owes ') + escHtml(kgFmtRs(Math.abs(a.rupees.payablePaise))) + '</div>';
    var chips = '';
    if(a.overdue) chips += kg2Chip(a.overdue + ' late', 'warn', '!');
    if(a.countDue) chips += kg2Chip('count due', 'warn', '!');
    html += '<div class="kg2-line kg2-click" role="button" tabindex="0" onclick="kg3Open(' + kg2Q(k.id) + ')"><div><b>' + escHtml(k.name) + '</b>' +
      '<div class="kg2-sub">' + a.inProgress + ' job' + (a.inProgress === 1 ? '' : 's') + ' in progress ' + chips + '</div></div><div class="kg2-right" style="display:block;">' + right + '</div></div>';
  });
  html += kg3ShopMetalHtml('gold');
  if(kgRefineLots('silver').length || kgHeldFine('silver') > 0) html += kg3ShopMetalHtml('silver');
  return html;
}
function kg3ShopMetalHtml(metal){
  var v = kgShopMetalView(metal), lots = kgRefineLots(metal).filter(function(l){ return l.status === 'pending'; });
  var html = '<div class="kg2-sec">Shop ' + escHtml(metal) + ' (fine)</div><div class="kg2-kpis">' +
    kg3Tile('With karigars', escHtml(kgFmtG(v.withKarigarsMg))) + kg3Tile('Being refined (estimate)', escHtml(kgFmtG(v.refiningEstMg))) +
    kg3Tile('Refined (assay)', escHtml(kgFmtG(v.refinedMg))) + '</div>';
  kgRefineLots(metal).filter(function(l){ return l.status === 'credited'; }).forEach(function(l){
    html += '<div class="kg2-line"><div><b>' + escHtml(l.kind) + ' assay ' + escHtml(kgFmtG(l.assayFineMg)) + ' fine</b><div class="kg2-sub">sent ' + escHtml(kgFmtG(l.estFineMg)) + ' est. &middot; ' + escHtml(l.date) +
      ' &middot; ' + escHtml(kg3Name(l.karigarId)) + '</div></div>' + (kgUser().role === 'owner' && !S.kgLedgerOn ? kg2Btn('Reverse assay', 'kg3Reverse(' + kg2Q(l.creditId) + ')') : '') + '</div>';
  });
  lots.forEach(function(l){
    html += '<div class="kg2-line"><div><b>' + escHtml(l.kind) + ' ' + escHtml(kgFmtG(l.estFineMg)) + ' fine</b><div class="kg2-sub">' + escHtml(l.date) + (l.jobNo ? ' &middot; ' + escHtml(l.jobNo) : '') +
      ' &middot; ' + escHtml(kg3Name(l.karigarId)) + '</div></div>' + (kgUser().role === 'owner' ? kg2Btn('Assay result', 'kg3Refine(' + kg2Q(l.scrapId) + ')') : '') + '</div>';
  });
  return html;
}

// \u2500\u2500 One karigar \u2500\u2500
function kg3ProfileHtml(kid){
  var k = findKarigar(kid), u = kgUser();
  if(!k) return '<div class="kg2-empty">Karigar not found.</div>' + kg2Btn('\u2190 All karigars', 'kg2Go(\'people\')');
  var a = kgAccount(kid), g = a.gold;
  var html = '<div class="kg2-row">' + kg2Btn('\u2190 All karigars', 'kg2Go(\'people\')') + '</div><div class="kg2-head"><div class="kg2-title">' + escHtml(k.name) + '</div>' +
    '<div class="kg2-sub">' + escHtml(kgAgreementText(kgAgreementFor(kid, kgToday()) || k)) + '</div></div>';
  html += '<div class="kg2-kpis">' + kg3Tile('Gold with him (fine)', escHtml(kgFmtG(g.totalMg)),
    'on jobs ' + escHtml(kgFmtG(g.inJobsMg)) + (g.carryMg ? ' &middot; carried ' + escHtml(kgFmtG(g.carryMg)) : '') + (g.openingMg ? ' &middot; opening ' + escHtml(kgFmtG(g.openingMg)) : ''), g.totalMg > 0 ? 'due' : '');
  if(kg3HasMetal(kid, 'silver')) html += kg3Tile('Silver with him (fine)', escHtml(kgFmtG(a.silver.totalMg)),
    'on jobs ' + escHtml(kgFmtG(a.silver.inJobsMg)) + (a.silver.carryMg ? ' &middot; carried ' + escHtml(kgFmtG(a.silver.carryMg)) : ''));
  html += kg3RupeeTile(a.rupees) + kg3Tile('Jobs in progress', String(a.inProgress), a.overdue ? a.overdue + ' late' : '', a.overdue ? 'warn' : '') + '</div>';
  var notes = '';
  if(a.countDue) notes += '<div class="kg2-note warn">A physical count of the carried balance is due (every ' + KG_COUNT_DAYS + ' days).</div>';
  [['gold', g], ['silver', a.silver]].forEach(function(m){
    var ck = kgCarryCheck(kid, m[0], 0);
    if(ck.over) notes += '<div class="kg2-note warn">Carried ' + escHtml(m[0]) + ' ' + escHtml(kgFmtG(ck.total)) + ' is over his limit of ' + escHtml(kgFmtG(ck.ceiling)) + '.</div>';
    if(m[1].oldestCarryDays > 30) notes += '<div class="kg2-note">Oldest carried ' + escHtml(m[0]) + ' is ' + m[1].oldestCarryDays + ' days old.</div>';
  });
  html += notes + '<div class="kg2-row">' + kg2Btn('+ New job', 'kg3NewJob(' + kg2Q(kid) + ')', 'btn-gold') + kg2Btn('Statement', 'kg3Statement(' + kg2Q(kid) + ')') +
    (u.role === 'owner' ? kg2Btn('Opening balance', 'kg3Opening(' + kg2Q(kid) + ')') + kg2Btn('Rupee opening', 'kg3RupeeOpening(' + kg2Q(kid) + ')') + kg2Btn('Record payment', 'kg2Money(' + kg2Q(kid) + ', \'PAYMENT\')') + kg2Btn('Carry settings', 'kg3Carry(' + kg2Q(kid) + ')') : '') +
    (k.carryTrusted ? kg2Btn('Record count', 'kg3Count(' + kg2Q(kid) + ')') : '') + kg2Btn('Edit details', 'kg3EditDetails(' + kg2Q(kid) + ')') + '</div>';
  html += '<div class="kg2-sec">Jobs</div>';
  var jobs = (S.kgJobs || []).filter(function(j){ return j.status !== 'cancelled' && (j.karigarId === kid || (j.model === 'points' && kgJobKarigarOk(j, kid))); })
    .sort(function(x, y){ return (x.status === 'open' ? 0 : 1) - (y.status === 'open' ? 0 : 1) || String(y.createdAt).localeCompare(String(x.createdAt)); });
  if(!jobs.length) html += '<div class="kg2-empty">No jobs for him yet.</div>';
  jobs.slice(0, 30).forEach(function(j){
    var held = j.model === 'points' ? kgKarigarJobFine(j, S.kgLedger || [], kid) : kgJobBalance(j, S.kgLedger || []).openFine;
    html += '<div class="kg2-line kg2-click" role="button" tabindex="0" onclick="kg2OpenJob(' + kg2Q(j.id) + ')"><div><b>' + escHtml(j.jobNo) + ' &middot; ' + escHtml(j.title) + '</b>' +
      '<div class="kg2-sub">' + escHtml(j.status) + (j.model === 'points' ? '' : ' &middot; old rules') + (j.tag ? ' &middot; ' + escHtml(j.tag) : '') + '</div></div><div class="kg2-right"><div class="kg2-num">' + escHtml(kg3G(held, kgMetalOf(j))) + '</div></div></div>';
  });
  var ow = kgOrderWork(kid);
  if(ow.any){
    html += '<div class="kg2-sec">Order work (old way, not added to the account above)</div><div class="kg2-line"><div><b>' + (ow.queue.length) + ' order stage' + (ow.queue.length === 1 ? '' : 's') + ' in progress</b>' +
      '<div class="kg2-sub">Metal with him on orders: gold ' + escHtml(Number(ow.held.gold).toFixed(3)) + ' g, silver ' + escHtml(Number(ow.held.silver).toFixed(3)) + ' g &middot; owed to him: ' +
      escHtml(fmt(ow.owed.cash)) + (ow.owed.gold ? ' + ' + escHtml(Number(ow.owed.gold).toFixed(3)) + ' g gold' : '') + (ow.owed.silver ? ' + ' + escHtml(Number(ow.owed.silver).toFixed(3)) + ' g silver' : '') + '</div></div>' +
      (u.role === 'owner' ? kg2Btn('Pay for order work', 'kg3PayOrder(' + kg2Q(kid) + ')') : '') + '</div>';
  }
  html += kg3PayOrderRecentHtml(kid);
  return html;
}

// \u2500\u2500 Statement for a date range \u2500\u2500
// Plain words for a ledger row, and a sign for the direction (+ = more with him, - = less with him).
var KG_WORDS = {ISSUE:'Given', RECEIPT:'Received', SCRAP:'Scrap / dust returned', LOSS:'Loss', ADJUST:'Owner adjustment', OPENING:'Opening balance',
  CARRY_OUT:'Carried forward', CARRY_IN:'Carried balance', CARRY_APPLY:'Carried balance used', REFINE_CREDIT:'Assay result',
  ACCRUAL:'Salary due', JOB_LABOUR:'Job labour', PAYMENT:'Paid', ADVANCE:'Advance given', DEDUCTION:'Deducted'};
function kgTransferPartner(e){
  var other = null;
  (S.kgLedger || []).forEach(function(x){ if(x.voucherId && x.voucherId === e.voucherId && x.id !== e.id && x.type !== 'REVERSAL') other = x; });
  return other ? kg3Name(other.karigarId) : '';
}
function kgEntryWords(e, target){
  if(e.type === 'REVERSAL' && target) return 'Reversed: ' + kgEntryWords(target, null).toLowerCase();
  if(e.type === 'TRANSFER_OUT') return 'Handed to ' + (kgTransferPartner(e) || 'the next karigar');
  if(e.type === 'TRANSFER_IN') return 'Taken over from ' + (kgTransferPartner(e) || 'the previous karigar');
  if(e.type === 'SCRAP' && e.kind) return e.kind.charAt(0).toUpperCase() + e.kind.slice(1) + ' returned';
  if(e.type === 'OPENING' && e.dir) return e.dir === 'owe' ? 'Opening: you owe him' : 'Opening: he owes you';
  if(e.type === 'LOSS' && e.settle === 'cash') return 'Loss (cash bill)';
  return KG_WORDS[e.type] || e.type;
}
// '+9.200 g' / '-4.800 g' / '0.000 g' from a signed amount and a formatter that handles positive numbers.
function kgSigned(n, fmt){ return n > 0 ? '+' + fmt(n) : (n < 0 ? '-' + fmt(-n) : fmt(0)); }
function kg3Statement(kid){ _kg2.karigarId = kid; _kg2.view = 'statement'; renderKgV2(); }
function kg3StSet(field, el){ _kg2['st' + field] = String(el.value || '').trim(); renderKgV2(); }
function kgOpeningReversed(id){ return (S.kgLedger || []).concat(S.kgSalary || []).some(function(x){ return x.type === 'REVERSAL' && x.reversesId === id; }); }
function kg3StatementData(kid, metal, from, to){
  if(metal === 'rupees'){
    var r = kgRupeeStatementRange(kid, from, to);
    return {metal:'rupees', from:from, to:to, openingText:kgFmtRs(r.openingPaise), closingText:kgFmtRs(r.closingPaise),
      rows:r.rows.map(function(x){ return {id:x.entry.id, type:x.type, salary:true, date:x.date, label:kgEntryWords(x.entry, x.target), state:x.state, deltaText:kgSigned(x.deltaPaise, kgFmtRs), balText:kgFmtRs(x.balancePaise), note:(x.reason ? 'Reason: ' + x.reason : (x.entry.note || ''))}; })};
  }
  var s = kgStatementRange(kid, metal, from, to);
  return {metal:metal, from:from, to:to, openingText:kgFmtG(s.openingMg), closingText:kgFmtG(s.closingMg), issuedText:kgFmtG(s.issuedMg), returnedText:kgFmtG(s.returnedMg), otherText:(s.otherMg !== 0 ? kgSigned(s.otherMg, kgFmtG) : ''),
    rows:s.rows.map(function(x){ return {id:x.entry.id, type:x.type, date:x.date, label:kgEntryWords(x.entry, x.target) + (x.jobNo ? ' (' + x.jobNo + ')' : ''), state:x.state, deltaText:kgSigned(x.deltaMg, kgFmtG), balText:kgFmtG(x.balanceMg), note:(x.reason ? 'Reason: ' + x.reason : (x.entry.note || ''))}; })};
}
function kg3StatementHtml(kid){
  var k = findKarigar(kid); if(!k) return '<div class="kg2-empty">Karigar not found.</div>';
  var metal = _kg2.stMetal || 'gold', from = _kg2.stFrom || (kgToday().slice(0, 7) + '-01'), to = _kg2.stTo || kgToday();
  var html = '<div class="kg2-row">' + kg2Btn('\u2190 ' + k.name, 'kg3Open(' + kg2Q(kid) + ')') + '</div><div class="kg2-head"><div class="kg2-title">Statement &middot; ' + escHtml(k.name) + '</div></div>';
  html += '<div class="kg2-row"><select class="kg2-sel" aria-label="Metal" onchange="kg3StSet(\'Metal\', this)">' +
    [['gold', 'Gold (fine)'], ['silver', 'Silver (fine)'], ['rupees', 'Rupees']].map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === metal ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
    '<input type="text" class="kg2-sel" aria-label="From date" value="' + escHtml(from) + '" placeholder="From YYYY-MM-DD" onchange="kg3StSet(\'From\', this)">' +
    '<input type="text" class="kg2-sel" aria-label="To date" value="' + escHtml(to) + '" placeholder="To YYYY-MM-DD" onchange="kg3StSet(\'To\', this)"></div>';
  if(!kgValidDateKey(from) || !kgValidDateKey(to) || from > to) return html + '<div class="kg2-note warn">Dates must be real days (YYYY-MM-DD) and From must not be after To.</div>';
  var d = kg3StatementData(kid, metal, from, to);
  html += '<div id="kg3-print"><div class="kg3-printhead">' + escHtml(k.name) + ' &middot; ' + escHtml(metal) + ' statement &middot; ' + escHtml(from) + ' to ' + escHtml(to) + '</div><div class="kg2-kpis">' + kg3Tile('Opening', escHtml(d.openingText)) + (d.issuedText ? kg3Tile('Given', escHtml(d.issuedText)) + kg3Tile('Returned', escHtml(d.returnedText)) + (d.otherText ? kg3Tile('Other changes', escHtml(d.otherText), 'opening, reversals, hand-overs, carry, loss') : '') : '') + kg3Tile('Closing', escHtml(d.closingText)) + '</div>';
  if(!d.rows.length) html += '<div class="kg2-empty">Nothing in this period.</div>';
  d.rows.forEach(function(r){
    html += '<div class="kg2-line"><div><b>' + escHtml(r.label) + '</b><div class="kg2-sub">' + escHtml(r.date) + (r.state !== 'ok' && r.state !== 'reversal' ? ' &middot; ' + escHtml(r.state) : '') +
      (r.note ? ' &middot; ' + escHtml(r.note) : '') + '</div></div><div class="kg2-right" style="display:block;"><div class="kg2-num">' + escHtml(r.deltaText) + '</div><div class="kg2-sub">bal ' + escHtml(r.balText) + '</div>' +
      (r.type === 'OPENING' && r.state === 'ok' && !kgOpeningReversed(r.id) && kgUser().role === 'owner' ? kg2Btn('Reverse', r.salary ? 'kg2ReverseSalary(' + kg2Q(kid) + ', ' + kg2Q(r.id) + ')' : 'kg3Reverse(' + kg2Q(r.id) + ')') : '') + '</div></div>';
  });
  return html + '</div><div class="kg2-row">' + kg2Btn('Share on WhatsApp', 'kg3ShareStatement(' + kg2Q(kid) + ')') + kg2Btn('Print / PDF', 'kg3PrintStatement()') + '</div>';
}
// Print or save as PDF: the existing print rules hide the app; body.kg-printing lets only the statement through.
function kg3PrintStatement(){
  var b = document.body; b.className += ' kg-printing';
  function done(){ b.className = b.className.replace(/\s*kg-printing/g, ''); window.removeEventListener('afterprint', done); }
  window.addEventListener('afterprint', done);
  try{ window.print(); }catch(e){ done(); }
}
function kg3StatementText(kid, metal, from, to){
  var d = kg3StatementData(kid, metal, from, to), unit = metal === 'rupees' ? '' : ' fine';
  var lines = [(metal === 'rupees' ? 'Rupee' : metal.charAt(0).toUpperCase() + metal.slice(1)) + ' statement - ' + kg3Name(kid), from + ' to ' + to, 'Opening: ' + d.openingText + unit];
  d.rows.forEach(function(r){ lines.push(r.date + '  ' + r.label + (r.note ? ' - ' + r.note : '') + '  ' + r.deltaText + '  bal ' + r.balText); });
  lines.push('Closing: ' + d.closingText + unit);
  return lines.join('\n');
}
function kg3ShareStatement(kid){
  var metal = _kg2.stMetal || 'gold', from = _kg2.stFrom || (kgToday().slice(0, 7) + '-01'), to = _kg2.stTo || kgToday();
  window.open('https://wa.me/?text=' + encodeURIComponent(kg3StatementText(kid, metal, from, to)), '_blank');
}
// Issue slip: dated, weight, purity, fine. No photo is stored (decision 8).
function kg3SlipText(e){
  var job = e.jobId ? kgFindJob(e.jobId) : null;
  return ['Metal given to ' + kg3Name(e.karigarId), e.date + (job ? '  Job ' + job.jobNo : ''), kgFmtG(e.mg) + ' ' + kgMetalOf(e) + ' at ' + (e.pu / 100) + '%', 'Fine: ' + kgFmtG(e.fineMg)].join('\n');
}
function kg3ShareSlip(entryId){
  var e = null; (S.kgLedger || []).forEach(function(x){ if(x.id === entryId) e = x; });
  if(e) window.open('https://wa.me/?text=' + encodeURIComponent(kg3SlipText(e)), '_blank');
}

// \u2500\u2500 Job page for the points model \u2500\u2500
function kg3More(){ _kg2.more = (_kg2.more === _kg2.jobId) ? '' : _kg2.jobId; renderKgV2(); }
function kgOrderLabel(job){
  if(!job || !job.orderRef || !job.orderRef.orderId) return '';
  var o = null; (S.orders || []).forEach(function(x){ if(x.id === job.orderRef.orderId) o = x; });
  return o ? o.ordNo + (o.customer ? ' (' + o.customer + ')' : '') : 'an order that is no longer in the list';
}
function kg3JobHtml(job){
  var u = kgUser(), led = S.kgLedger || [], idx = kgIndex(led), open = job.status === 'open', metal = kgMetalOf(job);
  var html = '<div class="kg2-row">' + kg2Btn('\u2190 ' + kg3Name(job.karigarId), 'kg3Open(' + kg2Q(job.karigarId) + ')') + '</div><div class="kg2-head"><div class="kg2-title">' + escHtml(job.jobNo) + ' &middot; ' + escHtml(job.title) + '</div>' +
    '<div class="kg2-sub">' + escHtml(metal) + ' &middot; ' + escHtml(job.status) + (job.tag ? ' &middot; tag ' + escHtml(job.tag) : '') + (job.pieceCount ? ' &middot; ' + escHtml(String(job.pieceCount)) + ' pieces' : '') +
    (job.dueDate ? ' &middot; due ' + escHtml(job.dueDate) : '') + (job.orderRef ? ' &middot; order ' + escHtml(kgOrderLabel(job)) : '') + '</div></div>';
  var overlap = kgOrderOverlap(job);
  if(overlap.length) html += '<div class="kg2-note warn">He also has a stage on order ' + escHtml(overlap.join(', ')) + ' in the old order screen. That metal is shown on his profile under Order work and is not counted in this job.</div>';
  html += '<div class="kg2-sec">Who holds the metal</div>';
  var fines = kgJobKarigarFines(job);
  if(!fines.length) html += '<div class="kg2-empty">No metal issued yet.</div>';
  fines.forEach(function(f){
    html += '<div class="kg2-line"><div><b>' + escHtml(kg3Name(f.kid)) + '</b></div><div class="kg2-num ' + (f.fine < 0 ? 'warn' : '') + '">' + escHtml(kg3G(f.fine, metal)) + '</div></div>';
  });
  var jb = kgJobBalance(job, led);
  if(jb.concededFine > 0) html += '<div class="kg2-line"><div><b>Wastage allowed</b><div class="kg2-sub">credit given above the fine really in the pieces</div></div><div class="kg2-num">' + escHtml(kg3G(jb.concededFine, metal)) + '</div></div>';
  if(jb.mixed) html += '<div class="kg2-note warn">Not balanced: one karigar holds more and another less than was given to him.</div>';
  if(open){
    // five buttons up front; the rest sit under More. "Use carried balance" only when he really has something carried.
    html += '<div class="kg2-row" id="kg3-actions">' + kg2Btn('Give metal', 'kg3Issue(' + kg2Q(job.id) + ')', 'btn-gold') + kg2Btn('Receive piece', 'kg3Receive(' + kg2Q(job.id) + ')', 'btn-gold') +
      kg2Btn('Scrap / dust', 'kg3Scrap(' + kg2Q(job.id) + ')') + kg2Btn('Close job', 'kg3Close(' + kg2Q(job.id) + ')') + kg2Btn(_kg2.more === job.id ? 'Less' : 'More', 'kg3More()') + '</div>';
    if(_kg2.more === job.id){
      var carried = 0; kgCarryLots(job.karigarId, metal).forEach(function(l){ carried += l.remainingMg; });
      html += '<div class="kg2-row" id="kg3-more">' + kg2Btn('Hand over to another karigar', 'kg3Transfer(' + kg2Q(job.id) + ')') + kg2Btn('+ Stage', 'kg3AddStage(' + kg2Q(job.id) + ')') +
        (carried > 0 ? kg2Btn('Use carried balance', 'kg3UseCarry(' + kg2Q(job.id) + ')') : '') + '</div>';
    }
  } else if(job.status === 'closed' && u.role === 'owner'){
    html += '<div class="kg2-row">' + kg2Btn('Reopen job', 'kg2Reopen(' + kg2Q(job.id) + ')') + '</div>';
  }
  var stages = job.stages || [];
  if(stages.length){
    html += '<div class="kg2-sec">Stages</div>';
    stages.forEach(function(s){ html += '<div class="kg2-line"><div><b>' + escHtml(s.name) + '</b><div class="kg2-sub">' + escHtml(kg3Name(s.who || job.karigarId)) + ' &middot; ' + escHtml(s.status) + '</div></div></div>'; });
  }
  html += '<div class="kg2-sec">Entries</div>';
  var rows = led.filter(function(e){ return e.jobId === job.id; });
  if(!rows.length) html += '<div class="kg2-empty">Nothing recorded yet.</div>';
  rows.forEach(function(e){
    var rev = !!idx.reversed[e.id], can = open && !rev && e.type !== 'REVERSAL' && e.type !== 'TRANSFER_IN' && (u.role === 'owner' || ['LOSS', 'ADJUST', 'OPENING'].indexOf(e.type) === -1);   // a transfer pair is reversed from its first row only
    var tgt = e.type === 'REVERSAL' ? idx.byId[e.reversesId] : null;
    var sub = escHtml(e.date || '') + ' &middot; ' + escHtml(kg3Name(e.karigarId)) + (e.mg ? ' &middot; ' + escHtml(kgFmtG(e.mg)) + ' at ' + (e.pu ? e.pu / 100 + '%' : '') : '') +
      (e.pieceDesc ? ' &middot; ' + escHtml(e.pieceDesc) + (e.qty > 1 ? ' x' + e.qty : '') : '') + (e.reason ? ' &middot; reason: ' + escHtml(e.reason) : '') + (rev ? ' &middot; reversed' : '');
    var sgn = tgt ? -kgRawDelta(tgt, {}, function(){ return true; }) : (e.type === 'ISSUE' || e.type === 'CARRY_APPLY' || e.type === 'TRANSFER_IN' ? (e.fineMg || 0) : (['RECEIPT', 'SCRAP', 'LOSS', 'ADJUST', 'TRANSFER_OUT', 'CARRY_OUT'].indexOf(e.type) !== -1 ? -(e.fineMg || 0) : 0));
    html += '<div class="kg2-line' + (rev ? ' kg2-struck' : '') + '"><div><b>' + escHtml(kgEntryWords(e, tgt)) + '</b><div class="kg2-sub">' + sub + '</div></div><div class="kg2-right"><div class="kg2-num">' + escHtml(kgSigned(sgn, kgFmtG)) + '</div>' +
      (e.type === 'ISSUE' && !rev ? kg2Btn('Slip', 'kg3ShareSlip(' + kg2Q(e.id) + ')') : '') + (can ? kg2Btn('Reverse', 'kg3Reverse(' + kg2Q(e.id) + ')') : '') + '</div></div>';
  });
  return html;
}

// \u2500\u2500 Sheets \u2500\u2500
function kg3NeedsConfirm(v){
  if(v.chip) return false;
  var r = kgCheckPurity(v.purity, kgSavedPus());
  return !!(r && r.confirm);
}
function kg3PuV(v){ return {purity:v.purity, chip:(v.chip ? '999' : ''), confirmed:!!v.confirmed}; }
function kg3PurFields(label, metal){
  return [
    {id:'chip', label:'Pure ' + (metal === 'silver' ? 'silver' : 'gold') + ' 999 (counts as 100%)', type:'check'},
    {id:'purity', label:label || 'Purity %', mode:'decimal', hint:'Type 92 or 91.82. Allowed: 50 to 99.99.', show:function(v){ return !v.chip; }},
    {id:'confirmed', label:'I checked this purity is right', type:'check', show:function(v){ return kg3NeedsConfirm(v); }}];
}
function kg3FineLine(v, label){
  var mg = kgParseMg(v.wt), pu = KG_PU_PURE;
  if(!v.chip){
    if(String(v.purity || '').trim() === '') return '';
    var chk = kgCheckPurity(v.purity, kgSavedPus());
    if(chk.error) return '<span class="warn">' + escHtml(chk.error) + '</span>';   // the save would refuse this purity, so no fine is shown for it
    pu = chk.pu;
  }
  if(mg === null) return '';
  return escHtml(label) + ': <b>' + escHtml(kgFmtG(kgFineFromPu(mg, pu))) + '</b> fine (' + (pu / 100) + '%)';
}
function kg3StageOpts(job){
  var out = [['', kg3Name(job.karigarId) + ' (main)']];
  (job.stages || []).forEach(function(s){ out.push([s.id, s.name + ' \u2013 ' + kg3Name(s.who || job.karigarId)]); });
  return out;
}
function kg3KarigarOpts(blank){
  var out = blank ? [['', blank]] : [];
  (S.karigars || []).forEach(function(k){ out.push([k.id, k.name]); });
  return out;
}
function kg3Save(b, fin){
  if(b.error) return fin(new Error(b.error));
  if(b.confirm) return fin(new Error(b.confirm));
  kgAddEntries([b.entry], function(err){ fin(err); });
}
function kg3NewJob(kid){
  var k = findKarigar(kid); if(!k) return;
  var pts = kgAgreementFor(kid, kgToday()) ? kgAgreementFor(kid, kgToday()).wastagePoints : k.wastagePoints;
  kgForm({title:'New job for ' + k.name, submitLabel:'Create job', doneToast:'\u2713 Job created',
    fields:[
      {id:'title', label:'Job title (e.g. Necklace set)'},
      {id:'metal', label:'Metal', type:'select', options:[['gold', 'Gold'], ['silver', 'Silver']], value:'gold'},
      {id:'points', label:'Wastage points on his touch (e.g. 4)', mode:'decimal', value:(pts != null ? String(pts / 100) : ''), hint:'Measured touch + points = what he is credited. Leave empty for a salary karigar.'},
      {id:'tag', label:'Tag / design number (optional)'},
      {id:'pieces', label:'Pieces expected (optional)', mode:'numeric'},
      {id:'due', label:'Due date YYYY-MM-DD (optional)'},
      {id:'ord', label:'Link to customer order (optional)', type:'select', options:[['', 'None']].concat((S.orders || []).filter(function(o){ return o.status !== 'cancelled' && o.status !== 'delivered'; }).map(function(o){ return [o.id, o.ordNo + ' - ' + (o.customer || '')]; })), value:'',
        hint:'Only to find the order again. The order\'s own karigar stage stays separate and is never added to this account.'}],
    onSubmit:function(v, fin){
      kgCreateJob({karigarId:kid, title:v.title, model:'points', metal:v.metal, pointsText:v.points, tag:v.tag, pieceCount:v.pieces, dueDate:v.due, orderId:v.ord}, v.opId, function(err, job){
        if(!err && job) _kg2.jobId = job.id;
        fin(err);
      });
    }});
}
function kg3Issue(jobId){
  var job = kgFindJob(jobId); if(!job) return;
  kgForm({title:'Give ' + kgMetalOf(job) + ' to karigar', submitLabel:'Record', doneToast:'\u2713 Recorded',
    fields:[{id:'stage', label:'Stage / karigar', type:'select', options:kg3StageOpts(job), value:''},
      {id:'wt', label:'Weight (grams)', mode:'decimal'}].concat(kg3PurFields('Purity %', kgMetalOf(job))).concat([{id:'note', label:'Note (optional)'}]),
    preview:function(v){ return kg3FineLine(v, 'Fine given'); },
    onSubmit:function(v, fin){ var p = kg3PuV(v); p.wt = v.wt; p.opId = v.opId; p.note = v.note; kg3Save(kgBuildIssue(jobId, v.stage, p), fin); }});
}
function kg3RecV(v, confirmed){
  var ct = v.unit === 'ct';
  return {gross:v.gross, stoneG:(ct ? '' : v.stone), stoneCt:(ct ? v.stone : ''), stoneMode:v.stoneMode, purity:v.purity, chip:(v.chip ? '999' : ''), agreed:v.agreed,
    piece:v.piece, qty:v.qty, tag:v.tag, confirmed:(confirmed || !!v.confirmed), opId:v.opId, note:v.note};
}
function kg3ReceivePreview(jobId, v){
  var b = kgBuildReceipt(jobId, v.stage, kg3RecV(v, true));
  if(!b.entry) return (b.error && String(v.gross || '').trim() !== '') ? '<span class="warn">' + escHtml(b.error) + '</span>' : '';
  return 'Net <b>' + escHtml(kgFmtG(b.entry.mg)) + '</b> &middot; real fine <b>' + escHtml(kgFmtG(b.entry.actualFineMg)) + '</b> &middot; credited to him <b>' + escHtml(kgFmtG(b.entry.creditFineMg)) + '</b>' +
    (b.capped ? ' (capped at what he holds)' : '') +
    (b.entry.openingUseMg > 0 ? '<br>Drawn from his opening balance: ' + escHtml(kgFmtG(b.entry.openingUseMg)) : '');
}
// Pay a karigar for old-way order work: cash, gold or silver, never more than is owed. Owner only.
var KG_PAY_UNITS = {cash:'\u20b9', gold:'g gold', silver:'g silver'};
function kg3OrderOwedText(type, n){ return type === 'cash' ? '\u20b9' + (Math.round(n * 100) / 100) : (Math.round(n * 1000) / 1000) + ' g ' + type; }
function kg3PayOrderCheck(kid, type, text){
  if(!Object.prototype.hasOwnProperty.call(KG_PAY_UNITS, type)) return {error:'Choose cash, gold or silver'};
  var t = String(text == null ? '' : text).trim(), cash = type === 'cash';
  if(!(cash ? /^\d{1,9}(\.\d{1,2})?$/ : /^\d{1,6}(\.\d{1,3})?$/).test(t)) return {error:'Enter the amount as a plain number (' + (cash ? 'rupees, at most 2 decimals' : 'grams, at most 3 decimals') + ')'};
  if(!(parseFloat(t) > 0)) return {error:'Enter an amount above zero'};
  var unit = cash ? 100 : 1000;
  var amountU = Math.round(parseFloat(t) * unit), owedU = Math.round((kgOrderWork(kid).owed[type] || 0) * unit);   // whole paise / whole mg: no float dust
  if(!(owedU > 0)) return {error:'Nothing is owed to him in ' + (cash ? 'cash' : type)};
  if(amountU > owedU) return {error:'More than is owed: ' + kg3OrderOwedText(type, owedU / unit) + ' is owed to him'};
  return {amount:amountU / unit, owed:owedU / unit};
}
var KG_PAY_MODES = ['cash', 'UPI', 'Bank'];
// 'kp' + time + 3 digits as before, but never the id of a payment that already exists (a clash would let one reversal undo two payments).
function kgPayId(prefix){
  var id, used = {};
  (S.karigarPayments || []).forEach(function(x){ used[x.id] = true; });
  do { id = prefix + Date.now() + Math.floor(Math.random() * 1000); } while(used[id]);
  return id;
}
// The one hardened core for paying a karigar for old-way order work. opts: {legacy:true} = the old Record payment button (the record keeps
// its old fields, posts nothing to the Day Book); otherwise {mode:'cash'|'UPI'|'Bank', dbPost:true} = the new sheet (cash/UPI/Bank is kept and
// the payment posts a Karigar payment line to the Day Book, derived at read time in js/10-daybook.js).
function kg3PayOrderSave(kid, type, amount, note, opId, done, opts){
  opts = opts || {};
  var u = kgUser(), added = null, auditId = null;
  S.karigarPayments = S.karigarPayments || [];
  for(var i = 0; i < S.karigarPayments.length; i++) if(S.karigarPayments[i].opId === opId) return done(null);
  kgTxn('karigar:' + kid, function(){
    if(u.role !== 'owner') return 'Only the owner can record a payment';
    if(!findKarigar(kid)) return 'Karigar not found';
    var c = kg3PayOrderCheck(kid, type, String(amount)); if(c.error) return c.error;
    var mode = '';
    if(!opts.legacy && type === 'cash'){ mode = String(opts.mode || 'cash'); if(KG_PAY_MODES.indexOf(mode) === -1) return 'Choose cash, UPI or bank'; }
    added = {id:kgPayId('kp'), opId:opId, karigarId:kid, date:kgToday(), type:type, amount:c.amount, note:String(note || '').trim()};
    if(!opts.legacy){ if(mode) added.mode = mode; if(opts.dbPost === true && type === 'cash') added.dbPost = true; }
    S.karigarPayments.push(added);
    auditId = kgAudit('kg_order_payment', 'karigar', kid, type + ' ' + kg3OrderOwedText(type, c.amount));
    return '';
  }, function(){ S.karigarPayments = S.karigarPayments.filter(function(x){ return x !== added; }); kgUndoAudit(auditId); },
  function(err){ done(err); });
}
// Reverse an order payment (owner, with a reason). The payment stays in the list; a 'reversal' record points at it, owed comes back
// (karigarOwed skips reversed payments) and, if the payment posted to the Day Book, the same amount goes back IN on the reversal day.
function kg3PayOrderReverse(paymentId, reason, opId, done){
  var u = kgUser(), target = null, rec = null, auditId = null;
  S.karigarPayments = S.karigarPayments || [];
  for(var i = 0; i < S.karigarPayments.length; i++){
    if(S.karigarPayments[i].opId === opId) return done(null);
    if(S.karigarPayments[i].id === paymentId) target = S.karigarPayments[i];
  }
  kgTxn('karigar:' + (target ? target.karigarId : paymentId), function(){
    if(u.role !== 'owner') return 'Only the owner can reverse a payment';
    if(!target || ['cash', 'gold', 'silver'].indexOf(target.type) === -1) return 'Payment not found';
    if(S.karigarPayments.some(function(x){ return x.type === 'reversal' && x.reversesId === target.id; })) return 'Already reversed';
    if(String(reason || '').trim().length < 5) return 'A reason (at least 5 letters) is required';
    rec = {id:kgPayId('kr'), opId:opId, karigarId:target.karigarId, date:kgToday(), ts:new Date().toISOString(), type:'reversal', reversesId:target.id, reason:String(reason).trim(), by:u.name};
    S.karigarPayments.push(rec);
    auditId = kgAudit('kg_order_payment_reverse', 'karigar', target.karigarId, kg3OrderOwedText(target.type, target.amount) + ': ' + rec.reason);
    return '';
  }, function(){ S.karigarPayments = S.karigarPayments.filter(function(x){ return x !== rec; }); kgUndoAudit(auditId); },
  function(err){ done(err); });
}
function kg3PayOrderReverseSheet(paymentId){
  kgForm({title:'Reverse this payment', submitLabel:'Reverse', doneToast:'\u2713 Payment reversed',
    fields:[{id:'reason', label:'Reason (at least 5 letters)'}],
    onSubmit:function(v, fin){ kg3PayOrderReverse(paymentId, v.reason, v.opId, function(err){ fin(err); }); }});
}
// The last few order payments of one karigar that can still be reversed (owner only).
function kg3PayOrderRecentHtml(kid){
  if(kgUser().role !== 'owner') return '';
  var all = S.karigarPayments || [], undone = {};
  all.forEach(function(x){ if(x.type === 'reversal') undone[x.reversesId] = true; });
  var mine = all.filter(function(x){ return x.karigarId === kid && x.type !== 'reversal' && !undone[x.id]; }).slice(-5).reverse();
  if(!mine.length) return '';
  var html = '<div class="kg2-sec">Order work payments</div>';
  mine.forEach(function(x){
    html += '<div class="kg2-line"><div><b>' + escHtml(kg3OrderOwedText(x.type, parseFloat(x.amount) || 0)) + ' paid</b><div class="kg2-sub">' + escHtml(x.date || '') + (x.mode ? ' &middot; ' + escHtml(x.mode) : '') + (x.note ? ' &middot; ' + escHtml(x.note) : '') + '</div></div>' +
      '<div class="kg2-right">' + kg2Btn('Reverse', 'kg3PayOrderReverseSheet(' + kg2Q(x.id) + ')') + '</div></div>';
  });
  return html;
}
function kg3PayOrder(kid){
  var k = findKarigar(kid); if(!k) return;
  var ow = kgOrderWork(kid).owed;
  kgForm({title:'Pay ' + k.name + ' for order work', submitLabel:'Record payment', doneToast:'\u2713 Payment recorded',
    fields:[{id:'type', label:'Paid in', type:'select', options:[['cash', 'Cash (\u20b9)'], ['gold', 'Gold (g)'], ['silver', 'Silver (g)']], value:(ow.cash > 0 ? 'cash' : (ow.gold > 0 ? 'gold' : 'silver'))},
      {id:'mode', label:'Paid by', type:'select', options:[['cash', 'Cash'], ['UPI', 'UPI'], ['Bank', 'Bank transfer']], value:'cash', show:function(v){ return v.type === 'cash'; }},
      {id:'amount', label:'Amount (\u20b9 or grams)', mode:'decimal'}, {id:'note', label:'Note (optional)'}],
    preview:function(v){
      var c = String(v.amount || '').trim() === '' ? null : kg3PayOrderCheck(kid, v.type, v.amount);
      return 'Owed to him: <b>' + escHtml(kg3OrderOwedText(v.type, ow[v.type] || 0)) + '</b>' + (c && c.error ? '<br><span class="warn">' + escHtml(c.error) + '</span>' : (c ? '<br>Recording ' + escHtml(kg3OrderOwedText(v.type, c.amount)) + ' paid to ' + escHtml(k.name) : ''));
    },
    onSubmit:function(v, fin){
      var c = kg3PayOrderCheck(kid, v.type, v.amount); if(c.error) return kg2Err(c.error, fin);
      kg3PayOrderSave(kid, v.type, c.amount, v.note, v.opId, function(err){ fin(err); }, {mode:(v.type === 'cash' ? v.mode : ''), dbPost:true});
    }});
}
function kg3Receive(jobId){
  var job = kgFindJob(jobId); if(!job) return;
  kgForm({title:'Receive finished piece', submitLabel:'Record receipt', doneToast:'\u2713 Receipt recorded',
    fields:[{id:'stage', label:'Stage / karigar', type:'select', options:kg3StageOpts(job), value:''},
      {id:'piece', label:'Piece (e.g. necklace)'}, {id:'qty', label:'Quantity', value:'1', mode:'numeric'}, {id:'tag', label:'Tag (optional)'},
      {id:'gross', label:'Gross weight (grams)', mode:'decimal'},
      {id:'stone', label:'Stone weight (optional)', mode:'decimal'},
      {id:'unit', label:'Stone weight is in', type:'select', options:[['g', 'Grams'], ['ct', 'Carats']], value:'g', show:function(v){ return String(v.stone || '').trim() !== ''; }},
      {id:'stoneMode', label:'Stones weighed by', type:'select', options:[['A', 'The shop'], ['B', 'The karigar (slip)']], value:'A', show:function(v){ return String(v.stone || '').trim() !== ''; }}]
      .concat(kg3PurFields('Measured touch %', kgMetalOf(job))).concat([{id:'agreed', label:'Touch he was told (optional)', mode:'decimal'}]),
    preview:function(v){ return kg3ReceivePreview(jobId, v); },
    onSubmit:function(v, fin){ kg3Save(kgBuildReceipt(jobId, v.stage, kg3RecV(v, false)), fin); }});
}
function kg3Scrap(jobId){
  var job = kgFindJob(jobId); if(!job) return;
  kgForm({title:'Scrap / dust / filings returned', submitLabel:'Record', doneToast:'\u2713 Recorded as a refining lot',
    fields:[{id:'stage', label:'Stage / karigar', type:'select', options:kg3StageOpts(job), value:''},
      {id:'kind', label:'Kind', type:'select', options:KG_SCRAP_KINDS.map(function(x){ return [x, x]; }), value:'scrap'},
      {id:'wt', label:'Weight (grams)', mode:'decimal'}].concat(kg3PurFields('Estimated purity %', kgMetalOf(job))),
    preview:function(v){ return kg3FineLine(v, 'Estimated fine (belongs to the shop)'); },
    onSubmit:function(v, fin){ var p = kg3PuV(v); p.wt = v.wt; p.opId = v.opId; p.kind = v.kind; kg3Save(kgBuildScrap(jobId, v.stage, p), fin); }});
}
function kg3Transfer(jobId){
  var job = kgFindJob(jobId); if(!job) return;
  var stages = kg3StageOpts(job);
  if(stages.length < 2) return toast('Add a stage with the next karigar first');
  kgForm({title:'Hand over to another karigar', submitLabel:'Hand over', doneToast:'\u2713 Handed over',
    fields:[{id:'from', label:'From', type:'select', options:stages, value:''}, {id:'to', label:'To', type:'select', options:stages.slice(1), value:stages[1][0]},
      {id:'wt', label:'Weight (grams)', mode:'decimal'}].concat(kg3PurFields('Purity %', kgMetalOf(job))).concat([{id:'note', label:'Note (optional)'}]),
    preview:function(v){ return kg3FineLine(v, 'Fine handed over'); },
    onSubmit:function(v, fin){
      if(v.from === v.to) return kg2Err('Choose two different stages', fin);
      var p = kg3PuV(v); p.jobId = jobId; p.fromStageId = v.from; p.toStageId = v.to; p.wt = v.wt; p.opId = v.opId; p.note = v.note;
      kgTransfer(p, function(err){ fin(err); });
    }});
}
function kg3AddStage(jobId){
  kgForm({title:'Add a stage', submitLabel:'Add', doneToast:'\u2713 Stage added',
    fields:[{id:'name', label:'Stage (e.g. Setting)'}, {id:'who', label:'Karigar for this stage', type:'select', options:kg3KarigarOpts('Same as the job'), value:''}],
    onSubmit:function(v, fin){ kgAddStage(jobId, v.name, v.who, function(err){ fin(err); }); }});
}
function kg3UseCarry(jobId){
  var job = kgFindJob(jobId); if(!job) return;
  var lots = kgCarryLots(job.karigarId, kgMetalOf(job)), total = 0; lots.forEach(function(l){ total += l.remainingMg; });
  if(!(total > 0)) return toast('He has no carried balance to use');
  kgForm({title:'Use carried balance on ' + job.jobNo, submitLabel:'Apply', doneToast:'\u2713 Carried balance applied',
    fields:[{id:'fine', label:'Fine to apply (grams, up to ' + kgFmtG(total) + ')', mode:'decimal', value:String(total / 1000), hint:'His own balance, on the main karigar of the job. Then give him only the rest of the metal this job needs.'}],
    onSubmit:function(v, fin){
      var mg = kgParseMg(v.fine); if(mg === null) return kg2Err(kgWeightProblem(v.fine, 'fine weight'), fin);
      kgApplyCarry(jobId, '', mg, v.opId, function(err){ fin(err); });
    }});
}
function kg3Close(jobId){
  var job = kgFindJob(jobId); if(!job) return;
  var open = kgJobKarigarFines(job).filter(function(f){ return f.fine > 0; }), text = open.map(function(f){ return kg3Name(f.kid) + ' ' + kgFmtG(f.fine); }).join(', ');
  var fields = open.length ? [
    {id:'settle', label:'What happens to it?', type:'select', options:[['carry', 'Keep it with him (carry forward)']].concat(kgUser().role === 'owner' ? [['loss', 'Accept as loss'], ['loss-cash', 'Loss, bill him in rupees']] : []), value:'carry'},
    {id:'reason', label:'Reason for the loss (at least 5 letters)', show:function(v){ return v.settle !== 'carry'; }},
    {id:'bill', label:'Bill amount (\u20b9)', mode:'decimal', show:function(v){ return v.settle === 'loss-cash'; }},
    {id:'ack', label:'Go ahead even if he is over his carry limit', type:'check', show:function(v){ return v.settle === 'carry'; }}] : [];
  kgForm({title:'Close ' + job.jobNo, submitLabel:'Close job', doneToast:'\u2713 Job closed', fields:fields,
    preview:function(){ return open.length ? 'Still with karigars: ' + escHtml(text) : 'All metal is accounted for.'; },
    onSubmit:function(v, fin){
      var opts = open.length ? {settle:v.settle, reason:v.reason, billText:v.bill, ackCeiling:!!v.ack, opId:v.opId} : undefined;
      kgCloseJob(jobId, function(err){ fin(err); }, opts);
    }});
}
function kg3Reverse(entryId){
  var e = null; (S.kgLedger || []).forEach(function(x){ if(x.id === entryId) e = x; });
  if(!e) return;
  kgForm({title:'Reverse this entry', submitLabel:'Reverse', doneToast:'\u2713 Reversed',
    fields:[{id:'reason', label:'Reason (at least 5 letters)'}],
    onSubmit:function(v, fin){
      var d = function(err){ fin(err); };
      if(e.voucherId) kgReverseTransfer(e.voucherId, v.reason, v.opId, d);
      else if(e.carryId) kgReverseCarry(e.carryId, v.reason, v.opId, d);
      else kgReverse(entryId, v.reason, v.opId, d);
    }});
}
function kg3Opening(kid){
  var k = findKarigar(kid); if(!k) return;
  kgForm({title:'Opening balance for ' + k.name, submitLabel:'Save', doneToast:'\u2713 Opening balance saved',
    fields:[{id:'metal', label:'Metal', type:'select', options:[['gold', 'Gold'], ['silver', 'Silver']], value:'gold'},
      {id:'wt', label:'Weight he holds (grams)', mode:'decimal'}].concat(kg3PurFields('Purity %')).concat([{id:'note', label:'Note (e.g. from his khata)'}]),
    preview:function(v){ return kg3FineLine(v, 'Fine with him'); },
    onSubmit:function(v, fin){ var p = kg3PuV(v); p.karigarId = kid; p.metal = v.metal; p.wt = v.wt; p.opId = v.opId; p.note = v.note; kgAddOpening(p, function(err){ fin(err); }); }});
}
function kg3RupeeOpening(kid){
  var k = findKarigar(kid); if(!k) return;
  kgForm({title:'Rupee opening for ' + k.name, submitLabel:'Save', doneToast:'\u2713 Saved',
    fields:[{id:'dir', label:'Who owes whom', type:'select', options:[['owe', 'You owe him'], ['advance', 'He owes you (advance)']], value:'owe'},
      {id:'amt', label:'Amount (\u20b9)', mode:'decimal'}, {id:'note', label:'Note (required, e.g. from his khata)'}],
    onSubmit:function(v, fin){ kgAddRupeeOpening({karigarId:kid, dir:v.dir, amountText:v.amt, note:v.note, opId:v.opId}, function(err){ fin(err); }); }});
}
function kg3Carry(kid){
  var k = findKarigar(kid); if(!k) return;
  var c = k.carryCeilingMg || {};
  kgForm({title:'Carry-forward for ' + k.name, submitLabel:'Save', doneToast:'\u2713 Saved',
    fields:[{id:'trusted', label:'He may keep a leftover balance when a job closes', type:'check', value:k.carryTrusted === true},
      {id:'g', label:'Gold limit, grams of fine (empty = no limit)', mode:'decimal', value:(c.gold ? String(c.gold / 1000) : '')},
      {id:'s', label:'Silver limit, grams of fine (empty = no limit)', mode:'decimal', value:(c.silver ? String(c.silver / 1000) : '')}],
    onSubmit:function(v, fin){ kgSetCarry(kid, {trusted:!!v.trusted, ceilingGold:v.g, ceilingSilver:v.s}, function(err){ fin(err); }); }});
}
function kg3Count(kid){
  kgForm({title:'Record a physical count', submitLabel:'Counted', doneToast:'\u2713 Count recorded',
    fields:[{id:'note', label:'Note (what you counted, optional)'}],
    onSubmit:function(v, fin){ kgMarkCounted(kid, v.note, function(err){ fin(err); }); }});
}
function kg3EditDetails(kid){
  var k = findKarigar(kid); if(!k) return;
  kgForm({title:'Details of ' + k.name, submitLabel:'Save', doneToast:'\u2713 Details saved',
    fields:[{id:'name', label:'Name', value:k.name || ''}, {id:'phone', label:'Phone (10-digit mobile)', value:k.phone || '', mode:'numeric'},
      {id:'skills', label:'Skills (e.g. Kundan setting)', value:k.skills || ''}, {id:'note', label:'Notes', value:k.note || ''}],
    onSubmit:function(v, fin){
      var err = updateKarigarProfile(kid, {name:v.name, phone:v.phone, skills:v.skills, note:v.note});
      fin(err ? new Error(err) : null);
    }});
}
function kg3Refine(scrapId){
  kgForm({title:'Assay result', submitLabel:'Save', doneToast:'\u2713 Assay saved',
    fields:[{id:'fine', label:'Real fine from the refiner (grams)', mode:'decimal'}, {id:'note', label:'Note (optional)'}],
    onSubmit:function(v, fin){ kgRefineCredit({scrapId:scrapId, fineText:v.fine, opId:v.opId, note:v.note}, function(err){ fin(err); }); }});
}
