/* Фоновый обработчик push-уведомлений.
   Положите этот файл рядом с index.html. Настраивать ничего не нужно:
   приложение само передаёт сюда параметры проекта при регистрации. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const q = new URL(self.location).searchParams;
firebase.initializeApp({
  apiKey: q.get('apiKey'),
  projectId: q.get('projectId'),
  appId: q.get('appId'),
  messagingSenderId: q.get('senderId'),
  authDomain: (q.get('projectId') || '') + '.firebaseapp.com',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || 'Новое сообщение';
  self.registration.showNotification(title, {
    body: d.body || '',
    icon: d.icon || './icon-192.png',
    badge: './icon-192.png',
    tag: d.tag || 'chat',
    data: {chatId: d.chatId || '', url: d.url || './'},
    vibrate: [120, 60, 120],
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow(target);
    })
  );
});
