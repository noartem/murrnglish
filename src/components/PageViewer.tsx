// PageViewer: book pages rendered from the vector PDF via pdf.js onto canvases.
// Every render matches the screen, so zooming stays sharp at any level. v5
// Simple vertical stack: pages flow in a column with a gap, and the scroll
// content is exactly the stack plus a margin around it — no elastic void, no
// drag-to-pan. Zoom lives in the --z var on .pagesflow: every length in the
// scroll content (page boxes, the flex gap AND the margin) is a multiple of
// --z, so a zoom rescales the
// whole content uniformly by r = z/z0 and the scroll compensation is exact:
// scrollNew = (scrollOld + anchor) * r - anchor — the anchor is the gesture
// point in viewport coords (cursor for ctrl+wheel/pinch, the visual center
// for buttons/reset). Buttons animate ~180ms eased; ctrl+wheel is instant.
// Zoom range: min = the tallest page of the set fills the pane height (never
// above fit-width, so a tall phone pane still starts at 100%), max =
// a page twice the pane wide. Nothing is persisted — every pdfPages change
// (unit ↔ unit, unit ↔ additional) and every mount starts at the default
// fit-the-pane-width zoom, scrolled to the very top.
// Scrolling is OverlayScrollbars (overlay bars drawn over the content, hidden
// until hover) like the sidebar and the exercise pane — and it works while
// pages are still loading, because placeholder canvases already occupy the
// real per-page height (baked from book.pdf into the book's data/pages.json,
// the `aspects` prop), so finishing
// a page load never reflows the layout either.
//
// Canvases re-render their backing store at the new resolution shortly after
// the zoom settles; between backing updates the browser just scales the
// existing bitmap.

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import type { PageAspects } from "../data";
import { Contrast, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { loadPageInvert, savePageInvert } from "../pageinvert";

interface Props {
  /** the book's PDF: one document per book, shared by every page of it */
  pdfUrl: string;
  /** height/width per page number, from the book's data/pages.json */
  aspects: PageAspects;
  pdfPages: number[];
  focusTick: number; // each increment focuses the pane (Shift+S)
  onPaneEscape: () => void; // Esc in the pane: App restores the previous focus
  /** the page width at 100%: the whole page fitting the pane height, kept
      within [min, max] (the rules compendium: a page in view, not a poster
      across a wide pane); unset = the pane width */
  pageWidth?: { min: number; max: number };
}

const MAX_ZOOM = 2; // page at double the pane width
const ANIM_MS = 180;
const RERENDER_DEBOUNCE_MS = 140;
const SCROLL_STEP = 80; // arrow-key scroll step (px) while the pane is focused

// fallback = A4 portrait; every real page is baked in data/pages.json
const pageAspect = (aspects: PageAspects, p: number) => aspects[String(p)] ?? 297 / 210;

type Bounds = { min: number; max: number };

// Runs step(now) once per frame until it returns false; returns a cancel fn.
// RAF drives it and a 32ms timer keeps it alive when RAF callbacks are
// suspended (hidden/background frames, headless capture). The pending flag
// lets whichever fires first run the frame and drops the other — scheduling
// both unguarded doubled the callbacks every frame, and the pile-up of
// competing ticks is what made arrow-key scrolling stutter.
function frameLoop(step: (now: number) => boolean): () => void {
  let alive = true;
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    const run = () => {
      if (!pending || !alive) return;
      pending = false;
      if (step(performance.now())) schedule();
      else alive = false;
    };
    requestAnimationFrame(run);
    window.setTimeout(run, 32);
  };
  schedule();
  return () => {
    alive = false;
  };
}

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

