// The deck list (#/cards): what is due today, in every deck the learner can
// study — everything at once, their own words, each book, its groups and its
// units — with Anki's three numbers (new, learning, due) and a way into each.
// The study settings and the backup live here too.
//
// The unit decks are generated from each book's course (decks.ts), so the
// list waits for the books; a book that cannot load (offline, not downloaded)
// is named and left out.

import { useMemo } from "react";
import type { ReactNode } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { BookOpenText, ChevronRight, NotebookPen } from "lucide-react";
import { BOOKS } from "../books";
import type { BookCards } from "../decks";
import { deckIds, useBookCards } from "../decks";
import type { DeckRef } from "../routes";
import { DICTIONARY_HASH, deckHash, rulesHash } from "../routes";
import type { DeckCounts as Counts } from "../srs";
import { deckCounts, todayDaily } from "../srs";
import type { StudySnapshot } from "../study";
import { resumeSuspended, saveSettings, srsConfig, useStudy } from "../study";
import { useMinuteClock } from "../dueCount";
import { BackupControls } from "./BackupControls";
import { SectionBar } from "./SectionBar";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

/** Counts of any deck, from the store — memoized by the caller. */
function counter(study: StudySnapshot, books: Record<string, BookCards>, now: number) {
  const cfg = srsConfig(study.settings);
  const suspended = new Set(study.srs.suspended);
  const daily = todayDaily(study.srs.daily, now, cfg);
  return (deck: DeckRef): Counts | null => {
    const ids = deckIds(deck, books, study.words, study.srs.states);
    if (!ids) return null;
    return deckCounts({ ids, states: study.srs.states, suspended, daily, now, cfg });
  };
}

export function CardsView() {
  const study = useStudy();
  const now = useMinuteClock();
  const { books, failed, loading } = useBookCards(BOOKS);
  const count = useMemo(() => counter(study, books, now), [study, books, now]);
  const all = count({ kind: "all" })!;
  const words = count({ kind: "words" })!;
  const allDue = all.fresh + all.learn + all.review;

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
                Everything due: your words, and the cards of every unit you have started — finished in the course
                or studied here. Cards of units you have not reached wait in their book’s deck below.
              </p>
              {failed.length > 0 && (
                <p className="lookupstatus warn">
                  Not available offline: {failed.map((b) => b.title).join(", ")}. Open the book online or download
                  it to study its cards.
                </p>
              )}
            </section>

            <DeckRow
              title="My words"
              icon={<NotebookPen size={18} aria-hidden />}
              c={words}
              href={deckHash({ kind: "words" })}
              extra={
                <a className="linkbtn" href={DICTIONARY_HASH}>
                  {study.words.length ? `${study.words.length} in the dictionary` : "Add words in the dictionary"}
                </a>
              }
              sheet
            />

            {BOOKS.map((b) => {
              const bc = books[b.id];
              const c = count({ kind: "book", book: b });
              return (
                <section key={b.id} className="sheet booksheet">
                  <DeckRow
                    title={b.title}
                    icon={<span className="libdot" style={{ background: b.color }} aria-hidden />}
                    kicker={`${b.level} · ${b.edition}`}
                    c={c}
                    href={deckHash({ kind: "book", book: b })}
                  />
                  {bc && <Groups bc={bc} count={count} />}
                  {!bc && <p className="rulesnote">{failed.includes(b) ? "Not available offline." : "Loading…"}</p>}
                </section>
              );
            })}

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

function Groups({ bc, count }: { bc: BookCards; count: (d: DeckRef) => Counts | null }) {
  const book = bc.book;
  return (
    <div className="deckgroups">
      {bc.index.groups.map((g, gi) => {
        const c = count({ kind: "group", book, group: gi + 1 });
        if (!c?.total) return null;
        return (
          <details key={g.name} className="deckgroup">
            <summary>
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
                const n = bc.byUnit.get(u)?.length ?? 0;
                const uc = count({ kind: "unit", book, unit: u });
                const title = bc.index.exercises[`u${u}`]?.title;
                return (
                  <li key={u} className="deckunit">
                    <span className="rulenum">{u}</span>
                    <span className="deckname">{title}</span>
                    <a className="iconlink" href={rulesHash(book, u)} title="The rule" aria-label={`Unit ${u}: the rule`}>
                      <BookOpenText size={15} aria-hidden />
                    </a>
                    {n ? (
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

function DeckRow({
  title,
  icon,
  kicker,
  c,
  href,
  extra,
  sheet = false,
}: {
  title: string;
  icon: ReactNode;
  kicker?: string;
  c: Counts | null;
  href: string;
  extra?: ReactNode;
  sheet?: boolean;
}) {
  const body = (
    <div className="deckrow">
      <span className="deckicon">{icon}</span>
      <div className="deckinfo">
        {kicker && <span className="libkicker">{kicker}</span>}
        <span className="decktitle">{title}</span>
        {extra}
      </div>
      {c && <CountsLine c={c} />}
      <a className={"pillbtn" + (c && c.fresh + c.learn + c.review ? " primary" : "")} href={href}>
        Study
      </a>
    </div>
  );
  return sheet ? <section className="sheet">{body}</section> : body;
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
        Type the answer on gap and sentence cards (the card is checked like an exercise)
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
