// App: the router. The hash picks the library (#/), one book's course
// (#/<book>/...) or one of the sections next to the books — the rules
// compendium, the card decks, the dictionary (routes.ts). A book's course is
// keyed by the book, so opening another book remounts it with that book's
// data and progress. The word editor is mounted once here, above every view:
// the dictionary, the exercises and the rules all open it.

import { useEffect, useState } from "react";
import { BOOKS, bookById } from "./books";
import CourseApp from "./CourseApp";
import { CardsView } from "./components/CardsView";
import { DictionaryView } from "./components/DictionaryView";
import { Library } from "./components/Library";
import { RulesView } from "./components/RulesView";
import { StudyView } from "./components/StudyView";
import { WordEditorHost } from "./components/WordEditor";
import {
  hasProgress,
  lastUnitFromProgress,
  loadLastBook,
  loadLastRoute,
  loadProgress,
} from "./progress";
import type { AppRoute } from "./routes";
import { LIBRARY_HASH, bookHash, deckKey, parsePage, parseRoute } from "./routes";

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
  return parseRoute(h === "" ? entryHash() : h, BOOKS);
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(currentRoute);

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
    </>
  );
}

function View({ route }: { route: AppRoute }) {
  switch (route.view) {
    case "library":
      return <Library />;
    case "book":
      return <CourseApp key={route.book.id} book={route.book} page={route.page} share={route.share} />;
    case "rules":
      return <RulesView book={route.book} unit={route.unit} />;
    case "cards":
      // a new deck is a new session
      return route.deck ? <StudyView key={deckKey(route.deck)} deck={route.deck} /> : <CardsView />;
    case "dictionary":
      return <DictionaryView />;
  }
}
