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
  saasActivityLog('daybook', 'Opening balance set: '+fmt(amount)+' on '+dateKey);
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
  saasActivityLog('daybook', (dir==='in'?'Cash in ':'Expense ')+fmt(entry.amount)+' '+DB_CATS[cat].label+' on '+dateKey);
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
  saasActivityLog('daybook', 'Voided '+fmt(entry.amount)+' '+(DB_CATS[entry.cat]?DB_CATS[entry.cat].label:entry.cat)+' on '+entry.date+': '+entry.voidReason);
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

  var diffNote = diff === 0 ? '' : (diff < 0 ? ', short '+fmt(-diff) : ', excess '+fmt(diff));
  saasActivityLog('daybook', 'Day closed '+dateKey+': book '+fmt(view.closing)+', counted '+fmt(counted)+diffNote);
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
  saasActivityLog('daybook', 'Count corrected for '+dateKey+': '+fmt(prev)+' → '+fmt(latest.counted));
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

// ── UI (Batch E) ──────────────────────────────────────────────────────
// Everything below reads/writes the DOM. None of it is covered by the
// regression suite — there is no browser automation in this repo. The
// pure derivation and write functions above are fully tested; this
// rendering layer is not, and should not be assumed to be until someone
// has actually tapped through it on a phone.
var _dbDate = null;         // 'YYYY-MM-DD' the screen is currently showing
var _dbVoidTargetId = null; // entry id the void modal is open for
var _dbEntryCat = null;     // category chip selected in the Add Entry modal

function dbUiDate(){ if(!_dbDate) _dbDate = dbToday(); return _dbDate; }

// 'YYYY-MM-DD' - 1 calendar day, built from local parts (mirrors
// _dbNextDay above — never through UTC midnight parsing).
function _dbPrevDay(dateKey){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if(!m) return dateKey;
  var d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  d.setDate(d.getDate()-1);
  return dbDayKey(d);
}

function dbGoPrev(){ _dbDate = _dbPrevDay(dbUiDate()); renderDayBook(); }
function dbGoNext(){ if(dbUiDate() >= dbToday()) return; _dbDate = _dbNextDay(dbUiDate()); renderDayBook(); }
function dbGoDate(k){ if(!k) return; _dbDate = (k > dbToday()) ? dbToday() : k; renderDayBook(); }
function dbGoToday(){ _dbDate = dbToday(); renderDayBook(); }

// Entry point from switchTab/renderTab. Always sweeps first (spec §6:
// the sweep runs when the screen is opened, never from boot or a timer)
// so the screen is never painted from a stale restatement baseline.
function renderDayBook(){
  var body = document.getElementById('db-body');
  if(!body) return;
  dbSweepRestatements(function(err){
    if(err && err.message !== 'version-conflict'){
      // version-conflict already shows its own reload prompt inside saveToCloud
      toast('⚠ Could not check for corrections on past days — showing what\'s saved.');
    }
    _dbPaint();
  });
}

