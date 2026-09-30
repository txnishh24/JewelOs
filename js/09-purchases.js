// ══════════════════════════════════════════════════════════════════════
// PURCHASE BILL HISTORY MODULE
// Records what the shop buys FROM suppliers (raw gold/silver, finished
// pieces). Can optionally push received items straight into sellable
// stock, and rolls up a per-supplier ledger. Independent of the
// sales/customer billing flow otherwise.
// Every optional FORM FIELD reads S.purchaseCfg — flip a flag off and
// that field/section/column simply doesn't render. Turning a flag off
// no longer deletes previously-saved data for that field; it's just
// hidden from the form/table/print until turned back on.
// ══════════════════════════════════════════════════════════════════════

var PB_PAGE_SIZE = 25;
var pbUI = { page:1, sortBy:'date', sortDir:'desc', editId:null, settingsOpen:false };

function pbToggleSettings(){
  pbUI.settingsOpen = !pbUI.settingsOpen;
  var body = document.getElementById('pb-settings-body');
  var arrow = document.getElementById('pb-settings-arrow');
  if(body) body.style.display = pbUI.settingsOpen ? 'flex' : 'none';
  if(arrow) arrow.textContent = pbUI.settingsOpen ? '\u25b2 hide' : '\u25bc show';
}

// ── SUB-TAB SWITCH (Inventory ⇄ Purchases) ──────────────────────────────
function switchInvSub(which){
  // Purchases plan gate removed — every shop has purchase bills.
  var stockEl = document.getElementById('inv-sub-stock');
  var purchEl = document.getElementById('inv-sub-purchases');
  var tabStock = document.getElementById('invsub-tab-stock');
  var tabPurch = document.getElementById('invsub-tab-purchases');
  if(stockEl) stockEl.style.display = which === 'stock' ? '' : 'none';
  if(purchEl) purchEl.style.display = which === 'purchases' ? '' : 'none';
  if(tabStock) tabStock.classList.toggle('active', which === 'stock');
  if(tabPurch) tabPurch.classList.toggle('active', which === 'purchases');
  if(which === 'purchases') renderPurchases();
}

// ── HELPERS ──────────────────────────────────────────────────────────────
function pbCfg(){ return S.purchaseCfg || {}; }

// Foundation audit §7: this used to begin with `if(!pbCfg().timeline)
// return;` — and timeline defaults to FALSE in 00-config-state.js, so
// for every shop that never found and enabled the optional "activity
// timeline" feature, purchase bills had NO edit history at all. An
// audit trail that's off by default isn't an audit trail. The toggle
// was conflating two different things: whether to SHOW the timeline in
// the bill detail view (a display preference, still honoured at the
// render site) and whether to RECORD financially significant events
// (not optional). Recording is now unconditional.
function pbLogEvent(bill, type, detail){
  bill.timeline = bill.timeline || [];
  bill.timeline.push({
    type:type,
    at:new Date().toISOString(),
    by:(SAAS.user&&SAAS.user.name)||'Owner',
    detail: detail || ''
  });
}

