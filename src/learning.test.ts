// The learning-state report: what the store's scheduling state reads out as.
// The numbers are the ones the card decks show, so the report has to agree
// with the scheduler's own days and status.

import { describe, expect, it } from "vitest";
import { makeLibrary } from "./deckdata";
import type { SrsData } from "./backup";
import { FORECAST_DAYS, buildLearningReport, studyDate } from "./learning";
import { DEFAULT_CONFIG, dayStart, dayNumber } from "./srs";
import type { Word } from "./words";

const NOW = new Date(2026, 4, 14, 12, 0, 0).getTime(); // 14 May 2026, noon
const today = dayNumber(NOW, DEFAULT_CONFIG);
const day = (offset: number) => dayStart(today + offset, DEFAULT_CONFIG);
const review = (dueOffset: number, reps = 3): SrsData["states"][string] => ({
  kind: "review",
  due: day(dueOffset),
  ivl: 10,
  ease: 2.5,
  step: 0,
  reps,
  lapses: 0,
  last: day(-2),
});

const learning = (dueInMin: number): SrsData["states"][string] => ({
  kind: "learning",
  due: NOW + dueInMin * 60_000,
  ivl: 0,
  ease: 2.5,
  step: 1,
  reps: 2,
  lapses: 0,
  last: NOW,
});

const word: Word = {
  id: "w1",
  word: "borrow",
  translation: "занимать",
  notes: "",
  reverse: true,
  added: 1,
  updated: 1,
};

const lib = makeLibrary({
  sections: [
    {
      id: "grammar",
      title: "Grammar",
      about: "",
      groups: [
        {
          title: "Verbs",
          decks: [
            {
              id: "irregular",
              title: "Irregular verbs",
              about: "",
              level: "A2",
              entries: [{ id: "go", en: "go" }],
            },
          ],
        },
      ],
    },
  ],
});

describe("learning state report", () => {
  it("reads the store's cards out: learned, learning, suspended", () => {
    const srs: SrsData = {
      states: {
        "d:irregular:go": review(0, 7),
        "w:w1:f": review(3),
        "d:irregular:gone": learning(10),
      },
      suspended: ["w:w1:r"],
    };
    const r = buildLearningReport(srs, lib, [word], NOW);
    expect(r.format).toBe("murrnglish-learning");
    expect(r.totals).toEqual({ cards: 4, learned: 2, learning: 1, suspended: 1, dueToday: 1 });
    const byId = Object.fromEntries(r.cards.map((c) => [c.id, c]));
    expect(byId["d:irregular:go"]).toMatchObject({
      deck: "Irregular verbs",
      text: "go",
      status: "learned",
      due: studyDate(NOW, DEFAULT_CONFIG, 0),
      intervalDays: 10,
      reps: 7,
    });
    // a card still in its steps comes back in minutes, so it prints a moment
    expect(byId["d:irregular:gone"]).toMatchObject({
      status: "learning",
      due: "2026-05-14 12:10",
      intervalDays: 0,
    });
    // the suspended card has no state of its own, yet it is still a card
    expect(byId["w:w1:r"]).toMatchObject({ deck: "My words", status: "suspended", due: "" });
    // the reverse direction reads the other way round
    expect(byId["w:w1:f"].text).toBe("borrow");
  });

  it("counts every day of the forecast, overdue cards on today", () => {
    const srs: SrsData = {
      states: {
        a: review(-3),
        b: review(0),
        c: review(2),
        d: review(FORECAST_DAYS + 5),
      },
      suspended: [],
    };
    const r = buildLearningReport(srs, lib, [], NOW);
    expect(r.forecast).toHaveLength(FORECAST_DAYS);
    expect(r.forecast[0]).toEqual({ date: studyDate(NOW, DEFAULT_CONFIG, 0), due: 2 }); // overdue + today
    expect(r.forecast[2].due).toBe(1);
    expect(r.forecast.slice(3).every((f) => f.due === 0)).toBe(true);
    expect(r.totals.dueToday).toBe(2);
  });

  it("groups the cards by deck, with the earliest day each owes", () => {
    const srs: SrsData = {
      states: { "d:irregular:go": review(4), "w:w1:f": review(1) },
      suspended: ["w:w1:r"],
    };
    const r = buildLearningReport(srs, lib, [word], NOW);
    expect(r.decks).toEqual([
      {
        deck: "Irregular verbs",
        cards: 1,
        learned: 1,
        learning: 0,
        suspended: 0,
        dueToday: 0,
        nextDue: studyDate(NOW, DEFAULT_CONFIG, 4),
      },
      {
        deck: "My words",
        cards: 2,
        learned: 1,
        learning: 0,
        suspended: 1,
        dueToday: 0,
        nextDue: studyDate(NOW, DEFAULT_CONFIG, 1),
      },
    ]);
  });

  it("keeps a card whose deck this browser no longer has", () => {
    const r = buildLearningReport({ states: { "d:gone:card": review(1) }, suspended: [] }, null, [], NOW);
    expect(r.cards[0]).toMatchObject({ deck: "gone", text: "card", status: "learned" });
  });

  it("is empty, not broken, with nothing learned", () => {
    const r = buildLearningReport({ states: {}, suspended: [] }, lib, [], NOW);
    expect(r.cards).toEqual([]);
    expect(r.decks).toEqual([]);
    expect(r.totals.cards).toBe(0);
    expect(r.forecast.every((f) => f.due === 0)).toBe(true);
  });
});