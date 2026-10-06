function numberToWords(num){
  if(!num||num<=0) return 'Zero Rupees';
  var ones=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  var tens=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function conv(n){
    if(n<20) return ones[n];
    if(n<100) return tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');
    if(n<1000) return ones[Math.floor(n/100)]+' Hundred'+(n%100?' and '+conv(n%100):'');
    if(n<100000) return conv(Math.floor(n/1000))+' Thousand'+(n%1000?' '+conv(n%1000):'');
    if(n<10000000) return conv(Math.floor(n/100000))+' Lakh'+(n%100000?' '+conv(n%100000):'');
    return conv(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+conv(n%10000000):'');
  }
  return 'Rupees '+conv(num);
}

function previewInvoice(){
  if(UI.saleMode==='stock'){
    var items = UI.saleItems.filter(function(x){return x.pid;});
    if(!items.length){toast('Add at least one item first');return;}
  } else {
    var hasItem = customSaleItems.some(function(x){return x.name&&(parseFloat(x.grossWt)||0)>0;});
    if(!hasItem){toast('Add at least one item with weight');return;}
  }
  CURRENT_SALE_FOR_PDF = buildSaleObj();
  if(!CURRENT_SALE_FOR_PDF.invNo) CURRENT_SALE_FOR_PDF.invNo = 'DRAFT'; // real number is assigned at save
  var bt = _saleFormBillType || 'gst';
  openInvoiceModal(buildInvoiceHTML(CURRENT_SALE_FOR_PDF, bt), bt);
}
function showSaleInvoice(saleId){
  var sale = S.sales.find(function(x){return x.id===saleId;});
  if(!sale) return;
  CURRENT_SALE_FOR_PDF = sale;
  var bt = sale.billType || 'gst';
  openInvoiceModal(buildInvoiceHTML(sale, bt), bt);
}
function openInvoiceModal(html, initialBillType){
  var bt = initialBillType || 'gst';
  _billType = bt;
  document.getElementById('invoice-content').innerHTML = '<iframe id="inv-frame" style="width:100%;height:500px;border:none;border-radius:8px;" srcdoc=""></iframe>';
  document.getElementById('invoice-modal').classList.add('open');
  setTimeout(function(){
    var f = document.getElementById('inv-frame');
    if(f) f.srcdoc = html;
    setBillType(bt);
  }, 80);
}
// Edit / Refund / Delete from the bill preview: close the preview first so the
// next modal is not stacked under it, then act on the bill that was showing.
function invoiceBillAction(fn){
  var sale = CURRENT_SALE_FOR_PDF;
  if(!sale || !sale.id) return;
  closeModal();
  fn(sale.id);
}
function closeModal(){
  document.getElementById('invoice-modal').classList.remove('open');
  CURRENT_SALE_FOR_PDF = null;
}

function downloadPDF(){
  if(!CURRENT_SALE_FOR_PDF){toast('No invoice loaded');return;}
  var btn = document.getElementById('pdf-btn');
  if(btn){btn.textContent='Opening...';btn.disabled=true;}
  var html = buildInvoiceHTML(CURRENT_SALE_FOR_PDF, _billType);
  var blob = new Blob([html],{type:'text/html;charset=utf-8'});
  var url = URL.createObjectURL(blob);
  var win = window.open(url,'_blank');
  var shopName = ((SAAS&&SAAS.shop&&SAAS.shop.name)||'Invoice').replace(/\s+/g,'-');
  var typeLabel = _billType==='gst' ? 'TaxInvoice' : 'Memo';
  if(win){
    win.onload = function(){ setTimeout(function(){win.print();},500); };
    toast('Bill opened! Tap Print \u2192 Save as PDF');
  } else {
    var a = document.createElement('a');
    a.href = url;
    a.download = (CURRENT_SALE_FOR_PDF.invNo||'Invoice')+'-'+typeLabel+'-'+shopName+'.html';
    a.click();
    toast('Downloaded! Open file and Print \u2192 Save as PDF');
  }
  setTimeout(function(){
    URL.revokeObjectURL(url);
    if(btn){btn.textContent='\u2193 Download PDF';btn.disabled=false;}
  }, 3000);
}

function shareWhatsApp(){
  if(!CURRENT_SALE_FOR_PDF){toast('No invoice loaded');return;}
  var s = CURRENT_SALE_FOR_PDF;
  var t = calcSaleTotals(s);
  var nl = '\n';
  var msg = '*'+((SAAS&&SAAS.shop&&SAAS.shop.name)||'My Jewellery Shop')+'*' + nl;
  // Only include BIS claim if items are actually hallmarked
  var hasBIS = (s.items||[]).some(function(i){ return i.huid && validateHUID(i.huid).ok; });
  if(hasBIS) msg += 'BIS Hallmark Certified' + nl;
  msg += '--------------------------------' + nl;
  msg += '*Invoice: ' + s.invNo + '*' + nl;
  msg += 'Date: ' + fmtDate(s.date) + nl;
  msg += 'Customer: *' + s.customer + '*' + nl;
  if(s.phone) msg += 'Phone: ' + s.phone + nl;
  msg += '--------------------------------' + nl;
  msg += '*Items Purchased:*' + nl;
  (s.items||[]).forEach(function(i){
    var rate = getItemRate(i); // locked at time of sale
    msg += '- ' + i.name + nl;
    msg += '  Purity: ' + i.purity;
    if(i.grossWeight&&(i.grossWeight>i.weight)){
      msg += ' | Gross: ' + fmtW(i.grossWeight);
      if(i.blackBeads>0) msg += ' | Beads: -' + fmtW(i.blackBeads);
      if(i.diamondWt>0)  msg += ' | Stone: -' + fmtW(i.diamondWt);
      if(i.otherWt>0)    msg += ' | Other: -' + fmtW(i.otherWt);
      msg += ' | *Net Gold: ' + fmtW(i.weight) + '*';
    } else {
      msg += ' | Wt: ' + fmtW(i.weight*i.qty);
    }
    if(i.huid) msg += ' | HUID: ' + i.huid;
    msg += nl;
    msg += '  Gold Value: ' + fmt(rate*i.weight*i.qty) + nl;
    if(i.making) msg += '  Making: ' + fmt(itemMakingAmount(i)) + nl;
    if(i.diamond) msg += '  Stone/Diamond: ' + fmt(i.diamond*i.qty) + nl;
  });
  msg += '--------------------------------' + nl;
  msg += '*Bill Summary:*' + nl;
  msg += 'Gold Value: ' + fmt(t.gv) + nl;
  msg += 'Making: ' + fmt(t.mc) + nl;
  if(t.dc) msg += 'Diamond: ' + fmt(t.dc) + nl;
  if(s.gst) msg += 'GST (' + s.gst + '%): ' + fmt(t.gstAmt) + nl;
  if(t.disc) msg += 'Discount: -' + fmt(t.disc) + nl;
  msg += '--------------------------------' + nl;
  msg += '*GRAND TOTAL: ' + fmt(t.grand) + '*' + nl;
  if(s.oldGold&&s.oldGold.value>0) msg += '\u2851 Old Gold ('+s.oldGold.purity+' '+fmtW(s.oldGold.weight)+'): -'+fmt(s.oldGold.value)+nl;
  if(s.prevAdvance&&s.prevAdvance.amount>0) msg += '\u2713 Advance paid ('+s.prevAdvance.mode+'): -'+fmt(s.prevAdvance.amount)+nl;
  if(s.nowPaying&&s.nowPaying.amount>0) msg += '\uD83D\uDCB3 Paid now ('+s.nowPaying.mode+'): -'+fmt(s.nowPaying.amount)+nl;
  if(t.bal>0) msg += '*Balance Due: ' + fmt(t.bal) + '*' + nl;
  else msg += '\u2705 Fully Settled' + nl;
  msg += '--------------------------------' + nl;
  msg += 'Payment Mode: ' + salePayModes(s) + nl;
  msg += nl + 'Thank you for shopping at '+((SAAS&&SAAS.shop&&SAAS.shop.name)||'our shop')+'!';
  var phone = (s.phone||'').replace(/[^0-9]/g,'');
  var waUrl = phone
    ? 'https://wa.me/91'+phone+'?text='+encodeURIComponent(msg)
    : 'https://wa.me/?text='+encodeURIComponent(msg);
  window.open(waUrl,'_blank');
  toast('Opening WhatsApp...');
}

// ── GIRVI ⇄ CUSTOMER ACCOUNT LINKING (Feature 1) ───────────────────────
// Normalises a phone number to bare digits, and an empty/garbage phone to ''.
function normPhone(phone){
  return (phone||'').toString().replace(/\D/g,'').slice(-10); // last 10 digits, ignores +91 etc
}
function normName(name){
  return (name||'').toString().trim().toLowerCase().replace(/\s+/g,' ');
}
// Finds an existing S.customers record matching this name/phone, or creates one.
// Phone (normalised) is the primary key when present; falls back to normalised name.
// Always returns a customer record (never null), and keeps S.customers deduped.
function findOrCreateGirviCustomer(name, phone, extra){
  if(!Array.isArray(S.customers)) S.customers = [];
  var np = normPhone(phone), nn = normName(name);
  var existing = null;
  if(np){
    existing = S.customers.find(function(c){ return normPhone(c.phone)===np; });
  } else if(nn){
    // Only fall back to name-only matching when this record has NO phone
    // at all. If a phone WAS provided but didn't match anyone, it's a
    // different person even if the name matches — common surnames
    // (Shah, Patel, Sharma) would otherwise get merged into one account,
    // silently combining two different customers' loans and balances.
    existing = S.customers.find(function(c){ return normName(c.name)===nn; });
  }
  if(existing){
    // Keep latest name/phone (typo correction), never lose existing contact info
    if(name && !existing.name) existing.name = name;
    if(phone && !existing.phone) existing.phone = phone;
    if(extra){
      if(extra.addr && !existing.addr) existing.addr = extra.addr;
    }
    existing.lastSeen = new Date().toISOString();
    return existing;
  }
  var rec = {
    id: (typeof crypto.randomUUID==='function') ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)),
    name: name||'', phone: phone||'',
    addr: (extra&&extra.addr)||'',
    gstin:'', email:'', notes:'',
    createdAt: new Date().toISOString(), lastSeen: new Date().toISOString()
  };
  S.customers.push(rec);
  return rec;
}
// Links one Girvi entry to its customer account, creating the account if needed.
// Call this whenever a Girvi entry is created or its name/phone is edited.
function linkGirviToCustomer(g){
  if(!g) return null;
  var cust = findOrCreateGirviCustomer(g.customer, g.phone, {addr:g.address});
  g.customerId = cust.id;
  return cust;
}
// One-time / on-load migration: links every existing Girvi entry that doesn't
// yet have a customerId, merging duplicate "accounts" for the same person.
function migrateGirviCustomerLinks(){
  if(!Array.isArray(S.girvi)) return;
  S.girvi.forEach(function(g){
    if(!g.customerId || !(S.customers||[]).some(function(c){return c.id===g.customerId;})){
      linkGirviToCustomer(g);
    }
  });
}
// All Girvi entries (active + closed, never deleted) belonging to one customer account.
function girviEntriesForCustomer(custId){
  return (S.girvi||[]).filter(function(g){ return !g._deleted && g.customerId===custId; });
}

// ── CUSTOMER DATABASE ─────────────────────────────────────────────────
// Upserts customer into S.customers on every sale.
// Keyed by phone number (most stable identifier).
// Falls back to name-only key if no phone.
function upsertCustomer(name, phone, extraFields){
  if(!name || name==='Walk-in') return;
  if(!Array.isArray(S.customers)) S.customers = [];
  var key = phone ? phone.replace(/\D/g,'') : name.toLowerCase().trim();
  var existing = S.customers.find(function(c){
    return phone
      ? (c.phone||'').replace(/\D/g,'') === key
      : c.name.toLowerCase().trim() === key;
  });
  if(existing){
    // Update name to latest (in case of typo correction)
    existing.name = name;
    if(phone) existing.phone = phone;
    if(extraFields){
      if(extraFields.addr  && !existing.addr)  existing.addr  = extraFields.addr;
      if(extraFields.gstin && !existing.gstin) existing.gstin = extraFields.gstin;
      if(extraFields.email && !existing.email) existing.email = extraFields.email;
    }
    existing.lastSeen = new Date().toISOString();
  } else {
    var newCust = {
      id:       (typeof crypto.randomUUID==='function') ? crypto.randomUUID() : Date.now().toString(36),
      name:     name,
      phone:    phone||'',
      addr:     (extraFields&&extraFields.addr)||'',
      gstin:    (extraFields&&extraFields.gstin)||'',
      email:    (extraFields&&extraFields.email)||'',
      notes:    '',
      createdAt: new Date().toISOString(),
      lastSeen:  new Date().toISOString()
    };
    S.customers.push(newCust);
  }
}

