function getDeadStock(days){
  var cutoff = new Date(Date.now() - days*86400000);
  return S.products.filter(function(p){
    if(p.status==='sold') return false;
    var added = new Date(p.createdAt || p.addedAt || 0);
    return added < cutoff;
  });
}

// ── CUSTOMER INTELLIGENCE TAGS ────────────────────────────────────────
function getCustomerTags(custName, phone, salesArr){
  var tags = [];
  var f = calcCustomerFinancials(custName, phone);
  // VIP: top 10% by revenue or > ₹1L total
  if(f.totalPurchased > 100000) tags.push('vip');
  // Frequent: 3+ purchases
  if(salesArr.length >= 3) tags.push('freq');
  // Risky: high exposure
  if(f.riskLevel === 'high') tags.push('risk');
  else if(f.riskLevel === 'medium' && f.totalExposure > 20000) tags.push('risk');
  // New: first purchase in last 30 days
  var lastSale = salesArr[salesArr.length-1];
  if(lastSale && (Date.now()-new Date(lastSale.date).getTime()) < 30*86400000 && salesArr.length===1) tags.push('new');
  // Has girvi
  var custGirvi = (S.girvi||[]).filter(function(g){return g.customer===custName;});
  if(custGirvi.some(function(g){return g.status==='defaulted';})) tags.push('risk');
  // QA 1 Oct P2: one big unpaid bill showed VIP + Risky + New at once. VIP is a
  // repeat customer in good standing: 2+ bills and not risky.
  if(tags.indexOf('vip')!==-1 && (salesArr.length<2 || tags.indexOf('risk')!==-1)) tags.splice(tags.indexOf('vip'),1);
  return tags;
}

function renderCustomerTag(tag){
  var map = {
    vip:'<span class="itag itag-vip">⭐ VIP</span>',
    freq:'<span class="itag itag-freq">🔁 Frequent</span>',
    risk:'<span class="itag itag-risk">⚠️ Risky</span>',
    new:'<span class="itag itag-new">🌱 New</span>'
  };
  return map[tag]||'';
}

// ── ORDER INTELLIGENCE ────────────────────────────────────────────────
function orderDelayRisk(o){
  var dl = Math.ceil((new Date(o.delivery)-Date.now())/86400000);
  if(dl < 0)  return {level:'overdue',  color:'var(--danger)', label:'Overdue '+Math.abs(dl)+'d'};
  if(dl===0)  return {level:'today',    color:'var(--warning)', label:'Due Today!'};
  if(dl <= 3) return {level:'urgent',   color:'var(--warning)', label:'In '+dl+'d'};
  return              {level:'ok',      color:'var(--success)', label:'In '+dl+'d'};
}

function orderProfitEst(o){
  // Estimated profit = quote - metal cost estimate
  // Metal cost = weight * rate for each item
  if(!o.items || !o.quote) return 0;
  // QA 30 Sep: with no estimated weight the metal cost was 0, so "Est. profit"
  // showed the whole quote. Use the order weight when there is no estimate,
  // and give no estimate at all (0 -- the cards hide it) when neither is set.
  function _w(it){ return parseFloat(it.estWt)||parseFloat(it.orderWt)||0; }
  if(!(o.items||[]).some(function(it){ return _w(it) > 0; })) return 0;
  var metalCost = (o.items||[]).reduce(function(s,it){
    var rate = getRate(it.metal||'gold', it.purity||'22K');
    return s + rate * _w(it) * (parseInt(it.qty)||1);
  },0);
  var mcCost = (o.items||[]).reduce(function(s,it){
    var mc = parseFloat(it.making)||0;
    var qty = parseInt(it.qty)||1;
    return s + (it.makingType==='per_gram' ? mc*_w(it)*qty : mc*qty);
  },0);
  return (parseFloat(o.quote)||0) - metalCost - mcCost;
}

// ── SMART REPORT HELPERS ──────────────────────────────────────────────
// Week-over-week comparison
function calcWeekRevenue(weeksAgo){
  var end   = new Date(Date.now() - weeksAgo*7*86400000);
  var start = new Date(end.getTime() - 7*86400000);
  return S.sales.filter(function(s){
    var d=new Date(s.date); return d>=start && d<=end;
  }).reduce(function(s,x){return s+calcSaleTotals(x).grand;},0);
}

function calcWeekProfit(weeksAgo){
  var end   = new Date(Date.now() - weeksAgo*7*86400000);
  var start = new Date(end.getTime() - 7*86400000);
  var sales = S.sales.filter(function(s){var d=new Date(s.date);return d>=start&&d<=end;});
  return sales.reduce(function(s,x){return s+calcSaleProfit(x).profit;},0);
}

// Category performance — revenue, units, trend. year/month pick which
// month is "this month" (QA 3 Oct M8: the Reports page's Category
// Intelligence table used to always mean the REAL current month here,
// silently disagreeing with every other figure on the same page once the
// jeweller looked at any other month). Dashboard's own call passes
// nothing, keeping its always-real-now behaviour.
function calcCategoryPerf(year, month){
  var now = new Date();
  var y = (typeof year === 'number') ? year : now.getFullYear();
  var m = (typeof month === 'number') ? month : now.getMonth();
  var thisMonthStart = new Date(y, m, 1);
  // QA 3 Oct M8: this month's window had no end, so it silently also
  // caught every sale after it (NaN-proof: a date compare against an
  // Invalid Date is always false, never a false "within range").
  var thisMonthEnd   = new Date(y, m+1, 0, 23, 59, 59, 999);
  var lastMonthStart = new Date(y, m-1, 1);
  var lastMonthEnd   = new Date(y, m, 0, 23, 59, 59, 999);
  var cats = {};
  S.sales.forEach(function(s){
    var d = new Date(s.date);
    var isThis = d >= thisMonthStart && d <= thisMonthEnd;
    var isLast = d >= lastMonthStart && d <= lastMonthEnd;
    (s.items||[]).forEach(function(i){
      var cat = saleItemCat(i);
      if(!cats[cat]) cats[cat]={rev:0,units:0,prevRev:0,profit:0};
      var itemRev = getItemRate(i)*(parseFloat(i.weight)||0)*(i.qty||1);
      var itemProfit = calcItemProfit(i).profit;
      if(isThis){cats[cat].rev+=itemRev;cats[cat].units+=(i.qty||1);cats[cat].profit+=itemProfit;}
      if(isLast){cats[cat].prevRev+=itemRev;}
    });
  });
  return Object.entries(cats).map(function(e){
    var trend = e[1].prevRev>0 ? ((e[1].rev-e[1].prevRev)/e[1].prevRev*100) : 0;
    return {cat:e[0],rev:e[1].rev,units:e[1].units,prevRev:e[1].prevRev,profit:e[1].profit,trend:trend};
  }).sort(function(a,b){return b.rev-a.rev;});
}

// ── REBUILD renderDash WITH INTELLIGENCE ──────────────────────────────

// ── ONBOARDING CHECKLIST ─────────────────────────────────────────────
function renderOnboarding(){
  var checklist = document.getElementById('onboarding-checklist');
  var stepsEl   = document.getElementById('onboarding-steps');
  if(!checklist || !stepsEl) return;

  var steps = [
    {
      id:'rates',
      label:'Set today\'s gold rates',
      done: ratesConfirmed(),
      action: function(){ switchTab('inventory'); setTimeout(function(){ var el=document.getElementById('rate-g24'); if(el){ el.focus(); el.select(); }},300); },
      cta:'Set rates'
    },
    {
      id:'product',
      label:'Add your first product',
      done: (S.products||[]).length > 0,
      action: function(){ switchTab('inventory'); setTimeout(function(){ var el=document.getElementById('add-btn'); if(el) el.click(); },300); },
      cta:'Add product'
    },
    {
      id:'sale',
      label:'Record your first sale',
      done: (S.sales||[]).length > 0,
      action: function(){ switchTab('sales'); },
      cta:'Record sale'
    },
    {
      id:'pin',
      label:'Set your 4-digit PIN', // security review, 20-21 Sep 2026: there is no more default 1234 to change away from
      // FIX (bug sweep, Aug 2026): 'jewelos_pin_changed' was a raw,
      // unscoped localStorage key -- same cross-account-leak class fixed
      // repeatedly elsewhere this session (ssj_cache, PIN keys, audit
      // log, WA rules). A new/different shop on a device where any prior
      // shop had ever changed its PIN would see this onboarding step as
      // already done, hiding a real security nudge. Now scoped per shop
      // via _pinShopSuffix() (see 04-orders-detail.js).
      done: (function(){ try{ return !!localStorage.getItem('jewelos_pin_changed::'+_pinShopSuffix()); }catch(e){ return false; } })(),
      // Also fixed: 'set-pin-input' targeted a text <input> that has
      // never existed -- PIN entry is a full-screen numeric keypad, not a
      // text field. The real entry point is pinShowChange().
      action: function(){ switchTab('settings'); setTimeout(function(){ if(typeof pinShowChange==='function') pinShowChange(); },300); },
      cta:'Change PIN'
    }
  ];

  var allDone = steps.every(function(s){ return s.done; });
  if(allDone){
    checklist.style.display = 'none';
    try{ localStorage.setItem(shopScopedKey('jewelos_onboarding_done'),'1'); }catch(e){}
    return;
  }

  // Only show if not dismissed and shop is new-ish
  var dismissed = false;
  try{ dismissed = !!localStorage.getItem(shopScopedKey('jewelos_onboarding_done')); }catch(e){}
  if(dismissed){ checklist.style.display='none'; return; }

  checklist.style.display = 'block';
  var doneCount = steps.filter(function(s){ return s.done; }).length;

  stepsEl.innerHTML = steps.map(function(s, i){
    return '<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:'+(s.done?'rgba(37,165,75,0.08)':'var(--surface)')+';border-radius:var(--radius);border:0.5px solid '+(s.done?'rgba(37,165,75,0.25)':'var(--border2)')+';">' +
      '<span style="font-size:16px;">'+(s.done?'✅':'⬜')+'</span>' +
      '<span style="flex:1;font-size:13px;color:'+(s.done?'var(--text3)':'var(--ink)')+';font-weight:'+(s.done?'400':'600')+';text-decoration:'+(s.done?'line-through':'none')+';">'+(i+1)+'. '+s.label+'</span>' +
      (!s.done?'<button onclick="(_onboardingSteps['+i+'].action)()" style="font-size:11px;padding:9px 14px;border-radius:20px;border:1px solid var(--gold);background:transparent;color:var(--gold-dark);cursor:pointer;font-weight:600;font-family:inherit;">'+s.cta+'</button>':'')+
    '</div>';
  }).join('');

  // Store steps for onclick access
  window._onboardingSteps = steps;
}

