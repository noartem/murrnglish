# Murrnglish

Raymond Murphy's grammar books as interactive web courses: the book's pages
with the exercises beside them, answers checked as you go, progress saved in
the browser. One installable PWA that works offline, one book per folder.
Next to the books: a searchable compendium of their rules, flash cards with
Anki's spaced repetition, and a dictionary of the learner's own words. The
cards are the app's own material, written for it and tied to no book:
grammar decks by topic and vocabulary decks (irregular verbs, advanced
irregular verbs, phrasal verbs, words + prepositions, collocations, linking
words, false friends, easily confused words, idioms).

| Book | Folder | Units | Additional |
| --- | --- | --- | --- |
| Essential Grammar in Use (Russian edition) — "red" | `books/red` | 115 | 35 |
| English Grammar in Use (Fifth edition) — "blue" | `books/blue` | 145 | 41 |

The repository merges the former `blue-murphy` and `red-murphy` projects with
both histories kept (`git log --follow books/red/data/units/unit-001.json`
reaches back into red-murphy).

## Layout

```
src/                    the web app (Vite + React + TypeScript), one for every book
  App.tsx               router: library, a book's course, or a section
  CourseApp.tsx         one book's course UI (landing, units, additional exercises)
  components/Library.tsx   the library landing
  components/RulesView.tsx, CardsView.tsx, StudyView.tsx, DictionaryView.tsx
                        the sections: rules, deck list, review session, dictionary
  components/DeckBrowser.tsx  a deck's cards, and one card with its history
  components/WordEditor.tsx, PickWord.tsx
                        adding/editing a word; "add" on a selected word
  rules.ts              rule text per book + the search across books
  deckdata.ts           the card decks: loading, entry kinds, gaps, answer checks
  decks.ts              which cards a session holds (a deck, the words, everything)
  legacy.ts             moving the review history of the old book-made cards
  selection.ts          what daily study takes: the ticks and switches of the deck list
  srs.ts                the scheduler (Anki's SM-2) and the daily queue
  limits.ts             the daily-limit presets (Light, Standard, Intensive, Catch up)
  study.ts              the study store (words, review state, settings)
  backup.ts             the study backup file and its merge
  lookup.ts, words.ts   dictionary lookups and word entries
  books.ts              book registry (generated from books/*/book.json)
  routes.ts             hash routes
  keys.ts               every localStorage key
  offline.ts            offline downloads, one per book
public/                 static files; sw.js = shell cache + one cache per book
books/<id>/             everything of one book
  book.json             title, edition, level, authors, cover color and size
  book.pdf, cover.*     served as /books/<id>/...
  data/                 units/, additional/, index.json, totals.json, pages.json
  scripts/              that book's extraction pipeline and validate.py
  work/                 extraction work files (page text, layout, parsing spec)
  original/             red only: the EPUB the LLM pipeline reads hints from
decks/                  the card decks: index.json (sections, groups, order) and
                        grammar/<id>.json, vocabulary/<id>.json, one per deck
scripts/
  sync_books.mjs        books/* -> public/books/* + src/generated/books.json
  sync_decks.mjs        decks/ -> src/generated/decks.json, checked (--format: house style)
  rules_text.mjs        a unit's rule page text -> data/rules.json (run by the sync)
  make_page_meta.mjs    book.pdf -> data/pages.json (page aspect ratios)
  deploy.sh             publish dist/ to the VPS
e2e.mjs                 end-to-end flows (Playwright)
```

`public/books/` and `src/generated/` are generated before every `dev`,
`build` and `test` run and are not committed.

