// Offline panel: the download window of the installed app. Structure copies
// ProgressModal (overlay + card + exit animation); the download itself lives in
// ../offline, so closing the panel never interrupts one that is in flight. The
// numbers come from that module's store, not from a per-panel subscription —
// the background start after install (App.tsx) runs one without this panel.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trash2, X } from "lucide-react";
import {
  downloadCourse,
  downloadFraction,
  downloadState,
  isDownloaded,
  removeDownloaded,
  useDownload,
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
  const [errorFile, setErrorFile] = useState("");
  const live = useDownload();
  const closeRef = useRef<HTMLButtonElement>(null);
  // exit: the card stays mounted under .closing while modal-out plays, then
  // drops from the DOM (same 150ms hunt as ProgressModal)
  const [shown, setShown] = useState(open);

  const onDone = useCallback(() => setPhase("done"), []);
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
    if (downloadState().active) {
      setPhase("downloading");
      downloadCourse().then(onDone, onFail); // rejoin, don't restart
      return;
    }
    setPhase("checking");
    let alive = true;
    isDownloaded().then((yes) => {
      if (alive) setPhase(yes ? "done" : "idle");
    });
    return () => {
      alive = false;
    };
  }, [open, onDone, onFail]);

  if (!shown) return null;
  const closing = !open;

  const start = () => {
    setErrorFile("");
    setPhase("downloading");
    downloadCourse().then(onDone, onFail);
  };

  const remove = async () => {
    await removeDownloaded();
    setPhase("idle");
  };

  // 0 while the total is unknown (a HEAD that never answered and the book not
  // started yet): the bar sits empty for that instant rather than guessing
  const p = live.progress;
  const frac = p ? (downloadFraction(p) ?? 0) : 0;

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
                {p && p.totalBytes > 0
                  ? `Downloading… ${mb(p.bytes)} of ${mb(p.totalBytes)} MB`
                  : "Preparing…"}
              </div>
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
                live.ts ? ` — ${new Date(live.ts).toLocaleString()}` : ""
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
