// Progress modal: unit-square overview + the import / export / share actions.
// Pure UI — actions arrive through onImport/onExport/onShare. With `preview`
// set (an incoming share-link payload) it shows THAT progress instead of the
// live one plus an apply button; closing discards the preview.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { IndexData, TotalsMap } from "../data";
import { completedUnitIds, countCorrect, pct, scopeStats } from "../progress";
import type { Progress } from "../progress";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Check, Download, Share2, Upload, X } from "lucide-react";

export function ProgressModal({
  open,
  onClose,
  progress,
  preview,
  index,
  totals,
  onApplyPreview,
  onImport,
  onExport,
  onShare,
  hintKeys,
}: {
  open: boolean;
  onClose: () => void;
  progress: Progress;
  /** incoming share-link payload: shown instead of `progress`, apply gated */
  preview?: Progress | null;
  index: IndexData | null;
  totals: TotalsMap | null;
  onApplyPreview?: () => void;
  onImport: (file: File) => Promise<string>;
  onExport: (includeAnswers: boolean) => string;
  onShare: (includeAnswers: boolean) => Promise<string>;
  /** opened via Shift+I: underline each control's trigger letter */
  hintKeys: boolean;
}): JSX.Element | null {
  const [withAnswers, setWithAnswers] = useState(true);
  const [busy, setBusy] = useState(false);
  // status line: seq re-keys the node so the copy-shake replays even when the
  // same text is set twice in a row
  const [msg, setMsgState] = useState<{ text: string; shake: boolean; seq: number }>({
    text: "",
    shake: false,
    seq: 0,
  });
  const setMsg = (text: string, shake = false) =>
    setMsgState((m) => ({ text, shake, seq: m.seq + 1 }));
  // exit: the card stays mounted under .closing while modal-out plays, then
  // drops from the DOM. closing is derived from open (not set in an effect),
  // so the class lands in the same commit as open=false — unmounting first
  // would flash the backdrop away and back.
  const [shown, setShown] = useState(open);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  // result message auto-clears
  useEffect(() => {
    if (!msg.text) return;
    const t = setTimeout(() => setMsg(""), 6000);
    return () => clearTimeout(t);
  }, [msg]);
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

  async function run(fn: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    try {
      const text = await fn();
      // "copied" is the one result that confirms a clipboard side effect the
      // window can't otherwise show — it gets the shake
      setMsg(text, /copied/i.test(text));
    } finally {
      setBusy(false);
    }
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // same file can be picked again
    if (!f) return;
    await run(() => onImport(f));
  }

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
              Incoming: Units completed {doneUnits.size}/145 · Answers correct {cc.correct}/
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
            Units completed {doneUnits.size}/145 · Answers correct {cc.correct}/{cc.total}
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
        {preview ? (
          <div className="modal-actions">
            <button className="themebtn primary" onClick={onApplyPreview}>
              <Check size={14} aria-hidden /> Apply and erase current progress
            </button>
          </div>
        ) : (
          <>
            <label className="modal-opt" data-modal-key="A">
              <input
                type="checkbox"
                checked={withAnswers}
                onChange={(e) => setWithAnswers(e.target.checked)}
              />
              <HintText text="Include answer texts" letter={hintKeys ? "A" : null} />
            </label>
            <div className="modal-actions">
              <button
                className="themebtn"
                data-modal-key="I"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={14} aria-hidden />{" "}
                <HintText text="Import" letter={hintKeys ? "I" : null} />
              </button>
              <button
                className="themebtn"
                data-modal-key="E"
                disabled={busy}
                onClick={() => setMsg(onExport(withAnswers))}
              >
                <Download size={14} aria-hidden />{" "}
                <HintText text="Export" letter={hintKeys ? "E" : null} />
              </button>
              <button
                className="themebtn"
                data-modal-key="S"
                disabled={busy}
                onClick={() => void run(() => onShare(withAnswers))}
              >
                <Share2 size={14} aria-hidden />{" "}
                <HintText text="Share" letter={hintKeys ? "S" : null} />
              </button>
            </div>
            <div className="modal-msg" role="status">
              {msg.text && (
                <span
                  key={msg.seq}
                  className={"msgtext" + (msg.shake ? " shake" : "")}
                >
                  {msg.text}
                </span>
              )}
            </div>
          </>
        )}
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pickFile} />
      </div>
    </div>
  );
}

// Shift+I opens the window in "hint mode": one letter of each control is
// underlined and pressing that letter does the same as clicking the control.
// The letter is the control's access key (I, E, S, and the A of "Answer").
// Everything stays inside ONE inline span: the buttons are flex rows with a
// 6px gap, so bare text next to the highlighted letter would become its own
// flex item and push a gap in the middle of the word.
function HintText({ text, letter }: { text: string; letter: string | null }): JSX.Element {
  const at = letter === null ? -1 : text.toLowerCase().indexOf(letter.toLowerCase());
  return (
    <span>
      {at === -1 ? (
        text
      ) : (
        <>
          {text.slice(0, at)}
          <span className="hintkey">{text[at]}</span>
          {text.slice(at + 1)}
        </>
      )}
    </span>
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
