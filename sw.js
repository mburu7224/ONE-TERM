/* Service Worker for Ruiru Media House — offline-first UI shell
   - Caches core static assets on install
   - Network-first image caching (saves thumbnails when online)
   - Navigation fallback to cached index.html for offline SPA behavior
*/

const CACHE_NAME = 'ruiru-static-v1';
const IMAGES_CACHE = 'ruiru-images-v1';

const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/localstorage.js',
  '/script.js',
  '/mpesa-integration.js',
  '/API/fetchYouTubeVideos.js',
  '/API/oauthCallback.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME && key !== IMAGES_CACHE) {
          return caches.delete(key);
        }
      })
    ))
    .then(() => self.clients.claim())
  );
});

function isImageRequest(request) {
  return request.destination === 'image' || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(new URL(request.url).pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigation requests: serve the cached shell (index.html)
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then(cached => {
        return cached || fetch(request).then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put('/index.html', response.clone()));
          }
          return response;
        }).catch(() => caches.match('/index.html'));
      })
    );
    return;
  }

  // Image requests: network-first, then cache fallback. When online, save image to IMAGES_CACHE.
  if (isImageRequest(request)) {
    event.respondWith(
      caches.open(IMAGES_CACHE).then(cache =>
        fetch(request).then(response => {
          // Save a copy (may be opaque) for offline use
          try { cache.put(request, response.clone()); } catch (e) { /* ignore put errors */ }
          return response;
        }).catch(() => cache.match(request))
      )
    );
    return;
  }

  // Other requests: try cache first, then network and update cache
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Don't cache opaque cross-origin responses for everything — but try caching same-origin
        if (response && response.ok && url.origin === self.location.origin) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => {
        // Fallback to index for navigations already handled; for others return nothing
        return caches.match('/index.html');
      });
    })
  );
});

// Allow the page to force the waiting service worker to become active
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
