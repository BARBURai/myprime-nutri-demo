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
    // Back in v4.77, after v4.70 removed it. The reasoning in v4.70 was wrong: the clean
    // notification Ron was comparing against came from Kajabi's app, not from ours.
    // Android keeps a round slot for a large icon whatever we do, and with no `icon` it
    // fills that slot with a letter monogram of the site name, so removing it bought
    // nothing and cost us the logo. The Hebrew title is truncated either way, at about ten
    // characters, so shortening it does not help and was not attempted.
    icon: "/icon-192.png",
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
