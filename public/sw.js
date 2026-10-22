/* Service worker CS Tracker — menerima notifikasi push walau tab tertutup */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/** kirim permintaan bunyi ke tab CS Tracker yang terbuka; true kalau ada yang memutar (maks tunggu 800 ms) */
function askPlay(wins, kind) {
  const mine = wins.filter((w) => new URL(w.url).origin === self.location.origin);
  if (!mine.length) return Promise.resolve(false);
  return new Promise((resolve) => {
    let left = mine.length;
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    setTimeout(() => finish(false), 800);
    for (const w of mine) {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => {
        if (e.data && e.data.played) return finish(true);
        if (--left === 0) finish(false);
      };
      try {
        w.postMessage({ type: "cs-sound", kind }, [ch.port2]);
      } catch (e) {
        if (--left === 0) finish(false);
      }
    }
  });
}

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
      // CS Tracker sedang terbuka (walau di tab belakang): minta halaman memutar bunyi pilihan user.
      // Kalau berhasil, pop-up sistem dibuat tanpa bunyi supaya tidak dobel.
      const played = await askPlay(wins, data.kind || "chat");
      await self.registration.showNotification(data.title || "CS Tracker", {
        body: data.body || "",
        icon: "/icon.png",
        badge: "/icon.png",
        tag: data.tag || undefined,
        renotify: !!data.tag,
        silent: played,
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
