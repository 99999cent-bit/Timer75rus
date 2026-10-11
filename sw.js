/* Service Worker приложения Chat (v2).
   • Приложение устанавливается и открывается без сети.
   • Библиотеки Firebase и каталоги музыки/радио кэшируются — не скачиваются каждый раз заново.
   • Показывает системные уведомления.
   Музыкальные потоки и данные Firestore идут напрямую (у Firestore свой кэш на устройстве). */
const CACHE = 'chat-shell-v3';
const DATA = 'chat-data-v1';
const MEDIA = 'chat-media-v1';   /* смайлики, стикеры, фото из чатов — один раз скачали, дальше без интернета */
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event)=>{
  event.waitUntil(caches.open(CACHE).then(c=> c.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=> k !== CACHE && k !== DATA && k !== MEDIA).map(k=> caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

/* не больше 3000 файлов: самые старые удаляются */
let trimAt = 0;
async function trimMedia(){
  if(Date.now() - trimAt < 60000) return; trimAt = Date.now();
  const c = await caches.open(MEDIA); const keys = await c.keys();
  if(keys.length > 3000) await Promise.all(keys.slice(0, keys.length - 2600).map(k=> c.delete(k)));
}

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
  // смайлики, 3D-стикеры, фото и картинки из чатов: из телефона, а не из сети
  if((url.hostname === 'fonts.gstatic.com' && url.pathname.startsWith('/s/e/notoemoji/'))
     || (url.hostname === 'cdn.jsdelivr.net' && /emoji/i.test(url.pathname))
     || (url.hostname === 'firebasestorage.googleapis.com' && !/\.(mp4|webm|mov|m4a|mp3|ogg|wav)(\?|$)/i.test(url.pathname))){
    event.respondWith(caches.open(MEDIA).then(async (c)=>{
      const hit = await c.match(req, {ignoreVary: true});
      /* «закрытая» копия (от обычной картинки) не годится для живых смайликов, которые раскладываются на кадры — берём из сети и заменяем */
      const usable = hit && !(hit.type === 'opaque' && req.mode === 'cors');
      if(usable) return hit;
      try{
        const res = await fetch(req);
        if(res && (res.ok || (res.type === 'opaque' && !hit))) c.put(req, res.clone()).then(trimMedia).catch(()=>{});
        return res;
      }catch(e){ if(hit && req.mode !== 'cors') return hit; throw e; }
    }));
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
