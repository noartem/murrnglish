import type { IndexData } from "./data";

// Offline course download: the page-side engine behind the "Download course"
// button. It fills the same Cache Storage bucket the service worker
// (app/public/sw.js) serves from, so one download makes the WHOLE course work
// without network — the document, the bundles, the data JSON and the book PDF.
//
// COURSE_CACHE must equal CACHE in app/public/sw.js — change both together.
export const COURSE_CACHE = "egu-course-offline-v1";
/** localStorage flag written after a successful download: {"ts": <epoch-ms>} */
export const OFFLINE_KEY = "egu-course-offline-v1";

const BASE = import.meta.env.BASE_URL;
const BOOK_URL = `${BASE}book.pdf`;
// Lookups and stores ignore Vary: this cache is keyed by URL alone. A Vary
// header on the response (vite preview sends Origin, Caddy's `encode` sends
// Accept-Encoding) would otherwise hide an entry from a request that carries
// that header — and offline that miss is a hard failure. Mirrored in
// app/public/sw.js, which reads the same cache.
const MATCH = { ignoreVary: true };

export interface DownloadProgress {
  /** files finished, book.pdf excluded (it streams last) */
  filesDone: number;
  filesTotal: number;
  /** bytes of book.pdf read so far */
  bookBytes: number;
  /** book.pdf content-length, 0 when the server sends no header */
  bookTotalBytes: number;
}

/** Everything the course needs, in download order; every entry BASE-prefixed. */
export function buildCourseUrls(index: IndexData): string[] {
  const urls = [`${BASE}data/index.json`, `${BASE}data/totals.json`];
  for (const g of index.groups)
    for (const u of g.units)
      urls.push(`${BASE}data/units/unit-${String(u).padStart(3, "0")}.json`);
  for (const n of index.additional.exercises)
    urls.push(`${BASE}data/additional/${String(n).padStart(2, "0")}.json`);
  // the 71 MB tail: run() keeps book.pdf out of the counted files and streams
  // it last, so the bar keeps moving across the whole download
  urls.push(BOOK_URL, `${BASE}cover.jpg`, `${BASE}favicon.svg`);
  return urls;
}

// the run in flight, if any — a promise, so reopening the panel mid-download
// rejoins it instead of starting a second one over the same cache
let inFlight: Promise<void> | null = null;
// last emitted progress; null until the file list is known (the shell and the
// fonts go first, and their count is not known up front)
let progress: DownloadProgress | null = null;
const subscribers = new Set<(p: DownloadProgress) => void>();

function emit(p: DownloadProgress): void {
  progress = p;
  for (const cb of subscribers) cb(p);
}

/**
 * Live run state. `active` is true from the moment a download starts (before
 * the first progress is known), so a panel reopened mid-download can attach
 * instead of offering to start again.
 */
export function currentDownload(): {
  active: boolean;
  progress: DownloadProgress | null;
} {
  return { active: inFlight !== null, progress };
}

/**
 * Download the whole course into Cache Storage. Safe to call repeatedly: while
 * a run is in flight every caller gets the same promise (`onProgress` is
 * subscribed to it), and files already in the cache are skipped — which is
 * also how a failed run resumes.
 */
export function downloadCourse(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (onProgress) {
    subscribers.add(onProgress);
    if (progress) onProgress(progress); // reopened panel: numbers so far
  }
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
      progress = null;
      subscribers.clear();
    });
  }
  return inFlight;
}

/** True when the course is in the cache — checked against Cache Storage, not the flag. */
export async function isDownloaded(): Promise<boolean> {
  return (await caches.match(new Request(BOOK_URL), MATCH)) !== undefined;
}

