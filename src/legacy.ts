// The cards before the decks. Until the decks (deckdata.ts) the cards were
// made from the books: unit cards from a book's exercises, keyed
// "<book>:<exercise>:<item>", and the books' word packs, keyed
// "v:<book>:<pack>:<entry>", with daily study ticked per book, unit and pack
// ("blue", "blue/u12", "blue/pack-phrasal-verbs"). Review states made then are
// still in the learner's store and in their backups.
//
// The word packs' material lives on in the vocabulary decks, mostly under the
// same entry ids, so a pack card's history moves to that entry; everything
// else of the old scheme is dropped. Pure: study.ts applies it once the decks
// have loaded, and again after importing an old backup.

import type { SrsData } from "./backup";
import type { DeckLibrary } from "./deckdata";
import { cardId, parseCardId } from "./deckdata";
import type { Include } from "./selection";
import { WORDS_PICK } from "./selection";
import type { CardState } from "./srs";
import { parseWordCardId } from "./words";

/** Old pack id -> the decks its entries may have moved to, in the order tried. */
const PACK_DECKS: Record<string, string[]> = {
  "irregular-verbs": ["irregular-verbs", "irregular-verbs-advanced"],
  "phrasal-verbs": ["phrasal-verbs", "phrasal-verbs-advanced"],
  prepositions: ["word-prepositions"],
  "words-prepositions": ["word-prepositions"],
  "linking-words": ["linking-words"],
  "go-get-do-make-have": ["collocations"],
};

/** The id a card has now: itself, its deck entry's id, or null when it is gone. */
export function currentId(id: string, lib: DeckLibrary): string | null {
  if (parseWordCardId(id) || parseCardId(id)) return id;
  const m = id.match(/^v:[^:]+:([^:]+):([^:]+)$/);
  if (!m) return null; // a unit card, or nothing we know
  for (const deck of PACK_DECKS[m[1]] ?? []) {
    if (lib.decks.get(deck)?.entries.some((e) => e.id === m[2])) return cardId(deck, m[2]);
  }
  return null;
}

/**
 * The store with every old card id moved or dropped and the old daily-study
 * ticks gone; null when there is nothing old in it. Two cards landing on one
 * entry (the same verb in both books' packs) keep the one answered last, as
 * a backup merge would.
 */
export function migrateLegacy(
  srs: SrsData,
  include: Include,
  lib: DeckLibrary,
): { srs: SrsData; include: Record<string, boolean> } | null {
  const oldState = Object.keys(srs.states).some((id) => currentId(id, lib) !== id);
  const oldSuspended = srs.suspended.some((id) => currentId(id, lib) !== id);
  const oldTicks = Object.keys(include).some((k) => k !== WORDS_PICK && !lib.decks.has(k));
  if (!oldState && !oldSuspended && !oldTicks) return null;

  const states: Record<string, CardState> = {};
  for (const [id, s] of Object.entries(srs.states)) {
    const to = currentId(id, lib);
    if (!to) continue;
    const had = states[to];
    if (!had || had.last < s.last) states[to] = s;
  }
  const suspended = [...new Set(srs.suspended.map((id) => currentId(id, lib)).filter((id): id is string => !!id))];
  const kept = Object.entries(include).filter(([k]) => k === WORDS_PICK || lib.decks.has(k));
  return { srs: { ...srs, states, suspended }, include: Object.fromEntries(kept) };
}
