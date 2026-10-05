// The dictionary (#/dictionary): the learner's saved words. One field both
// filters the list and adds a word (Enter, or the button, opens the editor
// with it looked up). Each row shows the word, its translation and where its
// cards stand; a row opens the editor. Words are also added straight from the
// exercises and the rules by selecting them (PickWord).
//
// Below them, the vocabulary decks (deckdata.ts): each one opens into its
// list, and the search looks through them too — an entry found there can be
// added to the learner's own words. #/dictionary/<deck> opens with that deck
// unfolded.

import { useEffect, useMemo, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ChevronRight, Layers, Plus, Search, Volume2 } from "lucide-react";
import { BOOKS } from "../books";
import type { Deck, DeckEntry, DeckSection } from "../deckdata";
import { entryText, gapsOf, useDecks } from "../deckdata";
import { speak } from "../lookup";
import { deckHash } from "../routes";
import type { CardState } from "../srs";
import { dayNumber, formatDays } from "../srs";
import { srsConfig, useStudy } from "../study";
import { useMinuteClock } from "../dueCount";
import type { Word } from "../words";
import { headwordKey, wordCardIds } from "../words";
import { LevelChip } from "./CardsView";
import { SectionShell } from "./SectionBar";
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

export function DictionaryView({ deck: openDeck }: { deck?: string }) {
  const { words, srs } = useStudy();
  const { lib } = useDecks();
  const vocabulary = lib?.sections.find((s) => s.id === "vocabulary");
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
    <SectionShell section="dictionary">
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

            {key && vocabulary && <DeckHits section={vocabulary} q={key} />}

            {vocabulary && <DeckShelf section={vocabulary} open={openDeck} />}
          </div>
      </OverlayScrollbarsComponent>
    </SectionShell>
  );
}

/** The English of an entry as a list shows it: the forms, or the words of the gaps in bold. */
export function EntryEn({ e }: { e: DeckEntry }) {
  if (e.forms)
    return (
      <>
        <strong>{e.en}</strong> · {e.forms.join(" · ")}
      </>
    );
  if (e.choice) return <strong>{entryText(e)}</strong>;
  if (e.en?.includes("[")) {
    const { parts, gaps } = gapsOf(e.en);
    return (
      <>
        {parts.map((p, i) => (
          <span key={i}>
            {p}
            {i < gaps.length && <strong>{gaps[i].answers.join("/")}</strong>}
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      <strong>{e.en}</strong>
      {e.alt?.length ? <span className="muted"> · {e.alt.join(", ")}</span> : null}
    </>
  );
}

/** Deck entries matching the search; a row adds the entry to the learner's words. */
function DeckHits({ section, q }: { section: DeckSection; q: string }) {
  const hits = useMemo(() => {
    const out: { deck: Deck; e: DeckEntry }[] = [];
    for (const g of section.groups)
      for (const deck of g.decks)
        for (const e of deck.entries) {
          const en = headwordKey(entryText(e));
          const ru = (e.ru ?? "").toLowerCase();
          if (en.includes(q) || ru.includes(q) || e.alt?.some((a) => headwordKey(a).includes(q))) out.push({ deck, e });
        }
    return out;
  }, [section, q]);
  if (!hits.length) return null;
  return (
    <section className="sheet packhits">
      <h3 className="sheethead">In the vocabulary decks</h3>
      <ul className="packentries">
        {hits.slice(0, 40).map(({ deck, e }) => (
          <li key={`${deck.id}:${e.id}`}>
            <span className="packen">
              <EntryEn e={e} />
            </span>
            <span className="packru" lang="ru">
              {e.ru}
            </span>
            <span className="wordfrom">{deck.title}</span>
            <button
              type="button"
              className="iconlink"
              title="Add to my words"
              aria-label={`Add ${entryText(e)} to my words`}
              onClick={() => openWordEditor({ word: entryText(e), context: e.ex })}
            >
              <Plus size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {hits.length > 40 && <p className="rulesnote">{hits.length - 40} more — type a few more letters.</p>}
    </section>
  );
}

/** The vocabulary decks by group, each unfolding into its list. */
function DeckShelf({ section, open }: { section: DeckSection; open?: string }) {
  const openRef = useRef<HTMLDetailsElement>(null);
  // arriving from the deck list or a card: the deck in view
  useEffect(() => {
    openRef.current?.scrollIntoView({ block: "start" });
  }, [open]);
  return (
    <>
      {section.groups.map((g) => (
        <section key={g.title} className="sheet packshelf">
          <p className="libkicker">{section.title}</p>
          <h3 className="sheethead">{g.title}</h3>
          {g.decks.map((d) => {
            const isOpen = open === d.id;
            return (
              <details key={d.id} className="deckgroup packfold" open={isOpen} ref={isOpen ? openRef : undefined}>
                <summary>
                  <ChevronRight size={16} className="chev" aria-hidden />
                  <span className="deckinfo">
                    <span className="deckname">
                      {d.title}
                      <LevelChip level={d.level} />
                    </span>
                    <span className="packabout">
                      {d.entries.length} words · {d.about}
                    </span>
                  </span>
                  <a
                    className="pillbtn small"
                    href={deckHash({ kind: "deck", id: d.id })}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Study
                  </a>
                </summary>
                <ul className="packentries">
                  {d.entries.map((e) => (
                    <li key={e.id}>
                      <span className="packen">
                        <EntryEn e={e} />
                      </span>
                      <span className="packru" lang="ru">
                        {e.ru}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </section>
      ))}
    </>
  );
}
