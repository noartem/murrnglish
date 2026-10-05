// Library: the landing of the whole app (#/). One card per book — cover,
// level, size, how far the learner got — with the same resume-or-start call
// to action each book's own landing has. Books come from the registry
// (books.ts), in learning order. Under the books, the sections that span
// them: the cards (with what is due today) and the dictionary.

import { useMemo, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Layers, NotebookPen } from "lucide-react";
import type { Book } from "../books";
import { BOOKS } from "../books";
import { useDueCount } from "../dueCount";
import { completedUnitIds, continueTarget, loadProgress } from "../progress";
import { CARDS_HASH, DICTIONARY_HASH, bookHash } from "../routes";
import { isStandalone } from "../offline";
import { useStudy } from "../study";
import { AppShell } from "./AppShell";
import { Battery } from "./Battery";
import { Cover } from "./Cover";
import { OfflineButton } from "./OfflineButton";
import { OfflinePanel } from "./OfflinePanel";

export function Library() {
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [standalone] = useState(isStandalone);

  return (
    <AppShell
      head={
        <span className="topbar-brand">
          <h1>Murrnglish</h1>
        </span>
      }
      navActions={standalone ? <OfflineButton onOpen={() => setOfflineOpen(true)} /> : undefined}
    >
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
              Exercises based on the material of Raymond Murphy (Cambridge
              University Press)
            </footer>
          </div>
        </OverlayScrollbarsComponent>
      <OfflinePanel open={offlineOpen} onClose={() => setOfflineOpen(false)} />
    </AppShell>
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
        <Cover book={book} className="libcover" />
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
      <a className="studytile" href={CARDS_HASH}>
        <Layers size={22} aria-hidden />
        <span className="tiletitle">
          Cards
          {due > 0 && <span className="duebadge">{due}</span>}
        </span>
        <span className="tiletext">
          {due > 0 ? `${due} due today. ` : ""}Grammar, verb forms, phrasal verbs and your own words, with spaced repetition.
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
