// The learning state, read out as a file: which cards are learned, which come
// back today, which are still in their learning steps, and when each of them
// is next due. The numbers are the store's own (study.ts keeps a card's
// scheduling state per card id; srs.ts decides what it means), so this is a
// report and not a second source of truth: it never writes.
//
// It answers a question the app itself cannot show — the state of every deck
// at once, off the device. Moving that state between browsers is the data
// file's job (datatransfer.ts); this is for looking at it.

import type { SrsData } from "./backup";
import type { DeckLibrary } from "./deckdata";
import { parseCardId } from "./deckdata";
import type { CardState, SrsConfig } from "./srs";
import { DEFAULT_CONFIG, dayNumber, dayStart } from "./srs";
import type { Word } from "./words";
import { parseWordCardId } from "./words";

export const LEARNING_FORMAT = "murrnglish-learning";

/** A graduated card is learned; the two step-based kinds are not there yet. */
export type LearningStatus = "learned" | "learning" | "relearning" | "suspended";

export interface LearningCard {
  id: string;
  /** the deck's title, or "My words" */
  deck: string;
  /** what the card asks, as the deck prints it */
  text: string;
  status: LearningStatus;
  /** a review card: the day it comes back; a learning card: the minute */
  due: string;
  reps: number;
  lapses: number;
  /** its interval in days (0 while it is still in its steps) */
  intervalDays: number;
  /** the day of its last answer */
  last: string;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * The report as it comes back in a data file, or null when what arrived is
 * not one. A report is never applied — the schedule moves as the cards do —
 * so this only has to recognise the shape well enough to read it, and it
 * drops what is broken rather than refusing the file around it.
 */
export function parseLearningReport(x: unknown): LearningReport | null {
  if (!isObj(x) || x.format !== LEARNING_FORMAT || x.version !== 1) return null;
  const t = x.totals;
  if (
    !isObj(t) ||
    !isNum(t.cards) ||
    !isNum(t.learned) ||
    !isNum(t.learning) ||
    !isNum(t.suspended) ||
    !isNum(t.dueToday)
  ) {
    return null;
  }
  return {
    format: LEARNING_FORMAT,
    version: 1,
    exported: isNum(x.exported) ? x.exported : 0,
    totals: {
      cards: t.cards,
      learned: t.learned,
      learning: t.learning,
      suspended: t.suspended,
      dueToday: t.dueToday,
    },
    forecast: Array.isArray(x.forecast)
      ? x.forecast.filter((f) => isObj(f) && typeof f.date === "string" && isNum(f.due))
      : [],
    decks: (Array.isArray(x.decks) ? x.decks : []).filter(isObj) as unknown as LearningDeck[],
    cards: (Array.isArray(x.cards) ? x.cards : []).filter(
      (c) => isObj(c) && typeof c.id === "string" && typeof c.deck === "string",
    ) as LearningCard[],
  };
}

export interface LearningDeck {
  deck: string;
  cards: number;
  learned: number;
  learning: number;
  suspended: number;
  /** cards due today, on the study day that runs from 4 a.m. */
  dueToday: number;
  /** the first day anything in this deck comes back */
  nextDue: string | null;
}

export interface LearningReport {
  format: typeof LEARNING_FORMAT;
  version: 1;
  exported: number;
  totals: {
    cards: number;
    learned: number;
    learning: number;
    suspended: number;
    dueToday: number;
  };
  /** one entry per coming day; overdue cards are counted on today */
  forecast: { date: string; due: number }[];
  decks: LearningDeck[];
  cards: LearningCard[];
}

/** How many coming days the forecast covers. */
export const FORECAST_DAYS = 14;

const WORDS_DECK = "My words";
const UNKNOWN_DECK = "A deck this browser no longer has";

/**
 * What the store holds, read out. Card ids the decks and the dictionary no
 * longer know (an older app wrote them, an edited deck dropped them) still
 * appear, under a deck named as unknown: their scheduling state is real and
 * worth showing even when the card behind it is gone.
 */
export function buildLearningReport(
  srs: SrsData,
  lib: DeckLibrary | null,
  words: readonly Word[],
  now: number,
  cfg: SrsConfig = DEFAULT_CONFIG,
): LearningReport {
  const suspended = new Set(srs.suspended);
  // one pass over the dictionary and the decks: a card id is looked up once
  const wordById = new Map(words.map((w) => [w.id, w]));
  const entryText = new Map<string, Map<string, string>>();
  for (const deck of lib?.decks.values() ?? []) {
    entryText.set(deck.id, new Map(deck.entries.map((e) => [e.id, e.en ?? e.ru ?? e.id])));
  }
  const cardText = (id: string): { deck: string; text: string } => {
    const w = parseWordCardId(id);
    if (w) {
      const word = wordById.get(w.wordId);
      return {
        deck: WORDS_DECK,
        text: word ? (w.dir === "r" ? `${word.word} → ${word.translation}` : word.word) : id,
      };
    }
    const c = parseCardId(id);
    if (c) {
      return {
        deck: lib?.decks.get(c.deck)?.title ?? c.deck,
        text: entryText.get(c.deck)?.get(c.entry) ?? c.entry,
      };
    }
    return { deck: UNKNOWN_DECK, text: id };
  };

  // every card with a state, plus every suspended id (it may have no state)
  const ids = [...new Set([...Object.keys(srs.states), ...suspended])].sort();
  const today = dayNumber(now, cfg);
  const forecast: { date: string; due: number }[] = Array.from(
    { length: FORECAST_DAYS },
    (_, i) => ({ date: studyDate(now, cfg, i), due: 0 }),
  );
  const decks = new Map<string, LearningDeck>();
  const cards: LearningCard[] = [];
  const totals = { cards: 0, learned: 0, learning: 0, suspended: 0, dueToday: 0 };

  for (const id of ids) {
    const state: CardState | undefined = srs.states[id];
    const { deck, text } = cardText(id);
    const isSuspended = suspended.has(id);
    const status: LearningStatus = isSuspended
      ? "suspended"
      : !state || state.kind === "review"
        ? "learned"
        : state.kind;
    // a review card's due is the start of its study day; a learning card's is
    // a minute from now, so it reads as a moment instead of a date
    const isReview = !state || state.kind === "review";
    const dueDay = state ? dayNumber(state.due, cfg) : today;
    const day = Math.max(0, Math.min(FORECAST_DAYS - 1, dueDay - today));
    const dueToday = state !== undefined && (isReview ? dueDay <= today : state.due <= now);
    if (state) {
      if (dueDay <= today + FORECAST_DAYS - 1) forecast[day].due++;
      if (dueToday) totals.dueToday++;
    }
    if (status === "learned") totals.learned++;
    else if (status === "suspended") totals.suspended++;
    else totals.learning++;
    totals.cards++;

    const when = state ? (isReview ? studyDate(now, cfg, day) : studyMoment(state.due)) : "";
    cards.push({
      id,
      deck,
      text,
      status,
      due: when,
      reps: state?.reps ?? 0,
      lapses: state?.lapses ?? 0,
      intervalDays: state && isReview ? state.ivl : 0,
      last: state ? isoDay(state.last) : "",
    });

    const row = decks.get(deck) ?? {
      deck,
      cards: 0,
      learned: 0,
      learning: 0,
      suspended: 0,
      dueToday: 0,
      nextDue: null,
    };
    row.cards++;
    if (status === "learned") row.learned++;
    else if (status === "suspended") row.suspended++;
    else row.learning++;
    if (dueToday) row.dueToday++;
    // the earliest day anything in this deck still owes the learner
    if (when && (!row.nextDue || when < row.nextDue)) row.nextDue = when;
    decks.set(deck, row);
  }

  return {
    format: LEARNING_FORMAT,
    version: 1,
    exported: now,
    totals,
    forecast,
    decks: [...decks.values()].sort((a, b) => a.deck.localeCompare(b.deck)),
    cards,
  };
}

// ---- dates -----------------------------------------------------------------
// Local calendar dates, not UTC ones: "the 5th" must read the same on the
// machine that wrote the file. A study day starts at 4 a.m. (srs.ts), so it is
// named by the date it starts on.

const pad = (n: number): string => String(n).padStart(2, "0");

export function isoDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The name of the study day `offset` days from today's. */
export function studyDate(now: number, cfg: SrsConfig, offset: number): string {
  return isoDay(dayStart(dayNumber(now, cfg) + offset, cfg));
}

function studyMoment(ts: number): string {
  const d = new Date(ts);
  return `${isoDay(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}