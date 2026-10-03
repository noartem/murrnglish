// The lessons: books/<id>/lessons/u<NNN>.md -> the "lesson" of that unit
// (types in src/lesson.ts). Run by sync_books.mjs, which puts each lesson into
// the unit's JSON and fails the sync on any error found here.
//
// The source is Markdown with blocks:
//
//   ---
//   hook: 🚗 What's going on right now?
//   goals: say what is happening now · am/is/are + -ing
//   ---
//   ::: scene 🚗 Stuck in traffic        <- a block: kind, icon, title
//   Mia is in her car. Her phone rings.  <- narration
//   > Mia: Sorry, I'm ==driving==!       <- a speech bubble
//   :::
//
//   ## Right now                         <- a section (lettered A, B, C…)
//   A paragraph.
//
//   :::: row                             <- the blocks inside side by side
//   ::: rule
//   …
//   :::
//   ::::
//
// Inline: ==highlight==, **bold**, _italic_, ~~wrong~~, [[u12]] or
// [[u12|text]] (a link to unit 12). A straight apostrophe between letters
// becomes ’, as in the exercises. Each kind's body is described at its parser
// below; README.md ("Lessons") has the catalogue.
//
// Lint (lintLesson): the lessons must not read as a wall of text — every
// section carries something besides paragraphs, no more than three
// paragraphs in a row, none longer than MAX_WORDS, at least MIN_KINDS kinds
// of block, and a summary. originality() holds a lesson against the text of
// the book's pages: no run of SHINGLE words may be the book's.

export const MAX_WORDS = 70;
export const MAX_PARAGRAPHS = 3;
export const MIN_KINDS = 4;
export const SHINGLE = 8;

const KINDS = [
  "scene",
  "rule",
  "note",
  "form",
  "examples",
  "compare",
  "timeline",
  "trap",
  "words",
  "cards",
  "quiz",
  "summary",
  "seealso",
];

// ---- inline --------------------------------------------------------------------

const MARKS = { "==": "hl", "**": "b", "~~": "x", _: "i" };

