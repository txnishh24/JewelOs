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
  rent:          {dir:'out', label:'Rent',              group:'expense',  icon:'🏠', color:'var(--danger)'},
  salary:        {dir:'out', label:'Salary',            group:'expense',  icon:'👤', color:'var(--danger)'},
  electricity:   {dir:'out', label:'Electricity',       group:'expense',  icon:'💡', color:'var(--danger)'},
  tea:           {dir:'out', label:'Tea / Refreshment', group:'expense',  icon:'☕',        color:'var(--danger)'},
  transport:     {dir:'out', label:'Transport',         group:'expense',  icon:'🚗', color:'var(--danger)'},
  repair:        {dir:'out', label:'Repair',            group:'expense',  icon:'🔧', color:'var(--danger)'},
  misc:          {dir:'out', label:'Miscellaneous',     group:'expense',  icon:'📦', color:'var(--danger)'},
  drawings:      {dir:'out', label:'Owner Drawings',    group:'owner',    icon:'💰', color:'var(--text3)'},
  capital:       {dir:'in',  label:'Owner Capital',     group:'owner',    icon:'🏦', color:'var(--success)'},
  bankDeposit:   {dir:'out', label:'Bank Deposit',      group:'transfer', icon:'🏧', color:'var(--text3)'},
  bankWithdrawal:{dir:'in',  label:'Bank Withdrawal',   group:'transfer', icon:'🏧', color:'var(--text3)'},
  cashShort:     {dir:'out', label:'Cash Short',        group:'reconcile',icon:'⚠️', color:'var(--danger)'},
  cashExcess:    {dir:'in',  label:'Cash Excess',       group:'reconcile',icon:'✅',        color:'var(--success)'},
  adjust:        {dir:null,  label:'Adjustment',        group:'system',   icon:'🔄', color:'var(--text3)'}
};

// Icon/color for auto lines (docs/DAYBOOK-SPEC-v2.md §3.1) — keyed by
// src, not DB_CATS, because an auto line's cat (e.g. 'sale-refund',
// 'girvi-disbursement') is a free-form label, not a DB_CATS key.
var DB_AUTO_ICONS = {
  sale:     {icon:'💎', color:'var(--gold-dark)'},
  purchase: {icon:'📥', color:'var(--text2)'},
  girvi:    {icon:'🪙', color:'#c9a84c'},
  order:    {icon:'📝', color:'var(--text2)'}
};

// Icon+color for any Day Book line (manual, via DB_CATS; auto, via
// DB_AUTO_ICONS by src). Falls back to a neutral dot rather than ever
// showing nothing — see DAYBOOK-SPEC-v2.md §9's "no undefined icon" test.
function dbLineIcon(line){
  if(line.cat && DB_CATS[line.cat] && DB_CATS[line.cat].icon) return DB_CATS[line.cat];
  if(line.src && DB_AUTO_ICONS[line.src]) return DB_AUTO_ICONS[line.src];
  return {icon:'•', color:'var(--text3)'};
}

