// The SM-2 scheduler against Anki's documented defaults, and the daily queue.
// Times are built from local dates so the 4 a.m. day rollover is exercised the
// same way in every time zone.

import { describe, expect, it } from "vitest";
import type { CardState } from "./srs";
import {
  DEFAULT_CONFIG,
  answer,
  buildQueue,
  countAnswer,
  dayNumber,
  dayStart,
  deckCounts,
  formatDays,
  freshDaily,
  fuzzRange,
  intervalLabel,
  nextCard,
  noteOf,
  preview,
  todayDaily,
} from "./srs";

const MIN = 60_000;
const NOW = new Date(2026, 0, 10, 12, 0).getTime(); // 10 Jan 2026, noon local
const TODAY = dayNumber(NOW);

const review = (over: Partial<CardState> = {}): CardState => ({
  kind: "review",
  due: dayStart(TODAY),
  ivl: 10,
  ease: 2.5,
  step: 0,
  reps: 5,
  lapses: 0,
  last: NOW - 10 * 86_400_000,
  ...over,
});

describe("days", () => {
  it("rolls the study day over at 4 a.m. local time", () => {
    const d = (h: number, m = 0) => dayNumber(new Date(2026, 0, 11, h, m).getTime());
    expect(d(3, 59)).toBe(TODAY);
    expect(d(4, 0)).toBe(TODAY + 1);
    expect(d(23, 59)).toBe(TODAY + 1);
  });

  it("starts a day at its rollover hour", () => {
    expect(dayStart(TODAY)).toBe(new Date(2026, 0, 10, 4, 0).getTime());
    expect(dayNumber(dayStart(TODAY + 30))).toBe(TODAY + 30);
  });
});

describe("new and learning cards", () => {
  it("walks the 1m / 10m learning steps", () => {
    expect(answer(undefined, 1, NOW)).toMatchObject({ kind: "learning", step: 0, due: NOW + MIN, ease: 2.5, reps: 1 });
    // Hard on the first of two steps waits halfway between them
    expect(answer(undefined, 2, NOW)).toMatchObject({ kind: "learning", step: 0, due: NOW + 5.5 * MIN });
    expect(answer(undefined, 3, NOW)).toMatchObject({ kind: "learning", step: 1, due: NOW + 10 * MIN });
  });

  it("graduates after the last step with the graduating interval", () => {
    const s1 = answer(undefined, 3, NOW);
    const later = NOW + 10 * MIN;
    const s2 = answer(s1, 3, later);
    expect(s2).toMatchObject({ kind: "review", ivl: 1, ease: 2.5, reps: 2 });
    expect(s2.due).toBe(dayStart(TODAY + 1));
    // Hard on a later step repeats that step
    expect(answer(s1, 2, later)).toMatchObject({ kind: "learning", step: 1, due: later + 10 * MIN });
    // Again goes back to the first step
    expect(answer(s1, 1, later)).toMatchObject({ kind: "learning", step: 0, due: later + MIN });
  });

  it("Easy graduates at once with the easy interval", () => {
    expect(answer(undefined, 4, NOW)).toMatchObject({ kind: "review", ivl: 4, due: dayStart(TODAY + 4) });
  });
});

