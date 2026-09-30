// The deck list (#/cards): what is due today, and every deck the learner can
// study — everything at once, their own words, each book, its groups, units
// and word packs — with Anki's three numbers (new, learning, due) and a way
// into each. It is also where daily study is chosen (selection.ts): a switch
// takes a whole book in or out, a tick takes in a unit, a group or a pack.
// Units and packs nobody ticked are in once started, so the ticks show that
// too. The study settings and the backup live here as well.
//
// The unit decks are generated from each book's course (decks.ts), so the
// list waits for the books; a book that cannot load (offline, not downloaded)
// is named and left out.

import { useEffect, useMemo, useRef } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { BookOpenText, ChevronRight, List, NotebookPen, Package } from "lucide-react";
import type { Book } from "../books";
import { BOOKS } from "../books";
import type { BookCards } from "../decks";
import { deckIds, startedPacks, startedUnits, useBookCards } from "../decks";
import type { Pack } from "../packs";
import { packUnitsLabel } from "../packs";
import type { DeckRef } from "../routes";
import { DICTIONARY_HASH, deckHash, dictionaryPackHash, rulesHash } from "../routes";
import type { Include } from "../selection";
import { WORDS_PICK, bookOn, packPick, picked, unitPick } from "../selection";
import type { DeckCounts as Counts } from "../srs";
import { deckCounts, todayDaily } from "../srs";
import type { StudySnapshot } from "../study";
import { resumeSuspended, saveSettings, setIncluded, srsConfig, useStudy } from "../study";
import { useMinuteClock } from "../dueCount";
import { BackupControls } from "./BackupControls";
import { SectionBar } from "./SectionBar";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

type Count = (d: DeckRef) => Counts | null;

/** Counts of any deck, from the store — memoized by the caller. */
function counter(study: StudySnapshot, books: Record<string, BookCards>, now: number): Count {
  const cfg = srsConfig(study.settings);
  const suspended = new Set(study.srs.suspended);
  const daily = todayDaily(study.srs.daily, now, cfg);
  return (deck: DeckRef): Counts | null => {
    const ids = deckIds(deck, books, study.words, study.srs.states, study.settings.include);
    if (!ids) return null;
    return deckCounts({ ids, states: study.srs.states, suspended, daily, now, cfg });
  };
}

export function CardsView() {
  const study = useStudy();
  const now = useMinuteClock();
  const { books, failed, loading } = useBookCards(BOOKS);
  const count = useMemo(() => counter(study, books, now), [study, books, now]);
  const include = study.settings.include;
  const all = count({ kind: "all" })!;
  const words = count({ kind: "words" })!;
  const allDue = all.fresh + all.learn + all.review;
  const wordsOn = include[WORDS_PICK] !== false;

  return (
    <div className="app">
      <SectionBar section="cards" />
      <div className="main">
        <OverlayScrollbarsComponent element="main" className="home deskpane" options={OS_OPTIONS}>
          <div className="deskcol">
            <section className="sheet todaysheet">
              <div className="todayrow">
                <div>
                  <h2 className="unitheading">Today</h2>
                  <CountsLine c={all} big />
                </div>
                {allDue > 0 ? (
                  <a className="homecta todaycta" href={deckHash({ kind: "all" })}>
                    Study now
                  </a>
                ) : (
                  <span className="donetag">{loading ? "Loading…" : "All done for today"}</span>
                )}
              </div>
              <p className="ruleprose muted">
                Daily study takes what is ticked below: your words, and in each book the units and word packs you
                tick. A unit you have started — finished in the course or studied here — is ticked for you until
                you untick it. Switch a book off to leave all of it out.
              </p>
              {failed.length > 0 && (
                <p className="lookupstatus warn">
                  Not available offline: {failed.map((b) => b.title).join(", ")}. Open the book online or download
                  it to study its cards.
                </p>
              )}
            </section>

            <section className={"sheet" + (wordsOn ? "" : " deckoff")}>
              <div className="deckrow">
                <PickBox
                  checked={wordsOn}
                  label="My words in daily study"
                  onChange={(v) => setIncluded({ [WORDS_PICK]: v ? null : false })}
                />
                <span className="deckicon">
                  <NotebookPen size={18} aria-hidden />
                </span>
                <div className="deckinfo">
                  <span className="decktitle">My words</span>
                  <a className="linkbtn" href={DICTIONARY_HASH}>
                    {study.words.length ? `${study.words.length} in the dictionary` : "Add words in the dictionary"}
                  </a>
                </div>
                <CountsLine c={words} />
                <StudyLink c={words} href={deckHash({ kind: "words" })} />
              </div>
            </section>

            {BOOKS.map((b) => (
              <BookSheet
                key={b.id}
                book={b}
                bc={books[b.id]}
                failed={failed.includes(b)}
                count={count}
                include={include}
                states={study.srs.states}
              />
            ))}

            <Settings />

            <section className="sheet backupsheet">
              <h3 className="sheethead">Backup</h3>
              <p className="ruleprose muted">
                Reviews and words are kept in this browser only. Export a backup now and then; importing merges it
                with what is here.
              </p>
              <BackupControls />
            </section>
          </div>
        </OverlayScrollbarsComponent>
      </div>
    </div>
  );
}

