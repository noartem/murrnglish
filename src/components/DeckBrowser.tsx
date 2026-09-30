// A deck's cards (#/cards/<deck>/browse): Anki's browser, for one deck. Every
// card in a list — its English, its Russian and where it stands (new,
// learning, due, in how long, suspended) — narrowed by a search and by those
// states. A row opens the card (#/cards/<deck>/browse/<entry>): turned over as
// a session shows it, with its review history, a way to suspend it or to
// forget it, and the cards before and after it in the list (← →).
//
// The search and the filter live in this component, which stays mounted
// between the list and a card: back in the list, they are as they were and
// the card last opened is in view.

import { useEffect, useMemo, useRef, useState } from "react";
import { OverlayScrollbarsComponent, type OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { ArrowLeft, ChevronLeft, ChevronRight, PauseCircle, PlayCircle, RotateCcw, Search, X } from "lucide-react";
import type { Deck, DeckEntry } from "../deckdata";
import { cardId, choiceOrder, deckCardIds, entryText, gapsOf, useDecks } from "../deckdata";
import type { ResolvedCard } from "../decks";
import { CARDS_HASH, browseHash, deckHash, replaceHash } from "../routes";
import type { CardState, SrsConfig } from "../srs";
import { dayNumber, deckCounts, formatDays, formatMinutes, todayDaily } from "../srs";
import { resetCard, setSuspended, srsConfig, useStudy } from "../study";
import { useMinuteClock } from "../dueCount";
import { headwordKey } from "../words";
import { CountsLine, LevelChip } from "./CardsView";
import { EntryEn } from "./DictionaryView";
import { SectionBar } from "./SectionBar";
import { CardLinks, CardPreview } from "./StudyView";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

type Tone = "new" | "learn" | "due" | "later" | "off";
type Filter = Tone | "any";

const FILTERS: { f: Filter; label: string }[] = [
  { f: "any", label: "All" },
  { f: "new", label: "New" },
  { f: "learn", label: "Learning" },
  { f: "due", label: "Due" },
  { f: "later", label: "Later" },
  { f: "off", label: "Suspended" },
];

/** Where a card stands, as one short label. */
function cardStatus(
  state: CardState | undefined,
  isSuspended: boolean,
  now: number,
  cfg: SrsConfig,
): { text: string; tone: Tone } {
  if (isSuspended) return { text: "suspended", tone: "off" };
  if (!state) return { text: "new", tone: "new" };
  if (state.kind !== "review") return { text: "learning", tone: "learn" };
  const days = dayNumber(state.due, cfg) - dayNumber(now, cfg);
  if (days <= 0) return { text: "due", tone: "due" };
  return { text: `in ${formatDays(days)}`, tone: "later" };
}

/** Everything an entry says, for the search. */
function haystack(e: DeckEntry): string {
  return headwordKey(
    [entryText(e), e.en, e.ru, e.ex, e.note, ...(e.alt ?? []), ...(e.forms ?? []), ...(e.choice ?? [])]
      .filter(Boolean)
      .join("\n"),
  );
}

interface Row {
  e: DeckEntry;
  id: string;
  st: { text: string; tone: Tone };
}

export function DeckBrowser({ deck: deckId, entry: entryId }: { deck: string; entry?: string }) {
  const { srs, settings } = useStudy();
  const { lib, failed } = useDecks();
  const now = useMinuteClock();
  const cfg = useMemo(() => srsConfig(settings), [settings]);
  const suspended = useMemo(() => new Set(srs.suspended), [srs.suspended]);
  const deck = lib?.decks.get(deckId);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("any");
  const osRef = useRef<OverlayScrollbarsComponentRef<"main">>(null);

  const rows = useMemo<Row[]>(
    () =>
      (deck?.entries ?? []).map((e) => {
        const id = cardId(deckId, e.id);
        return { e, id, st: cardStatus(srs.states[id], suspended.has(id), now, cfg) };
      }),
    [deck, deckId, srs.states, suspended, now, cfg],
  );
  const texts = useMemo(() => new Map((deck?.entries ?? []).map((e) => [e.id, haystack(e)])), [deck]);
  const key = headwordKey(q);
  const matching = key ? rows.filter((r) => texts.get(r.e.id)!.includes(key)) : rows;
  const shown = filter === "any" ? matching : matching.filter((r) => r.st.tone === filter);
  const tally = (f: Filter) => (f === "any" ? matching.length : matching.filter((r) => r.st.tone === f).length);

  const counts = useMemo(
    () =>
      deck
        ? deckCounts({
            ids: deckCardIds(deck),
            states: srs.states,
            suspended,
            daily: todayDaily(srs.daily, now, cfg),
            now,
            cfg,
          })
        : null,
    [deck, srs, suspended, now, cfg],
  );

  // a card opened: the page starts at its top; back in the list, the card
  // last opened is in view (and focused, for the keyboard)
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    const vp = osRef.current?.osInstance()?.elements().viewport;
    if (entryId) {
      last.current = entryId;
      if (vp) vp.scrollTop = 0;
      return;
    }
    const row = last.current && document.querySelector<HTMLElement>(`[data-entry="${last.current}"]`);
    if (row) {
      row.scrollIntoView({ block: "center" });
      row.focus({ preventScroll: true });
    }
  }, [entryId, deck]);

  const row = entryId ? rows.find((r) => r.e.id === entryId) : undefined;
  // a card the filter has since let go (suspended under "New") keeps its
  // neighbours from the whole deck
  const order = row && shown.includes(row) ? shown : rows;
  const at = row ? order.indexOf(row) : -1;

  let body: React.ReactNode;
  if (!lib) {
    body = (
      <p className="rulesnote">
        {failed
          ? "The decks could not be loaded. Are you offline? Open the cards online once and they stay available offline."
          : "Loading the cards…"}
      </p>
    );
  } else if (!deck) {
    body = (
      <section className="sheet finished">
        <h2 className="unitheading">No such deck</h2>
        <p className="ruleprose">It may have been renamed — pick it from the deck list.</p>
      </section>
    );
  } else if (entryId && row) {
    body = (
      <CardDetail
        key={row.id}
        deck={deck}
        row={row}
        state={srs.states[row.id]}
        section={lib.sectionOf.get(deck.id) ?? ""}
        now={now}
        cfg={cfg}
        prev={at > 0 ? order[at - 1].e.id : null}
        next={at < order.length - 1 ? order[at + 1].e.id : null}
        place={`${at + 1} of ${order.length}`}
      />
    );
  } else if (entryId) {
    body = (
      <section className="sheet finished">
        <h2 className="unitheading">No such card</h2>
        <p className="ruleprose">It may have been reworded or removed from the deck.</p>
        <div className="modal-actions">
          <a className="themebtn labelled" href={browseHash(deck.id)}>
            <ArrowLeft size={15} aria-hidden /> All its cards
          </a>
        </div>
      </section>
    );
  } else {
    body = (
      <>
        <section className="sheet browsetools">
          <p className="ruleprose muted">{deck.about}</p>
          <label className="searchbox">
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a card…"
              aria-label="Find a card"
              spellCheck={false}
              autoCapitalize="off"
            />
            {q && (
              <button type="button" className="searchclear" onClick={() => setQ("")} aria-label="Clear the search">
                <X size={16} aria-hidden />
              </button>
            )}
          </label>
          <div className="browsefilters" role="group" aria-label="Show the cards that are">
            {FILTERS.map(({ f, label }) => {
              const n = tally(f);
              return (
                <button
                  key={f}
                  type="button"
                  className="pillbtn small"
                  aria-pressed={filter === f}
                  disabled={!n && filter !== f}
                  onClick={() => setFilter(f)}
                >
                  {label} <span className="muted">{n}</span>
                </button>
              );
            })}
          </div>
        </section>
        {shown.length === 0 ? (
          <p className="rulesnote">No card matches.</p>
        ) : (
          <ul className="wordlist sheet browselist">
            {shown.map((r) => (
              <li key={r.id} className="wordrow">
                <a className="wordopen" href={browseHash(deck.id, r.e.id)} data-entry={r.e.id}>
                  <span className="packen">
                    <EntryEn e={r.e} />
                  </span>
                  <span className="packru" lang="ru">
                    {r.e.ru}
                  </span>
                </a>
                <span className={`statepill ${r.st.tone}`}>{r.st.text}</span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="app">
      <SectionBar section="cards" />
      <div className="main">
        <OverlayScrollbarsComponent ref={osRef} element="main" className="home deskpane" options={OS_OPTIONS}>
          <div className="deskcol studycol">
            <div className="studyhead">
              {entryId && deck ? (
                <a className="ruleback" href={browseHash(deck.id)}>
                  <ArrowLeft size={16} aria-hidden /> All cards
                </a>
              ) : (
                <a className="ruleback" href={CARDS_HASH}>
                  <ArrowLeft size={16} aria-hidden /> Decks
                </a>
              )}
              <h2 className="studytitle">
                {deck?.title}
                {deck && <LevelChip level={deck.level} />}
              </h2>
              {counts && <CountsLine c={counts} />}
              {deck && (
                <a className={"pillbtn small" + (counts && counts.fresh + counts.learn + counts.review ? " primary" : "")} href={deckHash({ kind: "deck", id: deck.id })}>
                  Study
                </a>
              )}
            </div>
            {body}
          </div>
        </OverlayScrollbarsComponent>
      </div>
    </div>
  );
}

const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

/** When the card comes up next, in words. */
function dueText(s: CardState, now: number, cfg: SrsConfig): string {
  if (s.kind !== "review") return s.due <= now ? "now" : `in ${formatMinutes(s.due - now)}`;
  const days = dayNumber(s.due, cfg) - dayNumber(now, cfg);
  const date = new Date(s.due).toLocaleDateString("en-GB", DATE);
  if (days === 0) return `today (${date})`;
  if (days < 0) return `${date}, overdue by ${formatDays(-days)}`;
  return `${date}, in ${formatDays(days)}`;
}

const KIND_NAME: Record<CardState["kind"], string> = {
  learning: "Learning",
  review: "Review",
  relearning: "Relearning",
};

function CardDetail({
  deck,
  row,
  state,
  section,
  now,
  cfg,
  prev,
  next,
  place,
}: {
  deck: Deck;
  row: Row;
  state: CardState | undefined;
  section: string;
  now: number;
  cfg: SrsConfig;
  prev: string | null;
  next: string | null;
  place: string;
}) {
  const { e, id, st } = row;
  const isSuspended = st.tone === "off";
  const r: ResolvedCard = { type: "deck", deck, entry: e, section };
  const order = useMemo(
    () => (e.choice ? choiceOrder(id, e.choice.length, state?.reps ?? 0) : []),
    [id, e.choice], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Forget asks twice: it throws away the card's history
  const [asking, setAsking] = useState(false);
  // a gap that takes more than one answer: the session shows only the first
  const gaps = e.en?.includes("[") ? gapsOf(e.en).gaps : [];
  const moreAnswers = gaps.some((g) => g.answers.length > 1);

  // ← → the cards around it, Esc back to the list
  const keys = useRef({ prev, next, deck: deck.id });
  keys.current = { prev, next, deck: deck.id };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey || ev.repeat) return;
      if (document.querySelector(".modal-overlay")) return; // the word editor is open
      if (ev.target instanceof HTMLElement && ev.target.closest("input, textarea, select")) return;
      const k = keys.current;
      const go = ev.key === "ArrowLeft" ? k.prev : ev.key === "ArrowRight" ? k.next : undefined;
      if (go) {
        ev.preventDefault();
        replaceHash(browseHash(k.deck, go));
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        window.location.hash = browseHash(k.deck);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="browsenav">
        <button
          type="button"
          className="linkbtn"
          disabled={!prev}
          onClick={() => prev && replaceHash(browseHash(deck.id, prev))}
          title="The card before — ←"
        >
          <ChevronLeft size={16} aria-hidden /> Previous
        </button>
        <span className="muted">Card {place}</span>
        <button
          type="button"
          className="linkbtn"
          disabled={!next}
          onClick={() => next && replaceHash(browseHash(deck.id, next))}
          title="The card after — →"
        >
          Next <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      <article className="sheet studycard turned">
        <CardPreview r={r} order={order} />
        {moreAnswers && (
          <p className="packalt">
            Accepted: {gaps.map((g) => g.answers.join(" / ")).join(" · ")}
          </p>
        )}
      </article>

      <section className="sheet cardinfo">
        <h3 className="sheethead">
          This card <span className={`statepill ${st.tone}`}>{st.text}</span>
        </h3>
        {state ? (
          <dl className="cardstats">
            <dt>Stage</dt>
            <dd>{KIND_NAME[state.kind]}</dd>
            <dt>Next review</dt>
            <dd>{isSuspended ? "never, while suspended" : dueText(state, now, cfg)}</dd>
            {state.kind !== "learning" && (
              <>
                <dt>Interval</dt>
                <dd>{formatDays(state.ivl)}</dd>
              </>
            )}
            <dt>Ease</dt>
            <dd>{Math.round(state.ease * 100)}%</dd>
            <dt>Reviews</dt>
            <dd>{state.reps}</dd>
            <dt>Lapses</dt>
            <dd>{state.lapses}</dd>
            <dt>Last answered</dt>
            <dd>{new Date(state.last).toLocaleString("en-GB", { ...DATE, hour: "2-digit", minute: "2-digit" })}</dd>
          </dl>
        ) : (
          <p className="ruleprose muted">
            Not studied yet: it comes up as a new card when {deck.title} is studied
            {isSuspended ? " — once it is resumed" : ""}.
          </p>
        )}
      </section>

      <div className="studytools">
        <button
          type="button"
          className="linkbtn"
          onClick={() => setSuspended(id, !isSuspended)}
          title={isSuspended ? "Show this card in the sessions again" : "Stop showing this card"}
        >
          {isSuspended ? <PlayCircle size={15} aria-hidden /> : <PauseCircle size={15} aria-hidden />}
          {isSuspended ? "Resume" : "Suspend"}
        </button>
        {state && (
          <button
            type="button"
            className={"linkbtn" + (asking ? " warn" : "")}
            onClick={() => {
              if (!asking) return setAsking(true);
              resetCard(id);
              setAsking(false);
            }}
            onBlur={() => setAsking(false)}
            title="Throw away its reviews: the card becomes new again"
          >
            <RotateCcw size={15} aria-hidden /> {asking ? "Forget its reviews? Click again" : "Forget"}
          </button>
        )}
        <CardLinks r={r} />
      </div>
    </>
  );
}