/** Timestamp of the last successful download, or null. */
export function getDownloadedTs(): number | null {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "ts" in parsed) {
      return typeof parsed.ts === "number" ? parsed.ts : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Drop the course cache and the flag; the rest of Cache Storage is untouched. */
export async function removeDownloaded(): Promise<void> {
  await caches.delete(COURSE_CACHE);
  localStorage.removeItem(OFFLINE_KEY);
}

/**
 * True only when the app runs as an installed PWA: Chromium/Android report
 * `display-mode: standalone`, an iOS home-screen app reports
 * `navigator.standalone`. Gates the visibility of the download button.
 */
export function isStandalone(): boolean {
  // the iOS home-screen flag has no lib.dom declaration
  const nav: Navigator & { standalone?: boolean } = navigator;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

/**
 * Same-origin URLs this page has already pulled in — the performance log
 * records the document's bundles, the lazy pdf.js chunks and every fetch the
 * app made (index.json, the unit JSON, book.pdf).
 */
function usedUrls(): string[] {
  const urls = new Set<string>();
  for (const e of performance.getEntriesByType("resource")) {
    const u = new URL(e.name, location.href);
    if (u.origin === location.origin) urls.add(u.href);
  }
  return [...urls];
}

/**
 * Store the document under both keys a navigate can ask for, plus every URL in
 * `urls` that is not cached yet. `strict` separates the two callers: an
 * explicit download must fail loudly on a missing file, a passive warm skips it.
 */
async function cacheShell(cache: Cache, urls: string[], strict: boolean): Promise<void> {
  const root = await fetch(BASE);
  if (!root.ok) {
    if (strict) throw new Error(BASE);
    return;
  }
  await cache.put(new Request(BASE), root.clone());
  await cache.put(new Request(`${BASE}index.html`), root.clone());
  for (const url of urls) {
    if (await cache.match(url, MATCH)) continue;
    const r = await fetch(url);
    if (!r.ok) {
      if (strict) throw new Error(url); // the panel shows which file failed
      continue;
    }
    await cache.put(url, r);
  }
}

/**
 * Cache what this visit already used. A service worker starts intercepting only
 * once it has activated, so the document and the bundles of the very first load
 * never reached it — without this pass, install → open → go offline shows a
 * blank page. book.pdf is deliberately left out: 71 MB must not be pulled in
 * silently — the "Download course" button owns that, with its progress UI.
 *
 * Returns true when the cache was empty and this pass warmed it; the caller
 * uses that to schedule one follow-up pass for the data the app fetches after
 * the load event (its own fetches start later than the document's). Later loads
 * need none of this: the worker intercepts and caches them itself.
 */
export async function warmCache(): Promise<boolean> {
  try {
    const cache = await caches.open(COURSE_CACHE);
    if (await cache.match(BASE, MATCH)) return false;
    await cacheShell(
      cache,
      usedUrls().filter((u) => u !== BOOK_URL),
      false,
    );
    return true;
  } catch {
    return false; // warming is a bonus, never a failure
  }
}

async function run(): Promise<void> {
  // Ask the browser to keep the ~75 MB course cache under quota pressure; an
  // installed PWA is granted this almost always. A refusal is harmless —
  // caching then stays best-effort.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* no persist() here: nothing to ask */
  }

  // Warm the lazy chunks. pdf.js and its worker are separate /assets/ files a
  // landing-page visit never loads; without this the download's shell scan
  // would miss them and the book would not render offline.
  const [{ default: workerUrl }] = await Promise.all([
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    import("pdfjs-dist"),
  ]);

  const cache = await caches.open(COURSE_CACHE);

  // The shell: the document and every same-origin /assets/ file this page has
  // already pulled in, plus the worker (fetched later, only by the book).
  await cacheShell(
    cache,
    [
      ...usedUrls().filter((u) => new URL(u).pathname.startsWith(`${BASE}assets/`)),
      new URL(workerUrl, location.href).href,
    ],
    true,
  );

  // The web fonts: the Google stylesheet lists the woff2 files, which the
  // browser has not necessarily fetched (it picks subsets per unicode-range).
  // Cached under the exact gstatic URL from the CSS — that is the key the
  // service worker looks up. Decoration only: the download must not fail
  // because Google Fonts is unreachable (a proxy, a blocked region), so every
  // font failure is skipped and offline text falls back to system faces.
  try {
    const css = document.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href*="fonts.googleapis.com"]',
    );
    const text = css ? await (await fetch(css.href)).text() : "";
    for (const [, raw] of text.matchAll(/url\(([^)]+\.woff2)\)/g)) {
      const url = raw.replace(/["']/g, "");
      if (await cache.match(url, MATCH)) continue;
      try {
        const r = await fetch(url);
        if (r.ok) await cache.put(url, r);
      } catch {
        /* one face stays uncached */
      }
    }
  } catch {
    /* no font list: offline uses the fallback faces */
  }

  // The data. index.json comes over the network (the service worker may serve
  // it from the cache this same visit filled — that copy is what the running
  // app is showing, so the list matches the visible course).
  const idx = await fetch(`${BASE}data/index.json`);
  if (!idx.ok) throw new Error(`${BASE}data/index.json`);
  const index: IndexData = await idx.json();
  const files = buildCourseUrls(index).filter((u) => u !== BOOK_URL);

  let filesDone = 0;
  const report = (bookBytes = 0, bookTotalBytes = 0) =>
    emit({ filesDone, filesTotal: files.length, bookBytes, bookTotalBytes });
  report();

  for (const url of files) {
    if (!(await cache.match(url, MATCH))) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url); // the panel shows which file failed
      await cache.put(url, r);
    }
    filesDone++;
    report();
  }

  // book.pdf last, streamed so the panel can show megabytes: assembling the
  // whole reader into one Uint8Array first (as an arrayBuffer() would) is a
  // second 71 MB copy with no progress in between.
  const book = await fetch(BOOK_URL);
  if (!book.ok) throw new Error(BOOK_URL);
  const bookTotalBytes = Number(book.headers.get("content-length")) || 0;
  let bytes: Uint8Array;
  if (book.body) {
    const reader = book.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      got += value.length;
      report(got, bookTotalBytes);
    }
    bytes = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
  } else {
    bytes = new Uint8Array(await book.arrayBuffer());
  }
  await cache.put(BOOK_URL, new Response(bytes));

  localStorage.setItem(OFFLINE_KEY, JSON.stringify({ ts: Date.now() }));
}
