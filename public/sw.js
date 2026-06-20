// LUXWELD service worker — intentionally minimal.
// It ONLY caches static branding assets (icons + manifest). It never touches
// navigations, login, forms, QR pages, photo uploads, or any warranty data,
// so it cannot serve stale private content or break submissions.
const CACHE = 'luxweld-static-v1';
const ASSETS = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only same-origin GETs for the specific static assets above. Everything else
  // (HTML pages, /p/*, /admin/*, /uploads/*, POSTs) goes straight to network.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/^\/(icon-|apple-touch-icon|manifest\.webmanifest|favicon)/.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then((r) => r || fetch(event.request)));
  }
});
