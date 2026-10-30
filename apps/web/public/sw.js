const CACHE='aftertrace-app-__BUILD__';
const PRECACHE=__PRECACHE__;
// Static hosts may redirect /index.html; navigation fallback must not retain redirected=true.
async function offlineShell(cache){const response=await cache.match('/index.html');return response?new Response(response.body,{status:200,headers:response.headers}):Response.error();}
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PRECACHE)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('aftertrace-app-')&&name!==CACHE)await caches.delete(name);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(url.origin===self.location.origin){event.respondWith((async()=>{const cache=await caches.open(CACHE);if(request.mode==='navigate'){try{const response=await fetch(request);return response.ok?response:await offlineShell(cache);}catch{return offlineShell(cache);}}return(await cache.match(request))??fetch(request);})());}else if(url.origin==='https://cdn.jsdelivr.net'&&/^\/npm\/onnxruntime-web@[^/]+\/dist\/ort-/.test(url.pathname)){event.respondWith((async()=>{const cache=await caches.open('aftertrace-runtime-v1'),cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;})());}});

self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')void self.skipWaiting();});