function pbRecalc(bill){
  bill.totalAmount = parseFloat(bill.totalAmount) || 0;
  bill.amountPaid  = parseFloat(bill.amountPaid)  || 0;
  // Foundation audit §5: amountPaid is what was recorded as paid AT
  // BILL ENTRY. Payments made to the supplier afterward now go into an
  // append-only ledger (bill.supplierPayments) instead of being typed
  // over the top of amountPaid, so "which payments, when, by what mode,
  // by whom" is answerable — same shape as sale.extraPayments[], with
  // reversals as their own entries rather than edits/deletions.
  var laterPaid = (bill.supplierPayments||[]).reduce(function(s,p){
    return s + (p.type==='reversal' ? -p.amount : p.amount);
  }, 0);
  var totalPaid = Math.round((bill.amountPaid + laterPaid) * 100) / 100;
  bill.totalPaid = totalPaid;
  // FIX: partial-payment/balance tracking is now always active — it used
  // to be silently forced to "fully paid" whenever the separate "Supplier
  // Credit Tracking" toggle (which is really about credit-terms due
  // dates, a different feature) was off, which is the default. That made
  // Amount Paid uneditable and any intentional outstanding balance get
  // wiped to zero for every shop that hadn't found and enabled that
  // toggle. See also pbOpenForm/pbClearForm/pbRecalcForm/pbSaveBill below.
  bill.pendingAmount = Math.max(0, Math.round((bill.totalAmount - totalPaid) * 100) / 100);
  // Foundation audit §3: overpayment used to vanish silently — pending
  // floors at 0, so paying a supplier more than the bill total just
  // showed "Paid" with the excess unrecorded anywhere. Now surfaced.
  bill.overpaidAmount = Math.max(0, Math.round((totalPaid - bill.totalAmount) * 100) / 100);
  bill.paymentStatus = bill.overpaidAmount > 0 ? 'Overpaid'
    : (bill.pendingAmount <= 0 ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Unpaid'));
}

function pbGoldRateFor(purity){
  var r = S.rates || {};
  var map = { '24K':r.g24, '22K':r.g22, '18K':r.g18, '14K':r.g14, 'Silver':r.sil };
  return map[purity] || 0;
}

// ── MAIN RENDER ──────────────────────────────────────────────────────────
function renderPurchases(){
  var root = document.getElementById('inv-sub-purchases');
  if(!root) return;
  var cfg = pbCfg();
  var html = '';

  // Settings strip — collapsed by default. Each optional feature is
  // independently toggleable, but a first-time user shouldn't have to
  // look at 6 checkboxes before they can write their first bill.
  html += '<div class="card">'+
    '<div class="card-title" style="cursor:pointer;" onclick="pbToggleSettings()">\u2699\ufe0f Customize which fields show <span id="pb-settings-arrow" style="font-size:11px;color:var(--text3);margin-left:6px;">'+(pbUI.settingsOpen?'\u25b2 hide':'\u25bc show')+'</span></div>'+
    '<div id="pb-settings-body" style="display:'+(pbUI.settingsOpen?'flex':'none')+';flex-wrap:wrap;gap:14px 20px;padding:4px 0;">'+
      pbToggle('gst','GST (CGST/SGST/IGST)')+
      pbToggle('goldRate','Gold Rate Snapshot')+
      pbToggle('stone','Stone / Diamond Details')+
      pbToggle('hallmark','Hallmark Charges')+
      pbToggle('credit','Supplier Credit Tracking')+
      pbToggle('timeline','Activity Timeline')+
    '</div></div>';

  // Add button + form
  html += '<div class="card">'+
    '<div class="card-title"><span>'+(pbUI.editId?'Edit Purchase Bill':'Purchase Bills')+'</span>'+
    '<button class="btn btn-dark" onclick="pbToggleForm()" id="pb-add-btn">+ Add Purchase Bill</button></div>'+
    '<div id="pb-form" style="display:none;">'+pbFormHtml()+'</div>'+
    '</div>';

  // Supplier ledger — aggregate outstanding per supplier, the thing an
  // owner actually needs before placing the next order
  html += pbSupplierLedgerHtml();

  // Wastage report removed on request — wastage is to be entered
  // manually per bill at purchase time rather than derived after the
  // fact from gross vs net weight. pbWastageReportHtml/pbWastagePct are
  // left defined but uncalled, so the manual-entry work can reuse the
  // percentage helper without rewriting it.

  // List: search/filter/sort/pagination/export
  html += '<div class="card">'+
    '<div class="card-title" id="pb-title">Purchase History</div>'+
    '<div class="search-row">'+
      '<input id="pb-search" placeholder="Search bill no, supplier or invoice no..." oninput="renderPurchaseList()"/>'+
      '<select id="pb-status-filter" onchange="renderPurchaseList()" style="width:auto;padding:9px 28px 9px 10px;font-size:13px;">'+
        '<option value="all">All Status</option><option value="Paid">Paid</option><option value="Partial">Partial</option><option value="Unpaid">Unpaid</option>'+
      '</select>'+
    '</div>'+
    '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;">'+
      '<input type="date" id="pb-date-from" onchange="renderPurchaseList()" style="width:auto;font-size:12px;padding:7px 8px;"/>'+
      '<input type="date" id="pb-date-to" onchange="renderPurchaseList()" style="width:auto;font-size:12px;padding:7px 8px;"/>'+
      '<select id="pb-type-filter" onchange="renderPurchaseList()" style="width:auto;font-size:12px;padding:7px 8px;">'+
        '<option value="all">All Types</option><option value="Gold">Gold</option><option value="Silver">Silver</option><option value="Other">Other</option>'+
      '</select>'+
      '<button class="btn btn-sm" onclick="pbPrintList()">\ud83d\udda8\ufe0f Print</button>'+
      '<button class="btn btn-sm" onclick="pbExportCsv()">\ud83d\udcc4 Excel/CSV Export</button>'+
    '</div>'+
    '<div class="tbl-wrap"><table id="pb-table">'+
      '<thead><tr>'+
        pbTh('billNo','Bill #')+pbTh('date','Date')+pbTh('supplier','Supplier')+
        '<th>Invoice #</th><th>Type</th>'+pbTh('grossWt','Gross Wt')+pbTh('wastagePct','Wastage')+pbTh('totalAmount','Total')+
        '<th>Paid</th><th>Pending</th><th>Status</th><th>Actions</th>'+
      '</tr></thead>'+
      '<tbody id="pb-body"></tbody>'+
    '</table>'+
    '<div id="pb-pagination" style="padding:6px 0;"></div></div>'+
    '<div id="pb-footer" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:13px;color:var(--text2);"></div>'+
    '</div>';

  root.innerHTML = html;
  renderPurchaseList();
}

function pbSupplierLedgerHtml(){
  var byS = {};
  (S.purchases||[]).forEach(function(b){
    var k = (b.supplier||'Unknown').trim();
    if(!byS[k]) byS[k] = { name:k, bills:0, total:0, paid:0, pending:0 };
    // totalPaid includes post-entry supplier payments (Foundation audit
    // §5); falls back to amountPaid for bills saved before that existed.
    var paid = (typeof b.totalPaid==='number') ? b.totalPaid : (b.amountPaid||0);
    byS[k].bills++; byS[k].total += b.totalAmount||0; byS[k].paid += paid; byS[k].pending += b.pendingAmount||0;
  });
  var rows = Object.values(byS).sort(function(a,b){ return b.pending - a.pending; });
  if(!rows.length) return '';
  var body = rows.map(function(r){
    return '<tr>'+
      '<td>'+escHtml(r.name)+'</td>'+
      '<td>'+r.bills+'</td>'+
      '<td>'+fmt(r.total)+'</td>'+
      '<td>'+fmt(r.paid)+'</td>'+
      '<td style="'+(r.pending>0?'color:var(--danger,#c0392b);font-weight:700;':'')+'">'+fmt(r.pending)+'</td>'+
    '</tr>';
  }).join('');
  return '<div class="card">'+
    '<div class="card-title">Supplier Ledger <span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:6px;">What you owe each supplier, across all their bills</span></div>'+
    '<div class="tbl-wrap"><table><thead><tr><th>Supplier</th><th>Bills</th><th>Total</th><th>Paid</th><th>Outstanding</th></tr></thead>'+
    '<tbody>'+body+'</tbody></table></div></div>';
}

// ── WASTAGE REPORT ───────────────────────────────────────────────────
// Wastage % is derived from fields that already exist on every bill/sale
// (gross weight vs net weight) — nothing new to fill in, so this works
// retroactively on data already in the system.
//   wastage% = (grossWt - netWt) / netWt * 100
function pbWastagePct(grossWt, netWt){
  grossWt = parseFloat(grossWt)||0; netWt = parseFloat(netWt)||0;
  if(netWt <= 0 || grossWt < netWt) return null; // no usable net-weight data
  return (grossWt - netWt) / netWt * 100;
}

function pbWastageReportHtml(){
  // Supplier side — from purchase bills
  var supplierRows = [];
  var bySupplier = {};
  (S.purchases||[]).forEach(function(b){
    var w = pbWastagePct(b.grossWt, b.netWt);
    if(w===null) return;
    supplierRows.push(w);
    var k=(b.supplier||'Unknown').trim();
    if(!bySupplier[k]) bySupplier[k]={name:k,sum:0,n:0};
    bySupplier[k].sum+=w; bySupplier[k].n++;
  });
  // Customer side — from sale items
  var customerRows = [];
  (S.sales||[]).forEach(function(s){
    (s.items||[]).forEach(function(it){
      var w = pbWastagePct(it.grossWt, it.netWt);
      if(w!==null) customerRows.push(w);
    });
  });

  if(!supplierRows.length && !customerRows.length) return '';

  var avgSupplier = supplierRows.length ? supplierRows.reduce(function(a,b){return a+b;},0)/supplierRows.length : null;
  var avgCustomer = customerRows.length ? customerRows.reduce(function(a,b){return a+b;},0)/customerRows.length : null;
  var diff = (avgSupplier!==null && avgCustomer!==null) ? (avgCustomer-avgSupplier) : null;

  // Profit-from-wastage is an ESTIMATE, not tied to specific bills (there's
  // no line-level link between what was bought and what was sold from it),
  // so it's labelled clearly rather than presented as an exact figure.
  var totalNetSold = (S.sales||[]).reduce(function(sum,s){
    return sum+(s.items||[]).reduce(function(a,it){return a+(parseFloat(it.netWt)||parseFloat(it.weight)||0)*(it.qty||1);},0);
  },0);
  var refRate = S.rates.g22||0;
  var estProfit = (diff!==null) ? (diff/100)*totalNetSold*refRate : null;

  var topSuppliers = Object.values(bySupplier).map(function(r){return {name:r.name, avg:r.sum/r.n};})
    .sort(function(a,b){return a.avg-b.avg;}).slice(0,5);

  var top = '<div class="tbl-wrap"><table><thead><tr><th>Supplier</th><th>Avg Wastage %</th></tr></thead><tbody>'+
    topSuppliers.map(function(r){return '<tr><td>'+escHtml(r.name)+'</td><td>'+r.avg.toFixed(2)+'%</td></tr>';}).join('')+
    '</tbody></table></div>';

  return '<div class="card">'+
    '<div class="card-title">\u2696\ufe0f Wastage Report <span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:6px;">from gross vs net weight on bills already entered</span></div>'+
    '<div class="fin-snapshot" style="margin-bottom:10px;">'+
      fsnCard('Avg Supplier Wastage', avgSupplier!==null?avgSupplier.toFixed(2)+'%':'—', supplierRows.length+' bill(s)', null, '', 'var(--gold-dark)')+
      fsnCard('Avg Selling Wastage', avgCustomer!==null?avgCustomer.toFixed(2)+'%':'—', customerRows.length+' item(s)', null, '', '#22c55e')+
      fsnCard('Difference', diff!==null?(diff>=0?'+':'')+diff.toFixed(2)+'%':'—', '', null, '', diff!==null&&diff<0?'#ef4444':'#22c55e')+
      fsnCard('Est. Profit from Wastage', estProfit!==null?fmt(Math.round(estProfit)):'—', 'rough estimate, not bill-linked', null, '', '#f59e0b')+
    '</div>'+
    (topSuppliers.length?'<div style="font-size:12px;font-weight:700;color:var(--text3);margin-bottom:6px;">Top suppliers by lowest wastage</div>'+top:'')+
    '</div>';
}

function pbToggle(key, label){
  var checked = pbCfg()[key] ? 'checked' : '';
  return '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;">'+
    '<input type="checkbox" '+checked+' style="width:16px;height:16px;flex:0 0 auto;accent-color:var(--gold);" onchange="pbSetCfg(\''+key+'\',this.checked)"/> '+label+'</label>';
}

function pbSetCfg(key, val){
  S.purchaseCfg = S.purchaseCfg || {};
  S.purchaseCfg[key] = val;
  // Re-derive amounts across all bills if credit toggle changed
  (S.purchases||[]).forEach(pbRecalc);
  saveToCloud();
  renderPurchases();
}

function pbTh(field, label){
  var arrow = pbUI.sortBy === field ? (pbUI.sortDir === 'asc' ? ' \u25b2' : ' \u25bc') : '';
  return '<th style="cursor:pointer;" onclick="pbSort(\''+field+'\')">'+label+arrow+'</th>';
}
function pbSort(field){
  if(pbUI.sortBy === field) pbUI.sortDir = pbUI.sortDir === 'asc' ? 'desc' : 'asc';
  else { pbUI.sortBy = field; pbUI.sortDir = 'asc'; }
  renderPurchaseList();
}

// ── FORM ──────────────────────────────────────────────────────────────
function pbFormHtml(){
  var cfg = pbCfg();
  var h = '<div class="form-grid">'+
    '<div class="fg"><label>Purchase Date</label><input type="date" id="pb-f-date"/></div>'+
    '<div class="fg"><label>Supplier Name</label><input id="pb-f-supplier" list="pb-supplier-list" placeholder="e.g. Malabar Bullion"/><datalist id="pb-supplier-list"></datalist></div>'+
    '<div class="fg"><label>Supplier Invoice #</label><input id="pb-f-invno" placeholder="Their bill number"/></div>'+
    '<div class="fg"><label>Purchase Type</label><select id="pb-f-type"><option>Gold</option><option>Silver</option><option>Other</option></select></div>'+
    '<div class="fg"><label>Purity</label><select id="pb-f-purity"><option>24K</option><option>22K</option><option>18K</option><option>14K</option><option>Silver</option><option>N/A</option></select></div>'+
    '<div class="fg"><label>Gross Weight (g)</label><input type="number" step="0.01" id="pb-f-grosswt" placeholder="0.00" oninput="pbAutoFillRate()"/></div>'+
    '<div class="fg"><label>Net Weight (g)</label><input type="number" step="0.01" id="pb-f-netwt" placeholder="0.00" oninput="pbRecalcForm()"/></div>'+
    // Entered per bill, as agreed with the supplier — not derived after the
    // fact from gross vs net. pbRecalcForm() still uses pbWastagePct() to
    // show what the weights imply, purely as a cross-check alongside it.
    '<div class="fg"><label>Wastage % <span style="font-size:10px;color:var(--text3)">(as agreed with supplier)</span></label><input type="number" step="0.01" min="0" id="pb-f-wastage" placeholder="0.00" oninput="pbRecalcForm()"/></div>';

  if(cfg.goldRate){
    h += '<div class="fg"><label>Gold Rate Snapshot \u20b9/g <span style="font-size:10px;color:var(--text3)">(rate on this date)</span></label><input type="number" id="pb-f-rate" placeholder="0"/></div>';
  }
  h += '<div class="fg"><label>Total Amount \u20b9</label><input type="number" id="pb-f-total" placeholder="0" oninput="pbRecalcForm()"/></div>'+
    '<div class="fg"><label>Amount Paid \u20b9</label><input type="number" id="pb-f-paid" placeholder="0" oninput="pbRecalcForm()"/></div>'+
    '<div class="fg"><label>Payment Method</label><select id="pb-f-paymethod"><option>Cash</option><option>Bank Transfer</option><option>UPI</option><option>Cheque</option><option>Credit</option></select></div>'+
    '<div class="fg"><label>Employee</label><input id="pb-f-employee" placeholder="Who recorded this"/></div>';

  if(cfg.gst){
    h += '<div class="fg"><label>CGST %</label><input type="number" step="0.01" id="pb-f-cgst" placeholder="1.5" oninput="pbRecalcForm()"/></div>'+
      '<div class="fg"><label>SGST %</label><input type="number" step="0.01" id="pb-f-sgst" placeholder="1.5" oninput="pbRecalcForm()"/></div>'+
      '<div class="fg"><label>IGST %</label><input type="number" step="0.01" id="pb-f-igst" placeholder="0" oninput="pbRecalcForm()"/></div>';
  }
  if(cfg.stone){
    h += '<div class="fg"><label>Stone Weight (ct)</label><input type="number" step="0.01" id="pb-f-stonewt" placeholder="0"/></div>'+
      '<div class="fg"><label>Stone Amount \u20b9</label><input type="number" id="pb-f-stoneamt" placeholder="0" oninput="pbRecalcForm()"/></div>'+
      '<div class="fg"><label>Diamond Details</label><input id="pb-f-diamond" placeholder="carat/clarity/certificate"/></div>';
  }
  if(cfg.hallmark){
    h += '<div class="fg"><label>Hallmark Charges \u20b9</label><input type="number" id="pb-f-hallmark" placeholder="0" oninput="pbRecalcForm()"/></div>';
  }
  if(cfg.credit){
    h += '<div class="fg"><label>Credit Due Date</label><input type="date" id="pb-f-duedate"/></div>';
  }
  h += '<div class="fg"><label>Notes</label><input id="pb-f-notes" placeholder="Optional"/></div>'+
    '</div>'+
    '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2);cursor:pointer;margin-top:12px;">'+
      '<input type="checkbox" id="pb-f-addstock" checked onchange="pbToggleItemMode()" style="width:16px;height:16px;flex:0 0 auto;accent-color:var(--gold);"'+(pbUI.editId?' disabled':'')+'/> '+
      'Add this as sellable stock'+
      (pbUI.editId?' <span style="font-size:11px;color:var(--text3)">— tracking mode is locked once a bill is saved; only weights/purity re-sync on edit</span>':'')+
    '</label>'+
    // Individual vs bulk tracking mode — new bills only; editing keeps
    // whatever mode the bill was originally created with (see PB_ITEM_MODE
    // below and pbCreateStockFromBill/pbCreateIndividualStockFromBill).
    (!pbUI.editId ?
      '<div id="pb-item-mode-wrap" style="margin-top:8px;display:flex;gap:14px;font-size:12px;color:var(--text2);">'+
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="radio" name="pb-item-mode" value="individual" checked onchange="pbToggleItemMode()"/> Individual pieces <span style="color:var(--text3);">(each with its own SKU — recommended)</span></label>'+
        '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;"><input type="radio" name="pb-item-mode" value="bulk" onchange="pbToggleItemMode()"/> Bulk / quantity item <span style="color:var(--text3);">(e.g. raw gold, bullion)</span></label>'+
      '</div>'
    : '')+
    // Individual-mode item entry list
    '<div id="pb-items-section" style="margin-top:10px;display:none;">'+
      '<div id="pb-items-list"></div>'+
      '<button type="button" onclick="pbAddItem()" style="padding:7px 14px;border-radius:9px;border:1px dashed var(--gold-dark);background:rgba(201,168,76,.06);color:var(--gold-dark);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">+ Add Item</button>'+
    '</div>'+
    // Bulk-mode: the original single "Total Items" field
    '<div id="pb-bulk-items-wrap" class="fg" style="margin-top:10px;display:none;"><label>Total Items (identical pieces)</label><input type="number" id="pb-f-items" placeholder="0"/></div>'+
    '<div id="pb-stock-note" style="display:none;margin-top:6px;font-size:12px;color:var(--success);">\u2713 Stock item(s) created from this bill</div>'+
    '<div id="pb-computed" style="margin-top:10px;padding:8px 10px;background:var(--bg2);border-radius:8px;font-size:13px;"></div>'+
    '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn btn-gold" onclick="savePurchase()">\u2601 Save &amp; Sync</button>'+
      '<button class="btn" onclick="pbToggleForm()">Cancel</button>'+
    '</div>';
  return h;
}

function pbToggleForm(id){
  var f = document.getElementById('pb-form');
  var open = f.style.display === 'none';
  if(open){
    f.innerHTML = pbFormHtml();
    pbUI.editId = id || null;
    pbFillSupplierList();
    if(id){
      var b = (S.purchases||[]).find(function(x){ return x.id === id; });
      if(b) pbFillForm(b);
    } else {
      pbClearForm();
      // P0-2 hardening: pre-fetch an atomic purchase bill number the
      // moment the blank form opens (same pattern initSaleDate() uses
      // for invoice numbers) so savePurchase() can use a
      // server-issued, concurrency-safe number instead of the local
      // S.nextPurchaseBillNo++ fallback whenever the network/proxy is
      // reachable.
      pbUI.pendingBillNo = null;
      getNextCounter('purchase_no', function(err, val){
        if(typeof val === 'number') pbUI.pendingBillNo = val;
      });
    }
  }
  f.style.display = open ? '' : 'none';
  document.getElementById('pb-add-btn').textContent = open ? 'Cancel' : '+ Add Purchase Bill';
  if(open){ pbRecalcForm(); pbToggleItemMode(); f.scrollIntoView({behavior:'smooth',block:'start'}); }
}

// PB_ITEMS holds the individual-piece rows for the currently open form.
// Rearchitected Aug 2026: a purchase bill used to always create exactly
// ONE bulk product (qty = totalItems, one shared SKU, averaged per-unit
// weight) — this now defaults to individual, uniquely-SKU'd items (see
// pbCreateIndividualStockFromBill), matching how jewellery pieces are
// actually tracked. "Bulk / quantity item" is kept as an explicit opt-in
// for cases where it's genuinely correct (raw gold, bullion, scrap) —
// existing bills created before this change keep their original bulk
// product untouched; itemTrackingMode is locked at creation and never
// silently migrated.
var PB_ITEMS = [];

function pbToggleItemMode(){
  var addStockEl = document.getElementById('pb-f-addstock');
  var showStock = addStockEl && addStockEl.checked;
  var modeWrap = document.getElementById('pb-item-mode-wrap');
  var itemsSection = document.getElementById('pb-items-section');
  var bulkWrap = document.getElementById('pb-bulk-items-wrap');
  if(!itemsSection || !bulkWrap) return; // form not open / not this view

  if(!showStock){
    if(modeWrap) modeWrap.style.display = 'none';
    itemsSection.style.display = 'none';
    bulkWrap.style.display = 'none';
    return;
  }
  if(modeWrap) modeWrap.style.display = '';

  var modeRadios = document.getElementsByName('pb-item-mode');
  var mode = pbUI.editId ? (pbUI._lockedItemMode||'individual') : 'individual';
  for(var i=0;i<modeRadios.length;i++){ if(modeRadios[i].checked) mode = modeRadios[i].value; }

  if(mode==='individual'){
    itemsSection.style.display = '';
    bulkWrap.style.display = 'none';
    if(!PB_ITEMS.length) pbAddItem();
    else pbRenderItems();
  } else {
    itemsSection.style.display = 'none';
    bulkWrap.style.display = '';
  }
}

function pbRenderItems(){
  var wrap = document.getElementById('pb-items-list');
  if(!wrap) return;
  if(!PB_ITEMS.length) PB_ITEMS=[{desc:'',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1}];
  wrap.innerHTML='';
  PB_ITEMS.forEach(function(item,i){ wrap.appendChild(pbItemCard(i,item)); });
}

function pbAddItem(){
  PB_ITEMS.push({desc:'',metal:'gold',purity:'22K',grossWt:0,netWt:0,qty:1});
  pbRenderItems();
}

function pbRemoveItem(i){
  if(PB_ITEMS.length<=1){ toast('At least one item required'); return; }
  PB_ITEMS.splice(i,1);
  pbRenderItems();
}

function pbItemCard(i,item){
  var GPURITY=['24K','22K','18K','14K','Gold Plated'];
  var SPURITY=['999 Pure','925 Sterling','800','Silver Plated'];

  var card=document.createElement('div');
  card.style.cssText='background:var(--card2);border:1.5px solid rgba(201,168,76,.25);border-radius:12px;padding:12px 13px;margin-bottom:10px;';

  var hdr=document.createElement('div');
  hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
  hdr.innerHTML='<div style="font-size:10px;font-weight:700;color:var(--gold-dark);text-transform:uppercase;letter-spacing:.06em;">Item '+(i+1)+'</div>';
  if(PB_ITEMS.length>1){
    var rb=document.createElement('button');
    rb.type='button';
    rb.style.cssText='padding:3px 10px;border-radius:8px;border:none;background:rgba(168,49,42,.1);color:var(--danger);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;';
    rb.textContent='Remove';
    (function(idx){rb.onclick=function(){pbRemoveItem(idx);};})(i);
    hdr.appendChild(rb);
  }
  card.appendChild(hdr);

  var grid=document.createElement('div');
  grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;';

  function fld(lbl,html){var d=document.createElement('div');d.className='fg';d.innerHTML='<label>'+lbl+'</label>'+html;return d;}

  var descFld=fld('Item / SKU description','<input id="pbi-desc-'+i+'" placeholder="e.g. Gold Ring, Bangle" value="'+escHtml(item.desc||'')+'"/>');
  (function(idx){descFld.querySelector('input').oninput=function(){PB_ITEMS[idx].desc=this.value;};})(i);
  grid.appendChild(descFld);

  var metalSel=fld('Metal','<select id="pbi-metal-'+i+'"><option value="gold"'+(item.metal==='gold'?' selected':'')+'>Gold</option><option value="silver"'+(item.metal==='silver'?' selected':'')+'>Silver</option></select>');
  (function(idx){metalSel.querySelector('select').onchange=function(){PB_ITEMS[idx].metal=this.value;PB_ITEMS[idx].purity=this.value==='gold'?'22K':'925 Sterling';pbRenderItems();};})(i);
  grid.appendChild(metalSel);

  var purOpts=(item.metal==='silver'?SPURITY:GPURITY).map(function(p){return '<option value="'+p+'"'+(p===item.purity?' selected':'')+'>'+p+'</option>';}).join('');
  var purSel=fld('Purity','<select id="pbi-purity-'+i+'">'+purOpts+'</select>');
  (function(idx){purSel.querySelector('select').onchange=function(){PB_ITEMS[idx].purity=this.value;};})(i);
  grid.appendChild(purSel);

  var qtyFld=fld('Quantity <span style="font-weight:400;color:var(--text3);">(identical pieces)</span>','<input id="pbi-qty-'+i+'" type="number" min="1" value="'+(item.qty||1)+'"/>');
  (function(idx){qtyFld.querySelector('input').oninput=function(){PB_ITEMS[idx].qty=Math.max(1,parseInt(this.value,10)||1);};})(i);
  grid.appendChild(qtyFld);

  var gwFld=fld('Gross Wt / piece (g)','<input id="pbi-gw-'+i+'" type="text" inputmode="decimal" placeholder="0.000" value="'+(item.grossWt>0?item.grossWt:'')+'" oninput="pbRecalcForm()"/>');
  (function(idx){gwFld.querySelector('input').addEventListener('input',function(){PB_ITEMS[idx].grossWt=parseFloat(this.value)||0;});})(i);
  grid.appendChild(gwFld);

  var nwFld=fld('Net Wt / piece (g)','<input id="pbi-nw-'+i+'" type="text" inputmode="decimal" placeholder="0.000" value="'+(item.netWt>0?item.netWt:'')+'"/>');
  (function(idx){nwFld.querySelector('input').oninput=function(){PB_ITEMS[idx].netWt=parseFloat(this.value)||0;};})(i);
  grid.appendChild(nwFld);

  card.appendChild(grid);
  return card;
}

function pbFillSupplierList(){
  var dl = document.getElementById('pb-supplier-list');
  if(!dl) return;
  dl.innerHTML = (S.suppliers||[]).map(function(s){ return '<option value="'+escHtml(s.name)+'">'; }).join('');
}

function pbClearForm(){
  document.getElementById('pb-f-date').value = dbDayKey(new Date());
  ['pb-f-supplier','pb-f-invno','pb-f-items','pb-f-grosswt','pb-f-netwt','pb-f-total','pb-f-paid',
   'pb-f-employee','pb-f-notes','pb-f-cgst','pb-f-sgst','pb-f-igst','pb-f-stonewt','pb-f-stoneamt',
   'pb-f-diamond','pb-f-hallmark','pb-f-duedate','pb-f-rate','pb-f-wastage'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value = '';
  });
  // Amount Paid is already blanked by the loop above along with every
  // other field; pbRecalcForm()'s preview-only "assume fully paid" default
  // takes over once a Total is typed, without writing into this field.
  var stockNote = document.getElementById('pb-stock-note'); if(stockNote) stockNote.style.display = 'none';
  PB_ITEMS = [];
  pbUI._lockedItemMode = 'individual';
  // Smart defaults: reuse supplier + payment method from the last bill —
  // most entry sessions are a stack of bills from the same supplier.
  // Supplier text is pre-selected so typing a different name overwrites
  // it instantly instead of requiring a manual clear.
  var last = (S.purchases||[]).slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); })[0];
  var pm = document.getElementById('pb-f-paymethod');
  if(pm && last && last.paymentMethod) pm.value = last.paymentMethod;
  var supplierEl = document.getElementById('pb-f-supplier');
  if(supplierEl && last && last.supplier){
    supplierEl.value = last.supplier;
    supplierEl.focus();
    supplierEl.select();
  } else if(supplierEl){
    supplierEl.focus();
  }
}

