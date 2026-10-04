// The study store: the dictionary, the review state of every card and the
// study settings, persisted in localStorage (keys.ts) and shared by every
// view through useStudy(). localStorage rather than IndexedDB: the data is
// small (a card's state is ~100 bytes; thousands of reviewed cards stay far
// under the quota), reads must be synchronous for the first paint of a review,
// and it is what the rest of the app already relies on offline. A write that
// fails (quota, private mode) is reported through `saveError`, and the backup
// file (backup.ts) is the way out.
//
// Other tabs of the app see changes through the storage event, so reviewing
// in two windows does not overwrite one with the other's stale copy.

import { useSyncExternalStore } from "react";
import type { SrsData, StudySettings } from "./backup";
import { DEFAULT_SETTINGS, cleanSettings, cleanSrs, mergeSrs, mergeWordList, validWord } from "./backup";
import type { DeckLibrary } from "./deckdata";
import { loadedDecks, whenDecksLoad } from "./deckdata";
import { SRS_KEY, SRS_SETTINGS_KEY, WORDS_KEY } from "./keys";
import { migrateLegacy } from "./legacy";
import type { CardState, Rating, SrsConfig } from "./srs";
import { DEFAULT_CONFIG, answer, countAnswer, todayDaily } from "./srs";
import type { Word } from "./words";

export interface StudySnapshot {
  words: Word[];
  srs: SrsData;
  settings: StudySettings;
  /** the last write failed: the UI asks for a backup */
  saveError: boolean;
  /** an answer that can still be taken back */
  canUndo: boolean;
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadWords(): Word[] {
  const x = read(WORDS_KEY) as { words?: unknown } | null;
  return Array.isArray(x?.words) ? x.words.filter(validWord) : [];
}

function load(): Omit<StudySnapshot, "saveError" | "canUndo"> {
  return { words: loadWords(), srs: cleanSrs(read(SRS_KEY)), settings: cleanSettings(read(SRS_SETTINGS_KEY)) };
}

let snap: StudySnapshot = { ...load(), saveError: false, canUndo: false };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

let persistAsked = false;
function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  // the first thing the learner saves: ask the browser not to evict it
  if (!persistAsked) {
    persistAsked = true;
    void navigator.storage?.persist?.().catch(() => {});
  }
  return true;
}

function set(patch: Partial<Omit<StudySnapshot, "saveError" | "canUndo">>, canUndo = snap.canUndo): void {
  let ok = true;
  if (patch.words) ok = write(WORDS_KEY, { words: patch.words }) && ok;
  if (patch.srs) ok = write(SRS_KEY, patch.srs) && ok;
  if (patch.settings) ok = write(SRS_SETTINGS_KEY, patch.settings) && ok;
  snap = { ...snap, ...patch, saveError: !ok, canUndo };
  emit();
}

/** Move the review history of the cards the books used to make (legacy.ts). */
function migrate(lib: DeckLibrary): void {
  const r = migrateLegacy(snap.srs, snap.settings.include, lib);
  if (r) set({ srs: r.srs, settings: { ...snap.settings, include: r.include } }, false);
}

if (typeof window !== "undefined") {
  whenDecksLoad(migrate);
  window.addEventListener("storage", (e) => {
    if (e.key === WORDS_KEY || e.key === SRS_KEY || e.key === SRS_SETTINGS_KEY || e.key === null) {
      snap = { ...load(), saveError: snap.saveError, canUndo: false };
      undo = null;
      emit();
    }
  });
}

export function useStudy(): StudySnapshot {
  return useSyncExternalStore(subscribe, () => snap);
}

export function studySnapshot(): StudySnapshot {
  return snap;
}

/** The scheduler's configuration: Anki's defaults with the learner's limits. */
export function srsConfig(settings: StudySettings = snap.settings): SrsConfig {
  return { ...DEFAULT_CONFIG, newPerDay: settings.newPerDay, reviewsPerDay: settings.reviewsPerDay };
}

// ---- words ----------------------------------------------------------------------

