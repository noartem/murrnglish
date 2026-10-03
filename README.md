# Murrnglish

Raymond Murphy's grammar books as interactive web courses: every unit opens
with a lesson written for the app, then its exercises, answers checked as
you go, progress saved in the browser. One installable PWA that works
offline, one book per folder. The app shows no page of the books: the
lessons are its own (in Russian for the red book, in English for the blue
one), and the exercises carry as text whatever the printed page gave them —
a picture, a table, a map. Next to the books: flash cards with Anki's spaced
repetition, and a dictionary of the learner's own words. The cards are the
app's own material too, written for it and tied to no book:
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
  components/Lesson.tsx    a unit's lesson: its header, sections and blocks
  components/ExerciseCard.tsx  one exercise, with the scene and cues that
                        stand for the book's pictures
  components/Library.tsx   the library landing
  components/CardsView.tsx, StudyView.tsx, DictionaryView.tsx
                        the sections: deck list, review session, dictionary
  components/DeckBrowser.tsx  a deck's cards, and one card with its history
  components/WordEditor.tsx, PickWord.tsx
                        adding/editing a word; "add" on a selected word
  lesson.ts             a lesson's types, as scripts/lessons.mjs compiles them
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
  book.json             title, edition, level, lessons' language, authors, cover
  cover.*               served as /books/<id>/...
  lessons/              the app's own lessons, u<NNN>.md, one per unit
  data/                 units/, additional/, index.json, totals.json
  book.pdf              the extraction pipelines' source; never served
  scripts/              that book's extraction pipeline and validate.py
  work/                 extraction work files (page text, layout, parsing spec)
  original/             red only: the EPUB the LLM pipeline reads hints from
decks/                  the card decks: index.json (sections, groups, order) and
                        grammar/<id>.json, vocabulary/<id>.json, one per deck
