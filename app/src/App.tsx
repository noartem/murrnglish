// App: hash-routed split-pane course UI.
// Routes: #u<N> = unit N, #a<N> = additional exercise N.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdditionalData, IndexData, UnitData } from "./data";
import { fetchAdditional, fetchIndex, fetchUnit } from "./data";
import { PageViewer } from "./components/PageViewer";
import { ExerciseCard } from "./components/ExerciseCard";
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

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [index, setIndex] = useState<IndexData | null>(null);
  const [unit, setUnit] = useState<UnitData | null>(null);
  const [additional, setAdditional] = useState<AdditionalData | null>(null);
  const [error, setError] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [progress, setProgressState] = useState<Progress>(emptyProgress);

  useEffect(() => {
    setProgressState(loadProgress());
    fetchIndex().then(setIndex).catch((e) => setError(String(e)));
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

  const exerciseIds = unit ? unit.exercises.map((e) => e.id) : [];
  const isUnitDone =
    route.kind === "unit" && unit ? unitCompleted(progress, exerciseIds) : false;

  return (
    <div className="app">
      <header className="topbar">
        <button className="sidebartoggle" onClick={() => setSidebarOpen((s) => !s)}>
          ☰
        </button>
        <h1>English Grammar in Use — Web Course</h1>
        <span className="progressline">
          Units completed{" "}
          <strong>{doneUnits.size}/145</strong>{" "}
          · Answers correct {counts.correct}/{counts.total}
        </span>
        {isUnitDone && <span className="donetag">✓ Unit {route.kind === "unit" ? route.n : ""} done</span>}
      </header>
      <div className="main">
        {sidebarOpen && index && (
          <nav className="sidebar">
            {index.groups.map((g) => (
              <div key={g.name} className="group">
                <div className="groupname">{g.name}</div>
                <div className="unitlinks">
                  {g.units.map((u) => (
                    <button
                      key={u}
                      className={
                        "unitlink" + (route.kind === "unit" && route.n === u ? " active" : "") +
                        (doneUnits.has(u) ? " done" : "")
                      }
                      onClick={() => navUnit(u)}
                    >
                      {u}
                      {doneUnits.has(u) && <span className="donemark">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="group">
              <div className="groupname">{index.additional.title}</div>
              <div className="unitlinks">
                {index.additional.exercises.map((n) => (
                  <button
                    key={n}
                    className={
                      "unitlink" + (route.kind === "additional" && route.n === n ? " active" : "")
                    }
                    onClick={() => navAdditional(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </nav>
        )}
        <div className="split">
          <div className="leftpane">
            {unit && <PageViewer pdfPages={unit.pdfPages} label={`Unit ${unit.unit}: ${unit.title}`} />}
            {additional && (
              <PageViewer
                pdfPages={additional.pdfPages}
                label={`Additional exercise ${additional.id}: ${additional.topic}`}
              />
            )}
          </div>
          <div className="rightpane">
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
          </div>
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