describe("review cards", () => {
  it("multiplies the interval by hard factor, ease and easy bonus", () => {
    expect(answer(review(), 2, NOW)).toMatchObject({ kind: "review", ivl: 12, ease: 2.35 });
    expect(answer(review(), 3, NOW)).toMatchObject({ kind: "review", ivl: 25, ease: 2.5 });
    expect(answer(review(), 4, NOW)).toMatchObject({ kind: "review", ivl: 33, ease: 2.65 });
    expect(answer(review(), 3, NOW).due).toBe(dayStart(TODAY + 25));
  });

  it("credits a late review with the days it waited", () => {
    const late = review({ due: dayStart(TODAY - 4) });
    // Good: (10 + 4/2) * 2.5; Easy: (10 + 4) * 2.5 * 1.3; Hard ignores the delay
    expect(answer(late, 3, NOW).ivl).toBe(30);
    expect(answer(late, 4, NOW).ivl).toBe(46);
    expect(answer(late, 2, NOW).ivl).toBe(12);
  });

  it("keeps Hard < Good < Easy even for tiny intervals", () => {
    const tiny = review({ ivl: 1, ease: 1.3 });
    const p = preview(tiny, NOW);
    expect(p[2].ivl).toBe(2);
    expect(p[3].ivl).toBeGreaterThan(p[2].ivl);
    expect(p[4].ivl).toBeGreaterThan(p[3].ivl);
  });

  it("lapses into relearning on Again and comes back at one day", () => {
    const lapsed = answer(review(), 1, NOW);
    expect(lapsed).toMatchObject({ kind: "relearning", step: 0, due: NOW + 10 * MIN, ivl: 1, ease: 2.3, lapses: 1 });
    const back = answer(lapsed, 3, NOW + 10 * MIN);
    expect(back).toMatchObject({ kind: "review", ivl: 1, due: dayStart(TODAY + 1), lapses: 1 });
    expect(answer(lapsed, 4, NOW + 10 * MIN)).toMatchObject({ kind: "review", ivl: 2 });
    // the single relearning step: Hard waits 1.5 times it
    expect(answer(lapsed, 2, NOW + 10 * MIN).due).toBe(NOW + 25 * MIN);
  });

  it("never lets ease drop below 130%", () => {
    let s = review({ ease: 1.4 });
    for (let i = 0; i < 5; i++) s = answer({ ...s, kind: "review", due: dayStart(TODAY) }, 1, NOW);
    expect(s.ease).toBe(1.3);
    expect(answer(review({ ease: 1.3 }), 2, NOW).ease).toBe(1.3);
  });

  it("caps intervals at the maximum", () => {
    expect(answer(review({ ivl: 30_000 }), 4, NOW).ivl).toBe(DEFAULT_CONFIG.maxIvl);
  });
});

describe("fuzz", () => {
  it("uses Anki's ranges", () => {
    expect(fuzzRange(1)).toEqual([1, 1]);
    expect(fuzzRange(2)).toEqual([2, 2]);
    expect(fuzzRange(10)).toEqual([8, 12]);
    // 1 + 0.15 * 4.5 + 0.1 * 13 + 0.05 * 80 ≈ 7 days either way
    expect(fuzzRange(100)).toEqual([93, 107]);
  });

  it("is reproducible per card, so the button label is the real interval", () => {
    const a = answer(review(), 3, NOW, DEFAULT_CONFIG, "blue:12.1:2");
    const b = answer(review(), 3, NOW, DEFAULT_CONFIG, "blue:12.1:2");
    expect(a).toEqual(b);
    expect(preview(review(), NOW, DEFAULT_CONFIG, "blue:12.1:2")[3]).toEqual(a);
    const [lo, hi] = fuzzRange(25);
    expect(a.ivl).toBeGreaterThanOrEqual(lo);
    expect(a.ivl).toBeLessThanOrEqual(hi);
    // different cards spread over the range
    const ivls = new Set(
      Array.from({ length: 40 }, (_, i) => answer(review(), 3, NOW, DEFAULT_CONFIG, `c${i}`).ivl),
    );
    expect(ivls.size).toBeGreaterThan(1);
  });
});

describe("labels", () => {
  it("prints minutes for learning and days to years for reviews", () => {
    const p = preview(undefined, NOW);
    expect([1, 2, 3, 4].map((r) => intervalLabel(p[r as 1 | 2 | 3 | 4], NOW))).toEqual(["1m", "6m", "10m", "4d"]);
    expect(formatDays(25)).toBe("25d");
    expect(formatDays(45)).toBe("1.5mo");
    expect(formatDays(60)).toBe("2mo");
    expect(formatDays(800)).toBe("2.2y");
  });
});

