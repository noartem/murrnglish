// Build what the app serves from books/<id>/ and tell the app which books
// exist. Runs before `npm run dev` / `npm run build` (package.json
// predev/prebuild hooks).
//
// For every books/<id>/ with a book.json:
//   public/books/<id>/data/        copy of books/<id>/data/, each unit with
//                                  its lesson (books/<id>/lessons/u<NNN>.md,
//                                  compiled by scripts/lessons.mjs), plus
//   public/books/<id>/data/course.json   every exercise file in one pack
//   public/books/<id>/<cover>      the cover art
// The book's PDF is not served: the app has its own lessons, and book.pdf
// stays in books/<id>/ for the extraction pipelines alone.
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
// A lesson that fails to compile, breaks the rhythm rules or shares a run of
// words with the book's page text (books/<id>/work/pages/plain) fails the
// sync, and with it dev, build and test.
//
// Book ids share the first hash segment with the app's own sections
// (#/cards, #/dictionary, and #/rules, which old links still use) —
// src/routes.ts RESERVED_IDS — so those names are refused as book folders. The card decks are not the books': they
// live in decks/ and scripts/sync_decks.mjs builds them.

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
import { compileLesson, lintLesson, originality, shingles } from "./lessons.mjs";

// hash segments that are app sections, not books — keep equal to
// RESERVED_IDS in src/routes.ts (routes.test.ts compares the two)
const RESERVED = ["rules", "cards", "dictionary"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = join(root, "books");
const publicBooks = join(root, "public", "books");
const registryFile = join(root, "src", "generated", "books.json");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// copy only when the size or mtime differs: this runs before every dev start
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

/**
 * The book's lessons, unit number -> lesson; throws with every problem of
 * every lesson at once, so one run shows all there is to fix.
 */
function buildLessons(id, src, index) {
  const out = new Map();
  const dir = join(src, "lessons");
  if (!existsSync(dir)) return out;
  const titles = new Map();
  for (const [key, info] of Object.entries(index.exercises)) {
    const m = key.match(/^u(\d+)$/);
    if (m) titles.set(Number(m[1]), info.title);
  }
  // the book's own words, page by page (a line break is no break in a sentence)
  const plainDir = join(src, "work", "pages", "plain");
  const book = new Set();
  if (existsSync(plainDir))
    for (const f of readdirSync(plainDir))
      for (const sh of shingles(readFileSync(join(plainDir, f), "utf8").replace(/-\n(?=\p{Ll})/gu, "").replace(/\s+/g, " ")))
        book.add(sh);
  const problems = [];
  for (const f of readdirSync(dir).sort()) {
    const m = f.match(/^u(\d{3})\.md$/);
    if (!m) {
      if (f.endsWith(".md")) problems.push(`${f}: name it u<NNN>.md (u007.md)`);
      continue;
    }
    const n = Number(m[1]);
    const { lesson, errors } = compileLesson(readFileSync(join(dir, f), "utf8"), titles);
    if (!titles.has(n)) errors.push(`the book has no unit ${n}`);
    errors.push(...lintLesson(lesson));
    for (const hit of originality(lesson, book)) errors.push(`the book's own words: "${hit}"`);
    for (const e of errors) problems.push(`${f}: ${e}`);
    out.set(n, lesson);
  }
  need(!problems.length, `books/${id}/lessons:\n  ${problems.join("\n  ")}`);
  return out;
}

const ids = readdirSync(booksDir).filter((id) => existsSync(join(booksDir, id, "book.json")));
need(ids.length > 0, "no books/<id>/book.json found");

const registry = [];
for (const id of ids) {
  need(/^[a-z][a-z0-9-]*$/.test(id), `book id "${id}": lowercase letters, digits and dashes only`);
  need(!RESERVED.includes(id), `book id "${id}" is the name of an app section (${RESERVED.join(", ")})`);
  const src = join(booksDir, id);
  const meta = readJson(join(src, "book.json"));
  for (const k of ["order", "title", "edition", "level", "lang", "authors", "publisher", "color", "cover"]) {
    need(meta[k] !== undefined, `books/${id}/book.json: missing "${k}"`);
  }
  need(["en", "ru"].includes(meta.lang), `books/${id}/book.json: "lang" is "en" or "ru" (the language of its lessons)`);
  for (const f of [meta.cover.file, "data/index.json", "data/totals.json"]) {
    need(existsSync(join(src, f)), `books/${id}/${f} is missing`);
  }

  const dest = join(publicBooks, id);
  const dataDest = join(dest, "data");
  // data is rebuilt from scratch so a file deleted in books/ is gone here too
  rmSync(dataDest, { recursive: true, force: true });
  mkdirSync(dataDest, { recursive: true });
  cpSync(join(src, "data"), dataDest, { recursive: true });
  rmSync(join(dest, "book.pdf"), { force: true }); // served before the lessons
  copyIfChanged(join(src, meta.cover.file), join(dest, meta.cover.file));

  const index = readJson(join(src, "data", "index.json"));
  const lessons = buildLessons(id, src, index);
  const bundle = {
    units: pick(join(src, "data", "units"), /^unit-(\d+)\.json$/),
    additional: pick(join(src, "data", "additional"), /^(\d+)\.json$/),
  };
  for (const [n, lesson] of lessons) {
    const unit = bundle.units[String(n)];
    need(unit, `books/${id}/lessons: a lesson for unit ${n}, which the book does not have`);
    unit.lesson = lesson;
    writeFileSync(join(dataDest, "units", `unit-${String(n).padStart(3, "0")}.json`), JSON.stringify(unit));
  }
  const units = Object.keys(bundle.units).length;
  const additional = Object.keys(bundle.additional).length;
  need(units && additional, `books/${id}: empty course (${units} units, ${additional} additional)`);
  writeFileSync(join(dataDest, "course.json"), JSON.stringify(bundle));

  // the index must list exactly the files present, or the app would offer
  // units it cannot open
  const listed = index.groups.flatMap((g) => g.units).length;
  need(listed === units, `books/${id}: index.json lists ${listed} units, data/units has ${units}`);
  need(
    index.additional.exercises.length === additional,
    `books/${id}: index.json lists ${index.additional.exercises.length} additional, data/additional has ${additional}`,
  );

  // what the offline download stores (src/offline.ts bookUrls)
  const size = (f) => statSync(join(dest, f)).size;
  const downloadBytes = [meta.cover.file, "data/index.json", "data/totals.json", "data/course.json"]
    .map(size)
    .reduce((a, b) => a + b, 0);

  registry.push({ id, ...meta, units, additional, downloadBytes });
  console.log(
    `synced books/${id} -> public/books/${id} (${units} units, ${additional} additional, ${lessons.size} lessons)`,
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