// one shared document for every viewer instance (unit ↔ additional switches);
// pdf.js itself is dynamically imported so it stays out of the main bundle.
// One book at a time: opening another book's PDF releases the previous one,
// the books are 14–75 MB each.
let docUrl = "";
let docPromise: Promise<PDFDocumentProxy> | null = null;
function getDoc(url: string): Promise<PDFDocumentProxy> {
  if (docPromise && docUrl !== url) {
    void docPromise.then((d) => d.destroy()).catch(() => {});
    docPromise = null;
  }
  if (!docPromise) {
    docUrl = url;
    const loading = (async () => {
      const [pdfjs, { default: workerUrl }] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      // pdf.js v6 fingerprints use Uint8Array.prototype.toHex (new ES method
      // missing in current Chromium); inject the polyfill into the worker
      // source and serve it as a blob URL — the main-thread polyfill would
      // never reach the worker context.
      let workerSrc = workerUrl;
      try {
        if (!("toHex" in Uint8Array.prototype)) {
          const code = await fetch(workerUrl).then((r) => r.text());
          const poly = "if(!Uint8Array.prototype.toHex){Uint8Array.prototype.toHex=function(){let s='';for(const b of this)s+=b.toString(16).padStart(2,'0');return s;};}\n";
          workerSrc = URL.createObjectURL(new Blob([poly + code], { type: "text/javascript" }));
        }
      } catch {
        /* keep the original worker URL */
      }
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return pdfjs.getDocument({ data: await r.arrayBuffer() }).promise;
    })();
    docPromise = loading;
    loading.catch(() => {
      if (docPromise === loading) docPromise = null; // allow a retry after a failure
    });
  }
  return docPromise;
}

