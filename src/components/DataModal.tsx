// The data window: everything this browser holds, in one place, and one file
// to move it with. The targets are ticked — the books' progress, the cards
// (reviews and daily limits), the words — and Import / Export / share act on
// the ticked ones. This replaces the export buttons that used to sit in the
// progress window, on the deck list and in the dictionary: same three
// actions, one window, available in every view (globalUi.ts).
//
// Nothing is written on import until Apply: the file is summarised first, so
// a learner sees what is in it before it touches their work.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Check, Download, Share2, Upload, X } from "lucide-react";
import { BOOKS, bookById } from "../books";
import type { Incoming, Targets } from "../datatransfer";
import { makeDataFile, parseIncoming } from "../datatransfer";
import { closeGlobal, globalHints, useGlobalModal } from "../globalUi";
import {
  completedUnitIds,
  loadProgress,
  progressPayload,
  saveProgress,
} from "../progress";
import { parseRoute } from "../routes";
import { encodeShare } from "../share";
import { importSrs, importWords } from "../study";

/** One row of the window: a checkbox and what ticking it carries. */
function Row({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  detail?: string;
}) {
  return (
    <label className="modal-opt">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{title}</span>
      {detail && <span className="modal-optdetail">{detail}</span>}
    </label>
  );
}

/** What the read file carries, one line per target it carries. */
function incomingSummary(read: Incoming): string[] {
  if (read.kind === "study") {
    const cards = Object.keys(read.backup.srs.states).length;
    return [
      `Cards: ${read.backup.words.length} word${read.backup.words.length === 1 ? "" : "s"}, ${cards} reviewed cards`,
    ];
  }
  if (read.kind === "progress") {
    return ["One book's progress — it goes into the course you are in"];
  }
  const lines: string[] = [];
  for (const [id, p] of Object.entries(read.file.books)) {
    const book = bookById(id);
    const done = completedUnitIds(p).size;
    lines.push(
      book ? `${book.title}: ${done}/${book.units} units done` : `Book "${id}": not in this app`,
    );
  }
  if (read.file.cards) {
    const cards = Object.keys(read.file.cards.srs.states).length;
    lines.push(`Cards: ${cards} reviewed card${cards === 1 ? "" : "s"}`);
  }
  if (read.file.dictionary) {
    const n = read.file.dictionary.words.length;
    lines.push(`Dictionary: ${n} word${n === 1 ? "" : "s"}`);
  }
  return lines.length ? lines : ["Nothing in this file"];
}

/** Apply the read file. Returns what changed, for the status line. */
function applyIncoming(read: Incoming): string {
  if (read.kind === "study") {
    const w = importWords(read.backup.words);
    const s = importSrs(read.backup.srs);
    return `Applied: ${w.added} new word${w.added === 1 ? "" : "s"}, ${w.updated} updated, ${s.cards} card${s.cards === 1 ? "" : "s"} with newer reviews`;
  }
  if (read.kind === "progress") {
    // a bare progress file names no book: it belongs to the course you are in
    const route = parseRoute(window.location.hash, BOOKS);
    if (route.view !== "book") return "A progress file belongs to a book — open one of the two courses first";
    saveProgress(route.book.id, read.progress, 0);
    return `Applied to ${route.book.title}`;
  }
  const parts: string[] = [];
  for (const [id, p] of Object.entries(read.file.books)) {
    const book = bookById(id);
    if (!book) continue;
    saveProgress(id, p, 0);
    parts.push(`${book.title} — ${completedUnitIds(p).size} units done`);
  }
  if (read.file.cards) {
    const s = importSrs(read.file.cards.srs);
    parts.push(`${s.cards} card${s.cards === 1 ? "" : "s"} with newer reviews`);
  }
  if (read.file.dictionary) {
    const w = importWords(read.file.dictionary.words);
    parts.push(`${w.added} new word${w.added === 1 ? "" : "s"}, ${w.updated} updated`);
  }
  return parts.length ? `Applied: ${parts.join(" · ")}` : "Nothing in this file to apply";
}