function pbFillForm(b){
  document.getElementById('pb-f-date').value = b.date || '';
  document.getElementById('pb-f-supplier').value = b.supplier || '';
  document.getElementById('pb-f-invno').value = b.supplierInvoiceNo || '';
  document.getElementById('pb-f-type').value = b.purchaseType || 'Gold';
  document.getElementById('pb-f-items').value = b.totalItems || '';
  document.getElementById('pb-f-purity').value = b.purity || '22K';
  document.getElementById('pb-f-grosswt').value = b.grossWt || '';
  document.getElementById('pb-f-netwt').value = b.netWt || '';
  var wFill = document.getElementById('pb-f-wastage');
  if(wFill) wFill.value = (b.wastagePct === null || b.wastagePct === undefined) ? '' : b.wastagePct;
  document.getElementById('pb-f-total').value = b.totalAmount || '';
  document.getElementById('pb-f-paid').value = b.amountPaid || '';
  document.getElementById('pb-f-paymethod').value = b.paymentMethod || 'Cash';
  document.getElementById('pb-f-employee').value = b.employee || '';
  document.getElementById('pb-f-notes').value = b.notes || '';
  if(pbCfg().goldRate && document.getElementById('pb-f-rate')) document.getElementById('pb-f-rate').value = b.goldRateSnapshot || '';
  if(pbCfg().gst){
    if(document.getElementById('pb-f-cgst')) document.getElementById('pb-f-cgst').value = b.cgstPct || '';
    if(document.getElementById('pb-f-sgst')) document.getElementById('pb-f-sgst').value = b.sgstPct || '';
    if(document.getElementById('pb-f-igst')) document.getElementById('pb-f-igst').value = b.igstPct || '';
  }
  if(pbCfg().stone){
    if(document.getElementById('pb-f-stonewt')) document.getElementById('pb-f-stonewt').value = b.stoneWt || '';
    if(document.getElementById('pb-f-stoneamt')) document.getElementById('pb-f-stoneamt').value = b.stoneAmount || '';
    if(document.getElementById('pb-f-diamond')) document.getElementById('pb-f-diamond').value = b.diamondDetails || '';
  }
  if(pbCfg().hallmark && document.getElementById('pb-f-hallmark')) document.getElementById('pb-f-hallmark').value = b.hallmarkCharges || '';
  if(pbCfg().credit && document.getElementById('pb-f-duedate')) document.getElementById('pb-f-duedate').value = b.dueDate || '';
  pbUI._lockedItemMode = b.itemTrackingMode || (b.stockProductId ? 'bulk' : 'individual');
  PB_ITEMS = (Array.isArray(b.items) && b.items.length) ? JSON.parse(JSON.stringify(b.items)) : [];
  var stockNote = document.getElementById('pb-stock-note');
  if(stockNote) stockNote.style.display = (b.stockProductId || (Array.isArray(b.stockProductIds)&&b.stockProductIds.length)) ? '' : 'none';
}

