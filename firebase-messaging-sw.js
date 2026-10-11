/* Фоновые push-уведомления (Firebase Cloud Messaging).
   Лежит рядом с index.html. Настраивать ничего не нужно —
   ключи приходят из приложения в адресе регистрации. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const P = new URLSearchParams(self.location.search);
try {
  firebase.initializeApp({
    apiKey: P.get('apiKey') || '',
    projectId: P.get('projectId') || '',
    appId: P.get('appId') || '',
    messagingSenderId: P.get('senderId') || ''
  });
  const messaging = firebase.messaging();
  /* уведомление без готового «notification» — рисуем сами */
  messaging.onBackgroundMessage((p) => {
    if (p && p.notification) return;           /* такое Firebase покажет сам */
    const d = (p && p.data) || {};
    return self.registration.showNotification(d.title || 'Новое сообщение', {
      body: d.body || '',
      tag: d.chatId ? 'chat-' + d.chatId : (d.type || 'msg'),
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: d
    });
  });
} catch (e) {}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/* нажатие на уведомление — открыть приложение (и нужный чат) */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = (event.notification && event.notification.data) || {};
  const fcm = d.FCM_MSG || {};
  const data = Object.assign({}, fcm.data || {}, d);
  const base = new URL('./', self.registration.scope.replace(/firebase-cloud-messaging-push-scope\/?$/, '')).href;
  const url = data.url || (data.chatId ? base + '?chat=' + encodeURIComponent(data.chatId) : base);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(base)) {
        try { c.postMessage({ type: 'open-chat', chatId: data.chatId || '' }); } catch (e) {}
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