function renderDash(){
  renderOnboarding();
  var now   = new Date();
  var year  = now.getFullYear();
  var month = now.getMonth();

  // Set date header
  var dateEl = document.getElementById('dash-date');
  if(dateEl) dateEl.textContent = now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});

  // Core financials
  var tgv       = stockGV(), tsv = stockSV();
  var todayStr  = dbDayKey(now);
  var monthStr  = year+'-'+String(month+1).padStart(2,'0')+'-01';
  var cfMonth   = calcCashFlow(monthStr, todayStr);
  var totalPendingBal  = S.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
  var activeGirviList  = (S.girvi||[]).filter(function(g){return !g._deleted && g.status!=='closed';});
  var activeGirviTotal = activeGirviList.reduce(function(s,g){return s+girviOutstanding(g);},0);

  // ── RATES STRIP ─────────────────────────────────────────────────
  var ratesEl = document.getElementById('dash-rates-strip');
  if(ratesEl){
    ratesEl.innerHTML =
      '<span style="color:var(--gold-dark);">&#127775; 22K '+fmt(S.rates.g22)+'/g</span>'+
      '<span style="color:var(--ink3);">&#11088; Silver '+fmt(S.rates.sil)+'/g</span>';
  }

  // ── 1. TODAY STRIP (sales / purchase / profit — today only) ──────
  // Local IST day of each record, not a slice of its stored string (QA 30 Sep:
  // sale dates now carry the time of day, so the string's first 10 chars can be
  // the previous UTC day for a bill made after midnight IST).
  var todaySales = S.sales.filter(function(s){ return s.date && dbDayKey(s.date)===todayStr; });
  var todaySalesTotal = todaySales.reduce(function(sum,s){ return sum+calcSaleTotals(s).grand; },0);
  var todayProfitTotal = todaySales.reduce(function(sum,s){ return sum+calcSaleProfit(s).profit; },0);
  var todayPurchases = (S.purchases||[]).filter(function(b){ return !b._deleted && b.date && dbDayKey(b.date)===todayStr; });
  var todayPurchaseTotal = todayPurchases.reduce(function(sum,b){ return sum+(b.totalAmount||0); },0);

  var todayEl = document.getElementById('dash-today-strip');
  if(todayEl){
    todayEl.innerHTML =
      fsnCard("Today's Sales", fmt(todaySalesTotal), todaySales.length+' bill(s)', null, '', 'var(--gold-dark)')+
      fsnCard("Today's Purchase", fmt(todayPurchaseTotal), todayPurchases.length+' bill(s)', null, '', 'var(--warning)')+
      // Colour by sign, like the Net Cash line below — a loss shown in the
      // same green as a profit is the one number on this strip a jeweller
      // cannot afford to misread.
      fsnCard("Today's Profit", fmt(todayProfitTotal), '', null, '', todayProfitTotal>=0?'var(--success)':'var(--danger)');
  }

  // ── 3. BUSINESS SNAPSHOT (the 4 numbers before any decision) ────
  // QA P2-19: "Low Stock Alerts" (categories with <=2 pieces) went red for
  // one ring -- most jewellery is one-off, so a low count is normal. It also
  // read p.category, which products don't have (the field is p.cat). Now a
  // plain count of what is in stock.
  var stockCats = {}, stockPieces = 0;
  S.products.filter(function(p){return p.status!=='sold';}).forEach(function(p){
    stockCats[p.cat||'Other'] = 1; stockPieces += (p.qty==null ? 1 : (parseInt(p.qty,10)||0));
  });
  var stockCatCount = Object.keys(stockCats).length;

  var snapEl2 = document.getElementById('dash-business-snapshot');
  if(snapEl2){
    snapEl2.innerHTML =
      fsnCard('Inventory Value', fmt(tgv+tsv), 'gold + silver stock', null, '', 'var(--gold-dark)')+
      fsnCard('Outstanding Payments', fmt(totalPendingBal), getSalesDueSoon(30).length+' overdue 30d+', null, '', 'var(--danger)')+
      fsnCard('Pending Girvi', fmt(activeGirviTotal), activeGirviList.length+' active loan(s)', null, '', 'var(--warning)')+
      fsnCard('Pieces in Stock', stockPieces, stockCatCount+' categor'+(stockCatCount===1?'y':'ies'), null, '', 'var(--gold-dark)');
  }

  // ── A. TODAY'S ACTIONS ──────────────────────────────────────────
  var actEl = document.getElementById('dash-actions');
  if(actEl){
    var actions = buildTodayActions();
    actEl.innerHTML = actions.map(function(a){
      return '<div class="action-item '+a.type+'" '+(a.tab?'onclick="switchTab(\''+a.tab+'\')"':'')+'>' +
        '<div class="action-icon">'+a.icon+'</div>'+
        '<div class="action-body">'+
          '<div class="action-title">'+a.title+'</div>'+
          '<div class="action-sub">'+a.sub+'</div>'+
          (a.cta?'<div class="action-cta">'+a.cta+'</div>':'')+
        '</div>'+
      '</div>';
    }).join('');
  }

  // ── C. INSIGHTS ────────────────────────────────────────────────
  var insightsEl = document.getElementById('dash-insights');
  if(insightsEl){
    var insights = runInsightEngine();
    if(!insights.length){
      insightsEl.innerHTML='<div style="font-size:13px;color:var(--text3);padding:8px 0;">Add more sales and stock data to unlock business insights.</div>';
    } else {
      insightsEl.innerHTML = insights.map(function(ins){
        var badge = ins.badge
          ? '<span class="insight-badge '+(ins.badge==='up'?'ib-up':ins.badge==='down'?'ib-down':'ib-flat')+'">'+ins.badgeText+'</span>'
          : '';
        return '<div class="insight-card '+ins.type+'">'+
          '<div class="insight-icon">'+ins.icon+'</div>'+
          '<div class="insight-text">'+ins.text+badge+'</div>'+
        '</div>';
      }).join('');
    }
  }

  // ── D. CASH FLOW + CAPITAL ────────────────────────────────────
  var cfEl = document.getElementById('stock-banner');
  if(cfEl){
    cfEl.innerHTML =
      '<div class="sbox sbox-g">'+
        '<div class="sbox-title">\ud83d\udcb0 Cash Flow \u2014 This Month</div>'+
        '<div style="display:grid;gap:6px;margin-top:8px;">'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">Total Collected (all modes)</span><span style="font-weight:700;color:var(--success);">'+fmt(cfMonth.cashIn)+'</span></div>'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">Cash Out (old gold)</span><span style="font-weight:700;color:var(--danger);">'+fmt(cfMonth.cashOut)+'</span></div>'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">Girvi Lent</span><span style="font-weight:700;color:var(--warning);">'+fmt(cfMonth.girviOut)+'</span></div>'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">Girvi Collected</span><span style="font-weight:700;color:var(--success);">'+fmt(cfMonth.girviIn)+'</span></div>'+
          (cfMonth.expenses>0?'<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">Expenses</span><span style="font-weight:700;color:var(--danger);">'+fmt(cfMonth.expenses)+'</span></div>':'')+
          '<div style="border-top:0.5px solid var(--border);padding-top:6px;display:flex;justify-content:space-between;font-size:14px;">'+
            '<span style="font-weight:700;">Net Cash</span>'+
            '<span style="font-weight:800;color:'+(cfMonth.netCash>=0?'var(--success)':'var(--danger)')+';">'+fmt(cfMonth.netCash)+'</span>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="sbox sbox-s">'+
        '<div class="sbox-title">\ud83d\udcca Capital Status</div>'+
        '<div style="display:grid;gap:6px;margin-top:8px;">'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">Stock Value</span><span style="font-weight:700;color:var(--gold-dark);">'+fmt(tgv+tsv)+'</span></div>'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">Credit Given</span><span style="font-weight:700;color:var(--danger);">'+fmt(totalPendingBal)+'</span></div>'+
          '<div style="display:flex;justify-content:space-between;font-size:13px;"><span style="color:var(--text3);">In Girvi</span><span style="font-weight:700;color:var(--warning);">'+fmt(activeGirviTotal)+'</span></div>'+
          '<div style="border-top:0.5px solid var(--border);padding-top:6px;display:flex;justify-content:space-between;font-size:14px;">'+
            '<span style="font-weight:700;">Capital Stuck</span>'+
            '<span style="font-weight:800;color:var(--danger);">'+fmt(totalPendingBal+activeGirviTotal)+'</span>'+
          '</div>'+
        '</div>'+
      '</div>';
  }

  // ── E. GOLD/SILVER BREAKDOWN ──────────────────────────────────
  var gbp={},sbp={};
  S.products.filter(function(p){return p.metal==='gold'&&p.status!=='sold';}).forEach(function(p){gbp[p.purity]=(gbp[p.purity]||0)+p.weight;});
  S.products.filter(function(p){return p.metal==='silver'&&p.status!=='sold';}).forEach(function(p){sbp[p.purity]=(sbp[p.purity]||0)+p.weight;});
  var ge=Object.entries(gbp).sort(function(a,b){return b[1]-a[1];}),gmx=ge.length?ge[0][1]:1;
  document.getElementById('gold-breakdown').innerHTML=ge.length
    ?ge.map(function(e){return '<div class="bar-row"><div class="bar-top"><span>'+e[0]+'</span><span style="font-weight:700">'+fmtW(e[1])+'</span></div><div class="bar-track"><div class="bar-g" style="width:'+Math.round(e[1]/gmx*100)+'%"></div></div></div>';}).join('')
    :'<div class="empty"><span class="empty-icon">&#127775;</span>No gold yet</div>';
  var se=Object.entries(sbp).sort(function(a,b){return b[1]-a[1];}),smx=se.length?se[0][1]:1;
  document.getElementById('silver-breakdown').innerHTML=se.length
    ?se.map(function(e){return '<div class="bar-row"><div class="bar-top"><span>'+e[0]+'</span><span style="font-weight:700">'+fmtW(e[1])+'</span></div><div class="bar-track"><div class="bar-s" style="width:'+Math.round(e[1]/smx*100)+'%"></div></div></div>';}).join('')
    :'<div class="empty"><span class="empty-icon">&#11088;</span>No silver yet</div>';

  // ── F. RECENT SALES WITH PROFIT ───────────────────────────────
  var rec=S.sales.slice().reverse().slice(0,5);
  document.getElementById('recent-sales').innerHTML=rec.length
    ?rec.map(function(s){
      var t=calcSaleTotals(s),p=calcSaleProfit(s);
      var wt=(s.items||[]).reduce(function(a,i){return a+i.weight*(i.qty||1);},0);
      return '<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer;" onclick="showSaleInvoice(\''+jsAttrEsc(s.id)+'\')">'+
        '<div style="display:flex;justify-content:space-between;">'+
          '<div><div style="font-weight:600;">'+escHtml(s.customer)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);">'+(s.items||[]).map(function(i){return escHtml(i.name);}).join(', ')+' &bull; '+fmtW(wt)+'</div></div>'+
          '<div style="text-align:right;">'+
            '<div style="font-weight:700;color:var(--gold-dark);">'+fmt(t.grand)+'</div>'+
            '<div style="font-size:11px;color:var(--success);">\u2191 '+fmt(Math.round(p.profit))+'</div>'+
            (t.bal>0?'<div style="font-size:11px;color:var(--danger);">Due: '+fmt(t.bal)+'</div>':'')+
          '</div>'+
        '</div></div>';
    }).join('')
    :'<div class="empty"><span class="empty-icon">&#128717;</span>No sales yet</div>';

  // ── G. PENDING WITH AGING ─────────────────────────────────────
  var custBal={};
  S.sales.forEach(function(s){
    var k=(s.customer||'Walk-in')+(s.phone?'_'+s.phone:'');
    if(!custBal[k]) custBal[k]={name:s.customer||'Walk-in',phone:s.phone||'',bal:0,oldestDays:0};
    var t=calcSaleTotals(s); custBal[k].bal+=t.bal;
    if(t.bal>0) custBal[k].oldestDays=Math.max(custBal[k].oldestDays,getAgingDays(s));
  });
  var pending=Object.values(custBal).filter(function(x){return x.bal>0;}).sort(function(a,b){return b.bal-a.bal;});
  var pbEl=document.getElementById('dash-pending-bal');
  if(pbEl){
    if(pending.length){
      pbEl.innerHTML=
        '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);margin-bottom:4px;">'+
          '<span style="font-size:12px;color:var(--text3);">'+pending.length+' customers</span>'+
          '<span style="font-weight:700;color:var(--danger);">'+fmt(totalPendingBal)+'</span>'+
        '</div>'+
        pending.slice(0,5).map(function(x){
          var ac=x.oldestDays>60?'var(--danger)':x.oldestDays>30?'var(--warning)':'var(--text3)';
          return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:0.5px solid var(--border);font-size:13px;">'+
            '<div><span style="font-weight:600;">'+escHtml(x.name)+'</span>'+(x.phone?'<div style="font-size:11px;color:var(--text3);">'+escHtml(x.phone)+'</div>':'')+'</div>'+
            '<div style="text-align:right;"><div style="font-weight:700;color:var(--danger);">'+fmt(x.bal)+'</div>'+
            '<div style="font-size:10px;color:'+ac+';">'+x.oldestDays+'d old</div></div></div>';
        }).join('')+
        (pending.length>5?'<div style="font-size:12px;color:var(--text3);padding:4px 0;">+'+(pending.length-5)+' more</div>':'');
    } else {
      pbEl.innerHTML='<div class="empty"><span class="empty-icon">&#9989;</span>All balances cleared</div>';
    }
  }

  // ── H. ORDERS DUE + CATEGORIES ───────────────────────────────
  var odEl=document.getElementById('dash-orders-due');
  if(odEl){
    var upcoming=(S.orders||[]).filter(function(o){return o.status!=='delivered'&&o.status!=='cancelled';})
      .sort(function(a,b){return new Date(a.delivery)-new Date(b.delivery);});
    if(upcoming.length){
      odEl.innerHTML=upcoming.slice(0,4).map(function(o){
        var risk=orderDelayRisk(o);
        var profEst=orderProfitEst(o);
        return '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;">'+
          '<div><div style="font-weight:600;">'+escHtml(o.customer)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);">'+escHtml(o.items&&o.items.length?o.items[0].desc:(o.desc||''))+'</div>'+
          (profEst>0?'<div style="font-size:10px;color:var(--success);">Est profit: '+fmt(Math.round(profEst))+'</div>':'')+
          '</div>'+
          '<div style="text-align:right;"><div style="font-weight:700;color:'+risk.color+';">'+risk.label+'</div>'+
          '<div style="font-size:11px;color:var(--text3);">'+fmtDate(o.delivery)+'</div></div></div>';
      }).join('')+
      (upcoming.length>4?'<div style="font-size:12px;color:var(--text3);padding:5px 0;">+'+(upcoming.length-4)+' more</div>':'');
    } else {
      odEl.innerHTML='<div class="empty"><span class="empty-icon">&#128221;</span>No active orders</div>';
    }
  }

  var tcEl=document.getElementById('dash-top-cats');
  if(tcEl){
    var catPerf=calcCategoryPerf();
    if(catPerf.length){
      var maxRev=catPerf[0].rev||1;
      tcEl.innerHTML=catPerf.slice(0,5).map(function(c){
        var trendHtml = c.prevRev>0
          ? '<span class="'+(c.trend>=0?'trend-up':'trend-down')+'" style="font-size:10px;">'+(c.trend>=0?'▲':'▼')+Math.abs(Math.round(c.trend))+'%</span>'
          : '';
        return '<div style="margin-bottom:9px;">'+
          '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">'+
            '<span style="font-weight:600;">'+c.cat+'</span>'+
            '<span style="color:var(--text3);">'+fmt(Math.round(c.rev))+' '+trendHtml+'</span>'+
          '</div>'+
          '<div style="background:var(--bg3);border-radius:4px;height:5px;overflow:hidden;">'+
            '<div style="height:100%;width:'+Math.round(c.rev/maxRev*100)+'%;background:var(--gold);border-radius:4px;"></div>'+
          '</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:2px;">'+c.units+' sold &bull; profit: '+fmt(Math.round(c.profit))+'</div>'+
        '</div>';
      }).join('');
    } else {
      tcEl.innerHTML='<div class="empty"><span class="empty-icon">&#128200;</span>No sales yet</div>';
    }
  }

  // Girvi dash card (from girvi module) — lives inside "More details" now;
  // the headline Pending Girvi number already sits in the Business Snapshot.
  var girviSlot=document.getElementById('dash-more-girvi');
  var girvi=(S.girvi||[]).filter(function(g){return !g._deleted;});
  if(!girviSlot) return;
  if(!girvi.length){ girviSlot.innerHTML=''; return; }
  var gActive=girvi.filter(function(g){return g.status==='active';}).length;
  var gOverdue=girvi.filter(function(g){return g.status==='overdue'||g.status==='atrisk';}).length;
  var gDeflt=girvi.filter(function(g){return g.status==='defaulted';}).length;
  var gTotalOut=girvi.filter(function(g){return g.status!=='closed';}).reduce(function(s,g){return s+girviOutstanding(g);},0);
  girviSlot.innerHTML='<div class="card" id="girvi-dash-card" style="cursor:pointer;" onclick="switchTab(\'girvi\')">'+
    '<div class="card-title">\ud83e\udea9 Girvi Portfolio <span style="font-size:11px;color:var(--text3);font-weight:400;">(tap to manage)</span></div>'+
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">'+
    '<div style="text-align:center;background:var(--card2);border-radius:10px;padding:9px 4px;"><div style="font-size:18px;font-weight:800;">'+gActive+'</div><div style="font-size:10px;color:var(--text3);">Active</div></div>'+
    '<div style="text-align:center;background:var(--card2);border-radius:10px;padding:9px 4px;"><div style="font-size:18px;font-weight:800;color:var(--warning);">'+gOverdue+'</div><div style="font-size:10px;color:var(--text3);">Overdue</div></div>'+
    '<div style="text-align:center;background:var(--card2);border-radius:10px;padding:9px 4px;"><div style="font-size:18px;font-weight:800;color:var(--danger);">'+gDeflt+'</div><div style="font-size:10px;color:var(--text3);">Defaulted</div></div>'+
    '<div style="text-align:center;background:var(--card2);border-radius:10px;padding:9px 4px;"><div style="font-size:15px;font-weight:800;color:var(--gold);">\u20b9'+Math.round(gTotalOut/1000).toLocaleString('en-IN')+'K</div><div style="font-size:10px;color:var(--text3);">Outstanding</div></div>'+
    '</div></div>';
}

