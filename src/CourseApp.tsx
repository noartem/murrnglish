// CourseApp: one book's course UI — its landing, units and additional
// exercises (routes.ts: #/<book>, #/<book>/u<N>, #/<book>/a<N>). A unit is one
// column: its lesson (the app's own, components/Lesson.tsx), then its
// exercises, with a bar of jumps between them that stays at the top.
// App mounts it keyed by the book, so switching books starts from a clean
// slate; within a book the page arrives as a prop from the hash.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Book } from "./books";
import { BookContext, useBook } from "./bookContext";
import type { AdditionalData, IndexData, TotalsMap, UnitData } from "./data";
import {
  fetchAdditional,
  fetchIndexOnce,
  fetchTotalsOnce,
  fetchUnit,
} from "./data";
import { LessonBody, LessonSoon, PracticeDivider, UnitHead, labelsFor } from "./components/Lesson";
import { ExerciseCard } from "./components/ExerciseCard";
import { openIncoming } from "./globalUi";
import { AppShell, revealInPanel } from "./components/AppShell";
import { useKeyScope } from "./keyScopes";
import { SC, focusFirstExercise } from "./shortcuts";
import { ArrowLeft, ArrowRight, BookOpenText, Check } from "lucide-react";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import {
  completedUnitIds,
  continueTarget,
  loadProgress,
  pct,
  saveLastRoute,
  scopeStats,
  subscribeProgress,
  unitCompleted,
} from "./progress";
import type { Progress } from "./progress";
import { OfflinePanel } from "./components/OfflinePanel";
import { OfflineButton } from "./components/OfflineButton";
import {
  autoDownloadAllowed,
  downloadBook,
  downloadState,
  isDownloaded,
  isStandalone,
} from "./offline";
import { Home } from "./components/Home";
import { Battery } from "./components/Battery";
import { decodeShare } from "./share";
import type { BookPage, ContentPage } from "./routes";
import {
  LIBRARY_HASH,
  bookHash,
  pageKey,
  parsePage,
  replaceHash,
} from "./routes";
import { PickWord } from "./components/PickWord";

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
  const [totals, setTotals] = useState<TotalsMap | null>(null);
  const [progress, setProgressState] = useState<Progress>(() => loadProgress(book.id));
  // the offline download window: its button exists only in the installed app
  const [offlineOpen, setOfflineOpen] = useState(false);
  // computed once — an install relaunches the app in standalone, so this
  // cannot change under a live session
  const [standalone] = useState(isStandalone);
  // transient topbar notice, auto-clears
  const [notice, setNotice] = useState("");

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
  const paneRef = useRef<OverlayScrollbarsComponentRef>(null);

  useEffect(() => {
    fetchIndexOnce(book)
      .then(setIndex)
      .catch((e) => setError(String(e)));
    fetchTotalsOnce(book)
      .then(setTotals)
      .catch(() => setTotals(null));
  }, [book]);
  // remember the last content page for the "/" entry redirect
  useEffect(() => {
    if (route.kind !== "home") saveLastRoute(book.id, pageKey(route));
  }, [book, route]);

  // "#/<book>/p=..." share links: decode and hand the INCOMING progress to
  // the data window, which previews it for this book and applies it only on
  // confirm; the hash is rewritten to the book's landing (no history entry,
  // so Back never replays the link)
  useEffect(() => {
    if (!share) return;
    let alive = true;
    void decodeShare(share).then((p) => {
      if (!alive) return;
      if (p) openIncoming({ kind: "progress", progress: p, book: book.id });
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
  // What index.json already knows about the route, available as soon as the
  // index lands: the heading text, so a route paints its real title before
  // the exercise JSON arrives.
  const routeInfo = routeKey ? index?.exercises?.[routeKey] : undefined;

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
    const vp = paneRef.current?.osInstance()?.elements().viewport;
    if (vp) vp.scrollTop = 0;
  }, [route]);
  // a fresh page with nothing to read first puts the caret into the first
  // exercise input so keyboard work starts immediately; fires when the data
  // lands, which covers every way of opening a page (hash, sidebar link,
  // bottom pager buttons). A unit with a lesson opens on the lesson instead:
  // Shift+S (or the jump bar) goes down to the exercises.
  useEffect(() => {
    if (!unit && !additional) return;
    if (unit?.lesson) return;
    // the pane instance/inputs may not exist yet on the very first load —
    // retry across a few frames so focus always lands on the exercise
    let raf = 0;
    let tries = 0;
    const focusFirst = () => {
      const vp = paneRef.current?.osInstance()?.elements().viewport;
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
  // it is re-asserted on every (re)initialization too. The panel itself
  // belongs to the shell; it is only asked to scroll.
  const activeRef = useRef<HTMLButtonElement>(null);
  const revealActiveUnit = useCallback((): boolean => revealInPanel(activeRef.current), []);
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
  }, [revealActiveUnit, route, index]);

  const setProgress = useCallback((fn: (p: Progress) => Progress) => {
    setProgressState((p) => fn(p));
  }, []);

  // a write from the data window's import lands in this book's key too:
  // re-read it so the open course shows the applied progress
  useEffect(
    () =>
      subscribeProgress((bookId) => {
        if (bookId === book.id) setProgressState(loadProgress(book.id));
      }),
    [book.id],
  );

  const doneUnits = useMemo(() => completedUnitIds(progress), [progress]);

  // the landing CTA: resume after the last unit worked on (progress.ts)
  const homeContinue = useMemo(() => continueTarget(progress, book), [progress, book]);

  // ---- navigation -------------------------------------------------------------
  function navUnit(n: number) {
    window.location.hash = bookHash(book, { kind: "unit", n });
  }

  function navAdditional(n: number) {
    window.location.hash = bookHash(book, { kind: "additional", n });
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

  // one resolver for every "go to course position" path (bottom pager
  // buttons + Shift+N / Shift+P shortcuts)
  const goTarget = (t: NavTarget | null) => {
    if (!t) return;
    if (t.kind === "unit") navUnit(t.n);
    else navAdditional(t.n);
  };

  // this book's own keys. The panel's own (Alt+Shift+E, Shift+E, its arrows,
  // Esc) belong to the shell, the app-wide ones (help, the data window, the
  // section jumps) and the exercise scope to the dispatcher, above this.
  useKeyScope("course", (e) => {
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      switch (e.code) {
        case "KeyS": {
          e.preventDefault();
          const vp = paneRef.current?.osInstance()?.elements().viewport;
          const practice = document.getElementById(PRACTICE_ID);
          if (!vp || !practice) {
            focusFirstExercise();
            return true;
          }
          // still reading the lesson while the divider is in the lower half
          const above =
            practice.getBoundingClientRect().top - vp.getBoundingClientRect().top;
          if (above > vp.clientHeight / 2) {
            scrollPane(vp, practice);
            focusFirstExercise();
          } else {
            vp.scrollTo({ top: 0, behavior: scrollBehavior() });
            document.getElementById(LESSON_ID)?.focus({ preventScroll: true });
          }
          return true;
        }
        case "KeyN":
          e.preventDefault();
          goTarget(pager?.next ?? null);
          return true;
        case "KeyP":
          e.preventDefault();
          goTarget(pager?.prev ?? null);
          return true;
      }
    }
    return false;
  });
  const isHome = route.kind === "home";
  // the open book's own progress, in the navigation panel under the books:
  // the topbar holds the title alone
  const stats = (
    <div className="bookstats">
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
    </div>
  );

  // the book's own units, handed to the shell's sidebar under the book in
  // the map: this is the only view with any
  const bookUnits = index ? (
    <>
      {index.groups.map((g) => {
        const gpct = pct(scopeStats(totals, g.units.map((u) => `u${u}`), progress));
        return (
          <div key={g.name} className="group">
            <div className="groupname">
              <span>{g.name}</span>
              {totals && gpct > 0 && (
                <span className={"grouppct" + (gpct === 100 ? " full" : "")}>{gpct}%</span>
              )}
            </div>
            <div className="unitlinks">
              {g.units.map((u) => {
                const upct = pct(scopeStats(totals, [`u${u}`], progress));
                return (
                  <button
                    key={u}
                    ref={route.kind === "unit" && route.n === u ? activeRef : undefined}
                    className={
                      "unitlink" +
                      (route.kind === "unit" && route.n === u ? " active" : "") +
                      (doneUnits.has(u) ? " done" : "")
                    }
                    onClick={() => navUnit(u)}
                  >
                    {u}
                    {doneUnits.has(u) && (
                      <span className="donemark">
                        <Check size={11} strokeWidth={3} aria-hidden />
                      </span>
                    )}
                    {totals && upct > 0 && (
                      <span className={"unitpct" + (upct === 100 ? " full" : "")}>{upct}%</span>
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
                scopeStats(totals, index.additional.exercises.map((n) => `a${n}`), progress),
              );
              return apct > 0 ? (
                <span className={"grouppct" + (apct === 100 ? " full" : "")}>{apct}%</span>
              ) : null;
            })()}
        </div>
        <div className="unitlinks">
          {index.additional.exercises.map((n) => {
            const apct = pct(scopeStats(totals, [`a${n}`], progress));
            return (
              <button
                key={n}
                ref={route.kind === "additional" && route.n === n ? activeRef : undefined}
                className={
                  "unitlink" + (route.kind === "additional" && route.n === n ? " active" : "")
                }
                onClick={() => navAdditional(n)}
              >
                {n}
                {totals && apct > 0 && (
                  <span className={"unitpct" + (apct === 100 ? " full" : "")}>{apct}%</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  ) : null;

  return (
    <BookContext.Provider value={book}>
    <AppShell
      head={
        <>
          {/* the way back to every book; phones reach it from the drawer */}
          <a className="topbar-lib" href={LIBRARY_HASH} title="All books">
            <span>Murrnglish</span>
          </a>
          <span className="topbar-crumbsep" aria-hidden>
            /
          </span>
          <button type="button" className="topbar-home" onClick={isHome ? undefined : goHome} disabled={isHome}>
            <h1>{book.title}</h1>
          </button>
          {notice && (
            <span className="progressline" role="status">
              {notice}
            </span>
          )}
        </>
      }
      navActions={standalone ? <OfflineButton bookId={book.id} onOpen={() => setOfflineOpen(true)} /> : undefined}
      topbarActions={
        standalone ? (
          <OfflineButton bookId={book.id} onOpen={() => setOfflineOpen(true)} variant="bar" />
        ) : undefined
      }
      bookStats={stats}
      bookUnits={bookUnits}
      sidebarEvents={sidebarEvents}
    >
        {isHome ? (
          <Home book={book} onStart={startCourse} continueTo={homeContinue} />
        ) : (
          <OverlayScrollbarsComponent
            ref={paneRef}
            className="coursepane"
            options={{
              overflow: { x: "hidden" as const },
              scrollbars: {
                theme: "os-theme-dark",
                autoHide: "leave" as const,
                autoHideDelay: 500,
              },
            }}
          >
            <div className="coursecol">
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
                  <UnitJumps
                    lesson={!!unit.lesson}
                    exercises={exerciseIds}
                    paneRef={paneRef}
                  />
                  <div id={LESSON_ID} tabIndex={-1} className="lessonanchor">
                    <UnitHead
                      n={unit.unit}
                      title={unit.title}
                      lesson={unit.lesson}
                      done={
                        isUnitDone && (
                          <span className="donetag">
                            <Check size={13} aria-hidden /> done
                          </span>
                        )
                      }
                    />
                  </div>
                  {unit.lesson ? <LessonBody lesson={unit.lesson} /> : <LessonSoon />}
                  <PracticeDivider id={PRACTICE_ID} />
                  <p className="pickhint">Select a word to add it to your dictionary</p>
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
                  </h2>
                  {additional.refs && <AdditionalRefs book={book} refs={additional.refs} />}
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
            </div>
            <PickWord
              scope=".coursepane"
              source={{ book: book.id, ...(route.kind === "unit" ? { unit: route.n } : {}) }}
            />
          </OverlayScrollbarsComponent>
        )}
      <OfflinePanel
        open={offlineOpen}
        onClose={() => setOfflineOpen(false)}
        currentBookId={book.id}
      />
    </AppShell>
    </BookContext.Provider>
  );
}

const LESSON_ID = "lesson";
const PRACTICE_ID = "practice";
/** the id ExerciseCard gives an exercise's card */
const exAnchor = (id: string) => `ex-${id}`;
/** room left above a jump target: the jump bar that stays at the top */
const JUMP_OFFSET = 56;

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/** Scroll the pane so `el` sits just under the jump bar. */
function scrollPane(vp: HTMLElement, el: HTMLElement) {
  const top = el.getBoundingClientRect().top - vp.getBoundingClientRect().top + vp.scrollTop - JUMP_OFFSET;
  vp.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior() });
}

/**
 * The bar at the top of a unit: the lesson, then one chip per exercise. The
 * part in view is marked as the pane scrolls, so the bar is a map of the
 * page and the way back up to the lesson from anywhere in the exercises.
 */
function UnitJumps({
  lesson,
  exercises,
  paneRef,
}: {
  lesson: boolean;
  exercises: string[];
  paneRef: RefObject<OverlayScrollbarsComponentRef>;
}) {
  const pane = useCallback(() => paneRef.current?.osInstance()?.elements().viewport, [paneRef]);
  const L = labelsFor(useBook());
  const [at, setAt] = useState<string>(LESSON_ID);
  const targets = useMemo(() => [LESSON_ID, ...exercises.map(exAnchor)], [exercises]);
  useEffect(() => {
    // any scroll in the page: the pane's viewport is created after this mounts
    const onScroll = () => {
      const vp = pane();
      if (!vp) return;
      const line = vp.getBoundingClientRect().top + JUMP_OFFSET + 40;
      let cur = LESSON_ID;
      for (const id of targets) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) cur = id;
      }
      // the lesson is over once the practice divider is up
      const practice = document.getElementById(PRACTICE_ID);
      if (cur === LESSON_ID && practice && practice.getBoundingClientRect().top <= line)
        cur = targets[1] ?? LESSON_ID;
      setAt(cur);
    };
    document.addEventListener("scroll", onScroll, true);
    onScroll();
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [targets, pane]);
  const go = (id: string) => {
    const vp = pane();
    const el = document.getElementById(id);
    if (!vp || !el) return;
    if (id === LESSON_ID) vp.scrollTo({ top: 0, behavior: scrollBehavior() });
    else scrollPane(vp, el);
  };
  return (
    <nav className="unitjumps" aria-label="In this unit">
      <button
        type="button"
        className={"jumpchip lessonchip" + (at === LESSON_ID ? " on" : "")}
        onClick={() => go(LESSON_ID)}
      >
        <BookOpenText size={14} aria-hidden /> {lesson ? L.lesson : L.unit}
      </button>
      <span className="jumpsep" aria-hidden />
      {exercises.map((id) => (
        <button
          key={id}
          type="button"
          className={"jumpchip" + (at === exAnchor(id) ? " on" : "")}
          onClick={() => go(exAnchor(id))}
        >
          {id}
        </button>
      ))}
    </nav>
  );
}

/** "Units 1–5, 12" under an additional exercise: links to those units. */
function AdditionalRefs({ book, refs }: { book: Book; refs: string }) {
  // the refs are free text; every number in them that is a unit becomes a link
  const parts = refs.split(/(\d+)/);
  return (
    <p className="refs addrefs">
      {parts.map((part, i) => {
        const page = /^\d+$/.test(part) ? parsePage(book, `u${part}`) : null;
        return page && page.kind === "unit" && page.n === Number(part) ? (
          <a key={i} href={bookHash(book, page)}>
            {part}
          </a>
        ) : (
          part
        );
      })}
    </p>
  );
}

interface NavTarget {
  kind: "unit" | "additional";
  n: number;
  label: string;
  desc: string;
}

// Placeholder shown from navigation until the unit JSON lands. The heading is
// REAL from the first frame — index.json carries every title, so there is no
// reason to skeleton that text. Only the card shape is guessed: instruction
// and numbered rows at the sizes the loaded card renders at. Deliberately
// static (no shimmer): the shape already says "loading". Row counts are
// illustrative — the real ones are not known until the JSON is parsed.
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
  return (
    <div className="unitloading" role="status" aria-label="Loading">
      {kind === "unit" ? (
        <UnitHead n={n} title={title} />
      ) : (
        <h2 className="unitheading skel-heading">
          {title ? `Additional exercise ${n} — ${title}` : `Additional exercise ${n}`}
        </h2>
      )}
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
