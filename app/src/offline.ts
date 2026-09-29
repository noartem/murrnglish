import { useSyncExternalStore } from "react";
import { COURSE_BUNDLE } from "./data";

// Offline course download: the page-side engine behind the "Download course"
// button. It fills the same Cache Storage bucket the service worker
// (app/public/sw.js) serves from, so one download makes the WHOLE course work
// without network — the document, the bundles, the book PDF and the data.
//
// The data is four small files, not ~190: data/course.json carries every unit
// and additional exercise (packed by scripts/sync_data.mjs) and the fetchers
// in data.ts read it when a per-exercise request fails offline.
//
// COURSE_CACHE must equal CACHE in app/public/sw.js — change both together.
export const COURSE_CACHE = "egu-course-offline-v1";
/** localStorage flag written after a successful download: {"ts": <epoch-ms>} */
export const OFFLINE_KEY = "egu-course-offline-v1";
/** set when the course is removed by hand: stops the install-time background
    download from putting back what someone deleted on purpose */
const OPTOUT_KEY = "egu-course-offline-v1-removed";

const BASE = import.meta.env.BASE_URL;
const BOOK_URL = `${BASE}book.pdf`;
// Lookups and stores ignore Vary: this cache is keyed by URL alone. A Vary
// header on the response (vite preview sends Origin, Caddy's `encode` sends
// Accept-Encoding) would otherwise hide an entry from a request that carries
// that header — and offline that miss is a hard failure. Mirrored in
// app/public/sw.js, which reads the same cache.
const MATCH = { ignoreVary: true };

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

/** Share of the course stored, 0..1, or null while the total is unknown. */
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
  /** when the cached course was downloaded, null when nothing is cached */
  ts: number | null;
  /** a run finished in THIS page session. Only then does the button show
      green: a course cached on an earlier launch is not news any more. */
  fresh: boolean;
}

