/* Service Worker приложения Chat.
   - Делает приложение устанавливаемым (иконка на главном экране).
   - Открывает оболочку приложения без сети (данные Firestore при этом не кэшируются).
   - Показывает системные уведомления (на Android Chrome без этого они не работают).
   Push-уведомления при закрытом приложении сюда НЕ входят — для них нужен Firebase Cloud Messaging. */
const CACHE = 'chat-shell-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event)=>{
  event.waitUntil(caches.open(CACHE).then(c=> c.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=> k !== CACHE).map(k=> caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Библиотеки Firebase: адрес содержит версию, поэтому можно брать из кэша
  if(url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')){
    event.respondWith(
      caches.match(req).then(hit=> hit || fetch(req).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=> c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // Свои файлы: сначала сеть (чтобы обновления приходили сразу), без сети — из кэша
  if(url.origin === self.location.origin){
    event.respondWith(
      fetch(req).then(res=>{
        if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)); }
        return res;
      }).catch(()=> caches.match(req).then(hit=> hit || caches.match('./index.html')))
    );
  }
  // Всё остальное (Firestore, TURN и т.д.) идёт напрямую, без вмешательства
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
