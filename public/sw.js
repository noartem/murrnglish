// Offline cache. No precache manifest: everything is cached at runtime
// (stale-while-revalidate), plus the explicit "Download" buttons
// (src/offline.ts) fill the same caches from the page side.
//
// One cache for the app shell, one per book (everything under /books/<id>/),
// so removing a book's offline copy is deleting one cache. The names must
// equal SHELL_CACHE / bookCache() in src/offline.ts — change both together.
const PREFIX = "murrnglish-";
const VERSION = "-v1";
const SHELL = `${PREFIX}shell${VERSION}`;
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
// these caches are keyed by URL alone: see the note on swr() below
const MATCH = { ignoreVary: true };

/** The cache a same-origin URL is stored in. */
function cacheFor(u) {
  const m = u.pathname.match(/^\/books\/([a-z][a-z0-9-]*)\//);
  return m ? `${PREFIX}book-${m[1]}${VERSION}` : SHELL;
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim(); // first visit: take over the page already open
      // anything that is not one of ours at this version: an older layout
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !(k.startsWith(PREFIX) && k.endsWith(VERSION)))
          .map((k) => caches.delete(k)),
      );
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (req.mode === "navigate") event.respondWith(navigate(req, u));
    else if (!req.headers.has("range")) event.respondWith(swr(event, req, u));
  } else if (FONT_HOSTS.has(u.hostname)) {
    event.respondWith(fontFirst(req));
  }
});

// document: network-first (a new deploy must show up immediately), cache when offline
async function navigate(req, u) {
  try {
    const r = await fetch(req);
    if (r.ok) {
      const cache = await caches.open(SHELL);
      await cache.put(new Request(u.origin + u.pathname), r.clone());
    }
    return r;
  } catch {
    // offline: the document this path was cached under, else the app shell —
    // the app is a single hash-routed document, so any path can be served
    // by it and a deep link opened offline still lands in the app
    return (
      (await caches.match(u.origin + u.pathname, MATCH)) ||
      (await caches.match(new Request(u.origin + "/"), MATCH)) ||
      Response.error()
    );
  }
}

// same-origin assets/data/book PDFs: serve cached, refresh the cache in background.
//
// These caches are keyed by URL alone: lookups ignore Vary (see MATCH) and
// every store uses a headerless `new Request(url)` key, so a re-store replaces
// the entry instead of adding a second variant that the URL match would then
// never see. Both halves matter — a response carrying Vary (vite preview sends
// Origin, Caddy's `encode` sends Accept-Encoding) would otherwise make a
// script/stylesheet request miss the entry the page-side download stored, and
// offline that miss is a hard failure.
async function swr(event, req, u) {
  const name = cacheFor(u);
  const hit = await caches.match(req, MATCH);
  if (hit) {
    event.waitUntil(
      fetch(req)
        .then((r) =>
          r.ok ? caches.open(name).then((c) => c.put(new Request(req.url), r)) : undefined,
        )
        .catch(() => undefined),
    );
    return hit;
  }
  try {
    const r = await fetch(req);
    if (r.ok) {
      const cache = await caches.open(name);
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
      const cache = await caches.open(SHELL);
      await cache.put(new Request(req.url), r.clone());
    }
    return r;
  } catch {
    return fetch(req).catch(() => Response.error()); // passthrough, no caching
  }
}
