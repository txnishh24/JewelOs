function showOrderDetail(ordId){
  var o=S.orders.find(function(x){return x.id===ordId;});if(!o)return;  var adv=ordAdvance(o);
  var bal=Math.max(0,(o.quote||o.estTotal||0)-adv);
  var dl=Math.ceil((new Date(o.delivery)-new Date())/86400000);
  document.getElementById('ord-modal-title').textContent=o.ordNo+' \u2014 '+o.customer;
  var body=document.getElementById('ord-modal-body');
  body.innerHTML='';

  // ── Header info card
  var infoDiv=document.createElement('div');
  infoDiv.style.cssText='background:var(--bg2);border-radius:var(--radius);padding:12px 14px;margin-bottom:1rem;';
  var priHtml=o.priority==='urgent'?'<span class="priority-urgent">URGENT</span>':o.priority==='vip'?'<span class="priority-vip">VIP</span>':'';
  infoDiv.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">'+
      '<div>'+
        '<div style="font-weight:700;font-size:16px;">'+escHtml(o.customer)+' '+priHtml+'</div>'+
        (o.phone?'<div style="font-size:13px;color:var(--text3);">&#128222; '+escHtml(o.phone)+'</div>':'')+
        (o.addr?'<div style="font-size:12px;color:var(--text3);">'+escHtml(o.addr)+'</div>':'')+
      '</div>'+
      '<span class="ord-status '+ORD_STATUS[o.status||'new'].cls+'" style="font-size:13px;padding:5px 14px;">'+ORD_STATUS[o.status||'new'].icon+' '+ORD_STATUS[o.status||'new'].label+'</span>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">'+
      '<div style="font-size:12px;color:var(--text3);">&#128197; Delivery: <strong style="color:'+(dl<0?'var(--danger)':dl<=3?'var(--warning)':'var(--ink)')+';">'+fmtDate(o.delivery)+(dl<0?' ('+Math.abs(dl)+'d overdue)':dl===0?' (Today)':' (in '+dl+'d)')+'</strong></div>'+
      '<div style="font-size:12px;color:var(--text3);">Created: <strong>'+fmtDate(o.createdAt)+'</strong></div>'+
      (o.notes?'<div style="font-size:12px;color:var(--text3);grid-column:1/-1;">Notes: <em>'+escHtml(o.notes)+'</em></div>':'')+
    '</div>';
  body.appendChild(infoDiv);

  // ── Items card
  if(o.items&&o.items.length){
    var itemsDiv=document.createElement('div');
    itemsDiv.style.cssText='margin-bottom:1rem;';
    itemsDiv.innerHTML='<div class="ord-section-label">Order Items ('+o.items.length+')</div>';
    var itemsInner=document.createElement('div');
    itemsInner.style.cssText='background:var(--surface);border:0.5px solid var(--border2);border-radius:var(--radius);overflow:hidden;';
    o.items.forEach(function(item,n){
      var row=document.createElement('div');
      row.style.cssText='padding:10px 14px;border-bottom:0.5px solid var(--border);';
      if(n===o.items.length-1) row.style.borderBottom='none';
      var makingDisplay=item.making>0?(item.makingType==='per_gram'?fmt(item.making)+'/g':item.makingType==='percent'?item.making+'%':fmt(item.making)+' flat'):'—';
      row.innerHTML=
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
          '<div>'+
            '<div style="font-weight:600;font-size:13px;">'+(n+1)+'. '+escHtml(item.desc)+'</div>'+
            '<div style="font-size:11px;color:var(--text3);margin-top:2px;">'+
              item.purity+' '+item.metal+
              (item.cat?' &bull; '+item.cat:'')+
              (item.qty>1?' &bull; Qty: '+item.qty:'')+
            '</div>'+
          '</div>'+
          '<div style="text-align:right;font-size:12px;color:var(--text3);">'+
            (item.orderWt?'<div>Order: <strong>'+fmtW(item.orderWt)+'</strong></div>':'')+
            (item.estWt?'<div>Est: <strong style="color:var(--gold-dark);">'+fmtW(item.estWt)+'</strong></div>':'')+
            (item.making?'<div>Making: '+makingDisplay+'</div>':'')+
          '</div>'+
        '</div>'+
        (item.note?'<div style="font-size:11px;color:var(--text3);margin-top:4px;font-style:italic;">'+item.note+'</div>':'');
      itemsInner.appendChild(row);
    });
    itemsDiv.appendChild(itemsInner);
    body.appendChild(itemsDiv);
  }

  // ── Payment Ledger card
  var payDiv=document.createElement('div');
  payDiv.style.cssText='margin-bottom:1rem;';
  payDiv.innerHTML='<div class="ord-section-label">Payment Ledger</div>';
  var payInner=document.createElement('div');
  payInner.className='ord-payment-section';

  // Summary row
  var paySum=document.createElement('div');
  paySum.style.cssText='display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;';
  paySum.innerHTML=
    '<div style="text-align:center;"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">Quoted</div><div style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:var(--ink);">'+fmt(o.quote||0)+'</div></div>'+
    '<div style="text-align:center;"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">Advance Paid</div><div style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:var(--success);">'+fmt(adv)+'</div></div>'+
    '<div style="text-align:center;"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">Balance</div><div style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:'+(bal>0?'var(--danger)':'var(--success)')+';">'+(bal>0?fmt(bal):'Settled')+'</div></div>';
  payInner.appendChild(paySum);

  // Ledger entries
  var ledger=o.ledger||(o.advance>0?[{txnId:'LEG-legacy',type:'advance',amount:o.advance,mode:o.payment||'Cash',date:o.createdAt,note:'Legacy entry'}]:[]);
  if(ledger.length){
    var ledgerList=document.createElement('div');
    ledgerList.style.cssText='border-top:0.5px solid rgba(201,163,78,.2);padding-top:10px;';
    ledger.forEach(function(txn){
      var row=document.createElement('div');
      row.className='ord-ledger-row';
      var isRev=txn.type==='reversal';
      row.innerHTML=
        '<div>'+
          '<div style="font-size:13px;font-weight:600;color:'+(isRev?'var(--danger)':'var(--ink)')+';">'+
            (isRev?'&#9100; Reversed: ':'&#128179; ')+fmt(txn.amount)+
            ' <span style="font-size:11px;font-weight:400;color:var(--text3);">'+txn.mode+'</span>'+
          '</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:1px;">'+fmtDate(txn.date)+' '+fmtTime(txn.date)+(txn.ref?' &bull; Ref: '+txn.ref:'')+(txn.note?' &bull; '+txn.note:'')+'</div>'+
        '</div>'+
        '<div style="display:flex;gap:6px;align-items:center;">'+
          '<span class="badge '+(isRev?'bg-red':txn.type==='advance'?'bg-gold':'bg-green')+'">'+txn.type+'</span>'+
          (!isRev&&o.status!=='delivered'&&o.status!=='cancelled'?
            '<button class="btn btn-xs btn-danger" onclick="reversePayment(\''+jsAttrEsc(ordId)+'\',\''+txn.txnId+'\')">Reverse</button>':'')+
        '</div>';
      ledgerList.appendChild(row);
    });
    payInner.appendChild(ledgerList);
  } else {
    payInner.innerHTML+='<div style="font-size:13px;color:var(--text3);padding:8px 0;">No payments recorded yet</div>';
  }

  // Add payment button
  if(o.status!=='delivered'&&o.status!=='cancelled'){
    var addPayBtn=document.createElement('div');
    addPayBtn.style.cssText='margin-top:12px;padding-top:12px;border-top:0.5px solid rgba(201,163,78,.2);';
    addPayBtn.innerHTML=
      '<div class="ord-section-label" style="margin-bottom:8px;">Add Payment</div>'+
      '<div class="form-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px;">'+
        '<div class="fg"><label>Amount (&#8377;)</label><input id="new-pay-amt" type="number" placeholder="0" inputmode="decimal"/></div>'+
        '<div class="fg"><label>Mode</label><select id="new-pay-mode"><option>Cash</option><option>UPI</option><option>Bank Transfer</option><option>Cheque</option></select></div>'+
        '<div class="fg"><label>Reference</label><input id="new-pay-ref" placeholder="UPI ID / Txn ref"/></div>'+
        '<div class="fg"><label>Note</label><input id="new-pay-note" placeholder="Optional"/></div>'+
      '</div>'+
      // Order ids are UUIDs. Unquoted, '+ordId+' produced
      // onclick="addPaymentToOrder(44150003-83d7-49d1-...)", which the browser
      // parses as arithmetic on names that do not exist — so the button threw
      // a silent SyntaxError and no payment was ever recorded. jsAttrEsc is
      // the helper the rest of the app already uses for exactly this.
      '<button class="btn btn-gold btn-full" onclick="addPaymentToOrder(\''+jsAttrEsc(ordId)+'\')">&#128179; Add Payment Entry</button>';
    payInner.appendChild(addPayBtn);
  }
  payDiv.appendChild(payInner);
  body.appendChild(payDiv);

  // ── Timeline card
  var tlDiv=document.createElement('div');
  tlDiv.style.cssText='margin-bottom:1rem;';
  tlDiv.innerHTML='<div class="ord-section-label">Status Timeline</div>';
  var tlInner=document.createElement('div');
  tlInner.className='ord-timeline';
  var ALL_STATUSES=['new','progress','ready','delivered'];
  ALL_STATUSES.forEach(function(s){
    var histEntry=(o.statusHistory||[]).find(function(h){return h.status===s;});
    var isDone=histEntry!=null;
    var isActive=o.status===s;
    var row=document.createElement('div'); row.className='ord-tl-item';
    row.innerHTML=
      '<div class="ord-tl-dot '+(isDone?'done':isActive?'active':'pending')+'">'+(isDone?'&#10003;':'')+'</div>'+
      '<div class="ord-tl-content">'+
        '<div class="ord-tl-label" style="color:'+(isDone||isActive?'var(--ink)':'var(--text3)')+';">'+ORD_STATUS[s].icon+' '+ORD_STATUS[s].label+'</div>'+
        (histEntry?'<div class="ord-tl-date">'+fmtDate(histEntry.date)+' at '+fmtTime(histEntry.date)+'</div>':'')+
        (histEntry&&histEntry.note?'<div class="ord-tl-note">'+histEntry.note+'</div>':'')+
      '</div>';
    tlInner.appendChild(row);
  });
  tlDiv.appendChild(tlInner);
  body.appendChild(tlDiv);

  // ── Status update + action buttons
  var sbWrap=document.createElement('div');
  sbWrap.style.cssText='margin-bottom:1rem;';
  sbWrap.innerHTML='<div class="ord-section-label">Update Status</div>';
  var sb=document.createElement('div'); sb.style.cssText='display:flex;flex-wrap:wrap;gap:6px;';
  if(sbWrap) sbWrap.appendChild(sb);
  Object.entries(ORD_STATUS).forEach(function(en){
    var btn=document.createElement('button'); btn.className='status-btn';
    if(o.status===en[0]) btn.style.cssText='background:var(--gold);color:var(--ink);border-color:var(--gold);font-weight:700;';
    btn.innerHTML=en[1].icon+' '+en[1].label;
    (function(sid){btn.onclick=function(ev){ev.stopPropagation();updateOrdStatus(o.id,sid);};})(en[0]);
    sb.appendChild(btn);
  });
  body.appendChild(sbWrap);

  var ab=document.createElement('div'); ab.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1rem;';
  var br=document.createElement('button'); br.className='btn btn-dark'; br.innerHTML='&#128196; Receipt';
  (function(oid){br.onclick=function(){generateOrderReceipt(oid);};})(o.id); ab.appendChild(br);
  if(o.status!=='delivered'&&o.status!=='cancelled'){
    var bc=document.createElement('button'); bc.className='btn btn-gold'; bc.innerHTML='&#10003; Deliver &amp; Create Bill';
    (function(oid){bc.onclick=function(){convertToSale(oid);};})(o.id); ab.appendChild(bc);
  }
  if(o.status!=='cancelled'){
    var bx=document.createElement('button'); bx.className='btn btn-danger'; bx.innerHTML='&#10005; Cancel';
    (function(oid){bx.onclick=function(){cancelOrder(oid);};})(o.id); ab.appendChild(bx);
  }
  body.appendChild(ab);
  document.getElementById('ord-modal').classList.add('open');
}

