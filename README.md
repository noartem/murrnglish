# Murrnglish

Raymond Murphy's grammar books as interactive web courses: the book's pages
with the exercises beside them, answers checked as you go, progress saved in
the browser. One installable PWA that works offline, one book per folder.

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
  App.tsx               router: library (#/) or a book's course (#/<book>/...)
  CourseApp.tsx         one book's course UI (landing, units, additional exercises)
  components/Library.tsx   the library landing
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
scripts/
  sync_books.mjs        books/* -> public/books/* + src/generated/books.json
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

Sections that are not books (a dictionary, flash cards) get their own first
segment next to the book ids.

## Storage

Progress, the last page and the offline flags are per book
(`murrnglish.<book>.progress-v1`, ...); theme, page inversion and the sidebar
state are shared (`murrnglish.theme`, ...). See `src/keys.ts`.

Progress from the old single-book sites (other origins, so their
localStorage is out of reach) moves over by hand: *Progress → Export* there,
*Progress → Import* in the same book here — the file format is unchanged.

## Offline

The service worker caches at runtime (stale-while-revalidate). In the
installed app a Download panel lists every book; each one downloads into its
own cache (`murrnglish-book-<id>-v1`) and can be removed on its own, while
the app itself lives in `murrnglish-shell-v1`. An installed app downloads the
open book by itself unless that book was removed by hand.

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