function pbAutoFillRate(){
  if(!pbCfg().goldRate) return;
  var purityEl = document.getElementById('pb-f-purity');
  var rateEl = document.getElementById('pb-f-rate');
  if(!purityEl || !rateEl || rateEl.value) return; // don't overwrite a manual edit
  rateEl.value = pbGoldRateFor(purityEl.value) || '';
}

function pbRecalcForm(){
  var cfg = pbCfg();
  var total = parseFloat(document.getElementById('pb-f-total').value) || 0;
  // FIX: Amount Paid is read as typed, always — never overwritten here.
  // An untouched (empty) field defaults its PREVIEW to "fully paid" as a
  // one-time convenience guess (most purchases are), but that's a display
  // default only; it never writes back into the input, so it can't stomp
  // a value the user is actively typing or has already entered.
  var paidEl = document.getElementById('pb-f-paid');
  var paidTyped = paidEl && paidEl.value.trim() !== '';
  var paid = paidTyped ? (parseFloat(paidEl.value) || 0) : total;
  // QA 30 Sep: the empty box said "0" while a blank SAVES as fully paid --
  // and the Day Book then posts the whole total as cash out. Say it plainly.
  if(paidEl) paidEl.placeholder = total > 0 ? 'Blank = fully paid (' + total + ')' : '0';
  var gstAmt = 0;
  if(cfg.gst){
    var c = parseFloat(document.getElementById('pb-f-cgst').value)||0;
    var s = parseFloat(document.getElementById('pb-f-sgst').value)||0;
    var i = parseFloat(document.getElementById('pb-f-igst').value)||0;
    gstAmt = total * (c+s+i) / 100;
  }
  var pending = Math.max(0, Math.round((total - paid)*100)/100);
  var status = pending <= 0 ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid');
  // Wastage cross-check: pbWastagePct() turns the gross/net weights already
  // on the form into the wastage they imply. It is shown next to whatever the
  // owner typed and never written into the field — the typed figure is what
  // the bill records. A gap between the two usually means a weight is wrong
  // or the supplier's agreed percentage was not what actually arrived.
  var wGross = parseFloat((document.getElementById('pb-f-grosswt')||{value:''}).value);
  var wNet   = parseFloat((document.getElementById('pb-f-netwt')||{value:''}).value);
  var implied = pbWastagePct(wGross, wNet);
  var wEl = document.getElementById('pb-f-wastage');
  var typed = (wEl && wEl.value.trim() !== '') ? parseFloat(wEl.value) : null;
  var wastageBit = '';
  if(implied !== null){
    wastageBit = ' &bull; Weights imply: <b>' + implied.toFixed(2) + '%</b>';
    if(typed !== null && isFinite(typed) && Math.abs(typed - implied) >= 0.05){
      wastageBit += ' <span style="color:var(--warning);">(entered ' + typed.toFixed(2) + '%)</span>';
    }
  }

  var out = document.getElementById('pb-computed');
  if(out){
    out.innerHTML = 'Pending: <b>'+fmt(pending)+'</b> &bull; Status: <b>'+status+'</b>'+
      (cfg.gst ? ' &bull; Est. GST included: <b>'+fmt(gstAmt)+'</b>' : '')+
      wastageBit;
  }
}

// Keeps a bill's linked stock item in sync when the bill is edited after
// stock was already created. Runs every edit (not gated by stockProductId
// like creation is) so weight/purity/cost/item-count changes propagate.
// Item count can never be reduced below what's already sold off this bill —
// it gets clamped there instead, with a toast explaining why.
function pbSyncStockFromBill(bill){
  if(!bill.stockProductId) return;
  var p = (S.products||[]).find(function(x){ return x.id === bill.stockProductId; });
  if(!p) return; // product was deleted separately — nothing to sync

  var soldQty = Math.max(0, (p._origQty||p.qty||1) - (p.qty||0));
  var requestedQty = Math.max(1, parseInt(bill.totalItems, 10) || 1);
  var newTotalQty = Math.max(requestedQty, soldQty);
  if(newTotalQty !== requestedQty){
    toast('\u26a0 Kept at '+newTotalQty+' items \u2014 '+soldQty+' already sold from this bill can\'t be reduced below.');
  }

  p._origQty = newTotalQty;
  p.qty = newTotalQty - soldQty;
  p.unitWeight = bill.grossWt > 0 ? bill.grossWt / newTotalQty : 0;
  p.unitNetWeight = bill.netWt > 0 ? bill.netWt / newTotalQty : 0;
  p.weight = Math.round(p.unitWeight * p.qty * 1000) / 1000;
  p.netWeight = Math.round(p.unitNetWeight * p.qty * 1000) / 1000;
  p.purity = bill.purity || p.purity;
  p.costRate = bill.grossWt > 0 ? Math.round((bill.totalAmount / bill.grossWt) * 100) / 100 : p.costRate;
  if(p.qty <= 0){ p.status = 'sold'; } else if(p.status === 'sold'){ p.status = 'available'; }
}

// ── SAVE / DELETE ─────────────────────────────────────────────────────
// ── Purchase transaction commit helper (Foundation audit B1, Sep 2026) ──
// Every real write here — savePurchase, deletePurchase — touches multiple
// correlated arrays together: S.purchases, S.products (auto-created/
// reconciled stock), S.suppliers, plus several counters. All of it used
// to go out via a bare saveToCloud() with NO callback at all — meaning a
// failed or conflicted save showed "✓ Purchase bill saved" / "Purchase
// bill deleted" regardless of whether anything actually reached the
// cloud, with zero rollback. This generalizes the same snapshot/lock/
// rollback pattern used for girvi and orders, sized for purchases'
// wider blast radius (several arrays at once, not one record).
var _purchaseSubmitLock = false;

function _purchaseSnapshot(){
  return {
    purchases: JSON.parse(JSON.stringify(S.purchases||[])),
    products: JSON.parse(JSON.stringify(S.products||[])),
    suppliers: JSON.parse(JSON.stringify(S.suppliers||[])),
    purchaseAuditLog: JSON.parse(JSON.stringify(S.purchaseAuditLog||[])),
    stockMovements: JSON.parse(JSON.stringify(S.stockMovements||[])),
    nextPurchaseBillNo: S.nextPurchaseBillNo,
    nextPurchaseId: S.nextPurchaseId,
    nextId: S.nextId
  };
}
function _purchaseRestore(snap){
  S.purchases = snap.purchases;
  S.products = snap.products;
  S.suppliers = snap.suppliers;
  S.purchaseAuditLog = snap.purchaseAuditLog;
  S.stockMovements = snap.stockMovements;
  S.nextPurchaseBillNo = snap.nextPurchaseBillNo;
  S.nextPurchaseId = snap.nextPurchaseId;
  S.nextId = snap.nextId;
}
// snapshot: result of _purchaseSnapshot() taken BEFORE mutating.
// onDone(err): called after commit or rollback; err is null on success.
function _purchaseCommit(snapshot, onDone){
  saveToCloud(function(err){
    _purchaseSubmitLock = false;
    if(err){
      _purchaseRestore(snapshot);
      saveCache();
      if(err.message !== 'version-conflict'){
        toast('\u26a0 Could not save \u2014 change rolled back. Check your connection and try again.');
      }
    }
    if(onDone) onDone(err);
  });
}

