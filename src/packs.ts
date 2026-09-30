// Word packs: ready-made vocabulary of a book, studied as cards next to its
// units — the irregular verbs of its appendix, its phrasal verbs, the words
// that go with a preposition. Each book keeps its packs in data/packs.json
// (hand-made: the Russian translations are not in the books), copied as is by
// scripts/sync_books.mjs, which also checks the shape. A book without the
// file simply has no packs.
//
// A pack asks one kind of question of every entry:
//
//   forms      the infinitive and its translation -> past simple and past
//              participle ("go" -> went · gone)
//   translate  the Russian -> the English phrase ("отменить" -> call off)
//   gap        the phrase with a word missing -> that word ("interested [in]")
//
// Card ids are "v:<book>:<pack>:<entry>": the entry ids are stable, so review
// history stays with the entry when the lists are corrected.

import type { Book } from "./books";
import { bookUrl } from "./books";
import { checkFill } from "./checker";

export const PACKS_FILE = "data/packs.json";

export type PackAsk = "forms" | "translate" | "gap";

export interface PackEntry {
  id: string;
  /** the English: an infinitive, a phrase, or a phrase with its [gap] */
  en: string;
  ru: string;
  /** forms packs: past simple, past participle ("was/were", "got/gotten") */
  forms?: string[];
  /** translate packs: other phrases accepted as the answer */
  alt?: string[];
  /** an example sentence */
  ex?: string;
  /** a remark shown with the answer */
  note?: string;
  /** the unit that teaches it */
  unit?: number;
}

export interface Pack {
  id: string;
  title: string;
  about: string;
  ask: PackAsk;
  /** the units it comes from: [first] or [first, last] */
  units?: number[];
  entries: PackEntry[];
}

interface PacksFile {
  packs?: Pack[];
}

/** A book's packs; none when it has no file or it cannot be fetched (offline). */
export function fetchPacks(book: Book): Promise<Pack[]> {
  if (!book.packs) return Promise.resolve([]);
  return fetch(bookUrl(book, PACKS_FILE))
    .then((r): Promise<PacksFile> | PacksFile => (r.ok ? r.json() : {}))
    .then((f) => (Array.isArray(f.packs) ? f.packs : []))
    .catch(() => {
      loaded.delete(book.id); // the next visit retries
      return [];
    });
}

const loaded = new Map<string, Promise<Pack[]>>();

/** fetchPacks once per book and session, shared by the decks and the dictionary. */
export function loadPacks(book: Book): Promise<Pack[]> {
  let p = loaded.get(book.id);
  if (!p) {
    p = fetchPacks(book);
    loaded.set(book.id, p);
  }
  return p;
}

export function packCardId(book: string, pack: string, entry: string): string {
  return `v:${book}:${pack}:${entry}`;
}

/** "v:blue:phrasal-verbs:give-up" -> its parts; null for any other card id. */
export function parsePackCardId(id: string): { book: string; pack: string; entry: string } | null {
  const m = id.match(/^v:([^:]+):([^:]+):([^:]+)$/);
  return m ? { book: m[1], pack: m[2], entry: m[3] } : null;
}

export function packCardIds(book: string, p: Pack): string[] {
  return p.entries.map((e) => packCardId(book, p.id, e.id));
}

/** "[have/take] a shower" -> the text around the gap and the words that fill it. */
export function gapParts(en: string): { before: string; after: string; answers: string[] } {
  const m = en.match(/^(.*?)\[([^\]]+)\](.*)$/);
  if (!m) return { before: en, after: "", answers: [] };
  return { before: m[1], after: m[3], answers: m[2].split("/").map((s) => s.trim()) };
}

/** The English as the answer side shows it: the gap filled with its first word. */
export function entryText(e: PackEntry): string {
  return e.en.replace(/\[([^\]/]+)(?:\/[^\]]*)?\]/, "$1");
}

/** "sewn/sewed" -> every spelling accepted for that form, the whole string too. */
function formVariants(form: string): string[] {
  return [form, ...form.split("/").map((s) => s.trim())];
}

/**
 * Whether what was typed answers the entry: the two forms, the English
 * phrase (or one of its alternatives), or the word of the gap.
 */
export function checkPackAnswer(ask: PackAsk, e: PackEntry, typed: { forms?: string[]; text?: string }): boolean {
  switch (ask) {
    case "forms":
      return (e.forms ?? []).every((f, i) => checkFill(typed.forms?.[i] ?? "", formVariants(f)));
    case "translate":
      return checkFill(typed.text ?? "", [e.en, ...(e.alt ?? [])]);
    case "gap":
      return checkFill(typed.text ?? "", gapParts(e.en).answers);
  }
}

/** "Units 137–145" / "Unit 5" / "" */
export function packUnitsLabel(p: Pack): string {
  const u = p.units ?? [];
  if (!u.length) return "";
  return u.length > 1 && u[1] !== u[0] ? `Units ${u[0]}–${u[1]}` : `Unit ${u[0]}`;
}
