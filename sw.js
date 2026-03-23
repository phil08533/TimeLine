// sw.js — My Circle Service Worker (PWA offline support)
'use strict';

const CACHE_NAME = 'mycircle-v5';

// Offline fallback page served when navigating without network or cache
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>My Circle — Offline</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  display:flex;align-items:center;justify-content:center;min-height:100vh;
  background:#0d0d0d;color:#e0e0e0;text-align:center;padding:1.5rem}
.wrap{max-width:380px}
h1{font-size:1.5rem;margin-bottom:.75rem}
p{color:#999;line-height:1.5;margin-bottom:1.25rem}
button{background:#6c63ff;color:#fff;border:none;padding:.65rem 1.5rem;
  border-radius:8px;font-size:.95rem;cursor:pointer}
button:hover{background:#5a52d5}
</style>
</head>
<body>
<div class="wrap">
  <h1>You're offline</h1>
  <p>My Circle needs an internet connection to sync with Google Drive. Check your connection and try again.</p>
  <button onclick="location.reload()">Retry</button>
</div>
</body>
</html>`;
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
    url.hostname === 'accounts.google.com'
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
            return caches.match('/index.html').then(r => r ||
              new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html' } })
            );
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then(r => {
      if (r) return r;
      if (event.request.mode === 'navigate') {
        return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('Offline', { status: 503 });
    }))
  );
});
