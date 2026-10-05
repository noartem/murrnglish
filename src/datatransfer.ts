// The data file: one JSON file carrying the chosen targets — the progress of
// one or more books, the cards (dictionary + review state + study settings),
// the learner's words — so a learner moves their work between browsers with
// one file instead of three. Everything lives in this browser only
// (progress.ts, study.ts), which is what makes the file the way out of it.
//
// One shape only for what goes out. Coming IN, three shapes are read: this
// file, the older study backup (backup.ts BACKUP_FORMAT) and a bare progress
// file — the two an app that never had a data window could produce. An
// unticked target is null in the file, never an empty object: "not chosen"
// and "chosen but empty" are different facts on the way back in.

import type { SrsData, StudyBackup, StudySettings } from "./backup";
import { BACKUP_FORMAT, cleanSettings, cleanSrs, parseBackup, validWord } from "./backup";
import { loadedDecks } from "./deckdata";
import { buildLearningReport, parseLearningReport } from "./learning";
import type { LearningReport } from "./learning";
import type { Progress } from "./progress";
import { loadProgress, parseProgressText, progressPayload, validateProgress } from "./progress";
import { srsConfig, studySnapshot } from "./study";
import type { Word } from "./words";

export const DATA_FORMAT = "murrnglish-data";

export interface DataFile {
  format: typeof DATA_FORMAT;
  version: 3;
  exported: number;
  /** book id -> that book's progress */
  books: Record<string, Progress>;
  /** null = the cards were not chosen for this file */
  cards: { srs: SrsData; settings: StudySettings } | null;
  /** null = the words were not chosen for this file */
  dictionary: { words: Word[] } | null;
  /** null = the learning report was not chosen for this file */
  learning: LearningReport | null;
}

/** What a learner ticked in the data window. */
export interface Targets {
  books: string[];
  includeAnswers: boolean;
  cards: boolean;
  dictionary: boolean;
  /** carry the learning report — what is learned and what comes back when */
  learning: boolean;
}

/** What the data window holds before anything is written: a file the learner
 *  picked, or the progress an incoming `#/<book>/p=` share link carries. Both
 *  are summarised first and land only on Apply. */
export type Incoming =
  | { kind: "data"; file: DataFile }
  | { kind: "study"; backup: StudyBackup }
  /** `book` names the book a share link belongs to; a bare progress FILE
   *  names none, and goes into the course you are in */
  | { kind: "progress"; progress: Progress; book?: string };

/**
 * Build the file for the chosen targets. The study store is read once, so a
 * file is a consistent snapshot; the answer flag applies to the book rows
 * only — a card or a word is exported whole, there is no smaller half of one.
 */
export function makeDataFile(t: Targets, now: number): DataFile {
  const books: Record<string, Progress> = {};
  for (const id of t.books) books[id] = progressPayload(loadProgress(id), t.includeAnswers);
  // nothing to read unless a target asks for it
  const snap = t.cards || t.dictionary || t.learning ? studySnapshot() : null;
  // the report reads off that same snapshot, so a file is one moment in time;
  // it is a report and never applied — the schedule itself moves under cards
  const learning =
    snap && t.learning
      ? buildLearningReport(snap.srs, loadedDecks(), snap.words, now, srsConfig(snap.settings))
      : null;
  return {
    format: DATA_FORMAT,
    version: 3,
    exported: now,
    books,
    cards: snap && t.cards ? { srs: snap.srs, settings: snap.settings } : null,
    dictionary: snap && t.dictionary ? { words: snap.words } : null,
    learning,
  };
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Read a file the data window was handed, or null when it is not one of the
 * three shapes. A data file's invalid parts are dropped rather than refused:
 * one book's broken progress must not cost the learner their words.
 */
export function parseIncoming(text: string): Incoming | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(parsed)) return null;

  if (parsed.format === DATA_FORMAT) {
    // version 3 added the learning report; a 2 file simply has none
    if (parsed.version !== 2 && parsed.version !== 3) return null;
    const books: Record<string, Progress> = {};
    if (isObj(parsed.books)) {
      for (const [id, p] of Object.entries(parsed.books)) {
        const valid = validateProgress(p);
        if (valid) books[id] = valid;
      }
    }
    const cards = isObj(parsed.cards)
      ? { srs: cleanSrs(parsed.cards.srs), settings: cleanSettings(parsed.cards.settings) }
      : null;
    const rawWords = isObj(parsed.dictionary) ? parsed.dictionary.words : null;
    const dictionary = Array.isArray(rawWords) ? { words: rawWords.filter(validWord) } : null;
    return {
      kind: "data",
      file: {
        format: DATA_FORMAT,
        version: 3,
        exported: isNum(parsed.exported) ? parsed.exported : 0,
        books,
        cards,
        dictionary,
        learning: parseLearningReport(parsed.learning),
      },
    };
  }

  if (parsed.format === BACKUP_FORMAT) {
    const backup = parseBackup(text);
    return backup ? { kind: "study", backup } : null;
  }

  const progress = parseProgressText(text);
  return progress ? { kind: "progress", progress } : null;
}