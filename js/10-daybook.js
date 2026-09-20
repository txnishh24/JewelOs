// ══════════════════════════════════════════════════════════════════════
// DAY BOOK (ROJMEL) MODULE
// The daily cash book. Auto lines are derived at read time from existing
// sales/purchase/girvi/order records (no separate storage for those);
// this file only stores manual entries (expenses, drawings, capital,
// bank transfer) and Close Day records. See docs/DAYBOOK-SPEC.md for
// the full design and HANDOFF.md for the posting-rule field sources.
//
// Locked-day rule (spec §6): a closed day's stored closing figure never
// changes. A later correction to a record dated inside a closed day is
// swept into a visible adjustment entry on the current open day instead
// of rewriting the past. See dbSweepRestatements().
// ══════════════════════════════════════════════════════════════════════

var DB_CATS = {
  rent:          {dir:'out', label:'Rent',              group:'expense'},
  salary:        {dir:'out', label:'Salary',            group:'expense'},
  electricity:   {dir:'out', label:'Electricity',       group:'expense'},
  tea:           {dir:'out', label:'Tea / Refreshment', group:'expense'},
  transport:     {dir:'out', label:'Transport',         group:'expense'},
  repair:        {dir:'out', label:'Repair',            group:'expense'},
  misc:          {dir:'out', label:'Miscellaneous',     group:'expense'},
  drawings:      {dir:'out', label:'Owner Drawings',    group:'owner'},
  capital:       {dir:'in',  label:'Owner Capital',     group:'owner'},
  bankDeposit:   {dir:'out', label:'Bank Deposit',      group:'transfer'},
  bankWithdrawal:{dir:'in',  label:'Bank Withdrawal',   group:'transfer'},
  cashShort:     {dir:'out', label:'Cash Short',        group:'reconcile'},
  cashExcess:    {dir:'in',  label:'Cash Excess',       group:'reconcile'},
  adjust:        {dir:null,  label:'Adjustment',        group:'system'}
};

