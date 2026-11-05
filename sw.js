// Utilidades · service worker
// La app (y sus librerías) se guardan en el móvil para abrirse sin conexión.
// Con red, pide primero la versión nueva; sin red, abre la guardada.
// Los PDF NO pasan por aquí: están en IndexedDB. Las llamadas a GitHub
// (api.github.com) tampoco: van siempre a la red.
const VERSION = 'utilidades-v27';
const BASE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './lib/pdf.min.js', './lib/pdf.worker.min.js', './lib/pdf-lib.min.js', './lib/qrcode.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASE))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  const guarda = res => { const copia = res.clone(); caches.open(VERSION).then(c => c.put(r, copia)); return res; };
  e.respondWith(fetch(r).then(guarda).catch(() => caches.match(r).then(m => m || caches.match('./index.html'))));
});