// Edit a customer record directly
function saveCustomerEdit(custId){
  var c = (S.customers||[]).find(function(x){ return x.id===custId; });
  if(!c){ toast('Customer not found'); return; }
  var nameEl  = document.getElementById('ce-name');
  var phoneEl = document.getElementById('ce-phone');
  var addrEl  = document.getElementById('ce-addr');
  var emailEl = document.getElementById('ce-email');
  var notesEl = document.getElementById('ce-notes');
  if(!nameEl){ toast('Edit form not found'); return; }
  var newName = nameEl.value.trim();
  if(!newName){ toast('Name cannot be empty'); return; }
  c.name  = newName;
  c.phone = phoneEl ? phoneEl.value.trim() : c.phone;
  c.addr  = addrEl  ? addrEl.value.trim()  : c.addr;
  c.email = emailEl ? emailEl.value.trim() : c.email;
  c.notes = notesEl ? notesEl.value.trim() : c.notes;
  saveToCloud(function(err){
    if(!err){
      toast('\u2705 Customer updated');
      document.getElementById('cust-edit-modal').style.display = 'none';
      renderCustomers();
    }
  });
}

function showCustomerEditModal(custId){
  var c = (S.customers||[]).find(function(x){ return x.id===custId; });
  if(!c){ toast('Customer not found'); return; }
  var modal = document.getElementById('cust-edit-modal');
  if(!modal) return;
  document.getElementById('ce-name').value  = c.name  || '';
  document.getElementById('ce-phone').value = c.phone || '';
  document.getElementById('ce-addr').value  = c.addr  || '';
  document.getElementById('ce-email').value = c.email || '';
  document.getElementById('ce-notes').value = c.notes || '';
  document.getElementById('ce-save-btn').onclick = function(){ saveCustomerEdit(custId); };
  modal.style.display = 'flex';
}

function showAddCustomerModal(){
  var modal = document.getElementById('cust-edit-modal');
  if(!modal) return;
  document.getElementById('ce-name').value  = '';
  document.getElementById('ce-phone').value = '';
  document.getElementById('ce-addr').value  = '';
  document.getElementById('ce-email').value = '';
  document.getElementById('ce-notes').value = '';
  document.getElementById('ce-save-btn').onclick = function(){
    var name  = (document.getElementById('ce-name').value||'').trim();
    var phone = (document.getElementById('ce-phone').value||'').trim();
    if(!name){ toast('Enter a customer name'); return; }
    upsertCustomer(name, phone, {
      addr:  (document.getElementById('ce-addr').value||'').trim(),
      email: (document.getElementById('ce-email').value||'').trim()
    });
    // Set notes separately since upsertCustomer doesn't handle it
    var nc = (S.customers||[]).find(function(c){ return c.name===name&&(c.phone||'')===(phone||''); });
    if(nc) nc.notes = (document.getElementById('ce-notes').value||'').trim();
    saveToCloud(function(err){
      if(!err){ toast('\u2705 Customer added'); document.getElementById('cust-edit-modal').style.display='none'; renderCustomers(); }
    });
  };
  modal.style.display = 'flex';
}

function buildCustMap(){
  var cm={};
  S.sales.forEach(function(s){
    var k=(s.customer||'Walk-in')+(s.phone?'_'+s.phone:'');
    if(!cm[k]) cm[k]={name:s.customer||'Walk-in',phone:s.phone||'',sales:[]};
    cm[k].sales.push(s);
  });
  // Merge with S.customers database — adds customers with no sales,
  // and enriches existing entries with addr/email/notes/id
  (S.customers||[]).forEach(function(c){
    var k = c.name+(c.phone?'_'+c.phone:'');
    if(!cm[k]) cm[k]={name:c.name,phone:c.phone||'',sales:[]};
    cm[k].custId  = c.id;
    cm[k].addr    = c.addr||cm[k].addr||'';
    cm[k].email   = c.email||cm[k].email||'';
    cm[k].notes   = c.notes||cm[k].notes||'';
  });
  return cm;
}

function renderBalanceTracker(){
  var cm=buildCustMap();
  var due=[];
  Object.values(cm).forEach(function(c){
    var b=c.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
    if(b>0) due.push({name:c.name,phone:c.phone,bal:b});
  });
  var banner=document.getElementById('bal-tracker-banner');
  if(!due.length){if(banner)banner.style.display='none';return;}
  if(banner)banner.style.display='block';
  var totalDue=due.reduce(function(s,c){return s+c.bal;},0);
  var se=document.getElementById('bal-summary-text');
  var te=document.getElementById('bal-total-amt');
  var le=document.getElementById('bal-due-list');
  if(se)se.textContent=due.length+' customer'+(due.length>1?'s':'')+' with pending balance';
  if(te)te.textContent=fmt(totalDue);
  due.sort(function(a,b){return b.bal-a.bal;});
  if(!le)return;
  var html='';
  due.forEach(function(c){
    var cid=encodeURIComponent(c.name+(c.phone?'_'+c.phone:''));
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:rgba(255,255,255,0.6);border-radius:var(--radius);margin-bottom:5px;cursor:pointer;" onclick="showCustHistory(&quot;'+cid+'&quot;)">';
    html+='<div><span style="font-weight:700;font-size:13px;">'+escHtml(c.name)+'</span>';
    if(c.phone) html+=' <span style="font-size:11px;color:var(--text3);">'+escHtml(c.phone)+'</span>';
    html+='</div>';
    html+='<span style="font-weight:700;color:var(--danger);">'+fmt(c.bal)+'</span></div>';
  });
  le.innerHTML=html;
}

function renderCustomers(){
  var q=(document.getElementById('cust-search').value||'').toLowerCase();
  var sortEl=document.getElementById('cust-sort');
  var sortBy=sortEl?sortEl.value:'purchases';
  renderBalanceTracker();
  var cm=buildCustMap();
  var custs=Object.values(cm);
  if(q) custs=custs.filter(function(c){return c.name.toLowerCase().indexOf(q)>-1||c.phone.indexOf(q)>-1;});

  // Enrich each customer with full financials
  custs.forEach(function(c){
    c._fin = calcCustomerFinancials(c.name, c.phone);
  });

  if(sortBy==='amount')   custs.sort(function(a,b){return b._fin.totalPurchased - a._fin.totalPurchased;});
  else if(sortBy==='balance') custs.sort(function(a,b){return b._fin.totalExposure - a._fin.totalExposure;});
  else if(sortBy==='recent')  custs.sort(function(a,b){
    var at=a.sales.length?new Date(a.sales[a.sales.length-1].date).getTime():0;
    var bt=b.sales.length?new Date(b.sales[b.sales.length-1].date).getTime():0;
    return bt-at;
  });
  else custs.sort(function(a,b){return b.sales.length-a.sales.length;});

  var listEl=document.getElementById('cust-list');
  listEl.innerHTML='';
  if(!custs.length){
    listEl.innerHTML='<div class="empty"><span class="empty-icon">&#128101;</span>No customers found</div>';
    return;
  }
  custs.forEach(function(c){
    var f   = c._fin;
    var last= c.sales[c.sales.length-1];
    var wt  = c.sales.reduce(function(s,x){return s+x.items.reduce(function(a,i){return a+i.weight*i.qty;},0);},0);
    var cid = c.name+(c.phone?'_'+c.phone:'');
    var riskColor = {low:'var(--success)',medium:'var(--warning)',high:'var(--danger)'}[f.riskLevel]||'var(--text3)';
    var riskIcon  = {low:'🟢',medium:'🟡',high:'🔴'}[f.riskLevel]||'⚪';
    var div=document.createElement('div');
    div.style.cssText='background:var(--surface);border:0.5px solid '+(f.totalExposure>0?'rgba(168,49,42,0.25)':'var(--border2)')+';border-left:3px solid '+(f.riskLevel==='high'?'var(--danger)':f.riskLevel==='medium'?'var(--warning)':'var(--gold)')+';border-radius:var(--radius-lg);padding:13px 15px;margin-bottom:9px;cursor:pointer;box-shadow:var(--shadow);';
    div.onclick=function(){showCustHistory(encodeURIComponent(cid));};
    // Store custId for edit button and girvi link
    var _custId = c.custId || null;
    // Girvi summary for this customer
    var _cGirvi = _custId ? girviEntriesForCustomer(_custId) : (S.girvi||[]).filter(function(g){
      return normName(g.customer)===normName(c.name)&&(!c.phone||normPhone(g.phone)===normPhone(c.phone));
    });
    var _cGActive = _cGirvi.filter(function(g){return g.status!=='closed';});
    var _cGOut    = _cGActive.reduce(function(s,g){return s+girviOutstanding(g);},0);
    var _cGInt    = _cGActive.reduce(function(s,g){return s+girviInterestAccrued(g);},0);
    div.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
        '<div>'+
          '<div style="font-weight:700;font-size:14px;">'+riskIcon+' '+escHtml(c.name)+'</div>'+
          (c.phone?'<div style="font-size:12px;color:var(--text3);">&#128222; '+escHtml(c.phone)+'</div>':'')+
          '<div style="font-size:11px;color:var(--text3);margin-top:3px;">'+(last?plural(c.sales.length,'bill')+' &bull; '+fmtW(wt)+' &bull; Last: '+fmtDate(last.date):'No jewellery purchases &bull; Girvi account')+'</div>'+
          (f.activeGirvi>0||_cGActive.length>0?
            '<div style="font-size:11px;color:var(--warning);font-weight:600;margin-top:2px;">🪙 '+(_cGActive.length||f.activeGirvi)+' active girvi · ₹'+Math.round(_cGOut||f.girviExposure).toLocaleString('en-IN')+' out · ₹'+Math.round(_cGInt).toLocaleString('en-IN')+' interest</div>'
            :'')+
        '</div>'+
        '<div style="text-align:right;min-width:110px;">'+
          '<div style="font-weight:700;color:var(--gold-dark);font-size:15px;">\u20b9'+Math.round(f.totalPurchased).toLocaleString('en-IN')+'</div>'+
          (f.totalCredit>0
            ?'<div style="font-size:12px;font-weight:700;color:var(--danger);">\u23f1 \u20b9'+Math.round(f.totalCredit).toLocaleString('en-IN')+' due</div>'+
             '<button onclick="event.stopPropagation();custBalanceWA(\''+jsAttrEsc(c.name)+'\',\''+jsAttrEsc(c.phone)+'\','+Math.round(f.totalCredit)+')" style="margin-top:5px;padding:4px 10px;border-radius:100px;border:1px solid #25d36640;background:#25d36622;color:#25d366;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">\ud83d\udcf2 Remind</button>'
            :'<div style="font-size:12px;color:var(--success);font-weight:600;">\u2713 All paid</div>')+
          (f.totalExposure>0?'<div style="font-size:11px;color:'+riskColor+';font-weight:600;">Total exposure: \u20b9'+Math.round(f.totalExposure).toLocaleString('en-IN')+'</div>':'')+
        '</div>'+
      '</div>'+
      (_custId?'<div style="text-align:right;margin-top:6px;"><button onclick="event.stopPropagation();showCustomerEditModal(\''+ _custId +'\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1px solid var(--border2);background:var(--card2);color:var(--text2);cursor:pointer;font-family:inherit;">✏️ Edit</button></div>':'')+
      '';
    listEl.appendChild(div);
  });
}


function markSalePaid(saleId){
  if(!isManager()){ toast('\u26a0 Only owners and managers can mark bills as paid'); return; }
  var sale=S.sales.find(function(x){return x.id===saleId;});
  if(!sale)return;
  var t=calcSaleTotals(sale);
  if(t.bal<=0){ toast('Already fully paid'); return; }
  if(_salePaymentSubmitLock[saleId]){ toast('Please wait — a save is already in progress'); return; }
  safeConfirm('Mark as fully paid?','Balance of '+fmt(t.bal)+' will be cleared.',function(){
    var _snap = {
      extraPayments: JSON.parse(JSON.stringify(sale.extraPayments||[])),
      paymentHistory: JSON.parse(JSON.stringify(sale.paymentHistory||[])),
      payStatus: sale.payStatus, paidAt: sale.paidAt, lockedGrand: sale.lockedGrand
    };
    _salePaymentSubmitLock[saleId]=true;
    // Foundation audit §6/§9: this used to jump sale.advance straight to
    // the grand total, overwriting whatever creation-time collection
    // (old gold / prev advance / initial payment) was already there —
    // a direct, unreversible balance edit, exactly what the financial
    // ledger audit says to never do. Now it records the remaining
    // balance as a real, reversible payment ledger entry instead, same
    // as any other payment — sale.advance/oldGold/prevAdvance are never
    // touched.
    if(!sale.extraPayments) sale.extraPayments=[];
    sale.extraPayments.push({id:(typeof crypto.randomUUID==='function')?crypto.randomUUID():'PAY-'+Date.now(),amount:t.bal,mode:'Manual',ref:'',date:new Date().toISOString(),by:(SAAS&&SAAS.user?(SAAS.user.name||SAAS.user.email):'staff')});
    sale.payStatus='full';
    sale.paidAt=new Date().toISOString();
    // Lock the grand total at the moment of payment
    if(!sale.lockedGrand) sale.lockedGrand=t.grand;
    // Record in payment history (display only — calcSaleTotals reads
    // sale.extraPayments above, not this)
    if(typeof addPaymentRecord==='function') addPaymentRecord(sale, t.bal, 'Manual', 'Marked as paid');
    // Lock rates into items that don't have them yet (migrates old bills)
    (sale.items||[]).forEach(function(i){
      if(!i.lockedRate) i.lockedRate=getRate(i.metal,i.purity);
    });
    saveToCloud(function(err){
      _salePaymentSubmitLock[saleId]=false;
      if(!err){
        toast('Marked as paid and saved!');
        var key=(sale.customer||'Walk-in')+(sale.phone?'_'+sale.phone:'');
        showCustHistory(encodeURIComponent(key));
        renderCustomers();
      } else {
        // Was a bare success-only callback — a failed save left the
        // sale showing fully paid locally forever with the cloud still
        // showing the real outstanding balance.
        sale.extraPayments=_snap.extraPayments;
        sale.paymentHistory=_snap.paymentHistory;
        sale.payStatus=_snap.payStatus;
        sale.paidAt=_snap.paidAt;
        sale.lockedGrand=_snap.lockedGrand;
        saveCache();
        if(err.message!=='version-conflict') toast('\u26a0 Could not save — change rolled back.');
      }
    });
  });
  return;
}

