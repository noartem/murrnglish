// The decks: how an entry is read (its kind, its gaps, its English), how a
// typed answer is checked, and every entry of every deck against its own key
// — sync_decks.mjs checks the shape; this runs the material through the
// checks the cards will meet.

import { describe, expect, it } from "vitest";
import file from "./generated/decks.json";
import type { DeckEntry, DeckSection } from "./deckdata";
import {
  cardId,
  checkTyped,
  choiceOrder,
  entryKind,
  entryText,
  fillGaps,
  gapsOf,
  makeLibrary,
  parseCardId,
  phraseAnswers,
} from "./deckdata";
import { parseWordCardId } from "./words";

const lib = makeLibrary(file as unknown as { sections: DeckSection[] });
const entry = (e: Partial<DeckEntry>): DeckEntry => ({ id: "x", ...e });

describe("card ids", () => {
  it("round-trip and stay apart from word cards", () => {
    const id = cardId("phrasal-verbs", "give-up");
    expect(id).toBe("d:phrasal-verbs:give-up");
    expect(parseCardId(id)).toEqual({ deck: "phrasal-verbs", entry: "give-up" });
    expect(parseWordCardId(id)).toBeNull();
    expect(parseCardId("w:abc:f")).toBeNull();
    expect(parseCardId("v:blue:phrasal-verbs:give-up")).toBeNull();
    expect(parseCardId("blue:12.1:2")).toBeNull();
  });
});

describe("entries", () => {
  it("know what they ask from their fields", () => {
    expect(entryKind({}, entry({ en: "go", forms: ["went", "gone"] }))).toBe("forms");
    expect(entryKind({}, entry({ choice: ["a", "b"] }))).toBe("choice");
    expect(entryKind({}, entry({ en: "good [at]" }))).toBe("gap");
    expect(entryKind({}, entry({ en: "give up", ru: "бросать" }))).toBe("translate");
    expect(entryKind({ ask: "meaning" }, entry({ en: "a piece of cake", ru: "проще простого" }))).toBe("meaning");
  });

  it("split a sentence into its gaps, answers and hints", () => {
    expect(gapsOf("If it [rains|rain], we [will stay/'ll stay|stay] in.")).toEqual({
      parts: ["If it ", ", we ", " in."],
      gaps: [
        { answers: ["rains"], hint: "rain" },
        { answers: ["will stay", "'ll stay"], hint: "stay" },
      ],
    });
    expect(gapsOf("no gaps")).toEqual({ parts: ["no gaps"], gaps: [] });
    expect(fillGaps("surprised [at/by]")).toBe("surprised at");
    expect(fillGaps("[Do you understand|you / understand] me?")).toBe("Do you understand me?");
  });

  it("print their English filled in", () => {
    expect(entryText(entry({ en: "[make] a mistake" }))).toBe("make a mistake");
    expect(entryText(entry({ en: "Can you ___ me your pen?", choice: ["lend", "borrow"] }))).toBe("Can you lend me your pen?");
    expect(entryText(entry({ choice: ["She has two brothers.", "She is having two brothers."] }))).toBe("She has two brothers.");
    expect(entryText(entry({ en: "give up" }))).toBe("give up");
  });
});

describe("checkTyped", () => {
  it("wants both forms, any spelling of each", () => {
    const e = entry({ en: "get", forms: ["got", "got/gotten"] });
    expect(checkTyped("forms", e, { gaps: ["got", "gotten"] })).toBe(true);
    expect(checkTyped("forms", e, { gaps: [" Got ", "got/gotten"] })).toBe(true);
    expect(checkTyped("forms", e, { gaps: ["got", ""] })).toBe(false);
    expect(checkTyped("forms", entry({ forms: ["was/were", "been"] }), { gaps: ["were", "been"] })).toBe(true);
  });

  it("wants every gap of a sentence, contractions and all", () => {
    const e = entry({ en: "I [haven't finished|not / finish] and she [has left|leave]." });
    expect(checkTyped("gap", e, { gaps: ["have not finished", "has left"] })).toBe(true);
    expect(checkTyped("gap", e, { gaps: ["haven’t finished", "has left"] })).toBe(true);
    expect(checkTyped("gap", e, { gaps: ["haven't finished", "left"] })).toBe(false);
  });

  it("takes no word, or a dash, where the answer is no article", () => {
    const e = entry({ en: "I’m afraid of [–] dogs." });
    expect(checkTyped("gap", e, { gaps: [""] })).toBe(true);
    expect(checkTyped("gap", e, { gaps: ["-"] })).toBe(true);
    expect(checkTyped("gap", e, { gaps: ["the"] })).toBe(false);
  });

  it("takes the phrase or one of its alternatives", () => {
    const e = entry({ en: "carry on", alt: ["go on"] });
    expect(checkTyped("translate", e, { text: "Carry on" })).toBe(true);
    expect(checkTyped("translate", e, { text: "go on" })).toBe(true);
    expect(checkTyped("translate", e, { text: "keep on" })).toBe(false);
  });
});

describe("choiceOrder", () => {
  it("shuffles every option in exactly once", () => {
    for (const n of [2, 3, 4]) {
      const o = choiceOrder("d:x:y", n, 0);
      expect([...o].sort()).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("is steady for a card and review, and not always right-first", () => {
    expect(choiceOrder("d:x:y", 3, 2)).toEqual(choiceOrder("d:x:y", 3, 2));
    const firsts = new Set<number>();
    for (let seed = 0; seed < 12; seed++) firsts.add(choiceOrder("d:confusables:lend", 2, seed)[0]);
    expect(firsts).toEqual(new Set([0, 1]));
  });
});

describe("the decks", () => {
  const all = [...lib.decks.values()];

  it("have sections, and every deck in one of them", () => {
    expect(lib.sections.map((s) => s.id)).toEqual(["grammar", "vocabulary"]);
    for (const d of all) expect(lib.sectionOf.get(d.id)).toBeTruthy();
    expect(lib.decks.has("irregular-verbs-advanced")).toBe(true);
  });

  for (const deck of all)
    it(`${deck.id}: every entry answers its own question`, () => {
      const fronts = new Set<string>();
      for (const e of deck.entries) {
        const kind = entryKind(deck, e);
        const at = `${deck.id}/${e.id}`;
        // the key, typed back, is right
        if (kind === "forms") expect(checkTyped(kind, e, { gaps: e.forms }), at).toBe(true);
        if (kind === "gap") {
          const { gaps } = gapsOf(e.en!);
          expect(gaps.length, at).toBeGreaterThan(0);
          expect(checkTyped(kind, e, { gaps: gaps.map((g) => g.answers[0]) }), at).toBe(true);
        }
        if (kind === "translate") {
          expect(checkTyped(kind, e, { text: e.en }), at).toBe(true);
          // the Russian never shows the answer
          for (const a of phraseAnswers(e)) expect(e.ru!.toLowerCase(), at).not.toContain(a.toLowerCase());
        }
        if (kind === "choice") {
          const opts = e.choice!;
          expect(new Set(opts).size, at).toBe(opts.length);
          if (e.en) expect(e.en.split("___").length, at).toBe(2);
        }
        // two cards of one deck with the same question could not be told apart
        const front = kind === "translate" ? e.ru! : kind === "choice" ? opts(e) : e.en!;
        expect(fronts.has(front), `${at}: the same question twice`).toBe(false);
        fronts.add(front);
      }
    });
});

const opts = (e: DeckEntry) => (e.en ?? "") + "|" + [...(e.choice ?? [])].sort().join("|");
