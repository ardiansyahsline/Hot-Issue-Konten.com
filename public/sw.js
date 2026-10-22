/* Service worker CS Tracker — menerima notifikasi push walau tab tertutup */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "CS Tracker", body: event.data ? event.data.text() : "" };
  }
  const url = data.url || "/";
  event.waitUntil(
    (async () => {
      // kalau CS Tracker sedang dibuka & dilihat di halaman yang sama, tidak perlu pop-up
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const path = new URL(url, self.location.origin).pathname;
      const watching = wins.some((w) => w.focused && w.visibilityState === "visible" && new URL(w.url).pathname === path && path !== "/akun");
      if (watching) return;
      await self.registration.showNotification(data.title || "CS Tracker", {
        body: data.body || "",
        icon: "/icon.png",
        badge: "/icon.png",
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          return w.navigate(url);
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
