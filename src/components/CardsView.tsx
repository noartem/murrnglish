// The deck list (#/cards): what is due today, and every deck the learner can
// study — everything at once, their own words, and the app's decks by
// section (grammar, vocabulary) and group — with Anki's three numbers (new,
// learning, due) and a way into each. It is also where daily study is chosen
// (selection.ts): a tick takes a deck in or out, a group's tick all of its
// decks. Decks nobody ticked are in once started, so the ticks show that too.
// Every deck opens into its cards as well (DeckBrowser.tsx).
// The study settings and the backup live here as well.

import type { RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ChevronRight, List, NotebookPen, Rows3 } from "lucide-react";
import type { Deck, DeckGroup, DeckLibrary, DeckSection } from "../deckdata";
import { LEVEL_NAMES, useDecks } from "../deckdata";
import { deckIds, startedDecks } from "../decks";
import { LIMIT_PRESETS, presetOf, reviewsTooFew } from "../limits";
import type { DeckRef } from "../routes";
import { DICTIONARY_HASH, browseHash, deckHash, dictionaryDeckHash } from "../routes";
import { WORDS_PICK, picked } from "../selection";
import type { DeckCounts as Counts } from "../srs";
import { deckCounts, todayDaily } from "../srs";
import type { StudySnapshot } from "../study";
import { resumeSuspended, saveSettings, setIncluded, srsConfig, useStudy } from "../study";
import { useMinuteClock } from "../dueCount";
import { SectionBar } from "./SectionBar";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

type Count = (d: DeckRef) => Counts | null;

/** Counts of any deck, from the store — memoized by the caller. */
function counter(study: StudySnapshot, lib: DeckLibrary | null, now: number): Count {
  const cfg = srsConfig(study.settings);
  const suspended = new Set(study.srs.suspended);
  const daily = todayDaily(study.srs.daily, now, cfg);
  return (deck: DeckRef): Counts | null => {
    const ids = deckIds(deck, lib, study.words, study.srs.states, study.settings.include);
    if (!ids) return null;
    return deckCounts({ ids, states: study.srs.states, suspended, daily, now, cfg });
  };
}

