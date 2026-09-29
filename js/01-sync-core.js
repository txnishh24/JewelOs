function setSyncStatus(status, label){
  // Track last status for diagnostics
  if(typeof window !== 'undefined') window._lastSyncStatus = {status:status, label:label, ts:Date.now()};
  var dot = document.getElementById('sync-dot');
  var lbl = document.getElementById('sync-label');
  var bar = document.getElementById('sync-bar-inner');
  dot.className = 'sync-dot ' + status;
  lbl.textContent = label;
  if(status==='syncing'){
    bar.className='sync-bar-inner syncing';
  } else {
    bar.className='sync-bar-inner done';
    setTimeout(function(){bar.className='sync-bar-inner';bar.style.width='0';},1000);
  }
}

// ── FIX v18: loadFromCloud — shop-key-aware ──────────────────────────
// Uses SHOP_ROW_KEY (set by saasSetSession after login) instead of
// hardcoded 'main'. Falls back gracefully when row doesn't exist yet
// (new shop) rather than treating it as a fatal error.
function _getShopRowKey(){
  // SHOP_ROW_KEY is set by saasSetSession. Fallback: derive from session.
  if(typeof SHOP_ROW_KEY !== 'undefined' && SHOP_ROW_KEY && SHOP_ROW_KEY !== 'main'){
    return SHOP_ROW_KEY;
  }
  // Try to recover from stored session
  try{
    // AUTH_KEY = 'jewelos_session', stores {userId, shopId, ts, token, exp}
    var s = JSON.parse(localStorage.getItem(typeof AUTH_KEY!=='undefined'?AUTH_KEY:'jewelos_session')||'null');
    if(s && s.shopId) return s.shopId;
  }catch(e){}
  // Foundation security fix: the 'main' fallback used to point every
  // session-less client at one shared legacy tenant row. Fail closed
  // instead — store-proxy v5 derives the shop from the session token
  // anyway, so this value is no longer sent.
  return '';
}

