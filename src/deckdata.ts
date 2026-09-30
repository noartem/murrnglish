// The card decks: the app's own grammar and vocabulary material, tied to no
// book. Written in decks/ (one JSON file per deck, ordered by
// decks/index.json), checked and packed by scripts/sync_decks.mjs into
// src/generated/decks.json, which is imported lazily — its own chunk with a
// hashed name, fetched the first time a deck is needed and kept by the
// service worker like the rest of the app.
//
// A deck is a list of entries; what an entry asks follows from its fields:
//
//   forms      "forms": [past, participle]    the infinitive and its Russian ->
//                                              past simple and past participle
//   gap        "en" with [gaps]               the sentence with each gap to fill
//              "She [has lived|live] here."   answers split by "/", the part
//                                              after "|" is a hint shown by the gap
//   choice     "choice": [right, wrong, …]    pick the right one; with an "en"
//                                              holding ___ the options fill it,
//                                              without one they are whole sentences
//   translate  "en" and "ru"                  the Russian -> the English (or one
//                                              of its "alt"ernatives)
//   meaning    the same, in a deck with       the English -> what it means
//              "ask": "meaning"               (turned over and rated, not typed)
//
// Card ids are "d:<deck>:<entry>". Both ids are stable: review history stays
// with the entry when the material is corrected.

import { useEffect, useState } from "react";
import { checkFill } from "./checker";

export type Level = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type EntryKind = "forms" | "gap" | "choice" | "translate" | "meaning";

export interface DeckEntry {
  id: string;
  /** the English: a word, a phrase, a sentence with [gaps], or a choice sentence with ___ */
  en?: string;
  ru?: string;
  /** past simple, past participle ("was/were", "got") */
  forms?: string[];
  /** the right option first; the app shuffles them */
  choice?: string[];
  /** translate: other phrases accepted as the answer */
  alt?: string[];
  /** an example sentence */
  ex?: string;
  /** why: shown with the answer */
  note?: string;
}

export interface Deck {
  id: string;
  title: string;
  about: string;
  level: Level;
  /** what plain phrases ask: the English (translate, the default) or their meaning */
  ask?: "translate" | "meaning";
  /** the instruction over every card, instead of the one of its kind */
  prompt?: string;
  entries: DeckEntry[];
}

export interface DeckGroup {
  title: string;
  decks: Deck[];
}

export interface DeckSection {
  id: string;
  title: string;
  about: string;
  groups: DeckGroup[];
}

export interface DeckLibrary {
  sections: DeckSection[];
  /** deck id -> the deck */
  decks: ReadonlyMap<string, Deck>;
  /** deck id -> its section id */
  sectionOf: ReadonlyMap<string, string>;
}

export function makeLibrary(file: { sections: DeckSection[] }): DeckLibrary {
  const decks = new Map<string, Deck>();
  const sectionOf = new Map<string, string>();
  for (const s of file.sections)
    for (const g of s.groups)
      for (const d of g.decks) {
        decks.set(d.id, d);
        sectionOf.set(d.id, s.id);
      }
  return { sections: file.sections, decks, sectionOf };
}

// ---- loading ------------------------------------------------------------------------

let library: DeckLibrary | null = null;
let loading: Promise<DeckLibrary> | null = null;
const onLoad: ((lib: DeckLibrary) => void)[] = [];

