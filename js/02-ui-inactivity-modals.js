function showInactivityLock(){
  if(_inactOverlayShown) return;
  _inactOverlayShown = true;
  clearTimeout(_inactTimer); // stop timer
  var ov=document.getElementById('inactivity-overlay');
  if(ov) ov.classList.add('show');
  if(typeof _enforceFullScreenLock==='function') _enforceFullScreenLock();
}

function dismissInactivity(){
  // Hide the inactivity overlay and show the PIN screen for re-authentication
  var ov=document.getElementById('inactivity-overlay');
  if(ov) ov.classList.remove('show');
  _inactOverlayShown=false;
  // Force PIN re-entry for security
  lockApp();
}

function initInactivityWatcher(){
  ['click','touchstart','keydown','scroll','mousemove'].forEach(function(ev){
    document.addEventListener(ev, resetInactivityTimer, {passive:true});
  });
  resetInactivityTimer();
}


// One-time migration: stamps lockedRate on existing bills and locks paid bills
function migrateLockRates(){
  var dirty=false;
  S.sales.forEach(function(sale){
    // Lock item rates if missing
    (sale.items||[]).forEach(function(i){
      if(!i.lockedRate&&i.metal&&i.purity){
        i.lockedRate=getRate(i.metal,i.purity);
        dirty=true;
      }
    });
    // Lock grand total on paid bills
    if(!sale.lockedGrand&&sale.payStatus==='full'&&sale.advance>0){
      sale.lockedGrand=sale.advance; // advance === grand when fully paid
      dirty=true;
    }
  });
  // Save migrated data back to cloud silently
  if(dirty) saveToCloud(function(err){ if(err) console.warn('[JewelOS] Background refresh save failed:', err); });
}

function calcSaleTotals(sale){
  var gv=0,mc=0,dc=0;
  (sale.items||[]).forEach(function(i){
    // CRITICAL: use lockedRate stored at bill creation — never live rate
    var rate=getItemRate(i);
    gv+=rate*i.weight*i.qty;
    mc+=itemMakingAmount(i);   // gross-weight basis on new sales, net on pre-existing ones
    if(i.isCustom){ dc+=(i.diamond||0); }
    else { dc+=(i.diamond||0)*i.qty; }
  });
  mc+=(sale.making||0); dc+=(sale.diamond||0);
  var sub=gv+mc+dc;
  // NaN guard — if any input was NaN, reset to 0
  if(!isFinite(sub)||isNaN(sub)) sub=0;
  var disc=sale.discount||0;
  // GST must be charged on the value net of any discount recorded on the
  // invoice at time of sale (not on the pre-discount subtotal) — otherwise
  // customers are overcharged tax and the invoice's displayed Taxable Value
  // won't match what's reported on the GSTR-1 filing for the same sale.
  var taxable = Math.max(0, sub - disc);
  var gstAmt  = taxable*(sale.gst||0)/100;
  var calcGrand = taxable+gstAmt;
  // If bill has a lockedGrand (set at creation), use it — prevents drift from rate changes
  var grand = sale.lockedGrand>0 ? sale.lockedGrand : calcGrand;
  var adv=sale.advance||0;
  // Include old gold and prev advance in total collected for balance calc
  var ogv=(sale.oldGold&&sale.oldGold.value)||0;
  var pav=(sale.prevAdvance&&sale.prevAdvance.amount)||0;
  var nav=(sale.nowPaying&&sale.nowPaying.amount)||0;
  var creationColl = adv>0 ? adv : (ogv+pav+nav);
  // Foundation audit §6 (financial ledger): payments made AFTER the sale
  // was created — the actual partial-payment gap. sale.advance/oldGold/
  // prevAdvance/nowPaying all describe what was collected AT creation
  // time and are left completely untouched; this is a separate, additive
  // append-only ledger for everything paid afterward, with reversals as
  // their own entries (never edited/deleted), same shape as orders/girvi.
  var extraPaid = (sale.extraPayments||[]).reduce(function(s,p){
    return s + (p.type==='reversal' ? -p.amount : p.amount);
  }, 0);
  var totalColl = creationColl + extraPaid;
  return{gv:gv,mc:mc,dc:dc,sub:sub,taxable:taxable,gstAmt:gstAmt,disc:disc,grand:grand,adv:totalColl,bal:Math.max(0,grand-totalColl),ogv:ogv,pav:pav,nav:nav,creationColl:creationColl,extraPaid:extraPaid};
}

function stockGV(){return S.products.filter(function(p){return p.metal==='gold'&&p.status!=='sold';}).reduce(function(s,p){return s+mktVal(p);},0);}
function stockSV(){return S.products.filter(function(p){return p.metal==='silver'&&p.status!=='sold';}).reduce(function(s,p){return s+mktVal(p);},0);}

// ─── TABS ─────────────────────────────────────────────────────────────────
function renderTab(tab){
  // F4: leaving the Sale tab abandons an order conversion, so the next,
  // unrelated sale can't be billed against that order.
  if(tab!=='sales') _pendingOrderConversion = null;
  // Re-checked on every screen change so the state stays honest across a
  // session left open overnight, and the warn banner returns the next day.
  if(typeof renderSubBanner === 'function') renderSubBanner();
  // Show skeleton for slow-loading panels before real render
  if(tab==='inventory')  showSkeleton('inv-body','8','table');
  if(tab==='girvi'){     showSkeleton('girvi-list','5','card'); var _gl=document.getElementById('girvi-list'); if(_gl) _gl.dataset.page='0'; }
  if(tab==='orders')     showSkeleton('ord-list','4','card');
  if(tab==='customers')  showSkeleton('cust-list','4','list');
  if(tab==='dashboard')  renderDash();
  else if(tab==='inventory'){loadRates();renderInv();}
  else if(tab==='sales'){initSaleDate();renderSaleItems();}
  else if(tab==='orders')renderOrders();
  else if(tab==='girvi')renderGirvi();
  else if(tab==='customers')renderCustomers();
  else if(tab==='reports')renderReports();
  else if(tab==='daybook')renderDayBook();
  else if(tab==='settings')renderSettings();
}
// Scroll position memory — keyed by tab name
var _tabScrollPos = {};

function switchTab(tab){
  // ── Staff role enforcement ───────────────────────────────────────────
  // staff: can only access dashboard, sales, inventory
  // manager/owner: full access
  var staffBlocked = ['reports','customers','girvi','settings'];
  var managerBlocked = []; // managers can access everything
  if(isStaff() && staffBlocked.indexOf(tab) !== -1){
    toast('\u26a0 Ask the owner for access to ' + tab);
    tab = 'sales'; // redirect to sales
  }
  // Plan-based tab gating removed. Every shop gets every module; whether it
  // can write is decided by paidUntil (subGuard), not by tier.
  // Save scroll position of current active panel before switching
  ['dashboard','inventory','sales','orders','girvi','customers','reports','daybook','settings'].forEach(function(t){
    var cp = document.getElementById('panel-'+t);
    if(cp && cp.classList.contains('active')) _tabScrollPos[t] = window.scrollY;
  });
  ['dashboard','inventory','sales','orders','girvi','customers','reports','daybook','settings'].forEach(function(t){
    var p=document.getElementById('panel-'+t),b=document.getElementById('bn-'+t);
    if(p)p.classList.toggle('active',t===tab);
    if(b)b.classList.toggle('active',t===tab);
  });
  document.querySelectorAll('.dtab').forEach(function(el,i){
    el.classList.toggle('active',['dashboard','inventory','sales','orders','girvi','customers','reports','daybook','settings'][i]===tab);
  });
  renderTab(tab);
  // Restore scroll position after render
  setTimeout(function(){
    window.scrollTo(0, _tabScrollPos[tab] || 0);
  }, 50);
  // Only reload from cloud if data is stale (>30s since last load)
  // This prevents unnecessary Supabase reads on every tab tap
  var _now = Date.now();
  var _lastLoad = parseInt(localStorage.getItem('ssj_last_cloud_load')||'0');
  if(_now - _lastLoad > 30000){
    loadFromCloud(function(err){
      if(!err){
        try{ localStorage.setItem('ssj_last_cloud_load', String(Date.now())); }catch(e){}
        renderTab(tab);
        setTimeout(function(){ window.scrollTo(0, _tabScrollPos[tab] || 0); }, 50);
      }
    });
  }
}

// ─── RATES ────────────────────────────────────────────────────────────────
function loadRates(){
  document.getElementById('rate-g24').value=S.rates.g24||'';
  document.getElementById('rate-g22').value=S.rates.g22||'';
  document.getElementById('rate-g18').value=S.rates.g18||'';
  document.getElementById('rate-g14').value=S.rates.g14||'';
  document.getElementById('rate-sil').value=S.rates.sil||'';
}
function saveRates(){
  S.rates.g24=parseFloat(document.getElementById('rate-g24').value)||0;
  S.rates.g22=parseFloat(document.getElementById('rate-g22').value)||0;
  S.rates.g18=parseFloat(document.getElementById('rate-g18').value)||0;
  S.rates.g14=parseFloat(document.getElementById('rate-g14').value)||0;
  S.rates.sil=parseFloat(document.getElementById('rate-sil').value)||0;
  saveToCloud(function(err){
    if(!err){toast('Rates saved & synced to all devices!');renderInv();}
  });
}