function showCustHistory(encKey){
  var key=decodeURIComponent(encKey);
  var custSales=S.sales.filter(function(s){
    return ((s.customer||'Walk-in')+(s.phone?'_'+s.phone:''))===key;
  });
  // Resolve the customer even when they have no jewellery sales yet —
  // e.g. an account created purely through Girvi (pawn) loans.
  var _custRecord = (S.customers||[]).find(function(c){
    return (c.name+(c.phone?'_'+c.phone:''))===key;
  });
  if(!custSales.length && !_custRecord) return; // nothing at all under this key
  var first=custSales[0] || {customer:_custRecord.name, phone:_custRecord.phone};
  var totalSpent=custSales.reduce(function(s,x){return s+(calcSaleTotals(x).grand-calcRefundAdj(x).amount);},0); // H2: net of refunds
  var totalBal=custSales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
  var totalWt=custSales.reduce(function(s,x){return s+x.items.reduce(function(a,i){return a+i.weight*i.qty;},0);},0);

  document.getElementById('cust-modal-title').textContent=(first.customer||'Walk-in')+' — Account';

  var body=document.getElementById('cust-modal-body');
  body.innerHTML='';

  // Summary bar
  var sumDiv=document.createElement('div');
  sumDiv.style.cssText='background:var(--bg2);border-radius:var(--radius);padding:10px 14px;margin-bottom:1rem;display:flex;gap:12px;flex-wrap:wrap;';
  if(custSales.length){
    var totalPending=custSales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
    var paidAmt=totalSpent-totalPending;
    sumDiv.innerHTML=
      '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">Lifetime Value</div><div style="font-weight:700;color:var(--gold-dark);font-size:17px;">'+fmt(totalSpent)+'</div></div>'+
      '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">Purchases</div><div style="font-weight:700;font-size:17px;">'+custSales.length+'</div></div>'+
      '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">Total Wt</div><div style="font-weight:700;font-size:17px;">'+fmtW(totalWt)+'</div></div>'+
      (paidAmt>0?'<div><div style="font-size:10px;color:var(--success);text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">Paid</div><div style="font-weight:700;color:var(--success);font-size:15px;">'+fmt(paidAmt)+'</div></div>':'')+
      (totalBal>0
        ?'<div><div style="font-size:10px;color:var(--danger);text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">Balance due</div><div style="font-weight:700;color:var(--danger);font-size:17px;">'+fmt(totalBal)+'</div></div>'
        :'<div><div style="font-size:10px;color:var(--success);text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">Status</div><div style="font-weight:700;color:var(--success);font-size:15px;">&#10003; All Cleared</div></div>'
      )+
      (first.phone?'<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">Phone</div><div style="font-weight:600;font-size:14px;">'+escHtml(first.phone)+'</div></div>':'');
  } else {
    sumDiv.innerHTML=
      '<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">Account Type</div><div style="font-weight:700;font-size:15px;">🪙 Girvi (Pawn) Only</div></div>'+
      (first.phone?'<div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;">Phone</div><div style="font-weight:600;font-size:14px;">'+escHtml(first.phone)+'</div></div>':'');
  }
  body.appendChild(sumDiv);

  // Each sale card
  custSales.slice().reverse().forEach(function(s){
    var t=calcSaleTotals(s);
    var wt=s.items.reduce(function(a,i){return a+i.weight*i.qty;},0);
    var isPaid=t.bal<=0;

    var card=document.createElement('div');
    card.style.cssText='border:1px solid '+(isPaid?'rgba(45,122,79,0.3)':'rgba(192,57,43,0.3)')+';border-radius:var(--radius);padding:12px;margin-bottom:10px;border-left:3px solid '+(isPaid?'var(--success)':'var(--danger)')+';';

    // Header row
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;';
    hdr.innerHTML=
      '<div>'+
        '<div style="font-weight:700;font-size:13px;">'+s.invNo+'</div>'+
        '<div style="font-size:12px;color:var(--text3);">'+fmtDate(s.date)+' at '+fmtTime(s.createdAt||s.date)+'</div>'+
        '<div style="font-size:12px;color:var(--text3);">'+escHtml(salePayModes(s))+'</div>'+
        (s.paidAt?'<div style="font-size:11px;color:var(--success);margin-top:2px;">&#10003; Paid on '+fmtDate(s.paidAt)+'</div>':'')+
        (s.refundStatus==='full'?'<div style="font-size:10px;font-weight:700;color:#fff;background:var(--danger);border-radius:4px;padding:1px 7px;margin-top:3px;display:inline-block;">&#128260; REFUNDED</div>':'')+
        (s.refundStatus==='partial'?'<div style="font-size:10px;font-weight:700;color:#fff;background:var(--warning);border-radius:4px;padding:1px 7px;margin-top:3px;display:inline-block;">&#128260; PART REFUND</div>':'')+
      '</div>'+
      '<div style="text-align:right;">'+
        '<div style="font-weight:700;font-size:15px;color:var(--gold-dark);">'+fmt(t.grand)+'</div>'+
        (isPaid
          ?'<div style="font-size:12px;font-weight:700;color:var(--success);">&#10003; Fully paid</div>'
          :'<div style="font-size:12px;font-weight:700;color:var(--danger);">&#9201; Bal: '+fmt(t.bal)+'</div>'
        )+
      '</div>';
    card.appendChild(hdr);

    // Items list
    s.items.forEach(function(i){
      var row=document.createElement('div');
      row.style.cssText='font-size:12px;padding:4px 0;border-top:1px solid var(--border);display:flex;justify-content:space-between;';
      row.innerHTML=
        '<span>'+escHtml(i.name)+' ('+escHtml(i.purity)+', '+fmtW(i.weight)+')'+(i.grossWeight&&i.grossWeight!==i.weight?' gross:'+fmtW(i.grossWeight):'')+(i.huid?' HUID:'+escHtml(i.huid):'')+'</span>'+
        '<span style="font-weight:600;">'+fmt(getItemRate(i)*i.weight*i.qty+itemMakingAmount(i)+(i.diamond||0)*i.qty)+'</span>';
      card.appendChild(row);
    });

    // Notes
    if(s.notes){
      var n=document.createElement('div');
      n.style.cssText='font-size:11px;color:var(--text3);margin-top:6px;';
      n.textContent='Note: '+s.notes;
      card.appendChild(n);
    }
    // Edit history indicator
    if(s.editHistory&&s.editHistory.length){
      var ev=document.createElement('div');
      ev.style.cssText='font-size:11px;color:var(--info);margin-top:4px;';
      ev.innerHTML='&#9998; Edited '+s.editHistory.length+' time'+(s.editHistory.length>1?'s':'')+
        ' &bull; Last: '+fmtDate(s.lastEditedAt||s.editHistory[s.editHistory.length-1].at);
      card.appendChild(ev);
    }
    // Payment history
    if((s.paymentHistory&&s.paymentHistory.length)||(s.extraPayments&&s.extraPayments.length)){
      var phDiv=document.createElement('div');
      phDiv.innerHTML=renderPaymentHistory(s);
      card.appendChild(phDiv);
    }
    // Aging indicator for unpaid bills
    var ageDays=getAgingDays(s);
    if(ageDays>7){
      var ageDiv=document.createElement('div');
      ageDiv.style.cssText='margin-top:5px;font-size:11px;font-weight:700;';
      ageDiv.className=agingClass(ageDays);
      ageDiv.textContent='⏱ Pending '+agingLabel(ageDays);
      card.appendChild(ageDiv);
    }

    // Action buttons
    var btnRow=document.createElement('div');
    btnRow.style.cssText='margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;';

    // View Bill button
    var btnBill=document.createElement('button');
    btnBill.className='btn btn-sm btn-gold';
    btnBill.innerHTML='&#128196; View Bill';
    (function(sid){btnBill.onclick=function(){showSaleInvoice(sid);};})(s.id);
    btnRow.appendChild(btnBill);

    // Edit bill button
    var btnEdit=document.createElement('button');
    btnEdit.className='btn btn-sm';
    btnEdit.style.cssText='background:var(--info);color:#fff;font-size:11px;';
    btnEdit.innerHTML='&#9998; Edit';
    (function(sid){btnEdit.onclick=function(){openEditBill(sid);};})(s.id);
    btnRow.appendChild(btnEdit);

    // Mark as Paid button (only if balance due)
    if(!isPaid){
      var btnPay=document.createElement('button');
      btnPay.className='btn btn-sm';
      btnPay.style.cssText='background:var(--success);color:#fff;font-size:11px;';
      btnPay.innerHTML='&#8377; Add Payment';
      (function(sid){btnPay.onclick=function(){openSalePaymentModal(sid);};})(s.id);
      btnRow.appendChild(btnPay);

      var btnPaid=document.createElement('button');
      btnPaid.className='btn btn-sm btn-success';
      btnPaid.innerHTML='&#10003; Mark as Paid';
      (function(sid){btnPaid.onclick=function(){markSalePaid(sid);};})(s.id);
      btnRow.appendChild(btnPaid);
    }

    // Delete button
    // Refund button
    var btnRef=document.createElement('button');
    btnRef.className='btn btn-sm';
    btnRef.style.cssText='background:var(--warning-bg);color:var(--warning);border:1px solid var(--warning);';
    btnRef.innerHTML='&#128260; Refund';
    (function(sid){btnRef.onclick=function(){openRefundModal(sid);};})(s.id);
    btnRow.appendChild(btnRef);
    // Delete button
    var btnDel=document.createElement('button');
    btnDel.className='btn btn-sm btn-danger';
    btnDel.innerHTML='&#128465; Delete';
    (function(sid){btnDel.onclick=function(){deleteSale(sid);};})(s.id);
    btnRow.appendChild(btnDel);

    card.appendChild(btnRow);
    body.appendChild(card);
  });

  document.getElementById('cust-modal').classList.add('open');

  // ── Girvi Customer Ledger (Feature 5 & 14) ──────────────────────────
  var _cName = first.customer||'Walk-in';
  var _cPhone = first.phone||'';
  var _custRecord = (_cPhone ? (S.customers||[]).find(function(c){return normPhone(c.phone)===normPhone(_cPhone);}) : null) ||
                    (S.customers||[]).find(function(c){return normName(c.name)===normName(_cName);});
  var _cGirvi = _custRecord ? girviEntriesForCustomer(_custRecord.id) :
    (S.girvi||[]).filter(function(g){
      return !g._deleted && normName(g.customer)===normName(_cName)&&(!_cPhone||normPhone(g.phone)===normPhone(_cPhone));
    });
  if(_cGirvi.length){
    var gSection=document.createElement('div');
    gSection.style.cssText='margin-top:14px;background:rgba(179,146,87,.04);border:1px solid rgba(179,146,87,.18);border-radius:12px;padding:12px;';
    var gActive=_cGirvi.filter(function(g){return g.status!=='closed';});
    var gClosed=_cGirvi.filter(function(g){return g.status==='closed';});
    var gTotalOut=gActive.reduce(function(s,g){return s+girviOutstanding(g);},0);
    var gTotalInt=gActive.reduce(function(s,g){return s+girviInterestAccrued(g);},0);
    var gTotalPaid=_cGirvi.reduce(function(s,g){return s+girviTotalPaid(g);},0);
    gSection.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'+
        '<div style="font-size:11px;font-weight:700;color:var(--gold);text-transform:uppercase;">🪙 Girvi Account — '+_cGirvi.length+' Loan'+(_cGirvi.length===1?'':'s')+'</div>'+
        (_custRecord?'<button onclick="event.stopPropagation();closeModal(\'cust-modal\');addGirviLoanForCustomer(\''+_custRecord.id+'\');" style="font-size:11px;padding:4px 12px;border-radius:20px;border:1px solid var(--gold-dark);background:rgba(179,146,87,.1);color:var(--gold-dark);cursor:pointer;font-family:inherit;font-weight:700;">+ Add Loan</button>':'')+
      '</div>'+
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px;">'+
        '<div><div style="font-size:10px;color:var(--text3);">Active</div><div style="font-weight:700;color:var(--warning);">'+gActive.length+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);">Closed</div><div style="font-weight:700;color:var(--success);">'+gClosed.length+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);">Outstanding</div><div style="font-weight:700;color:var(--danger);">₹'+Math.round(gTotalOut).toLocaleString('en-IN')+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);">Interest Due</div><div style="font-weight:700;color:var(--warning);">₹'+Math.round(gTotalInt).toLocaleString('en-IN')+'</div></div>'+
        '<div><div style="font-size:10px;color:var(--text3);">Total Paid</div><div style="font-weight:700;color:var(--success);">₹'+Math.round(gTotalPaid).toLocaleString('en-IN')+'</div></div>'+
      '</div>'+
      _cGirvi.slice().sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt);}).map(function(g){
        var ymd=girviExactDuration(g.startDate);
        var dur='';
        if(ymd.years>0) dur+=ymd.years+'y ';
        if(ymd.months>0) dur+=ymd.months+'m ';
        dur+=ymd.days+'d';
        return '<div onclick="closeModal(\'cust-modal\');setTimeout(function(){openGirviDetail(\''+g.id+'\');},150);" style="padding:8px 10px;border-radius:8px;background:var(--card2);margin-bottom:6px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">'+
          '<div>'+
            '<div style="font-size:12px;font-weight:700;">'+g.grvNo+' &nbsp;'+girviStatusBadge(g.status)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);">'+
              (Array.isArray(g.items)&&g.items.length ? g.items.map(function(it){return it.type||'Item';}).join(', ') : (g.item&&g.item.type)||'Item')+
              ' · '+fmtDate(g.startDate)+' · '+dur+
            '</div>'+
          '</div>'+
          '<div style="text-align:right;">'+
            '<div style="font-weight:800;font-size:13px;">'+(g.status==='closed'?'<span style="color:var(--success);">Closed</span>':'₹'+Math.round(girviOutstanding(g)).toLocaleString('en-IN'))+'</div>'+
            '<div style="font-size:10px;color:var(--text3);">Loan: ₹'+Math.round(g.principal).toLocaleString('en-IN')+'</div>'+
          '</div>'+
        '</div>';
      }).join('');
    body.appendChild(gSection);
  }
}

