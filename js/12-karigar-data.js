// ═══════════════════════════════════════════════════════════════════
// KARIGAR 2.0 — ledger client (phase 5a). Talks to the immutable journal in Postgres through
// store-proxy (supabase/migrations/010_karigar_ledger.sql). NOT yet used by any screen: the
// live V2 screens still read and write the shop blob. Screens switch over (phase 5b) only after
// the migration has been applied to a test project and you approve.
//
// Units: fine gold in integer MILLIGRAMS, labour in integer PAISE. A journal is a set of signed
// lines that must sum to zero, so metal can never be created or destroyed by one posting.
//   issue            VAULT -x          KCUST[k] +x
//   return           KCUST[k] -x       VAULT +x
//   receive piece    KCUST[k] -y       FG[job] +y
//   scrap            KCUST[k] -s       SCRAP[k] +s
//   approved loss    KCUST[k] -l       LOSS[k] +l
//   transfer         KCUST[a] -t  TRANSIT[v] +t   then   TRANSIT[v] -t  KCUST[b] +t
//   entitlement      accrue  ENT[k] +e  EARNED[k] -e
//                    settle  KCUST[k] -e  PAYOUT[k] +e  ENT[k] -e  EARNED[k] +e
//   opening / adjust VAULT +x OPENING -x   /   KCUST[k] +-a  ADJ[k] -+a
// Every journal carries a client-made op_id: re-sending it can never post twice.
// ═══════════════════════════════════════════════════════════════════

// APP_BUILD (js/00-config-state.js) is bumped on every deploy; the server can refuse older builds (MIN_CLIENT_BUILD).
var KG_J_TYPES = ['ISSUE', 'RETURN', 'RECEIPT', 'SCRAP', 'LOSS', 'TRANSFER_OUT', 'TRANSFER_IN',
  'ENTITLEMENT_ACCRUE', 'ENTITLEMENT_SETTLE', 'LABOUR_ACCRUE', 'LABOUR_PAY', 'ADJUST', 'OPENING', 'REVERSAL'];
var KG_J_OWNER_ONLY = ['ADJUST', 'OPENING', 'ENTITLEMENT_ACCRUE'];
var KG_J_ACCOUNTS = ['VAULT', 'KCUST', 'WIP', 'FG', 'SCRAP', 'LOSS', 'TRANSIT', 'ENT', 'EARNED', 'PAYOUT', 'OPENING', 'ADJ'];

function kgJLine(account, ownerRef, fineMg, grossMg, permille){
  var l = {account:account, owner_ref:ownerRef || '', fine_mg:fineMg};
  if(grossMg != null) l.gross_mg = grossMg;
  if(permille != null) l.permille = permille;
  return l;
}
function kgJournalSum(lines){
  var t = 0; (lines || []).forEach(function(l){ t += l.fine_mg; }); return t;
}

// Shape + balance check, same limits as the server. Returns '' when fine.
function kgValidateJournal(j, role){
  if(!j || typeof j !== 'object') return 'No journal';
  if(typeof j.op_id !== 'string' || !/^[A-Za-z0-9:_.-]{8,64}$/.test(j.op_id)) return 'Operation id is not valid';
  if(KG_J_TYPES.indexOf(j.type) === -1) return 'Unknown journal type';
  if(role && KG_J_OWNER_ONLY.indexOf(j.type) !== -1 && role !== 'owner') return 'Only the owner can post this';
  if(j.op_id.indexOf('migr:') === 0 && (j.type !== 'OPENING' || (role && role !== 'owner'))) return 'This operation id is reserved for opening balances posted by the owner';
  if(!kgValidDateKey(j.business_date)) return 'Date is not valid';
  if(j.type === 'REVERSAL' && !(Math.floor(j.reverses_id) === j.reverses_id)) return 'A reversal must name the journal it reverses';
  if(j.type !== 'REVERSAL' && j.reverses_id != null) return 'Only a reversal may name a journal';
  if(j.type === 'RECEIPT' && !(typeof j.job_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(j.job_id))) return 'A receipt must name its job';
  var lines = j.lines || [], labour = j.labour || [];
  if(lines.length > 20 || labour.length > 20) return 'Too many lines';
  if(!lines.length && !labour.length) return 'A journal needs at least one line';
  for(var i = 0; i < lines.length; i++){
    var l = lines[i];
    if(KG_J_ACCOUNTS.indexOf(l.account) === -1) return 'Unknown account ' + l.account;
    if(!(Math.floor(l.fine_mg) === l.fine_mg) || l.fine_mg === 0 || Math.abs(l.fine_mg) > 1e12) return 'Every line needs a non-zero whole-milligram weight';
    if(l.permille != null && !(Math.floor(l.permille) === l.permille && l.permille >= 1 && l.permille <= 1000)) return 'Fineness is not valid';
  }
  if(kgJournalSum(lines) !== 0) return 'Journal does not balance (' + kgFmtG(kgJournalSum(lines)) + ' fine out of balance)';
  for(var k = 0; k < labour.length; k++){
    var b = labour[k];
    if(!b.karigar_id || !(Math.floor(b.amount_paise) === b.amount_paise) || b.amount_paise === 0) return 'Every labour line needs a karigar and a non-zero amount in paise';
  }
  return '';
}

