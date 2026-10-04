// The data file: what a learner can move, and what the data window will
// accept on the way back in. The file is the only way out of this browser,
// so a round trip that loses a target loses work.

import { describe, expect, it } from "vitest";
import { makeBackup, cleanSettings } from "./backup";
import { DATA_FORMAT, makeDataFile, parseIncoming } from "./datatransfer";
import type { Progress } from "./progress";
import type { CardState } from "./srs";
import type { Word } from "./words";

const progress = (unit: number): Progress => ({
  answers: { [`${unit}.1`]: { items: { 1: ["is"] } } },
  results: { [`${unit}.1`]: { correct: 1, total: 1 } },
  selfMarks: {},
});

const word = (id: string): Word => ({
  id,
  word: id,
  translation: "t",
  notes: "",
  reverse: true,
  added: 1,
  updated: 1,
});

const state = (last: number): CardState => ({
  kind: "review",
  due: last + 86_400_000,
  ivl: 1,
  ease: 2.5,
  step: 0,
  reps: 1,
  lapses: 0,
  last,
});

// localStorage stands in for the browser's own store: makeDataFile reads the
// books' progress from it
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

describe("the data file", () => {
  it("round-trips every target it carries", () => {
    const file = makeDataFile(
      { books: ["red", "blue"], includeAnswers: true, cards: true, dictionary: true },
      9,
    );
    expect(parseIncoming(JSON.stringify(file))).toEqual({ kind: "data", file });
  });

  it("leaves an unticked target out entirely, not empty", () => {
    const file = makeDataFile(
      { books: [], includeAnswers: false, cards: false, dictionary: false },
      9,
    );
    expect(file.cards).toBeNull();
    expect(file.dictionary).toBeNull();
    expect(file.books).toEqual({});
  });

  it("leaves out the answer texts when they are not ticked", () => {
    store.set("murrnglish.red.progress-v1", JSON.stringify(progress(1)));
    const file = makeDataFile(
      { books: ["red"], includeAnswers: false, cards: false, dictionary: false },
      9,
    );
    expect(file.books.red.answers).toEqual({});
    expect(file.books.red.results).toEqual(progress(1).results);
  });

  it("reads the older study backup and the older progress file", () => {
    const backup = makeBackup(
      [word("a")],
      { states: { x: state(5) }, suspended: ["y"] },
      cleanSettings(null),
      3,
    );
    const read = parseIncoming(JSON.stringify(backup));
    expect(read?.kind).toBe("study");

    const bare = parseIncoming(JSON.stringify(progress(2)));
    expect(bare).toEqual({ kind: "progress", progress: progress(2) });
  });

  it("refuses what is not one of its files", () => {
    expect(parseIncoming("not json")).toBeNull();
    expect(parseIncoming(JSON.stringify({ answers: {}, results: {} }))).toBeNull();
    // a data file of a version this app does not know
    expect(parseIncoming(JSON.stringify({ format: DATA_FORMAT, version: 9 }))).toBeNull();
  });

  it("keeps the other targets when one book id is not in this app", () => {
    const file = {
      format: DATA_FORMAT,
      version: 2,
      exported: 1,
      books: { green: progress(3), red: progress(4) },
      cards: { srs: { states: { x: state(5) }, suspended: [] }, settings: cleanSettings(null) },
      dictionary: { words: [word("a"), { id: "broken" }] },
    };
    const read = parseIncoming(JSON.stringify(file));
    expect(read?.kind).toBe("data");
    if (read?.kind !== "data") return;
    // the unknown id survives parsing so the window can say "not in this
    // app" and skip it; the targets beside it are untouched
    expect(Object.keys(read.file.books)).toEqual(["green", "red"]);
    expect(read.file.cards).not.toBeNull();
    expect(read.file.dictionary?.words.map((w) => w.id)).toEqual(["a"]);
  });
});