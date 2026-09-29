// CourseApp: one book's split-pane course UI — its landing, units and
// additional exercises (routes.ts: #/<book>, #/<book>/u<N>, #/<book>/a<N>).
// App mounts it keyed by the book, so switching books starts from a clean
// slate; within a book the page arrives as a prop from the hash.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "./books";
import { bookUrl } from "./books";
import { BookContext } from "./bookContext";
import type { AdditionalData, IndexData, PageAspects, TotalsMap, UnitData } from "./data";
import {
  fetchAdditional,
  fetchIndex,
  fetchPageAspects,
  fetchTotals,
  fetchUnit,
} from "./data";
import { PageViewer } from "./components/PageViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { ExerciseCard } from "./components/ExerciseCard";
import {
  ShortcutsHelpButton,
  ShortcutsModal,
} from "./components/ShortcutsHelp";
import { SC, useCourseShortcuts } from "./shortcuts";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  LibraryBig,
  Menu,
  Share2,
} from "lucide-react";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import {
  completedUnitIds,
  continueTarget,
  loadProgress,
  parseProgressText,
  pct,
  progressPayload,
  saveLastRoute,
  saveProgress,
  scopeStats,
  unitCompleted,
} from "./progress";
import type { Progress } from "./progress";
import { ProgressModal } from "./components/ProgressModal";
import { OfflinePanel } from "./components/OfflinePanel";
import { OfflineButton, OfflineChip } from "./components/OfflineButton";
import {
  autoDownloadAllowed,
  downloadBook,
  downloadState,
  isDownloaded,
  isStandalone,
} from "./offline";
import { Home } from "./components/Home";
import { Battery } from "./components/Battery";
import { decodeShare, encodeShare } from "./share";
import type { BookPage, ContentPage } from "./routes";
import { LIBRARY_HASH, bookHash, pageKey, replaceHash } from "./routes";
import { SIDEBAR_COLLAPSED_KEY } from "./keys";

// How long an installed app waits before it starts filling the offline cache
// by itself: past the first paint and the page's own requests.
const AUTO_DOWNLOAD_MS = 3000;