// ── builders: one per event in the table above ──────────────────────
// o: {opId, date?, jobId?, voucherId?, note?, karigarId, mg?, fineMg?, permille?, ...}
function kgJHead(type, o){
  return {op_id:o.opId, type:type, job_id:o.jobId || null, voucher_id:o.voucherId || null, reverses_id:null,
          business_date:o.date || kgToday(), note:o.note || '', lines:[], labour:[]};
}
function kgFineOf(o){
  if(o.mg != null && o.permille != null){
    var f = kgFineMg(o.mg, o.permille);
    if(o.fineMg != null && o.fineMg !== f) return -1;
    return f;
  }
  return o.fineMg;
}
// Returns {journal} or {error}.
function kgBuildJournal(type, o){
  var j = kgJHead(type, o), f = kgFineOf(o), k = o.karigarId || '';
  if(f === -1) return {error:'Fine weight does not match weight and purity'};
  var need = {ISSUE:1, RETURN:1, RECEIPT:1, SCRAP:1, LOSS:1, TRANSFER_OUT:1, TRANSFER_IN:1, ENTITLEMENT_ACCRUE:1, ENTITLEMENT_SETTLE:1, ADJUST:1, OPENING:1};
  if(need[type] && !(Math.floor(f) === f) ) return {error:'Weight is required'};
  if((type !== 'ADJUST') && need[type] && !(f > 0)) return {error:'Weight must be more than zero'};
  var gm = o.mg != null ? o.mg : null, pm = o.permille != null ? o.permille : null;
  if(type === 'ISSUE')        j.lines = [kgJLine('VAULT', '', -f), kgJLine('KCUST', k, f, gm, pm)];
  else if(type === 'RETURN')  j.lines = [kgJLine('KCUST', k, -f, gm, pm), kgJLine('VAULT', '', f)];
  else if(type === 'RECEIPT') j.lines = [kgJLine('KCUST', k, -f), kgJLine('FG', o.jobId || '', f, gm, pm)];
  else if(type === 'SCRAP')   j.lines = [kgJLine('KCUST', k, -f), kgJLine('SCRAP', k, f, gm, pm)];
  else if(type === 'LOSS')    j.lines = [kgJLine('KCUST', k, -f), kgJLine('LOSS', k, f)];
  else if(type === 'TRANSFER_OUT'){ if(!o.voucherId) return {error:'A transfer needs a voucher'}; j.lines = [kgJLine('KCUST', o.fromKarigarId || k, -f), kgJLine('TRANSIT', o.voucherId, f)]; }
  else if(type === 'TRANSFER_IN'){  if(!o.voucherId) return {error:'A transfer needs a voucher'}; j.lines = [kgJLine('TRANSIT', o.voucherId, -f), kgJLine('KCUST', o.toKarigarId || k, f)]; }
  else if(type === 'ENTITLEMENT_ACCRUE') j.lines = [kgJLine('ENT', k, f), kgJLine('EARNED', k, -f)];
  else if(type === 'ENTITLEMENT_SETTLE'){
    var src = o.from === 'vault' ? kgJLine('VAULT', '', -f) : kgJLine('KCUST', k, -f);
    j.lines = [src, kgJLine('PAYOUT', k, f), kgJLine('ENT', k, -f), kgJLine('EARNED', k, f)];
  }
  else if(type === 'OPENING') j.lines = o.into === 'karigar' ? [kgJLine('KCUST', k, f, gm, pm), kgJLine('OPENING', '', -f)] : [kgJLine('VAULT', '', f), kgJLine('OPENING', '', -f)];
  else if(type === 'ADJUST'){
    if(!(f && Math.floor(f) === f)) return {error:'Adjustment weight is not valid'};
    if(String(o.note || '').trim().length < 5) return {error:'A reason (at least 5 letters) is required'};
    j.lines = [kgJLine('KCUST', k, f), kgJLine('ADJ', k, -f)];
  }
  else if(type === 'LABOUR_ACCRUE' || type === 'LABOUR_PAY'){
    if(!(Math.floor(o.amountPaise) === o.amountPaise) || !(o.amountPaise > 0)) return {error:'Amount is not valid'};
    j.labour = [{karigar_id:k, amount_paise:(type === 'LABOUR_PAY' ? -o.amountPaise : o.amountPaise), mode:o.mode || null}];
  }
  else return {error:'Cannot build a ' + type + ' journal here'};
  if(o.approve) j.approve = true;
  return {journal:j};
}
// Exact mirror of a journal as the server returned it (lines negated). The database refuses anything else.
function kgBuildReversal(original, opId, reason, date){
  if(!original || original.type === 'REVERSAL') return {error:'This journal cannot be reversed'};
  if(String(reason || '').trim().length < 5) return {error:'A reason (at least 5 letters) is required'};
  var j = {op_id:opId, type:'REVERSAL', job_id:original.job_id || null, voucher_id:original.voucher_id || null, reverses_id:original.id,
           business_date:date || kgToday(), note:String(reason).trim(), lines:[], labour:[]};
  (original.lines || []).forEach(function(l){ j.lines.push(kgJLine(l.account, l.owner_ref, -Number(l.fine_mg), l.gross_mg != null ? -Number(l.gross_mg) : null, l.permille)); });
  (original.labour || []).forEach(function(b){ j.labour.push({karigar_id:b.karigar_id, amount_paise:-Number(b.amount_paise), mode:b.mode || null}); });
  return {journal:j};
}

