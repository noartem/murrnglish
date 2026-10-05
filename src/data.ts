// Data layer: types mirroring books/<id>/work/PARSING-SPEC.md schemas + fetch
// helpers. Every fetch is for one book: its files are served under
// /books/<id>/ (scripts/sync_books.mjs).

import type { Book } from "./books";
import { bookUrl } from "./books";
import type { Lesson } from "./lesson";

/** book-relative path of every exercise in one file (scripts/sync_books.mjs) */
export const COURSE_BUNDLE = "data/course.json";

export type ExerciseType = "fill-in" | "choice" | "matching" | "write" | "self-check";

/** What every item may carry besides its own fields. */
interface ItemBase {
  /** what the item is about, where the printed book had a picture: an emoji
      and a line of text ("💪 He lifts the heavy box with one hand.") */
  cue?: string;
}

export interface FillInItem extends ItemBase {
  num: number;
  parts: string[];
  answers: string[][];
  /** pre-solved in the printed book; rendered as plain text, excluded from grading */
  example?: boolean;
}
export interface ChoiceItem extends ItemBase {
  num: number | string;
  options: string[];
  answer: number | number[];
  /** pre-solved in the printed book; rendered as static text, excluded from grading */
  example?: boolean;
}
export interface WriteItem extends ItemBase {
  num: number | string;
  prompt: string;
  answers: string[];
  /** pre-solved in the printed book or key-less; rendered as static text, excluded from grading */
  example?: boolean;
}
export interface SelfCheckItem extends ItemBase {
  num: number;
  prompt: string;
  modelAnswers: string[];
}

export type Item = FillInItem | ChoiceItem | WriteItem | SelfCheckItem;

export interface Exercise {
  id: string;
  type: ExerciseType;
  instruction: string;
  /** what the whole exercise is about, where the printed book had a picture,
      a map or a table: lines of text, "a | b | c" lines make a table */
  scene?: string;
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
  /** book pages of the unit — for the pipeline scripts, the app shows none */
  pdfPages: number[];
  exercises: Exercise[];
  /** the app's own lesson for the unit (scripts/lessons.mjs), when written */
  lesson?: Lesson;
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
      keyed "uN"/"aN" (books/<id>/scripts/make_index.py): the heading text
      (and the book pages, which the pipelines check and the app ignores).
      index.json is fetched at startup, so opening a route can label the page
      without waiting for the unit file — see CourseApp.tsx `routeInfo` */
  exercises: Record<string, { title: string; pages: number[] }>;
}

async function fetchJson<T>(book: Book, file: string): Promise<T> {
  const r = await fetch(bookUrl(book, file));
  if (!r.ok) throw new Error(`${book.id}/${file}: ${r.status}`);
  return r.json() as Promise<T>;
}

export function fetchIndex(book: Book): Promise<IndexData> {
  return fetchJson(book, "data/index.json");
}

/** The packed course: every exercise file keyed as the app asks for it. */
export interface CourseBundle {
  units: Record<string, UnitData>;
  additional: Record<string, AdditionalData>;
}

// each book's pack, fetched at most once per session; a load that failed is
// not kept, so the next exercise opened retries (the cache may have been
// filled since — the offline download stores this file)
const bundles = new Map<string, Promise<CourseBundle>>();

// the index is small and asked for by every section that lists units; one
// request per book per session (a failure is dropped so the next asker retries)
const indexes = new Map<string, Promise<IndexData>>();
export function fetchIndexOnce(book: Book): Promise<IndexData> {
  let p = indexes.get(book.id);
  if (!p) {
    p = fetchIndex(book).catch((e: unknown) => {
      indexes.delete(book.id);
      throw e;
    });
    indexes.set(book.id, p);
  }
  return p;
}

function loadBundle(book: Book): Promise<CourseBundle> {
  let b = bundles.get(book.id);
  if (!b) {
    b = fetchJson<CourseBundle>(book, COURSE_BUNDLE).catch((e: unknown) => {
      bundles.delete(book.id);
      throw e;
    });
    bundles.set(book.id, b);
  }
  return b;
}

/**
 * One exercise file, or — when that request fails, which offline means the
 * file was never cached — the same exercise out of the packed course. The
 * offline download (offline.ts) stores the pack INSTEAD of the ~190 per-file
 * copies, so this fallback is what makes a downloaded unit open offline.
 * Online the per-file request wins, so a fresh deploy is never served from a
 * stale pack.
 */
async function fetchExercise<T>(
  book: Book,
  file: string,
  pick: (b: CourseBundle) => T | undefined,
): Promise<T> {
  try {
    return await fetchJson<T>(book, file);
  } catch (e) {
    let packed: T | undefined;
    try {
      packed = pick(await loadBundle(book));
    } catch {
      throw e; // no pack either: the per-file error is the informative one
    }
    if (packed === undefined) throw e;
    return packed;
  }
}

export function fetchUnit(book: Book, n: number): Promise<UnitData> {
  return fetchExercise(book, `data/units/unit-${String(n).padStart(3, "0")}.json`, (b) => b.units[n]);
}

export function fetchAdditional(book: Book, n: number): Promise<AdditionalData> {
  return fetchExercise(book, `data/additional/${String(n).padStart(2, "0")}.json`, (b) => b.additional[n]);
}

export interface UnitTotals {
  total: number;
  exercises: Record<string, number>;
}
export type TotalsMap = Record<string, UnitTotals>;

export function fetchTotals(book: Book): Promise<TotalsMap> {
  return fetchJson(book, "data/totals.json");
}

// the totals are asked for by anything that draws a progress mosaic (the
// data window, one per book); one request per book per session, like the
// index, and a failure is dropped so the next asker retries
const totalsCache = new Map<string, Promise<TotalsMap>>();
export function fetchTotalsOnce(book: Book): Promise<TotalsMap> {
  let p = totalsCache.get(book.id);
  if (!p) {
    p = fetchTotals(book).catch((e: unknown) => {
      totalsCache.delete(book.id);
      throw e;
    });
    totalsCache.set(book.id, p);
  }
  return p;
}
