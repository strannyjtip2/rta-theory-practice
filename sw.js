const CACHE = 'rta-theory-v9-clean';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './transfer.js',
  './questions.json',
  './glossary.json',
  './context.json',
  './aliases.json',
  './legacy.json',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      const old = keys.filter((k) => k !== CACHE);
      return Promise.all(old.map((k) => caches.delete(k)))
        .then(() => self.clients.claim())
        .then(() =>
          // an older version was running: reload open pages once so they pick up the new code
          old.length
            ? self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => { try { c.navigate(c.url); } catch (_) {} }))
            : null
        );
    })
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res && res.ok && e.request.method === 'GET') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