function deleteSale(saleId){
  if(!isManager()){ toast('\u26a0 Only owners and managers can delete bills'); return; }
  var sale=S.sales.find(function(x){return x.id===saleId;});
  if(!sale) return;
  var t=calcSaleTotals(sale);
  safeConfirm('Delete bill '+sale.invNo+'?','\u20b9'+Math.round(t.grand).toLocaleString('en-IN')+' for '+sale.customer+'. Cannot be undone.',function(){
    (sale.items||[]).forEach(function(i){
      var p=S.products.find(function(x){return x.id===i.pid;});
      if(!p) return;
      var restoreQty=Math.max(1,parseInt(i.qty,10)||1);
      p.qty=(p.qty||0)+restoreQty;
      if(p._origQty) p.qty=Math.min(p.qty,p._origQty); // never restore past what was originally stocked
      if(p.unitWeight){ p.weight=Math.round(p.unitWeight*p.qty*1000)/1000; }
      if(p.unitNetWeight){ p.netWeight=Math.round(p.unitNetWeight*p.qty*1000)/1000; }
      p.status='available';
    });
    S.sales=S.sales.filter(function(x){return x.id!==saleId;});
    // Its invoice number stays used: never re-issued or re-typed (GST).
    if(sale.invNo){ if(!Array.isArray(S.voidedInvNos)) S.voidedInvNos=[]; S.voidedInvNos.push(sale.invNo); }
    auditLog('delete','sale',saleId,'Bill '+sale.invNo+' deleted — ₹'+Math.round(t.grand).toLocaleString('en-IN')); // H4: bill delete had no central audit trail
    saveToCloud(function(err){
      if(!err){
        toast('Bill deleted & stock restored');
        var remaining=S.sales.filter(function(s){
          return ((s.customer||'Walk-in')+(s.phone?'_'+s.phone:''))===((sale.customer||'Walk-in')+(sale.phone?'_'+sale.phone:''));
        });
        if(remaining.length){
          showCustHistory(encodeURIComponent((sale.customer||'Walk-in')+(sale.phone?'_'+sale.phone:'')));
        } else {
          closeCustModal();
        }
        renderCustomers();
      }
    });
  },true);
  return;
}


