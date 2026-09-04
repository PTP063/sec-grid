/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'mesh-os-bedrock-v1';

// Workbox injects the precache manifest array here during build
const manifest = (self as any).__WB_MANIFEST || [];

const PRECACHE_URLS: string[] = [
  '/',
  '/index.html',
  ...manifest.map((entry: any) => (typeof entry === 'string' ? entry : entry.url)),
];

// Deduplicate URLs to cache
const UNIQUE_PRECACHE_URLS = Array.from(new Set(PRECACHE_URLS));

/**
 * INSTALL: Precaches all production bundles, static assets, and icons.
 * Calls skipWaiting() immediately for non-blocking offline readiness.
 */
self.addEventListener('install', (event: ExtendableEvent) => {
  console.log('[SW] Installing Mesh·OS Deterministic Offline Engine...');
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        await cache.addAll(UNIQUE_PRECACHE_URLS);
        console.log(`[SW] Precached ${UNIQUE_PRECACHE_URLS.length} assets successfully.`);
      } catch (err) {
        console.warn('[SW] Bulk precache failed, falling back to individual caching:', err);
        // Resilient fallback: cache assets individually so a single missing optional asset does not abort install
        for (const url of UNIQUE_PRECACHE_URLS) {
          try {
            await cache.add(url);
          } catch (individualErr) {
            console.warn(`[SW] Optional asset failed to cache: ${url}`, individualErr);
          }
        }
      }
      await self.skipWaiting();
    })()
  );
});

/**
 * ACTIVATE: Purges obsolete cache versions and immediately takes control of all clients.
 */
self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('[SW] Activating Mesh·OS Service Worker & claiming clients...');
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log(`[SW] Evicting stale cache: ${key}`);
            return caches.delete(key);
          }
        })
      );
      await self.clients.claim();
      console.log('[SW] Mesh·OS Bedrock Offline Cache active.');
    })()
  );
});

/**
 * FETCH: Zero-network Cache-First strategy.
 * - Navigation requests immediately return index.html without touching network.
 * - Static/bundle requests return from CacheStorage with graceful offline fallback.
 */
self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;

  // Ignore non-GET requests (WebRTC signaling, websockets, mutations)
  if (request.method !== 'GET') {
    return;
  }

  // Handle SPA Navigation requests: always serve cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedIndex =
          (await cache.match('/index.html')) ||
          (await cache.match('index.html')) ||
          (await caches.match('/'));

        if (cachedIndex) {
          return cachedIndex;
        }

        // If not in cache, try network then cache it
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            cache.put('/index.html', networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response(
            '<!DOCTYPE html><html><body><h1>Mesh·OS Offline</h1><p>Cache missing index.html</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        }
      })()
    );
    return;
  }

  // Cache-First strategy for all assets
  event.respondWith(
    (async () => {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }

      // If missing from cache, attempt fetch if network is present
      try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok && request.url.startsWith(self.location.origin)) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        // Deterministic offline response — never hang or crash
        console.debug(`[SW] Cache miss and offline: ${request.url}`);
        return new Response('Offline resource unavailable', {
          status: 503,
          statusText: 'Service Unavailable (Offline)',
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })()
  );
});