function loadFromCloud(callback){
  setSyncStatus('syncing','Syncing...');
  var done = false;
  var shopKey = _getShopRowKey();
  var timer = setTimeout(function(){
    if(!done){ done=true; setSyncStatus('err','Offline'); if(callback) callback(new Error('timeout')); }
  }, 9000);

  fetch(SB_FUNCTIONS + '/store-proxy', {
    method: 'GET',
    headers: Object.assign({}, SB_HEADERS, { 'x-session-token': (typeof SAAS!=='undefined' && SAAS.sessionToken) || '' })
  })
  .then(function(r){
    // store-proxy v5 authenticates the session token, not a shop key —
    // a 401 means the session is gone/expired, not a network problem.
    // Surface it as "sign in again" instead of a generic sync failure.
    if(r.status === 401){
      clearTimeout(timer); done = true;
      setSyncStatus('err','Session expired');
      // Forced, not the confirm-first saasLogout(): this 401 is also what a
      // user removed from the shop gets, and they must not be able to cancel.
      if(typeof saasForceLogout === 'function') saasForceLogout('Your session has ended — please sign in again.');
      throw new Error('unauthenticated');
    }
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then(function(row){
    clearTimeout(timer); if(done) return; done = true;
    // row is null for a brand-new shop (store-proxy returns null, not 404) —
    // nothing to load yet; S already holds sane defaults, and the first
    // saveToCloud() will create the row via the proxy's upsert.
    var record = (row && row.data) ? row.data : {};
    _loadedVersion = _getDataVersion(record); // track for conflict detection
    try{ localStorage.setItem('ssj_last_cloud_load', String(Date.now())); }catch(e){} // throttle stamp
    if(Array.isArray(record.products))  S.products    = record.products;
    if(Array.isArray(record.sales))     S.sales       = record.sales;
    if(Array.isArray(record.orders))    S.orders      = record.orders;
    if(Array.isArray(record.girvi))     S.girvi       = record.girvi;
    if(Array.isArray(record.customers))  S.customers   = record.customers;
    if(Array.isArray(record.purchases))  S.purchases   = record.purchases;
    if(Array.isArray(record.suppliers))  S.suppliers   = record.suppliers;
    if(Array.isArray(record.purchaseAuditLog)) S.purchaseAuditLog = record.purchaseAuditLog;
    if(record.purchaseCfg && typeof record.purchaseCfg === 'object') S.purchaseCfg = Object.assign({}, S.purchaseCfg, record.purchaseCfg);
    if(record.dayBook && typeof record.dayBook === 'object') S.dayBook = record.dayBook;
    if(record.rates && typeof record.rates === 'object') S.rates = record.rates;
    if(record.nextId     > 0) S.nextId     = record.nextId;
    if(record.nextSaleId > 0) S.nextSaleId = record.nextSaleId;
    if(record.nextInvNo  > 0) S.nextInvNo  = record.nextInvNo;
    if(record.nextOrdId  > 0) S.nextOrdId  = record.nextOrdId;
    if(record.nextGirviId> 0) S.nextGirviId= record.nextGirviId;
    if(record.nextPurchaseId    > 0) S.nextPurchaseId    = record.nextPurchaseId;
    if(record.nextPurchaseBillNo> 0) S.nextPurchaseBillNo= record.nextPurchaseBillNo;
    migrateLockRates();
    normaliseData();
    setSyncStatus('ok', 'Live ●');
    if(callback) callback(null);
  })
  .catch(function(err){
    clearTimeout(timer); if(done) return; done = true;
    console.error('[JewelOS] loadFromCloud error:', err);
    setSyncStatus('err', 'Offline');
    if(callback) callback(err);
  });
}

// ── FIX v18: saveToCloud — shop-key-aware + upsert fallback ─────────
// Key fixes:
//   1. Uses SHOP_ROW_KEY (not hardcoded 'main')
//   2. PATCH returning empty [] means row doesn't exist → INSERT via upsert
//   3. isSaving is always reset, even when r.ok check throws inside .then()
//   4. Prefer:return=representation so we detect empty response (no rows matched)
function saveToCloud(callback){
  if(isSaving){ setTimeout(function(){ saveToCloud(callback); }, 400); return; }
  isSaving = true;
  _isSavingSetAt = Date.now();

  // ── BLOB SIZE WARNING ──────────────────────────────────────────────
  // Warn when shop data approaches Supabase's practical row size limit (~3MB)
  // This gives the shop owner time to contact support before data stops saving.
  (function checkBlobSize(){
    try{
      var approxSize = JSON.stringify({
        products:S.products, sales:S.sales, girvi:S.girvi||[],
        orders:S.orders||[], customers:S.customers||[]
      }).length;
      if(approxSize > 2500000 && !window._blobWarnedAt){ // 2.5MB threshold
        window._blobWarnedAt = Date.now();
        console.warn('[JewelOS] Data blob is '+Math.round(approxSize/1024)+'KB — approaching limits. Contact support.');
        toast('\u26a0 Your data is getting large. Contact support to upgrade your storage plan.');
      }
    }catch(e){}
  })();
  saveCache(); // local-first: always persist to localStorage before cloud attempt
  setSyncStatus('syncing','Saving...');
  if(!SB_FUNCTIONS || !SB_KEY){
    isSaving = false;
    console.warn('[JewelOS] saveToCloud: SB_FUNCTIONS not ready, saving locally only');
    if(callback) callback(null); // local save already done
    return;
  }
  if(!Array.isArray(S.products)||!Array.isArray(S.sales)||!Array.isArray(S.girvi)){
    isSaving = false;
    if(callback) callback(new Error('Invalid state'));
    return;
  }
  var shopKey = _getShopRowKey();
  var dataPayload = {
    products:    S.products,
    sales:       S.sales,
    orders:      S.orders    || [],
    girvi:       S.girvi     || [],
    customers:   S.customers || [],
    purchases:   S.purchases || [],
    suppliers:   S.suppliers || [],
    purchaseAuditLog: S.purchaseAuditLog || [],
    // FIX: previously never sent to the cloud at all (see removed no-op
    // wrapper in 05-auth-login.js and the rewritten auditLog() function
    // below) — both silently existed only on whichever single device/
    // browser created them.
    auditLog:    S.auditLog    || [],
    activityLog: S.activityLog || [],
    waRules:     S.waRules     || [],
    purchaseCfg: S.purchaseCfg || {},
    dayBook:     S.dayBook     || null,
    rates:       S.rates,
    nextId:      S.nextId      || 1,
    nextSaleId:  S.nextSaleId  || 1,
    nextInvNo:   S.nextInvNo   || 1,
    nextOrdId:   S.nextOrdId   || 1,
    nextGirviId: S.nextGirviId || 1,
    nextPurchaseId:     S.nextPurchaseId     || 1,
    nextPurchaseBillNo: S.nextPurchaseBillNo || 1
  };
  var retries = 0;
  var delays  = [2000, 5000, 15000];

  function _done_ok(row){
    isSaving = false;
    _isSavingSetAt = 0;
    if(row && row.data && typeof row.data._v === 'number') _loadedVersion = row.data._v;
    setSyncStatus('ok', 'Saved ✓');
    dismissSaveError(); // clear any persistent error banner
    if(callback) callback(null);
  }
  function _done_err(err){
    isSaving = false;
    _isSavingSetAt = 0;
    setSyncStatus('err', 'Save failed');
    showSaveError(); // persistent banner — doesn't auto-dismiss
    console.error('[JewelOS] saveToCloud final error:', err);
    if(callback) callback(err);
  }

  function attempt(){
    // store-proxy does the compare-and-swap server-side now: it only
    // accepts the write if expectedVersion still matches what's stored,
    // and auto-creates the row on a shop's very first save. A 409 with
    // conflict:true means another device saved since we last loaded.
    fetch(SB_FUNCTIONS + '/store-proxy', {
      method: 'PUT',
      headers: Object.assign({}, SB_HEADERS, { 'x-session-token': (typeof SAAS!=='undefined' && SAAS.sessionToken) || '' }),
      body: JSON.stringify({ data: dataPayload, expectedVersion: _loadedVersion || 0 })
    })
    .then(function(r){
      return r.json().then(function(body){ return { status: r.status, body: body }; });
    })
    .then(function(res){
      if(res.body && res.body.ok){
        _done_ok(res.body);
        return;
      }
      // Session expired or revoked — don't retry, don't silently drop
      // the save. Tell the user and send them back to sign in.
      if(res.status === 401){
        isSaving = false; _isSavingSetAt = 0;
        setSyncStatus('err','Session expired');
        // Callback first so a transactional save can roll back, then sign out
        // without a confirm (see loadFromCloud's 401 above for why).
        if(callback) callback(new Error('unauthenticated'));
        if(typeof saasForceLogout === 'function') saasForceLogout('Your session ended before your last change was saved — please sign in again and redo it.');
        return;
      }
      // A 403 means the account is authenticated but not allowed to
      // write (readonly role) — also not retryable.
      if(res.status === 403){
        isSaving = false; _isSavingSetAt = 0;
        setSyncStatus('err','Not allowed');
        toast('\u26a0 ' + ((res.body && res.body.message) || 'Your account cannot save changes.'));
        if(callback) callback(new Error('forbidden'));
        return;
      }
      if(res.body && res.body.conflict){
        // Real conflict: another device's save already moved the version
        // forward. Do NOT overwrite it. Surface this clearly and pull
        // their data instead of silently discarding it.
        isSaving = false; _isSavingSetAt = 0;
        setSyncStatus('err', 'Sync conflict');
        toast('\u26a0 Someone saved changes on another device just now. Loading their version — please redo your last action.');
        console.warn('[JewelOS] Real save conflict detected — refused to overwrite, reloading instead.');
        loadFromCloud(function(){ normaliseData(); saveCache(); try{ renderDash(); }catch(e){} });
        if(callback) callback(new Error('version-conflict'));
        return;
      }
      throw new Error('HTTP ' + res.status + (res.body && res.body.error ? ': ' + res.body.error : ''));
    })
    .catch(function(err){
      console.error('[JewelOS] save attempt error:', err);
      if(retries < 3){
        setTimeout(attempt, delays[retries++]);
      } else {
        _done_err(err);
      }
    });
  }
  attempt();
}

// ── Girvi transaction commit helper (Foundation audit B2, Sep 2026) ────
// Girvi payment/edit/renewal flows mutate S.girvi in memory then call
// saveToCloud() once — same shape as the sale flow, but until now with
// no rollback on failure and no per-loan double-submit lock. This
// generalizes the snapshot/lock/rollback pattern _commitSaleTransaction
// already proved out, so a failed or conflicted save can never leave a
// loan showing "closed"/"paid"/"renewed" in this tab when the cloud
// still has the old state.
var _girviSubmitLocks = {}; // keyed by girvi id

function _girviLocked(gid){ return !!_girviSubmitLocks[gid]; }
function _girviLock(gid){ _girviSubmitLocks[gid] = true; }
function _girviUnlock(gid){ delete _girviSubmitLocks[gid]; }

function _girviSnapshot(gid){
  var g = (S.girvi||[]).find(function(x){ return x.id === gid; });
  return g ? JSON.parse(JSON.stringify(g)) : null;
}

// Restores gid's record to exactly what snapshot held, and removes any
// brand-new girvi records the failed transaction created (e.g. renewal's
// new loan) so a rolled-back transaction leaves zero trace in S.girvi.
function _girviRestore(gid, snapshot, newIds){
  if(snapshot){
    var g = (S.girvi||[]).find(function(x){ return x.id === gid; });
    if(g){
      Object.keys(g).forEach(function(k){ if(!(k in snapshot)) delete g[k]; });
      Object.assign(g, snapshot);
    }
  }
  if(newIds && newIds.length){
    S.girvi = (S.girvi||[]).filter(function(x){ return newIds.indexOf(x.id) === -1; });
  }
}

// gid: the loan the lock/snapshot were taken against.
// opts.snapshot: result of _girviSnapshot(gid) taken BEFORE mutating.
// opts.newIds: ids of any NEW girvi records this transaction pushed
//   (renewal only) — removed on rollback along with restoring gid.
// onDone(err): called after commit or rollback; err is null on success.
function _girviCommit(gid, opts, onDone){
  saveToCloud(function(err){
    _girviUnlock(gid);
    if(err){
      _girviRestore(gid, opts.snapshot, opts.newIds);
      saveCache();
      if(err.message !== 'version-conflict'){
        toast('\u26a0 Could not save \u2014 change rolled back. Check your connection and try again.');
      }
      // A version-conflict already triggers its own toast + reload
      // inside saveToCloud() — no extra message needed here.
    }
    if(onDone) onDone(err);
  });
}

// ── Order transaction commit helper (Foundation audit B3, Sep 2026) ────
// Same shape as _girviCommit above: order payment/reversal/status/cancel
// flows mutate S.orders in memory then call saveToCloud() once, with no
// rollback on failure and no per-order submit lock. Generalizes the same
// snapshot/lock/rollback pattern.
var _orderSubmitLocks = {}; // keyed by order id

function _orderLocked(oid){ return !!_orderSubmitLocks[oid]; }
function _orderLock(oid){ _orderSubmitLocks[oid] = true; }
function _orderUnlock(oid){ delete _orderSubmitLocks[oid]; }

function _orderSnapshot(oid){
  var o = (S.orders||[]).find(function(x){ return x.id === oid; });
  return o ? JSON.parse(JSON.stringify(o)) : null;
}

function _orderRestore(oid, snapshot){
  if(!snapshot) return;
  var o = (S.orders||[]).find(function(x){ return x.id === oid; });
  if(o){
    Object.keys(o).forEach(function(k){ if(!(k in snapshot)) delete o[k]; });
    Object.assign(o, snapshot);
  }
}

// oid: the order the lock/snapshot were taken against.
// opts.snapshot: result of _orderSnapshot(oid) taken BEFORE mutating.
// onDone(err): called after commit or rollback; err is null on success.
function _orderCommit(oid, opts, onDone){
  saveToCloud(function(err){
    _orderUnlock(oid);
    if(err){
      _orderRestore(oid, opts.snapshot);
      saveCache();
      if(err.message !== 'version-conflict'){
        toast('\u26a0 Could not save \u2014 change rolled back. Check your connection and try again.');
      }
    }
    if(onDone) onDone(err);
  });
}

// ── Duplicate SKU/HUID protection (Inventory Foundation audit §6) ──────
// Neither addProduct() nor saveEditProd() nor purchase-driven product
// creation checked whether a typed SKU or HUID already existed on
// another product. A duplicate HUID is a BIS-hallmark-compliance issue
// (it's meant to be a unique government identifier per physical piece),
// not just a data-quality nit — both are blocked outright, not just
// warned about, matching "Prevent" in the audit spec.
// excludeId lets an edit compare against every OTHER product without
// flagging the item as a duplicate of itself.
function productSkuIsDuplicate(sku, excludeId){
  var s = (sku||'').trim().toLowerCase();
  if(!s) return null;
  return (S.products||[]).find(function(p){
    return p.id !== excludeId && (p.sku||'').trim().toLowerCase() === s;
  }) || null;
}
function productHuidIsDuplicate(huid, excludeId){
  var h = (huid||'').trim().toUpperCase();
  if(!h) return null; // blank HUID is allowed — not everything is hallmarked
  return (S.products||[]).find(function(p){
    return p.id !== excludeId && (p.huid||'').trim().toUpperCase() === h;
  }) || null;
}

// ── Central stock movement ledger (Inventory Foundation audit §4) ──────
// Every status/qty change that matters gets ONE entry here, written by
// this single function — not inferred after the fact from scattered
// fromPurchaseId/fromSaleId pointers and three unrelated logs that were
// never meant for this (S.auditLog, S.activityLog, S.purchaseAuditLog).
// This is what makes "show me this item's full history" (§5) and
// "what changed and when" (§13) actually answerable per-item.
// type: 'opening_stock' | 'purchase' | 'sale' | 'return' | 'inspection'
//     | 'adjustment' | 'delete'
function logStockMovement(productId, type, opts){
  opts = opts || {};
  S.stockMovements = S.stockMovements || [];
  S.stockMovements.push({
    id: (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2),
    productId: productId,
    type: type,
    prevStatus: opts.prevStatus || null,
    newStatus: opts.newStatus || null,
    qtyChange: (typeof opts.qtyChange==='number') ? opts.qtyChange : null,
    relatedId: opts.relatedId || null,   // sale id / purchase id / refund id, etc.
    relatedRef: opts.relatedRef || '',   // human-readable — invoice/bill no
    reason: opts.reason || '',
    user: (typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'User'):'User',
    ts: new Date().toISOString()
  });
  // Cap growth so a busy shop's history doesn't become an unbounded
  // array inside the one JSON blob every save has to move — oldest
  // entries roll off first, same spirit as other capped logs in this app.
  if(S.stockMovements.length > 5000){
    S.stockMovements = S.stockMovements.slice(S.stockMovements.length - 5000);
  }
}

function productMovementHistory(productId){
  return (S.stockMovements||[]).filter(function(m){ return m.productId===productId; })
    .sort(function(a,b){ return new Date(b.ts) - new Date(a.ts); });
}

var _lastCloudHash = '';
function _dataFingerprint(){
  // Hash that detects record count changes AND value edits
  // Samples last-updated timestamp or total value from each collection
  var prodHash = (S.products||[]).reduce(function(h,p){ return h + (p._seq||0) + ',' + (p.status||'') + ','; }, '');
  var saleHash = (S.sales||[]).reduce(function(h,s){ return h + (s.id||'') + ',' + (s.payStatus||'') + ','; }, '');
  var girvHash = (S.girvi||[]).reduce(function(h,g){ return h + (g.id||'') + ',' + (g.status||'') + ',' + (g.payments||[]).length + ','; }, '');
  var ordHash  = (S.orders||[]).reduce(function(h,o){ return h + (o.id||'') + ',' + (o.status||'') + ','; }, '');
  return prodHash.length + '|' + saleHash.length + '|' + girvHash.length + '|' + ordHash.length + '|' +
    (S.rates ? (S.rates.g22||0)+'|'+(S.rates.g24||0) : '0|0');
}

function startAutoRefresh(){
  if(refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(function(){
    // Skip poll entirely when browser tab is not visible — saves Supabase reads
    if(document.hidden) return;
    // Foundation audit B4 (12 Sep): a safeConfirm dialog (Reverse payment,
    // and every other danger-confirm across orders/girvi/sales/purchases)
    // holds a live reference into S.orders/S.girvi/S.sales while it waits,
    // with no timeout, for the shop owner to click OK. loadFromCloud()
    // below does a wholesale `S.x = record.x` — it doesn't patch in place —
    // so a poll landing mid-dialog orphans that reference: the confirmed
    // action mutates a copy nothing points to any more, the subsequent
    // save reports success (no version conflict, since this same poll just
    // advanced _loadedVersion), and the write is lost with no error shown
    // anywhere. Skipping the poll while any confirm dialog is open closes
    // that window; the dialog can safely stay open indefinitely otherwise.
    var confirmOverlay = document.getElementById('safe-confirm-overlay');
    if(confirmOverlay && confirmOverlay.style.display === 'flex') return;
    if(!isSaving && isPinSessionActive()){
      loadFromCloud(function(err){
        if(!err){
          saveCache();
          var fp = _dataFingerprint();
          if(fp !== _lastCloudHash){
            // Data actually changed — re-render active tab
            _lastCloudHash = fp;
            var activeTab = document.querySelector('.panel.active');
            if(activeTab){
              var id = activeTab.id.replace('panel-','');
              renderTab(id);
            }
          }
        }
      });
    }
  }, AUTO_REFRESH_MS);
}

function forceSync(){
  toast('Syncing...');
  loadFromCloud(function(err){
    normaliseData(); saveCache();
    if(!err){ renderDash(); toast('\u2713 Synced with cloud'); }
    else { toast('\u26a0 Offline — showing cached data'); }
  });
}

// ── PERSISTENT SAVE ERROR BANNER ─────────────────────────────────────
function showSaveError(){
  var b = document.getElementById('save-error-banner');
  if(b) b.style.display = 'flex';
}
function dismissSaveError(){
  var b = document.getElementById('save-error-banner');
  if(b) b.style.display = 'none';
}

// ── VERSION FIELD — OPTIMISTIC CONCURRENCY CONTROL ───────────────────
// Each save includes a `_v` (version) counter stored in the data blob.
// On load: store the version we received.
// On save: compare version in DB with what we loaded.
// If mismatch: another device saved newer data → show conflict warning.
var _loadedVersion = 0;

function _getDataVersion(record){
  return (record && typeof record._v === 'number') ? record._v : 0;
}

// NOTE: conflict handling is now done directly in saveToCloud()'s attempt()
// via a compare-and-swap PATCH filter (data->>_v=eq.N), which actually
// detects concurrent saves instead of comparing a save to itself.

// ── ATOMIC COUNTER VIA STORE-PROXY ───────────────────────────────────
// P0 hardening (Aug 2026): this used to hit the `counters` table
// directly with the public anon key via two separate REST calls
// (GET current val, then POST val+1) — neither atomic (a classic
// read-increment-write race between two devices) nor secure (the
// `counters` table has no RLS policy protecting it once RLS is
// enabled, so a direct anon call to it is either wide open or
// rejected outright). Both problems are fixed the same way P0-4 fixed
// them for the store blob: the browser asks store-proxy, and
// store-proxy calls a single atomic Postgres function
// (increment_shop_counter(), see
// supabase/migrations/002_atomic_transactions.sql) that performs the
// whole increment inside one locked statement. Falls back to the
// local S.nextXxx counters only if the network/function call fails —
// same fallback contract as before, callback(null, null) signals the
// caller to use the local counter.
function getNextCounter(counterName, callback){
  // counterName: 'inv_no' | 'girvi_no' | 'ord_no' | 'prod_no' | 'purchase_no'
  var shopKey = _getShopRowKey();
  fetch(SB_FUNCTIONS + '/store-proxy', {
    method: 'POST',
    headers: Object.assign({}, SB_HEADERS, { 'x-session-token': (typeof SAAS!=='undefined' && SAAS.sessionToken) || '' }),
    body: JSON.stringify({ action: 'increment_counter', counter: counterName })
  })
  .then(function(r){ return r.json().then(function(body){ return { status: r.status, body: body }; }); })
  .then(function(res){
    if(res.body && res.body.ok && typeof res.body.val === 'number'){
      callback(null, res.body.val);
    } else {
      throw new Error('HTTP ' + res.status + (res.body && res.body.error ? ': ' + res.body.error : ''));
    }
  })
  .catch(function(err){
    console.warn('[JewelOS] getNextCounter failed, using local fallback:', err);
    // Fallback: use local counter (not atomic, but better than crashing)
    callback(null, null); // null signals caller to use local counter
  });
}

// Wrap invoice number generation to use atomic counter when available
function getNextInvNo(callback){
  getNextCounter('inv_no', function(err, val){
    if(val !== null){
      // Sync local counter so it doesn't go backwards
      if(val >= S.nextInvNo) S.nextInvNo = val + 1;
      callback('INV-' + String(val).padStart(3,'0'));
    } else {
      // Fallback to local
      callback('INV-' + String(S.nextInvNo).padStart(3,'0'));
    }
  });
}

function getNextGrvNo(callback){
  getNextCounter('girvi_no', function(err, val){
    if(val !== null){
      if(val >= S.nextGirviId) S.nextGirviId = val + 1;
      callback('GRV-' + String(val).padStart(4,'0'));
    } else {
      callback('GRV-' + String(S.nextGirviId).padStart(4,'0'));
    }
  });
}

function repairAndReload(){
  normaliseData(); saveCache();
  renderDash();
  var activeTab = document.querySelector('.panel.active');
  if(activeTab){ var id=activeTab.id.replace('panel-',''); renderTab(id); }
  toast('\u2713 Data repaired & display refreshed');
}

// ─── HELPERS ─────────────────────────────────────────────────────────────
function fmt(n){
  var v = Math.round(n||0);
  return (v<0?'\u2212':'')+'\u20B9'+Math.abs(v).toLocaleString('en-IN');
}
function fmtW(w){var v=parseFloat(w)||0;return (Math.round(v*100)/100).toFixed(2)+'g';}
function fmtDate(d){try{var dt=new Date(d);if(isNaN(dt.getTime()))return '—';return dt.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}catch(e){return '—';}}
function fmtTime(d){try{var dt=new Date(d);if(isNaN(dt.getTime()))return '';return dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});}catch(e){return '';}}

// ── SAFE CONFIRM — replaces window.confirm() everywhere ──────────────
function safeConfirm(title, msg, onOk, danger){
  var overlay = document.getElementById('safe-confirm-overlay');
  var titleEl = document.getElementById('safe-confirm-title');
  var msgEl   = document.getElementById('safe-confirm-msg');
  var okBtn   = document.getElementById('safe-confirm-ok');
  var cancelBtn = document.getElementById('safe-confirm-cancel');
  if(!overlay) { if(onOk) onOk(); return; } // fallback if DOM not ready
  titleEl.textContent = title;
  msgEl.textContent   = msg;
  okBtn.style.background = danger
    ? 'linear-gradient(135deg,#7f1d1d,var(--danger))'
    : 'linear-gradient(135deg,var(--gold-dark),var(--gold))';
  okBtn.style.color = danger ? '#fff' : '#1a1200';
  overlay.style.display = 'flex';
  function cleanup(){ overlay.style.display='none'; okBtn.onclick=null; cancelBtn.onclick=null; }
  okBtn.onclick     = function(){ cleanup(); if(onOk) onOk(); };
  cancelBtn.onclick = function(){ cleanup(); };
}

function toast(msg){
  var t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove('show');},2800);
}