// ── server calls ─────────────────────────────────────────────────────
// cb(err, body, status). err is a network failure (retryable); a server answer, even a refusal,
// arrives as body/status with err null.
function kgRemote(body, cb){
  var timer = null, done = false;
  function finish(a, b, c){ if(done) return; done = true; clearTimeout(timer); cb(a, b, c); }
  timer = setTimeout(function(){ finish(new Error('timeout')); }, 20000);
  var payload = {}; Object.keys(body).forEach(function(x){ payload[x] = body[x]; });
  payload._build = APP_BUILD;
  fetch(SB_FUNCTIONS + '/store-proxy', {
    method:'POST',
    headers:Object.assign({}, SB_HEADERS, {'x-session-token':(typeof SAAS !== 'undefined' && SAAS.sessionToken) || ''}),
    body:JSON.stringify(payload)
  }).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(b){ finish(null, b, r.status); });
  }).catch(function(e){ finish(e || new Error('network')); });
}

// ── offline outbox: a journal is stored here BEFORE it is sent ──────────
// Replays are safe: the server ignores an op_id it has already posted.
function kgOutboxKey(){ return shopScopedKey('kg_outbox'); }
function kgRejectedKey(){ return shopScopedKey('kg_outbox_rejected'); }
function kgLsGet(key){ try{ var v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }catch(e){ return []; } }
function kgLsSet(key, list){ try{ localStorage.setItem(key, JSON.stringify(list)); return true; }catch(e){ return false; } }
function kgOutboxList(){ return kgLsGet(kgOutboxKey()); }
// Every shop's queued gold entries on this device, for the note shown when a sign-out or an expiry deletes them.
function kgLostNote(){
  var n = 0;
  try{ for(var q = localStorage.length - 1; q >= 0; q--){ var k = localStorage.key(q); if(k && /^kg_outbox::/.test(k)) n += kgLsGet(k).length; } }catch(e){}
  if(!n) return '';
  return ' ' + n + ' gold entr' + (n === 1 ? 'y' : 'ies') + ' had not reached the ledger. Check the karigar ledger before entering ' + (n === 1 ? 'it' : 'them') + ' again.';
}
// Who is signed in on this device. A queued journal is tagged with its maker (locally only, never sent) so a
// shared shop computer cannot send one person's entry under the next person's login: the server stamps the
// sender as the author, and as the approver of a loss when the sender is the owner.
function kgWho(){ return kgUser().who; }
function kgOutboxAdd(j){
  var list = kgOutboxList();
  for(var i = 0; i < list.length; i++) if(list[i].op_id === j.op_id) return true;
  var mine = {}; Object.keys(j).forEach(function(x){ mine[x] = j[x]; });
  mine._by = kgWho();
  list.push(mine);
  return kgLsSet(kgOutboxKey(), list);
}
// Entries this user may send. An entry with no maker recorded is treated as someone else's.
function kgOutboxMine(){
  var who = kgWho();
  return kgOutboxList().filter(function(x){ return who && x._by === who; });
}
// How many of this user's gold entries for one job are saved on the phone but not yet confirmed by the ledger.
function kgQueuedForJob(jobId){ return kgOutboxMine().filter(function(x){ return x.job_id === jobId; }).length; }
function kgOutboxRemove(opId){
  kgLsSet(kgOutboxKey(), kgOutboxList().filter(function(x){ return x.op_id !== opId; }));
}
// Remembers the day each accepted journal was dated, after its outbox row is gone, so a Save-again on a later day sends the same
// date (the server fingerprints business_date; a new day would look like different content).
function kgPostedKey(){ return shopScopedKey('kg_outbox_posted'); }
function kgPostedAdd(opId, date){ var l = kgLsGet(kgPostedKey()).filter(function(x){ return x.op !== opId; }); l.push({op:opId, d:date}); kgLsSet(kgPostedKey(), l.slice(-100)); }
function kgPostedDate(opId){ var d = null; kgLsGet(kgPostedKey()).forEach(function(x){ if(x.op === opId && kgValidDateKey(x.d)) d = x.d; }); return d; }
function kgRejectedList(){ return kgLsGet(kgRejectedKey()); }
function kgRejectedAdd(j, why){
  var list = kgRejectedList(); list.push({journal:j, why:why, at:new Date().toISOString()});
  kgLsSet(kgRejectedKey(), list.slice(-50));
}