function _dbPaint(){
  var body = document.getElementById('db-body');
  if(!body) return;
  var dateKey = dbUiDate();

  // First-time setup: nothing entered yet at all.
  if(!S.dayBook.opening && !(S.dayBook.closes||[]).length){
    body.innerHTML =
      '<div class="card">'+
        '<div class="card-title">📖 Set up your Day Book</div>'+
        '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;">Enter the cash you have in hand right now. Every day after this is tracked automatically from your sales, purchases, girvi and orders.</div>'+
        '<div class="ge-fg" style="margin-bottom:10px;"><label>Opening cash (₹)</label><input id="db-opening-amt" type="number" placeholder="0" inputmode="numeric"/></div>'+
        '<button class="btn btn-gold" style="width:100%;" onclick="dbSubmitOpening()">Start Day Book</button>'+
      '</div>';
    return;
  }

  var v = dbDayView(dateKey);
  var isToday = dateKey === dbToday();
  var html = '';

  html += '<div class="card" style="padding:0.85rem 1.1rem;">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'+
      '<button class="btn btn-sm" onclick="dbGoPrev()">‹</button>'+
      '<input type="date" id="db-date-input" value="'+dateKey+'" max="'+dbToday()+'" onchange="dbGoDate(this.value)" style="font-size:13px;font-weight:600;text-align:center;border:none;background:transparent;color:var(--ink);"/>'+
      '<button class="btn btn-sm" onclick="dbGoNext()"'+(isToday?' disabled':'')+'>›</button>'+
      (isToday?'':'<button class="btn btn-sm btn-gold" onclick="dbGoToday()">Today</button>')+
    '</div>'+
  '</div>';

  html += '<div class="metrics">'+
    '<div class="metric"><div class="metric-label">Opening</div><div class="metric-value">'+fmt(v.opening)+'</div></div>'+
    '<div class="metric"><div class="metric-label">Cash In</div><div class="metric-value" style="color:var(--success)">'+fmt(v.totalIn)+'</div></div>'+
    '<div class="metric"><div class="metric-label">Cash Out</div><div class="metric-value" style="color:var(--danger)">'+fmt(v.totalOut)+'</div></div>'+
    '<div class="metric"><div class="metric-label">Closing</div><div class="metric-value">'+fmt(v.closing)+'</div></div>'+
  '</div>';

  if(v.closed){
    var diffTxt = v.diff===0 ? 'matched exactly' : (v.diff<0 ? 'short by '+fmt(-v.diff) : 'excess of '+fmt(v.diff));
    html += '<div class="card" style="border:1px solid rgba(201,163,76,0.3);">'+
      '<div class="card-title">🔒 Day closed</div>'+
      '<div style="font-size:12px;color:var(--text2);">Counted '+fmt(v.counted)+' — '+diffTxt+'.</div>'+
      (dbDayKey(v.close.ts)===dbToday() ? '<button class="btn btn-sm" style="margin-top:8px;" onclick="dbOpenCorrectModal()">Correct today\'s count</button>' : '')+
    '</div>';
  }

  if(v.unknownCount > 0){
    // ponytail: a flat count-only banner, not a per-line [Add manual entry]
    // prefill action — add the one-tap version if a real shop hits this often.
    html += '<div class="card" style="border:1px solid var(--danger);">'+
      '<div style="font-size:12px;color:var(--danger);font-weight:600;">⚠ '+v.unknownCount+' cash movement(s) today have no recorded payment mode and are NOT counted above. Check the lines below and Girvi/Sales for the source.</div>'+
    '</div>';
  }

  html += '<div class="card"><div class="card-title">Lines</div>';
  var sortedLines = v.lines.slice().sort(function(a,b){
    var ta = a.ts || (a.date+'T00:00:00.000Z'), tb = b.ts || (b.date+'T00:00:00.000Z');
    return ta < tb ? -1 : (ta > tb ? 1 : 0);
  });
  if(!sortedLines.length){
    html += '<div style="text-align:center;color:var(--text3);padding:16px;font-size:13px;">No lines yet for this day.</div>';
  } else {
    var running = v.opening;
    sortedLines.forEach(function(line){
      if(line.unknown){
        html += '<div class="gl-entry" style="opacity:.7;">'+
          '<div class="gl-entry-left"><div class="gl-entry-amt">'+fmt(line.amount)+' — not counted</div>'+
          '<div class="gl-entry-meta">'+escHtml(line.label||'')+'</div></div>'+
        '</div>';
        return;
      }
      running = dbRound(running + (line.dir==='in' ? line.amount : -line.amount));
      var canVoid = (line.kind==='manual') && !line.voided && !v.closed;
      var catLabel = (line.cat && DB_CATS[line.cat]) ? DB_CATS[line.cat].label : (line.cat||'');
      html += '<div class="gl-entry"'+(line.voided?' style="opacity:.5;"':'')+'>'+
        '<div class="gl-entry-left">'+
          '<div class="gl-entry-amt '+(line.dir==='in'?'credit':'debit')+'">'+(line.dir==='in'?'+':'−')+fmt(line.amount)+(line.voided?' (voided)':'')+'</div>'+
          '<div class="gl-entry-meta">'+escHtml(line.label||catLabel)+(line.note?' • '+escHtml(line.note):'')+(line.kind==='adjust'?' • system adjustment':'')+(line.voided?' • '+escHtml(line.voidReason||''):'')+'</div>'+
        '</div>'+
        '<div class="gl-entry-right">'+
          '<div style="font-size:12px;font-weight:600;color:var(--ink3);">'+fmt(running)+'</div>'+
          (canVoid ? '<button class="btn btn-sm" style="margin-top:4px;" onclick="dbOpenVoidModal(\''+jsAttrEsc(line.id)+'\')">Void</button>' : '')+
        '</div>'+
      '</div>';
    });
  }
  html += '</div>';

  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">'+
    (v.closed ? '' :
      '<button class="btn btn-gold" onclick="dbOpenEntryModal()">+ Add Entry</button>'+
      '<button class="btn" onclick="dbOpenCloseModal()">🔒 Close Day</button>')+
    '<button class="btn" onclick="dbPrintDay()">🖨 Print</button>'+
    '<button class="btn btn-dark" onclick="dbWhatsAppDay()">💬 WhatsApp</button>'+
  '</div>';

  body.innerHTML = html;
}

