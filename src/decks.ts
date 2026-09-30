// Decks: which cards a study session reviews. A book's unit cards are made
// from its packed course (cards.ts) the first time a deck needs them and kept
// for the session; the learner's words come from the study store. What a
// card id stands for — a unit card or one direction of a saved word — is
// resolved here too, for the review screen.
//
// "Everything" is every card the learner has met plus the new cards of the
// units they have started: a unit finished in the course (progress.ts) or
// with any card studied, and every saved word. New cards of a book nobody
// has opened stay out, so the daily new-card allowance goes to what is being
// learned now rather than to Unit 1 of the other book. A book, group or unit
// deck introduces its new cards regardless.

import { useEffect, useMemo, useState } from "react";
import type { Book } from "./books";
import { BOOKS } from "./books";
import type { UnitCard } from "./cards";
import { unitCards } from "./cards";
import type { IndexData } from "./data";
import { fetchCourse, fetchIndexOnce } from "./data";
import { completedUnitIds, loadProgress } from "./progress";
import type { DeckRef } from "./routes";
import type { QueueInput } from "./srs";
import type { Word } from "./words";
import { parseWordCardId, wordCardIds } from "./words";

export interface BookCards {
  book: Book;
  index: IndexData;
  /** unit number -> its cards, in exercise order */
  byUnit: Map<number, UnitCard[]>;
  /** units in the book's learning order (its groups) */
  order: number[];
}

const loaded = new Map<string, Promise<BookCards>>();

export function loadBookCards(book: Book): Promise<BookCards> {
  let p = loaded.get(book.id);
  if (!p) {
    p = Promise.all([fetchIndexOnce(book), fetchCourse(book)])
      .then(([index, course]) => {
        const order = index.groups.flatMap((g) => g.units);
        const byUnit = new Map<number, UnitCard[]>();
        for (const n of order) {
          const u = course.units[n];
          if (u) byUnit.set(n, unitCards(book.id, u));
        }
        return { book, index, byUnit, order };
      })
      .catch((e: unknown) => {
        loaded.delete(book.id); // offline and not downloaded: the next visit retries
        throw e;
      });
    loaded.set(book.id, p);
  }
  return p;
}

/** The books a deck draws from. */
export function deckBooks(deck: DeckRef | undefined): readonly Book[] {
  if (!deck || deck.kind === "all") return BOOKS;
  if (deck.kind === "words") return [];
  return [deck.book];
}

export interface CardsState {
  /** book id -> its cards, as they arrive */
  books: Record<string, BookCards>;
  /** books whose course could not be loaded (offline, not downloaded) */
  failed: Book[];
  loading: boolean;
}

/** Load the unit cards of some books; a book that fails is reported, not fatal. */
export function useBookCards(books: readonly Book[]): CardsState {
  const key = books.map((b) => b.id).join(",");
  const [state, setState] = useState<CardsState>({ books: {}, failed: [], loading: books.length > 0 });
  useEffect(() => {
    let alive = true;
    setState({ books: {}, failed: [], loading: books.length > 0 });
    void Promise.allSettled(books.map(loadBookCards)).then((rs) => {
      if (!alive) return;
      const out: Record<string, BookCards> = {};
      const failed: Book[] = [];
      rs.forEach((r, i) => {
        if (r.status === "fulfilled") out[books[i].id] = r.value;
        else failed.push(books[i]);
      });
      setState({ books: out, failed, loading: false });
    });
    return () => {
      alive = false;
    };
    // keyed by the ids: callers pass fresh arrays of the same books
  }, [key]);
  return state;
}

/** Units the learner has started: finished in the course, or with a card studied. */
export function startedUnits(bc: BookCards, states: Readonly<Record<string, unknown>>): Set<number> {
  const out = completedUnitIds(loadProgress(bc.book.id));
  const prefix = `${bc.book.id}:`;
  for (const id of Object.keys(states)) {
    if (!id.startsWith(prefix)) continue;
    const ex = id.slice(prefix.length).split(":")[0]; // "12.3"
    const n = Number(ex.split(".")[0]);
    if (Number.isInteger(n)) out.add(n);
  }
  return out;
}