describe("daily counters", () => {
  it("count first answers as new and review answers as reviews", () => {
    const d = freshDaily(NOW);
    expect(countAnswer(d, undefined)).toMatchObject({ newDone: 1, reviewDone: 0 });
    expect(countAnswer(d, review())).toMatchObject({ newDone: 0, reviewDone: 1 });
    expect(countAnswer(d, answer(undefined, 3, NOW))).toEqual(d);
  });

  it("start from zero on a new day", () => {
    const d = { day: TODAY - 1, newDone: 20, reviewDone: 50 };
    expect(todayDaily(d, NOW)).toEqual({ day: TODAY, newDone: 0, reviewDone: 0 });
    expect(todayDaily({ ...d, day: TODAY }, NOW)).toEqual({ ...d, day: TODAY });
  });
});

describe("queue", () => {
  const cfg = { ...DEFAULT_CONFIG, newPerDay: 2, reviewsPerDay: 2 };
  const learning = (due: number): CardState => ({ ...answer(undefined, 3, NOW - 20 * MIN), due });

  it("orders learning, reviews, then new cards within the limits", () => {
    const states: Record<string, CardState> = {
      l1: learning(NOW - MIN),
      r1: review({ due: dayStart(TODAY - 2) }),
      r2: review({ due: dayStart(TODAY) }),
      r3: review({ due: dayStart(TODAY - 1) }),
      rFuture: review({ due: dayStart(TODAY + 3) }),
    };
    const ids = ["n1", "r1", "n2", "l1", "r2", "n3", "r3", "rFuture"];
    const q = buildQueue({ ids, states, suspended: new Set(), daily: freshDaily(NOW), now: NOW, cfg });
    expect(q.learn).toEqual(["l1"]);
    expect(q.review).toEqual(["r1", "r3"]); // most overdue first, cut to 2
    expect(q.fresh).toEqual(["n1", "n2"]);
    expect(nextCard(q, states, NOW, cfg)).toBe("l1");
    expect(nextCard({ ...q, learn: [] }, states, NOW, cfg)).toBe("r1");
    expect(nextCard({ ...q, learn: [], review: [] }, states, NOW, cfg)).toBe("n1");
  });

  it("subtracts what was already studied today and skips suspended cards", () => {
    const daily = { ...freshDaily(NOW), newDone: 1 };
    const q = buildQueue({ ids: ["n1", "n2", "n3"], states: {}, suspended: new Set(["n1"]), daily, now: NOW, cfg });
    expect(q.fresh).toEqual(["n2"]);
  });

  it("shows learning cards ahead only when nothing else is left", () => {
    const states = { a: learning(NOW + 5 * MIN), b: learning(NOW + 60 * MIN) };
    const q = buildQueue({ ids: ["a", "b"], states, suspended: new Set(), daily: freshDaily(NOW), now: NOW, cfg });
    expect(q.learn).toEqual([]);
    expect(q.later).toEqual(["a", "b"]);
    expect(nextCard(q, states, NOW, cfg)).toBe("a"); // within 20 minutes
    expect(nextCard({ ...q, later: ["b"] }, states, NOW, cfg)).toBeNull();
    expect(deckCounts({ ids: ["a", "b"], states, suspended: new Set(), daily: freshDaily(NOW), now: NOW, cfg })).toEqual({
      fresh: 0,
      learn: 2,
      review: 0,
      total: 2,
    });
  });

  it("buries the other direction of a word answered today", () => {
    expect(noteOf("w:abc:f")).toBe("w:abc");
    expect(noteOf("blue:12.1:2")).toBe("blue:12.1:2");
    const states = { "w:abc:f": answer(undefined, 3, NOW - MIN) };
    const q = buildQueue({
      ids: ["w:abc:f", "w:abc:r", "w:xyz:f"],
      states,
      suspended: new Set(),
      daily: freshDaily(NOW),
      now: NOW,
      cfg,
    });
    expect(q.fresh).toEqual(["w:xyz:f"]);
  });
});
