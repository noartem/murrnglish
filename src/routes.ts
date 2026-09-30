// Hash routes. The app is one static document, so every view is a hash:
//
//   #/                 the library (all books)
//   #/<book>           a book's landing
//   #/<book>/u<N>      unit N
//   #/<book>/a<N>      additional exercise N
//   #/<book>/p=<code>  a shared progress link for that book (share.ts)
//
// Sections that are not books take their own first segment next to the book
// ids (SECTIONS; scripts/sync_books.mjs refuses a book folder by those names):
//
//   #/rules                  the rules compendium: search across every book
//   #/rules/<book>           one book's rules, by its groups
//   #/rules/<book>/u<N>      the rule of unit N
//   #/cards                  the card decks and their due counts
//   #/cards/<deck>           a study session: all, words, <book>,
//                            <book>/g<N> (the book's N-th group), <book>/u<N>
//   #/dictionary             the learner's words
//
// A bare "/" (no hash at all) resumes the last page a learner worked on — see
// entryHash in App.tsx. Anything unknown lands in the library.

import type { Book } from "./books";
import { SHARE_CODE } from "./share";

/** A page inside one book. */
export type BookPage =
  | { kind: "home" }
  | { kind: "unit"; n: number }
  | { kind: "additional"; n: number };

export type ContentPage = Exclude<BookPage, { kind: "home" }>;

/** What a study session reviews. */
export type DeckRef =
  | { kind: "all" }
  | { kind: "words" }
  | { kind: "book"; book: Book }
  /** group: 1-based position in the book's index groups */
  | { kind: "group"; book: Book; group: number }
  | { kind: "unit"; book: Book; unit: number };

export type AppRoute =
  | { view: "library" }
  /** share: the code of a #/<book>/p= link, to preview and apply */
  | { view: "book"; book: Book; page: BookPage; share?: string }
  | { view: "rules"; book?: Book; unit?: number }
  /** no deck: the deck list */
  | { view: "cards"; deck?: DeckRef }
  | { view: "dictionary" };

/** First hash segments that are app sections, never book ids. The deck names
    "all" and "words" share the second segment of #/cards/ with book ids, so a
    book cannot take them either. Keep equal to RESERVED in sync_books.mjs. */
export const SECTIONS = ["rules", "cards", "dictionary"] as const;
export const RESERVED_IDS: readonly string[] = [...SECTIONS, "all", "words"];

const clamp = (n: number, max: number) => Math.min(max, Math.max(1, n));

/** "u5" / "a3" -> the page, clamped to the book; null for anything else. */
export function parsePage(book: Book, s: string): ContentPage | null {
  const mu = s.match(/^u(\d+)$/);
  if (mu) return { kind: "unit", n: clamp(Number(mu[1]), book.units) };
  const ma = s.match(/^a(\d+)$/);
  if (ma) return { kind: "additional", n: clamp(Number(ma[1]), book.additional) };
  return null;
}

/** The page part of a hash: "u5", "a3", or "" for the book landing. */
export function pageKey(page: BookPage): string {
  return page.kind === "unit" ? `u${page.n}` : page.kind === "additional" ? `a${page.n}` : "";
}

export function bookHash(book: Book, page: BookPage = { kind: "home" }): string {
  const key = pageKey(page);
  return key ? `#/${book.id}/${key}` : `#/${book.id}`;
}

export const LIBRARY_HASH = "#/";

/** Parse a location hash ("#/blue/u5"). A bare "" is the caller's to resolve. */
export function parseRoute(hash: string, books: readonly Book[]): AppRoute {
  const m = hash.match(/^#\/([a-z][a-z0-9-]*)(?:\/(.*))?$/);
  if (m && m[1] === "rules") return parseRules(m[2] ?? "", books);
  if (m && m[1] === "cards") return { view: "cards", deck: parseDeck(m[2] ?? "", books) };
  if (m && m[1] === "dictionary") return { view: "dictionary" };
  const book = m ? books.find((b) => b.id === m[1]) : undefined;
  if (!m || !book) return { view: "library" };
  const rest = m[2] ?? "";
  const share = rest.match(new RegExp(`^p=(${SHARE_CODE.source})$`));
  if (share) return { view: "book", book, page: { kind: "home" }, share: share[1] };
  return { view: "book", book, page: parsePage(book, rest) ?? { kind: "home" } };
}

function parseRules(rest: string, books: readonly Book[]): AppRoute {
  const [id, page] = rest.split("/");
  const book = books.find((b) => b.id === id);
  if (!book) return { view: "rules" };
  const u = parsePage(book, page ?? "");
  return u?.kind === "unit" ? { view: "rules", book, unit: u.n } : { view: "rules", book };
}

/** "all" / "words" / "blue" / "blue/g3" / "blue/u12"; undefined = the deck list. */
export function parseDeck(rest: string, books: readonly Book[]): DeckRef | undefined {
  if (rest === "all") return { kind: "all" };
  if (rest === "words") return { kind: "words" };
  const [id, sub] = rest.split("/");
  const book = books.find((b) => b.id === id);
  if (!book) return undefined;
  const g = sub?.match(/^g(\d+)$/);
  if (g && Number(g[1]) >= 1) return { kind: "group", book, group: Number(g[1]) };
  const u = parsePage(book, sub ?? "");
  if (u?.kind === "unit") return { kind: "unit", book, unit: u.n };
  return { kind: "book", book };
}

export function deckKey(d: DeckRef): string {
  switch (d.kind) {
    case "all":
    case "words":
      return d.kind;
    case "book":
      return d.book.id;
    case "group":
      return `${d.book.id}/g${d.group}`;
    case "unit":
      return `${d.book.id}/u${d.unit}`;
  }
}

export const CARDS_HASH = "#/cards";
export const DICTIONARY_HASH = "#/dictionary";
export const deckHash = (d: DeckRef) => `${CARDS_HASH}/${deckKey(d)}`;
export function rulesHash(book?: Book, unit?: number): string {
  if (!book) return "#/rules";
  return unit ? `#/rules/${book.id}/u${unit}` : `#/rules/${book.id}`;
}

/**
 * Swap the current hash without a history entry. replaceState fires no
 * hashchange, so one is dispatched by hand — the router listens to that
 * event alone, whichever way the hash changed.
 */
export function replaceHash(hash: string): void {
  window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
