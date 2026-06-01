/**
 * Stitch Service Worker
 * ---------------------
 * A minimal service worker that satisfies Chrome's PWA installability
 * criteria so Android shows the native "Add to Home Screen" banner.
 *
 * What this does:
 *   - Caches the app shell on install (offline-first for the shell)
 *   - Serves the shell from cache when offline, falls through to network otherwise
 *
 * We deliberately keep this lightweight — the recommendation feed and API
 * calls always go to the network so data is never stale.
 */

const CACHE_NAME = "stitch-v1";

// Files that make up the app shell (all served from the same origin)
const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  // Activate immediately without waiting for old tabs to close
  self.skipWaiting();
});

// ── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// ── Fetch: network-first for API calls, cache-first for shell ───────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always go to network for API routes — never cache dynamic data
  if (url.pathname.startsWith("/api/")) {
    return; // let the browser handle it normally
  }

  // For navigation requests (HTML), serve from cache if offline
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/").then((r) => r || Response.error())
      )
    );
    return;
  }

  // For static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(
      (cached) => cached || fetch(event.request)
    )
  );
});