## Develop

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
npm test           # unit tests (vitest)
npm run build      # type-check + production build into dist/
```

End-to-end flows (Playwright from the npx cache) run against the dev server,
or against `vite preview` to include the offline flow:

```sh
npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort
E2E_BASE=http://127.0.0.1:4173 node e2e.mjs
```

Validate a book's data (CI runs every book):

```sh
python books/blue/scripts/validate.py
python books/red/scripts/validate.py
```

A book's pipeline scripts resolve paths from their own book folder, so their
`Usage:` lines (`python scripts/...`) are meant to be run from `books/<id>/`.
The red book's LLM pipeline reads its API keys from `books/red/.env` (ignored).

## Routes

| Hash | View |
| --- | --- |
| *(none)* | resume the last page of the book with progress, else the library |
| `#/` | library |
| `#/<book>` | the book's landing |
| `#/<book>/u12` | unit 12 |
| `#/<book>/a3` | additional exercise 3 |
| `#/<book>/p=<code>` | shared progress for that book (preview, then apply) |
| `#/rules` | the rules compendium (search across every book) |
| `#/rules/<book>`, `#/rules/<book>/u12` | a book's rules; the rule of unit 12 |
| `#/cards` | the card decks with today's counts, settings, backup |
| `#/cards/<deck>` | a review session: `all`, `words`, or a deck id (`phrasal-verbs`) |
| `#/cards/<deck>/browse` | a deck's cards, with a search and where each one stands |
| `#/cards/<deck>/browse/<entry>` | one card: turned over, its review history, Suspend / Forget |
| `#/dictionary` | the learner's words and the vocabulary decks |
| `#/dictionary/<deck>` | the same, with that deck's list open |

Sections take their own first segment next to the book ids, so
`sync_books.mjs` refuses a book folder named after one (`RESERVED_IDS` in
`src/routes.ts`); `sync_decks.mjs` refuses a deck named `all` or `words`.

## Storage

Progress, the last page and the offline flags are per book
(`murrnglish.<book>.progress-v1`, ...); theme, page inversion and the sidebar
state are shared (`murrnglish.theme`, ...). See `src/keys.ts`.

Study data spans the books and is shared too: `murrnglish.words-v1` (the
dictionary, with everything a lookup found), `murrnglish.srs-v1` (the review
state of every card met, suspended cards, today's counters) and
`murrnglish.srs-settings-v1`. Deck cards are keyed `d:<deck>:<entry>`, so
review history survives corrections to the material; word cards are
`w:<word id>:f` / `:r`. The cards the books used to make (keyed
`<book>:<exercise>:<item>` and `v:<book>:<pack>:<entry>`) are migrated once
the decks load (`src/legacy.ts`): a word-pack card's history moves to the
deck entry of the same id, the rest is dropped — also when an old backup is
imported. It is backed up on its own: *Export backup* in the
dictionary or the deck list writes one JSON file, and *Import backup* merges
it (the newer entry and the later review win, suspensions add up) — nothing
is overwritten, so a phone's backup can be brought to a laptop and back.

Progress from the old single-book sites (other origins, so their
localStorage is out of reach) moves over by hand: *Progress → Export* there,
*Progress → Import* in the same book here — the file format is unchanged.

## Offline

The service worker caches at runtime (stale-while-revalidate). In the
installed app a Download panel lists every book; each one downloads into its
own cache (`murrnglish-book-<id>-v1`) and can be removed on its own, while
the app itself lives in `murrnglish-shell-v1`. An installed app downloads the
open book by itself unless that book was removed by hand.

A book's download includes `data/rules.json` (the compendium's text), so the
rules work offline for a downloaded book — or for any book whose course was
opened online, since the worker keeps what it serves. The decks are one lazy
chunk of the app (`assets/decks-<hash>.js`, ~70 KB gzipped): the worker keeps
it once the cards or the dictionary have been opened, and a book download
stores it with the shell, so reviews work offline. A download
whose PDF is already cached only tops up the missing small files. Dictionary
lookups need the network; offline the word is saved with what the learner
types, and a saved word's recording is kept in `murrnglish-audio-v1`.

## Rules, cards and the dictionary

**Rules.** The list on the left, the rule on the right under a toolbar with
the previous and next unit, *Text | Page*, and the links to the exercises
and cards; with no unit open, the book's groups as a map of its rules. The
book page is sized so the whole page is in view (640–900 px wide).
`scripts/rules_text.mjs` reads each unit's rule page from the
book's `pdftotext -layout` text (`work/pages/plain`): lettered sections,
indented examples, side-by-side columns and the footer's cross references. A
page is used only when its header names the unit, so text that is not the
book's own is left out — the red book's plain text is a copy of the blue
one, and its PDF text layer is OCR noise, so the red rules are shown as the
book page. Search reads unit and group titles in every book plus the rule
text where there is one.

**Cards.** The decks in `decks/` are written for the app — no sentence,
example or list comes from the books. `decks/index.json` orders them into
sections (grammar, vocabulary) and groups; a deck is a title, an `about`, a
CEFR `level` and its entries, and what an entry asks follows from its
fields (`src/deckdata.ts`):

