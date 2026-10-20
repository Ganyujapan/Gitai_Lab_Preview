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
  if (url.pathname.endsWith('/sw.js')) return;
  event.respondWith((async () => {
    const cache = await caches.open(ACTIVE_CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Do not cache arbitrary live responses; they are not part of a verified build.
    return fetch(request);
  })());
});
