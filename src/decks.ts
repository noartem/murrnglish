// Decks: which cards a study session reviews. A book's unit cards are made
// from its packed course (cards.ts) the first time a deck needs them and kept
// for the session, together with its word packs (packs.ts); the learner's
// words come from the study store. What a card id stands for — a unit card,
// a pack entry or one direction of a saved word — is resolved here too, for
// the review screen.
//
// "Everything" is what the learner ticked on the deck list (selection.ts):
// their words, and in every book switched on the units and packs ticked —
// or, where nothing was ticked, started: a unit finished in the course
// (progress.ts) or anything of it studied. New cards of a book nobody has
// opened stay out, so the daily new-card allowance goes to what is being
// learned now rather than to Unit 1 of the other book. A book's own deck is
// its share of that; a group, unit or pack deck introduces its new cards
// regardless.

import { useEffect, useMemo, useState } from "react";
import type { Book } from "./books";
import { BOOKS } from "./books";
import type { UnitCard } from "./cards";
import { unitCards } from "./cards";
import type { IndexData } from "./data";
import { fetchCourse, fetchIndexOnce } from "./data";
import type { Pack, PackEntry } from "./packs";
import { loadPacks, packCardIds, parsePackCardId } from "./packs";
import { completedUnitIds, loadProgress } from "./progress";
import type { DeckRef } from "./routes";
import type { Include } from "./selection";
import { WORDS_PICK, bookOn, interleave, packPick, picked, unitPick } from "./selection";
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
  /** the book's word packs (none when it has no data/packs.json) */
  packs: Pack[];
}

const loaded = new Map<string, Promise<BookCards>>();

export function loadBookCards(book: Book): Promise<BookCards> {
  let p = loaded.get(book.id);
  if (!p) {
    p = Promise.all([fetchIndexOnce(book), fetchCourse(book), loadPacks(book)])
      .then(([index, course, packs]) => {
        const order = index.groups.flatMap((g) => g.units);
        const byUnit = new Map<number, UnitCard[]>();
        for (const n of order) {
          const u = course.units[n];
          if (u) byUnit.set(n, unitCards(book.id, u));
        }
        return { book, index, byUnit, order, packs };
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

/** Packs with any card studied. */
export function startedPacks(bc: BookCards, states: Readonly<Record<string, unknown>>): Set<string> {
  const out = new Set<string>();
  for (const id of Object.keys(states)) {
    const p = parsePackCardId(id);
    if (p && p.book === bc.book.id) out.add(p.pack);
  }
  return out;
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

/** The units and packs of a book that daily study takes (ticked, or started). */
export function pickedIn(
  bc: BookCards,
  include: Include,
  states: Readonly<Record<string, unknown>>,
): { units: number[]; packs: Pack[] } {
  const b = bc.book.id;
  const started = startedUnits(bc, states);
  const packsStarted = startedPacks(bc, states);
  return {
    units: bc.order.filter((n) => picked(include, unitPick(b, n), started.has(n))),
    packs: bc.packs.filter((p) => picked(include, packPick(b, p.id), packsStarted.has(p.id))),
  };
}

/** A book's share of daily study: its picked units, and each picked pack. */
function bookShare(bc: BookCards, include: Include, states: Readonly<Record<string, unknown>>): string[][] {
  const { units, packs } = pickedIn(bc, include, states);
  return [unitIds(bc, units), ...packs.map((p) => packCardIds(bc.book.id, p))];
}

/**
 * The card ids of a deck, in the order new cards are introduced. Null while
 * the book it needs has not loaded (or could not be). Daily study takes its
 * sources by turns (the words, a book's units, each pack), so ticking a pack
 * brings its new cards in at once rather than after every unit's.
 */
export function deckIds(
  deck: DeckRef,
  books: Readonly<Record<string, BookCards>>,
  words: readonly Word[],
  states: Readonly<Record<string, unknown>>,
  include: Include = {},
): string[] | null {
  switch (deck.kind) {
    case "words":
      return wordIds(words);
    case "all": {
      const lists: string[][] = [include[WORDS_PICK] === false ? [] : wordIds(words)];
      for (const b of BOOKS) {
        const bc = books[b.id];
        if (!bc || !bookOn(include, b.id)) continue;
        lists.push(...bookShare(bc, include, states));
      }
      // cards met before whose book is not loaded right now still get reviewed
      // when their book comes back; nothing to show for them meanwhile
      return interleave(lists);
    }
    case "book": {
      const bc = books[deck.book.id];
      return bc ? interleave(bookShare(bc, include, states)) : null;
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
    case "pack": {
      const bc = books[deck.book.id];
      if (!bc) return null;
      const p = bc.packs.find((x) => x.id === deck.pack);
      return p ? packCardIds(bc.book.id, p) : [];
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
    case "pack":
      return books[deck.book.id]?.packs.find((p) => p.id === deck.pack)?.title ?? "Word pack";
  }
}

export type ResolvedCard =
  | { type: "unit"; card: UnitCard }
  | { type: "word"; word: Word; dir: "f" | "r" }
  | { type: "pack"; book: Book; pack: Pack; entry: PackEntry };

/** Card content by id, across the loaded books (units and packs) and the dictionary. */
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
      const v = parsePackCardId(id);
      if (v) {
        const bc = books[v.book];
        const pack = bc?.packs.find((p) => p.id === v.pack);
        const entry = pack?.entries.find((e) => e.id === v.entry);
        return bc && pack && entry ? { type: "pack", book: bc.book, pack, entry } : null;
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
