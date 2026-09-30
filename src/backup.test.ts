// The study backup: what a file must hold to be accepted, and the merge that
// brings a backup from another device in without losing anything here.

import { describe, expect, it } from "vitest";
import { cleanSettings, cleanSrs, makeBackup, mergeBackup, parseBackup } from "./backup";
import type { CardState } from "./srs";
import type { Word } from "./words";

const word = (id: string, updated: number, translation = "t"): Word => ({
  id,
  word: id,
  translation,
  notes: "",
  reverse: true,
  added: updated,
  updated,
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

describe("backup file", () => {
  it("round-trips through JSON", () => {
    const b = makeBackup([word("a", 1)], { states: { x: state(5) }, suspended: ["y"] }, cleanSettings(null), 9);
    expect(parseBackup(JSON.stringify(b))).toEqual(b);
  });

  it("refuses what is not a study backup and drops broken entries", () => {
    expect(parseBackup("not json")).toBeNull();
    expect(parseBackup(JSON.stringify({ answers: {}, results: {} }))).toBeNull(); // a progress file
    const b = parseBackup(
      JSON.stringify({
        format: "murrnglish-study",
        words: [word("a", 1), { id: "b" }],
        srs: { states: { x: state(1), y: { kind: "review" } }, suspended: ["s", 3] },
      }),
    )!;
    expect(b.words.map((w) => w.id)).toEqual(["a"]);
    expect(Object.keys(b.srs.states)).toEqual(["x"]);
    expect(b.srs.suspended).toEqual(["s"]);
    expect(b.settings).toEqual(cleanSettings(null));
  });

  it("clamps settings", () => {
    expect(cleanSettings({ newPerDay: -3, reviewsPerDay: 1e9, typeAnswers: "yes" })).toEqual({
      newPerDay: 0,
      reviewsPerDay: 9999,
      typeAnswers: true,
    });
    expect(cleanSrs("junk")).toEqual({ states: {}, suspended: [] });
  });
});

describe("mergeBackup", () => {
  it("keeps the newer of each word and card, and every suspension", () => {
    const mine = [word("a", 10, "mine"), word("b", 10, "mine")];
    const srs = { states: { x: state(100), y: state(100) }, suspended: ["p"] };
    const incoming = makeBackup(
      [word("a", 5, "old"), word("b", 20, "theirs"), word("c", 1, "new")],
      { states: { x: state(50), y: state(200), z: state(1) }, suspended: ["q", "p"] },
      cleanSettings(null),
      0,
    );
    const r = mergeBackup(mine, srs, incoming);
    expect(r.words.map((w) => [w.id, w.translation])).toEqual([
      ["c", "new"],
      ["a", "mine"],
      ["b", "theirs"],
    ]);
    expect(r.srs.states.x.last).toBe(100);
    expect(r.srs.states.y.last).toBe(200);
    expect(r.srs.states.z.last).toBe(1);
    expect(r.srs.suspended.sort()).toEqual(["p", "q"]);
    expect([r.added, r.updated, r.cards]).toEqual([1, 1, 2]);
  });
});
