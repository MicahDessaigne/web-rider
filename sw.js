// Self-destructing service worker: removes old versions and all caches.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.getRegistrations()
        .then((regs) => regs.map((r) => r.unregister())))
      .then(() => self.clients.claim())
  );
});