// Canonical LOCAL calendar-day key ('YYYY-MM-DD') from an ISO string, a
// Date, or an already-keyed string. Never use toISOString().slice(0,10)
// for this — IST is UTC+5:30, so anything after 18:30 local lands on
// the wrong (previous) day.
function dbDayKey(v){
  if(!v) return '';
  if(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  var d = (v instanceof Date) ? v : new Date(v);
  if(isNaN(d.getTime())) return '';
  var y = d.getFullYear();
  var m = String(d.getMonth()+1);
  if(m.length<2) m='0'+m;
  var day = String(d.getDate());
  if(day.length<2) day='0'+day;
  return y+'-'+m+'-'+day;
}

function dbToday(){
  return dbDayKey(new Date());
}

// Cash test used for every posting rule. Anything other than an exact
// (trimmed, case-insensitive) 'cash' — including 'Manual', 'Waiver',
// 'Credit', 'Other' — is NOT cash.
function dbIsCash(mode){
  return String(mode||'').trim().toLowerCase() === 'cash';
}

function dbRound(n){
  return Math.round((parseFloat(n)||0) * 100) / 100;
}

// Ensures S.dayBook exists with the correct shape. Called from
// normaliseData() on every load, so it's always safe to read S.dayBook.*
// without a null check elsewhere in this file.
function dbInit(){
  if(typeof S === 'undefined' || !S) return;
  if(!S.dayBook || typeof S.dayBook !== 'object'){
    S.dayBook = {opening:null, entries:[], closes:[]};
    return;
  }
  if(!Array.isArray(S.dayBook.entries)) S.dayBook.entries = [];
  if(!Array.isArray(S.dayBook.closes))  S.dayBook.closes  = [];
  if(S.dayBook.opening !== null && typeof S.dayBook.opening !== 'object') S.dayBook.opening = null;
}

// ── AUTO-LINE DERIVATION ─────────────────────────────────────────────
// Pure. No writes, no saves. Every posting rule below is sourced from
// the HANDOFF verify-first entries (20 Sep 2026) — see docs/DAYBOOK-SPEC.md
// §5/§10 for the table this implements and why each excluded field is
// excluded. Never add a field to these functions without checking that
// entry against a real payment path first; several plausible-looking
// fields here (sale.prevAdvance, sale.paymentHistory) are deliberate
// exclusions because posting them double-counts a line posted elsewhere.
//
// A line with dir:null and unknown:true represents cash whose payment
// mode could not be determined (e.g. a "settle full" sale.extraPayments
// entry with mode:'Manual', or a girvi loan disbursed before the
// disburseMode field existed). It is never summed into in/out — the
// day book cannot invent a mode — but it is returned so a renderer can
// show "amount not counted, mode unknown" instead of silently omitting it.

function dbAutoLines(dateKey){
  var lines = [];

  // ── A. Sales ──────────────────────────────────────────────────────
  (S.sales||[]).forEach(function(sale){
    // A1: creation-time payment, same three-tier precedence the edit-bill
    // modal uses (js/01-sync-core.js) — never sum tiers, only the first
    // that applies.
    if(dbDayKey(sale.date) === dateKey){
      var creationPays;
      if(sale.splitPayments && sale.splitPayments.length){
        creationPays = sale.splitPayments;
      } else if(sale.nowPaying && sale.nowPaying.amount > 0){
        creationPays = [{amount:sale.nowPaying.amount, mode:sale.nowPaying.mode}];
      } else {
        creationPays = [{amount:sale.advance||0, mode:sale.payment}];
      }
      creationPays.forEach(function(p){
        if(p.amount > 0 && dbIsCash(p.mode)){
          lines.push({dir:'in', amount:dbRound(p.amount), cat:'sale', label:'Sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:sale.invNo||''});
        }
      });
      // A2 sale.prevAdvance and A3 sale.oldGold: never a line — see header note.
    }

    // A4: cash collected later against an already-made sale. Own date,
    // never the sale date.
    (sale.extraPayments||[]).forEach(function(p){
      if(dbDayKey(p.date) !== dateKey) return;
      if(!p.amount || p.amount <= 0) return;
      if(p.mode === 'Manual'){
        lines.push({dir:null, unknown:true, amount:dbRound(p.amount), cat:'sale-manual-settle', label:'Sale '+(sale.invNo||'')+' settled, mode not recorded', src:'sale', srcId:sale.id, ref:p.id});
        return;
      }
      if(!dbIsCash(p.mode)) return;
      var dir = (p.type === 'reversal') ? 'out' : 'in';
      lines.push({dir:dir, amount:dbRound(p.amount), cat: dir==='out' ? 'sale-payment-reversal' : 'sale-extra-payment', label:'Sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:p.id});
    });
    // A6 sale.paymentHistory: never a line — it mirrors A1/A4, see header note.

    // A5: refunds paid in cash, out, on the refund's own date.
    (sale.refunds||[]).forEach(function(r){
      if(dbDayKey(r.date) !== dateKey) return;
      if(!r.amount || r.amount <= 0) return;
      if(!dbIsCash(r.mode)) return;
      lines.push({dir:'out', amount:dbRound(r.amount), cat:'sale-refund', label:'Refund, sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:r.id});
    });
  });

  // ── B. Purchases ──────────────────────────────────────────────────
  (S.purchases||[]).forEach(function(bill){
    // B1: whole-bill payment method. 'Credit' means zero cash moved.
    if(dbDayKey(bill.date) === dateKey && bill.amountPaid > 0 && dbIsCash(bill.paymentMethod)){
      lines.push({dir:'out', amount:dbRound(bill.amountPaid), cat:'purchase', label:'Purchase '+(bill.billNo||''), src:'purchase', srcId:bill.id, ref:bill.billNo||''});
    }
    // B2: payments made to the supplier after the bill was entered.
    (bill.supplierPayments||[]).forEach(function(p){
      if(dbDayKey(p.date) !== dateKey) return;
      if(!p.amount || p.amount <= 0) return;
      if(!dbIsCash(p.mode)) return;
      var dir = (p.type === 'reversal') ? 'in' : 'out';
      lines.push({dir:dir, amount:dbRound(p.amount), cat: dir==='in' ? 'supplier-payment-reversal' : 'supplier-payment', label:'Purchase '+(bill.billNo||''), src:'purchase', srcId:bill.id, ref:p.id});
    });
    // B3 bill.pendingAmount / totalPaid / overpaidAmount: derived, never a line.
  });

  // ── C. Girvi (read-only; girviLedgerState is never touched here) ───
  (S.girvi||[]).forEach(function(g){
    // C1: loan disbursement. Only posted when disburseMode is present —
    // never defaulted to Cash, that would retro-post historical loans.
    if(dbDayKey(g.startDate) === dateKey && g.principal > 0){
      if(g.disburseMode == null){
        lines.push({dir:null, unknown:true, amount:dbRound(g.principal), cat:'girvi-disbursement-unknown', label:'Loan '+(g.grvNo||'')+' disbursed, mode not recorded', src:'girvi', srcId:g.id, ref:g.grvNo||''});
      } else if(dbIsCash(g.disburseMode)){
        lines.push({dir:'out', amount:dbRound(g.principal), cat:'girvi-disbursement', label:'Loan '+(g.grvNo||'')+' disbursed', src:'girvi', srcId:g.id, ref:g.grvNo||''});
      }
    }
    // C2: repayments, interest, refunds — dispatch on type. penalty and
    // waiver are excluded by type (a penalty is a charge, not cash in;
    // a waiver's mode is hard-coded 'Waiver' anyway).
    (g.payments||[]).forEach(function(p){
      var day = dbDayKey(p.date || p.ts);
      if(day !== dateKey) return;
      if(!p.amount || p.amount <= 0) return;
      if(!dbIsCash(p.mode)) return;
      var type = p.type || 'payment'; // legacy entries predate the type field
      if(type === 'payment' || type === 'interest'){
        lines.push({dir:'in', amount:dbRound(p.amount), cat:'girvi-repayment', label:'Loan '+(g.grvNo||''), src:'girvi', srcId:g.id, ref:p.id});
      } else if(type === 'refund'){
        lines.push({dir:'out', amount:dbRound(p.amount), cat:'girvi-refund', label:'Loan '+(g.grvNo||'')+' refund', src:'girvi', srcId:g.id, ref:p.id});
      }
      // penalty, waiver: not cash movements — excluded by type, deliberately.
    });
    // C3 g.ledger: an event log, never a line — its money entries duplicate g.payments.
  });

  // ── D. Orders ───────────────────────────────────────────────────────
  (S.orders||[]).forEach(function(o){
    if(o.ledger && o.ledger.length){
      // D1: the real payment ledger.
      o.ledger.forEach(function(txn){
        if(dbDayKey(txn.date) !== dateKey) return;
        if(!txn.amount || txn.amount <= 0) return;
        if(!dbIsCash(txn.mode)) return;
        var dir = (txn.type === 'reversal') ? 'out' : 'in';
        lines.push({dir:dir, amount:dbRound(txn.amount), cat: dir==='out' ? 'order-advance-reversal' : 'order-advance', label:'Order '+(o.ordNo||''), src:'order', srcId:o.id, ref:txn.txnId||''});
      });
    } else if(o.advance > 0){
      // D2: legacy fallback for an order created before o.ledger existed.
      if(dbDayKey(o.createdAt) === dateKey && dbIsCash(o.payment || 'Cash')){
        lines.push({dir:'in', amount:dbRound(o.advance), cat:'order-advance-legacy', label:'Order '+(o.ordNo||''), src:'order', srcId:o.id, ref:''});
      }
    }
    // D3 o.advance (scalar) is a derived cache when o.ledger exists — never posted directly.
  });

  return lines;
}

function dbAutoTotals(dateKey){
  var lines = dbAutoLines(dateKey);
  var totals = {in:0, out:0, unknownCount:0};
  lines.forEach(function(l){
    if(l.unknown){ totals.unknownCount++; return; }
    if(l.dir === 'in')  totals.in  = dbRound(totals.in  + l.amount);
    if(l.dir === 'out') totals.out = dbRound(totals.out + l.amount);
  });
  return totals;
}

// ── MANUAL LINES ──────────────────────────────────────────────────────
function dbManualLines(dateKey){
  return (S.dayBook.entries||[]).filter(function(e){ return !e.voided && e.date === dateKey; });
}

function dbManualTotals(dateKey){
  var totals = {in:0, out:0};
  dbManualLines(dateKey).forEach(function(e){
    if(e.dir === 'in')  totals.in  = dbRound(totals.in  + e.amount);
    if(e.dir === 'out') totals.out = dbRound(totals.out + e.amount);
  });
  return totals;
}

function dbNetMovement(dateKey){
  var a = dbAutoTotals(dateKey), m = dbManualTotals(dateKey);
  return dbRound((a.in + m.in) - (a.out + m.out));
}

// ── BALANCES ───────────────────────────────────────────────────────────
function dbCloseFor(dateKey){
  var closes = S.dayBook.closes || [];
  for(var i=0; i<closes.length; i++){ if(closes[i].date === dateKey) return closes[i]; }
  return null;
}

// Greatest close strictly before dateKey, or null. 'YYYY-MM-DD' strings
// compare correctly with plain < / > — no date arithmetic needed.
function dbLastCloseBefore(dateKey){
  var best = null;
  (S.dayBook.closes||[]).forEach(function(c){
    if(c.date < dateKey && (!best || c.date > best.date)) best = c;
  });
  return best;
}

// Every date with any auto or manual movement, loKey <= d < hiKeyExclusive
// (or loKey < d < hiKeyExclusive when loInclusive is false). Walking only
// the dates that actually moved money — not every calendar day — is what
// keeps a multi-month gap between closes cheap.
function dbMovementDatesInRange(loKey, hiKeyExclusive, loInclusive){
  var set = {};
  function consider(k){
    if(!k) return;
    var passesLo = loInclusive ? (k >= loKey) : (k > loKey);
    if(passesLo && k < hiKeyExclusive) set[k] = true;
  }
  (S.sales||[]).forEach(function(s){
    consider(dbDayKey(s.date));
    (s.extraPayments||[]).forEach(function(p){ consider(dbDayKey(p.date)); });
    (s.refunds||[]).forEach(function(r){ consider(dbDayKey(r.date)); });
  });
  (S.purchases||[]).forEach(function(b){
    consider(dbDayKey(b.date));
    (b.supplierPayments||[]).forEach(function(p){ consider(dbDayKey(p.date)); });
  });
  (S.girvi||[]).forEach(function(g){
    consider(dbDayKey(g.startDate));
    (g.payments||[]).forEach(function(p){ consider(dbDayKey(p.date || p.ts)); });
  });
  (S.orders||[]).forEach(function(o){
    if(o.ledger && o.ledger.length){
      o.ledger.forEach(function(t){ consider(dbDayKey(t.date)); });
    } else if(o.advance > 0){
      consider(dbDayKey(o.createdAt));
    }
  });
  (S.dayBook.entries||[]).forEach(function(e){ if(!e.voided) consider(e.date); });
  return Object.keys(set).sort();
}

// dbOpening — see docs/DAYBOOK-SPEC.md §6 / the 20 Sep Opus HANDOFF entry
// for the full reasoning. Three cases, in order:
//   1. dateKey is itself a closed day -> its own stored opening (never
//      recomputed — a closed day's figures are frozen).
//   2. There's a close before dateKey -> that close's `closing` (already
//      includes its own day's movement) plus every day strictly after it
//      and before dateKey.
//   3. No close yet, but an owner-entered opening exists at or before
//      dateKey -> that amount plus every day from opening.date (inclusive
//      — the opening amount is a pre-day balance) up to dateKey.
//   Otherwise -> 0 (the UI should prompt "Set opening balance").
function dbOpening(dateKey){
  var exact = dbCloseFor(dateKey);
  if(exact) return exact.opening;

  var last = dbLastCloseBefore(dateKey);
  if(last){
    var total = last.closing;
    dbMovementDatesInRange(last.date, dateKey, false).forEach(function(d){
      total = dbRound(total + dbNetMovement(d));
    });
    return total;
  }

  if(S.dayBook.opening && S.dayBook.opening.date && S.dayBook.opening.date <= dateKey){
    var total2 = S.dayBook.opening.amount;
    dbMovementDatesInRange(S.dayBook.opening.date, dateKey, true).forEach(function(d){
      total2 = dbRound(total2 + dbNetMovement(d));
    });
    return total2;
  }

  return 0;
}

// The single object the renderer, print and WhatsApp builders all read —
// so they cannot disagree. For a closed day the four totals come from the
// stored close record (R1: never recomputed); `lines` is always the live
// item-level detail so the owner can see what makes up the day either way.
function dbDayView(dateKey){
  var closed = dbCloseFor(dateKey);
  var opening = dbOpening(dateKey);
  var autoLines = dbAutoLines(dateKey);
  var autoT = dbAutoTotals(dateKey);
  var manualLines = dbManualLines(dateKey);
  var manualT = dbManualTotals(dateKey);

  var totalIn, totalOut, closing;
  if(closed){
    totalIn  = dbRound(closed.autoIn  + closed.manualIn);
    totalOut = dbRound(closed.autoOut + closed.manualOut);
    closing  = closed.closing;
  } else {
    totalIn  = dbRound(autoT.in  + manualT.in);
    totalOut = dbRound(autoT.out + manualT.out);
    closing  = dbRound(opening + totalIn - totalOut);
  }

  return {
    date: dateKey,
    closed: !!closed,
    close: closed,
    opening: opening,
    lines: autoLines.concat(manualLines),
    totalIn: totalIn,
    totalOut: totalOut,
    closing: closing,
    counted: closed ? closed.counted : null,
    diff: closed ? closed.diff : null,
    unknownCount: autoT.unknownCount
  };
}

// 'YYYY-MM-DD' + 1 calendar day, built from local parts (never through
// UTC midnight parsing — same reasoning as subPaidUntil in 04-orders-detail.js).
function _dbNextDay(dateKey){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if(!m) return dateKey;
  var d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  d.setDate(d.getDate()+1);
  return dbDayKey(d);
}

function _dbUserName(){
  return (typeof SAAS !== 'undefined' && SAAS.user) ? (SAAS.user.name || SAAS.user.email || 'staff') : 'staff';
}

function _dbMoney(n){
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// ── WRITES ─────────────────────────────────────────────────────────────
// Same snapshot/commit/rollback shape as _purchaseCommit/_orderCommit:
// deep-clone S.dayBook before mutating, restore the WHOLE thing on any
// save failure (including a version conflict from another device saving
// first) so a rejected write can never leave the book half-changed. Like
// the rest of the app, activityLog/auditLog entries are not included in
// the snapshot — a rolled-back write can still leave a log line behind,
// same accepted tradeoff as girvi/order/purchase commits already make.
function _dbSnapshot(){
  return JSON.parse(JSON.stringify(S.dayBook));
}
function _dbRestore(snap){
  S.dayBook = snap;
}
function _dbCommit(snapshot, cb){
  saveToCloud(function(err){
    if(err){
      _dbRestore(snapshot);
      saveCache();
      if(err.message !== 'version-conflict'){
        toast('⚠ Could not save — change rolled back. Check your connection and try again.');
      }
    }
    if(cb) cb(err);
  });
}

// Refuses once any close exists — the opening anchor is meant to be set
// once, before the book has any history. A later correction is a manual
// entry or, if wrong at the root, a job for whoever administers the shop.
function dbSetOpening(dateKey, amount, cb){
  if(S.dayBook.closes && S.dayBook.closes.length){ if(cb) cb(new Error('opening-locked')); return; }
  if(!(amount >= 0)){ if(cb) cb(new Error('invalid-amount')); return; }
  var snap = _dbSnapshot();
  S.dayBook.opening = { date:dateKey, amount:dbRound(amount), ts:new Date().toISOString() };
  saasActivityLog('daybook', 'Opening balance set: '+_dbMoney(amount)+' on '+dateKey);
  auditLog('opening', 'daybook', dateKey, 'Opening balance '+dbRound(amount));
  _dbCommit(snap, cb);
}

function dbAddEntry(dateKey, dir, amount, cat, note, cb){
  if(dir !== 'in' && dir !== 'out'){ if(cb) cb(new Error('invalid-dir')); return; }
  if(!(amount > 0)){ if(cb) cb(new Error('invalid-amount')); return; }
  if(!DB_CATS[cat] || cat === 'adjust'){ if(cb) cb(new Error('invalid-cat')); return; } // adjust is system-only
  if(dateKey > dbToday()){ if(cb) cb(new Error('future-date')); return; }
  if(dbCloseFor(dateKey)){ if(cb) cb(new Error('day-closed')); return; }

  var snap = _dbSnapshot();
  var entry = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'DB-'+Date.now(),
    date: dateKey, dir: dir, amount: dbRound(amount), cat: cat, note: note || '',
    kind: 'manual', ts: new Date().toISOString(), by: _dbUserName(),
    voided: false, voidReason: ''
  };
  S.dayBook.entries.push(entry);
  saasActivityLog('daybook', (dir==='in'?'Cash in ':'Expense ')+_dbMoney(entry.amount)+' '+DB_CATS[cat].label+' on '+dateKey);
  auditLog('create', 'daybook', entry.id, DB_CATS[cat].label+' '+entry.amount+' on '+dateKey);
  _dbCommit(snap, function(err){ if(cb) cb(err, err ? null : entry); });
}

function dbVoidEntry(entryId, reason, cb){
  var entry = null;
  (S.dayBook.entries||[]).forEach(function(e){ if(e.id === entryId) entry = e; });
  if(!entry){ if(cb) cb(new Error('not-found')); return; }
  if(entry.voided){ if(cb) cb(new Error('already-voided')); return; }
  if(entry.kind === 'adjust'){ if(cb) cb(new Error('cannot-void-adjustment')); return; } // would desync the close it re-anchored
  if(dbCloseFor(entry.date)){ if(cb) cb(new Error('day-closed')); return; }
  if(!reason || !reason.trim()){ if(cb) cb(new Error('reason-required')); return; }

  var snap = _dbSnapshot();
  entry.voided = true;
  entry.voidReason = reason.trim();
  entry.voidTs = new Date().toISOString();
  entry.voidBy = _dbUserName();
  saasActivityLog('daybook', 'Voided '+_dbMoney(entry.amount)+' '+(DB_CATS[entry.cat]?DB_CATS[entry.cat].label:entry.cat)+' on '+entry.date+': '+entry.voidReason);
  auditLog('void', 'daybook', entry.id, 'Voided: '+entry.voidReason);
  _dbCommit(snap, cb);
}

// Today, unless today is already closed, in which case tomorrow — always
// open because a close can never be made for a future date (R5 below).
function dbFirstOpenDay(){
  var today = dbToday();
  return dbCloseFor(today) ? _dbNextDay(today) : today;
}

// R5: closes move forward only. Refuses a future date, a date already
// closed, or a date earlier than the latest existing close — days
// skipped in between stay live and their movement rolls into the next
// close's opening via dbOpening's walk.
function dbCloseDay(dateKey, counted, cb){
  if(dateKey > dbToday()){ if(cb) cb(new Error('future-date')); return; }
  if(dbCloseFor(dateKey)){ if(cb) cb(new Error('already-closed')); return; }
  var latest = null;
  (S.dayBook.closes||[]).forEach(function(c){ if(!latest || c.date > latest.date) latest = c; });
  if(latest && dateKey < latest.date){ if(cb) cb(new Error('before-latest-close')); return; }
  if(!(counted >= 0)){ if(cb) cb(new Error('invalid-counted')); return; }

  var view = dbDayView(dateKey); // still live at this point — not yet closed
  var autoT = dbAutoTotals(dateKey);
  var manualT = dbManualTotals(dateKey);
  var diff = dbRound(counted - view.closing);

  var snap = _dbSnapshot();
  var close = {
    date: dateKey, opening: view.opening,
    autoIn: autoT.in, autoOut: autoT.out,
    manualIn: manualT.in, manualOut: manualT.out,
    closing: view.closing, counted: dbRound(counted), diff: diff,
    ts: new Date().toISOString(), by: _dbUserName(),
    restatements: [], countCorrections: []
  };
  S.dayBook.closes.push(close);
  S.dayBook.closes.sort(function(a,b){ return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

  var diffNote = diff === 0 ? '' : (diff < 0 ? ', short '+_dbMoney(-diff) : ', excess '+_dbMoney(diff));
  saasActivityLog('daybook', 'Day closed '+dateKey+': book '+_dbMoney(view.closing)+', counted '+_dbMoney(counted)+diffNote);
  auditLog('close', 'daybook', dateKey, 'Closed: book '+view.closing+' counted '+close.counted+' diff '+diff);
  _dbCommit(snap, function(err){ if(cb) cb(err, err ? null : {closing:view.closing, counted:close.counted, diff:diff}); });
}

// The one narrow un-close exception (spec §6 edge case (d)): correcting
// a fat-fingered physical count, ONLY on the latest close, ONLY within
// the same local calendar day it was made, and ONLY if no later day has
// been closed since. `closing` (the book figure) is never touched — an
// observation may be corrected within the moment it was made; the book
// itself is derived from records and is never rewritten this way.
function dbCorrectCount(dateKey, newCounted, reason, cb){
  var latest = null;
  (S.dayBook.closes||[]).forEach(function(c){ if(!latest || c.date > latest.date) latest = c; });
  if(!latest || latest.date !== dateKey){ if(cb) cb(new Error('not-latest-close')); return; }
  if(dbDayKey(latest.ts) !== dbToday()){ if(cb) cb(new Error('correction-window-passed')); return; }
  if(!(newCounted >= 0)){ if(cb) cb(new Error('invalid-counted')); return; }
  if(!reason || !reason.trim()){ if(cb) cb(new Error('reason-required')); return; }

  var snap = _dbSnapshot();
  var prev = latest.counted;
  latest.counted = dbRound(newCounted);
  latest.diff = dbRound(latest.counted - latest.closing);
  if(!latest.countCorrections) latest.countCorrections = [];
  latest.countCorrections.push({ts:new Date().toISOString(), by:_dbUserName(), prev:prev, next:latest.counted, reason:reason.trim()});
  saasActivityLog('daybook', 'Count corrected for '+dateKey+': '+_dbMoney(prev)+' → '+_dbMoney(latest.counted));
  auditLog('correct', 'daybook', dateKey, 'Count corrected '+prev+' -> '+latest.counted+': '+reason.trim());
  _dbCommit(snap, cb);
}

// ── LOCKED-DAY RESTATEMENT SWEEP (spec §6) ────────────────────────────
// A closed day's opening/autoIn/autoOut/manualIn/manualOut/closing are
// frozen at close time and NEVER recomputed from live records — that is
// the whole point of closing a day. But records can still change after
// close (a backdated edit, a new record landing on an old date). This
// sweep is how that correction surfaces: as a visible adjustment entry
// on today (or tomorrow, if today is itself closed) instead of quietly
// rewriting the past.
var DB_RESTATE_THRESHOLD = 0.5; // rupees; below this is float noise, not a real correction

// Internal: builds the kind:'adjust' entry and the close's restatements[]
// record IN MEMORY ONLY. No save — dbSweepRestatements does exactly one
// saveToCloud for every adjustment a sweep produces, never one per close.
function dbPostAdjustment(close, newIn, newOut){
  var netDelta = dbRound((newIn - close.autoIn) - (newOut - close.autoOut));
  var entry = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'ADJ-'+Date.now()+'-'+Math.random().toString(36).slice(2),
    date: dbFirstOpenDay(), dir: netDelta >= 0 ? 'in' : 'out', amount: dbRound(Math.abs(netDelta)),
    cat: 'adjust', note: 'Correction to '+close.date, kind: 'adjust', srcDate: close.date,
    ts: new Date().toISOString(), by: _dbUserName(), voided: false, voidReason: ''
  };
  S.dayBook.entries.push(entry);
  if(!close.restatements) close.restatements = [];
  close.restatements.push({ts:entry.ts, by:entry.by, prevIn:close.autoIn, prevOut:close.autoOut, newIn:newIn, newOut:newOut, entryId:entry.id});
  close.autoIn = newIn;
  close.autoOut = newOut;
  return entry.id;
}

// Called ONLY when the Day Book screen is opened (never from boot, a
// timer, or loadFromCloud) — so it never fires on a screen nobody is
// looking at. Recomputes every closed day's live auto totals; where they
// differ from the close's stored baseline by more than the rounding
// threshold, posts one adjustment and re-baselines that close. Naturally
// idempotent: re-baselining means a second run sees zero delta and posts
// nothing, so running it twice in a row is always safe.
//
// Snapshot is taken only once real work exists, and a save failure
// (including a version conflict from another device saving first) rolls
// back every adjustment this call made. That rollback matters more here
// than anywhere else in the app: if the baseline advanced while the save
// failed, the next sweep would see zero delta and silently never post
// the correction at all.
function dbSweepRestatements(cb){
  var dirty = [];
  (S.dayBook.closes||[]).forEach(function(close){
    var t = dbAutoTotals(close.date);
    if(Math.abs(t.in - close.autoIn) > DB_RESTATE_THRESHOLD || Math.abs(t.out - close.autoOut) > DB_RESTATE_THRESHOLD){
      dirty.push({close:close, newIn:t.in, newOut:t.out});
    }
  });
  if(!dirty.length){ if(cb) cb(null, 0); return; }

  var snap = _dbSnapshot();
  dirty.forEach(function(d){ dbPostAdjustment(d.close, d.newIn, d.newOut); });
  saasActivityLog('daybook', dirty.length+' day(s) restated after a record dated inside a closed day changed');
  auditLog('restate', 'daybook', dirty.map(function(d){ return d.close.date; }).join(','), dirty.length+' day(s) restated');
  _dbCommit(snap, function(err){ if(cb) cb(err, err ? 0 : dirty.length); });
}
