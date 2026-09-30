// Dictionary lookups for a word the learner is adding. Three free, keyless
// sources that answer a browser directly (CORS), asked in parallel:
//
//   dictionaryapi.dev     English definitions, examples, IPA and a recording.
//                         Free and often slow or down (Cloudflare 52x) — never
//                         the only source of anything.
//   en.wiktionary.org     Russian translations grouped by sense (the
//                         "Translations" tables of the wikitext, which move to
//                         a "/translations" subpage for big words), plus IPA
//                         and a Commons recording; its REST definitions stand
//                         in when dictionaryapi.dev has nothing.
//   MyMemory              machine translation en→ru: the fallback for phrases
//                         and words Wiktionary has no table for. Anonymous use
//                         is capped at ~5000 characters a day per address; a
//                         spent quota answers 429 or a "MYMEMORY WARNING" text,
//                         which counts as no answer.
//
// Every request has a timeout, and a failed source only leaves its part out:
// the learner can always type the translation and save. Whatever was found is
// stored with the word (words.ts), so nothing here is needed offline — the
// recording is also kept in its own cache (AUDIO_CACHE) for offline playback.
//
// The parsers are pure and unit-tested (lookup.test.ts) against captured
// responses; lookupWord() is the network half.

import type { WordSense } from "./words";
import { stripStress } from "./words";

export interface TranslationGroup {
  /** part of speech heading the table sits under ("Noun") */
  pos: string;
  /** the sense the table translates ("collection of sheets of paper …") */
  gloss: string;
  words: string[];
}

export interface LookupResult {
  word: string;
  ipa?: string;
  audio?: string;
  senses: WordSense[];
  /** Wiktionary's sense-by-sense Russian translations */
  groups: TranslationGroup[];
  /** MyMemory's machine translation and its alternatives */
  machine: string[];
  /** sources that failed or were unreachable, for the status line */
  failed: string[];
}

// ---- parsers ----------------------------------------------------------------------

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const MAX_DEFS = 3;
const MAX_SENSES = 4;

/** dictionaryapi.dev: [{ phonetic, phonetics: [{text, audio}], meanings: [...] }] */
export function parseDictionaryApi(json: unknown): Pick<LookupResult, "ipa" | "audio" | "senses"> {
  const out: Pick<LookupResult, "ipa" | "audio" | "senses"> = { senses: [] };
  if (!Array.isArray(json)) return out;
  const byPos = new Map<string, WordSense>();
  for (const entry of json as Record<string, unknown>[]) {
    const phonetics = Array.isArray(entry.phonetics) ? (entry.phonetics as Record<string, unknown>[]) : [];
    if (!out.ipa) {
      const t = (typeof entry.phonetic === "string" && entry.phonetic) || phonetics.find((p) => typeof p.text === "string" && p.text)?.text;
      if (typeof t === "string") out.ipa = t;
    }
    if (!out.audio) {
      // prefer a British or American recording when there are several
      const withAudio = phonetics.filter((p) => typeof p.audio === "string" && p.audio);
      const pick = withAudio.find((p) => /-(uk|us)\.mp3$/.test(String(p.audio))) ?? withAudio[0];
      if (pick) out.audio = String(pick.audio);
    }
    const meanings = Array.isArray(entry.meanings) ? (entry.meanings as Record<string, unknown>[]) : [];
    for (const m of meanings) {
      const pos = typeof m.partOfSpeech === "string" ? m.partOfSpeech : "";
      const sense = byPos.get(pos) ?? { pos, defs: [] };
      byPos.set(pos, sense);
      const defs = Array.isArray(m.definitions) ? (m.definitions as Record<string, unknown>[]) : [];
      for (const d of defs) {
        if (sense.defs.length >= MAX_DEFS) break;
        if (typeof d.definition !== "string" || !d.definition.trim()) continue;
        sense.defs.push({
          def: d.definition.trim(),
          ...(typeof d.example === "string" && d.example.trim() ? { example: d.example.trim() } : {}),
        });
      }
    }
  }
  out.senses = [...byPos.values()].filter((s) => s.defs.length).slice(0, MAX_SENSES);
  return out;
}

/** Wiktionary REST /page/definition: { en: [{ partOfSpeech, definitions: [{definition, examples}] }] } */
export function parseWiktionaryDefinitions(json: unknown): WordSense[] {
  const en = (json as { en?: unknown } | null)?.en;
  if (!Array.isArray(en)) return [];
  const out: WordSense[] = [];
  for (const entry of en as Record<string, unknown>[]) {
    const pos = typeof entry.partOfSpeech === "string" ? entry.partOfSpeech.toLowerCase() : "";
    const defs = Array.isArray(entry.definitions) ? (entry.definitions as Record<string, unknown>[]) : [];
    const sense: WordSense = { pos, defs: [] };
    for (const d of defs) {
      if (sense.defs.length >= MAX_DEFS) break;
      const def = typeof d.definition === "string" ? stripHtml(d.definition) : "";
      if (!def) continue;
      const ex = Array.isArray(d.examples) && typeof d.examples[0] === "string" ? stripHtml(d.examples[0]) : "";
      sense.defs.push({ def, ...(ex ? { example: ex } : {}) });
    }
    if (sense.defs.length) out.push(sense);
    if (out.length >= MAX_SENSES) break;
  }
  return out;
}