function savePurchase(){
  if(!subGuard('saving a purchase bill')) return;
  if(_purchaseSubmitLock){ toast('Already saving — please wait'); return; }
  var cfg = pbCfg();
  var date = document.getElementById('pb-f-date').value;
  var supplier = (document.getElementById('pb-f-supplier').value||'').trim();
  var total = parseFloat(document.getElementById('pb-f-total').value) || 0;

  if(!date){ toast('\u26a0 Purchase date is required'); return; }
  if(!supplier){ toast('\u26a0 Supplier name is required'); return; }
  if(total <= 0){ toast('\u26a0 Total amount must be greater than 0'); return; }

  var grossWtVal = parseFloat(document.getElementById('pb-f-grosswt').value);
  var netWtVal = parseFloat(document.getElementById('pb-f-netwt').value);
  var paidVal = parseFloat(document.getElementById('pb-f-paid').value);
  if(grossWtVal < 0){ toast('\u26a0 Gross weight can\'t be negative'); return; }
  if(netWtVal < 0){ toast('\u26a0 Net weight can\'t be negative'); return; }
  if(!isNaN(grossWtVal) && !isNaN(netWtVal) && netWtVal > grossWtVal){ toast('\u26a0 Net weight can\'t be more than gross weight'); return; }
  if(paidVal < 0){ toast('\u26a0 Amount paid can\'t be negative'); return; }
  var wastageEl = document.getElementById('pb-f-wastage');
  var wastageVal = wastageEl ? parseFloat(wastageEl.value) : NaN;
  if(!isNaN(wastageVal) && (wastageVal < 0 || wastageVal > 100)){ toast('\u26a0 Wastage % must be between 0 and 100'); return; }
  // This checks the AT-ENTRY amount only. Payments recorded later live
  // in bill.supplierPayments and are allowed to exceed the total (that's
  // an overpayment, surfaced by pbRecalc) — they don't come through here.
  if(!isNaN(paidVal) && paidVal > total){ toast('\u26a0 Amount paid can\'t be more than the total'); return; }
  if(cfg.gst){
    var gstVals = [
      parseFloat(document.getElementById('pb-f-cgst').value)||0,
      parseFloat(document.getElementById('pb-f-sgst').value)||0,
      parseFloat(document.getElementById('pb-f-igst').value)||0
    ];
    if(gstVals.some(function(v){ return v < 0 || v > 100; })){ toast('\u26a0 GST % must be between 0 and 100'); return; }
  }

  var bill = pbUI.editId ? (S.purchases||[]).find(function(x){ return x.id === pbUI.editId; }) : null;
  var isNew = !bill;
  // Foundation audit §7: editing an already-saved bill's financial
  // fields is a financially significant change — deletePurchase already
  // gated on isManager(), but this path had no check at all, so any
  // staff member could silently alter a completed purchase's total or
  // amount paid. Only gates when a money field ACTUALLY changed, so
  // fixing a typo in the notes or employee name stays frictionless.
  // (Standing caveat: isManager() is client-side only and bypassable
  // via devtools — this raises the bar, it is not real authorization.
  // Server-side per-staff role checks in store-proxy remain unbuilt.)
  var _financialEditFields = null;
  if(!isNew){
    var _changed = [];
    if(Math.abs((parseFloat(bill.totalAmount)||0) - total) > 0.005) _changed.push('Total '+fmt(bill.totalAmount)+'\u2192'+fmt(total));
    var _newPaid = isNaN(paidVal) ? total : paidVal;
    if(Math.abs((parseFloat(bill.amountPaid)||0) - _newPaid) > 0.005) _changed.push('Amount Paid '+fmt(bill.amountPaid)+'\u2192'+fmt(_newPaid));
    if((bill.supplier||'') !== supplier) _changed.push('Supplier '+bill.supplier+'\u2192'+supplier);
    if(_changed.length){
      if(!isManager()){ toast('\u26a0 Only owners and managers can change a saved bill\'s amounts or supplier'); return; }
      _financialEditFields = _changed;
    }
  }
  if(isNew){
    // Use the atomic counter fetched when the form opened (see
    // pbToggleForm) when it resolved in time; otherwise fall back to
    // the local sequential counter, same fallback contract every other
    // counter in the app uses when store-proxy is unreachable.
    var billNoVal = (typeof pbUI.pendingBillNo === 'number') ? pbUI.pendingBillNo : (S.nextPurchaseBillNo||1);
    bill = { id:(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2),
             billNo:'PB-'+String(billNoVal).padStart(5,'0'), timeline:[] };
    if(billNoVal >= S.nextPurchaseBillNo) S.nextPurchaseBillNo = billNoVal + 1;
    pbUI.pendingBillNo = null;
    S.nextPurchaseId = (S.nextPurchaseId||1) + 1;
  }

  bill.date = date;
  bill.supplier = supplier;
  bill.supplierInvoiceNo = document.getElementById('pb-f-invno').value.trim();
  bill.purchaseType = document.getElementById('pb-f-type').value;
  bill.totalItems = parseInt(document.getElementById('pb-f-items').value) || 0;
  bill.purity = document.getElementById('pb-f-purity').value;
  bill.grossWt = parseFloat(document.getElementById('pb-f-grosswt').value) || 0;
  bill.netWt = parseFloat(document.getElementById('pb-f-netwt').value) || 0;
  // null (not 0) when left blank, so "no wastage agreed" stays distinguishable
  // from "0% agreed" on reports and on any bill entered before this field existed.
  bill.wastagePct = (function(){
    var el = document.getElementById('pb-f-wastage');
    if(!el || el.value.trim() === '') return null;
    var v = parseFloat(el.value);
    return isFinite(v) ? v : null;
  }());
  bill.totalAmount = total;
  // FIX: matches pbRecalcForm's preview default — an untouched Amount
  // Paid field saves as "fully paid" (the common case), not as 0/unpaid,
  // so the saved bill matches what the preview just showed the user.
  var _paidFieldEl = document.getElementById('pb-f-paid');
  var _paidTyped = _paidFieldEl && _paidFieldEl.value.trim() !== '';
  bill.amountPaid = _paidTyped ? (parseFloat(_paidFieldEl.value) || 0) : total;
  bill.paymentMethod = document.getElementById('pb-f-paymethod').value;
  bill.employee = document.getElementById('pb-f-employee').value.trim();
  bill.notes = document.getElementById('pb-f-notes').value.trim();

  // Optional fields — only touched when their toggle is ON. Turning a
  // toggle off hides the field from the form but never erases data that
  // was already saved for it; it just isn't shown or re-collected.
  if(cfg.goldRate){ bill.goldRateSnapshot = parseFloat(document.getElementById('pb-f-rate').value) || 0; }
  if(cfg.gst){
    bill.cgstPct = parseFloat(document.getElementById('pb-f-cgst').value) || 0;
    bill.sgstPct = parseFloat(document.getElementById('pb-f-sgst').value) || 0;
    bill.igstPct = parseFloat(document.getElementById('pb-f-igst').value) || 0;
  }
  if(cfg.stone){
    bill.stoneWt = parseFloat(document.getElementById('pb-f-stonewt').value) || 0;
    bill.stoneAmount = parseFloat(document.getElementById('pb-f-stoneamt').value) || 0;
    bill.diamondDetails = document.getElementById('pb-f-diamond').value.trim();
  }
  if(cfg.hallmark){ bill.hallmarkCharges = parseFloat(document.getElementById('pb-f-hallmark').value) || 0; }
  if(cfg.credit){ bill.dueDate = document.getElementById('pb-f-duedate').value || ''; }

  // Duplicate supplier-invoice-number check (soft — confirm, don't block)
  var dupe = (S.purchases||[]).some(function(x){
    return x.id !== bill.id && x.supplier.toLowerCase() === supplier.toLowerCase() &&
      bill.supplierInvoiceNo && x.supplierInvoiceNo && x.supplierInvoiceNo.toLowerCase() === bill.supplierInvoiceNo.toLowerCase();
  });

  // Abnormal price check — catches fat-finger typos (e.g. an extra zero)
  // by comparing this bill's effective rate/gram against today's rate
  // for the same purity. Only fires when both numbers are meaningful.
  var abnormalRate = false, effRate = 0, refRate = 0;
  if(bill.grossWt > 0 && bill.totalAmount > 0){
    effRate = bill.totalAmount / bill.grossWt;
    refRate = pbGoldRateFor(bill.purity);
    if(refRate > 0 && (effRate > refRate * 1.5 || effRate < refRate * 0.5)) abnormalRate = true;
  }

  var warnings = [];
  if(dupe) warnings.push('Supplier invoice #'+bill.supplierInvoiceNo+' already exists for '+supplier+'.');
  if(abnormalRate) warnings.push('This works out to \u20b9'+Math.round(effRate)+'/g, but today\'s '+bill.purity+' rate is \u20b9'+Math.round(refRate)+'/g — check the total amount and weight.');

function finishSave(){
    var _snap = _purchaseSnapshot();
    _purchaseSubmitLock = true;
    pbRecalc(bill);
    // Foundation audit §7: a financial edit records WHAT changed and WHY
    // (reason captured below before this runs), not just "Edited".
    pbLogEvent(bill, isNew ? 'Created' : (_financialEditFields ? 'Financial edit' : 'Edited'),
      _financialEditFields ? (_financialEditFields.join(', ') + (bill._pendingEditReason ? ' \u2014 reason: '+bill._pendingEditReason : '')) : '');
    delete bill._pendingEditReason;
    if(isNew) S.purchases.push(bill);

    // Auto-register supplier for the datalist / supplier ledger (trimmed, case-insensitive dedupe)
    var supplierKey = supplier.toLowerCase();
    if(!(S.suppliers||[]).some(function(s){ return s.name.trim().toLowerCase() === supplierKey; })){
      S.suppliers = S.suppliers || [];
      S.suppliers.push({ name:supplier });
    }

    // Optional: push received items into sellable stock (first save only
    // decides individual-vs-bulk mode; edits always reconcile whichever
    // mode the bill already has — see pbUI._lockedItemMode).
    var addStockEl = document.getElementById('pb-f-addstock');
    var isAlreadyLinked = !!(bill.stockProductId || (Array.isArray(bill.stockProductIds) && bill.stockProductIds.length));
    if(addStockEl && addStockEl.checked && !isAlreadyLinked){
      var modeRadios = document.getElementsByName('pb-item-mode');
      var chosenMode = 'individual';
      for(var mi=0; mi<modeRadios.length; mi++){ if(modeRadios[mi].checked) chosenMode = modeRadios[mi].value; }
      if(chosenMode==='individual'){
        pbCreateIndividualStockFromBill(bill, PB_ITEMS);
      } else {
        bill.totalItems = parseInt((document.getElementById('pb-f-items')||{}).value, 10) || 1;
        bill.itemTrackingMode = 'bulk';
        pbCreateStockFromBill(bill);
      }
    } else if(isAlreadyLinked){
      // Editing a bill that already has linked stock — reconcile it instead
      // of leaving the product(s) frozen at its original values.
      if(bill.itemTrackingMode==='individual' || Array.isArray(bill.stockProductIds)){
        pbSyncIndividualStockFromBill(bill, PB_ITEMS);
      } else {
        pbSyncStockFromBill(bill);
      }
    }

    // Foundation audit B1: was a bare saveToCloud() with zero error
    // handling — the toast below fired unconditionally even if the save
    // failed. Now reverts purchases/products/suppliers together on
    // failure and only confirms success once the cloud actually has it.
    _purchaseCommit(_snap, function(err){
      if(err) return;
      pbToggleForm();
      renderPurchases();
      toast('\u2713 Purchase bill saved');
    });
  }

  // Foundation audit §7: a financially significant edit needs a stated
  // reason on the audit record. Uses an in-app modal, never window.prompt
  // (removed app-wide in Batch 2).
  function proceedAfterReason(){
    if(warnings.length){
      safeConfirm('Double-check this bill', warnings.join(' '), finishSave, false);
    } else {
      finishSave();
    }
  }

  if(_financialEditFields){
    pbAskEditReason(_financialEditFields, function(reason){
      bill._pendingEditReason = reason;
      proceedAfterReason();
    });
    return;
  }
  proceedAfterReason();
}