// The download's observable state. It lives here, not in a component, because
// three things show it — the panel, the topbar button and the phone chip — and
// the background start after install (App.tsx) can begin a run while none of
// them is open.
let state: DownloadState = {
  active: false,
  progress: null,
  failed: false,
  ts: getDownloadedTs(),
  fresh: false,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<DownloadState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Snapshot for useSyncExternalStore: the same object until something changes. */
export function downloadState(): DownloadState {
  return state;
}

/**
 * Live download state for the UI. Progress ticks arrive a few hundred times
 * over a download, so the subscribers are the button and the chip alone —
 * putting the hook in App would re-render the whole unit list on every chunk.
 */
export function useDownload(): DownloadState {
  return useSyncExternalStore(subscribe, downloadState);
}

/**
 * Everything the course needs beyond the shell, in download order; every entry
 * BASE-prefixed. index.json and totals.json are the files the app asks for at
 * startup, course.json is the whole course in one file (see the header).
 * book.pdf is listed last but downloaded by run() itself, streamed, so its
 * 71 MB come with progress.
 */
export function buildCourseUrls(): string[] {
  return [
    `${BASE}data/index.json`,
    `${BASE}data/totals.json`,
    `${BASE}${COURSE_BUNDLE}`,
    `${BASE}cover.jpg`,
    `${BASE}favicon.svg`,
    BOOK_URL,
  ];
}

// the run in flight, if any — a promise, so reopening the panel mid-download
// rejoins it instead of starting a second one over the same cache
let inFlight: Promise<void> | null = null;

/**
 * Download the whole course into Cache Storage. Safe to call repeatedly: while
 * a run is in flight every caller gets the same promise, and files already in
 * the cache are skipped — which is also how a failed run resumes.
 */
export function downloadCourse(): Promise<void> {
  if (!inFlight) {
    localStorage.removeItem(OPTOUT_KEY); // an asked-for download beats every opt-out
    setState({ active: true, progress: null, failed: false });
    inFlight = run()
      .then(() => {
        const ts = Date.now();
        localStorage.setItem(OFFLINE_KEY, JSON.stringify({ ts }));
        setState({ ts, fresh: true });
      })
      .catch((e: unknown) => {
        setState({ failed: true });
        throw e;
      })
      .finally(() => {
        inFlight = null;
        setState({ active: false });
      });
  }
  return inFlight;
}

/** True when the course is in the cache — checked against Cache Storage, not the flag. */
export async function isDownloaded(): Promise<boolean> {
  return (await caches.match(new Request(BOOK_URL), MATCH)) !== undefined;
}

/** Timestamp of the last successful download, or null. */
function getDownloadedTs(): number | null {
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
  localStorage.setItem(OPTOUT_KEY, "1"); // remember: don't do this again by itself
  setState({ ts: null, progress: null, failed: false, fresh: false });
}

/**
 * False once the course has been removed by hand. The background download of
 * an installed app asks this first, so deleting ~72 MB to free space is not
 * undone behind the user's back — pressing "Download course" clears it again.
 */
export function autoDownloadAllowed(): boolean {
  try {
    return localStorage.getItem(OPTOUT_KEY) === null;
  } catch {
    return true; // no storage: treat as never removed
  }
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

/**
 * Store the document under both keys a navigate can ask for, plus every URL in
 * `urls` that is not cached yet. `strict` separates the two callers: an
 * explicit download must fail loudly on a missing file, a passive warm skips
 * it. `count` is told the size of each response actually stored, so the
 * download's progress covers these files too.
 */
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
  // Ask the browser to keep the ~72 MB course cache under quota pressure; an
  // installed PWA is granted this almost always. A refusal is harmless —
  // caching then stays best-effort.
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* no persist() here: nothing to ask */
  }

  // How big the download will be, before it starts. book.pdf is ~90% of the
  // payload and is stored last, so without this the bar would fill with the
  // small files and then drop back when the book began. A server that refuses
  // HEAD leaves this 0, and the book's own response headers supply it a moment
  // before the book's bytes start moving.
  let bookTotalBytes = await headSize(BOOK_URL);

  // Warm the lazy chunks. pdf.js and its worker are separate /assets/ files a
  // landing-page visit never loads; without this the download's shell scan
  // would miss them and the book would not render offline.
  const [{ default: workerUrl }] = await Promise.all([
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    import("pdfjs-dist"),
  ]);

  const cache = await caches.open(COURSE_CACHE);

  // Byte bookkeeping. `stored` counts everything outside book.pdf as it lands;
  // the total adds that to the book's size, so the bar climbs to the book's
  // share of the payload and then rides the book's stream to 100%.
  let stored = 0;
  let bookBytes = 0;
  const report = () =>
    setState({
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
  // already pulled in, plus the worker (fetched later, only by the book).
  await cacheShell(
    cache,
    [
      ...usedUrls().filter((u) => new URL(u).pathname.startsWith(`${BASE}assets/`)),
      new URL(workerUrl, location.href).href,
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
      if (await cache.match(url, MATCH)) continue;
      try {
        const r = await fetch(url);
        if (r.ok) {
          count(size(r));
          await cache.put(url, r);
        }
      } catch {
        /* one face stays uncached */
      }
    }
  } catch {
    /* no font list: offline uses the fallback faces */
  }

  // The data — three files, whatever the course's size: the two the app asks
  // for at startup (offline it boots on index.json) and the packed course.
  for (const url of buildCourseUrls().filter((u) => u !== BOOK_URL)) {
    if (await cache.match(url, MATCH)) continue;
    const r = await fetch(url);
    if (!r.ok) throw new Error(url); // the panel shows which file failed
    count(size(r));
    await cache.put(url, r);
  }

  // book.pdf last, streamed so the panel can show megabytes: assembling the
  // whole reader into one Uint8Array first (as an arrayBuffer() would) is a
  // second 71 MB copy with no progress in between.
  const book = await fetch(BOOK_URL);
  if (!book.ok) throw new Error(BOOK_URL);
  if (!bookTotalBytes) bookTotalBytes = size(book);
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
    bytes = new Uint8Array(await book.arrayBuffer());
    bookBytes = bytes.length;
  }
  await cache.put(BOOK_URL, new Response(bytes));
}
