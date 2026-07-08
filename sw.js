// BrainVault Mission Control — service worker
// Handles push notifications and caches the chrono-node CDN script for offline quick-add.

const OFFLINE_CACHE = 'brainvault-offline-v1';
const OFFLINE_URLS = [
  'https://cdn.jsdelivr.net/npm/chrono-node@2/dist/chrono.min.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then(cache => cache.addAll(OFFLINE_URLS))
      .catch(() => {}) // best-effort; don't block install if offline during install
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (!OFFLINE_URLS.includes(event.request.url)) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

self.addEventListener('push', event => {
  let data = { title: 'BrainVault', body: 'You have a reminder.' };
  try { data = event.data.json(); } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'BrainVault', {
      body: data.body || '',
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='%231a2533'/><text y='72' x='50' text-anchor='middle' font-size='60'>%F0%9F%A7%A0</text></svg>",
      tag: data.title,
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
