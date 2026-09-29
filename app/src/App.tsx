// App: the router. The hash picks the library (#/) or one book's course
// (#/<book>/...), see routes.ts. A book's course is keyed by the book, so
// opening another book remounts it with that book's data and progress.

import { useEffect, useState } from "react";
import { BOOKS, bookById } from "./books";
import CourseApp from "./CourseApp";
import { Library } from "./components/Library";
import {
  hasProgress,
  lastUnitFromProgress,
  loadLastBook,
  loadLastRoute,
  loadProgress,
} from "./progress";
import type { AppRoute } from "./routes";
import { LIBRARY_HASH, bookHash, parsePage, parseRoute } from "./routes";

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

  if (route.view === "library") return <Library />;
  return (
    <CourseApp key={route.book.id} book={route.book} page={route.page} share={route.share} />
  );
}