// In-app reason capture for financial edits to a saved purchase bill.
function pbAskEditReason(changedFields, onOk){
  var m=document.getElementById('pbreason-modal-inner');
  if(!m){
    var ov=document.createElement('div');
    ov.id='pbreason-modal';
    ov.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1250;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    ov.innerHTML='<div id="pbreason-modal-inner" style="background:var(--surface);border-radius:18px;max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.35);padding:22px;"></div>';
    document.body.appendChild(ov);
    m=document.getElementById('pbreason-modal-inner');
  }
  document.getElementById('pbreason-modal').style.display='flex';
  m.innerHTML=
    '<h3 style="margin:0 0 10px;font-size:16px;">Reason for this change</h3>'+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:12px;">You\'re changing: <b>'+escHtml(changedFields.join(', '))+'</b>. This is recorded in the bill\'s history.</div>'+
    '<input id="pbreason-input" type="text" placeholder="e.g. supplier sent corrected invoice" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;box-sizing:border-box;">'+
    '<div style="display:flex;gap:9px;margin-top:16px;">'+
      '<button class="btn btn-sm" style="flex:1;background:var(--surf2);border:1px solid var(--border2);" onclick="document.getElementById(\'pbreason-modal\').style.display=\'none\'">Cancel</button>'+
      '<button class="btn btn-sm btn-dark" style="flex:1;" id="pbreason-ok">Save Change</button>'+
    '</div>';
  document.getElementById('pbreason-ok').onclick=function(){
    var v=(document.getElementById('pbreason-input').value||'').trim();
    if(!v){ toast('Please enter a reason'); return; }
    document.getElementById('pbreason-modal').style.display='none';
    onOk(v);
  };
  setTimeout(function(){ var i=document.getElementById('pbreason-input'); if(i) i.focus(); },50);
}

// ── STOCK LINK ───────────────────────────────────────────────────────
// Purchases don't automatically become sellable stock — a lot of what
// a shop buys is bullion/scrap that gets melted down, not sold as-is.
// This only runs when the user explicitly checks "Add to sellable
// stock" on the form, and creates ONE product entry per bill (matching
// the bill's gross/net weight and purity) linked back to the bill.
function pbCreateStockFromBill(bill){
  var costPerGram = bill.grossWt > 0 ? Math.round((bill.totalAmount / bill.grossWt) * 100) / 100 : 0;
  // Quantity comes from totalItems (defaults to 1 for bulk/bullion-style
  // bills where "how many pieces" doesn't really apply). unitWeight /
  // unitNetWeight are the per-piece figures; weight / netWeight are always
  // kept as unitWeight*qty so they stay derivable, not hand-maintained.
  var qty = Math.max(1, parseInt(bill.totalItems, 10) || 1);
  var unitWeight = bill.grossWt > 0 ? bill.grossWt / qty : 0;
  var unitNetWeight = bill.netWt > 0 ? bill.netWt / qty : 0;
  var product = {
    id: (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2),
    _seq: S.nextId = (S.nextId||1) + 1,
    name: bill.purchaseType+' from '+bill.supplier,
    cat: 'Other',
    metal: bill.purchaseType === 'Silver' ? 'silver' : 'gold',
    purity: bill.purity || '22K',
    huid: '',
    sku: 'PB-'+bill.billNo.replace('PB-',''),
    weight: bill.grossWt,
    netWeight: bill.netWt,
    unitWeight: unitWeight,
    unitNetWeight: unitNetWeight,
    costRate: costPerGram,
    mcRate: 0,
    making:0, diamond:0, qty:qty, alert:1,
    _origQty: qty,
    photo:'', notes:'Auto-added from purchase bill '+bill.billNo,
    status:'available',
    createdAt: new Date().toISOString(),
    fromPurchaseId: bill.id
  };
  S.products = S.products || [];
  S.products.push(product);
  bill.stockProductId = product.id;
  logStockMovement(product.id, 'purchase', {newStatus:'available', qtyChange:qty, relatedId:bill.id, relatedRef:bill.billNo, reason:'Received from purchase bill'});
}

// ── Individual-item stock creation (rearchitected Aug 2026) ────────────
// One product per item row, each with its own unique SKU, weight, purity
// and quantity — instead of the single bulk row above. Cost is allocated
// across items proportionally by weight from the bill's overall total,
// since the purchase form doesn't (and shouldn't need to) collect a
// separate price per item.
function pbCreateIndividualStockFromBill(bill, items){
  var costPerGram = bill.grossWt > 0 ? bill.totalAmount / bill.grossWt : 0;
  bill.items = JSON.parse(JSON.stringify(items));
  bill.itemTrackingMode = 'individual';
  bill.stockProductIds = [];
  items.forEach(function(item, idx){
    var qty = Math.max(1, parseInt(item.qty,10) || 1);
    var totalGw = (item.grossWt||0) * qty;
    var totalNw = (item.netWt||0) * qty;
    var product = {
      id: (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)+idx,
      _seq: S.nextId = (S.nextId||1) + 1,
      name: (item.desc||'').trim() || (bill.purchaseType+' item'),
      cat: 'Other',
      metal: item.metal || (bill.purchaseType==='Silver'?'silver':'gold'),
      purity: item.purity || bill.purity || '22K',
      huid: '',
      sku: 'PB-'+bill.billNo.replace('PB-','')+'-'+(idx+1),
      weight: Math.round(totalGw*1000)/1000,
      netWeight: Math.round(totalNw*1000)/1000,
      unitWeight: item.grossWt||0,
      unitNetWeight: item.netWt||0,
      costRate: Math.round(costPerGram*100)/100,
      mcRate: 0,
      making:0, diamond:0, qty:qty, alert:1,
      _origQty: qty,
      photo:'', notes:'Auto-added from purchase bill '+bill.billNo+' (item '+(idx+1)+' of '+items.length+')',
      status:'available',
      createdAt: new Date().toISOString(),
      fromPurchaseId: bill.id,
      fromPurchaseItemIndex: idx
    };
    S.products = S.products || [];
    S.products.push(product);
    bill.stockProductIds.push(product.id);
    logStockMovement(product.id, 'purchase', {newStatus:'available', qtyChange:qty, relatedId:bill.id, relatedRef:bill.billNo, reason:'Received from purchase bill (item '+(idx+1)+')'});
  });
}

// Reconciles an already-synced individual-mode bill's linked products
// against its (possibly edited) item list — same idempotency/sold-
// protection guarantee as pbSyncStockFromBill, applied per item instead
// of to one shared row. Matched by fromPurchaseItemIndex, not array
// position, so reordering never mismatches a product to the wrong row.
function pbSyncIndividualStockFromBill(bill, items){
  if(!Array.isArray(bill.stockProductIds) || !bill.stockProductIds.length) return;
  items = items || bill.items || [];
  var costPerGram = bill.grossWt > 0 ? bill.totalAmount / bill.grossWt : 0;
  var anyReducedBelowSold = false;

  bill.stockProductIds.forEach(function(pid, idx){
    var p = (S.products||[]).find(function(x){ return x.id === pid; });
    if(!p) return; // product was deleted separately — nothing to sync
    var item = items[idx];
    if(!item) return; // row was removed from the form — see note below; existing product is left as-is (never silently deleted here)

    var soldQty = Math.max(0, (p._origQty||p.qty||1) - (p.qty||0));
    var requestedQty = Math.max(1, parseInt(item.qty,10) || 1);
    var newQty = Math.max(requestedQty, soldQty);
    if(newQty !== requestedQty) anyReducedBelowSold = true;

    p.name = (item.desc||'').trim() || p.name;
    p.metal = item.metal || p.metal;
    p.purity = item.purity || p.purity;
    p._origQty = newQty;
    p.qty = newQty - soldQty;
    p.unitWeight = item.grossWt||0;
    p.unitNetWeight = item.netWt||0;
    p.weight = Math.round((item.grossWt||0) * newQty * 1000) / 1000;
    p.netWeight = Math.round((item.netWt||0) * newQty * 1000) / 1000;
    p.costRate = costPerGram > 0 ? Math.round(costPerGram*100)/100 : p.costRate;
    if(p.qty <= 0){ p.status = 'sold'; } else if(p.status === 'sold'){ p.status = 'available'; }
  });

  // New rows added since the bill was first saved (items.length grew) —
  // create products for those, same as initial creation.
  if(items.length > bill.stockProductIds.length){
    var newRows = items.slice(bill.stockProductIds.length);
    var baseIdx = bill.stockProductIds.length;
    newRows.forEach(function(item, offset){
      var idx = baseIdx + offset;
      var qty = Math.max(1, parseInt(item.qty,10) || 1);
      var product = {
        id: (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)+idx,
        _seq: S.nextId = (S.nextId||1) + 1,
        name: (item.desc||'').trim() || (bill.purchaseType+' item'),
        cat: 'Other', metal: item.metal||'gold', purity: item.purity||bill.purity||'22K', huid: '',
        sku: 'PB-'+bill.billNo.replace('PB-','')+'-'+(idx+1),
        weight: Math.round((item.grossWt||0)*qty*1000)/1000, netWeight: Math.round((item.netWt||0)*qty*1000)/1000,
        unitWeight: item.grossWt||0, unitNetWeight: item.netWt||0,
        costRate: Math.round(costPerGram*100)/100, mcRate:0, making:0, diamond:0, qty:qty, alert:1, _origQty:qty,
        photo:'', notes:'Auto-added from purchase bill '+bill.billNo+' (item '+(idx+1)+' of '+items.length+')',
        status:'available', createdAt: new Date().toISOString(), fromPurchaseId: bill.id, fromPurchaseItemIndex: idx
      };
      S.products = S.products || [];
      S.products.push(product);
      bill.stockProductIds.push(product.id);
    });
  }

  bill.items = JSON.parse(JSON.stringify(items));
  if(anyReducedBelowSold) toast('\u26a0 Some item quantities were kept higher than entered \u2014 already-sold pieces can\'t be reduced below.');
}

// ── Supplier payments & bill history (Foundation audit §5, §7) ─────────
// Payments made to a supplier AFTER the bill was entered used to mean
// retyping amountPaid to a bigger number — no record of when, how much,
// by what mode, or by whom. These append to bill.supplierPayments[]
// instead (read by pbRecalc), with reversal-as-new-entry, mirroring
// sale.extraPayments[] exactly.
var _pbPaymentLock = {}; // keyed by bill id

function pbOpenPaymentModal(billId){
  var b = (S.purchases||[]).find(function(x){ return x.id===billId; });
  if(!b){ toast('Bill not found'); return; }
  pbRecalc(b);
  if(b.pendingAmount<=0){ toast('This bill has no outstanding balance'); return; }
  var mInner = document.getElementById('pbpay-modal-inner');
  if(!mInner){
    var ov=document.createElement('div');
    ov.id='pbpay-modal';
    ov.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    ov.innerHTML='<div id="pbpay-modal-inner" style="background:var(--surface);border-radius:18px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35);padding:22px;"></div>';
    document.body.appendChild(ov);
    mInner=document.getElementById('pbpay-modal-inner');
  }
  document.getElementById('pbpay-modal').style.display='flex';
  mInner.innerHTML=
    '<h3 style="margin:0 0 14px;font-size:16px;">Pay Supplier \u2014 '+escHtml(b.billNo)+'</h3>'+
    '<div style="font-size:13px;color:var(--text2);margin-bottom:14px;">'+escHtml(b.supplier)+' \u00b7 Outstanding: <b style="color:var(--danger);">'+fmt(b.pendingAmount)+'</b></div>'+
    '<div style="display:grid;gap:9px;">'+
      '<input id="pbpay-amount" type="number" step="0.01" placeholder="Amount" value="'+b.pendingAmount+'" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
      '<select id="pbpay-mode" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
        '<option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option><option>Card</option><option>Other</option>'+
      '</select>'+
      '<input id="pbpay-ref" type="text" placeholder="Reference / cheque no (optional)" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
    '</div>'+
    '<div style="display:flex;gap:9px;margin-top:16px;">'+
      '<button class="btn btn-sm" style="flex:1;background:var(--surf2);border:1px solid var(--border2);" onclick="document.getElementById(\'pbpay-modal\').style.display=\'none\'">Cancel</button>'+
      '<button class="btn btn-sm btn-success" style="flex:1;" onclick="pbSubmitPayment(\''+billId+'\')">Record Payment</button>'+
    '</div>';
}

