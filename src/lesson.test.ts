// The lesson compiler (scripts/lessons.mjs): the Markdown-with-blocks source
// of books/<id>/lessons/*.md into the JSON the app renders, its rhythm rules
// and the check against the book's own words.

import { describe, expect, it } from "vitest";
import { compileLesson, inline, lintLesson, originality, shingles } from "../scripts/lessons.mjs";
import type { Block, Lesson } from "./lesson";

const UNITS = new Map([
  [1, "Present continuous"],
  [2, "Present simple"],
]);

const FULL = `---
hook: 🚗 What's going on right now?
goals: say what is happening now · am/is/are + -ing
---
::: scene 🚗 Stuck in traffic
Mia is in her car.
> Mia: I'm ==driving==!
> Tom: OK.
> Just a thought.
:::

## Right now
The action has started and it has not finished.

:::: row
::: rule 💡
am/is/are + **-ing**
:::
::: form
# Positive
I | am | work==ing==
she | is | work==ing==
:::
::::

::: timeline
span now-10 now+10 | I'm driving
repeat past future | every day
point past
arrow now future | later
:::

## Around now
::: examples
- She's learning Italian. // not at this very moment
- They're building a house.
:::
::: compare Now or always?
# ✓ I'm working now.
- at this moment
# ✗ I work now.
- wrong here
:::
::: trap
✗ I ~~am work~~ now.
✓ I am working now.
Don't forget the -ing.
:::
::: words
now · at the moment · these days
:::
::: cards
# 🍳 Habits
I cook every day.
# 🌍 Facts
Water boils at 100°C.
:::
::: note
Say _right now_ to stress it.
:::
::: quiz
? She ___ (work) now.
= is working
:::
::: summary
- am/is/are + -ing
- for now and around now
:::
::: seealso
u2
u2 the other present
:::
`;

describe("inline", () => {
  it("parses the marks and nests them", () => {
    expect(inline("a ==b **c**== d")).toEqual(["a ", { s: "hl", c: ["b ", { s: "b", c: ["c"] }] }, " d"]);
    expect(inline("~~I am work~~ and _this_")).toEqual([{ s: "x", c: ["I am work"] }, " and ", { s: "i", c: ["this"] }]);
  });

  it("leaves blanks and snake_case alone", () => {
    expect(inline("She ___ (work).")).toEqual(["She ___ (work)."]);
    expect(inline("a_b_c")).toEqual(["a_b_c"]);
  });

  it("links units, checked against the book", () => {
    expect(inline("see [[u2]] or [[u1|this one]]", [], UNITS)).toEqual([
      "see ",
      { u: 2, c: ["Unit 2"] },
      " or ",
      { u: 1, c: ["this one"] },
    ]);
    const err: string[] = [];
    inline("[[u9]]", err, UNITS);
    expect(err).toEqual(["link to a unit this book does not have: u9"]);
  });

  it("curls the apostrophe between letters", () => {
    expect(inline("I'm here, 'quoted'")).toEqual(["I’m here, 'quoted'"]);
  });

  it("reports an unclosed mark and keeps its text", () => {
    const err: string[] = [];
    expect(inline("a ==b", err)).toEqual(["a ", "b"]);
    expect(err).toHaveLength(1);
  });
});