// Sends one journal. cb(err, result):
//   err null, result {ok, duplicate, journal_id}   posted (or already posted)
//   err.code 'rejected'  the ledger refused it (message says why); removed from the outbox, kept in the rejected list
//   err.code 'invalid'   caught before sending
//   err.code 'offline'   saved in the outbox and will be retried
//   err.code 'outdated'  this app build is too old: reload
//   err.code 'forbidden' your role cannot post
function kgSendJournal(j, cb){
  var wire = {}; Object.keys(j).forEach(function(x){ if(x.charAt(0) !== '_') wire[x] = j[x]; }); // _by and _entry stay on this device
  kgRemote(Object.assign({action:'kg_post'}, wire), function(err, body, status){
    if(err) return cb(Object.assign(new Error('Not sent yet - it is saved and will be retried'), {code:'offline'}));
    if(status === 200 && body && body.ok){ kgPostedAdd(j.op_id, j.business_date); kgOutboxRemove(j.op_id); return cb(null, body); }
    if(status === 409 && body && body.error === 'client_outdated') return cb(Object.assign(new Error('Please reload the app to update'), {code:'outdated'}));
    if(status === 401){
      // the entry is safe in the outbox; ask for sign-in and send the queue once it is back
      if(typeof saasRequireReauth === 'function') saasRequireReauth(function(){ kgOutboxFlush(); }, (body && body.reason) || 'expired'); // no reason given: never guess 'revoked', that wipes the device
      return cb(Object.assign(new Error('Please sign in again. Your entry is saved and will be sent after you sign in.'), {code:'offline', reauth:true}));
    }
    if(status === 403) { kgOutboxRemove(j.op_id); kgRejectedAdd(wire, 'Your account cannot post to the ledger'); return cb(Object.assign(new Error('Your account cannot post to the ledger'), {code:'forbidden'})); }
    if(status === 422 || status === 400){
      kgOutboxRemove(j.op_id);
      var why = (body && (body.message || body.error)) || 'refused';
      kgRejectedAdd(wire, why);
      return cb(Object.assign(new Error(why), {code:'rejected'}));
    }
    cb(Object.assign(new Error('Server problem - saved and will be retried'), {code:'offline'}));
  });
}
function kgPostJournal(j, cb){
  var u = kgUser(), bad = kgValidateJournal(j, u.role);
  if(bad) return cb(Object.assign(new Error(bad), {code:'invalid'}));
  if(!kgOutboxAdd(j)) return cb(Object.assign(new Error('This device has no room to keep the entry safely - free some storage'), {code:'invalid'}));
  kgSendJournal(j, cb);
}
// The ledger took a queued journal; save its shop-data entry too (the form that made it may be long closed).
// If the shop data now refuses it (the job changed on another device), keep it out of the blob and leave a note on the
// S.kgParked (saved with the shop data, shown on Reports); the owner decides; kgReverseParked undoes it on the ledger.
function kgFinishQueued(item, done){
  var en = item._entry; S.kgLedger = S.kgLedger || [];
  if(!en) return done();
  for(var i = 0; i < S.kgLedger.length; i++) if(S.kgLedger[i].opId === en.opId) return done();
  // a network failure or a busy lock is not a refusal: put it back and stop, the next flush tries again (the server
  // answers duplicate, so nothing is posted twice)
  function requeue(err){ kgOutboxAdd(item); done(err); }
  kgCommitEntry(en, kgFindJob(en.jobId), kgUser(), function(err){
    if(!err) return done();
    if(err.transient) return requeue(err);
    var p = {id:kgNewId(), opId:en.opId, at:new Date().toISOString(), why:err.message, entry:en};
    kgTxn('park:' + en.opId, function(){ S.kgParked = S.kgParked || []; S.kgParked.push(p); return ''; },
      function(){ S.kgParked = (S.kgParked || []).filter(function(x){ return x.id !== p.id; }); }, function(e2){ if(e2) return requeue(e2); done(); });
  });
}
// Safe to call from anywhere, any time: does nothing unless this user has a queued entry, the phone is online and no
// sign-in prompt is already open. Called at app start, on every auto-refresh tick and when the phone comes back online.
function kgTryFlush(){
  try{
    if(typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if(typeof saasReauthPending === 'function' && saasReauthPending()) return;
    if(!kgOutboxMine().length) return;
    kgOutboxFlush();
  }catch(e){}
}
function kgOnlineHook(){ kgTryFlush(); }
try{ if(typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', kgOnlineHook); }catch(e){}
// Replays everything waiting, oldest first, one at a time. A network failure stops the run.
var _kgFlushing = false;
function kgOutboxFlush(cb){
  if(_kgFlushing){ if(cb) cb(null, {sent:0, left:kgOutboxList().length, busy:true}); return; }
  _kgFlushing = true;
  var sent = 0;
  (function next(){
    var list = kgOutboxMine();
    if(!list.length){ _kgFlushing = false; if(cb) cb(null, {sent:sent, left:kgOutboxList().length}); return; }
    var item = list[0];
    kgSendJournal(item, function(err){
      if(err && (err.code === 'offline' || err.code === 'outdated')){ _kgFlushing = false; if(cb) cb(err, {sent:sent, left:kgOutboxList().length}); return; }
      if(err) { sent++; return next(); }
      kgFinishQueued(item, function(e2){
        if(e2){ _kgFlushing = false; if(cb) cb(e2, {sent:sent, left:kgOutboxList().length}); return; }
        sent++; next();
      });
    });
  })();
}

// ── blob to ledger: open each karigar's blob balance once (owner only, two steps) ─────────
// Step 1, opts.dryRun: send nothing, list what would be opened (rep.would) for the owner to check.
// Step 2, opts.confirmed: that exact list. Only a karigar whose balance still equals the confirmed figure is posted;
// a changed or new balance goes to needsReview (a manager can edit the blob between the two steps). No list, no run.
// op_id is 'migr:' + karigar id (the ledger already keeps op_ids per shop), so a rerun re-sends the same id and the
// server reports a duplicate. Zero posts nothing; a negative balance is listed for the owner to resolve by hand.
// shortcut: gold held per karigar only, no per-job WIP seed (it would double count custody), revisit with Task 11;
// shortcut: compares against the blob in memory, a screen should reload the latest blob before step 2.
// cb(err, {posted:[{karigarId,fineMg}], would:[{karigarId,name,fineMg}], duplicates, skippedZero,
//          needsReview:[{karigarId,name,fineMg,was?}], failed:[{karigarId,why}]})
function kgMigrateBlobToLedger(cb, opts){
  if(kgUser().role !== 'owner') return cb(new Error('Only the owner can open the ledger balances'));
  var dry = !!(opts && opts.dryRun), conf = Object.create(null); // no prototype: an id like 'constructor' must not match
  if(!dry){
    if(!opts || !Array.isArray(opts.confirmed)) return cb(new Error('Preview the balances and confirm them first'));
    opts.confirmed.forEach(function(c){ conf[c.karigarId] = c.fineMg; });
  }
  var rep = {posted:[], would:[], duplicates:0, skippedZero:0, needsReview:[], failed:[]}, list = (S.karigars || []).slice();
  (function next(){
    var k = list.shift();
    if(!k) return cb(null, rep);
    var f = kgKhata(k.id).openFine;
    if(f === 0){ rep.skippedZero++; return next(); }
    if(f < 0){ rep.needsReview.push({karigarId:k.id, name:k.name, fineMg:f}); return next(); }
    if(dry){ rep.would.push({karigarId:k.id, name:k.name, fineMg:f}); return next(); }
    if(conf[k.id] !== f){ rep.needsReview.push({karigarId:k.id, name:k.name, fineMg:f, was:conf[k.id] === undefined ? null : conf[k.id]}); return next(); }
    var built = kgBuildJournal('OPENING', {into:'karigar', karigarId:k.id, fineMg:f, opId:'migr:' + k.id});
    if(built.error){ rep.failed.push({karigarId:k.id, why:built.error}); return next(); }
    kgPostJournal(built.journal, function(err, r){
      // the date is part of what the server compares, so a rerun on a later day comes back as "different content"
      if(err) rep.failed.push({karigarId:k.id, why:/different content/.test(err.message) ? 'Already opened on an earlier day. Nothing was posted. Check the ledger balance on Reports.' : err.message});
      else if(r && r.duplicate) rep.duplicates++;
      else rep.posted.push({karigarId:k.id, fineMg:f});
      next();
    });
  })();
}

// ── reverse a parked entry: the ledger has it, the shop data refused it ──────────────────────────
// cb(err, journal|null). Reads the ledger a page at a time until it finds the journal with this op_id.
// shortcut: reads from the start of the ledger each time; add a "find by op_id" call when a shop's ledger is large.
function kgFindServerJournal(opId, cb){
  (function page(after){
    kgRemote({action:'kg_journal_list', after:after, limit:1000}, function(err, body, status){
      if(err) return cb(new Error('Could not reach the ledger. Check the internet and try again.'));
      if(!(status === 200 && body && body.ok && Array.isArray(body.journals))) return cb(new Error(status === 403 ? 'Only the owner or a manager can read the ledger' : 'The ledger could not be read. Try again.'));
      for(var i = 0; i < body.journals.length; i++) if(body.journals[i].op_id === opId) return cb(null, body.journals[i]);
      if(body.journals.length < 1000) return cb(null, null);
      page(body.journals[body.journals.length - 1].id);
    });
  })(0);
}
// Owner only. Posts the exact mirror of the ledger journal, then drops the parked row. The reversal's op_id comes from the
// parked entry, so a retry after a lost answer is a duplicate on the server and never reverses twice.
function kgReverseParked(parkedId, reason, done){
  var u = kgUser(), p = null;
  (S.kgParked || []).forEach(function(x){ if(x.id === parkedId) p = x; });
  if(!p) return done(new Error('That entry is no longer parked'));
  if(u.role !== 'owner') return done(new Error('Only the owner can reverse a parked entry'));
  var opId = ('rv-' + p.opId).slice(0, 64);
  kgFindServerJournal(p.opId, function(err, orig){
    if(err) return done(err);
    if(!orig) return done(new Error('The ledger has no entry with this id. Check the karigar ledger before doing anything.'));
    var en = p.entry || {}, pos = 0;
    (orig.lines || []).forEach(function(l){ if(Number(l.fine_mg) > 0) pos += Number(l.fine_mg); });
    if(orig.type !== en.type || (orig.job_id || null) !== (en.jobId || null) || pos !== Math.abs(en.fineMg || 0))
      return done(new Error('The ledger entry does not match this parked entry. Check the karigar ledger before doing anything.'));
    // Dated on the original journal's own day: the same on every retry (the server fingerprints business_date, so a new
    // day would make a retry look like different content), and the mirror cancels the original on its own day.
    var date = kgValidDateKey(orig.business_date) ? orig.business_date : null;
    var rv = kgBuildReversal(orig, opId, reason, date);
    if(rv.error) return done(new Error(rv.error));
    kgPostJournal(rv.journal, function(e2){
      if(e2 && (e2.code === 'offline' || e2.code === 'outdated')) return done(new Error(e2.reauth || e2.code === 'outdated' ? e2.message : 'Not confirmed. The reversal may already be recorded. Tap Reverse again to confirm.'));
      if(e2) return done(e2);
      var removed = null, auditId = null;
      kgTxn('park-rm:' + p.id, function(){
        S.kgParked = S.kgParked || [];
        S.kgParked = S.kgParked.filter(function(x){ if(x.id === p.id){ removed = x; return false; } return true; });
        if(removed) auditId = kgAudit('kg_parked_reverse', 'kgParked', p.id, 'Reversed on ledger: ' + String(reason).trim());
        return '';
      }, function(){ if(removed) S.kgParked.push(removed); kgUndoAudit(auditId); },
      function(e3){ done(e3 ? new Error('Reversed on the ledger but not saved to the shop yet. Tap Reverse again to finish.') : null); });
    });
  });
}

// ── blob vs ledger report: do the shop data and the ledger agree on who holds how much gold? ─────────
// cb(err, rows) with rows = [{account, owner_ref, fine_mg}] for the whole shop (owner or manager).
function kgFetchBalances(cb){
  kgRemote({action:'kg_balances'}, function(err, body, status){
    if(err) return cb(new Error('Could not reach the ledger. Check the internet and try again.'));
    if(status === 200 && body && body.ok) return cb(null, body.balances || []);
    cb(new Error(status === 403 ? 'Only the owner or a manager can read the ledger' : 'The ledger could not be read. Try again.'));
  });
}
// Pure. Compares each karigar's ledger custody (KCUST) with the blob's gold-with-karigar figure; diff = ledger minus blob.
// unknown = ledger balances whose owner reference matches no karigar in the shop data (D11).
// shortcut: custody only; a wastage karigar's earned share is not accrued on the ledger yet, so with the ledger flag on
// it shows as a diff until ENTITLEMENT_ACCRUE is wired to job close (Task 4 follow-up).
function kgReconcile(rows){
  var led = Object.create(null), known = Object.create(null), unknown = [], byKarigar = ['KCUST', 'ENT', 'EARNED', 'PAYOUT', 'SCRAP', 'LOSS'];
  (S.karigars || []).forEach(function(k){ known[k.id] = true; });
  (rows || []).forEach(function(r){
    var mg = Number(r.fine_mg);
    if(r.account === 'KCUST') led[r.owner_ref] = mg;
    if(byKarigar.indexOf(r.account) !== -1 && !known[r.owner_ref]) unknown.push({account:r.account, ownerRef:r.owner_ref, fineMg:mg});
  });
  var out = [], bad = [];
  (S.karigars || []).forEach(function(k){
    var blob = kgKhata(k.id).openFine, ledger = led[k.id] || 0;
    if(blob === 0 && ledger === 0) return;
    var row = {karigarId:k.id, name:k.name, blob:blob, ledger:ledger, diff:ledger - blob};
    out.push(row); if(row.diff !== 0) bad.push(row);
  });
  return {rows:out, mismatches:bad, unknown:unknown};
}
