var CACHE='jewelos-v19';
self.addEventListener('install',function(e){self.skipWaiting();});
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
    if(r&&r.status===200){var c=r.clone();caches.open(CACHE).then(function(ca){ca.put(e.request,c);});}
    return r;
  }).catch(function(){return caches.match(e.request);}));
});