// ── ADD PAYMENT TO ORDER ──────────────────────────────────────────────────
function addPaymentToOrder(ordId){
  var o=S.orders.find(function(x){return x.id===ordId;});if(!o)return;
  if(_orderLocked(ordId)){ toast('Payment already being recorded — please wait'); return; }
  var amt=parseFloat((document.getElementById('new-pay-amt')||{value:0}).value)||0;
  if(amt<=0){toast('Enter a valid amount');return;}
  var mode=(document.getElementById('new-pay-mode')||{value:'Cash'}).value;
  var ref=(document.getElementById('new-pay-ref')||{value:''}).value.trim();
  var note=(document.getElementById('new-pay-note')||{value:''}).value.trim();
  function doAdd(){
    var _snap=_orderSnapshot(ordId);
    _orderLock(ordId);
    if(!o.ledger)o.ledger=[];
    var txn={txnId:(typeof crypto.randomUUID==='function')?crypto.randomUUID():'TXN-'+Date.now(),type:'advance',amount:amt,mode:mode,ref:ref,note:note||'Payment received',date:new Date().toISOString()};
    o.ledger.push(txn);
    o.advance=ordAdvance(o);
    // Foundation audit B3: was a bare-callback saveToCloud() with no
    // rollback and no lock — a failed/conflicted save could leave a
    // payment showing added here while the cloud never received it.
    _orderCommit(ordId, {snapshot:_snap}, function(err){
      if(!err){toast('\u2713 \u20b9'+amt.toLocaleString('en-IN')+' via '+mode+' added');showOrderDetail(ordId);}
    });
  }
  // Overpayment guard
  var totalAfter=ordAdvance(o)+amt;
  if(o.quote>0&&totalAfter>o.quote*1.05){
    safeConfirm('Payment exceeds quote?','Total payments ('+fmt(totalAfter)+') exceed quoted amount ('+fmt(o.quote)+'). Continue anyway?',doAdd,true);
    return;
  }
  doAdd();
}

// ── REVERSE PAYMENT ───────────────────────────────────────────────────────
function reversePayment(ordId, txnId){
  var o=S.orders.find(function(x){return x.id===ordId;});if(!o||!o.ledger)return;
  if(_orderLocked(ordId)){ toast('Please wait — a save is already in progress'); return; }
  var txn=o.ledger.find(function(t){return t.txnId===txnId;});if(!txn)return;
  safeConfirm('Reverse payment?','Reverse payment of '+fmt(txn.amount)+'? This will be recorded as a reversal (not deleted).',function(){
    var _snap=_orderSnapshot(ordId);
    _orderLock(ordId);
    o.ledger.push({txnId:(typeof crypto.randomUUID==='function')?crypto.randomUUID():'TXN-'+Date.now(),type:'reversal',amount:txn.amount,mode:txn.mode,ref:'Reversal of '+txnId,note:'Reversed',date:new Date().toISOString(),reversedTxn:txnId});
    o.advance=ordAdvance(o);
    // Foundation audit B3: was a bare-callback saveToCloud() — a failed
    // save could show a reversal recorded here while the cloud still
    // had the original payment intact and no reversal at all.
    _orderCommit(ordId, {snapshot:_snap}, function(err){
      if(!err){toast('\u2718 Payment reversed');showOrderDetail(ordId);}
    });
  },true);
  return;
}

// ── UPDATE ORDER STATUS ───────────────────────────────────────────────────
function updateOrdStatus(ordId, newStatus){
  var o=S.orders.find(function(x){return x.id===ordId;});if(!o)return;
  if(_orderLocked(ordId)){ toast('Please wait — a save is already in progress'); return; }
  var _snap=_orderSnapshot(ordId);
  _orderLock(ordId);
  o.status=newStatus;
  if(!o.statusHistory)o.statusHistory=[];
  o.statusHistory.push({status:newStatus,date:new Date().toISOString(),note:ORD_STATUS[newStatus].label});
  // Auto-prompt WhatsApp when order is ready
  if(newStatus==='ready'){
    var shopName=(SAAS&&SAAS.shop&&SAAS.shop.name)||'hamari dukaan';
    var msg='Namaste '+o.customer+' ji \ud83d\ude4f\n\n'+
      'Aapka order *taiyaar ho gaya hai*! \ud83c\udf89\n\n'+
      'Order No: *'+o.ordNo+'*\n'+
      ((o.items&&o.items.length)?(o.items[0].desc+(o.items.length>1?' + '+(o.items.length-1)+' more':'')):'')+'\n\n'+
      'Please aaj shop par aayen aur apna zaroor lejayen.\n\n'+
      '_'+shopName+'_';
    var phone=(o.phone||'').replace(/\D/g,'');
    if(phone.length===10) phone='91'+phone;
    // Foundation audit B3: was a bare-callback saveToCloud() — status
    // change now reverts on failure instead of sticking locally forever.
    _orderCommit(ordId, {snapshot:_snap}, function(err){
      if(!err){
        renderOrders();
        toast(ORD_STATUS[newStatus].icon+' '+ORD_STATUS[newStatus].label);
        showOrderDetail(ordId);
        if(phone){
          safeConfirm('Order ready! Notify customer?','Send WhatsApp to '+o.customer+'?',function(){
            window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
          });
        }
      }
    });
    return;
  }
  _orderCommit(ordId, {snapshot:_snap}, function(err){
    if(!err){renderOrders();toast(ORD_STATUS[newStatus].icon+' '+ORD_STATUS[newStatus].label);showOrderDetail(ordId);}
  });
}

// ── CANCEL ORDER ──────────────────────────────────────────────────────────
function cancelOrder(ordId){
  var o=S.orders.find(function(x){return x.id===ordId;});if(!o)return;
  if(_orderLocked(ordId)){ toast('Please wait — a save is already in progress'); return; }
  safeConfirm('Cancel '+o.ordNo+'?','This cannot be undone.',function(){
    var _snap=_orderSnapshot(ordId);
    _orderLock(ordId);
    o.status='cancelled';
    if(!o.statusHistory)o.statusHistory=[];
    o.statusHistory.push({status:'cancelled',date:new Date().toISOString(),note:'Cancelled by user'});
    // Foundation audit B3: was a bare-callback saveToCloud() — a failed
    // save could show "cancelled" here while the cloud still had it live.
    _orderCommit(ordId, {snapshot:_snap}, function(err){
      if(!err){closeOrdModal();renderOrders();toast('Order cancelled');}
    });
  },true);
  return;
}

// ── CONVERT TO SALE ───────────────────────────────────────────────────────
// Foundation audit B4: this used to mark the order 'delivered'/linkedSale
// and save it to the cloud the moment the sale FORM was pre-filled — not
// once an actual sale existed. If the staff member navigated away or
// closed the tab before clicking "Record Sale" on the sales tab, the
// order was permanently stuck showing delivered/converted with no sale,
// no inventory deducted, no invoice, and no easy way to retry (billedSaleId
// was never set, only the misleading linkedSale flag). Now this only
// prefills the form and records which order is pending conversion —
// _commitSaleTransaction() in 02-ui-inactivity-modals.js does the actual
// order status change, atomically together with the sale it belongs to,
// and only once that sale has actually been recorded.
var _pendingOrderConversion = null;

function convertToSale(ordId){
  var o=S.orders.find(function(x){return x.id===ordId;});if(!o)return;
  if(o.billedSaleId){toast('This order has already been billed ('+o.billedInvNo+')');return;}
  safeConfirm('Mark as Delivered?','Create final bill for '+o.customer+'?',function(){  var totalAdv=ordAdvance(o);
  closeOrdModal();
  switchTab('sales');
  setTimeout(function(){
    document.getElementById('s-cust').value=o.customer;
    document.getElementById('s-phone').value=o.phone||'';
    // ── Carry the ordered ornaments in as editable line items ──────────
    // Custom-made pieces are not in inventory, so they cannot be picked from
    // the SKU dropdown that the stock mode requires — which is why an order
    // could not actually be billed. They go in as custom line items instead,
    // pre-filled from the order and fully editable: the quoted weight is an
    // estimate, and a 15g order that comes off the scale at 15.6g is billed
    // at 15.6g once the owner corrects it.
    var flatMaking = 0;
    if(o.items && o.items.length){
      var lines = [];
      o.items.forEach(function(it){
        var pieces = Math.max(1, parseInt(it.qty) || 1);
        var metal  = it.metal || 'gold';
        var purity = it.purity || (metal==='silver' ? '925 Sterling' : '22K');
        // Est. Final Weight is the better starting point than the originally
        // quoted weight; fall back to the quote if no estimate was recorded.
        var wt = parseFloat(it.estWt) || parseFloat(it.orderWt) || 0;
        // The order records a making TYPE; a custom sale line charges ₹/g.
        var perGram = 0;
        var mk = parseFloat(it.making) || 0;
        if(mk > 0){
          if(it.makingType === 'per_gram'){
            perGram = mk;                                   // same unit already
          } else if(it.makingType === 'percent'){
            // % of metal value is (pct/100 × rate) per gram, so it keeps
            // scaling correctly when the owner corrects the weight.
            perGram = (mk/100) * getRate(metal, purity);
          } else {
            // 'flat' is a rupee amount with no per-gram meaning. Dividing it
            // by a weight that is about to change would silently reprice it,
            // so it goes to the bill-level making field untouched.
            flatMaking += mk * pieces;
          }
        }
        for(var p=0; p<pieces; p++){
          lines.push({name:it.desc||'Custom item', metal:metal, purity:purity,
                      grossWt:wt, blackBeads:0, diamond:0,
                      making:perGram, stoneCharges:0});
        }
      });
      if(lines.length){
        customSaleItems = lines;
        // Clear first: renderCustomSaleItems only adds/removes cards and
        // refreshes the computed figures — it does not rewrite the inputs of
        // cards that already exist, so stale values would survive.
        var cwrap = document.getElementById('custom-sale-items');
        if(cwrap) cwrap.innerHTML = '';
        setSaleMode('custom');   // switches the form and rebuilds the cards
      }
    }
    if(flatMaking > 0) document.getElementById('s-making').value = flatMaking;
    // Total advance already paid → fills prev advance correctly
    document.getElementById('s-prev-advance').value=totalAdv;
    document.getElementById('s-notes').value='Order: '+o.ordNo+(o.notes?' | '+o.notes:'');
    document.getElementById('s-invno').value='INV-'+String(S.nextInvNo).padStart(3,'0');
    var bal=Math.max(0,(o.quote||0)-totalAdv);
    setPayStatus(bal<=0?'full':'advance');
    updateSum();
    // No order mutation and no save here anymore — just flag it pending.
    _pendingOrderConversion = ordId;
    toast('\u2713 '+o.ordNo+' loaded. Check each weight against the scale, then record the bill.');
  },600);
  }); // end safeConfirm
  return;
}

