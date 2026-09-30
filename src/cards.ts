// Unit card decks: flash cards made from a unit's own exercises, with the
// book's answer key as the back of the card. Derived from the packed course
// (data/course.json, see data.ts) whenever a deck is opened, so they cannot
// drift from the exercises and cost nothing extra to download: the offline
// copy of a book already carries the pack.
//
// What makes a card: an exercise item that can be answered from the card
// alone and has one right answer in the key. The printed book gives context
// the data does not carry (pictures, a situation printed above the items), so
// an item is left out when its answer depends on that:
//
//   fill-in   every gap has a keyed answer of at most five words, and there
//             is enough sentence around the gaps to know what goes there.
//             Exercises built on pictures or situations only keep items that
//             still carry their own clue — a word box, or a "(verb)" hint.
//   choice    every option is a full sentence and the options are versions
//             of the same sentence ("Which is right?"). Options that are two
//             different sentences are answers to something the card does not
//             show ("Look at each answer and choose the right question").
//   write     a prompt of at least two words; picture exercises need a
//             prompt long enough to stand on its own (four words).
//   matching  every keyed pair: the left side asks, the right side answers.
//   self-check  never — the key only has model answers.
//
// Exercises asking for the learner's own ideas are skipped whatever their
// type. The generated ids are "<book>:<exercise>:<item>" — stable across data
// fixes, so review history stays attached to the item it was made from.

import type { ChoiceItem, Exercise, FillInItem, UnitData, WriteItem } from "./data";

interface CardBase {
  /** "<book>:<exercise>:<item>", the key of the card's review state */
  id: string;
  book: string;
  unit: number;
  /** the exercise id, "12.3" */
  exercise: string;
  instruction: string;
  wordBank?: string[];
}

export type UnitCard =
  | (CardBase & { kind: "cloze"; parts: string[]; answers: string[][] })
  | (CardBase & { kind: "choice"; options: string[]; answer: number[] })
  | (CardBase & { kind: "write"; prompt: string; answers: string[] })
  | (CardBase & { kind: "match"; left: string; right: string });

/** A card's own fields, per kind (Omit alone would merge the union). */
type CardBody = UnitCard extends infer C ? (C extends CardBase ? Omit<C, keyof CardBase> : never) : never;

const OWN = /own ideas|your own|about (yourself|you)\b|true for you|о себе|своими|свои (ответы|предложения|идеи)|о вас\b|о своей|о своём/i;
const PICTURE = /pictur|photo|\bmaps?\b|drawing|картин|рисун|фото|\bкарт[аеуы]\b/i;
const SITUATION = /situation|ситуаци/i;

