import { useSyncExternalStore } from "react";
import type { Book } from "./books";
import { BOOKS, bookUrl } from "./books";
import { COURSE_BUNDLE, RULES_FILE } from "./data";
import { offlineKey, offlineRemovedKey } from "./keys";

// Offline downloads: the page-side engine behind the "Download" buttons. They
// fill the same Cache Storage buckets the service worker (public/sw.js)
// serves from, so one download makes a WHOLE book work without network — the
// document, the bundles, the book PDF and its data.
//
// Two kinds of bucket, so a book can be removed without touching the others:
//   SHELL_CACHE        the app itself: document, /assets/, fonts, icons
//   bookCache(id)      everything under /books/<id>/
// The service worker picks the bucket by the same rule (cacheFor in sw.js).
//
// A book's data is four small files, not ~190: data/course.json carries every
// unit and additional exercise (packed by scripts/sync_books.mjs) and the
// fetchers in data.ts read it when a per-exercise request fails offline.
//
// Cache names must equal the ones in public/sw.js — change both together.
export const SHELL_CACHE = "murrnglish-shell-v1";
export const bookCache = (bookId: string) => `murrnglish-book-${bookId}-v1`;

const BASE = import.meta.env.BASE_URL;
// Lookups and stores ignore Vary: these caches are keyed by URL alone. A Vary
// header on the response (vite preview sends Origin, Caddy's `encode` sends
// Accept-Encoding) would otherwise hide an entry from a request that carries
// that header — and offline that miss is a hard failure. Mirrored in
// public/sw.js, which reads the same caches.
const MATCH = { ignoreVary: true };

/** Files of the app itself that no page load is guaranteed to have fetched. */
const SHELL_FILES = [
  "favicon.svg",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
].map((f) => `${BASE}${f}`);

export interface DownloadProgress {
  /** bytes stored so far, book.pdf's stream included */
  bytes: number;
  /**
   * Bytes this run expects: book.pdf's size plus every byte stored outside it.
   * 0 while book.pdf's size is unknown, which means there is no fraction to
   * draw yet (see downloadFraction).
   */
  totalBytes: number;
}

/** Share of the book stored, 0..1, or null while the total is unknown. */
export function downloadFraction(p: DownloadProgress): number | null {
  return p.totalBytes > 0 ? Math.min(1, p.bytes / p.totalBytes) : null;
}

export interface DownloadState {
  /** a run is in flight */
  active: boolean;
  /** the latest numbers, null before the run's first report */
  progress: DownloadProgress | null;
  /** the last run failed — the panel and the phone chip offer a retry */
  failed: boolean;
  /** when the cached book was downloaded, null when nothing is cached */
  ts: number | null;
  /** a run finished in THIS page session. Only then does the button show
      green: a book cached on an earlier launch is not news any more. */
  fresh: boolean;
}

// The downloads' observable state, one entry per book. It lives here, not in
// a component, because several things show it — the panel, the topbar button
// and the phone chip — and the background start after install (CourseApp)
// can begin a run while none of them is open. Replaced, never mutated, so a
// snapshot is stable until something changes.
let states: Readonly<Record<string, DownloadState>> = Object.fromEntries(
  BOOKS.map((b) => [
    b.id,
    { active: false, progress: null, failed: false, ts: getDownloadedTs(b.id), fresh: false },
  ]),
);
const listeners = new Set<() => void>();