export function saveWord(w: Word): void {
  const i = snap.words.findIndex((x) => x.id === w.id);
  const words = i < 0 ? [...snap.words, w] : snap.words.map((x) => (x.id === w.id ? w : x));
  // a reverse card turned off (or a translation emptied) takes its review state along
  const srs = dropStates(snap.srs, (id) => id === `w:${w.id}:r` && !(w.reverse && w.translation.trim()));
  set({ words, srs });
}

export function deleteWord(id: string): void {
  set({
    words: snap.words.filter((w) => w.id !== id),
    srs: dropStates(snap.srs, (cid) => cid.startsWith(`w:${id}:`)),
  });
}

function dropStates(srs: SrsData, drop: (id: string) => boolean): SrsData {
  if (!Object.keys(srs.states).some(drop) && !srs.suspended.some(drop)) return srs;
  const states = Object.fromEntries(Object.entries(srs.states).filter(([id]) => !drop(id)));
  return { ...srs, states, suspended: srs.suspended.filter((id) => !drop(id)) };
}

// ---- reviews --------------------------------------------------------------------

let undo: { id: string; prev: CardState | undefined; srs: SrsData } | null = null;

/** Answer a card: schedule it and count it against today's limits. */
export function answerCard(id: string, rating: Rating, now = Date.now()): CardState {
  const cfg = srsConfig();
  const prev = snap.srs.states[id];
  const next = answer(prev, rating, now, cfg, id);
  const daily = countAnswer(todayDaily(snap.srs.daily, now, cfg), prev);
  undo = { id, prev, srs: snap.srs };
  set({ srs: { ...snap.srs, states: { ...snap.srs.states, [id]: next }, daily } }, true);
  return next;
}

/** Take the last answer back; returns the card id to show again. */
export function undoAnswer(): string | null {
  if (!undo) return null;
  const { id, srs } = undo;
  undo = null;
  set({ srs }, false);
  return id;
}

export function setSuspended(id: string, on: boolean): void {
  const has = snap.srs.suspended.includes(id);
  if (has === on) return;
  const suspended = on ? [...snap.srs.suspended, id] : snap.srs.suspended.filter((x) => x !== id);
  undo = null;
  set({ srs: { ...snap.srs, suspended } }, false);
}

/** Bring suspended cards back (all of them, or those `which` picks). */
export function resumeSuspended(which: (id: string) => boolean = () => true): void {
  const suspended = snap.srs.suspended.filter((id) => !which(id));
  if (suspended.length === snap.srs.suspended.length) return;
  undo = null;
  set({ srs: { ...snap.srs, suspended } }, false);
}

/** Forget a card's history: it becomes new again. */
export function resetCard(id: string): void {
  undo = null;
  set({ srs: dropStates(snap.srs, (x) => x === id) }, false);
}

export function saveSettings(s: StudySettings): void {
  set({ settings: cleanSettings(s) });
}

export function resetSettings(): void {
  set({ settings: { ...DEFAULT_SETTINGS, include: {} } });
}

/** Tick or untick decks for daily study (selection.ts); null goes back to the default. */
export function setIncluded(patch: Readonly<Record<string, boolean | null>>): void {
  const include = { ...snap.settings.include };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete include[k];
    else include[k] = v;
  }
  set({ settings: { ...snap.settings, include } });
}

// ---- import -------------------------------------------------------------------
// Words and review state are imported apart: the data window applies the two
// halves of a file on its own (a progress-only file touches neither), so the
// merge is split with the same shape the data file carries.

/** Merge a word list in (the entry edited last wins) and apply it. */
export function importWords(words: Word[]): { added: number; updated: number } {
  const r = mergeWordList(snap.words, words);
  undo = null;
  set({ words: r.words }, false);
  return { added: r.added, updated: r.updated };
}

/** Merge review states in (the card answered last wins) and apply them. */
export function importSrs(incoming: SrsData): { cards: number } {
  const r = mergeSrs(snap.srs, incoming);
  undo = null;
  set({ srs: r.srs }, false);
  // an imported file brings card ids an older app wrote back
  const lib = loadedDecks();
  if (lib) migrate(lib);
  return { cards: r.cards };
}
