// PageViewer: book pages rendered from the vector PDF via pdf.js onto canvases.
// Every render matches the screen, so zooming stays sharp at any level. v5
// Simple vertical stack: pages flow in a column with a gap, and the scroll
// content is exactly the stack — no elastic void around it, no drag-to-pan.
// Zoom lives in the --z var on .pagesflow: every length in the scroll content
// (page boxes AND the flex gap) is a multiple of --z, so a zoom rescales the
// whole content uniformly by r = z/z0 and the scroll compensation is exact:
// scrollNew = (scrollOld + anchor) * r - anchor — the anchor is the gesture
// point in viewport coords (cursor for ctrl+wheel/pinch, the visual center
// for buttons/reset). Buttons animate ~180ms eased; ctrl+wheel is instant.
// Zoom range: min = the tallest page of the set fills the pane height, max =
// a page twice the pane wide. Nothing is persisted — every pdfPages change
// (unit ↔ unit, unit ↔ additional) and every mount starts at the default
// fit-the-pane-width zoom, scrolled to the very top.
// Scrolling is OverlayScrollbars (overlay bars drawn over the content, hidden
// until hover) like the sidebar and the exercise pane — and it works while
// pages are still loading, because placeholder canvases already occupy the
// real per-page height (baked from book.pdf in pages-meta.json), so finishing
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
import pagesMeta from "../pages-meta.json";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

interface Props {
  pdfPages: number[];
  focusTick: number; // each increment focuses the pane (Shift+S)
  onPaneEscape: () => void; // Esc in the pane: App restores the previous focus
}

const MAX_ZOOM = 2; // page at double the pane width
const ANIM_MS = 180;
const RERENDER_DEBOUNCE_MS = 140;
const SCROLL_STEP = 80; // arrow-key scroll step (px) while the pane is focused

const ASPECTS = pagesMeta as Record<string, number>;
// fallback = A4 portrait; every real page is baked in pages-meta.json
const pageAspect = (p: number) => ASPECTS[String(p)] ?? 297 / 210;

type Bounds = { min: number; max: number };

// one shared document for every viewer instance (unit ↔ additional switches);
// pdf.js itself is dynamically imported so it stays out of the main bundle
let docPromise: Promise<PDFDocumentProxy> | null = null;
function getDoc(): Promise<PDFDocumentProxy> {
  if (!docPromise) {
    docPromise = (async () => {
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
      const r = await fetch(`${import.meta.env.BASE_URL}book.pdf`);
      if (!r.ok) throw new Error(`book.pdf: ${r.status}`);
      return pdfjs.getDocument({ data: await r.arrayBuffer() }).promise;
    })();
    docPromise.catch(() => {
      docPromise = null; // allow a retry after a failure
    });
  }
  return docPromise;
}

export function PageViewer({ pdfPages, focusTick, onPaneEscape }: Props) {
  const [zoom, setZoom] = useState(1);
  const [docReady, setDocReady] = useState(false);
  const osRef = useRef<OverlayScrollbarsComponentRef>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  const animRef = useRef<number | null>(null);
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
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
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

  // recompute --pw (pane width = page width at zoom 1) and the zoom bounds
  // for the current pdfPages: min = the tallest page fills the pane height,
  // max = 2x pane width (never below min)
  const syncVars = () => {
    const pane = viewerRef.current;
    const flow = flowRef.current;
    if (!pane || !flow) return;
    const vw = pane.clientWidth;
    const vh = pane.clientHeight;
    if (!vw || !vh) return;
    flow.style.setProperty("--pw", `${vw}px`);
    const maxA = pdfPages.length
      ? Math.max(...pdfPages.map(pageAspect))
      : 297 / 210;
    const min = Math.max(0.05, vh / (vw * maxA));
    boundsRef.current = { min, max: Math.max(MAX_ZOOM, min) };
  };

  // kick off (and await) the shared document as soon as the viewer mounts
  useEffect(() => {
    let alive = true;
    getDoc()
      .then(() => {
        if (alive) setDocReady(true);
      })
      .catch(() => {
        if (alive) setDocReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

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
      syncVars();
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

  // Shift+S lands focus here: pane-scoped keys (arrows / Ctrl zoom / R / Esc)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onPaneEscape();
      return;
    }
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        vpEl()?.scrollBy({ top: -SCROLL_STEP });
        return;
      case "ArrowDown":
        e.preventDefault();
        vpEl()?.scrollBy({ top: SCROLL_STEP });
        return;
      case "ArrowLeft":
        e.preventDefault();
        vpEl()?.scrollBy({ left: -SCROLL_STEP });
        return;
      case "ArrowRight":
        e.preventDefault();
        vpEl()?.scrollBy({ left: SCROLL_STEP });
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
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyR") {
      e.preventDefault();
      if (Math.abs(zoomRef.current - defaultZoomRef.current) > 0.005) {
        animateTo(clampToBounds(1));
      } else {
        const vp = vpEl();
        if (vp) {
          vp.scrollTop = 0;
          vp.scrollLeft = 0;
        }
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
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ANIM_MS);
      applyZoom(from + (target - from) * (1 - Math.pow(1 - k, 3)), ax, ay);
      if (k < 1) {
        // RAF preferred; a timer keeps the animation alive when RAF
        // callbacks are suspended (hidden/background frames, headless
        // capture). Double-firing is harmless: each tick computes k from
        // its own timestamp.
        requestAnimationFrame((r) => tick(r));
        animRef.current = window.setTimeout(() => tick(performance.now()), 32);
      } else {
        animRef.current = null;
      }
    };
    applyZoom(from, ax, ay); // first frame lands synchronously (RAF may never fire)
    requestAnimationFrame((r) => tick(r));
    window.setTimeout(() => tick(performance.now()), 32);
  };

  const step = (dz: number) =>
    animateTo(clampToBounds(Math.round((zoomRef.current + dz) * 100) / 100));

  return (
    <div
      className="pageviewer"
      ref={viewerRef}
      tabIndex={0}
      aria-label="Book page"
      onKeyDown={onKey}
    >
      <div className="pagetoolbar">
        <button type="button" aria-label="Zoom out" title="Zoom out — Ctrl -" onClick={() => step(-0.25)}>
          <ZoomOut size={15} aria-hidden />
        </button>
        <span className="zoomlabel">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" title="Zoom in — Ctrl +" onClick={() => step(0.25)}>
          <ZoomIn size={15} aria-hidden />
        </button>
        <button type="button" title="Reset zoom — R" onClick={() => animateTo(clampToBounds(1))}>
          <RotateCcw size={13} aria-hidden /> Reset
        </button>
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
            <PdfPage key={p} pageNum={p} zoom={zoom} docReady={docReady} />
          ))}
        </div>
      </OverlayScrollbarsComponent>
    </div>
  );
}

function PdfPage({ pageNum, zoom, docReady }: {
  pageNum: number;
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
    const doc = await getDoc();
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
  // (baked in pages-meta.json) instead of the default 2:1 empty canvas stub,
  // so swapping in the rendered canvas never shifts the layout
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || canvas.width !== 300 || canvas.height !== 150) return;
    const w = Math.max(box.clientWidth, 100) * 2; // placeholder resolution
    canvas.width = Math.floor(w);
    canvas.height = Math.floor(w * pageAspect(pageNum));
    canvas.style.width = "100%";
    canvas.style.height = "auto";
  }, []);

  // render on mount / doc-ready / navigation; units have only a few pages,
  // so eager rendering is cheap and side-steps visibility races entirely
  useEffect(() => {
    schedule();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (taskRef.current) taskRef.current.cancel();
    };
  });

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