// an apostrophe between letters, or before a mark: I'm, I'==m==
const typo = (s) => s.replace(/(\p{L}|==|\*\*)'(?=\p{L}|==|\*\*)/gu, "$1’");

/**
 * Inline markup -> runs. `err` collects what is wrong (an unclosed mark, a
 * bad link); `units` are the unit numbers a link may point to.
 */
export function inline(src, err = [], units = null) {
  src = typo(src);
  const root = { c: [] };
  const stack = [root];
  let buf = "";
  const flush = () => {
    if (buf) stack[stack.length - 1].c.push(buf);
    buf = "";
  };
  for (let i = 0; i < src.length; ) {
    if (src.startsWith("[[", i)) {
      const end = src.indexOf("]]", i);
      const m = end > 0 ? src.slice(i + 2, end).match(/^u(\d+)(?:\|(.+))?$/) : null;
      if (!m) {
        err.push(`bad link in "${src}"`);
        buf += src.slice(i, end > 0 ? end + 2 : src.length);
        i = end > 0 ? end + 2 : src.length;
        continue;
      }
      const u = Number(m[1]);
      if (units && !units.has(u)) err.push(`link to a unit this book does not have: u${u}`);
      flush();
      stack[stack.length - 1].c.push({ u, c: inline(m[2] ?? `Unit ${u}`, err, units) });
      i = end + 2;
      continue;
    }
    const two = src.slice(i, i + 2);
    let mark = null;
    if (two === "==" || two === "**" || two === "~~") mark = two;
    else if (src[i] === "_" && src[i - 1] !== "_" && src[i + 1] !== "_") {
      // _italic_: opens before a word, closes after one — a blank (___) or
      // snake_case is text
      const open = /[\p{L}\p{N}(“‘"'-]/u.test(src[i + 1] ?? "") && !/[\p{L}\p{N}]/u.test(src[i - 1] ?? "");
      const close = /[\p{L}\p{N}.,!?)”’"'…]/u.test(src[i - 1] ?? "") && !/[\p{L}\p{N}]/u.test(src[i + 1] ?? "");
      const top = stack[stack.length - 1];
      if ((top.s === "i" && close) || (top.s !== "i" && open)) mark = "_";
    }
    if (!mark) {
      buf += src[i];
      i++;
      continue;
    }
    flush();
    const s = MARKS[mark];
    const top = stack[stack.length - 1];
    if (top.s === s) {
      stack.pop();
      stack[stack.length - 1].c.push({ s, c: top.c });
    } else {
      stack.push({ s, c: [] });
    }
    i += mark.length;
  }
  flush();
  if (stack.length > 1) err.push(`unclosed ${Object.keys(MARKS).find((k) => MARKS[k] === stack[stack.length - 1].s)} in "${src}"`);
  // an unclosed mark keeps its text
  while (stack.length > 1) {
    const top = stack.pop();
    stack[stack.length - 1].c.push(...top.c);
  }
  return root.c;
}

export function plain(t) {
  return t.map((r) => (typeof r === "string" ? r : plain(r.c))).join("");
}

// ---- blocks --------------------------------------------------------------------

/** "🚗 Stuck in traffic" -> icon + title; either may be missing. */
function head(args, err, units) {
  const m = args.match(/^(\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️\p{Emoji_Modifier}]*|[✓✗✔✘])\s*(.*)$/u);
  const icon = m ? m[1] : undefined;
  const title = (m ? m[2] : args).trim();
  return { icon, title: title ? inline(title, err, units) : undefined };
}

/** Blank-line separated paragraphs of `lines`, each joined into one. */
function paragraphs(lines, ctx) {
  const out = [];
  let cur = [];
  for (const l of [...lines, ""]) {
    if (l.trim()) cur.push(l.trim());
    else if (cur.length) {
      out.push(ctx.t(cur.join(" ")));
      cur = [];
    }
  }
  return out;
}

const nonEmpty = (lines) => lines.map((l) => l.trim()).filter(Boolean);
const item = (l) => l.replace(/^[-•]\s+/, "");

const POS = { past: 18, now: 50, future: 82 };
function pos(tok) {
  const m = tok.match(/^(past|now|future|\d+)([+-]\d+)?$/);
  if (!m) return null;
  const base = m[1] in POS ? POS[m[1]] : Number(m[1]);
  return Math.max(0, Math.min(100, base + Number(m[2] ?? 0)));
}

/**
 * Each kind's body. `ctx.t` makes inline text, `ctx.err` collects errors.
 */
const PARSE = {
  // narration lines; "> Who: text" is a speech bubble
  scene(h, lines, ctx) {
    const out = [];
    for (const l of nonEmpty(lines)) {
      const m = l.match(/^>\s*(?:([^:]{1,24}):\s+)?(.*)$/);
      // a bubble without a name has who "": still a bubble
      out.push(m ? { who: m[1]?.trim() ?? "", t: ctx.t(m[2]) } : { t: ctx.t(l) });
    }
    if (!out.length) ctx.err.push("scene: empty");
    return { icon: h.icon, title: h.title, lines: out };
  },
  rule(h, lines, ctx) {
    const body = paragraphs(lines, ctx);
    if (!body.length) ctx.err.push("rule: empty");
    return { icon: h.icon, title: h.title, body };
  },
  note(h, lines, ctx) {
    const body = paragraphs(lines, ctx);
    if (!body.length) ctx.err.push("note: empty");
    return { icon: h.icon, title: h.title, body };
  },
  // "# caption" starts a table; rows are "cell | cell | cell"
  form(h, lines, ctx) {
    const tables = [];
    for (const l of nonEmpty(lines)) {
      if (l.startsWith("# ")) tables.push({ head: ctx.t(l.slice(2)), rows: [] });
      else {
        if (!tables.length) tables.push({ rows: [] });
        tables[tables.length - 1].rows.push(l.split(/\s+\|\s+/).map((c) => ctx.t(c.trim())));
      }
    }
    if (!tables.some((t) => t.rows.length)) ctx.err.push("form: no rows");
    return { title: h.title, tables };
  },
  // "- sentence" or "- sentence // gloss"
  examples(h, lines, ctx) {
    const items = nonEmpty(lines).map((l) => {
      const [t, gloss] = item(l).split(/\s+\/\/\s+/);
      return gloss ? { t: ctx.t(t), gloss: ctx.t(gloss) } : { t: ctx.t(t) };
    });
    if (!items.length) ctx.err.push("examples: empty");
    return { icon: h.icon, title: h.title, items };
  },
  // "# heading" starts a column (✓ / ✗ first colours it); lines are its items
  compare(h, lines, ctx) {
    const cols = [];
    for (const l of nonEmpty(lines)) {
      if (l.startsWith("# ")) {
        const text = l.slice(2).trim();
        const tone = text.startsWith("✓") ? "good" : text.startsWith("✗") ? "bad" : undefined;
        cols.push({ head: ctx.t(tone ? text.slice(1).trim() : text), ...(tone ? { tone } : {}), items: [] });
      } else if (!cols.length) ctx.err.push(`compare: "${l}" before the first "# column"`);
      else cols[cols.length - 1].items.push(ctx.t(item(l)));
    }
    if (cols.length < 2) ctx.err.push("compare: needs two columns or more");
    return { title: h.title, cols };
  },
  // "point now | label", "span past now | label", "repeat past future",
  // "arrow now future"; positions past / now / future or 0–100, ±offset
  timeline(h, lines, ctx) {
    const marks = [];
    for (const l of nonEmpty(lines)) {
      const [spec, label] = l.split(/\s+\|\s+/);
      const [kind, a, b] = spec.trim().split(/\s+/);
      const from = a ? pos(a) : null;
      const to = b ? pos(b) : from;
      if (!["point", "span", "repeat", "arrow"].includes(kind) || from === null || to === null) {
        ctx.err.push(`timeline: bad mark "${l}"`);
        continue;
      }
      marks.push({ kind, from: Math.min(from, to), to: Math.max(from, to), ...(label ? { label: ctx.t(label.trim()) } : {}) });
    }
    if (!marks.length) ctx.err.push("timeline: no marks");
    return { title: h.title, marks };
  },
  // "✗ wrong" then "✓ right"; other lines are the explanation
  trap(h, lines, ctx) {
    const pairs = [];
    const rest = [];
    let bad;
    for (const l of lines) {
      const t = l.trim();
      if (t.startsWith("✗")) bad = ctx.t(t.slice(1).trim());
      else if (t.startsWith("✓")) {
        pairs.push(bad ? { bad, good: ctx.t(t.slice(1).trim()) } : { good: ctx.t(t.slice(1).trim()) });
        bad = undefined;
      } else rest.push(l);
    }
    if (bad) ctx.err.push("trap: a ✗ line without the ✓ after it");
    if (!pairs.length) ctx.err.push("trap: no ✓ line");
    return { title: h.title, pairs, body: paragraphs(rest, ctx) };
  },
  // "a · b · c", on one line or several
  words(h, lines, ctx) {
    const items = nonEmpty(lines)
      .flatMap((l) => l.split(/\s+·\s+/))
      .map((w) => ctx.t(w.trim()))
      .filter((t) => t.length);
    if (!items.length) ctx.err.push("words: empty");
    return { icon: h.icon, title: h.title, items };
  },
  // "# 🍳 Card title" starts a card; lines are its text
  cards(h, lines, ctx) {
    const cards = [];
    let body = [];
    const close = () => {
      if (cards.length) cards[cards.length - 1].body = paragraphs(body, ctx);
      body = [];
    };
    for (const l of lines) {
      if (l.trim().startsWith("# ")) {
        close();
        const c = head(l.trim().slice(2), ctx.err, ctx.units);
        cards.push({ ...(c.icon ? { icon: c.icon } : {}), title: c.title ?? [], body: [] });
      } else if (cards.length) body.push(l);
      else if (l.trim()) ctx.err.push(`cards: "${l.trim()}" before the first "# card"`);
    }
    close();
    if (cards.length < 2) ctx.err.push("cards: needs two cards or more");
    return { cards };
  },
  // "? question" then "= answer"
  quiz(h, lines, ctx) {
    const items = [];
    let q;
    for (const l of nonEmpty(lines)) {
      if (l.startsWith("?")) q = ctx.t(l.slice(1).trim());
      else if (l.startsWith("=") && q) {
        items.push({ q, a: ctx.t(l.slice(1).trim()) });
        q = undefined;
      } else ctx.err.push(`quiz: "${l}" is neither "? question" nor "= answer" after one`);
    }
    if (q) ctx.err.push("quiz: a question without its answer");
    if (!items.length) ctx.err.push("quiz: empty");
    return { title: h.title, items };
  },
  summary(h, lines, ctx) {
    const items = nonEmpty(lines).map((l) => ctx.t(item(l)));
    if (!items.length) ctx.err.push("summary: empty");
    return { title: h.title, items };
  },
  // "u12" (the unit's title) or "u12 text"
  seealso(h, lines, ctx) {
    const items = [];
    for (const l of nonEmpty(lines)) {
      const m = l.match(/^u(\d+)(?:\s+(.*))?$/);
      if (!m) {
        ctx.err.push(`seealso: "${l}" is not "u12 [text]"`);
        continue;
      }
      const unit = Number(m[1]);
      if (ctx.units && !ctx.units.has(unit)) ctx.err.push(`seealso: this book has no unit ${unit}`);
      items.push({ unit, t: ctx.t(m[2] ?? ctx.units?.get(unit) ?? `Unit ${unit}`) });
    }
    return { items };
  },
};

// ---- the file ------------------------------------------------------------------

/**
 * A lesson's source -> { lesson, errors }. `units` maps this book's unit
 * numbers to their titles (links and "see also" are checked against it).
 */
export function compileLesson(src, units = null) {
  const errors = [];
  const t = (s) => inline(s, errors, units);
  const ctx = { t, err: errors, units };
  const lines = src.replace(/\r\n?/g, "\n").split("\n");

  // front matter
  const meta = {};
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.indexOf("---", 1);
    if (end < 0) errors.push("front matter: no closing ---");
    for (const l of lines.slice(1, end < 0 ? 1 : end)) {
      const m = l.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
      else if (l.trim()) errors.push(`front matter: "${l}"`);
    }
    i = end < 0 ? 1 : end + 1;
  }
  for (const k of Object.keys(meta))
    if (!["hook", "goals"].includes(k)) errors.push(`front matter: unknown key "${k}"`);

  // blocks, paragraphs and sections, with :::: row around blocks
  const intro = [];
  const sections = [];
  let para = [];
  const target = () => (sections.length ? sections[sections.length - 1].blocks : intro);
  const flushPara = (into) => {
    if (para.length) into.push({ k: "p", t: t(para.join(" ")) });
    para = [];
  };
  const readBlock = (at, into) => {
    const m = lines[at].trim().match(/^:::\s*([a-z]+)\s*(.*)$/);
    const kind = m?.[1];
    const body = [];
    let j = at + 1;
    for (; j < lines.length && lines[j].trim() !== ":::"; j++) body.push(lines[j]);
    if (j >= lines.length) errors.push(`line ${at + 1}: "::: ${kind}" is never closed`);
    if (!kind || !PARSE[kind]) errors.push(`line ${at + 1}: unknown block "${lines[at].trim()}"`);
    else {
      const n = errors.length;
      const block = { k: kind, ...PARSE[kind](head(m[2] ?? "", errors, units), body, ctx) };
      for (let e = n; e < errors.length; e++) errors[e] = `line ${at + 1}: ${errors[e]}`;
      into.push(block);
    }
    return j + 1;
  };
  while (i < lines.length) {
    const raw = lines[i];
    const l = raw.trim();
    if (l.startsWith("::::")) {
      flushPara(target());
      if (!/^::::\s*row$/.test(l)) {
        errors.push(`line ${i + 1}: "${l}" — only ":::: row" groups blocks`);
        i++;
        continue;
      }
      const row = { k: "row", blocks: [] };
      i++;
      while (i < lines.length && lines[i].trim() !== "::::") {
        if (lines[i].trim().startsWith(":::")) i = readBlock(i, row.blocks);
        else {
          if (lines[i].trim()) errors.push(`line ${i + 1}: only blocks go in a row`);
          i++;
        }
      }
      if (i >= lines.length) errors.push("\":::: row\" is never closed");
      if (row.blocks.length < 2) errors.push(`a row with ${row.blocks.length} block(s): side by side needs two or more`);
      target().push(row);
      i++;
    } else if (l.startsWith(":::")) {
      flushPara(target());
      i = readBlock(i, target());
    } else if (l.startsWith("## ")) {
      flushPara(target());
      sections.push({ letter: String.fromCharCode(65 + sections.length), title: t(l.slice(3).trim()), blocks: [] });
      i++;
    } else if (l.startsWith("#")) {
      errors.push(`line ${i + 1}: only "## " headings make sections`);
      i++;
    } else if (!l) {
      flushPara(target());
      i++;
    } else {
      para.push(l);
      i++;
    }
  }
  flushPara(target());

  const lesson = {
    ...(meta.hook ? { hook: t(meta.hook) } : {}),
    goals: (meta.goals ?? "")
      .split(/\s+·\s+/)
      .filter(Boolean)
      .map((g) => t(g)),
    intro,
    sections,
    minutes: 1,
  };
  lesson.minutes = Math.max(1, Math.round(words(lessonText(lesson)).length / 130));
  return { lesson, errors };
}

// ---- text, lint, originality ------------------------------------------------------

function blockTexts(b) {
  switch (b.k) {
    case "p":
      return [b.t];
    case "scene":
      return [b.title ?? [], ...b.lines.map((l) => l.t)];
    case "rule":
    case "note":
      return [b.title ?? [], ...b.body];
    case "form":
      return [b.title ?? [], ...b.tables.flatMap((t) => [t.head ?? [], ...t.rows.flat()])];
    case "examples":
      return [b.title ?? [], ...b.items.flatMap((x) => [x.t, x.gloss ?? []])];
    case "compare":
      return [b.title ?? [], ...b.cols.flatMap((c) => [c.head, ...c.items])];
    case "timeline":
      return [b.title ?? [], ...b.marks.map((m) => m.label ?? [])];
    case "trap":
      return [b.title ?? [], ...b.pairs.flatMap((p) => [p.bad ?? [], p.good]), ...b.body];
    case "words":
    case "summary":
      return [b.title ?? [], ...b.items];
    case "cards":
      return b.cards.flatMap((c) => [c.title, ...c.body]);
    case "quiz":
      return [b.title ?? [], ...b.items.flatMap((x) => [x.q, x.a])];
    case "seealso":
      return [];
    case "row":
      return b.blocks.flatMap(blockTexts);
  }
  return [];
}

/** Every text of the lesson, one per line. */
export function lessonText(lesson) {
  const all = [
    lesson.hook ?? [],
    ...lesson.goals,
    ...lesson.intro.flatMap(blockTexts),
    ...lesson.sections.flatMap((s) => [s.title, ...s.blocks.flatMap(blockTexts)]),
  ];
  return all
    .map(plain)
    .filter((s) => s.trim())
    .join("\n");
}

const words = (s) =>
  s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/ё/g, "е")
    .match(/[\p{L}\p{N}']+/gu) ?? [];

/** The rhythm rules: what makes a lesson read as a wall of text. */
export function lintLesson(lesson) {
  const errors = [];
  const kinds = new Set();
  const walk = (blocks, where) => {
    let run = 0;
    for (const b of blocks) {
      if (b.k === "row") {
        walk(b.blocks, where);
        run = 0;
        continue;
      }
      kinds.add(b.k);
      if (b.k !== "p") {
        run = 0;
        continue;
      }
      run++;
      if (run > MAX_PARAGRAPHS) errors.push(`${where}: more than ${MAX_PARAGRAPHS} paragraphs in a row`);
      const n = words(plain(b.t)).length;
      if (n > MAX_WORDS) errors.push(`${where}: a paragraph of ${n} words (at most ${MAX_WORDS})`);
    }
  };
  walk(lesson.intro, "intro");
  for (const s of lesson.sections) {
    const where = `section ${s.letter} (${plain(s.title)})`;
    walk(s.blocks, where);
    if (!s.blocks.some((b) => b.k !== "p")) errors.push(`${where}: nothing but paragraphs`);
  }
  if (lesson.sections.length < 2) errors.push("fewer than two sections");
  if (!lesson.goals.length) errors.push("no goals in the front matter");
  if (!kinds.has("summary")) errors.push("no summary");
  const used = [...kinds].filter((k) => k !== "p");
  if (used.length < MIN_KINDS) errors.push(`only ${used.length} kinds of block (${used.join(", ")}): use ${MIN_KINDS} or more`);
  return errors;
}

/** Every run of SHINGLE words of `text`. */
export function shingles(text, n = SHINGLE) {
  const out = new Set();
  for (const line of text.split("\n")) {
    const w = words(line);
    for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  }
  return out;
}

/** Runs of SHINGLE words the lesson shares with the book's text. */
export function originality(lesson, bookShingles) {
  const hits = [];
  for (const s of shingles(lessonText(lesson))) if (bookShingles.has(s)) hits.push(s);
  return hits;
}

export { KINDS };