export function PageViewer({ pdfUrl, aspects, pdfPages, focusTick, onPaneEscape, pageWidth }: Props) {
  const [zoom, setZoom] = useState(1);
  const [docReady, setDocReady] = useState(false);
  // inverted page colors: one shared pref (data-page-invert on <html>),
  // persisted independently of the theme
  const [invert, setInvert] = useState(loadPageInvert);
  const osRef = useRef<OverlayScrollbarsComponentRef>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  // cancel fn of the in-flight button/reset zoom animation
  const zoomAnimRef = useRef<(() => void) | null>(null);
  // in-flight smooth scroll: its target (arrow keys chain onto it) + cancel
  const scrollAnimRef = useRef<{ top: number; left: number; cancel: () => void } | null>(null);
  const boundsRef = useRef<Bounds>({ min: 0.05, max: MAX_ZOOM });
  // zoom the pane starts at (fit width); R compares against it to decide
  // between "reset zoom" and "scroll back to the top"
  const defaultZoomRef = useRef(1);

  // the element that actually scrolls inside the OverlayScrollbars structure
  const vpEl = () => osRef.current?.osInstance()?.elements().viewport ?? null;

  const clampToBounds = (v: number) =>
    Math.min(
      boundsRef.current.max,
      Math.max(boundsRef.current.min, Number.isFinite(v) ? v : 1),
    );

  // stop an in-flight button zoom; wheel takes over from the current frame
  const cancelAnim = () => {
    zoomAnimRef.current?.();
    zoomAnimRef.current = null;
  };

  // one synchronous zoom step: --z rescales every page box, then the scroll
  // is compensated so the content point under (ax, ay) stays there. Every
  // length in the content is a multiple of --z (boxes AND the flex gap),
  // so (scroll + anchor) * r - anchor is exact.
  const applyZoom = (z: number, ax?: number, ay?: number) => {
    const el = vpEl();
    const flow = flowRef.current;
    if (!el || !flow) return;
    const r = z / zoomRef.current;
    const px = ax ?? el.clientWidth / 2;
    const py = ay ?? el.clientHeight / 2;
    const sl = el.scrollLeft;
    const st = el.scrollTop;
    flow.style.setProperty("--z", String(z));
    el.scrollLeft = (sl + px) * r - px;
    el.scrollTop = (st + py) * r - py;
    zoomRef.current = z;
    setZoom(z);
  };

  // recompute --pw (page width at zoom 1 = pane width minus the side margins,
  // so at 100% the page plus its --pad margins fill the pane width exactly —
  // or the pageWidth fit, the stack then centered)
  // and the zoom bounds for the current pdfPages: min = the tallest page
  // with its top/bottom margins fills the pane height, max = 2x pane width
  // (never below min). --pad is read from CSS (it differs on phones).
  const syncVars = () => {
    const pane = viewerRef.current;
    const flow = flowRef.current;
    if (!pane || !flow) return;
    const vw = pane.clientWidth;
    const vh = pane.clientHeight;
    if (!vw || !vh) return;
    const pad = parseFloat(getComputedStyle(flow).getPropertyValue("--pad")) || 0;
    const maxA = pdfPages.length
      ? Math.max(...pdfPages.map((p) => pageAspect(aspects, p)))
      : 297 / 210;
    const fit = pageWidth ? Math.min(pageWidth.max, Math.max(pageWidth.min, (vh - 2 * pad) / maxA)) : Infinity;
    const pw = Math.max(1, Math.min(vw - 2 * pad, fit));
    flow.style.setProperty("--pw", `${pw}px`);
    // capped at 1: on a tall narrow pane (phone) fitting the height would
    // need a page wider than the pane, pushing the default above 100%
    const min = Math.min(1, Math.max(0.05, vh / (pw * maxA + 2 * pad)));
    boundsRef.current = { min, max: Math.max(MAX_ZOOM, min) };
  };

  // kick off (and await) the shared document as soon as the viewer mounts
  useEffect(() => {
    let alive = true;
    setDocReady(false);
    getDoc(pdfUrl)
      .then(() => {
        if (alive) setDocReady(true);
      })
      .catch(() => {
        if (alive) setDocReady(false);
      });
    return () => {
      alive = false;
    };
  }, [pdfUrl]);

  // fresh start on mount and on pdfPages change (unit ↔ unit, unit ↔
  // additional): default zoom (fit the pane width, clamped into bounds),
  // scroll to the very top of the stack. Nothing persists.
  useEffect(() => {
    cancelAnim();
    syncVars();
    const z = clampToBounds(1);
    defaultZoomRef.current = z;
    const flow = flowRef.current;
    const el = vpEl();
    if (flow) flow.style.setProperty("--z", String(z));
    zoomRef.current = z;
    setZoom(z);
    if (el) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }, [pdfPages]);

  // keep --pw and the bounds synced with the pane; a live zoom that left
  // the new range is clamped in place (center-anchored)
  useEffect(() => {
    const pane = viewerRef.current;
    if (!pane) return;
    const onResize = () => {
      // an untouched pane keeps fitting: the first measure can land while
      // the layout is still settling (narrow pane -> min > 1), which used
      // to strand the "100%" default at e.g. 120%
      const untouched = Math.abs(zoomRef.current - defaultZoomRef.current) <= 0.005;
      syncVars();
      if (untouched && zoomAnimRef.current === null) {
        const z = clampToBounds(1);
        defaultZoomRef.current = z;
        if (z !== zoomRef.current) applyZoom(z);
        return;
      }
      const { min, max } = boundsRef.current;
      if (zoomRef.current < min || zoomRef.current > max) {
        applyZoom(clampToBounds(zoomRef.current));
      }
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [pdfPages]);

  // ctrl+wheel / trackpad pinch zoom, anchored at the cursor point;
  // plain wheel is a normal scroll
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain wheel = normal scroll
      e.preventDefault(); // block browser page-zoom
      cancelAnim();
      // normalize lines/pages to pixels, then map deltaY exponentially so
      // trackpad pinch (many tiny deltas) feels proportional, not jumpy
      const units =
        e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      const capped = Math.max(-60, Math.min(60, units));
      const factor = Math.exp(-capped * 0.0032);
      const vp = vpEl();
      if (!vp) return;
      const vr = vp.getBoundingClientRect();
      applyZoom(
        clampToBounds(zoomRef.current * factor),
        e.clientX - vr.left,
        e.clientY - vr.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // two-finger pinch zoom, anchored at the pinch midpoint; a single finger
  // stays a native pan (touch-action: pan-x pan-y in CSS keeps the browser
  // from hijacking the gesture into a page zoom)
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      cancelAnim();
      start = { dist: dist(e.touches), zoom: zoomRef.current };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const vp = vpEl();
      if (!vp) return;
      const vr = vp.getBoundingClientRect();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - vr.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - vr.top;
      applyZoom(clampToBounds(start.zoom * (dist(e.touches) / start.dist)), mx, my);
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // smooth scrolling: OverlayScrollbars suppresses the native smooth
  // scroll-behavior on its viewport, so animate scrollTop/scrollLeft. A new
  // call retargets the running animation from the current position (one loop
  // at a time), so a held arrow key glides instead of stacking animations.
  const smoothScroll = (top: number, left: number) => {
    const vp = vpEl();
    if (!vp) return;
    scrollAnimRef.current?.cancel();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const toTop = clamp(top, vp.scrollHeight - vp.clientHeight);
    const toLeft = clamp(left, vp.scrollWidth - vp.clientWidth);
    const fromTop = vp.scrollTop;
    const fromLeft = vp.scrollLeft;
    const t0 = performance.now();
    const anim = {
      top: toTop,
      left: toLeft,
      cancel: frameLoop((now) => {
        const k = Math.min(1, (now - t0) / 220);
        const e = easeOutCubic(k);
        vp.scrollTop = fromTop + (toTop - fromTop) * e;
        vp.scrollLeft = fromLeft + (toLeft - fromLeft) * e;
        if (k < 1) return true;
        if (scrollAnimRef.current === anim) scrollAnimRef.current = null;
        return false;
      }),
    };
    scrollAnimRef.current = anim;
  };

  // arrow-key step from where the scroll is heading, not where it is now:
  // repeated keydowns keep a steady pace instead of re-easing from a lag
  const scrollBy = (dy: number, dx: number) => {
    const vp = vpEl();
    if (!vp) return;
    const base = scrollAnimRef.current ?? { top: vp.scrollTop, left: vp.scrollLeft };
    smoothScroll(base.top + dy, base.left + dx);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onPaneEscape();
      return;
    }
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        scrollBy(-SCROLL_STEP, 0);
        return;
      case "ArrowDown":
        e.preventDefault();
        scrollBy(SCROLL_STEP, 0);
        return;
      case "ArrowLeft":
        e.preventDefault();
        scrollBy(0, -SCROLL_STEP);
        return;
      case "ArrowRight":
        e.preventDefault();
        scrollBy(0, SCROLL_STEP);
        return;
      // a screen minus a sliver of overlap, so the reading line stays in view
      case "PageUp":
        e.preventDefault();
        scrollBy(-(vpEl()?.clientHeight ?? 0) * 0.9, 0);
        return;
      case "PageDown":
        e.preventDefault();
        scrollBy((vpEl()?.clientHeight ?? 0) * 0.9, 0);
        return;
      case "Home":
        e.preventDefault();
        smoothScroll(0, scrollAnimRef.current?.left ?? vpEl()?.scrollLeft ?? 0);
        return;
      case "End":
        e.preventDefault();
        // smoothScroll clamps to the real bottom
        smoothScroll(Infinity, scrollAnimRef.current?.left ?? vpEl()?.scrollLeft ?? 0);
        return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      (e.key === "+" || e.key === "=")
    ) {
      e.preventDefault(); // also blocks the browser page-zoom
      step(0.25);
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      (e.key === "-" || e.key === "_")
    ) {
      e.preventDefault();
      step(-0.25);
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === "KeyT") {
      e.preventDefault();
      viewerRef.current?.querySelector<HTMLButtonElement>(".invertbtn")?.click();
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyR") {
      e.preventDefault();
      if (Math.abs(zoomRef.current - defaultZoomRef.current) > 0.005) {
        animateTo(clampToBounds(1));
      } else {
        smoothScroll(0, 0);
      }
    }
  };

  // Shift+S: focus the pane without scrolling it
  useEffect(() => {
    if (focusTick > 0) viewerRef.current?.focus({ preventScroll: true });
  }, [focusTick]);

  // eased zoom for buttons/reset, anchored at the (fixed) visual center
  const animateTo = (target: number) => {
    cancelAnim();
    const el = vpEl();
    if (!el) return;
    const ax = el.clientWidth / 2;
    const ay = el.clientHeight / 2;
    const from = zoomRef.current;
    const t0 = performance.now();
    applyZoom(from, ax, ay); // first frame lands synchronously (RAF may never fire)
    const cancel = frameLoop((now) => {
      const k = Math.min(1, (now - t0) / ANIM_MS);
      applyZoom(from + (target - from) * easeOutCubic(k), ax, ay);
      if (k < 1) return true;
      if (zoomAnimRef.current === cancel) zoomAnimRef.current = null;
      return false;
    });
    zoomAnimRef.current = cancel;
  };

  const step = (dz: number) =>
    animateTo(clampToBounds(Math.round((zoomRef.current + dz) * 100) / 100));

  const toggleInvert = () => {
    const next = !invert;
    savePageInvert(next);
    setInvert(next);
  };

  return (
    <div
      className="pageviewer"
      ref={viewerRef}
      tabIndex={0}
      aria-label="Book page"
      onKeyDown={onKey}
    >
      <div className="pagetools">
        <div className="pagetoolbar invertbar">
          <button
            type="button"
            className="invertbtn"
            aria-pressed={invert}
            aria-label="Invert page colors"
            title="Invert page colors"
            onClick={toggleInvert}
          >
            <Contrast size={15} aria-hidden />
          </button>
        </div>
        <div className="pagetoolbar">
          <button type="button" aria-label="Zoom out" title="Zoom out — Ctrl -" onClick={() => step(-0.25)}>
            <ZoomOut size={15} aria-hidden />
          </button>
          <span className="zoomlabel">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" title="Zoom in — Ctrl +" onClick={() => step(0.25)}>
            <ZoomIn size={15} aria-hidden />
          </button>
          <button
            type="button"
            title="Reset zoom — R"
            disabled={Math.abs(zoom - defaultZoomRef.current) <= 0.005}
            onClick={() => animateTo(clampToBounds(1))}
          >
            <RotateCcw size={13} aria-hidden /> Reset
          </button>
        </div>
      </div>
      <OverlayScrollbarsComponent
        ref={osRef}
        className="zoomwrap"
        options={{
          overflow: { x: "scroll", y: "scroll" },
          scrollbars: {
            theme: "os-theme-dark",
            autoHide: "leave",
            autoHideDelay: 500,
          },
        }}
      >
        <div className="pagesflow" ref={flowRef}>
          {pdfPages.map((p) => (
            <PdfPage
              key={p}
              pdfUrl={pdfUrl}
              pageNum={p}
              aspect={pageAspect(aspects, p)}
              zoom={zoom}
              docReady={docReady}
            />
          ))}
        </div>
      </OverlayScrollbarsComponent>
    </div>
  );
}

function PdfPage({ pdfUrl, pageNum, aspect, zoom, docReady }: {
  pdfUrl: string;
  pageNum: number;
  /** height/width of this page, for the placeholder */
  aspect: number;
  zoom: number;
  docReady: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<RenderTask | null>(null);
  const timerRef = useRef<number | null>(null);
  const renderedRef = useRef(0); // css width the backing store was rendered for

  const render = async () => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || !docReady) return;
    const cssW = box.clientWidth;
    if (cssW < 10) return; // hidden pane; a later zoom/resize retriggers
    if (taskRef.current) {
      taskRef.current.cancel();
      taskRef.current = null;
    }
    const doc = await getDoc(pdfUrl);
    if (!boxRef.current || !canvasRef.current) return;
    const page = await doc.getPage(pageNum);
    if (!boxRef.current || !canvasRef.current) return;
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = (cssW * dpr) / base.width;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const task = page.render({ canvasContext: ctx, viewport });
    taskRef.current = task;
    try {
      await task.promise;
      renderedRef.current = cssW;
    } catch {
      /* canceled or failed; a newer render supersedes this one */
    } finally {
      if (taskRef.current === task) taskRef.current = null;
    }
  };

  const schedule = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      render();
    }, RERENDER_DEBOUNCE_MS);
  };

  // while loading, show a blank page placeholder with the REAL page aspect
  // (baked in data/pages.json) instead of the default 2:1 empty canvas stub,
  // so swapping in the rendered canvas never shifts the layout
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || canvas.width !== 300 || canvas.height !== 150) return;
    const w = Math.max(box.clientWidth, 100) * 2; // placeholder resolution
    canvas.width = Math.floor(w);
    canvas.height = Math.floor(w * aspect);
    canvas.style.width = "100%";
    canvas.style.height = "auto";
  }, []);

  // render on mount / doc-ready; units have only a few pages, so eager
  // rendering is cheap and side-steps visibility races entirely. Navigation
  // remounts the pages (keyed by page number). Never on every render: the
  // parent re-renders on each keystroke in an exercise, and render() resets
  // canvas.width, which blanks the page until pdf.js repaints it.
  useEffect(() => {
    schedule();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (taskRef.current) taskRef.current.cancel();
    };
  }, [docReady]);

  // re-render the backing store when the zoom settles (skip tiny drift)
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !docReady) return;
    if (Math.abs(box.clientWidth - renderedRef.current) < 2) return;
    schedule();
  }, [zoom, docReady]);

  return (
    <div ref={boxRef} className="pagebox">
      <canvas ref={canvasRef} className="pagecanvas" />
    </div>
  );
}
