// The download's file list is the whole risk here: a missing entry is a unit
// that cannot be opened once the plane leaves, and nothing else in the app
// notices before that. The course's data must stay ONE request (course.json)
// — the per-unit files are what the app falls back FROM, not what it downloads.

import { describe, expect, it } from "vitest";
import { buildCourseUrls, downloadFraction } from "./offline";

describe("buildCourseUrls", () => {
  it("lists the whole course in download order", () => {
    expect(buildCourseUrls()).toEqual([
      "/data/index.json",
      "/data/totals.json",
      "/data/course.json",
      "/cover.png",
      "/favicon.svg",
      "/book.pdf",
    ]);
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
