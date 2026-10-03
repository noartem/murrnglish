import { describe, expect, it } from "vitest";
import { checkChoice, checkFill, checkMatching, checkWrite, exampleText, normalize } from "./checker";

describe("normalize", () => {
  it("lowercases and trims", () => {
    expect(normalize("  Taking ")).toBe("taking");
  });

  it("straightens curly apostrophes and quotes", () => {
    expect(normalize("I’ve been")).toBe("i have been");
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

  it("contraction forms normalize to the same string", () => {
    expect(normalize("I’ve had")).toBe(normalize("I have had"));
    expect(checkFill("I’ve had", ["I have had"])).toBe(true);
  });

  it("bridges contractions and expanded forms", () => {
    expect(checkFill("isn't", ["is not"])).toBe(true);
    expect(checkFill("He isn't", ["He ’s not"])).toBe(true);
    expect(checkFill("can not", ["can't"])).toBe(true);
    expect(checkFill("cannot", ["can't"])).toBe(true);
    expect(checkFill("won't", ["will not"])).toBe(true);
    expect(checkFill("I'm", ["I am"])).toBe(true);
    expect(checkFill("they've gone", ["they have gone"])).toBe(true);
    expect(checkFill("You aren't supposed to park", ["You're not supposed to park"])).toBe(true);
  });

  it("keeps possessive 's and unlisted '-d' distinct", () => {
    expect(checkFill("John's car", ["John's car"])).toBe(true);
    expect(checkFill("I'd go", ["I would go"])).toBe(false);
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

describe("exampleText", () => {
  it("keeps an example whose parts hold the answer", () => {
    expect(exampleText({ num: 1, parts: ["She’s taking ", " a picture."], answers: [["taking"]], example: true })).toBe(
      "She’s taking a picture.",
    );
  });

  it("fills in an answer the parts leave out", () => {
    expect(exampleText({ num: 1, parts: ["He’s", ""], answers: [["hot."]], example: true })).toBe("He’s hot.");
    expect(exampleText({ num: 1, parts: ["", " an apple."], answers: [["She’s eating"]], example: true })).toBe(
      "She’s eating an apple.",
    );
  });
});
