// Service Worker for English for Real Australia PWA
// This service worker caches application shell files so that the app can be used offline.

const CACHE_NAME = 'efra-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  'index.html',
  'daily.html',
  'childcare.html',
  'nursing.html',
  'life.html',
  'favorites.html',
  'review.html',
  'search.html',
  'quickadd.html',
  'smartadd.html',
  'difficult.html',
  'css/style.css',
  'js/script.js',
  'js/data.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'images/hero.png',
  'images/screen.png'
];

// Install event: cache essential assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate event: remove old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: serve from cache when available, fall back to network, provide fallback for navigations
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).catch(() => {
        // For navigation requests, fallback to index.html
        if (event.request.mode === 'navigate') {
          return caches.match('index.html');
        }
      });
    })
  );
});