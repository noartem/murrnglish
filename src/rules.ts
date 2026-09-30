// The rules compendium's data: each book's index (groups, unit titles, rule
// pages) plus the rule text scripts/rules_text.mjs extracted into
// data/rules.json, and the search across every book. A book without rule
// text (its page text is not its own) is still listed and searchable by
// unit and group titles; its rules are shown as the book page.

import type { Book } from "./books";
import { bookUrl } from "./books";
import type { IndexData } from "./data";
import { RULES_FILE, fetchIndexOnce } from "./data";
import type { ParsedRule } from "../scripts/rules_text.mjs";
import { ruleText, theoryPages } from "../scripts/rules_text.mjs";

export type { ParsedRule, RuleLine, RuleRef, RuleSection } from "../scripts/rules_text.mjs";
export { theoryPages };

export interface BookRules {
  book: Book;
  index: IndexData;
  /** unit number -> its parsed rule page (absent: show the page itself) */
  rules: Map<number, ParsedRule>;
}

interface RulesFile {
  units?: Record<string, ParsedRule>;
}

const loaded = new Map<string, Promise<BookRules>>();

export function loadBookRules(book: Book): Promise<BookRules> {
  let p = loaded.get(book.id);
  if (!p) {
    p = Promise.all([
      fetchIndexOnce(book),
      // no text is not an error: the compendium falls back to the pages
      fetch(bookUrl(book, RULES_FILE))
        .then((r): Promise<RulesFile> | RulesFile => (r.ok ? r.json() : { units: {} }))
        .catch((): RulesFile => ({ units: {} })),
    ])
      .then(([index, file]) => {
        const rules = new Map<number, ParsedRule>();
        for (const [n, r] of Object.entries(file.units ?? {})) rules.set(Number(n), r);
        return { book, index, rules };
      })
      .catch((e: unknown) => {
        loaded.delete(book.id);
        throw e;
      });
    loaded.set(book.id, p);
  }
  return p;
}

// ---- search -----------------------------------------------------------------------

/** Lowercase, curly quotes straightened, accents off: "Can’t" ~ "can't". */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ё/g, "е");
}

export interface RuleHit {
  book: Book;
  unit: number;
  title: string;
  group: string;
  /** the rule-text line the first query word was found in, if not in the title */
  snippet?: string;
  score: number;
}

interface Doc {
  book: Book;
  unit: number;
  title: string;
  group: string;
  head: string; // folded title + group
  lines: string[]; // original text lines
  body: string; // folded, one string
}

const docCache = new WeakMap<BookRules, Doc[]>();

function docs(br: BookRules): Doc[] {
  let d = docCache.get(br);
  if (d) return d;
  d = [];
  for (const g of br.index.groups)
    for (const unit of g.units) {
      const title = br.index.exercises[`u${unit}`]?.title ?? "";
      const rule = br.rules.get(unit);
      const text = rule ? ruleText(rule) : "";
      d.push({
        book: br.book,
        unit,
        title,
        group: g.name,
        head: fold(`${title} ${g.name}`),
        lines: text ? text.split("\n") : [],
        body: fold(text),
      });
    }
  docCache.set(br, d);
  return d;
}

/** Query words: two letters and up, or a unit number ("12"). */
export function queryTerms(q: string): string[] {
  return fold(q)
    .split(/[^\p{L}\p{N}'/-]+/u)
    .map((t) => t.replace(/^['/-]+|['/-]+$/g, ""))
    .filter((t) => t.length > 1 || /^\d+$/.test(t));
}

const wordStart = (hay: string, t: string) => {
  let i = hay.indexOf(t);
  while (i > 0 && /[\p{L}\p{N}]/u.test(hay[i - 1])) i = hay.indexOf(t, i + 1);
  return i;
};

/**
 * Units whose title, group or rule text holds every query word (a word
 * matches at the start of a word: "go" finds "going", not "ago"). A number
 * alone also finds that unit. Title hits rank above text hits, then fewer
 * words between the terms, then book order.
 */
export function searchRules(all: readonly BookRules[], q: string, limit = 60): RuleHit[] {
  const terms = queryTerms(q);
  if (!terms.length) return [];
  const hits: RuleHit[] = [];
  for (const br of all)
    for (const d of docs(br)) {
      let score = 0;
      let ok = true;
      for (const t of terms) {
        if (/^\d+$/.test(t) && Number(t) === d.unit) {
          score += 50;
          continue;
        }
        if (wordStart(d.head, t) >= 0) score += 10;
        else if (wordStart(d.body, t) >= 0) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const hit: RuleHit = { book: d.book, unit: d.unit, title: d.title, group: d.group, score };
      // the line to show: the one holding the most terms
      if (d.lines.length && terms.some((t) => wordStart(d.head, t) < 0)) {
        let best = -1;
        let bestN = 0;
        d.lines.forEach((l, i) => {
          const f = fold(l);
          const n = terms.filter((t) => wordStart(f, t) >= 0).length;
          if (n > bestN) {
            best = i;
            bestN = n;
          }
        });
        if (best >= 0) hit.snippet = d.lines[best];
      }
      hits.push(hit);
    }
  hits.sort((a, b) => b.score - a.score || a.book.order - b.book.order || a.unit - b.unit);
  return hits.slice(0, limit);
}

/**
 * Split `text` into plain and matched runs for highlighting: every place a
 * query word starts a word.
 */
export function highlight(text: string, terms: readonly string[]): { t: string; hit: boolean }[] {
  if (!terms.length) return [{ t: text, hit: false }];
  const f = fold(text);
  // folding keeps the length for Latin and Cyrillic text (accents are dropped
  // only from letters that had them as separate marks), so positions carry over
  const same = f.length === text.length;
  const marks = new Array<boolean>(text.length).fill(false);
  if (same)
    for (const t of terms) {
      let i = f.indexOf(t);
      while (i >= 0) {
        if (i === 0 || !/[\p{L}\p{N}]/u.test(f[i - 1])) for (let k = i; k < i + t.length; k++) marks[k] = true;
        i = f.indexOf(t, i + 1);
      }
    }
  const out: { t: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === marks[i]) last.t += text[i];
    else out.push({ t: text[i], hit: marks[i] });
  }
  return out;
}
