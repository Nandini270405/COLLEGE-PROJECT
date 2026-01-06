self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', (event) => {
  // very simple: just network-first, no offline caching
  event.respondWith(fetch(event.request));
});