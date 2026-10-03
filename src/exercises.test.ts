// The exercises without the book page beside them: a unit that has its
// lesson has been gone through, so none of its exercises may still point at
// a picture, a map or a list that only the printed page had
// (scripts/audit_exercises.mjs finds them).

import { describe, expect, it } from "vitest";
import { suspects } from "../scripts/audit_exercises.mjs";
import type { UnitData } from "./data";

const units = import.meta.glob<UnitData>("../books/*/data/units/*.json", { eager: true, import: "default" });
const lessons = Object.keys(import.meta.glob("../books/*/lessons/*.md", { query: "?raw" }));

/** "../books/red/data/units/unit-007.json" -> ["red", 7] */
const where = (path: string): [string, number] => {
  const m = path.match(/books\/([^/]+)\/.*?(\d{3})\.(?:json|md)$/)!;
  return [m[1], Number(m[2])];
};

const unit = (book: string, n: number): UnitData => {
  const key = Object.keys(units).find((k) => {
    const [b, u] = where(k);
    return b === book && u === n;
  });
  return units[key!];
};

describe("the units with a lesson", () => {
  it.each(lessons.map(where))("%s unit %i needs nothing from the book page", (book, n) => {
    const gaps = unit(book, n).exercises.flatMap((ex) =>
      suspects(ex)
        .filter((w) => w.startsWith("names"))
        .map((w) => `${ex.id}: ${w}`),
    );
    expect(gaps).toEqual([]);
  });
});

describe("cues", () => {
  it("stand wherever an instruction sends the learner to them", () => {
    for (const [path, u] of Object.entries(units)) {
      for (const ex of u.exercises) {
        // the words the fixed instructions use ("описания ситуаций" are the prompts themselves)
        if (!/описания(?! ситуаций)|descriptions/i.test(ex.instruction)) continue;
        const bare = (ex.items ?? []).filter((it) => !("example" in it && it.example) && !it.cue);
        expect(!!ex.scene || bare.length === 0, `${where(path)[0]} ${ex.id}`).toBe(true);
      }
    }
  });
});
