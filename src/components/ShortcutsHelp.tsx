// Keyboard-shortcuts help: the topbar button (native title tooltip, like
// ThemeToggle) and the help window. Esc and the backdrop close it — Esc in
// the central dispatcher, the backdrop click here. The window itself is
// mounted by App off globalUi.ts, so it opens from every view.

import { Fragment, useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { HelpSection } from "../shortcuts";
import { HELP_SECTIONS, SC } from "../shortcuts";
import { takeHelpJump } from "./SearchModal";

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
  entries = HELP_SECTIONS,
}: {
  onClose: () => void;
  /** the whole app's keys by default */
  entries?: HelpSection[];
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
  const [at, setAt] = useState(entries[0]?.title ?? "");
  // the section in view drives the rail, and the rail drives the scroll: a
  // click jumps, a scroll marks. Both land on the same state, so they cannot
  // disagree.
  const jumpTo = (title: string) => {
    setAt(title);
    document.getElementById(sectionId(title))?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  // the search opens this window on one of its groups. The window does not
  // exist when the search sends the request, so the target waits in a slot
  // that this mount reads once.
  useEffect(() => {
    const title = takeHelpJump();
    if (title) jumpTo(title);
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
          <button className="helpclose" ref={closeRef} onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className="helpbody">
          {/* the rail: one row per group, the current one marked. On a phone
              it becomes a row of tabs above the list. */}
          <nav className="helprail" aria-label="Shortcut groups">
            {entries.map((s) => (
              <button
                key={s.title}
                className={"helplink" + (s.title === at ? " on" : "")}
                onClick={() => jumpTo(s.title)}
                aria-current={s.title === at ? "true" : undefined}
              >
                {s.title}
              </button>
            ))}
          </nav>
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
                setAt(nearestSection(event.target as HTMLElement, entries));
              },
            }}
          >
            {entries.map((section) => (
              <section key={section.title} id={sectionId(section.title)}>
                <h4 className="helpsection">{section.title}</h4>
                <div className="helpentries">
                  {section.entries.map((entry) => (
                    <div className="helpentry" key={entry.title}>
                      <div className="helpentryhead">
                        <span className="keychips">
                          <KeyChips combo={entry.keys} />
                        </span>{" "}
                        {entry.alt && (
                          <>
                            <span className="keysep">/</span>
                            <KeyChips combo={entry.alt} />
                          </>
                        )}
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
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </OverlayScrollbarsComponent>
        </div>
      </div>
    </div>
  );
}

/** The DOM id a group scrolls to. Titles are unique in HELP_SECTIONS. */
function sectionId(title: string): string {
  return "help-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** The group whose heading is last above the top of the scrolled list. */
function nearestSection(vp: HTMLElement, sections: HelpSection[]): string {
  const top = vp.getBoundingClientRect().top + 24;
  let found = sections[0]?.title ?? "";
  for (const s of sections) {
    const el = document.getElementById(sectionId(s.title));
    if (el && el.getBoundingClientRect().top <= top) found = s.title;
  }
  return found;
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
