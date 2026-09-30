# Murrnglish

Raymond Murphy's grammar books as interactive web courses: the book's pages
with the exercises beside them, answers checked as you go, progress saved in
the browser. One installable PWA that works offline, one book per folder.
Next to the books: a searchable compendium of their rules, flash cards with
Anki's spaced repetition (from the exercises and from each book's word
packs), and a dictionary of the learner's own words.

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
  components/WordEditor.tsx, PickWord.tsx
                        adding/editing a word; "add" on a selected word
  rules.ts              rule text per book + the search across books
  cards.ts              flash cards generated from a unit's exercises
  packs.ts              a book's word packs (data/packs.json) and their answer checks
  decks.ts              which cards a deck holds (book, group, unit, pack, words, all)
  selection.ts          what daily study takes: the ticks and switches of the deck list
  srs.ts                the scheduler (Anki's SM-2) and the daily queue
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
  data/                 units/, additional/, index.json, totals.json, pages.json,
                        packs.json (the word packs, hand-made)
  scripts/              that book's extraction pipeline and validate.py
  work/                 extraction work files (page text, layout, parsing spec)
  original/             red only: the EPUB the LLM pipeline reads hints from
scripts/
  sync_books.mjs        books/* -> public/books/* + src/generated/books.json
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
| `#/cards/<deck>` | a review session: `all`, `words`, `<book>`, `<book>/g3` (the book's 3rd group), `<book>/u12`, `<book>/pack-<id>` |
| `#/dictionary` | the learner's words and the books' word packs |
| `#/dictionary/<book>/pack-<id>` | the same, with that pack open |

Sections take their own first segment next to the book ids, and the deck
names `all` / `words` share the second segment of `#/cards/` with them, so
`sync_books.mjs` refuses a book folder named after any of them
(`RESERVED_IDS` in `src/routes.ts`).

## Storage

Progress, the last page and the offline flags are per book
(`murrnglish.<book>.progress-v1`, ...); theme, page inversion and the sidebar
state are shared (`murrnglish.theme`, ...). See `src/keys.ts`.

Study data spans the books and is shared too: `murrnglish.words-v1` (the
dictionary, with everything a lookup found), `murrnglish.srs-v1` (the review
state of every card met, suspended cards, today's counters) and
`murrnglish.srs-settings-v1`. Unit cards are keyed
`<book>:<exercise>:<item>`, so review history survives data fixes; word cards
are `w:<word id>:f` / `:r`. It is backed up on its own: *Export backup* in the
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

A book's download includes `data/rules.json` (the compendium's text), and its
`data/course.json` is also where the unit cards come from, so the rules, the
decks and reviews work offline for a downloaded book — or for any book whose
course was opened online, since the worker keeps what it serves. A download
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

**Cards.** Generated from the unit's exercises with the book's key on the
back (`src/cards.ts` says which items qualify: an item that needs the
printed picture or situation is left out). About 3,600 cards per book: gap
sentences (typed and checked like the exercise, or just turned over),
"which is right" options, sentences to write, matching pairs. "Everything
due" takes the cards of units the learner has started — finished in the
course or studied in a deck — plus every saved word, so the daily new-card
allowance goes to what is being learned.

**Word packs.** Each book has ready-made vocabulary in `data/packs.json`,
written by hand because the translations are not in the books: the
irregular verbs of its appendix, its phrasal verbs, the words that take a
preposition, and (red) the go/get/do/make/have phrases and the prepositions of
time and place. A pack asks one kind of question — a verb's two forms, the
English of a Russian phrase, or the word missing from a phrase — typed and
checked like an exercise. Card ids are `v:<book>:<pack>:<entry>`, so entry
ids must stay put once published; `sync_books.mjs` checks the file's shape.
The dictionary lists every pack and its search reads them too; an entry can
be added to the learner's own words.

**Choosing what to study.** The deck list ticks what "Everything due" takes:
the learner's words, and in each book its units and packs. A unit or pack
nobody ticked is in once it is started, so the default is what the course is
at; a tick either way overrides that, a group's tick sets its units, and a
book's switch takes all of it out (its own decks still open). The choices are
deck keys in the study settings (`include`), and the due count leaves out the
cards they exclude.

**Scheduling** is Anki's SM-2 with its default steps (1 and 10 minutes, then
1 day; Easy 4 days; ease 250%, fuzz, the day starting at 4 a.m.), daily new
and review limits, and sibling burying for a word's two cards. SM-2 rather
than FSRS: its behaviour is what Anki's buttons promise, it needs no fitted
parameters, and every rule can be checked by hand (`src/srs.test.ts`). Keys:
Space shows the answer and then gives the suggested rating, 1–4 rate, 1–n
pick an option, Ctrl+Z undoes, Shift+? lists them.

**Dictionary.** Words are added in the dictionary or by selecting a word in
an exercise or a rule (the sentence and the unit come along). The lookup asks
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
   Word packs (`data/packs.json`) are optional.
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
