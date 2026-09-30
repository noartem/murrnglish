// The rules search: every query word must be found (at the start of a word),
// title hits rank first, a unit number finds its unit, and the snippet is the
// rule line holding the words.

import { describe, expect, it } from "vitest";
import type { Book } from "./books";
import type { BookRules } from "./rules";
import { fold, highlight, queryTerms, searchRules } from "./rules";

const book = (id: string, order: number): Book => ({
  id,
  order,
  title: id,
  edition: "",
  level: id,
  authors: "",
  publisher: "",
  color: "#000",
  cover: { file: "c.png", width: 1, height: 1 },
  units: 3,
  additional: 0,
  downloadBytes: 0,
  packs: 0,
});

const RED = book("red", 1);
const BLUE = book("blue", 2);

const rules = (b: Book, titles: string[], text: Record<number, string[]> = {}): BookRules => ({
  book: b,
  index: {
    groups: [{ name: "Group", units: titles.map((_, i) => i + 1) }],
    additional: { title: "", exercises: [] },
    exercises: Object.fromEntries(titles.map((t, i) => [`u${i + 1}`, { title: t, pages: [] }])),
  },
  rules: new Map(
    Object.entries(text).map(([n, lines]) => [Number(n), { s: [{ l: "A", x: lines.map((t) => ["t", t] as ["t", string]) }], r: [] }]),
  ),
});

const ALL = [
  rules(RED, ["I used to …", "am/is/are", "Настоящее время"]),
  rules(BLUE, ["Present perfect", "used to (do)", "for and since"], {
    1: ["We use the present perfect for a period that continues until now.", "I haven’t seen him since Monday."],
    3: ["We use for and since to say how long something has been happening."],
  }),
];

describe("searchRules", () => {
  it("needs every word, at the start of a word", () => {
    expect(searchRules(ALL, "used to").map((h) => `${h.book.id}${h.unit}`)).toEqual(["red1", "blue2"]);
    expect(searchRules(ALL, "sed")).toEqual([]); // not inside a word
    expect(searchRules(ALL, "since monday").map((h) => `${h.book.id}${h.unit}`)).toEqual(["blue1"]);
  });

  it("ranks title hits over text hits and gives the text line", () => {
    const hits = searchRules(ALL, "since");
    expect(hits.map((h) => `${h.book.id}${h.unit}`)).toEqual(["blue3", "blue1"]);
    expect(hits[0].snippet).toBeUndefined(); // found in the title
    expect(hits[1].snippet).toBe("I haven’t seen him since Monday.");
  });

  it("finds a unit by its number and folds quotes, case and ё", () => {
    expect(searchRules(ALL, "3").map((h) => `${h.book.id}${h.unit}`)).toEqual(["red3", "blue3"]);
    expect(searchRules(ALL, "HAVEN'T").map((h) => h.unit)).toEqual([1]);
    expect(fold("Всё")).toBe("все");
    expect(searchRules(ALL, "настоящее").map((h) => `${h.book.id}${h.unit}`)).toEqual(["red3"]);
  });

  it("ignores one-letter words and punctuation", () => {
    expect(queryTerms("a … the / used-to!")).toEqual(["the", "used-to"]);
    expect(searchRules(ALL, "  ")).toEqual([]);
  });
});

describe("highlight", () => {
  it("marks the query words where they start a word", () => {
    expect(highlight("Since then, since.", ["since"])).toEqual([
      { t: "Since", hit: true },
      { t: " then, ", hit: false },
      { t: "since", hit: true },
      { t: ".", hit: false },
    ]);
    expect(highlight("convince", ["vince"])).toEqual([{ t: "convince", hit: false }]);
  });
});