// ── GENERATE ORDER RECEIPT ────────────────────────────────────────────────
// FIX: was declared ONLY inside generateOrderReceipt() as a local helper,
// so it didn't exist as a global — every other caller (renderOrders()'s
// metrics/list in 03-billing-numbers.js, the "Due This Week" widget, the
// order detail view) was calling an undefined function. This stayed
// invisible because Array.reduce() never invokes its callback on an empty
// array, so the crash only fired the moment a shop's FIRST active order
// existed — i.e. immediately after saving it, which is exactly what broke:
// saveOrder()'s success callback calls renderOrders() right after the
// order is already pushed to S.orders and sent to the cloud, and that
// call threw a ReferenceError before ever reaching the toast/list update —
// looks exactly like "froze, nothing happened," with the order count
// stuck at its last successfully-rendered value (0).
// A reversal must SUBTRACT the amount it reverses, not merely be skipped.
// Skipping it left the original payment still counted, so a reversed advance
// stayed credited to the customer and the balance due read too low. Sales
// (02-ui-inactivity-modals.js) and purchases (09-purchases.js) already do it
// this way; orders were the odd one out. Reachable only now — the Reverse
// button itself never worked, because the order id was spliced into its
// onclick unquoted.
function ordAdvance(ord){return (ord.ledger&&ord.ledger.length)?ord.ledger.reduce(function(s,t){return s+(t.type==='reversal'?-t.amount:t.amount);},0):(ord.advance||0);}

function generateOrderReceipt(ordId){
  var o=S.orders.find(function(x){return x.id===ordId;});if(!o)return;
  var adv=ordAdvance(o); var bal=Math.max(0,(o.quote||0)-adv);
  var rows=(o.items&&o.items.length)?o.items.map(function(it,n){
    return '<tr><td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;">'+(n+1)+'. '+it.desc+'</td>'+
      '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:center;">'+it.purity+'</td>'+
      '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:center;">'+(it.orderWt?fmtW(it.orderWt):'—')+'</td>'+
      '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:center;">'+(it.estWt?fmtW(it.estWt):'—')+'</td>'+
      '<td style="padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:right;">'+(it.making>0?(it.makingType==='per_gram'?fmt(it.making)+'/g':it.makingType==='percent'?it.making+'%':fmt(it.making)):'—')+'</td>'+
    '</tr>';
  }).join(''):'<tr><td colspan="5" style="padding:10px;text-align:center;color:#999;">'+( o.desc||'Custom Order')+'</td></tr>';
  var ledgerRows=(o.ledger&&o.ledger.length)?o.ledger.map(function(txn){
    return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0f0f0;font-size:12px;">'+
      '<span style="color:'+(txn.type==='reversal'?'#c0392b':'#1a1814')+';">'+(txn.type==='reversal'?'&#9100; Reversed: ':'')+fmt(txn.amount)+' ('+txn.mode+')</span>'+
      '<span style="color:#888;">'+fmtDate(txn.date)+(txn.ref?' · '+txn.ref:'')+'</span>'+
    '</div>';
  }).join(''):'<div style="color:#888;font-size:12px;padding:5px 0;">No payments recorded</div>';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Order Receipt '+o.ordNo+'</title><style>'+
    '*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Georgia,serif;background:#fff;color:#1a1814;font-size:13px;padding:0;}'+
    '.page{max-width:680px;margin:0 auto;padding:28px 32px;}'+
    '.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px;border-bottom:2px solid #1a1814;margin-bottom:18px;}'+
    '.sn{font-size:26px;font-weight:700;color:#1a1814;letter-spacing:.04em;}.sn em{font-style:italic;color:#c9a34e;}'+
    '.st{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-top:4px;}'+
    '.ord-badge{background:#f8f3ea;border:1px solid #c9a34e;border-radius:8px;padding:10px 14px;text-align:right;}'+
    '.ord-no{font-size:20px;font-weight:700;color:#1a1814;letter-spacing:.06em;}'+
    '.ord-date{font-size:11px;color:#888;margin-top:3px;}'+
    '.info-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;}'+
    '.ibox{background:#f8f9fa;border:1px solid #e9ecef;border-radius:8px;padding:12px;}'+
    '.ilbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#888;margin-bottom:5px;}'+
    '.iname{font-size:15px;font-weight:700;color:#1a1814;}'+
    '.idet{font-size:12px;color:#555;margin-top:2px;}'+
    'table{width:100%;border-collapse:collapse;margin-bottom:16px;}'+
    'thead tr{background:#1a1814;}thead th{padding:8px 10px;text-align:left;font-size:10px;font-weight:700;color:#c9a34e;text-transform:uppercase;letter-spacing:.08em;}'+
    'thead th:not(:first-child){text-align:center;}'+
    '.section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#888;margin-bottom:8px;}'+
    '.pay-section{background:#f8f3ea;border:1px solid rgba(201,163,78,.3);border-radius:8px;padding:12px 14px;margin-bottom:16px;}'+
    '.pay-total{display:flex;justify-content:space-between;padding-top:8px;margin-top:8px;border-top:1px solid rgba(201,163,78,.3);font-size:15px;font-weight:700;}'+
    '.status-chip{display:inline-block;padding:3px 12px;border-radius:100px;font-size:11px;font-weight:700;background:#e8f5ee;color:#1c6040;border:1px solid rgba(28,96,64,.25);}'+
    '.sig{display:flex;justify-content:space-between;margin-top:24px;}'+
    '.sigb{width:140px;text-align:center;}.sigl{height:1px;background:#ccc;margin-bottom:5px;}.sigk{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.1em;}'+
    '.footer{text-align:center;margin-top:20px;padding-top:14px;border-top:1px solid #e0e0e0;font-size:11px;color:#888;}'+
    '@media print{body{font-size:12px;}.page{padding:16px 20px;}}'+
    '</style></head><body><div class="page">'+
    '<div class="hdr"><div><div class="sn"><em>Sri Sai</em> Jewellers</div><div class="st">Order Receipt — Not a Tax Invoice</div></div>'+
    '<div class="ord-badge"><div class="ord-no">'+o.ordNo+'</div><div class="ord-date">'+fmtDate(o.createdAt)+' · '+ORD_STATUS[o.status||'new'].label+'</div></div></div>'+
    '<div class="info-row">'+
      '<div class="ibox"><div class="ilbl">Customer</div><div class="iname">'+escHtml(o.customer)+'</div>'+(o.phone?'<div class="idet">'+escHtml(o.phone)+'</div>':'')+(o.addr?'<div class="idet">'+escHtml(o.addr)+'</div>':'')+'</div>'+
      '<div class="ibox"><div class="ilbl">Delivery</div><div class="iname">'+fmtDate(o.delivery)+'</div>'+(o.notes?'<div class="idet">'+escHtml(o.notes)+'</div>':'')+'</div>'+
    '</div>'+
    '<div class="section-title">Order Items</div>'+
    '<table><thead><tr><th>Description</th><th>Purity</th><th>Order Wt</th><th>Est Wt</th><th>Making</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<div class="section-title">Payment Ledger</div>'+
    '<div class="pay-section">'+ledgerRows+
      '<div class="pay-total"><span>Quoted Amount</span><span>'+fmt(o.quote||0)+'</span></div>'+
      '<div class="pay-total"><span>Total Advance Paid</span><span style="color:#1c6040;">'+fmt(adv)+'</span></div>'+
      (bal>0?'<div class="pay-total"><span style="color:#c0392b;">Balance Due</span><span style="color:#c0392b;">'+fmt(bal)+'</span></div>':'<div class="pay-total"><span style="color:#1c6040;">&#10003; Fully Settled</span><span style="color:#1c6040;">Nil</span></div>')+
    '</div>'+
    (o.goldDeposit?'<div style="font-size:12px;color:#888;margin-bottom:12px;">Gold Deposited: <strong>'+fmtW(o.goldDeposit)+'</strong></div>':'')+
    '<div class="sig"><div class="sigb"><div class="sigl"></div><div class="sigk">Customer</div></div>'+
    '<div style="font-size:12px;color:#888;font-style:italic;">'+((SAAS&&SAAS.shop&&SAAS.shop.name)||'JewelOS')+'</div>'+
    '<div class="sigb"><div class="sigl"></div><div class="sigk">Authorised</div></div></div>'+
    '<div class="footer">'+((SAAS&&SAAS.shop&&SAAS.shop.name)||'JewelOS')+' — Order Receipt — Not a final invoice. BIS Hallmark status subject to hallmarking at delivery.</div>'+
    '</div></body></html>';
  var w=window.open('','_blank','width=750,height=900');
  if(w){w.document.write(html);w.document.close();setTimeout(function(){w.print();},600);}
}

function toggleOrdForm(){
  var form=document.getElementById('ord-form');
  var btn=document.getElementById('ord-add-btn');
  if(!form)return;
  var isOpen=form.style.display!=='none';
  if(isOpen){
    form.style.display='none';
    if(btn)btn.textContent='+ New Order';
    ordItems=[{desc:'',cat:'Rings',metal:'gold',purity:'22K',orderWt:0,estWt:0,making:0,makingType:'flat',qty:1,note:''}];
  } else {
    form.style.display='block';
    if(btn)btn.textContent='Cancel';
    renderOrdItems();
    calcOrdEst();
    // Set default delivery date 14 days from now
    var d=new Date(); d.setDate(d.getDate()+14);
    var di=document.getElementById('of-delivery');
    if(di&&!di.value) di.value=d.toISOString().split('T')[0];
  }
}
function closeOrdModal(){document.getElementById('ord-modal').classList.remove('open');}

// ─── CACHE ────────────────────────────────────────────────────────────────
function saveCache(){
  try{
    if(!Array.isArray(S.products)||!Array.isArray(S.sales)) return;
    // FIX: cache is tagged with the shop it belongs to. Without this, any
    // account created/logged into on a device that previously held another
    // shop's cache would render that other shop's data on first paint,
    // before the cloud fetch (which IS correctly shop-scoped) overwrites it.
    var ownerShopId = (typeof SAAS!=='undefined' && SAAS.shop && SAAS.shop.id) || null;
    localStorage.setItem('ssj_cache',JSON.stringify({
      shopId:ownerShopId,
      products:S.products,sales:S.sales,orders:S.orders||[],girvi:S.girvi||[],customers:S.customers||[],
      purchases:S.purchases||[],suppliers:S.suppliers||[],purchaseAuditLog:S.purchaseAuditLog||[],purchaseCfg:S.purchaseCfg||{},rates:S.rates,
      auditLog:S.auditLog||[],activityLog:S.activityLog||[],waRules:S.waRules||[],
      nextId:S.nextId||1,nextSaleId:S.nextSaleId||1,nextInvNo:S.nextInvNo||1,nextOrdId:S.nextOrdId||1,nextGirviId:S.nextGirviId||1,
      nextPurchaseId:S.nextPurchaseId||1,nextPurchaseBillNo:S.nextPurchaseBillNo||1
    }));
    try{ localStorage.setItem('ssj_last_save', Date.now().toString()); } catch(e){}
  }catch(e){console.warn('Cache save failed:',e.message||e);}
}