// ── HELPER: Financial Snapshot Card ──────────────────────────────────
function fsnCard(label, val, sub, trend, extra, valColor){
  var trendHtml = '';
  if(trend !== null && trend !== undefined){
    var tClass = trend>=5?'trend-up':trend<=-5?'trend-down':'trend-flat';
    var tIcon  = trend>=5?'▲':trend<=-5?'▼':'—';
    trendHtml  = '<div class="fsn-trend '+tClass+'">'+tIcon+' '+Math.abs(Math.round(trend))+'% vs last month</div>';
  }
  return '<div class="fin-snap-card">'+
    '<div class="fsn-label">'+label+'</div>'+
    '<div class="fsn-val" style="color:'+valColor+';">'+val+'</div>'+
    '<div class="fsn-sub">'+sub+'</div>'+
    trendHtml+
    (extra||'')+
  '</div>';
}

// ── UPGRADE renderReports WITH SMART SECTIONS ─────────────────────────
// Patch: add Category Intelligence and Week-over-Week sections
(function patchReports(){
  var _orig = renderReports;
  renderReports = function(){
    _orig();
    renderReportsIntelligence();
  };
}());

function renderReportsIntelligence(){
  var panel = document.getElementById('panel-reports');
  if(!panel) return;

  // Remove old intel cards
  ['rep-intel-cat','rep-intel-wow','rep-intel-metal','rep-intel-catbar'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.remove();
  });

  var monthSales = filterSalesByMonth(repYear, repMonth);

  // ── 1. METAL-WISE SALES BREAKDOWN (visual bars) ───────────────────
  var metalCard = document.createElement('div');
  metalCard.id = 'rep-intel-metal'; metalCard.className = 'card';
  var metalData = {};
  monthSales.forEach(function(s){
    s.items.forEach(function(i){
      var m = (i.metal||'gold').toLowerCase();
      var rev = getItemRate(i) * (parseFloat(i.weight)||0) * (i.qty||1) + itemMakingAmount(i) + (i.diamond||0);
      if(!metalData[m]) metalData[m] = {rev:0, wt:0, units:0};
      metalData[m].rev += rev;
      metalData[m].wt  += (parseFloat(i.weight)||0) * (i.qty||1);
      metalData[m].units += (i.qty||1);
    });
  });
  var metalTotalRev = Object.values(metalData).reduce(function(s,m){return s+m.rev;},0) || 1;
  var metalColors = {gold:'var(--gold)', silver:'#9eafc2', platinum:'#8b8b8b', other:'#a78bfa'};
  var metalEmoji  = {gold:'\uD83D\uDFE1', silver:'\u26AA', platinum:'\u26AA', other:'\u26AB'};
  var metalRows = Object.entries(metalData).sort(function(a,b){return b[1].rev-a[1].rev;}).map(function(e){
    var m=e[0], d=e[1];
    var pct = Math.round(d.rev/metalTotalRev*100);
    var col = metalColors[m] || 'var(--gold)';
    return '<div style="margin-bottom:14px;">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:5px;">'+
        '<span style="font-size:13px;font-weight:600;text-transform:capitalize;">'+(metalEmoji[m]||'\u26AB')+' '+m+'</span>'+
        '<span style="font-size:12px;color:var(--text2);">'+fmt(Math.round(d.rev))+' &bull; '+fmtW(d.wt)+' &bull; '+d.units+' pcs</span>'+
      '</div>'+
      '<div style="background:var(--bg3);border-radius:100px;height:10px;overflow:hidden;">'+
        '<div style="width:'+pct+'%;height:100%;background:'+col+';border-radius:100px;transition:width .5s;"></div>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--text3);margin-top:3px;">'+pct+'% of revenue</div>'+
    '</div>';
  }).join('');
  metalCard.innerHTML = '<div class="card-title">\u2694\uFE0F Metal-wise Revenue</div>'+
    (metalRows || '<div class="empty">No sales this month</div>');
  panel.appendChild(metalCard);

  // ── 2. CATEGORY-WISE VISUAL BAR CHART ────────────────────────────
  var catBarCard = document.createElement('div');
  catBarCard.id = 'rep-intel-catbar'; catBarCard.className = 'card';
  var catData = {};
  monthSales.forEach(function(s){
    s.items.forEach(function(i){
      var cat = saleItemCat(i); // same rule as the other category tables
      var rev = getItemRate(i) * (parseFloat(i.weight)||0) * (i.qty||1) + itemMakingAmount(i) + (i.diamond||0);
      if(!catData[cat]) catData[cat] = {rev:0, units:0};
      catData[cat].rev   += rev;
      catData[cat].units += (i.qty||1);
    });
  });
  var catEntries = Object.entries(catData).sort(function(a,b){return b[1].rev-a[1].rev;}).slice(0,8);
  var catMax = catEntries.length ? catEntries[0][1].rev : 1;
  var catPalette = ['var(--gold)','#a78bfa','#34d399','#60a5fa','#f87171','#fbbf24','#38bdf8','#fb7185'];
  var catRows = catEntries.map(function(e, idx){
    var cat=e[0], d=e[1];
    var barW = Math.max(4, Math.round(d.rev/catMax*100));
    var col  = catPalette[idx % catPalette.length];
    return '<div style="margin-bottom:11px;">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:4px;">'+
        '<span style="font-size:12px;font-weight:600;">'+cat+'</span>'+
        '<span style="font-size:12px;color:var(--text2);">'+fmt(Math.round(d.rev))+' &bull; '+d.units+' pcs</span>'+
      '</div>'+
      '<div style="background:var(--bg3);border-radius:100px;height:8px;overflow:hidden;">'+
        '<div style="width:'+barW+'%;height:100%;background:'+col+';border-radius:100px;transition:width .5s;"></div>'+
      '</div>'+
    '</div>';
  }).join('');
  catBarCard.innerHTML = '<div class="card-title">\uD83C\uDFF7\uFE0F Category-wise Revenue</div>'+
    (catRows || '<div class="empty">No sales this month</div>');
  panel.appendChild(catBarCard);

  // ── 3. WEEK-OVER-WEEK ─────────────────────────────────────────────
  var wowCard = document.createElement('div');
  wowCard.id='rep-intel-wow'; wowCard.className='card';
  var weekLabels=['6w ago','5w ago','4w ago','3w ago','2w ago','Last wk','This wk'];
  var weekRevs=[];
  for(var i=6;i>=0;i--) weekRevs.push(calcWeekRevenue(i));
  var weekProfs=[];
  for(var j=6;j>=0;j--) weekProfs.push(calcWeekProfit(j));
  var maxWR=Math.max.apply(null,weekRevs)||1;
  wowCard.innerHTML='<div class="card-title">\uD83D\uDCC5 Week-over-Week Performance</div>'+
    '<div style="overflow-x:auto;"><table style="width:100%;font-size:12px;border-collapse:collapse;">'+
    '<thead><tr>'+
    weekLabels.map(function(l,i){return '<th style="padding:6px 4px;color:var(--text3);font-weight:600;text-align:right;'+(i===6?'color:var(--gold-dark);':'')+'">'+l+'</th>';}).join('')+
    '</tr></thead><tbody>'+
    '<tr>'+weekRevs.map(function(v,i){return '<td style="padding:6px 4px;text-align:right;font-weight:'+(i===6?'700':'400')+';color:'+(i===6?'var(--gold-dark)':'var(--text2)')+';">'+fmt(v)+'</td>';}).join('')+'</tr>'+
    '<tr>'+weekProfs.map(function(v,i){return '<td style="padding:4px;text-align:right;font-size:11px;color:'+(v>=0?'var(--success)':'var(--danger)')+';font-weight:'+(i===6?'700':'400')+';">'+fmt(Math.round(v))+'</td>';}).join('')+'</tr>'+
    '</tbody></table></div>'+
    '<div style="display:flex;align-items:flex-end;gap:3px;height:50px;margin-top:10px;padding:0 4px;">'+
    weekRevs.map(function(v,i){
      var h=Math.max(4,Math.round(v/maxWR*50));
      return '<div style="flex:1;height:'+h+'px;background:'+(i===6?'var(--gold)':'var(--bg3)')+';border-radius:3px 3px 0 0;transition:height .3s;"></div>';
    }).join('')+'</div>'+
    '<div style="display:flex;gap:3px;padding:3px 4px;">'+weekLabels.map(function(l,i){return '<div style="flex:1;text-align:center;font-size:9px;color:'+(i===6?'var(--gold-dark)':'var(--text3)')+';">'+l.replace(' ago','')+'</div>';}).join('')+'</div>';
  panel.appendChild(wowCard);

  // ── 4. CATEGORY INTELLIGENCE TABLE ───────────────────────────────
  var catCard = document.createElement('div');
  catCard.id='rep-intel-cat'; catCard.className='card';
  var catPerf = calcCategoryPerf(repYear, repMonth); // QA 3 Oct M8: match the month this page is actually showing
  catCard.innerHTML='<div class="card-title">\uD83C\uDFF7\uFE0F Category Intelligence — This Month</div>'+
    (catPerf.length?
      '<div class="tbl-wrap"><table><thead><tr><th>Category</th><th>Revenue</th><th>Units</th><th>Profit</th><th>Trend</th></tr></thead><tbody>'+
      catPerf.map(function(c){
        var tIcon = c.prevRev>0?(c.trend>=0?'\u25B2 '+Math.round(c.trend)+'%':'\u25BC '+Math.abs(Math.round(c.trend))+'%'):'—';
        var tColor= c.prevRev>0?(c.trend>=0?'var(--success)':'var(--danger)'):'var(--text3)';
        return '<tr>'+
          '<td style="font-weight:600;">'+c.cat+'</td>'+
          '<td style="font-weight:700;color:var(--gold-dark);">'+fmt(Math.round(c.rev))+'</td>'+
          '<td>'+c.units+'</td>'+
          '<td style="color:var(--success);">'+fmt(Math.round(c.profit))+'</td>'+
          '<td style="color:'+tColor+';font-weight:600;font-size:11px;">'+tIcon+'</td>'+
        '</tr>';
      }).join('')+'</tbody></table></div>'
    :'<div class="empty">No sales data this month</div>');
  panel.appendChild(catCard);
}
// ── UPGRADE renderCustomers WITH TAGS + FINANCIAL PROFILE ──────────────
(function patchCustomerRender(){
  // After renderCustomers builds each card, inject intelligence tags
  // We patch buildCustCard by overriding the div.innerHTML construction
  // Instead we fully replace the forEach loop behaviour via event delegation
  // The cleanest approach: patch the output after render
  var _origRenderCust = renderCustomers;
  renderCustomers = function(){
    _origRenderCust();
    // Inject tags into existing customer cards
    var listEl = document.getElementById('cust-list');
    if(!listEl) return;
    // Tags are already built in renderCustomers via calcCustomerFinancials
    // We just need the tag icons — add a post-processing step
    var cm = buildCustMap();
    Object.values(cm).forEach(function(c){
      var tags = getCustomerTags(c.name, c.phone, c.sales);
      if(!tags.length) return;
      var tagHtml = tags.map(renderCustomerTag).join('');
      // Find the card by text content (best we can do without IDs)
      // Tags are already rendered via the new renderCustomers — this is a no-op safeguard
    });
  };
}());

