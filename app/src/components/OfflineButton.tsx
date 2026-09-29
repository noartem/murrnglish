// The download's two status surfaces, both driven by the store in ../offline.
// They are their own components on purpose: the progress ticks arrive a few
// hundred times over a download, and subscribing here re-renders a button —
// not the app around it.
//
// The fill is a --p percentage the CSS paints as a bottom-up green gradient, so
// the control simply gets greener as the course lands. Green is for a download
// the user watched happen: once the page is reloaded the button goes neutral
// again, cached course or not.

import type { CSSProperties } from "react";
import { Download } from "lucide-react";
import { downloadFraction, useDownload } from "../offline";

/** Percent of the course stored: 100 for a run that finished in this session,
    the bytes so far while one is running, 0 otherwise. */
function useFill(): {
  pct: number;
  active: boolean;
  failed: boolean;
  fresh: boolean;
  stored: boolean;
} {
  const s = useDownload();
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
 * Desktop topbar: the way into the offline panel, and the download's status —
 * green fills the icon square from the bottom up while the course streams in,
 * and stays full for a download of this session. A course cached on an earlier
 * launch leaves the button neutral.
 */
export function OfflineButton({ onOpen }: { onOpen: () => void }) {
  const { pct, active, fresh, stored } = useFill();
  const title = active
    ? `Offline — downloading ${pct}%`
    : stored
      ? "Offline — the course is downloaded"
      : "Offline — download the course";
  return (
    <button
      className={"themebtn dlbtn" + (active ? " running" : fresh ? " done" : "")}
      style={{ "--p": `${pct}%` } as CSSProperties}
      onClick={onOpen}
      title={title}
      aria-label="Offline: download the course"
    >
      <Download size={15} aria-hidden />
    </button>
  );
}

/**
 * Phone topbar: the download button sits in the drawer, behind the hamburger,
 * so a run in flight shows up as a chip beside the title instead. A failed run
 * keeps the chip — that is the one state the user has to act on; a finished
 * one drops it. Tapping either opens the panel.
 */
export function OfflineChip({ onOpen }: { onOpen: () => void }) {
  const { pct, active, failed } = useFill();
  if (!active && !failed) return null;
  return (
    <button
      className={"dlchip" + (failed ? " failed" : "")}
      style={{ "--p": `${pct}%` } as CSSProperties}
      onClick={onOpen}
      title={failed ? "Offline — download failed, open for details" : `Offline — downloading ${pct}%`}
      aria-label="Offline: download the course"
    >
      <Download size={14} aria-hidden />
      <span className="dlchip-pct">{failed ? "Retry" : `${pct}%`}</span>
    </button>
  );
}
