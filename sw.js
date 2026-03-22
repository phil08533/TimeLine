// sw.js — My Circle Service Worker (PWA offline support)
'use strict';

const CACHE_NAME = 'mycircle-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/utils.js',
  '/js/auth.js',
  '/js/drive.js',
  '/js/data.js',
  '/js/theme.js',
  '/js/ui.js',
  '/manifest.json'
];

// ── Install: pre-cache all static assets ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Some assets may be missing — continue install anyway
        return Promise.all(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(() => { /* skip missing */ })
          )
        );
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for static assets, network-first for API calls ─────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for Google APIs and OAuth
  if (
    url.hostname === 'www.googleapis.com' ||
    url.hostname === 'apis.google.com' ||
    url.hostname === 'accounts.google.com' ||
    url.hostname === 'people.googleapis.com'
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // API offline — return a JSON error so callers can handle gracefully
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Network-first for resumable upload endpoints
  if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/upload/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Network-first for same-origin static assets (so updates are picked up immediately)
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then(response => {
        // Cache successful GET responses for offline fallback
        if (
          response.ok &&
          event.request.method === 'GET' &&
          !url.pathname.includes('config.js') && // don't cache secrets
          !url.pathname.includes('videos.json')   // too large to cache (7MB)
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline: fall back to cached version
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html').then(r => r || new Response('Offline', { status: 503 }));
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then(r => r || new Response('Offline', { status: 503 })))
  );
});
