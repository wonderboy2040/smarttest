/* ============================================================
 * SmartAI Pro v20 — Service Worker (LEAN TWO-DESK SHELL)
 * ------------------------------------------------------------
 * v20.0 REWRITE: the portfolio background-sync engine (15-min
 * price fetch, widget data, P&L badge, price notifications) is
 * REMOVED with the portfolio feature. What remains is the
 * minimum a localhost trading terminal needs:
 *   1. App-shell precache (offline boot)
 *   2. Navigation: network-first, cached shell fallback
 *   3. Hashed static assets: stale-while-revalidate
 *   4. /api/* and /api/stream: NEVER intercepted (network only;
 *      SSE pass-through, private data never touches CacheStorage)
 * ACTIVATE evicts EVERY cache older than v20 — including any
 * private-API leftovers from pre-v12.7 denylist days.
 * ============================================================ */

const CACHE_VERSION = 'smartai-pro-v20';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // ALL API traffic (incl. SSE /api/stream) — network only, never cached
  if (url.pathname.startsWith('/api/')) return;

  // App navigation → network-first, fall back to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Static assets → stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
