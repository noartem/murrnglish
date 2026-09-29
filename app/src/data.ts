// Data layer: types mirroring work/PARSING-SPEC.md schemas + fetch helpers.

/** URL prefix for static assets: "/" locally, "/<repo>/" on GitHub Pages. */
const BASE = import.meta.env.BASE_URL;

/** data-relative path of every exercise in one file (scripts/sync_data.mjs) */
export const COURSE_BUNDLE = "data/course.json";

export type ExerciseType = "fill-in" | "choice" | "matching" | "write" | "self-check";

export interface FillInItem {
  num: number;
  parts: string[];
  answers: string[][];
  /** pre-solved in the printed book; rendered as plain text, excluded from grading */
  example?: boolean;
}
export interface ChoiceItem {
  num: number | string;
  options: string[];
  answer: number | number[];
  /** pre-solved in the printed book; rendered as static text, excluded from grading */
  example?: boolean;
}
export interface WriteItem {
  num: number | string;
  prompt: string;
  answers: string[];
  /** pre-solved in the printed book or key-less; rendered as static text, excluded from grading */
  example?: boolean;
}
export interface SelfCheckItem {
  num: number;
  prompt: string;
  modelAnswers: string[];
}

export type Item = FillInItem | ChoiceItem | WriteItem | SelfCheckItem;

export interface Exercise {
  id: string;
  type: ExerciseType;
  instruction: string;
  wordBank?: string[];
  items?: Item[];
  leftOptions?: string[];
  rightOptions?: string[];
  pairs?: [number, number][];
  /** printed-book example items (solved on the page), by item num */
  example?: number[];
}

export interface UnitData {
  unit: number;
  title: string;
  /** book pages of the unit — mirrored in index.json `pages` (what the app
      mounts the page stack on); kept here for the per-file pipeline scripts */
  pdfPages: number[];
  exercises: Exercise[];
}

export interface AdditionalData {
  id: number;
  topic: string;
  refs?: string;
  pdfPages: number[];
  exercise: Exercise;
}

export interface Group {
  name: string;
  units: number[];
}

export interface IndexData {
  groups: Group[];
  additional: { title: string; exercises: number[] };
  /** per-exercise info the app needs before that exercise's own JSON lands,
      keyed "uN"/"aN" (scripts/make_index.py): the heading text and the book
      pages to mount. index.json is fetched at startup, so opening a route can
      label the page and start the 13.9 MB book PDF without waiting for the
      unit file — see App.tsx `routeInfo` */
  exercises: Record<string, { title: string; pages: number[] }>;
}

export async function fetchIndex(): Promise<IndexData> {
  const r = await fetch(`${BASE}data/index.json`);
  if (!r.ok) throw new Error(`index.json: ${r.status}`);
  return r.json();
}

/** The packed course: every exercise file keyed as the app asks for it. */
interface CourseBundle {
  units: Record<string, UnitData>;
  additional: Record<string, AdditionalData>;
}

// the packed course, fetched at most once per session; a load that failed is
// not kept, so the next exercise opened retries (the cache may have been
// filled since — the offline download stores this file)
let bundle: Promise<CourseBundle> | null = null;

function loadBundle(): Promise<CourseBundle> {
  if (!bundle) {
    bundle = fetch(`${BASE}${COURSE_BUNDLE}`)
      .then((r) => {
        if (!r.ok) throw new Error(`course.json: ${r.status}`);
        return r.json() as Promise<CourseBundle>;
      })
      .catch((e: unknown) => {
        bundle = null;
        throw e;
      });
  }
  return bundle;
}

/**
 * One exercise file, or — when that request fails, which offline means the
 * file was never cached — the same exercise out of the packed course. The
 * offline download (offline.ts) stores the pack INSTEAD of the ~190 per-file
 * copies, so this fallback is what makes a downloaded unit open offline.
 * Online the per-file request wins, so a fresh deploy is never served from a
 * stale pack.
 */
async function fetchExercise<T>(file: string, pick: (b: CourseBundle) => T | undefined): Promise<T> {
  try {
    const r = await fetch(`${BASE}${file}`);
    if (!r.ok) throw new Error(`${file}: ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    let packed: T | undefined;
    try {
      packed = pick(await loadBundle());
    } catch {
      throw e; // no pack either: the per-file error is the informative one
    }
    if (packed === undefined) throw e;
    return packed;
  }
}

export function fetchUnit(n: number): Promise<UnitData> {
  return fetchExercise(`data/units/unit-${String(n).padStart(3, "0")}.json`, (b) => b.units[n]);
}

export function fetchAdditional(n: number): Promise<AdditionalData> {
  return fetchExercise(`data/additional/${String(n).padStart(2, "0")}.json`, (b) => b.additional[n]);
}

export interface UnitTotals {
  total: number;
  exercises: Record<string, number>;
}
export type TotalsMap = Record<string, UnitTotals>;

export async function fetchTotals(): Promise<TotalsMap> {
  const r = await fetch(`${BASE}data/totals.json`);
  if (!r.ok) throw new Error(`totals.json: ${r.status}`);
  return r.json();
}
