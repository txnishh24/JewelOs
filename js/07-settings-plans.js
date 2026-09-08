function renderSettingsPlan(){
  var pb=document.getElementById('set-plan-badge');
  var pi=document.getElementById('set-plan-info');
  if(pb) pb.innerHTML='<span class="plan-badge '+(SAAS.plan||'free')+'">'+(SAAS.plan||'FREE').toUpperCase()+'</span>';
  if(pi){
    var limits=PLAN_LIMITS[SAAS.plan||'free']||PLAN_LIMITS['free'];
    pi.innerHTML='<b>'+(SAAS.plan||'Free').charAt(0).toUpperCase()+(SAAS.plan||'free').slice(1)+'</b> &bull; '+
      'Products: '+(limits.maxProducts>9999?'Unlimited':limits.maxProducts)+' &bull; '+
      'Users: '+(limits.maxUsers>99?'Unlimited':limits.maxUsers)+' &bull; '+
      (limits.girvi?'\u2705 Girvi':'\u274c Girvi')+' &bull; '+
      (limits.reports?'\u2705 Reports':'\u274c Reports')+' &bull; '+
      (limits.whatsapp?'\u2705 WhatsApp':'\u274c WhatsApp');
  }
  var gatesEl=document.getElementById('set-plan-gates');
  if(gatesEl){
    var allFeatures=[
      {key:'girvi',    label:'\ud83e\udea9 Girvi Loans',     req:'pro'},
      {key:'reports',  label:'\ud83d\udcca Smart Reports',   req:'basic'},
      {key:'whatsapp', label:'\ud83d\udcf1 WhatsApp Auto',   req:'pro'},
      {key:'orders',   label:'\ud83d\udccb Orders Module',   req:'basic'},
      {key:'csvExport',label:'\ud83d\udcc4 CSV/PDF Export',  req:'basic'},
    ];
    gatesEl.innerHTML=allFeatures.map(function(f){
      var has=canAccess(f.key);
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:13px;">'+
        '<span>'+(has?'\u2705':'\ud83d\udd12')+' '+f.label+'</span>'+
        (has
          ?'<span style="font-size:11px;color:#22c55e;font-weight:600;">Active</span>'
          :'<span class="upgrade-nudge" style="padding:4px 10px;margin:0;" onclick="document.getElementById(\'pricing-modal\').style.display=\'block\'">'+
             '<span style="font-size:11px;color:var(--gold);font-weight:700;">Upgrade to '+f.req.toUpperCase()+' \u2192</span>'+
           '</span>')+
      '</div>';
    }).join('');
  }
}

// ── PDF REPORT EXPORT ─────────────────────────────────────────────────
function showPdfReport(){
  var now   = new Date();
  var year  = now.getFullYear();
  var month = now.getMonth();
  var mName = ['January','February','March','April','May','June','July','August','September','October','November','December'][month];
  var thisM = calcMonthProfit(year,month);
  var allT  = calcAllTimeProfit();
  var shopName = SAAS.shop?SAAS.shop.name:'My Shop';
  var pending  = S.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
  var girviTot = (S.girvi||[]).filter(function(g){return g.status!=='closed';}).reduce(function(s,g){return s+girviOutstanding(g);},0);

  var html =
    '<div style="font-family:Arial,sans-serif;color:#111;max-width:580px;margin:0 auto;">'+
    // Header
    '<div style="text-align:center;border-bottom:2px solid #c9a84c;padding-bottom:16px;margin-bottom:20px;">'+
      '<div style="font-size:24px;font-weight:800;color:#c9a84c;">'+shopName+'</div>'+
      '<div style="font-size:13px;color:#666;margin-top:4px;">Monthly Business Report — '+mName+' '+year+'</div>'+
      '<div style="font-size:11px;color:#999;">Generated: '+now.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})+'</div>'+
    '</div>'+
    // P&L
    '<div style="margin-bottom:20px;">'+
      '<h3 style="font-size:14px;font-weight:700;color:#333;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px;">P&L Summary — '+mName+'</h3>'+
      pdfRow('Total Revenue',      fmt(thisM.revenue),'#c9a84c',true)+
      pdfRow('Metal Cost',         fmt(thisM.cost),   '#ef4444',false)+
      pdfRow('GST Collected',      fmt(thisM.gst),    '#666',  false)+
      '<div style="border-top:2px solid #eee;margin:8px 0;"></div>'+
      pdfRow('Net Profit',         fmt(thisM.profit), '#22c55e',true)+
      pdfRow('Profit Margin',      thisM.margin.toFixed(1)+'%', '#22c55e',false)+
      pdfRow('Bills This Month',   thisM.count+' invoices','#666',false)+
    '</div>'+
    // Capital
    '<div style="margin-bottom:20px;">'+
      '<h3 style="font-size:14px;font-weight:700;color:#333;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px;">Capital Status</h3>'+
      pdfRow('Stock Value',        fmt(stockGV()+stockSV()), '#c9a84c',false)+
      pdfRow('Credit Outstanding', fmt(pending),  '#ef4444',false)+
      pdfRow('Girvi Exposure',     fmt(girviTot), '#f59e0b',false)+
      '<div style="border-top:2px solid #eee;margin:8px 0;"></div>'+
      pdfRow('Total Capital Stuck',fmt(pending+girviTot),'#ef4444',true)+
    '</div>'+
    // All-time
    '<div style="margin-bottom:20px;">'+
      '<h3 style="font-size:14px;font-weight:700;color:#333;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px;">All-Time Summary</h3>'+
      pdfRow('Total Revenue',  fmt(allT.revenue), '#c9a84c',false)+
      pdfRow('Total Profit',   fmt(allT.profit),  '#22c55e',false)+
      pdfRow('Avg Margin',     allT.margin.toFixed(1)+'%','#22c55e',false)+
      pdfRow('Total Sales',    S.sales.length+' invoices','#666',false)+
    '</div>'+
    // Top customers
    '<div style="margin-bottom:20px;">'+
      '<h3 style="font-size:14px;font-weight:700;color:#333;border-bottom:1px solid #eee;padding-bottom:6px;margin-bottom:10px;">Top 5 Customers (All Time)</h3>'+
      (function(){
        var cm = buildCustMap ? buildCustMap() : {};
        var custs = Object.values(cm).map(function(c){
          return {name:c.name,rev:c.sales.reduce(function(s,x){return s+calcSaleTotals(x).grand;},0),count:c.sales.length};
        }).sort(function(a,b){return b.rev-a.rev;}).slice(0,5);
        return custs.map(function(c,i){
          return pdfRow((i+1)+'. '+c.name, fmt(c.rev)+' ('+c.count+' orders)','#333',false);
        }).join('');
      }())+
    '</div>'+
    '<div style="text-align:center;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px;">'+
      'Generated by JewelOS &bull; jewelos.app &bull; '+shopName+
    '</div>'+
    '</div>';

  var body = document.getElementById('pdf-preview-body');
  if(body) body.innerHTML = html;
  document.getElementById('pdf-preview-modal').style.display='block';
}

function pdfRow(label, val, color, bold){
  return '<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px;'+(bold?'font-weight:700;':'')+'">'+'<span>'+label+'</span><span style="color:'+color+';">'+val+'</span></div>';
}

function printPdfPreview(){
  var body = document.getElementById('pdf-preview-body');
  if(!body) return;
  var w = window.open('','_blank');
  w.document.write('<html><head><title>'+((SAAS.shop?SAAS.shop.name:'JewelOS')+' Report')+'</title>'+
    '<style>body{font-family:Arial,sans-serif;margin:20px;}@media print{.no-print{display:none;}}</style>'+
    '</head><body>'+body.innerHTML+'</body></html>');
  w.document.close();
  w.focus();
  setTimeout(function(){w.print();},500);
  saasActivityLog('export','PDF report printed');
}

