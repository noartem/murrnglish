// The learner's own words: what a dictionary entry holds and the review
// cards it makes. Everything a lookup found (translation candidates,
// definitions, IPA, the recording's URL) is stored with the word, so the
// entry and its cards work offline once saved (lookup.ts fetches it).

export interface WordDef {
  def: string;
  example?: string;
}

/** Definitions under one part of speech. */
export interface WordSense {
  pos: string;
  defs: WordDef[];
}

export interface Word {
  id: string;
  /** the headword as saved ("look after") */
  word: string;
  /** what the learner recalls on the front→back card; usually Russian */
  translation: string;
  notes: string;
  ipa?: string;
  /** URL of a recording (dictionaryapi.dev / Wikimedia Commons) */
  audio?: string;
  senses?: WordSense[];
  /** other translations the lookup offered, to pick from when editing */
  alternatives?: string[];
  /** the sentence the word was picked from */
  context?: string;
  /** where it was picked: a book's unit ("blue", 12) */
  source?: { book: string; unit?: number };
  /** also make the translation → word card */
  reverse: boolean;
  added: number;
  updated: number;
}

/** Word card ids: "w:<id>:f" (word → translation), "w:<id>:r" (translation → word). */
export function wordCardIds(w: Word): string[] {
  const ids = [`w:${w.id}:f`];
  if (w.reverse && w.translation.trim()) ids.push(`w:${w.id}:r`);
  return ids;
}

/** "w:abc:r" -> { wordId: "abc", dir: "r" }; null for any other card id. */
export function parseWordCardId(id: string): { wordId: string; dir: "f" | "r" } | null {
  const m = id.match(/^w:([^:]+):([fr])$/);
  return m ? { wordId: m[1], dir: m[2] as "f" | "r" } : null;
}

export function newWordId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** The key two spellings of one headword share: case, spaces and quotes folded. */
export function headwordKey(s: string): string {
  return s.trim().toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ");
}

/**
 * A selection worth offering to the dictionary: one to four English words
 * (letters, apostrophes, hyphens), nothing else. Returns it tidied, or null.
 */
export function pickableWord(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  if (!s || s.length > 40) return null;
  if (!/^[A-Za-z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*){0,3}$/.test(s)) return null;
  return s.replace(/’/g, "'");
}

/** Accents off (the stress marks Wiktionary prints: "кни́га"), for comparing. */
export function stripStress(s: string): string {
  return s.normalize("NFD").replace(/́/g, "").normalize("NFC");
}
