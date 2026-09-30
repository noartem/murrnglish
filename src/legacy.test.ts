// The review history of the book-made cards: pack cards move to the deck
// entry they became, unit cards and the old ticks go.

import { describe, expect, it } from "vitest";
import type { SrsData } from "./backup";
import type { DeckLibrary } from "./deckdata";
import { makeLibrary } from "./deckdata";
import { currentId, migrateLegacy } from "./legacy";
import type { CardState } from "./srs";

const lib: DeckLibrary = makeLibrary({
  sections: [
    {
      id: "vocabulary",
      title: "Vocabulary",
      about: "",
      groups: [
        {
          title: "Verbs",
          decks: [
            { id: "irregular-verbs", title: "", about: "", level: "A2", entries: [{ id: "go", en: "go", forms: ["went", "gone"] }] },
            {
              id: "irregular-verbs-advanced",
              title: "",
              about: "",
              level: "C1",
              entries: [{ id: "flee", en: "flee", forms: ["fled", "fled"] }],
            },
          ],
        },
      ],
    },
  ],
});

const at = (last: number): CardState => ({ kind: "review", due: 0, ivl: 1, ease: 2.5, step: 0, reps: 1, lapses: 0, last });

describe("currentId", () => {
  it("keeps the cards of now and moves a pack card to its entry", () => {
    expect(currentId("w:abc:f", lib)).toBe("w:abc:f");
    expect(currentId("d:irregular-verbs:go", lib)).toBe("d:irregular-verbs:go");
    expect(currentId("v:blue:irregular-verbs:go", lib)).toBe("d:irregular-verbs:go");
    expect(currentId("v:red:irregular-verbs:flee", lib)).toBe("d:irregular-verbs-advanced:flee");
  });

  it("drops what has no place any more", () => {
    expect(currentId("v:blue:irregular-verbs:beget", lib)).toBeNull();
    expect(currentId("v:red:time-and-place:at-night", lib)).toBeNull();
    expect(currentId("blue:12.1:3", lib)).toBeNull();
  });
});

describe("migrateLegacy", () => {
  it("leaves a store of today alone", () => {
    const srs: SrsData = { states: { "d:irregular-verbs:go": at(1) }, suspended: [] };
    expect(migrateLegacy(srs, { words: false, "irregular-verbs": true }, lib)).toBeNull();
  });

  it("moves the history, keeps the later answer and drops the old ticks", () => {
    const srs: SrsData = {
      states: {
        "v:blue:irregular-verbs:go": at(5),
        "v:red:irregular-verbs:go": at(9),
        "blue:12.1:3": at(7),
        "w:abc:f": at(3),
      },
      suspended: ["v:red:irregular-verbs:flee", "red:4.2:1"],
      daily: { day: 1, newDone: 2, reviewDone: 3 },
    };
    const r = migrateLegacy(srs, { blue: false, "blue/u12": true, "red/pack-irregular-verbs": true, words: true }, lib)!;
    expect(r.srs.states).toEqual({ "d:irregular-verbs:go": at(9), "w:abc:f": at(3) });
    expect(r.srs.suspended).toEqual(["d:irregular-verbs-advanced:flee"]);
    expect(r.srs.daily).toEqual(srs.daily);
    expect(r.include).toEqual({ words: true });
  });
});
