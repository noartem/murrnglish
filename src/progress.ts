// Progress persistence in localStorage, one entry per book (keys.ts).
// Shape (per work/PARSING-SPEC.md / plan):
//   answers[id] per type:
//     fill-in    -> { items: { [num]: string[] } }
//     choice     -> { items: { [num]: number } }
//     matching   -> { pairs: (number|null)[] }
//     write      -> { items: { [num]: string } }
//     self-check -> { items: { [num]: string } }
//   results[id] -> { correct: number, total: number }
//   selfMarks[id] -> { [num]: boolean }
import type { Book } from "./books";
import type { TotalsMap } from "./data";
import { LAST_BOOK_KEY, lastRouteKey, progressKey } from "./keys";

export interface ResultEntry {
  correct: number;
  total: number;
}

export interface Progress {
  answers: Record<string, Record<string, unknown>>;
  results: Record<string, ResultEntry>;
  selfMarks: Record<string, Record<string, boolean>>;
}

export interface ProgressCounts {
  correct: number;
  total: number;
}

// pending debounced write per book: one shared timer would let the next
// book's save cancel the previous book's last write
const saveTimers = new Map<string, number>();

export function emptyProgress(): Progress {
  return { answers: {}, results: {}, selfMarks: {} };
}

export function loadProgress(bookId: string): Progress {
  try {
    const raw = localStorage.getItem(progressKey(bookId));
    if (!raw) return emptyProgress();
    const p = JSON.parse(raw) as Progress;
    return {
      answers: p.answers ?? {},
      results: p.results ?? {},
      selfMarks: p.selfMarks ?? {},
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(bookId: string, p: Progress, debounceMs = 300): void {
  window.clearTimeout(saveTimers.get(bookId));
  saveTimers.set(
    bookId,
    window.setTimeout(() => {
      saveTimers.delete(bookId);
      try {
        localStorage.setItem(progressKey(bookId), JSON.stringify(p));
      } catch {
        // storage full/unavailable: progress silently not persisted
      }
    }, debounceMs),
  );
}

/** Anything worked on: a checked exercise or a self-check mark. */
export function hasProgress(p: Progress): boolean {
  return Object.keys(p.results).length > 0 || Object.keys(p.selfMarks).length > 0;
}

export function unitCompleted(progress: Progress, exerciseIds: string[]): boolean {
  return exerciseIds.length > 0 && exerciseIds.every((id) => progress.results[id]);
}

export function countCorrect(progress: Progress): ProgressCounts {
  let correct = 0;
  let total = 0;
  for (const r of Object.values(progress.results)) {
    correct += r.correct;
    total += r.total;
  }
  return { correct, total };
}

// Last opened content page of a book ("u13"/"a41") and the book itself, used
// by the "/" entry redirect.
export function loadLastRoute(bookId: string): string | null {
  try {
    const raw = localStorage.getItem(lastRouteKey(bookId));
    return raw !== null && /^(u|a)\d+$/.test(raw) ? raw : null;
  } catch {
    return null; // storage unavailable: entry falls back to progress
  }
}

export function saveLastRoute(bookId: string, route: string): void {
  try {
    localStorage.setItem(lastRouteKey(bookId), route);
    localStorage.setItem(LAST_BOOK_KEY, bookId);
  } catch {
    // storage unavailable: redirect falls back to progress-derived unit
  }
}

export function loadLastBook(): string | null {
  try {
    return localStorage.getItem(LAST_BOOK_KEY);
  } catch {
    return null;
  }
}

// Fallback for progress saved before last-route tracking existed: the unit
// of the most recently answered exercise (results keys keep insertion
// order; additional exercises use bare ids, so only units match).
export function lastUnitFromProgress(p: Progress): string | null {
  const keys = Object.keys(p.results);
  for (let i = keys.length - 1; i >= 0; i--) {
    const m = keys[i].match(/^(\d+)\./);
    if (m) return `u${m[1]}`;
  }
  return null;
}

// A unit is done when its results entries N.1..N.k are present and
// consecutive (item results exist only for checked exercises).
export function completedUnitIds(progress: Progress): Set<number> {
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

/** Where a learner with saved progress should resume; null = fresh start. */
export interface ContinueTarget {
  /** the page key: "u12" / "a3" */
  page: string;
  label: string;
}

// Learners with saved progress continue with the unit AFTER the last one
// where they did at least one exercise (a result or a self-check mark); once
// that would be past the book's last unit, the first additional exercise
// without results. Fresh learners get null: plain "Start with Unit 1".
export function continueTarget(progress: Progress, book: Book): ContinueTarget | null {
  if (!hasProgress(progress)) return null;
  let lastTouched = 0;
  for (const keys of [progress.results, progress.selfMarks]) {
    for (const id of Object.keys(keys)) {
      const m = id.match(/^(\d+)\./);
      if (m) lastTouched = Math.max(lastTouched, Number(m[1]));
    }
  }
  if (lastTouched < book.units) {
    return { page: `u${lastTouched + 1}`, label: `Continue with Unit ${lastTouched + 1}` };
  }
  const nextAdditional = Array.from({ length: book.additional }, (_, i) => i + 1).find(
    (n) => !unitCompleted(progress, [String(n)]),
  );
  if (nextAdditional) {
    return {
      page: `a${nextAdditional}`,
      label: `Continue with Additional exercise ${nextAdditional}`,
    };
  }
  return null;
}

// ---- import / export / share helpers ---------------------------------------

// A complete localStorage-dump shape: all three maps present (a dump always
// has them), results entries numeric. answers/selfMarks contents stay
// unchecked — same leniency as loadProgress().
export function validateProgress(x: unknown): Progress | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  for (const k of ["answers", "results", "selfMarks"] as const) {
    const v = o[k];
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  }
  for (const v of Object.values(o.results as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const e = v as Record<string, unknown>;
    if (typeof e.correct !== "number" || !Number.isFinite(e.correct)) return null;
    if (typeof e.total !== "number" || !Number.isFinite(e.total)) return null;
  }
  return x as Progress;
}

export function parseProgressText(text: string): Progress | null {
  try {
    return validateProgress(JSON.parse(text));
  } catch {
    return null;
  }
}

// Wire payload: with answers excluded only the facts of completion travel —
// every percent/done indicator keeps working off results+selfMarks.
export function progressPayload(p: Progress, includeAnswers: boolean): Progress {
  return includeAnswers ? p : { answers: {}, results: p.results, selfMarks: p.selfMarks };
}

export function scopeStats(
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

export function pct(s: { correct: number; total: number }): number {
  return s.total ? Math.min(100, Math.round((s.correct / s.total) * 100)) : 0;
}