// ── UPGRADE renderOrders WITH PIPELINE VIEW ───────────────────────────
(function patchOrdersPipeline(){
  var _origOrders = renderOrders;
  renderOrders = function(){
    _origOrders();
    renderOrdersPipeline();
  };
}());

function renderOrdersPipeline(){
  var panel = document.getElementById('panel-orders');
  if(!panel) return;
  var existing = document.getElementById('orders-pipeline');
  if(existing) existing.remove();

  var orders = S.orders||[];
  var stages = ['new','design','making','polishing','quality','ready','delivered'];
  var stageLabels = {new:'New',design:'Design',making:'Making',polishing:'Polish',quality:'QC',ready:'Ready',delivered:'Done'};
  var counts = {};
  stages.forEach(function(s){counts[s]=0;});
  orders.forEach(function(o){if(o.status&&counts[o.status]!==undefined)counts[o.status]++;});

  var pipeDiv = document.createElement('div');
  pipeDiv.id = 'orders-pipeline';
  pipeDiv.className = 'card';
  pipeDiv.style.marginBottom = '.9rem';
  pipeDiv.innerHTML='<div class="card-title">🏭 Order Pipeline</div>'+
    '<div class="pipeline">'+
    stages.map(function(s){
      return '<div class="pipe-stage" onclick="filterOrdersByStatus(\''+s+'\')" style="'+(counts[s]>0?'':'opacity:0.4;')+'">'+
        '<span class="pipe-count">'+counts[s]+'</span>'+
        stageLabels[s]+
      '</div>';
    }).join('<div style="font-size:16px;color:var(--text3);padding-top:8px;">\u203a</div>')+
    '</div>'+
    // Profit estimate for all active orders
    (function(){
      var active=orders.filter(function(o){return o.status!=='delivered'&&o.status!=='cancelled';});
      var totalProfit=active.reduce(function(s,o){return s+orderProfitEst(o);},0);
      // via ordAdvance so reversals subtract here too, matching the order detail
      var totalBal=active.reduce(function(s,o){return s+Math.max(0,(o.quote||0)-ordAdvance(o));},0);
      return '<div style="display:flex;gap:16px;font-size:12px;padding-top:6px;border-top:0.5px solid var(--border);flex-wrap:wrap;">'+
        '<span>Active: <strong>'+active.length+'</strong></span>'+
        '<span>Est. profit: <strong style="color:var(--success);">'+fmt(Math.round(totalProfit))+'</strong></span>'+
        '<span>Balance due: <strong style="color:var(--danger);">'+fmt(Math.round(totalBal))+'</strong></span>'+
      '</div>';
    }());

  // Insert before the first child of orders panel
  var ordMetrics = document.getElementById('ord-metrics');
  if(ordMetrics && ordMetrics.parentNode===panel){
    // Was ordMetrics.parentNode.previousSibling — but the line above has just
    // established that parentNode IS panel, so that asked panel to insert
    // before its own sibling, which is not one of its children. insertBefore
    // throws on that, and it threw every time the orders screen redrew: the
    // list itself had already been drawn, but everything after this point was
    // skipped, including the "order saved" confirmation.
    panel.insertBefore(pipeDiv, ordMetrics.previousSibling||ordMetrics);
  } else {
    panel.insertBefore(pipeDiv, panel.firstChild);
  }
}

function filterOrdersByStatus(status){
  var filt = document.getElementById('ord-filter');
  if(filt){ filt.value=status; renderOrders(); }
}

// ══ END INTELLIGENCE LAYER v10 ══


// ══════════════════════════════════════════════════════════════════════
// ─── GROWTH LAYER v11 ────────────────────────────────────────────────
// WhatsApp Reminders, CLV, Demo Mode, Referral, PDF Export,
// Daily Digest, Onboarding Wizard, Advanced Analytics, Plan Gates
// ══════════════════════════════════════════════════════════════════════

// ── SETTINGS TABS ────────────────────────────────────────────────────
function showSettingsTab(tab){
  var tabs = ['profile','automation','analytics','team','plan','audit','data','account'];
  tabs.forEach(function(t){
    var el = document.getElementById('stab-'+t);
    if(el) el.style.display = t===tab ? '' : 'none';
  });
  // FIX: previously matched the "active" highlight to a button by its
  // position in this array vs. its position in the real DOM — but this
  // array's order didn't actually match the HTML (data/account/audit were
  // rotated relative to the real audit/data/account button order), so
  // clicking one settings tab correctly showed that tab's panel but
  // visually highlighted a DIFFERENT button as active. Buttons now carry
  // their own data-tab attribute (see index.html), so this matches by
  // name directly and can't drift out of sync with DOM order again.
  document.querySelectorAll('.settings-tab').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.tab===tab);
  });
  // Lazy-render analytics when tab opens
  if(tab==='analytics') renderSettingsAnalytics();
  if(tab==='automation') renderSettingsAutomation();
}

// Patch renderSettings to use tabs
(function(){
  var _orig = renderSettings;
  renderSettings = function(){
    if(!SAAS.shop||!SAAS.user) return;
    // _orig was captured and then never called, which silently killed every
    // block below this function's own re-implementation: the Cloud Setup
    // badge (left reading "Checking..." forever), the digest email field and
    // the Razorpay key field (both shown empty however they were saved).
    // Calling it first restores those; the re-implementation below still
    // wins for the blocks both of them render, exactly as before.
    _orig();
    // Fill shop fields
    var fields={
      'set-shopname':SAAS.shop.name||'',
      'set-city':SAAS.shop.city||'',
      'set-phone':SAAS.shop.phone||'',
      'set-gstin':SAAS.shop.gstin||''
    };
    Object.entries(fields).forEach(function(e){
      var el=document.getElementById(e[0]); if(el) el.value=e[1];
    });
    // Staff
    var staffEl=document.getElementById('set-staff-list');
    if(staffEl){
      var users=saasGetUsers().filter(function(u){return u.shopId===SAAS.shop.id;});
      staffEl.innerHTML=users.length
        ?users.map(function(u){
          return '<div class="log-row"><div><b>'+escHtml(u.name)+'</b><div style="font-size:11px;color:var(--text3);">'+escHtml(u.email)+' &bull; '+escHtml(u.role)+'</div></div>'+
            '<div>'+(u.id!==SAAS.user.id&&isOwner()?'<button onclick="removeStaff(\''+u.id+'\')" style="font-size:11px;color:var(--danger);background:none;border:none;cursor:pointer;">Remove</button>':'<span style="font-size:11px;color:var(--text3);">You</span>')+'</div></div>';
        }).join('')
        :'<div style="font-size:12px;color:var(--text3);">No team members yet.</div>';
    }
    // Activity log
    var logEl=document.getElementById('set-activity-log');
    if(logEl){
      var log=(S.activityLog||[]).slice(0,15);
      logEl.innerHTML=log.length
        ?log.map(function(l){
          return '<div class="log-row"><div><span style="font-size:11px;color:var(--text3);">'+escHtml(l.type)+'</span><br><span style="font-size:12px;">'+escHtml(l.note)+'</span></div>'+
            '<div style="font-size:10px;color:var(--text3);text-align:right;min-width:70px;">'+fmtDate(l.ts)+'<br>'+escHtml(l.user)+'</div></div>';
        }).join('')
        :'<div style="font-size:12px;color:var(--text3);">No activity yet.</div>';
    }
    // Last backup
    var lb=document.getElementById('set-last-backup');
    var ls=localStorage.getItem('ssj_last_save');
    if(lb&&ls) lb.textContent='Last sync: '+new Date(parseInt(ls)).toLocaleString('en-IN');
    // Account
    var acc=document.getElementById('set-account-info');
    if(acc) acc.innerHTML='<b>'+escHtml(SAAS.user.name)+'</b> &bull; '+escHtml(SAAS.user.email)+' &bull; <span class="role-badge '+(SAAS.user.role==='owner'?'':'staff')+'">'+escHtml(SAAS.user.role)+'</span>'+subAccountLineHtml();
  };
}());