function dbSubmitOpening(){
  var amt = parseFloat((document.getElementById('db-opening-amt')||{}).value);
  if(!(amt >= 0)){ toast('⚠ Enter a valid amount'); return; }
  dbSetOpening(dbUiDate(), amt, function(err){
    if(err){ toast('⚠ Could not save: '+err.message); return; }
    toast('✓ Day Book started');
    renderDayBook();
  });
}

var DB_ENTRY_CHIP_CATS = ['rent','salary','electricity','tea','transport','repair','misc','drawings','capital','bankDeposit','bankWithdrawal'];

function dbOpenEntryModal(){
  _dbEntryCat = null;
  var row = document.getElementById('db-entry-cat-row');
  if(row){
    row.innerHTML = DB_ENTRY_CHIP_CATS.map(function(k){
      return '<button type="button" class="gl-type-btn db-cat-chip" onclick="dbSetEntryCat(\''+k+'\',this)">'+escHtml(DB_CATS[k].label)+'</button>';
    }).join('');
  }
  var amtEl = document.getElementById('db-entry-amt'); if(amtEl) amtEl.value = '';
  var noteEl = document.getElementById('db-entry-note'); if(noteEl) noteEl.value = '';
  document.getElementById('db-entry-modal').style.display = 'block';
}

function dbSetEntryCat(cat, el){
  _dbEntryCat = cat;
  document.querySelectorAll('.db-cat-chip').forEach(function(b){ b.classList.toggle('active', b === el); });
}

function dbSubmitEntry(){
  if(!_dbEntryCat){ toast('⚠ Choose a category'); return; }
  var amt = parseFloat((document.getElementById('db-entry-amt')||{}).value);
  var note = (document.getElementById('db-entry-note')||{}).value || '';
  dbAddEntry(dbUiDate(), DB_CATS[_dbEntryCat].dir, amt, _dbEntryCat, note, function(err){
    if(err){ toast('⚠ Could not save: '+err.message); return; }
    document.getElementById('db-entry-modal').style.display = 'none';
    toast('✓ Entry saved');
    renderDayBook();
  });
}

function dbOpenVoidModal(entryId){
  _dbVoidTargetId = entryId;
  var el = document.getElementById('db-void-reason'); if(el) el.value = '';
  document.getElementById('db-void-modal').style.display = 'block';
}

