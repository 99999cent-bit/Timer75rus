// Импорт Firebase скриптов для Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Инициализация с вашими настройками из app.js
firebase.initializeApp({
  apiKey: "AIzaSyCqHBCbqGSuo4V2FpQ9QICg00QQpO1-P-s",
  authDomain: "chat-42f66.firebaseapp.com",
  projectId: "chat-42f66",
  storageBucket: "chat-42f66.firebasestorage.app",
  messagingSenderId: "708710541235",
  appId: "1:708710541235:web:246f6a7ecd2b4f0b3ecdc6"
});

const messaging = firebase.messaging();

// Перехват уведомлений при закрытом приложении
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Получено фоновое сообщение:', payload);
  const title = payload.notification?.title || 'Новое сообщение';
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png'
  };

  self.registration.showNotification(title, options);
});
