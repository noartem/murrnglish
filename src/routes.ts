// Hash routes. The app is one static document, so every view is a hash:
//
//   #/                 the library (all books)
//   #/<book>           a book's landing
//   #/<book>/u<N>      unit N
//   #/<book>/a<N>      additional exercise N
//   #/<book>/p=<code>  a shared progress link for that book (share.ts)
//
// A bare "/" (no hash at all) resumes the last page a learner worked on — see
// entryHash in App.tsx. Anything unknown lands in the library. Future
// sections that are not books (a dictionary, flash cards) get their own first
// segment next to the book ids.

import type { Book } from "./books";
import { SHARE_CODE } from "./share";

/** A page inside one book. */
export type BookPage =
  | { kind: "home" }
  | { kind: "unit"; n: number }
  | { kind: "additional"; n: number };

export type ContentPage = Exclude<BookPage, { kind: "home" }>;

export type AppRoute =
  | { view: "library" }
  /** share: the code of a #/<book>/p= link, to preview and apply */
  | { view: "book"; book: Book; page: BookPage; share?: string };

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
  const book = m ? books.find((b) => b.id === m[1]) : undefined;
  if (!m || !book) return { view: "library" };
  const rest = m[2] ?? "";
  const share = rest.match(new RegExp(`^p=(${SHARE_CODE.source})$`));
  if (share) return { view: "book", book, page: { kind: "home" }, share: share[1] };
  return { view: "book", book, page: parsePage(book, rest) ?? { kind: "home" } };
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
