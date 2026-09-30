// Which cards a study session reviews, and what a card id stands for. The
// deck cards come from the app's own decks (deckdata.ts); the learner's words
// from the study store.
//
// "Everything" is what the learner ticked on the deck list (selection.ts):
// their words and every deck ticked — or, where nothing was ticked, started.
// A deck nobody has opened stays out, so the daily new-card allowance goes to
// what is being learned now. A deck's own session introduces its new cards
// regardless.

import { useMemo } from "react";
import type { Deck, DeckEntry, DeckLibrary } from "./deckdata";
import { deckCardIds, parseCardId } from "./deckdata";
import type { DeckRef } from "./routes";
import type { Include } from "./selection";
import { WORDS_PICK, interleave, picked } from "./selection";
import type { Word } from "./words";
import { parseWordCardId, wordCardIds } from "./words";

/** Decks with any card studied. */
export function startedDecks(states: Readonly<Record<string, unknown>>): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys(states)) {
    const d = parseCardId(id);
    if (d) out.add(d.deck);
  }
  return out;
}

/** Word card ids, oldest word first: new words are introduced in the order they were saved. */
export function wordIds(words: readonly Word[]): string[] {
  return [...words].sort((a, b) => a.added - b.added).flatMap(wordCardIds);
}

/** The decks daily study takes: ticked, or started and not unticked. */
export function pickedDecks(lib: DeckLibrary, include: Include, states: Readonly<Record<string, unknown>>): Deck[] {
  const started = startedDecks(states);
  return [...lib.decks.values()].filter((d) => picked(include, d.id, started.has(d.id)));
}

/**
 * The card ids of a deck, in the order new cards are introduced. Null while
 * the decks have not loaded. Daily study takes its sources by turns (the
 * words, then each deck), so ticking a deck brings its new cards in at once.
 */
export function deckIds(
  deck: DeckRef,
  lib: DeckLibrary | null,
  words: readonly Word[],
  states: Readonly<Record<string, unknown>>,
  include: Include = {},
): string[] | null {
  switch (deck.kind) {
    case "words":
      return wordIds(words);
    case "all": {
      if (!lib) return null;
      const lists = [include[WORDS_PICK] === false ? [] : wordIds(words)];
      for (const d of pickedDecks(lib, include, states)) lists.push(deckCardIds(d));
      return interleave(lists);
    }
    case "deck": {
      if (!lib) return null;
      const d = lib.decks.get(deck.id);
      return d ? deckCardIds(d) : [];
    }
  }
}

/** The deck's name, as the session header prints it. */
export function deckTitle(deck: DeckRef, lib: DeckLibrary | null): string {
  switch (deck.kind) {
    case "all":
      return "Everything due";
    case "words":
      return "My words";
    case "deck":
      return lib?.decks.get(deck.id)?.title ?? "";
  }
}

export type ResolvedCard =
  | { type: "word"; word: Word; dir: "f" | "r" }
  | { type: "deck"; deck: Deck; entry: DeckEntry; section: string };

/** Card content by id, across the decks and the dictionary. */
export function useCardLookup(lib: DeckLibrary | null, words: readonly Word[]): (id: string) => ResolvedCard | null {
  return useMemo(() => {
    const byWord = new Map(words.map((w) => [w.id, w]));
    const entries = new Map<string, Map<string, DeckEntry>>();
    const entriesOf = (d: Deck) => {
      let m = entries.get(d.id);
      if (!m) {
        m = new Map(d.entries.map((e) => [e.id, e]));
        entries.set(d.id, m);
      }
      return m;
    };
    return (id: string) => {
      const w = parseWordCardId(id);
      if (w) {
        const word = byWord.get(w.wordId);
        return word ? { type: "word", word, dir: w.dir } : null;
      }
      const c = parseCardId(id);
      const deck = c && lib?.decks.get(c.deck);
      const entry = c && deck && entriesOf(deck).get(c.entry);
      return deck && entry ? { type: "deck", deck, entry, section: lib?.sectionOf.get(deck.id) ?? "" } : null;
    };
  }, [lib, words]);
}

/** Whether a card id still names a card: a word card, or an entry of a loaded deck. */
export function cardExists(id: string, lib: DeckLibrary): boolean {
  if (parseWordCardId(id)) return true;
  const c = parseCardId(id);
  return !!c && !!lib.decks.get(c.deck)?.entries.some((e) => e.id === c.entry);
}
