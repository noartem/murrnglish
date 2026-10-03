// A unit's lesson: the app's own explanation of the grammar the unit's
// exercises practise, written for it in books/<id>/lessons/u<NNN>.md and
// compiled by scripts/lessons.mjs into the unit's JSON (the "lesson" field of
// data/units/unit-NNN.json and of data/course.json). Text arrives already
// split into runs, so the app renders it without parsing anything.

/** Inline text: plain strings and marked-up runs. */
export type Run =
  | string
  /** hl: highlighter, b: bold, i: italic, x: struck out (a wrong form) */
  | { s: "hl" | "b" | "i" | "x"; c: Run[] }
  /** a link to another unit of the same book */
  | { u: number; c: Run[] };
export type Text = Run[];

/** A mark on a timeline, positions 0 (far past) .. 50 (now) .. 100 (far future). */
export interface TimeMark {
  kind: "point" | "span" | "repeat" | "arrow";
  from: number;
  to: number;
  label?: Text;
}

export type Block =
  | { k: "p"; t: Text }
  /** a little story: an icon, narration lines and speech bubbles (a line
      with `who`, "" for a bubble without a name) */
  | { k: "scene"; icon?: string; title?: Text; lines: { who?: string; t: Text }[] }
  /** the main idea of a section, on an index card */
  | { k: "rule"; icon?: string; title?: Text; body: Text[] }
  /** a sticky note: a tip, a thing to remember */
  | { k: "note"; icon?: string; title?: Text; body: Text[] }
  /** tables of forms, side by side */
  | { k: "form"; title?: Text; tables: { head?: Text; rows: Text[][] }[] }
  | { k: "examples"; icon?: string; title?: Text; items: { t: Text; gloss?: Text }[] }
  /** columns to hold against each other; ✓ / ✗ headings colour them */
  | { k: "compare"; title?: Text; cols: { head: Text; tone?: "good" | "bad"; items: Text[] }[] }
  | { k: "timeline"; title?: Text; marks: TimeMark[] }
  /** a typical mistake: the wrong form struck out, the right one after it */
  | { k: "trap"; title?: Text; pairs: { bad?: Text; good: Text }[]; body: Text[] }
  | { k: "words"; icon?: string; title?: Text; items: Text[] }
  | { k: "cards"; cards: { icon?: string; title: Text; body: Text[] }[] }
  /** check yourself: the answer shows on a tap, nothing is graded */
  | { k: "quiz"; title?: Text; items: { q: Text; a: Text }[] }
  | { k: "summary"; title?: Text; items: Text[] }
  | { k: "seealso"; items: { unit: number; t: Text }[] }
  /** blocks side by side (stacked on a phone) */
  | { k: "row"; blocks: Block[] };

export type BlockKind = Block["k"];

export interface LessonSection {
  letter: string;
  title: Text;
  blocks: Block[];
}

export interface Lesson {
  hook?: Text;
  goals: Text[];
  /** blocks before the first section: usually the opening scene */
  intro: Block[];
  sections: LessonSection[];
  /** reading time */
  minutes: number;
}

/** The plain text of some runs. */
export function plain(t: Text): string {
  return t.map((r) => (typeof r === "string" ? r : plain(r.c))).join("");
}