// ─── DATA NORMALISATION (FIX-06) ────────────────────────────────────────────
// Run after EVERY data load: loadFromCloud(), loadCache(), doRestore()
// Maps old field names → canonical names so UI never shows NaN/zero
function normaliseData(){
  if(typeof S === 'undefined' || !S) return; // safety guard
  // ── SCHEMA VERSION ────────────────────────────────────────────────
  // v19 canonical field names (do NOT add new aliases — fix data at write time instead):
  //   Products: id, name, cat, metal, purity, huid, sku, grossWt, netWt, weight(=grossWt),
  //             costRate, mc, mcRate, makingType, stoneCharge, beadsWt, status, photo, notes
  //   Sales:    id, invNo, date, customer, phone, items[], payStatus, gst, making, discount,
  //             advance, lockedGrand, oldGold, prevAdvance, nowPaying
  //   Girvi:    id, grvNo, customer, phone, items[], item(legacy), principal, interestRate,
  //             rateType, compound, startDate, duration, status, payments[], ledger[]
  //   Orders:   id, ordNo, customer, phone, items[], status, advance, delivery, notes
  S._schemaVersion = 19;
  // ── PRODUCTS ──────────────────────────────────────────────
  (S.products||[]).forEach(function(p){
    if(!p.netWt && p.netWeight)  p.netWt    = p.netWeight;
    if(!p.grossWt && p.weight)   p.grossWt  = p.weight;
    if(!p.grossWt)               p.grossWt  = p.netWt;
    if(p.stockQty==null && p.qty!=null)             p.stockQty = p.qty;
    if(p.stockQty==null && p.status==='available')  p.stockQty = 1;
    if(p.stockQty==null && p.status==='sold')       p.stockQty = 0;
    if(p.stockQty==null)                            p.stockQty = 1;
    if(!p.mc && p.making)        p.mc          = p.making;
    if(!p.makingType)            p.makingType  = 'per_gram';
    if(!p.stoneCharge && p.diamond)  p.stoneCharge = p.diamond;
    if(!p.beadsWt && p.blackBeads)   p.beadsWt     = p.blackBeads;
    if(!p.beadsWt && p.diamondWt)    p.beadsWt     = p.diamondWt;
    p.netWt       = parseFloat(p.netWt)       || 0;
    p.grossWt     = parseFloat(p.grossWt)     || 0;
    p.stockQty    = parseInt(p.stockQty)      || 0;
    p.mc          = parseFloat(p.mc)          || 0;
    p.stoneCharge = parseFloat(p.stoneCharge) || 0;
    p.beadsWt     = parseFloat(p.beadsWt)     || 0;
    if(p.grossWt < p.netWt) p.grossWt = p.netWt;
  });
  // ── SALES ─────────────────────────────────────────────────
  (S.sales||[]).forEach(function(s){
    if(!s.payStatus && s.paymentStatus) s.payStatus = s.paymentStatus;
    if(!s.payStatus && s.status)        s.payStatus = s.status;
    if(!s.payStatus) s.payStatus = 'paid';
    if(!s.invNo && s.invoiceNo)   s.invNo = s.invoiceNo;
    if(!s.invNo && s.invoice_no)  s.invNo = s.invoice_no;
    // total / subtotal / balance are NOT stored on a sale. Money is derived by
    // calcSaleTotals() from the item lines, lockedRates and lockedGrand — one
    // source of truth, per the financial engine note in 01-sync-core.js.
    // These three lines used to coerce legacy field names (`amount`, `sub`) that
    // nothing has written for a long time, so every saved sale ended up carrying
    // total:0, subtotal:0, balance:0. Nothing read them — but anyone looking at
    // the raw database sees a ₹1.2 lakh bill with total:0 and reasonably concludes
    // money is being lost. That false alarm has now cost a round trip, so the
    // dead normalisation is removed rather than the zeros explained again.
    // Read the real figures with calcSaleTotals(sale): .sub, .gstAmt, .grand, .bal.
    (s.items||[]).forEach(function(it){
      if(!it.grossWt && it.grossWeight) it.grossWt = it.grossWeight;
      if(!it.netWt && it.weight)        it.netWt   = it.weight;
      if(!it.beads && it.blackBeads)    it.beads   = it.blackBeads;
      if(!it.diamond && it.diamondWt)   it.diamond = it.diamondWt;
      if(!it.mcAmt && it.making)        it.mcAmt   = it.making;
      if(!it.stoneAmt && it.diamond && !it.diamondWt) it.stoneAmt = it.diamond;
      if(!it.rate && it.lockedRate)     it.rate    = it.lockedRate;
      it.grossWt = parseFloat(it.grossWt) || 0;
      it.netWt   = parseFloat(it.netWt)   || 0;
      it.mcAmt   = parseFloat(it.mcAmt)   || 0;
      it.rate    = parseFloat(it.rate)    || 0;
    });
  });
  // ── RATES ─────────────────────────────────────────────────
  if(S.rates){
    if(!S.rates.g22 && S.rates.gold22) S.rates.g22 = S.rates.gold22;
    if(!S.rates.g24 && S.rates.gold24) S.rates.g24 = S.rates.gold24;
    if(!S.rates.g18 && S.rates.gold18) S.rates.g18 = S.rates.gold18;
    if(!S.rates.sil && S.rates.silver) S.rates.sil = S.rates.silver;
  }
  // ── GIRVI ITEMS NORMALISATION ────────────────────────────────
  // Wrap legacy single g.item into g.items[] array for multi-item compat
  (S.girvi||[]).forEach(function(g){
    // ── Structural integrity guards (prevent runtime crashes) ──
    if(!g.id) g.id = (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
    if(!g.ledger)   g.ledger   = [];
    if(!g.payments) g.payments = [];
    if(!g.notesList) g.notesList = [];
    if(!g.amountAdjLog) g.amountAdjLog = [];
    if(!g.grvNo) g.grvNo = 'GRV-' + String(g.id).slice(-4).toUpperCase();
    if(!g.customer) g.customer = 'Unknown';
    if(!g.phone) g.phone = '';
    if(!g.startDate) g.startDate = new Date().toISOString().slice(0,10);
    if(!g.interestRate) g.interestRate = 2;
    if(!g.rateType) g.rateType = 'monthly';
    if(!g.principal || isNaN(parseFloat(g.principal))) g.principal = 0;
    if(!g.status) g.status = 'active';
    if(!g.createdAt) g.createdAt = g.startDate;

    // ── Items normalisation ──
    if(!Array.isArray(g.items) || !g.items.length){
      if(g.item && (g.item.weight||g.item.grossWt)){
        g.items = [{
          type:g.item.type||'Item', metal:g.item.metal||'gold',
          purity:g.item.purity||'22K',
          weight:parseFloat(g.item.weight||g.item.grossWt)||0,
          netWt:parseFloat(g.item.netWt)||0,
          qty:parseInt(g.item.qty)||1,
          desc:g.item.desc||''
        }];
      } else {
        g.items = [];
      }
    }
    // Ensure legacy g.item always mirrors first item
    if(g.items.length && !g.item) g.item = g.items[0];
  });
  // ── CUSTOMERS NORMALISATION ───────────────────────────────
  if(!Array.isArray(S.customers)) S.customers = [];
  // ── PURCHASES NORMALISATION ───────────────────────────────
  if(!Array.isArray(S.purchases)) S.purchases = [];
  if(!Array.isArray(S.suppliers)) S.suppliers = [];
  if(!Array.isArray(S.purchaseAuditLog)) S.purchaseAuditLog = [];
  if(!Array.isArray(S.auditLog)) S.auditLog = [];
  if(!Array.isArray(S.activityLog)) S.activityLog = [];
  if(!Array.isArray(S.waRules)) S.waRules = [];
  if(!S.purchaseCfg) S.purchaseCfg = {gst:true, goldRate:false, stone:false, hallmark:false, credit:false, timeline:false};
  (S.purchases||[]).forEach(function(p){
    if(!p.id) p.id = (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
    if(!p.billNo) p.billNo = 'PB-' + String(p.id).slice(-5).toUpperCase();
    if(!p.date) p.date = new Date().toISOString().slice(0,10);
    if(!p.supplier) p.supplier = 'Unknown Supplier';
    if(!p.purchaseType) p.purchaseType = 'Gold';
    if(!p.paymentMethod) p.paymentMethod = 'Cash';
    if(!Array.isArray(p.timeline)) p.timeline = [];
    p.totalAmount  = parseFloat(p.totalAmount)  || 0;
    p.amountPaid   = parseFloat(p.amountPaid)   || 0;
    p.grossWt      = parseFloat(p.grossWt)      || 0;
    p.netWt        = parseFloat(p.netWt)        || 0;
    p.totalItems   = parseInt(p.totalItems)     || 0;
    // Supplier credit toggle: when disabled, every purchase is treated as fully paid
    if(!S.purchaseCfg.credit){
      p.amountPaid = p.totalAmount;
    }
    p.pendingAmount = Math.max(0, Math.round((p.totalAmount - p.amountPaid) * 100) / 100);
    p.paymentStatus = p.pendingAmount <= 0 ? 'Paid' : (p.amountPaid > 0 ? 'Partial' : 'Unpaid');
    if(p.deleted == null) p.deleted = false;
  });
  if(!S.nextPurchaseId || S.nextPurchaseId < 1) S.nextPurchaseId = (S.purchases||[]).length + 1;
  if(!S.nextPurchaseBillNo || S.nextPurchaseBillNo < 1) S.nextPurchaseBillNo = (S.purchases||[]).length + 1;
  // ── GIRVI ⇄ CUSTOMER ACCOUNT LINKING (Feature 1) ───────────
  // Ensures every Girvi entry is linked to exactly one S.customers
  // record (by normalised phone, falling back to normalised name),
  // so the same customer never gets a duplicate "account" just
  // because they pawned another item.
  migrateGirviCustomerLinks();
  // ── ID COUNTERS ───────────────────────────────────────────
  if(!S.nextId)     S.nextId     = (S.products||[]).length + 1;
  if(!S.nextSaleId) S.nextSaleId = (S.sales   ||[]).length + 1;
  if(!S.nextInvNo)  S.nextInvNo  = (S.sales   ||[]).length + 1;
}
function loadCache(){
  try{
    var d=localStorage.getItem('ssj_cache');
    if(!d)return false;
    var r=JSON.parse(d);
    // FIX: reject any cache that doesn't belong to the shop currently
    // logged in on this device. Old caches predate this field (r.shopId
    // undefined) — treat those as stale too rather than trusting them,
    // since an undefined-vs-undefined match would defeat the check on a
    // device that's never had a shopId-tagged cache written yet.
    var currentShopId = (typeof SAAS!=='undefined' && SAAS.shop && SAAS.shop.id) || null;
    if(!currentShopId || r.shopId !== currentShopId){
      try{ localStorage.removeItem('ssj_cache'); }catch(e2){}
      return false;
    }
    if(r.products)S.products=r.products;
    if(r.sales)S.sales=r.sales;
    if(r.orders)S.orders=r.orders;
    if(r.girvi)S.girvi=r.girvi;
    if(r.rates)S.rates=r.rates;
    if(r.nextId)S.nextId=r.nextId;
    if(r.nextSaleId)S.nextSaleId=r.nextSaleId;
    if(r.nextInvNo)S.nextInvNo=r.nextInvNo;
    if(r.nextOrdId&&r.nextOrdId>1)S.nextOrdId=r.nextOrdId;
    if(r.nextGirviId&&r.nextGirviId>1)S.nextGirviId=r.nextGirviId;
    if(Array.isArray(r.customers)) S.customers=r.customers;
    if(Array.isArray(r.purchases)) S.purchases=r.purchases;
    if(Array.isArray(r.suppliers)) S.suppliers=r.suppliers;
    if(Array.isArray(r.purchaseAuditLog)) S.purchaseAuditLog=r.purchaseAuditLog;
    if(Array.isArray(r.auditLog)) S.auditLog=r.auditLog;
    if(Array.isArray(r.activityLog)) S.activityLog=r.activityLog;
    if(Array.isArray(r.waRules)) S.waRules=r.waRules;
    if(r.purchaseCfg && typeof r.purchaseCfg==='object') S.purchaseCfg=Object.assign({}, S.purchaseCfg, r.purchaseCfg);
    if(r.nextPurchaseId&&r.nextPurchaseId>1) S.nextPurchaseId=r.nextPurchaseId;
    if(r.nextPurchaseBillNo&&r.nextPurchaseBillNo>1) S.nextPurchaseBillNo=r.nextPurchaseBillNo;
    normaliseData();
    return true;
  }catch(e){return false;}
}

// ─── STARTUP ──────────────────────────────────────────────────────────────


// ─── PIN LOCK ─────────────────────────────────────────────────────────────
// FIX: PIN keys are scoped per-shop. Previously these were flat constants
// ('ssj_pin' etc.), so a new/different account created on a device that
// already had a PIN set would inherit the PREVIOUS account's PIN and
// unlocked-session state — someone could unlock a brand-new account with
// an old owner's PIN, or a new account could boot straight past the PIN
// screen entirely if the old session hadn't timed out yet. Each key is now
// namespaced to the currently logged-in shop id, same fix pattern as
// ssj_cache. _pinShopSuffix() falls back to a shared 'noshop' bucket only
// in the narrow pre-login window; isPinSet()/verify never run before a
// shop is set, so in practice this always resolves to a real shop id.
function _pinShopSuffix(){
  return (typeof SAAS!=='undefined' && SAAS.shop && SAAS.shop.id) || 'noshop';
}
function _PIN_KEY()            { return 'ssj_pin::' + _pinShopSuffix(); }
function _PIN_SALT_KEY()       { return 'ssj_pin_salt::' + _pinShopSuffix(); }
function _PIN_SESSION_KEY()    { return 'ssj_unlocked::' + _pinShopSuffix(); }
function _PIN_LAST_ACTIVE_KEY(){ return 'ssj_last_active::' + _pinShopSuffix(); }
var DEFAULT_PIN        = '1234';

// sessionStorage alone gets wiped every time a mobile OS kills the
// backgrounded PWA process — which happens far more often than the user
// actually being idle for 3 minutes. That made the PIN screen reappear on
// almost every re-open, not just after real inactivity. These helpers use
// a localStorage timestamp instead, which survives the process being
// killed, so "still unlocked" is judged by actual elapsed time since the
// last touch — matching the real security intent — rather than by whether
// the OS happened to keep the tab alive.
function markPinSessionActive(){
  try{ sessionStorage.setItem(_PIN_SESSION_KEY(), '1'); }catch(e){}
  try{ localStorage.setItem(_PIN_LAST_ACTIVE_KEY(), String(Date.now())); }catch(e){}
}
function isPinSessionActive(){
  try{
    var ts = parseInt(localStorage.getItem(_PIN_LAST_ACTIVE_KEY()), 10);
    if(!ts || isNaN(ts)) return false;
    var idleMs = (typeof INACTIVITY_MS !== 'undefined') ? INACTIVITY_MS : (3*60*1000);
    return (Date.now() - ts) < idleMs;
  }catch(e){ return false; }
}
function clearPinSession(){
  try{ sessionStorage.removeItem(_PIN_SESSION_KEY()); }catch(e){}
  try{ localStorage.removeItem(_PIN_LAST_ACTIVE_KEY()); }catch(e){}
}

// ─── PIN STATE (all private, no global mutation except through pinKey/pinDel) ──
var _pinBuf      = '';    // current digit buffer
var _pinLocked   = false; // true while SHA-256 verify is in progress
var _pinChanging = false; // true while in change-PIN flow
var _pinStep     = 0;     // 0=verify current, 1=enter new, 2=confirm new
var _pinTempNew  = '';

// ─── PIN HASHING — SHA-256 + salt, fast on mobile (<2ms) ─────────────────────
function _getPinSalt(){
  var s = localStorage.getItem(_PIN_SALT_KEY());
  if(!s){
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    s = Array.from(arr).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    try{ localStorage.setItem(_PIN_SALT_KEY(), s); } catch(e){} 
  }
  return s;
}

function _sha256(str){
  var enc = new TextEncoder();
  return crypto.subtle.digest('SHA-256', enc.encode(str)).then(function(buf){
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  });
}

function isPinSet(){ return !!localStorage.getItem(_PIN_KEY()); }

function _doSetPin(p){
  var salt = _getPinSalt();
  return _sha256(salt + p).then(function(h){
    try{ localStorage.setItem(_PIN_KEY(), 's1:' + h); } catch(e){ console.warn('[JewelOS] Could not save PIN'); }
  });
}

// Supports three stored formats: 's1:' (SHA-256), 'ssj2:' (old PBKDF2), plain text
function _verifyPin(entered){
  var stored = localStorage.getItem(_PIN_KEY()) || '';

  // No PIN stored — compare against default '1234'
  if(!stored){
    if(entered === DEFAULT_PIN) return Promise.resolve(true);
    return Promise.resolve(false);
  }

  // New fast format: s1: + sha256(salt+pin)
  if(stored.startsWith('s1:')){
    var salt = _getPinSalt();
    return _sha256(salt + entered).then(function(h){
      return ('s1:' + h) === stored;
    });
  }

  // Old PBKDF2 format — verify then silently migrate to fast format
  if(stored.startsWith('ssj2:')){
    var enc2 = new TextEncoder();
    var salt2 = localStorage.getItem(_PIN_SALT_KEY()) || '';
    return crypto.subtle.importKey('raw', enc2.encode(entered), {name:'PBKDF2'}, false, ['deriveBits'])
      .then(function(key){
        return crypto.subtle.deriveBits(
          {name:'PBKDF2', salt: enc2.encode(salt2), iterations:100000, hash:'SHA-256'},
          key, 256
        );
      })
      .then(function(bits){
        var h = 'ssj2:' + Array.from(new Uint8Array(bits)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
        var ok = h === stored;
        if(ok) _doSetPin(entered); // migrate silently
        return ok;
      })
      .catch(function(){ return false; });
  }

  // Plain text (very old)
  var ok = entered === stored;
  if(ok) _doSetPin(entered);
  return Promise.resolve(ok);
}

// ─── PIN UI HELPERS ───────────────────────────────────────────────────────────
function updatePinDots(n){
  for(var i=0;i<4;i++){
    var d=document.getElementById('pd'+i);
    if(d) d.className='pin-dot'+(i<n?' filled':'');
  }
}

function pinShake(){
  var d=document.getElementById('pin-dots');
  if(!d) return;
  d.classList.remove('pin-shake');
  void d.offsetWidth; // force reflow
  d.classList.add('pin-shake');
  setTimeout(function(){d.classList.remove('pin-shake');},420);
}

function _pinSetLabel(txt){
  var l=document.getElementById('pin-label'); if(l) l.textContent=txt;
}
function _pinSetError(txt){
  var e=document.getElementById('pin-error'); if(e) e.textContent=txt;
}
function _pinClearError(){ _pinSetError(''); }

// ─── PIN CORE LOGIC ───────────────────────────────────────────────────────────
function _pinAddDigit(digit){
  if(_pinLocked) return;

  var buf = _pinChanging ? _pinBuf : _pinBuf; // same buffer, mode tells us context
  if(_pinBuf.length >= 4) return;

  _pinBuf += digit;
  updatePinDots(_pinBuf.length);
  _pinClearError();

  if(_pinBuf.length === 4){
    _pinLocked = true;
    setTimeout(_pinChanging ? _pinHandleChange : _pinHandleVerify, 80);
  }
}

function _pinDeleteDigit(){
  if(_pinLocked) return;
  _pinBuf = _pinBuf.slice(0,-1);
  updatePinDots(_pinBuf.length);
  _pinClearError();
}

function _pinHandleVerify(){
  var entered = _pinBuf;
  _pinBuf = '';
  updatePinDots(0);

  _verifyPin(entered).then(function(ok){
    _pinLocked = false;
    if(ok){
      _pinClearError();
      _pinUnlockApp();
    } else {
      _pinSetError('Incorrect PIN. Try again.');
      pinShake();
    }
  }).catch(function(){
    _pinLocked = false;
    _pinSetError('Error verifying PIN. Try again.');
    pinShake();
  });
}

function _pinHandleChange(){
  var entered = _pinBuf;
  _pinBuf = '';
  updatePinDots(0);

  if(_pinStep === 0){
    // Verify current PIN
    _verifyPin(entered).then(function(ok){
      _pinLocked = false;
      if(ok){
        _pinStep = 1;
        _pinSetLabel('Enter New 4-Digit PIN');
        _pinClearError();
      } else {
        _pinSetError('Wrong PIN. Try again.');
        pinShake();
      }
    });
  } else if(_pinStep === 1){
    // Store new PIN candidate
    _pinTempNew = entered;
    _pinStep = 2;
    _pinLocked = false;
    _pinSetLabel('Confirm New PIN');
    _pinClearError();
  } else if(_pinStep === 2){
    // Confirm match
    if(entered === _pinTempNew){
      _doSetPin(_pinTempNew).then(function(){
        _pinLocked  = false;
        _pinChanging = false;
        _pinStep    = 0;
        _pinTempNew = '';
        _pinSetLabel('Enter PIN');
        _pinClearError();
        markPinSessionActive();
        var ps=document.getElementById('pin-screen');
        if(ps) ps.classList.add('hidden');
        toast('\u2713 PIN changed successfully!');
        try{ localStorage.setItem('jewelos_pin_changed::'+_pinShopSuffix(),'1'); }catch(e){} // onboarding flag, shop-scoped (see fix note in 06-inventory-stock.js)
        if(!_appStarted){ _appStarted=true; startApp(); }
      });
    } else {
      _pinLocked = false;
      _pinStep   = 1;
      _pinTempNew = '';
      _pinSetLabel('Enter New 4-Digit PIN');
      _pinSetError("PINs don't match. Enter new PIN again.");
      pinShake();
    }
  }
}

function _pinUnlockApp(){
  markPinSessionActive();
  var ps=document.getElementById('pin-screen');
  if(ps) ps.classList.add('hidden');
  var ov=document.getElementById('inactivity-overlay');
  if(ov) ov.classList.remove('show');
  _inactOverlayShown=false;
  var header=document.querySelector('header.topbar');
  var mainEl=document.querySelector('main.main');
  var bnav=document.querySelector('.bnav');
  if(header) header.style.visibility='';
  if(mainEl)  mainEl.style.visibility='';
  if(bnav)    bnav.style.visibility='';
  if(!_appStarted){ _appStarted=true; startApp(); }
}

// ─── PUBLIC API (called from settings etc) ────────────────────────────────────
function pinKey(digit){ _pinAddDigit(digit); }   // kept for any remaining callers
function pinDel()     { _pinDeleteDigit(); }

function pinShowChange(){
  _pinChanging=true; _pinStep=0; _pinBuf=''; _pinTempNew=''; _pinLocked=false;
  _pinSetLabel('Enter Current PIN');
  _pinClearError();
  updatePinDots(0);
}// Show actual shop name on PIN screen// ─── BUILD PIN PAD WITH JS — single event listener, no inline handlers ────────
// Uses pointer events (works on both mouse and touch, no double-fire)
function _buildPinPad(){
  var pad = document.getElementById('pin-pad');
  if(!pad) return;
  var keys = ['1','2','3','4','5','6','7','8','9','','0','del'];
  pad.innerHTML = '';
  keys.forEach(function(k){
    var btn = document.createElement('button');
    btn.type = 'button';
    if(k === ''){
      btn.className = 'pin-btn empty';
      btn.setAttribute('aria-hidden','true');
    } else if(k === 'del'){
      btn.className = 'pin-btn del';
      btn.innerHTML = '&#9003;';
      btn.setAttribute('aria-label','Delete');
    } else {
      btn.className = 'pin-btn';
      btn.textContent = k;
    }
    if(k !== ''){
      // Use pointerdown — fires once on both touch and mouse, no 300ms delay
      btn.addEventListener('pointerdown', function(e){
        e.preventDefault();
        btn.classList.add('pressed');
        if(k === 'del') _pinDeleteDigit();
        else _pinAddDigit(k);
      });
      btn.addEventListener('pointerup',   function(){ btn.classList.remove('pressed'); });
      btn.addEventListener('pointerleave',function(){ btn.classList.remove('pressed'); });
    }
    pad.appendChild(btn);
  });

  // Wire Change PIN and Forgot PIN buttons by ID (not inline handlers)
  var changeBtn = document.getElementById('pin-change-btn');
  var forgotBtn = document.getElementById('pin-forgot-btn');
  if(changeBtn) changeBtn.addEventListener('pointerdown', function(e){
    e.preventDefault(); pinShowChange();
  });
  if(forgotBtn) forgotBtn.addEventListener('pointerdown', function(e){
    e.preventDefault(); pinResetToDefault();
  });
}

// Build the pad as soon as DOM is ready
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', _buildPinPad);
} else {
  _buildPinPad();
}

function lockApp(){
  clearPinSession();
  pinBuffer=''; pinChanging=false; pinChangeStep=0; pinNewBuffer=''; pinTempNew=''; pinLocked=false;
  updatePinDots(0);
  var ov=document.getElementById('inactivity-overlay');
  if(ov) ov.classList.remove('show');
  _inactOverlayShown=false;
  clearTimeout(_inactTimer);
  updatePinShopName();
  var l=document.getElementById('pin-label'); var e=document.getElementById('pin-error');
  var ps=document.getElementById('pin-screen');
  if(l) l.textContent='Enter PIN'; if(e) e.textContent=''; if(ps) ps.classList.remove('hidden');
  var header=document.querySelector('header.topbar');
  var mainEl=document.querySelector('main.main');
  var bnav=document.querySelector('.bnav');
  if(header) header.style.visibility='hidden';
  if(mainEl)  mainEl.style.visibility='hidden';
  if(bnav)    bnav.style.visibility='hidden';
  _enforceFullScreenLock();
}

// ── DEFENSIVE FULL-SCREEN ENFORCEMENT ────────────────────────────────
// Older Android WebViews can mis-size position:fixed overlays (stale vh
// units, viewport not yet settled after rotation/keyboard). This forces
// the lock screens to cover the true visible viewport using measured
// pixel dimensions instead of relying purely on CSS units.
function _enforceFullScreenLock(){
  [document.getElementById('pin-screen'), document.getElementById('inactivity-overlay')].forEach(function(el){
    if(!el) return;
    var w = window.innerWidth  || document.documentElement.clientWidth;
    var h = window.innerHeight || document.documentElement.clientHeight;
    el.style.width  = w + 'px';
    el.style.height = h + 'px';
    el.style.top = '0'; el.style.left = '0'; el.style.right = '0'; el.style.bottom = '0';
  });
}
['resize','orientationchange'].forEach(function(ev){
  window.addEventListener(ev, function(){
    // Only reassert if a lock screen is actually visible right now
    var ps=document.getElementById('pin-screen');
    var ov=document.getElementById('inactivity-overlay');
    var psVisible = ps && !ps.classList.contains('hidden');
    var ovVisible = ov && ov.classList.contains('show');
    if(psVisible||ovVisible) setTimeout(_enforceFullScreenLock, 50);
  });
});

// Show actual shop name on PIN screen
function updatePinShopName(){
  var el = document.getElementById('pin-shop-name');
  if(!el) return;
  var name = (SAAS && SAAS.shop && SAAS.shop.name) ? SAAS.shop.name : 'JewelOS';
  el.textContent = name;
}

// Forgot PIN — verifies identity via email then resets to 1234
function pinResetToDefault(){
  safeConfirm(
    'Forgot PIN?',
    'This will reset your PIN to 1234. You can change it after logging in. Continue?',
    function(){
      localStorage.removeItem(_PIN_KEY());
      localStorage.removeItem(_PIN_SALT_KEY());
      pinBuffer=''; pinLocked=false; pinChanging=false; pinChangeStep=0;
      updatePinDots(0);
      var e = document.getElementById('pin-error');
      if(e) e.textContent = 'PIN reset to 1234. Enter it now.';
      var l = document.getElementById('pin-label');
      if(l) l.textContent = 'Enter PIN';
    }
  );
}


// ── CORE APP START — called after auth + PIN verified ─────────────────
var _startAppRunning = false;
var _appStarted = false; // used by PIN module
function doStartApp(){
  if(_startAppRunning) return;
  _startAppRunning = true;
  _appStarted = true;

  // Always repair data first
  // FIX: `cached` now reflects whether loadCache() actually accepted a
  // cache for THIS shop (see loadCache's shopId check), not just whether
  // the ssj_cache key happened to exist — that raw-existence check was
  // the reason a new/different account could render a previous account's
  // cached dashboard before the cloud fetch below had a chance to run.
  var cached = false;
  try{ cached = loadCache(); }catch(e){}
  try{ normaliseData(); }catch(e){}

  // Dismiss loading screen unconditionally
  var loadEl = document.getElementById('loading-screen');
  if(loadEl) loadEl.classList.add('hidden');
  var offBtn = document.getElementById('loading-offline-btn');
  if(offBtn) offBtn.style.display = 'none';

  if(typeof initSplitPayments==='function') try{initSplitPayments();}catch(e){}
  if(typeof initInactivityWatcher==='function') try{initInactivityWatcher();}catch(e){}
  try{setSaleFormBillType('gst');}catch(e){}
  try{updateHeaderUI();}catch(e){}

  if(cached){
    try{ renderDash(); }catch(e){}
    setSyncStatus('syncing','Syncing...');
    loadFromCloud(function(err){
      try{ normaliseData(); saveCache(); renderDash(); }catch(e){}
      if(!err){ setSyncStatus('ok','Live'); try{startAutoRefresh();}catch(e){} }
      else{ setSyncStatus('err','Offline'); toast('Offline — showing cached data.'); }
    });
  } else {
    // First-ever load — fetch from cloud then render
    if(loadEl) loadEl.classList.remove('hidden');
    var msg = document.getElementById('loading-msg');
    if(msg) msg.textContent = 'Loading your data...';
    loadFromCloud(function(err){
      if(loadEl) loadEl.classList.add('hidden');
      try{normaliseData();}catch(e){}
      if(!err){ try{saveCache(); startAutoRefresh();}catch(e){} setSyncStatus('ok','Live'); }
      else{ setSyncStatus('err','Offline'); toast('No internet — data may be empty.'); }
      try{renderDash();}catch(e){}
    });
  }
}

function startApp(){ doStartApp(); }

// ─── STARTUP: handled by window.onload below ─────────────────────────
// PIN + SaaS auth unified in the onload handler — do NOT boot here.
// (Inline boot removed: it ran before DOM was ready causing race conditions)


// ══════════════════════════════════════════════════════════════════════
// ─── GIRVI MODULE ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

var GIRVI_AT_RISK_DAYS  = 60;
var GIRVI_DEFAULT_DAYS  = 120;
var _currentPayGid = null; // stores gid for active payment modal

function girviDaysSince(dateStr, endDateStr){
  if(!dateStr) return 0;
  var endMs = endDateStr ? new Date(endDateStr).getTime() : Date.now();
  return Math.max(0, Math.floor((endMs-new Date(dateStr).getTime())/86400000));
}
// Safe ledger append — never crashes on legacy data missing the array
function girviLog(g, type, note, extra){
  if(!g) return;
  if(!g.ledger) g.ledger = [];
  var entry = Object.assign({type:type||'edit', note:note||'', ts:new Date().toISOString()}, extra||{});
  g.ledger.push(entry);
}
// ── DAY-BASED interest calculation ──────────────────────────────────
// Fixes the month-rounding bug: a loan from Jan 31 → Feb 14 = 14 days
// of interest, not 0 months. Daily rate = annual_rate / 365.
// ── HUID VALIDATION ─────────────────────────────────────────────────
// BIS Hallmark Unique ID format: exactly 6 uppercase alphanumeric chars
var HUID_REGEX = /^[A-Z0-9]{6}$/;
function validateHUID(huid){
  if(!huid || huid.trim()==='') return {ok:true, msg:''}; // blank is allowed (not all items hallmarked)
  var h = huid.trim().toUpperCase();
  if(!HUID_REGEX.test(h)) return {ok:false, msg:'HUID must be exactly 6 uppercase letters/numbers (e.g. AB1234). Got: '+h};
  return {ok:true, msg:''};
}

function girviDailyRate(g){
  var r = parseFloat(g.interestRate) || 0;
  if(g.rateType === 'yearly')  return r / 100 / 365;
  if(g.rateType === 'monthly') return r / 100 / 30;
  return r / 100 / 30; // default monthly
}

// Returns {years, months, days, totalDays} for display (Feature 3)
// Uses calendar-accurate month subtraction so Feb/31-day months are correct.
function girviExactDuration(startDateStr, endDateStr){
  var s = new Date(startDateStr);
  var e = endDateStr ? new Date(endDateStr) : new Date();
  if(isNaN(s.getTime())) return {years:0,months:0,days:0,totalDays:0};
  var totalDays = Math.max(0, Math.floor((e.getTime()-s.getTime())/86400000));
  // Calendar subtraction
  var years=0,months=0,days=0;
  var y=e.getFullYear()-s.getFullYear();
  var m=e.getMonth()-s.getMonth();
  var d=e.getDate()-s.getDate();
  if(d<0){
    m--;
    // Days in previous month relative to e
    var prevMonth=new Date(e.getFullYear(),e.getMonth(),0);
    d+=prevMonth.getDate();
  }
  if(m<0){y--;m+=12;}
  return {years:Math.max(0,y),months:Math.max(0,m),days:Math.max(0,d),totalDays:totalDays};
}
// ── GIRVI LEDGER WALK ────────────────────────────────────────────────
// Single source of truth for reducing-balance interest.
// Replays every payment in chronological order against the ORIGINAL
// principal (g.principal is never mutated), applying an interest-first
// waterfall at each payment: accrued interest is settled before any
// amount is applied to principal. This fixes two bugs present in the
// old day-count model:
//   1) Partial/full payments now actually reduce the principal that
//      future interest accrues on (previously interest kept accruing
//      on the full original principal forever).
//   2) Each payment gets an exact interestPortion/principalPortion at
//      the moment it happened, so historical P&L reporting doesn't have
//      to guess using today's live accrued-interest snapshot.
// 'interest' type payments are pinned to interest only (never reduce
// principal), matching existing UI intent even if overpaid (the
// surplus becomes a negative pendingInterest / prepaid credit).
function girviLedgerState(g, asOfDate){
  var p = parseFloat(g && g.principal) || 0;
  if(!g || p <= 0) return {principal:0, interestAccrued:0, outstanding:0, totalInterestPaid:0, totalPrincipalPaid:0, payments:[]};
  var asOf = asOfDate ? new Date(asOfDate) : new Date();
  var cursor = new Date(g.startDate);
  if(isNaN(cursor.getTime())) cursor = new Date();
  var remainingPrincipal = p;
  var pendingInterest = 0;
  var totalInterestPaid = 0, totalPrincipalPaid = 0;
  var annotated = [];

  function accrueTo(uptoDate){
    var days = Math.floor((uptoDate.getTime()-cursor.getTime())/86400000);
    if(days <= 0) return;
    var rate = girviDailyRate(g);
    var interest;
    if(g.compound){
      var safeDays = Math.min(days, 10950);
      var factor   = Math.pow(1+rate, safeDays);
      interest = isFinite(factor) ? remainingPrincipal*(factor-1) : remainingPrincipal*rate*days;
    } else {
      interest = remainingPrincipal * rate * days;
    }
    pendingInterest += interest;
    cursor = uptoDate;
  }

  var pays = (g.payments||[]).slice().sort(function(a,b){
    return new Date(a.date||a.ts) - new Date(b.date||b.ts);
  });

  pays.forEach(function(pay){
    var payDate = new Date(pay.date||pay.ts);
    if(isNaN(payDate.getTime()) || payDate < cursor) payDate = cursor; // ignore malformed/backdated entries
    accrueTo(payDate);
    var amt = parseFloat(pay.amount) || 0;
    if(pay.type === 'penalty' || pay.type === 'refund'){
      // These INCREASE what's owed, not reduce it — a manually-charged
      // penalty or an issued refund both add to the outstanding balance
      // going forward (and will themselves start accruing interest, same
      // as the rest of the principal).
      remainingPrincipal += amt;
      annotated.push(Object.assign({}, pay, {interestPortion:0, principalPortion:-amt}));
      return;
    }
    var toInterest, toPrincipal;
    if(pay.type === 'interest'){
      toInterest = amt;
      toPrincipal = 0;
    } else {
      toInterest  = Math.min(amt, Math.max(0, pendingInterest));
      toPrincipal = Math.min(amt - toInterest, remainingPrincipal);
    }
    pendingInterest     -= toInterest;
    remainingPrincipal  -= toPrincipal;
    totalInterestPaid   += toInterest;
    totalPrincipalPaid  += toPrincipal;
    annotated.push(Object.assign({}, pay, {interestPortion:toInterest, principalPortion:toPrincipal}));
  });

  accrueTo(asOf);
  remainingPrincipal = Math.max(0, remainingPrincipal);
  pendingInterest     = isFinite(pendingInterest) ? pendingInterest : 0;

  return {
    principal: remainingPrincipal,
    interestAccrued: Math.max(0, pendingInterest),
    outstanding: Math.max(0, remainingPrincipal + pendingInterest),
    totalInterestPaid: totalInterestPaid,
    totalPrincipalPaid: totalPrincipalPaid,
    payments: annotated
  };
}
function girviOutstanding(g){
  if(!g) return 0;
  var result = girviLedgerState(g).outstanding;
  return isFinite(result) ? result : (parseFloat(g.principal)||0);
}
function girviInterestAccrued(g){
  return girviLedgerState(g).interestAccrued;
}

// ── Financer margin tracking (additive — added Aug 2026) ────────────────
// Purely new, separate from the customer-side interest engine above. Many
// jewellery Girvi shops fund their pledge lending from a financer at a
// lower rate (typically 1-1.1%) and lend to the customer at a higher rate
// (typically 2%) — the difference is the shop's margin on that loan. This
// tracks that second, independent relationship without touching
// girviLedgerState/girviInterestAccrued at all: customer-side payments,
// waterfalls, and penalties are completely unaffected by whether a loan
// has financer details attached, and a loan with no financerRate simply
// shows no margin section.
//
// Deliberately simple flat day-rate accrual (principal * rate * days),
// NOT the same interest-first payment waterfall the customer side uses —
// the financer relationship in real shop practice is usually just "we owe
// them simple interest on however much of their money is still out,"
// independent of how the customer chooses to pay down their own loan.
function girviHasFinancer(g){
  return !!(g && g.financerName && parseFloat(g.financerRate) > 0);
}
function girviFinancerDailyRate(g){
  var r = parseFloat(g.financerRate) || 0;
  if(g.financerRateType === 'yearly') return r / 100 / 365;
  return r / 100 / 30; // default monthly, matching the customer-side default
}
function girviFinancerInterestAccrued(g){
  if(!girviHasFinancer(g)) return 0;
  var principal = parseFloat(g.principal) || 0;
  var days = (g.status==='closed' && g.closedDate)
    ? girviDaysSince(g.startDate, g.closedDate)
    : girviDaysSince(g.startDate);
  return Math.round(principal * girviFinancerDailyRate(g) * days);
}
// Owner's margin on this loan: what the customer owes in interest, minus
// what's owed to the financer for the same funding period.
function girviMargin(g){
  if(!girviHasFinancer(g)) return null;
  var customerInterest = girviInterestAccrued(g);
  var financerInterest = girviFinancerInterestAccrued(g);
  return { customerInterest: customerInterest, financerInterest: financerInterest, margin: customerInterest - financerInterest };
}
function girviTotalPaid(g){
  // Total cash received from customer — excludes penalty (a charge, not a
  // receipt) and refund (money given back, the opposite direction).
  return (g.payments||[]).reduce(function(s,x){
    if(x.type==='penalty' || x.type==='refund') return s;
    return s+(parseFloat(x.amount)||0);
  }, 0);
}
// Monthly interest shown on card (for display only — actual accrual is day-based)
function girviMonthlyInterest(g){
  var p = parseFloat(g.principal) || 0;
  return p * girviDailyRate(g) * 30;
}
function girviComputeStatus(g){
  if(g.status==='closed'||g.status==='defaulted') return g.status;
  var days=girviDaysSince(g.startDate),dur=parseInt(g.duration)||0;
  var dueDays=dur?dur*30:0,overdueDays=dueDays?Math.max(0,days-dueDays):0;
  if(dueDays&&overdueDays>=GIRVI_DEFAULT_DAYS) return 'defaulted';
  if(dueDays&&overdueDays>=GIRVI_AT_RISK_DAYS) return 'atrisk';
  if(dueDays&&days>dueDays) return 'overdue';
  return 'active';
}
function girviStatusBadge(s){
  var m={active:['#22c55e','Active'],overdue:['#f59e0b','Overdue'],atrisk:['#ef4444','At Risk'],defaulted:['#7f1d1d','Defaulted'],closed:['#64748b','Closed']};
  var v=m[s]||m['active'];
  return '<span style="background:'+v[0]+'22;color:'+v[0]+';font-size:10px;font-weight:700;padding:3px 9px;border-radius:100px;border:1px solid '+v[0]+'44;text-transform:uppercase;letter-spacing:.05em;">'+v[1]+'</span>';
}
function girviRiskBadge(r){
  var m={low:'#22c55e',medium:'#f59e0b',high:'#ef4444'},c=m[r]||m['medium'];
  return '<span style="background:'+c+'22;color:'+c+';font-size:10px;font-weight:600;padding:2px 7px;border-radius:100px;">'+(r?r.charAt(0).toUpperCase()+r.slice(1):'Med')+'</span>';
}

// Patch normaliseData
(function(){
  var _orig=normaliseData;
  normaliseData=function(){
    _orig();
    (S.girvi||[]).forEach(function(g){
      g.payments=g.payments||[];g.ledger=g.ledger||[];
      g.principal=parseFloat(g.principal)||0;g.interestRate=parseFloat(g.interestRate)||0;
      if(g.status!=='closed') g.status=girviComputeStatus(g);
    });
    if(!S.nextGirviId) S.nextGirviId=(S.girvi||[]).length+1;
  };
}());function closeGirviManual(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});if(!g)return;
  var outstanding=girviOutstanding(g);
  var closeMsg = outstanding>1
    ? 'Outstanding \u20b9'+Math.round(outstanding).toLocaleString('en-IN')+' still pending. Force-close anyway?'
    : 'Release item and close Girvi '+g.grvNo+'?';
  safeConfirm('Close '+g.grvNo+'?', closeMsg, function(){
    g.status='closed'; g.closedAt=new Date().toISOString();
    if(!g.ledger)g.ledger=[];
    g.ledger.push({type:'closed',note:'Manually closed',ts:new Date().toISOString()});
    closeGirviDetail();
    saveToCloud(function(err){if(!err){renderGirvi();renderDash();toast('Girvi '+g.grvNo+' closed');}});
  }, outstanding>1);
  return;
}

