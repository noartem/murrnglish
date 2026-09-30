// What "Everything due" takes: the learner ticks what they want to study
// every day on the deck list. The choices are kept as the deck keys of
// routes.ts mapped to on/off, in the study settings (backup.ts):
//
//   "words"             the learner's own words           (default on)
//   "<book>"            the book as a whole: off leaves out all of it,
//                       whatever its units say             (default on)
//   "<book>/u12"        a unit                             (default: started)
//   "<book>/pack-<id>"  a word pack                        (default: started)
//
// A unit or pack nobody ticked is in once it is started — a unit finished in
// the course, or anything of it studied in a deck — so the daily allowance
// of new cards goes to what is being learned without any ticking at all,
// and a tick either way overrides that. Pure functions; decks.ts applies
// them to the loaded books, dueCount.ts to the review state alone.

import { parsePackCardId } from "./packs";
import { parseWordCardId } from "./words";

export type Include = Readonly<Record<string, boolean>>;

export const WORDS_PICK = "words";
export const unitPick = (book: string, unit: number) => `${book}/u${unit}`;
export const packPick = (book: string, pack: string) => `${book}/pack-${pack}`;

/** The book is switched on (the default). */
export function bookOn(include: Include, book: string): boolean {
  return include[book] !== false;
}

/** A unit or pack: its tick, else whether it has been started. */
export function picked(include: Include, key: string, started: boolean): boolean {
  return include[key] ?? started;
}

/**
 * A card the learner has taken out by hand: its book switched off, or its
 * unit or pack unticked, or their words turned off. Cards met before are
 * started by definition, so this alone decides whether a met card counts.
 */
export function cardExcluded(id: string, include: Include): boolean {
  if (parseWordCardId(id)) return include[WORDS_PICK] === false;
  const p = parsePackCardId(id);
  if (p) return !bookOn(include, p.book) || include[packPick(p.book, p.pack)] === false;
  const m = id.match(/^([^:]+):(\d+)\./); // "<book>:12.3:4"
  if (!m) return false;
  return !bookOn(include, m[1]) || include[unitPick(m[1], Number(m[2]))] === false;
}

/**
 * Lists merged by turns — one from each, then the next of each — so new
 * cards come from every source at once instead of one after the other.
 */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