export default function CourseApp({
  book,
  page: route,
  share,
}: {
  book: Book;
  page: BookPage;
  /** code of a #/<book>/p= link: previewed, applied only on confirm */
  share?: string;
}) {
  const [index, setIndex] = useState<IndexData | null>(null);
  const [unit, setUnit] = useState<UnitData | null>(null);
  const [additional, setAdditional] = useState<AdditionalData | null>(null);
  const [error, setError] = useState<string>("");
  // first open: collapsed (hover card); a user's explicit choice persists —
  // "0" = left expanded, "1" = collapsed, absent = first-open default (collapsed)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "0",
  );
  const [totals, setTotals] = useState<TotalsMap | null>(null);
  // incoming progress held for the preview modal; applied only on confirm.
  // ONE mechanism for both the #p= link open and the JSON file import.
  const [preview, setPreview] = useState<{
    p: Progress;
    src: "file" | "link";
  } | null>(null);
  const [progress, setProgressState] = useState<Progress>(() => loadProgress(book.id));
  // page heights, fetched with the index: the page stack waits for them so
  // its placeholders take their real size from the first frame
  const [aspects, setAspects] = useState<PageAspects | null>(null);
  // keyboard-shortcuts help modal + pane focus pump (Shift+S)
  const [helpOpen, setHelpOpen] = useState(false);
  const [paneFocusTick, setPaneFocusTick] = useState(0);
  const preHelpFocus = useRef<HTMLElement | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // the offline download window: its button exists only in the installed app
  const [offlineOpen, setOfflineOpen] = useState(false);
  // computed once — an install relaunches the app in standalone, so this
  // cannot change under a live session
  const [standalone] = useState(isStandalone);
  // Shift+I open: the modal underlines each control's trigger letter
  const [modalHints, setModalHints] = useState(false);
  const [notice, setNotice] = useState("");
  // transient topbar notice, auto-clears
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  // An installed app pulls the open book into the cache on its own, so a
  // fresh install is offline-ready without anyone pressing the button — the
  // progress shows up on the topbar button (and, on a phone, on the chip).
  // Started once the page has settled, and again if the browser comes back
  // online: the launch that installs the app may well have no network yet. A
  // failed run is never retried in a loop — the panel and the chip both offer
  // it again.
  useEffect(() => {
    if (!standalone) return;
    let stopped = false;
    const attempt = async () => {
      if (stopped || downloadState(book.id).active || navigator.onLine === false) return;
      if (!autoDownloadAllowed(book.id)) return; // removed by hand: leave it removed
      if (await isDownloaded(book)) return;
      if (stopped || downloadState(book.id).active) return;
      downloadBook(book).catch(() => {
        /* offline, or a file gone: the panel offers a retry */
      });
    };
    const t = window.setTimeout(() => void attempt(), AUTO_DOWNLOAD_MS);
    window.addEventListener("online", attempt);
    return () => {
      stopped = true;
      window.clearTimeout(t);
      window.removeEventListener("online", attempt);
    };
  }, [standalone, book]);
  // phone layout (<=768px): the split becomes Book | Exercises tabs and the
  // sidebar becomes a drawer; desktop layout is pixel-identical
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 768px)").matches,
  );
  const [mobileTab, setMobileTab] = useState<"book" | "exercises">("book");
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // Phone drawer gestures: a leftward swipe pushes the open drawer back, a
  // rightward one pulls it in over either pane. No drawer state is read — a
  // drag only ever sets the panel to where it already is — so the listeners
  // survive every open/close. Passive listeners plus the vertical slop leave
  // page scrolling alone. Places that own their touches are left out: the
  // book pages (dragging there must never summon the drawer), form controls
  // (caret placement, text selection) and open dialogs (the drawer would
  // otherwise slide in behind the modal, which already covers the screen).
  useEffect(() => {
    if (!isMobile) return;
    const SWIPE_OWNED =
      "input, textarea, select, .pageviewer, .modal-overlay, .helpoverlay";
    const COMMIT = 60; // horizontal travel that commits the gesture (px)
    const SLOP = 12; // vertical travel that hands the drag back to scrolling
    let x0 = 0;
    let y0 = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.target instanceof Element && t.target.closest(SWIPE_OWNED)) return;
      x0 = t.clientX;
      y0 = t.clientY;
      tracking = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      if (e.touches.length !== 1) {
        // a second finger means a pinch, not a swipe
        tracking = false;
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
        tracking = false;
        return;
      }
      if (Math.abs(dx) < COMMIT || Math.abs(dx) <= Math.abs(dy)) return;
      tracking = false;
      setDrawerOpen(dx > 0);
    };
    const onEnd = () => {
      tracking = false;
    };
    const opts = { passive: true } as const;
    window.addEventListener("touchstart", onStart, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("touchend", onEnd, opts);
    window.addEventListener("touchcancel", onEnd, opts);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [isMobile]);
  const rightpaneRef = useRef<OverlayScrollbarsComponentRef>(null);
  // sidebar collapse representation: in-flow while animating, fixed hover
  // card once fully collapsed (settled); toggling runs the width animation
  const [cardPhase, setCardPhase] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== "0",
  );
  const [transient, setTransient] = useState(false);
  const animTimers = useRef<number[]>([]);
  const clearAnimTimers = () => {
    for (const t of animTimers.current) window.clearTimeout(t);
    animTimers.current = [];
  };
  const toggleSidebar = () => {
    // mobile: the hamburger opens a drawer instead of the desktop collapse
    // machinery; no localStorage write, no transient/card phases
    if (isMobile) {
      setDrawerOpen((v) => !v);
      return;
    }
    clearAnimTimers();
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "0" : "1");
    } catch {
      // storage unavailable: choice silently not persisted
    }
    if (next) {
      // collapsed card -> brief in-flow zero-width frame -> animate open
      setCardPhase(false);
      setTransient(true);
      animTimers.current.push(window.setTimeout(() => setTransient(false), 30));
    } else {
      // open -> animate width to zero -> then become the hover card
      setTransient(true);
      animTimers.current.push(window.setTimeout(() => setCardPhase(true), 270));
    }
  };
  useEffect(() => clearAnimTimers, []);

  useEffect(() => {
    fetchIndex(book)
      .then(setIndex)
      .catch((e) => setError(String(e)));
    fetchTotals(book)
      .then(setTotals)
      .catch(() => setTotals(null));
    fetchPageAspects(book)
      .then(setAspects)
      .catch(() => setAspects({})); // no heights: the pages fall back to A4
  }, [book]);
  // remember the last content page for the "/" entry redirect
  useEffect(() => {
    if (route.kind !== "home") saveLastRoute(book.id, pageKey(route));
  }, [book, route]);

  // "#/<book>/p=..." share links: decode and hold the INCOMING progress for a
  // preview modal — nothing is applied until the user confirms; the hash is
  // rewritten to the book's landing (no history entry, so Back never replays
  // the link)
  useEffect(() => {
    if (!share) return;
    let alive = true;
    void decodeShare(share).then((p) => {
      if (!alive) return;
      if (p) setPreview({ p, src: "link" });
      else setNotice("Share link is invalid or corrupted");
      replaceHash(bookHash(book));
    });
    return () => {
      alive = false;
    };
  }, [book, share]);

  // which exercise of the route is still in flight: its pane shows a skeleton
  // that mirrors the real card shape (heading, instruction, numbered rows).
  // Reading the route instead of a set-then-cleared flag makes a strike on
  // the exercises impossible — the key flips to null only when the matching
  // JSON lands (or fails; the error message is the pane's content then).
  const routeKey = route.kind === "home" ? null : pageKey(route);
  const pending = routeKey && !unit && !additional && !error ? routeKey : null;
  // route numbers go into the placeholder heading, which must read exactly
  // like the loaded heading
  const routeN = routeKey ? Number(routeKey.slice(1)) : 0;
  // Everything index.json already knows about the route, available as soon as
  // the index lands: the heading text and the book pages. That is what lets a
  // route paint its real title and start the PDF alongside the exercise JSON.
  const routeInfo = routeKey ? index?.exercises?.[routeKey] : undefined;
  // The page stack mounts on index pages for the whole visit, never on the
  // loaded unit object: the PDF fetch (14–75 MB, the slowest thing the app
  // does) then runs alongside the exercise JSON. Index pages are a stable
  // reference, so the unit arriving does not re-identify the array and
  // PageViewer keeps its zoom/scroll state. validate.py fails the build if
  // this copy drifts from the per-file pdfPages, which the fallback below
  // covers for a stale browser cache.
  const mountPages =
    routeInfo?.pages ?? unit?.pdfPages ?? additional?.pdfPages;

  useEffect(() => {
    setUnit(null);
    setAdditional(null);
    setError("");
    if (route.kind === "unit") {
      fetchUnit(book, route.n)
        .then(setUnit)
        .catch((e) => setError(String(e)));
    } else if (route.kind === "additional") {
      fetchAdditional(book, route.n)
        .then(setAdditional)
        .catch((e) => setError(String(e)));
    }
  }, [book, route]);
  // a new page always starts read from the top (pager and sidebar alike)
  useEffect(() => {
    const vp = rightpaneRef.current?.osInstance()?.elements().viewport;
    if (vp) vp.scrollTop = 0;
  }, [route]);
  // the pane focus pump is per-page: clear it on navigation so a stale tick
  // can never steal focus from the exercise when PageViewer remounts
  useEffect(() => {
    setPaneFocusTick(0);
  }, [route]);

  // a fresh page puts the caret into the first exercise input so keyboard
  // work starts immediately; fires when the data lands, which covers every
  // way of opening a page (hash, sidebar link, bottom pager buttons)
  useEffect(() => {
    if (!unit && !additional) return;
    // the pane instance/inputs may not exist yet on the very first load —
    // retry across a few frames so focus always lands on the exercise
    let raf = 0;
    let tries = 0;
    const focusFirst = () => {
      const vp = rightpaneRef.current?.osInstance()?.elements().viewport;
      const first = vp?.querySelector<HTMLElement>(
        ".exercise textarea, .exercise input, .exercise select, .exercise button",
      );
      if (!first) return false;
      first.focus({ preventScroll: true });
      return true;
    };
    if (focusFirst()) return;
    const tick = () => {
      if (focusFirst() || ++tries > 60) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [unit, additional]);

  // keep a unit button in the upper third of the panel: plain
  // scrollIntoView("nearest") pinned it to the very bottom edge, and the
  // panel's scrollbars instance re-initializes on mount (twice under
  // StrictMode) right after the list renders, zeroing the scroll again — so
  // it is re-asserted on every (re)initialization too
  const activeRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<OverlayScrollbarsComponentRef<"nav">>(null);
  // false while the panel's overlay-scrollbars viewport is not up yet
  const revealUnit = useCallback((el: HTMLButtonElement | null): boolean => {
    const vp = sidebarRef.current?.osInstance()?.elements().viewport;
    if (!el || !vp) return false;
    const vpRect = vp.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // fully visible already: leave the scroll alone, so clicking a unit that
    // is on screen never jumps the list
    if (elRect.top >= vpRect.top && elRect.bottom <= vpRect.bottom) return true;
    const slack = Math.max(0, vpRect.height - elRect.height);
    vp.scrollTop += elRect.top - vpRect.top - slack / 3;
    return true;
  }, []);
  const revealActiveUnit = useCallback(
    (): boolean => revealUnit(activeRef.current),
    [revealUnit],
  );
  // the route's own unit button; the landing has no active unit, so Shift+E
  // falls back to the first entry of the list there
  const unitPanelTarget = useCallback((): HTMLButtonElement | null => {
    return (
      activeRef.current ??
      sidebarRef.current
        ?.osInstance()
        ?.elements()
        .viewport?.querySelector<HTMLButtonElement>(".unitlink") ??
      null
    );
  }, []);
  const sidebarEvents = useMemo(
    () => ({
      initialized: () => {
        // after the constructor settled: a write made during it is undone by
        // the instance's own setup
        requestAnimationFrame(() => void revealActiveUnit());
      },
    }),
    [revealActiveUnit],
  );
  // route/list changes; the first load is covered by the panel's own
  // `initialized` event, its instance only appears a frame after the list
  useEffect(() => {
    revealActiveUnit();
  }, [revealActiveUnit, route, sidebarOpen, index]);

  const setProgress = useCallback((fn: (p: Progress) => Progress) => {
    setProgressState((p) => fn(p));
  }, []);

  const doneUnits = useMemo(() => completedUnitIds(progress), [progress]);

  // the landing CTA: resume after the last unit worked on (progress.ts)
  const homeContinue = useMemo(() => continueTarget(progress, book), [progress, book]);

  // ---- progress import / export / share -------------------------------------

  // file import goes through the same preview-confirm modal as share links:
  // parse, hold, show — nothing is applied until the user confirms
  async function handleImportFile(file: File): Promise<string> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      return "Could not read the file";
    }
    const p = parseProgressText(text);
    if (!p) return "Invalid progress file";
    setPreview({ p, src: "file" });
    return ""; // the preview modal takes over
  }

  function handleExport(includeAnswers: boolean): string {
    const blob = new Blob(
      [JSON.stringify(progressPayload(progress, includeAnswers))],
      {
        type: "application/json",
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `murrnglish-${book.id}-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return includeAnswers
      ? "File downloaded (answers included)"
      : "File downloaded (answers excluded)";
  }

  async function handleShare(includeAnswers: boolean): Promise<string> {
    const code = await encodeShare(progressPayload(progress, includeAnswers));
    const url = `${location.origin}${location.pathname}#/${book.id}/p=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      return "Link copied to clipboard";
    } catch {
      window.prompt("Copy this link:", url);
      return "Copy the link from the prompt";
    }
  }

  function handleApplyPreview(): void {
    if (!preview) return;
    setProgressState(preview.p);
    saveProgress(book.id, preview.p, 0);
    setPreview(null);
    setModalOpen(false); // close entirely: the notice must be visible
    setNotice(
      preview.src === "link"
        ? "Progress loaded from link"
        : "Progress imported",
    );
  }

  function navUnit(n: number) {
    window.location.hash = bookHash(book, { kind: "unit", n });
    setDrawerOpen(false);
  }

  function navAdditional(n: number) {
    window.location.hash = bookHash(book, { kind: "additional", n });
    setDrawerOpen(false);
  }

  // pager: null on home/unknown routes, else prev/next course positions.
  // Built from raw index (the old `course` list duplicated this logic).
  const pager = useMemo<null | {
    prev: NavTarget | null;
    next: NavTarget | null;
  }>(() => {
    if (route.kind === "home" || !index) return null;
    const at = (cr?: ContentPage): NavTarget | null => {
      if (!cr) return null;
      return {
        kind: cr.kind,
        n: cr.n,
        label:
          cr.kind === "unit" ? `Unit ${cr.n}` : `Additional exercise ${cr.n}`,
        desc: index.exercises?.[cr.kind === "unit" ? `u${cr.n}` : `a${cr.n}`]?.title ?? "",
      };
    };
    const course: ContentPage[] = [
      ...index.groups.flatMap((g) =>
        g.units.map((u) => ({ kind: "unit" as const, n: u })),
      ),
      ...index.additional.exercises.map((n) => ({
        kind: "additional" as const,
        n,
      })),
    ];
    const pos = course.findIndex(
      (r) => r.kind === route.kind && r.n === route.n,
    );
    return { prev: at(course[pos - 1]), next: at(course[pos + 1]) };
  }, [index, route]);

  const exerciseIds = unit ? unit.exercises.map((e) => e.id) : [];
  const isUnitDone =
    route.kind === "unit" && unit
      ? unitCompleted(progress, exerciseIds)
      : false;
  const ov = scopeStats(totals, totals ? Object.keys(totals) : [], progress);

  function goHome() {
    window.location.hash = bookHash(book);
  }

  // landing CTA + cover: resume where the learner left off, or Unit 1
  function startCourse() {
    window.location.hash = homeContinue
      ? `#/${book.id}/${homeContinue.page}`
      : bookHash(book, { kind: "unit", n: 1 });
  }

  // focus restoration around the help modal: the element active when help
  // opened gets focus back when it closes (Esc, backdrop, close button)
  const openHelp = () => {
    preHelpFocus.current = document.activeElement as HTMLElement | null;
    setHelpOpen(true);
  };
  const closeHelp = () => {
    setHelpOpen(false);
    preHelpFocus.current?.focus();
  };
  // one resolver for every "go to course position" path (bottom pager
  // buttons + Shift+N / Shift+P shortcuts)
  const goTarget = (t: NavTarget | null) => {
    if (!t) return;
    if (t.kind === "unit") navUnit(t.n);
    else navAdditional(t.n);
  };
  const sc = useCourseShortcuts({
    helpOpen,
    openHelp,
    closeHelp,
    progressOpen: modalOpen || preview !== null,
    progressHints: modalOpen && modalHints,
    hintProgress: () => {
      setModalHints(true);
      setModalOpen(true);
    },
    goNextUnit: () => goTarget(pager?.next ?? null),
    goPrevUnit: () => goTarget(pager?.prev ?? null),
    focusPagePane: () => setPaneFocusTick((t) => t + 1),
    focusUnitPanel: () => {
      const el = unitPanelTarget();
      if (!el) return;
      // reveal first — focus() alone would scroll the unit to the bottom edge;
      // preventScroll then keeps it where the reveal put it
      if (revealUnit(el)) el.focus({ preventScroll: true });
      else el.focus();
    },
    toggleSidebar,
    cycleTheme: () =>
      document
        .querySelector<HTMLButtonElement>(
          '.topbar-actions .themebtn[aria-label^="Theme"]',
        )
        ?.click(),
  });
  const isHome = route.kind === "home";
  // progress batteries: in the topbar on desktop, atop the unit drawer on
  // phones (the phone topbar has no room for them)
  const stats = (
    <>
      <Battery
        label="Units completed"
        done={doneUnits.size}
        total={book.units}
        tone="accent"
      />
      {/* blank until the course totals load: saved progress alone only
          knows the attempted blanks, and showing that count first made
          the value jump to the real total a moment later */}
      <Battery
        label="Answers correct"
        done={ov.correct}
        total={ov.total}
        tone="ok"
        pending={!totals}
      />
    </>
  );

  return (
    <BookContext.Provider value={book}>
    <div className="app">
      <header className="topbar">
        <button
          className="sidebartoggle"
          onClick={toggleSidebar}
          title={"Unit list \u2014 " + SC.sidebarToggle}
          aria-label="Toggle unit list"
        >
          <Menu size={16} aria-hidden />
        </button>
        <div className="topbar-mid">
          {/* the way back to every book; phones reach it from the drawer */}
          <a className="topbar-lib" href={LIBRARY_HASH} title="All books">
            <LibraryBig size={17} aria-hidden />
            <span>Murrnglish</span>
          </a>
          <span className="topbar-crumbsep" aria-hidden>
            /
          </span>
          <button
            type="button"
            className="topbar-home"
            onClick={
              isHome
                ? undefined
                : // mobile: the unit drawer might be open behind the topbar;
                  // going home also closes it so the tab bar is visible again
                  () => {
                    if (isMobile) setDrawerOpen(false);
                    goHome();
                  }
            }
            disabled={isHome}
          >
            <h1>{book.title}</h1>
          </button>
          {notice && (
            <span className="progressline" role="status">
              {notice}
            </span>
          )}
        </div>
        <div className="topstats">{stats}</div>
        {isMobile && standalone && (
          <OfflineChip bookId={book.id} onOpen={() => setOfflineOpen(true)} />
        )}
        {/* phones keep the topbar to the title alone: progress, download and
            theme move into the unit drawer (see .draweractions), and the
            shortcuts help is dropped — its key hints are inert on touch */}
        {!isMobile && (
          <div className="topbar-actions">
            <ShortcutsHelpButton onOpen={openHelp} />
            <button
              className="themebtn"
              onClick={() => {
                // pointer open: no underlined letters, just the plain window
                setModalHints(false);
                setModalOpen(true);
              }}
              title={"Progress: import, export, share — " + SC.progress}
              aria-label="Progress: import, export, share"
            >
              <Share2 size={15} aria-hidden />
            </button>
            {standalone && (
              <OfflineButton bookId={book.id} onOpen={() => setOfflineOpen(true)} />
            )}
            <ThemeToggle />
          </div>
        )}
      </header>
      <div className="main">
        {!sidebarOpen && !isMobile && (
          <div className="sidebar-edge" aria-hidden />
        )}
        {!isHome && <MobileTabSwitch tab={mobileTab} onTab={setMobileTab} />}
        {isMobile && (
          <div
            className={`sidebar-backdrop ${drawerOpen && 'enabled'}`}
            onClick={() => setDrawerOpen(false)}
          />
        )}
        {index &&
          (() => {
            const sideCls = isMobile
              ? "sidebar" + (drawerOpen ? " mobile-open" : "")
              : sidebarOpen
                ? transient
                  ? "sidebar opening"
                  : "sidebar"
                : cardPhase
                  ? "sidebar collapsed"
                  : "sidebar closing";
            const osOptions = {
              overflow: { x: "hidden" as const },
              scrollbars: {
                theme: "os-theme-dark",
                autoHide: "leave" as const,
                autoHideDelay: 500,
              },
            };
            return (
              <OverlayScrollbarsComponent
                ref={sidebarRef}
                element="nav"
                className={sideCls}
                options={osOptions}
                events={sidebarEvents}
              >
                <div className="sidebar-inner">
                  {isMobile && (
                    <div className="draweractions">
                      <a className="draweraction" href={LIBRARY_HASH}>
                        <LibraryBig size={16} aria-hidden />
                        <span>All books</span>
                      </a>
                      <button
                        type="button"
                        className="draweraction"
                        onClick={() => {
                          setDrawerOpen(false);
                          // pointer open: no underlined letters, plain window
                          setModalHints(false);
                          setModalOpen(true);
                        }}
                        title={"Progress: import, export, share — " + SC.progress}
                      >
                        <Share2 size={16} aria-hidden />
                        <span>Progress &amp; share</span>
                      </button>
                      {standalone && (
                        <button
                          type="button"
                          className="draweraction"
                          onClick={() => {
                            setDrawerOpen(false);
                            setOfflineOpen(true);
                          }}
                          title="Offline — download books"
                        >
                          <Download size={16} aria-hidden />
                          <span>Download books</span>
                        </button>
                      )}
                      <ThemeToggle labelled />
                    </div>
                  )}
                  {isMobile && <div className="drawerstats">{stats}</div>}
                  {index.groups.map((g) => {
                    const gpct = pct(
                      scopeStats(
                        totals,
                        g.units.map((u) => `u${u}`),
                        progress,
                      ),
                    );
                    return (
                      <div key={g.name} className="group">
                        <div className="groupname">
                          <span>{g.name}</span>
                          {totals && gpct > 0 && (
                            <span
                              className={
                                "grouppct" + (gpct === 100 ? " full" : "")
                              }
                            >
                              {gpct}%
                            </span>
                          )}
                        </div>
                        <div className="unitlinks">
                          {g.units.map((u) => {
                            const upct = pct(
                              scopeStats(totals, [`u${u}`], progress),
                            );
                            return (
                              <button
                                key={u}
                                ref={
                                  route.kind === "unit" && route.n === u
                                    ? activeRef
                                    : undefined
                                }
                                className={
                                  "unitlink" +
                                  (route.kind === "unit" && route.n === u
                                    ? " active"
                                    : "") +
                                  (doneUnits.has(u) ? " done" : "")
                                }
                                onClick={() => navUnit(u)}
                              >
                                {u}
                                {doneUnits.has(u) && (
                                  <span className="donemark">
                                    <Check
                                      size={11}
                                      strokeWidth={3}
                                      aria-hidden
                                    />
                                  </span>
                                )}
                                {totals && upct > 0 && (
                                  <span
                                    className={
                                      "unitpct" + (upct === 100 ? " full" : "")
                                    }
                                  >
                                    {upct}%
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <div className="group">
                    <div className="groupname">
                      <span>{index.additional.title}</span>
                      {totals &&
                        (() => {
                          const apct = pct(
                            scopeStats(
                              totals,
                              index.additional.exercises.map((n) => `a${n}`),
                              progress,
                            ),
                          );
                          return apct > 0 ? (
                            <span
                              className={
                                "grouppct" + (apct === 100 ? " full" : "")
                              }
                            >
                              {apct}%
                            </span>
                          ) : null;
                        })()}
                    </div>
                    <div className="unitlinks">
                      {index.additional.exercises.map((n) => {
                        const apct = pct(
                          scopeStats(totals, [`a${n}`], progress),
                        );
                        return (
                          <button
                            key={n}
                            ref={
                              route.kind === "additional" && route.n === n
                                ? activeRef
                                : undefined
                            }
                            className={
                              "unitlink" +
                              (route.kind === "additional" && route.n === n
                                ? " active"
                                : "")
                            }
                            onClick={() => navAdditional(n)}
                          >
                            {n}
                            {totals && apct > 0 && (
                              <span
                                className={
                                  "unitpct" + (apct === 100 ? " full" : "")
                                }
                              >
                                {apct}%
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </OverlayScrollbarsComponent>
            );
          })()}
        {isHome ? (
          <Home book={book} onStart={startCourse} continueTo={homeContinue} />
        ) : (
          <div className="split" data-tab={mobileTab}>
            <div className="leftpane">
              {mountPages && aspects && (
                <PageViewer
                  pdfUrl={bookUrl(book, "book.pdf")}
                  aspects={aspects}
                  pdfPages={mountPages}
                  focusTick={paneFocusTick}
                  onPaneEscape={sc.restoreFocus}
                />
              )}
            </div>
            <OverlayScrollbarsComponent
              ref={rightpaneRef}
              className="rightpane"
              options={{
                overflow: { x: "hidden" as const },
                scrollbars: {
                  theme: "os-theme-dark",
                  autoHide: "leave" as const,
                  autoHideDelay: 500,
                },
              }}
            >
              {error && <div className="loaderror">{error}</div>}
              {pending && (
                <UnitLoading
                  kind={pending[0] === "u" ? "unit" : "additional"}
                  n={routeN}
                  title={routeInfo?.title ?? ""}
                />
              )}
              {unit && (
                <>
                  <h2 className="unitheading">
                    Unit {unit.unit} — {unit.title}
                    {isUnitDone && (
                      <span className="donetag">
                        <Check size={13} aria-hidden /> done
                      </span>
                    )}
                  </h2>
                  {unit.exercises.map((ex) => (
                    <ExerciseCard
                      key={ex.id}
                      exercise={ex}
                      progress={progress}
                      setProgress={setProgress}
                    />
                  ))}
                </>
              )}
              {additional && (
                <>
                  <h2 className="unitheading">
                    Additional exercise {additional.id} — {additional.topic}
                    {additional.refs && (
                      <span className="refs"> ({additional.refs})</span>
                    )}
                  </h2>
                  <ExerciseCard
                    exercise={additional.exercise}
                    progress={progress}
                    setProgress={setProgress}
                  />
                </>
              )}
              {pager && (pager.prev || pager.next) && (
                <UnitNav prev={pager.prev} next={pager.next} onGo={goTarget} />
              )}
            </OverlayScrollbarsComponent>
          </div>
        )}
      </div>
      <ProgressModal
        open={modalOpen || preview !== null}
        onClose={() => {
          setModalOpen(false);
          setPreview(null);
        }}
        progress={progress}
        preview={preview ? preview.p : null}
        index={index}
        totals={totals}
        onApplyPreview={handleApplyPreview}
        onImport={handleImportFile}
        onExport={handleExport}
        onShare={handleShare}
        hintKeys={modalHints}
      />
      <OfflinePanel
        open={offlineOpen}
        onClose={() => setOfflineOpen(false)}
        currentBookId={book.id}
      />
      {helpOpen && <ShortcutsModal onClose={closeHelp} />}
    </div>
    </BookContext.Provider>
  );
}

interface NavTarget {
  kind: "unit" | "additional";
  n: number;
  label: string;
  desc: string;
}

// Exercises-pane placeholder shown from navigation until the exercise JSON
// lands. The heading is REAL from the first frame — index.json carries every
// title, so there is no reason to skeleton that text. Only the card shape is
// guessed: instruction and numbered rows at the sizes the loaded card renders
// at, so the swap does not jump. Deliberately static (no shimmer): the shape
// already says "loading", and motion here would compete with the page stack
// filling in beside it. Row counts are illustrative — the real ones are not
// known until the JSON is parsed.
function UnitLoading({
  kind,
  n,
  title,
}: {
  kind: "unit" | "additional";
  n: number;
  title: string;
}) {
  // must match the loaded headings exactly, or the title visibly rewrites
  // itself the moment the JSON lands
  const label =
    kind === "unit" ? `Unit ${n}` : `Additional exercise ${n}`;
  return (
    <div className="unitloading" role="status" aria-label="Loading exercises">
      <h2 className="unitheading skel-heading">
        {title ? `${label} — ${title}` : label}
      </h2>
      {[0, 1].map((card) => (
        <div className="exercise skel-card" key={card}>
          <p className="instruction skel-instruction">
            <span className="skel-fill" />
            <span className="skel-fill short" />
          </p>
          {Array.from({ length: card === 0 ? 5 : 3 }, (_, i) => (
            <div className="skel-item" key={i}>
              <span className="skel-bar" />
              <span className="skel-bar" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Bottom-of-page prev/next: two big ghost buttons; at course edges the
// missing side still occupies its grid cell as an empty dashed slot.
function UnitNav({
  prev,
  next,
  onGo,
}: {
  prev: NavTarget | null;
  next: NavTarget | null;
  onGo: (t: NavTarget) => void;
}) {
  const cell = (t: NavTarget | null, side: "prev" | "next") =>
    t ? (
      <button
        type="button"
        className={`unitnavbtn ${side}`}
        onClick={() => onGo(t)}
        title={
          side === "prev"
            ? "Previous unit — " + SC.prevUnit
            : "Next unit — " + SC.nextUnit
        }
      >
        {side === "prev" ? (
          <ArrowLeft size={18} strokeWidth={2} aria-hidden />
        ) : (
          <ArrowRight size={18} strokeWidth={2} aria-hidden />
        )}
        <span className="unitnavtext">
          <span className="unitnavnum">{t.label}</span>
          {t.desc && <span className="unitnavdesc">{t.desc}</span>}
        </span>
      </button>
    ) : (
      <div className="unitnavempty" aria-hidden />
    );
  return (
    <nav className="unitnav" aria-label="Course navigation">
      {cell(prev, "prev")}
      {cell(next, "next")}
    </nav>
  );
}

// Phone-only segmented control picking which pane owns the screen. Rendered
// on desktop too (CSS hides it at >=769px), so no mount flash on resize.
function MobileTabSwitch({
  tab,
  onTab,
}: {
  tab: "book" | "exercises";
  onTab: (t: "book" | "exercises") => void;
}) {
  return (
    <div className="tabswitch" aria-label="Book or exercises view">
      <button
        type="button"
        className={tab === "book" ? "on" : ""}
        aria-pressed={tab === "book"}
        onClick={() => onTab("book")}
      >
        Book
      </button>
      <button
        type="button"
        className={tab === "exercises" ? "on" : ""}
        aria-pressed={tab === "exercises"}
        onClick={() => onTab("exercises")}
      >
        Exercises
      </button>
    </div>
  );
}
