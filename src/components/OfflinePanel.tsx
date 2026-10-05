// Offline panel: the download window of the installed app, one row per book —
// each downloads and is removed on its own. Structure copies the data window
// (overlay + card + exit animation); the downloads themselves live in
// ../offline, so closing the panel never interrupts one that is in flight.
// The numbers come from that module's store, not from a per-panel
// subscription — the background start after install (CourseApp) runs one
// without this panel.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trash2, X } from "lucide-react";
import type { Book } from "../books";
import { BOOKS } from "../books";
import {
  downloadBook,
  downloadFraction,
  downloadState,
  isDownloaded,
  removeDownloaded,
  useDownloads,
} from "../offline";
import { Cover } from "./Cover";

type Phase = "checking" | "idle" | "downloading" | "done" | "error";

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

export function OfflinePanel({
  open,
  onClose,
  currentBookId,
}: {
  open: boolean;
  onClose: () => void;
  /** the book being read: listed first */
  currentBookId?: string;
}): JSX.Element | null {
  const closeRef = useRef<HTMLButtonElement>(null);
  // exit: the card stays mounted under .closing while modal-out plays, then
  // drops from the DOM (same 150ms hunt as the data window)
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 150);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!shown) return null;
  const closing = !open;
  const books = [...BOOKS].sort(
    (a, b) => Number(b.id === currentBookId) - Number(a.id === currentBookId),
  );

  return (
    <div className={"modal-overlay" + (closing ? " closing" : "")} onClick={onClose}>
      <div
        className={"modal" + (closing ? " closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Offline"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Offline</h2>
          <button ref={closeRef} className="themebtn" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className="modal-summary">
          Download a book to learn without internet: its pages, units and
          additional exercises.
        </div>
        <div className="modal-body dlrows">
          {books.map((b) => (
            <BookRow key={b.id} book={b} open={open} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BookRow({ book, open }: { book: Book; open: boolean }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [errorFile, setErrorFile] = useState("");
  const live = useDownloads()[book.id];

  const onDone = useCallback(() => setPhase("done"), []);
  const onFail = useCallback((e: unknown) => {
    setErrorFile(e instanceof Error ? e.message : String(e));
    setPhase("error");
  }, []);

  // opening: a run already in flight wins over the cache check — the panel
  // can be closed and reopened while the download keeps going underneath
  useEffect(() => {
    if (!open) return;
    setErrorFile("");
    if (downloadState(book.id).active) {
      setPhase("downloading");
      downloadBook(book).then(onDone, onFail); // rejoin, don't restart
      return;
    }
    setPhase("checking");
    let alive = true;
    isDownloaded(book).then((yes) => {
      if (alive) setPhase(yes ? "done" : "idle");
    });
    return () => {
      alive = false;
    };
  }, [open, book, onDone, onFail]);

  const start = () => {
    setErrorFile("");
    setPhase("downloading");
    downloadBook(book).then(onDone, onFail);
  };

  const remove = async () => {
    await removeDownloaded(book);
    setPhase("idle");
  };

  // 0 while the total is unknown (a HEAD that never answered and the book not
  // started yet): the bar sits empty for that instant rather than guessing
  const p = live.progress;
  const frac = p ? (downloadFraction(p) ?? 0) : 0;

  const status =
    phase === "checking"
      ? "Checking…"
      : phase === "idle"
        ? `≈${mb(book.downloadBytes)} MB — the book, ${book.units} units and ${book.additional} additional exercises`
        : phase === "downloading"
          ? p && p.totalBytes > 0
            ? `Downloading… ${mb(p.bytes)} of ${mb(p.totalBytes)} MB`
            : "Preparing…"
          : phase === "done"
            ? `Downloaded${live.ts ? ` — ${new Date(live.ts).toLocaleString()}` : ""}`
            : `Download failed at ${errorFile}. Finished parts are kept — retry to resume.`;

  return (
    <div className="dlrow">
      <Cover book={book} className="dlcover" />
      <div className="dlinfo">
        <div className="dltitle">{book.title}</div>
        <div className="dlstatus">{status}</div>
        {phase === "downloading" && (
          <div
            className="dlbar"
            role="progressbar"
            aria-label={`Downloading ${book.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(frac * 100)}
          >
            <div className="dlbar-fill" style={{ width: `${frac * 100}%` }} />
          </div>
        )}
      </div>
      <div className="modal-actions dlaction">
        {phase === "idle" && (
          <button className="themebtn primary" onClick={start}>
            <Download size={14} aria-hidden /> Download
          </button>
        )}
        {phase === "done" && (
          <button
            className="themebtn"
            onClick={() => void remove()}
            aria-label={`Remove the downloaded ${book.title}`}
          >
            <Trash2 size={14} aria-hidden /> Remove
          </button>
        )}
        {phase === "error" && (
          <button className="themebtn" onClick={start}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
