// Word packs: the answer checks of each kind of pack, and every pack of every
// book against the rules the cards rely on (sync_books.mjs checks the shape
// too; this also runs the entries through the checks they will meet).

import { describe, expect, it } from "vitest";
import type { Pack, PackEntry } from "./packs";
import { checkPackAnswer, entryText, gapParts, packCardId, packUnitsLabel, parsePackCardId } from "./packs";
import { parseWordCardId } from "./words";

const files = import.meta.glob<{ packs: Pack[] }>("../books/*/data/packs.json", { eager: true, import: "default" });
const byBook = Object.fromEntries(Object.entries(files).map(([path, f]) => [path.split("/")[2], f.packs]));

const entry = (e: Partial<PackEntry>): PackEntry => ({ id: "x", en: "", ru: "", ...e });

describe("pack card ids", () => {
  it("round-trip and stay apart from word and unit cards", () => {
    const id = packCardId("blue", "phrasal-verbs", "give-up");
    expect(id).toBe("v:blue:phrasal-verbs:give-up");
    expect(parsePackCardId(id)).toEqual({ book: "blue", pack: "phrasal-verbs", entry: "give-up" });
    expect(parseWordCardId(id)).toBeNull();
    expect(parsePackCardId("w:abc:f")).toBeNull();
    expect(parsePackCardId("blue:12.1:2")).toBeNull();
  });
});

describe("checkPackAnswer", () => {
  it("wants both forms, any spelling of each", () => {
    const e = entry({ en: "get", forms: ["got", "got/gotten"] });
    expect(checkPackAnswer("forms", e, { forms: ["got", "gotten"] })).toBe(true);
    expect(checkPackAnswer("forms", e, { forms: [" Got ", "got/gotten"] })).toBe(true);
    expect(checkPackAnswer("forms", e, { forms: ["got", ""] })).toBe(false);
    expect(checkPackAnswer("forms", entry({ forms: ["was/were", "been"] }), { forms: ["were", "been"] })).toBe(true);
  });

  it("takes the phrase or one of its alternatives", () => {
    const e = entry({ en: "carry on", alt: ["go on"] });
    expect(checkPackAnswer("translate", e, { text: "Carry on" })).toBe(true);
    expect(checkPackAnswer("translate", e, { text: "go on" })).toBe(true);
    expect(checkPackAnswer("translate", e, { text: "keep on" })).toBe(false);
  });

  it("fills a gap with any of its words", () => {
    const e = entry({ en: "surprised [at/by]" });
    expect(gapParts(e.en)).toEqual({ before: "surprised ", after: "", answers: ["at", "by"] });
    expect(checkPackAnswer("gap", e, { text: "by" })).toBe(true);
    expect(checkPackAnswer("gap", e, { text: "with" })).toBe(false);
    expect(entryText(e)).toBe("surprised at");
    expect(entryText(entry({ en: "[have/take] a shower" }))).toBe("have a shower");
  });

  it("labels the units a pack comes from", () => {
    expect(packUnitsLabel({ units: [137, 145] } as Pack)).toBe("Units 137–145");
    expect(packUnitsLabel({ units: [5] } as Pack)).toBe("Unit 5");
  });
});

describe("the books' packs", () => {
  it("exist for every book", () => {
    expect(Object.keys(byBook).sort()).toEqual(["blue", "red"]);
  });

  for (const [book, packs] of Object.entries(byBook))
    it(`${book}: every entry answers its own question`, () => {
      const packIds = new Set<string>();
      for (const p of packs) {
        expect(packIds.has(p.id)).toBe(false);
        packIds.add(p.id);
        const ids = new Set<string>();
        for (const e of p.entries) {
          expect(ids.has(e.id), `${p.id}/${e.id} repeated`).toBe(false);
          ids.add(e.id);
          expect(e.ru.trim()).not.toBe("");
          // the key, typed back, is right
          const ok =
            p.ask === "forms"
              ? checkPackAnswer(p.ask, e, { forms: e.forms })
              : p.ask === "gap"
                ? checkPackAnswer(p.ask, e, { text: gapParts(e.en).answers[0] })
                : checkPackAnswer(p.ask, e, { text: e.en });
          expect(ok, `${p.id}/${e.id}`).toBe(true);
        }
      }
    });

  it("a translation card never shows its answer in the Russian", () => {
    for (const packs of Object.values(byBook))
      for (const p of packs.filter((x) => x.ask === "translate"))
        for (const e of p.entries) expect(e.ru.toLowerCase()).not.toContain(e.en.toLowerCase());
  });
});