// ── DEMO MODE ─────────────────────────────────────────────────────────
var DEMO_ACTIVE = false;

function loadDemoData(){
  safeConfirm('Load sample data?','This will ADD demo records to your current data for you to explore.',function(){
  DEMO_ACTIVE = true;
  document.getElementById('demo-banner').classList.add('visible');
  document.body.classList.add('demo-mode');

  var today = dbDayKey(new Date());
  var lastMonth = dbDayKey(new Date(Date.now()-30*86400000));
  var twoMonth  = dbDayKey(new Date(Date.now()-60*86400000));

  // Demo products
  var demoProducts = [
    {id:'demo-p1',_seq:9001,name:'22K Gold Chain',cat:'Chains',metal:'gold',purity:'22K',weight:12.5,netWeight:11.8,costRate:6800,mcRate:120,status:'available',sku:'GLD-001',qty:1,alert:1,making:0,diamond:0,stockQty:1,createdAt:twoMonth},
    {id:'demo-p2',_seq:9002,name:'Diamond Ring',cat:'Rings',metal:'gold',purity:'18K',weight:4.2,netWeight:3.8,costRate:5500,mcRate:200,status:'available',sku:'GLD-002',qty:1,alert:1,making:0,diamond:8500,stockQty:1,createdAt:twoMonth},
    {id:'demo-p3',_seq:9003,name:'Silver Anklet',cat:'Anklets',metal:'silver',purity:'925 Silver',weight:18.0,netWeight:17.2,costRate:80,mcRate:15,status:'available',sku:'SLV-001',qty:1,alert:1,making:0,diamond:0,stockQty:1,createdAt:lastMonth},
    {id:'demo-p4',_seq:9004,name:'22K Bangle',cat:'Bangles',metal:'gold',purity:'22K',weight:22.0,netWeight:21.0,costRate:6850,mcRate:90,status:'sold',sku:'GLD-003',qty:0,alert:1,making:0,diamond:0,stockQty:0,createdAt:twoMonth},
    {id:'demo-p5',_seq:9005,name:'Gold Earrings',cat:'Earrings',metal:'gold',purity:'22K',weight:6.8,netWeight:6.2,costRate:6900,mcRate:150,status:'available',sku:'GLD-004',qty:1,alert:1,making:0,diamond:0,stockQty:1,createdAt:lastMonth},
  ];

  // Demo people are deliberately unmistakable: "Demo Customer N", 00000000NN
  // phones, "Sample" addresses/notes/IDs. Do not make these realistic again —
  // they used to be plausible Indian names with plausible mobile numbers and
  // AADHAAR/PAN-shaped id proofs, and nothing on screen said they were
  // invented, so a jeweller could take a demo shop for a live one. Numbers
  // stay distinct because the phone is what links a customer's records
  // together; one shared number would collapse all six into a single account.
  // Demo sales
  var demoSales = [
    {id:'demo-s1',invNo:'INV-D001',date:today,customer:'Demo Customer 1',phone:'0000000001',
     items:[{pid:'demo-p4',name:'22K Bangle',metal:'gold',purity:'22K',weight:22,qty:1,making:1980,stoneCharges:0,lockedRate:7200,rate:7200,isCustom:false}],
     payStatus:'partial',advance:120000,gst:3,discount:0,payMode:'cash',
     lockedRates:{g22:7200,g24:7800,g18:5900,sil:95}},
    {id:'demo-s2',invNo:'INV-D002',date:lastMonth,customer:'Demo Customer 2',phone:'0000000002',
     items:[{pid:'demo-p1',name:'22K Gold Chain',metal:'gold',purity:'22K',weight:12.5,qty:1,making:1500,stoneCharges:0,lockedRate:7100,rate:7100,isCustom:false}],
     payStatus:'full',advance:91250,gst:3,discount:2000,payMode:'upi',
     lockedRates:{g22:7100,g24:7700,g18:5800,sil:92}},
    {id:'demo-s3',invNo:'INV-D003',date:lastMonth,customer:'Demo Customer 3',phone:'0000000003',
     items:[{pid:'',name:'Custom Necklace',metal:'gold',purity:'22K',weight:35,qty:1,making:4200,stoneCharges:2500,lockedRate:7150,rate:7150,isCustom:true}],
     payStatus:'partial',advance:200000,gst:3,discount:0,payMode:'bank',
     lockedRates:{g22:7150,g24:7750,g18:5850,sil:93}},
  ];

  // Demo girvi
  var demoGirvi = [
    {id:'demo-g1',_seq:9001,grvNo:'GRV-D001',createdAt:twoMonth,customer:'Demo Customer 4',phone:'0000000004',
     risk:'medium',address:'Sample address',
     item:{metal:'gold',purity:'22K',weight:28,qty:1,desc:'22K Gold Bangles (2 pieces)'},
     principal:150000,interestRate:2,rateType:'monthly',compound:false,startDate:twoMonth,
     duration:3,notes:'Sample note',status:'overdue',payments:[
       {id:'demo-pay1',amount:15000,mode:'cash',date:lastMonth,ref:'Sample payment',ts:lastMonth+'T10:00:00Z'}
     ],
     ledger:[{type:'created',note:'Girvi created \u20b9150000',ts:twoMonth+'T09:00:00Z'}]},
    {id:'demo-g2',_seq:9002,grvNo:'GRV-D002',createdAt:lastMonth,customer:'Demo Customer 5',phone:'0000000005',
     risk:'low',address:'Sample address',
     item:{metal:'gold',purity:'22K',weight:15,qty:1,desc:'22K Gold Chain'},
     principal:80000,interestRate:2,rateType:'monthly',compound:false,startDate:lastMonth,
     duration:6,notes:'',status:'active',payments:[],
     ledger:[{type:'created',note:'Girvi created \u20b980000',ts:lastMonth+'T11:00:00Z'}]},
  ];

  // Demo orders
  var demoOrders = [
    {id:'demo-o1',ordNo:'ORD-D001',createdAt:lastMonth,customer:'Demo Customer 6',phone:'0000000006',
     status:'progress',priority:'normal',delivery:dbDayKey(new Date(Date.now()+5*86400000)),
     items:[{desc:'Custom 22K Necklace',cat:'Necklaces',metal:'gold',purity:'22K',estWt:18,qty:1,making:250,makingType:'per_gram',note:'Sample note'}],
     quote:145000,advance:50000,notes:'Sample note',
     ledger:[{type:'advance',amount:50000,mode:'cash',ref:'',note:'Initial advance',date:lastMonth}]},
  ];

  // Push demo data
  demoProducts.forEach(function(p){ if(!S.products.find(function(x){return x.id===p.id;})) S.products.push(p); });
  demoSales.forEach(function(s){ if(!S.sales.find(function(x){return x.id===s.id;})) S.sales.push(s); });
  demoGirvi.forEach(function(g){ if(!S.girvi.find(function(x){return x.id===g.id;})) S.girvi.push(g); });
  demoOrders.forEach(function(o){ if(!S.orders.find(function(x){return x.id===o.id;})) S.orders.push(o); });

  normaliseData();
  saveCache();
  renderDash();
  toast('\u2705 Demo data loaded! Explore the dashboard, reports, and girvi tab.');
  switchTab('dashboard');
  }); // end safeConfirm
  return;
}

function clearDemoData(){
  safeConfirm('Clear ALL data?','This cannot be undone. All products, sales, orders and girvi records will be permanently deleted.',function(){
    S.products=[]; S.sales=[]; S.orders=[]; S.girvi=[];
    S.stockMovements=[]; // F2: now synced -- demo stock history must not reach other phones
    S.nextId=1; S.nextSaleId=1; S.nextInvNo=1; S.nextOrdId=1; S.nextGirviId=1;
    DEMO_ACTIVE=false;
    document.getElementById('demo-banner').classList.remove('visible');
    document.body.classList.remove('demo-mode');
    saveToCloud(function(){ renderDash(); toast('All data cleared.'); });
  },true);
  return;
}

function exitDemoMode(){
  DEMO_ACTIVE=false;
  document.getElementById('demo-banner').classList.remove('visible');
  document.body.classList.remove('demo-mode');
  // Prompt signup
  showAuthTab('signup');
  document.getElementById('saas-auth-screen').style.display='flex';
}

// ── WHATSAPP AUTOMATION RULES ─────────────────────────────────────────
// Rules stored in localStorage — each has an enabled toggle
// FIX: previously templates were 6 hardcoded JS functions the owner
// couldn't touch at all -- only enable/disable was possible. Now each
// rule carries an editable messageTemplate string with {variable}
// placeholders, filled in by waFillTemplate() below. The default text
// for each rule is the EXACT previous hardcoded wording, converted to a
// template -- so nothing changes for anyone who never edits a template.
var WA_RULE_DEFAULTS = [
  {id:'girvi_overdue',  enabled:true,  name:'Girvi Overdue',         icon:'\ud83d\udd34', trigger:'Girvi loan past due date',        delay:0,
    messageTemplate:'\ud83e\udea9 *{shop_name}*\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nDear *{customer_name}*,\n\nYour girvi loan is *overdue*.\n\nGirvi: {girvi_number}\nItem: {item_desc}\nDuration: {duration_months} months\n*Outstanding: \u20b9{amount}*\n(includes penalty for late payment)\n\nPlease visit the shop at your earliest convenience to avoid further penalties.\n\nThank you \ud83d\ude4f\n_{shop_name}_'},
  {id:'girvi_due7',     enabled:true,  name:'Girvi Due in 7 Days',   icon:'\u23f0', trigger:'Girvi due within 7 days',          delay:0,
    messageTemplate:'\ud83e\udea9 *{shop_name} \u2014 Girvi Reminder*\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nDear *{customer_name}*,\n\nYour girvi loan *{girvi_number}* is due on *{due_date}*.\n\nItem: {item_desc}\n*Outstanding: \u20b9{amount}*\n\nPlease visit before the due date to avoid penalty charges.\n\nThank you \ud83d\ude4f'},
  {id:'payment_30d',    enabled:true,  name:'Payment 30 Days Due',   icon:'\ud83d\udcb8', trigger:'Sale balance unpaid 30+ days',     delay:0,
    messageTemplate:'\ud83d\udcb8 *{shop_name} \u2014 Payment Reminder*\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nDear *{customer_name}*,\n\nWe have a pending balance on your purchase.\n\nInvoice: {invoice_number}\nDate: {invoice_date}\nItems: {items}\n*Balance Due: \u20b9{amount}*\n({days_pending} days pending)\n\nKindly clear the balance at your earliest convenience.\n\nThank you \ud83d\ude4f\n_{invoice_number}_'},
  {id:'order_ready',    enabled:true,  name:'Order Ready Alert',     icon:'\ud83c\udf81', trigger:'Order status = ready',             delay:0,
    messageTemplate:'\ud83c\udf81 *{shop_name} \u2014 Your Order is Ready!*\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nDear *{customer_name}*,\n\nGreat news! Your order *{order_number}* is ready for pickup.\n\nItems: {items}\n{balance_line}\n\nPlease visit the shop at your convenience.\n\nThank you \ud83d\ude4f\n_{shop_name}_'},
  {id:'order_delayed',  enabled:false, name:'Order Delay Warning',   icon:'\ud83d\udce6', trigger:'Order past delivery date',         delay:0,
    messageTemplate:'\ud83d\udce6 *{shop_name} \u2014 Order Update*\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nDear *{customer_name}*,\n\nWe sincerely apologize for the delay on your order *{order_number}*.\n\nYour order was due {days_delayed} day(s) ago. We are working on it and will update you shortly.\n\nWe value your patience and trust.\n\nThank you \ud83d\ude4f\n_{shop_name}_'},
  {id:'birthday',       enabled:false, name:'Festival/Birthday Msg', icon:'\ud83c\udf89', trigger:'Manual trigger (festival days)',   delay:0,
    messageTemplate:'\u2728 *{shop_name}*\n\nDear *{customer_name}*,\n\nWishing you and your family a joyful and prosperous festive season!\n\nVisit us for exclusive festive offers on gold, silver, and diamonds.\n\nWarm regards,\n_{shop_name}_'},
];

