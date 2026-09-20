
// ─── SUPABASE CONFIG ─────────────────────────────────────────────────────
var SB_URL = 'https://uluzuwomwqsqxtejgzmf.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsdXp1d29td3FzcXh0ZWpnem1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4MjA2ODYsImV4cCI6MjA4OTM5NjY4Nn0.Eq_RXzOf_iifmcCfC7z-9iHUPKoOH9NfbRP2Q9OEHcA';
var SB_FUNCTIONS = SB_URL + '/functions/v1'; // Edge Function proxies — store-proxy, auth-gateway
// SB_REST (direct PostgREST access to the `store` table) was removed in
// the Aug 2026 P0 hardening pass. RLS now default-denies anon/authenticated
// on that table (see supabase/migrations/001_lockdown_rls.sql), so a raw
// REST call to it always fails — every read/write goes through
// SB_FUNCTIONS + '/store-proxy' instead. SB_HEADERS is still used (it
// carries the anon apikey Supabase requires to invoke any Edge Function,
// plus the per-call x-shop-key header added at each call site).
var SB_HEADERS = {'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Prefer':'return=representation'};
// ─── PER-SHOP LOCALSTORAGE SCOPING ───────────────────────────────────────
// Any browser-local key that holds SHOP-specific state must be suffixed with
// the shop id. An unscoped key leaks across accounts on a shared device: the
// second shop to log in on the same browser inherits the first shop's value.
// This bug class has been found and fixed six times now — use this helper for
// any new local key that is not genuinely device-global.
function shopScopedKey(base){
  var shop = (typeof SAAS !== 'undefined' && SAAS.shop && SAAS.shop.id) || 'noshop';
  return base + '::' + shop;
}

var AUTO_REFRESH_MS = 15000;
var refreshTimer = null;
var isSaving = false;
var _isSavingSetAt = 0;

// Watchdog: auto-release isSaving if stuck for more than 30 seconds
setInterval(function(){
  if(isSaving && _isSavingSetAt > 0 && (Date.now() - _isSavingSetAt) > 30000){
    console.warn('[JewelOS] isSaving stuck for 30s — auto-releasing lock');
    isSaving = false;
    _isSavingSetAt = 0;
    setSyncStatus('err','Save lock reset');
  }
}, 5000);

// ─── CONSTANTS ────────────────────────────────────────────────────────────
var G_PUR=['24K','22K','18K','14K','Gold Plated'];
var S_PUR=['999 Pure','925 Sterling','800','Silver Plated'];
var CATS=['All','Rings','Necklaces / Haar','Earrings','Jhumkas','Bangles','Kankanalu','Bracelets','Anklets / Payal','Pendants','Chains','Mangalsutras','Maang Tikka','Nose Ring / Nath','Armlet / Bajuband','Waist Belt / Kamarbandh','Jadau','Other'];
var CCLS={Rings:'bg-purple','Necklaces / Haar':'bg-gold',Earrings:'bg-blue',Jhumkas:'bg-blue',Bangles:'bg-green',Kankanalu:'bg-green',Bracelets:'bg-info','Anklets / Payal':'bg-purple',Pendants:'bg-gold',Chains:'bg-gold',Mangalsutras:'bg-red','Maang Tikka':'bg-amber','Nose Ring / Nath':'bg-amber','Armlet / Bajuband':'bg-silver','Waist Belt / Kamarbandh':'bg-silver',Jadau:'bg-gold',Other:'bg-silver'};

// ─── STATE ────────────────────────────────────────────────────────────────
var S = {
  products:[], sales:[], orders:[], girvi:[], customers:[],
  purchases:[], suppliers:[], purchaseAuditLog:[],
  rates:{g24:7800,g22:7200,g18:5900,g14:4600,sil:95},
  nextId:1, nextSaleId:1, nextInvNo:1, nextOrdId:1, nextGirviId:1, nextPurchaseId:1, nextPurchaseBillNo:1,
  purchaseCfg:{gst:true, goldRate:false, stone:false, hallmark:false, credit:false, timeline:false},
  dayBook:null
};

// UI state (not saved to cloud)
var UI = { metal:'gold', selCat:'All', saleItems:[{pid:'',qty:1}], saleMode:'stock' };
var customSaleItems = [{name:'',metal:'gold',purity:'22K',grossWt:0,blackBeads:0,diamond:0,making:0,stoneCharges:0}];

// ─── SUPABASE SYNC ───────────────────────────────────────────────────────
