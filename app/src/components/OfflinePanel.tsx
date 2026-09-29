// Offline panel: the download window of the installed app. Structure copies
// ProgressModal (overlay + card + exit animation); the download itself lives in
// ../offline, so closing the panel never interrupts one that is in flight.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trash2, X } from "lucide-react";
import type { DownloadProgress } from "../offline";
import {
  currentDownload,
  downloadCourse,
  getDownloadedTs,
  isDownloaded,
  removeDownloaded,
} from "../offline";

type Phase = "checking" | "idle" | "downloading" | "done" | "error";

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

export function OfflinePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>("checking");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [savedTs, setSavedTs] = useState<number | null>(null);
  const [errorFile, setErrorFile] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  // exit: the card stays mounted under .closing while modal-out plays, then
  // drops from the DOM (same 150ms hunt as ProgressModal)
  const [shown, setShown] = useState(open);

  const onProgress = useCallback((p: DownloadProgress) => setProgress(p), []);
  const onDone = useCallback(() => {
    setSavedTs(getDownloadedTs());
    setPhase("done");
  }, []);
  const onFail = useCallback((e: unknown) => {
    setErrorFile(e instanceof Error ? e.message : String(e));
    setPhase("error");
  }, []);

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

  // opening: a run already in flight wins over the stored flag — the panel can
  // be closed and reopened while the download keeps going underneath
  useEffect(() => {
    if (!open) return;
    setErrorFile("");
    setSavedTs(getDownloadedTs());
    const live = currentDownload();
    if (live.active) {
      setProgress(live.progress);
      setPhase("downloading");
      downloadCourse(onProgress).then(onDone, onFail); // rejoin, don't restart
      return;
    }
    setProgress(null);
    setPhase("checking");
    let alive = true;
    isDownloaded().then((yes) => {
      if (alive) setPhase(yes ? "done" : "idle");
    });
    return () => {
      alive = false;
    };
  }, [open, onProgress, onDone, onFail]);

  if (!shown) return null;
  const closing = !open;

  const start = () => {
    setErrorFile("");
    setProgress(null);
    setPhase("downloading");
    downloadCourse(onProgress).then(onDone, onFail);
  };

  const remove = async () => {
    await removeDownloaded();
    setProgress(null);
    setSavedTs(null);
    setPhase("idle");
  };

  // the book is one file of the total, streamed last — the bar mixes its bytes
  // in as a fraction so it never jumps the whole tail at once
  const frac = progress
    ? Math.min(
        1,
        (progress.filesDone +
          (progress.bookTotalBytes
            ? progress.bookBytes / progress.bookTotalBytes
            : 0)) /
          (progress.filesTotal + 1),
      )
    : 0;
  const onBook =
    progress !== null && progress.filesDone === progress.filesTotal;

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
        <div className="modal-body">
          {phase === "downloading" && (
            <>
              <div
                className="dlbar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(frac * 100)}
              >
                <div className="dlbar-fill" style={{ width: `${frac * 100}%` }} />
              </div>
              <div className="modal-summary">
                {progress
                  ? `Downloading… ${progress.filesDone}/${progress.filesTotal} files`
                  : "Preparing…"}
              </div>
              {onBook && (
                <div className="modal-summary">
                  {progress.bookTotalBytes
                    ? `book.pdf — ${mb(progress.bookBytes)} of ${mb(progress.bookTotalBytes)} MB`
                    : `book.pdf — ${mb(progress.bookBytes)} MB downloaded`}
                </div>
              )}
            </>
          )}
          {phase === "checking" && <div className="modal-summary">Checking…</div>}
          {phase === "idle" && (
            <div className="modal-summary">
              Download the whole course (≈75 MB — the book, all 115 units and 35
              additional exercises) to learn without internet.
            </div>
          )}
          {phase === "done" && (
            <div className="modal-summary">
              {`Downloaded for offline use${
                savedTs ? ` — ${new Date(savedTs).toLocaleString()}` : ""
              }`}
            </div>
          )}
          {phase === "error" && (
            <div className="modal-summary">
              {`Download failed at ${errorFile}. Finished parts are kept — press retry to resume.`}
            </div>
          )}
          <div className="modal-actions">
            {phase === "idle" && (
              <button className="themebtn primary" onClick={start}>
                <Download size={14} aria-hidden /> Download course
              </button>
            )}
            {phase === "done" && (
              <button className="themebtn" onClick={() => void remove()}>
                <Trash2 size={14} aria-hidden /> Remove downloaded files
              </button>
            )}
            {phase === "error" && (
              <button className="themebtn" onClick={start}>
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
