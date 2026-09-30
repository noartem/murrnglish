// The dictionary (#/dictionary): the learner's saved words. One field both
// filters the list and adds a word (Enter, or the button, opens the editor
// with it looked up). Each row shows the word, its translation and where its
// cards stand; a row opens the editor. Words are also added straight from the
// exercises and the rules by selecting them (PickWord).

import { useMemo, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Layers, Plus, Search, Volume2 } from "lucide-react";
import { BOOKS } from "../books";
import { speak } from "../lookup";
import { deckHash } from "../routes";
import type { CardState } from "../srs";
import { dayNumber, formatDays } from "../srs";
import { srsConfig, useStudy } from "../study";
import { useMinuteClock } from "../dueCount";
import type { Word } from "../words";
import { headwordKey, wordCardIds } from "../words";
import { BackupControls } from "./BackupControls";
import { SectionBar } from "./SectionBar";
import { openWordEditor } from "./WordEditor";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

/** Where a word's cards stand, as one short label. */
function wordStatus(
  w: Word,
  states: Readonly<Record<string, CardState>>,
  suspended: ReadonlySet<string>,
  now: number,
): { text: string; tone: "new" | "learn" | "due" | "later" | "off" } {
  const ids = wordCardIds(w).filter((id) => !suspended.has(id));
  if (!ids.length) return { text: "suspended", tone: "off" };
  const ss = ids.map((id) => states[id]);
  if (ss.every((s) => !s)) return { text: "new", tone: "new" };
  if (ss.some((s) => s && s.kind !== "review")) return { text: "learning", tone: "learn" };
  const cfg = srsConfig();
  const today = dayNumber(now, cfg);
  // the soonest card decides; a card never answered is due now
  const next = Math.min(...ss.map((s) => (s ? dayNumber(s.due, cfg) : today)));
  if (next <= today) return { text: "due", tone: "due" };
  return { text: `in ${formatDays(next - today)}`, tone: "later" };
}

export function DictionaryView() {
  const { words, srs } = useStudy();
  const [q, setQ] = useState("");
  const now = useMinuteClock();
  const suspended = useMemo(() => new Set(srs.suspended), [srs.suspended]);
  const key = headwordKey(q);
  const list = useMemo(() => {
    const sorted = [...words].sort((a, b) => b.added - a.added);
    if (!key) return sorted;
    return sorted.filter(
      (w) => headwordKey(w.word).includes(key) || w.translation.toLowerCase().includes(key) || w.notes.toLowerCase().includes(key),
    );
  }, [words, key]);
  const exact = words.find((w) => headwordKey(w.word) === key);

  function add() {
    if (exact) openWordEditor({ id: exact.id });
    else openWordEditor({ word: q.trim() });
  }

  return (
    <div className="app">
      <SectionBar section="dictionary" />
      <div className="main">
        <OverlayScrollbarsComponent element="main" className="home deskpane" options={OS_OPTIONS}>
          <div className="deskcol">
            <form
              className="sheet addbar"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <label className="searchbox grow">
                <Search size={16} aria-hidden />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find or add a word…"
                  aria-label="Find or add a word"
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </label>
              <button type="submit" className="homecta small" disabled={!q.trim()}>
                <Plus size={17} aria-hidden /> {exact ? "Open" : "Add"}
              </button>
            </form>

            <div className="dicthead">
              <p className="modal-summary">
                {words.length
                  ? `${words.length} word${words.length === 1 ? "" : "s"}${key ? ` · ${list.length} shown` : ""}`
                  : ""}
              </p>
              {words.length > 0 && (
                <a className="pillbtn" href={deckHash({ kind: "words" })}>
                  <Layers size={15} aria-hidden /> Study my words
                </a>
              )}
            </div>

            {words.length === 0 ? (
              <div className="sheet emptysheet">
                <h2 className="unitheading">Your words</h2>
                <p className="ruleprose">
                  Type a word above and press <kbd>Enter</kbd>: the dictionary looks up its Russian translation,
                  definitions and pronunciation, and you can change anything before saving.
                </p>
                <p className="ruleprose">
                  In an exercise or a rule, select a word with the mouse (or a long press on a phone) and use the{" "}
                  <strong>Add</strong> button that appears under it — the sentence comes along as an example.
                </p>
                <p className="ruleprose muted">
                  Every saved word becomes flash cards: word → translation, and back again if you like.
                </p>
              </div>
            ) : list.length === 0 ? (
              <p className="rulesnote">
                No saved word matches. Press <kbd>Enter</kbd> to add “{q.trim()}”.
              </p>
            ) : (
              <ul className="wordlist sheet">
                {list.map((w) => {
                  const st = wordStatus(w, srs.states, suspended, now);
                  const from = w.source && BOOKS.find((b) => b.id === w.source!.book);
                  return (
                    <li key={w.id} className="wordrow">
                      <button
                        type="button"
                        className="wordspeak"
                        onClick={() => void speak(w.word, w.audio)}
                        aria-label={`Listen: ${w.word}`}
                      >
                        <Volume2 size={15} aria-hidden />
                      </button>
                      <button type="button" className="wordopen" onClick={() => openWordEditor({ id: w.id })}>
                        <span className="wordhead">
                          <strong>{w.word}</strong>
                          {w.ipa && <span className="ipa">{w.ipa}</span>}
                        </span>
                        <span className="wordtrans" lang="ru">
                          {w.translation || <em className="muted">no translation</em>}
                        </span>
                        {from && (
                          <span className="wordfrom">
                            <span className="libdot" style={{ background: from.color }} aria-hidden />
                            {w.source!.unit ? `Unit ${w.source!.unit}` : from.level}
                          </span>
                        )}
                      </button>
                      <span className={`statepill ${st.tone}`}>{st.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            <section className="sheet backupsheet">
              <h3 className="sheethead">Backup</h3>
              <p className="ruleprose muted">
                Your words and your card reviews are kept in this browser only. Export a backup now and then, and
                import it on another device — importing merges, nothing is overwritten.
              </p>
              <BackupControls />
            </section>
          </div>
        </OverlayScrollbarsComponent>
      </div>
    </div>
  );
}
