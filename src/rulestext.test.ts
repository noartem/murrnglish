// Rule-page text (scripts/rules_text.mjs): the structure read from the
// layout text, and the header check that keeps another book's pages out.

import { describe, expect, it } from "vitest";
import { headerMatches, parseRulePage, refUnits, ruleText, theoryPages } from "../scripts/rules_text.mjs";
import p040 from "../books/blue/work/pages/plain/p040.txt?raw";
import p214 from "../books/blue/work/pages/plain/p214.txt?raw";

const TITLE_14 = "Present perfect and past 2 (I have done and I did)";

describe("rule page text", () => {
  it("takes the left page of the spread", () => {
    expect(theoryPages([40, 41])).toEqual([40]);
    expect(theoryPages([7])).toEqual([7]);
    expect(theoryPages([1, 2, 3, 4])).toEqual([1, 2]);
  });

  it("uses a page only when its header names the unit", () => {
    expect(headerMatches(p040, 14, TITLE_14)).toBe(true);
    expect(headerMatches(p040, 15, TITLE_14)).toBe(false); // wrong number
    expect(headerMatches(p040, 14, "am/is/are (вопросы)")).toBe(false); // wrong title
    // "Unit" run into the title on the page
    expect(headerMatches(p214, 101, "Adjectives and adverbs 2 (well, fast, late, hard/hardly)")).toBe(true);
    expect(parseRulePage("ENGLISH\nGRAMMAR\n  IN USE\n", 1, "am/is/are")).toBeNull();
  });

  it("reads sections, examples, columns and the footer references", () => {
    const r = parseRulePage(p040, 14, TITLE_14)!;
    expect(r.s.map((s) => s.l)).toEqual(["A", "B"]);
    const a = r.s[0].x;
    expect(a[0]).toEqual([
      "t",
      "We do not use the present perfect (I have done) when we talk about a finished time (for example, yesterday / last year / ten minutes ago etc.). We use a past tense:",
    ]);
    expect(a[1]).toEqual(["e", "It was very cold yesterday. (not has been)"]);
    expect(a).toContainEqual(["c", ["Present perfect", "Past simple"]]);
    expect(r.r).toEqual([
      { t: "Past simple", to: "Unit 5", u: [5] },
      { t: "Present perfect", to: "Units 7–8", u: [7, 8] },
      { t: "Present perfect and past 1", to: "Unit 13", u: [13] },
    ]);
    expect(ruleText(r)).toContain("Did you see Anna this morning?");
  });

  it("keeps a short section heading apart from its prose", () => {
    const r = parseRulePage(p214, 101, "Adjectives and adverbs 2 (well, fast, late, hard/hardly)")!;
    expect(r.s[0].x[0]).toEqual(["h", "good and well"]);
    expect(r.s[0].x[1]).toEqual(["t", "Good is an adjective. The adverb is well:"]);
  });

  it("expands unit references", () => {
    expect(refUnits("Units 92–93")).toEqual([92, 93]);
    expect(refUnits("Unit 93B")).toEqual([93]);
    expect(refUnits("Units 3, 5–6")).toEqual([3, 5, 6]);
    expect(refUnits("Appendix 2")).toEqual([]);
  });
});
