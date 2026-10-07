// The app shell every view renders inside: the topbar and the navigation
// panel — the app's map — with the page's own column beside it. The panel is
// the same on every page: the app-wide controls first (progress and data,
// search, the download, the theme), then the two sections that span the
// books, then the books themselves, ruled off from each other. Inside a book
// its own progress and units hang under the books (CourseApp passes them as
// `bookStats` and `bookUnits`; it is the only view with any).
//
// Desktop: the panel is a real column that collapses to a card the left edge
// slides back in, remembered in localStorage as it was. Mobile: the same
// content as a drawer behind the hamburger, which is why the phone topbar
// carries nothing but the page's title and the hamburger — every control it
// would hold is a row of the drawer. The state lives here so it survives
// navigating between views — one panel, not one per view.

import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { Layers, Menu, NotebookPen, Search, Share2 } from "lucide-react";
import { BOOKS } from "../books";
import { useDueCount } from "../dueCount";
import { openGlobal } from "../globalUi";
import { SIDEBAR_COLLAPSED_KEY } from "../keys";
import { completedUnitIds, loadProgress, subscribeProgress } from "../progress";
import { CARDS_HASH, DICTIONARY_HASH, LIBRARY_HASH, bookHash } from "../routes";
import { SC } from "../shortcuts";
import { useIsMobile } from "../useIsMobile";
import { ShortcutsHelpButton } from "./ShortcutsHelp";
import { ThemeToggle } from "./ThemeToggle";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: {
    theme: "os-theme-dark",
    autoHide: "leave" as const,
    autoHideDelay: 500,
  },
};

// The hamburger's own click, for keys that toggle the menu from anywhere: the
// course scope's Alt+Shift+E and Esc. The shell that is mounted registers its
// handler here, so a key does not need the state or a prop drill to reach it.
let menuToggle: (() => void) | null = null;

/** Toggle the app's sidebar, as the hamburger does. */
export function toggleMenu(): void {
  menuToggle?.();
}

