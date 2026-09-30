// Build the card decks: decks/ -> src/generated/decks.json. Runs with
// sync_books.mjs before `npm run dev` / `build` / `test` (package.json).
//
// The decks are the app's own material, written for it and tied to no book:
// decks/index.json orders them into sections and groups, and each deck is
// decks/<section>/<id>.json (see src/deckdata.ts for the entry kinds). They
// are checked here, so a broken card fails the build instead of a review
// session, and packed into one file the app imports lazily — a chunk with a
// hashed name, so a deploy never pairs the app with stale decks.
//
//   node scripts/sync_decks.mjs            check and build
//   node scripts/sync_decks.mjs --format   also rewrite decks/**/*.json in the
//                                          house style: one entry per line
//
// Deck and entry ids go into card ids ("d:<deck>:<entry>") and URLs
// (#/cards/<deck>), so they are [a-z0-9-] and must stay put once published:
// renaming one orphans the review history of its cards.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// deck names that #/cards/<deck> gives other meanings — keep equal to
// DECK_RESERVED in src/routes.ts (routes.test.ts compares the two)
const RESERVED = ["all", "words"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const ASKS = ["translate", "meaning"];
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const decksDir = join(root, "decks");
const outFile = join(root, "src", "generated", "decks.json");
const format = process.argv.includes("--format");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const text = (s) => typeof s === "string" && s.trim() !== "";

/** "She [has lived|live] in [Paris]" -> the gaps, each answers + hint; null when the brackets are broken. */
function gapsOf(en) {
  const out = [];
  let rest = en;
  for (;;) {
    const open = rest.indexOf("[");
    const close = rest.indexOf("]");
    if (open < 0) return close < 0 ? out : null;
    if (close < open) return null;
    const body = rest.slice(open + 1, close);
    if (body.includes("[")) return null;
    const bar = body.indexOf("|");
    const answers = (bar < 0 ? body : body.slice(0, bar)).split("/").map((s) => s.trim());
    out.push({ answers, hint: bar < 0 ? "" : body.slice(bar + 1).trim() });
    rest = rest.slice(close + 1);
  }
}

function checkEntry(deck, e, at) {
  need(ID.test(e.id ?? ""), `${at}: id missing or not [a-z0-9-]`);
  for (const k of ["en", "ru", "ex", "note"]) need(e[k] === undefined || text(e[k]), `${at}: "${k}" is empty`);
  if (e.forms !== undefined) {
    need(Array.isArray(e.forms) && e.forms.length === 2 && e.forms.every(text), `${at}: forms needs two`);
    need(text(e.en) && !e.en.includes("[") && text(e.ru), `${at}: a forms entry needs en and ru`);
    return;
  }
  if (e.choice !== undefined) {
    need(Array.isArray(e.choice) && e.choice.length >= 2 && e.choice.every(text), `${at}: choice needs two options or more`);
    need(new Set(e.choice).size === e.choice.length, `${at}: repeated option`);
    if (e.en !== undefined) need(e.en.split("___").length === 2, `${at}: a choice sentence needs exactly one ___`);
    return;
  }
  need(text(e.en), `${at}: needs en`);
  const gaps = gapsOf(e.en);
  need(gaps !== null, `${at}: broken [gap] brackets`);
  need(gaps.every((g) => g.answers.every((a) => a !== "")), `${at}: a gap with an empty answer`);
  need(!e.en.includes("___"), `${at}: ___ is for choice sentences`);
  // a phrase to recall: the Russian is the question
  if (!gaps.length) need(text(e.ru), `${at}: a ${deck.ask ?? "translate"} entry needs ru`);
  need(e.alt === undefined || (Array.isArray(e.alt) && e.alt.every(text)), `${at}: alt is a list of phrases`);
}

function checkDeck(section, id, deck) {
  const where = `decks/${section}/${id}.json`;
  need(text(deck.title) && text(deck.about), `${where}: needs title and about`);
  need(LEVELS.includes(deck.level), `${where}: level is one of ${LEVELS.join(", ")}`);
  need(deck.ask === undefined || ASKS.includes(deck.ask), `${where}: ask is ${ASKS.join(" or ")}`);
  need(deck.prompt === undefined || text(deck.prompt), `${where}: prompt is empty`);
  need(Array.isArray(deck.entries) && deck.entries.length > 0, `${where}: no entries`);
  const seen = new Set();
  for (const e of deck.entries) {
    const at = `${where}: ${e.id}`;
    need(!seen.has(e.id), `${at}: repeated id`);
    seen.add(e.id);
    checkEntry(deck, e, at);
  }
}

/** One entry per line, the deck's own fields first: diffs stay one line per card. */
function houseStyle(deck) {
  const head = Object.entries(deck)
    .filter(([k]) => k !== "entries")
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const lines = deck.entries.map((e) => "    " + JSON.stringify(e).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "'));
  return `{\n${head.join("\n")}\n  "entries": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

const index = readJson(join(decksDir, "index.json"));
need(Array.isArray(index.sections) && index.sections.length, "decks/index.json: no sections");

const deckIds = new Set();
const sections = [];
let cards = 0;
for (const s of index.sections) {
  need(ID.test(s.id ?? "") && text(s.title) && text(s.about), `decks/index.json: section "${s.id}" needs id, title and about`);
  const dir = join(decksDir, s.id);
  need(existsSync(dir), `decks/${s.id}/ is missing`);
  const files = new Set(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)));
  const groups = [];
  for (const g of s.groups ?? []) {
    need(text(g.title) && Array.isArray(g.decks) && g.decks.length, `decks/index.json: ${s.id}: a group needs title and decks`);
    const decks = [];
    for (const id of g.decks) {
      need(ID.test(id) && !RESERVED.includes(id), `deck id "${id}": [a-z0-9-], and not ${RESERVED.join(" or ")}`);
      need(!deckIds.has(id), `deck "${id}" is listed twice`);
      deckIds.add(id);
      need(files.delete(id), `decks/${s.id}/${id}.json is missing`);
      const file = join(dir, `${id}.json`);
      const deck = readJson(file);
      checkDeck(s.id, id, deck);
      if (format) writeFileSync(file, houseStyle(deck));
      cards += deck.entries.length;
      decks.push({ id, ...deck });
    }
    groups.push({ title: g.title, decks });
  }
  need(files.size === 0, `decks/${s.id}/: not in decks/index.json: ${[...files].join(", ")}`);
  sections.push({ id: s.id, title: s.title, about: s.about, groups });
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ sections }));
console.log(`synced decks/ -> src/generated/decks.json (${deckIds.size} decks, ${cards} cards)`);