| Entry | The card |
| --- | --- |
| `"en": "go", "forms": ["went", "gone"]` | the verb → past simple and past participle, typed |
| `"en": "She [has lived\|live] here."` | the sentence with its gaps typed; `a/b` inside a gap are answers, after `\|` a hint shown by the gap |
| `"choice": ["right", "wrong"]`, optional `"en"` with `___` | pick one (the right one is written first, the app shuffles); with `en`, the options fill its `___` |
| `"en": "give up", "ru": "бросать", "alt": […]` | the Russian → the English, typed |
| the same in a deck with `"ask": "meaning"` | the English → what it means, turned over (idioms) |

`ru` (a translation), `ex` (an example) and `note` (why: shown with the
answer, in Russian) go with any of them; `prompt` on a deck replaces the
line over its cards. `sync_decks.mjs` checks every file and fails the build
on a broken one; `src/deckdata.test.ts` types every key back into its own
card. Deck and entry ids go into card ids and URLs, so they stay put once
published. `node scripts/sync_decks.mjs --format` rewrites the files one
entry per line.

**Choosing what to study.** The deck list ticks what "Everything due" takes:
the learner's words and the decks. A deck nobody ticked is in once it is
started — studying it once is enough — and a tick either way overrides
that; a group's tick sets its decks, and each section has All / Started /
None. The choices are
deck keys in the study settings (`include`), and the due count leaves out the
cards they exclude.

**Browsing a deck.** Every deck on the deck list opens into its cards (its
title, or the list icon by it): a search over everything an entry says, and
filters by state — new, learning, due, later, suspended. A card opens turned
over, as a session shows it, with its stage, next review, interval, ease,
reviews and lapses; it can be suspended, resumed or forgotten (its reviews
thrown away) there, and ← → step through the list, Esc goes back to it. A
session links each deck card to this page (Card info).

**Scheduling** is Anki's SM-2 with its default steps (1 and 10 minutes, then
1 day; Easy 4 days; ease 250%, fuzz, the day starting at 4 a.m.), daily new
and review limits (set by hand or from a preset; learning cards, as in Anki,
have no limit), and sibling burying for a word's two cards. SM-2 rather
than FSRS: its behaviour is what Anki's buttons promise, it needs no fitted
parameters, and every rule can be checked by hand (`src/srs.test.ts`). Keys:
Space shows the answer and then gives the suggested rating, 1–4 rate, 1–n
pick an option, Ctrl+Z undoes, Shift+? lists them.

**Dictionary.** Words are added in the dictionary, from a vocabulary card, or by
selecting a word in an exercise or a rule (the sentence and the unit come
along). The dictionary also lists every vocabulary deck, and its search
reads them. The lookup asks
three keyless, CORS-enabled sources at once: dictionaryapi.dev (definitions,
IPA, a recording — often slow or down), English Wiktionary (Russian
translations by sense, IPA, a recording, definitions as a fallback) and
MyMemory (machine translation, ~5000 characters a day per address). Any of
them may fail; the entry can always be typed by hand and saved.

## Adding a book

1. Create `books/<id>/` with `book.pdf`, a cover image and `book.json`
   (copy one from another book; `order` places it on the learning path).
2. Produce `data/` in the shared format (`work/PARSING-SPEC.md` of either
   book describes it) with its own pipeline under `books/<id>/scripts/`,
   including a `validate.py` — CI runs `books/*/scripts/validate.py`.
3. `node scripts/make_page_meta.mjs <id>` for `data/pages.json`.
4. `npm run dev` — `sync_books.mjs` registers it; the library, routes,
   progress and offline download pick it up with no app change.

## Deploy

`murrnglish.noartem.ru`, the same scheme as the old book sites: Cloudflare in
front, Caddy on the VPS serving `/srv/murrnglish/http`, owned by the
`mg-deploy` user that CI logs in as.

Pushes to `main` validate, test and build; once the `DEPLOY_SSH_KEY` secret
exists they also publish `dist/` with `scripts/deploy.sh` (target at the top,
overridable through `DEPLOY_*` env).

One-time server setup (deploy user, site root, Caddy block) is
`scripts/setup-vps.sh`, run with an admin account — see its header for the
command and the secret.
