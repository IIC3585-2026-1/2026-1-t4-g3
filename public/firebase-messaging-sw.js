importScripts("/firebase-messaging-config.js");
importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js");

firebase.initializeApp(self.__FIREBASE_MESSAGING_CONFIG__);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Split PWA";
  const body = payload.notification?.body || "";
  const opts = {
    body,
    data: payload.data || {},
    icon: "/icons/icon-192.png"
  };
  return self.registration.showNotification(title, opts);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const splitId = event.notification?.data?.splitId;
  const path = splitId ? `/?split=${encodeURIComponent(splitId)}` : "/";
  const url = new URL(path, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          if ("navigate" in c) {
            c.navigate(url);
          }
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
