// Keyboard-shortcuts help: the topbar button (native title tooltip, like
// ThemeToggle) and the help modal. Esc/backdrop close is handled centrally
// in useCourseShortcuts (helpOpen state lives in App); the backdrop click
// is the only local handler here.

import { Fragment, useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";
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

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div className="helpoverlay" onClick={onClose}>
      <div
        className="helpcard"
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
        {SHORTCUT_HELP.map((entry) => (
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
      </div>
    </div>
  );
}

// one combo = separate key chips joined by "+"
function KeyChips({ combo }: { combo: string[] }) {
  return (
    <>
      {combo.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="keyplus">+</span>}
          <kbd>{k}</kbd>
        </Fragment>
      ))}
    </>
  );
}
