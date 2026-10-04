// Progress modal: this book's unit-square overview, plus the preview of an
// incoming share link (#/<book>/p=…) with an apply button. Pure UI. The
// import / export / share actions live in the data window now (DataModal),
// so this one is only ever opened for the overview.
import { useEffect, useMemo, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Check, X } from "lucide-react";
import { useBook } from "../bookContext";
import type { IndexData, TotalsMap } from "../data";
import { completedUnitIds, countCorrect, pct, scopeStats } from "../progress";
import type { Progress } from "../progress";

export function ProgressModal({
  open,
  onClose,
  progress,
  preview,
  index,
  totals,
  onApplyPreview,
}: {
  open: boolean;
  onClose: () => void;
  progress: Progress;
  /** incoming share-link payload: shown instead of `progress`, apply gated */
  preview?: Progress | null;
  index: IndexData | null;
  totals: TotalsMap | null;
  onApplyPreview?: () => void;
}): JSX.Element | null {
  const book = useBook();
  // status line: seq re-keys the node so the entry animation replays even when
  // the same text is set twice in a row.
  // exit: the card stays mounted under .closing while modal-out plays, then
  // drops from the DOM. closing is derived from open (not set in an effect),
  // so the class lands in the same commit as open=false — unmounting first
  // would flash the backdrop away and back.
  const [shown, setShown] = useState(open);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Esc closes while open; the close button takes focus for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);
  // enter: modal-in runs on mount; exit: hold the card 150ms (> 0.14s
  // modal-out) so the animation finishes before unmount
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 150);
    return () => window.clearTimeout(t);
  }, [open]);

  // preview shows the incoming payload, not the live state; computed BEFORE
  // the early return — hooks must run unconditionally
  const display = preview ?? progress;
  const doneUnits = useMemo(() => completedUnitIds(display), [display]);
  const cc = countCorrect(display);
  const answerCount = Object.keys(display.answers).length;

  if (!shown) return null;
  const closing = !open;

  return (
    <div className={"modal-overlay" + (closing ? " closing" : "")} onClick={onClose}>
      <div
        className={"modal" + (closing ? " closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Progress"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Progress</h2>
          <button ref={closeRef} className="themebtn" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        {preview ? (
          <>
            <div className="modal-summary">
              Incoming: Units completed {doneUnits.size}/{book.units} · Answers correct {cc.correct}/
              {cc.total}
            </div>
            <div className="modal-summary">
              {answerCount > 0
                ? `Includes ${answerCount} answer texts`
                : "Completion facts only — no answer texts"}
            </div>
          </>
        ) : (
          <div className="modal-summary">
            Units completed {doneUnits.size}/{book.units} · Answers correct {cc.correct}/{cc.total}
          </div>
        )}
        {index && (
          <OverlayScrollbarsComponent
            className="modal-body"
            options={{
              overflow: { x: "hidden" as const },
              scrollbars: {
                theme: "os-theme-dark",
                autoHide: "leave" as const,
                autoHideDelay: 500,
              },
            }}
          >
            <div className="unitgrid">
              {index.groups.flatMap((g) => g.units).map((u) => {
                const p = pct(scopeStats(totals, [`u${u}`], display));
                return (
                  <Square
                    key={u}
                    done={doneUnits.has(u)}
                    p={p}
                    title={`Unit ${u}${p > 0 ? ` — ${p}%` : ""}`}
                  />
                );
              })}
              {index.additional.exercises.map((n) => {
                const p = pct(scopeStats(totals, [`a${n}`], display));
                return (
                  <Square
                    key={n}
                    done={Boolean(display.results[String(n)])}
                    p={p}
                    title={`Additional exercise ${n}${p > 0 ? ` — ${p}%` : ""}`}
                  />
                );
              })}
            </div>
          </OverlayScrollbarsComponent>
        )}
        {preview && (
          <div className="modal-actions">
            <button className="themebtn primary" onClick={onApplyPreview}>
              <Check size={14} aria-hidden /> Apply and erase current progress
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// One overview square: grey while untouched, the ok fill mixed toward grey by
// its percent while partial, solid ok once done. No label — the color IS the
// information; hover the title for the exact unit.
function Square({ done, p, title }: { done: boolean; p: number; title: string }): JSX.Element {
  const partial = !done && p > 0;
  return (
    <div
      className={done ? "unitsq done" : "unitsq"}
      title={title}
      style={
        partial ? { background: `color-mix(in srgb, var(--ok-solid) ${p}%, var(--track))` } : undefined
      }
    />
  );
}