export function CardsView() {
  const study = useStudy();
  const now = useMinuteClock();
  const { lib, failed } = useDecks();
  const count = useMemo(() => counter(study, lib, now), [study, lib, now]);
  const include = study.settings.include;
  const started = useMemo(() => startedDecks(study.srs.states), [study.srs.states]);
  const deckOn = (d: Deck) => picked(include, d.id, started.has(d.id));
  // faded: taken out by hand, not merely not started yet
  const deckOff = (d: Deck) => include[d.id] === false;
  const all = count({ kind: "all" });
  const words = count({ kind: "words" })!;
  const allDue = all ? all.fresh + all.learn + all.review : 0;
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
                  <CountsLine c={all ?? words} big />
                </div>
                {allDue > 0 ? (
                  <a className="homecta todaycta" href={deckHash({ kind: "all" })}>
                    Study now
                  </a>
                ) : (
                  <span className="donetag">{!lib && !failed ? "Loading…" : "All done for today"}</span>
                )}
              </div>
              <p className="ruleprose muted">
                Daily study takes what is ticked below: your words and the decks you tick. A deck you have
                studied is ticked for you until you untick it — so opening a deck and pressing Study is all it
                takes to start.
              </p>
              {failed && (
                <p className="lookupstatus warn">
                  The decks could not be loaded. Are you offline? Open this page online once and they stay
                  available offline.
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

            {lib ? (
              lib.sections.map((s) => <SectionSheet key={s.id} section={s} count={count} deckOn={deckOn} deckOff={deckOff} />)
            ) : (
              !failed && <p className="rulesnote">Loading the decks…</p>
            )}

            <Settings />

          </div>
        </OverlayScrollbarsComponent>
      </div>
    </div>
  );
}

function SectionSheet({
  section,
  count,
  deckOn,
  deckOff,
}: {
  section: DeckSection;
  count: Count;
  deckOn: (d: Deck) => boolean;
  deckOff: (d: Deck) => boolean;
}) {
  const decks = section.groups.flatMap((g) => g.decks);
  const cards = decks.reduce((n, d) => n + d.entries.length, 0);
  const on = decks.filter(deckOn).length;
  const vocabulary = section.id === "vocabulary";
  // every deck ticked / back to the started ones / none
  const setAll = (v: boolean | null) => setIncluded(Object.fromEntries(decks.map((d) => [d.id, v])));

  return (
    <section className="sheet decksection">
      <p className="libkicker">
        {decks.length} decks · {cards} cards · {on ? `${on} in daily study` : "none in daily study yet"}
      </p>
      <div className="decksectionhead">
        <h3 className="sheethead">{section.title}</h3>
        <span className="decksubacts" role="group" aria-label={`Tick decks of ${section.title}`}>
          <button type="button" className="linkbtn" onClick={() => setAll(true)}>
            All
          </button>
          <button type="button" className="linkbtn" onClick={() => setAll(null)} title="Only the decks you have started">
            Started
          </button>
          <button type="button" className="linkbtn" onClick={() => setAll(false)}>
            None
          </button>
        </span>
      </div>
      <p className="ruleprose muted">{section.about}</p>
      <div className="deckgroups">
        {section.groups.map((g) => (
          <GroupFold key={g.title} group={g} count={count} deckOn={deckOn} deckOff={deckOff} vocabulary={vocabulary} />
        ))}
      </div>
    </section>
  );
}

/** A group of decks, open at first when any of them is in daily study. */
function GroupFold({
  group,
  count,
  deckOn,
  deckOff,
  vocabulary,
}: {
  group: DeckGroup;
  count: Count;
  deckOn: (d: Deck) => boolean;
  deckOff: (d: Deck) => boolean;
  vocabulary: boolean;
}) {
  const n = group.decks.filter(deckOn).length;
  // only the first render decides: ticking must not fold what the learner opened
  const [open] = useState(n > 0);
  return (
    <details className="deckgroup" open={open}>
      <summary>
        <PickBox
          checked={n === group.decks.length}
          mixed={n > 0 && n < group.decks.length}
          label={`${group.title} in daily study`}
          onChange={(v) => setIncluded(Object.fromEntries(group.decks.map((d) => [d.id, v])))}
        />
        <ChevronRight size={16} className="chev" aria-hidden />
        <span className="deckname">{group.title}</span>
        <GroupCounts decks={group.decks} count={count} />
      </summary>
      <ul className="deckrows">
        {group.decks.map((d) => (
          <DeckRow key={d.id} deck={d} on={deckOn(d)} off={deckOff(d)} count={count} vocabulary={vocabulary} />
        ))}
      </ul>
    </details>
  );
}

/** A group's numbers: its decks' added up. */
function GroupCounts({ decks, count }: { decks: Deck[]; count: Count }) {
  const c = { fresh: 0, learn: 0, review: 0, total: 0 };
  for (const d of decks) {
    const x = count({ kind: "deck", id: d.id });
    if (!x) continue;
    c.fresh += x.fresh;
    c.learn += x.learn;
    c.review += x.review;
    c.total += x.total;
  }
  return <CountsLine c={c} />;
}

function DeckRow({
  deck,
  on,
  off,
  count,
  vocabulary,
}: {
  deck: Deck;
  on: boolean;
  off: boolean;
  count: Count;
  vocabulary: boolean;
}) {
  const c = count({ kind: "deck", id: deck.id });
  return (
    <li className={"deckline" + (off ? " deckoff" : "")}>
      <PickBox checked={on} label={`${deck.title} in daily study`} onChange={(v) => setIncluded({ [deck.id]: v })} />
      <div className="deckinfo">
        <a className="deckname decklink" href={browseHash(deck.id)}>
          {deck.title}
          <LevelChip level={deck.level} />
        </a>
        <span className="packabout">
          {deck.entries.length} {vocabulary ? "words" : "cards"} · {deck.about}
        </span>
      </div>
      <a
        className="iconlink"
        href={browseHash(deck.id)}
        title="Browse the cards"
        aria-label={`${deck.title}: browse the cards`}
      >
        <Rows3 size={16} aria-hidden />
      </a>
      {vocabulary && (
        <a
          className="iconlink"
          href={dictionaryDeckHash(deck.id)}
          title="The word list"
          aria-label={`${deck.title}: the word list`}
        >
          <List size={16} aria-hidden />
        </a>
      )}
      {c && <CountsLine c={c} />}
      <StudyLink c={on ? c : null} href={deckHash({ kind: "deck", id: deck.id })} small />
    </li>
  );
}

export function LevelChip({ level }: { level: Deck["level"] }) {
  return (
    <span className="levelchip" title={LEVEL_NAMES[level]}>
      {level}
    </span>
  );
}

function StudyLink({ c, href, small = false }: { c: Counts | null; href: string; small?: boolean }) {
  return (
    <a className={"pillbtn" + (small ? " small" : "") + (c && c.fresh + c.learn + c.review ? " primary" : "")} href={href}>
      Study
    </a>
  );
}

/** A tick for daily study; `mixed` shows a group with only some decks ticked. */
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
      // a mixed group becomes all ticked; a tick in a summary must not fold it
      onClick={(e) => e.stopPropagation()}
      onChange={() => onChange(mixed ? true : !checked)}
    />
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
  const preset = presetOf(settings);
  const newInput = useRef<HTMLInputElement>(null);
  const num = (
    k: "newPerDay" | "reviewsPerDay",
    label: string,
    hint: string,
    ref?: RefObject<HTMLInputElement>,
  ) => (
    <label className="setting">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      <input
        ref={ref}
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
      <div className="setting">
        <span>
          Daily load
          <small>{preset ? preset.hint : "your own limits, set below"}</small>
        </span>
      </div>
      <div className="browsefilters presetrow" role="group" aria-label="Daily load">
        {LIMIT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="pillbtn small"
            aria-pressed={preset === p}
            onClick={() => saveSettings({ ...settings, newPerDay: p.newPerDay, reviewsPerDay: p.reviewsPerDay })}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          className="pillbtn small"
          aria-pressed={!preset}
          onClick={() => newInput.current?.focus()}
        >
          Custom
        </button>
      </div>
      {num("newPerDay", "New cards a day", "cards seen for the first time, across all decks", newInput)}
      {num("reviewsPerDay", "Reviews a day", "the most review cards shown in one day")}
      {reviewsTooFew(settings) && (
        <p className="lookupstatus warn">
          Reviews will pile up: each new card a day brings about ten reviews a day later on. Keep the review limit
          at least ten times the new one ({10 * settings.newPerDay}).
        </p>
      )}
      <label className="modal-opt">
        <input
          type="checkbox"
          checked={settings.typeAnswers}
          onChange={(e) => saveSettings({ ...settings, typeAnswers: e.target.checked })}
        />
        Type the answers: gaps, verb forms and translations are checked like an exercise
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
        at growing intervals; a day starts at 4 a.m. Learning cards have no limit of their own: they are the new
        cards of today and the ones you forgot, and they must come back on time.
      </p>
    </details>
  );
}