// Simple {variable} substitution -- deliberately not a full templating
// language (no loops/conditionals) so a non-technical shop owner can
// safely edit these without breaking anything. Unknown/mistyped
// {placeholders} are left as-is rather than silently vanishing, so a
// typo is visible instead of producing a confusing blank in the message.
function waFillTemplate(tpl, vars){
  return (tpl||'').replace(/\{([a-z_]+)\}/g, function(match, key){
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
  });
}

// Computes the variable set for one rule firing on one record. Reuses
// the exact same calculations the old hardcoded functions used, so
// numbers/wording are identical unless the owner has edited the template.
function waComputeVars(ruleId, record, shopName){
  var v = { shop_name: shopName };
  if(ruleId==='girvi_overdue'){
    var outstanding = girviOutstandingWithPenalty(record).amount;
    v.customer_name = record.customer;
    v.girvi_number = record.grvNo;
    v.item_desc = record.item.desc||record.item.metal;
    v.duration_months = Math.round(girviDaysSince(record.startDate) / 30);
    v.amount = Math.round(outstanding).toLocaleString('en-IN');
  } else if(ruleId==='girvi_due7'){
    var due = new Date(record.startDate); due.setMonth(due.getMonth()+parseInt(record.duration));
    v.customer_name = record.customer;
    v.girvi_number = record.grvNo;
    v.item_desc = record.item.desc||record.item.metal;
    v.due_date = fmtDate(dbDayKey(due));
    v.amount = Math.round(girviOutstanding(record)).toLocaleString('en-IN');
  } else if(ruleId==='payment_30d'){
    var t = calcSaleTotals(record);
    v.customer_name = record.customer;
    v.invoice_number = record.invNo;
    v.invoice_date = fmtDate(record.date);
    v.items = (record.items||[]).map(function(i){return i.name;}).join(', ');
    v.amount = Math.round(t.bal).toLocaleString('en-IN');
    v.days_pending = getAgingDays(record);
  } else if(ruleId==='order_ready'){
    var bal = Math.max(0,(record.quote||0) - ordAdvance(record));   // reversals subtract
    v.customer_name = record.customer;
    v.order_number = record.ordNo;
    v.items = (record.items&&record.items.length) ? record.items.map(function(i){return i.desc;}).join(', ') : '';
    v.balance_line = bal>0 ? ('*Balance to pay on pickup: \u20b9'+Math.round(bal).toLocaleString('en-IN')+'*') : 'All paid! Just come collect.';
  } else if(ruleId==='order_delayed'){
    v.customer_name = record.customer;
    v.order_number = record.ordNo;
    v.days_delayed = Math.abs(Math.ceil((new Date(record.delivery)-Date.now())/86400000));
  } else if(ruleId==='birthday'){
    v.customer_name = record; // called with a plain customer name string
  }
  return v;
}

// FIX: previously a raw, unscoped localStorage key ('jewelos_wa_rules')
// — same cross-account-leak class as ssj_cache/PIN/audit-log fixed
// earlier, and local-only (never reached the cloud, so editing a
// template on one device wouldn't show up on another). Now lives in
// S.waRules, flowing through the same shop-scoped cache + cloud sync
// pipeline as the rest of the app's data.
function getWaRules(){
  if(Array.isArray(S.waRules) && S.waRules.length){
    // Merge in any new default rule types that don't exist yet in this
    // shop's saved rules (e.g. a rule added in a later app update),
    // without touching this shop's own edited templates/enabled state.
    var existingIds = S.waRules.map(function(r){return r.id;});
    WA_RULE_DEFAULTS.forEach(function(def){
      if(existingIds.indexOf(def.id)===-1) S.waRules.push(JSON.parse(JSON.stringify(def)));
    });
    return S.waRules;
  }
  S.waRules = JSON.parse(JSON.stringify(WA_RULE_DEFAULTS));
  return S.waRules;
}
function saveWaRules(rules){
  S.waRules = rules;
  try{ saveToCloud(); }catch(e){}
}
function resetWaRuleTemplate(ruleId){
  var def = WA_RULE_DEFAULTS.find(function(r){return r.id===ruleId;});
  if(!def) return;
  var rules = getWaRules();
  var rule = rules.find(function(r){return r.id===ruleId;});
  if(rule){
    rule.messageTemplate = def.messageTemplate;
    saveWaRules(rules);
    renderSettingsAutomation();
    toast('\u2713 Reset to default wording');
  }
}
function saveWaRuleTemplate(ruleId){
  var el = document.getElementById('wa-tpl-'+ruleId);
  if(!el) return;
  var rules = getWaRules();
  var rule = rules.find(function(r){return r.id===ruleId;});
  if(rule){
    rule.messageTemplate = el.value;
    saveWaRules(rules);
    toast('\u2713 Message template saved');
  }
}
function previewWaRuleTemplate(ruleId){
  var el = document.getElementById('wa-tpl-'+ruleId);
  var rules = getWaRules();
  var rule = rules.find(function(r){return r.id===ruleId;});
  if(!el || !rule) return;
  var sampleVars = {
    shop_name: (SAAS.shop&&SAAS.shop.name)||'Your Shop', customer_name:'Rahul Sharma',
    girvi_number:'GRV-0042', item_desc:'Gold Chain 22K', duration_months:'4', due_date:'15 Sep 2026',
    amount:'12,500', invoice_number:'INV-0301', invoice_date:'1 Aug 2026', items:'Gold Ring, Silver Bangle',
    days_pending:'32', order_number:'ORD-018', balance_line:'*Balance to pay on pickup: \u20b91,200*', days_delayed:'3'
  };
  alert(waFillTemplate(el.value, sampleVars));
}

// Opens the template editor on one specific rule, from the Settings card.
// Settings deliberately does NOT render a second textarea of its own: the
// editor's field is found by id (wa-tpl-<ruleId>), so a duplicate copy on
// another screen would make saveWaRuleTemplate/previewWaRuleTemplate read
// whichever one happened to come first in the document. One editor only.
function editWaTemplate(ruleId){
  var modal = document.getElementById('wa-automation-modal');
  if(!modal) return;
  modal.style.display = 'block';
  renderWaRules();
  var ta = document.getElementById('wa-tpl-'+ruleId);
  if(!ta) return;
  var det = ta.closest ? ta.closest('details') : null;
  if(det) det.open = true;
  try{ ta.scrollIntoView({block:'center'}); }catch(e){ /* older browsers */ }
  ta.focus();
}
function toggleWaRule(ruleId){
  var rules = getWaRules();
  var rule  = rules.find(function(r){return r.id===ruleId;});
  if(rule) rule.enabled = !rule.enabled;
  saveWaRules(rules);
  renderWaRules();
  renderSettingsAutomation();
}

function renderWaRules(){
  var rules = getWaRules();
  var el    = document.getElementById('wa-rules-list');
  if(!el) return;
  el.innerHTML = rules.map(function(r){
    return '<div class="wa-rule" style="flex-direction:column;align-items:stretch;">'+
      '<div style="display:flex;align-items:center;gap:10px;">'+
        '<div class="wa-rule-icon">'+r.icon+'</div>'+
        '<div class="wa-rule-body">'+
          '<div class="wa-rule-title">'+r.name+'</div>'+
          '<div class="wa-rule-sub">'+r.trigger+'</div>'+
        '</div>'+
        '<label class="wa-toggle">'+
          '<input type="checkbox" '+(r.enabled?'checked':'')+' onchange="toggleWaRule(\''+r.id+'\')">'+
          '<div class="wa-toggle-slider"></div>'+
        '</label>'+
      '</div>'+
      '<details style="margin-top:8px;">'+
        '<summary style="cursor:pointer;font-size:11px;color:var(--gold-dark);font-weight:700;">\u270f\ufe0f Edit message wording</summary>'+
        '<div style="margin-top:8px;">'+
          '<textarea id="wa-tpl-'+r.id+'" rows="7" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;padding:10px;border-radius:10px;border:1px solid var(--border2);background:var(--card1);color:var(--ink);resize:vertical;">'+escHtml(r.messageTemplate||'')+'</textarea>'+
          '<div style="font-size:10px;color:var(--text3);margin:5px 0 8px;">Available: {customer_name} {shop_name} {amount} {due_date} {girvi_number} {invoice_number} {order_number} {items} {item_desc} \u2014 write in your own words, these get swapped in automatically.</div>'+
          '<div style="display:flex;gap:6px;flex-wrap:wrap;">'+
            '<button onclick="saveWaRuleTemplate(\''+r.id+'\')" style="padding:6px 14px;border-radius:8px;border:none;background:var(--gold);color:#1a1200;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Save</button>'+
            '<button onclick="previewWaRuleTemplate(\''+r.id+'\')" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border2);background:var(--card2);color:var(--text2);font-size:12px;cursor:pointer;font-family:inherit;">Preview</button>'+
            '<button onclick="resetWaRuleTemplate(\''+r.id+'\')" style="padding:6px 14px;border-radius:8px;border:1px solid var(--border2);background:none;color:var(--text3);font-size:12px;cursor:pointer;font-family:inherit;">Reset to Default</button>'+
          '</div>'+
        '</div>'+
      '</details>'+
    '</div>';
  }).join('');
}