export function AppShell({
  head,
  navActions,
  bookStats,
  bookUnits,
  sidebarRef,
  sidebarEvents,
  children,
}: {
  /** the topbar's middle: the view's own crumb and title */
  head: ReactNode;
  /** the panel's download button, in the installed app */
  navActions?: ReactNode;
  /** the open book's progress, under the books in the map */
  bookStats?: ReactNode;
  /** the open book's units, under its progress */
  bookUnits?: ReactNode;
  /** the course scrolls its panel and scrolls the active unit into view */
  sidebarRef?: RefObject<OverlayScrollbarsComponentRef<"nav">>;
  sidebarEvents?: Record<string, () => void>;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  // any navigation closes the phone drawer: the page behind it has moved, so
  // leaving it open would cover the page the learner just asked for. The map
  // and the course's unit tiles both navigate, so this is the one place that
  // has to know.
  useEffect(() => {
    const close = () => setDrawerOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);
  // first open: collapsed (hover card); a user's explicit choice persists —
  // "0" = left expanded, "1" = collapsed, absent = first-open default (collapsed)
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "0",
  );
  // sidebar collapse representation: in-flow while animating, fixed hover
  // card once fully collapsed (settled); toggling runs the width animation
  const [cardPhase, setCardPhase] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== "0",
  );
  const [transient, setTransient] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
    }
  };
  useEffect(() => {
    menuToggle = toggleSidebar;
    return () => {
      if (menuToggle === toggleSidebar) menuToggle = null;
    }
  });
  useEffect(() => clearAnimTimers, []);
  // Phone drawer gestures: a leftward swipe pushes the open drawer back, a
  // rightward one pulls it in over either pane. No drawer state is read — a
  // drag only ever sets the panel to where it already is — so the listeners
  // survive every open/close. Passive listeners plus the vertical slop leave
  // page scrolling alone. Places that own their touches are left out: form
  // controls (caret placement, text selection), anything that scrolls
  // sideways (the lesson's wide tables, a long row) — a rightward swipe over
  // one of those is reading, not asking for the panel — and open dialogs
  // (the drawer would otherwise slide in behind the modal, which already
  // covers the screen). The lesson's tables own a horizontal drag whatever
  // they are showing, so they are named as well as measured.
  useEffect(() => {
    if (!isMobile) return;
    const SWIPE_OWNED = "input, textarea, select, .lformtables, .modal-overlay, .helpoverlay";
    const COMMIT = 60; // horizontal travel that commits the gesture (px)
    const SLOP = 12; // vertical travel that hands the drag back to scrolling
    // the nearest box around this point that actually scrolls sideways
    const scrollsSideways = (target: EventTarget | null): boolean => {
      for (let el = target; el instanceof Element; el = el.parentElement) {
        const ox = getComputedStyle(el).overflowX;
        if ((ox === "auto" || ox === "scroll") && el.scrollWidth - el.clientWidth > 1) return true;
      }
      return false;
    };
    let x0 = 0;
    let y0 = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (t.target instanceof Element && t.target.closest(SWIPE_OWNED)) return;
      if (scrollsSideways(t.target)) return;
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

  // the class is derived, never set in an effect: the transition between the
  // in-flow panel and the fixed card must land in one commit
  const sideCls = isMobile
    ? "sidebar" + (drawerOpen ? " mobile-open" : "")
    : sidebarOpen
      ? transient
        ? "sidebar opening"
        : "sidebar"
      : cardPhase
        ? "sidebar collapsed"
        : "sidebar closing";

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="sidebartoggle"
          onClick={toggleSidebar}
          title={"Menu — " + SC.sidebarToggle}
          aria-label={isMobile ? "Menu" : "Toggle the menu"}
          aria-expanded={isMobile ? drawerOpen : sidebarOpen}
        >
          <Menu size={16} aria-hidden />
        </button>
        <div className="topbar-mid">{head}</div>
        <div className="topbar-actions">
          {/* everything else the app-wide controls need lives in the panel,
              which a phone reaches through the hamburger */}
          {!isMobile && <ShortcutsHelpButton onOpen={() => openGlobal("help")} />}
        </div>
      </header>
      <div className="main">
        {!sidebarOpen && !isMobile && <div className="sidebar-edge" aria-hidden />}
        {isMobile && (
          <div
            className={`sidebar-backdrop ${drawerOpen && "enabled"}`}
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <OverlayScrollbarsComponent
          ref={sidebarRef}
          element="nav"
          className={sideCls}
          options={OS_OPTIONS}
          events={sidebarEvents}
        >
          <div className="sidebar-inner">
            <NavPanel
              navActions={navActions}
              bookStats={bookStats}
              bookUnits={bookUnits}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </OverlayScrollbarsComponent>
        {children}
      </div>
    </div>
  );
}

/**
 * One tile of the panel: a control that acts (a button) or a place to go (a
 * link). Both read as the same square. A place that is where you are is
 * filled with `color` — a book's own colour, or the app's accent where it has
 * none — so the map answers "where am I" without a rule of its own.
 */
function NavTile({
  href,
  onClick,
  title,
  color,
  active,
  meta,
  dataAttr,
  children,
  childrenRow,
}: {
  /** where the tile goes; absent makes it a button that acts */
  href?: string;
  onClick?: () => void;
  /** the full name and the keys, for the tooltip and for screen readers */
  title: string;
  /** the fill of the tile where you are — a book's own colour */
  color?: string;
  active?: boolean;
  /** the number under the name — cards due, a book's progress */
  meta?: ReactNode;
  dataAttr?: string;
  children: ReactNode;
  childrenRow?: boolean;
}) {
  const cls = "navtile" + (active ? " active" : "");
 
  const style = {} as CSSProperties & Record<string, string>;
  if (color) {
    style["--tile"] = color;
    style["--tile-ink"] = "#fff";
  }
  style["flexDirection"] = childrenRow ? "row" : "column";
  if (childrenRow) {
    style["justifyContent"] = "start";
    style["paddingInline"] = "12px";
  }
 
  const body = (
    <>
      {children}
      {meta && <span className="navmeta">{meta}</span>}
    </>
  );
  return href === undefined ? (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={title}
      aria-label={title}
      style={style}
      {...(dataAttr ? { "data-global-btn": dataAttr } : {})}
    >
      {body}
    </button>
  ) : (
    <a
      href={href}
      className={cls}
      onClick={onClick}
      style={style}
      title={title}
      aria-current={active ? "page" : undefined}
    >
      {body}
    </a>
  );
}


/**
 * The app's map: the app-wide controls, then the sections that span the
 * books, then the books themselves. Every row is the same kind of tile — the
 * one you are in is filled in, a book with the colour it is printed in —
 * so where you are is read off the panel at a glance. Inside a book its own
 * progress and units follow the books — `bookStats` and `bookUnits` are the
 * course's batteries and unit tiles, the only view with any.
 * Progress is read from localStorage, so a write (an import, a finished
 * unit) re-reads it rather than leaving the map stale.
 */
function NavPanel({
  navActions,
  bookStats,
  bookUnits,
  onNavigate,
}: {
  navActions?: ReactNode;
  bookStats?: ReactNode;
  bookUnits?: ReactNode;
  onNavigate: () => void;
}) {
  const due = useDueCount();
  const [, bump] = useState(0);
  useEffect(() => subscribeProgress(() => bump((n) => n + 1)), []);
  const here = window.location.hash;
  // a control that opens a window must not leave the phone drawer open
  // behind it: `onNavigate` is the drawer's own close, and a no-op on desktop
  const open = (which: "data" | "search") => () => {
    onNavigate();
    openGlobal(which);
  };

  return (
    <>
      <div className="navblock navgrid navtools">
        <NavTile
          title={"Progress and data — " + SC.data + " / " + SC.dataAlt}
          dataAttr="data"
          onClick={open("data")}
        >
          <Share2 size={15} aria-hidden />
          <NavLabel>Progress</NavLabel>
        </NavTile>
        <NavTile title={"Search — " + SC.search} onClick={open("search")}>
          <Search size={15} aria-hidden />
          <NavLabel>Search</NavLabel>
        </NavTile>
        {navActions}
        <ThemeToggle />
      </div>
      <div className="navblock navgrid">
        <NavTile
          href={CARDS_HASH}
          onClick={onNavigate}
          active={here.startsWith("#/cards")}
          title={"Cards — " + SC.cards}
        >
          <Layers size={15} aria-hidden />
          <NavLabel meta={due > 0 ? due : undefined}>Cards</NavLabel>
        </NavTile>
        <NavTile
          href={DICTIONARY_HASH}
          onClick={onNavigate}
          active={here.startsWith("#/dictionary")}
          title={"Dictionary — " + SC.dictionary}
        >
          <NotebookPen size={15} aria-hidden />
          <NavLabel>Dictionary</NavLabel>
        </NavTile>
      </div>
      <div className="navblock navgrid navbooks">
        {BOOKS.map((book) => {
          const done = completedUnitIds(loadProgress(book.id)).size;
          const open = here.startsWith(`#/${book.id}`);
          return (
            <NavTile
              key={book.id}
              href={bookHash(book)}
              onClick={onNavigate}
              active={open}
              color={book.color}
              title={`${book.title} — ${done} of ${book.units} units done`}
              meta={`${done}/${book.units}`}
              childrenRow={true}
            >
              <BookMark color={book.color} />
              <NavLabel wrap>{book.title}</NavLabel>
            </NavTile>
          );
        })}
        {bookStats}
        {bookUnits}
      </div>
    </>
  );
}

/** A book's mark: its cover colour as a small square, its own on every tile. */
function BookMark({ color }: { color: string }) {
  return <span className="navdot" style={{ "--color": color } as CSSProperties} aria-hidden />;
}

/** The short name a tile carries under its icon; the long one is the tooltip.
 *  `meta` rides on the same line as the name — a count beside "Cards" reads as
 *  one thing, where under it looks like a second row of the tile. */
function NavLabel({
  children,
  wrap,
  meta,
}: {
  children: ReactNode;
  wrap?: boolean;
  meta?: ReactNode;
}) {
  return (
    <span className={"navtoollabel" + (wrap ? " wrap" : "") + (meta !== undefined ? " counted" : "")}>
      {children}
      {meta !== undefined && <span className="navmeta">{meta}</span>}
    </span>
  );
}

/** The crumb every non-book view shows: the app's name, then the section. */
export function AppCrumb({ section }: { section: string }): JSX.Element {
  return (
    <>
      <a className="topbar-lib" href={LIBRARY_HASH} title="All books">
        <span>Murrnglish</span>
      </a>
      <span className="topbar-crumbsep" aria-hidden>
        /
      </span>
      <h1 className="sectiontitle">{section}</h1>
    </>
  );
}