function markGirviDefault(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});if(!g)return;
  safeConfirm('Mark as defaulted?','Mark Girvi '+g.grvNo+' as DEFAULTED? This changes its status permanently.',function(){
    g.status='defaulted';
    if(!g.ledger)g.ledger=[];
    g.ledger.push({type:'defaulted',note:'Marked as defaulted',ts:new Date().toISOString()});
    closeGirviDetail();
    saveToCloud(function(err){if(!err){renderGirvi();renderDash();toast('Girvi '+g.grvNo+' marked defaulted');}});
  },true);
  return;
}

function deleteGirviEntry(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});if(!g)return;
  if(g.status==='closed'){toast('Closed entries cannot be deleted');return;}
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  safeConfirm('Archive '+g.grvNo+'?','This will archive (soft-delete) the record. It can be recovered from the Archived tab.',function(){
    g._deleted=true;
    g._deletedAt=new Date().toISOString();
    g._deletedBy=currentUser;
    if(!g.ledger)g.ledger=[];
    g.ledger.push({type:'deleted',note:'Archived by '+currentUser,ts:new Date().toISOString(),user:currentUser});
    if(typeof auditLog==='function') auditLog('delete','girvi',g.id,'Archived by '+currentUser);
    closeGirviDetail();
    saveToCloud(function(err){if(!err){renderGirvi();renderDash();toast('📦 Girvi '+g.grvNo+' archived');}});
  },true);
}