// ─── EDIT PRODUCT ────────────────────────────────────────────────────────
function editProd(id){
  var p=S.products.find(function(x){return x.id===id;});
  if(!p) return;
  document.getElementById('ep-id').value=p.id;
  document.getElementById('ep-name').value=p.name||'';
  document.getElementById('ep-huid').value=p.huid||'';
  document.getElementById('ep-sku').value=p.sku||'';
  // Show the weight of ONE piece — unitWeight is the source everything else
  // derives from (weight = unitWeight x qty). Showing the derived total left
  // this box empty for a sold-out item (qty 0), and "Gross weight required"
  // then blocked every edit to it. Products that predate unitWeight fall
  // back to their stored weight.
  document.getElementById('ep-wt').value=(p.unitWeight||p.weight)||'';
  var wtHint=document.getElementById('ep-wt-hint');
  if(wtHint){
    var _q=(typeof p.qty==='number')?p.qty:1;
    wtHint.textContent = _q>1 ? (_q+' pieces in stock · '+(Math.round(p.weight*1000)/1000)+' g total')
                       : _q===0 ? 'Sold out — this is kept for when you restock'
                       : '';
  }
  document.getElementById('ep-netwt').value=p.netWeight||'';
  document.getElementById('ep-mcrate').value=p.mcRate||'';
  document.getElementById('ep-stonewt').value=p.stoneWt||'';
  document.getElementById('ep-wastage').value=p.wastagePct||'';
  document.getElementById('ep-hallmark').value=p.hallmarkCentre||'';
  document.getElementById('ep-photo').value=p.photo||'';
  document.getElementById('ep-notes').value=p.notes||'';
  var purList=p.metal==='gold'?['24K','22K','18K','14K','Gold Plated']:['999 Pure','925 Sterling','800','Silver Plated'];
  var ps=document.getElementById('ep-purity');
  ps.innerHTML=purList.map(function(pu){return '<option'+(pu===p.purity?' selected':'')+'>'+pu+'</option>';}).join('');
  var cs=document.getElementById('ep-cat');
  for(var ci=0;ci<cs.options.length;ci++){
    if(cs.options[ci].text===p.cat){cs.selectedIndex=ci;break;}
  }
  document.getElementById('edit-modal').classList.add('open');
}
function saveEditProd(){
  var id=document.getElementById('ep-id').value;
  var p=S.products.find(function(x){return String(x.id)===id;});
  if(!p){toast('Product not found');return;}
  var name=document.getElementById('ep-name').value.trim();
  var wt=parseFloat(document.getElementById('ep-wt').value)||0;
  if(!name){toast('Product name required');return;}
  if(!wt){toast('⚠ Enter the weight of one piece'); document.getElementById('ep-wt').focus(); return;}
  // Validate everything BEFORE mutating p — this used to mutate
  // name/cat/purity first and only then validate HUID, so a failed HUID
  // check left the in-memory product half-edited with nothing saved.
  var epHuidRaw = document.getElementById('ep-huid').value.trim().toUpperCase();
  var epHuidCheck = validateHUID(epHuidRaw);
  if(!epHuidCheck.ok){ toast('\u26a0 '+epHuidCheck.msg); document.getElementById('ep-huid').focus(); return; }
  var epSku = document.getElementById('ep-sku').value.trim()||(p.metal==='gold'?'GLD':'SLV')+'-'+String(p.id).padStart(3,'0');
  // Foundation audit §6: block a duplicate SKU/HUID, excluding this
  // product's own id so editing without changing SKU/HUID doesn't trip
  // on itself.
  var dupHuid2 = productHuidIsDuplicate(epHuidRaw, p.id);
  if(dupHuid2){ toast('\u26a0 HUID '+epHuidRaw+' is already used by "'+dupHuid2.name+'" ('+dupHuid2.sku+')'); document.getElementById('ep-huid').focus(); return; }
  var dupSku2 = productSkuIsDuplicate(epSku, p.id);
  if(dupSku2){ toast('\u26a0 SKU '+epSku+' is already used by "'+dupSku2.name+'"'); document.getElementById('ep-sku').focus(); return; }
  var rawPhoto = document.getElementById('ep-photo').value.trim();
  var photoVal = (rawPhoto && (rawPhoto.startsWith('http://') || rawPhoto.startsWith('https://'))) ? rawPhoto : '';
  if(rawPhoto && !photoVal) toast('\u26a0 Photo URL must start with http:// or https:// \u2014 not saved');

  // Making Charge ₹/g is billed to the customer on every stock sale, so a
  // negative rate would print a bill line that pays the customer. Checked
  // up here with the rest, before anything on p is touched.
  var epMcRate = parseFloat(document.getElementById('ep-mcrate').value)||0;
  if(epMcRate < 0){ toast('\u26a0 Making charge cannot be negative'); document.getElementById('ep-mcrate').focus(); return; }

  var _epNet=parseFloat(document.getElementById('ep-netwt').value)||0;
  var _epStone=parseFloat((document.getElementById('ep-stonewt')||{value:0}).value)||0;
  var _epWast=parseFloat((document.getElementById('ep-wastage')||{value:0}).value)||0;
  var _epXp=productExtrasProblem(wt, _epStone, _epWast); if(_epXp){ toast('\u26a0 '+_epXp); return; }
  if(_epNet<0){ toast('\u26a0 Net weight cannot be negative'); document.getElementById('ep-netwt').focus(); return; }
  if(_epNet>0 && _epNet>wt*Math.max(1,parseInt(p.qty,10)||1)+1e-9){ toast('Net weight cannot be more than gross weight'); document.getElementById('ep-netwt').focus(); return; } // QA 30 Sep
  var _snap = JSON.parse(JSON.stringify(p));
  p.name=name;
  p.cat=document.getElementById('ep-cat').value;
  p.purity=document.getElementById('ep-purity').value;
  p.huid=epHuidRaw;
  p.sku=epSku;
  // wt is one piece. Writing it straight into p.weight (the derived total)
  // meant the next qty change re-derived from the old unitWeight and silently
  // threw the correction away: a batch corrected to 18g showed 10g, not 12g,
  // after one sale. Store the source, then derive exactly as every qty change
  // does. A sold-out item keeps its piece weight for restocking; its total
  // is correctly 0.
  var qtyNow = (typeof p.qty==='number' && isFinite(p.qty)) ? p.qty : 1;
  p.unitWeight = wt;
  p.weight = Math.round(wt*qtyNow*1000)/1000;
  p.netWeight=parseFloat(document.getElementById('ep-netwt').value)||0;
  p.mcRate=epMcRate;
  p.stoneWt=_epStone; p.wastagePct=_epWast;
  p.hallmarkCentre=((document.getElementById('ep-hallmark')||{value:''}).value||'').trim();
  if(!p.netWeight && _epStone>0) p.netWeight=Math.round((wt-_epStone)*qtyNow*1000)/1000; // net = gross - stones when not typed
  p.photo=photoVal;
  p.notes=document.getElementById('ep-notes').value.trim();

  // Foundation audit §13: log a change record when a field the spec
  // explicitly calls out (weight/purity/cost/location-type fields) was
  // actually edited — not on every save regardless of whether anything
  // meaningful changed.
  var changedFields=[];
  // Compare the per-piece weight the user actually saw and edited. Comparing
  // the derived total would log a phantom change on an item that predates
  // unitWeight, whose stored total is re-derived by the save above.
  var _prevPieceWt = _snap.unitWeight||_snap.weight;
  if(_prevPieceWt!==p.unitWeight) changedFields.push('weight '+_prevPieceWt+'g\u2192'+p.unitWeight+'g');
  if(_snap.purity!==p.purity) changedFields.push('purity '+_snap.purity+'\u2192'+p.purity);
  if(_snap.sku!==p.sku) changedFields.push('SKU '+_snap.sku+'\u2192'+p.sku);
  // A product with no huid field at all is not a different HUID from '' —
  // comparing them raw logged a phantom "HUID changed" on every edit of an older item.
  if((_snap.huid||'')!==(p.huid||'')) changedFields.push('HUID '+(_snap.huid||'—')+'\u2192'+(p.huid||'—'));
  if((parseFloat(_snap.mcRate)||0)!==p.mcRate) changedFields.push('making charge \u20b9'+(parseFloat(_snap.mcRate)||0)+'/g\u2192\u20b9'+p.mcRate+'/g');
  var moveId=null;
  if(changedFields.length){
    S.stockMovements=S.stockMovements||[];
    moveId=(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36);
    S.stockMovements.push({id:moveId,productId:p.id,type:'adjustment',prevStatus:p.status,newStatus:p.status,qtyChange:null,relatedId:null,relatedRef:'',reason:'Edited: '+changedFields.join(', '),user:(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User',ts:new Date().toISOString()});
  }

  saveToCloud(function(err){
    if(!err){closeEditModal();renderInv();toast('✓ '+p.name+' updated!');}
    else{
      // Was "Save failed — check connection" with the edit left applied
      // in memory forever. Now reverted, same pattern as every other
      // mutation point in this app.
      Object.keys(p).forEach(function(k){ if(!(k in _snap)) delete p[k]; });
      Object.assign(p, _snap);
      if(moveId) S.stockMovements=S.stockMovements.filter(function(m){return m.id!==moveId;});
      saveCache();
      if(err.message!=='version-conflict') toast('\u26a0 Save failed — change rolled back. Check your connection.');
    }
  });
}
function closeEditModal(){document.getElementById('edit-modal').classList.remove('open');}

function closeCustModal(){document.getElementById('cust-modal').classList.remove('open');}

// ─── REPORTS ─────────────────────────────────────────────────────────────
var repYear=new Date().getFullYear();
var repMonth=new Date().getMonth();

function changeMonth(dir){
  repMonth+=dir;
  if(repMonth>11){repMonth=0;repYear++;}
  if(repMonth<0){repMonth=11;repYear--;}
  renderReports();
}
function setMonthToday(){
  repYear=new Date().getFullYear();
  repMonth=new Date().getMonth();
  renderReports();
}
function filterSalesByMonth(yr,mo){
  return S.sales.filter(function(s){
    var d=new Date(s.date);
    return d.getFullYear()===yr&&d.getMonth()===mo;
  });
}
function exportMonthCSV(){
  var ms=filterSalesByMonth(repYear,repMonth);
  if(!ms.length){toast('No sales this month to export');return;}
  var rows=[['Invoice','Date','Customer','Phone','Items','Weight','Payment','Total','Balance']];
  ms.forEach(function(s){
    var wt=s.items.reduce(function(a,i){return a+i.weight*i.qty;},0);
    var t=calcSaleTotals(s);
    rows.push([s.invNo,fmtDate(s.date),s.customer,s.phone||'',
      s.items.map(function(i){return i.name;}).join('; '),
      fmtW(wt),salePayModes(s),t.grand,t.bal]);
  });
  var csv=rows.map(function(r){
    return r.map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');
  }).join('\n');
  var blob=new Blob([csv],{type:'text/csv'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  var mn=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  a.download='SriSai-'+mn[repMonth]+'-'+repYear+'.csv';
  a.href=url;a.click();URL.revokeObjectURL(url);
  toast('CSV exported!');
}

// ── GSTR-1 EXPORT ────────────────────────────────────────────────────
// Generates B2C summary CSV compatible with GST portal upload
// Format: GSTIN, Invoice No, Date, Customer GSTIN, Taxable Value, CGST, SGST, IGST, Total
function exportGSTR1(){
  var sales = (S.sales||[]).filter(function(s){ return (parseFloat(s.gst)||0) > 0; });
  if(!sales.length){ toast('No GST sales found in current data'); return; }

  // Ask user for month/year filter
  var months = {};
  sales.forEach(function(s){
    var d = s.date ? dbDayKey(s.date).slice(0,7) : 'unknown'; // local IST month, not the stored string's
    months[d] = (months[d]||0)+1;
  });
  var monthList = Object.keys(months).sort().reverse();

  // Show simple month picker
  safeConfirm(
    'Export GSTR-1',
    'Export ' + sales.length + ' GST sales as GSTR-1 CSV. Click OK to download.',
    function(){
      _doGSTR1Export(sales);
    }
  );
}

function exportGSTR1Month(ym){
  // ym = 'YYYY-MM'
  var sales = (S.sales||[]).filter(function(s){
    return (parseFloat(s.gst)||0) > 0 && s.date && dbDayKey(s.date).slice(0,7) === ym; // local IST month
  });
  if(!sales.length){ toast('No GST sales for ' + ym); return; }
  _doGSTR1Export(sales, ym);
}

function _doGSTR1Export(sales, label){
  var shopGSTIN = (SAAS && SAAS.shop && SAAS.shop.gstin) || '';
  var shopName  = (SAAS && SAAS.shop && SAAS.shop.name)  || 'My Shop';

  var rows = [
    // Header row — GSTR-1 B2C Summary format
    ['GSTIN of Supplier', 'Invoice Number', 'Invoice Date', 'Invoice Value',
     'Place of Supply', 'Reverse Charge', 'Invoice Type', 'Customer GSTIN',
     'Customer Name', 'Customer Phone',
     'Taxable Value (₹)', 'IGST (₹)', 'CGST (₹)', 'SGST/UTGST (₹)',
     'HSN Code', 'GST Rate %']
  ];

  sales.forEach(function(s){
    var t = calcSaleTotals(s);
    var gstRate  = parseFloat(s.gst) || 0;
    var taxable  = t.taxable || 0;
    var gstAmt   = t.gstAmt || 0;
    var custGSTIN = (s.custGSTIN||'').trim().toUpperCase();
    // Determine IGST vs CGST/SGST
    // If customer GSTIN state code != shop state code → IGST
    // Simple heuristic: if custGSTIN present and first 2 digits differ from shop
    var shopState = shopGSTIN.substring(0,2);
    var custState = custGSTIN.substring(0,2);
    var isIGST    = custGSTIN.length === 15 && custState !== shopState;
    var igst = isIGST ? gstAmt : 0;
    var cgst = isIGST ? 0 : gstAmt / 2;
    var sgst = isIGST ? 0 : gstAmt / 2;

    var invDate = s.date || '';
    // Format date as DD-MM-YYYY for GST portal
    if(invDate && invDate.indexOf('-') > -1){
      var parts = invDate.split('-');
      if(parts.length === 3) invDate = parts[2]+'-'+parts[1]+'-'+parts[0];
    }

    rows.push([
      shopGSTIN,
      s.invNo || '',
      invDate,
      (t.grand||0).toFixed(2),
      s.placeOfSupply || shopState || '',
      'N',  // Reverse charge — N for B2C
      custGSTIN ? 'B2B' : 'B2C',
      custGSTIN,
      s.customer || 'Walk-in',
      s.phone || '',
      taxable.toFixed(2),
      igst.toFixed(2),
      cgst.toFixed(2),
      sgst.toFixed(2),
      '7113',   // HSN for articles of jewellery
      gstRate.toFixed(1)
    ]);
  });

  // Build CSV
  var csv = rows.map(function(row){
    return row.map(function(cell){
      var s = String(cell || '');
      if(s.indexOf(',') > -1 || s.indexOf('"') > -1 || s.indexOf('\n') > -1){
        s = '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(',');
  }).join('\n');

  // Add BOM for Excel compatibility with Indian locale
  var bom = '\uFEFF';
  var blob = new Blob([bom + csv], {type:'text/csv;charset=utf-8;'});
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href   = url;
  a.download = (label ? 'GSTR1_'+label : 'GSTR1_All') + '_' + shopName.replace(/\s+/g,'_') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if(typeof saasActivityLog==='function') saasActivityLog('reports','Exported GSTR-1 CSV: '+(sales.length)+' sales');
  toast('\u2705 GSTR-1 CSV exported — ' + sales.length + ' invoices');
}

// One rule for an item's category everywhere in Reports (QA 30 Sep: the same
// ring showed as "Rings" in one section and "Other" in another). A stock
// sale's line carries only pid, so the product's category comes first.
// How a sale was paid, e.g. "Cash + UPI" for a split payment. Cowork 1 Oct:
// the bill, its chip and the customer account said only "Cash" (the first
// split row) while Reports said "Cash + UPI". One rule, from Reports.
function salePayModes(s){
  var modes=(s.splitPayments&&s.splitPayments.length)
    ? s.splitPayments.filter(function(r){return (parseFloat(r.amount)||0)>0;}).map(function(r){return r.mode;})
    : [(s.nowPaying&&s.nowPaying.mode)||s.payment||''];
  var seen={}; modes=modes.filter(function(m){ if(!m||seen[m]) return false; seen[m]=1; return true; });
  return modes.join(' + ');
}
function saleItemCat(i){
  var p = i && i.pid ? (S.products||[]).find(function(x){ return x.id===i.pid; }) : null;
  return (p&&p.cat) || (i&&(i.cat||i.category)) || 'Other';
}
function renderReports(){
  // Populate GSTR-1 month buttons
  (function(){
    var btnEl = document.getElementById('gstr1-month-btns');
    if(btnEl){
      var gstSales = (S.sales||[]).filter(function(s){ return (parseFloat(s.gst)||0)>0 && s.date; });
      var months = {};
      gstSales.forEach(function(s){ var m=dbDayKey(s.date).slice(0,7); months[m]=(months[m]||0)+1; });
      var mList = Object.keys(months).sort().reverse().slice(0,6);
      btnEl.innerHTML = mList.map(function(ym){
        var parts=ym.split('-'); var label=(parts[1]?['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(parts[1])-1]:ym)+' '+parts[0];
        return '<button onclick="exportGSTR1Month(\''+ym+'\')" class="btn btn-sm" style="font-size:11px;">⬇ '+label+' ('+months[ym]+')</button>';
      }).join('');
    }
  })();

  var MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var mlbl=MN[repMonth]+' '+repYear;
  var lbl=document.getElementById('month-label'); if(lbl) lbl.textContent=mlbl;
  ['rep-chart-label','rep-top-label','rep-hist-label'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent=mlbl;});

  var monthSales = filterSalesByMonth(repYear,repMonth);
  var mProfit    = calcMonthProfit(repYear,repMonth);
  var allTime    = calcAllTimeProfit();

  // Cash flow this month
  var monthStart = repYear+'-'+String(repMonth+1).padStart(2,'0')+'-01';
  var monthEnd   = repYear+'-'+String(repMonth+1).padStart(2,'0')+'-'+new Date(repYear,repMonth+1,0).getDate();
  var cf         = calcCashFlow(monthStart, monthEnd);

  // Pending balance all time
  var totalPending = S.sales.reduce(function(s,x){return s+calcSaleTotals(x).bal;},0);
  var girviTotal   = (S.girvi||[]).filter(function(g){return !g._deleted && g.status!=='closed';}).reduce(function(s,g){return s+girviOutstanding(g);},0);

  // ── Key metrics row ──
  var rm=document.getElementById('rep-metrics');
  if(rm) rm.innerHTML=
    '<div class="metric"><div class="metric-label">Revenue</div><div class="metric-value" style="color:var(--gold-dark)">'+fmt(mProfit.revenue)+'</div><div class="metric-sub">'+plural(monthSales.length,'bill')+' + girvi interest'+(mProfit.refunds>0?' − '+fmt(mProfit.refunds)+' refunds':'')+'</div></div>'+
    '<div class="metric"><div class="metric-label">Profit</div><div class="metric-value" style="color:'+(mProfit.netProfit>=0?'var(--success)':'var(--danger)')+'">'+fmt(mProfit.netProfit)+'</div><div class="metric-sub">net of expenses</div></div>'+
    '<div class="metric"><div class="metric-label">GST Collected</div><div class="metric-value">'+fmt(mProfit.gst)+'</div><div class="metric-sub">govt portion'+(mProfit.refundGst>0?'<br>Net of '+fmt(mProfit.refundGst)+' GST on refunds. Not in the GSTR-1 export — issue credit notes separately.':'')+'</div></div>'+
    '<div class="metric"><div class="metric-label">Total Collected</div><div class="metric-value" style="color:var(--success)">'+fmt(cf.cashIn)+'</div><div class="metric-sub">cash + UPI + card — not the same as Day Book’s cash-only "Cash In"</div></div>'+
    '<div class="metric"><div class="metric-label">Credit Given</div><div class="metric-value" style="color:var(--danger)">'+fmt(cf.credit)+'</div><div class="metric-sub">pending this month</div></div>'+
    '<div class="metric"><div class="metric-label">Net Cash</div><div class="metric-value" style="color:'+(cf.netCash>=0?'var(--success)':'var(--danger)')+'">'+fmt(cf.netCash)+'</div><div class="metric-sub">in \u2212 out</div></div>';

  // ── 6-month revenue + profit chart ──
  var chartData=[];
  for(var ci=5;ci>=0;ci--){
    var cm=repMonth-ci, cy=repYear;
    if(cm<0){cm+=12;cy--;}
    var mp=calcMonthProfit(cy,cm);
    chartData.push({label:MS[cm],rev:mp.revenue,profit:mp.netProfit,active:(cm===repMonth&&cy===repYear)});
  }
  var mx=Math.max.apply(null,chartData.map(function(d){return d.rev;}))||1;
  var ce=document.getElementById('rep-chart');
  var le=document.getElementById('rep-chart-labels');
  if(ce) ce.innerHTML=chartData.map(function(d){
    var hRev   =Math.max(4,Math.round(d.rev/mx*80));
    var hProfit=Math.max(2,Math.round(Math.max(0,d.profit)/mx*80));
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">'+
      '<div style="font-size:9px;color:var(--text3);">'+(d.rev>0?fmt(d.rev).replace('\u20b9',''):'')+'</div>'+
      '<div style="width:100%;position:relative;height:80px;display:flex;align-items:flex-end;gap:1px;">'+
        '<div style="flex:1;height:'+hRev+'px;background:'+(d.active?'var(--gold)':'var(--bg3)')+';border-radius:3px 3px 0 0;"></div>'+
        '<div style="flex:1;height:'+hProfit+'px;background:'+(d.profit>=0?'var(--success)':'var(--danger)')+';border-radius:3px 3px 0 0;opacity:0.8;"></div>'+
      '</div></div>';
  }).join('');
  if(le) le.innerHTML=chartData.map(function(d){
    return '<div style="flex:1;text-align:center;font-size:10px;color:'+(d.active?'var(--gold-dark)':'var(--text3)')+';">'+d.label+'</div>';
  }).join('');

  // ── P&L Statement ──
  var plEl=document.getElementById('rep-pl');
  if(!plEl){
    // Insert P&L section dynamically
    var reportPanel=document.getElementById('panel-reports');
    if(reportPanel){
      var plDiv=document.createElement('div');
      plDiv.className='card'; plDiv.id='rep-pl-card';
      plDiv.innerHTML='<div class="card-title">\ud83d\udcc4 P&L Statement \u2014 <span id="rep-pl-label"></span></div><div id="rep-pl"></div>';
      var rmEl=document.getElementById('rep-metrics');
      if(rmEl && rmEl.parentNode) rmEl.parentNode.insertBefore(plDiv, rmEl.nextSibling);
      plEl=document.getElementById('rep-pl');
    }
  }
  if(plEl){
    var plLabel=document.getElementById('rep-pl-label'); if(plLabel) plLabel.textContent=mlbl;
    var goldSold=monthSales.reduce(function(s,x){return s+x.items.filter(function(i){return i.metal==='gold';}).reduce(function(a,i){return a+i.weight*i.qty;},0);},0);
    var silverSold=monthSales.reduce(function(s,x){return s+x.items.filter(function(i){return i.metal==='silver';}).reduce(function(a,i){return a+i.weight*i.qty;},0);},0);
    var expByCat=Object.keys(mProfit.expenses.byCat);
    var expBreakdownHtml=dbExpenseBreakdownHtml(mProfit.expenses.byCat);
    plEl.innerHTML=
      '<div style="display:grid;gap:0;">'+
      plRow('(+) Total Revenue',     fmt(mProfit.revenue),  'var(--gold-dark)', true)+
      plRow('(-) Metal Cost',        fmt(mProfit.cost),     'var(--danger)',    false)+
      plRow('(-) GST (Govt portion)',fmt(mProfit.gst),      'var(--text3)',     false)+
      '<div style="border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">'+
      plRow('= Gross Profit',        fmt(mProfit.profit),   mProfit.profit>=0?'var(--success)':'var(--danger)', true)+
      '</div>'+
      (expByCat.length ?
        '<details style="margin-top:2px;"><summary style="cursor:pointer;">'+
          plRow('(-) Operating Expenses', fmt(mProfit.expenses.total), 'var(--danger)', false)+
        '</summary>'+expBreakdownHtml+'</details>'
        : plRow('(-) Operating Expenses', fmt(0), 'var(--text3)', false))+
      '<div style="border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">'+
      plRow('= Net Profit',          fmt(mProfit.netProfit),mProfit.netProfit>=0?'var(--success)':'var(--danger)', true)+
      '</div>'+
      '<div style="border-top:0.5px solid var(--border);padding-top:8px;margin-top:8px;font-size:11px;color:var(--text3);">'+
      plRow('Gold sold',  fmtW(goldSold),   'var(--text2)', false)+
      plRow('Silver sold',fmtW(silverSold), 'var(--text2)', false)+
      plRow('Gross margin', mProfit.margin.toFixed(1)+'%', 'var(--text2)', false)+
      '</div></div>'+
      '<div style="margin-top:12px;padding:10px 14px;background:var(--card2);border-radius:10px;font-size:12px;">'+
        '<div style="font-weight:700;margin-bottom:6px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">All-Time Summary</div>'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Total Revenue</span><span style="font-weight:700;color:var(--gold-dark);">'+fmt(allTime.revenue)+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Total Profit</span><span style="font-weight:700;color:var(--success);">'+fmt(allTime.profit)+'</span></div>'+
        '<div style="display:flex;justify-content:space-between;"><span>Avg Margin</span><span style="font-weight:700;">'+allTime.margin.toFixed(1)+'%</span></div>'+
      '</div>';
  }

  // ── Top products ──
  var pm={};
  monthSales.forEach(function(s){s.items.forEach(function(i){
    if(!pm[i.name]) pm[i.name]={u:0,w:0,rev:0};
    pm[i.name].u+=i.qty; pm[i.name].w+=i.weight*i.qty;
    pm[i.name].rev+=getItemRate(i)*(parseFloat(i.weight)||0)*(i.qty||1);
  });});
  var tp=document.getElementById('top-prods');
  if(tp) tp.innerHTML=Object.entries(pm).sort(function(a,b){return b[1].rev-a[1].rev;}).slice(0,8)
    .map(function(e){return '<tr><td>'+escHtml(e[0])+'</td><td>'+e[1].u+'</td><td style="font-weight:700">'+fmtW(e[1].w)+'</td><td style="font-weight:700;color:var(--gold-dark);">'+fmt(Math.round(e[1].rev))+'</td></tr>';}).join('')
    ||'<tr><td colspan="4"><div class="empty">No sales this month yet — is mahine ka pehla bill banao!</div></td></tr>';

  // ── By category (QA 30 Sep: #cat-perf had no renderer at all -- empty) ──
  var cm={};
  monthSales.forEach(function(s){ (s.items||[]).forEach(function(i){
    var c=saleItemCat(i), q=i.qty||1;
    if(!cm[c]) cm[c]={u:0,w:0};
    cm[c].u+=q; cm[c].w+=(parseFloat(i.weight)||0)*q;
  });});
  var cpEl=document.getElementById('cat-perf');
  if(cpEl) cpEl.innerHTML=Object.entries(cm).sort(function(a,b){return b[1].w-a[1].w;})
    .map(function(e){return '<tr><td>'+escHtml(e[0])+'</td><td>'+e[1].u+'</td><td style="font-weight:700">'+fmtW(e[1].w)+'</td></tr>';}).join('')
    ||'<tr><td colspan="3"><div class="empty">No category data yet — koi bill nahi bana is mahine</div></td></tr>';

  // ── Sales in <month> (QA 30 Sep: #sales-hist had no renderer either) ──
  var shEl=document.getElementById('sales-hist');
  if(shEl) shEl.innerHTML=monthSales.slice().sort(function(a,b){return new Date(b.date)-new Date(a.date);})
    .map(function(s){
      var t=calcSaleTotals(s), q=0, w=0;
      (s.items||[]).forEach(function(i){ var n=i.qty||1; q+=n; w+=(parseFloat(i.weight)||0)*n; });
      var modes=salePayModes(s);
      return '<tr><td style="font-weight:600">'+escHtml(s.invNo||'')+'</td><td>'+fmtDate(s.date)+'</td><td>'+escHtml(s.customer||'Walk-in')+'</td>'+
        '<td>'+q+'</td><td>'+fmtW(w)+'</td><td>'+escHtml(modes||'\u2014')+'</td>'+
        '<td style="font-weight:700;color:var(--gold-dark);">'+fmt(t.grand)+'</td>'+
        '<td style="color:'+(t.bal>0?'var(--danger)':'var(--success)')+'">'+(t.bal>0?fmt(t.bal):'\u2713')+'</td>'+
        '<td><button class="btn btn-sm" onclick="showSaleInvoice(\''+jsAttrEsc(s.id)+'\')">View</button></td></tr>';
    }).join('')
    ||'<tr><td colspan="9"><div class="empty">No sales this month — naya bill banane ke liye Record Sale par jao</div></td></tr>';

  // ── Top customers this month ──
  var custMap3={};
  monthSales.forEach(function(s){
    var k=(s.customer||'Walk-in')+(s.phone?'_'+s.phone:'');
    if(!custMap3[k]) custMap3[k]={name:s.customer||'Walk-in',phone:s.phone||'',count:0,rev:0,profit:0,pending:0};
    var t2=calcSaleTotals(s); var p2=calcSaleProfit(s);
    custMap3[k].count++; custMap3[k].rev+=t2.grand; custMap3[k].profit+=p2.profit; custMap3[k].pending+=t2.bal;
  });
  var topC=Object.values(custMap3).sort(function(a,b){return b.rev-a.rev;}).slice(0,5);
  var tcEl=document.getElementById('rep-top-custs');
  if(tcEl){
    if(topC.length){
      tcEl.innerHTML=topC.map(function(cu,i){
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">'+
          '<div><div style="font-weight:600;">'+(i+1)+'. '+escHtml(cu.name)+'</div>'+
          (cu.phone?'<div style="font-size:11px;color:var(--text3);">'+escHtml(cu.phone)+'</div>':'')+
          '</div>'+
          '<div style="text-align:right;">'+
            '<div style="font-weight:700;color:var(--gold-dark);">'+fmt(cu.rev)+'</div>'+
            '<div style="font-size:11px;color:var(--success);">Profit: '+fmt(Math.round(cu.profit))+'</div>'+
            (cu.pending>0?'<div style="font-size:11px;color:var(--danger);">Due: '+fmt(cu.pending)+'</div>':'<div style="font-size:11px;color:var(--success);">\u2713 Cleared</div>')+
          '</div></div>';
      }).join('');
    } else {
      tcEl.innerHTML='<div class="empty"><span class="empty-icon">&#128101;</span>No sales this month — top customers yahan dikhenge jab bill banoge</div>';
    }
  }

  // ── Pending aging ──
  var agingEl=document.getElementById('rep-aging');
  if(agingEl){
    var pendingSales=S.sales.filter(function(s){return calcSaleTotals(s).bal>0;});
    pendingSales.sort(function(a,b){return getAgingDays(b)-getAgingDays(a);});
    if(pendingSales.length){
      agingEl.innerHTML=pendingSales.slice(0,10).map(function(s){
        var t3=calcSaleTotals(s); var days=getAgingDays(s);
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">'+
          '<div><div style="font-weight:600;">'+escHtml(s.customer)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);">'+escHtml(s.invNo)+' &bull; '+fmtDate(s.date)+'</div></div>'+
          '<div style="text-align:right;">'+
            '<div style="font-weight:700;color:var(--danger);">'+fmt(t3.bal)+'</div>'+
            '<div class="'+agingClass(days)+'">'+agingLabel(days)+'</div>'+
          '</div></div>';
      }).join('');
    } else {
      agingEl.innerHTML='<div class="empty"><span class="empty-icon">&#9989;</span>No pending balances — sab clear hai!</div>';
    }
  }

  // ── Girvi report ──
  var girviRepEl=document.getElementById('rep-girvi');
  if(!girviRepEl){
    var rp=document.getElementById('panel-reports');
    if(rp){
      var gd=document.createElement('div'); gd.className='card';
      gd.innerHTML='<div class="card-title">\ud83e\udea9 Girvi Portfolio</div><div id="rep-girvi"></div>';
      rp.appendChild(gd); girviRepEl=document.getElementById('rep-girvi');
    }
  }
  if(girviRepEl){
    var gList=(S.girvi||[]).filter(function(g){return g.status!=='closed';});
    var totalOut=gList.reduce(function(s,g){return s+girviOutstanding(g);},0);
    var totalInt=gList.reduce(function(s,g){return s+girviInterestAccrued(g);},0);
    var highRisk=gList.filter(function(g){return girviLTV(g)>0.85;}).length;
    girviRepEl.innerHTML=
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">'+
        '<div style="background:var(--card2);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--warning);">'+fmt(totalOut)+'</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;">Outstanding</div></div>'+
        '<div style="background:var(--card2);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:18px;font-weight:800;color:var(--success);">'+fmt(totalInt)+'</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;">Interest Earned</div></div>'+
        '<div style="background:var(--card2);border-radius:10px;padding:10px;text-align:center;"><div style="font-size:18px;font-weight:800;color:'+(highRisk>0?'var(--danger)':'var(--success)')+';">'+highRisk+'</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;">High Risk</div></div>'+
      '</div>'+
      (gList.length?
        '<div class="tbl-wrap"><table><thead><tr><th>GRV</th><th>Customer</th><th>Principal</th><th>Outstanding</th><th>LTV</th><th>Status</th></tr></thead><tbody>'+
        gList.slice(0,10).map(function(g){
          var ltv=girviLTV(g); var ltvL=girviLTVLabel(ltv); var out=girviOutstanding(g);
          return '<tr>'+
            '<td style="font-weight:700;color:var(--gold);">'+g.grvNo+'</td>'+
            '<td>'+escHtml(g.customer)+'</td>'+
            '<td>'+fmt(g.principal)+'</td>'+
            '<td style="font-weight:700;">'+fmt(Math.round(out))+'</td>'+
            '<td><span style="color:'+ltvL.color+';font-weight:700;">'+ltvL.icon+' '+(ltv*100).toFixed(0)+'%</span></td>'+
            '<td>'+girviStatusBadge(g.status)+'</td>'+
          '</tr>';
        }).join('')+
        '</tbody></table></div>'
        :'<div class="empty">No active girvi loans — abhi koi girvi nahi hai</div>');
  }
}

function plRow(label, val, color, bold){
  return '<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px;'+( bold?'font-weight:700;':'')+'">'+
    '<span>'+label+'</span><span style="color:'+color+';">'+val+'</span></div>';
}


// Order form line items. Must be declared at load — renderOrdItems()
// runs the first time the form is opened, before either of the two
// reset sites (toggleOrdForm's close branch, saveOrder) has ever run.
// Without this, the very first open threw a ReferenceError and the
// Order Items section rendered empty, which looked like the section
// had "vanished" while working fine after an open/close/reopen cycle.
var ordItems=[{desc:'',cat:'Other',metal:'gold',purity:'22K',orderWt:0,estWt:0,making:0,makingType:'flat',qty:1,note:''}];

function addOrdItem(){
  ordItems.push({desc:'',cat:'Other',metal:'gold',purity:'22K',orderWt:0,estWt:0,making:0,makingType:'flat',qty:1,note:''});
  var wrap=document.getElementById('of-items-wrap');
  if(wrap) wrap.appendChild(buildOrdItemRow(ordItems.length-1));
  calcOrdEst();
}
function removeOrdItem(idx){
  if(ordItems.length<=1)return;
  ordItems.splice(idx,1);
  renderOrdItems();
}
function renderOrdItems(){
  var wrap=document.getElementById('of-items-wrap');
  if(!wrap)return;
  wrap.innerHTML='';
  ordItems.forEach(function(_,i){ wrap.appendChild(buildOrdItemRow(i)); });
  calcOrdEst();
}
function buildOrdItemRow(i){
  var item=ordItems[i];
  var CATS=['Rings','Necklaces / Haar','Earrings','Jhumkas','Bangles','Kankanalu','Bracelets','Anklets / Payal','Pendants','Chains','Mangalsutras','Maang Tikka','Nose Ring / Nath','Armlet / Bajuband','Waist Belt / Kamarbandh','Jadau','Other'];
  var METALS=['gold','silver','diamond'];
  var GPURITY=['24K','22K','18K','14K','Gold Plated'];
  var SPURITY=['999 Pure','925 Sterling','800','Silver Plated'];
  var card=document.createElement('div'); card.className='ord-item-card';
  var hdr=document.createElement('div'); hdr.className='item-header';
  hdr.innerHTML='<span class="item-num">Item '+(i+1)+'</span>';
  if(ordItems.length>1){
    var rb=document.createElement('button'); rb.className='btn btn-sm btn-danger'; rb.textContent='Remove';
    (function(idx){rb.onclick=function(){removeOrdItem(idx);};})(i);
    hdr.appendChild(rb);
  }
  card.appendChild(hdr);
  var g=document.createElement('div'); g.className='form-grid'; g.style.gridTemplateColumns='1fr 1fr';
  function field(lbl,id,type,ph,val,onInput){
    var f=document.createElement('div'); f.className='fg';
    f.innerHTML='<label>'+lbl+'</label>';
    var inp=document.createElement('input');
    inp.type=type||'text'; inp.id=id; inp.placeholder=ph||'';
    if(type==='number') inp.setAttribute('inputmode','decimal');
    inp.value=val||'';
    inp.oninput=onInput;
    f.appendChild(inp); return f;
  }
  function selField(lbl,id,opts,val,onChange){
    var f=document.createElement('div'); f.className='fg';
    f.innerHTML='<label>'+lbl+'</label>';
    var s=document.createElement('select'); s.id=id;
    opts.forEach(function(o){var op=document.createElement('option');op.value=o;op.textContent=o;if(o===val)op.selected=true;s.appendChild(op);});
    s.onchange=onChange; f.appendChild(s); return f;
  }
  // Row 1: Description + Category
  g.appendChild(field('Description / Design *','oi-desc-'+i,'text','e.g. 22K Gold Ring with diamond',item.desc,function(){ordItems[i].desc=this.value;}));
  g.appendChild(selField('Category','oi-cat-'+i,CATS,item.cat||'Other',function(){ordItems[i].cat=this.value;}));
  // Row 2: Metal + Purity
  var mf=selField('Metal','oi-metal-'+i,METALS,item.metal||'gold',function(){
    ordItems[i].metal=this.value;
    var ps=document.getElementById('oi-purity-'+i);
    if(ps){
      var pl=this.value==='silver'?SPURITY:GPURITY; ps.innerHTML='';
      pl.forEach(function(p){var o=document.createElement('option');o.value=p;o.textContent=p;ps.appendChild(o);});
      ordItems[i].purity=ps.value;
    }
  });
  g.appendChild(mf);
  var pf=selField('Purity','oi-purity-'+i,(item.metal==='silver'?SPURITY:GPURITY),item.purity||'22K',function(){ordItems[i].purity=this.value;});
  g.appendChild(pf);
  // Row 3: Order weight + Est final weight
  var owf=document.createElement('div'); owf.className='fg';
  owf.innerHTML='<label>Order Weight (g)</label>';
  var oww=document.createElement('div'); oww.className='isuf';
  var owi=document.createElement('input'); owi.type='text'; owi.setAttribute('inputmode','decimal');
  owi.placeholder='0.000'; owi.id='oi-wt-'+i; owi.value=item.orderWt>0?item.orderWt:'';
  (function(idx){owi.oninput=function(){ordItems[idx].orderWt=parseFloat(this.value)||0;calcOrdEst();};})(i);
  var ows=document.createElement('span'); ows.className='suf'; ows.textContent='g';
  oww.appendChild(owi); oww.appendChild(ows); owf.appendChild(oww); g.appendChild(owf);
  var ewf=document.createElement('div'); ewf.className='fg';
  ewf.innerHTML='<label>Est. Final Weight (g) <span style="font-size:10px;color:var(--text3);">&#177;tolerance</span></label>';
  var eww=document.createElement('div'); eww.className='isuf';
  var ewi=document.createElement('input'); ewi.type='text'; ewi.setAttribute('inputmode','decimal');
  ewi.placeholder='0.000'; ewi.id='oi-ewt-'+i; ewi.value=item.estWt>0?item.estWt:'';
  (function(idx){ewi.oninput=function(){ordItems[idx].estWt=parseFloat(this.value)||0;calcOrdEst();};})(i);
  var ews=document.createElement('span'); ews.className='suf'; ews.textContent='g';
  eww.appendChild(ewi); eww.appendChild(ews); ewf.appendChild(eww); g.appendChild(ewf);
  // Row 4: Making charges + type
  var mkf=document.createElement('div'); mkf.className='fg'; mkf.innerHTML='<label>Making Charges</label>';
  var mkw=document.createElement('div'); mkw.style.cssText='display:flex;gap:6px;';
  var mksel=document.createElement('select'); mksel.id='oi-mkt-'+i; mksel.style.cssText='width:auto;padding:9px 28px 9px 8px;font-size:12px;';
  ['flat','per_gram','percent'].forEach(function(t){var o=document.createElement('option');o.value=t;o.textContent=t==='flat'?'₹ Flat':t==='per_gram'?'₹/g':'%';if(t===(item.makingType||'flat'))o.selected=true;mksel.appendChild(o);});
  (function(idx){mksel.onchange=function(){ordItems[idx].makingType=this.value;};})(i);
  var mki=document.createElement('input'); mki.type='text'; mki.setAttribute('inputmode','decimal');
  mki.placeholder='0'; mki.id='oi-mk-'+i; mki.value=item.making>0?item.making:''; mki.style.flex='1';
  (function(idx){mki.oninput=function(){ordItems[idx].making=parseFloat(this.value)||0;calcOrdEst();};})(i);
  mkw.appendChild(mksel); mkw.appendChild(mki); mkf.appendChild(mkw); g.appendChild(mkf);
  // Row 5: Qty + Note
  g.appendChild(field('Quantity','oi-qty-'+i,'number','1',item.qty||1,function(){ordItems[i].qty=parseInt(this.value)||1;}));
  g.appendChild(field('Design Note / Reference','oi-note-'+i,'text','Colour, finish, photo ref...',item.note,function(){ordItems[i].note=this.value;}));
  card.appendChild(g);
  return card;
}

function calcOrdEst(){
  var quote=parseFloat((document.getElementById('of-quote')||{value:0}).value)||0;
  var adv=parseFloat((document.getElementById('of-adv-amt')||{value:0}).value)||0;
  var gold=parseFloat((document.getElementById('of-golddeposit')||{value:0}).value)||0;
  var goldVal = gold > 0
    ? (gold * getRate('gold', (document.getElementById('of-goldpurity')||{value:'22K'}).value||'22K'))
    : 0;
  var bal = Math.max(0, quote - adv - goldVal);
  function se(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  se('oe-total',fmt(quote)); se('oe-adv',fmt(adv));
  se('oe-goldep', goldVal>0 ? fmtW(gold)+' ('+fmt(goldVal)+')' : fmtW(gold));
  se('oe-bal',fmt(bal));
}

function ordCustAuto(){
  var q=(document.getElementById('of-cust').value||'').toLowerCase().trim();
  var box=document.getElementById('of-cust-sug');
  if(!q||q.length<2){if(box)box.style.display='none';return;}
  var seen={};
  var matches=S.sales.concat(S.orders||[]).filter(function(s){
    var n=(s.customer||'').toLowerCase();
    if(n.indexOf(q)===0&&!seen[s.customer]){seen[s.customer]=1;return true;}return false;
  }).slice(0,5);
  if(!matches.length){if(box)box.style.display='none';return;}
  if(box){box.style.display='block';box.innerHTML='';}
  matches.forEach(function(s){
    var div=document.createElement('div');
    div.style.cssText='padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);';
    div.innerHTML='<strong>'+escHtml(s.customer)+'</strong>'+(s.phone?' &bull; '+escHtml(s.phone):'');
    div.onclick=function(){
      document.getElementById('of-cust').value=s.customer;
      if(s.phone) document.getElementById('of-phone').value=s.phone;
      if(box) box.style.display='none';
    };
    if(box) box.appendChild(div);
  });
}

// ── SAVE ORDER ────────────────────────────────────────────────────────────
function saveOrder(_pastDateOk){
  ordItems.forEach(function(item,i){
    var dEl=document.getElementById('oi-desc-'+i); if(dEl)item.desc=dEl.value.trim();
    var cEl=document.getElementById('oi-cat-'+i); if(cEl)item.cat=cEl.value;
    var mEl=document.getElementById('oi-metal-'+i); if(mEl)item.metal=mEl.value;
    var pEl=document.getElementById('oi-purity-'+i); if(pEl)item.purity=pEl.value;
    var wEl=document.getElementById('oi-wt-'+i); if(wEl)item.orderWt=parseFloat(wEl.value)||0;
    var eEl=document.getElementById('oi-ewt-'+i); if(eEl)item.estWt=parseFloat(eEl.value)||0;
    var mkEl=document.getElementById('oi-mk-'+i); if(mkEl)item.making=parseFloat(mkEl.value)||0;
    var mtEl=document.getElementById('oi-mkt-'+i); if(mtEl)item.makingType=mtEl.value||'flat';
    var qEl=document.getElementById('oi-qty-'+i); if(qEl)item.qty=Math.max(1,parseInt(qEl.value)||1);
    var nEl=document.getElementById('oi-note-'+i); if(nEl)item.note=nEl.value.trim();
  });
  var cust=(document.getElementById('of-cust').value||'').trim();
  var delivery=document.getElementById('of-delivery').value||'';
  if(!cust){toast('Enter customer name');return;}
  var validItems=ordItems.filter(function(x){return x.desc.trim();});
  if(!validItems.length){toast('Enter at least one item description');return;}
  if(!delivery){toast('Select delivery date');return;}
  // QA 30 Sep: an advance of 1,50,000 on a 1,00,000 quote saved as "Fully paid"
  // and the extra 50,000 vanished; a delivery 4 weeks in the past was accepted.
  var _q=parseFloat((document.getElementById('of-quote')||{value:0}).value)||0;
  var _adv=parseFloat((document.getElementById('of-adv-amt')||{value:0}).value)||0;
  if(_q>0 && _adv>_q){toast('Advance ('+fmt(_adv)+') is more than the quote ('+fmt(_q)+'). Check both amounts.');return;}
  if(!_pastDateOk && delivery < dbDayKey(new Date())){
    safeConfirm('Delivery date is in the past', 'The delivery date '+fmtDate(delivery)+' has already passed. Save this order anyway (for example, an older order being entered now)?', function(){ saveOrder(true); });
    return;
  }
  // F4: one new order at a time -- the form stays open on a failed save.
  if(_orderLocked('__new')){toast('Already saving, please wait');return;}
  _orderLock('__new');
  var _prevNextOrdId=S.nextOrdId;
  if(!S.orders)S.orders=[];
  var now=new Date().toISOString();
  var advAmt=parseFloat((document.getElementById('of-adv-amt')||{value:0}).value)||0;
  var advMode=(document.getElementById('of-adv-mode')||{value:'Cash'}).value;
  var advRef=(document.getElementById('of-adv-ref')||{value:''}).value.trim();
  var advNote=(document.getElementById('of-adv-note')||{value:''}).value.trim();
  var txnId='TXN-'+Date.now();
  var initLedger = advAmt>0 ? [{
    txnId:txnId, type:'advance', amount:advAmt, mode:advMode,
    ref:advRef, note:advNote||'Initial advance', date:now
  }] : [];
  var ord={
    id: (typeof crypto.randomUUID==='function') ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)),
    _seq: S.nextOrdId++,
    ordNo:'ORD-'+String(S.nextOrdId-1).padStart(3,'0'),
    createdAt:now,
    customer:cust,
    phone:(document.getElementById('of-phone').value||'').trim(),
    addr:(document.getElementById('of-addr').value||'').trim(),
    items:validItems.map(function(i){
      return{desc:i.desc,cat:i.cat,metal:i.metal||'gold',purity:i.purity||'22K',
             orderWt:i.orderWt||0,estWt:i.estWt||0,making:i.making||0,
             makingType:i.makingType||'flat',qty:i.qty||1,note:i.note||''};
    }),
    quote:parseFloat((document.getElementById('of-quote')||{value:0}).value)||0,
    finalRate:parseFloat((document.getElementById('of-finalrate')||{value:0}).value)||0,
    goldDeposit:parseFloat((document.getElementById('of-golddeposit')||{value:0}).value)||0,
    goldPurity:(document.getElementById('of-goldpurity')||{value:'22K'}).value||'22K',
    priority:(document.getElementById('of-priority')||{value:'normal'}).value||'normal',
    delivery:delivery,
    // Notes / Occasion field removed from the order form. Orders created
    // before that still carry o.notes and the detail view / receipt keep
    // showing it, so no existing order loses information.
    status:'new',
    advance: advAmt,
    // NEW: full payment ledger
    ledger: initLedger,
    statusHistory:[{status:'new',date:now,note:'Order created'}]
  };
  S.orders.push(ord);
  // H4: orders had no central audit trail. Same rule as Girvi's archive
  // (Cowork review 30 Sep) -- a failed save must not leave its log line.
  var _auditSnap=(S.auditLog||[]).slice();
  auditLog('create','order',ord.id,ord.ordNo+' for '+ord.customer);
  // F4: was a bare save -- a failure left the order on screen until the next
  // refresh silently removed it. Now it is removed at once (and the order
  // number given back), the form stays filled in, and the jeweller retries.
  _orderCommit('__new', {snapshot:null, newIds:[ord.id], failMsg:SAVE_RETRY_MSG,
    restore:function(){ S.nextOrdId=_prevNextOrdId; S.auditLog=_auditSnap; }}, function(err){
    renderOrders();
    if(err) return;
    ordItems=[{desc:'',cat:'Other',metal:'gold',purity:'22K',orderWt:0,estWt:0,making:0,makingType:'flat',qty:1,note:''}];
    toggleOrdForm();
    toast('\u2713 '+ord.ordNo+' saved!');
  });
}

// ── RENDER ORDERS ─────────────────────────────────────────────────────────
// Order lifecycle states. Referenced in five places across
// 03-billing-numbers.js and 04-orders-detail.js but never actually
// declared — so renderOrders() cleared #ord-list and then threw a
// ReferenceError on the first order, leaving the list permanently blank
// (not even the "No orders found" empty state, which is why it looked
// like the section had vanished). showOrderDetail() and the order→sale
// conversion path died on the same missing object, which is why orders
// could not be opened or billed at all.
// Keys must match the status values the app actually writes and the
// ALL_STATUSES pipeline the timeline iterates in showOrderDetail:
// new -> progress -> ready -> delivered, plus cancelled.
var ORD_STATUS = {
  'new':       { label:'New',        icon:'\uD83D\uDCDD', cls:'ord-st-new'  },
  'progress':  { label:'In Making',  icon:'\uD83D\uDD28', cls:'ord-st-prog' },
  'ready':     { label:'Ready',      icon:'\uD83D\uDD14', cls:'ord-st-rdy'  },
  'delivered': { label:'Delivered',  icon:'\uD83D\uDCE6', cls:'ord-st-dlv'  },
  'cancelled': { label:'Cancelled',  icon:'\u2716',    cls:'ord-st-cxl'  }
};

function renderOrders(){
  if(!S.orders)S.orders=[];
  var q=(document.getElementById('ord-search')||{value:''}).value.toLowerCase();
  var filt=(document.getElementById('ord-filter')||{value:'all'}).value;
  var week=new Date();week.setDate(week.getDate()+7);
  var active=S.orders.filter(function(o){return o.status!=='delivered'&&o.status!=='cancelled';});  var tAdv=active.reduce(function(s,o){return s+ordAdvance(o);},0);
  var tBal=active.reduce(function(s,o){return s+Math.max(0,(o.quote||o.estTotal||0)-ordAdvance(o));},0);
  var urgent=active.filter(function(o){return new Date(o.delivery)<=week;});
  var metricsEl=document.getElementById('ord-metrics');
  if(metricsEl) metricsEl.innerHTML=
    '<div class="metric" style="--ma:linear-gradient(90deg,var(--info),#6ba3f5)"><div class="metric-label">Active Orders</div><div class="metric-value">'+active.length+'</div><div class="metric-sub">'+S.orders.length+' total</div></div>'+
    '<div class="metric" style="--ma:linear-gradient(90deg,var(--gold-dark),var(--gold))"><div class="metric-label">Total Advance</div><div class="metric-value" style="font-size:20px;">'+fmt(tAdv)+'</div><div class="metric-sub">collected</div></div>'+
    '<div class="metric" style="--ma:linear-gradient(90deg,var(--danger),#f08080)"><div class="metric-label">Balance Due</div><div class="metric-value" style="font-size:20px;">'+fmt(tBal)+'</div><div class="metric-sub">on delivery</div></div>'+
    '<div class="metric" style="--ma:linear-gradient(90deg,var(--warning),#f5c842)"><div class="metric-label">Due This Week</div><div class="metric-value" style="color:var(--warning)">'+urgent.length+'</div><div class="metric-sub">orders</div></div>';
  var uwEl=document.getElementById('ord-urgent-wrap');
  if(uwEl) uwEl.innerHTML=urgent.length?
    '<div style="background:linear-gradient(135deg,var(--warning-bg),var(--surface));border:0.5px solid rgba(138,78,12,.3);border-radius:var(--radius-lg);padding:1rem 1.1rem;margin-bottom:.85rem;">'+
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--warning);margin-bottom:10px;">&#9201; Due This Week ('+urgent.length+')</div>'+
      urgent.map(function(o){
        var dl=Math.ceil((new Date(o.delivery)-new Date())/86400000);
        var adv=ordAdvance(o);
        var bal=Math.max(0,(o.quote||0)-adv);
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:0.5px solid rgba(138,78,12,.15);">'+
          '<div><div style="font-weight:600;font-size:13px;">'+escHtml(o.ordNo)+' — '+escHtml(o.customer)+'</div>'+
          '<div style="font-size:11px;color:var(--text3);">'+((o.items&&o.items.length)?escHtml(o.items[0].desc)+(o.items.length>1?' +'+( o.items.length-1)+' more':''):escHtml(o.desc||''))+'</div></div>'+
          '<div style="text-align:right;">'+
            '<div style="font-size:12px;font-weight:700;color:'+(dl<0?'var(--danger)':'var(--warning)')+';">'+(dl<0?Math.abs(dl)+'d overdue':dl===0?'Today':'In '+dl+'d')+'</div>'+
            (bal>0?'<div style="font-size:11px;color:var(--danger);">Bal: '+fmt(bal)+'</div>':'')+
          '</div></div>';
      }).join('')+
    '</div>':'';
  var filtered=S.orders.filter(function(o){
    if(filt!=='all'&&o.status!==filt)return false;
    if(!q)return true;
    return (o.ordNo||'').toLowerCase().indexOf(q)>-1||
           (o.customer||'').toLowerCase().indexOf(q)>-1||
           (o.phone||'').indexOf(q)>-1;
  }).sort(function(a,b){return new Date(b.createdAt)-new Date(a.createdAt);});
  var listEl=document.getElementById('ord-list');
  if(!listEl)return;
  if(!filtered.length){listEl.innerHTML='<div class="empty"><span class="empty-icon">&#128221;</span>No orders found — naya order yahan se banao</div>';return;}
  listEl.innerHTML='';
  filtered.forEach(function(o){
    var adv=ordAdvance(o);
    var bal=Math.max(0,(o.quote||o.estTotal||0)-adv);
    var dl=Math.ceil((new Date(o.delivery)-new Date())/86400000);
    var isUrgent=dl<=7&&o.status!=='delivered'&&o.status!=='cancelled';
    var div=document.createElement('div');
    div.className='ord-card'+(isUrgent?' urgent':'');
    div.onclick=function(){showOrderDetail(o.id);};
    var priHtml=o.priority==='urgent'?'<span class="priority-urgent">URGENT</span>':o.priority==='vip'?'<span class="priority-vip">VIP</span>':'';
    var itemSummary=(o.items&&o.items.length)?o.items.slice(0,2).map(function(it){return (it.qty>1?it.qty+'&times; ':'')+escHtml(it.desc)+'<span style="color:var(--text3);font-size:10px;"> ('+escHtml(it.purity)+')</span>';}).join(' &bull; ')+(o.items.length>2?' <span style="color:var(--text3);">+'+( o.items.length-2)+' more</span>':''):escHtml(o.desc||'');
    div.innerHTML=
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">'+
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
          '<span style="font-weight:700;font-size:13px;color:var(--info);">'+o.ordNo+'</span>'+
          '<span class="ord-status '+ORD_STATUS[o.status||'new'].cls+'">'+ORD_STATUS[o.status||'new'].icon+' '+ORD_STATUS[o.status||'new'].label+'</span>'+
          priHtml+
        '</div>'+
        '<span style="font-size:11px;color:var(--text3);">'+fmtDate(o.createdAt)+'</span>'+
      '</div>'+
      '<div style="font-weight:600;font-size:14px;margin-bottom:4px;">'+escHtml(o.customer)+(o.phone?' <span style="font-size:11px;font-weight:400;color:var(--text3);">'+escHtml(o.phone)+'</span>':'')+'</div>'+
      '<div style="font-size:12px;color:var(--text2);margin-bottom:8px;">'+itemSummary+'</div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">'+
        '<div style="font-size:12px;color:var(--text3);">&#128197; '+fmtDate(o.delivery)+
          ' <span style="color:'+(dl<0?'var(--danger)':dl<=3?'var(--warning)':'var(--text3)')+';">'+(dl<0?'('+Math.abs(dl)+'d overdue)':dl===0?'(Today!)':'(in '+dl+'d)')+'</span></div>'+
        '<div style="text-align:right;">'+
          ((o.quote||o.estTotal||0)?'<div style="font-size:13px;font-weight:700;color:var(--gold-dark);">'+fmt(o.quote||o.estTotal||0)+'</div>':'')+
          (bal>0?'<div style="font-size:11px;color:var(--danger);">Bal: '+fmt(bal)+'</div>':'<div style="font-size:11px;color:var(--success);">&#10003; Fully paid</div>')+
        '</div>'+
      '</div>';
    listEl.appendChild(div);
  });
}

// ── SHOW ORDER DETAIL ─────────────────────────────────────────────────────
