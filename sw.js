const CACHE_VERSION = 'web-rider-static-v1';
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './icons/icon.svg',
  './js/config.js',
  './js/planck.min.js',
  './js/physics.js',
  './js/vehicle.js',
  './js/track-pieces.js',
  './js/track.js',
  './js/camera.js',
  './js/particles.js',
  './js/renderer.js',
  './js/audio.js',
  './js/input.js',
  './js/storage.js',
  './js/stunts.js',
  './js/challenges.js',
  './js/levels.js',
  './js/ui.js',
  './js/game.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request);

    const update = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(update);
      return cached;
    }

    const network = await update;
    if (network) return network;

    if (request.mode === 'navigate') {
      return (await cache.match('./index.html')) || Response.error();
    }
    return Response.error();
  })());
});
