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
//   #/cards                  the card decks and their due counts
//   #/cards/<deck>           a study session: all, words, or a deck
//                            (deckdata.ts; no deck is named all or words)
//   #/cards/<deck>/browse    a deck's cards, to look through
//   #/cards/<deck>/browse/<entry>  one of them, with where it stands
//   #/dictionary             the learner's words and the vocabulary decks
//   #/dictionary/<deck>      the same, with that deck's list open
//
// A bare "/" (no hash at all) resumes the last page a learner worked on — see
// entryHash in App.tsx. Anything unknown lands in the library.
//
// #/rules/... was the rules compendium. A unit's rule is now the lesson at the
// top of the unit itself, so old links move there (legacyHash): #/rules/<book>/u<N>
// -> #/<book>/u<N>, #/rules/<book> -> #/<book>, #/rules -> the library. "rules"
// stays reserved so such a link can never name a book.

import type { Book } from "./books";
import { SHARE_CODE } from "./share";

/** A page inside one book. */
export type BookPage =
  | { kind: "home" }
  | { kind: "unit"; n: number }
  | { kind: "additional"; n: number };

export type ContentPage = Exclude<BookPage, { kind: "home" }>;

/** What a study session reviews: everything due, the learner's words, or one deck. */
export type DeckRef = { kind: "all" } | { kind: "words" } | { kind: "deck"; id: string };

export type AppRoute =
  | { view: "library" }
  /** share: the code of a #/<book>/p= link, to preview and apply */
  | { view: "book"; book: Book; page: BookPage; share?: string }
  /** no deck: the deck list */
  | { view: "cards"; deck?: DeckRef }
  /** entry: the card to show; none, the deck's list */
  | { view: "browse"; deck: string; entry?: string }
  /** deck: the vocabulary deck to open */
  | { view: "dictionary"; deck?: string };

/** First hash segments that are app sections. */
export const SECTIONS = ["cards", "dictionary"] as const;
/** First hash segments that are never book ids: the sections and the old
    rules compendium's (legacyHash). Keep equal to RESERVED in sync_books.mjs. */
export const RESERVED_IDS: readonly string[] = ["rules", ...SECTIONS];
/** The session names that share #/cards/ with the deck ids. Keep equal to
    RESERVED in sync_decks.mjs. */
export const DECK_RESERVED: readonly string[] = ["all", "words"];

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
  const legacy = legacyHash(hash, books);
  if (legacy !== null) return parseRoute(legacy, books);
  const m = hash.match(/^#\/([a-z][a-z0-9-]*)(?:\/(.*))?$/);
  if (m && m[1] === "cards") return parseCards(m[2] ?? "");
  if (m && m[1] === "dictionary") return parseDictionary(m[2] ?? "");
  const book = m ? books.find((b) => b.id === m[1]) : undefined;
  if (!m || !book) return { view: "library" };
  const rest = m[2] ?? "";
  const share = rest.match(new RegExp(`^p=(${SHARE_CODE.source})$`));
  if (share) return { view: "book", book, page: { kind: "home" }, share: share[1] };
  return { view: "book", book, page: parsePage(book, rest) ?? { kind: "home" } };
}

/** Where an old #/rules/... link goes now; null for any other hash. */
export function legacyHash(hash: string, books: readonly Book[]): string | null {
  const m = hash.match(/^#\/rules(?:\/(.*))?$/);
  if (!m) return null;
  const [id, page] = (m[1] ?? "").split("/");
  const book = books.find((b) => b.id === id);
  if (!book) return LIBRARY_HASH;
  const u = parsePage(book, page ?? "");
  return bookHash(book, u?.kind === "unit" ? u : { kind: "home" });
}

const DECK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "idioms" -> the dictionary with that deck open; anything else, the dictionary. */
function parseDictionary(rest: string): AppRoute {
  return DECK_ID.test(rest) ? { view: "dictionary", deck: rest } : { view: "dictionary" };
}

/** "<deck>" -> its session; "<deck>/browse[/<entry>]" -> its cards; else the deck list. */
function parseCards(rest: string): AppRoute {
  const b = rest.match(/^([a-z0-9-]+)\/browse(?:\/([a-z0-9-]+))?$/);
  if (b && DECK_ID.test(b[1]) && !DECK_RESERVED.includes(b[1]))
    return b[2] ? { view: "browse", deck: b[1], entry: b[2] } : { view: "browse", deck: b[1] };
  return { view: "cards", deck: parseDeck(rest) };
}

/** "all" / "words" / a deck id; undefined = the deck list. Whether the deck
    exists is known once the decks load: the session says so. */
export function parseDeck(rest: string): DeckRef | undefined {
  if (rest === "all") return { kind: "all" };
  if (rest === "words") return { kind: "words" };
  return DECK_ID.test(rest) ? { kind: "deck", id: rest } : undefined;
}

export function deckKey(d: DeckRef): string {
  return d.kind === "deck" ? d.id : d.kind;
}

export const CARDS_HASH = "#/cards";
export const DICTIONARY_HASH = "#/dictionary";
export const deckHash = (d: DeckRef) => `${CARDS_HASH}/${deckKey(d)}`;
export const browseHash = (deck: string, entry?: string) =>
  `${CARDS_HASH}/${deck}/browse` + (entry ? `/${entry}` : "");
export const dictionaryDeckHash = (deck: string) => `${DICTIONARY_HASH}/${deck}`;

/**
 * Swap the current hash without a history entry. replaceState fires no
 * hashchange, so one is dispatched by hand — the router listens to that
 * event alone, whichever way the hash changed.
 */
export function replaceHash(hash: string): void {
  window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