// ── CSV EXPORT ────────────────────────────────────────────────────────
function exportCSV(){
  if(!canAccess('csvExport')){
    toast('\u26a0 CSV export requires Basic plan');
    document.getElementById('pricing-modal').style.display='block';
    return;
  }
  var rows = [['Invoice','Date','Customer','Phone','Items','Weight(g)','Total','Paid','Balance','GST','Profit']];
  S.sales.forEach(function(s){
    var t=calcSaleTotals(s); var p=calcSaleProfit(s);
    var wt=(s.items||[]).reduce(function(a,i){return a+i.weight*(i.qty||1);},0);
    rows.push([
      s.invNo, s.date, s.customer, s.phone||'',
      (s.items||[]).map(function(i){return i.name;}).join('; '),
      wt.toFixed(2), Math.round(t.grand), Math.round(t.adv),
      Math.round(t.bal), Math.round(t.gstAmt), Math.round(p.profit)
    ]);
  });
  var csv = rows.map(function(r){return r.map(function(c){return '"'+String(c).replace(/"/g,'""')+'"';}).join(',');}).join('\n');
  var blob = new Blob([csv],{type:'text/csv'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download= ((SAAS.shop?SAAS.shop.name:'JewelOS').replace(/\s+/g,'-'))+'-sales-'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  URL.revokeObjectURL(url);
  saasActivityLog('export','Sales CSV exported ('+S.sales.length+' rows)');
  toast('\u2713 CSV downloaded!');
}

// ── ONBOARDING WIZARD ─────────────────────────────────────────────────
var WIZARD_STEPS = [
  {
    title:'Welcome to JewelOS! 💎',
    body:'Your complete jewellery business manager. Let\'s set up your shop in 3 quick steps.',
    action:'Get Started',next:true
  },
  {
    title:'Add Your Gold Rates 📊',
    body:'Go to Inventory → set today\'s 22K and 24K rates. This drives all your profit calculations.',
    action:'Got it',next:true
  },
  {
    title:'Add Your First Product 📦',
    body:'Tap Inventory → + Add Product. Fill weight, purity, and optionally your purchase rate to track profit.',
    action:'Next',next:true
  },
  {
    title:'Record Your First Sale 💰',
    body:'Tap Sale tab → pick a customer → add items → record how much they paid. That\'s it!',
    action:'Next',next:true
  },
  {
    title:'You\'re All Set! 🚀',
    body:'Your dashboard will start showing insights, profit trends, and alerts as you add more data. Check Settings → Automation to set up WhatsApp reminders.',
    action:'Start Using JewelOS',next:false
  }
];

var _wizardStep = 0;
function showOnboardingWizard(){
  var el = document.getElementById('onboard-wizard');
  if(!el) return;
  _wizardStep = 0;
  renderWizardStep();
  el.classList.add('visible');
}

function wizardNext(){
  _wizardStep++;
  if(_wizardStep >= WIZARD_STEPS.length){
    dismissWizard();
  } else {
    renderWizardStep();
  }
}
function wizardBack(){ if(_wizardStep>0){ _wizardStep--; renderWizardStep(); }}
function dismissWizard(){
  var el=document.getElementById('onboard-wizard');
  if(el) el.classList.remove('visible');
  try{ localStorage.setItem(shopScopedKey('jewelos_wizard_done'),'1'); } catch(e){}
}

// Show wizard on first use
(function(){
  var _origBoot = bootApp;
  bootApp = function(){
    _origBoot();
    if(!localStorage.getItem(shopScopedKey('jewelos_wizard_done')) && !S.products.length && !S.sales.length){
      setTimeout(showOnboardingWizard, 1200);
    }
  };
}());

// ── PLAN UPGRADE NUDGES (contextual) ─────────────────────────────────
function checkUpgradeNudge(context){
  var plan = SAAS.plan || 'free';
  if(plan === 'pro') return; // already max

  var nudges = {
    free_products: {
      trigger: plan==='free' && S.products.length >= 40,
      msg: 'You\'re at '+(S.products.length)+'/50 products on Free. Upgrade to Basic for unlimited.',
      requiredPlan:'basic'
    },
    free_reports: {
      trigger: plan==='free',
      msg: 'Unlock smart reports, CSV export, and orders on Basic plan.',
      requiredPlan:'basic'
    },
    basic_girvi: {
      trigger: plan==='basic',
      msg: 'Upgrade to Pro for Girvi loans, WhatsApp automation, and unlimited users.',
      requiredPlan:'pro'
    }
  };

  var nudge = nudges[context];
  if(!nudge || !nudge.trigger) return;

  var existing = document.getElementById('upgrade-nudge-'+context);
  if(existing) return; // already shown

  var div = document.createElement('div');
  div.id = 'upgrade-nudge-'+context;
  div.className = 'upgrade-nudge';
  div.onclick = function(){ document.getElementById('pricing-modal').style.display='block'; };
  div.innerHTML =
    '<div class="upgrade-nudge-icon">\ud83d\ude80</div>'+
    '<div class="upgrade-nudge-text">'+nudge.msg+'</div>'+
    '<div class="upgrade-nudge-cta">Upgrade \u2192</div>';

  // Inject into relevant panel
  var panel = document.getElementById('panel-inventory') || document.getElementById('panel-dashboard');
  if(panel) panel.insertBefore(div, panel.firstChild);
}

// Check nudges after every render
(function(){
  var _origRenderDash = renderDash;
  renderDash = function(){
    _origRenderDash();
    checkUpgradeNudge('free_products');
    checkUpgradeNudge('free_reports');
    checkUpgradeNudge('basic_girvi');
  };
}());

// ─── END GROWTH LAYER v11 ───


// ══════════════════════════════════════════════════════════════════════
// ─── GIRVI ENGINE v12 — Daily Collection Assistant ───────────────────
// Premium rebuild: wizard form, smart list, hinglish WA messages,
// live interest preview, LTV, penalty, renewal, risk intelligence
// ══════════════════════════════════════════════════════════════════════

// ── WIZARD STATE ──────────────────────────────────────────────────────
var GF_STEP        = 1;
var GF_MAX_STEPS   = 5;
var GF_EDIT_ID     = null;
var GF_ITEM_TYPE   = 'Ring';
var GF_ITEMS          = [];
var _gfSuggestedLoan  = 0; // suggested 70% LTV loan amount
var GF_STEP_LABELS = ['Customer Details','Items Pledged','Ornament Photos','Loan Terms','Review & Create'];
var GF_ITEM_TYPES  = [
  {icon:'💍',label:'Ring'},{icon:'⛓',label:'Chain'},{icon:'🔘',label:'Bangle'},
  {icon:'📿',label:'Necklace'},{icon:'✨',label:'Earring'},{icon:'⌚',label:'Watch'},
  {icon:'🏅',label:'Coin'},{icon:'🎁',label:'Set'},{icon:'📦',label:'Other'}
];

function gfGetRate(metal, purity){
  if(!S.rates) return 0;
  if(metal==='silver') return S.rates.sil||95;
  if(purity==='24K') return S.rates.g24||7800;
  if(purity==='22K') return S.rates.g22||7200;
  if(purity==='18K') return S.rates.g18||5900;
  if(purity==='14K') return S.rates.g14||4600;
  return S.rates.g22||7200;
}

function gfItemMktVal(item){
  var wt = parseFloat(item.grossWt||item.weight)||0;
  if(!wt) return 0;
  return gfGetRate(item.metal||'gold', item.purity||'22K') * wt * (parseInt(item.qty)||1);
}

function gfRenderItemCard(idx){
  var item = GF_ITEMS[idx];
  if(!item) return '';
  var mktVal = gfItemMktVal(item);
  var purities = item.metal==='silver' ? ['999','925','800','Other'] : ['24K','22K','20K','18K','14K','Other'];
  var purOpts  = purities.map(function(p){ return '<option'+(p===item.purity?' selected':'')+'>'+p+'</option>'; }).join('');
  var metOpts  = [['gold','Gold'],['silver','Silver'],['diamond','Diamond'],['other','Other']].map(function(m){
    return '<option value="'+m[0]+'"'+(m[0]===item.metal?' selected':'')+'>'+m[1]+'</option>';
  }).join('');
  var typePills = GF_ITEM_TYPES.map(function(t){
    var act = t.label===(item.type||'Ring');
    return '<button data-idx="'+idx+'" data-type="'+t.label+'" onclick="gfSetItemType(parseInt(this.dataset.idx),this.dataset.type)" '+
      'style="padding:5px 10px;border-radius:100px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;'+
      'border:1px solid '+(act?'var(--gold)':'var(--border)')+';background:'+(act?'rgba(201,168,76,.15)':'transparent')+';'+
      'color:'+(act?'var(--gold-dark)':'var(--text2)')+';">'+t.icon+' '+t.label+'</button>';
  }).join('');
  return '<div id="gf-item-card-'+idx+'" style="background:var(--card1);border:1.5px solid rgba(201,168,76,.22);border-radius:13px;padding:12px;margin-bottom:10px;">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;">'+
      '<span style="font-size:10px;font-weight:700;color:var(--gold-dark);text-transform:uppercase;letter-spacing:.07em;">Item '+(idx+1)+'</span>'+
      (GF_ITEMS.length>1?'<button onclick="gfRemoveItem('+idx+')" style="padding:2px 10px;border-radius:100px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08);color:#ef4444;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;">&#10005; Remove</button>':'')+
    '</div>'+
    '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:9px;">'+typePills+'</div>'+
    '<div style="margin-bottom:8px;">'+
      '<div style="font-size:10px;color:var(--gold-dark);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Description</div>'+
      '<input type="text" placeholder="e.g. Ladies 22K gold chain with pendant" value="'+escHtml(item.desc||'')+'" '+
        'data-idx="'+idx+'" oninput="GF_ITEMS[parseInt(this.dataset.idx)].desc=this.value;" '+
        'style="width:100%;box-sizing:border-box;padding:8px 11px;border-radius:9px;border:1.5px solid rgba(201,168,76,.3);background:var(--bg);color:var(--ink);font-size:13px;font-family:inherit;outline:none;">'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">'+
      '<div>'+
        '<div style="font-size:10px;color:var(--gold-dark);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Metal</div>'+
        '<select data-idx="'+idx+'" onchange="gfSetItemMetal(parseInt(this.dataset.idx),this.value)" style="width:100%;padding:9px 10px;border-radius:9px;border:1.5px solid rgba(201,168,76,.3);background:var(--bg);color:var(--ink);font-size:13px;font-family:inherit;outline:none;">'+metOpts+'</select>'+
      '</div>'+
      '<div>'+
        '<div style="font-size:10px;color:var(--gold-dark);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Purity</div>'+
        '<select data-idx="'+idx+'" onchange="GF_ITEMS[parseInt(this.dataset.idx)].purity=this.value;gfUpdateSummary();" style="width:100%;padding:9px 10px;border-radius:9px;border:1.5px solid rgba(201,168,76,.3);background:var(--bg);color:var(--ink);font-size:13px;font-family:inherit;outline:none;">'+purOpts+'</select>'+
      '</div>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">'+
      '<div>'+
        '<div style="font-size:10px;color:var(--gold-dark);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Gross Wt (g)</div>'+
        '<input type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal" value="'+(item.grossWt||'')+'" '+
          'data-idx="'+idx+'" oninput="GF_ITEMS[parseInt(this.dataset.idx)].grossWt=parseFloat(this.value)||0;gfUpdateSummary();" '+
          'style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:9px;border:1.5px solid rgba(201,168,76,.3);background:var(--bg);color:var(--ink);font-size:15px;font-family:inherit;font-weight:700;outline:none;">'+
      '</div>'+
      '<div>'+
        '<div style="font-size:10px;color:var(--gold-dark);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Net Wt (g)</div>'+
        '<input type="number" step="0.01" min="0" placeholder="0.00" inputmode="decimal" value="'+(item.netWt||'')+'" '+
          'data-idx="'+idx+'" oninput="GF_ITEMS[parseInt(this.dataset.idx)].netWt=parseFloat(this.value)||0;" '+
          'style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:9px;border:1.5px solid rgba(201,168,76,.3);background:var(--bg);color:var(--ink);font-size:14px;font-family:inherit;font-weight:600;outline:none;">'+
      '</div>'+
      '<div>'+
        '<div style="font-size:10px;color:var(--gold-dark);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Pieces</div>'+
        '<input type="number" min="1" value="'+(item.qty||1)+'" '+
          'data-idx="'+idx+'" oninput="GF_ITEMS[parseInt(this.dataset.idx)].qty=parseInt(this.value)||1;gfUpdateSummary();" '+
          'style="width:100%;box-sizing:border-box;padding:9px 10px;border-radius:9px;border:1.5px solid rgba(201,168,76,.3);background:var(--bg);color:var(--ink);font-size:15px;font-family:inherit;font-weight:700;outline:none;">'+
      '</div>'+
    '</div>'+
    (mktVal>0?'<div style="margin-top:8px;padding:6px 10px;background:rgba(201,168,76,.07);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">'+
      '<span style="font-size:11px;color:var(--text3);">Market value</span>'+
      '<span style="font-size:13px;font-weight:700;color:var(--gold-dark);">&#8377;'+Math.round(mktVal).toLocaleString('en-IN')+'</span></div>':'')+
  '</div>';
}

function gfRenderItems(){
  var el = document.getElementById('gf-items-list');
  if(!el) return;
  if(!GF_ITEMS.length) GF_ITEMS = [{type:'Ring',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1,desc:''}];
  el.innerHTML = GF_ITEMS.map(function(_,i){ return gfRenderItemCard(i); }).join('');
  gfUpdateSummary();
}

function gfAddItem(){
  GF_ITEMS.push({type:'Ring',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1,desc:''});
  gfRenderItems();
  setTimeout(function(){
    var list=document.getElementById('gf-items-list');
    if(list&&list.lastElementChild) list.lastElementChild.scrollIntoView({behavior:'smooth',block:'center'});
  },80);
}

function gfRemoveItem(idx){
  if(GF_ITEMS.length<=1){toast('At least one item required');return;}
  GF_ITEMS.splice(idx,1);
  gfRenderItems();
}

function gfSetItemType(idx,type){
  if(!GF_ITEMS[idx]) return;
  GF_ITEMS[idx].type=type;
  gfRenderItems();
}

function gfSetItemMetal(idx,metal){
  if(!GF_ITEMS[idx]) return;
  GF_ITEMS[idx].metal=metal;
  GF_ITEMS[idx].purity=metal==='silver'?'999':'22K';
  gfRenderItems();
}

function gfUpdateSummary(){
  var totalWt=0,totalMkt=0;
  GF_ITEMS.forEach(function(item){
    totalWt  +=(parseFloat(item.grossWt)||0)*(parseInt(item.qty)||1);
    totalMkt +=gfItemMktVal(item);
  });
  var suggested=Math.round(totalMkt*0.70/100)*100;
  _gfSuggestedLoan=suggested;
  var el=document.getElementById('gf-items-summary');
  if(el) el.style.display=totalMkt>0?'':'none';
  var ti=document.getElementById('gf-total-items');   if(ti) ti.textContent=GF_ITEMS.length;
  var tw=document.getElementById('gf-total-weight');  if(tw) tw.textContent=totalWt.toFixed(2)+'g';
  var tm=document.getElementById('gf-total-mktval');  if(tm) tm.textContent='\u20b9'+Math.round(totalMkt).toLocaleString('en-IN');
  var sl=document.getElementById('gf-suggested-loan');if(sl) sl.textContent='\u20b9'+suggested.toLocaleString('en-IN');
  if(GF_STEP===4) girviAutoCalc();
}

function gfUseSuggestedLoan(){
  var el=document.getElementById('gf-principal');
  if(el&&_gfSuggestedLoan>0){
    el.value=_gfSuggestedLoan;
    girviAutoCalc();
    toast('\u2705 Loan set to \u20b9'+_gfSuggestedLoan.toLocaleString('en-IN')+' (70% LTV)');
    GF_STEP=4; renderWizardStep();
  }
}

// ── ORNAMENT PHOTOS (wizard step 3) ──────────────────────────────────
// Photographed as the pledge is taken in, then stored on the customer's
// profile so the shop has a record of exactly what came through the door.
//
// STORAGE NOTE: this shop's entire dataset — sales, stock, orders, loans,
// customers — lives in ONE Supabase row, and saveToCloud() already warns at
// 2.5MB against a practical ceiling of about 3MB. Images are therefore
// resized hard before storing, capped per loan, and refused outright when
// the row is close to full: a photo must never be the reason a shop stops
// being able to save its takings. See the report note about moving these to
// Supabase Storage, which is the real fix.
var GF_PHOTOS        = [];       // {id, dataUrl, ts} held until the loan is saved
var GF_MAX_PHOTOS    = 3;
var GF_PHOTO_EDGE    = 512;      // longest edge in px
var GF_PHOTO_QUALITY = 0.55;
var GF_PHOTO_BUDGET  = 2200000;  // stay below saveToCloud's 2.5MB warning

// A phone photo is 2-5MB; at 512px / JPEG 0.55 this lands around 25-50KB.
function gfCompressPhoto(file, cb){
  var reader = new FileReader();
  reader.onload = function(e){
    var img = new Image();
    img.onload = function(){
      var scale = Math.min(1, GF_PHOTO_EDGE / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width  * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      try{
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(c.toDataURL('image/jpeg', GF_PHOTO_QUALITY));
      }catch(err){ cb(null); }
    };
    img.onerror = function(){ cb(null); };
    img.src = e.target.result;
  };
  reader.onerror = function(){ cb(null); };
  reader.readAsDataURL(file);
}

// Roughly how many bytes of the shared row are already spoken for.
function gfBlobBytes(){
  try{
    return JSON.stringify({p:S.products, s:S.sales, g:S.girvi||[],
                           o:S.orders||[], c:S.customers||[]}).length;
  }catch(e){ return GF_PHOTO_BUDGET; }   // unmeasurable: assume full, refuse
}

function gfAddPhotos(input){
  var file = input && input.files && input.files[0];
  input.value = '';                       // so the same file can be re-picked
  if(!file) return;
  if(GF_PHOTOS.length >= GF_MAX_PHOTOS){
    toast('⚠ Up to '+GF_MAX_PHOTOS+' photos per loan');
    return;
  }
  if(!/^image\//.test(file.type)){ toast('⚠ That is not an image'); return; }
  gfCompressPhoto(file, function(dataUrl){
    if(!dataUrl){ toast('⚠ Could not read that photo'); return; }
    if(gfBlobBytes() + dataUrl.length > GF_PHOTO_BUDGET){
      toast('⚠ Storage almost full — photo not added. Your other data is unaffected.');
      return;
    }
    GF_PHOTOS.push({
      id: (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36),
      dataUrl: dataUrl,
      ts: new Date().toISOString()
    });
    gfRenderPhotos();
  });
}

function gfRemovePhoto(id){
  GF_PHOTOS = GF_PHOTOS.filter(function(p){ return p.id !== id; });
  gfRenderPhotos();
}

function gfRenderPhotos(){
  var grid = document.getElementById('gf-photo-grid');
  if(!grid) return;
  grid.innerHTML = GF_PHOTOS.map(function(p){
    return '<div style="position:relative;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--border2);">'+
      '<img src="'+p.dataUrl+'" style="width:100%;height:100%;object-fit:cover;display:block;">'+
      '<button type="button" onclick="gfRemovePhoto(\''+p.id+'\')" title="Remove" '+
        'style="position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:12px;line-height:1;cursor:pointer;">✕</button>'+
    '</div>';
  }).join('');
  var note = document.getElementById('gf-photo-note');
  if(note){
    var kb = Math.round(GF_PHOTOS.reduce(function(s,p){ return s + p.dataUrl.length; }, 0) / 1024);
    note.innerHTML = GF_PHOTOS.length
      ? GF_PHOTOS.length+' of '+GF_MAX_PHOTOS+' photos · about '+kb+'KB. Saved to the customer\'s profile when you create the loan.'
      : 'Optional — you can create the loan without photos.';
  }
}

function openGirviForm(editId, prefill){
  GF_STEP = 1; GF_EDIT_ID = editId || null;
  GF_PHOTOS = [];   // never carry photos over from a previous loan
  var modal = document.getElementById('girvi-modal');
  var title = document.getElementById('girvi-modal-title');

  // Reset all fields
  ['gf-cust','gf-phone','gf-addr','gf-idproof',
   'gf-principal','gf-duration','gf-notes','gf-financer-name','gf-financer-rate'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  var rate=document.getElementById('gf-rate'); if(rate) rate.value=2;
  var rt=document.getElementById('gf-ratetype'); if(rt) rt.value='monthly';
  var cp=document.getElementById('gf-compound'); if(cp) cp.checked=false;
  var frt=document.getElementById('gf-financer-ratetype'); if(frt) frt.value='monthly';
  var risk=document.getElementById('gf-risk'); if(risk) risk.value='medium';
  // gf-metal / gf-purity removed — now managed per-item in GF_ITEMS array
  document.getElementById('gf-start').value = new Date().toISOString().slice(0,10);
  var sb=document.getElementById('gf-save-btn'); if(sb) sb.removeAttribute('data-edit');

  if(editId){
    var g=(S.girvi||[]).find(function(x){return x.id===editId;});
    if(!g) return;
    if(g.status==='closed'){toast('Closed entries cannot be edited');return;}
    title.innerHTML = '✏️ Edit '+escHtml(g.grvNo);
    document.getElementById('gf-cust').value      = g.customer||'';
    document.getElementById('gf-phone').value     = g.phone||'';
    document.getElementById('gf-risk').value      = g.risk||'medium';
    document.getElementById('gf-addr').value      = g.address||'';
    document.getElementById('gf-idproof').value   = g.idProof||'';
    // Load items array (multi-item) or wrap legacy single item
    GF_ITEMS = Array.isArray(g.items)&&g.items.length ? g.items.map(function(it){ return {
        type:it.type||'Ring',metal:it.metal||'gold',purity:it.purity||'22K',
        grossWt:parseFloat(it.weight||it.grossWt)||0,netWt:parseFloat(it.netWt)||0,
        qty:parseInt(it.qty)||1,desc:it.desc||''
      };}) : g.item ? [{type:g.item.type||'Ring',metal:g.item.metal||'gold',
        purity:g.item.purity||'22K',grossWt:parseFloat(g.item.weight)||0,
        netWt:parseFloat(g.item.netWt)||0,qty:parseInt(g.item.qty)||1,desc:g.item.desc||''}]
      : [{type:'Ring',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1,desc:''}];
    document.getElementById('gf-principal').value = g.principal||'';
    document.getElementById('gf-rate').value      = g.interestRate||2;
    document.getElementById('gf-ratetype').value  = g.rateType||'monthly';
    document.getElementById('gf-compound').checked= !!g.compound;
    document.getElementById('gf-financer-name').value = g.financerName||'';
    document.getElementById('gf-financer-rate').value = g.financerRate||'';
    document.getElementById('gf-financer-ratetype').value = g.financerRateType||'monthly';
    document.getElementById('gf-start').value     = g.startDate||'';
    document.getElementById('gf-duration').value  = g.duration||'';
    document.getElementById('gf-notes').value     = g.notes||'';
    GF_ITEM_TYPE = (GF_ITEMS[0]&&GF_ITEMS[0].type) || 'Ring'; // kept for legacy compat only
  } else {
    title.innerHTML = prefill ? ('🪙 New Loan — '+escHtml(prefill.name||'')) : '🪙 New Girvi Entry';
    GF_ITEM_TYPE = 'Ring'; // legacy
    GF_ITEMS = [{type:'Ring',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1,desc:''}];
    if(prefill){
      var cEl=document.getElementById('gf-cust'); if(cEl) cEl.value = prefill.name||'';
      var pEl=document.getElementById('gf-phone'); if(pEl) pEl.value = prefill.phone||'';
    }
  }

  renderWizardStep();
  modal.style.display='block';
  setTimeout(function(){
    // If customer is pre-filled, jump focus straight to loan amount instead
    // of the name field — the useful field to fill next.
    var el=document.getElementById(prefill ? 'gf-principal' : 'gf-cust'); if(el) el.focus();
  },150);
}

// Opens the Girvi wizard pre-filled for adding another loan to an existing
// customer account. Looks the customer up by ID rather than accepting raw
// name/phone strings directly, so this is safe to wire to onclick="..."
// even for names containing apostrophes or quotes (D'Souza, O'Brien, etc.)
// which would otherwise break the attribute string. Phone-based matching
// (linkGirviToCustomer) then links the new loan to the same account
// automatically at save time.
function addGirviLoanForCustomer(custId){
  var c = (S.customers||[]).find(function(x){ return x.id===custId; });
  if(!c){ toast('\u26a0 Customer not found'); return; }
  openGirviForm(null, { name:c.name||'', phone:c.phone||'' });
}

function closeGirviModal(){
  document.getElementById('girvi-modal').style.display='none';
}

function renderWizardStep(){
  // Update step dots
  var nav = document.getElementById('gf-step-nav');
  if(nav){
    nav.innerHTML = '';
    for(var i=1;i<=GF_MAX_STEPS;i++){
      var d=document.createElement('div');
      d.className='gf-step-dot'+(i<GF_STEP?' done':i===GF_STEP?' active':'');
      nav.appendChild(d);
    }
  }
  // Step label
  var lbl=document.getElementById('gf-step-label');
  if(lbl) lbl.textContent='Step '+GF_STEP+' of '+GF_MAX_STEPS+' — '+GF_STEP_LABELS[GF_STEP-1];

  // Show/hide steps
  for(var s=1;s<=GF_MAX_STEPS;s++){
    var el=document.getElementById('gf-step-'+s);
    if(el) el.className='gf-wizard'+(s===GF_STEP?' active':'');
  }

  // Back button
  var bb=document.getElementById('gf-back-btn');
  if(bb) bb.style.display = GF_STEP>1?'':'none';

  // Next/Save button
  var nb=document.getElementById('gf-next-btn');
  if(nb){
    if(GF_STEP===GF_MAX_STEPS){
      nb.textContent='🪙 '+(GF_EDIT_ID?'Update':'Create')+' Girvi';
      nb.style.background='linear-gradient(135deg,#c9a84c,#f0c040)';
    } else {
      nb.textContent='Next →';
      nb.style.background='var(--gold)';
    }
  }

  // Auto-update preview on step 3/4
  if(GF_STEP===2) gfRenderItems();
  if(GF_STEP===3) gfRenderPhotos();
  if(GF_STEP===4||GF_STEP===5) girviAutoCalc();
  if(GF_STEP===5) updateGirviDueDate();
}

function girviWizardNext(){
  // Validate current step
  if(GF_STEP===1){
    var cust=(document.getElementById('gf-cust').value||'').trim();
    var phone=(document.getElementById('gf-phone').value||'').trim();
    if(!cust){toast('\u26a0 Customer name required');document.getElementById('gf-cust').focus();return;}
    if(!phone){toast('\u26a0 Phone number required');document.getElementById('gf-phone').focus();return;}
    if(normPhone(phone).length<10){toast('\u26a0 Enter a valid 10-digit phone number');document.getElementById('gf-phone').focus();return;}
  }
  if(GF_STEP===2){
    var hasWt=GF_ITEMS.some(function(it){return (parseFloat(it.grossWt)||0)>0;});
    if(!hasWt){toast('\u26a0 Enter weight for at least one item');return;}
  }
  if(GF_STEP===4){
    var principal=parseFloat(document.getElementById('gf-principal').value);
    var rate=parseFloat(document.getElementById('gf-rate').value);
    if(!principal||principal<=0){toast('\u26a0 Enter loan amount');document.getElementById('gf-principal').focus();return;}
    if(!rate||rate<=0){toast('\u26a0 Enter interest rate');document.getElementById('gf-rate').focus();return;}
    var _gfStart=document.getElementById('gf-start').value;
    if(!_gfStart){toast('\u26a0 Enter start date');document.getElementById('gf-start').focus();return;}
    if(new Date(_gfStart).getTime() > Date.now()+86400000){toast('\u26a0 Start date cannot be in the future');document.getElementById('gf-start').focus();return;}
    var _gfDur=parseInt(document.getElementById('gf-duration').value);
    if(_gfDur && _gfDur<0){toast('\u26a0 Duration cannot be negative');document.getElementById('gf-duration').focus();return;}
  }
  if(GF_STEP===GF_MAX_STEPS){
    saveGirviEntry();
    return;
  }
  GF_STEP++;
  renderWizardStep();
}

function girviWizardBack(){
  if(GF_STEP>1){ GF_STEP--; renderWizardStep(); }
}

// selectItemType removed — replaced by gfSetItemType() in multi-item builder

function setGirviAmount(amt){
  var el=document.getElementById('gf-principal');
  if(el){ el.value=amt; girviAutoCalc(); }
}

function girviAutoCalc(){
  var p   = parseFloat(document.getElementById('gf-principal').value)||0;
  var r   = parseFloat(document.getElementById('gf-rate').value)||0;
  var rt  = document.getElementById('gf-ratetype').value;
  var cp  = document.getElementById('gf-compound').checked;
  var dur = parseInt(document.getElementById('gf-duration').value)||0;
  var rm  = rt==='yearly'?r/12:r;

  var prev3  = document.getElementById('gf-preview');
  var prevF  = document.getElementById('gf-final-preview');
  if(!p||!r){ if(prev3) prev3.style.display='none'; if(prevF) prevF.style.display='none'; return; }

  var m1   = p*rm/100;
  var m3   = cp?p*(Math.pow(1+rm/100,3)-1):p*rm/100*3;
  var m6   = cp?p*(Math.pow(1+rm/100,6)-1):p*rm/100*6;
  var mDur = dur?(cp?p*(Math.pow(1+rm/100,dur)-1):p*rm/100*dur):0;
  var payable = p + (dur?mDur:m6);

  var rowsHtml =
    '<div class="girvi-preview-row"><span>Principal</span><span style="font-weight:700;">\u20b9'+Math.round(p).toLocaleString('en-IN')+'</span></div>'+
    '<div class="girvi-preview-row"><span>Interest per month</span><span>\u20b9'+Math.round(m1).toLocaleString('en-IN')+'</span></div>'+
    (dur?'<div class="girvi-preview-row"><span>Interest for '+dur+' months</span><span style="color:#f59e0b;">\u20b9'+Math.round(mDur).toLocaleString('en-IN')+'</span></div>':
         '<div class="girvi-preview-row"><span>Interest @ 6 months</span><span style="color:#f59e0b;">\u20b9'+Math.round(m6).toLocaleString('en-IN')+'</span></div>');

  var totalHtml = '\u20b9'+Math.round(payable).toLocaleString('en-IN');

  var pr=document.getElementById('gf-preview-rows'); if(pr) pr.innerHTML=rowsHtml;
  var pt=document.getElementById('gf-preview-total'); if(pt) pt.textContent=totalHtml;
  if(prev3) prev3.style.display='';

  // Final preview (step 4)
  if(prevF){
    var start = (document.getElementById('gf-start').value)||new Date().toISOString().slice(0,10);
    var dueStr='';
    if(dur){var d=new Date(start);d.setMonth(d.getMonth()+dur);dueStr=fmtDate(d.toISOString().slice(0,10));}
    var cust=(document.getElementById('gf-cust').value||'').trim();
    var _tw=GF_ITEMS.reduce(function(s,it){return s+(parseFloat(it.grossWt)||0)*(parseInt(it.qty)||1);},0);
    var _tm=GF_ITEMS.reduce(function(s,it){return s+gfItemMktVal(it);},0);
    var fr=document.getElementById('gf-final-rows');
    var _irows=GF_ITEMS.filter(function(it){return (parseFloat(it.grossWt)||0)>0;}).map(function(it,i){
      return '<div class="girvi-preview-row"><span>Item '+(i+1)+' ('+escHtml(it.type||'Item')+')</span><span>'+
        (it.desc?escHtml(it.desc)+' · ':'')+it.purity+' '+it.metal+' · '+it.grossWt+'g'+(it.qty>1?' \xd7'+it.qty:'')+
        (gfItemMktVal(it)>0?' · \u20b9'+Math.round(gfItemMktVal(it)).toLocaleString('en-IN'):'')+
      '</span></div>';
    }).join('');
    if(fr) fr.innerHTML=
      '<div class="girvi-preview-row"><span>Customer</span><span style="font-weight:700;">'+escHtml(cust)+'</span></div>'+
      _irows+
      (_tm>0?'<div class="girvi-preview-row"><span>Total Mkt Value</span><span style="color:var(--gold-dark);font-weight:700;">\u20b9'+Math.round(_tm).toLocaleString('en-IN')+'</span></div>':'')+
      '<div class="girvi-preview-row"><span>Loan Amount</span><span style="font-weight:700;">\u20b9'+Math.round(p).toLocaleString('en-IN')+'</span></div>'+
      '<div class="girvi-preview-row"><span>Rate</span><span>'+r+'% '+(rt==='yearly'?'per year':'per month')+(cp?' (compound)':'')+' </span></div>'+
      (dur?'<div class="girvi-preview-row"><span>Due Date</span><span style="color:var(--gold);font-weight:700;">'+dueStr+'</span></div>':'')+
      '<div class="girvi-preview-row" style="border-top:1px solid rgba(201,168,76,.2);margin-top:6px;padding-top:6px;font-weight:700;"><span>Total Payable</span><span style="color:var(--gold);">\u20b9'+Math.round(payable).toLocaleString('en-IN')+'</span></div>';
    prevF.style.display='';
  }
}

function updateGirviDueDate(){
  var start = document.getElementById('gf-start').value;
  var dur   = parseInt(document.getElementById('gf-duration').value)||0;
  var el    = document.getElementById('gf-duedate-display');
  if(!el) return;
  if(start && dur){
    var d = new Date(start);
    d.setMonth(d.getMonth()+dur);
    el.textContent = fmtDate(d.toISOString().slice(0,10));
  } else {
    el.textContent = dur?'Set start date':'No fixed term';
  }
}

// ── SAVE ENTRY (replaces old) ──────────────────────────────────────────
function saveGirviEntry(){
  // Creating a NEW loan is blocked read-only; editing an existing one is not,
  // and taking a repayment (submitGirviPayment) is deliberately never blocked.
  if(!GF_EDIT_ID && !subGuard('creating a new girvi loan')) return;
  var cust      = (document.getElementById('gf-cust').value||'').trim();
  var phone     = (document.getElementById('gf-phone').value||'').trim();
  var principal = parseFloat(document.getElementById('gf-principal').value);
  var rate      = parseFloat(document.getElementById('gf-rate').value);
  if(!cust)         {toast('\u26a0 Customer name required');return;}
  if(!phone)        {toast('\u26a0 Phone required');return;}
  if(!principal||principal<=0){toast('\u26a0 Loan amount required');return;}
  if(!rate||rate<=0){toast('\u26a0 Interest rate required');return;}

  var _si=GF_ITEMS.filter(function(it){return (parseFloat(it.grossWt)||0)>0;});
  if(!_si.length){toast('\u26a0 At least one item with weight required');return;}

  if(GF_EDIT_ID){
    // ── EDIT PATH: update the existing record only. No new record is created. ──
    var idx=(S.girvi||[]).findIndex(function(x){return x.id===GF_EDIT_ID;});
    if(idx===-1){toast('Not found');return;}
    var g=S.girvi[idx];
    if(!g.ledger)g.ledger=[];
    g.ledger.push({type:'edit',note:'Entry edited',ts:new Date().toISOString()});
    g.customer=cust; g.phone=phone; g.risk=document.getElementById('gf-risk').value;
    g.address=(document.getElementById('gf-addr').value||'').trim();
    g.idProof=(document.getElementById('gf-idproof').value||'').trim().toUpperCase();
    g.items=_si.map(function(it){return {type:it.type,metal:it.metal,purity:it.purity,
      weight:parseFloat(it.grossWt)||0,netWt:parseFloat(it.netWt)||0,qty:parseInt(it.qty)||1,desc:it.desc};});
    g.item=g.items[0]; // legacy compat
    g.principal=principal; g.interestRate=rate; g.rateType=document.getElementById('gf-ratetype').value;
    g.compound=document.getElementById('gf-compound').checked;
    g.financerName=(document.getElementById('gf-financer-name').value||'').trim();
    g.financerRate=parseFloat(document.getElementById('gf-financer-rate').value)||0;
    g.financerRateType=document.getElementById('gf-financer-ratetype').value;
    g.startDate=document.getElementById('gf-start').value;
    g.duration=parseInt(document.getElementById('gf-duration').value)||0;
    g.notes=(document.getElementById('gf-notes').value||'').trim();
    g.status=girviComputeStatus(g);
    linkGirviToCustomer(g);
    closeGirviModal();
    if(typeof saasActivityLog==='function') saasActivityLog('girvi','Girvi updated: '+(g.grvNo||'')+' \u20b9'+principal);
    saveToCloud(function(err){
      if(!err){renderGirvi();renderDash();toast('\u2705 Girvi updated!');}
    });
    return;
  }

  // ── CREATE PATH: build a brand-new record and push it. ──────────────────
  var _grvFormData = {
    id:(typeof crypto.randomUUID==='function')?crypto.randomUUID():(Date.now().toString(36)+Math.random().toString(36).slice(2)),
    createdAt:new Date().toISOString(),
    customer:cust, phone:phone, risk:document.getElementById('gf-risk').value,
    address:(document.getElementById('gf-addr').value||'').trim(),
    idProof:(document.getElementById('gf-idproof').value||'').trim().toUpperCase(),
    items:_si.map(function(it){return {type:it.type,metal:it.metal,purity:it.purity,
      weight:parseFloat(it.grossWt)||0,netWt:parseFloat(it.netWt)||0,qty:parseInt(it.qty)||1,desc:it.desc};}),
    item:(function(){ var fi=_si[0];
      return {type:fi.type,metal:fi.metal,purity:fi.purity,weight:parseFloat(fi.grossWt)||0,netWt:parseFloat(fi.netWt)||0,qty:parseInt(fi.qty)||1,desc:fi.desc}; })(),
    principal:principal,interestRate:rate,rateType:document.getElementById('gf-ratetype').value,
    compound:document.getElementById('gf-compound').checked,
    financerName:(document.getElementById('gf-financer-name').value||'').trim(),
    financerRate:parseFloat(document.getElementById('gf-financer-rate').value)||0,
    financerRateType:document.getElementById('gf-financer-ratetype').value,
    startDate:document.getElementById('gf-start').value,
    duration:parseInt(document.getElementById('gf-duration').value)||0,
    notes:(document.getElementById('gf-notes').value||'').trim(),
    status:'active',payments:[],
    ledger:[{type:'created',note:'Girvi created \u20b9'+principal,ts:new Date().toISOString()}]
  };
  getNextGrvNo(function(grvNo){
    _grvFormData.grvNo = grvNo;
    _grvFormData._seq  = S.nextGirviId;
    if(!S.girvi) S.girvi=[];
    S.girvi.push(_grvFormData);
    var _gCust = linkGirviToCustomer(_grvFormData);
    // Ornament photos from step 3 live on the customer's profile, each tagged
    // with the loan it was taken for. Stored once, on the customer only — the
    // loan keeps a count, not a second copy of the image data.
    if(_gCust && GF_PHOTOS.length){
      if(!Array.isArray(_gCust.ornamentPhotos)) _gCust.ornamentPhotos = [];
      GF_PHOTOS.forEach(function(p){
        _gCust.ornamentPhotos.push({id:p.id, dataUrl:p.dataUrl, ts:p.ts,
                                    girviId:_grvFormData.id, grvNo:grvNo});
      });
      _grvFormData.photoCount = GF_PHOTOS.length;
      GF_PHOTOS = [];
    }
    S.nextGirviId++;
    closeGirviModal();
    if(typeof saasActivityLog==='function') saasActivityLog('girvi','Girvi created: '+grvNo+' \u20b9'+principal);
    saveToCloud(function(err){
      if(!err){renderGirvi();renderDash();toast('\u2705 Girvi created! '+grvNo);}
      else{toast('\u26a0 Saved locally but cloud sync failed — will retry');renderGirvi();renderDash();}
    });
  });
}

// ── CONTROL PANEL RENDERER ────────────────────────────────────────────
function renderGirviCP(){
  var girvi     = (S.girvi||[]).filter(function(g){return !g._deleted;});
  var active    = girvi.filter(function(g){return g.status==='active';});
  var overdue   = girvi.filter(function(g){return g.status==='overdue'||g.status==='atrisk';});
  var defaulted = girvi.filter(function(g){return g.status==='defaulted';});
  var totalOut  = active.concat(overdue).reduce(function(s,g){return s+girviOutstanding(g);},0);
  var totalInt  = girvi.filter(function(g){return g.status!=='defaulted';}).reduce(function(s,g){return s+girviInterestAccrued(g);},0);
  var el = document.getElementById('girvi-cp');
  if(!el) return;
  el.innerHTML=
    '<div class="girvi-cp-title">🪙 Girvi Portfolio</div>'+
    '<div class="girvi-kpi-row">'+
      '<div class="girvi-kpi"><div class="girvi-kpi-val">'+active.length+'</div><div class="girvi-kpi-lbl">Active</div></div>'+
      '<div class="girvi-kpi"><div class="girvi-kpi-val">\u20b9'+kFmt(totalOut)+'</div><div class="girvi-kpi-lbl">Lent Out</div></div>'+
      '<div class="girvi-kpi"><div class="girvi-kpi-val success">\u20b9'+kFmt(totalInt)+'</div><div class="girvi-kpi-lbl">Interest</div></div>'+
      '<div class="girvi-kpi"><div class="girvi-kpi-val '+(overdue.length+defaulted.length>0?'danger':'success')+'">'+(overdue.length+defaulted.length)+'</div><div class="girvi-kpi-lbl">Overdue</div></div>'+
    '</div>';
}

function kFmt(n){
  if(n>=100000) return (n/100000).toFixed(1)+'L';
  if(n>=1000)   return Math.round(n/1000)+'K';
  return Math.round(n).toString();
}

// ── TODAY'S ACTIONS ───────────────────────────────────────────────────
function renderGirviTodayActions(){
  var el = document.getElementById('girvi-today-actions');
  if(!el) return;
  var girvi = (S.girvi||[]).filter(function(g){return !g._deleted;});
  var now   = new Date();
  var today = now.toISOString().slice(0,10);
  var actions = [];

  girvi.forEach(function(g){
    if(g.status==='closed') return;
    var outstanding = girviOutstandingWithPenalty(g).amount;
    var daysObj     = girviDaysInfo(g);

    var type='', urgency='blue';
    if(daysObj.overdue > 0){
      type = '\ud83d\udd34 '+daysObj.overdue+'d overdue';
      urgency = 'red';
    } else if(daysObj.dueDate && daysObj.daysLeft <= 7){
      type = '\u23f0 Due in '+daysObj.daysLeft+'d';
      urgency = daysObj.daysLeft<=3?'red':'amber';
    } else if(g.status==='defaulted'){
      type = '\u274c Defaulted';
      urgency = 'red';
    } else {
      return; // active and not near due — skip from today's list
    }

    actions.push({g:g, type:type, urgency:urgency, outstanding:outstanding, daysObj:daysObj});
  });

  // Sort: overdue first, then by amount desc
  actions.sort(function(a,b){
    var aOv=a.daysObj.overdue>0?0:1, bOv=b.daysObj.overdue>0?0:1;
    return aOv!==bOv ? aOv-bOv : b.outstanding-a.outstanding;
  });

  if(!actions.length){
    el.innerHTML='<div style="display:flex;align-items:center;gap:10px;padding:10px 0;font-size:13px;color:var(--text3);">'+
      '<span style="font-size:22px;">\u2705</span>'+
      '<span>Sab theek hai! No overdue loans or urgent follow-ups today.</span>'+
    '</div>';
    return;
  }

  el.innerHTML = actions.slice(0,8).map(function(a){
    var g = a.g;
    return '<div class="girvi-action '+a.urgency+'" onclick="openGirviDetail(\''+g.id+'\')">'+
      '<div class="girvi-action-icon">'+(a.urgency==='red'?'\ud83d\udd34':a.urgency==='amber'?'\u26a0\ufe0f':'\ud83d\udfe6')+'</div>'+
      '<div class="girvi-action-body">'+
        '<div class="girvi-action-name">'+escHtml(g.customer)+'</div>'+
        '<div class="girvi-action-sub">'+g.grvNo+' &bull; '+a.type+' &bull; '+(g.item.desc||g.item.metal||'')+'</div>'+
        '<div class="girvi-action-btns" onclick="event.stopPropagation();">'+
          '<button class="girvi-action-btn gab-call" onclick="callCustomer(\''+jsAttrEsc(g.phone)+'\')">📞 Call</button>'+
          '<button class="girvi-action-btn gab-wa"   onclick="girviWhatsApp(\''+g.id+'\')">💬 WA</button>'+
          '<button class="girvi-action-btn gab-pay"  onclick="openGirviPayment(\''+g.id+'\')">₹ Pay</button>'+
        '</div>'+
      '</div>'+
      '<div class="girvi-action-right">'+
        '<div class="girvi-action-amt" style="color:'+(a.urgency==='red'?'#ef4444':'#f59e0b')+'">\u20b9'+kFmt(Math.round(a.outstanding))+'</div>'+
        '<div class="girvi-action-days">outstanding</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

// ── GIRVI CARD LIST ────────────────────────────────────────────────────
function renderGirvi(){
  var girvi  = (S.girvi||[]).filter(function(g){return !g._deleted;});
  var search = ((document.getElementById('girvi-search')||{}).value||'').toLowerCase().trim();
  var filter = ((document.getElementById('girvi-filter-status')||{}).value)||'all';

  var _bycustBtn = document.getElementById('girvi-chip-bycust');
  if(_bycustBtn) _bycustBtn.classList.toggle('active', GIRVI_VIEW_MODE==='customer');

  // Refresh statuses
  girvi.forEach(function(g){
    if(g.status!=='closed'&&g.status!=='defaulted') g.status=girviComputeStatus(g);
  });

  renderGirviCP();
  renderGirviTodayActions();

  var list = girvi.filter(function(g){
    var ms = !search||(g.customer||'').toLowerCase().includes(search)||
      (g.phone||'').includes(search)||(g.grvNo||'').toLowerCase().includes(search)||
      ((g.item&&g.item.desc)||'').toLowerCase().includes(search);
    return ms && (filter==='all'||g.status===filter);
  });

  var ord={atrisk:0,defaulted:1,overdue:2,active:3,closed:4};
  list.sort(function(a,b){
    var d=(ord[a.status]||3)-(ord[b.status]||3);
    return d!==0?d:new Date(b.createdAt)-new Date(a.createdAt);
  });

  var listEl = document.getElementById('girvi-list');
  if(!listEl) return;

  if(!list.length){
    listEl.innerHTML='<div style="text-align:center;padding:3rem 1rem;color:var(--text3);">'+
      (search||filter!=='all'
        ?'<div style="font-size:28px;margin-bottom:8px;">🔍</div><div>No results found</div>'
        :'<div style="font-size:40px;margin-bottom:10px;">🪙</div>'+
         '<div style="font-size:15px;font-weight:700;margin-bottom:6px;">Koi girvi entry nahi hai</div>'+
         '<div style="font-size:13px;margin-bottom:14px;">Tap + New Girvi to start tracking loans</div>'+
         '<button class="btn btn-gold" onclick="openGirviForm()" style="padding:12px 24px;font-size:14px;">+ New Girvi</button>')+
    '</div>';
    return;
  }

  // NOTE: this function is intentionally simple (flat list, no grouping).
  // It is overridden by js/08-girvi-viewmode.js at load time (search
  // "FULL renderGirvi OVERRIDE"), which adds the exec dashboard, chip
  // filters, and delegates to renderGirviByCustomer() when the user has
  // "By Customer" view active. This copy only exists as an unused
  // pre-override fallback baseline and never actually runs in the app —
  // kept simple on purpose so it doesn't drift from what's really live.

  // Virtual scroll: render 25 at a time to keep DOM lean
  var GIRVI_PAGE = 25;
  var _gPage = parseInt(listEl.dataset.page||0);
  var pageItems = list.slice(0, (_gPage+1)*GIRVI_PAGE);
  var hasMore = list.length > pageItems.length;

  listEl.innerHTML = pageItems.map(function(g){ return girviLoanCardHTML(g); }).join('');

  // Load More button for virtual scroll
  if(hasMore){
    listEl.innerHTML += '<div style="text-align:center;padding:12px 0;">' +
      '<button onclick="(function(){var el=document.getElementById(\'girvi-list\');el.dataset.page=(parseInt(el.dataset.page||0)+1);renderGirvi();})()" ' +
      'class="btn btn-gold" style="padding:10px 28px;font-size:13px;">' +
      '⬇ Load more (' + (list.length - pageItems.length) + ' remaining)' +
      '</button></div>';
  }

  // Show total count
  var countEl = document.getElementById('girvi-count-label');
  if(countEl) countEl.textContent = 'Showing ' + pageItems.length + ' of ' + list.length;
}

function girviLoanCardHTML(g){
    var outstanding = girviOutstanding(g);
    var interest    = girviInterestAccrued(g);
    var penalty     = girviOutstandingWithPenalty(g).penalty;
    var daysInfo    = girviDaysInfo(g);
    var status      = g.status;
    var ltv         = girviLTV(g);
    var ltvL        = girviLTVLabel(ltv);

    // Outstanding color
    var outColor = status==='closed'?'green':status==='defaulted'?'red':
      daysInfo.overdue>0?'red':daysInfo.daysLeft<=7&&daysInfo.daysLeft>=0?'amber':'normal';

    // Days badge
    var daysBadge='', daysBadgeClass='days-na';
    if(status==='closed'){
      daysBadge='Released'; daysBadgeClass='days-safe';
    } else if(status==='defaulted'){
      daysBadge='Defaulted'; daysBadgeClass='days-overdue';
    } else if(daysInfo.overdue>0){
      daysBadge=daysInfo.overdue+'d overdue'; daysBadgeClass='days-overdue';
    } else if(daysInfo.daysLeft>=0){
      daysBadge=daysInfo.daysLeft===0?'Due today!':daysInfo.daysLeft+'d left';
      daysBadgeClass=daysInfo.daysLeft<=3?'days-overdue':daysInfo.daysLeft<=7?'days-soon':'days-safe';
    } else {
      daysBadge='No term set'; daysBadgeClass='days-na';
    }

    var canAct = status!=='closed';

    return '<div class="girvi-card status-'+status+'" onclick="openGirviDetail(\''+g.id+'\')">'+
      '<div class="girvi-card-top">'+
        '<div class="girvi-card-meta">'+
          '<div>'+
            '<span class="girvi-card-id">'+g.grvNo+'</span>'+
            ' <span class="girvi-card-days '+daysBadgeClass+'">'+daysBadge+'</span>'+
            ' '+girviRiskBadge(g.risk)+
          '</div>'+
          '<div class="girvi-card-date">'+fmtDate(g.startDate)+'</div>'+
        '</div>'+
        '<div class="girvi-card-body">'+
          '<div class="girvi-card-left">'+
            '<div class="girvi-card-name">'+escHtml(g.customer)+'</div>'+
            '<div class="girvi-card-phone">\uD83D\uDCDE '+escHtml(g.phone)+'</div>'+
            (function(){
              var _ci=Array.isArray(g.items)&&g.items.length?g.items:(g.item?[g.item]:[]);
              var _cw=_ci.reduce(function(s,it){return s+(parseFloat(it.weight||it.grossWt)||0)*(parseInt(it.qty)||1);},0);
              if(_ci.length===1){var it=_ci[0];
                return '<div class="girvi-card-item">'+(it.desc||it.type||'Item')+
                  ' &bull; '+(it.purity||'')+' '+(it.metal||'')+(_cw?' &bull; '+_cw+'g':'')+' &bull; Mkt: &#8377;'+
                  Math.round(getRate(it.metal||'gold',it.purity||'22K')*_cw).toLocaleString('en-IN')+'</div>';
              }
              return '<div class="girvi-card-item"><span style="background:rgba(201,168,76,.15);color:var(--gold-dark);font-weight:700;font-size:10px;padding:1px 6px;border-radius:8px;margin-right:4px;">'+_ci.length+' items</span>'+
                _cw.toFixed(2)+'g &bull; '+_ci.map(function(it){return it.type||'Item';}).join(', ')+'</div>';
            })()+
          '</div>'+
          '<div class="girvi-card-right">'+
            '<div class="girvi-card-outstanding '+outColor+'">\u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</div>'+
            '<div class="girvi-card-principal">₹'+Math.round(g.principal).toLocaleString('en-IN')+' @ '+g.interestRate+'%'+(g.rateType==='yearly'?'/yr':'/mo')+'</div>'+
            (interest>0?'<div class="girvi-card-interest">+\u20b9'+Math.round(interest).toLocaleString('en-IN')+' interest</div>':'')+
            (penalty>0?'<div style="font-size:10px;color:#ef4444;font-weight:700;">+\u20b9'+Math.round(penalty).toLocaleString('en-IN')+' penalty</div>':'')+
            '<div style="font-size:10px;color:'+ltvL.color+';margin-top:2px;">'+ltvL.icon+' LTV '+(ltv*100).toFixed(0)+'%</div>'+
          '</div>'+
        '</div>'+
      '</div>'+
      (canAct?
        '<div class="girvi-card-actions" onclick="event.stopPropagation();">'+
          '<button class="gca call-btn" onclick="callCustomer(\''+jsAttrEsc(g.phone)+'\')">'+
            '<span class="gca-icon">\uD83D\uDCDE</span>Call'+
          '</button>'+
          '<button class="gca wa-btn" onclick="girviWhatsApp(\''+g.id+'\')">'+
            '<span class="gca-icon">\uD83D\uDCAC</span>WhatsApp'+
          '</button>'+
          '<button class="gca pay-btn" onclick="openGirviPayment(\''+g.id+'\')">'+
            '<span class="gca-icon">₹</span>Pay'+
          '</button>'+
          '<button class="gca" onclick="openGirviDetail(\''+g.id+'\')">'+
            '<span class="gca-icon">\uD83D\uDCCB</span>Details'+
          '</button>'+
        '</div>'
      :'<div style="text-align:center;font-size:11px;color:var(--text3);padding:8px;border-top:0.5px solid var(--border);">\uD83D\uDD12 Closed '+(g.closedAt?fmtDate(g.closedAt):'')+'</div>')+
    '</div>';
}

// Reset girvi page on filter/search change
function resetGirviPage(){
  var el = document.getElementById('girvi-list');
  if(el) el.dataset.page = '0';
  renderGirvi();
}

// ── DAYS HELPER ───────────────────────────────────────────────────────
function girviDaysInfo(g){
  var duration = parseInt(g.duration)||0;
  if(!duration) return {overdue:0, daysLeft:-1, dueDate:null};
  var dueDate = new Date(g.startDate);
  dueDate.setMonth(dueDate.getMonth()+duration);
  var diff = Math.ceil((dueDate-Date.now())/86400000);
  return {
    overdue:   diff<0 ? Math.abs(diff) : 0,
    daysLeft:  diff>=0 ? diff : -1,
    dueDate:   dueDate
  };
}

// ── DIRECT CALL ────────────────────────────────────────────────────────
function callCustomer(phone){
  if(!phone){toast('\u26a0 No phone number');return;}
  window.location.href = 'tel:'+phone.replace(/\D/g,'');
}

// ── WHATSAPP — HINGLISH TEMPLATES ─────────────────────────────────────
function girviWhatsApp(gid){
  var g = (S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  var shopName  = (SAAS&&SAAS.shop&&SAAS.shop.name)||'hamari dukaan';
  var outstanding = girviOutstandingWithPenalty(g).amount;
  var daysInfo    = girviDaysInfo(g);
  var msg;

  var _waItems = Array.isArray(g.items)&&g.items.length ? g.items : (g.item?[g.item]:[]);
  var _waItemDesc = _waItems.length===1 ? (_waItems[0].desc||_waItems[0].type||'Item') : _waItems.length+' items';
  if(daysInfo.overdue>0){
    // Overdue — urgent tone
    msg = 'नमस्ते '+g.customer+' ji 🙏\n\n'+
      'Aapka *'+shopName+'* mein girvi loan overdue ho gaya hai.\n\n'+
      'Girvi No: *'+g.grvNo+'*\n'+
      'Item: '+_waItemDesc+'\n'+
      'Loan Amount: ₹'+Math.round(g.principal).toLocaleString('en-IN')+'\n'+
      '*Total Payable: ₹'+Math.round(outstanding).toLocaleString('en-IN')+'*\n'+
      '('+daysInfo.overdue+' din overdue)\n\n'+
      'Kripya *aaj hi* shop par aayen ya payment karein, warna penalty badhti rahegi.\n\n'+
      '_'+shopName+'_';
  } else if(daysInfo.daysLeft>=0 && daysInfo.daysLeft<=7){
    // Due soon
    msg = 'Namaste '+g.customer+' ji 🙏\n\n'+
      '*'+shopName+'* se yaad dila rahe hain —\n\n'+
      'Aapka girvi loan *'+daysInfo.daysLeft+' din mein due* hai.\n\n'+
      'Girvi No: *'+g.grvNo+'*\n'+
      'Item: '+_waItemDesc+'\n'+
      '*Outstanding: ₹'+Math.round(outstanding).toLocaleString('en-IN')+'*\n'+
      (daysInfo.dueDate?'Due Date: '+fmtDate(daysInfo.dueDate.toISOString().slice(0,10))+'\n':'')+
      '\nSamay par payment karein. Koi bhi sahayta ke liye hum available hain.\n\n'+
      '_'+shopName+'_';
  } else {
    // General reminder
    msg = 'Namaste '+g.customer+' ji 🙏\n\n'+
      '*'+shopName+'* mein aapka girvi loan active hai.\n\n'+
      'Girvi No: *'+g.grvNo+'*\n'+
      'Item: '+_waItemDesc+'\n'+
      'Principal: ₹'+Math.round(g.principal).toLocaleString('en-IN')+'\n'+
      '*Outstanding: ₹'+Math.round(outstanding).toLocaleString('en-IN')+'*\n\n'+
      'Kisi bhi payment ya query ke liye shop par aayen.\n\n'+
      '_'+shopName+'_';
  }

  if(typeof saasActivityLog==='function') saasActivityLog('whatsapp','Girvi reminder sent to '+g.customer);
  var phone = g.phone.replace(/\D/g,'');
  if(phone.length===10) phone='91'+phone;
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
}

// ── PREMIUM DETAIL VIEW — Features 2, 3, 7, 11 ─────────────────────────
function openGirviDetail(gid){
  var g = (S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g) return;
  var outstanding   = girviOutstanding(g);
  var penObj        = girviOutstandingWithPenalty(g);
  var interest      = girviInterestAccrued(g);
  var penalty       = penObj.penalty;
  var totalPaid     = girviTotalPaid(g);
  var _daysElapsed  = girviDaysSince(g.startDate);
  var ymd           = girviExactDuration(g.startDate);
  var status        = g.status;
  var ltv           = girviLTV(g);
  var ltvL          = girviLTVLabel(ltv);
  var daysInfo      = girviDaysInfo(g);
  var _allIt = Array.isArray(g.items)&&g.items.length ? g.items : (g.item?[g.item]:[]);
  var mktVal   = _allIt.reduce(function(s,it){ return s+getRate(it.metal||'gold',it.purity||'22K')*(parseFloat(it.weight||it.grossWt)||0)*(parseInt(it.qty)||1);},0);
  var canAct        = status!=='closed';

  // ── Feature 2: Editable final amount ──────────────────────────────────
  var calcTotal     = penObj.amount; // system-calculated, never overwritten
  var displayAmt    = (g.adjustedAmount!=null) ? g.adjustedAmount : calcTotal;
  var adjDiff       = (g.adjustedAmount!=null) ? (g.adjustedAmount - calcTotal) : 0;
  var adjHtml = canAct ?
    '<div style="background:var(--card2);border:1px solid var(--border2);border-radius:12px;padding:13px;margin-bottom:14px;">'+
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:10px;">✏️ Payable Amount</div>'+
      '<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">'+
        '<div style="flex:1;">'+
          '<div style="font-size:10px;color:var(--text3);margin-bottom:3px;">System Calculated</div>'+
          '<div style="font-size:16px;font-weight:800;color:var(--text2);">₹'+Math.round(calcTotal).toLocaleString('en-IN')+'</div>'+
        '</div>'+
        '<div style="font-size:18px;color:var(--text3);">→</div>'+
        '<div style="flex:1;">'+
          '<div style="font-size:10px;color:var(--text3);margin-bottom:3px;">Owner Adjusted</div>'+
          '<input id="gd-adj-amount" type="number" step="100" value="'+(g.adjustedAmount!=null?Math.round(g.adjustedAmount):'')+'"'+
            ' placeholder="'+Math.round(calcTotal)+'"'+
            ' oninput="gdPreviewAdj('+Math.round(calcTotal)+')"'+
            ' style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:9px;border:1.5px solid var(--gold);background:rgba(201,168,76,.05);color:var(--text1);font-size:15px;font-weight:800;font-family:inherit;">'+
        '</div>'+
      '</div>'+
      (adjDiff!==0?'<div id="gd-adj-diff" style="font-size:12px;color:'+(adjDiff<0?'#22c55e':'#f59e0b')+';font-weight:600;margin-bottom:8px;">'+
        (adjDiff<0?'🟢 Discount/Waiver: ₹'+Math.round(Math.abs(adjDiff)).toLocaleString('en-IN'):'🟡 Extra Charge: ₹'+Math.round(adjDiff).toLocaleString('en-IN'))+
      '</div>':'<div id="gd-adj-diff" style="font-size:12px;color:var(--text3);margin-bottom:8px;"></div>')+
      '<select id="gd-adj-reason" style="width:100%;padding:8px 10px;border-radius:9px;border:1px solid var(--border);background:var(--card2);color:var(--text1);font-size:13px;font-family:inherit;margin-bottom:8px;">'+
        '<option value="">-- Select Reason --</option>'+
        '<option value="Round Off">Round Off</option>'+
        '<option value="Discount">Discount</option>'+
        '<option value="Relationship Customer">Relationship Customer</option>'+
        '<option value="Special Case">Special Case</option>'+
        '<option value="Manual Correction">Manual Correction</option>'+
        '<option value="Other">Other</option>'+
      '</select>'+
      '<div style="display:flex;gap:7px;">'+
        '<button onclick="gdSaveAdjAmount(\''+gid+'\')" style="flex:1;padding:9px;border-radius:9px;border:none;background:var(--gold);color:#1a1200;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">✅ Set Amount</button>'+
        (g.adjustedAmount!=null?'<button onclick="gdResetAdjAmount(\''+gid+'\')" style="padding:9px 13px;border-radius:9px;border:1px solid var(--border);background:var(--card2);color:var(--text2);font-size:12px;cursor:pointer;font-family:inherit;">↺ Reset</button>':'')+
      '</div>'+
      (g.amountAdjLog&&g.amountAdjLog.length?
        '<div style="margin-top:8px;font-size:11px;color:var(--text3);">Last adjustment: '+
        fmtDate(g.amountAdjLog[g.amountAdjLog.length-1].ts)+' by '+
        escHtml(g.amountAdjLog[g.amountAdjLog.length-1].user)+' — '+
        escHtml(g.amountAdjLog[g.amountAdjLog.length-1].reason||'No reason')+
        '</div>':'')+
    '</div>'
  : '';

  // ── Feature 3: Enhanced duration display ──────────────────────────────
  var durationStr = '';
  if(ymd.years>0) durationStr += ymd.years+' yr'+(ymd.years>1?'s':'')+' ';
  if(ymd.months>0) durationStr += ymd.months+' mo ';
  if(ymd.days>0 || (!ymd.years&&!ymd.months)) durationStr += ymd.days+' day'+(ymd.days!==1?'s':'');

  // ── Feature 7: Notes ──────────────────────────────────────────────────
  var notesRows = (g.notesList||[]).slice().reverse().map(function(n){
    return '<div style="padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.025);margin-bottom:6px;">'+
      '<div style="font-size:13px;color:var(--text1);">'+escHtml(n.text)+'</div>'+
      '<div style="font-size:10px;color:var(--text3);margin-top:3px;">'+fmtDate(n.ts)+' '+fmtTime(n.ts)+(n.user?' · '+escHtml(n.user):'')+'</div>'+
    '</div>';
  }).join('');
  var notesHtml = canAct ?
    '<div style="margin-bottom:14px;">'+
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px;">📝 Notes</div>'+
      notesRows+
      '<div style="display:flex;gap:7px;margin-top:6px;">'+
        '<input id="gd-note-input" type="text" placeholder="Add a note…" style="flex:1;padding:9px 11px;border-radius:9px;border:1px solid var(--border);background:var(--card2);color:var(--text1);font-size:13px;font-family:inherit;" onkeydown="if(event.key===\'Enter\')gdAddNote(\''+gid+'\')">'+
        '<button onclick="gdAddNote(\''+gid+'\')" style="padding:9px 14px;border-radius:9px;border:none;background:var(--gold);color:#1a1200;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">+</button>'+
      '</div>'+
    '</div>'
  : (notesRows ? '<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px;">📝 Notes</div>'+notesRows+'</div>' : '');

  // ── Feature 11: Full audit timeline ───────────────────────────────────
  var allEvents = [];
  (g.ledger||[]).forEach(function(l){ allEvents.push({ts:l.ts,type:l.type,note:l.note,user:l.user||''}); });
  (g.payments||[]).forEach(function(p){ allEvents.push({ts:p.ts||p.date,type:'payment',note:'₹'+Math.round(p.amount).toLocaleString('en-IN')+' received via '+(p.mode||'Cash'),user:''}); });
  (g.notesList||[]).forEach(function(n){ allEvents.push({ts:n.ts,type:'note',note:'Note: '+n.text,user:n.user||''}); });
  (g.amountAdjLog||[]).forEach(function(a){ allEvents.push({ts:a.ts,type:'adjustment',note:'Amount adjusted to ₹'+Math.round(a.newAmount).toLocaleString('en-IN')+' ('+a.reason+')',user:a.user||''}); });
  allEvents.sort(function(a,b){ return new Date(b.ts)-new Date(a.ts); });
  var icons={created:'🟢',payment:'💸',closed:'🔒',defaulted:'🔴',edit:'✏️',renewal:'🔄',waiver:'💚',penalty:'⚠️',note:'📝',adjustment:'🔧'};
  var timelineRows = allEvents.slice(0,12).map(function(l){
    return '<div class="gd-tl-item">'+
      '<div class="gd-tl-dot" style="background:'+(l.type==='payment'?'#22c55e':l.type==='closed'?'#64748b':l.type==='defaulted'?'#ef4444':l.type==='note'?'#60a5fa':l.type==='adjustment'?'#f59e0b':'var(--gold)')+'"></div>'+
      '<div class="gd-tl-text">'+(icons[l.type]||'📋')+' '+escHtml(l.note||'')+(l.user?' <span style="color:var(--text3);font-size:10px;">· '+escHtml(l.user)+'</span>':'')+'</div>'+
      '<div class="gd-tl-date">'+fmtDate(l.ts)+' '+fmtTime(l.ts)+'</div>'+
    '</div>';
  }).join('');

  // Payment rows — same ledger math the receipt uses, so every payment
  // shows where the money went (interest vs principal) and what the
  // balance was right after, not just a bare amount and date.
  var _ledger = girviLedgerState(g);
  var _runBal = g.principal;
  var payRowsData = _ledger.payments.map(function(p){
    _runBal = _runBal - (p.principalPortion||0);
    return {p:p, balAfter:Math.max(0,_runBal)};
  }).reverse();
  var payRows = payRowsData.map(function(row){
    var p=row.p;
    var isAdj = p.type==='penalty'||p.type==='refund';
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid var(--border);font-size:12px;">'+
      '<div>'+
        '<div style="font-weight:700;font-size:13px;">\u20b9'+Math.round(p.amount).toLocaleString('en-IN')+' <span style="font-weight:400;color:var(--text3);font-size:11px;">'+(p.mode||(isAdj?p.type:'Cash'))+'</span></div>'+
        (isAdj?'':'<div style="font-size:11px;color:var(--text3);">Interest \u20b9'+Math.round(p.interestPortion||0).toLocaleString('en-IN')+' \u2022 Principal \u20b9'+Math.round(p.principalPortion||0).toLocaleString('en-IN')+'</div>')+
      '</div>'+
      '<div style="text-align:right;">'+
        '<div style="font-size:11px;color:var(--text3);">'+fmtDate(p.date)+'</div>'+
        '<div style="font-size:11px;font-weight:600;">Bal \u20b9'+Math.round(row.balAfter).toLocaleString('en-IN')+'</div>'+
      '</div>'+
    '</div>';
  }).join('');

  // Due status banner
  var statusBanner='';
  if(status!=='closed'){
    if(daysInfo.overdue>0){
      statusBanner='<div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;">'+
        '<span style="font-size:22px;">🚨</span>'+
        '<div><div style="font-weight:700;color:#ef4444;font-size:14px;">'+daysInfo.overdue+' Din Overdue!</div>'+
        '<div style="font-size:12px;color:var(--text3);">Penalty: +₹'+Math.round(penalty).toLocaleString('en-IN')+' added</div></div>'+
      '</div>';
    } else if(daysInfo.daysLeft>=0&&daysInfo.daysLeft<=7){
      statusBanner='<div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:10px;">'+
        '<span style="font-size:22px;">⏰</span>'+
        '<div><div style="font-weight:700;color:#f59e0b;font-size:14px;">'+(daysInfo.daysLeft===0?'Aaj Due Hai!':daysInfo.daysLeft+' Din Mein Due')+'</div>'+
        '<div style="font-size:12px;color:var(--text3);">Due: '+fmtDate(daysInfo.dueDate.toISOString().slice(0,10))+'</div></div>'+
      '</div>';
    }
  }

  var html = statusBanner+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">'+
      '<div style="background:var(--card2);border-radius:11px;padding:11px 13px;">'+
        '<div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:5px;">👤 Customer</div>'+
        '<div style="font-size:15px;font-weight:700;">'+escHtml(g.customer)+'</div>'+
        '<div style="font-size:12px;color:var(--text3);">📞 '+escHtml(g.phone)+'</div>'+
        (g.address?'<div style="font-size:11px;color:var(--text3);margin-top:2px;">'+escHtml(g.address)+'</div>':'')+
        (g.idProof?'<div style="font-size:11px;color:var(--text3);">ID: '+escHtml(g.idProof)+'</div>':'')+
      '</div>'+
      (function(){
        var _its=_allIt;
        var _twD=_its.reduce(function(s,it){return s+(parseFloat(it.weight||it.grossWt)||0)*(parseInt(it.qty)||1);},0);
        if(_its.length===1){
          var it=_its[0];
          return '<div style="background:var(--card2);border-radius:11px;padding:11px 13px;">'+
            '<div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:5px;">🪙 Item Pledged</div>'+
            '<div style="font-size:14px;font-weight:700;">'+escHtml(it.type||'Item')+(it.qty>1?' ×'+it.qty:'')+'</div>'+
            '<div style="font-size:12px;color:var(--text3);">'+(it.purity||'')+' '+(it.metal||'')+(it.weight||it.grossWt?' · '+(it.weight||it.grossWt)+'g':'')+'</div>'+
            (it.desc?'<div style="font-size:11px;color:var(--text3);margin-top:2px;">'+escHtml(it.desc)+'</div>':'')+
            (mktVal>0?'<div style="font-size:12px;color:var(--gold);font-weight:600;margin-top:4px;">Mkt: ₹'+Math.round(mktVal).toLocaleString('en-IN')+'</div>':'')+
          '</div>';
        }
        return '<div style="background:var(--card2);border-radius:11px;padding:11px 13px;">'+
          '<div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;margin-bottom:6px;">🪙 '+_its.length+' Items · '+_twD.toFixed(2)+'g</div>'+
          _its.map(function(it){
            return '<div style="font-size:12px;padding:3px 0;border-bottom:0.5px solid rgba(201,168,76,.1);">'+
              '<span style="font-weight:700;">'+escHtml(it.type||'Item')+(it.qty>1?' ×'+it.qty:'')+'</span>'+
              '<span style="color:var(--text3);"> '+(it.purity||'')+' '+(it.metal||'')+((it.weight||it.grossWt)?' '+(it.weight||it.grossWt)+'g':'')+'</span>'+
            '</div>';
          }).join('')+
        '</div>';
      })()+
    '</div>'+
    // ── Feature 3: Full duration & interest breakdown ──────────────────
    '<div style="background:linear-gradient(135deg,rgba(201,168,76,.06),rgba(201,168,76,.02));border:0.5px solid rgba(201,168,76,.2);border-radius:12px;padding:14px;margin-bottom:14px;">'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">'+
        '<div style="text-align:center;">'+
          '<div style="font-size:18px;font-weight:800;color:var(--gold);">₹'+Math.round(_ledger.principal).toLocaleString('en-IN')+'</div>'+
          '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;">Loan Balance</div>'+
        '</div>'+
        '<div style="text-align:center;">'+
          '<div style="font-size:18px;font-weight:800;color:#f59e0b;">₹'+Math.round(interest).toLocaleString('en-IN')+'</div>'+
          '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;">Interest</div>'+
        '</div>'+
        '<div style="text-align:center;">'+
          '<div style="font-size:18px;font-weight:800;color:'+(status==='closed'?'#22c55e':penalty>0?'#ef4444':'#c9a84c')+';">₹'+Math.round(displayAmt).toLocaleString('en-IN')+(g.adjustedAmount!=null?'*':'')+'</div>'+
          '<div style="font-size:9px;color:var(--text3);text-transform:uppercase;">'+(status==='closed'?'Closed':'Payable')+(g.adjustedAmount!=null?' (adj)':'')+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--text2);margin-bottom:6px;">'+
        '<div>\ud83d\udcc5 Started <strong>'+fmtDate(g.startDate)+'</strong></div>'+
        '<div>\u23f1 <strong>'+durationStr+'</strong> ago ('+_daysElapsed+' days)</div>'+
        '<div>\ud83d\udcc8 <strong>'+g.interestRate+'% '+(g.rateType==='yearly'?'p.a.':'p.m.')+(g.compound?' compound':' simple')+'</strong></div>'+
        '<div>\ud83d\udcb3 Paid so far <strong>\u20b9'+Math.round(totalPaid).toLocaleString('en-IN')+'</strong></div>'+
      '</div>'+
      (penalty>0?'<div style="font-size:12px;color:#ef4444;font-weight:600;">\u26a0 Penalty for late payment: +\u20b9'+Math.round(penalty).toLocaleString('en-IN')+'</div>':'')+
      (g.adjustedAmount!=null?'<div style="font-size:11px;color:var(--text3);margin-top:4px;">* Adjusted amount. System calc: \u20b9'+Math.round(calcTotal).toLocaleString('en-IN')+'</div>':'')+
    '</div>'+
    // ── Customer vs Financer margin — only shown when this loan has
    // financer details attached (see girviMargin() in 04-orders-detail.js,
    // fully additive, doesn't touch the customer-side interest engine) ──
    (girviHasFinancer(g) ? (function(){
      var m = girviMargin(g);
      var marginColor = m.margin>=0 ? '#22c55e' : '#ef4444';
      return '<div style="background:var(--card2);border:1px solid var(--border2);border-radius:12px;padding:12px 14px;margin-bottom:14px;">'+
        '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:10px;">\ud83e\udd1d Financer: '+escHtml(g.financerName)+' ('+g.financerRate+'% '+(g.financerRateType==='yearly'?'p.a.':'p.m.')+')</div>'+
        '<div style="display:flex;gap:10px;flex-wrap:wrap;">'+
          '<div style="flex:1;min-width:100px;"><div style="font-size:10px;color:var(--text3);">Customer gives us</div><div style="font-weight:800;color:#c9a84c;">\u20b9'+Math.round(m.customerInterest).toLocaleString('en-IN')+'</div></div>'+
          '<div style="flex:1;min-width:100px;"><div style="font-size:10px;color:var(--text3);">We pay financer</div><div style="font-weight:800;color:var(--text2);">\u20b9'+Math.round(m.financerInterest).toLocaleString('en-IN')+'</div></div>'+
          '<div style="flex:1;min-width:100px;"><div style="font-size:10px;color:var(--text3);">Our margin</div><div style="font-weight:800;color:'+marginColor+';">\u20b9'+Math.round(m.margin).toLocaleString('en-IN')+'</div></div>'+
        '</div>'+
      '</div>';
    })() : '')+
    // ── Adjustable final amount — tucked away; most loans never need this ──
    (canAct?
      '<details style="margin-bottom:14px;">'+
        '<summary style="cursor:pointer;font-size:12px;font-weight:600;color:var(--text3);padding:2px 0;">\u270f\ufe0f Adjust payable amount (discount / waiver / correction)</summary>'+
        '<div style="margin-top:8px;">'+adjHtml+'</div>'+
      '</details>'
    :'')+
    // Payment history
    (payRows?
      '<div style="margin-bottom:14px;">'+
        '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:6px;">💸 Payment History — Paid: ₹'+Math.round(totalPaid).toLocaleString('en-IN')+'</div>'+
        payRows+
      '</div>'
    :'<div style="font-size:12px;color:var(--text3);margin-bottom:12px;">No payments yet.</div>')+
    // ── Feature 7: Notes ──────────────────────────────────────────────
    notesHtml+
    // ── Feature 11: Audit trail ────────────────────────────────────────
    // Ornament photos taken when the pledge came in. They live on the
    // customer's profile, so they are looked up rather than stored twice.
    (function(){
      var c = (S.customers||[]).find(function(x){ return x.id===g.customerId; });
      var pics = (c && c.ornamentPhotos || []).filter(function(p){ return p.girviId===g.id; });
      if(!pics.length) return '';
      return '<div style="margin-bottom:14px;">'+
        '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px;">📷 Ornament Photos</div>'+
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">'+
          pics.map(function(p){
            return '<a href="'+p.dataUrl+'" target="_blank" rel="noopener" style="display:block;aspect-ratio:1;border-radius:10px;overflow:hidden;border:1px solid var(--border2);">'+
              '<img src="'+p.dataUrl+'" style="width:100%;height:100%;object-fit:cover;display:block;">'+
            '</a>';
          }).join('')+
        '</div>'+
      '</div>';
    }())+
    '<div style="margin-bottom:14px;">'+
      '<div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px;">📋 Audit Trail</div>'+
      '<div class="gd-timeline">'+timelineRows+'</div>'+
    '</div>'+
    // Actions
    (canAct?
      '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px;">'+
        '<button onclick="openGirviPayment(\''+gid+'\')" style="padding:12px;border-radius:11px;border:none;background:var(--gold);color:#1a1200;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">💸 Add Payment</button>'+
        '<button onclick="girviWhatsApp(\''+gid+'\')" style="padding:12px;border-radius:11px;border:none;background:#25d36622;color:#25d366;border:1px solid #25d36640;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">📱 WhatsApp</button>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;">'+
        '<button onclick="callCustomer(\''+jsAttrEsc(g.phone)+'\')" style="padding:10px 4px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:#22c55e;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">📞 Call</button>'+
        '<button onclick="openGirviEditModal(\''+gid+'\')" style="padding:10px 4px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">✏ Edit</button>'+
        '<button onclick="openGirviRenewalModal(\''+gid+'\')" style="padding:10px 4px;border-radius:10px;border:1px solid #60a5fa44;background:#60a5fa15;color:#60a5fa;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">🔄 Renew</button>'+
      '</div>'+
      // Ledger / Timeline / Receipt used to be bolted on by an override in
      // 08-girvi-viewmode.js that re-opened this modal and appended a second
      // action block — which is where the duplicate Edit, WhatsApp and Renew
      // buttons came from. Merged in here so each action appears exactly once.
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:7px;">'+
        '<button onclick="openGirviLedger(\''+gid+'\')" style="padding:10px 4px;border-radius:10px;border:1px solid rgba(28,96,64,.3);background:rgba(28,96,64,.08);color:var(--success);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">📒 Ledger</button>'+
        '<button onclick="openGirviTimeline(\''+gid+'\')" style="padding:10px 4px;border-radius:10px;border:1px solid rgba(138,78,12,.3);background:rgba(138,78,12,.08);color:var(--warning);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">📋 Timeline</button>'+
        '<button onclick="openGirviReceiptModal(\''+gid+'\',\'creation\')" style="padding:10px 4px;border-radius:10px;border:1px solid var(--border);background:var(--card2);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">🧾 Receipt</button>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:7px;margin-top:7px;">'+
        '<button onclick="closeGirviManual(\''+gid+'\')" style="padding:10px 4px;border-radius:10px;border:1px solid #22c55e44;background:#22c55e12;color:#22c55e;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">🔓 Release Item</button>'+
        '<button onclick="markGirviDefault(\''+gid+'\')" style="padding:10px 4px;border-radius:10px;border:1px solid #ef444444;background:#ef444412;color:#ef4444;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">🔴 Mark Default</button>'+
      '</div>'
    :'<div style="text-align:center;padding:10px;font-size:13px;color:var(--text3);">🔒 This loan is '+status+'. No further actions.</div>');

  document.getElementById('gd-title').innerHTML='🪢 '+escHtml(g.grvNo)+' &nbsp;'+girviStatusBadge(status);
  document.getElementById('gd-body').innerHTML=html;
  document.getElementById('girvi-detail-modal').style.display='block';
}

// ── Feature 2: Adj amount helpers ──────────────────────────────────────
function gdPreviewAdj(calcTotal){
  var inp=document.getElementById('gd-adj-amount');
  var el=document.getElementById('gd-adj-diff');
  if(!inp||!el) return;
  var val=parseFloat(inp.value);
  if(!val||isNaN(val)){el.textContent='';return;}
  var diff=val-calcTotal;
  el.innerHTML=diff<0?'🟢 Discount/Waiver: ₹'+Math.round(Math.abs(diff)).toLocaleString('en-IN'):
               diff>0?'🟡 Extra Charge: ₹'+Math.round(diff).toLocaleString('en-IN'):'✅ Same as calculated';
  el.style.color=diff<0?'#22c55e':diff>0?'#f59e0b':'var(--text3)';
}
function gdSaveAdjAmount(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  var inp=document.getElementById('gd-adj-amount');
  var reason=(document.getElementById('gd-adj-reason')||{}).value||'';
  if(!inp){return;}
  var val=parseFloat(inp.value);
  if(!val||val<0){toast('⚠ Enter a valid amount');return;}
  if(!reason){toast('⚠ Please select a reason for adjustment');return;}
  var oldVal=g.adjustedAmount;
  var calcTotal=girviOutstandingWithPenalty(g).amount;
  g.adjustedAmount=val;
  if(!g.amountAdjLog) g.amountAdjLog=[];
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  if(!g.amountAdjLog)g.amountAdjLog=[];
  g.amountAdjLog.push({
    oldAmount: oldVal!=null?oldVal:calcTotal,
    newAmount: val,
    calcAmount: calcTotal,
    diff: val-calcTotal,
    reason: reason,
    user: currentUser,
    ts: new Date().toISOString()
  });
  if(!g.ledger)g.ledger=[];
  g.ledger.push({type:'adjustment',note:'Amount adjusted to ₹'+Math.round(val).toLocaleString('en-IN')+' ('+reason+')',ts:new Date().toISOString(),user:currentUser});
  if(typeof auditLog==='function') auditLog('update','girvi',g.id,'Amount adjusted: ₹'+Math.round(val)+' reason: '+reason);
  saveToCloud(function(err){
    openGirviDetail(gid);
    toast(err?'⚠ Saved locally':'✅ Amount adjusted to ₹'+Math.round(val).toLocaleString('en-IN'));
  });
}
function gdResetAdjAmount(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g) return;
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  if(!g.ledger)g.ledger=[];
  g.ledger.push({type:'adjustment',note:'Adjusted amount reset to system-calculated',ts:new Date().toISOString(),user:currentUser});
  delete g.adjustedAmount;
  saveToCloud(function(err){
    openGirviDetail(gid);
    toast(err?'⚠ Saved locally':'↺ Reset to system-calculated amount');
  });
}
// ── Feature 7: Add note ──────────────────────────────────────────────────
function gdAddNote(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g) return;
  var inp=document.getElementById('gd-note-input');
  if(!inp) return;
  var text=inp.value.trim();
  if(!text){toast('⚠ Note cannot be empty');return;}
  if(!g.notesList) g.notesList=[];
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  if(!g.notesList)g.notesList=[];
  g.notesList.push({text:text,ts:new Date().toISOString(),user:currentUser});
  if(!g.ledger)g.ledger=[];
  g.ledger.push({type:'note',note:'Note: '+text,ts:new Date().toISOString(),user:currentUser});
  inp.value='';
  saveToCloud(function(err){
    openGirviDetail(gid);
    toast(err?'⚠ Saved locally':'📝 Note added!');
  });
}
function closeGirviDetail(){
  document.getElementById('girvi-detail-modal').style.display='none';
}

// ── PAYMENT MODAL (enhanced) ──────────────────────────────────────────
function openGirviPayment(gid){
  _currentPayGid = gid;
  var g = (S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g){toast('Not found');return;}
  if(g.status==='closed'){toast('Already closed');return;}
  var outstanding = girviOutstandingWithPenalty(g).amount;
  var monthly     = girviMonthlyInterest(g);
  var interest    = girviInterestAccrued(g);

  var html=
    // Big outstanding number
    '<div style="text-align:center;padding:14px 0 10px;">'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Total Outstanding</div>'+
      '<div style="font-size:clamp(22px,7vw,32px);font-weight:800;color:#ef4444;">\u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</div>'+
      '<div style="font-size:12px;color:var(--text3);margin-top:3px;">'+
        '\u20b9'+Math.round(g.principal).toLocaleString('en-IN')+' principal + '+
        '\u20b9'+Math.round(interest).toLocaleString('en-IN')+' interest'+
      '</div>'+
    '</div>'+
    // Quick payment buttons
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">'+
      '<div style="font-size:11px;color:var(--text3);width:100%;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Quick amounts:</div>'+
      '<button onclick="setPayAmt('+Math.round(monthly)+')" style="padding:5px 11px;border-radius:100px;border:1px solid var(--border);background:var(--card2);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Interest only \u20b9'+Math.round(monthly).toLocaleString('en-IN')+'</button>'+
      '<button onclick="setPayAmt('+Math.round(outstanding/2)+')" style="padding:5px 11px;border-radius:100px;border:1px solid var(--border);background:var(--card2);color:var(--text2);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Half \u20b9'+Math.round(outstanding/2).toLocaleString('en-IN')+'</button>'+
      '<button onclick="setPayAmt('+Math.round(outstanding)+')" style="padding:5px 11px;border-radius:100px;border:1px solid var(--gold);background:rgba(201,168,76,.1);color:var(--gold);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Full \u20b9'+Math.round(outstanding).toLocaleString('en-IN')+'</button>'+
    '</div>'+
    // Amount input
    '<div style="position:relative;margin-bottom:9px;">'+
      '<span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--text3);font-size:16px;font-weight:700;">\u20b9</span>'+
      '<input id="pay-amount" type="number" step="100" placeholder="Enter amount" inputmode="numeric"'+
        ' oninput="updatePayBalance('+Math.round(outstanding)+')"'+
        ' style="width:100%;box-sizing:border-box;padding:14px 14px 14px 30px;border-radius:11px;border:1.5px solid var(--border);background:var(--card2);color:var(--text1);font-size:20px;font-family:inherit;font-weight:800;">'+
    '</div>'+
    '<div id="pay-balance-preview" style="font-size:12px;color:var(--text3);text-align:center;margin-bottom:12px;"></div>'+
    // Mode + Date
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:9px;">'+
      '<select id="pay-mode" style="padding:10px;border-radius:11px;border:1px solid var(--border);background:var(--card2);color:var(--text1);font-size:13px;font-family:inherit;">'+
        '<option value="cash">💵 Cash</option><option value="upi">📱 UPI</option>'+
        '<option value="bank">🏦 Bank Transfer</option><option value="cheque">📝 Cheque</option>'+
      '</select>'+
      '<input id="pay-date" type="date" style="padding:10px;border-radius:11px;border:1px solid var(--border);background:var(--card2);color:var(--text1);font-size:13px;font-family:inherit;">'+
    '</div>'+
    '<select id="pay-type" style="width:100%;padding:9px 12px;border-radius:11px;border:1px solid var(--border);background:var(--card2);color:var(--text1);font-size:13px;font-family:inherit;margin-bottom:9px;">'+
      '<option value="general">💳 General Payment</option>'+
      '<option value="interest">📅 Interest Only (Item Stays Pledged)</option>'+
      '<option value="partial">🔢 Partial Principal Repayment</option>'+
      '<option value="full">🔓 Full Redemption (Close Girvi)</option>'+
    '</select>'+
    '<input id="pay-ref" type="text" placeholder="Reference / note (optional)"'+
      ' style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:11px;border:1px solid var(--border);background:var(--card2);color:var(--text1);font-size:13px;font-family:inherit;margin-bottom:12px;">'+
    '<div style="display:flex;gap:8px;">'+
      '<button onclick="closeGirviDetail()" style="flex:1;padding:12px;border-radius:11px;border:1px solid var(--border);background:var(--card2);color:var(--text2);font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>'+
      '<button onclick="submitGirviPayment(\''+gid+'\')" style="flex:2;padding:12px;border-radius:11px;border:none;background:var(--gold);color:#1a1200;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">\ud83d\udcb8 Record Payment</button>'+
    '</div>';

  document.getElementById('gd-title').innerHTML='\ud83d\udcb8 Payment — '+escHtml(g.grvNo);
  // Clear stale split rows from previous open
  if(typeof splitRows!=='undefined') splitRows=[];
  var _splitEl=document.getElementById('split-rows'); if(_splitEl) _splitEl.innerHTML='';
  document.getElementById('gd-body').innerHTML=html;
  document.getElementById('pay-date').value=new Date().toISOString().slice(0,10);
  document.getElementById('girvi-detail-modal').style.display='block';
  setTimeout(function(){var el=document.getElementById('pay-amount');if(el)el.focus();},120);
}

function setPayAmt(amt){
  var el=document.getElementById('pay-amount');
  if(el){el.value=amt;updatePayBalance(null);}
}

function updatePayBalance(outstanding){
  var amt = parseFloat(document.getElementById('pay-amount').value)||0;
  var el  = document.getElementById('pay-balance-preview');
  if(!el||!amt) return;
  if(outstanding===null){
    var g = _currentPayGid ? (S.girvi||[]).find(function(x){return x.id===_currentPayGid;}) : null;
    outstanding = g ? girviOutstandingWithPenalty(g).amount : 0;
  }
  var remaining = Math.max(0, outstanding-amt);
  el.innerHTML = remaining<=0
    ? '<span style="color:#22c55e;font-weight:700;">\u2713 Full payment — loan will be CLOSED</span>'
    : 'Balance after payment: <strong>\u20b9'+Math.round(remaining).toLocaleString('en-IN')+'</strong>';
}

// DELIBERATELY NOT SUBSCRIPTION-GATED. If a customer walks in to repay a pawn
// loan and collect his gold, blocking it hurts him, not the shop that owes us
// money. Tanish chose to lose that leverage; flagged in HANDOFF as unsettled,
// so do not "fix" this omission without checking there first.
function submitGirviPayment(gid){
  if(_girviLocked(gid)){ toast('Payment already being recorded — please wait'); return; }
  var g = (S.girvi||[]).find(function(x){return x.id===gid;});
  if(!g) return;
  var amount = parseFloat(document.getElementById('pay-amount').value);
  var mode   = document.getElementById('pay-mode').value;
  var date   = document.getElementById('pay-date').value;
  var ref    = (document.getElementById('pay-ref').value||'').trim();
  var payTypeEl = document.getElementById('pay-type');
  var payType = payTypeEl ? payTypeEl.value : 'general';
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  if(!amount||amount<=0){toast('⚠ Enter valid amount');return;}
  if(!date){toast('⚠ Enter payment date');return;}
  var outstanding = girviOutstandingWithPenalty(g).amount;
  var interest    = girviInterestAccrued(g);

  // Determine auto payment type if not set
  if(!payTypeEl){
    if(Math.abs(amount - interest) < 2) payType='interest';
    else if(amount >= outstanding - 0.5) payType='full';
    else if(amount < outstanding) payType='partial';
  }

  function doSubmit(){
    var _snap = _girviSnapshot(gid);
    _girviLock(gid);
    var pid = (typeof crypto.randomUUID==='function')?crypto.randomUUID():Date.now().toString(36);
    var payNote = '₹'+Math.round(amount).toLocaleString('en-IN')+' via '+mode+
      (payType==='interest'?' (Interest Only)':payType==='full'?' (Full Redemption)':payType==='partial'?' (Partial)':'')+
      (ref?' ('+ref+')':'');
    if(!g.payments)g.payments=[];
    g.payments.push({id:pid,amount:amount,mode:mode,date:date,ref:ref,type:payType,ts:new Date().toISOString(),user:currentUser});
    if(!g.ledger)g.ledger=[];
    g.ledger.push({type:'payment',note:payNote,ts:new Date().toISOString(),user:currentUser});
    var newOut = girviOutstanding(g);
    var _successMsg;
    if(payType==='interest'){
      // Interest-only: reset the effective start date so interest re-accrues from today
      g.interestResetDate = date;
      g._lastInterestPaidDate = date;
      if(!g.ledger)g.ledger=[];
      g.ledger.push({type:'payment',note:'Interest reset — accrual restarts from '+date,ts:new Date().toISOString(),user:currentUser});
      g.status = girviComputeStatus(g);
      _successMsg = '✅ Interest paid ₹'+Math.round(amount).toLocaleString('en-IN')+'. Item still pledged.';
    } else if(newOut<=0.5 || payType==='full'){
      g.status='closed'; g.closedAt=new Date().toISOString();
      if(!g.ledger)g.ledger=[];
      g.ledger.push({type:'closed',note:'Fully redeemed & closed',ts:new Date().toISOString(),user:currentUser});
      _successMsg = '✅ Payment recorded. Girvi CLOSED — item released!';
    } else {
      g.status=girviComputeStatus(g);
      _successMsg = '✅ Payment ₹'+Math.round(amount).toLocaleString('en-IN')+' recorded. Balance: ₹'+Math.round(newOut).toLocaleString('en-IN');
    }
    if(typeof saasActivityLog==='function') saasActivityLog('girvi','Payment ₹'+Math.round(amount)+' for '+g.grvNo);
    closeGirviDetail();
    // Foundation audit B2: was a bare saveToCloud() with no rollback and
    // no per-loan lock — a failed/conflicted save could leave this loan
    // showing paid/closed here while the cloud still had it open. Now
    // snapshotted and reverted on failure, matching the sale flow.
    _girviCommit(gid, {snapshot:_snap}, function(err){
      if(!err){ renderGirvi(); renderDash(); toast(_successMsg); }
    });
  }

  if(amount > outstanding+1 && payType!=='full'){
    safeConfirm(
      'Payment exceeds outstanding?',
      'Amount ₹'+Math.round(amount).toLocaleString('en-IN')+' exceeds outstanding ₹'+Math.round(outstanding).toLocaleString('en-IN')+'. Continue?',
      doSubmit, true
    );
    return;
  }
  doSubmit();
}

// ═══ END GIRVI ENGINE v12 ═══


// ═══════════════════════════════════════════════════════════════════════
// ─── GIRVI MODULE v20 — Enterprise Pawn Management Engine ────────────
// Edit · Ledger · Timeline · Documents · Renewal · Overdue · Dashboard
// Zero regression. Fully backward compatible with v19 data structures.
// ═══════════════════════════════════════════════════════════════════════

// ── MODULE STATE ───────────────────────────────────────────────────────
var _geEditId = null;
var _glGirviId = null;
var _glEntryType = 'payment';
var _grnGirviId = null;
var GE_ITEMS = [];
var _girviChips = {};
var GIRVI_VIEW_MODE = (function(){
  // 'list' | 'customer'. Default is 'list' (dashboard-style, not grouped by customer).
  // Last choice is remembered across sessions.
  try{
    var saved = localStorage.getItem('jewelos_girvi_view_mode');
    if(saved==='customer'||saved==='list') return saved;
  }catch(e){}
  return 'list';
})();