function setState(bookId: string, patch: Partial<DownloadState>): void {
  states = { ...states, [bookId]: { ...states[bookId], ...patch } };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function downloadState(bookId: string): DownloadState {
  return states[bookId];
}

/**
 * Live download state of every book. Progress ticks arrive a few hundred
 * times over a download, so the subscribers are the panel, the button and
 * the chip alone — a hook in CourseApp would re-render the whole unit list on
 * every chunk.
 */
export function useDownloads(): Readonly<Record<string, DownloadState>> {
  return useSyncExternalStore(subscribe, () => states);
}

/**
 * Everything a book needs beyond the shell, in download order. index.json,
 * pages.json and totals.json are what the app asks for when the book opens,
 * course.json is the whole course in one file (see the header) — the unit
 * card decks are made from it too — and rules.json is the text of the rules
 * compendium. book.pdf is listed last but downloaded by run() itself,
 * streamed, so its megabytes come with progress. scripts/sync_books.mjs sums
 * the same files for the size the panel shows.
 */
export function bookUrls(book: Book): string[] {
  return [
    bookUrl(book, "data/index.json"),
    bookUrl(book, "data/totals.json"),
    bookUrl(book, "data/pages.json"),
    bookUrl(book, COURSE_BUNDLE),
    bookUrl(book, RULES_FILE),
    bookUrl(book, book.cover.file),
    bookUrl(book, "book.pdf"),
  ];
}

// the runs in flight — a promise per book, so reopening the panel mid-download
// rejoins it instead of starting a second one over the same cache
const inFlight = new Map<string, Promise<void>>();

/**
 * Download one book into Cache Storage. Safe to call repeatedly: while a run
 * is in flight every caller gets the same promise, and files already in the
 * cache are skipped — which is also how a failed run resumes.
 */
export function downloadBook(book: Book): Promise<void> {
  let run = inFlight.get(book.id);
  if (!run) {
    try {
      localStorage.removeItem(offlineRemovedKey(book.id)); // an asked-for download beats every opt-out
    } catch {
      /* no storage: nothing to clear */
    }
    setState(book.id, { active: true, progress: null, failed: false });
    run = runDownload(book)
      .then(() => {
        const ts = Date.now();
        try {
          localStorage.setItem(offlineKey(book.id), JSON.stringify({ ts }));
        } catch {
          /* the cache is filled either way; only the date goes unremembered */
        }
        setState(book.id, { ts, fresh: true });
      })
      .catch((e: unknown) => {
        setState(book.id, { failed: true });
        throw e;
      })
      .finally(() => {
        inFlight.delete(book.id);
        setState(book.id, { active: false });
      });
    inFlight.set(book.id, run);
  }
  return run;
}

/**
 * True when every file of the book is in its cache — checked against Cache
 * Storage, not the flag. Every file, not book.pdf alone: reading a unit online
 * caches the PDF by itself (the worker stores what it serves), and a book
 * missing course.json still fails offline on the next unit.
 */
export async function isDownloaded(book: Book): Promise<boolean> {
  if (!(await caches.has(bookCache(book.id)))) return false;
  const cache = await caches.open(bookCache(book.id));
  for (const url of bookUrls(book)) {
    if (!(await cache.match(url, MATCH))) return false;
  }
  return true;
}

/** Timestamp of the last successful download, or null. */
function getDownloadedTs(bookId: string): number | null {
  try {
    const raw = localStorage.getItem(offlineKey(bookId));
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

/** Drop the book's cache and flag; the shell and the other books stay. */
export async function removeDownloaded(book: Book): Promise<void> {
  await caches.delete(bookCache(book.id));
  try {
    localStorage.removeItem(offlineKey(book.id));
    localStorage.setItem(offlineRemovedKey(book.id), "1"); // don't do this again by itself
  } catch {
    /* no storage: the cache is gone all the same */
  }
  setState(book.id, { ts: null, progress: null, failed: false, fresh: false });
}

/**
 * False once the book has been removed by hand. The background download of
 * an installed app asks this first, so deleting a book to free space is not
 * undone behind the user's back — pressing "Download" clears it again.
 */
export function autoDownloadAllowed(bookId: string): boolean {
  try {
    return localStorage.getItem(offlineRemovedKey(bookId)) === null;
  } catch {
    return true; // no storage: treat as never removed
  }
}

/**
 * True only when the app runs as an installed PWA: Chromium/Android report
 * `display-mode: standalone`, an iOS home-screen app reports
 * `navigator.standalone`. Gates the visibility of the download buttons.
 */
export function isStandalone(): boolean {
  // the iOS home-screen flag has no lib.dom declaration
  const nav: Navigator & { standalone?: boolean } = navigator;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

/** Content-length of a response; 0 when the server sends none. */
function size(r: Response): number {
  return Number(r.headers.get("content-length")) || 0;
}

/** Content-length of `url` from a HEAD — no body, 0 if the server refuses. */
async function headSize(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok ? size(r) : 0;
  } catch {
    return 0;
  }
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

/** The book a same-origin URL belongs to (/books/<id>/...), or null for the shell. */
function bookOfUrl(url: string): string | null {
  const path = new URL(url, location.href).pathname;
  const prefix = `${BASE}books/`;
  if (!path.startsWith(prefix)) return null;
  const id = path.slice(prefix.length).split("/")[0];
  return BOOKS.some((b) => b.id === id) ? id : null;
}

/**
 * Store each URL not cached yet into `cache`. `strict` separates the two
 * callers: an explicit download must fail loudly on a missing file, a
 * passive warm skips it. `count` is told the size of each response actually
 * stored, so the download's progress covers these files too.
 */
async function storeMissing(
  cache: Cache,
  urls: string[],
  strict: boolean,
  count: (bytes: number) => void = () => {},
): Promise<void> {
  for (const url of urls) {
    if (await cache.match(url, MATCH)) continue;
    const r = await fetch(url);
    if (!r.ok) {
      if (strict) throw new Error(url); // the panel shows which file failed
      continue;
    }
    count(size(r));
    await cache.put(url, r);
  }
}

/** The document under both keys a navigate can ask for, then `urls`. */
async function cacheShell(
  cache: Cache,
  urls: string[],
  strict: boolean,
  count: (bytes: number) => void = () => {},
): Promise<void> {
  const root = await fetch(BASE);
  if (!root.ok) {
    if (strict) throw new Error(BASE);
    return;
  }
  count(size(root)); // one file, cached under two keys
  await cache.put(new Request(BASE), root.clone());
  await cache.put(new Request(`${BASE}index.html`), root.clone());
  await storeMissing(cache, urls, strict, count);
}

/**
 * Cache what this visit already used. A service worker starts intercepting only
 * once it has activated, so the document and the bundles of the very first load
 * never reached it — without this pass, install → open → go offline shows a
 * blank page. Book PDFs are deliberately left out: tens of MB must not be
 * pulled in silently — the "Download" buttons own that, with their progress UI.
 *
 * Returns true when the shell cache was empty and this pass warmed it; the
 * caller uses that to schedule one follow-up pass for the data the app fetches
 * after the load event (its own fetches start later than the document's).
 * Later loads need none of this: the worker intercepts and caches them itself.
 */
export async function warmCache(): Promise<boolean> {
  try {
    const shell = await caches.open(SHELL_CACHE);
    const first = !(await shell.match(BASE, MATCH));
    const used = usedUrls().filter((u) => !u.endsWith("/book.pdf"));
    const byBook = new Map<string, string[]>();
    const forShell: string[] = [];
    for (const u of used) {
      const id = bookOfUrl(u);
      if (id) byBook.set(id, [...(byBook.get(id) ?? []), u]);
      else forShell.push(u);
    }
    if (first) await cacheShell(shell, forShell, false);
    for (const [id, urls] of byBook) {
      await storeMissing(await caches.open(bookCache(id)), urls, false);
    }
    return first;
  } catch {
    return false; // warming is a bonus, never a failure
  }
}

async function runDownload(book: Book): Promise<void> {
  // Ask the browser to keep the caches under quota pressure; an installed PWA
  // is granted this almost always. A refusal is harmless — caching then stays
  // best-effort.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* no persist() here: nothing to ask */
  }

  const pdfUrl = bookUrl(book, "book.pdf");
  // How big the download will be, before it starts. book.pdf is ~90% of the
  // payload and is stored last, so without this the bar would fill with the
  // small files and then drop back when the book began. A server that refuses
  // HEAD leaves this 0, and the book's own response headers supply it a moment
  // before the book's bytes start moving.
  let bookTotalBytes = await headSize(pdfUrl);

  // Warm the lazy chunks. pdf.js and its worker are separate /assets/ files a
  // library visit never loads; without this the download's shell scan would
  // miss them and the book would not render offline.
  const [{ default: workerUrl }] = await Promise.all([
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    import("pdfjs-dist"),
  ]);

  const shell = await caches.open(SHELL_CACHE);
  const cache = await caches.open(bookCache(book.id));

  // Byte bookkeeping. `stored` counts everything outside book.pdf as it lands;
  // the total adds that to the book's size, so the bar climbs to the book's
  // share of the payload and then rides the book's stream to 100%.
  let stored = 0;
  let bookBytes = 0;
  const report = () =>
    setState(book.id, {
      progress: {
        bytes: stored + bookBytes,
        totalBytes: bookTotalBytes ? bookTotalBytes + stored : 0,
      },
    });
  const count = (n: number) => {
    stored += n;
    report();
  };

  // The shell: the document and every same-origin /assets/ file this page has
  // already pulled in, plus the worker (fetched later, only by the book) and
  // the icons.
  await cacheShell(
    shell,
    [
      ...usedUrls().filter((u) => new URL(u).pathname.startsWith(`${BASE}assets/`)),
      new URL(workerUrl, location.href).href,
      ...SHELL_FILES,
    ],
    true,
    count,
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
      if (await shell.match(url, MATCH)) continue;
      try {
        const r = await fetch(url);
        if (r.ok) {
          count(size(r));
          await shell.put(url, r);
        }
      } catch {
        /* one face stays uncached */
      }
    }
  } catch {
    /* no font list: offline uses the fallback faces */
  }

  // The data — a handful of files, whatever the book's size: the ones the app
  // asks for when the book opens (offline it boots on index.json) and the
  // packed course.
  await storeMissing(cache, bookUrls(book).filter((u) => u !== pdfUrl), true, count);

  // A book already in the cache (a finished earlier download, or the copy the
  // service worker kept while the book was read online) is not fetched again:
  // when a release adds a small file to bookUrls, an installed app tops its
  // copy up with that file instead of pulling tens of megabytes once more.
  const cachedPdf = await cache.match(pdfUrl, MATCH);
  if (cachedPdf) {
    bookBytes = size(cachedPdf) || bookTotalBytes;
    if (!bookTotalBytes) bookTotalBytes = bookBytes;
    report();
    return;
  }

  // book.pdf last, streamed so the panel can show megabytes: assembling the
  // whole reader into one Uint8Array first (as an arrayBuffer() would) is a
  // second copy of the book with no progress in between.
  const pdf = await fetch(pdfUrl);
  if (!pdf.ok) throw new Error(pdfUrl);
  if (!bookTotalBytes) bookTotalBytes = size(pdf);
  let bytes: Uint8Array;
  if (pdf.body) {
    const reader = pdf.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      got += value.length;
      bookBytes = got;
      report();
    }
    bytes = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
  } else {
    bytes = new Uint8Array(await pdf.arrayBuffer());
    bookBytes = bytes.length;
  }
  await cache.put(pdfUrl, new Response(bytes));
}