function pbSubmitPayment(billId){
  var b = (S.purchases||[]).find(function(x){ return x.id===billId; });
  if(!b) return;
  if(_pbPaymentLock[billId]){ toast('Payment already being recorded — please wait'); return; }
  var amount=parseFloat(document.getElementById('pbpay-amount').value);
  var mode=document.getElementById('pbpay-mode').value;
  var ref=(document.getElementById('pbpay-ref').value||'').trim();
  if(!amount||amount<=0){ toast('Enter a valid amount'); return; }

  function doPay(){
    var _snap=_purchaseSnapshot();
    _pbPaymentLock[billId]=true;
    b.supplierPayments = b.supplierPayments || [];
    b.supplierPayments.push({
      id:(typeof crypto.randomUUID==='function')?crypto.randomUUID():'SPAY-'+Date.now(),
      amount:amount, mode:mode, ref:ref, date:new Date().toISOString(),
      by:(SAAS.user&&SAAS.user.name)||'Owner'
    });
    pbRecalc(b);
    pbLogEvent(b,'Payment', fmt(amount)+' via '+mode+(ref?' ('+ref+')':''));
    document.getElementById('pbpay-modal').style.display='none';
    _purchaseCommit(_snap, function(err){
      _pbPaymentLock[billId]=false;
      if(!err){ renderPurchases(); toast('\u2713 '+fmt(amount)+' paid to '+b.supplier); }
    });
  }

  if(amount > b.pendingAmount + 1){
    safeConfirm('Payment exceeds balance?','This payment ('+fmt(amount)+') is more than the outstanding balance ('+fmt(b.pendingAmount)+'). It will be recorded as an overpayment. Continue?',doPay,true);
    return;
  }
  doPay();
}

function pbReversePayment(billId, payId){
  var b=(S.purchases||[]).find(function(x){ return x.id===billId; });
  if(!b||!b.supplierPayments) return;
  var pay=b.supplierPayments.find(function(p){ return p.id===payId; });
  if(!pay||pay.type==='reversal') return;
  if(b.supplierPayments.some(function(p){ return p.reversedPayment===payId; })){ toast('Already reversed'); return; }
  if(!isManager()){ toast('\u26a0 Only owners and managers can reverse supplier payments'); return; }
  if(_pbPaymentLock[billId]){ toast('Please wait — a save is already in progress'); return; }
  safeConfirm('Reverse this payment?','Reverse '+fmt(pay.amount)+' ('+pay.mode+')? Recorded as a reversal, not deleted.',function(){
    var _snap=_purchaseSnapshot();
    _pbPaymentLock[billId]=true;
    b.supplierPayments.push({
      id:(typeof crypto.randomUUID==='function')?crypto.randomUUID():'SREV-'+Date.now(),
      type:'reversal', amount:pay.amount, mode:pay.mode, ref:'Reversal of '+payId,
      date:new Date().toISOString(), reversedPayment:payId, by:(SAAS.user&&SAAS.user.name)||'Owner'
    });
    pbRecalc(b);
    pbLogEvent(b,'Payment reversed', fmt(pay.amount));
    _purchaseCommit(_snap, function(err){
      _pbPaymentLock[billId]=false;
      if(!err){ renderPurchases(); pbOpenHistoryModal(billId); toast('\u2718 Payment reversed'); }
    });
  }, true);
}

// Foundation audit §7: the timeline was being recorded but had NO
// render site anywhere in the app — write-only, invisible data. This is
// that view: payment ledger + full edit/action history for one bill.
function pbOpenHistoryModal(billId){
  var b=(S.purchases||[]).find(function(x){ return x.id===billId; });
  if(!b){ toast('Bill not found'); return; }
  var mInner=document.getElementById('pbhist-modal-inner');
  if(!mInner){
    var ov=document.createElement('div');
    ov.id='pbhist-modal';
    ov.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    ov.innerHTML='<div id="pbhist-modal-inner" style="background:var(--surface);border-radius:18px;max-width:480px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35);padding:22px;"></div>';
    document.body.appendChild(ov);
    mInner=document.getElementById('pbhist-modal-inner');
  }
  document.getElementById('pbhist-modal').style.display='flex';
  pbRecalc(b);
  var pays=(b.supplierPayments||[]);
  var reversedIds=pays.filter(function(p){return p.reversedPayment;}).map(function(p){return p.reversedPayment;});
  mInner.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'+
      '<h3 style="margin:0;font-size:16px;">'+escHtml(b.billNo)+' \u2014 '+escHtml(b.supplier)+'</h3>'+
      '<button onclick="document.getElementById(\'pbhist-modal\').style.display=\'none\'" style="border:none;background:transparent;font-size:20px;cursor:pointer;">&times;</button>'+
    '</div>'+
    '<div style="font-size:12px;color:var(--text2);margin-bottom:14px;padding:9px 12px;background:var(--card2);border-radius:9px;">'+
      'Total '+fmt(b.totalAmount)+' \u00b7 Paid '+fmt(b.totalPaid||b.amountPaid||0)+' \u00b7 '+
      (b.overpaidAmount>0
        ? '<b style="color:#a86a00;">Overpaid '+fmt(b.overpaidAmount)+'</b>'
        : '<b style="color:'+(b.pendingAmount>0?'var(--danger)':'var(--success)')+';">'+(b.pendingAmount>0?'Outstanding '+fmt(b.pendingAmount):'Settled')+'</b>')+
    '</div>'+
    '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px;">Payments</div>'+
    (b.amountPaid>0?'<div style="font-size:12px;padding:6px 10px;background:var(--card2);border-radius:8px;margin-bottom:5px;color:var(--text2);">At bill entry \u00b7 '+fmt(b.amountPaid)+(b.paymentMethod?' \u00b7 '+escHtml(b.paymentMethod):'')+'</div>':'')+
    (pays.length===0 && !b.amountPaid ? '<div style="font-size:12px;color:var(--text3);padding:6px 0;">No payments recorded yet.</div>' : '')+
    pays.map(function(p){
      var isRev=p.type==='reversal', wasRev=reversedIds.indexOf(p.id)!==-1;
      return '<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:6px 10px;background:var(--card2);border-radius:8px;margin-bottom:5px;'+(wasRev?'opacity:.5;text-decoration:line-through;':'')+'">'+
        '<span'+(isRev?' style="color:var(--danger);"':'')+'>'+(isRev?'\u2718 Reversal':fmtDate(p.date))+' \u00b7 '+escHtml(p.mode||'')+' \u00b7 '+fmt(p.amount)+(p.ref?' \u00b7 '+escHtml(p.ref):'')+'<br><span style="color:var(--text3);font-size:11px;">by '+escHtml(p.by||'')+'</span></span>'+
        ((!isRev&&!wasRev)?'<button onclick="pbReversePayment(\''+billId+'\',\''+p.id+'\')" style="border:none;background:transparent;color:var(--danger);cursor:pointer;font-size:11px;font-family:inherit;text-decoration:underline;">Reverse</button>':'')+
      '</div>';
    }).join('')+
    '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin:14px 0 6px;">Bill History</div>'+
    ((b.timeline&&b.timeline.length)
      ? b.timeline.slice().reverse().map(function(t){
          return '<div style="font-size:12px;padding:5px 10px;border-left:2px solid var(--border2);margin-bottom:4px;">'+
            '<b>'+escHtml(t.type)+'</b>'+(t.detail?' \u00b7 '+escHtml(t.detail):'')+
            '<div style="color:var(--text3);font-size:11px;">'+fmtDate(t.at)+' '+fmtTime(t.at)+' \u00b7 '+escHtml(t.by||'')+'</div>'+
          '</div>';
        }).join('')
      : '<div style="font-size:12px;color:var(--text3);">No history recorded for this bill.</div>');
}

function deletePurchase(id){
  if(!isManager()){ toast('\u26a0 Only owners and managers can delete purchase bills'); return; }
  var bill = (S.purchases||[]).find(function(x){ return x.id === id; });
  if(!bill) return;

  // Handles both the legacy single-product bulk link and the new
  // multi-product individual-item link -- blocks deletion if ANY linked
  // product has already-sold quantity, same protection as before, now
  // checked across every item this bill created.
  var linkedIds = bill.stockProductId ? [bill.stockProductId] : (bill.stockProductIds||[]);
  var linkedProducts = linkedIds.map(function(pid){ return (S.products||[]).find(function(x){ return x.id===pid; }); }).filter(Boolean);
  var totalSold = linkedProducts.reduce(function(sum,p){ return sum + Math.max(0, (p._origQty||p.qty||1) - (p.qty||0)); }, 0);
  if(totalSold > 0){
    toast('\u26a0 Can\'t delete \u2014 '+totalSold+' item(s) from this bill are already sold. Delete blocked to protect sales history.');
    return;
  }

  safeConfirm('Delete purchase bill '+bill.billNo+'?', 'This removes it from purchase history and the supplier ledger on all devices, and removes its linked (unsold) stock item(s). This cannot be undone.', function(){
    if(_purchaseSubmitLock){ toast('Already saving — please wait'); return; }
    var _snap = _purchaseSnapshot();
    _purchaseSubmitLock = true;
    S.purchaseAuditLog = S.purchaseAuditLog || [];
    S.purchaseAuditLog.push({
      action:'Deleted', billNo:bill.billNo, supplier:bill.supplier, totalAmount:bill.totalAmount,
      by:(SAAS.user&&SAAS.user.name)||'Owner', at:new Date().toISOString()
    });
    if(linkedIds.length){
      linkedIds.forEach(function(pid){
        logStockMovement(pid, 'delete', {reason:'Purchase bill '+bill.billNo+' deleted', relatedId:bill.id, relatedRef:bill.billNo});
      });
      S.products = (S.products||[]).filter(function(x){ return linkedIds.indexOf(x.id) === -1; });
    }
    S.purchases = (S.purchases||[]).filter(function(x){ return x.id !== id; });
    // Foundation audit B1: was a bare saveToCloud() — "Purchase bill
    // deleted" fired even if the delete never reached the cloud, leaving
    // the bill and its stock products reappearing on next real sync with
    // no warning. Now reverted together on failure.
    _purchaseCommit(_snap, function(err){
      if(err) return;
      renderPurchases();
      toast('Purchase bill deleted');
    });
  }, true);
}

