// Which exercises may lean on the book page the app no longer shows: a
// picture, a map, a table, a box of words. Prints one line per suspect for a
// person to go through; an exercise that carries its scene or its cues (see
// src/data.ts) is left out, as are the reasons its text already answers.
//
//   node scripts/audit_exercises.mjs [book] [--all]
//
// --all lists the resolved ones too. src/exercises.test.ts keeps the fixed
// ones fixed; this script is the finder, not the gate.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const all = args.includes("--all");
const only = args.find((a) => !a.startsWith("--"));

/** Words in an instruction that point at something printed beside it. */
export const PAGE_WORDS =
  /\b(pictures?|photos?|maps?|tables?|diagrams?|charts?|look at|information|below|on the left|on the right|section [a-e])\b|картин|рисун|изображ|посмотр|таблиц|карт[аеуы]|схем|информац|раздел/i;

/** An instruction that names a list of words to use. */
const LIST_WORDS = /\b(these|following|from the box|choose from)\b|рамк|эти слова|следующ|слова из/i;

/**
 * What an exercise needs from the page it came from: "names the page" and
 * "names a list…" are real gaps (src/exercises.test.ts holds them for the
 * units that have their lesson); "items with nothing to go on" is a hint for
 * the reader, often an item about the learner themself.
 */
export function suspects(ex) {
  const why = [];
  const items = ex.items ?? [];
  const cued = items.length > 0 && items.filter((it) => !it.example).every((it) => it.cue);
  // a matching exercise's left and right are its own two columns
  const text = ex.type === "matching" ? ex.instruction.replace(/on the (left|right)/gi, "") : ex.instruction;
  if (PAGE_WORDS.test(text) && !ex.scene && !cued) why.push("names the page");
  // the list is in the word bank, or after a colon in the instruction itself
  const listed = ex.wordBank?.length || /:\s*\S/.test(ex.instruction);
  if (LIST_WORDS.test(ex.instruction) && !listed) why.push("names a list of words it does not carry");
  if (!ex.scene) {
    const bare = items.filter((it) => {
      if (it.example || it.cue) return false;
      if (it.parts) return it.parts.join("").replace(/[\s.,!?’'–—-]/g, "").length < 4;
      if ("prompt" in it) return (it.prompt ?? "").trim().split(/\s+/).filter(Boolean).length < 2;
      return false;
    });
    if (bare.length) why.push(`items with nothing to go on: ${bare.map((it) => it.num).join(", ")}`);
  }
  return why;
}

function* exercises(book) {
  const data = join(root, "books", book, "data");
  for (const f of readdirSync(join(data, "units")).sort()) {
    const u = JSON.parse(readFileSync(join(data, "units", f), "utf8"));
    for (const ex of u.exercises) yield { where: `u${u.unit}`, ex };
  }
  for (const f of readdirSync(join(data, "additional")).sort()) {
    const a = JSON.parse(readFileSync(join(data, "additional", f), "utf8"));
    yield { where: `a${a.id}`, ex: a.exercise };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const books = readdirSync(join(root, "books")).filter((b) => !only || b === only);
  for (const book of books) {
    let n = 0;
    for (const { where, ex } of exercises(book)) {
      const why = suspects(ex);
      if (!why.length && !(all && (ex.scene || ex.items?.some((it) => it.cue)))) continue;
      n++;
      console.log(`${book} ${where} ${ex.id} [${ex.type}] ${why.join("; ") || "resolved"}\n    ${ex.instruction.replace(/\n/g, " / ").slice(0, 160)}`);
    }
    console.log(`${book}: ${n} exercise(s)\n`);
  }
}
