// Progress persistence in localStorage, key egu-course-progress-v1.
// Shape (per work/PARSING-SPEC.md / plan):
//   answers[id] per type:
//     fill-in    -> { items: { [num]: string[] } }
//     choice     -> { items: { [num]: number } }
//     matching   -> { pairs: (number|null)[] }
//     write      -> { items: { [num]: string } }
//     self-check -> { items: { [num]: string } }
//   results[id] -> { correct: number, total: number }
//   selfMarks[id] -> { [num]: boolean }

const KEY = "egu-course-progress-v1";

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

let saveTimer: number | undefined;

export function emptyProgress(): Progress {
  return { answers: {}, results: {}, selfMarks: {} };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
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

export function saveProgress(p: Progress, debounceMs = 300): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      // storage full/unavailable: progress silently not persisted
    }
  }, debounceMs);
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

// Last opened content page ("u13"/"a41"), used by the "/" entry redirect.
const LAST_KEY = "egu-course-last-route-v1";

export function loadLastRoute(): string | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw !== null && /^(u|a)\d+$/.test(raw) ? raw : null;
  } catch {
    return null; // storage unavailable: entry falls back to progress
  }
}

export function saveLastRoute(route: string): void {
  try {
    localStorage.setItem(LAST_KEY, route);
  } catch {
    // storage unavailable: redirect falls back to progress-derived unit
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