// ─── METAL TAB ────────────────────────────────────────────────────────────
function setMetal(m){
  UI.metal=m; UI.selCat='All';
  document.getElementById('mtab-gold').className='mtab'+(m==='gold'?' mtab-g':'');
  document.getElementById('mtab-silver').className='mtab'+(m==='silver'?' mtab-s':'');
  document.getElementById('add-form-title').textContent='Add '+(m==='gold'?'Gold':'Silver')+' Product';
  document.getElementById('inv-title').textContent=(m==='gold'?'Gold':'Silver')+' Products';
  fillPurities();
  if(document.getElementById('add-form').style.display!=='none'){
    document.getElementById('add-form').style.display='none';
    document.getElementById('add-btn').textContent='+ Add product';
    document.getElementById('add-btn').className='btn btn-dark';
  }
  renderInv();
}
function fillPurities(){
  var sel=document.getElementById('f-purity');if(!sel)return;
  var list=UI.metal==='gold'?G_PUR:S_PUR;
  sel.innerHTML=list.map(function(p){return '<option>'+p+'</option>';}).join('');
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────

// ── SKELETON LOADERS ─────────────────────────────────────────────────
function showSkeleton(elId, rows, type){
  // type: 'card' | 'table' | 'list'
  rows = parseInt(rows) || 4;
  var el = document.getElementById(elId);
  if(!el) return;
  var html = '';
  if(type === 'table'){
    for(var i=0;i<rows;i++){
      html += '<tr>' +
        '<td><div class="skeleton skel-line medium"></div></td>'.repeat(4) +
        '</tr>';
    }
  } else if(type === 'card'){
    for(var j=0;j<rows;j++){
      html += '<div class="skel-card">' +
        '<div class="skeleton skel-line medium" style="margin-bottom:6px;height:16px;"></div>' +
        '<div class="skeleton skel-line short"></div>' +
      '</div>';
    }
  } else {
    // list rows
    for(var k=0;k<rows;k++){
      html += '<div class="skel-row">' +
        '<div class="skeleton skel-circle"></div>' +
        '<div style="flex:1;">' +
          '<div class="skeleton skel-line medium" style="margin-bottom:5px;"></div>' +
          '<div class="skeleton skel-line short"></div>' +
        '</div>' +
      '</div>';
    }
  }
  el.innerHTML = html;
}

function renderInv(){
  var q=(document.getElementById('inv-search').value||'').toLowerCase();
  var m=UI.metal;
  var sf=document.getElementById('inv-status-filter').value;
  document.getElementById('cat-pills').innerHTML=CATS.map(function(c){return '<button class="pill'+(UI.selCat===c?' active':'')+'" onclick="setCat(\''+c+'\')">'+c+'</button>';}).join('');
  var prods=S.products.filter(function(p){return p.metal===m;});
  if(UI.selCat!=='All') prods=prods.filter(function(p){return p.cat===UI.selCat;});
  if(sf==='available') prods=prods.filter(function(p){return p.status!=='sold'&&p.status!=='returned';});
  if(sf==='sold') prods=prods.filter(function(p){return p.status==='sold';});
  if(sf==='returned') prods=prods.filter(function(p){return p.status==='returned';});
  if(q) prods=prods.filter(function(p){return p.name.toLowerCase().indexOf(q)>-1||p.sku.toLowerCase().indexOf(q)>-1||(p.huid&&p.huid.toLowerCase().indexOf(q)>-1);});
  var isG=m==='gold';
  // Pagination
  var totalProds = prods.length;
  var totalPages = Math.ceil(totalProds / INV_PAGE_SIZE);
  if(_invPage >= totalPages) _invPage = Math.max(0, totalPages-1);
  var pagedProds = paginateArray(prods, _invPage, INV_PAGE_SIZE);

  // Pagination controls
  var pgHtml = totalPages > 1 ? renderPaginator(totalProds, _invPage, INV_PAGE_SIZE, 'function(p){_invPage=p;renderInv();}') : '';
  var pgEl = document.getElementById('inv-pagination');
  if(pgEl) pgEl.innerHTML = pgHtml;

  document.getElementById('inv-body').innerHTML=pagedProds.length
    ?pagedProds.map(function(p){
      var sold=p.status==='sold';
      var returned=p.status==='returned';
      var mv=p.weight*getRate(p.metal,p.purity);
      var pbg=isG?'background:#fef9ec;color:var(--gold-dark);border:1px solid rgba(201,168,76,0.3)':'background:#eef2f6;color:var(--silver-dark);border:1px solid rgba(168,180,192,0.35)';
      var safePhoto=(p.photo&&(p.photo.startsWith('http://')||p.photo.startsWith('https://')))?p.photo:'';
      var photoHtml=safePhoto?'<a href="'+safePhoto+'" target="_blank" class="photo-link">&#128247; View</a>':'<span style="color:var(--text3);font-size:11px">&#8212;</span>';
      var statusBadge=sold?'<span class="badge bg-red">&#128308; Sold</span>':returned?'<span class="badge" style="background:#fff4e0;color:#a86a00;border:1px solid rgba(168,106,0,0.3);">&#128269; Returned</span>':'<span class="badge bg-green">&#128994; Avail</span>';
      return '<tr class="'+(sold?'sold-row':'')+'">'+
        '<td><div style="font-weight:600;font-size:13px">'+escHtml(p.name)+'</div>'+(p.notes?'<div style="font-size:11px;color:var(--text3)">'+escHtml(p.notes)+'</div>':'')+'<div style="font-size:10px;color:var(--text3)">'+escHtml(p.sku)+'</div></td>'+
        '<td style="font-size:11px;font-weight:600;color:var(--info)">'+(p.huid?p.huid:'<span style="color:var(--text3)">&#8212;</span>')+'</td>'+
        '<td><span class="badge" style="'+pbg+'">'+p.purity+'</span></td>'+
        '<td style="font-weight:700;color:'+(isG?'var(--gold-dark)':'var(--silver-dark)')+'">'+fmtW(p.weight)+'</td>'+
        '<td style="font-size:12px;color:var(--text2)">'+(p.netWeight&&p.netWeight>0?fmtW(p.netWeight):'<span style="color:var(--text3)">&#8212;</span>')+'</td>'+
        '<td style="font-weight:600;color:var(--gold-dark)">'+fmt(mv)+'</td>'+
        '<td>'+photoHtml+'</td>'+
        '<td>'+statusBadge+'</td>'+
        '<td><div style="display:flex;gap:5px;flex-wrap:wrap;">'+
          '<button class="btn btn-sm btn-info" onclick="editProd(\''+p.id+'\')" title="Edit product">&#9998;</button>'+
          '<button class="btn btn-sm" onclick="openItemHistoryModal(\''+p.id+'\')" title="Movement history" style="background:var(--surf2);border:1px solid var(--border2);color:var(--text2);">&#128337;</button>'+
          '<button class="btn btn-sm" onclick="openAdjustStockModal(\''+p.id+'\')" title="Adjust stock quantity" style="background:var(--surf2);border:1px solid var(--border2);color:var(--text2);">&#177;</button>'+
          (returned
            ?'<button class="btn btn-sm btn-success" onclick="markReturnedSellable(\''+p.id+'\')" title="Inspected — move to sellable stock" style="font-size:11px;">&#10003; Mark Sellable</button>'
            :'<button class="btn btn-sm '+(sold?'btn-success':'btn-danger')+'" onclick="toggleStatus(\''+p.id+'\')" style="font-size:11px;">'+(sold?'&#9850; Restore':'&#10005; Sold')+'</button>'
          )+
          '<button class="btn btn-sm btn-danger" onclick="delProd(\''+p.id+'\')" title="Delete">&#128465;</button>'+
        '</div></td>'+
      '</tr>';
    }).join('')
    :'<tr><td colspan="9"><div class="empty"><span class="empty-icon">'+(isG?'&#127775;':'&#11088;')+'</span>No products found</div></td></tr>';

  // "Available" here should mean sellable, not just "not sold" — a
  // returned/pending-inspection item is neither (Foundation audit B5).
  var all=S.products.filter(function(p){return p.metal===m&&p.status!=='sold'&&p.status!=='returned';});
  if(UI.selCat!=='All') all=all.filter(function(p){return p.cat===UI.selCat;});
  var tw=all.reduce(function(s,p){return s+p.weight;},0);
  var tv=all.reduce(function(s,p){return s+p.weight*getRate(p.metal,p.purity);},0);
  var soldCount=S.products.filter(function(p){return p.metal===m&&p.status==='sold';}).length;
  var returnedCount=S.products.filter(function(p){return p.metal===m&&p.status==='returned';}).length;
  document.getElementById('inv-footer').innerHTML=
    '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;">'+
    '<span><span style="color:var(--ink3)">Available</span> <strong style="color:var(--success)">'+all.length+'</strong></span>'+
    (returnedCount?'<span><span style="color:var(--ink3)">Returned (needs inspection)</span> <strong style="color:#a86a00;">'+returnedCount+'</strong></span>':'')+
    '<span><span style="color:var(--ink3)">Total weight</span> <strong style="color:'+(isG?'var(--gold-dark)':'var(--silver-dark)')+'">'+fmtW(tw)+'</strong></span>'+
    '<span><span style="color:var(--ink3)">Market value</span> <strong>'+fmt(tv)+'</strong></span>'+
    '<span style="margin-left:auto"><span style="color:var(--ink3)">Sold</span> <strong style="color:var(--danger)">'+soldCount+'</strong></span>'+
    '</div>';
}

function setCat(c){UI.selCat=c;renderInv();}
function updQty(id,v){
  var p=S.products.find(function(x){return x.id===id;});
  if(!p) return;
  var prevQty=p.qty, prevWeight=p.weight;
  p.qty=Math.max(0,parseInt(v)||0);
  // Weight is derived from unitWeight*qty everywhere else that changes qty
  // (sale deduction, purchase sync). This editor used to skip it, so a manual
  // qty change left the old total weight behind and every weight-based figure
  // — stock valuation, metal totals, reports — silently drifted.
  if(p.unitWeight){ p.weight=Math.round(p.unitWeight*p.qty*1000)/1000; }
  // Manual qty edits were also the one stock change with no audit trail.
  var qtyChange=p.qty-prevQty;
  var moveId=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36);
  if(qtyChange!==0){
    S.stockMovements=S.stockMovements||[];
    S.stockMovements.push({id:moveId,productId:p.id,type:'adjustment',prevStatus:p.status,newStatus:p.status,qtyChange:qtyChange,relatedId:null,relatedRef:'',reason:'Manual quantity edit',user:(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User',ts:new Date().toISOString()});
  }
  saveToCloud(function(err){
    if(!err){ renderInv(); }
    else{
      p.qty=prevQty; p.weight=prevWeight;
      if(qtyChange!==0) S.stockMovements=S.stockMovements.filter(function(m){return m.id!==moveId;});
      saveCache();
      if(err.message!=='version-conflict') toast('\u26a0 Could not save quantity — change rolled back.');
      renderInv();
    }
  });
}

// ── ADJUST STOCK — the entry point updQty() never had ──────────────────
// A separate action, not an inline stepper or an Edit Product field:
// updQty already logs a stockMovements 'adjustment' event, so this is
// modeled as an event with its own stakes, same shape as a sale or
// purchase changing stock, not a quiet metadata edit.
var _asProductId = null;

function openAdjustStockModal(id){
  var p = S.products.find(function(x){ return x.id === id; });
  if(!p) return;
  _asProductId = id;
  var info = document.getElementById('as-product-info');
  if(info) info.innerHTML = '<b>'+escHtml(p.name)+'</b><br/>Current quantity: '+p.qty+' &middot; Current weight: '+fmtW(p.weight);
  var warn = document.getElementById('as-weight-warning');
  if(warn){
    // p.weight only recomputes from qty when unitWeight is set (updQty's
    // own rule) — flag it here rather than let the owner discover it later.
    if(p.unitWeight){
      warn.style.display = 'none';
    } else {
      warn.style.display = 'block';
      warn.textContent = 'No per-unit weight on this item — changing quantity will NOT update the total weight. Correct it in Edit Product if needed.';
    }
  }
  var qtyEl = document.getElementById('as-new-qty');
  if(qtyEl) qtyEl.value = p.qty;
  document.getElementById('adjust-stock-modal').style.display = 'block';
}

function submitAdjustStock(){
  var newQty = parseInt((document.getElementById('as-new-qty')||{}).value, 10);
  if(isNaN(newQty) || newQty < 0){ toast('Enter a valid quantity (0 or more)'); return; }
  var id = _asProductId;
  updQty(id, newQty); // updQty takes the new TOTAL quantity, not a delta
  document.getElementById('adjust-stock-modal').style.display = 'none';
  toast('Stock adjusted');
}

function toggleStatus(id){
  var p=S.products.find(function(x){return x.id===id;});
  if(!p)return;
  var prevStatus=p.status;
  p.status=p.status==='sold'?'available':'sold';
  p.qty=p.status==='sold'?0:1;
  S.stockMovements=S.stockMovements||[];
  var moveId=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36);
  S.stockMovements.push({id:moveId,productId:p.id,type:'adjustment',prevStatus:prevStatus,newStatus:p.status,qtyChange:p.status==='sold'?-1:1,relatedId:null,relatedRef:'',reason:'Manual status toggle',user:(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User',ts:new Date().toISOString()});
  saveToCloud(function(err){
    if(!err){renderInv();renderDash();toast(p.name+': '+( p.status==='sold'?'Marked SOLD':'Restored to AVAILABLE'));}
    else{
      p.status=prevStatus; p.qty=prevStatus==='sold'?0:1;
      S.stockMovements=S.stockMovements.filter(function(m){return m.id!==moveId;});
      saveCache();
      if(err.message!=='version-conflict') toast('\u26a0 Could not save — change rolled back.');
    }
  });
}

// Foundation audit B5: the "inspect" step for an item that came back
// from a refund. A returned item lands in inventory with status
// 'returned' (excluded from sale search, barcode labels, and the
// Available count/total) until someone here confirms it's actually fit
// to resell — e.g. after checking for damage or whether it needs
// re-polishing/re-hallmarking first. This is the only path that flips
// 'returned' → 'available'; toggleStatus above is for the ordinary
// sold/available cycle and is left untouched.
function markReturnedSellable(id){
  var p=S.products.find(function(x){return x.id===id;});
  if(!p || p.status!=='returned') return;
  safeConfirm('Mark as sellable?', escHtml(p.name)+' will move to Available stock and become sellable again.', function(){
    var _prevStatus=p.status;
    p.status='available';
    logStockMovement(p.id,'inspection',{prevStatus:_prevStatus,newStatus:'available',reason:'Inspected — approved for resale'});
    saveToCloud(function(err){
      if(!err){ renderInv(); renderDash(); toast('\u2713 '+p.name+' moved to available stock'); }
      else{ p.status=_prevStatus; S.stockMovements.pop(); saveCache(); if(err.message!=='version-conflict'){ toast('\u26a0 Could not save — change rolled back.'); } renderInv(); }
    });
  });
}

function toggleAdd(){
  var f=document.getElementById('add-form'),b=document.getElementById('add-btn');
  var show=f.style.display==='none';
  f.style.display=show?'block':'none';
  b.textContent=show?'X Close':'+ Add product';
  b.className=show?'btn btn-danger':'btn btn-dark';
  if(show) fillPurities();
}

function addProduct(){
  var name=document.getElementById('f-name').value.trim();
  if(!name){toast('Enter a product name');return;}
  var wt=parseFloat(document.getElementById('f-wt').value)||0;
  if(!wt){toast('Enter gross weight');return;}
  // HUID validation
  var huidRaw = document.getElementById('f-huid').value.trim().toUpperCase();
  var huidCheck = validateHUID(huidRaw);
  if(!huidCheck.ok){ toast('\u26a0 '+huidCheck.msg); document.getElementById('f-huid').focus(); return; }
  var neEl=document.getElementById('f-netwt');
  var netwt=neEl?parseFloat(neEl.value)||0:0;
  var sku=document.getElementById('f-sku').value.trim()||(UI.metal==='gold'?'GLD':'SLV')+'-'+String(S.nextId).padStart(3,'0');
  // Foundation audit §6: block a duplicate SKU or HUID before creating
  // the product, instead of silently accepting a second item under the
  // same identifier.
  var dupHuid = productHuidIsDuplicate(huidRaw, null);
  if(dupHuid){ toast('\u26a0 HUID '+huidRaw+' is already used by "'+dupHuid.name+'" ('+dupHuid.sku+')'); document.getElementById('f-huid').focus(); return; }
  var dupSku = productSkuIsDuplicate(sku, null);
  if(dupSku){ toast('\u26a0 SKU '+sku+' is already used by "'+dupSku.name+'"'); document.getElementById('f-sku').focus(); return; }
  var newProdId = (typeof crypto.randomUUID==='function') ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2));
  S.products.push({
    id: newProdId,
    _seq: S.nextId++,
    name:name,
    cat:document.getElementById('f-cat').value,
    metal:UI.metal,
    purity:document.getElementById('f-purity').value,
    huid:document.getElementById('f-huid').value.trim().toUpperCase(),
    sku:sku,
    weight:wt,
    netWeight:netwt,
    costRate: parseFloat((document.getElementById('f-costrate')||{value:0}).value)||0,
    mcRate:   parseFloat((document.getElementById('f-mcrate')||{value:0}).value)||0,
    unitWeight: wt, unitNetWeight: netwt,
    making:0,diamond:0,qty:1,alert:1,_origQty:1,
    photo:document.getElementById('f-photo').value.trim(),
    notes:document.getElementById('f-notes').value.trim(),
    status:'available'
  });
  ['f-name','f-huid','f-sku','f-wt','f-netwt','f-costrate','f-mcrate','f-photo','f-notes'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  logStockMovement(newProdId, 'opening_stock', {newStatus:'available', qtyChange:1, reason:'Manually added to inventory'});
  saveToCloud(function(err){
    if(!err){ toggleAdd(); renderInv(); toast('Product added & synced!'); }
    else{
      // Foundation audit §6/§4: was a bare success/nothing callback — a
      // failed save left the product AND its movement-ledger entry
      // permanently in this tab's memory with no rollback.
      S.products = S.products.filter(function(x){ return x.id!==newProdId; });
      S.stockMovements = (S.stockMovements||[]).filter(function(m){ return m.productId!==newProdId; });
      saveCache();
      if(err.message!=='version-conflict') toast('\u26a0 Could not save — product not added. Check your connection.');
    }
  });
}

// ── Item movement history viewer (Inventory Foundation audit §5) ───────
// The ledger (logStockMovement, 01-sync-core.js) is only useful if
// someone can actually see it — this is that view, one item at a time,
// newest first. Self-contained overlay, same construction pattern as
// openRefundModal (01-sync-core.js), so it needs no new HTML.
function openItemHistoryModal(productId){
  var p=(S.products||[]).find(function(x){return x.id===productId;});
  var moves=productMovementHistory(productId);
  var mInner=document.getElementById('hist-modal-inner');
  if(!mInner){
    var ov=document.createElement('div');
    ov.id='hist-modal';
    ov.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    ov.innerHTML='<div id="hist-modal-inner" style="background:var(--surface);border-radius:18px;max-width:480px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35);padding:22px;"></div>';
    document.body.appendChild(ov);
    mInner=document.getElementById('hist-modal-inner');
  }
  document.getElementById('hist-modal').style.display='flex';
  var typeLabel={opening_stock:'Added to inventory',purchase:'Purchased',sale:'Sold',return:'Returned',inspection:'Inspected',adjustment:'Adjusted',delete:'Deleted'};
  var typeColor={opening_stock:'var(--success)',purchase:'var(--success)',sale:'var(--info)',return:'#a86a00',inspection:'var(--success)',adjustment:'var(--text2)',delete:'var(--danger)'};
  mInner.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">'+
      '<h3 style="margin:0;font-size:16px;">History'+(p?': '+escHtml(p.name):'')+'</h3>'+
      '<button class="btn btn-sm" onclick="document.getElementById(\'hist-modal\').style.display=\'none\'" style="border:none;background:transparent;font-size:20px;cursor:pointer;">&times;</button>'+
    '</div>'+
    (moves.length===0
      ? '<div style="color:var(--text3);font-size:13px;padding:12px 0;">No recorded movement yet — anything before the inventory foundation update won\'t appear here.</div>'
      : '<div style="display:grid;gap:8px;">'+moves.map(function(m){
          return '<div style="border:1px solid var(--border2);border-radius:10px;padding:10px 12px;font-size:12px;">'+
            '<div style="display:flex;justify-content:space-between;gap:8px;">'+
              '<span style="font-weight:700;color:'+(typeColor[m.type]||'var(--text2)')+';">'+(typeLabel[m.type]||m.type)+'</span>'+
              '<span style="color:var(--text3);">'+new Date(m.ts).toLocaleString('en-IN')+'</span>'+
            '</div>'+
            (m.reason?'<div style="margin-top:3px;color:var(--text2);">'+escHtml(m.reason)+'</div>':'')+
            (m.relatedRef?'<div style="margin-top:3px;color:var(--text3);">Ref: '+escHtml(m.relatedRef)+'</div>':'')+
            ((m.prevStatus||m.newStatus)?'<div style="margin-top:3px;color:var(--text3);">Status: '+(m.prevStatus||'—')+' \u2192 '+(m.newStatus||'—')+'</div>':'')+
            ((typeof m.qtyChange==='number')?'<div style="margin-top:3px;color:var(--text3);">Qty: '+(m.qtyChange>0?'+':'')+m.qtyChange+'</div>':'')+
            '<div style="margin-top:3px;color:var(--text3);">by '+escHtml(m.user)+'</div>'+
          '</div>';
        }).join('')+'</div>'
    );
}

function delProd(id){
  if(!isManager()){ toast('\u26a0 Only owners and managers can delete products'); return; }
  var p=S.products.find(function(x){return x.id===id;});
  if(!p) return;
  safeConfirm('Delete product?','This will remove it from all devices and cannot be undone.',function(){
    var _snap=JSON.parse(JSON.stringify(p));
    S.products=S.products.filter(function(x){return x.id!==id;});
    S.stockMovements=S.stockMovements||[];
    var moveId=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36);
    S.stockMovements.push({id:moveId,productId:id,type:'delete',prevStatus:_snap.status,newStatus:null,qtyChange:-(_snap.qty||0),relatedId:null,relatedRef:'',reason:'Deleted from inventory',user:(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User',ts:new Date().toISOString()});
    saveToCloud(function(err){
      if(!err){renderInv();toast('Deleted & synced');}
      else{
        // Foundation audit §4: was a bare success-only callback — a
        // failed delete left the product gone locally with the cloud
        // still having it, permanently, until a manual full reload.
        S.products.push(_snap);
        S.stockMovements=S.stockMovements.filter(function(m){return m.id!==moveId;});
        saveCache();
        if(err.message!=='version-conflict') toast('\u26a0 Could not delete — change rolled back.');
        renderInv();
      }
    });
  },true);
  return;
}

// ─── SALES ───────────────────────────────────────────────────────────────
function initSaleDate(){
  var d=document.getElementById('s-date');
  if(!d.value) d.value=dbDayKey(new Date()); // local IST day, not toISOString()'s UTC day
  // Invoice No. stays blank: the number is assigned at save time (allocInvNo).
}

function custAutocomplete(){
  var q=(document.getElementById('s-cust').value||'').toLowerCase().trim();
  var box=document.getElementById('cust-suggestions');
  if(!q){box.style.display='none';return;}
  var seen={};
  var matches=S.sales.filter(function(s){
    var n=(s.customer||'').toLowerCase();
    if(n.indexOf(q)===0&&!seen[s.customer]){seen[s.customer]=1;return true;}
    return false;
  }).slice(0,5);
  if(!matches.length){box.style.display='none';return;}
  box.style.display='block';
  box.innerHTML=matches.map(function(s){
    return '<div style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);" onclick="fillCust(\''+jsAttrEsc(s.customer)+'\',\''+jsAttrEsc(s.phone||'')+'\')">'+
      '<strong>'+escHtml(s.customer)+'</strong>'+(s.phone?' &bull; '+escHtml(s.phone):'')+
    '</div>';
  }).join('');
}

function fillCust(name,phone){
  // name/phone arrive already HTML-attribute-decoded by the browser -- the
  // markup that calls this escapes them with jsAttrEsc(), not encodeURIComponent(),
  // so decoding here would both be wrong and throw on a name containing a
  // raw '%' (security review, 23 Sep 2026 HANDOFF entry: this used to be a
  // stored-XSS gap -- encodeURIComponent() does not escape the quote/paren
  // characters needed to break out of the onclick attribute).
  document.getElementById('s-cust').value=name;
  document.getElementById('s-phone').value=phone;
  document.getElementById('cust-suggestions').style.display='none';
}

function renderSaleItems(){
  var wrap=document.getElementById('sale-items');
  wrap.innerHTML='';
  UI.saleItems.forEach(function(item,i){
    var card=document.createElement('div');
    card.className='sale-card';
    card.id='si-card-'+i;
    var p=item.pid?S.products.find(function(x){return x.id==item.pid;}):null;

    // Header row
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;';
    hdr.innerHTML='<div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Item '+(i+1)+'</div>';
    if(UI.saleItems.length>1){
      var rb=document.createElement('button');
      rb.className='btn btn-sm btn-danger';
      rb.textContent='Remove';
      (function(idx){rb.onclick=function(){removeSI(idx);};})(i);
      hdr.appendChild(rb);
    }
    card.appendChild(hdr);

    // SKU search row + qty
    var grid=document.createElement('div');
    grid.className='form-grid';

    // SKU input with autocomplete
    var skuFg=document.createElement('div');
    skuFg.className='fg';
    skuFg.innerHTML='<label>SKU / Item Code</label>';
    var skuInput=document.createElement('input');
    skuInput.id='si-sku-'+i;
    skuInput.placeholder='Type SKU or item name...';
    skuInput.value=p?p.sku:'';
    skuInput.autocomplete='off';
    skuInput.style.cssText='text-transform:uppercase;';
    var sugBox=document.createElement('div');
    sugBox.id='si-sug-'+i;
    sugBox.style.cssText='display:none;position:absolute;z-index:300;background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius);width:100%;max-height:200px;overflow-y:auto;box-shadow:var(--shadow);';
    var skuWrap=document.createElement('div');
    skuWrap.style.cssText='position:relative;';
    skuWrap.appendChild(skuInput);
    skuWrap.appendChild(sugBox);
    skuFg.appendChild(skuWrap);

    (function(idx,inp,sug){
      inp.oninput=function(){skuSearch(idx,inp.value,sug);};
      inp.onkeydown=function(e){
        if(e.key==='Escape'){sug.style.display='none';}
        if(e.key==='Enter'){
          // FIX: this is the barcode-scanner and fast-typist path — type
          // (or scan) the exact SKU, hit Enter, expect it to just work.
          // Previously nothing handled Enter at all; only clicking a
          // dropdown suggestion ever set item.pid, so a scanned/typed
          // SKU silently never attached to the sale (see buildSaleObj).
          e.preventDefault();
          sug.style.display='none';
          resolveSkuInput(idx);
        }
      };
      inp.onblur=function(){
        // Delay slightly so a suggestion-row click (which also blurs
        // the input) can register its own onclick/onSP first — otherwise
        // this blur-time exact-match resolver would run first and could
        // fight with the click handler over which product gets picked.
        setTimeout(function(){ resolveSkuInput(idx); }, 150);
      };
      // Hide suggestions on outside click
      document.addEventListener('click',function(e){
        if(!skuWrap.contains(e.target))sug.style.display='none';
      },{once:false});
    })(i,skuInput,sugBox);

    // Qty input
    var qtyFg=document.createElement('div');
    qtyFg.className='fg';
    qtyFg.innerHTML='<label>Quantity</label>';
    var qtyInput=document.createElement('input');
    qtyInput.type='number';
    qtyInput.setAttribute('inputmode','numeric');
    qtyInput.min='1';
    qtyInput.value=item.qty||1;
    (function(idx){qtyInput.onchange=function(){onSQ(idx,this.value);};})(i);
    qtyFg.appendChild(qtyInput);

    grid.appendChild(skuFg);
    grid.appendChild(qtyFg);
    card.appendChild(grid);

    // Product info bar + deductions (shown when product is selected)
    if(p){
      var info=document.createElement('div');
      info.style.cssText='margin-top:8px;font-size:12px;color:var(--ink2);background:var(--gold-bg);padding:11px 13px;border-radius:var(--radius);border:0.5px solid rgba(201,168,76,0.25);';

      // Top row: name, purity, gross weight, rate
      var topRow=document.createElement('div');
      topRow.style.cssText='display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;margin-bottom:10px;';
      topRow.innerHTML=
        '<div>'+
          '<div style="font-weight:700;font-size:14px;color:var(--text);">'+escHtml(p.name)+'</div>'+
          '<div style="margin-top:3px;">'+
            '<span class="badge '+(p.metal==='gold'?'bg-gold':'bg-silver')+'">'+p.purity+'</span>'+
            '&nbsp; Gross: <strong>'+fmtW(p.weight)+'</strong>'+
            '&nbsp; Rate: <strong>'+fmt(getRate(p.metal,p.purity))+'/g</strong>'+
            (p.huid?'&nbsp; HUID: <strong style="color:var(--info);">'+escHtml(p.huid)+'</strong>':'')+
          '</div>'+
        '</div>'+
        '<div style="text-align:right;">'+
          '<div id="si-lineval-'+i+'" style="font-weight:700;font-size:14px;color:var(--gold-dark);">'+fmt(getRate(p.metal,p.purity)*p.weight)+'</div>'+
        '</div>';
      info.appendChild(topRow);

      // ── Deduction box ──────────────────────────────────────────────
      var dbox=document.createElement('div');
      dbox.style.cssText='background:rgba(201,168,76,0.05);border:0.5px dashed rgba(201,168,76,0.35);border-radius:var(--radius);padding:9px 11px;margin-bottom:9px;';

      var dtitle=document.createElement('div');
      dtitle.style.cssText='font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text3);margin-bottom:8px;';
      dtitle.innerHTML='&#11015; Weight Deductions &nbsp;<span style="font-weight:400;font-style:italic;">(enter weight to subtract from gross)</span>';
      dbox.appendChild(dtitle);

      var dgrid=document.createElement('div');
      dgrid.style.cssText='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;';

      // Black Beads field
      var bbWrap=document.createElement('div');
      bbWrap.innerHTML='<div style="font-size:11px;color:var(--text3);margin-bottom:3px;">&#9679; Black Beads (g)</div>';
      var bbIW=document.createElement('div'); bbIW.className='isuf';
      var bbI=document.createElement('input'); bbI.type='text'; bbI.setAttribute('inputmode','decimal');
      bbI.placeholder='0.000'; bbI.id='si-bb-'+i;
      bbI.value=(item.blackBeads>0)?item.blackBeads:'';
      bbI.style.cssText='font-size:12px;';
      (function(idx){bbI.oninput=function(){UI.saleItems[idx].blackBeads=parseFloat(this.value)||0;refreshStockDeductDisplay(idx);updateSum();};})(i);
      var bbS=document.createElement('span'); bbS.className='suf'; bbS.textContent='g';
      bbIW.appendChild(bbI); bbIW.appendChild(bbS); bbWrap.appendChild(bbIW);
      dgrid.appendChild(bbWrap);

      // Diamond/Stone field
      var dwWrap=document.createElement('div');
      dwWrap.innerHTML='<div style="font-size:11px;color:var(--text3);margin-bottom:3px;">&#128142; Diamond/Stone (g)</div>';
      var dwIW=document.createElement('div'); dwIW.className='isuf';
      var dwI=document.createElement('input'); dwI.type='text'; dwI.setAttribute('inputmode','decimal');
      dwI.placeholder='0.000'; dwI.id='si-dw-'+i;
      dwI.value=(item.diamondWt>0)?item.diamondWt:'';
      dwI.style.cssText='font-size:12px;';
      (function(idx){dwI.oninput=function(){UI.saleItems[idx].diamondWt=parseFloat(this.value)||0;refreshStockDeductDisplay(idx);updateSum();};})(i);
      var dwS=document.createElement('span'); dwS.className='suf'; dwS.textContent='g';
      dwIW.appendChild(dwI); dwIW.appendChild(dwS); dwWrap.appendChild(dwIW);
      dgrid.appendChild(dwWrap);

      // Other deduction field
      var owWrap=document.createElement('div');
      owWrap.innerHTML='<div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Other (g)</div>';
      var owIW=document.createElement('div'); owIW.className='isuf';
      var owI=document.createElement('input'); owI.type='text'; owI.setAttribute('inputmode','decimal');
      owI.placeholder='0.000'; owI.id='si-ow-'+i;
      owI.value=(item.otherWt>0)?item.otherWt:'';
      owI.style.cssText='font-size:12px;';
      (function(idx){owI.oninput=function(){UI.saleItems[idx].otherWt=parseFloat(this.value)||0;refreshStockDeductDisplay(idx);updateSum();};})(i);
      var owS=document.createElement('span'); owS.className='suf'; owS.textContent='g';
      owIW.appendChild(owI); owIW.appendChild(owS); owWrap.appendChild(owIW);
      dgrid.appendChild(owWrap);

      dbox.appendChild(dgrid);

      // Net weight result row
      var netRow=document.createElement('div');
      netRow.id='si-netrow-'+i;
      netRow.style.cssText='margin-top:8px;font-size:12px;';
      refreshStockDeductDisplay_el(netRow, p, item);
      dbox.appendChild(netRow);
      info.appendChild(dbox);
      // ── End deduction box ──────────────────────────────────────────

      // Photo link
      var safePhotoUrl=(p.photo&&(p.photo.startsWith('http://')||p.photo.startsWith('https://')))?p.photo:'';
      if(safePhotoUrl){
        var phLink=document.createElement('a');
        phLink.href=safePhotoUrl; phLink.target='_blank';
        phLink.style.cssText='font-size:12px;color:var(--info);display:inline-block;margin-right:10px;';
        phLink.innerHTML='&#128247; View Photo';
        info.appendChild(phLink);
      }

      // Clear button
      var clrBtn=document.createElement('button');
      clrBtn.className='btn btn-sm btn-danger';
      clrBtn.style.cssText='font-size:11px;';
      clrBtn.innerHTML='&#10005; Clear Item';
      (function(idx){clrBtn.onclick=function(){onSP(idx,'');renderSaleItems();};})(i);
      info.appendChild(clrBtn);
      card.appendChild(info);
    }

    wrap.appendChild(card);
  });
  updateSum();
}

function skuSearch(idx,val,sugBox){
  var q=val.trim().toLowerCase();
  sugBox.style.display='none';
  sugBox.innerHTML='';
  if(!q||q.length<1)return;
  var matches=S.products.filter(function(p){
    return p.status!=='sold'&&p.status!=='returned'&&(
      p.sku.toLowerCase().indexOf(q)>-1||
      p.name.toLowerCase().indexOf(q)>-1||
      (p.huid&&p.huid.toLowerCase().indexOf(q)>-1)
    );
  }).slice(0,10);
  if(!matches.length)return;
  sugBox.style.display='block';
  matches.forEach(function(p){
    var row=document.createElement('div');
    row.style.cssText='padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);';
    row.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
        '<div>'+
          '<div style="font-weight:700;font-size:13px;">'+escHtml(p.name)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:2px;">'+
            '<span style="font-weight:700;color:var(--info);">'+escHtml(p.sku)+'</span>'+
            ' &bull; '+escHtml(p.purity)+' &bull; '+fmtW(p.weight)+
            (p.huid?' &bull; HUID: '+p.huid:'')+
          '</div>'+
        '</div>'+
        '<div style="text-align:right;flex-shrink:0;margin-left:8px;">'+
          '<div style="font-weight:700;color:var(--gold-dark);font-size:13px;">'+fmt(getRate(p.metal,p.purity)*p.weight)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);">'+p.qty+' in stock</div>'+
        '</div>'+
      '</div>';
    row.onmouseover=function(){this.style.background='var(--bg2)';};
    row.onmouseout=function(){this.style.background='';};
    (function(prod){
      row.onclick=function(){
        onSP(idx,prod.id);
        sugBox.style.display='none';
      };
    })(p);
    sugBox.appendChild(row);
  });
}

function onSP(i,v){
  // Batch 7 regression fix: product ids became UUIDs (crypto.randomUUID)
  // when addProduct was rewritten, but this still ran parseInt on them.
  // parseInt('a3f8c1d2-...') is NaN, so clicking a dropdown suggestion
  // set pid=NaN, the product lookup failed, and the row cleared itself —
  // which made it impossible to bill anything picked from the dropdown.
  // Ids are opaque strings now; never coerce them.
  UI.saleItems[i].pid=v||'';
  UI.saleItems[i].blackBeads=0;
  UI.saleItems[i].diamondWt=0;
  UI.saleItems[i].otherWt=0;
  UI.saleItems[i].skuUnresolved=false;
  renderSaleItems();
}

// FIX (sale SKU not saving): resolves whatever text is currently typed
// in a sale row's SKU field into a real product, for the two cases
// clicking a dropdown suggestion never covered — pressing Enter after
// typing/scanning an exact SKU, and tabbing/clicking away without ever
// opening the dropdown. Tries an exact SKU match first, then an exact
// HUID match (both case-insensitive), matching how skuSearch's partial
// search already treats those two fields as equivalent lookup keys.
// A typed value that matches nothing is left visibly unresolved
// (skuUnresolved=true) rather than silently dropped — see recordSale(),
// which now blocks the sale instead of quietly billing fewer items than
// the staff member actually entered.
function resolveSkuInput(idx){
  var inp=document.getElementById('si-sku-'+idx);
  if(!inp) return;
  var typed=inp.value.trim();
  var item=UI.saleItems[idx];
  if(!item) return;

  // Already resolved to a product whose SKU still matches what's typed —
  // nothing to do (covers the normal click-a-suggestion path).
  if(item.pid){
    var current=S.products.find(function(x){return x.id==item.pid;});
    if(current && current.sku && current.sku.toLowerCase()===typed.toLowerCase()) return;
  }

  if(!typed){ item.pid=''; item.skuUnresolved=false; return; }

  var q=typed.toLowerCase();
  var bySku=S.products.filter(function(p){return p.status!=='sold'&&p.status!=='returned'&&p.sku&&p.sku.toLowerCase()===q;});
  var match=bySku[0];
  if(!match){
    var byHuid=S.products.filter(function(p){return p.status!=='sold'&&p.status!=='returned'&&p.huid&&p.huid.toLowerCase()===q;});
    match=byHuid[0];
  }

  if(match){
    onSP(idx,match.id); // re-renders, which also refreshes this input's displayed value from the resolved product
  } else {
    item.pid='';
    item.skuUnresolved=true;
    inp.style.borderColor='var(--danger,#c0392b)';
    inp.title='No matching item found for "'+typed+'" — pick from the dropdown or check the SKU';
  }
}

// Refresh the net weight display row using a DOM element reference
function refreshStockDeductDisplay_el(netRow, p, item){
  var bb=parseFloat(item.blackBeads)||0;
  var dw=parseFloat(item.diamondWt)||0;
  var ow=parseFloat(item.otherWt)||0;
  var totalDeduct=bb+dw+ow;
  var netWt=Math.max(0,p.weight-totalDeduct);
  var rate=getRate(p.metal,p.purity);
  if(totalDeduct>0){
    netRow.innerHTML=
      '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">'+
        '<span style="color:var(--text3);">'+fmtW(p.weight)+'</span>'+
        (bb>0?'<span style="color:var(--danger);font-size:11px;">&#8722; '+fmtW(bb)+' beads</span>':'')+
        (dw>0?'<span style="color:var(--danger);font-size:11px;">&#8722; '+fmtW(dw)+' stone</span>':'')+
        (ow>0?'<span style="color:var(--danger);font-size:11px;">&#8722; '+fmtW(ow)+' other</span>':'')+
        '<span style="color:var(--text3);">=</span>'+
        '<span style="font-weight:700;color:var(--gold-dark);">'+fmtW(netWt)+' net gold</span>'+
        '<span style="color:var(--text3);font-size:11px;">('+fmt(rate*netWt)+')</span>'+
      '</div>';
  } else {
    netRow.innerHTML='<span style="font-size:11px;color:var(--text3);">Enter deductions above to subtract from gross weight</span>';
  }
}

// Called on input change — refreshes by ID
function refreshStockDeductDisplay(idx){
  var item=UI.saleItems[idx];
  var p=item.pid?S.products.find(function(x){return x.id==item.pid;}):null;
  if(!p) return;
  var netRow=document.getElementById('si-netrow-'+idx);
  if(netRow) refreshStockDeductDisplay_el(netRow, p, item);
  // Also update line value display
  var lv=document.getElementById('si-lineval-'+idx);
  if(lv){
    var bb=parseFloat(item.blackBeads)||0;
    var dw=parseFloat(item.diamondWt)||0;
    var ow=parseFloat(item.otherWt)||0;
    var net=Math.max(0,p.weight-bb-dw-ow);
    lv.textContent=fmt(getRate(p.metal,p.purity)*net);
  }
}
function onSQ(i,v){UI.saleItems[i].qty=Math.max(1,parseInt(v)||1);updateSum();}
function addSI(){UI.saleItems.push({pid:'',qty:1,blackBeads:0,diamondWt:0,otherWt:0});renderSaleItems();}
function removeSI(i){UI.saleItems.splice(i,1);renderSaleItems();}

// Payment status: 'full' | 'advance' | 'pending'
var payStatus = 'full';

var ogMode = 'direct'; // 'direct' | 'calc'
function setOgMode(mode){
  ogMode = mode;
  var btnDirect = document.getElementById('og-mode-direct');
  var btnCalc   = document.getElementById('og-mode-calc');
  var rowDirect = document.getElementById('og-direct-row');
  var rowCalc   = document.getElementById('og-calc-row');
  if(btnDirect) btnDirect.style.cssText = 'padding:4px 12px;font-size:11px;font-weight:700;border:none;cursor:pointer;font-family:inherit;background:'+(mode==='direct'?'var(--gold);color:#1a1814':'transparent;color:var(--gold-dark)')+';';
  if(btnCalc)   btnCalc.style.cssText   = 'padding:4px 12px;font-size:11px;font-weight:600;border:none;cursor:pointer;font-family:inherit;background:'+(mode==='calc'?'var(--gold);color:#1a1814':'transparent;color:var(--gold-dark)')+';';
  if(rowDirect) rowDirect.style.display = mode==='direct' ? 'block' : 'none';
  if(rowCalc)   rowCalc.style.display   = mode==='calc'   ? 'block' : 'none';
  // Clear the inactive mode's fields so they don't interfere
  if(mode==='direct'){
    var wtEl=document.getElementById('s-oldgold-wt'); if(wtEl) wtEl.value='';
    var purEl=document.getElementById('s-oldgold-purity'); if(purEl) purEl.value='';
    var valEl=document.getElementById('s-oldgold-val'); if(valEl){valEl.value='';valEl._manualEdit=false;}
  } else {
    var dEl=document.getElementById('s-oldgold-direct'); if(dEl) dEl.value='';
  }
  updateSum();
}

function setPayStatus(status){
  // payStatus is now auto-determined in updateSum based on amounts
  // This function kept for compatibility with convertToSale etc.
  payStatus = status;
  if(status==='full'){
    // Fill paying-now with grand total
    var grandEl=document.getElementById('ss-total');
    var nowEl=document.getElementById('s-advance');
    if(grandEl&&nowEl){
      var g=parseFloat(grandEl.textContent.replace(/[^\d]/g,''))||0;
      nowEl.value=g;
    }
  } else if(status==='pending'){
    var nowEl2=document.getElementById('s-advance');
    if(nowEl2) nowEl2.value=0;
  }
  updateSum();
}

function updateSum(){
  var gv=0,mc=0,dc=0;
  if(UI.saleMode==='custom'){
    customSaleItems.forEach(function(item,i){
      var gwEl=document.getElementById('csi-gw-'+i);
      var bbEl=document.getElementById('csi-bb-'+i);
      var dwEl=document.getElementById('csi-dw-'+i);
      var mkEl=document.getElementById('csi-mk-'+i);
      var scEl=document.getElementById('csi-sc-'+i);
      if(gwEl)item.grossWt=parseFloat(gwEl.value)||0;
      if(bbEl)item.blackBeads=parseFloat(bbEl.value)||0;
      if(dwEl)item.diamond=parseFloat(dwEl.value)||0;
      if(mkEl)item.making=parseFloat(mkEl.value)||0;
      if(scEl)item.stoneCharges=parseFloat(scEl.value)||0;
      var net=calcNetGold(item);
      var rate=getRate(item.metal||'gold',item.purity||'22K');
      // Metal is valued on net weight; making is charged on gross.
      gv+=rate*net; mc+=(parseFloat(item.making)||0)*(parseFloat(item.grossWt)||0); dc+=parseFloat(item.stoneCharges)||0;
    });
  } else {
    UI.saleItems.forEach(function(item){
      if(!item.pid)return;
      var p=S.products.find(function(x){return x.id==item.pid;});
      if(!p)return;
      var bb=parseFloat(item.blackBeads)||0;
      var dw=parseFloat(item.diamondWt)||0;
      var ow=parseFloat(item.otherWt)||0;
      var netWt=Math.max(0,p.weight-bb-dw-ow);
      gv+=getRate(p.metal,p.purity)*netWt;
      // Must match buildSaleRecord()'s stock branch exactly, or this preview
      // disagrees with the total actually locked onto the bill.
      mc+=(parseFloat(p.mcRate)||0)*(parseFloat(p.weight)||0);
    });
  }
  mc+=(parseFloat(document.getElementById('s-making').value)||0);
  dc+=(parseFloat(document.getElementById('s-diamond').value)||0);
  var sub=gv+mc+dc;
  var gstPct=parseFloat(document.getElementById('s-gst').value)||0;
  var disc=parseFloat(document.getElementById('s-disc').value)||0;
  // Must match calcSaleTotals(): GST is charged on the value net of any
  // discount recorded at time of sale, not on the pre-discount subtotal —
  // otherwise this live preview disagrees with the actual saved invoice.
  var taxable=Math.max(0,sub-disc);
  var gstAmt=taxable*gstPct/100;
  var grand=Math.max(0,taxable+gstAmt);

  document.getElementById('ss-gv').textContent=fmt(gv);
  document.getElementById('ss-mc').textContent=fmt(mc);
  document.getElementById('ss-dc').textContent=fmt(dc);
  document.getElementById('ss-sub').textContent=fmt(sub);
  document.getElementById('ss-gst').textContent=fmt(gstAmt)+(gstPct?' ('+gstPct+'%)':'');
  document.getElementById('ss-disc').textContent=fmt(disc);
  document.getElementById('ss-total').textContent=fmt(grand);

  // ── Payment calculation ─────────────────────────────────────────────────
  // Old gold deduction — read from whichever mode is active
  var ogVal = 0;
  var ogWt = 0; var ogPur = '';
  if(ogMode==='direct'){
    ogVal = parseFloat((document.getElementById('s-oldgold-direct')||{value:0}).value)||0;
  } else {
    ogWt  = parseFloat((document.getElementById('s-oldgold-wt')||{value:0}).value)||0;
    ogPur = (document.getElementById('s-oldgold-purity')||{value:''}).value;
    var ogValOverride = parseFloat((document.getElementById('s-oldgold-val')||{value:''}).value)||0;
    ogVal = ogValOverride>0 ? ogValOverride : (ogWt>0&&ogPur ? getRate('gold',ogPur)*ogWt : 0);
    // Auto-fill calculated value field
    var ogDisp = document.getElementById('s-oldgold-display');
    var ogValEl = document.getElementById('s-oldgold-val');
    if(ogWt>0&&ogPur&&!(ogValEl&&ogValEl._manualEdit)){
      var autoV = Math.round(getRate('gold',ogPur)*ogWt);
      if(ogValEl) ogValEl.value = autoV||'';
      if(ogDisp){ ogDisp.style.display='block'; ogDisp.textContent='Auto: '+fmtW(ogWt)+' × '+fmt(getRate('gold',ogPur))+'/g = '+fmt(autoV); }
    } else {
      if(ogDisp) ogDisp.style.display='none';
    }
  }

  // Sync split total to legacy hidden field before reading
  if(typeof getSplitTotal==='function'){ var st=getSplitTotal(); var sa=document.getElementById('s-advance'); if(sa) sa.value=st; }
  // Prev advance
  var prevAdv = Math.max(0, parseFloat((document.getElementById('s-prev-advance')||{value:0}).value)||0);

  // Now paying — sum all split payment rows
  var nowPay  = (typeof getSplitTotal==='function') ? getSplitTotal() : Math.max(0,parseFloat((document.getElementById('s-advance')||{value:0}).value)||0);

  // Total collected = old gold + prev advance + now paying
  var totalCollected = ogVal + prevAdv + nowPay;
  var balance = Math.max(0, grand - totalCollected);
  var overpaid = Math.max(0, totalCollected - grand);

  // Determine payStatus for saving
  if(totalCollected >= grand) payStatus = 'full';
  else if(totalCollected > 0) payStatus = 'advance';
  else payStatus = 'pending';

  // Show/hide balance due row
  var balDueRow = document.getElementById('balance-due-row');
  var balDisp   = document.getElementById('s-bal-due-display');
  if(balDueRow) balDueRow.style.display = grand>0 ? 'block' : 'none';
  if(balDisp)   balDisp.textContent = fmt(grand);

  // Show still-pending or fully-cleared
  var stillRow    = document.getElementById('still-pending-row');
  var clearedRow  = document.getElementById('fully-cleared-row');
  var stillAmt    = document.getElementById('s-still-pending');
  if(stillRow && clearedRow){
    if(grand <= 0){
      stillRow.style.display='none'; clearedRow.style.display='none';
    } else if(balance > 0){
      stillRow.style.display='block'; clearedRow.style.display='none';
      if(stillAmt) stillAmt.textContent = fmt(balance);
    } else {
      stillRow.style.display='none'; clearedRow.style.display='block';
    }
  }

  // Payment summary row in sum box
  var row = document.getElementById('payment-summary-row');
  if(!row) return;
  var html='';
  if(ogVal>0)
    html+='<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:var(--gold-dark);">&#9851; Old Gold deduction</span><span style="color:var(--gold-dark);font-weight:600;">- '+fmt(ogVal)+'</span></div>';
  if(prevAdv>0)
    html+='<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:var(--success);">&#10003; Advance already paid</span><span style="color:var(--success);font-weight:600;">- '+fmt(prevAdv)+'</span></div>';
  if(nowPay>0)
    html+='<div style="display:flex;justify-content:space-between;font-size:13px;padding:3px 0;"><span style="color:var(--success);">&#128179; Paying now</span><span style="color:var(--success);font-weight:600;">- '+fmt(nowPay)+'</span></div>';
  if(totalCollected>0)
    html+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-top:1px dashed var(--border2);margin-top:4px;color:var(--text2);"><span>Total collected</span><span>'+fmt(totalCollected)+'</span></div>';
  // Final status
  if(balance>0){
    html+='<div style="display:flex;justify-content:space-between;font-size:16px;font-weight:800;padding:7px 0;margin-top:4px;border-top:2px solid var(--danger);color:var(--danger);">'+
      '<span>&#9201; Balance Due</span><span>'+fmt(balance)+'</span></div>';
  } else if(grand>0){
    html+='<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;padding:7px 0;margin-top:4px;border-top:2px solid var(--success);color:var(--success);">'+
      '<span>&#10003; Fully Settled</span><span>'+fmt(grand)+'</span></div>';
    if(overpaid>0) html+='<div style="font-size:12px;color:var(--text3);padding:3px 0;">Change to return: '+fmt(overpaid)+'</div>';
  }
  row.innerHTML=html;
}

function buildSaleObj(){
  var saleItems;
  if(UI.saleMode==='custom'){
    customSaleItems.forEach(function(item,i){
      var gwEl=document.getElementById('csi-gw-'+i);var bbEl=document.getElementById('csi-bb-'+i);
      var dwEl=document.getElementById('csi-dw-'+i);var mkEl=document.getElementById('csi-mk-'+i);
      var scEl=document.getElementById('csi-sc-'+i);var nmEl=document.getElementById('csi-name-'+i);
      if(gwEl)item.grossWt=parseFloat(gwEl.value)||0; if(bbEl)item.blackBeads=parseFloat(bbEl.value)||0;
      if(dwEl)item.diamond=parseFloat(dwEl.value)||0; if(mkEl)item.making=parseFloat(mkEl.value)||0;
      if(scEl)item.stoneCharges=parseFloat(scEl.value)||0; if(nmEl)item.name=nmEl.value.trim();
    });
    saleItems=customSaleItems.filter(function(x){return x.name&&(parseFloat(x.grossWt)||0)>0;}).map(function(item){
      var net=calcNetGold(item);
      var lockedRate=getRate(item.metal||'gold',item.purity||'22K');
      // makingBasis records what this bill was actually charged on, so the
      // figures stay reproducible if the shop's basis ever changes again.
      return{pid:null,name:item.name,qty:1,grossWeight:parseFloat(item.grossWt)||0,blackBeads:parseFloat(item.blackBeads)||0,diamondWt:parseFloat(item.diamond)||0,weight:net,purity:item.purity||'22K',metal:item.metal||'gold',making:parseFloat(item.making)||0,makingBasis:'gross',diamond:parseFloat(item.stoneCharges)||0,huid:'',isCustom:true,lockedRate:lockedRate};
    });
  } else {
    saleItems=UI.saleItems.filter(function(x){return x.pid;}).map(function(item){
      var p=S.products.find(function(x){return x.id==item.pid;});
      var bb=parseFloat(item.blackBeads)||0;
      var dw=parseFloat(item.diamondWt)||0;
      var ow=parseFloat(item.otherWt)||0;
      var netWt=Math.max(0,p.weight-bb-dw-ow);
      var lockedRate=getRate(p.metal,p.purity);
      return{
        pid:p.id,name:p.name,qty:1,
        grossWeight:p.weight,
        blackBeads:bb,
        diamondWt:dw,
        otherWt:ow,
        weight:netWt,  // net gold weight used for billing
        purity:p.purity,metal:p.metal,
        // The product's "Making Charge ₹/g" (mcRate), converted here to the
        // flat rupee amount itemMakingAmount() expects for a stock item, and
        // charged on gross weight like every other making charge. Stored as a
        // value, not a rate, so editing the product later cannot restate a
        // bill that was already printed and paid.
        making:(parseFloat(p.mcRate)||0)*(parseFloat(p.weight)||0),
        diamond:0,
        huid:p.huid||'',
        lockedRate:lockedRate
      };
    });
  }
  var gv=0,mc=0,dc=0;
  saleItems.forEach(function(i){
    gv+=getRate(i.metal,i.purity)*i.weight*i.qty;
    // Was `i.making*i.qty` for every item. That is right for a stock item,
    // where making is a flat rupee amount, but a custom item's making is a
    // per-gram rate — so custom bills locked a grand total with making
    // charged once instead of per gram (₹500/g on a 20g bangle locked ₹500,
    // not ₹10,000). calcSaleTotals() multiplies by weight, so the displayed
    // breakdown and the locked total disagreed. One helper now does both.
    mc+=itemMakingAmount(i); dc+=i.diamond*i.qty;
  });
  mc+=(parseFloat(document.getElementById('s-making').value)||0);
  dc+=(parseFloat(document.getElementById('s-diamond').value)||0);
  var sub=gv+mc+dc;
  var gstPct=parseFloat(document.getElementById('s-gst').value)||0;
  var disc=parseFloat(document.getElementById('s-disc').value)||0;
  // Must match calcSaleTotals(): GST on the discount-adjusted taxable
  // value. This is the actual value locked onto the sale record below
  // (lockedGrand) — getting this right here is what matters; the fallback
  // formula in calcSaleTotals() never runs once lockedGrand is set.
  var taxable=Math.max(0,sub-disc);
  var grand=Math.max(0,taxable+taxable*gstPct/100);
  // Collect all payment fields
  var ogWtB=0,ogPurB='',ogValB=0;
  if(ogMode==='direct'){
    ogValB = parseFloat((document.getElementById('s-oldgold-direct')||{value:0}).value)||0;
  } else {
    ogWtB   = parseFloat((document.getElementById('s-oldgold-wt')||{value:0}).value)||0;
    ogPurB  = (document.getElementById('s-oldgold-purity')||{value:''}).value;
    var ogValOvB= parseFloat((document.getElementById('s-oldgold-val')||{value:''}).value)||0;
    ogValB  = ogValOvB>0 ? ogValOvB : (ogWtB>0&&ogPurB ? getRate('gold',ogPurB)*ogWtB : 0);
  }
  var prevAdvB= Math.max(0,parseFloat((document.getElementById('s-prev-advance')||{value:0}).value)||0);
  var prevAdvModeB = (document.getElementById('s-prev-advance-mode')||{value:'Cash'}).value;
  var nowPayB = (typeof getSplitTotal==='function') ? getSplitTotal() : Math.max(0,parseFloat((document.getElementById('s-advance')||{value:0}).value)||0);
  var nowPayModeB = (splitRows&&splitRows[0]) ? splitRows[0].mode : ((document.getElementById('s-pay')||{value:'Cash'}).value);
  var splitPaymentsB = (typeof splitRows!=='undefined') ? splitRows.filter(function(r){return (parseFloat(r.amount)||0)>0;}).map(function(r){return {amount:parseFloat(r.amount)||0,mode:r.mode};}) : [];
  var totalCollB = ogValB+prevAdvB+nowPayB;
  var balB = Math.max(0,grand-totalCollB);
  // payStatus already set by updateSum
  var advForRecord = totalCollB >= grand ? grand : totalCollB;
  return{
    id: (typeof crypto.randomUUID==='function') ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)),
    invNo:(document.getElementById('s-invno').value||'').trim(), // blank = assign at save
    date:new Date(document.getElementById('s-date').value||new Date()).toISOString(),
    createdAt:new Date().toISOString(),
    customer:document.getElementById('s-cust').value||'Walk-in',
    phone:document.getElementById('s-phone').value||'',
    addr:document.getElementById('s-addr').value||'',
    items:saleItems,
    making:parseFloat(document.getElementById('s-making').value)||0,
    diamond:parseFloat(document.getElementById('s-diamond').value)||0,
    gst:gstPct,
    discount:disc,
    lockedGrand:grand,
    advance:advForRecord,
    payStatus:payStatus,
    payment:nowPayModeB,
    oldGold:{weight:ogWtB,purity:ogPurB,value:ogValB},
    prevAdvance:{amount:prevAdvB,mode:prevAdvModeB},
    nowPaying:{amount:nowPayB,mode:nowPayModeB},
    splitPayments:splitPaymentsB,
    lockedRates:{g24:S.rates.g24,g22:S.rates.g22,g18:S.rates.g18,g14:S.rates.g14,sil:S.rates.sil},
    notes:(document.getElementById('s-notes')||{value:''}).value,
    billType: _saleFormBillType || 'gst'
  };
}

// Deducts the sold quantity from each item's linked product instead of
// blindly zeroing it out — a batch of 5 selling 2 should leave 3, not 0.
function deductSoldStock(items, sale){
  items.filter(function(x){return x.pid;}).forEach(function(item){
    var p=S.products.find(function(x){return x.id==item.pid;});
    if(!p) return;
    var soldQty=Math.max(1,parseInt(item.qty,10)||1);
    var prevStatus=p.status;
    p.qty=Math.max(0,(p.qty||0)-soldQty);
    if(p.unitWeight){ p.weight=Math.round(p.unitWeight*p.qty*1000)/1000; }
    if(p.unitNetWeight){ p.netWeight=Math.round(p.unitNetWeight*p.qty*1000)/1000; }
    if(p.qty<=0){ p.status='sold'; p.qty=0; }
    // Foundation audit §4: log the sale movement in memory now, so it
    // lands in the SAME cloud save as the sale itself and rolls back
    // together on failure — not a separate write that could succeed or
    // fail independently of the sale it's describing.
    logStockMovement(p.id, 'sale', {
      prevStatus: prevStatus, newStatus: p.status, qtyChange: -soldQty,
      relatedId: sale?sale.id:null, relatedRef: sale?sale.invNo:'', reason: 'Sold'
    });
  });
}

// ── P0-3 hardening (Aug 2026): createSaleTransaction ────────────────
// A sale that touches stock is one business transaction now, not two:
//   1. validate customer/phone/items
//   2. validate inventory (sufficient stock, not already sold)
//   3. deduct stock IN MEMORY
//   4. push the sale record IN MEMORY
//   5. ONE saveToCloud() call persists sale + stock together as a single
//      atomic write (store-proxy's compare-and-swap — see
//      supabase/migrations/002_atomic_transactions.sql — either saves
//      both or saves neither; there is no longer a second, separate,
//      best-effort save for the stock side that can be lost)
// If that save fails OR loses a version conflict, step 6 rolls back both
// the sale and the stock deduction together, so the local state always
// matches what's actually persisted — no "sale exists, stock wasn't
// deducted" half-state, and no leftover sale to accidentally resubmit.
//
// _saleSubmitLock is a hard guard against double-click / double-tap: a
// second recordSale() call while one is still in flight is dropped
// outright rather than relying only on the softer isDuplicateSale()
// content-based heuristic below (which still runs, to catch a second
// *separate* click after the first one already completed).
var _saleSubmitLock = false;

function recordSale(){
  if(!subGuard('recording a sale')) return;
  if(_saleSubmitLock){ toast('Sale already being recorded — please wait'); return; }
  if(!document.getElementById('s-cust').value.trim()){toast('Enter customer name');return;}
  var sale=buildSaleObj();
  if(!sale.items||!sale.items.length){toast('Add at least one item');return;}
  // Phone validation — must be empty OR 10 digits
  if(sale.phone){
    var _cleanPhone = (sale.phone||'').replace(/\D/g,'');
    // F5: accept what people type -- "+91 98765 43210" or "098765 43210" --
    // by dropping the country code or trunk 0 (the form used to suggest +91
    // and then refuse it).
    if(_cleanPhone.length===12 && _cleanPhone.slice(0,2)==='91') _cleanPhone=_cleanPhone.slice(2);
    else if(_cleanPhone.length===11 && _cleanPhone.charAt(0)==='0') _cleanPhone=_cleanPhone.slice(1);
    if(_cleanPhone.length && _cleanPhone.length !== 10){
      toast('\u26a0 Phone must be 10 digits (e.g. 9876543210). Got: '+sale.phone);
      var _pEl=document.getElementById('s-phone'); if(_pEl) _pEl.focus();
      return;
    }
    if(_cleanPhone.length===10) sale.phone = _cleanPhone;
  }
  if(UI.saleMode!=='custom'){
    // FIX: previously buildSaleObj() just filtered out any row with no
    // resolved pid — so a staff member could type/scan a SKU, have it
    // fail to resolve (typo, item already sold since the page loaded,
    // etc.), and the sale would go through anyway with that item simply
    // missing, no error shown. Now any row with unresolved typed text
    // blocks the sale explicitly instead of silently shrinking it.
    var unresolvedRow=-1;
    for(var _ui=0; _ui<UI.saleItems.length; _ui++){
      var _inp=document.getElementById('si-sku-'+_ui);
      var _typed=_inp?_inp.value.trim():'';
      if(_typed && !UI.saleItems[_ui].pid){ unresolvedRow=_ui; break; }
    }
    if(unresolvedRow>-1){
      toast('\u26a0 Item '+(unresolvedRow+1)+': SKU not recognized — pick it from the dropdown or check for typos');
      var _badInp=document.getElementById('si-sku-'+unresolvedRow);
      if(_badInp) _badInp.focus();
      return;
    }
    var ok=true;
    UI.saleItems.filter(function(x){return x.pid;}).forEach(function(item){
      var p=S.products.find(function(x){return x.id==item.pid;});
      var wantQty=Math.max(1,parseInt(item.qty,10)||1);
      if(!p||p.status==='sold'||p.qty<=0){toast((p?p.name:'Item')+' already sold');ok=false;}
      else if(wantQty>p.qty){toast('Only '+p.qty+' of '+p.name+' left in stock');ok=false;}
    });
    if(!ok)return;
  }
  if(sale.invNo && invNoInUse(sale.invNo)){
    toast('\u26a0 Invoice '+sale.invNo+' already exists. Clear the Invoice No. box to get the next number.');
    return;
  }
  // A typed number in the counter's own format far above the series would,
  // as a real bill, move the server's floor (migration 005) -- a typo like
  // INV-3000 for INV-030 would jump every later invoice. Refuse it.
  var _typedNo = /^\s*INV-0*(\d+)\s*$/i.exec(sale.invNo||'');
  // Compared with the highest real bill, as the server's floor is (Opus
  // review of 005): S.nextInvNo can be stale in either direction.
  if(_typedNo && parseInt(_typedNo[1],10) > maxInvBillNo() + 1000){
    toast('\u26a0 Invoice '+sale.invNo+' is far ahead of your series. Check for a typo, or clear the Invoice No. box to get the next number.');
    return;
  }
  // Duplicate bill guard — catches a second, separate click after the
  // first sale already finished (different scenario from the in-flight
  // lock above, which catches a click while the first is still saving)
  if(isDuplicateSale(sale.customer, sale.items)){
    safeConfirm(
      'Duplicate bill?',
      'A bill for ' + sale.customer + ' was just created. Record another?',
      function(){ _commitSaleTransaction(sale); }
    );
    return;
  }
  _commitSaleTransaction(sale);
}

// F3: a blank invoice number is fetched from the server counter here, at
// save time, holding the submit lock so a double-tap can't fetch two.
// The form state the commit needs is captured HERE, before the network hop:
// a Clear, a row removed, or another order's Convert while the number is in
// flight must not change what this sale deducts or which order it bills.
function _commitSaleTransaction(sale){
  var ctx = { items: UI.saleItems.slice(), mode: UI.saleMode, order: _pendingOrderConversion };
  // Cowork review 30 Sep: an exception in the commit must not leave the
  // submit lock set (every Record tap refused) or an unsaved sale in S --
  // on the typed-number path as well as the server-number one.
  function run(){
    try { _commitSaleTransactionNow(sale, ctx); }
    catch(e){
      _saleSubmitLock = false;
      S.sales = S.sales.filter(function(s){ return s.id !== sale.id; });
      console.error('[JewelOS] sale commit threw:', e);
      toast('\u26a0 Sale not recorded. Please try again.');
    }
  }
  if(sale.invNo){ run(); return; }
  _saleSubmitLock = true;
  allocInvNo(function(err, invNo){
    if(err){
      _saleSubmitLock = false;
      toast(err.message === 'counter-behind'
        ? '\u26a0 Could not get a free invoice number. Please contact JewelOS support.'
        : '\u26a0 Could not get an invoice number. Check your internet and try again.');
      return;
    }
    sale.invNo = invNo;
    ctx.issuedNo = parseInt(invNo.slice(4), 10); // only server-issued numbers move the series (below)
    run();
  });
}

function _commitSaleTransactionNow(sale, ctx){
  _saleSubmitLock = true;
  var saleItemsForStock = ctx.items; // snapshot for rollback
  // Snapshot exactly what deductSoldStock will touch, so a failed save
  // can restore precisely these products to their pre-sale state.
  var stockSnapshot = (ctx.mode!=='custom') ? saleItemsForStock
    .filter(function(x){return x.pid;})
    .map(function(item){
      var p=S.products.find(function(x){return x.id==item.pid;});
      return p ? { id:p.id, qty:p.qty, weight:p.weight, netWeight:p.netWeight, status:p.status } : null;
    }).filter(Boolean) : [];

  if(typeof addPaymentRecord==='function' && (sale.nowPaying&&sale.nowPaying.amount>0)){
    addPaymentRecord(sale, sale.nowPaying.amount, sale.nowPaying.mode, 'Initial payment');
  }
  // Foundation audit B4: if this sale is completing an order conversion
  // (convertToSale prefilled this form), link the order to it NOW, in
  // memory, so the order's delivered/linkedSale status goes out in the
  // SAME cloud save as the sale itself — never before the sale exists,
  // and rolled back together if the save fails.
  var linkedOrder = null, linkedOrderSnap = null;
  if(ctx.order){
    linkedOrder = (S.orders||[]).find(function(x){return x.id===ctx.order;});
    if(linkedOrder && !linkedOrder.billedSaleId){
      linkedOrderSnap = JSON.parse(JSON.stringify(linkedOrder));
      linkedOrder.status='delivered';
      linkedOrder.linkedSale=true;
      linkedOrder.billedSaleId=sale.id;
      linkedOrder.billedInvNo=sale.invNo;
      if(!linkedOrder.statusHistory)linkedOrder.statusHistory=[];
      linkedOrder.statusHistory.push({status:'delivered',date:new Date().toISOString(),note:'Converted to sale '+sale.invNo});
    } else {
      linkedOrder = null; // already billed elsewhere in the meantime — don't touch it
    }
  }
  // Steps 3+4: deduct stock and add the sale record together, in memory,
  // BEFORE the (single) cloud save — this is what makes the eventual
  // saveToCloud() one atomic write instead of two.
  S.sales.push(sale);
  S.nextSaleId++;
  // Forward-sync, not a blind increment: sale.invNo may already be a
  // higher, atomically-fetched number (_commitSaleTransaction() -> allocInvNo())
  // than whatever S.nextInvNo currently holds, or — on the local-fallback
  // path — exactly equal to it. A blind S.nextInvNo++ here left the local
  // counter trailing behind numbers already handed out, which is how two
  // separately-opened sales could mint the same INV- number. Snapshot the
  // pre-commit value so a failed save can restore it exactly, not just -1.
  var _prevNextInvNo = S.nextInvNo;
  // F3: max(), never "+1 anyway" -- S.nextInvNo is the server counter's floor
  // (migration 004), so any extra bump becomes a skipped GST number.
  // Cowork review 30 Sep: ONLY a server-issued number moves it. A typed number
  // ("2025-26/001", a pasted phone number) used to be stripped to its digits
  // and could jump the whole shop's series to INV-202526002 or past the
  // database's integer limit. Typed numbers are still checked for duplicates.
  if(ctx.issuedNo > 0) S.nextInvNo = Math.max(S.nextInvNo, ctx.issuedNo+1);
  if(ctx.mode!=='custom'){
    deductSoldStock(saleItemsForStock, sale);
  }

  saveToCloud(function(err){
    _saleSubmitLock = false;
    if(!err){
      upsertCustomer(sale.customer, sale.phone, { addr: sale.addr||'', gstin: sale.custGSTIN||'' });
      if(linkedOrder){ if(_pendingOrderConversion===ctx.order) _pendingOrderConversion=null; if(typeof renderOrders==='function') renderOrders(); }
      clearSale();
      renderDash();
      toast('\u2705 Sale recorded! Invoice: '+sale.invNo);
      setTimeout(function(){switchTab('dashboard');},900);
    } else {
      // Roll back the order link too — the sale that would have justified
      // it never actually made it to the cloud.
      if(linkedOrder && linkedOrderSnap){
        Object.keys(linkedOrder).forEach(function(k){ if(!(k in linkedOrderSnap)) delete linkedOrder[k]; });
        Object.assign(linkedOrder, linkedOrderSnap);
      }
      // Save failed OR lost a version-conflict CAS check — roll back
      // BOTH the sale and the stock deduction together, so local state
      // never claims a sale that isn't actually persisted, and never
      // shows stock as sold that the cloud still has as available.
      var failIdx = S.sales.findIndex(function(s){ return s.id===sale.id; });
      if(failIdx !== -1) S.sales.splice(failIdx, 1);
      S.nextSaleId = Math.max(1, S.nextSaleId-1);
      // Restore the exact pre-commit snapshot, not a blind -1 — the
      // forward-sync above may have jumped S.nextInvNo ahead by more
      // than one if sale.invNo carried an atomically-fetched number.
      S.nextInvNo  = _prevNextInvNo;
      stockSnapshot.forEach(function(snap){
        var p=S.products.find(function(x){return x.id===snap.id;});
        if(p){ p.qty=snap.qty; p.weight=snap.weight; p.netWeight=snap.netWeight; p.status=snap.status; }
      });
      // The movement-ledger entries logStockMovement() wrote for this sale
      // describe a sale that never actually made it to the cloud — strip
      // them too, so the ledger doesn't show a "sale" movement with no
      // corresponding sale.
      S.stockMovements = (S.stockMovements||[]).filter(function(m){ return m.relatedId!==sale.id || m.type!=='sale'; });
      saveCache();
      // A version conflict already triggers its own toast + reload inside
      // saveToCloud(); a plain network/save failure needs its own message.
      if(err.message !== 'version-conflict'){
        toast('\u26a0 Sale could not be saved. Check your connection and try again.');
      }
    }
  });
}

// ─── CUSTOM SALE MODE ────────────────────────────────────────────────────
function setSaleMode(mode){
  UI.saleMode=mode;
  var sd=document.getElementById('sale-mode-stock');
  var cd=document.getElementById('sale-mode-custom');
  var bs=document.getElementById('mode-btn-stock');
  var bc=document.getElementById('mode-btn-custom');
  if(mode==='stock'){
    if(sd)sd.style.display='block'; if(cd)cd.style.display='none';
    if(bs)bs.className='mode-btn active-stock'; if(bc)bc.className='mode-btn';
    renderSaleItems();
  } else {
    if(sd)sd.style.display='none'; if(cd)cd.style.display='block';
    if(bs)bs.className='mode-btn'; if(bc)bc.className='mode-btn active-custom';
    renderCustomSaleItems();
  }
  updateSum();
}
function calcNetGold(item){
  return Math.max(0,(parseFloat(item.grossWt)||0)-(parseFloat(item.blackBeads)||0)-(parseFloat(item.diamond)||0));
}
function addCustomSI(){
  var idx=customSaleItems.length;
  customSaleItems.push({name:'',metal:'gold',purity:'22K',grossWt:0,blackBeads:0,diamond:0,making:0,stoneCharges:0});
  var wrap=document.getElementById('custom-sale-items');
  if(wrap){ var card=buildCustomItemCard(idx); wrap.appendChild(card); card.scrollIntoView({behavior:'smooth',block:'nearest'}); }
  updateSum();
}
function removeCustomSI(i){
  if(customSaleItems.length<=1) return;
  customSaleItems.splice(i,1);
  var wrap=document.getElementById('custom-sale-items');
  if(wrap){ wrap.innerHTML=''; customSaleItems.forEach(function(item,idx){ wrap.appendChild(buildCustomItemCard(idx)); }); }
  updateSum();
}
function renderCustomSaleItems(){
  var wrap=document.getElementById('custom-sale-items'); if(!wrap) return;
  while(wrap.children.length<customSaleItems.length) wrap.appendChild(buildCustomItemCard(wrap.children.length));
  while(wrap.children.length>customSaleItems.length) wrap.removeChild(wrap.lastChild);
  customSaleItems.forEach(function(item,i){ refreshCustomItemDisplay(i,item); });
  updateSum();
}
function buildCustomItemCard(i){
  var item=customSaleItems[i];
  var GPUR=['24K','22K','18K','14K','Gold Plated'];
  var SPUR=['999 Pure','925 Sterling','800','Silver Plated'];
  var card=document.createElement('div'); card.className='custom-item-card'; card.id='cic-'+i;
  // Header
  var hdr=document.createElement('div'); hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
  var hl=document.createElement('div'); hl.className='item-num'; hl.textContent='Item '+(i+1); hdr.appendChild(hl);
  if(customSaleItems.length>1){ var rb=document.createElement('button'); rb.className='btn btn-sm btn-danger'; rb.textContent='Remove'; (function(idx){rb.onclick=function(){removeCustomSI(idx);};})(i); hdr.appendChild(rb); }
  card.appendChild(hdr);
  // Grid
  var grid=document.createElement('div'); grid.className='form-grid';
  // Name
  var nf=document.createElement('div'); nf.className='fg'; nf.innerHTML='<label>Item Description *</label>';
  var ni=document.createElement('input'); ni.placeholder='e.g. Gold Necklace Meenakari'; ni.value=item.name||''; ni.id='csi-name-'+i;
  (function(idx){ni.oninput=function(){customSaleItems[idx].name=this.value;updateSum();};})(i);
  nf.appendChild(ni); grid.appendChild(nf);
  // Metal
  var mf=document.createElement('div'); mf.className='fg'; mf.innerHTML='<label>Metal</label>';
  var ms=document.createElement('select'); ms.id='csi-metal-'+i;
  ['gold','silver'].forEach(function(m){var o=document.createElement('option');o.value=m;o.textContent=m.charAt(0).toUpperCase()+m.slice(1);if((item.metal||'gold')===m)o.selected=true;ms.appendChild(o);});
  (function(idx){ms.onchange=function(){customSaleItems[idx].metal=this.value;customSaleItems[idx].purity=this.value==='gold'?'22K':'925 Sterling';var ps=document.getElementById('csi-purity-'+idx);if(ps){var pl=this.value==='gold'?GPUR:SPUR;ps.innerHTML='';pl.forEach(function(p){var o=document.createElement('option');o.value=p;o.textContent=p;if(p===customSaleItems[idx].purity)o.selected=true;ps.appendChild(o);});}refreshCustomItemDisplay(idx,customSaleItems[idx]);updateSum();};})(i);
  mf.appendChild(ms); grid.appendChild(mf);
  // Purity
  var pf=document.createElement('div'); pf.className='fg'; pf.innerHTML='<label>Purity</label>';
  var ps=document.createElement('select'); ps.id='csi-purity-'+i;
  ((item.metal||'gold')==='silver'?SPUR:GPUR).forEach(function(p){var o=document.createElement('option');o.value=p;o.textContent=p;if((item.purity||'22K')===p)o.selected=true;ps.appendChild(o);});
  (function(idx){ps.onchange=function(){customSaleItems[idx].purity=this.value;refreshCustomItemDisplay(idx,customSaleItems[idx]);updateSum();};})(i);
  pf.appendChild(ps); grid.appendChild(pf);
  // Gross weight — text input to allow free decimal typing
  var gwf=document.createElement('div'); gwf.className='fg'; gwf.innerHTML='<label>Gross Weight (g)</label>';
  var gww=document.createElement('div'); gww.className='isuf';
  var gwi=document.createElement('input'); gwi.type='text'; gwi.setAttribute('inputmode','decimal'); gwi.placeholder='0.000'; gwi.id='csi-gw-'+i; gwi.value=item.grossWt>0?item.grossWt:'';
  (function(idx){gwi.oninput=function(){customSaleItems[idx].grossWt=parseFloat(this.value)||0;refreshCustomItemDisplay(idx,customSaleItems[idx]);updateSum();};})(i);
  var gwS=document.createElement('span'); gwS.className='suf'; gwS.textContent='g';
  gww.appendChild(gwi); gww.appendChild(gwS); gwf.appendChild(gww); grid.appendChild(gwf);
  card.appendChild(grid);
  // Deductions box
  var dbox=document.createElement('div'); dbox.className='deduct-box'; dbox.innerHTML='<div class="deduct-title">&#11015; Deductions (minus from gross weight)</div>';
  var dgrid=document.createElement('div'); dgrid.className='form-grid';
  // Black beads
  var bbf=document.createElement('div'); bbf.className='fg'; bbf.innerHTML='<label>&#9679; Black Beads / Kala Moti (g)</label>';
  var bbw=document.createElement('div'); bbw.className='isuf';
  var bbi=document.createElement('input'); bbi.type='text'; bbi.setAttribute('inputmode','decimal'); bbi.placeholder='0.000'; bbi.id='csi-bb-'+i; bbi.value=item.blackBeads>0?item.blackBeads:'';
  (function(idx){bbi.oninput=function(){customSaleItems[idx].blackBeads=parseFloat(this.value)||0;refreshCustomItemDisplay(idx,customSaleItems[idx]);updateSum();};})(i);
  var bbS=document.createElement('span'); bbS.className='suf'; bbS.textContent='g';
  bbw.appendChild(bbi); bbw.appendChild(bbS); bbf.appendChild(bbw); dgrid.appendChild(bbf);
  // Diamond wt
  var dwf=document.createElement('div'); dwf.className='fg'; dwf.innerHTML='<label>&#128142; Diamond / Stone Weight (g)</label>';
  var dww=document.createElement('div'); dww.className='isuf';
  var dwi=document.createElement('input'); dwi.type='text'; dwi.setAttribute('inputmode','decimal'); dwi.placeholder='0.000'; dwi.id='csi-dw-'+i; dwi.value=item.diamond>0?item.diamond:'';
  (function(idx){dwi.oninput=function(){customSaleItems[idx].diamond=parseFloat(this.value)||0;refreshCustomItemDisplay(idx,customSaleItems[idx]);updateSum();};})(i);
  var dwS=document.createElement('span'); dwS.className='suf'; dwS.textContent='g';
  dww.appendChild(dwi); dww.appendChild(dwS); dwf.appendChild(dww); dgrid.appendChild(dwf);
  dbox.appendChild(dgrid);
  // Net wt display
  var wtRow=document.createElement('div'); wtRow.className='wt-calc-row'; wtRow.id='csi-wtrow-'+i;
  dbox.appendChild(wtRow); card.appendChild(dbox);
  // Charges
  var cgrid=document.createElement('div'); cgrid.className='form-grid'; cgrid.style.marginTop='10px';
  // Making
  var mkf=document.createElement('div'); mkf.className='fg'; mkf.innerHTML='<label>Making Charges (&#8377;/g on gross wt)</label>';
  var mkw=document.createElement('div'); mkw.className='isuf';
  var mki=document.createElement('input'); mki.type='text'; mki.setAttribute('inputmode','decimal'); mki.placeholder='0'; mki.id='csi-mk-'+i; mki.value=item.making>0?item.making:'';
  (function(idx){mki.oninput=function(){customSaleItems[idx].making=parseFloat(this.value)||0;refreshCustomItemDisplay(idx,customSaleItems[idx]);updateSum();};})(i);
  var mkS=document.createElement('span'); mkS.className='suf'; mkS.textContent='\u20B9/g';
  mkw.appendChild(mki); mkw.appendChild(mkS); mkf.appendChild(mkw); cgrid.appendChild(mkf);
  // Stone charges
  var scf=document.createElement('div'); scf.className='fg'; scf.innerHTML='<label>Stone / Diamond Charges (&#8377; flat)</label>';
  var sci=document.createElement('input'); sci.type='text'; sci.setAttribute('inputmode','decimal'); sci.placeholder='0'; sci.id='csi-sc-'+i; sci.value=item.stoneCharges>0?item.stoneCharges:'';
  (function(idx){sci.oninput=function(){customSaleItems[idx].stoneCharges=parseFloat(this.value)||0;refreshCustomItemDisplay(idx,customSaleItems[idx]);updateSum();};})(i);
  scf.appendChild(sci); cgrid.appendChild(scf);
  card.appendChild(cgrid);
  // Line total display
  var ltDiv=document.createElement('div'); ltDiv.id='csi-total-'+i; card.appendChild(ltDiv);
  refreshCustomItemDisplay(i,item);
  return card;
}
function refreshCustomItemDisplay(i,item){
  var gross=parseFloat(item.grossWt)||0;
  var beads=parseFloat(item.blackBeads)||0;
  var diaWt=parseFloat(item.diamond)||0;
  var net=Math.max(0,gross-beads-diaWt);
  var rate=getRate(item.metal||'gold',item.purity||'22K');
  var mkAmt=(parseFloat(item.making)||0)*gross;   // making is charged on gross weight
  var scAmt=parseFloat(item.stoneCharges)||0;
  var gvAmt=rate*net;
  var lineTotal=gvAmt+mkAmt+scAmt;
  var wtRow=document.getElementById('csi-wtrow-'+i);
  if(wtRow){
    if(gross>0){
      wtRow.innerHTML='<span>'+fmtW(gross)+'</span>'+
        (beads>0?'<span style="color:var(--text3);">\u2212 '+fmtW(beads)+' beads</span>':'')+
        (diaWt>0?'<span style="color:var(--text3);">\u2212 '+fmtW(diaWt)+' stone</span>':'')+
        (beads>0||diaWt>0?'<span style="margin-left:auto;"> = </span><span class="wt-calc-net">'+fmtW(net)+' Net Gold</span>':
          '<span style="margin-left:auto;color:var(--gold-dark);font-weight:700;">= '+fmtW(net)+' Gold</span>');
    } else { wtRow.innerHTML=''; }
  }
  var ltDiv=document.getElementById('csi-total-'+i);
  if(ltDiv){
    if(gross>0){
      ltDiv.style.cssText='margin-top:10px;background:rgba(201,168,76,0.06);border:1px solid rgba(201,168,76,0.2);border-radius:var(--radius);padding:10px 12px;';
      ltDiv.innerHTML=
        '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:3px;"><span>Gold value ('+item.purity+' \u00d7 '+fmtW(net)+')</span><span>'+fmt(gvAmt)+'</span></div>'+
        (mkAmt>0?'<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:3px;"><span>Making ('+fmt(parseFloat(item.making)||0)+'/g)</span><span>'+fmt(mkAmt)+'</span></div>':'')+
        (scAmt>0?'<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:3px;"><span>Stone / Diamond</span><span>'+fmt(scAmt)+'</span></div>':'')+
        '<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:var(--gold-dark);border-top:1px solid rgba(201,168,76,0.2);padding-top:6px;margin-top:4px;"><span>Item Total</span><span>'+fmt(lineTotal)+'</span></div>';
    } else { ltDiv.innerHTML=''; ltDiv.style.cssText=''; }
  }
}

function clearSale(){
  _pendingOrderConversion = null; // F4: a cleared form is no longer that order's bill
  UI.saleItems=[{pid:'',qty:1,blackBeads:0,diamondWt:0,otherWt:0}];
  customSaleItems=[{name:'',metal:'gold',purity:'22K',grossWt:0,blackBeads:0,diamond:0,making:0,stoneCharges:0}];
  var cwrap=document.getElementById('custom-sale-items');if(cwrap)cwrap.innerHTML='';
  ['s-cust','s-phone','s-addr','s-notes'].forEach(function(id){document.getElementById(id).value='';});
  ['s-making','s-diamond','s-gst','s-disc','s-advance'].forEach(function(id){document.getElementById(id).value='0';});
  document.getElementById('s-date').value=dbDayKey(new Date()); // local IST day, not toISOString()'s UTC day
  document.getElementById('s-invno').value=''; // assigned at save time
  document.getElementById('cust-suggestions').style.display='none';
  // Clear old gold fields
  var ogDE=document.getElementById('s-oldgold-direct');if(ogDE)ogDE.value='';
  var ogWE=document.getElementById('s-oldgold-wt');if(ogWE)ogWE.value='';
  var ogVE=document.getElementById('s-oldgold-val');if(ogVE){ogVE.value='';ogVE._manualEdit=false;}
  var ogPE=document.getElementById('s-oldgold-purity');if(ogPE)ogPE.value='';
  var ogDD=document.getElementById('s-oldgold-display');if(ogDD)ogDD.style.display='none';
  var ogPA=document.getElementById('s-prev-advance');if(ogPA)ogPA.value='0';
  // UI resets
  var bdR=document.getElementById('balance-due-row');if(bdR)bdR.style.display='none';
  var spR=document.getElementById('still-pending-row');if(spR)spR.style.display='none';
  var scR=document.getElementById('fully-cleared-row');if(scR)scR.style.display='none';
  setOgMode('direct');
  if(typeof initSplitPayments==='function') initSplitPayments();
  setSaleMode('stock');
  setPayStatus('pending');
  setSaleFormBillType('gst');
  renderSaleItems();
}

// --- INVOICE / PDF ---
var CURRENT_SALE_FOR_PDF = null;

// ── BILL TYPE STATE ──────────────────────────────────────────────────
var _billType = 'gst'; // 'gst' | 'memo'
var _saleFormBillType = 'gst'; // bill type selected on the sales form

function setSaleFormBillType(type){
  _saleFormBillType = type;
  _billType = type; // keep invoice preview in sync
  var gstBtn  = document.getElementById('sform-btype-gst');
  var memoBtn = document.getElementById('sform-btype-memo');
  if(gstBtn && memoBtn){
    if(type === 'gst'){
      gstBtn.style.background  = 'linear-gradient(135deg,var(--gold-dark),var(--gold))';
      gstBtn.style.color       = '#1a1200';
      memoBtn.style.background = 'transparent';
      memoBtn.style.color      = 'var(--text2)';
    } else {
      memoBtn.style.background = 'linear-gradient(135deg,var(--gold-dark),var(--gold))';
      memoBtn.style.color      = '#1a1200';
      gstBtn.style.background  = 'transparent';
      gstBtn.style.color       = 'var(--text2)';
    }
  }
  var gstWrap = document.getElementById('s-gst-wrap');
  var gstSumRow = document.getElementById('ss-gst-row');
  if(gstWrap)   gstWrap.style.display   = (type === 'gst') ? '' : 'none';
  if(gstSumRow) gstSumRow.style.display = (type === 'gst') ? '' : 'none';
  if(type === 'memo'){
    var gstInput = document.getElementById('s-gst');
    if(gstInput){ gstInput.value = '0'; }
  }
  updateSum();
}

function setBillType(type){
  _billType = type;
  var gstBtn  = document.getElementById('btype-gst');
  var memoBtn = document.getElementById('btype-memo');
  if(gstBtn && memoBtn){
    if(type === 'gst'){
      gstBtn.style.background  = 'linear-gradient(135deg,var(--gold-dark),var(--gold))';
      gstBtn.style.color       = '#1a1200';
      memoBtn.style.background = 'transparent';
      memoBtn.style.color      = 'var(--text2)';
    } else {
      memoBtn.style.background = 'linear-gradient(135deg,#334155,#475569)';
      memoBtn.style.color      = '#fff';
      gstBtn.style.background  = 'transparent';
      gstBtn.style.color       = 'var(--text2)';
    }
  }
  if(CURRENT_SALE_FOR_PDF){
    var html = buildInvoiceHTML(CURRENT_SALE_FOR_PDF, type);
    var f = document.getElementById('inv-frame');
    if(f){ f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close(); }
  }
}

function buildInvoiceHTML(sale, billType){
  if(!billType) billType = _billType || 'gst';
  var isGST  = (billType === 'gst');

  // ── Shop details from SAAS (dynamic — never hardcoded) ──────────────
  var shop     = (SAAS && SAAS.shop) || {};
  // Escaped once here: every use below is HTML, and a manager can edit these.
  var shopName = escHtml(shop.name  || 'My Jewellery Shop');
  var shopCity = escHtml(shop.city  || '');
  var shopPhone= escHtml(shop.phone || '');
  var shopGSTIN= escHtml((shop.gstin||'').trim().toUpperCase());
  // Only claim BIS Hallmark if shop has GSTIN AND every item has a valid HUID
  var allItemsHallmarked = isGST && (sale.items||[]).every(function(i){
    return !i.huid || validateHUID(i.huid).ok; // custom items with no huid are OK
  }) && (sale.items||[]).some(function(i){ return i.huid && validateHUID(i.huid).ok; });
  var shopTagline = allItemsHallmarked
    ? ('BIS Hallmark Certified' + (shopCity ? ' \u00b7 ' + shopCity : ''))
    : ('Quality Jewellery' + (shopCity ? ' \u00b7 ' + shopCity : ''));

  var t = calcSaleTotals(sale);

  // GST split: jewellery HSN 7113 — 3% GST (1.5% CGST + 1.5% SGST, or 3% IGST)
  var gstRate    = parseFloat(sale.gst) || 0;
  var gstAmt     = t.gstAmt || 0;
  var cgst = 0, sgst = 0, igst = 0;
  if(isGST && gstAmt > 0){
    // Use full GST engine for IGST/CGST/SGST determination
    var gstBreakdown = calcSaleGSTBreakdown(sale);
    if(gstBreakdown.igst > 0){
      cgst = 0; sgst = 0;
      var igst = gstBreakdown.igst;
    } else {
      cgst = gstBreakdown.cgst;
      sgst = gstBreakdown.sgst;
    }
  }

  var rows = (sale.items||[]).map(function(i){
    var rate   = getItemRate(i);
    var netWt  = i.weight;
    var mkAmt  = itemMakingAmount(i);
    var dcAmt  = i.isCustom ? (i.diamond||0) : ((i.diamond&&i.diamond>0) ? i.diamond*i.qty : 0);
    var taxableAmt = rate*netWt*i.qty + mkAmt + dcAmt;
    var gstItem= isGST ? Math.round(taxableAmt * gstRate / 100 * 100) / 100 : 0;
    var lineTotal = taxableAmt + gstItem;
    var wtDetail = '';
    var hasDeduct = (i.grossWeight||0)>0 && ((i.blackBeads||0)+(i.diamondWt||0)+(i.otherWt||0))>0;
    if(hasDeduct){
      wtDetail = '<span class="wt-g">Gross '+fmtW(i.grossWeight)+'</span>';
      if((i.blackBeads||0)>0) wtDetail += ' <span class="wt-d">&minus;'+fmtW(i.blackBeads)+' beads</span>';
      if((i.diamondWt||0)>0)  wtDetail += ' <span class="wt-d">&minus;'+fmtW(i.diamondWt)+' stone</span>';
      if((i.otherWt||0)>0)    wtDetail += ' <span class="wt-d">&minus;'+fmtW(i.otherWt)+' other</span>';
      wtDetail += ' <span class="wt-n">&rarr; '+fmtW(netWt)+' net</span>';
    } else if(i.isCustom && (i.grossWeight||0)>0){
      wtDetail = '<span class="wt-g">'+fmtW(i.grossWeight)+'</span>';
      if((i.blackBeads||0)>0) wtDetail += ' <span class="wt-d">&minus;'+fmtW(i.blackBeads)+'</span>';
      if((i.diamondWt||0)>0)  wtDetail += ' <span class="wt-d">&minus;'+fmtW(i.diamondWt)+'</span>';
      wtDetail += ' <span class="wt-n">&rarr; '+fmtW(netWt)+' net</span>';
    }
    var hsnCol = isGST ? '<td class="ir" style="font-size:11px;">7113</td>' : '';
    var gstCol = isGST ? '<td class="ir">'+(gstItem>0?fmt(gstItem):'&mdash;')+'</td>' : '';
    return '<tr>'+
      '<td class="il"><div class="in">'+escHtml(i.name)+'</div>'+
        '<div class="im">'+escHtml(i.purity)+(i.huid?' &ensp;&middot;&ensp; HUID: <code>'+escHtml(i.huid)+'</code>':'')+'</div>'+
        (wtDetail?'<div class="iw">'+wtDetail+'</div>':'')+
      '</td>'+
      '<td class="ir">'+fmtW(netWt)+'</td>'+
      '<td class="ir">'+fmt(rate)+(i.lockedRate?'<br><small>locked</small>':'')+'</td>'+
      '<td class="ir">'+(mkAmt>0?fmt(mkAmt):'&mdash;')+'</td>'+
      '<td class="ir">'+(dcAmt>0?fmt(dcAmt):'&mdash;')+'</td>'+
      hsnCol + gstCol +
      '<td class="ir bold">'+fmt(lineTotal)+'</td>'+
    '</tr>';
  }).join('');

  var amtWords = numberToWords(Math.round(t.grand));

  // ── Memo banner — removed per design spec ───────────────────────────
  var memoBanner = '';

  // ── Header label ────────────────────────────────────────────────────
  var invoiceLabel = isGST ? 'Tax Invoice' : 'Memo Bill';
  var invoiceColor = isGST ? '#1a5fd4' : '#8a6a1f';

  // ── GST info block on invoice ────────────────────────────────────────
  var gstInfoBlock = (isGST && shopGSTIN) ?
    '<div style="font-size:10px;color:#6c757d;margin-top:4px;">'+
    'GSTIN: <strong style="color:#141618;">'+shopGSTIN+'</strong></div>' : '';

  // ── GST compliance note for memo ────────────────────────────────────
  var gstTotalsBlock = '';
  if(isGST && gstAmt > 0){
    var gstBD = calcSaleGSTBreakdown(sale);
    var taxableVal = fmt(t.taxable);
    gstTotalsBlock =
      '<div class="tr2"><span class="tc">Taxable Value</span><span class="tv">'+taxableVal+'</span></div>';
    // HSN summary rows
    if(gstBD.metalValue > 0){
      gstTotalsBlock += '<div class="tr2" style="font-size:10px;color:#888;"><span class="tc">&nbsp;&nbsp;HSN '+gstBD.metalHSN+' (Metal '+gstBD.metalGSTRate+'%)</span><span class="tv">'+fmt(gstBD.metalValue)+'</span></div>';
    }
    if(gstBD.makingValue > 0){
      gstTotalsBlock += '<div class="tr2" style="font-size:10px;color:#888;"><span class="tc">&nbsp;&nbsp;HSN '+gstBD.makingHSN+' (Making '+gstBD.makingGSTRate+'%)</span><span class="tv">'+fmt(gstBD.makingValue)+'</span></div>';
    }
    if(gstBD.stoneValue > 0){
      gstTotalsBlock += '<div class="tr2" style="font-size:10px;color:#888;"><span class="tc">&nbsp;&nbsp;HSN '+gstBD.stoneHSN+' (Stones '+gstBD.stoneGSTRate+'%)</span><span class="tv">'+fmt(gstBD.stoneValue)+'</span></div>';
    }
    // Tax split
    if(gstBD.isInterState){
      gstTotalsBlock += '<div class="tr2"><span class="tc">IGST @ '+gstRate+'%</span><span class="tv">'+fmt(gstBD.igst)+'</span></div>';
    } else {
      gstTotalsBlock +=
        '<div class="tr2"><span class="tc">CGST @ '+(gstRate/2).toFixed(1)+'%</span><span class="tv">'+fmt(gstBD.cgst)+'</span></div>'+
        '<div class="tr2"><span class="tc">SGST @ '+(gstRate/2).toFixed(1)+'%</span><span class="tv">'+fmt(gstBD.sgst)+'</span></div>';
    }
  }

  // ── Table headers ────────────────────────────────────────────────────
  var hsnHeader = isGST ? '<th>HSN</th>' : '';
  var gstHeader = isGST ? '<th>GST</th>' : '';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>'+sale.invNo+'</title><style>'+
    '@import url(\'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@300;400;500&display=swap\');'+
    '*{box-sizing:border-box;margin:0;padding:0;}'+
    'body{font-family:\'Inter\',-apple-system,sans-serif;background:#fff;color:#212529;font-size:13px;line-height:1.55;-webkit-print-color-adjust:exact;}'+
    '.page{max-width:710px;margin:0 auto;padding:32px 36px;position:relative;}'+
    '.wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);'+
    'font-family:\'Cormorant Garamond\',serif;font-size:86px;font-weight:600;'+
    'color:rgba(26,95,212,.04);pointer-events:none;white-space:nowrap;z-index:0;}'+
    '.pg{position:relative;z-index:1;}'+
    '.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:2px solid #212529;margin-bottom:20px;}'+
    '.sn{font-family:\'Cormorant Garamond\',serif;font-size:28px;font-weight:600;color:#141618;letter-spacing:.04em;line-height:1;}'+
    '.st{font-size:10px;color:#6c757d;letter-spacing:.12em;text-transform:uppercase;margin-top:5px;}'+
    '.ibox{text-align:right;}'+
    '.ino{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:3px;color:'+invoiceColor+';}'+
    '.inv{font-family:\'Cormorant Garamond\',serif;font-size:22px;font-weight:600;color:#141618;letter-spacing:.04em;}'+
    '.idt{font-size:11px;color:#6c757d;margin-top:3px;}'+
    '.ir2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}'+
    '.ib{background:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;padding:12px 14px;}'+
    '.ib.blue{background:#e8f0fe;border-color:rgba(26,95,212,.15);}'+
    '.il2{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#6c757d;margin-bottom:6px;}'+
    '.iname{font-family:\'Cormorant Garamond\',serif;font-size:16px;font-weight:600;color:#141618;}'+
    '.idet{font-size:12px;color:#495057;margin-top:3px;}'+
    '.tbl{width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;}'+
    '.tbl thead tr{background:#f1f3f5;border-bottom:2px solid #dee2e6;}'+
    '.tbl thead th{padding:9px 12px;text-align:right;font-size:9.5px;font-weight:700;color:#495057;text-transform:uppercase;letter-spacing:.1em;white-space:nowrap;}'+
    '.tbl thead th:first-child{text-align:left;}'+
    '.tbl tbody tr{border-bottom:1px solid #f1f3f5;}'+
    '.tbl tbody tr:last-child{border-bottom:none;}'+
    '.tbl tbody tr:nth-child(even){background:#fafafa;}'+
    '.il{padding:11px 12px;vertical-align:top;}'+
    '.in{font-family:\'Cormorant Garamond\',serif;font-size:15px;font-weight:600;color:#141618;letter-spacing:.02em;}'+
    '.im{font-size:11px;color:#6c757d;margin-top:2px;}'+
    '.im code{font-family:monospace;color:#1a5fd4;font-size:11px;}'+
    '.iw{font-size:11px;margin-top:4px;}'+
    '.wt-g{color:#6c757d;}.wt-d{color:#c0392b;}.wt-n{color:#059669;font-weight:500;}'+
    '.ir{text-align:right;padding:11px 12px;vertical-align:middle;color:#495057;}'+
    '.bold{font-weight:600;color:#141618;}small{font-size:9px;color:#adb5bd;display:block;}'+
    '.tw{display:flex;justify-content:flex-end;margin-bottom:18px;}'+
    '.tb{width:310px;}'+
    '.tr2{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #f1f3f5;color:#495057;}'+
    '.tr2:last-child{border-bottom:none;}'+
    '.tc{color:#6c757d;font-size:12px;}.tv{font-weight:500;color:#141618;}'+
    '.tv.cr{color:#059669;font-weight:600;}.tv.db{color:#c0392b;font-weight:700;}'+
    '.tgrand{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-top:2px solid #141618;margin-top:6px;}'+
    '.tgl{font-size:13px;font-weight:600;color:#141618;text-transform:uppercase;letter-spacing:.05em;}'+
    '.tgv{font-family:\'Cormorant Garamond\',serif;font-size:22px;font-weight:600;color:'+invoiceColor+';}'+
    '.tsettle{display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:1px solid #f1f3f5;}'+
    '.wb{background:#e8f0fe;border-left:3px solid '+invoiceColor+';border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:18px;}'+
    '.wbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#6c757d;margin-bottom:3px;}'+
    '.wbt{font-size:13px;font-weight:500;color:#141618;}'+
    '.chips{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;}'+
    '.chip{font-size:11px;font-weight:500;padding:4px 14px;border-radius:100px;letter-spacing:.02em;}'+
    '.cp{background:#ecfdf5;color:#059669;border:1px solid rgba(5,150,105,.2);}'+
    '.ce{background:#fdf3f2;color:#c0392b;border:1px solid rgba(192,57,43,.2);}'+
    '.sigrow{display:flex;justify-content:space-between;margin:22px 0 18px;align-items:flex-end;}'+
    '.sigb{text-align:center;width:150px;}'+
    '.sigl{height:1px;background:#dee2e6;margin-bottom:5px;}'+
    '.sigk{font-size:10px;color:#6c757d;text-transform:uppercase;letter-spacing:.1em;font-weight:600;}'+
    '.sigc{font-size:12px;color:#adb5bd;font-style:italic;}'+
    '.terms{border-top:1px solid #dee2e6;padding-top:12px;margin-top:4px;}'+
    '.tt{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#adb5bd;margin-bottom:5px;}'+
    '.tx{font-size:10px;color:#adb5bd;line-height:1.7;}'+
    '.ftr{text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #dee2e6;}'+
    '.ft{font-family:\'Cormorant Garamond\',serif;font-size:15px;color:#495057;font-weight:500;}'+
    '.fp{font-size:10px;color:#adb5bd;margin-top:4px;letter-spacing:.04em;}'+
    '.seal{display:inline-block;border:1px solid #dee2e6;border-radius:4px;padding:3px 10px;font-size:9px;color:#adb5bd;margin-top:8px;letter-spacing:.1em;text-transform:uppercase;}'+
    '@media print{body{font-size:12px;}.page{padding:18px 22px;}.wm{display:none;}}'+
    '</style></head><body>'+
    '<div class="wm">'+shopName+'</div>'+
    '<div class="page"><div class="pg">'+
    memoBanner+
    /* Header — dynamic shop name */
    '<div class="hdr">'+
      '<div>'+
        '<div class="sn">'+shopName+'</div>'+
        '<div class="st">'+shopTagline+'</div>'+
        (shopPhone ? '<div style="font-size:11px;color:#6c757d;margin-top:3px;">&#9990; '+shopPhone+'</div>' : '')+
        gstInfoBlock+
      '</div>'+
      '<div class="ibox">'+
        '<div class="ino">'+invoiceLabel+'</div>'+
        '<div class="inv">'+sale.invNo+'</div>'+
        '<div class="idt">'+fmtDate(sale.date)+'&ensp;&middot;&ensp;'+fmtTime(sale.date)+'</div>'+
      '</div>'+
    '</div>'+
    /* Info row */
    '<div class="ir2">'+
      '<div class="ib"><div class="il2">Bill To</div>'+
        '<div class="iname">'+escHtml(sale.customer)+'</div>'+
        (sale.phone?'<div class="idet">&#9990; '+escHtml(sale.phone)+'</div>':'')+
        (sale.addr?'<div class="idet">'+escHtml(sale.addr)+'</div>':'')+
      '</div>'+
      '<div class="ib blue"><div class="il2">Payment Info</div>'+
        '<div class="iname">'+escHtml(sale.payment)+'</div>'+
        '<div class="idet">Date: '+fmtDate(sale.date)+'</div>'+
        (sale.notes?'<div class="idet">Occasion: '+escHtml(sale.notes)+'</div>':'')+
      '</div>'+
    '</div>'+
    /* Items table */
    '<table class="tbl"><thead><tr>'+
      '<th style="width:36%;text-align:left;">Item Description</th>'+
      '<th>Net Wt (g)</th><th>Rate/g (&#8377;)</th><th>Making (&#8377;)</th><th>Stone (&#8377;)</th>'+
      hsnHeader + gstHeader +
      '<th>Amount (&#8377;)</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table>'+
    /* Totals */
    '<div class="tw"><div class="tb">'+
      '<div class="tr2"><span class="tc">Gold Value</span><span class="tv">'+fmt(t.gv)+'</span></div>'+
      '<div class="tr2"><span class="tc">Making Charges</span><span class="tv">'+fmt(t.mc)+'</span></div>'+
      (t.dc?'<div class="tr2"><span class="tc">Diamond / Stone</span><span class="tv">'+fmt(t.dc)+'</span></div>':'')+
      (t.disc?'<div class="tr2"><span class="tc">Discount</span><span class="tv cr">&minus; '+fmt(t.disc)+'</span></div>':'')+
      gstTotalsBlock+
      '<div class="tgrand"><span class="tgl">Grand Total</span><span class="tgv">&#8377;'+fmt(t.grand)+'</span></div>'+
      ((sale.oldGold&&sale.oldGold.value>0)?
        '<div class="tsettle"><span style="color:#6c757d;">&#9851; Old Gold'+(sale.oldGold.purity?' ('+sale.oldGold.purity+')':'')+'</span><span class="tv cr">&minus; '+fmt(sale.oldGold.value)+'</span></div>':'')+
      ((sale.prevAdvance&&sale.prevAdvance.amount>0)?
        '<div class="tsettle"><span style="color:#6c757d;">&#10003; Advance ('+sale.prevAdvance.mode+')</span><span class="tv cr">&minus; '+fmt(sale.prevAdvance.amount)+'</span></div>':'')+
      ((sale.splitPayments&&sale.splitPayments.length>0)?
        sale.splitPayments.map(function(sp){return '<div class="tsettle"><span style="color:#6c757d;">&#128179; '+sp.mode+'</span><span class="tv cr">&minus; '+fmt(sp.amount)+'</span></div>';}).join('')
      :(sale.nowPaying&&sale.nowPaying.amount>0?
          '<div class="tsettle"><span style="color:#6c757d;">&#128179; Paid ('+sale.nowPaying.mode+')</span><span class="tv cr">&minus; '+fmt(sale.nowPaying.amount)+'</span></div>':
          (!sale.oldGold&&!sale.prevAdvance&&sale.advance>0?
            '<div class="tsettle"><span style="color:#6c757d;">Advance Paid</span><span class="tv cr">&minus; '+fmt(t.adv)+'</span></div>':'')))+
      (t.bal>0?
        '<div class="tr2" style="background:#fdf3f2;border-radius:4px;padding:8px 4px;margin-top:4px;"><span style="color:#c0392b;font-weight:700;">&#9201; Balance Due</span><span style="color:#c0392b;font-weight:700;font-size:15px;">&#8377;'+fmt(t.bal)+'</span></div>':
        '<div class="tr2" style="background:#ecfdf5;border-radius:4px;padding:8px 4px;margin-top:4px;"><span style="color:#059669;font-weight:600;">&#10003; Fully Settled</span><span style="color:#059669;font-weight:600;">Nil</span></div>')+
    '</div></div>'+
    /* Amount in words */
    '<div class="wb"><div class="wbl">Amount in Words</div><div class="wbt">&#8377; '+amtWords+' Only</div></div>'+
    /* Status chips */
    '<div class="chips">'+
      '<span class="chip cp">'+sale.payment+'</span>'+
      (t.bal>0?'<span class="chip ce">Balance Due: &#8377;'+fmt(t.bal)+'</span>':'<span class="chip cp">&#10003; Payment Complete</span>')+
    '</div>'+
    /* Signature section */
    '<div class="sigrow">'+
      '<div class="sigb"><div class="sigl"></div><div class="sigk">Customer</div></div>'+
      '<div class="sigc">Thank you for your purchase</div>'+
      '<div class="sigb"><div class="sigl"></div><div class="sigk">Authorised Signatory</div></div>'+
    '</div>'+
    /* Terms */
    '<div class="terms"><div class="tt">Terms &amp; Conditions</div>'+
      '<div class="tx">Goods once sold will not be exchanged without original bill &middot; Exchange value subject to gold rates at time of exchange &middot; All disputes subject to local jurisdiction &middot; Computer generated invoice.</div></div>'+
    /* Footer */
    '<div class="ftr"><div class="ft">'+shopName+'</div>'+
      (shopCity ? '<div class="fp">'+shopCity+(shopGSTIN&&isGST?' &ensp;&middot;&ensp; GSTIN: '+shopGSTIN:'')+'</div>' : '')+
      '<div class="seal">'+invoiceLabel+'</div>'+
    '</div>'+
    '</div></div></body></html>';
}

