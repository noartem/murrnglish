// Library: the landing of the whole app (#/). One card per book — cover,
// level, size, how far the learner got — with the same resume-or-start call
// to action each book's own landing has. Books come from the registry
// (books.ts), in learning order. Under the books, the sections that span
// them: the rules, the cards (with what is due today) and the dictionary.

import { useEffect, useMemo, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { BookOpenText, Layers, LibraryBig, NotebookPen } from "lucide-react";
import type { Book } from "../books";
import { BOOKS, bookUrl } from "../books";
import { completedUnitIds, continueTarget, loadProgress } from "../progress";
import { CARDS_HASH, DICTIONARY_HASH, bookHash, rulesHash } from "../routes";
import { useDueCount } from "../dueCount";
import { useStudy } from "../study";
import { isStandalone } from "../offline";
import { Battery } from "./Battery";
import { OfflineButton, OfflineChip } from "./OfflineButton";
import { OfflinePanel } from "./OfflinePanel";
import { ThemeToggle } from "./ThemeToggle";

export function Library() {
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [standalone] = useState(isStandalone);
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-mid">
          <span className="topbar-brand">
            <LibraryBig size={20} aria-hidden />
            <h1>Murrnglish</h1>
          </span>
        </div>
        {isMobile && standalone && <OfflineChip onOpen={() => setOfflineOpen(true)} />}
        <div className="topbar-actions">
          {standalone && <OfflineButton onOpen={() => setOfflineOpen(true)} />}
          <ThemeToggle />
        </div>
      </header>
      <div className="main">
        <OverlayScrollbarsComponent
          element="main"
          className="home library"
          options={{
            overflow: { x: "hidden" },
            scrollbars: {
              theme: "os-theme-dark",
              autoHide: "leave",
              autoHideDelay: 500,
            },
          }}
        >
          <div className="libcol">
            <p className="homedesc libintro">
              Raymond Murphy’s grammar books as interactive web courses: the
              book’s pages with exercises beside them, answers checked as you
              go, progress saved in this browser.
            </p>
            <div className="libgrid">
              {BOOKS.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
            <StudyTiles />
            <footer className="homecredit">
              Web edition by{" "}
              <a href="https://noartem.ru" rel="me noopener" target="_blank">
                Artem Noskov
              </a>
              <br />
              From the books by Raymond Murphy (Cambridge University Press)
            </footer>
          </div>
        </OverlayScrollbarsComponent>
      </div>
      <OfflinePanel open={offlineOpen} onClose={() => setOfflineOpen(false)} />
    </div>
  );
}

function BookCard({ book }: { book: Book }) {
  const progress = useMemo(() => loadProgress(book.id), [book]);
  const done = useMemo(() => completedUnitIds(progress).size, [progress]);
  const next = continueTarget(progress, book);
  const open = () => {
    window.location.hash = next
      ? `#/${book.id}/${next.page}`
      : bookHash(book, { kind: "unit", n: 1 });
  };
  return (
    <article className="libcard">
      <a className="libcoverlink" href={bookHash(book)} aria-label={`${book.title}: about the book`}>
        <img
          className="libcover"
          src={bookUrl(book, book.cover.file)}
          alt=""
          width={book.cover.width}
          height={book.cover.height}
          style={{ aspectRatio: `${book.cover.width} / ${book.cover.height}` }}
          decoding="async"
          draggable={false}
        />
      </a>
      <div className="libinfo">
        <p className="libkicker">
          <span className="libdot" style={{ background: book.color }} aria-hidden />
          {book.level} · {book.edition}
        </p>
        <h2 className="libtitle">
          <a href={bookHash(book)}>{book.title}</a>
        </h2>
        <p className="libmeta">
          {book.units} units · {book.additional} additional exercises
        </p>
        <Battery label="Units completed" done={done} total={book.units} tone="accent" />
        <button type="button" className="homecta libcta" onClick={open}>
          {next ? next.label : "Start with Unit 1"}
        </button>
      </div>
    </article>
  );
}

function StudyTiles() {
  const due = useDueCount();
  const { words } = useStudy();
  return (
    <nav className="studygrid" aria-label="Study">
      <a className="studytile" href={rulesHash()}>
        <BookOpenText size={22} aria-hidden />
        <span className="tiletitle">Rules</span>
        <span className="tiletext">Every rule of the books, searchable, next to its exercises.</span>
      </a>
      <a className="studytile" href={CARDS_HASH}>
        <Layers size={22} aria-hidden />
        <span className="tiletitle">
          Cards
          {due > 0 && <span className="duebadge">{due}</span>}
        </span>
        <span className="tiletext">
          {due > 0 ? `${due} due today. ` : ""}Spaced repetition of the units you learn and of your words.
        </span>
      </a>
      <a className="studytile" href={DICTIONARY_HASH}>
        <NotebookPen size={22} aria-hidden />
        <span className="tiletitle">Dictionary</span>
        <span className="tiletext">
          {words.length ? `${words.length} word${words.length === 1 ? "" : "s"}. ` : ""}Your own words, with
          translations and pronunciation.
        </span>
      </a>
    </nav>
  );
}
