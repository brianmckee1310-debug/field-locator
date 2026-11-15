const CACHE='fl-v3.3';
const ASSETS=['./','./index.html','./app.css','./app.js','./state.js','./ui.js','./geo.js','./store.js','./tools.js','./calib.js','./mosaic.js',
  './track.js','./io.js','./aerial.js','./manifest.json','./icon-192.png','./icon-512.png','./pdf.min.mjs','./pdf.worker.min.mjs'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET' || u.origin!==self.location.origin) return;   // imagery downloads go straight to the network
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>hit||fetch(e.request)
    .then(res=>{ if(res.ok){ const cp=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{}); } return res; })
    .catch(()=>caches.match('./index.html'))));
});