scripts/
  sync_books.mjs        books/* -> public/books/* + src/generated/books.json
  lessons.mjs           lessons/*.md -> each unit's "lesson", linted (run by the sync)
  audit_exercises.mjs   exercises that may still lean on the book page
  sync_decks.mjs        decks/ -> src/generated/decks.json, checked (--format: house style)
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
| `#/rules/<book>/u12` | the old rules compendium: now unit 12 itself (`#/rules/<book>` the book, `#/rules` the library) |
| `#/cards` | the card decks with today's counts, settings, backup |
| `#/cards/<deck>` | a review session: `all`, `words`, or a deck id (`phrasal-verbs`) |
| `#/cards/<deck>/browse` | a deck's cards, with a search and where each one stands |
| `#/cards/<deck>/browse/<entry>` | one card: turned over, its review history, Suspend / Forget |
| `#/dictionary` | the learner's words and the vocabulary decks |
| `#/dictionary/<deck>` | the same, with that deck's list open |

Sections take their own first segment next to the book ids, so
`sync_books.mjs` refuses a book folder named after one — or `rules`, which
old links still use (`RESERVED_IDS` in `src/routes.ts`); `sync_decks.mjs`
refuses a deck named `all` or `words`.

## Storage

Progress, the last page and the offline flags are per book
(`murrnglish.<book>.progress-v1`, ...); the theme and the sidebar state are
shared (`murrnglish.theme`, ...). See `src/keys.ts`.

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
own cache (`murrnglish-book-<id>-v2`) and can be removed on its own, while
the app itself lives in `murrnglish-shell-v2`. An installed app downloads the
open book by itself unless that book was removed by hand.

A book is four files: `index.json`, `totals.json`, `course.json` (every unit
with its lesson, and every additional exercise) and the cover — a few
hundred kilobytes. The `-v1` caches held the books' PDFs; the worker deletes
them when it activates. The decks are one lazy chunk of the app
(`assets/decks-<hash>.js`, ~70 KB gzipped): the worker keeps it once the
cards or the dictionary have been opened, and a book download stores it
with the shell, so reviews work offline. Dictionary
lookups need the network; offline the word is saved with what the learner
types, and a saved word's recording is kept in `murrnglish-audio-v1`.

## Lessons

A unit is one column: a bar of jumps at the top (the lesson, then one chip
per exercise, the part in view lit up; Shift+S goes from the lesson down to
the first exercise and back), the lesson, a "Practice" divider, the
exercises. A unit whose lesson is not written yet says so and shows its
exercises.

A lesson is `books/<id>/lessons/u<NNN>.md`, written for the app: its own
situations, names and examples, covering the grammar the unit's exercises
practise. `scripts/lessons.mjs` compiles it into the unit's JSON (the
`lesson` field of `data/units/unit-NNN.json` and of `course.json`), so it
arrives with the exercises and works offline. The source is Markdown with
blocks:

```md
---
hook: 🎬 What's going on right now?
goals: say what is in progress · talk about changes
---
::: scene 📞 Saturday morning        <- kind, icon, title
Leo calls his sister Nina.           <- narration
> Nina: I'm ==painting== the kitchen! <- a speech bubble
:::

## At this very moment               <- a section, lettered A, B, C…
A paragraph.

:::: row                             <- the blocks inside, side by side
::: rule
…
:::
::: timeline
span now-16 now+12 | Nina is painting
point now | Leo calls
:::
::::
```

| Block | What it is | Body |
| --- | --- | --- |
| `scene` | a little story: an icon, narration, speech bubbles | lines; `> Who: text` is a bubble |
| `rule` | the section's idea on an index card | paragraphs |
| `note` | a sticky note under tape | paragraphs |
| `form` | tables of forms, side by side | `# caption`, then `cell \| cell` rows |
| `examples` | ruled notebook lines | `- sentence` or `- sentence // gloss` |
| `compare` | columns; a `✓` / `✗` heading colours one | `# heading`, then its lines |
| `timeline` | past · now · future | `point / span / repeat / arrow <from> [<to>] \| label`; positions `past`, `now`, `future` or 0–100, `now-10` |
| `trap` | a typical mistake | `✗ wrong`, `✓ right`, then paragraphs |
| `words` | a cloud of chips | `a · b · c` |
| `cards` | small cards in a row | `# 🍳 title`, then its text |
| `quiz` | check yourself, the answer on a tap | `? question`, `= answer` |
| `summary` | the lesson as a checklist | `- line` |
| `seealso` | chips to other units | `u12` or `u12 text` |

Inline: `==highlight==`, `**bold**`, `_italic_`, `~~wrong~~`, `[[u12]]` /
`[[u12|text]]`. A straight apostrophe between letters becomes ’.

The sync fails on a lesson that breaks the rhythm rules — every section
carries something besides paragraphs, at most three paragraphs in a row,
none over 70 words, at least four kinds of block, a summary — or that shares
a run of eight words with the book's page text (`work/pages/plain`).

**The exercises without the page.** Where the printed book set an exercise on
a picture, a map or a table, the exercise carries it as text: `scene` (lines;
`a | b | c` lines make a table) above the items, `cue` (an emoji and a line)
above an item, and the instruction says to read them. An example the page
used to show solved is filled in from its answer. `node
scripts/audit_exercises.mjs [book]` lists what may still lean on the page;
`src/exercises.test.ts` holds every unit that has its lesson to none.

## Cards and the dictionary

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
selecting a word in an exercise or a lesson (the sentence and the unit come
along). The dictionary also lists every vocabulary deck, and its search
reads them. The lookup asks
three keyless, CORS-enabled sources at once: dictionaryapi.dev (definitions,
IPA, a recording — often slow or down), English Wiktionary (Russian
translations by sense, IPA, a recording, definitions as a fallback) and
MyMemory (machine translation, ~5000 characters a day per address). Any of
them may fail; the entry can always be typed by hand and saved.

## Adding a book

1. Create `books/<id>/` with a cover image and `book.json` (copy one from
   another book; `order` places it on the learning path, `lang` is the
   language of its lessons, `en` or `ru`).
2. Produce `data/` in the shared format (`work/PARSING-SPEC.md` of either
   book describes it) with its own pipeline under `books/<id>/scripts/`,
   including a `validate.py` — CI runs `books/*/scripts/validate.py`.
3. Go through the exercises (`scripts/audit_exercises.mjs <id>`) and write
   the lessons in `books/<id>/lessons/`.
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
