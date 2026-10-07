// The downloads' two status surfaces, both driven by the store in ../offline.
// Inside a book they follow that book's download; in the library (no book)
// whichever download is running, or failed, or just finished.
// They are their own components on purpose: the progress ticks arrive a few
// hundred times over a download, and subscribing here re-renders a button —
// not the app around it.
//
// The fill is a --p percentage the CSS paints as a bottom-up green gradient, so
// the control simply gets greener as the book lands. Green is for a download
// the user watched happen: once the page is reloaded the button goes neutral
// again, cached course or not.

import type { CSSProperties } from "react";
import { Download } from "lucide-react";
import type { DownloadState } from "../offline";
import { downloadFraction, useDownloads } from "../offline";

/** Percent of the book stored: 100 for a run that finished in this session,
    the bytes so far while one is running, 0 otherwise. */
function useFill(bookId?: string): {
  pct: number;
  active: boolean;
  failed: boolean;
  fresh: boolean;
  stored: boolean;
} {
  const all = useDownloads();
  const list = Object.values(all);
  const s: DownloadState | undefined = bookId
    ? all[bookId]
    : (list.find((x) => x.active) ?? list.find((x) => x.failed) ?? list.find((x) => x.fresh));
  if (!s) {
    return { pct: 0, active: false, failed: false, fresh: false, stored: list.some((x) => x.ts !== null) };
  }
  const frac = s.progress ? downloadFraction(s.progress) : null;
  return {
    // an unknown total (no HEAD answer, book not started) is an empty fill
    pct: s.fresh ? 100 : frac === null ? 0 : Math.round(frac * 100),
    active: s.active,
    failed: s.failed,
    fresh: s.fresh,
    stored: s.ts !== null,
  };
}

/**
 * The download control: the way into the offline panel, and the download's
 * status — green fills the button from the bottom up while the book streams
 * in, and stays full for a download of this session. A book cached on an
 * earlier launch leaves the button neutral. It is a tile in the panel and a
 * plain button in the header, which is where a desktop keeps it.
 */
export function OfflineButton({
  bookId,
  onOpen,
  variant = "tile",
}: {
  bookId?: string;
  onOpen: () => void;
  variant?: "tile" | "bar";
}) {
  const { pct, active, fresh, stored } = useFill(bookId);
  const title = active
    ? `Offline — downloading ${pct}%`
    : !bookId
      ? "Offline — download books"
      : stored
        ? "Offline — the book is downloaded"
        : "Offline — download the book";
  return (
    <button
      className={
        (variant === "bar" ? "themebtn dlbtn" : "navtile dlbtn") +
        (active ? " running" : fresh ? " done" : "")
      }
      style={{ "--p": `${pct}%` } as CSSProperties}
      onClick={onOpen}
      title={title}
      aria-label={title}
    >
      <Download size={15} aria-hidden />
      {variant === "bar" ? null : <span className="navtoollabel">Download</span>}
    </button>
  );
}

/**
 * Phone topbar: the download button sits in the drawer, behind the hamburger,
 * so a run in flight shows up as a chip beside the title instead. A failed run
 * keeps the chip — that is the one state the user has to act on; a finished
 * one drops it. Tapping either opens the panel.
 */
export function OfflineChip({ bookId, onOpen }: { bookId?: string; onOpen: () => void }) {
  const { pct, active, failed } = useFill(bookId);
  if (!active && !failed) return null;
  return (
    <button
      className={"dlchip" + (failed ? " failed" : "")}
      style={{ "--p": `${pct}%` } as CSSProperties}
      onClick={onOpen}
      title={failed ? "Offline — download failed, open for details" : `Offline — downloading ${pct}%`}
      aria-label="Offline: download books"
    >
      <Download size={14} aria-hidden />
      <span className="dlchip-pct">{failed ? "Retry" : `${pct}%`}</span>
    </button>
  );
}
