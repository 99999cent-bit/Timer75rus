/* Service Worker приложения Chat (v2).
   • Приложение устанавливается и открывается без сети.
   • Библиотеки Firebase и каталоги музыки/радио кэшируются — не скачиваются каждый раз заново.
   • Показывает системные уведомления.
   Музыкальные потоки и данные Firestore идут напрямую (у Firestore свой кэш на устройстве). */
const CACHE = 'chat-shell-v2';
const DATA = 'chat-data-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event)=>{
  event.waitUntil(caches.open(CACHE).then(c=> c.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=> k !== CACHE && k !== DATA).map(k=> caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

// «Устаревший, но мгновенный» ответ из кэша, в фоне — свежий (для списков треков и станций)
async function staleWhileRevalidate(req, maxAgeMs){
  const cache = await caches.open(DATA);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res=>{
    if(res.ok){ const copy = res.clone(); cache.put(req, copy); }
    return res;
  }).catch(()=> hit);
  if(hit){
    const age = Date.now() - new Date(hit.headers.get('date') || 0).getTime();
    if(age < maxAgeMs) { fresh.catch(()=>{}); return hit; }
  }
  return fresh.then(r=> r || hit || new Response('[]', {status: 503, headers: {'Content-Type': 'application/json'}}));
}

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET' || req.headers.get('range')) return;          // аудио с перемоткой — напрямую
  const url = new URL(req.url);

  if(url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')){
    event.respondWith(caches.match(req).then(hit=> hit || fetch(req).then(res=>{ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)); return res; })));
    return;
  }
  // каталоги: тренды/поиск Audius и списки станций — 10 минут из кэша
  if((/audius/.test(url.hostname) && /\/v1\/tracks\/(trending|search)/.test(url.pathname)) || (/radio-browser\.info$/.test(url.hostname) && url.pathname.startsWith('/json/'))){
    event.respondWith(staleWhileRevalidate(req, 10 * 60 * 1000));
    return;
  }
  if(url.origin === self.location.origin){
    event.respondWith(
      fetch(req).then(res=>{ if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)); } return res; })
        .catch(()=> caches.match(req).then(hit=> hit || caches.match('./index.html')))
    );
  }
});

self.addEventListener('notificationclick', (event)=>{
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list=>{
      for(const c of list){ if('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});