export function DataModal(): JSX.Element | null {
  // one app-wide window at a time: the help window and the book picker
  // close this one rather than opening beside it
  const open = useGlobalModal() === "data";
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [withAnswers, setWithAnswers] = useState(true);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  // status line: seq re-keys the node so the entry animation (fade, plus the
  // copy-shake) replays even when the same text is set twice in a row.
  const [msg, setMsgState] = useState<{ text: string; shake: boolean; seq: number }>({
    text: "",
    shake: false,
    seq: 0,
  });
  const [msgLeaving, setMsgLeaving] = useState(false);
  const setMsg = (text: string, shake = false) => {
    setMsgLeaving(false);
    setMsgState((m) => ({ text, shake, seq: m.seq + 1 }));
  };
  // exit: the window stays mounted under .closing while modal-out plays, then
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
      if (e.key === "Escape") closeGlobal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 150);
    return () => window.clearTimeout(t);
  }, [open]);

  // result message auto-clears: fade out, then drop the text once the
  // 0.18s leave animation has played (so the line doesn't blink away)
  useEffect(() => {
    if (!msg.text) return;
    const hide = setTimeout(() => setMsgLeaving(true), 6000);
    const drop = setTimeout(() => {
      setMsgState((m) => ({ ...m, text: "" }));
      setMsgLeaving(false);
    }, 6180);
    return () => {
      clearTimeout(hide);
      clearTimeout(drop);
    };
  }, [msg]);

  const targets: Targets = useMemo(
    () => ({
      books: BOOKS.filter((b) => ticked[b.id]).map((b) => b.id),
      includeAnswers: withAnswers,
      cards: Boolean(ticked.cards),
      dictionary: Boolean(ticked.dictionary),
    }),
    [ticked, withAnswers],
  );

  if (!shown) return null;
  const closing = !open;
  const hints = globalHints();
  // a share link carries one book's progress, so it needs exactly one book
  const oneBook = targets.books.length === 1;

  async function share() {
    const bookId = targets.books[0];
    try {
      const code = await encodeShare(progressPayload(loadProgress(bookId), withAnswers));
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}#/${bookId}/p=${code}`,
      );
      setMsg("Link copied", true);
    } catch {
      setMsg("Could not copy — the browser blocked the clipboard", true);
    }
  }

  function exportFile() {
    if (!targets.books.length && !targets.cards && !targets.dictionary) {
      setMsg("Nothing selected — tick what to export");
      return;
    }
    const blob = new Blob([JSON.stringify(makeDataFile(targets, Date.now()))], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `murrnglish-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg("File downloaded");
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again
    if (!f) return;
    let text: string;
    try {
      text = await f.text();
    } catch {
      setMsg("Could not read the file", true);
      return;
    }
    const found = parseIncoming(text);
    if (!found) {
      setMsg("Not a Murrnglish file", true);
      return;
    }
    setIncoming(found);
  }

  return (
    <div className={"modal-overlay" + (closing ? " closing" : "")} onClick={closeGlobal}>
      <div
        className={"modal" + (closing ? " closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Data"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Data</h2>
          <button ref={closeRef} className="themebtn" onClick={closeGlobal} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className="modal-summary">
          Everything here lives in this browser only. Choose what to move.
        </div>
        {BOOKS.map((book) => (
          <Row
            key={book.id}
            checked={Boolean(ticked[book.id])}
            onChange={(v) => setTicked((t) => ({ ...t, [book.id]: v }))}
            title={book.title}
            detail={`${completedUnitIds(loadProgress(book.id)).size}/${book.units} units done`}
          />
        ))}
        <Row
          checked={Boolean(ticked.cards)}
          onChange={(v) => setTicked((t) => ({ ...t, cards: v }))}
          title="Cards — reviews and daily limits"
        />
        <Row
          checked={Boolean(ticked.dictionary)}
          onChange={(v) => setTicked((t) => ({ ...t, dictionary: v }))}
          title="Dictionary — your words"
        />
        <label className="modal-opt" data-modal-key="A">
          <input
            type="checkbox"
            checked={withAnswers}
            onChange={(e) => setWithAnswers(e.target.checked)}
          />
          <HintText text="Include answer texts" letter={hints ? "A" : null} />
        </label>
        <div className="modal-actions">
          <button className="themebtn" data-modal-key="I" onClick={() => fileRef.current?.click()}>
            <Upload size={14} aria-hidden /> <HintText text="Import" letter={hints ? "I" : null} />
          </button>
          <button className="themebtn" data-modal-key="E" onClick={exportFile}>
            <Download size={14} aria-hidden /> <HintText text="Export" letter={hints ? "E" : null} />
          </button>
          <button className="themebtn" data-modal-key="S" disabled={!oneBook} onClick={() => void share()}>
            <Share2 size={14} aria-hidden />{" "}
            <HintText text="Copy share link" letter={hints ? "S" : null} />
          </button>
        </div>
        {incoming && (
          <>
            <div className="modal-summary">
              {incomingSummary(incoming).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="themebtn primary" onClick={() => setMsg(applyIncoming(incoming))}>
                <Check size={14} aria-hidden /> Apply
              </button>
            </div>
          </>
        )}
        <div className="modal-msg" role="status">
          {msg.text && (
            <span
              key={msg.seq}
              className={"msgtext" + (msg.shake ? " shake" : "") + (msgLeaving ? " leaving" : "")}
            >
              {msg.text}
            </span>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pickFile} />
      </div>
    </div>
  );
}

/**
 * Alt+D and Shift+I open the window in "hint mode": one letter of each
 * control is underlined and pressing that letter does the same as clicking
 * it. The letter is the control's access key (I, E, S, and the A of
 * "Answer"). Everything stays inside ONE inline span: the buttons are flex
 * rows with a 6px gap, so bare text next to the highlighted letter would
 * become its own flex item and push a gap in the middle of the word.
 */
export function HintText({ text, letter }: { text: string; letter: string | null }): JSX.Element {
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