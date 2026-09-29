// Offline cache. No precache manifest: everything is cached at runtime
// (stale-while-revalidate), plus the explicit "Download course" button
// (app/src/offline.ts) fills the same cache from the page side.
// CACHE must equal COURSE_CACHE in app/src/offline.ts — change both together.
const CACHE = "egu-course-offline-v1";
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
// this cache is keyed by URL alone: see the note on swr() below
const MATCH = { ignoreVary: true };

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim(); // first visit: take over the page already open
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (req.mode === "navigate") event.respondWith(navigate(req, u));
    else if (!req.headers.has("range")) event.respondWith(swr(event, req));
  } else if (FONT_HOSTS.has(u.hostname)) {
    event.respondWith(fontFirst(req));
  }
});

// document: network-first (a new deploy must show up immediately), cache when offline
async function navigate(req, u) {
  try {
    const r = await fetch(req);
    if (r.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(new Request(u.origin + u.pathname), r.clone());
    }
    return r;
  } catch {
    // offline: the document this path was cached under, else the app shell —
    // the course is a single hash-routed document, so any path can be served
    // by it and a deep link opened offline still lands in the app
    return (
      (await caches.match(u.origin + u.pathname, MATCH)) ||
      (await caches.match(new Request(u.origin + "/"), MATCH)) ||
      Response.error()
    );
  }
}

// same-origin assets/data/book.pdf: serve cached, refresh the cache in background.
//
// This cache is keyed by URL alone: lookups ignore Vary (see MATCH) and every
// store uses a headerless `new Request(url)` key, so a re-store replaces the
// entry instead of adding a second variant that the URL match would then never
// see. Both halves matter — a response carrying Vary (vite preview sends
// Origin, Caddy's `encode` sends Accept-Encoding) would otherwise make a
// script/stylesheet request miss the entry the page-side download stored, and
// offline that miss is a hard failure.
async function swr(event, req) {
  const hit = await caches.match(req, MATCH);
  if (hit) {
    event.waitUntil(
      fetch(req)
        .then((r) =>
          r.ok ? caches.open(CACHE).then((c) => c.put(new Request(req.url), r)) : undefined,
        )
        .catch(() => undefined),
    );
    return hit;
  }
  try {
    const r = await fetch(req);
    if (r.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(new Request(req.url), r.clone());
    }
    return r;
  } catch {
    return (await caches.match(req, MATCH)) || Response.error();
  }
}

// fonts (cross-origin): cache-first; re-issued as cors so responses are not
// opaque — Chromium quota-pads opaque responses, wasting hundreds of MB
async function fontFirst(req) {
  const hit = await caches.match(req, MATCH);
  if (hit) return hit;
  try {
    const r = await fetch(new Request(req.url, { mode: "cors" }));
    if (r.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(new Request(req.url), r.clone());
    }
    return r;
  } catch {
    return fetch(req).catch(() => Response.error()); // passthrough, no caching
  }
}
