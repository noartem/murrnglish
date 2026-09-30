// The text of a unit's rule page, for the rules compendium (src/rules.ts).
// scripts/sync_books.mjs runs it over books/<id>/work/pages/plain — the
// `pdftotext -layout` text every book's pipeline keeps — and writes what it
// finds to public/books/<id>/data/rules.json.
//
// A Murphy unit is a two-page spread: the rule on the left, the exercises on
// the right. The layout text of the rule page keeps the book's structure in
// its columns, which is what this reads:
//
//   Unit
//    12         for and since   when … ?   and   how long … ?      <- header
//          A   We use for and since to say how long …              <- section A
//                   Helen is in hospital. She's been there since…  <- example (deeper)
//                Present perfect      Past simple                  <- two columns
//   24           Present perfect ➜ Units 7–8   for ➜ Unit 12       <- footer refs
//
// Nothing is trusted blindly: a page is used only when its header names the
// unit (the number, and most words of the title). Page text that belongs to a
// different book or edition — or a scan whose text layer is noise — fails that
// check and the unit simply has no text; the compendium then shows the page
// itself alone.

/** The rule pages of a unit: the first half of its pages (the left of the spread). */
export function theoryPages(pages) {
  return pages.slice(0, Math.max(1, Math.ceil(pages.length / 2)));
}

const latinWords = (s) =>
  (s.toLowerCase().replace(/’/g, "'").match(/[a-z][a-z']+/g) ?? []).filter((w) => w.length > 1);

/** True when the page's header is this unit's: "Unit", its number, its title. */
export function headerMatches(text, unit, title) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  // "Unit" may run straight into the title: "UnitAdjectives and adverbs 2"
  if (!lines.length || !/^\s*Unit/.test(lines[0])) return false;
  const head = lines.slice(0, 4).map((l, i) => (i ? l : l.replace(/^\s*Unit/, "Unit ")));
  const num = head
    .map((l) => l.match(/^\s*Unit\s+(\d{1,3})\b/) ?? l.match(/^\s*(\d{1,3})\b/))
    .find(Boolean);
  if (!num || Number(num[1]) !== unit) return false;
  const want = latinWords(title);
  if (!want.length) return true;
  const have = new Set(latinWords(head.join(" ")));
  return want.filter((w) => have.has(w)).length / want.length >= 0.6;
}

const SECTION = /^( {1,12})([A-H])( {2,})(\S.*)$/;
const FOOTER = /^\s*\d{1,3}\s{2,}\S|\S\s{2,}\d{1,3}\s*$/;

/** "Units 3–4" / "Unit 93B" / "Units 92–93, 96" -> [3, 4] / [93] / [92, 93, 96] */
export function refUnits(target) {
  if (!/^Units?\b/.test(target)) return [];
  const out = [];
  for (const m of target.matchAll(/(\d+)[A-Z]*(?:\s*[–-]\s*(\d+))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= Math.min(b, a + 10); n++) if (!out.includes(n)) out.push(n);
  }
  return out;
}

function parseFooter(line) {
  const body = line.trim().replace(/^\d{1,3}\s{2,}/, "").replace(/\s{2,}\d{1,3}$/, "");
  const refs = [];
  for (const item of body.split(/\s{3,}/)) {
    const m = item.match(/^(.+?)\s*➜\s*(.+)$/);
    if (!m) continue;
    refs.push({ t: m[1].trim(), to: m[2].trim(), u: refUnits(m[2].trim()) });
  }
  return refs;
}

/**
 * One rule page -> { s: sections, r: cross references }, or null when the
 * page is not this unit's rule. A section is { l: "A", x: lines }; a line is
 * ["h", text] (the section's short heading), ["t", text] (rule prose),
 * ["e", text] (an example, indented deeper in the book), ["c", [cell, ...]]
 * (side-by-side columns) or ["b"] (a paragraph gap).
 */
export function parseRulePage(text, unit, title) {
  if (!headerMatches(text, unit, title)) return null;
  let lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ""));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  let refs = [];
  if (lines.length && FOOTER.test(lines[lines.length - 1])) {
    refs = parseFooter(lines[lines.length - 1]);
    lines = lines.slice(0, -1);
  }

  // section letters sit in one column, in alphabetical order
  const starts = [];
  let col = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SECTION);
    if (!m) continue;
    const want = String.fromCharCode(65 + starts.length);
    if (m[2] !== want) continue;
    if (col >= 0 && Math.abs(m[1].length - col) > 1) continue;
    col = m[1].length;
    starts.push({ i, letter: m[2], textCol: m[1].length + 1 + m[3].length });
  }
  // no lettered sections: one section holding everything after the header
  if (!starts.length) {
    const headerEnd = lines.findIndex((l, i) => i > 0 && /^\s*\d{1,3}\b/.test(l));
    const first = lines.slice(headerEnd + 1).findIndex((l) => l.trim());
    if (first < 0) return null;
    const i = headerEnd + 1 + first;
    starts.push({ i, letter: "", textCol: lines[i].search(/\S/) });
  }

  const sections = [];
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].i : lines.length;
    const x = [];
    for (let i = s.i; i < end; i++) {
      let raw = lines[i];
      if (i === s.i && s.letter) raw = " ".repeat(s.textCol) + raw.slice(s.textCol);
      if (!raw.trim()) {
        if (x.length && x[x.length - 1][0] !== "b") x.push(["b"]);
        continue;
      }
      const indent = raw.search(/\S/);
      const t = raw.trim();
      const cells = t.split(/ {5,}/);
      if (cells.length > 1) {
        x.push(["c", cells]);
        continue;
      }
      // the letter line often carries a short heading ("A  good and well")
      // with the prose starting on the next line
      if (i === s.i && s.letter && t.split(/\s+/).length <= 6 && !/[:.!?]$/.test(t)) {
        x.push(["h", t]);
        continue;
      }
      const kind = indent >= s.textCol + 3 ? "e" : "t";
      const prev = x[x.length - 1];
      // prose wrapped over two lines of the page reads as one line here
      if (kind === "t" && prev && prev[0] === "t" && !/[:.!?)]$/.test(prev[1])) {
        prev[1] = `${prev[1]} ${t}`;
        continue;
      }
      x.push([kind, t]);
    }
    while (x.length && x[x.length - 1][0] === "b") x.pop();
    if (x.length) sections.push({ l: s.letter, x });
  });
  if (!sections.length) return null;
  return { s: sections, r: refs };
}

/** The searchable text of a parsed rule: every line and cell, one string. */
export function ruleText(rule) {
  const out = [];
  for (const s of rule.s)
    for (const line of s.x) {
      if (line[0] === "c") out.push(line[1].join("  "));
      else if (line[0] !== "b") out.push(line[1]);
    }
  return out.join("\n");
}