// Run all enabled WA reminders — collect who to message and show batch
function runAllWaReminders(){
  var rules   = getWaRules();
  var enabled = rules.filter(function(r){return r.enabled;});
  var queue   = [];
  var shopName= SAAS.shop?SAAS.shop.name:'Our Shop';
  var now     = new Date();

  enabled.forEach(function(rule){
    if(rule.id==='girvi_overdue'){
      (S.girvi||[]).filter(function(g){
        if(g.status==='closed') return false;
        if(!g.duration) return false;
        var due=new Date(g.startDate); due.setMonth(due.getMonth()+parseInt(g.duration));
        return due < now;
      }).forEach(function(g){
        if(!g.phone) return;
        queue.push({name:g.customer,phone:g.phone,ruleId:rule.id,
          msg:waFillTemplate(rule.messageTemplate,waComputeVars('girvi_overdue',g,shopName)),label:rule.name+': '+g.grvNo});
      });
    }
    if(rule.id==='girvi_due7'){
      getGirviDueSoon(7).forEach(function(g){
        if(!g.phone) return;
        queue.push({name:g.customer,phone:g.phone,ruleId:rule.id,
          msg:waFillTemplate(rule.messageTemplate,waComputeVars('girvi_due7',g,shopName)),label:rule.name+': '+g.grvNo});
      });
    }
    if(rule.id==='payment_30d'){
      getSalesDueSoon(30).forEach(function(s){
        if(!s.phone) return;
        queue.push({name:s.customer,phone:s.phone,ruleId:rule.id,
          msg:waFillTemplate(rule.messageTemplate,waComputeVars('payment_30d',s,shopName)),label:rule.name+': '+s.invNo});
      });
    }
    if(rule.id==='order_ready'){
      (S.orders||[]).filter(function(o){return o.status==='ready'&&o.phone;}).forEach(function(o){
        queue.push({name:o.customer,phone:o.phone,ruleId:rule.id,
          msg:waFillTemplate(rule.messageTemplate,waComputeVars('order_ready',o,shopName)),label:rule.name+': '+o.ordNo});
      });
    }
    if(rule.id==='order_delayed'){
      (S.orders||[]).filter(function(o){
        return o.status!=='delivered'&&o.status!=='cancelled'&&new Date(o.delivery)<now&&o.phone;
      }).forEach(function(o){
        queue.push({name:o.customer,phone:o.phone,ruleId:rule.id,
          msg:waFillTemplate(rule.messageTemplate,waComputeVars('order_delayed',o,shopName)),label:rule.name+': '+o.ordNo});
      });
    }
  });

  if(!queue.length){ toast('\u2705 No reminders due right now. All clear!'); return; }

  // Show queue and let user send one by one
  showWaQueue(queue);
}

var _waQueue = [], _waQueueIdx = 0;
function showWaQueue(queue){
  _waQueue = queue; _waQueueIdx = 0;
  sendNextWaInQueue();
}
function sendNextWaInQueue(){
  if(_waQueueIdx >= _waQueue.length){
    toast('\u2705 All '+_waQueue.length+' reminders sent!');
    document.getElementById('wa-automation-modal').style.display='none';
    return;
  }
  var item = _waQueue[_waQueueIdx];
  var remaining = _waQueue.length - _waQueueIdx;
  // Show confirmation with message preview
  safeConfirm(
    'Send reminder '+(_waQueueIdx+1)+' of '+_waQueue.length+'?',
    'To: '+item.name+' ('+item.phone+') — '+item.label+'. Tap Confirm to open WhatsApp.',
    function(){
      sendWhatsApp(item.phone, item.msg);
      saasActivityLog('whatsapp','Reminder sent: '+item.label+' to '+item.name);
      _waQueueIdx++;
      if(_waQueueIdx < _waQueue.length){
        setTimeout(sendNextWaInQueue, 800);
      } else {
        toast('\u2705 Reminders complete!');
      }
    }
  );
  // Also advance on cancel so queue doesn't stall
  document.getElementById('safe-confirm-cancel').addEventListener('click', function onSkip(){
    document.getElementById('safe-confirm-cancel').removeEventListener('click', onSkip);
    _waQueueIdx++;
    if(_waQueueIdx < _waQueue.length) setTimeout(sendNextWaInQueue, 400);
    else toast('\u2705 Reminders complete!');
  }, {once:true});
  return;
}

function renderSettingsAutomation(){
  // Show honest description of what this feature is
  var descEl = document.getElementById('wa-how-it-works');
  if(descEl) descEl.style.display = 'block';
  renderWaRules();
  // Message templates — the real, editable ones.
  // This card used to list four hardcoded sample strings ('Dear [Customer],
  // we have a pending balance on invoice [INV-XXX]...') that were not wired
  // to WA_RULE_DEFAULTS at all. So it showed four items when there are six
  // rules, the wording never matched what actually got sent, and there was
  // no way to change any of it from Settings. Now it lists the shop's own
  // current templates, each with an Edit button.
  var tmplEl = document.getElementById('set-wa-templates');
  if(tmplEl){
    var tplRules = getWaRules();
    tmplEl.innerHTML = tplRules.map(function(r){
      var def = WA_RULE_DEFAULTS.find(function(d){return d.id===r.id;});
      var edited = !!def && def.messageTemplate !== r.messageTemplate;
      // A readable one-line gist of the real wording, with the decorative
      // divider and WhatsApp bold/italic marks stripped for legibility.
      // Strip only the * bold marks. Underscores are WhatsApp's italic mark
      // too, but they also sit inside every placeholder name, so removing
      // them turns {shop_name} into {shopname} — a placeholder that does not
      // exist, shown to an owner who may well copy it.
      var gist = (r.messageTemplate||'')
        .replace(/\*/g,'')
        .replace(/─+/g,' ')
        .replace(/\s+/g,' ')
        .trim();
      var short = gist.length>90 ? gist.slice(0,90)+'…' : gist;
      return '<div style="padding:10px 12px;background:var(--card2);border-radius:9px;margin-bottom:7px;">'+
        '<div style="display:flex;align-items:center;gap:7px;margin-bottom:4px;">'+
          '<span>'+r.icon+'</span>'+
          '<span style="font-size:12px;font-weight:700;">'+escHtml(r.name)+'</span>'+
          (edited?'<span style="font-size:9px;font-weight:700;color:var(--gold-dark);background:var(--gold-bg);padding:2px 7px;border-radius:100px;letter-spacing:.04em;">YOUR WORDING</span>':'')+
          (r.enabled?'':'<span style="font-size:9px;font-weight:700;color:var(--text3);background:var(--bg2);padding:2px 7px;border-radius:100px;letter-spacing:.04em;">OFF</span>')+
          '<button onclick="editWaTemplate(\''+r.id+'\')" style="margin-left:auto;flex:none;padding:5px 13px;border-radius:8px;border:1px solid var(--border-gold);background:var(--card1);color:var(--gold-dark);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">✏️ Edit</button>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--text3);line-height:1.5;">'+escHtml(short)+'</div>'+
      '</div>';
    }).join('');
  }
  var rulesEl = document.getElementById('set-wa-rules');
  if(rulesEl){
    var rules = getWaRules();
    var active = rules.filter(function(r){return r.enabled;});
    rulesEl.innerHTML = '<div style="font-size:12px;color:var(--text2);">'+active.length+' of '+rules.length+' rules active &bull; ';
    var due = [];
    var now = new Date();
    if(rules.find(function(r){return r.id==='girvi_overdue'&&r.enabled;})){
      var oG=(S.girvi||[]).filter(function(g){if(g.status==='closed'||!g.duration)return false;var d=new Date(g.startDate);d.setMonth(d.getMonth()+parseInt(g.duration));return d<now;}).length;
      if(oG) due.push(oG+' overdue girvi');
    }
    if(rules.find(function(r){return r.id==='payment_30d'&&r.enabled;})){
      var oP=getSalesDueSoon(30).length;
      if(oP) due.push(oP+' overdue payments');
    }
    rulesEl.innerHTML += (due.length?'<b style="color:var(--warning);">'+due.join(', ')+' due</b>':'all clear today') + '</div>';
  }
}

// ── DAILY DIGEST ─────────────────────────────────────────────────────
function showDailyDigest(){
  var el = document.getElementById('digest-body');
  if(!el) return;
  var now    = new Date();
  var year   = now.getFullYear();
  var month  = now.getMonth();
  var today  = dbDayKey(now);
  var monthStr = year+'-'+String(month+1).padStart(2,'0')+'-01';
  var thisMonth  = calcMonthProfit(year, month);
  var cf         = calcCashFlow(monthStr, today);
  var todaySales = S.sales.filter(function(s){return s.date===today;});
  var todayRev   = todaySales.reduce(function(s,x){return s+calcSaleTotals(x).grand;},0);
  var pendingBal = S.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
  var activeGirvi= (S.girvi||[]).filter(function(g){return g.status!=='closed';});
  var girviOut   = activeGirvi.reduce(function(s,g){return s+girviOutstanding(g);},0);
  var overdueG   = activeGirvi.filter(function(g){if(!g.duration)return false;var d=new Date(g.startDate);d.setMonth(d.getMonth()+parseInt(g.duration));return d<now;});
  var urgentOrders=(S.orders||[]).filter(function(o){return o.status!=='delivered'&&o.status!=='cancelled'&&new Date(o.delivery)<=new Date(Date.now()+3*86400000);});

  var shopName = SAAS.shop ? SAAS.shop.name : 'Your Shop';
  var dayName  = now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});

  el.innerHTML=
    '<div style="text-align:center;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:12px;">'+
      '<div style="font-size:13px;color:var(--text3);">'+dayName+'</div>'+
      '<div style="font-size:22px;font-weight:800;margin-top:4px;">'+fmt(todayRev)+'</div>'+
      '<div style="font-size:11px;color:var(--text3);">Today\'s revenue &bull; '+plural(todaySales.length,'bill')+'</div>'+
    '</div>'+
    digestSection('\ud83d\udcb0 This Month So Far',[
      ['Revenue', fmt(thisMonth.revenue)],
      ['Profit',  fmt(thisMonth.netProfit)],
      ['Cash In', fmt(cf.cashIn)],
      ['Margin',  thisMonth.margin.toFixed(1)+'%']
    ])+
    digestSection('\u26a0\ufe0f Action Needed',[
      ['Overdue girvi', overdueG.length ? overdueG.length+' loans' : '\u2705 Clear'],
      ['Pending dues',  pendingBal > 0  ? fmt(pendingBal)          : '\u2705 Clear'],
      ['Urgent orders', urgentOrders.length ? plural(urgentOrders.length,'order') : '\u2705 Clear']
    ])+
    digestSection('\ud83e\udea9 Girvi Status',[
      ['Active loans', activeGirvi.length],
      ['Total outstanding', fmt(Math.round(girviOut))],
      ['Overdue', overdueG.length+' loans']
    ]);

  document.getElementById('digest-modal').style.display='block';
  saasActivityLog('report','Daily digest viewed');
}

function digestSection(title, rows){
  return '<div class="digest-section">'+
    '<div class="digest-section-title">'+title+'</div>'+
    rows.map(function(r){return '<div class="digest-row"><span>'+r[0]+'</span><strong>'+r[1]+'</strong></div>';}).join('')+
  '</div>';
}

function shareDigestWhatsApp(){
  var now   = new Date();
  var year  = now.getFullYear();
  var month = now.getMonth();
  var today = dbDayKey(now);
  var thisMonth = calcMonthProfit(year, month);
  var pendingBal = S.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
  var activeGirvi= (S.girvi||[]).filter(function(g){return g.status!=='closed';});
  var girviOut   = activeGirvi.reduce(function(s,g){return s+girviOutstanding(g);},0);
  var shopName   = SAAS.shop?SAAS.shop.name:'My Shop';
  var dayName    = now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'});

  // Net profit paired with its own net margin, not the gross margin
  // calcMonthProfit returns as .margin (batch28 review, 23 Sep 2026
  // HANDOFF entry: the two numbers didn't agree with each other).
  var netMargin = thisMonth.revenue>0 ? (thisMonth.netProfit/thisMonth.revenue*100) : 0;
  var msg = '\ud83d\udcca *'+shopName+' — Daily Summary*\n'+
    dayName+'\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\n'+
    '\ud83d\udcb0 *This Month*\n'+
    'Revenue: '+fmt(thisMonth.revenue)+'\n'+
    'Profit: '+fmt(thisMonth.netProfit)+' ('+netMargin.toFixed(1)+'%)\n\n'+
    '\u26a0\ufe0f *Action Items*\n'+
    'Pending dues: '+fmt(pendingBal)+'\n'+
    'Girvi outstanding: '+fmt(Math.round(girviOut))+'\n\n'+
    '_Sent from JewelOS_';

  var ownerPhone = SAAS.shop ? SAAS.shop.phone : '';
  sendWhatsApp(ownerPhone||'', msg);
}

