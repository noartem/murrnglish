// Hash routing: every book's pages, the library as the fallback for anything
// unknown, and share links scoped to the book they were made in.

import { describe, expect, it } from "vitest";
import type { Book } from "./books";
import { bookHash, parsePage, parseRoute } from "./routes";

const book = (id: string, units: number, additional: number): Book => ({
  id,
  order: 1,
  title: id,
  edition: "",
  level: "",
  authors: "",
  publisher: "",
  color: "#000",
  cover: { file: "cover.png", width: 1, height: 1 },
  units,
  additional,
  downloadBytes: 0,
});
const RED = book("red", 115, 35);
const BLUE = book("blue", 145, 41);
const BOOKS = [RED, BLUE];

describe("parseRoute", () => {
  it("opens the library at #/ and for anything unknown", () => {
    for (const h of ["#/", "#", "#home", "#u5", "#/green/u1", "#/Blue/u1", "#//u1"]) {
      expect(parseRoute(h, BOOKS)).toEqual({ view: "library" });
    }
  });

  it("opens a book's landing", () => {
    for (const h of ["#/blue", "#/blue/", "#/blue/home", "#/blue/x9"]) {
      expect(parseRoute(h, BOOKS)).toEqual({ view: "book", book: BLUE, page: { kind: "home" } });
    }
  });

  it("opens units and additional exercises", () => {
    expect(parseRoute("#/red/u12", BOOKS)).toEqual({
      view: "book",
      book: RED,
      page: { kind: "unit", n: 12 },
    });
    expect(parseRoute("#/blue/a41", BOOKS)).toEqual({
      view: "book",
      book: BLUE,
      page: { kind: "additional", n: 41 },
    });
  });

  it("clamps page numbers to the book", () => {
    expect(parsePage(RED, "u145")).toEqual({ kind: "unit", n: 115 });
    expect(parsePage(BLUE, "u145")).toEqual({ kind: "unit", n: 145 });
    expect(parsePage(RED, "a41")).toEqual({ kind: "additional", n: 35 });
    expect(parsePage(RED, "u0")).toEqual({ kind: "unit", n: 1 });
  });

  it("carries a share code to its book's landing", () => {
    expect(parseRoute("#/red/p=1.AbC-_9", BOOKS)).toEqual({
      view: "book",
      book: RED,
      page: { kind: "home" },
      share: "1.AbC-_9",
    });
    // not a code: the book's landing, nothing to preview
    expect(parseRoute("#/red/p=2.abc", BOOKS)).toEqual({
      view: "book",
      book: RED,
      page: { kind: "home" },
    });
  });
});

describe("bookHash", () => {
  it("round-trips through parseRoute", () => {
    for (const page of [
      { kind: "home" as const },
      { kind: "unit" as const, n: 7 },
      { kind: "additional" as const, n: 3 },
    ]) {
      expect(parseRoute(bookHash(BLUE, page), BOOKS)).toEqual({ view: "book", book: BLUE, page });
    }
  });
});