function dbSubmitVoid(){
  var reason = (document.getElementById('db-void-reason')||{}).value || '';
  if(!reason.trim()){ toast('⚠ Enter a reason'); return; }
  dbVoidEntry(_dbVoidTargetId, reason, function(err){
    if(err){ toast('⚠ Could not void: '+err.message); return; }
    document.getElementById('db-void-modal').style.display = 'none';
    toast('✓ Entry voided');
    renderDayBook();
  });
}

function dbOpenCloseModal(){
  var dateKey = dbUiDate();
  var v = dbDayView(dateKey);
  var sum = document.getElementById('db-close-summary');
  if(sum) sum.innerHTML = 'Book shows a closing balance of <b>'+fmt(v.closing)+'</b> for '+fmtDate(dateKey)+'. Count the physical cash in hand and enter it below.';
  var el = document.getElementById('db-close-counted'); if(el) el.value = '';
  document.getElementById('db-close-modal').style.display = 'block';
}

function dbSubmitClose(){
  var counted = parseFloat((document.getElementById('db-close-counted')||{}).value);
  if(!(counted >= 0)){ toast('⚠ Enter the amount actually counted'); return; }
  var dateKey = dbUiDate();
  safeConfirm('Close '+fmtDate(dateKey)+'?', 'Once closed, this day\'s figures are locked. A later correction to a bill dated today shows up as an adjustment on a future day, not a rewrite of this one.', function(){
    dbCloseDay(dateKey, counted, function(err, res){
      if(err){ toast('⚠ Could not close: '+err.message); return; }
      document.getElementById('db-close-modal').style.display = 'none';
      toast('✓ Day closed');
      renderDayBook();
      if(res.diff !== 0){
        var landDate = dbFirstOpenDay();
        safeConfirm(
          res.diff < 0 ? 'Record the shortfall?' : 'Record the excess?',
          'Counted cash was '+fmt(Math.abs(res.diff))+' '+(res.diff<0?'short':'more')+' than the book. Add this as an entry on '+fmtDate(landDate)+'?',
          function(){
            dbAddEntry(landDate, res.diff<0?'out':'in', Math.abs(res.diff), res.diff<0?'cashShort':'cashExcess', 'From closing '+dateKey, function(err2){
              if(err2){ toast('⚠ Could not record: '+err2.message); return; }
              toast('✓ Recorded');
              renderDayBook();
            });
          }
        );
      }
    });
  });
}

function dbOpenCorrectModal(){
  var el = document.getElementById('db-correct-counted'); if(el) el.value = '';
  var r = document.getElementById('db-correct-reason'); if(r) r.value = '';
  document.getElementById('db-correct-modal').style.display = 'block';
}

function dbSubmitCorrect(){
  var counted = parseFloat((document.getElementById('db-correct-counted')||{}).value);
  var reason = (document.getElementById('db-correct-reason')||{}).value || '';
  if(!(counted >= 0)){ toast('⚠ Enter a valid amount'); return; }
  dbCorrectCount(dbUiDate(), counted, reason, function(err){
    if(err){ toast('⚠ Could not correct: '+err.message); return; }
    document.getElementById('db-correct-modal').style.display = 'none';
    toast('✓ Count corrected');
    renderDayBook();
  });
}