describe("compileLesson", () => {
  const { lesson, errors } = compileLesson(FULL, UNITS);
  const kinds = (bs: Block[]): string[] => bs.flatMap((b) => (b.k === "row" ? ["row", ...kinds(b.blocks)] : [b.k]));

  it("compiles every kind of block without errors", () => {
    expect(errors).toEqual([]);
    expect(kinds(lesson.intro)).toEqual(["scene"]);
    expect(lesson.sections.map((s) => s.letter)).toEqual(["A", "B"]);
    expect(kinds(lesson.sections[0].blocks)).toEqual(["p", "row", "rule", "form", "timeline"]);
    expect(kinds(lesson.sections[1].blocks)).toEqual([
      "examples",
      "compare",
      "trap",
      "words",
      "cards",
      "note",
      "quiz",
      "summary",
      "seealso",
    ]);
    expect(lintLesson(lesson)).toEqual([]);
  });

  it("reads the front matter", () => {
    expect(lesson.hook).toEqual(["🚗 What’s going on right now?"]);
    expect(lesson.goals).toEqual([["say what is happening now"], ["am/is/are + -ing"]]);
    expect(lesson.minutes).toBeGreaterThanOrEqual(1);
  });

  it("tells narration from bubbles", () => {
    const scene = lesson.intro[0] as Extract<Block, { k: "scene" }>;
    expect(scene.icon).toBe("🚗");
    expect(scene.title).toEqual(["Stuck in traffic"]);
    expect(scene.lines.map((l) => l.who)).toEqual([undefined, "Mia", "Tom", ""]);
  });

  it("builds tables, timelines, pairs and links", () => {
    const [, row, tl] = lesson.sections[0].blocks;
    const form = (row as Extract<Block, { k: "row" }>).blocks[1] as Extract<Block, { k: "form" }>;
    expect(form.tables[0].head).toEqual(["Positive"]);
    expect(form.tables[0].rows[1]).toEqual([["she"], ["is"], ["work", { s: "hl", c: ["ing"] }]]);
    expect((tl as Extract<Block, { k: "timeline" }>).marks).toEqual([
      { kind: "span", from: 40, to: 60, label: ["I’m driving"] },
      { kind: "repeat", from: 18, to: 82, label: ["every day"] },
      { kind: "point", from: 18, to: 18 },
      { kind: "arrow", from: 50, to: 82, label: ["later"] },
    ]);
    const b = lesson.sections[1].blocks;
    const compare = b[1] as Extract<Block, { k: "compare" }>;
    expect(compare.cols.map((c) => c.tone)).toEqual(["good", "bad"]);
    const trap = b[2] as Extract<Block, { k: "trap" }>;
    expect(trap.pairs).toEqual([{ bad: ["I ", { s: "x", c: ["am work"] }, " now."], good: ["I am working now."] }]);
    expect(trap.body).toEqual([["Don’t forget the -ing."]]);
    const see = b[8] as Extract<Block, { k: "seealso" }>;
    expect(see.items).toEqual([
      { unit: 2, t: ["Present simple"] },
      { unit: 2, t: ["the other present"] },
    ]);
  });

  it("reports what is wrong, with the line", () => {
    const { errors } = compileLesson("::: wobble\nx\n:::\n\n::: trap\n✗ only wrong\n:::\n\n::: seealso\nu7\n:::\n", UNITS);
    expect(errors).toEqual([
      'line 1: unknown block "::: wobble"',
      "line 5: trap: a ✗ line without the ✓ after it",
      "line 5: trap: no ✓ line",
      "line 9: seealso: this book has no unit 7",
    ]);
  });
});

describe("lintLesson", () => {
  const lint = (src: string) => lintLesson(compileLesson(src).lesson as Lesson);

  it("refuses a wall of text", () => {
    const long = Array.from({ length: 80 }, () => "word").join(" ");
    const errors = lint(`## One\n\n${long}\n\na\n\nb\n\nc\n\nd\n`);
    expect(errors).toContain("section A (One): a paragraph of 80 words (at most 70)");
    expect(errors).toContain("section A (One): more than 3 paragraphs in a row");
    expect(errors).toContain("section A (One): nothing but paragraphs");
    expect(errors).toContain("fewer than two sections");
    expect(errors).toContain("no goals in the front matter");
    expect(errors).toContain("no summary");
  });
});

describe("originality", () => {
  it("finds a run of eight of the book's words", () => {
    const book = shingles("We use the present continuous for something that is happening at the time of speaking.");
    const own = compileLesson("A thing that is happening at the time of speaking is here.").lesson as Lesson;
    expect(originality(own, book)).toEqual(["that is happening at the time of speaking"]);
    const fresh = compileLesson("Something going on right now, as you talk.").lesson as Lesson;
    expect(originality(fresh, book)).toEqual([]);
  });
});
