// Hash routing: every book's pages, the library as the fallback for anything
// unknown, and share links scoped to the book they were made in.

import { describe, expect, it } from "vitest";
import type { Book } from "./books";
import type { DeckRef } from "./routes";
import {
  DECK_RESERVED,
  RESERVED_IDS,
  bookHash,
  browseHash,
  deckHash,
  dictionaryDeckHash,
  parseDeck,
  parsePage,
  parseRoute,
  rulesHash,
} from "./routes";
import syncScript from "../scripts/sync_books.mjs?raw";
import deckSync from "../scripts/sync_decks.mjs?raw";

const book = (id: string, units: number, additional: number): Book => ({
  id,
  order: 1,
  title: id,
  edition: "",
  level: "",
  authors: "",
  publisher: "",
  color: "#000",
  cover: { file: "cover.png", width: 1, height: 1 },
  units,
  additional,
  downloadBytes: 0,
});
const RED = book("red", 115, 35);
const BLUE = book("blue", 145, 41);
const BOOKS = [RED, BLUE];

describe("parseRoute", () => {
  it("opens the library at #/ and for anything unknown", () => {
    for (const h of ["#/", "#", "#home", "#u5", "#/green/u1", "#/Blue/u1", "#//u1"]) {
      expect(parseRoute(h, BOOKS)).toEqual({ view: "library" });
    }
  });

  it("opens a book's landing", () => {
    for (const h of ["#/blue", "#/blue/", "#/blue/home", "#/blue/x9"]) {
      expect(parseRoute(h, BOOKS)).toEqual({ view: "book", book: BLUE, page: { kind: "home" } });
    }
  });

  it("opens units and additional exercises", () => {
    expect(parseRoute("#/red/u12", BOOKS)).toEqual({
      view: "book",
      book: RED,
      page: { kind: "unit", n: 12 },
    });
    expect(parseRoute("#/blue/a41", BOOKS)).toEqual({
      view: "book",
      book: BLUE,
      page: { kind: "additional", n: 41 },
    });
  });

  it("clamps page numbers to the book", () => {
    expect(parsePage(RED, "u145")).toEqual({ kind: "unit", n: 115 });
    expect(parsePage(BLUE, "u145")).toEqual({ kind: "unit", n: 145 });
    expect(parsePage(RED, "a41")).toEqual({ kind: "additional", n: 35 });
    expect(parsePage(RED, "u0")).toEqual({ kind: "unit", n: 1 });
  });

  it("carries a share code to its book's landing", () => {
    expect(parseRoute("#/red/p=1.AbC-_9", BOOKS)).toEqual({
      view: "book",
      book: RED,
      page: { kind: "home" },
      share: "1.AbC-_9",
    });
    // not a code: the book's landing, nothing to preview
    expect(parseRoute("#/red/p=2.abc", BOOKS)).toEqual({
      view: "book",
      book: RED,
      page: { kind: "home" },
    });
  });
});

describe("bookHash", () => {
  it("round-trips through parseRoute", () => {
    for (const page of [
      { kind: "home" as const },
      { kind: "unit" as const, n: 7 },
      { kind: "additional" as const, n: 3 },
    ]) {
      expect(parseRoute(bookHash(BLUE, page), BOOKS)).toEqual({ view: "book", book: BLUE, page });
    }
  });
});

describe("sections", () => {
  it("opens the rules compendium, a book's rules and a unit's rule", () => {
    expect(parseRoute("#/rules", BOOKS)).toEqual({ view: "rules" });
    expect(parseRoute("#/rules/green", BOOKS)).toEqual({ view: "rules" });
    expect(parseRoute("#/rules/blue", BOOKS)).toEqual({ view: "rules", book: BLUE });
    expect(parseRoute("#/rules/red/u200", BOOKS)).toEqual({ view: "rules", book: RED, unit: 115 });
    expect(parseRoute(rulesHash(BLUE, 12), BOOKS)).toEqual({ view: "rules", book: BLUE, unit: 12 });
  });

  it("opens the deck list and every kind of deck", () => {
    expect(parseRoute("#/cards", BOOKS)).toEqual({ view: "cards", deck: undefined });
    expect(parseRoute("#/cards/Nope", BOOKS)).toEqual({ view: "cards", deck: undefined });
    // the book-made decks of before are gone: their links land on the deck list
    expect(parseRoute("#/cards/blue/u12", BOOKS)).toEqual({ view: "cards", deck: undefined });
    const decks: DeckRef[] = [{ kind: "all" }, { kind: "words" }, { kind: "deck", id: "phrasal-verbs" }];
    for (const deck of decks) expect(parseRoute(deckHash(deck), BOOKS)).toEqual({ view: "cards", deck });
    expect(parseDeck("idioms")).toEqual({ kind: "deck", id: "idioms" });
    expect(parseDeck("")).toBeUndefined();
  });

  it("opens a deck's cards and one card of it", () => {
    expect(parseRoute("#/cards/idioms/browse", BOOKS)).toEqual({ view: "browse", deck: "idioms" });
    expect(parseRoute(browseHash("idioms"), BOOKS)).toEqual({ view: "browse", deck: "idioms" });
    expect(parseRoute(browseHash("idioms", "break-the-ice"), BOOKS)).toEqual({
      view: "browse",
      deck: "idioms",
      entry: "break-the-ice",
    });
    // the sessions that are not decks have no list of their own
    expect(parseRoute("#/cards/all/browse", BOOKS)).toEqual({ view: "cards", deck: undefined });
    expect(parseRoute("#/cards/idioms/browse/Nope", BOOKS)).toEqual({ view: "cards", deck: undefined });
  });

  it("opens the dictionary", () => {
    expect(parseRoute("#/dictionary", BOOKS)).toEqual({ view: "dictionary" });
    expect(parseRoute("#/dictionary/irregular-verbs", BOOKS)).toEqual({ view: "dictionary", deck: "irregular-verbs" });
    expect(parseRoute(dictionaryDeckHash("idioms"), BOOKS)).toEqual({ view: "dictionary", deck: "idioms" });
    expect(parseRoute("#/dictionary/blue/pack-x", BOOKS)).toEqual({ view: "dictionary" });
  });

  it("reserves the section names in the book sync and the session names in the deck sync", () => {
    const m = syncScript.match(/const RESERVED = (\[[^\]]*\])/);
    expect(m && JSON.parse(m[1])).toEqual([...RESERVED_IDS]);
    const d = deckSync.match(/const RESERVED = (\[[^\]]*\])/);
    expect(d && JSON.parse(d[1])).toEqual([...DECK_RESERVED]);
  });
});
