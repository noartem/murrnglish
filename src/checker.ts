// Answer normalization + checking. Pure functions, unit-tested in checker.test.ts.

import type { FillInItem } from "./data";

export function normalize(s: string): string {
  return s
    .trim()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s*'/g, "'")
    .replace(
      /\b(is|are|was|were|do|does|did|have|has|had|could|would|should|must|need|might|may|dare|used|ought)n't\b/g,
      "$1 not",
    )
    .replace(/\bcan't\b/g, "can not")
    .replace(/\bcannot\b/g, "can not")
    .replace(/\bwon't\b/g, "will not")
    .replace(/\bshan't\b/g, "shall not")
    .replace(/\bi'm\b/g, "i am")
    .replace(/\b([a-z]+)'re\b/g, "$1 are")
    .replace(/\b([a-z]+)'s\b/g, "$1 is")
    .replace(/\b([a-z]+)'ll\b/g, "$1 will")
    .replace(/\b([a-z]+)'ve\b/g, "$1 have")
    .replace(/\s+/g, " ")
    .replace(/[.?!]+$/, "")
    .trim();
}

const NO_WORD = new Set(["-", "–", "—"]);

export function checkFill(value: string, variants: string[]): boolean {
  if (!variants.length) return false;
  const v = normalize(value);
  if (!v || NO_WORD.has(v)) {
    // "–" is printed for items where no word is necessary; typed, it is no word too
    return variants.some((a) => NO_WORD.has(normalize(a)));
  }
  return variants.some((a) => normalize(a) === v);
}

export const checkWrite = checkFill;

export function checkChoice(selected: number | null, answer: number | number[]): boolean {
  if (selected === null) return false;
  return Array.isArray(answer) ? answer.includes(selected) : selected === answer;
}
export function checkMatching(selected: (number | null)[], pairs: [number, number][]): boolean[] {
  const answer = new Map(pairs.map(([l, r]) => [l, r]));
  return selected.map((s, i) => s !== null && answer.get(i) === s);
}

/**
 * A solved example as one line. Some examples carry their answer inside the
 * parts already ("She’s taking " + " a picture."), others only in answers
 * ("He’s" + "" with "hot.") — which the printed page used to show.
 */
export function exampleText(it: FillInItem): string {
  const squeeze = (s: string) => s.replace(/\s{2,}/g, " ").trim();
  const text = it.parts.join("");
  const answers = it.answers.map((a) => a[0] ?? "");
  if (answers.every((a) => !a || text.includes(a))) return squeeze(text);
  return squeeze(
    it.parts.map((p, i) => (i < answers.length ? `${p}${p && !/\s$/.test(p) ? " " : ""}${answers[i]}` : p)).join(""),
  );
}
