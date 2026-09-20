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