function BookSheet({
  book,
  bc,
  failed,
  count,
  include,
  states,
}: {
  book: Book;
  bc?: BookCards;
  failed: boolean;
  count: Count;
  include: Include;
  states: Readonly<Record<string, unknown>>;
}) {
  const on = bookOn(include, book.id);
  const c = count({ kind: "book", book });
  const started = useMemo(() => (bc ? startedUnits(bc, states) : new Set<number>()), [bc, states]);
  const packsStarted = useMemo(() => (bc ? startedPacks(bc, states) : new Set<string>()), [bc, states]);
  const unitOn = (u: number) => picked(include, unitPick(book.id, u), started.has(u));
  const packOn = (p: Pack) => picked(include, packPick(book.id, p.id), packsStarted.has(p.id));

  let summary = "";
  if (!on) summary = "Switched off: none of its cards are in daily study.";
  else if (bc) {
    const u = bc.order.filter(unitOn).length;
    const p = bc.packs.filter(packOn).length;
    summary = `In daily study: ${u} of ${bc.order.length} units` + (bc.packs.length ? `, ${p} of ${bc.packs.length} packs` : "");
  }

  // every unit of the book ticked / back to the started ones / none
  const setUnits = (v: boolean | null) =>
    bc && setIncluded(Object.fromEntries(bc.order.map((u) => [unitPick(book.id, u), v])));

  return (
    <section className={"sheet booksheet" + (on ? "" : " deckoff")}>
      <div className="deckrow">
        <Switch
          on={on}
          label={`${book.title} in daily study`}
          onChange={(v) => setIncluded({ [book.id]: v ? null : false })}
        />
        <span className="deckicon">
          <span className="libdot" style={{ background: book.color }} aria-hidden />
        </span>
        <div className="deckinfo">
          <span className="libkicker">
            {book.level} · {book.edition}
          </span>
          <span className="decktitle">{book.title}</span>
          {summary && <span className="decksummary">{summary}</span>}
        </div>
        {c && <CountsLine c={c} />}
        <StudyLink c={c} href={deckHash({ kind: "book", book })} />
      </div>
      {!bc && <p className="rulesnote">{failed ? "Not available offline." : "Loading…"}</p>}
      {bc && on && (
        <>
          {bc.packs.length > 0 && (
            <>
              <div className="decksub">
                <h4>Word packs</h4>
              </div>
              <ul className="packrows">
                {bc.packs.map((p) => {
                  const pc = count({ kind: "pack", book, pack: p.id });
                  const ticked = packOn(p);
                  return (
                    <li key={p.id} className="packrow">
                      <PickBox
                        checked={ticked}
                        label={`${p.title} in daily study`}
                        onChange={(v) => setIncluded({ [packPick(book.id, p.id)]: v })}
                      />
                      <span className="deckicon">
                        <Package size={17} aria-hidden />
                      </span>
                      <div className="deckinfo">
                        <span className="deckname">{p.title}</span>
                        <span className="packabout">
                          {p.entries.length} words
                          {packUnitsLabel(p) && ` · ${packUnitsLabel(p)}`} · {p.about}
                        </span>
                      </div>
                      <a
                        className="iconlink"
                        href={dictionaryPackHash(book, p.id)}
                        title="The words"
                        aria-label={`${p.title}: the words`}
                      >
                        <List size={16} aria-hidden />
                      </a>
                      {pc && <CountsLine c={pc} />}
                      <a className="pillbtn small" href={deckHash({ kind: "pack", book, pack: p.id })}>
                        Study
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="decksub">
            <h4>Units</h4>
            <span className="decksubacts" role="group" aria-label={`Tick units of ${book.title}`}>
              <button type="button" className="linkbtn" onClick={() => setUnits(true)}>
                All
              </button>
              <button type="button" className="linkbtn" onClick={() => setUnits(null)} title="Only the units you have started">
                Started
              </button>
              <button type="button" className="linkbtn" onClick={() => setUnits(false)}>
                None
              </button>
            </span>
          </div>
          <Groups bc={bc} count={count} unitOn={unitOn} />
        </>
      )}
    </section>
  );
}

function Groups({ bc, count, unitOn }: { bc: BookCards; count: Count; unitOn: (u: number) => boolean }) {
  const book = bc.book;
  return (
    <div className="deckgroups">
      {bc.index.groups.map((g, gi) => {
        const c = count({ kind: "group", book, group: gi + 1 });
        if (!c?.total) return null;
        const withCards = g.units.filter((u) => bc.byUnit.get(u)?.length);
        const n = withCards.filter(unitOn).length;
        return (
          <details key={g.name} className="deckgroup">
            <summary>
              <PickBox
                checked={n > 0 && n === withCards.length}
                mixed={n > 0 && n < withCards.length}
                label={`${g.name} in daily study`}
                onChange={(v) => setIncluded(Object.fromEntries(withCards.map((u) => [unitPick(book.id, u), v])))}
              />
              <ChevronRight size={16} className="chev" aria-hidden />
              <span className="deckname">{g.name}</span>
              {c && <CountsLine c={c} />}
              <a
                className="pillbtn small"
                href={deckHash({ kind: "group", book, group: gi + 1 })}
                onClick={(e) => e.stopPropagation()}
              >
                Study
              </a>
            </summary>
            <ul className="deckunits">
              {g.units.map((u) => {
                const cards = bc.byUnit.get(u)?.length ?? 0;
                const uc = count({ kind: "unit", book, unit: u });
                const title = bc.index.exercises[`u${u}`]?.title;
                return (
                  <li key={u} className="deckunit">
                    {cards ? (
                      <PickBox
                        checked={unitOn(u)}
                        label={`Unit ${u} in daily study`}
                        onChange={(v) => setIncluded({ [unitPick(book.id, u)]: v })}
                      />
                    ) : (
                      <span className="pickspace" aria-hidden />
                    )}
                    <span className="rulenum">{u}</span>
                    <span className="deckname">{title}</span>
                    <a className="iconlink" href={rulesHash(book, u)} title="The rule" aria-label={`Unit ${u}: the rule`}>
                      <BookOpenText size={15} aria-hidden />
                    </a>
                    {cards ? (
                      <>
                        {uc && <CountsLine c={uc} />}
                        <a className="pillbtn small" href={deckHash({ kind: "unit", book, unit: u })}>
                          Study
                        </a>
                      </>
                    ) : (
                      <span className="nocards" title="Its exercises need the pictures of the printed page">
                        no cards
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function StudyLink({ c, href }: { c: Counts | null; href: string }) {
  return (
    <a className={"pillbtn" + (c && c.fresh + c.learn + c.review ? " primary" : "")} href={href}>
      Study
    </a>
  );
}

/** A tick for daily study; `mixed` shows a group with only some units ticked. */
function PickBox({
  checked,
  mixed = false,
  label,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="pickbox"
      checked={checked}
      aria-label={label}
      title={checked ? "In daily study — untick to leave it out" : "Not in daily study — tick to add it"}
      // a mixed group becomes all ticked
      onChange={() => onChange(mixed ? true : !checked)}
    />
  );
}

/** The switch that takes a whole book in or out of daily study. */
function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? "Switch the book off: none of its cards in daily study" : "Switch the book on"}
      className={"bookswitch" + (on ? " on" : "")}
      onClick={() => onChange(!on)}
    >
      <span className="knob" aria-hidden />
    </button>
  );
}

/** Anki's three numbers: new (blue), learning (red), due (green); zeros fade. */
export function CountsLine({ c, big = false, at }: { c: Counts; big?: boolean; at?: "fresh" | "learn" | "review" }) {
  const n = (k: "fresh" | "learn" | "review", label: string) => (
    <span className={`count ${k}` + (c[k] ? "" : " zero") + (at === k ? " at" : "")} title={`${c[k]} ${label}`}>
      {c[k]}
      {big && <small>{label}</small>}
    </span>
  );
  return (
    <span className={"counts" + (big ? " big" : "")}>
      {n("fresh", "new")}
      {n("learn", "learning")}
      {n("review", "due")}
    </span>
  );
}

function Settings() {
  const { settings, srs } = useStudy();
  const suspended = srs.suspended.length;
  const num = (k: "newPerDay" | "reviewsPerDay", label: string, hint: string) => (
    <label className="setting">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <input
        type="number"
        min={0}
        max={9999}
        className="wfull numinput"
        value={settings[k]}
        onChange={(e) => saveSettings({ ...settings, [k]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <details className="sheet settingsheet">
      <summary className="sheethead">
        <ChevronRight size={16} className="chev" aria-hidden /> Settings
      </summary>
      {num("newPerDay", "New cards a day", "cards seen for the first time, across all decks")}
      {num("reviewsPerDay", "Reviews a day", "the most review cards shown in one day")}
      <label className="modal-opt">
        <input
          type="checkbox"
          checked={settings.typeAnswers}
          onChange={(e) => saveSettings({ ...settings, typeAnswers: e.target.checked })}
        />
        Type the answer on gap, sentence and pack cards (the card is checked like an exercise)
      </label>
      {suspended > 0 && (
        <p className="setting">
          <span>
            {suspended} suspended card{suspended === 1 ? "" : "s"}
            <small>cards you asked never to see again</small>
          </span>
          <button type="button" className="pillbtn" onClick={() => resumeSuspended()}>
            Resume all
          </button>
        </p>
      )}
      <p className="ruleprose muted">
        Scheduling follows Anki’s SM-2: new cards step through 1 and 10 minutes, then come back after a day and
        at growing intervals; a day starts at 4 a.m.
      </p>
    </details>
  );
}
