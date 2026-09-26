import { describe, expect, it } from "vitest";
import { checkChoice, checkFill, checkMatching, checkWrite, normalize } from "./checker";

describe("normalize", () => {
  it("lowercases and trims", () => {
    expect(normalize("  Taking ")).toBe("taking");
  });

  it("straightens curly apostrophes and quotes", () => {
    expect(normalize("I’ve been")).toBe("i've been");
    expect(normalize("“yes”")).toBe('"yes"');
  });

  it("collapses whitespace", () => {
    expect(normalize("a\tb\nc   d")).toBe("a b c d");
  });

  it("strips trailing punctuation", () => {
    expect(normalize("Why are you crying?")).toBe("why are you crying");
    expect(normalize("Stop.")).toBe("stop");
  });
});

describe("checkFill", () => {
  it("accepts a listed variant", () => {
    expect(checkFill("taking", ["taking"])).toBe(true);
  });

  it("accepts any variant and is case/punctuation tolerant", () => {
    expect(checkFill("What’s she studying?", [
      "What is she studying?",
      "What’s she studying?",
    ])).toBe(true);
  });

  it("rejects a wrong answer", () => {
    expect(checkFill("takeing", ["taking", "taking a picture"])).toBe(false);
  });

  it("rejects empty input unless the key marks no word necessary", () => {
    expect(checkFill("  ", ["taking"])).toBe(false);
    expect(checkFill("", ["–"])).toBe(true);
  });

  it("contraction variants are distinct listed values, both match when listed", () => {
    expect(checkFill("I’ve had", ["I’ve had"])).toBe(true);
    expect(checkFill("I have had", ["I have had"])).toBe(true);
    expect(checkFill("I’ve had", ["I have had"])).toBe(false);
  });
});

describe("checkWrite", () => {
  it("matches full-sentence answers modulo normalization", () => {
    expect(
      checkWrite("Why are you crying?", ["What’s the matter? Why are you crying?"]),
    ).toBe(false);
    expect(
      checkWrite("what’s the matter? why are you crying", [
        "What’s the matter? Why are you crying?",
      ]),
    ).toBe(true);
  });
});

describe("checkChoice", () => {
  it("accepts the single correct index", () => {
    expect(checkChoice(2, 2)).toBe(true);
    expect(checkChoice(0, 2)).toBe(false);
  });

  it("accepts any of several correct indices", () => {
    expect(checkChoice(0, [0, 1])).toBe(true);
    expect(checkChoice(1, [0, 1])).toBe(true);
    expect(checkChoice(2, [0, 1])).toBe(false);
    expect(checkChoice(null, [0, 1])).toBe(false);
  });
});

describe("checkMatching", () => {
  const pairs: [number, number][] = [
    [0, 5],
    [1, 3],
    [2, 0],
  ];

  it("marks correct selections true", () => {
    expect(checkMatching([5, 3, 0], pairs)).toEqual([true, true, true]);
  });

  it("marks wrong selections false", () => {
    expect(checkMatching([0, 3, 0], pairs)).toEqual([false, true, true]);
  });

  it("unanswered slots are false", () => {
    expect(checkMatching([null, 3, 0], pairs)).toEqual([false, true, true]);
  });
});
