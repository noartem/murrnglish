// App: the router. The hash picks the library (#/), one book's course
// (#/<book>/...) or one of the sections next to the books — the card decks
// and the dictionary (routes.ts). A book's course is
// keyed by the book, so opening another book remounts it with that book's
// data and progress. App also owns what no single view can: the one
// keyboard dispatcher and the three app-wide windows (help, data, book
// picker), so every key and every window works in every view. The word
// editor is mounted once here too — the dictionary, the lessons and the
// exercises all open it.

import { useEffect, useState } from "react";
import { BOOKS, bookById } from "./books";
import CourseApp from "./CourseApp";
import { BookPicker } from "./components/BookPicker";
import { CardsView } from "./components/CardsView";
import { DataModal } from "./components/DataModal";
import { DeckBrowser } from "./components/DeckBrowser";
import { DictionaryView } from "./components/DictionaryView";
import { Library } from "./components/Library";
import { ShortcutsModal } from "./components/ShortcutsHelp";
import { SearchModal } from "./components/SearchModal";
import { StudyView } from "./components/StudyView";
import { WordEditorHost } from "./components/WordEditor";
import { closeGlobal, useGlobalModal } from "./globalUi";
import {
  hasProgress,
  lastUnitFromProgress,
  loadLastBook,
  loadLastRoute,
  loadProgress,
} from "./progress";
import type { AppRoute } from "./routes";
import { LIBRARY_HASH, bookHash, deckKey, legacyHash, parsePage, parseRoute } from "./routes";
import { useAppShortcuts } from "./shortcuts";

/** The windows App owns. Only one is up at a time (globalUi.ts). */
function GlobalWindows() {
  const modal = useGlobalModal();
  return (
    <>
      <SearchModal onClose={closeGlobal} />
      {modal === "help" && <ShortcutsModal onClose={closeGlobal} />}
      <DataModal />
      {modal === "books" && <BookPicker />}
    </>
  );
}

// bare "/": learners with saved progress go straight back to the page they
// last worked on — in the book last opened if it has progress, else in the
// first book that does (a glance into another book must not strand them in
// the library); everyone else starts in the library
function entryHash(): string {
  const last = bookById(loadLastBook() ?? "");
  const order = last ? [last, ...BOOKS.filter((b) => b !== last)] : BOOKS;
  for (const book of order) {
    const p = loadProgress(book.id);
    if (!hasProgress(p)) continue;
    const page = parsePage(book, loadLastRoute(book.id) ?? lastUnitFromProgress(p) ?? "");
    return bookHash(book, page ?? { kind: "home" });
  }
  return LIBRARY_HASH;
}

function currentRoute(): AppRoute {
  const h = window.location.hash;
  // an old #/rules/... link: the address becomes the page it opens
  const moved = legacyHash(h, BOOKS);
  if (moved !== null) window.history.replaceState(null, "", `${window.location.pathname}${moved}`);
  return parseRoute(h === "" ? entryHash() : (moved ?? h), BOOKS);
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(currentRoute);
  useAppShortcuts();

  useEffect(() => {
    // bare "/" resolved by entryHash(): write the hash back (replaceState —
    // no history entry) so the URL matches the page
    if (window.location.hash === "") {
      window.history.replaceState(null, "", `${window.location.pathname}${entryHash()}`);
    }
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      <View route={route} />
      <WordEditorHost />
      <GlobalWindows />
    </>
  );
}

function View({ route }: { route: AppRoute }) {
  switch (route.view) {
    case "library":
      return <Library />;
    case "book":
      return <CourseApp key={route.book.id} book={route.book} page={route.page} share={route.share} />;
    case "cards":
      // a new deck is a new session
      return route.deck ? <StudyView key={deckKey(route.deck)} deck={route.deck} /> : <CardsView />;
    case "browse":
      // one deck's list and its cards share the search and the filter
      return <DeckBrowser key={route.deck} deck={route.deck} entry={route.entry} />;
    case "dictionary":
      return <DictionaryView deck={route.deck} />;
  }
}
