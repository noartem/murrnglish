// The study backup file: the dictionary, every card's review state and the
// study settings in one JSON file, so switching browsers or clearing site
// data loses nothing. Import MERGES instead of replacing — a backup made on
// the phone brought to the laptop must not wipe what was learned on the
// laptop meanwhile:
//
//   words     by id; the entry edited last wins
//   states    by card id; the card answered last wins
//   suspended union (a card suspended on either side stays suspended)
//   settings  this browser's are kept (the limits and what is ticked for daily study)
//
// Pure functions: study.ts applies the result.

import type { CardState, Daily } from "./srs";
import type { Word } from "./words";

export interface SrsData {
  states: Record<string, CardState>;
  suspended: string[];
  daily?: Daily;
}

export interface StudySettings {
  newPerDay: number;
  reviewsPerDay: number;
  /** cloze and write cards ask for the answer to be typed */
  typeAnswers: boolean;
  /** what "Everything due" takes, by deck key (selection.ts) */
  include: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: StudySettings = { newPerDay: 20, reviewsPerDay: 200, typeAnswers: true, include: {} };

export const BACKUP_FORMAT = "murrnglish-study";

export interface StudyBackup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exported: number;
  words: Word[];
  srs: SrsData;
  settings: StudySettings;
}

export function makeBackup(words: Word[], srs: SrsData, settings: StudySettings, now: number): StudyBackup {
  return { format: BACKUP_FORMAT, version: 1, exported: now, words, srs, settings };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

export function validWord(x: unknown): x is Word {
  if (!isObj(x)) return false;
  return (
    typeof x.id === "string" &&
    !!x.id &&
    typeof x.word === "string" &&
    !!x.word.trim() &&
    typeof x.translation === "string" &&
    typeof x.notes === "string" &&
    typeof x.reverse === "boolean" &&
    isNum(x.added) &&
    isNum(x.updated)
  );
}

export function validState(x: unknown): x is CardState {
  if (!isObj(x)) return false;
  return (
    (x.kind === "learning" || x.kind === "review" || x.kind === "relearning") &&
    isNum(x.due) &&
    isNum(x.ivl) &&
    isNum(x.ease) &&
    isNum(x.step) &&
    isNum(x.reps) &&
    isNum(x.lapses) &&
    isNum(x.last)
  );
}

/** The valid part of stored/imported SRS data; invalid card entries are dropped. */
export function cleanSrs(x: unknown): SrsData {
  const out: SrsData = { states: {}, suspended: [] };
  if (!isObj(x)) return out;
  if (isObj(x.states)) for (const [id, s] of Object.entries(x.states)) if (validState(s)) out.states[id] = s;
  if (Array.isArray(x.suspended)) out.suspended = x.suspended.filter((s): s is string => typeof s === "string");
  if (isObj(x.daily) && isNum(x.daily.day) && isNum(x.daily.newDone) && isNum(x.daily.reviewDone))
    out.daily = { day: x.daily.day, newDone: x.daily.newDone, reviewDone: x.daily.reviewDone };
  return out;
}

export function cleanSettings(x: unknown): StudySettings {
  if (!isObj(x)) return { ...DEFAULT_SETTINGS, include: {} };
  const int = (v: unknown, d: number, max: number) =>
    isNum(v) ? Math.min(max, Math.max(0, Math.round(v))) : d;
  return {
    newPerDay: int(x.newPerDay, DEFAULT_SETTINGS.newPerDay, 9999),
    reviewsPerDay: int(x.reviewsPerDay, DEFAULT_SETTINGS.reviewsPerDay, 9999),
    typeAnswers: typeof x.typeAnswers === "boolean" ? x.typeAnswers : DEFAULT_SETTINGS.typeAnswers,
    include: isObj(x.include)
      ? Object.fromEntries(Object.entries(x.include).filter((e): e is [string, boolean] => typeof e[1] === "boolean"))
      : {},
  };
}

/** A backup file's content, or null when it is not one. */
export function parseBackup(text: string): StudyBackup | null {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(x) || x.format !== BACKUP_FORMAT || !Array.isArray(x.words)) return null;
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exported: isNum(x.exported) ? x.exported : 0,
    words: x.words.filter(validWord),
    srs: cleanSrs(x.srs),
    settings: cleanSettings(x.settings),
  };
}

export interface MergeResult {
  words: Word[];
  srs: SrsData;
  /** what the import changed, for the confirmation line */
  added: number;
  updated: number;
  cards: number;
}

/**
 * Words of `incoming` merged into `mine`: by id, the entry edited last
 * wins, and the result keeps the order the words were added in.
 */
export function mergeWordList(
  mine: Word[],
  incoming: Word[],
): { words: Word[]; added: number; updated: number } {
  const byId = new Map(mine.map((w) => [w.id, w]));
  let added = 0;
  let updated = 0;
  for (const w of incoming) {
    const own = byId.get(w.id);
    if (!own) {
      byId.set(w.id, w);
      added++;
    } else if (w.updated > own.updated) {
      byId.set(w.id, w);
      updated++;
    }
  }
  const words = [...byId.values()].sort((a, b) => a.added - b.added);
  return { words, added, updated };
}

/** Review states of `incoming` merged into `mine`: by card id, the card
 *  answered last wins; suspended is the union of both sides. */
export function mergeSrs(mine: SrsData, incoming: SrsData): { srs: SrsData; cards: number } {
  const states = { ...mine.states };
  let cards = 0;
  for (const [id, s] of Object.entries(incoming.states)) {
    const own = states[id];
    if (!own || s.last > own.last) {
      states[id] = s;
      cards++;
    }
  }
  const suspended = [...new Set([...mine.suspended, ...incoming.suspended])];
  return { srs: { ...mine, states, suspended }, cards };
}

export function mergeBackup(words: Word[], srs: SrsData, incoming: StudyBackup): MergeResult {
  const w = mergeWordList(words, incoming.words);
  const s = mergeSrs(srs, incoming.srs);
  return { words: w.words, srs: s.srs, added: w.added, updated: w.updated, cards: s.cards };
}
