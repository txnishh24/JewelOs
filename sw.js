var CACHE='jewelos-v20';
var SHELL=['./','manifest.json','icon-192.png','icon-512.png',
  'js/00-config-state.js','js/01-sync-core.js','js/02-ui-inactivity-modals.js',
  'js/03-billing-numbers.js','js/04-orders-detail.js','js/05-auth-login.js',
  'js/06-inventory-stock.js','js/07-settings-plans.js','js/08-girvi-viewmode.js',
  'js/09-purchases.js','js/10-daybook.js'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(ca){return ca.addAll(SHELL);}));
  self.skipWaiting();
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(k){
    return Promise.all(k.filter(function(n){return n!==CACHE;}).map(function(n){return caches.delete(n);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  var u=e.request.url;
  if(u.indexOf('supabase.co')>-1||u.indexOf('razorpay')>-1)return;
  e.respondWith(fetch(e.request).then(function(r){
    if(r&&r.status===200){
      var c=r.clone();
      e.waitUntil(caches.open(CACHE).then(function(ca){return ca.put(e.request,c);}));
    }
    return r;
  }).catch(function(){return caches.match(e.request);}));
});
