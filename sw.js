const CACHE = 'ember-cache-v12';
const PRECACHE = ['./', './index.html'];

const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

// ── Install: pre-cache shell, skip waiting immediately ───────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
});

// ── Activate: delete old ember-cache-* versions ─────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('ember-cache-') && k !== CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET (e.g. Claude API POSTs) — Cache API can't store them
  if (request.method !== 'GET') return;

  // CDN / fonts → stale-while-revalidate
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Navigation or explicit HTML → network-first (works offline via cache)
  if (request.mode === 'navigate' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else → network with cache fallback
  event.respondWith(networkWithCacheFallback(request));
});

// ── Strategies ───────────────────────────────────────────────────────────────
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || caches.match('./');
  }
}

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const fresh = fetch(req).then(res => {
    caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => null);
  return cached || await fresh;
}

async function networkWithCacheFallback(req) {
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE);
    cache.put(req, res.clone());
    return res;
  } catch {
    return caches.match(req);
  }
}
