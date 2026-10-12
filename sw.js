/* Service Worker приложения Chat (v2).
   • Приложение устанавливается и открывается без сети.
   • Библиотеки Firebase и каталоги музыки/радио кэшируются — не скачиваются каждый раз заново.
   • Показывает системные уведомления.
   Музыкальные потоки и данные Firestore идут напрямую (у Firestore свой кэш на устройстве). */
const CACHE = 'chat-shell-v5';
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
  if((url.origin === self.location.origin && url.pathname.indexOf('/fx/') >= 0)
     || (url.hostname === 'fonts.gstatic.com' && url.pathname.startsWith('/s/e/notoemoji/'))
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
    /* приложение открывается мгновенно и без сети: страница, скрипт и стили — из телефона,
       а свежая версия скачивается в фоне и будет при следующем запуске */
    const nav = req.mode === 'navigate';
    const shell = nav || /\.(js|css|webmanifest|png|svg|ico)$/.test(url.pathname) || url.pathname.endsWith('/');
    if(shell && !url.pathname.endsWith('/sw.js') && !url.pathname.endsWith('firebase-messaging-sw.js')){
      event.respondWith((async ()=>{
        const c = await caches.open(CACHE);
        const hit = nav ? (await c.match(req, {ignoreSearch: true}) || await c.match('./index.html') || await c.match('./')) : await c.match(req);
        const fresh = fetch(req, {cache: 'no-cache'}).then((res)=>{
          if(res && res.ok){
            const copy = res.clone();
            c.put(nav ? './index.html' : req, copy).then(async ()=>{
              /* старые версии того же файла (app.js?v=…) — удалить */
              if(nav || !url.search) return;
              for(const k of await c.keys()){ const u = new URL(k.url); if(u.pathname === url.pathname && u.search !== url.search) c.delete(k); }
            }).catch(()=>{});
          }
          return res;
        });
        if(hit){ event.waitUntil(fresh.catch(()=>{})); return hit; }
        try{ return await fresh; }catch(e){ return (await c.match('./index.html')) || Response.error(); }
      })());
      return;
    }
    event.respondWith(
      fetch(req).then(res=>{ if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)); } return res; })
        .catch(()=> caches.match(req).then(hit=> hit || caches.match('./index.html')))
    );
  }
});

self.addEventListener('notificationclick', (event)=>{
  event.notification.close();
  /* куда вести: чат, календарь (метка cal-…) или «тип:отправитель» (лайк, история, друг…) */
  const n = event.notification, d = (n && n.data) || {}, tag = String((n && n.tag) || '');
  let target = d.target || '';
  if(!target){
    if(d.chatId) target = 'chat:' + d.chatId;
    else if(/^cal-/.test(tag)) target = 'cal:' + tag.slice(4);
    else if(d.type && d.type !== 'test') target = d.type + ':' + (d.sender || '');
  }
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list=>{
      for(const c of list){
        if('focus' in c){
          if(target){ try{ c.postMessage({type: 'open-target', target}); }catch(e){} }
          return c.focus();
        }
      }
      return self.clients.openWindow(target ? './?target=' + encodeURIComponent(target) : './');
    })
  );
});