function recoverGirviEntry(gid){
  var g=(S.girvi||[]).find(function(x){return x.id===gid;});if(!g)return;
  var currentUser=(typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User';
  delete g._deleted; delete g._deletedAt; delete g._deletedBy;
  if(!g.ledger)g.ledger=[];
  g.ledger.push({type:'edit',note:'Recovered from archive by '+currentUser,ts:new Date().toISOString(),user:currentUser});
  saveToCloud(function(err){if(!err){renderGirvi();toast('✅ Girvi '+g.grvNo+' recovered');}});
}

// ═══ END GIRVI MODULE ═══


// ══════════════════════════════════════════════════════════════════════
// ─── JEWELOS SAAS ENGINE ─────────────────────────────────────────────
// Multi-tenant auth, shop isolation, role-based access, activity log,
// feature gating, plan management, settings panel, WhatsApp, backup
// ══════════════════════════════════════════════════════════════════════

// ── SAAS STATE ──────────────────────────────────────────────────────
var SAAS = {
  user:     null,   // { id, email, name, role }
  shop:     null,   // { id, name, city, phone, gstin, plan, locale }
  session:  null,   // Supabase session token
  plan:     'pro',  // plans removed — always pro
  staffList:[],
  activityLog:[]
};

// ── PLAN LIMITS ─────────────────────────────────────────────────────
var _PRO_LIMITS = { maxProducts:999999, maxUsers:999, girvi:true, reports:true, whatsapp:true, orders:true, csvExport:true };
var PLAN_LIMITS = { free:_PRO_LIMITS, basic:_PRO_LIMITS, pro:_PRO_LIMITS };

// ── SUBSCRIPTION WINDOW ──────────────────────────────────────────────
// Orthogonal to PLAN_LIMITS. Plans answer "which features"; this answers
// "is the subscription current". One product, one price — nothing here
// looks at SAAS.plan and nothing here should ever be made to.
//
// SAAS.shop.paidUntil is set by Tanish through Supabase and arrives on the
// shop record from auth-gateway at login. The client only ever READS it:
// auth_store is server-written, and update-shop takes a five-field
// allow-list that does not include paidUntil, so a shop cannot extend its
// own subscription. (The shop's own JSON blob would have been the wrong
// home for exactly that reason — it is client-writable via store-proxy.)
//
// Enforcement here is client-side and bypassable in devtools. That is a
// deliberate, accepted trade for now; real enforcement belongs in
// store-proxy later.
var SUB_GRACE_DAYS = 7;   // full access continues this long past paidUntil
var SUB_WARN_DAYS  = 7;   // banner starts this many days before paidUntil

function subPaidUntil(){
  var raw = (typeof SAAS !== 'undefined' && SAAS.shop) ? SAAS.shop.paidUntil : null;
  if(!raw) return null;
  // A bare 'YYYY-MM-DD' is parsed as UTC midnight by the Date constructor,
  // which reads back as the PREVIOUS day anywhere behind UTC — the shop would
  // lose a day of subscription. Build it from local parts instead. Anything
  // with a time in it (a full ISO timestamp) is left to the parser.
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
            : new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

// Whole days from today to paidUntil. 0 = expires today (still paid).
// Negative = days since it lapsed. null = no date on the record.
function subDaysLeft(){
  var until = subPaidUntil();
  if(!until) return null;
  var today = new Date(); today.setHours(0,0,0,0);
  var end   = new Date(until.getFullYear(), until.getMonth(), until.getDate());
  return Math.round((end - today) / 86400000);
}

// 'ok' | 'warn' | 'grace' | 'readonly'
// No paidUntil means no restriction. Every shop that exists today has no
// value yet, and a deploy must never lock anybody out of their own books.
function subState(){
  var d = subDaysLeft();
  if(d === null)              return 'ok';
  if(d > SUB_WARN_DAYS)       return 'ok';
  if(d >= 0)                  return 'warn';       // ends today or within a week
  if(d >= -SUB_GRACE_DAYS)    return 'grace';      // lapsed, still full access
  return 'readonly';
}

function subReadOnly(){ return subState() === 'readonly'; }

// Gate for the four things read-only stops: a new bill/sale, a purchase
// bill, and a new girvi loan. Everything else stays open on purpose —
// login, viewing, printing, backup, and taking a girvi repayment.
// Returns true when the action may proceed.
function subGuard(action){
  if(!subReadOnly()) return true;
  toast('⚠ Subscription expired — ' + action + ' is paused. You can still view, print and back up your data.');
  return false;
}

function subPaidUntilText(){
  var until = subPaidUntil();
  if(!until) return null;
  var mm = String(until.getMonth() + 1); if(mm.length < 2) mm = '0' + mm;
  var dd = String(until.getDate());      if(dd.length < 2) dd = '0' + dd;
  return fmtDate(until.getFullYear() + '-' + mm + '-' + dd);
}

// The "Paid until <date>" line for Settings → Account, so Tanish can tell a
// shop where it stands without asking anyone. Returns '' when no paidUntil is
// set, rather than inventing a status for a shop never given one.
function subAccountLineHtml(){
  var when = subPaidUntilText();
  if(!when) return '';
  var st = subState();
  var colour = (st === 'ok') ? 'var(--success)' : (st === 'warn') ? 'var(--warning)' : 'var(--danger)';
  var suffix = (st === 'grace')    ? ' — ended, in grace period'
             : (st === 'readonly') ? ' — expired, read-only'
             : '';
  return '<div style="margin-top:6px;">Paid until <b style="color:' + colour + ';">' +
         escHtml(when) + '</b>' + suffix + '</div>';
}

// The warn banner is dismissible, but the dismissal is keyed to the day, so
// it comes back tomorrow and the shop cannot click once and forget about it
// for a week. Grace and read-only cannot be dismissed at all.
function _subDismissKey(){
  return (typeof shopScopedKey === 'function')
    ? shopScopedKey('jewelos_sub_banner_dismissed')
    : 'jewelos_sub_banner_dismissed';
}

// Local calendar day, not toISOString()'s UTC one. subDaysLeft() counts from
// local midnight, so the dismissal has to roll over at local midnight too —
// otherwise "tomorrow" arrives at 05:30 in India and the two halves of this
// feature disagree about what day it is.
function _subToday(){
  var d = new Date();
  var mm = String(d.getMonth() + 1); if(mm.length < 2) mm = '0' + mm;
  var dd = String(d.getDate());      if(dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function subDismissBanner(){
  try{ localStorage.setItem(_subDismissKey(), _subToday()); }catch(e){}
  renderSubBanner();
}

function renderSubBanner(){
  var el = document.getElementById('sub-banner');
  if(!el) return;
  var state = subState();
  var when  = subPaidUntilText();

  if(state === 'ok'){
    el.className = ''; el.innerHTML = '';
    if(document.body) document.body.classList.remove('sub-banner-on');
    return;
  }

  if(state === 'warn'){
    var today = _subToday();
    var seen = null;
    try{ seen = localStorage.getItem(_subDismissKey()); }catch(e){}
    if(seen === today){
      el.className = ''; el.innerHTML = '';
      if(document.body) document.body.classList.remove('sub-banner-on');
      return;
    }
    var d = subDaysLeft();
    el.className = 'visible warn';
    el.innerHTML = '⏳ Your subscription ends on ' + escHtml(when) +
      (d === 0 ? ' — today' : ' — ' + d + ' day' + (d === 1 ? '' : 's') + ' left') +
      '<button class="sub-x" onclick="subDismissBanner()" title="Hide until tomorrow">✕</button>';
  } else if(state === 'grace'){
    el.className = 'visible lapsed';
    el.innerHTML = '⚠ Your subscription ended on ' + escHtml(when) +
      '. Renew to keep billing — everything still works for now.';
  } else {
    el.className = 'visible lapsed';
    el.innerHTML = '🔒 Subscription expired on ' + escHtml(when) +
      ' — read-only. You can still view, print and back up your data.';
  }
  if(document.body) document.body.classList.add('sub-banner-on');
}

// ── SUPABASE SAAS TABLE KEYS ─────────────────────────────────────────
// Each shop gets its own row in Supabase `store` table, keyed by shop_id
// FIX v18: All fetch calls now use _getShopRowKey() — no hardcoded 'main'
// SHOP_ROW_KEY is set by saasSetSession after login (shop.rowKey || shop.id)
var SHOP_ROW_KEY = 'main'; // default; overridden after auth

// ── AUTH HELPERS ─────────────────────────────────────────────────────
var AUTH_KEY   = 'jewelos_session';
var SESSION_TOKEN_KEY = 'jewelos_session_token'; // sessionStorage only — bearer credential, not a cache
var SHOP_KEY   = 'jewelos_shop';
var USERS_KEY  = 'jewelos_users';
var SHOPS_KEY  = 'jewelos_shops';
// NOTE: direct REST access to `auth_store` (SB_AUTH_REST) is retired —
// that table is locked down by 001_lockdown_rls.sql. All reads/writes now
// go through authGatewayCall() → the auth-gateway Edge Function.

// ── LOCAL CACHE (fast read, survives offline) ─────────────────────────
function saasGetUsers(){ try{ return JSON.parse(localStorage.getItem(USERS_KEY)||'[]'); }catch(e){ return []; } }
function saasGetShops(){ try{ return JSON.parse(localStorage.getItem(SHOPS_KEY)||'[]'); }catch(e){ return []; } }
function saasSetUsers(u){
  // Local device cache ONLY — this device's own user record(s), populated
  // from login/signup/add-staff/remove-staff responses. No longer pushed
  // to auth_store directly; that table is locked down (see 001_lockdown_rls.sql)
  // and every mutation now happens server-side inside the auth-gateway
  // Edge Function that made the change.
  try{ localStorage.setItem(USERS_KEY, JSON.stringify(u)); } catch(e){ console.warn('[JewelOS] localStorage quota exceeded saving users'); }
}
function saasSetShops(s){
  try{ localStorage.setItem(SHOPS_KEY, JSON.stringify(s)); } catch(e){ console.warn('[JewelOS] localStorage quota exceeded saving shops'); }
}

// ── DEPRECATED — kept as no-op stubs so old call sites don't throw ─────
// auth_store is locked down (001_lockdown_rls.sql); there is no more
// "fetch everyone's users+shops" or "push our copy of everyone's users+
// shops" operation, by design — a shop's browser should never have had
// download access to every other shop's password hashes in the first
// place. Each device's local cache (USERS_KEY/SHOPS_KEY) is populated
// directly from the response of login/signup/add-staff/remove-staff via
// authGatewayCall(), which only ever returns this shop's own data.
function saasLoadAuthFromCloud(callback){ if(callback) callback(null); }
function saasSaveAuthToCloud(){ /* no-op — see comment above */ }

// ── AUTH SCREEN ──────────────────────────────────────────────────────
function _hideLoadingScreen(){
  var loadEl = document.getElementById('loading-screen');
  if(loadEl) loadEl.classList.add('hidden');
  var btn = document.getElementById('loading-offline-btn');
  if(btn) btn.style.display = 'none';
}

function showAuthScreen(){
  _hideLoadingScreen(); // always dismiss loading before showing auth
  document.getElementById('saas-auth-screen').style.display = 'flex';
  document.getElementById('saas-onboard-screen').style.display = 'none';
  var header = document.querySelector('header.topbar');
  var mainEl  = document.querySelector('main.main');
  var bnav    = document.querySelector('.bnav');
  if(header) header.style.display = 'none';
  if(mainEl)  mainEl.style.display  = 'none';
  if(bnav)    bnav.style.display    = 'none';
}

function hideAuthScreen(){
  _hideLoadingScreen();
  document.getElementById('saas-auth-screen').style.display = 'none';
  document.getElementById('saas-onboard-screen').style.display = 'none';
  var header = document.querySelector('header.topbar');
  var mainEl  = document.querySelector('main.main');
  var bnav    = document.querySelector('.bnav');
  if(header) header.style.display = '';
  if(mainEl)  mainEl.style.display  = '';
  if(bnav)    bnav.style.display    = '';
}

function showAuthTab(tab){
  document.getElementById('auth-login-form').style.display  = tab==='login'  ? '' : 'none';
  document.getElementById('auth-signup-form').style.display = tab==='signup' ? '' : 'none';
  document.getElementById('auth-tab-login').classList.toggle('active',  tab==='login');
  document.getElementById('auth-tab-signup').classList.toggle('active', tab==='signup');
}

// ── ASYNC HASH (PBKDF2) ──────────────────────────────────────────────
async function saasHashPassword(pw, saltHex){
  if(!saltHex){
    var arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    saltHex = Array.from(arr).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  var enc = new TextEncoder();
  var key = await crypto.subtle.importKey('raw', enc.encode(pw), {name:'PBKDF2'}, false, ['deriveBits']);
  var bits = await crypto.subtle.deriveBits(
    {name:'PBKDF2', salt:enc.encode(saltHex), iterations:100000, hash:'SHA-256'},
    key, 256
  );
  var hash = Array.from(new Uint8Array(bits)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  return {hash: 'pbkdf2:'+hash, salt: saltHex};
}

// ── AUTH GATEWAY — replaces direct client reads/writes of auth_store ───
// All login/signup/staff-management now goes through this Edge Function,
// which holds the service_role key server-side. The browser never again
// downloads the full users/shops table.
function authGatewayCall(route, body){
  return fetch(SB_FUNCTIONS + '/auth-gateway/' + route, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey':SB_KEY, 'Authorization':'Bearer '+SB_KEY },
    body: JSON.stringify(body || {})
  }).then(function(r){
    return r.json().then(function(data){
      if(!r.ok) throw Object.assign(new Error(data.error || ('HTTP '+r.status)), {status:r.status, data:data});
      return data;
    });
  });
}

async function saasVerifyPassword(pw, storedHash, salt){
  var result = await saasHashPassword(pw, salt);
  return result.hash === storedHash;
}

// ── SIGN UP ──────────────────────────────────────────────────────────
function saasSignup(){
  var name     = (document.getElementById('signup-name').value||'').trim();
  var email    = (document.getElementById('signup-email').value||'').trim().toLowerCase();
  var password = (document.getElementById('signup-password').value||'');
  var shopName = (document.getElementById('signup-shop').value||'').trim();
  var city     = (document.getElementById('signup-city').value||'').trim();
  var errEl    = document.getElementById('auth-signup-err');

  errEl.textContent = '';
  if(!name)     { errEl.textContent='Name is required'; return; }
  if(!email || !email.includes('@')) { errEl.textContent='Enter a valid email'; return; }
  if(password.length < 8) { errEl.textContent='Password must be at least 8 characters'; return; }
  if(!shopName) { errEl.textContent='Shop name is required'; return; }

  errEl.textContent = '\u23f3 Creating account...';
  var signupBtn = document.querySelector('#auth-signup-form .auth-btn');
  if(signupBtn) signupBtn.disabled = true;

  // Account creation (ID generation, rowKey via crypto.randomUUID(),
  // password hashing, duplicate-email check) now happens server-side in
  // auth-gateway — the client no longer builds these records itself or
  // writes them to auth_store directly.
  authGatewayCall('signup', {name:name, email:email, password:password, shopName:shopName, city:city})
    .then(function(res){
      if(signupBtn) signupBtn.disabled = false;
      saasSetSession(res.user, res.shop, res.sessionToken);
      hideAuthScreen();
      showOnboardingScreen();
    })
    .catch(function(err){
      if(signupBtn) signupBtn.disabled = false;
      errEl.textContent = (err.data && err.data.error) ? err.data.error : 'Sign-up failed. Check your connection and try again.';
    });
}

// ── SIGN IN ──────────────────────────────────────────────────────────
// ── LOGIN RATE LIMITING ───────────────────────────────────────────────
var _loginAttempts = 0;
var _loginLockedUntil = 0;

