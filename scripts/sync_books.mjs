// Build what the app serves from books/<id>/ and tell the app which books
// exist. Runs before `npm run dev` / `npm run build` (package.json
// predev/prebuild hooks).
//
// For every books/<id>/ with a book.json:
//   public/books/<id>/data/        copy of books/<id>/data/, plus
//   public/books/<id>/data/course.json   every exercise file in one pack
//   public/books/<id>/book.pdf     the book
//   public/books/<id>/<cover>      the cover art
// and src/generated/books.json — the registry the app imports: book.json
// plus what is counted here (units, additional exercises, download size), so
// nothing the app shows can drift from the files.
//
// Why the pack: the offline download used to pull every unit file and every
// additional file one by one — ~190 requests for 1.4 MB. course.json is that
// same data in a single request, and it gives the app a second source to read
// from when a per-unit fetch fails offline (src/data.ts loadBundle).
// Generated here rather than committed, so it cannot drift from data/ — the
// per-file JSON stays the source of truth.
//
// public/books/<id>/data/rules.json is the text of each unit's rule page for
// the rules compendium, read from books/<id>/work/pages/plain (see
// scripts/rules_text.mjs): { units: { "<n>": { s: sections, r: refs } } }.
// Units whose page text does not carry their own header are left out.
//
// books/<id>/data/packs.json (optional) is the book's word packs, hand-made
// (src/packs.ts): copied with data/ like the rest, and checked here so a
// broken list fails the build instead of a review session.
//
// Book ids share the first hash segment with the app's own sections
// (#/rules, #/cards, #/dictionary) and the second of #/cards/ with the deck
// names (all, words) — src/routes.ts RESERVED_IDS — so those names are
// refused as book folders.

import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRulePage, theoryPages } from "./rules_text.mjs";