function getRate(metal,purity){
  if(!metal||!purity) return 0;
  if(!S.rates||typeof S.rates!=='object') return 0; // null guard
  if(metal==='silver') return S.rates.sil||0;
  if(purity==='24K') return S.rates.g24||0;
  if(purity==='22K') return S.rates.g22||0;
  if(purity==='18K') return S.rates.g18||0;
  if(purity==='14K') return S.rates.g14||0;
  return S.rates.g18||S.rates.g22||0;
}
function mktVal(p){return p.weight*getRate(p.metal,p.purity);}

// Returns the locked rate for a historical bill item, or live rate for new items
function getItemRate(i){
  return i.lockedRate||getRate(i.metal,i.purity);
}

// ═══════════════════════════════════════════════════════════════════════
// SPLIT PAYMENT SYSTEM
// ═══════════════════════════════════════════════════════════════════════
var splitRows = [{amount:0, mode:'Cash'}];

function initSplitPayments(){
  splitRows = [{amount:0, mode:'Cash'}];
  renderSplitRows();
}

function addSplitRow(){
  splitRows.push({amount:0, mode:'UPI'});
  renderSplitRows();
  updateSum();
}

function removeSplitRow(i){
  if(splitRows.length<=1) return;
  splitRows.splice(i,1);
  renderSplitRows();
  updateSum();
}

function renderSplitRows(){
  var wrap = document.getElementById('split-payments-wrap');
  if(!wrap) return;
  wrap.innerHTML = '';
  var MODES = ['Cash','UPI','Card','Bank Transfer','Cheque'];
  splitRows.forEach(function(row, i){
    var div = document.createElement('div');
    div.className = 'split-pay-row';
    // Amount input
    var af = document.createElement('div'); af.className = 'fg';
    af.innerHTML = '<label>'+(i===0?'Amount (₹)':'+ Amount (₹)')+'</label>';
    var ai = document.createElement('input');
    ai.type='text'; ai.setAttribute('inputmode','decimal');
    ai.placeholder='0'; ai.value=row.amount>0?row.amount:'';
    ai.style.cssText='font-size:15px;font-weight:700;';
    (function(idx){ai.oninput=function(){splitRows[idx].amount=parseFloat(this.value)||0;syncSplitToLegacy();updateSum();};})(i);
    af.appendChild(ai); div.appendChild(af);
    // Mode select
    var mf = document.createElement('div'); mf.className = 'fg';
    mf.innerHTML = '<label>Mode</label>';
    var ms = document.createElement('select');
    MODES.forEach(function(m){var o=document.createElement('option');o.value=m;o.textContent=m;if(m===row.mode)o.selected=true;ms.appendChild(o);});
    (function(idx){ms.onchange=function(){splitRows[idx].mode=this.value;syncSplitToLegacy();};})(i);
    mf.appendChild(ms); div.appendChild(mf);
    // Remove button
    var rb = document.createElement('div');
    rb.style.cssText='padding-bottom:4px;display:flex;align-items:flex-end;';
    if(splitRows.length>1){
      var btn=document.createElement('button');btn.className='btn btn-sm btn-danger';btn.innerHTML='&#10005;';
      (function(idx){btn.onclick=function(){removeSplitRow(idx);};})(i);
      rb.appendChild(btn);
    }
    div.appendChild(rb);
    wrap.appendChild(div);
  });
}

function getSplitTotal(){
  return splitRows.reduce(function(s,r){return s+(parseFloat(r.amount)||0);},0);
}

function syncSplitToLegacy(){
  // Keep legacy s-advance and s-pay in sync for compatibility
  var total = getSplitTotal();
  var adv = document.getElementById('s-advance');
  var pay = document.getElementById('s-pay');
  if(adv) adv.value = total;
  if(pay) pay.value = splitRows[0]&&splitRows[0].mode ? splitRows[0].mode : 'Cash';
}

