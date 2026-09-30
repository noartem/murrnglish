// Book registry. Each book lives in books/<id>/ at the repo root; its
// book.json plus the counts scripts/sync_books.mjs takes from the data files
// arrive here as generated/books.json, so adding a book is a new folder, not
// an app change. Served files sit under /books/<id>/ (see bookUrl).

import registry from "./generated/books.json";

export interface Book {
  /** folder name under books/, also the route segment: #/<id>/u5 */
  id: string;
  /** library order: the learning path, elementary first */
  order: number;
  title: string;
  edition: string;
  level: string;
  authors: string;
  publisher: string;
  /** the printed cover's color: library card accents, never UI state */
  color: string;
  cover: { file: string; width: number; height: number };
  units: number;
  additional: number;
  /** bytes the offline download stores (book, cover, data) */
  downloadBytes: number;
  /** word packs in data/packs.json (0: no such file) */
  packs: number;
}

export const BOOKS: readonly Book[] = registry as Book[];

export function bookById(id: string): Book | undefined {
  return BOOKS.find((b) => b.id === id);
}

/** URL of a file served for this book: bookUrl(b, "book.pdf") -> "/books/blue/book.pdf" */
export function bookUrl(book: Book, file: string): string {
  return `${import.meta.env.BASE_URL}books/${book.id}/${file}`;
}
