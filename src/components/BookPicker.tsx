// Book picker: Shift+B, "Go to a book", open from anywhere in the app. One
// row per book in library order — its number, its name, how far the learner
// got — so the destination is visible before the key that picks it. Alt+1…9
// opens a book outright from any view; this is the same list for the case
// where the browser or the window manager claims Alt+digit.

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { BOOKS } from "../books";
import { closeGlobal, currentGlobal } from "../globalUi";
import { completedUnitIds, loadProgress } from "../progress";
import { bookHash } from "../routes";

export function BookPicker(): JSX.Element | null {
  const open = currentGlobal() === "books";
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstRow = useRef<HTMLButtonElement>(null);

  // its own keys while open: a digit picks the book, the arrows move between
  // the rows, Enter is the button's own click, Esc closes
  useEffect(() => {
    if (!open) return;
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".pickerrow")];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeGlobal();
        return;
      }
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (n) {
        const book = BOOKS[Number(n) - 1];
        if (!book) return;
        e.preventDefault();
        closeGlobal();
        window.location.hash = bookHash(book);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const here = rows().indexOf(document.activeElement as HTMLButtonElement);
        if (here === -1) return;
        e.preventDefault();
        rows()[e.key === "ArrowDown" ? here + 1 : here - 1]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    firstRow.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={closeGlobal}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Go to"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Go to a book</h2>
          <button ref={closeRef} className="themebtn" onClick={closeGlobal} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className="pickerrows">
          {BOOKS.map((book, i) => (
            <button
              key={book.id}
              ref={i === 0 ? firstRow : undefined}
              type="button"
              className="pickerrow"
              onClick={() => {
                closeGlobal();
                window.location.hash = bookHash(book);
              }}
            >
              <kbd>{i + 1}</kbd>
              <span className="pickerrowtext">
                <span className="pickertitle">{book.title}</span>
                <span className="pickermeta">
                  {book.level} · {book.edition} — {completedUnitIds(loadProgress(book.id)).size}/
                  {book.units} units done
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}