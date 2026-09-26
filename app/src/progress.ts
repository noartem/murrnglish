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