// ═══════════════════════════════════════════════════════════════════════
// DUPLICATE BILL GUARD
// ═══════════════════════════════════════════════════════════════════════
function isDuplicateSale(custName, items){
  var now = Date.now();
  var recentCutoff = now - 60000; // 60 seconds
  return S.sales.some(function(s){
    // s.date is the user-picked bill date (UTC midnight), not when the bill
    // was saved, so use createdAt. Missing or unparseable is treated as "not
    // recent" and skipped -- a malformed createdAt must not fall through as
    // if it were fresh (NaN < recentCutoff is false, not true, so isNaN()
    // has to be checked explicitly, not relied on to fail the comparison).
    var createdTs = s.createdAt ? new Date(s.createdAt).getTime() : NaN;
    if(isNaN(createdTs) || createdTs < recentCutoff) return false;
    if((s.customer||'').toLowerCase() !== (custName||'').toLowerCase()) return false;
    if((s.items||[]).length !== items.length) return false;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// EDIT BILL FEATURE
// ═══════════════════════════════════════════════════════════════════════
var _editBillId = null;

function openEditBill(saleId){
  var sale = S.sales.find(function(x){return x.id===saleId;});
  if(!sale) return;
  _editBillId = saleId;

  var ver = (sale.editHistory ? sale.editHistory.length+1 : 1);
  var vt = document.getElementById('eb-version-tag');
  if(vt) vt.textContent = 'v'+ver;

  var body = document.getElementById('edit-bill-body');
  if(!body) return;
  body.innerHTML = '';

  // Notes / occasion edit
  var nb = document.createElement('div'); nb.className='form-grid'; nb.style.marginBottom='12px';
  nb.innerHTML=
    '<div class="fg"><label>Customer</label><input id="eb-cust" value="'+escHtml(sale.customer||'')+'"/></div>'+
    '<div class="fg"><label>Phone</label><input id="eb-phone" value="'+escHtml(sale.phone||'')+'"/></div>'+
    '<div class="fg"><label>Notes / Occasion</label><input id="eb-notes" value="'+escHtml(sale.notes||'')+'"/></div>'+
    '<div class="fg"><label>Discount (₹)</label><input id="eb-disc" type="number" value="'+(sale.discount||0)+'"/></div>'+
    '<div class="fg"><label>GST %</label><input id="eb-gst" type="number" value="'+(sale.gst||0)+'"/></div>';
  body.appendChild(nb);

  // Items table (read-only display + weight/making edit)
  var itHead = document.createElement('div');
  itHead.style.cssText='font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text2);margin-bottom:8px;';
  itHead.textContent = 'Items';
  body.appendChild(itHead);

  (sale.items||[]).forEach(function(item, i){
    var row = document.createElement('div');
    row.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;';
    row.innerHTML=
      '<div style="font-weight:700;font-size:13px;margin-bottom:6px;">'+escHtml(item.name)+
        ' <span class="badge '+(item.metal==='gold'?'bg-gold':'bg-silver')+'">'+item.purity+'</span>'+
      '</div>'+
      '<div class="form-grid" style="grid-template-columns:1fr 1fr 1fr 1fr;">'+
        '<div class="fg"><label>Net Wt (g)</label><input id="ei-wt-'+i+'" type="text" inputmode="decimal" value="'+((item.weight||0).toFixed(3))+'" oninput="calcEditTotal()"/></div>'+
        '<div class="fg"><label>Rate (₹/g)</label><input id="ei-rate-'+i+'" type="number" value="'+(item.lockedRate||0)+'" oninput="calcEditTotal()"/></div>'+
        '<div class="fg"><label>Making (₹)</label><input id="ei-mk-'+i+'" type="number" value="'+(item.making||0)+'" oninput="calcEditTotal()"/></div>'+
        '<div class="fg"><label>Stone (₹)</label><input id="ei-dc-'+i+'" type="number" value="'+(item.diamond||0)+'" oninput="calcEditTotal()"/></div>'+
      '</div>';
    body.appendChild(row);
  });

  // Payment adjustment — with full split breakdown
  var pa = document.createElement('div');
  pa.style.cssText='background:var(--surf2);border:1px solid var(--b2);border-radius:var(--rl);padding:14px 16px;margin-bottom:10px;';
  // Build existing split payments for editing
  var existSplits = sale.splitPayments && sale.splitPayments.length
    ? sale.splitPayments
    : (sale.nowPaying && sale.nowPaying.amount > 0
        ? [{amount:sale.nowPaying.amount, mode:sale.nowPaying.mode||'Cash'}]
        : [{amount:sale.advance||0, mode:sale.payment||'Cash'}]);
  var splitHtml = existSplits.map(function(sp,si){
    return '<div class="form-grid" style="grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end;">'+
      '<div class="fg"><label>Amount (₹)</label><input id="ebsp-amt-'+si+'" type="number" value="'+(sp.amount||0)+'" oninput="calcEditTotal()" placeholder="0"/></div>'+
      '<div class="fg"><label>Mode</label><select id="ebsp-mode-'+si+'">'+
        ['Cash','UPI','Card','Bank Transfer','Cheque'].map(function(m){return '<option'+(m===sp.mode?' selected':'')+'>'+m+'</option>';}).join('')+
      '</select></div>'+
      (si>0?'<button class="btn btn-danger btn-sm" style="align-self:flex-end" onclick="removeEditPayRow('+si+')">&#10005;</button>':'<div></div>')+
    '</div>';
  }).join('');
  pa.innerHTML=
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ch5);margin-bottom:10px;">Payment Breakdown</div>'+
    '<div id="eb-splits-wrap">'+splitHtml+'</div>'+
    '<button class="split-add-btn" onclick="addEditPayRow()">+ Add payment mode</button>'+
    '<div class="form-grid" style="margin-top:10px;">'+
      '<div class="fg"><label>Old Gold Value (₹)</label><input id="eb-oldgold" type="number" value="'+((sale.oldGold&&sale.oldGold.value)||0)+'" oninput="calcEditTotal()" placeholder="0"/></div>'+
      '<div class="fg"><label>Advance already paid (₹)</label><input id="eb-advance" type="number" value="'+((sale.prevAdvance&&sale.prevAdvance.amount)||0)+'" oninput="calcEditTotal()" placeholder="0"/></div>'+
    '</div>';
  // Store split count
  pa.dataset.splits = existSplits.length;
  pa._splitCount = existSplits.length;
  body.appendChild(pa);

  // Edit total display
  var et = document.createElement('div');
  et.id = 'eb-total-display';
  et.style.cssText='background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1rem;margin-bottom:12px;';
  body.appendChild(et);
  calcEditTotal();

  // Edit history
  if(sale.editHistory && sale.editHistory.length){
    var hh = document.createElement('div');
    hh.style.cssText='margin-bottom:12px;';
    hh.innerHTML='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text2);margin-bottom:6px;">Edit History</div>';
    sale.editHistory.slice().reverse().forEach(function(h){
      hh.innerHTML+='<div class="edit-history-row">'+
        '<span>'+fmtDate(h.at)+' '+fmtTime(h.at)+'</span>'+
        '<span>v'+h.version+'</span>'+
        '<span style="color:var(--text2);">Grand: '+fmt(h.grand)+'</span>'+
        '<span>'+(h.reason||'Edited')+'</span>'+
      '</div>';
    });
    body.appendChild(hh);
  }

  // Reason input + save
  var reasonRow = document.createElement('div');
  reasonRow.innerHTML=
    '<div class="fg" style="margin-bottom:10px;"><label>Reason for edit (optional)</label><input id="eb-reason" placeholder="e.g. Weight correction, customer request..."/></div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+
      '<button class="btn btn-gold" onclick="saveEditBill()">&#9729; Save Changes</button>'+
      '<button class="btn" onclick="closeEditBillModal()">Cancel</button>'+
    '</div>';
  body.appendChild(reasonRow);

  document.getElementById('edit-bill-modal').classList.add('open');
}

function calcEditTotal(){
  var sale = S.sales.find(function(x){return x.id===_editBillId;});
  if(!sale) return;
  var gv=0,mc=0,dc=0;
  (sale.items||[]).forEach(function(item,i){
    var wt=parseFloat((document.getElementById('ei-wt-'+i)||{value:0}).value)||0;
    var rate=parseFloat((document.getElementById('ei-rate-'+i)||{value:0}).value)||0;
    var mk=parseFloat((document.getElementById('ei-mk-'+i)||{value:0}).value)||0;
    var stone=parseFloat((document.getElementById('ei-dc-'+i)||{value:0}).value)||0;
    gv+=rate*wt; mc+=mk; dc+=stone;
  });
  var sub=gv+mc+dc;
  var gst=parseFloat((document.getElementById('eb-gst')||{value:0}).value)||0;
  var disc=parseFloat((document.getElementById('eb-disc')||{value:0}).value)||0;
  // Must match calcSaleTotals(): GST on the discount-adjusted taxable
  // value, not the pre-discount subtotal.
  var taxable=Math.max(0,sub-disc);
  var grand=Math.max(0,taxable+taxable*gst/100);
  // Collect all payment rows
  var splitTotal=0, splitRows=[];
  var si=0;
  while(document.getElementById('ebsp-amt-'+si)){
    var amt=parseFloat(document.getElementById('ebsp-amt-'+si).value)||0;
    var mode=(document.getElementById('ebsp-mode-'+si)||{value:'Cash'}).value;
    if(amt>0) splitRows.push({amount:amt,mode:mode});
    splitTotal+=amt;
    si++;
  }
  var prevAdv=parseFloat((document.getElementById('eb-advance')||{value:0}).value)||0;
  var og=parseFloat((document.getElementById('eb-oldgold')||{value:0}).value)||0;
  var totalColl=splitTotal+prevAdv+og;
  var bal=Math.max(0,grand-totalColl);
  var el=document.getElementById('eb-total-display');
  if(!el) return;
  var splitHtml=splitRows.map(function(r){
    return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--ch6);"><span>&#128179; Paid ('+r.mode+')</span><span style="color:var(--em4);font-weight:500;">'+fmt(r.amount)+'</span></div>';
  }).join('');
  el.innerHTML=
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;">'+
      '<div style="background:var(--ch0);border-radius:8px;padding:10px;">'+
        '<div style="font-size:9.5px;color:var(--ch5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Gold Value</div>'+
        '<div style="font-size:16px;font-weight:600;color:var(--ch-gold-d);">'+fmt(gv)+'</div></div>'+
      '<div style="background:var(--ch0);border-radius:8px;padding:10px;">'+
        '<div style="font-size:9.5px;color:var(--ch5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Grand Total</div>'+
        '<div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:var(--sap5);">'+fmt(grand)+'</div></div>'+
      '<div style="background:'+(bal>0?'var(--err-bg)':'var(--ok-bg)')+';border-radius:8px;padding:10px;">'+
        '<div style="font-size:9.5px;color:var(--ch5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px;">Balance</div>'+
        '<div style="font-size:18px;font-weight:700;color:'+(bal>0?'var(--err)':'var(--em4)')+';">'+fmt(bal)+'</div></div>'+
    '</div>'+
    (splitHtml||prevAdv>0||og>0?
      '<div style="border-top:1px solid var(--b1);padding-top:8px;">'+
        (og>0?'<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--ch6);"><span>&#9851; Old Gold</span><span style="color:var(--em4);font-weight:500;">'+fmt(og)+'</span></div>':'')+
        (prevAdv>0?'<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;color:var(--ch6);"><span>&#10003; Prev Advance</span><span style="color:var(--em4);font-weight:500;">'+fmt(prevAdv)+'</span></div>':'')+
        splitHtml+
      '</div>':'');
}

function saveEditBill(){
  var sale = S.sales.find(function(x){return x.id===_editBillId;});
  if(!sale) return;
  // Save version snapshot before editing
  if(!sale.editHistory) sale.editHistory=[];
  sale.editHistory.push({
    version: sale.editHistory.length+1,
    at: new Date().toISOString(),
    grand: sale.lockedGrand||sale.advance||0,
    reason: (document.getElementById('eb-reason')||{value:''}).value||'Edited',
    snapshot: JSON.parse(JSON.stringify({items:sale.items,advance:sale.advance,discount:sale.discount,gst:sale.gst}))
  });
  // Apply edits to items
  (sale.items||[]).forEach(function(item,i){
    var wt=parseFloat((document.getElementById('ei-wt-'+i)||{value:item.weight}).value)||item.weight;
    var rate=parseFloat((document.getElementById('ei-rate-'+i)||{value:item.lockedRate}).value)||item.lockedRate;
    var mk=parseFloat((document.getElementById('ei-mk-'+i)||{value:item.making||0}).value)||0;
    var stone=parseFloat((document.getElementById('ei-dc-'+i)||{value:item.diamond||0}).value)||0;
    item.weight=wt; item.lockedRate=rate; item.making=mk; item.diamond=stone;
  });
  // Apply billing edits
  sale.discount=parseFloat((document.getElementById('eb-disc')||{value:0}).value)||0;
  sale.gst=parseFloat((document.getElementById('eb-gst')||{value:0}).value)||0;
  sale.customer=(document.getElementById('eb-cust')||{value:sale.customer}).value||sale.customer;
  sale.phone=(document.getElementById('eb-phone')||{value:sale.phone||''}).value||sale.phone||'';
  sale.notes=(document.getElementById('eb-notes')||{value:sale.notes||''}).value||sale.notes||'';
  // Collect split payments from edit rows
  var savedSplits=[], splitAdv=0;
  var si2=0;
  while(document.getElementById('ebsp-amt-'+si2)){
    var samt=parseFloat(document.getElementById('ebsp-amt-'+si2).value)||0;
    var smode=(document.getElementById('ebsp-mode-'+si2)||{value:'Cash'}).value;
    if(samt>0){savedSplits.push({amount:samt,mode:smode});splitAdv+=samt;}
    si2++;
  }
  var prevAdvSave=parseFloat((document.getElementById('eb-advance')||{value:0}).value)||0;
  var og=parseFloat((document.getElementById('eb-oldgold')||{value:0}).value)||0;
  var adv=splitAdv+prevAdvSave+og;
  sale.advance=adv;
  sale.splitPayments=savedSplits;
  if(savedSplits.length>0) sale.payment=savedSplits.map(function(s){return s.mode;}).join('+');
  if(prevAdvSave>0) sale.prevAdvance={amount:prevAdvSave,mode:(sale.prevAdvance&&sale.prevAdvance.mode)||'Cash'};
  if(og>0) sale.oldGold={weight:sale.oldGold?sale.oldGold.weight:0, purity:sale.oldGold?sale.oldGold.purity:'', value:og};
  // Recalculate and re-lock
  sale.lastEditedAt = new Date().toISOString();
  var t=calcSaleTotals(sale);
  sale.lockedGrand=t.grand;
  if(t.bal<=0) sale.payStatus='full';
  saveToCloud(function(err){
    if(!err){
      closeEditBillModal();
      toast('&#10003; Bill updated & saved! v'+(sale.editHistory.length));
      renderCustomers();
    }
  });
}

function _editPayCount(){
  var i=0;
  while(document.getElementById('ebsp-amt-'+i)) i++;
  return i;
}
function addEditPayRow(){
  var n=_editPayCount();
  var wrap=document.getElementById('eb-splits-wrap');
  if(!wrap)return;
  var div=document.createElement('div');
  div.id='ebsp-row-'+n;
  div.className='form-grid';
  div.style.cssText='grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end;';
  div.innerHTML='<div class="fg"><label>Amount (₹)</label><input id="ebsp-amt-'+n+'" type="number" value="0" oninput="calcEditTotal()" placeholder="0"/></div>'+
    '<div class="fg"><label>Mode</label><select id="ebsp-mode-'+n+'">'+
      ['Cash','UPI','Card','Bank Transfer','Cheque'].map(function(m){return '<option>'+m+'</option>';}).join('')+
    '</select></div>'+
    '<button class="btn btn-danger btn-sm" style="align-self:flex-end" onclick="removeEditPayRow('+n+')">&#10005;</button>';
  wrap.appendChild(div);
  calcEditTotal();
}
function removeEditPayRow(idx){
  var el=document.getElementById('ebsp-row-'+idx);
  if(!el){
    // fallback: find and remove by input id
    var inp=document.getElementById('ebsp-amt-'+idx);
    if(inp&&inp.parentElement&&inp.parentElement.parentElement)
      el=inp.parentElement.parentElement;
  }
  if(el) el.remove();
  calcEditTotal();
}
function closeEditBillModal(){
  document.getElementById('edit-bill-modal').classList.remove('open');
  _editBillId=null;
}

function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// For values embedded inside a single-quoted JS string within an inline
// onclick="..." attribute (e.g. onclick="callCustomer('+phone+')"). escHtml
// alone doesn't stop a value containing a literal ' from breaking out of the
// JS string and injecting script. Escapes backslash + single-quote for the
// JS-string context, then HTML-attribute-escapes the result.
function jsAttrEsc(s){
  return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════════════════
// PAYMENT HISTORY TRACKING
// ═══════════════════════════════════════════════════════════════════════
function addPaymentRecord(sale, amount, mode, note){
  if(!sale.paymentHistory) sale.paymentHistory=[];
  sale.paymentHistory.push({
    date: new Date().toISOString(),
    amount: amount,
    mode: mode||'Cash',
    note: note||''
  });
}

function renderPaymentHistory(sale){
  var html='';
  if(sale.paymentHistory && sale.paymentHistory.length){
    html+='<div style="margin-top:10px;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">';
    html+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text2);padding:7px 10px;background:var(--bg2);">Payment History</div>';
    sale.paymentHistory.forEach(function(p){
      html+='<div class="pay-hist-item">'+
        '<span style="color:var(--text3);">'+fmtDate(p.date)+' '+fmtTime(p.date)+'</span>'+
        '<span>'+p.mode+'</span>'+
        '<span class="pay-hist-badge">'+fmt(p.amount)+'</span>'+
      '</div>';
    });
    html+='</div>';
  }
  // Foundation audit §6/§9: post-creation payments are reversible —
  // this is the only place a "Reverse" action shows, since only entries
  // in sale.extraPayments (not the creation-time payment above) go
  // through the reversible ledger.
  var reversibles = (sale.extraPayments||[]).filter(function(p){
    return p.type!=='reversal' && !(sale.extraPayments||[]).some(function(x){return x.reversedPayment===p.id;});
  });
  if(reversibles.length){
    html+='<div style="margin-top:6px;display:grid;gap:4px;">';
    reversibles.forEach(function(p){
      html+='<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;background:var(--card2);border-radius:8px;padding:5px 9px;">'+
        '<span style="color:var(--text3);">'+fmtDate(p.date)+' \u00b7 '+escHtml(p.mode)+' \u00b7 '+fmt(p.amount)+'</span>'+
        '<button onclick="event.stopPropagation();reverseSalePayment(\''+sale.id+'\',\''+p.id+'\')" style="border:none;background:transparent;color:var(--danger);cursor:pointer;font-size:11px;font-family:inherit;text-decoration:underline;">Reverse</button>'+
      '</div>';
    });
    html+='</div>';
  }
  return html;
}

// ═══════════════════════════════════════════════════════════════════════
// PROFIT CALCULATION
// ═══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
// ─── FINANCIAL ENGINE v9 ─────────────────────────────────────────────
// All money logic lives here. UI reads these — never recalculates.
// ══════════════════════════════════════════════════════════════════════

// ── ITEM-LEVEL COST & PROFIT ─────────────────────────────────────────
// Cost of an item = (costRate or market rate) × netWeight + mcCost
// Selling price   = lockedRate × netWeight + makingCharge + stoneCharge
// Profit          = Selling - Cost

// ── MAKING CHARGE BASIS ──────────────────────────────────────────────
// Making is charged per gram on CUSTOM items and as a flat amount on stock
// items. Custom items used to be charged on net weight (gross minus black
// beads and diamond weight); the shop charges on GROSS weight, so sales
// created from Sept 2026 carry makingBasis:'gross'.
//
// The flag is deliberate rather than changing the sum outright: calcSaleTotals
// derives the taxable value and GST from the making charge, so recalculating
// old bills on a new basis would restate the tax on invoices already issued
// and already filed on GSTR-1. Records without the flag keep the net-weight
// basis they were billed under, permanently.
function itemMakingWeight(item){
  if(item.makingBasis === 'gross'){
    var g = parseFloat(item.grossWeight);
    if(isFinite(g) && g > 0) return g;   // fall through to net if gross wasn't captured
  }
  return parseFloat(item.weight) || 0;
}

// Full making charge for one line, including quantity.
function itemMakingAmount(item){
  var making = parseFloat(item.making) || 0;
  var qty    = parseInt(item.qty) || 1;
  return item.isCustom ? making * itemMakingWeight(item) * qty : making * qty;
}

function getItemCostRate(item){
  // For stock items: use stored costRate; fall back to lockedRate (no margin captured)
  if(item.costRate && item.costRate > 0) return item.costRate;
  // For custom sale items with no costRate, use lockedRate as cost (zero margin on metal)
  return getItemRate(item);
}

function calcItemProfit(item){
  var sellRate  = getItemRate(item);
  var costRate  = getItemCostRate(item);
  var netWt     = parseFloat(item.weight) || 0;
  var qty       = parseInt(item.qty) || 1;
  // Gold value at sell vs cost
  var goldSell  = sellRate  * netWt * qty;
  var goldCost  = costRate  * netWt * qty;
  // mcRate is the product's Making Charge per gram — what the customer is
  // billed, not what the karigar was paid. It used to be subtracted here as a
  // cost as well, which made every sale carrying a making charge show a loss
  // of exactly that amount. No separate making cost is recorded anywhere, so
  // the honest figure is zero; making cost lives inside costRate (the rate the
  // shop paid for the finished piece).
  var mcCharged = itemMakingAmount(item);
  var mcCost    = 0;
  // Stone/diamond: full margin (cost not tracked separately → 0 cost assumed unless set)
  var stoneSell = (parseFloat(item.diamond)||0) * qty;
  var stoneCost = (parseFloat(item.stoneCost)||0) * qty;
  return {
    goldSell:  goldSell,
    goldCost:  goldCost,
    mcCharged: mcCharged,
    mcCost:    mcCost,
    stoneSell: stoneSell,
    stoneCost: stoneCost,
    totalSell: goldSell + mcCharged + stoneSell,
    totalCost: goldCost + mcCost    + stoneCost,
    profit:    (goldSell + mcCharged + stoneSell) - (goldCost + mcCost + stoneCost)
  };
}

// ── SALE-LEVEL PROFIT ────────────────────────────────────────────────
function calcSaleProfit(sale){
  var t         = calcSaleTotals(sale);
  var itemsCost = 0;
  (sale.items||[]).forEach(function(i){
    var p = S.products.find(function(x){ return x.id===i.pid; });
    var costRate = (p && p.costRate > 0) ? p.costRate : getItemRate(i);
    // No making cost here — see calcItemProfit(). Charging p.mcRate as a cost
    // while the bill never billed it is what turned a normal sale into a loss
    // of exactly mcRate x weight.
    var stoneCost= (parseFloat(i.stoneCost)||0) * (i.qty||1);
    itemsCost += costRate * (parseFloat(i.weight)||0) * (i.qty||1) + stoneCost;
  });
  // Revenue = grand total (locked)
  // Cost    = metal cost + making cost + stone cost
  // Profit  = Revenue - Cost - GST (GST is govt's money, not ours)
  var gstPaid   = t.gstAmt || 0;
  var revenue   = t.grand;
  var profit    = revenue - itemsCost - gstPaid;
  var margin    = revenue > 0 ? (profit / revenue * 100) : 0;
  return { revenue:revenue, cost:itemsCost, gstPaid:gstPaid, profit:profit, margin:margin };
}

// ── CASH FLOW ENGINE ─────────────────────────────────────────────────
// Tracks every rupee in and out. Returns a snapshot for any date range.
function calcCashFlow(fromDate, toDate){
  var from = fromDate ? new Date(fromDate) : new Date(0);
  var to   = toDate   ? new Date(toDate)   : new Date();
  to.setHours(23,59,59,999);

  var cashIn  = 0;  // actual cash/payment-instrument money received (excludes old-gold trade-in — see below)
  var cashOut = 0;  // old-gold trade-in value taken in (informational — not a literal cash outflow)
  var credit  = 0;  // credit given (pending balances)
  var girviOut= 0;  // cash lent as girvi loans
  var girviIn = 0;  // girvi repayments received

  // Sales cash flows
  S.sales.forEach(function(s){
    var d = new Date(s.date);
    if(d < from || d > to) return;
    var t = calcSaleTotals(s);
    var ogv = (s.oldGold && s.oldGold.value) || 0;
    // Old-gold trade-in is not a cash movement — no rupee note or bank
    // transfer happens for that portion, the customer simply owes less
    // because they handed over gold instead. Including it in "Cash In"
    // overstated real money collected; it also isn't a genuine cash
    // outflow, so it must not be subtracted from netCash as if it were.
    cashIn += Math.max(0, t.adv - ogv);
    credit += t.bal;
    if(ogv > 0) cashOut += ogv; // kept for the "Cash Out (old gold)" display — trade-in value, not literal cash out
  });

  // Girvi loan flows
  (S.girvi||[]).forEach(function(g){
    var d = new Date(g.startDate||g.createdAt);
    if(d >= from && d <= to){
      girviOut += parseFloat(g.principal)||0;
    }
    (g.payments||[]).forEach(function(p){
      var pd = new Date(p.date||p.ts);
      if(pd >= from && pd <= to){
        girviIn += parseFloat(p.amount)||0;
      }
    });
  });

  var netCash = cashIn + girviIn - girviOut; // old-gold trade-in excluded — not a real cash movement
  return {
    cashIn:   cashIn,
    cashOut:  cashOut,
    credit:   credit,
    girviOut: girviOut,
    girviIn:  girviIn,
    netCash:  netCash,
    capitalStuck: credit + Math.max(0, girviOut - girviIn)
  };
}

// ── GIRVI FINANCIAL METRICS ──────────────────────────────────────────
// LTV = Loan / (Item Market Value)   →  safe < 70%, medium < 85%, high > 85%
function girviLTV(g){
  var principal = parseFloat(g.principal)||0;
  if(!principal) return 0;
  var allItems = Array.isArray(g.items)&&g.items.length ? g.items : (g.item?[g.item]:[]);
  var totalMkt = allItems.reduce(function(s,it){
    return s + getRate(it.metal||'gold',it.purity||'22K')*(parseFloat(it.weight||it.grossWt)||0)*(parseInt(it.qty)||1);
  },0);
  if(!totalMkt) return 1;
  return principal / totalMkt;
}

function girviLTVLabel(ltv){
  if(ltv <= 0.70) return { label:'Safe',   color:'#22c55e', icon:'🟢' };
  if(ltv <= 0.85) return { label:'Medium', color:'#f59e0b', icon:'🟡' };
  return                  { label:'High',  color:'#ef4444', icon:'🔴' };
}

// Penalty = additional % on top of regular interest after overdue
var GIRVI_PENALTY_RATE = 2; // extra 2% per month after due date

function calcSaleGSTBreakdown(sale) {
  var shopGstin = (typeof SAAS !== 'undefined' && SAAS.shop && SAAS.shop.gstin) ? SAAS.shop.gstin : '';
  var custGstin = sale.gstNo || '';
  var isInterState = !!(shopGstin.length >= 2 && custGstin.length >= 2 && shopGstin.substring(0,2) !== custGstin.substring(0,2));

  // Single source of truth: reuse calcSaleTotals' exact metal/making/stone
  // values and a single uniform GST rate (sale.gst) — the same rate that
  // actually produced the invoice's Grand Total. The old version
  // recomputed these independently, forcing making charges to a minimum
  // 5% and charging 0% GST on stones, so the printed CGST/SGST rows never
  // matched the Grand Total the customer was actually billed. HSN codes
  // are still shown per component for the GST summary, but the rate
  // applied to every component is identical, guaranteeing the totals
  // always reconcile.
  var t = calcSaleTotals(sale);
  // Pro-rate the discount across the three HSN buckets so their GST sums
  // exactly to t.gstAmt, which is now computed on the discount-adjusted
  // taxable value (see calcSaleTotals) — without this, discounted sales
  // would reintroduce the invoice/GST-total mismatch this function exists
  // to prevent.
  var scale = t.sub > 0 ? (t.taxable / t.sub) : 1;
  var metalValue  = t.gv * scale;
  var makingValue = t.mc * scale;
  var stoneValue  = t.dc * scale;
  var gstPct      = parseFloat(sale.gst) || 0;

  function split(value){
    var gstAmt = value * gstPct / 100;
    return isInterState
      ? { igst: gstAmt, cgst: 0, sgst: 0 }
      : { igst: 0, cgst: gstAmt/2, sgst: gstAmt/2 };
  }
  var mGST = split(metalValue), kGST = split(makingValue), sGST = split(stoneValue);

  return {
    metalValue:   Math.round(metalValue),
    makingValue:  Math.round(makingValue),
    stoneValue:   Math.round(stoneValue),
    metalHSN:     '7113', makingHSN: '9983', stoneHSN: '7103',
    metalGSTRate: gstPct, makingGSTRate: gstPct, stoneGSTRate: gstPct,
    isInterState: isInterState,
    cgst:  Math.round((mGST.cgst + kGST.cgst + sGST.cgst) * 100)/100,
    sgst:  Math.round((mGST.sgst + kGST.sgst + sGST.sgst) * 100)/100,
    igst:  Math.round((mGST.igst + kGST.igst + sGST.igst) * 100)/100,
    total: Math.round(((mGST.cgst+mGST.sgst+mGST.igst) + (kGST.cgst+kGST.sgst+kGST.igst) + (sGST.cgst+sGST.sgst+sGST.igst)) * 100)/100
  };
}

// ===================================================================
// --- CLOUD AUDIT LOG ENGINE ----------------------------------------
// ===================================================================
var AUDIT_MAX = 300;
// FIX: previously read/wrote a raw, unscoped localStorage key
// ('jewelos_audit_v2') directly — same class of bug as the ssj_cache/PIN
// cross-account leak fixed in an earlier pass (any shop signing into a
// device that had another shop's audit history would see/corrupt it),
// AND it never reached the cloud at all, so from a second device or
// after a cache clear the audit trail looked like it had never saved.
// Now pushes into S.auditLog, which flows through the same shop-scoped
// cache (saveCache/loadCache) and cloud sync (saveToCloud dataPayload)
// pipeline as every other piece of shop data.
function auditLog(action, entity, entityId, note) {
  var uid = (typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36);
  var entry = {
    id:       uid,
    ts:       new Date().toISOString(),
    user:     (typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.name||SAAS.user.email||'unknown'):'system',
    role:     (typeof SAAS!=='undefined'&&SAAS.user)?(SAAS.user.role||'staff'):'system',
    action:   action,
    entity:   entity,
    entityId: entityId||'',
    note:     note||''
  };
  if(!Array.isArray(S.auditLog)) S.auditLog=[];
  S.auditLog.unshift(entry);
  if(S.auditLog.length>AUDIT_MAX) S.auditLog=S.auditLog.slice(0,AUDIT_MAX);
  return entry;
}

function getAuditLog(limit) {
  var l = Array.isArray(S.auditLog) ? S.auditLog : [];
  return limit ? l.slice(0,limit) : l;
}

// ===================================================================
// --- PAGINATION HELPERS --------------------------------------------
// ===================================================================
var INV_PAGE_SIZE   = 50; var _invPage  = 0;
var SALES_PAGE_SIZE = 30; var _salesPage = 0;

function paginateArray(arr, page, pageSize) {
  return arr.slice(page*pageSize, page*pageSize+pageSize);
}

function renderPaginator(total, page, pageSize, setPageFn) {
  var totalPages = Math.ceil(total/pageSize);
  if(totalPages<=1) return '';
  var b='<div class="pg-bar" style="display:flex;align-items:center;gap:6px;padding:10px 0;flex-wrap:wrap;">';
  if(page>0) b+='<button class="btn btn-sm" onclick="'+setPageFn+'('+(page-1)+')"><< Prev</button>';
  for(var i=0;i<totalPages;i++){
    b+='<button class="btn btn-sm'+(i===page?' btn-gold':'')+'" onclick="'+setPageFn+'('+i+')">'+(i+1)+'</button>';
  }
  if(page<totalPages-1) b+='<button class="btn btn-sm" onclick="'+setPageFn+'('+(page+1)+')">Next >></button>';
  b+='<span style="font-size:11px;color:var(--text3);margin-left:4px;">'+total+' total | Page '+(page+1)+'/'+totalPages+'</span>';
  b+='</div>';
  return b;
}

// ===================================================================
// --- REFUND / CREDIT NOTE ENGINE -----------------------------------
// ===================================================================
// ── Sale partial payments (Foundation audit §6, financial ledger) ──────
// Before this, the ONLY way to reduce a sale's balance after creation
// was markSalePaid(), which jumped straight to fully-paid in one action
// — there was no way to record "customer paid ₹40,000 today, ₹60,000
// next week" for a sale, unlike orders and girvi which already had this.
// Payments append to sale.extraPayments[] (read by calcSaleTotals in
// 02-ui-inactivity-modals.js); a reversal is its own new entry, never a
// deletion or edit of the original.
var _salePaymentSubmitLock = {}; // keyed by sale id

function openSalePaymentModal(saleId){
  var sale=(S.sales||[]).find(function(x){return x.id===saleId;});
  if(!sale){toast('Sale not found');return;}
  var t=calcSaleTotals(sale);
  if(t.bal<=0){toast('This bill has no balance due');return;}

  var mInner=document.getElementById('spay-modal-inner');
  if(!mInner){
    var ov=document.createElement('div');
    ov.id='spay-modal';
    ov.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    ov.innerHTML='<div id="spay-modal-inner" style="background:var(--surface);border-radius:18px;max-width:420px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35);padding:22px;"></div>';
    document.body.appendChild(ov);
    mInner=document.getElementById('spay-modal-inner');
  }
  document.getElementById('spay-modal').style.display='flex';
  mInner.innerHTML=
    '<h3 style="margin:0 0 14px;font-size:16px;">Record Payment \u2014 '+escHtml(sale.invNo)+'</h3>'+
    '<div style="font-size:13px;color:var(--text2);margin-bottom:14px;">Balance due: <b style="color:var(--danger);">'+fmt(t.bal)+'</b></div>'+
    '<div style="display:grid;gap:9px;">'+
      '<input id="spay-amount" type="number" step="0.01" placeholder="Amount" value="'+t.bal+'" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
      '<select id="spay-mode" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
        '<option>Cash</option><option>UPI</option><option>Card</option><option>Bank Transfer</option><option>Cheque</option><option>Other</option>'+
      '</select>'+
      '<input id="spay-ref" type="text" placeholder="Reference (optional)" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
    '</div>'+
    '<div style="display:flex;gap:9px;margin-top:16px;">'+
      '<button class="btn btn-sm" style="flex:1;background:var(--surf2);border:1px solid var(--border2);" onclick="document.getElementById(\'spay-modal\').style.display=\'none\'">Cancel</button>'+
      '<button class="btn btn-sm btn-success" style="flex:1;" onclick="submitSalePayment(\''+saleId+'\')">Record Payment</button>'+
    '</div>';
}

function submitSalePayment(saleId){
  var sale=(S.sales||[]).find(function(x){return x.id===saleId;});
  if(!sale) return;
  if(_salePaymentSubmitLock[saleId]){ toast('Payment already being recorded — please wait'); return; }
  var amount=parseFloat(document.getElementById('spay-amount').value);
  var mode=document.getElementById('spay-mode').value;
  var ref=(document.getElementById('spay-ref').value||'').trim();
  if(!amount||amount<=0){toast('Enter a valid amount');return;}
  var t=calcSaleTotals(sale);

  function doSubmit(){
    var _snap = JSON.parse(JSON.stringify(sale.extraPayments||[]));
    _salePaymentSubmitLock[saleId]=true;
    if(!sale.extraPayments) sale.extraPayments=[];
    var payId=(typeof crypto.randomUUID==='function')?crypto.randomUUID():'PAY-'+Date.now();
    sale.extraPayments.push({id:payId,amount:amount,mode:mode,ref:ref,date:new Date().toISOString(),by:(SAAS&&SAAS.user?(SAAS.user.name||SAAS.user.email):'staff')});
    if(typeof addPaymentRecord==='function') addPaymentRecord(sale, amount, mode, ref||'Payment received');
    document.getElementById('spay-modal').style.display='none';
    saveToCloud(function(err){
      _salePaymentSubmitLock[saleId]=false;
      if(!err){
        renderCustomers(); renderTab('sales');
        toast('\u2713 '+fmt(amount)+' payment recorded');
      } else {
        sale.extraPayments=_snap;
        if(sale.paymentHistory && sale.paymentHistory.length) sale.paymentHistory.pop();
        saveCache();
        if(err.message!=='version-conflict'){
          toast('\u26a0 Could not save — payment rolled back. Check your connection and try again.');
        }
      }
    });
  }

  if(amount > t.bal + 1){
    safeConfirm('Payment exceeds balance?','This payment ('+fmt(amount)+') is more than the outstanding balance ('+fmt(t.bal)+'). Continue anyway?',doSubmit,true);
    return;
  }
  doSubmit();
}

// Reverses one specific logged payment — appends a reversal entry,
// never edits or deletes the original (Foundation audit §9).
function reverseSalePayment(saleId, paymentId){
  var sale=(S.sales||[]).find(function(x){return x.id===saleId;});
  if(!sale||!sale.extraPayments) return;
  var pay=sale.extraPayments.find(function(p){return p.id===paymentId;});
  if(!pay || pay.type==='reversal') return;
  if(_salePaymentSubmitLock[saleId]){ toast('Please wait — a save is already in progress'); return; }
  var alreadyReversed = sale.extraPayments.some(function(p){return p.reversedPayment===paymentId;});
  if(alreadyReversed){ toast('Already reversed'); return; }
  safeConfirm('Reverse this payment?','Reverse '+fmt(pay.amount)+' ('+pay.mode+', '+fmtDate(pay.date)+')? Recorded as a reversal, not deleted.',function(){
    var _snap = JSON.parse(JSON.stringify(sale.extraPayments));
    _salePaymentSubmitLock[saleId]=true;
    sale.extraPayments.push({id:(typeof crypto.randomUUID==='function')?crypto.randomUUID():'REV-'+Date.now(),type:'reversal',amount:pay.amount,mode:pay.mode,ref:'Reversal of '+paymentId,date:new Date().toISOString(),reversedPayment:paymentId,by:(SAAS&&SAAS.user?(SAAS.user.name||SAAS.user.email):'staff')});
    saveToCloud(function(err){
      _salePaymentSubmitLock[saleId]=false;
      if(!err){ renderCustomers(); renderTab('sales'); toast('\u2718 Payment reversed'); }
      else{
        sale.extraPayments=_snap;
        saveCache();
        if(err.message!=='version-conflict') toast('\u26a0 Could not save — reversal rolled back.');
      }
    });
  },true);
}

function openRefundModal(saleId) {
  var sale=(S.sales||[]).find(function(x){return x.id===saleId;});
  if(!sale){toast('Sale not found');return;}
  if(sale.refundStatus==='full'){toast('Already fully refunded');return;}
  var t=calcSaleTotals(sale);
  var done=(sale.refunds||[]).reduce(function(s,r){return s+r.amount;},0);
  var maxR=t.grand-done;
  if(maxR<=0){toast('Nothing left to refund');return;}

  var mInner=document.getElementById('refund-modal-inner');
  if(!mInner){
    var ov=document.createElement('div');
    ov.id='refund-modal';
    ov.style.cssText='display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
    ov.innerHTML='<div id="refund-modal-inner" style="background:var(--surface);border-radius:18px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35);padding:22px;"></div>';
    document.body.appendChild(ov);
    mInner=document.getElementById('refund-modal-inner');
  }
  document.getElementById('refund-modal').style.display='flex';

  // Foundation audit B5: sale.returnedItemIdx tracks which item indices
  // have already been physically returned (created a 'returned' product
  // and/or been checked in a prior refund), so they can't be returned
  // twice across multiple partial refunds on the same sale.
  var alreadyReturned = sale.returnedItemIdx || [];
  var returnableItems = (sale.items||[])
    .map(function(it,idx){ return {it:it, idx:idx}; })
    .filter(function(x){ return x.it.pid && alreadyReturned.indexOf(x.idx)===-1; });

  var itemsHtml = '';
  if(returnableItems.length){
    itemsHtml =
      '<label style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Physically Returned Items (optional)</label>'+
      '<div style="border:1px solid var(--border2);border-radius:9px;padding:8px;max-height:140px;overflow-y:auto;display:grid;gap:6px;">'+
      returnableItems.map(function(x){
        return '<label style="display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;">'+
          '<input type="checkbox" class="rfnd-item-chk" value="'+x.idx+'" style="width:16px;height:16px;">'+
          '<span>'+escHtml(x.it.name)+' &middot; '+fmtW(x.it.grossWeight||x.it.weight)+' &middot; '+escHtml(x.it.purity||'')+'</span>'+
        '</label>';
      }).join('')+
      '</div>'+
      '<div style="font-size:11px;color:var(--text3);">Checked items go back into inventory as <b>Returned — needs inspection</b>, not straight to sellable stock.</div>';
  }

  mInner.innerHTML=
    '<div style="font-family:\'Cormorant Garamond\',Georgia,serif;font-size:20px;font-weight:600;color:var(--ink);margin-bottom:4px;">Issue Refund</div>'+
    '<div style="font-size:12px;color:var(--text3);margin-bottom:14px;">'+escHtml(sale.invNo||sale.id)+' &middot; '+escHtml(sale.customer)+'</div>'+
    '<div style="background:var(--danger-soft);border:1px solid var(--danger);border-radius:10px;padding:12px;margin-bottom:14px;text-align:center;">'+
      '<div style="font-size:10px;font-weight:700;color:var(--danger);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;">Max Refundable</div>'+
      '<div style="font-size:30px;font-weight:800;color:var(--danger);">&#8377;'+Math.round(maxR).toLocaleString('en-IN')+'</div>'+
    '</div>'+
    '<div style="display:grid;gap:9px;">'+
      '<label style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Refund Amount</label>'+
      '<input id="rfnd-amount" type="number" step="1" max="'+Math.round(maxR)+'" value="'+Math.round(maxR)+'" style="width:100%;padding:11px 13px;border-radius:9px;border:1.5px solid var(--border2);font-size:20px;font-weight:700;font-family:inherit;background:var(--surface);">'+
      '<label style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Refund Mode</label>'+
      '<select id="rfnd-mode" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
        '<option value="Cash">&#128181; Cash</option>'+
        '<option value="UPI">&#128241; UPI</option>'+
        '<option value="Bank Transfer">&#127968; Bank Transfer</option>'+
      '</select>'+
      '<label style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;">Reason</label>'+
      '<select id="rfnd-reason" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
        '<option>Customer Return</option><option>Defective Item</option><option>Wrong Item</option>'+
        '<option>Price Correction</option><option>Order Cancelled</option><option>Other</option>'+
      '</select>'+
      '<input id="rfnd-note" type="text" placeholder="Additional notes (optional)" style="width:100%;padding:9px 12px;border-radius:9px;border:1px solid var(--border2);background:var(--surface);font-size:13px;font-family:inherit;">'+
    '</div>'+
    (itemsHtml ? '<div style="display:grid;gap:9px;margin-top:12px;">'+itemsHtml+'</div>' : '')+
    '<div style="display:flex;gap:9px;margin-top:16px;">'+
      '<button onclick="closeRefundModal()" class="btn" style="flex:1;">Cancel</button>'+
      '<button onclick="_submitRefund(\''+saleId+'\')" class="btn-danger" style="flex:2;padding:12px;border-radius:9px;border:none;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;background:var(--danger);color:#fff;">&#128260; Issue Refund</button>'+
    '</div>';
}

function closeRefundModal() {
  var m=document.getElementById('refund-modal');
  if(m) m.style.display='none';
}

function _submitRefund(saleId) {
  var sale=(S.sales||[]).find(function(x){return x.id===saleId;});
  if(!sale) return;
  if(_refundSubmitLock){ toast('Refund already being processed — please wait'); return; }
  var amount=parseFloat(document.getElementById('rfnd-amount').value);
  var mode  =document.getElementById('rfnd-mode').value;
  var reason=document.getElementById('rfnd-reason').value;
  var note  =(document.getElementById('rfnd-note').value||'').trim();
  if(!amount||amount<=0){toast('Enter valid amount');return;}
  var t=calcSaleTotals(sale);
  var done=(sale.refunds||[]).reduce(function(s,r){return s+r.amount;},0);
  if(amount > t.grand-done+1){toast('Amount exceeds refundable');return;}
  var checkedIdx = Array.prototype.slice.call(document.querySelectorAll('.rfnd-item-chk:checked'))
    .map(function(el){ return parseInt(el.value,10); });
  safeConfirm('Issue Refund?','Refund &#8377;'+Math.round(amount).toLocaleString('en-IN')+' to '+sale.customer+'?\nReason: '+reason,function(){
    var _snap = _refundSnapshot();
    _refundSubmitLock = true;
    if(!sale.refunds) sale.refunds=[];
    var refId=(typeof crypto.randomUUID==='function')?crypto.randomUUID():'REF-'+String(Date.now()).slice(-6);
    sale.refunds.push({id:refId,amount:amount,mode:mode,reason:reason,note:note,date:new Date().toISOString(),by:(SAAS&&SAAS.user?(SAAS.user.name||SAAS.user.email):'staff')});
    var totalR=(sale.refunds||[]).reduce(function(s,r){return s+r.amount;},0);
    sale.refundStatus = totalR>=t.grand-1 ? 'full' : 'partial';

    // Foundation audit B5: physically-returned items go back into
    // inventory as their OWN new product row with status 'returned'
    // (needs inspection) — not merged into whatever product row the
    // original SKU still points to, since that original row may since
    // have been resold, edited, or deleted entirely. Copies identifying
    // details from the sale's own item snapshot, which is what survives
    // regardless of what happened to the source product afterward.
    if(!sale.returnedItemIdx) sale.returnedItemIdx=[];
    var createdCount=0;
    checkedIdx.forEach(function(idx){
      var item=(sale.items||[])[idx];
      if(!item || sale.returnedItemIdx.indexOf(idx)!==-1) return;
      var product={
        id:(typeof crypto!=='undefined'&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)+idx,
        _seq: S.nextId=(S.nextId||1)+1,
        name:item.name||'Returned item',
        cat:'Other',
        metal:item.metal||'gold',
        purity:item.purity||'22K',
        huid:item.huid||'',
        sku:'RET-'+(sale.invNo||saleId)+'-'+(idx+1),
        weight:item.grossWeight||item.weight||0,
        netWeight:item.weight||0,
        qty:Math.max(1,parseInt(item.qty,10)||1),
        alert:1,
        making:0,diamond:0,
        photo:'', notes:'Returned from sale '+(sale.invNo||saleId)+' ('+reason+')',
        status:'returned',
        createdAt:new Date().toISOString(),
        fromSaleId:sale.id,
        fromSaleItemIndex:idx
      };
      S.products=S.products||[];
      S.products.push(product);
      sale.returnedItemIdx.push(idx);
      createdCount++;
      logStockMovement(product.id, 'return', {
        newStatus:'returned', qtyChange: product.qty,
        relatedId: sale.id, relatedRef: sale.invNo, reason: 'Returned via refund '+refId+' ('+reason+')'
      });
    });

    auditLog('refund','sale',saleId,'&#8377;'+Math.round(amount)+' via '+mode+' | '+reason+(note?' | '+note:'')+(createdCount?' | '+createdCount+' item(s) returned to inventory':''));
    closeRefundModal();
    // Same snapshot/rollback shape as girvi/orders/purchases — a failed
    // save must not leave the refund AND the new 'returned' product rows
    // sitting in this tab while the cloud never received either.
    saveToCloud(function(err){
      _refundSubmitLock=false;
      if(!err){
        renderTab('sales');
        toast('Refund '+refId+' issued'+(createdCount?' \u00b7 '+createdCount+' item(s) sent for inspection':''));
      } else {
        _refundRestore(_snap);
        saveCache();
        if(err.message!=='version-conflict'){
          toast('\u26a0 Refund could not be saved — rolled back. Check your connection and try again.');
        }
      }
    });
  },true);
}

// Generic snapshot/restore for _submitRefund — mirrors the shape of
// _purchaseSnapshot/_purchaseRestore in 09-purchases.js but scoped to
// exactly what a refund can touch (sales + products), defined here since
// 01-sync-core.js loads before 09-purchases.js and refunds shouldn't
// depend on load order of an unrelated module.
var _refundSubmitLock = false;
function _refundSnapshot(){
  return {
    sales: JSON.parse(JSON.stringify(S.sales||[])),
    products: JSON.parse(JSON.stringify(S.products||[])),
    stockMovements: JSON.parse(JSON.stringify(S.stockMovements||[])),
    nextId: S.nextId
  };
}
function _refundRestore(snap){
  S.sales = snap.sales;
  S.products = snap.products;
  S.stockMovements = snap.stockMovements;
  S.nextId = snap.nextId;
}

// ===================================================================
// --- BARCODE LABEL ENGINE ------------------------------------------
// ===================================================================
function openBarcodeLabels(prodIds) {
  var prods = prodIds
    ? (S.products||[]).filter(function(p){return prodIds.indexOf(p.id)!==-1;})
    : (S.products||[]).filter(function(p){return p.status!=='sold'&&p.status!=='returned';}).slice(0,32);
  if(!prods.length){toast('No products for labels');return;}
  var labHtml = prods.map(function(p){
    var sku  = p.sku||('ITEM-'+p.id);
    var huid = p.huid||'';
    var price= Math.round((p.weight||0)*getRate(p.metal,p.purity));
    var bars = _barcodeSVG(sku);
    return '<div class="lbl">' +
      '<div class="ls">'+ escHtml((SAAS&&SAAS.shop&&SAAS.shop.name)||'Sri Sai Jewellers') +'</div>'+
      '<div class="ln">'+escHtml(p.name||p.category||'Item')+'</div>'+
      '<div class="lm">'+
        '<span class="lpur">'+escHtml(p.purity||'')+'</span>'+
        '<span class="lwt">'+parseFloat(p.weight||0).toFixed(2)+'g</span>'+
        (huid?'<span class="lhuid">'+escHtml(huid)+'</span>':'')+
      '</div>'+
      '<div class="lbar">'+bars+'</div>'+
      '<div class="lsku">'+escHtml(sku)+'</div>'+
      '<div class="lprice">&#8377;'+price.toLocaleString('en-IN')+'</div>'+
    '</div>';
  }).join('');

  var w=window.open('','_blank','width=900,height=700');
  if(!w){toast('Allow popups to print labels');return;}
  w.document.write('<!DOCTYPE html><html><head><title>Labels</title><style>'+
    '@page{size:A4;margin:8mm}body{margin:0;padding:6px;font-family:sans-serif}'+
    '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}'+
    '.lbl{border:1px solid #bbb;border-radius:5px;padding:7px;text-align:center;page-break-inside:avoid}'+
    '.ls{font-size:6.5px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.1em}'+
    '.ln{font-size:8.5px;font-weight:600;color:#111;min-height:20px;line-height:1.3;margin:2px 0}'+
    '.lm{display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin:3px 0}'+
    '.lpur{font-size:7px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px;font-weight:700}'+
    '.lwt{font-size:7px;background:#ede9fe;color:#4c1d95;padding:1px 4px;border-radius:3px;font-weight:700}'+
    '.lhuid{font-size:6.5px;background:#d1fae5;color:#065f46;padding:1px 4px;border-radius:3px;font-weight:600}'+
    '.lbar svg{width:100%;height:26px}'+
    '.lsku{font-size:6.5px;color:#888;margin-top:1px;font-weight:600}'+
    '.lprice{font-size:10px;font-weight:800;color:#7c3aed;margin-top:2px}'+
    '@media print{.noprint{display:none}}'+
  '</style></head><body>'+
  '<div class="noprint" style="padding:10px;background:#f1f5f9;margin-bottom:8px;display:flex;gap:10px;align-items:center;">'+
    '<span style="font-size:13px;font-weight:600">'+prods.length+' labels</span>'+
    '<button onclick="window.print()" style="padding:7px 18px;background:#7c3aed;color:#fff;border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer">Print</button>'+
    '<button onclick="window.close()" style="padding:7px 14px;background:#e2e8f0;border:none;border-radius:7px;font-size:13px;cursor:pointer">Close</button>'+
  '</div>'+
  '<div class="grid">'+labHtml+'</div>'+
  '</body></html>');
  w.document.close();
  auditLog('print','product','batch','Printed '+prods.length+' barcode labels');
}

function _barcodeSVG(text) {
  // Pseudo-barcode visual for label printing
  var s=0; for(var j=0;j<(text||'X').length;j++) s=(s*31+(text||'X').charCodeAt(j))&0xffff;
  var pat=[2]; for(var i=0;i<28;i++){s=(s*1103515245+12345)&0xffff;pat.push(1+(s%3));}pat.push(2);
  var tot=pat.reduce(function(a,v){return a+v;},0), uw=140/tot;
  var svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 26">',x=0;
  pat.forEach(function(w,i){var bw=w*uw;if(i%2===1)svg+='<rect x="'+x.toFixed(1)+'" y="0" width="'+bw.toFixed(1)+'" height="20" fill="#111"/>';x+=bw;});
  return svg+'</svg>';
}

function girviOutstandingWithPenalty(g){
  var base          = girviOutstanding(g);   // respects compound/simple flag
  var dueDays       = (parseInt(g.duration)||0) * 30;
  var daysSince     = girviDaysSince(g.startDate);
  var overdueMonths = (dueDays && daysSince > dueDays)
    ? Math.max(0, Math.floor((daysSince - dueDays) / 30))
    : 0;
  // Penalty applied on outstanding (not just principal) to match real-world practice
  var penalty = base * (GIRVI_PENALTY_RATE/100) * overdueMonths;
  var total   = base + penalty;
  // Risk classification
  var risk = 'low';
  if(overdueMonths >= 6)       risk = 'critical';
  else if(overdueMonths >= 3)  risk = 'high';
  else if(overdueMonths >= 1)  risk = 'medium';
  else if(daysSince > dueDays * 0.8) risk = 'watch';
  return { amount: total, base: base, penalty: penalty, penaltyMonths: overdueMonths, risk: risk };
}

// ── PROFIT SUMMARY HELPERS ───────────────────────────────────────────

// Day Book expenses for P&L (docs/DAYBOOK-SPEC-v2.md §1). Only group:'expense'
// entries count — Owner Drawings/Capital are equity movements, never a cost.
// Called with no args, totals across all time (calcAllTimeProfit); called
// with (year, month), totals that calendar month (calcMonthProfit). Derived
// at render time from S.dayBook.entries — no new stored field.
function calcDayBookExpenses(year, month){
  var filterByMonth = (year !== undefined && month !== undefined);
  var monthStartKey, monthEndKey;
  if(filterByMonth){
    // Plain 'YYYY-MM-DD' string compare, like every other date check in
    // 10-daybook.js — e.date is always a dateKey (dbAddEntry never stores
    // a timestamp there), and new Date('YYYY-MM-DD') parses as UTC
    // midnight while new Date(year,month,1) is local, a mismatch an Opus
    // review caught on 23 Sep 2026 (correct in IST by luck, not by design).
    monthStartKey = year+'-'+String(month+1).padStart(2,'0')+'-01';
    monthEndKey   = dbDayKey(new Date(year, month+1, 0));
  }
  var byCat = {}, total = 0;
  (S.dayBook && S.dayBook.entries || []).forEach(function(e){
    if(e.voided) return;
    if(!DB_CATS[e.cat] || DB_CATS[e.cat].group !== 'expense') return;
    if(filterByMonth && (e.date < monthStartKey || e.date > monthEndKey)) return;
    total = dbRound(total + e.amount);
    byCat[e.cat] = dbRound((byCat[e.cat]||0) + e.amount);
  });
  return { total: total, byCat: byCat };
}
function calcMonthProfit(year, month){
  var sales = S.sales.filter(function(s){
    var d=new Date(s.date); return d.getFullYear()===year && d.getMonth()===month;
  });
  var totalRevenue=0, totalCost=0, totalProfit=0, totalGST=0;
  sales.forEach(function(s){
    var p = calcSaleProfit(s);
    totalRevenue += p.revenue;
    totalCost    += p.cost;
    totalProfit  += p.profit;
    totalGST     += p.gstPaid;
  });
  // Add girvi interest income for the month
  var monthStart = new Date(year, month, 1);
  var monthEnd   = new Date(year, month+1, 0, 23, 59, 59);
  (S.girvi||[]).forEach(function(g){
    // Use the ledger walk's per-payment interest/principal split (computed
    // at the time each payment actually happened) instead of comparing
    // against today's live accrued-interest figure — the old approach could
    // misattribute an entire principal repayment as pure interest profit.
    var annotatedPayments = girviLedgerState(g).payments;
    annotatedPayments.forEach(function(p){
      var pd = new Date(p.date||p.ts);
      if(pd >= monthStart && pd <= monthEnd){
        totalRevenue += p.interestPortion;
        totalProfit  += p.interestPortion; // interest is pure profit — no cost
      }
    });
  });
  var margin = totalRevenue>0 ? (totalProfit/totalRevenue*100) : 0;
  var expenses = calcDayBookExpenses(year, month);
  return { revenue:totalRevenue, cost:totalCost, profit:totalProfit, gst:totalGST, margin:margin, count:sales.length, expenses:expenses, netProfit: totalProfit-expenses.total };
}

function calcAllTimeProfit(){
  var totalRevenue=0, totalProfit=0;
  S.sales.forEach(function(s){
    var p=calcSaleProfit(s);
    totalRevenue += p.revenue;
    totalProfit  += p.profit;
  });
  // Add girvi interest income, same as calcMonthProfit -- otherwise the
  // all-time figure is sales-only and can read lower than a single month
  // that has interest in it (batch28 device pass, 23 Sep 2026 HANDOFF entry).
  (S.girvi||[]).forEach(function(g){
    girviLedgerState(g).payments.forEach(function(p){
      totalRevenue += p.interestPortion;
      totalProfit  += p.interestPortion; // interest is pure profit -- no cost
    });
  });
  var expenses = calcDayBookExpenses();
  return { revenue:totalRevenue, profit:totalProfit, margin: totalRevenue>0?(totalProfit/totalRevenue*100):0, expenses:expenses, netProfit: totalProfit-expenses.total };
}

// ── CUSTOMER FINANCIAL PROFILE ───────────────────────────────────────
function calcCustomerFinancials(customerName, phone){
  var key = customerName+(phone?'_'+phone:'');
  var custSales = S.sales.filter(function(s){
    return (s.customer||'')===(customerName||'') && (!phone||(s.phone||'')===(phone||''));
  });
  var custGirvi = (S.girvi||[]).filter(function(g){
    return !g._deleted && ((g.customer||'')===(customerName||'') && (!phone||(g.phone||'')===(phone||'')));
  });
  var totalPurchased=0, totalPaid=0, totalCredit=0;
  custSales.forEach(function(s){
    var t=calcSaleTotals(s);
    totalPurchased += t.grand;
    totalPaid      += t.adv;
    totalCredit    += t.bal;
  });
  var activeGirvi = custGirvi.filter(function(g){ return g.status!=='closed'; });
  var girviExposure = activeGirvi.reduce(function(s,g){ return s+girviOutstanding(g); },0);
  var totalExposure = totalCredit + girviExposure;
  var riskLevel = totalExposure > 50000 ? 'high' : totalExposure > 10000 ? 'medium' : 'low';
  return {
    totalPurchased: totalPurchased,
    totalPaid:      totalPaid,
    totalCredit:    totalCredit,
    girviExposure:  girviExposure,
    totalExposure:  totalExposure,
    riskLevel:      riskLevel,
    salesCount:     custSales.length,
    girviCount:     custGirvi.length,
    activeGirvi:    activeGirvi.length
  };
}

// ── OVERDUE PAYMENT INTELLIGENCE ────────────────────────────────────
function getSalesDueSoon(days){
  // Sales with outstanding balance older than `days`
  return S.sales.filter(function(s){
    var t = calcSaleTotals(s);
    return t.bal > 0 && getAgingDays(s) >= days;
  });
}

function getGirviDueSoon(days){
  return (S.girvi||[]).filter(function(g){
    if(g.status==='closed') return false;
    if(!g.duration) return false;
    var dueDate = new Date(g.startDate);
    dueDate.setMonth(dueDate.getMonth() + parseInt(g.duration));
    var daysLeft = Math.floor((dueDate.getTime()-Date.now())/86400000);
    return daysLeft <= days && daysLeft >= 0;
  });
}

// END FINANCIAL ENGINE v9


// ═══════════════════════════════════════════════════════════════════════
// PAYMENT AGING
// ═══════════════════════════════════════════════════════════════════════
function getAgingDays(sale){
  var t=calcSaleTotals(sale);
  if(t.bal<=0) return 0;
  var d=new Date(sale.date);
  return Math.floor((Date.now()-d.getTime())/86400000);
}

function agingClass(days){
  if(days===0) return 'aging-ok';
  if(days<=7)  return 'aging-ok';
  if(days<=30) return 'aging-warn';
  return 'aging-crit';
}

function agingLabel(days){
  if(days===0) return 'Paid';
  if(days<=7)  return days+'d';
  if(days<=30) return days+'d overdue';
  return days+'d OVERDUE';
}

// ═══════════════════════════════════════════════════════════════════════
// DEBOUNCE UTILITY
// ═══════════════════════════════════════════════════════════════════════
function debounce(fn, ms){
  var t;
  return function(){
    var args=arguments, ctx=this;
    clearTimeout(t);
    t=setTimeout(function(){fn.apply(ctx,args);},ms);
  };
}
// Stable debounced search handlers
// Wrapped in anonymous functions (not passed directly) because these lines
// run at script-load time, before renderInv/renderOrders/renderCustomers
// (defined in later-loading files) exist yet. The wrapper defers the name
// lookup until the debounced function is actually called, by which point
// every script has finished loading.
var debouncedRenderInv = debounce(function(){ renderInv.apply(this, arguments); }, 280);
var debouncedRenderOrders = debounce(function(){ renderOrders.apply(this, arguments); }, 280);
var debouncedRenderCustomers = debounce(function(){ renderCustomers.apply(this, arguments); }, 280);


// ═══════════════════════════════════════════════════════════════════════
// AUTO-LOCK ON INACTIVITY (3 minutes)
// ═══════════════════════════════════════════════════════════════════════
var INACTIVITY_MS = 3 * 60 * 1000; // 3 minutes
var _inactTimer = null;
var _inactOverlayShown = false;

function resetInactivityTimer(){
  if(!isPinSessionActive()) return; // not logged in / already timed out
  try{ localStorage.setItem(_PIN_LAST_ACTIVE_KEY(), String(Date.now())); }catch(e){} // refresh on every touch/click/etc.
  clearTimeout(_inactTimer);
  _inactTimer = setTimeout(showInactivityLock, INACTIVITY_MS);
}

