// What "Everything due" takes: the learner ticks what they want to study
// every day on the deck list. The choices are kept as deck keys mapped to
// on/off, in the study settings (backup.ts):
//
//   "words"     the learner's own words       (default on)
//   "<deck>"    a deck (deckdata.ts)          (default: started)
//
// A deck nobody ticked is in once it is started — any of its cards studied —
// so opening a deck and studying it is all it takes, and a tick either way
// overrides that. Pure functions; decks.ts applies them to the loaded decks,
// dueCount.ts to the review state alone.

import { parseCardId } from "./deckdata";
import { parseWordCardId } from "./words";

export type Include = Readonly<Record<string, boolean>>;

export const WORDS_PICK = "words";

/** A deck: its tick, else whether it has been started. */
export function picked(include: Include, deck: string, started: boolean): boolean {
  return include[deck] ?? started;
}

/**
 * A card the learner has taken out by hand — its deck unticked, or their
 * words turned off — or one that is no card of this app any more (the
 * earlier book-made cards, migrated or dropped by study.ts). Cards met before
 * are started by definition, so this alone decides whether a met card counts.
 */
export function cardExcluded(id: string, include: Include): boolean {
  if (parseWordCardId(id)) return include[WORDS_PICK] === false;
  const d = parseCardId(id);
  return !d || include[d.deck] === false;
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