// ── LIST: search / filter / sort / paginate ──────────────────────────
function pbGetFiltered(){
  var q = (document.getElementById('pb-search')||{}).value || '';
  q = q.toLowerCase().trim();
  var status = (document.getElementById('pb-status-filter')||{}).value || 'all';
  var type = (document.getElementById('pb-type-filter')||{}).value || 'all';
  var from = (document.getElementById('pb-date-from')||{}).value || '';
  var to = (document.getElementById('pb-date-to')||{}).value || '';

  var list = (S.purchases||[]).filter(function(b){
    if(q){
      var hay = (b.billNo+' '+b.supplier+' '+(b.supplierInvoiceNo||'')).toLowerCase();
      if(hay.indexOf(q) === -1) return false;
    }
    if(status !== 'all' && b.paymentStatus !== status) return false;
    if(type !== 'all' && b.purchaseType !== type) return false;
    if(from && b.date < from) return false;
    if(to && b.date > to) return false;
    return true;
  });

  var field = pbUI.sortBy, dir = pbUI.sortDir === 'asc' ? 1 : -1;
  list.sort(function(a,b){
    var av = a[field], bv = b[field];
    if(typeof av === 'string') { av = (av||'').toLowerCase(); bv = (bv||'').toLowerCase(); }
    else { av = av||0; bv = bv||0; }
    if(av < bv) return -1*dir;
    if(av > bv) return 1*dir;
    return 0;
  });
  return list;
}

function renderPurchaseList(){
  var all = pbGetFiltered();
  var totalPages = Math.max(1, Math.ceil(all.length / PB_PAGE_SIZE));
  if(pbUI.page > totalPages) pbUI.page = totalPages;
  var start = (pbUI.page - 1) * PB_PAGE_SIZE;
  var pageRows = all.slice(start, start + PB_PAGE_SIZE);

  var body = document.getElementById('pb-body');
  if(!body) return;
  if(!pageRows.length){
    body.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:20px;">No purchase bills yet</td></tr>';
  } else {
    body.innerHTML = pageRows.map(function(b){
      var statusColor = b.paymentStatus === 'Paid' ? 'var(--success)' : (b.paymentStatus === 'Partial' ? 'var(--warning)' : 'var(--danger,#c0392b)');
      return '<tr>'+
        '<td>'+escHtml(b.billNo)+'</td>'+
        '<td>'+escHtml(b.date)+'</td>'+
        '<td>'+escHtml(b.supplier)+'</td>'+
        '<td>'+escHtml(b.supplierInvoiceNo||'-')+'</td>'+
        '<td>'+escHtml(b.purchaseType)+'</td>'+
        '<td>'+fmtW(b.grossWt)+'</td>'+
        // Blank, not 0%, for bills entered before wastage was recorded.
        '<td>'+((b.wastagePct===null||b.wastagePct===undefined)?'—':(parseFloat(b.wastagePct).toFixed(2)+'%'))+'</td>'+
        '<td>'+fmt(b.totalAmount)+'</td>'+
        '<td>'+fmt(b.amountPaid)+'</td>'+
        '<td>'+fmt(b.pendingAmount)+'</td>'+
        '<td><span style="color:'+statusColor+';font-weight:700;">'+b.paymentStatus+'</span></td>'+
        '<td style="white-space:nowrap;">'+
          '<button class="btn btn-sm" onclick="pbToggleForm(\''+b.id+'\')" title="Edit">\u270f\ufe0f</button> '+
          '<button class="btn btn-sm" onclick="pbOpenPaymentModal(\''+b.id+'\')" title="Record supplier payment">\u20b9</button> '+
          '<button class="btn btn-sm" onclick="pbOpenHistoryModal(\''+b.id+'\')" title="Bill history">\ud83d\udd52</button> '+
          '<button class="btn btn-sm" onclick="pbPrintBill(\''+b.id+'\')" title="Print">\ud83d\uddb6\ufe0f</button> '+
          '<button class="btn btn-sm" onclick="deletePurchase(\''+b.id+'\')" title="Delete">\ud83d\uddd1\ufe0f</button>'+
        '</td>'+
      '</tr>';
    }).join('');
  }

  var pag = document.getElementById('pb-pagination');
  if(pag){
    var html = '';
    for(var i=1;i<=totalPages;i++){
      html += '<button class="btn btn-sm'+(i===pbUI.page?' btn-gold':'')+'" style="margin-right:4px;" onclick="pbGoPage('+i+')">'+i+'</button>';
    }
    pag.innerHTML = totalPages > 1 ? html : '';
  }

  var footer = document.getElementById('pb-footer');
  if(footer){
    var totalAmt = all.reduce(function(s,b){ return s+b.totalAmount; }, 0);
    var totalPending = all.reduce(function(s,b){ return s+b.pendingAmount; }, 0);
    footer.innerHTML = all.length+' bill(s) &bull; Total: <b>'+fmt(totalAmt)+'</b> &bull; Pending: <b>'+fmt(totalPending)+'</b>';
  }
}

function pbGoPage(p){ pbUI.page = p; renderPurchaseList(); }

// ── PRINT ────────────────────────────────────────────────────────────
function pbPrintBill(id){
  var b = (S.purchases||[]).find(function(x){ return x.id === id; });
  if(!b){ toast('Bill not found'); return; }
  pbLogEvent(b, 'Printed');
  // Foundation audit B1: this is just an activity-log entry, not a
  // financial mutation, so it doesn't need the full snapshot/rollback
  // treatment — but silently swallowing the error was still wrong.
  saveToCloud(function(err){ if(err && err.message !== 'version-conflict') console.warn('Print log not saved:', err); });
  var cfg = pbCfg();
  var rows = '<tr><td>Bill No</td><td>'+escHtml(b.billNo)+'</td></tr>'+
    '<tr><td>Date</td><td>'+escHtml(b.date)+'</td></tr>'+
    '<tr><td>Supplier</td><td>'+escHtml(b.supplier)+'</td></tr>'+
    '<tr><td>Supplier Invoice #</td><td>'+escHtml(b.supplierInvoiceNo||'-')+'</td></tr>'+
    '<tr><td>Purchase Type</td><td>'+escHtml(b.purchaseType)+'</td></tr>'+
    '<tr><td>Total Items</td><td>'+b.totalItems+'</td></tr>'+
    '<tr><td>Gross / Net Weight</td><td>'+fmtW(b.grossWt)+' / '+fmtW(b.netWt)+'</td></tr>'+
    '<tr><td>Purity</td><td>'+escHtml(b.purity)+'</td></tr>'+
    (cfg.goldRate ? '<tr><td>Gold Rate Snapshot</td><td>'+fmt(b.goldRateSnapshot)+'/g</td></tr>' : '')+
    (cfg.gst ? '<tr><td>GST (C/S/I)</td><td>'+ (b.cgstPct||0)+'% / '+(b.sgstPct||0)+'% / '+(b.igstPct||0)+'%</td></tr>' : '')+
    (cfg.stone ? '<tr><td>Stone</td><td>'+fmt(b.stoneAmount)+' ('+(b.stoneWt||0)+'ct) '+escHtml(b.diamondDetails||'')+'</td></tr>' : '')+
    (cfg.hallmark ? '<tr><td>Hallmark Charges</td><td>'+fmt(b.hallmarkCharges)+'</td></tr>' : '')+
    '<tr><td>Total Amount</td><td><b>'+fmt(b.totalAmount)+'</b></td></tr>'+
    '<tr><td>Amount Paid</td><td>'+fmt(b.amountPaid)+'</td></tr>'+
    '<tr><td>Pending</td><td>'+fmt(b.pendingAmount)+'</td></tr>'+
    '<tr><td>Payment Status</td><td>'+b.paymentStatus+'</td></tr>'+
    (cfg.credit && b.dueDate ? '<tr><td>Credit Due Date</td><td>'+escHtml(b.dueDate)+'</td></tr>' : '')+
    '<tr><td>Employee</td><td>'+escHtml(b.employee||'-')+'</td></tr>'+
    '<tr><td>Notes</td><td>'+escHtml(b.notes||'-')+'</td></tr>';
  var w = window.open('', '_blank');
  w.document.write('<html><head><title>Purchase Bill '+escHtml(b.billNo)+'</title>'+
    '<style>body{font-family:sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;}td{padding:6px 10px;border-bottom:1px solid #ddd;}td:first-child{color:#666;width:40%;}h2{margin-bottom:4px;}</style>'+
    '</head><body><h2>Purchase Bill</h2><table>'+rows+'</table>'+
    '<script>window.onload=function(){window.print();}<\/script></body></html>');
  w.document.close();
}

function pbPrintList(){
  var rows = pbGetFiltered();
  var body = rows.map(function(b){
    return '<tr><td>'+escHtml(b.billNo)+'</td><td>'+escHtml(b.date)+'</td><td>'+escHtml(b.supplier)+'</td>'+
      '<td>'+escHtml(b.purchaseType)+'</td><td>'+fmtW(b.grossWt)+'</td><td>'+fmt(b.totalAmount)+'</td>'+
      '<td>'+fmt(b.pendingAmount)+'</td><td>'+b.paymentStatus+'</td></tr>';
  }).join('');
  var w = window.open('', '_blank');
  w.document.write('<html><head><title>Purchase History</title>'+
    '<style>body{font-family:sans-serif;padding:20px;}table{width:100%;border-collapse:collapse;font-size:13px;}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;}</style>'+
    '</head><body><h2>Purchase Bill History</h2><table><thead><tr><th>Bill#</th><th>Date</th><th>Supplier</th><th>Type</th><th>Gross Wt</th><th>Total</th><th>Pending</th><th>Status</th></tr></thead>'+
    '<tbody>'+body+'</tbody></table><script>window.onload=function(){window.print();}<\/script></body></html>');
  w.document.close();
}

// ── EXPORT (CSV — opens cleanly in Excel) ────────────────────────────
function pbExportCsv(){
  var rows = pbGetFiltered();
  var cfg = pbCfg();
  var headers = ['Bill No','Date','Supplier','Supplier Invoice #','Purchase Type','Total Items','Gross Wt','Net Wt','Wastage %','Purity','Total Amount','Amount Paid','Pending','Payment Status','Payment Method','Employee','Notes'];
  if(cfg.goldRate) headers.push('Gold Rate Snapshot');
  if(cfg.gst) headers.push('CGST %','SGST %','IGST %');
  if(cfg.stone) headers.push('Stone Wt','Stone Amount','Diamond Details');
  if(cfg.hallmark) headers.push('Hallmark Charges');
  if(cfg.credit) headers.push('Credit Due Date');

  function csvEsc(v){ v = (v==null?'':String(v)); return '"'+v.replace(/"/g,'""')+'"'; }

  var lines = [headers.map(csvEsc).join(',')];
  rows.forEach(function(b){
    var row = [b.billNo,b.date,b.supplier,b.supplierInvoiceNo||'',b.purchaseType,b.totalItems,b.grossWt,b.netWt,(b.wastagePct==null?'':b.wastagePct),b.purity,
      b.totalAmount,b.amountPaid,b.pendingAmount,b.paymentStatus,b.paymentMethod,b.employee||'',b.notes||''];
    if(cfg.goldRate) row.push(b.goldRateSnapshot||0);
    if(cfg.gst) row.push(b.cgstPct||0,b.sgstPct||0,b.igstPct||0);
    if(cfg.stone) row.push(b.stoneWt||0,b.stoneAmount||0,b.diamondDetails||'');
    if(cfg.hallmark) row.push(b.hallmarkCharges||0);
    if(cfg.credit) row.push(b.dueDate||'');
    lines.push(row.map(csvEsc).join(','));
  });
  var blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8;'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'purchase-bills-'+dbDayKey(new Date())+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
