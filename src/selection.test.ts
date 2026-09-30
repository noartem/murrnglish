// Daily study: which cards "Everything due" and a book's deck take once the
// learner ticks or unticks units, packs, their words or a whole book.

import { describe, expect, it } from "vitest";
import { BOOKS } from "./books";
import type { UnitCard } from "./cards";
import type { BookCards } from "./decks";
import { deckIds } from "./decks";
import type { IndexData } from "./data";
import type { Pack } from "./packs";
import { cardExcluded, interleave } from "./selection";
import type { Word } from "./words";

const [RED, BLUE] = BOOKS;

const card = (book: string, unit: number, n: number): UnitCard => ({
  id: `${book}:${unit}.1:${n}`,
  book,
  unit,
  exercise: `${unit}.1`,
  instruction: "",
  kind: "match",
  left: "a",
  right: "b",
});

const pack = (id: string, n: number): Pack => ({
  id,
  title: id,
  about: "",
  ask: "translate",
  entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, en: `e${i}`, ru: `р${i}` })),
});

// two units of two cards each and one pack, per book
function bookCards(book: typeof RED): BookCards {
  const byUnit = new Map([
    [1, [card(book.id, 1, 1), card(book.id, 1, 2)]],
    [2, [card(book.id, 2, 1), card(book.id, 2, 2)]],
  ]);
  const index = { groups: [{ name: "g", units: [1, 2] }], exercises: {}, additional: { exercises: [] } } as unknown as IndexData;
  return { book, index, byUnit, order: [1, 2], packs: [pack("verbs", 2)] };
}
const books = { red: bookCards(RED), blue: bookCards(BLUE) };

const word: Word = { id: "w1", word: "cat", translation: "кот", notes: "", reverse: false, added: 1, updated: 1 };
// red unit 2 started: one of its cards was studied
const states = { "red:2.1:1": {} };

describe("daily study", () => {
  it("takes the words and the started units by default, by turns", () => {
    expect(deckIds({ kind: "all" }, books, [word], states, {})).toEqual(["w:w1:f", "red:2.1:1", "red:2.1:2"]);
  });

  it("adds ticked units and packs, and drops unticked ones", () => {
    const ids = deckIds({ kind: "all" }, books, [word], states, {
      "red/u2": false,
      "blue/u1": true,
      "blue/pack-verbs": true,
      words: false,
    });
    // blue's unit cards and its pack come in turn about
    expect(ids).toEqual(["blue:1.1:1", "v:blue:verbs:e0", "blue:1.1:2", "v:blue:verbs:e1"]);
  });

  it("leaves a switched-off book out whatever is ticked in it", () => {
    const ids = deckIds({ kind: "all" }, books, [], states, { red: false, "red/u1": true });
    expect(ids).toEqual([]);
  });

  it("gives a book's deck its share, and its pack deck all of the pack", () => {
    expect(deckIds({ kind: "book", book: RED }, books, [], states, { "red/pack-verbs": true })).toEqual([
      "red:2.1:1",
      "v:red:verbs:e0",
      "red:2.1:2",
      "v:red:verbs:e1",
    ]);
    // switched off, the book's own deck still opens
    expect(deckIds({ kind: "book", book: RED }, books, [], states, { red: false })).toEqual(["red:2.1:1", "red:2.1:2"]);
    expect(deckIds({ kind: "pack", book: BLUE, pack: "verbs" }, books, [], {}, {})).toEqual([
      "v:blue:verbs:e0",
      "v:blue:verbs:e1",
    ]);
  });

  it("treats a pack with a card studied as started", () => {
    const ids = deckIds({ kind: "all" }, books, [], { "v:blue:verbs:e1": {} }, {});
    expect(ids).toEqual(["v:blue:verbs:e0", "v:blue:verbs:e1"]);
  });
});

describe("cardExcluded", () => {
  it("tells from the id alone whether a met card was taken out", () => {
    const include = { red: false, "blue/u12": false, "blue/pack-verbs": false, words: false };
    expect(cardExcluded("red:3.1:1", include)).toBe(true);
    expect(cardExcluded("blue:12.2:4", include)).toBe(true);
    expect(cardExcluded("blue:13.2:4", include)).toBe(false);
    expect(cardExcluded("v:blue:verbs:go", include)).toBe(true);
    expect(cardExcluded("v:blue:other:go", include)).toBe(false);
    expect(cardExcluded("v:red:other:go", include)).toBe(true);
    expect(cardExcluded("w:abc:f", include)).toBe(true);
    expect(cardExcluded("w:abc:f", {})).toBe(false);
  });
});

describe("interleave", () => {
  it("takes one from each list in turn", () => {
    expect(interleave([[1, 2, 3], [], [10, 20]])).toEqual([1, 10, 2, 20, 3]);
  });
});
