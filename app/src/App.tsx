// App: hash-routed split-pane course UI.
// Routes: #u<N> = unit N, #a<N> = additional exercise N.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdditionalData, IndexData, TotalsMap, UnitData } from "./data";
import { fetchAdditional, fetchIndex, fetchTotals, fetchUnit } from "./data";
import { PageViewer } from "./components/PageViewer";
import { ThemeToggle } from "./components/ThemeToggle";
import { ExerciseCard } from "./components/ExerciseCard";
import { ArrowLeft, ArrowRight, Check, Menu } from "lucide-react";
import {
  OverlayScrollbarsComponent,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import {
  countCorrect,
  emptyProgress,
  loadProgress,
  unitCompleted,
} from "./progress";
import type { Progress } from "./progress";

type Route = { kind: "unit"; n: number } | { kind: "additional"; n: number };

function parseHash(): Route {
  const h = window.location.hash.replace(/^#/, "");
  const mu = h.match(/^u(\d+)$/);
  if (mu) return { kind: "unit", n: Math.min(145, Math.max(1, Number(mu[1]))) };
  const ma = h.match(/^a(\d+)$/);
  if (ma) return { kind: "additional", n: Math.min(41, Math.max(1, Number(ma[1]))) };
  return { kind: "unit", n: 1 };
}
function scopeStats(
  totals: TotalsMap | null,
  keys: string[],
  progress: Progress,
): { correct: number; total: number } {
  if (!totals) return { correct: 0, total: 0 };
  let correct = 0;
  let total = 0;
  for (const k of keys) {
    const t = totals[k];
    if (!t) continue;
    total += t.total;
    for (const [id, n] of Object.entries(t.exercises))
      if (n > 0) correct += Math.min(progress.results[id]?.correct ?? 0, n); // cap stale saved results
  }
  return { correct, total };
}

function pct(s: { correct: number; total: number }): number {
  return s.total ? Math.min(100, Math.round((s.correct / s.total) * 100)) : 0;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [index, setIndex] = useState<IndexData | null>(null);
  const [unit, setUnit] = useState<UnitData | null>(null);
  const [additional, setAdditional] = useState<AdditionalData | null>(null);
  const [error, setError] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("egu-course-sidebar-collapsed") !== "1",
  );
  const [totals, setTotals] = useState<TotalsMap | null>(null);
  const [progress, setProgressState] = useState<Progress>(emptyProgress);
  const rightpaneRef = useRef<OverlayScrollbarsComponentRef>(null);
  // sidebar collapse representation: in-flow while animating, fixed hover
  // card once fully collapsed (settled); toggling runs the width animation
  const [cardPhase, setCardPhase] = useState(() => localStorage.getItem("egu-course-sidebar-collapsed") === "1");
  const [transient, setTransient] = useState(false);
  const animTimers = useRef<number[]>([]);
  const clearAnimTimers = () => {
    for (const t of animTimers.current) window.clearTimeout(t);
    animTimers.current = [];
  };
  const toggleSidebar = () => {
    clearAnimTimers();
    const next = !sidebarOpen;
    setSidebarOpen(next);
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
    setProgressState(loadProgress());
    fetchIndex().then(setIndex).catch((e) => setError(String(e)));
    fetchTotals().then(setTotals).catch(() => setTotals(null));
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setUnit(null);
    setAdditional(null);
    setError("");
    if (route.kind === "unit") {
      fetchUnit(route.n)
        .then(setUnit)
        .catch((e) => setError(String(e)));
    } else {
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

  // a fresh page puts the caret into the first exercise input so keyboard
  // work starts immediately; fires when the data lands, which covers every
  // way of opening a page (hash, sidebar link, bottom pager buttons)
  useEffect(() => {
    if (!unit && !additional) return;
    const vp = rightpaneRef.current?.osInstance()?.elements().viewport;
    const first = vp?.querySelector<HTMLElement>(
      ".exercise textarea, .exercise input, .exercise select, .exercise button",
    );
    first?.focus({ preventScroll: true });
  }, [unit, additional]);

  // keep the active unit button in the visible part of the sidebar
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = activeRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
  }, [route, sidebarOpen, index]);

  const setProgress = useCallback((fn: (p: Progress) => Progress) => {
    setProgressState((p) => fn(p));
  }, []);

  const doneUnits = useMemo(() => completedUnitIds(progress), [progress]);
  const counts = useMemo(() => countCorrect(progress), [progress]);

  function navUnit(n: number) {
    window.location.hash = `u${n}`;
  }

  function navAdditional(n: number) {
    window.location.hash = `a${n}`;
  }
  // course order for the bottom pager: units 1..145, then additional 1..41
  const course = useMemo<Route[]>(() => {
    if (!index) return [];
    const list: Route[] = [];
    for (const g of index.groups) for (const u of g.units) list.push({ kind: "unit", n: u });
    for (const n of index.additional.exercises) list.push({ kind: "additional", n });
    return list;
  }, [index]);
  const pager = useMemo(() => {
    const pos = course.findIndex((r) => r.kind === route.kind && r.n === route.n);
    const at = (r?: Route): NavTarget | null => {
      if (!r) return null;
      return {
        kind: r.kind,
        n: r.n,
        label: r.kind === "unit" ? `Unit ${r.n}` : `Additional exercise ${r.n}`,
        desc: index?.titles?.[r.kind === "unit" ? `u${r.n}` : `a${r.n}`] ?? "",
      };
    };
    return { prev: at(course[pos - 1]), next: at(course[pos + 1]) };
  }, [course, index, route]);

  const exerciseIds = unit ? unit.exercises.map((e) => e.id) : [];
  const isUnitDone =
    route.kind === "unit" && unit ? unitCompleted(progress, exerciseIds) : false;
  const ov = scopeStats(totals, totals ? Object.keys(totals) : [], progress);

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="sidebartoggle"
          onClick={toggleSidebar}
        >
          <Menu size={16} aria-hidden />
        </button>
        <div className="topbar-mid">
          <h1>English Grammar in Use</h1>
          <span className="progressline">
            Units completed <strong>{doneUnits.size}/145</strong> ·{" "}
            {totals ? (
              <>
                Answers correct {ov.correct}/{ov.total}
                {pct(ov) > 0 ? <> · {pct(ov)}%</> : null}
              </>
            ) : (
              <>Answers correct {counts.correct}/{counts.total}</>
            )}
          </span>
          {isUnitDone && (
            <span className="donetag"><Check size={13} aria-hidden /> Unit {route.kind === "unit" ? route.n : ""} done</span>
          )}
        </div>
        <ThemeToggle />
      </header>
      <div className="main">
        {!sidebarOpen && <div className="sidebar-edge" aria-hidden />}
        {index && (() => {
          const sideCls = sidebarOpen
            ? transient ? "sidebar opening" : "sidebar"
            : cardPhase ? "sidebar collapsed" : "sidebar closing";
          const osOptions = {
            overflow: { x: "hidden" as const },
            scrollbars: {
              theme: "os-theme-dark",
              autoHide: "leave" as const,
              autoHideDelay: 500,
            },
          };
          return (
            <OverlayScrollbarsComponent element="nav" className={sideCls} options={osOptions}>
            <div className="sidebar-inner">
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
                            ref={
                              route.kind === "unit" && route.n === u ? activeRef : undefined
                            }
                            className={
                              "unitlink" + (route.kind === "unit" && route.n === u ? " active" : "") +
                              (doneUnits.has(u) ? " done" : "")
                            }
                            onClick={() => navUnit(u)}
                          >
                            {u}
                            {doneUnits.has(u) && <span className="donemark"><Check size={11} strokeWidth={3} aria-hidden /></span>}
                            {totals && upct > 0 && (
                              <span className={"unitpct" + (upct === 100 ? " full" : "")}>
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
                      const apct = pct(scopeStats(
                        totals,
                        index.additional.exercises.map((n) => `a${n}`),
                        progress,
                      ));
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
                        ref={
                          route.kind === "additional" && route.n === n ? activeRef : undefined
                        }
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
            </div>
            </OverlayScrollbarsComponent>
          );
        })()}
          <div className="split">
            <div className="leftpane">
            {unit && <PageViewer pdfPages={unit.pdfPages} />}
            {additional && (
              <PageViewer pdfPages={additional.pdfPages} />
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
            {unit && (
              <>
                <h2 className="unitheading">
                  Unit {unit.unit} — {unit.title}
                </h2>
                {unit.exercises.map((ex) => (
                  <ExerciseCard key={ex.id} exercise={ex} progress={progress} setProgress={setProgress} />
                ))}
              </>
            )}
            {additional && (
              <>
                <h2 className="unitheading">
                  Additional exercise {additional.id} — {additional.topic}
                  {additional.refs && <span className="refs"> ({additional.refs})</span>}
                </h2>
                <ExerciseCard exercise={additional.exercise} progress={progress} setProgress={setProgress} />
              </>
            )}
            {(pager.prev || pager.next) && (
              <UnitNav prev={pager.prev} next={pager.next} onGo={(t) => (t.kind === "unit" ? navUnit(t.n) : navAdditional(t.n))} />
            )}
          </OverlayScrollbarsComponent>
        </div>
      </div>
    </div>
  );
}

function completedUnitIds(progress: Progress): Set<number> {
  // A unit is done when its results entries N.1..N.k are present and
  // consecutive (item results exist only for checked exercises).
  const byUnit = new Map<number, Set<string>>();
  for (const id of Object.keys(progress.results)) {
    const m = id.match(/^(\d+)\./);
    if (!m) continue;
    const u = Number(m[1]);
    const set = byUnit.get(u) ?? new Set<string>();
    set.add(id);
    byUnit.set(u, set);
  }
  const done = new Set<number>();
  for (const [u, ids] of byUnit) {
    let k = 1;
    while (ids.has(`${u}.${k}`)) k++;
    k -= 1;
    if (k >= 1 && ids.size === k) done.add(u);
  }
  return done;
}

interface NavTarget {
  kind: "unit" | "additional";
  n: number;
  label: string;
  desc: string;
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
      <button type="button" className={`unitnavbtn ${side}`} onClick={() => onGo(t)}>
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
