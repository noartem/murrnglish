// Unit cards against the real book data: which items become cards, and that
// every card of every book is well formed (an answer on its back, a stable
// unique id).

import { describe, expect, it } from "vitest";
import type { UnitData } from "./data";
import { cardAnswerText, unitCards } from "./cards";

const files = import.meta.glob<UnitData>("../books/*/data/units/unit-*.json", {
  eager: true,
  import: "default",
});
const byBook = new Map<string, UnitData[]>();
for (const [path, unit] of Object.entries(files)) {
  const book = path.split("/")[2];
  byBook.set(book, [...(byBook.get(book) ?? []), unit]);
}
const unit = (book: string, n: number) => byBook.get(book)!.find((u) => u.unit === n)!;
const ids = (book: string, n: number) => unitCards(book, unit(book, n)).map((c) => c.id);

describe("unitCards", () => {
  it("makes cloze cards from keyed gaps", () => {
    const c = unitCards("blue", unit("blue", 12)).find((x) => x.id === "blue:12.1:2");
    expect(c).toMatchObject({
      kind: "cloze",
      unit: 12,
      exercise: "12.1",
      instruction: "Write for or since.",
      parts: ["Paul has lived in Brazil ", " ten years."],
      answers: [["for"]],
    });
  });

  it("leaves out what needs the printed page", () => {
    const blue12 = ids("blue", 12);
    // "Look at each answer and choose the right question": the answer is not on the card
    expect(blue12.some((id) => id.startsWith("blue:12.2:"))).toBe(false);
    // "Read the situations and complete": the situation is not on the card
    expect(blue12.some((id) => id.startsWith("blue:12.3:"))).toBe(false);
  });

  it("keeps verb forms, translations and word-box gaps", () => {
    const red12 = unitCards("red", unit("red", 12));
    expect(red12.find((c) => c.id === "red:12.2:2")).toMatchObject({ kind: "cloze", answers: [["saw"]] });
    expect(red12.find((c) => c.id === "red:12.6:1")).toMatchObject({ kind: "write", prompt: "Вчера я работал весь день." });
    expect(red12.some((c) => c.id.startsWith("red:12.1:") && c.wordBank?.length)).toBe(true);
    // self-check has model answers only
    expect(red12.some((c) => c.exercise === "12.5")).toBe(false);
  });

  it("ends a running-text item at its last full sentence", () => {
    const c = unitCards("red", unit("red", 12)).find((x) => x.id === "red:12.3:1");
    expect(c).toMatchObject({ kind: "cloze", parts: ["Last Tuesday Lisa ", " from London to Madrid."] });
  });

  it("drops printed examples that show their own answer", () => {
    expect(ids("blue", 1)).not.toContain("blue:1.1:1");
  });

  it("keeps choices between versions of one sentence", () => {
    const c = unitCards("blue", unit("blue", 86)).find((x) => x.id === "blue:86.4:1");
    expect(c).toMatchObject({ kind: "choice", answer: [1] });
    expect(c && cardAnswerText(c)).toBe("She didn’t tell anybody");
  });

  for (const [book, units] of byBook) {
    it(`makes well-formed cards for every unit of ${book}`, () => {
      const all = units.flatMap((u) => unitCards(book, u));
      expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
      for (const c of all) {
        expect(c.id.startsWith(`${book}:${c.exercise}:`)).toBe(true);
        expect(cardAnswerText(c).trim().length).toBeGreaterThan(0);
        if (c.kind === "cloze") expect(c.parts.length).toBeGreaterThanOrEqual(c.answers.length);
      }
      // a real deck for (almost) every unit, not a handful of survivors
      const empty = units.filter((u) => unitCards(book, u).length === 0).length;
      expect(empty).toBeLessThanOrEqual(Math.ceil(units.length * 0.05));
      expect(all.length).toBeGreaterThan(units.length * 10);
    });
  }
});