// ── PRINT / WHATSAPP (Batch F) ─────────────────────────────────────────
// dbBuildDaySummary is the shared source for both, so the WhatsApp text
// and the printed sheet can never disagree with each other or with what
// dbDayView already showed on screen. Voided and unknown-mode lines are
// excluded from both — a void is a correction (the void itself is on
// screen, not on the paper record) and an unknown-mode line was never
// counted in the totals to begin with.
function dbBuildDaySummary(dateKey){
  var v = dbDayView(dateKey);
  var shopName = (typeof SAAS !== 'undefined' && SAAS.shop) ? SAAS.shop.name : 'My Shop';
  var counted = v.lines.filter(function(l){ return !l.unknown && !l.voided; });
  var ins  = counted.filter(function(l){ return l.dir === 'in'; });
  var outs = counted.filter(function(l){ return l.dir === 'out'; });
  var diffLine = v.closed
    ? '\nCounted: '+fmt(v.counted)+(v.diff!==0 ? ' ('+(v.diff<0?'short '+fmt(-v.diff):'excess '+fmt(v.diff))+')' : ' (matched)')
    : '';
  return '📖 *'+shopName+' — Day Book*\n'+fmtDate(dateKey)+'\n─────────\n\n'+
    'Opening: '+fmt(v.opening)+'\n\n'+
    '*Cash In* ('+fmt(v.totalIn)+')\n'+
    (ins.length ? ins.map(function(l){ return '  '+(l.label||l.cat)+': '+fmt(l.amount); }).join('\n') : '  —')+'\n\n'+
    '*Cash Out* ('+fmt(v.totalOut)+')\n'+
    (outs.length ? outs.map(function(l){ return '  '+(l.label||l.cat)+': '+fmt(l.amount); }).join('\n') : '  —')+'\n\n'+
    'Closing: *'+fmt(v.closing)+'*'+diffLine+
    '\n\n_Sent from JewelOS_';
}

function dbWhatsAppDay(){
  var msg = dbBuildDaySummary(dbUiDate());
  var ownerPhone = (typeof SAAS !== 'undefined' && SAAS.shop) ? SAAS.shop.phone : '';
  sendWhatsApp(ownerPhone||'', msg);
}

// Two-column rojmel layout (Cash In | Cash Out side by side), matching
// the paper cash book Prime's own product mimics — see spec §7/§8.
function dbPrintDay(){
  var dateKey = dbUiDate();
  var v = dbDayView(dateKey);
  var shopName = (typeof SAAS !== 'undefined' && SAAS.shop) ? SAAS.shop.name : 'My Shop';
  var counted = v.lines.filter(function(l){ return !l.unknown && !l.voided; });
  var ins  = counted.filter(function(l){ return l.dir === 'in'; });
  var outs = counted.filter(function(l){ return l.dir === 'out'; });
  function rows(arr){
    return arr.map(function(l){
      return '<tr><td>'+escHtml(l.label||l.cat||'')+'</td><td style="text-align:right;">'+fmt(l.amount)+'</td></tr>';
    }).join('') || '<tr><td colspan="2" style="color:#999;">—</td></tr>';
  }
  var diffHtml = v.closed
    ? '<br/>Counted: '+fmt(v.counted)+(v.diff!==0 ? ' ('+(v.diff<0?'short '+fmt(-v.diff):'excess '+fmt(v.diff))+')' : ' (matched)')
    : '';
  var w = window.open('', '_blank');
  w.document.write('<html><head><title>Day Book '+escHtml(dateKey)+'</title>'+
    '<style>body{font-family:sans-serif;padding:20px;}h2{margin-bottom:2px;}.sub{color:#666;margin-bottom:14px;}table{width:100%;border-collapse:collapse;font-size:13px;}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;}.cols{display:flex;gap:20px;}.col{flex:1;}.tot{font-weight:700;border-top:2px solid #333;}.summary{margin-top:16px;font-size:14px;}</style>'+
    '</head><body>'+
    '<h2>'+escHtml(shopName)+' — Day Book</h2><div class="sub">'+escHtml(dateKey)+'</div>'+
    '<div class="cols">'+
      '<div class="col"><h3>Cash In</h3><table>'+rows(ins)+'<tr class="tot"><td>Total</td><td style="text-align:right;">'+fmt(v.totalIn)+'</td></tr></table></div>'+
      '<div class="col"><h3>Cash Out</h3><table>'+rows(outs)+'<tr class="tot"><td>Total</td><td style="text-align:right;">'+fmt(v.totalOut)+'</td></tr></table></div>'+
    '</div>'+
    '<div class="summary">Opening: <b>'+fmt(v.opening)+'</b> &nbsp;→&nbsp; Closing: <b>'+fmt(v.closing)+'</b>'+diffHtml+'</div>'+
    '<script>window.onload=function(){window.print();}<\/script></body></html>');
  w.document.close();
}
