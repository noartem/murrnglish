// Keyboard-shortcuts help: the topbar button (native title tooltip, like
// ThemeToggle) and the help modal. Esc/backdrop close is handled centrally
// in useCourseShortcuts (helpOpen state lives in App); the backdrop click
// is the only local handler here.

import { Fragment, useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { HelpEntry } from "../shortcuts";
import { SC, SHORTCUT_HELP } from "../shortcuts";

export function ShortcutsHelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="helpbtn"
      onClick={onOpen}
      title={"Keyboard shortcuts — " + SC.help}
      aria-label="Keyboard shortcuts"
    >
      <Keyboard size={15} strokeWidth={1.6} aria-hidden />
    </button>
  );
}

export function ShortcutsModal({
  onClose,
  entries = SHORTCUT_HELP,
}: {
  onClose: () => void;
  /** the course's keys by default; the study screen passes its own */
  entries?: HelpEntry[];
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Focus the scroll container, not the close button: the browser's default
  // action for arrows/PgUp/PgDn/Home/End then scrolls it, and the central
  // dispatcher deliberately
  // doesn't preventDefault those keys while the help is open.
  useEffect(() => {
    const vp = document.querySelector<HTMLElement>(
      ".helpcard [data-overlayscrollbars-viewport]",
    );
    if (vp) {
      vp.focus({ preventScroll: true });
    } else {
      closeRef.current?.focus();
    }
  }, []);
  const [scrolled, setScrolled] = useState(false);
  return (
    <div className="helpoverlay" onClick={onClose}>
      <div
        className={"helpcard" + (scrolled ? " scrolled" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="helpcardhead">
        <h3>Keyboard shortcuts</h3>
        <button
          className="helpclose"
          ref={closeRef}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <OverlayScrollbarsComponent
        className="helpscroll"
        options={{
          overflow: { x: "hidden" as const },
          scrollbars: {
            theme: "os-theme-dark",
            autoHide: "leave" as const,
            autoHideDelay: 500,
          },
        }}
          events={{
            scroll: (_instance, event) => {
              const target = event.target as HTMLElement;
              setScrolled(target.scrollTop > 0);
            },
          }}
      >
      {entries.map((entry) => (
        <section className="helpentry" key={entry.title}>
          <div className="helpentryhead">
            <span className="keychips">
              <KeyChips combo={entry.keys} />
            </span>{" "}
            <strong>{entry.title}</strong>
          </div>
          <p>{entry.desc}</p>
          {entry.sub && (
            <ul>
              {entry.sub.map((s) => (
                <li key={s.desc}>
                  <span className="keychips">
                    <KeyChips combo={s.keys} />
                    {s.alt && (
                      <>
                        <span className="keysep">/</span>
                        <KeyChips combo={s.alt} />
                      </>
                    )}
                  </span>{" "}
                  {"\u2014"} {s.desc}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      </OverlayScrollbarsComponent>
      </div>
    </div>
  );
}

// one combo = separate key chips joined by "+"; a token may hold "/"
// alternatives (["↑ / ↓"]) — those render as chips joined by "/"
function KeyChips({ combo }: { combo: string[] }) {
  return (
    <>
      {combo.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="keyplus">+</span>}
          {k.split("/").map((key, j) => (
            <Fragment key={j}>
              {j > 0 && <span className="keysep">/</span>}
              <kbd>{key.trim()}</kbd>
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}