const words = (s: string) => s.replace(/[\[\]()…_.,!?;:"“”‘’'–—-]+/g, " ").trim().split(/\s+/).filter(Boolean);
const wordCount = (s: string) => words(s).length;

function fillCard(ex: Exercise, it: FillInItem, contextual: boolean): Omit<UnitCard & { kind: "cloze" }, keyof CardBase> | null {
  const gaps = it.answers.length;
  if (!gaps || it.parts.length < gaps) return null;
  if (it.answers.some((vs) => !vs.length || !vs[0].trim())) return null;
  // long keyed answers are free rewrites of a sentence the card does not show
  if (it.answers.some((vs) => wordCount(vs[0]) > 5)) return null;
  const text = it.parts.join(" ");
  const n = wordCount(text);
  const shortAnswers = it.answers.every((vs) => wordCount(vs[0]) <= 2);
  if (n < 1 || (n < 3 && !shortAnswers)) return null;
  if (contextual && !ex.wordBank?.length && !/\(/.test(text)) return null;
  // a printed example sometimes carries its answer beside the gap ("She's
  // taking ___ a picture" -> taking): the card would give itself away
  const low = (s: string) => s.toLowerCase().replace(/’/g, "'").trim();
  for (let i = 0; i < gaps; i++) {
    const a = low(it.answers[i][0]);
    if (a.length > 1 && (low(it.parts[i]).endsWith(a) || low(it.parts[i + 1] ?? "").startsWith(a))) return null;
  }
  return { kind: "cloze", parts: trimTail(it.parts), answers: it.answers };
}

// Items of a running text end where the next item begins: "Last Tuesday Lisa
// ___ from London to Madrid. She". The card stops at the last full sentence.
function trimTail(parts: string[]): string[] {
  const last = parts[parts.length - 1];
  const m = last.match(/^([\s\S]*?[.!?…][”’"]?)\s+[^.!?…]+$/);
  if (!m || !/[A-Za-zА-Яа-я]/.test(last)) return parts;
  return [...parts.slice(0, -1), m[1]];
}

function jaccard(a: string, b: string): number {
  const x = new Set(words(a.toLowerCase()));
  const y = new Set(words(b.toLowerCase()));
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both || 1);
}

function choiceCard(it: ChoiceItem): Omit<UnitCard & { kind: "choice" }, keyof CardBase> | null {
  const answer = (Array.isArray(it.answer) ? it.answer : [it.answer]).filter(
    (i) => Number.isInteger(i) && i >= 0 && i < it.options.length,
  );
  if (it.options.length < 2 || !answer.length) return null;
  if (it.options.some((o) => wordCount(o) < 3)) return null;
  for (let i = 0; i < it.options.length; i++)
    for (let j = i + 1; j < it.options.length; j++)
      if (jaccard(it.options[i], it.options[j]) < 0.5) return null;
  return { kind: "choice", options: it.options, answer };
}

function writeCard(it: WriteItem, picture: boolean): Omit<UnitCard & { kind: "write" }, keyof CardBase> | null {
  const answers = it.answers.filter((a) => a.trim());
  if (!answers.length) return null;
  const n = wordCount(it.prompt);
  if (n < 2 || (picture && n < 4)) return null;
  return { kind: "write", prompt: it.prompt, answers };
}

/** Every card of one unit, in the order of its exercises. */
export function unitCards(bookId: string, unit: UnitData): UnitCard[] {
  const out: UnitCard[] = [];
  const seen = new Set<string>();
  for (const ex of unit.exercises) {
    if (OWN.test(ex.instruction)) continue;
    const picture = PICTURE.test(ex.instruction);
    const base = (key: string | number): CardBase => ({
      id: `${bookId}:${ex.id}:${key}`,
      book: bookId,
      unit: unit.unit,
      exercise: ex.id,
      instruction: ex.instruction,
      ...(ex.wordBank?.length ? { wordBank: ex.wordBank } : {}),
    });
    const push = (key: string | number, body: CardBody | null, front: string) => {
      if (!body) return;
      // a front seen before in this unit would be the same card twice
      const dedupe = `${ex.instruction}\u0000${front}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      out.push({ ...base(key), ...body } as UnitCard);
    };
    switch (ex.type) {
      case "fill-in":
        for (const it of (ex.items ?? []) as FillInItem[])
          push(it.num, fillCard(ex, it, picture || SITUATION.test(ex.instruction)), it.parts.join("_"));
        break;
      case "choice":
        if (picture) break;
        for (const it of (ex.items ?? []) as ChoiceItem[]) push(it.num, choiceCard(it), it.options.join("|"));
        break;
      case "write":
        for (const it of (ex.items ?? []) as WriteItem[]) push(it.num, writeCard(it, picture), it.prompt);
        break;
      case "matching": {
        if (picture) break;
        const left = ex.leftOptions ?? [];
        const right = ex.rightOptions ?? [];
        for (const [l, r] of ex.pairs ?? []) {
          if (!left[l]?.trim() || !right[r]?.trim()) continue;
          push(`m${l}`, { kind: "match", left: left[l], right: right[r] }, left[l]);
        }
        break;
      }
      default:
        break; // self-check: model answers only
    }
  }
  return out;
}

/** The first keyed answer of a card, as plain text (used by lists and tests). */
export function cardAnswerText(c: UnitCard): string {
  switch (c.kind) {
    case "cloze":
      return c.answers.map((vs) => vs[0]).join(" … ");
    case "choice":
      return c.answer.map((i) => c.options[i]).join(" / ");
    case "write":
      return c.answers[0];
    case "match":
      return c.right;
  }
}
