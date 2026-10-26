/* Generated during the GitHub Pages build; confined to /exhibit/. */
const BUILD_ID = '__GITAI_BUILD__';
const CACHE_PREFIX = 'gitai-konchu2026-exhibit-';
const ACTIVE_CACHE = CACHE_PREFIX + BUILD_ID;
const BASE = self.registration.scope;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const manifestResponse = await fetch(new URL('precache.json', BASE), { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error('Precache manifest unavailable');
    const assetPaths = await manifestResponse.json();
    if (!Array.isArray(assetPaths) || !assetPaths.includes('game.html')) {
      throw new Error('Invalid offline asset list');
    }
    const urls = assetPaths.map(path => new URL(path, BASE).href);
    const cache = await caches.open(ACTIVE_CACHE);
    try {
      // Atomic installation: a failed download never activates a partial update.
      await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(ACTIVE_CACHE);
      throw error;
    }
    // Do NOT skipWaiting here; open gameplay must not be replaced automatically.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name.startsWith(CACHE_PREFIX) && name !== ACTIVE_CACHE
    ).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      !url.href.startsWith(BASE)) return;
  if (url.pathname.endsWith('/sw.js') ||
      (url.pathname.endsWith('/version.json') && url.searchParams.has('online'))) return;
  event.respondWith((async () => {
    const cache = await caches.open(ACTIVE_CACHE);
    // The installed PWA launches at /exhibit/ (directory URL), while the
    // atomic precache stores /exhibit/index.html. Cache.match ignoreSearch
    // ignores query only; it does NOT equate a directory to index.html.
    // This fallback is strictly for navigation to this exact scoped root,
    // never for game assets, JSON/API requests, or the public preview.
    if (request.mode === 'navigate' && url.pathname === new URL(BASE).pathname) {
      const home = await cache.match(new URL('index.html', BASE).href);
      if (home) return home;
    }
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Do not cache arbitrary live responses; they are not part of a verified build.
    return fetch(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'APPLY_EXHIBIT_UPDATE') {
    // Called only from the administrator landing screen after full pre-cache.
    self.skipWaiting();
  }
});
