// Home: a book's landing (#/<book>). The hero is the book cover — drawn in
// the app (Cover.tsx) — with a one-paragraph description and a single
// call to action beside it on desktop (stacked and centered on phones). The
// cover is a real button mirroring the CTA — same action, mouse or keyboard.
// Learners with saved progress get the CTA corrected to "Continue with …"
// pointing where they left off; Progress numbers live in the topbar, the
// unit list behind the hamburger on content pages — the landing stays
// quiet. Scrolling is OverlayScrollbars, like every other pane.

import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { Book } from "../books";
import type { ContinueTarget } from "../progress";
import { Cover } from "./Cover";

export function Home({
  book,
  onStart,
  continueTo,
}: {
  book: Book;
  onStart: () => void;
  continueTo: ContinueTarget | null;
}) {
  return (
    <OverlayScrollbarsComponent
      element="main"
      className="home"
      options={{
        overflow: { x: "hidden" },
        scrollbars: {
          theme: "os-theme-dark",
          autoHide: "leave",
          autoHideDelay: 500,
        },
      }}
    >
      <div className="homecol">
        <button type="button" className="homecoverbtn" onClick={onStart}>
          <Cover book={book} className="homecover" />
        </button>
        <div className="hometext">
          <p className="homekicker">
            {book.level} · {book.edition}
          </p>
          <p className="homedesc">{book.description}</p>
          <button type="button" className="homecta" onClick={onStart}>
            {continueTo ? (
              <>
                <s>Start with Unit 1</s> {continueTo.label}
              </>
            ) : (
              "Start with Unit 1"
            )}
          </button>
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
      </div>
    </OverlayScrollbarsComponent>
  );
}