function scheduleDailyDigest(){
  var btn = document.getElementById('digest-schedule-btn');
  var info= document.getElementById('digest-schedule-info');
  var current = localStorage.getItem(shopScopedKey('jewelos_digest_time'));
  var time = prompt('Set daily digest reminder time (24h format, e.g. 09:00):', current||'09:00');
  if(!time) return;
  try{ localStorage.setItem(shopScopedKey('jewelos_digest_time'), time); } catch(e){}
  if(btn) btn.textContent = '\u23f0 Scheduled: '+time;
  if(info) info.textContent = 'Daily digest reminder set for '+time+'. Open the app at that time for your summary.';
  toast('\u2713 Daily digest scheduled for '+time);
}

// ── ADVANCED ANALYTICS ────────────────────────────────────────────────

// Customer Lifetime Value
function calcCLV(custName, phone){
  var fin   = calcCustomerFinancials(custName, phone);
  var sales = S.sales.filter(function(s){return s.customer===custName&&(!phone||s.phone===phone);});
  if(!sales.length) return null;
  var times = sales.map(function(s){ return new Date(s.date).getTime(); }).filter(isFinite);
  var daySpan = times.length ? (Math.max.apply(null,times) - Math.min.apply(null,times))/86400000 : 0;
  var avgOrderVal  = fin.totalPurchased / sales.length;
  // QA P2-17: one bill was read as "buys every month" and projected x24
  // (Rs 49.9 lakh from one Rs 2 lakh bill). Project only from 2+ bills at
  // least a month apart; otherwise the figure is simply what they have spent.
  var projected    = sales.length >= 2 && daySpan >= 30;
  var intervalDays = projected ? daySpan / (sales.length - 1) : 0;
  var purchaseFreq = projected ? 30 / intervalDays : 0; // per month
  var projectedLTV = projected ? avgOrderVal * purchaseFreq * 24 : fin.totalPurchased; // 24-month projection
  var tags = getCustomerTags(custName, phone, sales);
  return {
    name:        custName,
    phone:       phone,
    totalSpend:  fin.totalPurchased,
    orders:      sales.length,
    avgOrder:    avgOrderVal,
    freqPerMonth:purchaseFreq,
    intervalDays:intervalDays,
    projected:   projected,
    projectedLTV:projectedLTV,
    pending:     fin.totalCredit,
    exposure:    fin.totalExposure,
    riskLevel:   fin.riskLevel,
    tags:        tags,
    firstSale:   sales[0].date,
    lastSale:    sales[sales.length-1].date
  };
}

function renderSettingsAnalytics(){
  // ── CLV Table ──────────────────────────────────────────────────
  var clvEl = document.getElementById('set-clv-list');
  if(clvEl){
    var cm = buildCustMap ? buildCustMap() : {};
    var custs = Object.values(cm).map(function(c){ return calcCLV(c.name,c.phone); }).filter(Boolean);
    custs.sort(function(a,b){return b.projectedLTV-a.projectedLTV;});
    var maxCLV = custs.length ? custs[0].projectedLTV : 1;
    if(custs.length){
      clvEl.innerHTML = custs.slice(0,10).map(function(c,i){
        var tagHtml = c.tags.map(renderCustomerTag).join('');
        var riskColor={low:'var(--success)',medium:'var(--warning)',high:'var(--danger)'}[c.riskLevel]||'var(--text3)';
        return '<div class="clv-tier">'+
          '<div style="flex-shrink:0;width:22px;text-align:center;font-weight:800;font-size:12px;color:var(--text3);">'+(i+1)+'</div>'+
          '<div style="flex:1;min-width:0;">'+
            '<div style="font-weight:600;font-size:13px;">'+escHtml(c.name)+' '+tagHtml+'</div>'+
            '<div style="font-size:10px;color:var(--text3);">'+plural(c.orders,'order')+' &bull; '+fmt(Math.round(c.avgOrder))+'/order'+(c.projected?' &bull; every '+Math.round(c.intervalDays)+'d on average':'')+'</div>'+
            '<div class="clv-bar-track" style="margin-top:4px;">'+
              '<div class="clv-bar-fill" style="width:'+Math.round(c.projectedLTV/maxCLV*100)+'%;background:var(--gold);"></div>'+
            '</div>'+
          '</div>'+
          '<div style="text-align:right;flex-shrink:0;margin-left:10px;">'+
            '<div style="font-weight:700;font-size:14px;color:var(--gold-dark);">'+fmt(Math.round(c.projectedLTV))+'</div>'+
            '<div style="font-size:9px;color:var(--text3);">'+(c.projected?'24-mo CLV':'spent so far')+'</div>'+
            (c.pending>0?'<div style="font-size:10px;color:var(--danger);">Due: '+fmt(c.pending)+'</div>':'')+
          '</div>'+
        '</div>';
      }).join('');
    } else {
      clvEl.innerHTML='<div class="empty">Add sales to see customer lifetime value</div>';
    }
  }

  // ── 6-month Profit Trend ──────────────────────────────────────
  var ptEl = document.getElementById('set-profit-trend');
  if(ptEl){
    var now   = new Date();
    var months= [];
    for(var i=5;i>=0;i--){
      var cm2=now.getMonth()-i, cy=now.getFullYear();
      if(cm2<0){cm2+=12;cy--;}
      var mp=calcMonthProfit(cy,cm2);
      months.push({
        label:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][cm2],
        revenue:mp.revenue,profit:mp.profit,margin:mp.margin,count:mp.count
      });
    }
    var maxR=Math.max.apply(null,months.map(function(m){return m.revenue;}))||1;
    ptEl.innerHTML=
      '<div style="display:flex;align-items:flex-end;gap:4px;height:70px;margin-bottom:4px;">'+
      months.map(function(m){
        var hR=Math.max(4,Math.round(m.revenue/maxR*70));
        var hP=m.revenue>0?Math.max(2,Math.round(Math.max(0,m.profit)/maxR*70)):0;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">'+
          '<div style="font-size:9px;color:var(--text3);">'+(m.revenue>0?Math.round(m.margin)+'%':'')+'</div>'+
          '<div style="width:100%;position:relative;height:56px;display:flex;align-items:flex-end;gap:1px;">'+
            '<div style="flex:1;height:'+hR+'px;background:var(--bg3);border-radius:2px 2px 0 0;"></div>'+
            '<div style="flex:1;height:'+hP+'px;background:var(--success);border-radius:2px 2px 0 0;opacity:.85;"></div>'+
          '</div></div>';
      }).join('')+
      '</div>'+
      '<div style="display:flex;gap:4px;">'+months.map(function(m){
        return '<div style="flex:1;text-align:center;font-size:10px;color:var(--text3);">'+m.label+'</div>';
      }).join('')+'</div>'+
      '<div style="display:flex;gap:12px;font-size:11px;color:var(--text3);margin-top:8px;">'+
        '<span><span style="display:inline-block;width:10px;height:10px;background:var(--bg3);border-radius:2px;margin-right:3px;"></span>Revenue</span>'+
        '<span><span style="display:inline-block;width:10px;height:10px;background:var(--success);border-radius:2px;margin-right:3px;"></span>Profit</span>'+
      '</div>';
  }

  // ── Category Growth (3-month trend) ──────────────────────────
  var cgEl = document.getElementById('set-cat-growth');
  if(cgEl){
    var now2 = new Date();
    var cats3={};
    for(var mi=2;mi>=0;mi--){
      var mm=now2.getMonth()-mi, yy=now2.getFullYear();
      if(mm<0){mm+=12;yy--;}
      var sales3=S.sales.filter(function(s){var d=new Date(s.date);return d.getFullYear()===yy&&d.getMonth()===mm;});
      sales3.forEach(function(s){
        (s.items||[]).forEach(function(i){
          var cat=saleItemCat(i); // the one category rule the Reports tables use
          if(!cats3[cat]) cats3[cat]=[0,0,0];
          cats3[cat][2-mi]+=getItemRate(i)*(parseFloat(i.weight)||0)*(i.qty||1);
        });
      });
    }
    var MS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var mLabels=[-2,-1,0].map(function(off){var m=((now2.getMonth()+off+12)%12);return MS[m];});
    var catArr=Object.entries(cats3).sort(function(a,b){return b[1][2]-a[1][2];});
    if(catArr.length){
      cgEl.innerHTML='<div style="overflow-x:auto;"><table style="width:100%;font-size:12px;border-collapse:collapse;">'+
        '<thead><tr><th style="text-align:left;padding:5px 4px;color:var(--text3);">Category</th>'+
        mLabels.map(function(l){return '<th style="text-align:right;padding:5px 4px;color:var(--text3);">'+l+'</th>';}).join('')+
        '<th style="text-align:right;padding:5px 4px;color:var(--text3);">Trend</th></tr></thead>'+
        '<tbody>'+catArr.slice(0,8).map(function(e){
          var prev=e[1][1]||0,curr=e[1][2]||0;
          var trend=prev>0?((curr-prev)/prev*100):0;
          var tColor=trend>=0?'var(--success)':'var(--danger)';
          // QA P2-17: Rs 0 -> Rs 1,89,720 read "▲0%". No base month = no percentage.
          var tText=prev>0 ? (trend>=0?'▲':'▼')+Math.abs(Math.round(trend))+'%' : (curr>0?'New':'—');
          return '<tr>'+
            '<td style="padding:5px 4px;font-weight:600;">'+escHtml(e[0])+'</td>'+
            e[1].map(function(v){return '<td style="text-align:right;padding:5px 4px;font-size:11px;">'+fmt(Math.round(v))+'</td>';}).join('')+
            '<td style="text-align:right;padding:5px 4px;font-size:11px;color:'+tColor+';font-weight:700;">'+tText+'</td>'+
          '</tr>';
        }).join('')+
        '</tbody></table></div>';
    } else {
      cgEl.innerHTML='<div class="empty">Add sales data to see category growth</div>';
    }
  }

  // ── Capital Allocation ────────────────────────────────────────
  var capEl = document.getElementById('set-capital-alloc');
  if(capEl){
    var stockVal  = stockGV()+stockSV();
    var pendingB  = S.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
    var girviTot  = (S.girvi||[]).filter(function(g){return g.status!=='closed';}).reduce(function(s,g){return s+girviOutstanding(g);},0);
    var totalCap  = stockVal + pendingB + girviTot;
    if(totalCap > 0){
      var bars = [
        {label:'Stock',   val:stockVal,  color:'var(--gold)',   pct:stockVal/totalCap*100},
        {label:'Credit',  val:pendingB,  color:'var(--danger)', pct:pendingB/totalCap*100},
        {label:'Girvi',   val:girviTot,  color:'var(--warning)',pct:girviTot/totalCap*100},
      ];
      capEl.innerHTML=
        '<div style="font-size:12px;color:var(--text3);margin-bottom:10px;">Total tracked capital: <strong>'+fmt(Math.round(totalCap))+'</strong></div>'+
        bars.map(function(b){
          return '<div style="margin-bottom:10px;">'+
            '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">'+
              '<span style="font-weight:600;">'+b.label+'</span>'+
              '<span>'+fmt(Math.round(b.val))+' <span style="color:var(--text3);">('+b.pct.toFixed(0)+'%)</span></span>'+
            '</div>'+
            '<div style="background:var(--bg3);border-radius:4px;height:8px;overflow:hidden;">'+
              '<div style="height:100%;width:'+b.pct+'%;background:'+b.color+';border-radius:4px;"></div>'+
            '</div>'+
          '</div>';
        }).join('');
    } else {
      capEl.innerHTML='<div class="empty">Add inventory, sales, and girvi data to see capital allocation</div>';
    }
  }
}

