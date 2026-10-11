/* Фоновые push-уведомления (Firebase Cloud Messaging).
   Лежит рядом с index.html. Настраивать ничего не нужно —
   ключи приходят из приложения в адресе регистрации. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

/* папка приложения: .../Timer75rus/ (без служебной папки push) */
const APP_BASE = new URL('./', self.location.href).href;

/* аватарки собеседников, сохранённые приложением (IndexedDB «pushAvatars») */
function avatarFromPhone(key) {
  return new Promise((resolve) => {
    try {
      const rq = indexedDB.open('pushAvatars', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('a'); } catch (e) {} };
      rq.onerror = () => resolve('');
      rq.onsuccess = () => {
        try {
          const g = rq.result.transaction('a', 'readonly').objectStore('a').get(String(key));
          g.onsuccess = () => resolve(typeof g.result === 'string' ? g.result : '');
          g.onerror = () => resolve('');
        } catch (e) { resolve(''); }
      };
    } catch (e) { resolve(''); }
  });
}

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
  messaging.onBackgroundMessage(async (p) => {
    if (p && p.notification) return;           /* такое Firebase покажет сам */
    const d = (p && p.data) || {};
    /* фото справа: аватарка, которую приложение заранее сохранило на телефоне */
    const saved = (d.chatId && await avatarFromPhone('chat-' + d.chatId)) || (d.from && await avatarFromPhone(d.from)) || '';
    const icon = saved || (/^https:\/\//.test(d.icon || '') ? d.icon : APP_BASE + 'icon-192.png');
    return self.registration.showNotification(d.title || 'Новое сообщение', {
      body: d.body || '',
      tag: d.chatId ? 'chat-' + d.chatId : (d.type || 'msg'),
      renotify: true,
      icon,
      badge: APP_BASE + 'badge-96.png',          /* маленький белый значок в строке состояния */
      vibrate: [180, 80, 180],
      timestamp: Date.now(),
      lang: 'ru',
      data: { chatId: d.chatId || '', from: d.from || '', type: d.type || '' }
    });
  });
} catch (e) {}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/* нажатие на уведомление — открыть приложение и нужный чат.
   Адрес всегда строим от папки приложения — так не бывает 404. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = (event.notification && event.notification.data) || {};
  const fcm = d.FCM_MSG || {};
  const data = Object.assign({}, fcm.data || {}, d);
  const chatId = data.chatId || '';
  const url = APP_BASE + (chatId ? '?chat=' + encodeURIComponent(chatId) : '');
  const basePath = new URL(APP_BASE).pathname;
  const isApp = (u) => { try { const x = new URL(u); return x.origin === self.location.origin && (x.pathname === basePath || x.pathname === basePath + 'index.html'); } catch (e) { return false; } };
  event.stopImmediatePropagation();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* 1) уже открытое приложение — переключаемся на него и открываем чат */
    for (const c of all) {
      if (isApp(c.url)) {
        try { c.postMessage({ type: 'open-chat', chatId }); } catch (e) {}
        try { return await c.focus(); } catch (e) {}
      }
    }
    /* 2) открыта другая страница сайта — переводим её на приложение */
    for (const c of all) {
      if (c.url.startsWith(self.location.origin + basePath) && 'navigate' in c) {
        try { const w = await c.navigate(url); if (w) return w.focus(); } catch (e) {}
      }
    }
    /* 3) иначе — новое окно */
    return self.clients.openWindow(url);
  })());
});
