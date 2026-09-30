// Spaced repetition: Anki's SM-2 scheduler (the "v3" defaults Anki ships with
// before FSRS is switched on) and the daily queue. Pure functions only — the
// store (study.ts) persists what they return, the review screen shows it.
//
// Why SM-2 and not FSRS: the learners here know Anki, and SM-2's behaviour is
// what its buttons promise — "Good" multiplies the interval by the card's
// ease, "Again" sends it back to relearning. It needs no fitted parameters
// (FSRS's defaults are tuned on other people's review logs and only pay off
// once they are re-fitted on your own), its state is four numbers per card,
// and every rule below can be checked by hand against Anki's manual.
//
// Time: learning steps are minutes, review intervals are days. A day starts
// at 4 a.m. local time (Anki's "next day starts at"), so a late-night session
// still counts as the same day.

export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export const RATINGS: readonly Rating[] = [1, 2, 3, 4];
export const RATING_LABEL: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export interface CardState {
  /** new cards have no state at all: the first answer creates one */
  kind: "learning" | "review" | "relearning";
  /** epoch ms when the card is next shown; review cards: the start of their day */
  due: number;
  /** review interval in days; while relearning, the interval it returns to */
  ivl: number;
  /** interval multiplier, 1.3 and up (Anki's "ease", 250% = 2.5) */
  ease: number;
  /** index into the learning or relearning steps */
  step: number;
  reps: number;
  lapses: number;
  /** epoch ms of the last answer */
  last: number;
}

export interface SrsConfig {
  /** minutes */
  learnSteps: number[];
  /** minutes */
  relearnSteps: number[];
  graduatingIvl: number;
  easyIvl: number;
  startEase: number;
  easyBonus: number;
  hardFactor: number;
  /** "new interval" after a lapse, as a share of the old one (0 = start over) */
  lapseFactor: number;
  minIvl: number;
  maxIvl: number;
  newPerDay: number;
  reviewsPerDay: number;
  /** local hour the study day rolls over at */
  dayStartHour: number;
  /** learning cards due within this many minutes are shown when nothing else is left */
  learnAheadMin: number;
}

export const DEFAULT_CONFIG: SrsConfig = {
  learnSteps: [1, 10],
  relearnSteps: [10],
  graduatingIvl: 1,
  easyIvl: 4,
  startEase: 2.5,
  easyBonus: 1.3,
  hardFactor: 1.2,
  lapseFactor: 0,
  minIvl: 1,
  maxIvl: 36500,
  newPerDay: 20,
  reviewsPerDay: 200,
  dayStartHour: 4,
  learnAheadMin: 20,
};

const MIN = 60_000;
const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;

// ---- days -------------------------------------------------------------------

