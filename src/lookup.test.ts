// Dictionary lookup parsers against trimmed copies of real responses
// (dictionaryapi.dev, Wiktionary wikitext and REST, MyMemory).

import { describe, expect, it } from "vitest";
import {
  parseDictionaryApi,
  parseMyMemory,
  parseWiktionaryDefinitions,
  parseWiktionaryPronunciation,
  parseWiktionaryTranslations,
  suggestTranslation,
  translationCandidates,
} from "./lookup";

const DICT = [
  {
    word: "book",
    phonetic: "/bʊk/",
    phonetics: [
      { text: "/bʊk/", audio: "" },
      { text: "/bʊk/", audio: "https://api.dictionaryapi.dev/media/pronunciations/en/book-uk.mp3" },
    ],
    meanings: [
      {
        partOfSpeech: "noun",
        definitions: [
          { definition: "A collection of sheets of paper bound together.", example: "She opened the book." },
          { definition: "A long work fit for publication." },
          { definition: "A major division of a long work." },
          { definition: "A record of betting." },
        ],
      },
      { partOfSpeech: "verb", definitions: [{ definition: "To reserve.", example: "I booked a table." }] },
    ],
  },
];

const WIKI = `==English==
===Pronunciation===
* {{IPA|en|/bʊk/|/buːk/}}
* {{audio|en|en-us-book.ogg|a=US}}

===Noun===
{{en-noun}}

====Translations====
{{trans-top|collection of sheets of paper bound together}}
* French: {{t+|fr|livre|m}}
* Russian: {{tt+|ru|кни́га|f}}, {{tt+|ru|кни́жка|f}}
{{trans-bottom}}
{{trans-top|record of betting}}
* Russian: {{t|ru|[[кни́га]] ставок|f}}
{{trans-bottom}}
{{checktrans-top}}
* Russian: {{t|ru|непроверенное}}
{{trans-bottom}}

===Verb===
====Translations====
{{trans-top|to reserve}}
* Russian: {{t+|ru|брони́ровать|impf}}, {{t+|ru|заброни́ровать|pf}}
{{trans-bottom}}

==French==
===Noun===
{{trans-top|ignored}}
* Russian: {{t|ru|чужое}}
`;

describe("dictionaryapi.dev", () => {
  it("takes IPA, a named recording and up to three definitions per part of speech", () => {
    const r = parseDictionaryApi(DICT);
    expect(r.ipa).toBe("/bʊk/");
    expect(r.audio).toMatch(/book-uk\.mp3$/);
    expect(r.senses.map((s) => s.pos)).toEqual(["noun", "verb"]);
    expect(r.senses[0].defs).toHaveLength(3);
    expect(r.senses[0].defs[0]).toEqual({
      def: "A collection of sheets of paper bound together.",
      example: "She opened the book.",
    });
  });

  it("survives anything that is not an entry list", () => {
    expect(parseDictionaryApi({ title: "No Definitions Found" })).toEqual({ senses: [] });
    expect(parseDictionaryApi(null)).toEqual({ senses: [] });
  });
});

describe("Wiktionary", () => {
  it("reads Russian translations by sense, stress marks off, English section only", () => {
    const { groups, subpage } = parseWiktionaryTranslations(WIKI);
    expect(subpage).toBe(false);
    expect(groups).toEqual([
      { pos: "Noun", gloss: "collection of sheets of paper bound together", words: ["книга", "книжка"] },
      { pos: "Noun", gloss: "record of betting", words: ["книга ставок"] },
      { pos: "Verb", gloss: "to reserve", words: ["бронировать", "забронировать"] },
    ]);
  });

  it("notices tables moved to a translations subpage", () => {
    const t = parseWiktionaryTranslations("==English==\n===Noun===\n====Translations====\n{{see translation subpage|Noun}}\n");
    expect(t).toEqual({ groups: [], subpage: true });
  });

  it("reads IPA and the Commons recording", () => {
    expect(parseWiktionaryPronunciation(WIKI)).toEqual({ ipa: "/bʊk/", audioFile: "en-us-book.ogg" });
  });

  it("reads REST definitions without their markup", () => {
    const senses = parseWiktionaryDefinitions({
      en: [
        {
          partOfSpeech: "Noun",
          definitions: [
            { definition: "" },
            {
              definition: 'A <a href="/wiki/collection">collection</a> of sheets.',
              examples: ["She opened the <b>book</b>."],
            },
          ],
        },
      ],
    });
    expect(senses).toEqual([
      { pos: "noun", defs: [{ def: "A collection of sheets.", example: "She opened the book." }] },
    ]);
  });
});

describe("MyMemory", () => {
  it("keeps Cyrillic translations, close matches only, no echoes or quota warnings", () => {
    const r = parseMyMemory(
      {
        responseStatus: 200,
        responseData: { translatedText: "книга" },
        matches: [
          { translation: "книга", match: 1 },
          { translation: "Книжка", match: 0.99 },
          { translation: "балансовая", match: 0.5 },
          { translation: "book", match: 0.98 },
        ],
      },
      "book",
    );
    expect(r).toEqual(["книга", "Книжка"]);
    expect(
      parseMyMemory({ responseStatus: 200, responseData: { translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS" } }, "book"),
    ).toEqual([]);
    expect(parseMyMemory({ responseStatus: 429 }, "book")).toEqual([]);
  });
});

describe("suggestions", () => {
  it("prefers the first sense's words, falls back to the machine", () => {
    const groups = parseWiktionaryTranslations(WIKI).groups;
    expect(suggestTranslation({ groups, machine: ["книга"] })).toBe("книга, книжка");
    expect(suggestTranslation({ groups: [], machine: ["присматривать"] })).toBe("присматривать");
    expect(suggestTranslation({ groups: [], machine: [] })).toBe("");
    expect(translationCandidates({ groups, machine: ["книга", "том"] })).toEqual([
      "книга",
      "книжка",
      "книга ставок",
      "бронировать",
      "забронировать",
      "том",
    ]);
  });
});
