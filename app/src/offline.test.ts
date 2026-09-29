// The unit/additional URL paddings are the whole risk here: a wrong pad is a
// 404 offline, and nothing else in the app notices before the plane leaves.

import { describe, expect, it } from "vitest";
import type { IndexData } from "./data";
import { buildCourseUrls } from "./offline";

const index: IndexData = {
  groups: [{ name: "G", units: [1, 2, 3] }],
  additional: { title: "t", exercises: [4, 9, 41] },
  exercises: {},
};

describe("buildCourseUrls", () => {
  it("lists the whole course in download order", () => {
    expect(buildCourseUrls(index)).toEqual([
      "/data/index.json",
      "/data/totals.json",
      "/data/units/unit-001.json",
      "/data/units/unit-002.json",
      "/data/units/unit-003.json",
      "/data/additional/04.json",
      "/data/additional/09.json",
      "/data/additional/41.json",
      "/book.pdf",
      "/cover.png",
      "/favicon.svg",
    ]);
  });
});