/** The study day `ts` falls in: a local calendar date, shifted by the rollover hour. */
export function dayNumber(ts: number, cfg: Pick<SrsConfig, "dayStartHour"> = DEFAULT_CONFIG): number {
  const d = new Date(ts - cfg.dayStartHour * 3_600_000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** epoch ms at which study day `day` begins (local time, DST-safe). */
export function dayStart(day: number, cfg: Pick<SrsConfig, "dayStartHour"> = DEFAULT_CONFIG): number {
  const d = new Date(day * DAY_MS);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cfg.dayStartHour).getTime();
}

// ---- fuzz -------------------------------------------------------------------

// Anki spreads review intervals a little so cards added together do not stay
// due together forever. The spread is seeded from the card and its review
// count rather than Math.random, so the interval printed on a button is
// exactly the one that answer schedules.
function seeded(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Anki's fuzz range: ±15% up to a week, ±10% to 20 days, ±5% beyond. */
export function fuzzRange(ivl: number): [number, number] {
  if (ivl < 2.5) return [ivl, ivl];
  let delta = 1;
  delta += 0.15 * Math.max(0, Math.min(ivl, 7) - 2.5);
  delta += 0.1 * Math.max(0, Math.min(ivl, 20) - 7);
  delta += 0.05 * Math.max(0, ivl - 20);
  const lo = Math.max(2, Math.round(ivl - delta));
  const hi = Math.round(ivl + delta);
  return [lo, Math.max(lo, hi)];
}

function fuzzed(ivl: number, seed: string | null): number {
  if (seed === null) return ivl;
  const [lo, hi] = fuzzRange(ivl);
  return lo + Math.floor(seeded(seed) * (hi - lo + 1));
}

// ---- answering ----------------------------------------------------------------

const clampIvl = (ivl: number, cfg: SrsConfig) =>
  Math.min(cfg.maxIvl, Math.max(cfg.minIvl, Math.round(ivl)));

/** A graduated card: due at the start of the day `ivl` days from `now`. */
function toReview(prev: Omit<CardState, "kind" | "due" | "step">, ivl: number, now: number, cfg: SrsConfig): CardState {
  return {
    ...prev,
    kind: "review",
    ivl,
    step: 0,
    due: dayStart(dayNumber(now, cfg) + ivl, cfg),
  };
}

/** Delay of the "Hard" answer on a learning step (Anki v3 rules). */
function hardStepDelay(steps: number[], step: number): number {
  if (step > 0) return steps[step];
  if (steps.length === 1) return Math.min(steps[0] * 1.5, steps[0] + 1440);
  return (steps[0] + steps[1]) / 2;
}

/**
 * The card's state after answering `rating` at `now`. `seed` (the card id)
 * makes the interval fuzz reproducible; null turns fuzz off.
 */
export function answer(
  state: CardState | undefined,
  rating: Rating,
  now: number,
  cfg: SrsConfig = DEFAULT_CONFIG,
  seed: string | null = null,
): CardState {
  const base = state ?? {
    kind: "learning" as const,
    due: now,
    ivl: 0,
    ease: cfg.startEase,
    step: 0,
    reps: 0,
    lapses: 0,
    last: now,
  };
  const common = { ...base, reps: base.reps + 1, last: now };

  if (base.kind === "learning" || base.kind === "relearning") {
    const relearn = base.kind === "relearning";
    const steps = relearn ? cfg.relearnSteps : cfg.learnSteps;
    const step = Math.min(base.step, Math.max(0, steps.length - 1));
    // what graduating gives: a lapsed card returns to its reduced interval
    const gradIvl = relearn ? Math.max(cfg.minIvl, base.ivl) : cfg.graduatingIvl;
    switch (rating) {
      case 1:
        if (!steps.length) return toReview(common, gradIvl, now, cfg);
        return { ...common, step: 0, due: now + steps[0] * MIN };
      case 2:
        if (!steps.length) return toReview(common, gradIvl, now, cfg);
        return { ...common, step, due: now + hardStepDelay(steps, step) * MIN };
      case 3: {
        const next = step + 1;
        if (next < steps.length) return { ...common, step: next, due: now + steps[next] * MIN };
        return toReview(common, gradIvl, now, cfg);
      }
      case 4: {
        const ivl = relearn ? gradIvl + 1 : cfg.easyIvl;
        return toReview(common, clampIvl(fuzzed(ivl, seed && `${seed}#${common.reps}`), cfg), now, cfg);
      }
    }
  }

  // review
  const today = dayNumber(now, cfg);
  const delay = Math.max(0, today - dayNumber(base.due, cfg));
  const s = seed && `${seed}#${common.reps}`;
  const hard = clampIvl(Math.max(base.ivl + 1, fuzzed(Math.round(base.ivl * cfg.hardFactor), s && s + "h")), cfg);
  switch (rating) {
    case 1: {
      const ease = Math.max(MIN_EASE, base.ease - 0.2);
      const ivl = clampIvl(base.ivl * cfg.lapseFactor, cfg);
      const lapsed = { ...common, ease, ivl, lapses: base.lapses + 1 };
      if (!cfg.relearnSteps.length) return toReview(lapsed, ivl, now, cfg);
      return { ...lapsed, kind: "relearning", step: 0, due: now + cfg.relearnSteps[0] * MIN };
    }
    case 2:
      return toReview({ ...common, ease: Math.max(MIN_EASE, base.ease - 0.15) }, hard, now, cfg);
    case 3: {
      const good = goodIvl(base, delay, hard, cfg, s);
      return toReview(common, good, now, cfg);
    }
    case 4: {
      const good = goodIvl(base, delay, hard, cfg, s);
      const raw = (base.ivl + delay) * base.ease * cfg.easyBonus;
      const easy = clampIvl(Math.max(good + 1, fuzzed(Math.round(raw), s && s + "e")), cfg);
      return toReview({ ...common, ease: base.ease + 0.15 }, easy, now, cfg);
    }
  }
}

function goodIvl(base: CardState, delay: number, hard: number, cfg: SrsConfig, s: string | null): number {
  const raw = (base.ivl + delay / 2) * base.ease;
  return clampIvl(Math.max(hard + 1, fuzzed(Math.round(raw), s && s + "g")), cfg);
}

/** What each button would do, for the labels over them. */
export function preview(
  state: CardState | undefined,
  now: number,
  cfg: SrsConfig = DEFAULT_CONFIG,
  seed: string | null = null,
): Record<Rating, CardState> {
  return {
    1: answer(state, 1, now, cfg, seed),
    2: answer(state, 2, now, cfg, seed),
    3: answer(state, 3, now, cfg, seed),
    4: answer(state, 4, now, cfg, seed),
  };
}

/**
 * The label over an answer button: "1m", "10m", "4d", "1.5mo", "2.1y". A
 * review card's wait is its interval in days, whatever the hour of the day —
 * the clock time of its due (4 a.m.) says nothing to the learner.
 */
export function intervalLabel(next: CardState, now: number): string {
  if (next.kind === "review") return formatDays(next.ivl);
  return formatMinutes(next.due - now);
}

export function formatMinutes(ms: number): string {
  const m = Math.round(ms / MIN);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return formatDays(Math.round(m / 1440));
}

export function formatDays(days: number): string {
  if (days < 30) return `${days}d`;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (days < 365) return `${trim(days / 30)}mo`;
  return `${trim(days / 365)}y`;
}

// ---- the daily queue ------------------------------------------------------------

/** What was studied on the current day; reset when the day rolls over. */
export interface Daily {
  day: number;
  /** new cards seen for the first time */
  newDone: number;
  /** review-card answers */
  reviewDone: number;
}

export function freshDaily(now: number, cfg: SrsConfig = DEFAULT_CONFIG): Daily {
  return { day: dayNumber(now, cfg), newDone: 0, reviewDone: 0 };
}

/** The counters for today — yesterday's numbers do not carry over. */
export function todayDaily(d: Daily | undefined, now: number, cfg: SrsConfig = DEFAULT_CONFIG): Daily {
  return d && d.day === dayNumber(now, cfg) ? d : freshDaily(now, cfg);
}

/** Count one answer against today's limits. */
export function countAnswer(d: Daily, prev: CardState | undefined): Daily {
  if (!prev) return { ...d, newDone: d.newDone + 1 };
  if (prev.kind === "review") return { ...d, reviewDone: d.reviewDone + 1 };
  return d;
}

/**
 * Cards that belong together (the two directions of one saved word):
 * answering one hides the other until tomorrow, as Anki's sibling burying
 * does. "w:<id>:f" / "w:<id>:r" share "w:<id>"; everything else stands alone.
 */
export function noteOf(id: string): string {
  const m = id.match(/^(w:[^:]+):[a-z]$/);
  return m ? m[1] : id;
}

export interface QueueInput {
  /** the deck's cards, in the order new ones are introduced */
  ids: readonly string[];
  states: Readonly<Record<string, CardState>>;
  suspended: ReadonlySet<string>;
  daily: Daily;
  now: number;
  cfg?: SrsConfig;
}

export interface Queue {
  /** learning/relearning cards due now, earliest first */
  learn: string[];
  /** review cards due today, most overdue first, cut to the review limit */
  review: string[];
  /** new cards within today's limit, in deck order */
  fresh: string[];
  /** learning cards due later today, earliest first — shown ahead once the rest is done */
  later: string[];
}

export function buildQueue({ ids, states, suspended, daily, now, cfg = DEFAULT_CONFIG }: QueueInput): Queue {
  const today = dayNumber(now, cfg);
  const todayStart = dayStart(today, cfg);
  const learn: [string, number][] = [];
  const later: [string, number][] = [];
  const review: [string, number][] = [];
  const fresh: string[] = [];
  // notes answered today: their other cards wait (sibling burying)
  const touched = new Set<string>();
  for (const id of ids) {
    const s = states[id];
    if (s && s.last >= todayStart) touched.add(noteOf(id));
  }
  const buried = (id: string) => noteOf(id) !== id && touched.has(noteOf(id));
  const newLeft = Math.max(0, cfg.newPerDay - daily.newDone);
  const reviewLeft = Math.max(0, cfg.reviewsPerDay - daily.reviewDone);
  for (const id of ids) {
    if (suspended.has(id)) continue;
    const s = states[id];
    if (!s) {
      if (fresh.length < newLeft && !buried(id)) fresh.push(id);
      continue;
    }
    if (s.kind === "review") {
      if (dayNumber(s.due, cfg) <= today && !(buried(id) && s.last < todayStart)) review.push([id, s.due]);
    } else if (s.due <= now) {
      learn.push([id, s.due]);
    } else if (dayNumber(s.due, cfg) <= today) {
      later.push([id, s.due]);
    }
  }
  const byDue = (a: [string, number], b: [string, number]) => a[1] - b[1];
  return {
    learn: learn.sort(byDue).map(([id]) => id),
    review: review.sort(byDue).slice(0, reviewLeft).map(([id]) => id),
    fresh,
    later: later.sort(byDue).map(([id]) => id),
  };
}

/**
 * The next card to show, or null when the session is over. Order: learning
 * cards that are due, then reviews, then new cards, then — once nothing else
 * is left — learning cards due within the learn-ahead window.
 */
export function nextCard(q: Queue, states: Readonly<Record<string, CardState>>, now: number, cfg: SrsConfig = DEFAULT_CONFIG): string | null {
  if (q.learn.length) return q.learn[0];
  if (q.review.length) return q.review[0];
  if (q.fresh.length) return q.fresh[0];
  const ahead = q.later.find((id) => (states[id]?.due ?? Infinity) <= now + cfg.learnAheadMin * MIN);
  return ahead ?? null;
}

/** New / learning / due counts for a deck, as the deck list shows them. */
export interface DeckCounts {
  fresh: number;
  learn: number;
  review: number;
  total: number;
}

export function deckCounts(input: QueueInput): DeckCounts {
  const q = buildQueue(input);
  return {
    fresh: q.fresh.length,
    learn: q.learn.length + q.later.length,
    review: q.review.length,
    total: input.ids.length,
  };
}