// Renders a calcDayBookExpenses().byCat breakdown as plRow() lines, icon +
// color per category. Shared by Reports' P&L card (03-billing-numbers.js)
// and Day Book's Month view (§6.2 point 4) so the two can never drift —
// same function, same data, per DAYBOOK-SPEC-v2.md §6.3.
function dbExpenseBreakdownHtml(byCat){
  return Object.keys(byCat).sort(function(a,b){ return byCat[b]-byCat[a]; }).map(function(cat){
    var c = DB_CATS[cat] || {label:cat, icon:'', color:'var(--text3)'};
    return plRow('  '+c.icon+' '+escHtml(c.label), fmt(byCat[cat]), c.color, false);
  }).join('');
}

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
        if(!(p.amount > 0)) return;
        if(dbIsCash(p.mode)){
          lines.push({dir:'in', amount:dbRound(p.amount), cat:'sale', label:'Sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:sale.invNo||''});
        } else {
          lines.push({dir:'in', nonCash:true, mode:p.mode||'', amount:dbRound(p.amount), cat:'sale', label:'Sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:sale.invNo||''});
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
      var dir = (p.type === 'reversal') ? 'out' : 'in';
      var extraCat = dir==='out' ? 'sale-payment-reversal' : 'sale-extra-payment';
      if(!dbIsCash(p.mode)){
        lines.push({dir:dir, nonCash:true, mode:p.mode||'', amount:dbRound(p.amount), cat:extraCat, label:'Sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:p.id});
        return;
      }
      lines.push({dir:dir, amount:dbRound(p.amount), cat:extraCat, label:'Sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:p.id});
    });
    // A6 sale.paymentHistory: never a line — it mirrors A1/A4, see header note.

    // A5: refunds paid in cash, out, on the refund's own date.
    (sale.refunds||[]).forEach(function(r){
      if(dbDayKey(r.date) !== dateKey) return;
      if(!r.amount || r.amount <= 0) return;
      if(!dbIsCash(r.mode)){
        lines.push({dir:'out', nonCash:true, mode:r.mode||'', amount:dbRound(r.amount), cat:'sale-refund', label:'Refund, sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:r.id});
        return;
      }
      lines.push({dir:'out', amount:dbRound(r.amount), cat:'sale-refund', label:'Refund, sale '+(sale.invNo||''), src:'sale', srcId:sale.id, ref:r.id});
    });
  });

  // ── B. Purchases ──────────────────────────────────────────────────
  (S.purchases||[]).forEach(function(bill){
    // B1: whole-bill payment method. 'Credit' means zero cash moved, so it
    // never produces a line at all — not even a non-cash one.
    if(dbDayKey(bill.date) === dateKey && bill.amountPaid > 0){
      if(dbIsCash(bill.paymentMethod)){
        lines.push({dir:'out', amount:dbRound(bill.amountPaid), cat:'purchase', label:'Purchase '+(bill.billNo||''), src:'purchase', srcId:bill.id, ref:bill.billNo||''});
      } else if(String(bill.paymentMethod||'').trim().toLowerCase() !== 'credit'){
        lines.push({dir:'out', nonCash:true, mode:bill.paymentMethod||'', amount:dbRound(bill.amountPaid), cat:'purchase', label:'Purchase '+(bill.billNo||''), src:'purchase', srcId:bill.id, ref:bill.billNo||''});
      }
    }
    // B2: payments made to the supplier after the bill was entered.
    (bill.supplierPayments||[]).forEach(function(p){
      if(dbDayKey(p.date) !== dateKey) return;
      if(!p.amount || p.amount <= 0) return;
      var dir = (p.type === 'reversal') ? 'in' : 'out';
      var supCat = dir==='in' ? 'supplier-payment-reversal' : 'supplier-payment';
      if(!dbIsCash(p.mode)){
        lines.push({dir:dir, nonCash:true, mode:p.mode||'', amount:dbRound(p.amount), cat:supCat, label:'Purchase '+(bill.billNo||''), src:'purchase', srcId:bill.id, ref:p.id});
        return;
      }
      lines.push({dir:dir, amount:dbRound(p.amount), cat:supCat, label:'Purchase '+(bill.billNo||''), src:'purchase', srcId:bill.id, ref:p.id});
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
      } else {
        lines.push({dir:'out', nonCash:true, mode:g.disburseMode||'', amount:dbRound(g.principal), cat:'girvi-disbursement', label:'Loan '+(g.grvNo||'')+' disbursed', src:'girvi', srcId:g.id, ref:g.grvNo||''});
      }
    }
    // C2: repayments, interest, refunds — dispatch on type. penalty and
    // waiver are excluded by type (a penalty is a charge, not cash in;
    // a waiver's mode is hard-coded 'Waiver' anyway) regardless of mode.
    (g.payments||[]).forEach(function(p){
      var day = dbDayKey(p.date || p.ts);
      if(day !== dateKey) return;
      if(!p.amount || p.amount <= 0) return;
      var type = p.type || 'payment'; // legacy entries predate the type field
      if(type !== 'payment' && type !== 'interest' && type !== 'refund') return;
      var gDir = (type === 'refund') ? 'out' : 'in';
      var gCat = (type === 'refund') ? 'girvi-refund' : 'girvi-repayment';
      var gLabel = 'Loan '+(g.grvNo||'')+(type==='refund' ? ' refund' : '');
      if(!dbIsCash(p.mode)){
        lines.push({dir:gDir, nonCash:true, mode:p.mode||'', amount:dbRound(p.amount), cat:gCat, label:gLabel, src:'girvi', srcId:g.id, ref:p.id});
        return;
      }
      lines.push({dir:gDir, amount:dbRound(p.amount), cat:gCat, label:gLabel, src:'girvi', srcId:g.id, ref:p.id});
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
        var dir = (txn.type === 'reversal') ? 'out' : 'in';
        var ordCat = dir==='out' ? 'order-advance-reversal' : 'order-advance';
        if(!dbIsCash(txn.mode)){
          lines.push({dir:dir, nonCash:true, mode:txn.mode||'', amount:dbRound(txn.amount), cat:ordCat, label:'Order '+(o.ordNo||''), src:'order', srcId:o.id, ref:txn.txnId||''});
          return;
        }
        lines.push({dir:dir, amount:dbRound(txn.amount), cat:ordCat, label:'Order '+(o.ordNo||''), src:'order', srcId:o.id, ref:txn.txnId||''});
      });
    } else if(o.advance > 0){
      // D2: legacy fallback for an order created before o.ledger existed.
      if(dbDayKey(o.createdAt) === dateKey){
        if(dbIsCash(o.payment || 'Cash')){
          lines.push({dir:'in', amount:dbRound(o.advance), cat:'order-advance-legacy', label:'Order '+(o.ordNo||''), src:'order', srcId:o.id, ref:''});
        } else {
          lines.push({dir:'in', nonCash:true, mode:o.payment||'', amount:dbRound(o.advance), cat:'order-advance-legacy', label:'Order '+(o.ordNo||''), src:'order', srcId:o.id, ref:''});
        }
      }
    }
    // D3 o.advance (scalar) is a derived cache when o.ledger exists — never posted directly.
  });

  return lines;
}

function dbAutoTotals(dateKey){
  var lines = dbAutoLines(dateKey);
  var totals = {in:0, out:0, unknownCount:0, nonCashCount:0, nonCashAmount:0};
  lines.forEach(function(l){
    if(l.unknown){ totals.unknownCount++; return; }
    if(l.nonCash){ totals.nonCashCount++; totals.nonCashAmount = dbRound(totals.nonCashAmount + l.amount); return; }
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
    unknownCount: autoT.unknownCount,
    nonCashCount: autoT.nonCashCount,
    nonCashAmount: autoT.nonCashAmount
  };
}

// Day Book v2 §2 — one entry per calendar day in [fromDateKey, toDateKey]
// inclusive, for the trend chart and Month view's day-by-day list. Reuses
// dbDayView for every day rather than re-implementing its in/out/closing
// logic — a closed day still comes back frozen at its stored closing.
function dbBuildTrend(fromDateKey, toDateKey){
  var out = [];
  var k = fromDateKey;
  while(k <= toDateKey){
    var v = dbDayView(k);
    out.push({date:k, totalIn:v.totalIn, totalOut:v.totalOut, closing:v.closing, isClosed:v.closed});
    k = _dbNextDay(k);
  }
  return out;
}

// 'YYYY-MM-DD' + n calendar days (n may be negative), built from local
// parts (never through UTC midnight parsing — same reasoning as
// subPaidUntil in 04-orders-detail.js).
function _dbOffsetDay(dateKey, n){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if(!m) return dateKey;
  var d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  d.setDate(d.getDate()+n);
  return dbDayKey(d);
}
function _dbNextDay(dateKey){ return _dbOffsetDay(dateKey, 1); }

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

// Day Book v2 §4.2 — optional {name, phone, customerId} on a manual entry.
// customerId only when it names a real S.customers row; blank → no party.
function dbCleanParty(party){
  if(!party) return null;
  var name = (party.name||'').toString().trim(), phone = (party.phone||'').toString().trim();
  if(!name && !phone) return null;
  var p = {name:name, phone:phone};
  var c = party.customerId && (S.customers||[]).find(function(x){ return x.id === party.customerId; });
  if(c) p.customerId = c.id;
  return p;
}

// party is last (after cb) so existing positional callers are unaffected.
function dbAddEntry(dateKey, dir, amount, cat, note, cb, party){
  if(dir !== 'in' && dir !== 'out'){ if(cb) cb(new Error('invalid-dir')); return; }
  if(!(amount > 0)){ if(cb) cb(new Error('invalid-amount')); return; }
  if(!DB_CATS[cat] || cat === 'adjust'){ if(cb) cb(new Error('invalid-cat')); return; } // adjust is system-only
  // QA 30 Sep: closing TODAY makes the first open day tomorrow, and the
  // "Record the shortfall?" dialog lands its entry there -- which this guard
  // refused as future-date, silently. Only that entry (a cash short/excess on
  // the first open day) may be dated ahead; manual entries still may not.
  var _closeCarry = (cat === 'cashShort' || cat === 'cashExcess') && dateKey === dbFirstOpenDay();
  if(dateKey > dbToday() && !_closeCarry){ if(cb) cb(new Error('future-date')); return; }
  if(dbCloseFor(dateKey)){ if(cb) cb(new Error('day-closed')); return; }

  var snap = _dbSnapshot();
  var entry = {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'DB-'+Date.now(),
    date: dateKey, dir: dir, amount: dbRound(amount), cat: cat, note: note || '',
    kind: 'manual', ts: new Date().toISOString(), by: _dbUserName(),
    voided: false, voidReason: ''
  };
  var cleanParty = dbCleanParty(party);
  if(cleanParty) entry.party = cleanParty;
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
var _dbViewMode = 'day';    // 'day' | 'month' (DAYBOOK-SPEC-v2.md §6)
var _dbMonthYear = new Date().getFullYear();
var _dbMonthMonth = new Date().getMonth();
var _dbChartDays = 14;      // trend chart window toggle: 14 or 30

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
// Jumping to a specific date always means "show me that day" — used both by
// the day-nav date input and by tapping a bar/row in Month view, so it also
// switches back to Day mode (§6.2: "tap to drill into that day's single-day view").
function dbGoDate(k){ if(!k) return; _dbDate = (k > dbToday()) ? dbToday() : k; _dbViewMode = 'day'; renderDayBook(); }
function dbGoToday(){ _dbDate = dbToday(); renderDayBook(); }

function dbSetViewMode(mode){
  if(_dbViewMode === mode) return;
  _dbViewMode = mode;
  renderDayBook();
}
function dbChangeMonth(dir){
  _dbMonthMonth += dir;
  if(_dbMonthMonth > 11){ _dbMonthMonth = 0; _dbMonthYear++; }
  if(_dbMonthMonth < 0){ _dbMonthMonth = 11; _dbMonthYear--; }
  renderDayBook();
}
function dbSetChartDays(n){ _dbChartDays = n; renderDayBook(); }

// Day Book v2 §4.3 — "👤 By Person" in Month view, same shape as Girvi's
// toggleGirviViewMode/renderGirviByCustomer. Session-only, like _dbViewMode.
var _dbByPerson = false;
function dbToggleByPerson(btn){
  _dbByPerson = !_dbByPerson;
  if(btn) btn.classList.toggle('active', _dbByPerson);
  renderDayBook();
}

// Pure: live manual entries with a party in [fromKey, toKey], grouped by
// customerId (else normalised name+phone, as Girvi does for unlinked rows).
function dbGroupByParty(fromKey, toKey){
  var groups = {};
  (S.dayBook.entries||[]).forEach(function(e){
    if(e.voided || e.kind !== 'manual' || !e.party || e.date < fromKey || e.date > toKey) return;
    var key = e.party.customerId || ('p_'+normName(e.party.name)+'_'+normPhone(e.party.phone));
    if(!groups[key]){
      var c = e.party.customerId && (S.customers||[]).find(function(x){ return x.id === e.party.customerId; });
      groups[key] = { custId:e.party.customerId||null, name:c ? c.name : e.party.name,
                      phone:c ? c.phone : e.party.phone, entries:[], totalIn:0, totalOut:0 };
    }
    var g = groups[key];
    g.entries.push(e);
    if(e.dir === 'in')  g.totalIn  = dbRound(g.totalIn  + e.amount);
    if(e.dir === 'out') g.totalOut = dbRound(g.totalOut + e.amount);
  });
  return Object.keys(groups).map(function(k){ return groups[k]; })
    .sort(function(a,b){ return (b.totalIn+b.totalOut) - (a.totalIn+a.totalOut); });
}

function _dbPaintByPerson(fromKey, toKey){
  var rows = dbGroupByParty(fromKey, toKey);
  if(!rows.length){
    return '<div class="card"><div style="text-align:center;color:var(--text3);padding:16px;font-size:13px;">No entries linked to a person this month.</div></div>';
  }
  return rows.map(function(grp){
    var entriesHtml = grp.entries.slice().sort(function(a,b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); })
      .map(function(e){
        var c = DB_CATS[e.cat] || {label:e.cat, icon:'', color:'var(--text3)'};
        return '<div class="gl-entry" style="cursor:pointer;" onclick="dbGoDate(\''+jsAttrEsc(e.date)+'\')">'+
          '<div class="gl-entry-left">'+
            '<div class="gl-entry-amt '+(e.dir==='in'?'credit':'debit')+'">'+(e.dir==='in'?'+':'−')+fmt(e.amount)+'</div>'+
            '<div class="gl-entry-meta"><span style="color:'+c.color+';">'+c.icon+'</span> '+escHtml(c.label)+(e.note?' • '+escHtml(e.note):'')+'</div>'+
          '</div>'+
          '<div class="gl-entry-right"><div style="font-size:12px;color:var(--ink3);">'+fmtDate(e.date)+'</div></div>'+
        '</div>';
      }).join('');
    return '<div class="card">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">'+
        '<div>'+
          '<div style="font-weight:700;font-size:15px;">👤 '+escHtml(grp.name||grp.phone||'Unknown')+'</div>'+
          (grp.phone?'<div style="font-size:12px;color:var(--text3);margin-top:2px;">📞 '+escHtml(grp.phone)+'</div>':'')+
        '</div>'+
        '<div style="text-align:right;font-size:11px;color:var(--text3);">'+grp.entries.length+' entr'+(grp.entries.length===1?'y':'ies')+'</div>'+
      '</div>'+
      '<div style="display:flex;gap:16px;flex-wrap:wrap;padding:8px 0;border-top:0.5px solid rgba(201,168,76,.14);border-bottom:0.5px solid rgba(201,168,76,.14);margin-bottom:6px;">'+
        '<div><div style="font-size:10px;color:var(--text3);">Paid out</div><div style="font-weight:700;color:var(--danger);">'+fmt(grp.totalOut)+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);">Received</div><div style="font-weight:700;color:var(--success);">'+fmt(grp.totalIn)+'</div></div>'+
      '</div>'+
      entriesHtml+
    '</div>';
  }).join('');
}

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

  var toggle = '<div style="display:flex;gap:6px;margin-bottom:10px;">'+
    '<button class="btn btn-sm'+(_dbViewMode==='day'?' btn-gold':'')+'" onclick="dbSetViewMode(\'day\')">Day</button>'+
    '<button class="btn btn-sm'+(_dbViewMode==='month'?' btn-gold':'')+'" onclick="dbSetViewMode(\'month\')">📅 Month</button>'+
  '</div>';
  body.innerHTML = toggle + (_dbViewMode==='month' ? _dbPaintMonth() : _dbPaintDay());
}

function _dbPaintDay(){
  var dateKey = dbUiDate();
  var v = dbDayView(dateKey);
  var isToday = dateKey === dbToday();
  var html = '';

  html += '<div class="card" style="padding:0.85rem 1.1rem;">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;gap:8px;">'+
      '<button class="btn btn-sm" style="flex-shrink:0;" onclick="dbGoPrev()">‹</button>'+
      '<input type="date" id="db-date-input" value="'+dateKey+'" max="'+dbToday()+'" onchange="dbGoDate(this.value)" style="flex:1;min-width:0;font-size:13px;font-weight:600;text-align:center;border:none;background:transparent;color:var(--ink);"/>'+
      '<button class="btn btn-sm" style="flex-shrink:0;" onclick="dbGoNext()"'+(isToday?' disabled':'')+'>›</button>'+
      (isToday?'':'<button class="btn btn-sm btn-gold" style="flex-shrink:0;" onclick="dbGoToday()">Today</button>')+
    '</div>'+
  '</div>';

  html += '<div class="metrics">'+
    '<div class="metric"><div class="metric-label">Opening</div><div class="metric-value">'+fmt(v.opening)+'</div></div>'+
    '<div class="metric"><div class="metric-label">Cash In</div><div class="metric-value" style="color:var(--success)">'+fmt(v.totalIn)+'</div></div>'+
    '<div class="metric"><div class="metric-label">Cash Out</div><div class="metric-value" style="color:var(--danger)">'+fmt(v.totalOut)+'</div></div>'+
    '<div class="metric"><div class="metric-label">Closing</div><div class="metric-value">'+fmt(v.closing)+'</div></div>'+
  '</div>';

  if(v.closing < 0){
    html += '<div class="card" style="border:1px solid var(--danger);">'+
      '<div style="font-size:12px;color:var(--danger);font-weight:600;">⚠ Closing cash is negative ('+fmt(v.closing)+'). That usually means the opening balance or a payment mode on one of today\'s entries is wrong.</div>'+
    '</div>';
  }

  if(v.closed){
    var diffTxt = v.diff===0 ? 'matched exactly' : (v.diff<0 ? 'short by '+fmt(-v.diff) : 'excess of '+fmt(v.diff));
    html += '<div class="card" style="border:1px solid rgba(201,163,76,0.3);">'+
      '<div class="card-title">🔒 Day closed</div>'+
      '<div style="font-size:12px;color:var(--text2);">Counted '+fmt(v.counted)+' — '+diffTxt+'.</div>'+
      (dbDayKey(v.close.ts)===dbToday() ? '<button class="btn btn-sm" style="margin-top:8px;" onclick="dbOpenCorrectModal()">Correct today\'s count</button>' : '')+
    '</div>';
  }

  if(v.nonCashCount > 0){
    html += '<div class="card" style="border:1px solid var(--gold);">'+
      '<div style="font-size:12px;color:var(--text2);">Also today: <b>'+fmt(v.nonCashAmount)+'</b> across '+v.nonCashCount+' sale(s)/payment(s) in UPI, Card or Bank — correctly not counted in the cash figures above.</div>'+
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
      if(line.nonCash){
        html += '<div class="gl-entry" style="opacity:.7;">'+
          '<div class="gl-entry-left"><div class="gl-entry-amt">'+fmt(line.amount)+' — '+escHtml(line.mode||'non-cash')+', not counted</div>'+
          '<div class="gl-entry-meta">'+escHtml(line.label||'')+'</div></div>'+
        '</div>';
        return;
      }
      running = dbRound(running + (line.dir==='in' ? line.amount : -line.amount));
      var canVoid = (line.kind==='manual') && !line.voided && !v.closed;
      var catLabel = (line.cat && DB_CATS[line.cat]) ? DB_CATS[line.cat].label : (line.cat||'');
      var sourceTag = line.src ? ' • auto' : (line.kind==='manual' ? ' • manual' : '');
      var lineIcon = dbLineIcon(line);
      var iconBadge = '<span style="display:inline-block;width:16px;text-align:center;margin-right:5px;color:'+lineIcon.color+';">'+lineIcon.icon+'</span>';
      var partyTag = line.party ? ' <span class="db-party-tag">👤 '+escHtml(line.party.name||line.party.phone)+'</span>' : '';
      html += '<div class="gl-entry"'+(line.voided?' style="opacity:.5;"':'')+'>'+
        '<div class="gl-entry-left">'+
          '<div class="gl-entry-amt '+(line.dir==='in'?'credit':'debit')+'">'+(line.dir==='in'?'+':'−')+fmt(line.amount)+(line.voided?' (voided)':'')+'</div>'+
          '<div class="gl-entry-meta">'+iconBadge+escHtml(line.label||catLabel)+(line.note?' • '+escHtml(line.note):'')+partyTag+(line.kind==='adjust'?' • system adjustment':sourceTag)+(line.voided?' • '+escHtml(line.voidReason||''):'')+'</div>'+
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

  return html;
}

// Day Book v2 §6 — Month view: month picker, trend chart (§2), Cash In/Out/
// Net + expenses tiles, the shared expense breakdown (§6.3 — same function
// as Reports' P&L card), and a day-by-day list. Read-only aggregation over
// dbBuildTrend/calcDayBookExpenses — no new storage, nothing that touches
// dbAutoTotals or the locked-day sweep.
function _dbPaintMonth(){
  var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var year = _dbMonthYear, month = _dbMonthMonth;
  var monthStart = year+'-'+String(month+1).padStart(2,'0')+'-01';
  var monthEndKey = dbDayKey(new Date(year, month+1, 0));
  var today = dbToday();
  var rangeEnd = monthEndKey < today ? monthEndKey : today;
  // Flows before the Day Book's opening date are already folded into the
  // owner-entered opening amount -- counting them again here double-counts
  // a shop's first partial month and makes its early days look like errors
  // (batch28 device pass, 23 Sep 2026 HANDOFF entry).
  var openingDate = S.dayBook.opening && S.dayBook.opening.date;
  var rangeStart = (openingDate && openingDate > monthStart) ? openingDate : monthStart;
  // The chart's own range (below) can reach earlier than rangeStart (into
  // the previous month) or later (a short 14d window in a long-open
  // month) -- one dbBuildTrend over their combined span, sliced twice,
  // instead of walking the same days from dbOpening() a second time
  // (Opus review of this fix, 23 Sep 2026 HANDOFF entry: perf note).
  var chartStart = _dbOffsetDay(rangeEnd, -(_dbChartDays-1));
  if(openingDate && chartStart < openingDate) chartStart = openingDate;
  var fullStart = chartStart < rangeStart ? chartStart : rangeStart;
  var fullTrend = fullStart <= rangeEnd ? dbBuildTrend(fullStart, rangeEnd) : [];
  var trend = fullTrend.filter(function(d){ return d.date >= rangeStart; });

  var totalIn=0, totalOut=0;
  trend.forEach(function(d){ totalIn = dbRound(totalIn+d.totalIn); totalOut = dbRound(totalOut+d.totalOut); });
  // Net Cash already nets every cash movement, including expense payments
  // (dbDayView's totalOut is auto+manual cash out, and manual out includes
  // every group:'expense' entry) — so there is no separate "after expenses"
  // figure to show without double-subtracting them. Opus review 23 Sep 2026
  // caught an earlier version of this tile doing exactly that (HANDOFF.md).
  var netCash = dbRound(totalIn - totalOut);
  var expenses = calcDayBookExpenses(year, month);

  var html = '<div style="margin-bottom:10px;"><button class="girvi-search-chip'+(_dbByPerson?' active':'')+'" onclick="dbToggleByPerson(this)">👤 By Person</button></div>';

  html += '<div class="card" style="padding:0.85rem 1.1rem;">'+
    '<div style="display:flex;align-items:center;justify-content:space-between;">'+
      '<button class="btn btn-sm" onclick="dbChangeMonth(-1)">‹</button>'+
      '<div style="font-size:13px;font-weight:700;">'+MN[month]+' '+year+'</div>'+
      '<button class="btn btn-sm" onclick="dbChangeMonth(1)">›</button>'+
    '</div>'+
    (rangeStart > monthStart ? '<div style="text-align:center;font-size:11px;color:var(--text3);margin-top:4px;">Day Book started '+fmtDate(rangeStart)+'</div>' : '')+
  '</div>';

  // Its own range, independent of the month picker -- a trend clipped to
  // the selected month can't show more than a handful of bars on the 3rd
  // of a month, and 30d would never reach back into the previous month
  // (batch28 confirmed-live review, 23 Sep 2026 HANDOFF entry). chartStart
  // was already folded into fullTrend above; just slice it back out.
  var chartDays = fullTrend.filter(function(d){ return d.date >= chartStart; });
  var mx = Math.max.apply(null, chartDays.map(function(d){return Math.max(d.totalIn,d.totalOut);})) || 1;
  html += '<div class="card">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'+
      '<div class="card-title" style="margin:0;">Cash flow trend</div>'+
      '<div style="display:flex;gap:4px;">'+
        '<button class="btn btn-sm'+(_dbChartDays===14?' btn-gold':'')+'" onclick="dbSetChartDays(14)">14d</button>'+
        '<button class="btn btn-sm'+(_dbChartDays===30?' btn-gold':'')+'" onclick="dbSetChartDays(30)">30d</button>'+
      '</div>'+
    '</div>'+
    (chartDays.length ?
      '<div style="display:flex;align-items:flex-end;gap:2px;height:104px;">'+
      chartDays.map(function(d){
        var hIn  = Math.max(2, Math.round(d.totalIn/mx*80));
        var hOut = Math.max(2, Math.round(d.totalOut/mx*80));
        var dayNum = Number(d.date.slice(8,10));
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;cursor:pointer;" onclick="dbGoDate(\''+d.date+'\')" title="'+fmtDate(d.date)+'">'+
          '<div style="width:100%;display:flex;align-items:flex-end;gap:1px;height:80px;">'+
            '<div style="flex:1;height:'+hIn+'px;background:var(--gold-dark);border-radius:2px 2px 0 0;"></div>'+
            '<div style="flex:1;height:'+hOut+'px;background:var(--danger);border-radius:2px 2px 0 0;opacity:.85;"></div>'+
          '</div>'+
          '<div style="font-size:9px;color:var(--text3);margin-top:3px;">'+dayNum+'</div>'+
        '</div>';
      }).join('')+
      '</div>'
      : '<div class="empty" style="padding:16px 0;">No activity yet this range</div>')+
  '</div>';

  html += '<div class="metrics">'+
    '<div class="metric"><div class="metric-label">Cash In</div><div class="metric-value" style="color:var(--success)">'+fmt(totalIn)+'</div><div class="metric-sub">'+MN[month]+' so far</div></div>'+
    '<div class="metric"><div class="metric-label">Cash Out</div><div class="metric-value" style="color:var(--danger)">'+fmt(totalOut)+'</div><div class="metric-sub">'+MN[month]+' so far</div></div>'+
    '<div class="metric"><div class="metric-label">Net Cash</div><div class="metric-value" style="color:'+(netCash>=0?'var(--success)':'var(--danger)')+'">'+fmt(netCash)+'</div><div class="metric-sub">'+MN[month]+' so far</div></div>'+
    '<div class="metric"><div class="metric-label">Operating Expenses</div><div class="metric-value" style="color:var(--danger)">'+fmt(expenses.total)+'</div><div class="metric-sub">already inside Cash Out</div></div>'+
  '</div>';

  if(Object.keys(expenses.byCat).length){
    html += '<div class="card"><div class="card-title">Expense breakdown</div>'+dbExpenseBreakdownHtml(expenses.byCat)+'</div>';
  }

  if(_dbByPerson) return html + _dbPaintByPerson(rangeStart, rangeEnd);

  html += '<div class="card"><div class="card-title">Days</div>';
  if(!trend.length){
    html += '<div style="text-align:center;color:var(--text3);padding:16px;font-size:13px;">No days in this range yet.</div>';
  } else {
    html += trend.slice().reverse().map(function(d){
      return '<div class="gl-entry" style="cursor:pointer;" onclick="dbGoDate(\''+d.date+'\')">'+
        '<div class="gl-entry-left">'+
          '<div class="gl-entry-amt">'+(d.isClosed?'🔒 ':'')+fmtDate(d.date)+'</div>'+
          '<div class="gl-entry-meta">In '+fmt(d.totalIn)+' • Out '+fmt(d.totalOut)+'</div>'+
        '</div>'+
        '<div class="gl-entry-right"><div style="font-size:12px;font-weight:600;color:var(--ink3);">'+fmt(d.closing)+'</div></div>'+
      '</div>';
    }).join('');
  }
  html += '</div>';

  return html;
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
      var c = DB_CATS[k];
      return '<button type="button" class="gl-type-btn db-cat-chip" style="border-color:'+c.color+';" onclick="dbSetEntryCat(\''+k+'\',this)">'+c.icon+' '+escHtml(c.label)+'</button>';
    }).join('');
  }
  var amtEl = document.getElementById('db-entry-amt'); if(amtEl) amtEl.value = '';
  var noteEl = document.getElementById('db-entry-note'); if(noteEl) noteEl.value = '';
  var partyEl = document.getElementById('db-entry-party'); if(partyEl) partyEl.value = '';
  var sugEl = document.getElementById('db-party-suggestions'); if(sugEl) sugEl.style.display = 'none';
  _dbEntryParty = null;
  document.getElementById('db-entry-modal').style.display = 'block';
}

// §4.3 type-ahead — same inline pattern as the sale form's custAutocomplete(),
// but against S.customers (name prefix or phone digits). Typing after a pick
// drops the link, so a stale customerId never rides on an edited name.
var _dbEntryParty = null; // the S.customers row picked, if any
function dbPartyAutocomplete(){
  _dbEntryParty = null;
  var q = normName((document.getElementById('db-entry-party')||{}).value);
  var box = document.getElementById('db-party-suggestions');
  if(!box) return;
  if(!q){ box.style.display='none'; return; }
  var qd = normPhone(q);
  var matches = (S.customers||[]).filter(function(c){
    return normName(c.name).indexOf(q)===0 || (qd.length>=3 && normPhone(c.phone).indexOf(qd)>-1);
  }).slice(0,5);
  if(!matches.length){ box.style.display='none'; return; }
  box.style.display='block';
  box.innerHTML = matches.map(function(c){
    return '<div style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);" onclick="dbFillParty(\''+jsAttrEsc(c.id)+'\')">'+
      '<strong>'+escHtml(c.name)+'</strong>'+(c.phone?' &bull; '+escHtml(c.phone):'')+
    '</div>';
  }).join('');
}

function dbFillParty(custId){
  var c = (S.customers||[]).find(function(x){ return x.id === custId; });
  if(!c) return;
  document.getElementById('db-entry-party').value = c.name || c.phone || '';
  document.getElementById('db-party-suggestions').style.display = 'none';
  _dbEntryParty = c;
}

function dbSetEntryCat(cat, el){
  _dbEntryCat = cat;
  document.querySelectorAll('.db-cat-chip').forEach(function(b){ b.classList.toggle('active', b === el); });
}

function dbSubmitEntry(){
  if(!_dbEntryCat){ toast('⚠ Choose a category'); return; }
  var amt = parseFloat((document.getElementById('db-entry-amt')||{}).value);
  var note = (document.getElementById('db-entry-note')||{}).value || '';
  var partyText = (document.getElementById('db-entry-party')||{}).value || '';
  // Typed text made only of phone-ish characters (digits, spaces, +, -,
  // parens) with 7+ real digits is a phone number, not a name -- store it
  // as one so it doesn't render as "👤 9876543210". Checking for "no Latin
  // letters" instead of "only phone characters" would let a non-Latin name
  // typed alongside a number (e.g. Devanagari) through as a phone.
  var partyIsPhone = /^[\d\s+()-]+$/.test(partyText.trim()) && normPhone(partyText).length >= 7;
  var party = _dbEntryParty
    ? {name:_dbEntryParty.name, phone:_dbEntryParty.phone, customerId:_dbEntryParty.id}
    : (partyIsPhone ? {name:'', phone:partyText} : {name:partyText, phone:''});
  dbAddEntry(dbUiDate(), DB_CATS[_dbEntryCat].dir, amt, _dbEntryCat, note, function(err){
    if(err){ toast('⚠ Could not save: '+err.message); return; }
    document.getElementById('db-entry-modal').style.display = 'none';
    toast('✓ Entry saved');
    renderDayBook();
  }, party);
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
  var counted = v.lines.filter(function(l){ return !l.unknown && !l.nonCash && !l.voided; });
  var ins  = counted.filter(function(l){ return l.dir === 'in'; });
  var outs = counted.filter(function(l){ return l.dir === 'out'; });
  var diffLine = v.closed
    ? '\nCounted: '+fmt(v.counted)+(v.diff!==0 ? ' ('+(v.diff<0?'short '+fmt(-v.diff):'excess '+fmt(v.diff))+')' : ' (matched)')
    : '';
  var nonCashLine = v.nonCashCount > 0
    ? '\nAlso today (UPI/Card/Bank, not counted above): '+fmt(v.nonCashAmount)+' across '+v.nonCashCount+' payment(s)'
    : '';
  return '📖 *'+shopName+' — Day Book*\n'+fmtDate(dateKey)+'\n─────────\n\n'+
    'Opening: '+fmt(v.opening)+'\n\n'+
    '*Cash In* ('+fmt(v.totalIn)+')\n'+
    (ins.length ? ins.map(function(l){ return '  '+(l.label||l.cat)+': '+fmt(l.amount); }).join('\n') : '  —')+'\n\n'+
    '*Cash Out* ('+fmt(v.totalOut)+')\n'+
    (outs.length ? outs.map(function(l){ return '  '+(l.label||l.cat)+': '+fmt(l.amount); }).join('\n') : '  —')+'\n\n'+
    'Closing: *'+fmt(v.closing)+'*'+diffLine+nonCashLine+
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
