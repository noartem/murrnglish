// Daily study: which cards "Everything due" and a deck's session take once
// the learner ticks or unticks decks or their words.

import { describe, expect, it } from "vitest";
import type { Deck, DeckLibrary } from "./deckdata";
import { makeLibrary } from "./deckdata";
import { deckIds, pickedDecks, startedDecks } from "./decks";
import { cardExcluded, interleave } from "./selection";
import type { Word } from "./words";

const deck = (id: string, n: number): Deck => ({
  id,
  title: id,
  about: "",
  level: "B1",
  entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, en: `e${i}`, ru: `р${i}` })),
});

const lib: DeckLibrary = makeLibrary({
  sections: [
    { id: "grammar", title: "Grammar", about: "", groups: [{ title: "g", decks: [deck("tenses", 2), deck("modals", 2)] }] },
    { id: "vocabulary", title: "Vocabulary", about: "", groups: [{ title: "v", decks: [deck("verbs", 3)] }] },
  ],
});

const word: Word = { id: "w1", word: "cat", translation: "кот", notes: "", reverse: false, added: 1, updated: 1 };
// the tenses deck is started: one of its cards was studied
const states = { "d:tenses:e1": {} };

describe("daily study", () => {
  it("takes the learner's words and the decks started, by turns", () => {
    expect(startedDecks(states)).toEqual(new Set(["tenses"]));
    expect(deckIds({ kind: "all" }, lib, [word], states)).toEqual(["w:w1:f", "d:tenses:e0", "d:tenses:e1"]);
  });

  it("takes a ticked deck, leaves out an unticked one", () => {
    const include = { verbs: true, tenses: false };
    expect(pickedDecks(lib, include, states).map((d) => d.id)).toEqual(["verbs"]);
    expect(deckIds({ kind: "all" }, lib, [word], states, include)).toEqual([
      "w:w1:f",
      "d:verbs:e0",
      "d:verbs:e1",
      "d:verbs:e2",
    ]);
  });

  it("leaves the words out when they are turned off", () => {
    expect(deckIds({ kind: "all" }, lib, [word], states, { words: false })).toEqual(["d:tenses:e0", "d:tenses:e1"]);
  });

  it("waits for the decks, except for the words", () => {
    expect(deckIds({ kind: "all" }, null, [word], states)).toBeNull();
    expect(deckIds({ kind: "deck", id: "verbs" }, null, [word], states)).toBeNull();
    expect(deckIds({ kind: "words" }, null, [word], states)).toEqual(["w:w1:f"]);
  });

  it("opens any deck on its own, ticked or not", () => {
    expect(deckIds({ kind: "deck", id: "modals" }, lib, [], states, { modals: false })).toEqual(["d:modals:e0", "d:modals:e1"]);
    expect(deckIds({ kind: "deck", id: "gone" }, lib, [], states)).toEqual([]);
  });
});

describe("cardExcluded", () => {
  it("follows the ticks, and drops what is no card any more", () => {
    expect(cardExcluded("d:tenses:e0", {})).toBe(false);
    expect(cardExcluded("d:tenses:e0", { tenses: false })).toBe(true);
    expect(cardExcluded("w:w1:f", {})).toBe(false);
    expect(cardExcluded("w:w1:f", { words: false })).toBe(true);
    // the book-made cards of before
    expect(cardExcluded("blue:12.1:3", {})).toBe(true);
    expect(cardExcluded("v:blue:irregular-verbs:go", {})).toBe(true);
  });
});

describe("interleave", () => {
  it("takes one from each list by turns", () => {
    expect(interleave([[1, 2, 3], [], [10, 20]])).toEqual([1, 10, 2, 20, 3]);
    expect(interleave([])).toEqual([]);
  });
});
