// App: hash-routed split-pane course UI.
// Routes: #home (or bare "/") = landing, #u<N> = unit N, #a<N> = additional exercise N.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdditionalData, IndexData, TotalsMap, UnitData } from "./data";
import { fetchAdditional, fetchIndex, fetchTotals, fetchUnit } from "./data";
import { PageViewer } from "./components/PageViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { ExerciseCard } from "./components/ExerciseCard";
import {
  ShortcutsHelpButton,
  ShortcutsModal,
} from "./components/ShortcutsHelp";
import { SC, useCourseShortcuts } from "./shortcuts";
import { ArrowLeft, ArrowRight, Check, Download, Menu, Share2 } from "lucide-react";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import {
  completedUnitIds,
  lastUnitFromProgress,
  loadLastRoute,
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
import { isStandalone } from "./offline";
import { Home, type HomeContinue } from "./components/Home";
import { SHARE_HASH_RE, decodeShare, encodeShare } from "./share";
// content routes (what a hash can deep-link to); Route adds the landing
type ContentRoute =
  { kind: "unit"; n: number } | { kind: "additional"; n: number };

// home landing: bare "/", "#home", or any unknown hash; the rest are content
type Route = { kind: "home" } | ContentRoute;

// unit/additional hash -> route, or null for anything else
function routeFromHash(h: string): ContentRoute | null {
  const mu = h.match(/^u(\d+)$/);
  if (mu) return { kind: "unit", n: Math.min(145, Math.max(1, Number(mu[1]))) };
  const ma = h.match(/^a(\d+)$/);
  if (ma)
    return { kind: "additional", n: Math.min(41, Math.max(1, Number(ma[1]))) };
  return null;
}

// bare "/" resolves to the landing — or, for learners with saved progress,
// straight to their last page (the URL is fixed up by the mount effect)
function entryRoute(): Route {
  const p = loadProgress();
  const hasProgress =
    Object.keys(p.results).length > 0 || Object.keys(p.selfMarks).length > 0;
  if (!hasProgress) return { kind: "home" };
  return (
    routeFromHash(loadLastRoute() ?? lastUnitFromProgress(p) ?? "") ?? {
      kind: "home",
    }
  );
}

function parseHash(): Route {
  const h = window.location.hash.replace(/^#/, "");
  if (h === "") return entryRoute();
  if (h === "home") return { kind: "home" };
  return routeFromHash(h) ?? { kind: "home" };
}

function routeToHash(r: Route): string {
  return r.kind === "unit"
    ? `u${r.n}`
    : r.kind === "additional"
      ? `a${r.n}`
      : "home";
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [index, setIndex] = useState<IndexData | null>(null);
  const [unit, setUnit] = useState<UnitData | null>(null);
  const [additional, setAdditional] = useState<AdditionalData | null>(null);
  const [error, setError] = useState<string>("");
  // first open: collapsed (hover card); a user's explicit choice persists —
  // "0" = left expanded, "1" = collapsed, absent = first-open default (collapsed)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("red-murphy-sidebar-collapsed") === "0",
  );
  const [totals, setTotals] = useState<TotalsMap | null>(null);
  // incoming progress held for the preview modal; applied only on confirm.
  // ONE mechanism for both the #p= link open and the JSON file import.
  const [preview, setPreview] = useState<{
    p: Progress;
    src: "file" | "link";
  } | null>(null);
  const [progress, setProgressState] = useState<Progress>(loadProgress);
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
  const rightpaneRef = useRef<OverlayScrollbarsComponentRef>(null);
  // sidebar collapse representation: in-flow while animating, fixed hover
  // card once fully collapsed (settled); toggling runs the width animation
  const [cardPhase, setCardPhase] = useState(
    () => localStorage.getItem("red-murphy-sidebar-collapsed") !== "0",
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
      localStorage.setItem("red-murphy-sidebar-collapsed", next ? "0" : "1");
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
    // bare "/" resolved to a content page by entryRoute(): write the hash
    // back (replaceState — no history entry) so the URL matches the page
    if (window.location.hash === "" && route.kind !== "home") {
      window.history.replaceState(null, "", `#${routeToHash(route)}`);
    }
    fetchIndex()
      .then(setIndex)
      .catch((e) => setError(String(e)));
    fetchTotals()
      .then(setTotals)
      .catch(() => setTotals(null));
    void applyShareHash();
  }, []);
  // remember the last content page for the "/" entry redirect
  useEffect(() => {
    if (route.kind !== "home") {
      saveLastRoute(route.kind === "unit" ? `u${route.n}` : `a${route.n}`);
    }
  }, [route]);

  useEffect(() => {
    const onHash = () => {
      // "#p=..." share links replace progress; routeFromHash never sees them
      if (SHARE_HASH_RE.test(window.location.hash)) {
        void applyShareHash();
        return;
      }
      setRoute(parseHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // which exercise of the route is still in flight: its pane shows a skeleton
  // that mirrors the real card shape (heading, instruction, numbered rows).
  // Reading the route instead of a set-then-cleared flag makes a strike on
  // the exercises impossible — the key flips to null only when the matching
  // JSON lands (or fails; the error message is the pane's content then).
  const routeKey =
    route.kind === "unit"
      ? `u${route.n}`
      : route.kind === "additional"
        ? `a${route.n}`
        : null;
  const pending = routeKey && !unit && !additional && !error ? routeKey : null;
  // route numbers go into the placeholder heading, which must read exactly
  // like the loaded heading
  const routeN = routeKey ? Number(routeKey.slice(1)) : 0;
  // Everything index.json already knows about the route, available as soon as
  // the index lands: the heading text and the book pages. That is what lets a
  // route paint its real title and start the PDF alongside the exercise JSON.
  const routeInfo = routeKey ? index?.exercises?.[routeKey] : undefined;
  // The page stack mounts on index pages for the whole visit, never on the
  // loaded unit object: the PDF fetch (74.6 MB, the slowest thing the app
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
      fetchUnit(route.n)
        .then(setUnit)
        .catch((e) => setError(String(e)));
    } else if (route.kind === "additional") {
      fetchAdditional(route.n)
        .then(setAdditional)
        .catch((e) => setError(String(e)));
    }
  }, [route]);
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

  // the landing CTA: learners with saved progress continue with the unit
  // AFTER the last one where they did at least one exercise (a result or a
  // self-check mark); once that would be past unit 145, the first
  // additional exercise without results. Fresh users get plain
  // "Start with Unit 1".
  const homeContinue = useMemo<HomeContinue | null>(() => {
    const hasProgress =
      Object.keys(progress.results).length > 0 ||
      Object.keys(progress.selfMarks).length > 0;
    if (!hasProgress) return null;
    let lastTouched = 0;
    for (const keys of [progress.results, progress.selfMarks]) {
      for (const id of Object.keys(keys)) {
        const m = id.match(/^(\d+)\./);
        if (m) lastTouched = Math.max(lastTouched, Number(m[1]));
      }
    }
    if (lastTouched < 145) {
      return {
        hash: `u${lastTouched + 1}`,
        label: `Continue with Unit ${lastTouched + 1}`,
      };
    }
    const nextAdditional = Array.from({ length: 41 }, (_, i) => i + 1).find(
      (n) => !unitCompleted(progress, [String(n)]),
    );
    if (nextAdditional) {
      return {
        hash: `a${nextAdditional}`,
        label: `Continue with Additional exercise ${nextAdditional}`,
      };
    }
    return null;
  }, [progress]);

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
    a.download = `red-murphy-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return includeAnswers
      ? "File downloaded (answers included)"
      : "File downloaded (answers excluded)";
  }

  async function handleShare(includeAnswers: boolean): Promise<string> {
    const code = await encodeShare(progressPayload(progress, includeAnswers));
    const url = `${location.origin}${location.pathname}#p=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      return "Link copied to clipboard";
    } catch {
      window.prompt("Copy this link:", url);
      return "Copy the link from the prompt";
    }
  }

  // "#p=..." share links: decode and hold the INCOMING progress for a preview
  // modal — nothing is applied until the user confirms; the hash is rewritten
  // to a plain unit route (replaceState — no hashchange, so no re-entry loop).
  async function applyShareHash(): Promise<void> {
    const m = window.location.hash.match(SHARE_HASH_RE);
    if (!m) return;
    const p = await decodeShare(`${m[1]}.${m[2]}`);
    if (p) setPreview({ p, src: "link" });
    else setNotice("Share link is invalid or corrupted");
    window.history.replaceState(null, "", `${window.location.pathname}#u1`);
    setRoute({ kind: "unit", n: 1 });
  }

  function handleApplyPreview(): void {
    if (!preview) return;
    setProgressState(preview.p);
    saveProgress(preview.p, 0);
    setPreview(null);
    setModalOpen(false); // close entirely: the notice must be visible
    setNotice(
      preview.src === "link"
        ? "Progress loaded from link"
        : "Progress imported",
    );
  }

  function navUnit(n: number) {
    window.location.hash = `u${n}`;
    setDrawerOpen(false);
  }

  function navAdditional(n: number) {
    window.location.hash = `a${n}`;
    setDrawerOpen(false);
  }

  // pager: null on home/unknown routes, else prev/next course positions.
  // Built from raw index (the old `course` list duplicated this logic).
  const pager = useMemo<null | {
    prev: NavTarget | null;
    next: NavTarget | null;
  }>(() => {
    if (route.kind === "home" || !index) return null;
    const at = (r?: Route | null): NavTarget | null => {
      if (!r || r.kind === "home") return null;
      const cr = r as ContentRoute;
      return {
        kind: cr.kind,
        n: cr.n,
        label:
          cr.kind === "unit" ? `Unit ${cr.n}` : `Additional exercise ${cr.n}`,
        desc: index.exercises?.[cr.kind === "unit" ? `u${cr.n}` : `a${cr.n}`]?.title ?? "",
      };
    };
    const course: ContentRoute[] = [
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
    window.location.hash = "home";
  }

  // landing CTA + cover: resume where the learner left off, or Unit 1
  function startCourse() {
    window.location.hash = homeContinue ? homeContinue.hash : "u1";
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
        total={145}
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
            <h1>Essential Grammar in Use</h1>
          </button>
          {notice && (
            <span className="progressline" role="status">
              {notice}
            </span>
          )}
        </div>
        <div className="topstats">{stats}</div>
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
            <button
              className="themebtn"
              onClick={() => setOfflineOpen(true)}
              title="Offline — download the course"
              aria-label="Offline: download the course"
            >
              <Download size={15} aria-hidden />
            </button>
          )}
          <ThemeToggle />
        </div>
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
          <Home onStart={startCourse} continueTo={homeContinue} />
        ) : (
          <div className="split" data-tab={mobileTab}>
            <div className="leftpane">
              {mountPages && (
                <PageViewer
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
      <OfflinePanel open={offlineOpen} onClose={() => setOfflineOpen(false)} />
      {helpOpen && <ShortcutsModal onClose={closeHelp} />}
    </div>
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

// Topbar progress meter drawn as a battery: label on the left, then a cell
// filled to done/total with the count printed inside. `empty` keeps the
// cell blank while the real total isn't known yet.
function Battery({
  label,
  done,
  total,
  tone,
  pending = false,
}: {
  label: string;
  done: number;
  total: number;
  tone: "accent" | "ok";
  pending?: boolean;
}) {
  const percent = pending ? 0 : pct({ correct: done, total });
  const text = `${done}/${total}`;
  return (
    <div
      className={`battery ${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pending ? undefined : percent}
      aria-valuetext={pending ? undefined : `${text} (${percent}%)`}
      title={pending ? label : `${label}: ${text} (${percent}%)`}
    >
      <span className="battery-label">{label}</span>
      <span className="battery-cell">
        {/* any progress shows a sliver, so 1 of 145 doesn't read as empty */}
        <span
          className="battery-fill"
          style={{
            width: `${percent}%`,
            minWidth: !pending && done > 0 ? 3 : 0,
          }}
        />
        {!pending && <strong className="battery-value">{text}</strong>}
      </span>
    </div>
  );
}