const POS = /^(Noun|Verb|Adjective|Adverb|Preposition|Conjunction|Pronoun|Determiner|Interjection|Phrase|Prepositional phrase|Particle|Numeral|Article|Proverb|Idiom|Contraction|Proper noun)$/;

/** The English section of a Wiktionary page's wikitext. */
function englishSection(wikitext: string): string {
  const start = wikitext.search(/^==\s*English\s*==\s*$/m);
  if (start < 0) return "";
  const rest = wikitext.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^==[^=].*==\s*$/m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** First positional parameter of a template's arguments ("id=x|gloss" -> "gloss"). */
function firstPositional(args: string): string {
  return args.split("|").find((a) => a && !a.includes("=")) ?? "";
}

/**
 * Russian translations from a page's wikitext, grouped by sense.
 * `subpage` is set when the tables live on "<word>/translations".
 */
export function parseWiktionaryTranslations(wikitext: string): { groups: TranslationGroup[]; subpage: boolean } {
  const en = englishSection(wikitext);
  const subpage = /\{\{see translation subpage/i.test(en);
  const groups: TranslationGroup[] = [];
  let pos = "";
  let gloss = "";
  let checked = true;
  for (const line of en.split("\n")) {
    const h = line.match(/^={3,6}\s*(.+?)\s*={3,6}\s*$/);
    if (h) {
      if (POS.test(h[1])) pos = h[1];
      continue;
    }
    const top = line.match(/\{\{(trans-top(?:-see)?|checktrans-top)\|?([^}]*)\}\}/);
    if (top) {
      checked = top[1] !== "checktrans-top";
      gloss = stripHtml(firstPositional(top[2]).replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1"));
    }
    if (!checked) continue;
    const ru = line.match(/^\*+\s*Russian:\s*(.*)$/);
    if (!ru) continue;
    const words: string[] = [];
    for (const m of ru[1].matchAll(/\{\{tt?\+?\|ru\|([^|}]+)/g)) {
      const w = stripStress(m[1].replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")).trim();
      if (w && !words.includes(w)) words.push(w);
    }
    if (words.length) groups.push({ pos, gloss, words });
  }
  return { groups, subpage };
}

/** IPA and the Commons recording from the English pronunciation section. */
export function parseWiktionaryPronunciation(wikitext: string): { ipa?: string; audioFile?: string } {
  const en = englishSection(wikitext);
  const ipa = en.match(/\{\{IPA\|en\|([^|}]+)/)?.[1]?.trim();
  const audioFile = en.match(/\{\{audio\|en\|([^|}]+\.(?:ogg|mp3|wav|flac|opus))/i)?.[1]?.trim();
  return { ...(ipa ? { ipa } : {}), ...(audioFile ? { audioFile } : {}) };
}

/** MyMemory's answer: the translation first, then close alternatives. */
export function parseMyMemory(json: unknown, word: string): string[] {
  const o = json as {
    responseStatus?: unknown;
    responseData?: { translatedText?: unknown };
    matches?: { translation?: unknown; match?: unknown }[];
  } | null;
  if (!o || Number(o.responseStatus) !== 200) return [];
  const out: string[] = [];
  const add = (t: unknown) => {
    if (typeof t !== "string") return;
    const s = t.trim();
    // a spent quota or an echo of the query is no translation
    if (!s || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(s) || s.toLowerCase() === word.toLowerCase()) return;
    if (!/[А-Яа-яЁё]/.test(s)) return;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  };
  add(o.responseData?.translatedText);
  for (const m of o.matches ?? []) if (Number(m.match) >= 0.9) add(m.translation);
  return out.slice(0, 4);
}

/** The translation a fresh entry starts with: the first sense's words, else the machine's. */
export function suggestTranslation(r: Pick<LookupResult, "groups" | "machine">): string {
  if (r.groups.length) return r.groups[0].words.slice(0, 3).join(", ");
  return r.machine[0] ?? "";
}

/** Every distinct candidate, for the chips under the translation field. */
export function translationCandidates(r: Pick<LookupResult, "groups" | "machine">): string[] {
  const out: string[] = [];
  for (const g of r.groups) for (const w of g.words) if (!out.includes(w)) out.push(w);
  for (const m of r.machine) if (!out.includes(m)) out.push(m);
  return out.slice(0, 16);
}

// ---- network ----------------------------------------------------------------------

const TIMEOUT_MS = 8000;

export const commonsFileUrl = (file: string) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, "_"))}`;

async function getJson(url: string, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal.addEventListener("abort", stop);
  const t = window.setTimeout(stop, TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const body: unknown = await r.json().catch(() => null);
    return { status: r.status, body };
  } finally {
    window.clearTimeout(t);
    signal.removeEventListener("abort", stop);
  }
}

const wikiParse = (page: string) =>
  `https://en.wiktionary.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&redirects=1&origin=*&page=${encodeURIComponent(page)}`;

async function wikitext(page: string, signal: AbortSignal): Promise<string | null> {
  const { status, body } = await getJson(wikiParse(page), signal);
  const text = (body as { parse?: { wikitext?: unknown } } | null)?.parse?.wikitext;
  if (status !== 200) throw new Error(String(status));
  return typeof text === "string" ? text : null; // null: no such page
}

export class OfflineError extends Error {}

/** Look a word up everywhere at once. Throws OfflineError without a network. */
export async function lookupWord(raw: string, signal: AbortSignal): Promise<LookupResult> {
  const word = raw.trim();
  if (navigator.onLine === false) throw new OfflineError("offline");
  const key = word.toLowerCase();
  const result: LookupResult = { word, senses: [], groups: [], machine: [], failed: [] };

  const dict = getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`, signal).then(
    ({ status, body }) => {
      if (status === 404) return; // no entry: not a failure
      if (status !== 200) throw new Error(String(status));
      const d = parseDictionaryApi(body);
      result.ipa = d.ipa;
      result.audio = d.audio;
      result.senses = d.senses;
    },
  );

  let wikiAudio: string | undefined;
  let wikiIpa: string | undefined;
  const wiki = (async () => {
    const text = await wikitext(key, signal);
    if (text === null) return;
    const pron = parseWiktionaryPronunciation(text);
    wikiIpa = pron.ipa;
    if (pron.audioFile) wikiAudio = commonsFileUrl(pron.audioFile);
    const t = parseWiktionaryTranslations(text);
    result.groups = t.groups;
    if (t.subpage) {
      const sub = await wikitext(`${key}/translations`, signal);
      if (sub) result.groups = [...parseWiktionaryTranslations(sub).groups, ...t.groups];
    }
  })();

  const machine = getJson(
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ru`,
    signal,
  ).then(({ body }) => {
    result.machine = parseMyMemory(body, word);
  });

  const settled = await Promise.allSettled([dict, wiki, machine]);
  const names = ["dictionaryapi.dev", "Wiktionary", "MyMemory"];
  settled.forEach((s, i) => {
    if (s.status === "rejected") result.failed.push(names[i]);
  });
  if (signal.aborted) throw new DOMException("aborted", "AbortError");

  // Wiktionary fills in what dictionaryapi.dev did not give
  if (!result.ipa && wikiIpa) result.ipa = wikiIpa;
  if (!result.audio && wikiAudio) result.audio = wikiAudio;
  if (!result.senses.length) {
    try {
      const { status, body } = await getJson(
        `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(key)}`,
        signal,
      );
      if (status === 200) result.senses = parseWiktionaryDefinitions(body);
    } catch {
      /* definitions stay empty; translations may still be there */
    }
  }
  return result;
}

// ---- recordings -------------------------------------------------------------------

/** Cache Storage bucket for word recordings; kept by the service worker (murrnglish-*-v1). */
export const AUDIO_CACHE = "murrnglish-audio-v1";

/** Keep a recording for offline playback. Best effort: a refusal leaves it online-only. */
export async function cacheAudio(url: string): Promise<void> {
  try {
    const cache = await caches.open(AUDIO_CACHE);
    if (await cache.match(url)) return;
    const r = await fetch(url, { mode: "cors" });
    if (r.ok) await cache.put(url, r);
  } catch {
    /* no CORS, no network or no Cache Storage */
  }
}

export async function forgetAudio(url: string): Promise<void> {
  try {
    await (await caches.open(AUDIO_CACHE)).delete(url);
  } catch {
    /* nothing to forget */
  }
}

let playing: HTMLAudioElement | null = null;

/**
 * Say a word: its stored recording (from the offline cache when there),
 * else the device's speech synthesis — which also works offline.
 */
export async function speak(word: string, audio?: string): Promise<void> {
  playing?.pause();
  if (audio) {
    try {
      let src = audio;
      const hit = await caches.match(audio).catch(() => undefined);
      if (hit) src = URL.createObjectURL(await hit.blob());
      const el = new Audio(src);
      playing = el;
      if (src !== audio) el.addEventListener("ended", () => URL.revokeObjectURL(src), { once: true });
      await el.play();
      return;
    } catch {
      /* fall through to synthesis */
    }
  }
  if ("speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-GB";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
}