// hash segments that are app sections or deck names, not books — keep equal
// to RESERVED_IDS in src/routes.ts (routes.test.ts compares the two)
const RESERVED = ["rules", "cards", "dictionary", "all", "words"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = join(root, "books");
const publicBooks = join(root, "public", "books");
const registryFile = join(root, "src", "generated", "books.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// copy only when the size or mtime differs: the book PDFs are 14–75 MB and
// this runs before every dev start
function copyIfChanged(src, dest) {
  const s = statSync(src);
  if (existsSync(dest)) {
    const d = statSync(dest);
    if (d.size === s.size && d.mtimeMs >= s.mtimeMs) return;
  }
  copyFileSync(src, dest);
}

// unit-001.json -> "1", 07.json -> "7" (the keys the fetchers ask for)
function pick(dir, re) {
  const out = {};
  for (const f of readdirSync(dir)) {
    const m = re.exec(f);
    if (m) out[String(Number(m[1]))] = readJson(join(dir, f));
  }
  return out;
}

// the word packs' shape (src/packs.ts): ids unique and URL-safe (they are in
// card ids and #/cards/<book>/pack-<id>), every entry answerable
function checkPacks(book, file, units) {
  const where = `books/${book}/data/packs.json`;
  need(Array.isArray(file.packs), `${where}: no "packs" list`);
  const packIds = new Set();
  for (const p of file.packs) {
    need(/^[a-z0-9-]+$/.test(p.id ?? "") && !packIds.has(p.id), `${where}: pack id "${p.id}" missing, repeated or not [a-z0-9-]`);
    packIds.add(p.id);
    need(p.title && p.about && ["forms", "translate", "gap"].includes(p.ask), `${where}: pack ${p.id} needs title, about and ask`);
    need(Array.isArray(p.entries) && p.entries.length, `${where}: pack ${p.id} has no entries`);
    for (const u of p.units ?? []) need(u >= 1 && u <= units, `${where}: pack ${p.id}: no unit ${u}`);
    const seen = new Set();
    for (const e of p.entries) {
      const at = `${where}: ${p.id}/${e.id}`;
      need(/^[a-z0-9-]+$/.test(e.id ?? "") && !seen.has(e.id), `${at}: id missing, repeated or not [a-z0-9-]`);
      seen.add(e.id);
      need(typeof e.en === "string" && e.en.trim() && typeof e.ru === "string" && e.ru.trim(), `${at}: needs en and ru`);
      if (p.ask === "forms") need(Array.isArray(e.forms) && e.forms.length === 2 && e.forms.every(Boolean), `${at}: needs two forms`);
      if (p.ask === "gap") need(/^[^[]*\[[^\]]+\][^[]*$/.test(e.en), `${at}: needs one [gap]`);
      if (e.unit !== undefined) need(e.unit >= 1 && e.unit <= units, `${at}: no unit ${e.unit}`);
    }
  }
  return file.packs;
}

const ids = readdirSync(booksDir).filter((id) => existsSync(join(booksDir, id, "book.json")));
need(ids.length > 0, "no books/<id>/book.json found");

const registry = [];
for (const id of ids) {
  need(/^[a-z][a-z0-9-]*$/.test(id), `book id "${id}": lowercase letters, digits and dashes only`);
  need(!RESERVED.includes(id), `book id "${id}" is the name of an app section (${RESERVED.join(", ")})`);
  const src = join(booksDir, id);
  const meta = readJson(join(src, "book.json"));
  for (const k of ["order", "title", "edition", "level", "authors", "publisher", "color", "cover"]) {
    need(meta[k] !== undefined, `books/${id}/book.json: missing "${k}"`);
  }
  for (const f of ["book.pdf", meta.cover.file, "data/index.json", "data/totals.json", "data/pages.json"]) {
    need(existsSync(join(src, f)), `books/${id}/${f} is missing`);
  }

  const dest = join(publicBooks, id);
  const dataDest = join(dest, "data");
  // data is rebuilt from scratch so a file deleted in books/ is gone here too
  rmSync(dataDest, { recursive: true, force: true });
  mkdirSync(dataDest, { recursive: true });
  cpSync(join(src, "data"), dataDest, { recursive: true });
  copyIfChanged(join(src, "book.pdf"), join(dest, "book.pdf"));
  copyIfChanged(join(src, meta.cover.file), join(dest, meta.cover.file));

  const bundle = {
    units: pick(join(src, "data", "units"), /^unit-(\d+)\.json$/),
    additional: pick(join(src, "data", "additional"), /^(\d+)\.json$/),
  };
  const units = Object.keys(bundle.units).length;
  const additional = Object.keys(bundle.additional).length;
  need(units && additional, `books/${id}: empty course (${units} units, ${additional} additional)`);
  writeFileSync(join(dataDest, "course.json"), JSON.stringify(bundle));

  // the index must list exactly the files present, or the app would offer
  // units it cannot open
  const index = readJson(join(src, "data", "index.json"));
  const listed = index.groups.flatMap((g) => g.units).length;
  need(listed === units, `books/${id}: index.json lists ${listed} units, data/units has ${units}`);
  need(
    index.additional.exercises.length === additional,
    `books/${id}: index.json lists ${index.additional.exercises.length} additional, data/additional has ${additional}`,
  );

  // the rules compendium's text: each unit's rule page, when the page text
  // is this book's own (its header names the unit)
  const rules = {};
  const plainDir = join(src, "work", "pages", "plain");
  for (const [key, info] of Object.entries(index.exercises)) {
    const m = key.match(/^u(\d+)$/);
    if (!m) continue;
    const file = join(plainDir, `p${String(theoryPages(info.pages)[0]).padStart(3, "0")}.txt`);
    if (!existsSync(file)) continue;
    const rule = parseRulePage(readFileSync(file, "utf8"), Number(m[1]), info.title);
    if (rule) rules[m[1]] = rule;
  }
  writeFileSync(join(dataDest, "rules.json"), JSON.stringify({ units: rules }));
  const ruleCount = Object.keys(rules).length;

  const packsFile = join(src, "data", "packs.json");
  const packs = existsSync(packsFile) ? checkPacks(id, readJson(packsFile), units) : [];

  // what the offline download stores (src/offline.ts bookUrls)
  const size = (f) => statSync(join(dest, f)).size;
  const downloadBytes = ["book.pdf", meta.cover.file, "data/index.json", "data/totals.json", "data/pages.json", "data/course.json", "data/rules.json", ...(packs.length ? ["data/packs.json"] : [])]
    .map(size)
    .reduce((a, b) => a + b, 0);

  registry.push({ id, ...meta, units, additional, downloadBytes, packs: packs.length });
  console.log(
    `synced books/${id} -> public/books/${id} (${units} units, ${additional} additional, rule text for ${ruleCount}, ${packs.length} word packs)`,
  );
}

// books removed from books/ disappear from public/ as well
if (existsSync(publicBooks)) {
  for (const d of readdirSync(publicBooks)) {
    if (!ids.includes(d)) rmSync(join(publicBooks, d), { recursive: true, force: true });
  }
}

registry.sort((a, b) => a.order - b.order);
mkdirSync(dirname(registryFile), { recursive: true });
writeFileSync(registryFile, JSON.stringify(registry, null, 2) + "\n");
