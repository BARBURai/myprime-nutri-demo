// MyPrime nutrition - service worker for Web Push (daily 19:00 diary reminder).
// Shows the push notification and focuses/opens the app on click.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "MyPrime מעקב";
  const body = data.body || "יומן המעקב נפתח לך, היכנסי למלא את היום";
  const options = {
    body,
    // No `icon` on purpose. Android already shows the app's own icon on the notification,
    // and setting one here added a SECOND copy of the same logo on the other side, which
    // ate the width the Hebrew title needs and pushed it into an ellipsis. Ron compared it
    // against an older install that sets none, and that one reads better.
    badge: "/icon-192.png",
    dir: "rtl",
    lang: "he",
    tag: data.tag || "daily-diary",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