/** The decks, once per session; a failed load (offline, never fetched) is retried next time. */
export function loadDecks(): Promise<DeckLibrary> {
  if (!loading) {
    loading = import("./generated/decks.json")
      .then((m) => {
        library = makeLibrary(m.default as unknown as { sections: DeckSection[] });
        for (const f of onLoad) f(library);
        return library;
      })
      .catch((e: unknown) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

/** The decks if they have arrived, else null — for code that must not wait. */
export function loadedDecks(): DeckLibrary | null {
  return library;
}

/** Run `f` with the decks once they have loaded (at once if they have). */
export function whenDecksLoad(f: (lib: DeckLibrary) => void): void {
  if (library) f(library);
  else onLoad.push(f);
}

export interface DecksState {
  lib: DeckLibrary | null;
  failed: boolean;
}

export function useDecks(): DecksState {
  const [state, setState] = useState<DecksState>({ lib: library, failed: false });
  useEffect(() => {
    if (library) return;
    let alive = true;
    loadDecks().then(
      (lib) => alive && setState({ lib, failed: false }),
      () => alive && setState({ lib: null, failed: true }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

// ---- card ids -----------------------------------------------------------------------

export function cardId(deck: string, entry: string): string {
  return `d:${deck}:${entry}`;
}

/** "d:idioms:break-the-ice" -> its parts; null for any other card id. */
export function parseCardId(id: string): { deck: string; entry: string } | null {
  const m = id.match(/^d:([a-z0-9-]+):([a-z0-9-]+)$/);
  return m ? { deck: m[1], entry: m[2] } : null;
}

export function deckCardIds(d: Deck): string[] {
  return d.entries.map((e) => cardId(d.id, e.id));
}

// ---- entries ------------------------------------------------------------------------

export function entryKind(d: Pick<Deck, "ask">, e: DeckEntry): EntryKind {
  if (e.forms) return "forms";
  if (e.choice) return "choice";
  if (e.en?.includes("[")) return "gap";
  return d.ask ?? "translate";
}

export interface Gap {
  answers: string[];
  hint: string;
}

/** "She [has lived|live] here." -> the text around the gaps (one more part than gaps) and the gaps. */
export function gapsOf(en: string): { parts: string[]; gaps: Gap[] } {
  const parts: string[] = [];
  const gaps: Gap[] = [];
  const re = /\[([^\]]*)\]/g;
  let at = 0;
  for (let m = re.exec(en); m; m = re.exec(en)) {
    parts.push(en.slice(at, m.index));
    const bar = m[1].indexOf("|");
    const answers = (bar < 0 ? m[1] : m[1].slice(0, bar)).split("/").map((s) => s.trim());
    gaps.push({ answers, hint: bar < 0 ? "" : m[1].slice(bar + 1).trim() });
    at = m.index + m[0].length;
  }
  parts.push(en.slice(at));
  return { parts, gaps };
}

/** "surprised [at/by]" -> "surprised at": the English with every gap filled by its first answer. */
export function fillGaps(en: string): string {
  const { parts, gaps } = gapsOf(en);
  return parts.map((p, i) => p + (i < gaps.length ? gaps[i].answers[0] : "")).join("");
}

/** The English of an entry as the answer side, the lists and "add to my words" show it. */
export function entryText(e: DeckEntry): string {
  if (e.choice) return e.en ? e.en.replace("___", e.choice[0]) : e.choice[0];
  return e.en ? fillGaps(e.en) : "";
}

/** "sewn/sewed" -> every spelling accepted for that form, the whole string too. */
export function formVariants(form: string): string[] {
  return [form, ...form.split("/").map((s) => s.trim())];
}

/** The answers a translate card takes. */
export function phraseAnswers(e: DeckEntry): string[] {
  return [e.en ?? "", ...(e.alt ?? [])];
}

/**
 * Whether what was typed answers the entry: both forms, every gap, or the
 * English phrase (or one of its alternatives). Choice and meaning cards are
 * not typed.
 */
export function checkTyped(kind: EntryKind, e: DeckEntry, typed: { gaps?: string[]; text?: string }): boolean {
  switch (kind) {
    case "forms":
      return (e.forms ?? []).every((f, i) => checkFill(typed.gaps?.[i] ?? "", formVariants(f)));
    case "gap":
      return gapsOf(e.en ?? "").gaps.every((g, i) => checkFill(typed.gaps?.[i] ?? "", g.answers));
    case "translate":
      return checkFill(typed.text ?? "", phraseAnswers(e));
    default:
      return false;
  }
}

/**
 * The order a choice card shows its options in: shuffled, since the right one
 * is always written first, but the same for as long as the card is on screen
 * — a different order at each review (`seed`, the card's review count), so
 * the answer is not remembered by its place.
 */
export function choiceOrder(id: string, n: number, seed: number): number[] {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
    const j = (h >>> 0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const LEVEL_NAMES: Record<Level, string> = {
  A1: "Beginner",
  A2: "Elementary",
  B1: "Intermediate",
  B2: "Upper-intermediate",
  C1: "Advanced",
  C2: "Proficiency",
};
