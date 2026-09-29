// The download's file list is the whole risk here: a missing entry is a unit
// that cannot be opened once the plane leaves, and nothing else in the app
// notices before that. A book's data must stay ONE request (course.json) —
// the per-unit files are what the app falls back FROM, not what it downloads.

import { describe, expect, it } from "vitest";
import { BOOKS, bookById } from "./books";
import { bookCache, bookUrls, downloadFraction } from "./offline";

describe("bookUrls", () => {
  it("lists a whole book in download order", () => {
    expect(bookUrls(bookById("blue")!)).toEqual([
      "/books/blue/data/index.json",
      "/books/blue/data/totals.json",
      "/books/blue/data/pages.json",
      "/books/blue/data/course.json",
      "/books/blue/cover.png",
      "/books/blue/book.pdf",
    ]);
  });

  it("keeps every file of every book under that book's path", () => {
    // the service worker files /books/<id>/... into bookCache(id): a file
    // outside the path would land in the shell cache and survive a removal
    for (const b of BOOKS) {
      for (const u of bookUrls(b)) expect(u.startsWith(`/books/${b.id}/`)).toBe(true);
    }
  });

  it("names one cache per book", () => {
    expect(new Set(BOOKS.map((b) => bookCache(b.id))).size).toBe(BOOKS.length);
  });
});

describe("downloadFraction", () => {
  it("is the stored share of the total", () => {
    expect(downloadFraction({ bytes: 0, totalBytes: 1000 })).toBe(0);
    expect(downloadFraction({ bytes: 250, totalBytes: 1000 })).toBe(0.25);
    expect(downloadFraction({ bytes: 1000, totalBytes: 1000 })).toBe(1);
  });

  it("is null before the total is known", () => {
    expect(downloadFraction({ bytes: 0, totalBytes: 0 })).toBeNull();
    expect(downloadFraction({ bytes: 512, totalBytes: 0 })).toBeNull();
  });

  it("never exceeds 1 on a total the run outgrew", () => {
    // the book's own content-length arriving late can only raise the total,
    // but a shell file without one can leave bytes past it
    expect(downloadFraction({ bytes: 1200, totalBytes: 1000 })).toBe(1);
  });
});
