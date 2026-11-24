// Smart Tasks phone app service worker: offline start-up and push notifications.
const CACHE = 'smart-tasks-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Network first (always the newest app), the cache when offline.
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL('./', location.href).pathname)) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))),
  );
});

// A notification from the server (an AI agent's notify, or "No agent picked up").
self.addEventListener('push', e => {
  let n = {};
  try {
    n = e.data ? e.data.json() : {};
  } catch {
    n = { title: 'Smart Tasks', message: e.data ? e.data.text() : '' };
  }
  const from = n.from ? `From ${n.from}` : '';
  e.waitUntil(
    self.registration.showNotification(n.title || 'Smart Tasks', {
      body: [n.message, from].filter(Boolean).join('\n'),
      tag: n.tag || `notice-${n.id || Date.now()}`,
      icon: 'icon-512.png',
      badge: 'badge-96.png',
      data: { url: n.url || null, push: true },
    }),
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const app = wins.find(w => new URL(w.url).pathname.startsWith(new URL('./', location.href).pathname));
      if (data.push && data.url) return self.clients.openWindow(data.url);
      if (app) {
        await app.focus();
        // A notification the page made itself (reminders): let it handle the tap.
        if (data.local) app.postMessage({ type: 'st-notification-click', id: data.id, action: e.action || '' });
        return;
      }
      return self.clients.openWindow('./');
    })(),
  );
});