function unitIds(bc: BookCards, units: readonly number[]): string[] {
  return units.flatMap((n) => (bc.byUnit.get(n) ?? []).map((c) => c.id));
}

/** Word card ids, oldest word first: new words are introduced in the order they were saved. */
export function wordIds(words: readonly Word[]): string[] {
  return [...words].sort((a, b) => a.added - b.added).flatMap(wordCardIds);
}

/**
 * The card ids of a deck, in the order new cards are introduced. Null while
 * the book it needs has not loaded (or could not be).
 */
export function deckIds(
  deck: DeckRef,
  books: Readonly<Record<string, BookCards>>,
  words: readonly Word[],
  states: Readonly<Record<string, unknown>>,
): string[] | null {
  switch (deck.kind) {
    case "words":
      return wordIds(words);
    case "all": {
      const ids = wordIds(words);
      for (const b of BOOKS) {
        const bc = books[b.id];
        if (!bc) continue;
        const started = startedUnits(bc, states);
        ids.push(...unitIds(bc, bc.order.filter((n) => started.has(n))));
      }
      // cards met before whose book is not loaded right now still get reviewed
      // when their book comes back; nothing to show for them meanwhile
      return ids;
    }
    case "book": {
      const bc = books[deck.book.id];
      return bc ? unitIds(bc, bc.order) : null;
    }
    case "group": {
      const bc = books[deck.book.id];
      const g = bc?.index.groups[deck.group - 1];
      return bc ? unitIds(bc, g?.units ?? []) : null;
    }
    case "unit": {
      const bc = books[deck.book.id];
      return bc ? unitIds(bc, [deck.unit]) : null;
    }
  }
}

/** The deck's name, as the session header and the deck list print it. */
export function deckTitle(deck: DeckRef, books: Readonly<Record<string, BookCards>>): string {
  switch (deck.kind) {
    case "all":
      return "Everything due";
    case "words":
      return "My words";
    case "book":
      return deck.book.title;
    case "group":
      return books[deck.book.id]?.index.groups[deck.group - 1]?.name ?? `${deck.book.title}, group ${deck.group}`;
    case "unit": {
      const t = books[deck.book.id]?.index.exercises[`u${deck.unit}`]?.title;
      return t ? `Unit ${deck.unit} — ${t}` : `Unit ${deck.unit}`;
    }
  }
}

export type ResolvedCard = { type: "unit"; card: UnitCard } | { type: "word"; word: Word; dir: "f" | "r" };

/** Card content by id, across the loaded books and the dictionary. */
export function useCardLookup(
  books: Readonly<Record<string, BookCards>>,
  words: readonly Word[],
): (id: string) => ResolvedCard | null {
  return useMemo(() => {
    const unit = new Map<string, UnitCard>();
    for (const bc of Object.values(books)) for (const cs of bc.byUnit.values()) for (const c of cs) unit.set(c.id, c);
    const byWord = new Map(words.map((w) => [w.id, w]));
    return (id: string) => {
      const w = parseWordCardId(id);
      if (w) {
        const word = byWord.get(w.wordId);
        return word ? { type: "word", word, dir: w.dir } : null;
      }
      const card = unit.get(id);
      return card ? { type: "unit", card } : null;
    };
  }, [books, words]);
}

/** The queue input of a deck, from the store's state. */
export function queueInput(
  ids: readonly string[],
  srs: { states: QueueInput["states"]; suspended: readonly string[] },
  daily: QueueInput["daily"],
  now: number,
  cfg: QueueInput["cfg"],
  suspended?: ReadonlySet<string>,
): QueueInput {
  return { ids, states: srs.states, suspended: suspended ?? new Set(srs.suspended), daily, now, cfg };
}
