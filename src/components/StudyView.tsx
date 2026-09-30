// A study session (#/cards/<deck>): Anki's review loop. One card at a time —
// the question, then the answer — and four buttons (Again / Hard / Good /
// Easy) carrying the interval each one schedules. The queue is rebuilt from
// the store after every answer (srs.ts buildQueue), so answers in another tab,
// an undo or the clock passing a learning card's due time are all picked up;
// the card on screen stays put until it is answered.
//
// Deck cards (deckdata.ts) ask for a verb's forms, the gaps of a sentence,
// the right one of a few options, the English of a Russian phrase, or what an
// English phrase means; typed answers are checked like an exercise. Word
// cards show a saved word and its translation, or the translation and the
// word. Everything the session needs is in the app's own chunks or the
// store, so it works offline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ArrowLeft, Check, Info, List, PauseCircle, PencilLine, Plus, Rows3, Undo2, Volume2, X } from "lucide-react";
import { checkFill, normalize } from "../checker";
import type { Deck, DeckEntry, EntryKind } from "../deckdata";
import { checkTyped, choiceOrder, entryKind, entryText, formVariants, gapsOf, parseCardId, phraseAnswers, useDecks } from "../deckdata";
import type { ResolvedCard } from "../decks";
import { deckIds, deckTitle, useCardLookup } from "../decks";
import { speak } from "../lookup";
import type { DeckRef } from "../routes";
import { CARDS_HASH, browseHash, dictionaryDeckHash } from "../routes";
import type { Rating } from "../srs";
import { RATINGS, RATING_LABEL, buildQueue, intervalLabel, nextCard, preview, todayDaily } from "../srs";
import { STUDY_HELP } from "../shortcuts";
import { answerCard, setSuspended, srsConfig, undoAnswer, useStudy } from "../study";
import type { Word } from "../words";
import { CountsLine, LevelChip } from "./CardsView";
import { SectionBar } from "./SectionBar";
import { ShortcutsHelpButton, ShortcutsModal } from "./ShortcutsHelp";
import { openWordEditor } from "./WordEditor";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

/** What the learner did on the question side, for checking and the suggested rating. */
interface Attempt {
  /** the forms, or the gaps of a sentence */
  gaps: string[];
  text: string;
  /** the option picked, as its index in the entry (the right one is 0) */
  choice: number | null;
}
const EMPTY: Attempt = { gaps: [], text: "", choice: null };

export function StudyView({ deck }: { deck: DeckRef }) {
  const study = useStudy();
  const { words, srs, settings } = study;
  const decks = useDecks();
  const lookup = useCardLookup(decks.lib, words);
  const cfg = useMemo(() => srsConfig(settings), [settings]);

  // the clock the queue is built at: moved on by every answer, and every
  // 15 s so a learning card falls due while its screen is open
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const ids = useMemo(
    () => deckIds(deck, decks.lib, words, srs.states, settings.include),
    [deck, decks.lib, words, srs.states, settings.include],
  );
  const queue = useMemo(() => {
    if (!ids) return null;
    return buildQueue({
      ids,
      states: srs.states,
      suspended: new Set(srs.suspended),
      daily: todayDaily(srs.daily, now, cfg),
      now,
      cfg,
    });
  }, [ids, srs, now, cfg]);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [attempt, setAttempt] = useState<Attempt>(EMPTY);
  const [helpOpen, setHelpOpen] = useState(false);

  // the card on screen stays until answered; when there is none, take the next
  const next = queue ? nextCard(queue, srs.states, now, cfg) : null;
  const shownId = currentId ?? next;
  useEffect(() => {
    if (currentId === null && next !== null) setCurrentId(next);
  }, [currentId, next]);
  // a card that disappeared (its word deleted, suspended elsewhere) is dropped
  const resolved = shownId ? lookup(shownId) : null;
  useEffect(() => {
    if (shownId && decks.lib && !resolved) setCurrentId(null);
  }, [shownId, resolved, decks.lib]);

  // turned over: the answer field lets go of the focus, so 1–4 and Space rate
  const turn = useCallback(() => setRevealed(true), []);
  useEffect(() => {
    if (!revealed) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.closest(".studycard input, .studycard textarea")) el.blur();
  }, [revealed]);
  // a choice card's options: shuffled anew at each review (by its review
  // count when it comes up), steady while it is on screen
  const options = resolved?.type === "deck" ? resolved.entry.choice : undefined;
  const reps = shownId ? (srs.states[shownId]?.reps ?? 0) : 0;
  // (the review count is read when the card comes up: answering moves on)
  const shownOrder = useMemo(
    () => (shownId && options ? choiceOrder(shownId, options.length, reps) : []),
    [shownId, options], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const verdict = resolved && revealed ? grade(resolved, attempt, settings.typeAnswers) : null;
  const suggested: Rating = verdict === false ? 1 : 3;

  const rate = useCallback(
    (r: Rating) => {
      if (!shownId || !revealed) return;
      answerCard(shownId, r);
      setCurrentId(null);
      setRevealed(false);
      setAttempt(EMPTY);
      setNow(Date.now());
    },
    [shownId, revealed],
  );

  const undo = useCallback(() => {
    const id = undoAnswer();
    if (!id) return;
    setCurrentId(id);
    setRevealed(false);
    setAttempt(EMPTY);
    setNow(Date.now());
  }, []);

  const pickChoice = useCallback(
    (i: number) => {
      if (revealed) return;
      setAttempt((a) => ({ ...a, choice: i }));
      setRevealed(true);
    },
    [revealed],
  );

  // keys: see STUDY_HELP
  const keyState = useRef({ revealed, rate, turn, undo, suggested, pickChoice, shownOrder, helpOpen });
  keyState.current = { revealed, rate, turn, undo, suggested, pickChoice, shownOrder, helpOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyState.current;
      if (k.helpOpen) {
        if (e.key === "Escape") setHelpOpen(false);
        return;
      }
      if (document.querySelector(".modal-overlay")) return; // the word editor is open
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      // Ctrl+Z in a field with text is the field's own undo; an empty answer
      // field (the next card's, which takes the focus) has nothing to undo
      const fieldText = typing && "value" in typing ? String(typing.value) : "";
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "KeyZ" && !fieldText) {
        e.preventDefault();
        k.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (e.shiftKey && e.code === "KeyT" && !typing) {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('.topbar-actions .themebtn[aria-label^="Theme"]')?.click();
        return;
      }
      if (typing || e.shiftKey || e.repeat) return;
      const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (!k.revealed) {
        if (e.key === " " || e.key === "Enter") {
          // a focused button (Undo, Suspend…) keeps its own Space/Enter
          if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
          e.preventDefault();
          k.turn();
        } else if (digit && Number(digit) <= k.shownOrder.length) {
          e.preventDefault();
          k.pickChoice(k.shownOrder[Number(digit) - 1]);
        }
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        e.preventDefault();
        k.rate(k.suggested);
      } else if (digit && Number(digit) <= 4) {
        e.preventDefault();
        k.rate(Number(digit) as Rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const state = shownId ? srs.states[shownId] : undefined;
  const at = !shownId || !state ? "fresh" : state.kind === "review" ? "review" : "learn";
  const counts = queue
    ? { fresh: queue.fresh.length, learn: queue.learn.length + queue.later.length, review: queue.review.length, total: ids?.length ?? 0 }
    : null;
  // one instant for every button, so the four labels agree with each other
  const t = Date.now();
  const previews = shownId && revealed ? preview(state, t, cfg, shownId) : null;

  let body;
  if (!ids) {
    body = decks.failed ? (
      <Notice>
        The decks could not be loaded. Are you offline? Open the cards online once and they stay available
        offline.
      </Notice>
    ) : (
      <Notice>Loading the cards…</Notice>
    );
  } else if (!shownId || !resolved) {
    body = <Finished deck={deck} total={ids.length} later={queue?.later.length ?? 0} />;
  } else {
    body = (
      <>
        <article className={"sheet studycard" + (revealed ? " turned" : "")} key={shownId}>
          <CardFace
            r={resolved}
            revealed={revealed}
            attempt={attempt}
            setAttempt={setAttempt}
            typeAnswers={settings.typeAnswers}
            order={shownOrder}
            onSubmit={turn}
            onPick={pickChoice}
          />
        </article>
        <div className="studyactions">
          {!revealed ? (
            <button type="button" className="homecta showbtn" onClick={turn}>
              Show answer <kbd>Space</kbd>
            </button>
          ) : (
            <div className="ratebtns" role="group" aria-label="How well did you know it?">
              {RATINGS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`ratebtn r${r}` + (r === suggested ? " suggest" : "")}
                  onClick={() => rate(r)}
                  title={`${RATING_LABEL[r]} — ${r}`}
                >
                  <span className="rateivl">{previews ? intervalLabel(previews[r], t) : ""}</span>
                  <span className="ratelabel">{RATING_LABEL[r]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="studytools">
          <button type="button" className="linkbtn" onClick={undo} disabled={!study.canUndo} title="Undo — Ctrl+Z">
            <Undo2 size={15} aria-hidden /> Undo
          </button>
          <button
            type="button"
            className="linkbtn"
            onClick={() => {
              setSuspended(shownId, true);
              setCurrentId(null);
              setRevealed(false);
              setAttempt(EMPTY);
            }}
            title="Stop showing this card (Cards → Settings brings suspended cards back)"
          >
            <PauseCircle size={15} aria-hidden /> Suspend
          </button>
          <CardLinks r={resolved} />
          {resolved.type === "deck" && (
            <a
              className="linkbtn"
              href={browseHash(resolved.deck.id, parseCardId(shownId)?.entry)}
              title="The card among its deck's cards, with its review history"
            >
              <Info size={15} aria-hidden /> Card info
            </a>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="app">
      <SectionBar
        section="cards"
        actions={<ShortcutsHelpButton onOpen={() => setHelpOpen(true)} />}
      />
      <div className="main">
        <OverlayScrollbarsComponent element="main" className="home deskpane" options={OS_OPTIONS}>
          <div className="deskcol studycol">
            <div className="studyhead">
              <a className="ruleback" href={CARDS_HASH}>
                <ArrowLeft size={16} aria-hidden /> Decks
              </a>
              <h2 className="studytitle">{deckTitle(deck, decks.lib)}</h2>
              {counts && <CountsLine c={counts} at={resolved ? at : undefined} />}
            </div>
            {body}
          </div>
        </OverlayScrollbarsComponent>
      </div>
      {helpOpen && <ShortcutsModal entries={STUDY_HELP} onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rulesnote">{children}</p>;
}

function Finished({ deck, total, later }: { deck: DeckRef; total: number; later: number }) {
  let text: string;
  if (!total)
    text =
      deck.kind === "words"
        ? "No words yet. Add some in the dictionary — or select a word in an exercise."
        : deck.kind === "all"
          ? "Nothing here yet. Tick a deck in the deck list — or just study one — and add words to your dictionary: their cards will appear here."
          : "There is no such deck. It may have been renamed — pick it from the deck list.";
  else if (later)
    text = `${later} card${later === 1 ? "" : "s"} you are learning come${later === 1 ? "s" : ""} back later today — this page brings ${later === 1 ? "it" : "them"} up when due.`;
  else text = "Nothing more is due in this deck today. Come back tomorrow.";
  return (
    <section className="sheet finished">
      <h2 className="unitheading">{total ? "Done for now" : "No cards"}</h2>
      <p className="ruleprose">{text}</p>
      <div className="modal-actions">
        <a className="themebtn labelled" href={CARDS_HASH}>
          <ArrowLeft size={15} aria-hidden /> All decks
        </a>
        {deck.kind === "deck" && total > 0 && (
          <a className="themebtn labelled" href={browseHash(deck.id)}>
            <Rows3 size={15} aria-hidden /> Browse the cards
          </a>
        )}
      </div>
    </section>
  );
}

// ---- checking -----------------------------------------------------------------------

/** Whether the typed/picked answer was right; null when nothing was attempted. */
function grade(r: ResolvedCard, a: Attempt, typing: boolean): boolean | null {
  if (r.type === "word") {
    if (r.dir !== "r" || !typing || !a.text.trim()) return null;
    return normalize(a.text) === normalize(r.word.word);
  }
  const kind = entryKind(r.deck, r.entry);
  if (kind === "choice") return a.choice === null ? null : a.choice === 0;
  if (kind === "meaning" || !typing) return null;
  const typed = kind === "translate" ? !!a.text.trim() : a.gaps.some((g) => g?.trim());
  return typed ? checkTyped(kind, r.entry, a) : null;
}

// ---- faces --------------------------------------------------------------------------

interface FaceProps {
  r: ResolvedCard;
  revealed: boolean;
  attempt: Attempt;
  setAttempt: (f: (a: Attempt) => Attempt) => void;
  typeAnswers: boolean;
  /** a choice card's options in the order shown */
  order: number[];
  onSubmit: () => void;
  onPick: (i: number) => void;
}

/** A card as the deck browser shows it: turned over, nothing typed. */
export function CardPreview({ r, order }: { r: ResolvedCard; order: number[] }) {
  const none = () => {};
  return (
    <CardFace r={r} revealed attempt={EMPTY} setAttempt={none} typeAnswers={false} order={order} onSubmit={none} onPick={none} />
  );
}

function CardFace(p: FaceProps) {
  if (p.r.type === "word") return <WordFace {...p} word={p.r.word} dir={p.r.dir} />;
  return <DeckFace {...p} deck={p.r.deck} entry={p.r.entry} />;
}

function WordFace({ word, dir, revealed, attempt, setAttempt, typeAnswers, onSubmit }: FaceProps & { word: Word; dir: "f" | "r" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const askTyping = dir === "r" && typeAnswers;
  useEffect(() => {
    if (askTyping) inputRef.current?.focus({ preventScroll: true });
  }, [askTyping]);
  const head = (
    <div className="wordbig">
      <span className="wordbigtext">{word.word}</span>
      {word.ipa && <span className="ipa">{word.ipa}</span>}
      <Speak text={word.word} audio={word.audio} />
    </div>
  );
  const translation = (
    <p className="wordbigtrans" lang="ru">
      {word.translation || <em className="muted">no translation</em>}
    </p>
  );
  const ok = askTyping && attempt.text.trim() ? normalize(attempt.text) === normalize(word.word) : null;
  return (
    <>
      <p className="cardsource">{dir === "f" ? "Word → translation" : "Translation → word"}</p>
      <div className="cardfront">
        {dir === "f" ? head : translation}
        {askTyping && (
          <input
            ref={inputRef}
            className={"wfull" + (ok === true ? " ok" : ok === false ? " bad" : "")}
            value={attempt.text}
            readOnly={revealed}
            onChange={(e) => {
              const v = e.target.value;
              setAttempt((a) => ({ ...a, text: v }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !revealed) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="the English word"
            aria-label="The English word"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </div>
      {revealed && (
        <div className="cardback">
          {dir === "f" ? translation : head}
          {word.senses && word.senses.length > 0 && (
            <div className="sensebrief">
              {word.senses.slice(0, 2).map((s, i) => (
                <p key={i}>
                  <em className="pos">{s.pos}</em> {s.defs[0]?.def}
                  {s.defs[0]?.example && <span className="senseex">{s.defs[0].example}</span>}
                </p>
              ))}
            </div>
          )}
          {word.context && <p className="wordcontext">{word.context}</p>}
          {word.notes && <p className="wordnotes">{word.notes}</p>}
        </div>
      )}
    </>
  );
}

function Speak({ text, audio }: { text: string; audio?: string }) {
  return (
    <button type="button" className="wordspeak" onClick={() => void speak(text, audio)} aria-label={`Listen: ${text}`}>
      <Volume2 size={16} aria-hidden />
    </button>
  );
}

/** The line over a card: what to do with it. */
function instruction(deck: Deck, kind: EntryKind, e: DeckEntry): string {
  if (deck.prompt && kind !== "forms") return deck.prompt;
  switch (kind) {
    case "forms":
      return "Past simple · past participle";
    case "gap":
      return gapsOf(e.en ?? "").gaps.length > 1 ? "Fill the gaps" : "Fill the gap";
    case "choice":
      return e.en ? "Choose what fits" : "Which is right?";
    case "translate":
      return "In English";
    case "meaning":
      return "What does it mean?";
  }
}

function DeckFace({
  deck,
  entry,
  revealed,
  attempt,
  setAttempt,
  typeAnswers,
  order,
  onSubmit,
  onPick,
}: FaceProps & { deck: Deck; entry: DeckEntry }) {
  const kind = entryKind(deck, entry);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (typeAnswers) inputs.current[0]?.focus({ preventScroll: true });
  }, [typeAnswers]);

  const setGap = (i: number, v: string) =>
    setAttempt((a) => {
      const gaps = [...a.gaps];
      gaps[i] = v;
      return { ...a, gaps };
    });
  // Enter moves to the next field; in the last one it turns the card
  const enter = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || revealed) return;
    e.preventDefault();
    const next = inputs.current[i + 1];
    if (next) next.focus();
    else onSubmit();
  };
  const mark = (typed: string, variants: string[]) =>
    revealed && typed.trim() ? (checkFill(typed, variants) ? " ok" : " bad") : "";
  /** a typed field: a gap in a sentence (cls "gap") or a line of its own */
  const field = (i: number, value: string, variants: string[], label: string, cls: "gap" | "wfull") => (
    <input
      key={i}
      ref={(el) => void (inputs.current[i] = el)}
      className={cls + mark(value, variants)}
      size={cls === "gap" ? Math.max(5, Math.max(...variants.map((v) => v.length)) + 2) : undefined}
      value={value}
      readOnly={revealed}
      onChange={(e) => {
        const v = e.target.value;
        if (kind === "translate") setAttempt((a) => ({ ...a, text: v }));
        else setGap(i, v);
      }}
      onKeyDown={enter(i)}
      placeholder={cls === "gap" ? undefined : label}
      aria-label={label}
      autoCapitalize="off"
      autoComplete="off"
      spellCheck={false}
    />
  );
  const ru = entry.ru && (
    <p className="packru" lang="ru">
      {entry.ru}
    </p>
  );
  const extra = (entry.ex || entry.note) && (
    <>
      {entry.ex && kind !== "meaning" && <p className="wordcontext">{entry.ex}</p>}
      {entry.note && <p className="wordnotes cardnote">{entry.note}</p>}
    </>
  );

  let front: React.ReactNode;
  let back: React.ReactNode = null;
  switch (kind) {
    case "forms": {
      const forms = entry.forms ?? [];
      front = (
        <>
          <div className="wordbig">
            <span className="wordbigtext">{entry.en}</span>
            <Speak text={entry.en ?? ""} />
          </div>
          {ru}
          {typeAnswers && (
            <div className="formsrow">
              {forms.map((f, i) =>
                field(i, attempt.gaps[i] ?? "", formVariants(f), i ? "past participle" : "past simple", "wfull"),
              )}
            </div>
          )}
        </>
      );
      back = (
        <>
          <p className="formsline">
            <span>{entry.en}</span>
            {forms.map((f, i) => (
              <span key={i} className={typeAnswers && checkFill(attempt.gaps[i] ?? "", formVariants(f)) ? "ok" : undefined}>
                {f}
              </span>
            ))}
          </p>
          {extra}
        </>
      );
      break;
    }
    case "gap": {
      const { parts, gaps } = gapsOf(entry.en ?? "");
      front = (
        <>
          <p className="clozeline">
            {parts.map((part, i) => (
              <span key={i}>
                {part}
                {i < gaps.length && (
                  <>
                    {typeAnswers ? (
                      field(i, attempt.gaps[i] ?? "", gaps[i].answers, `Gap ${i + 1}`, "gap")
                    ) : revealed ? (
                      <mark className="gapfill">{gaps[i].answers[0]}</mark>
                    ) : (
                      <span className="gapblank" aria-label="gap" />
                    )}
                    {gaps[i].hint && <span className="gaphint"> ({gaps[i].hint})</span>}
                  </>
                )}
              </span>
            ))}
          </p>
          {ru}
        </>
      );
      back = (
        <>
          {typeAnswers && (
            <p className="filledline">
              {parts.map((part, i) => (
                <span key={i}>
                  {part}
                  {i < gaps.length && (
                    <mark className={"gapfill" + (checkFill(attempt.gaps[i] ?? "", gaps[i].answers) ? "" : " missed")}>
                      {gaps[i].answers.join(" / ")}
                    </mark>
                  )}
                </span>
              ))}
            </p>
          )}
          {extra}
        </>
      );
      break;
    }
    case "choice": {
      const opts = entry.choice ?? [];
      const [before, after] = entry.en ? entry.en.split("___") : ["", ""];
      front = (
        <>
          {entry.en && (
            <p className="clozeline">
              {before}
              {revealed ? <mark className="gapfill">{opts[0]}</mark> : <span className="gapblank" aria-label="gap" />}
              {after}
            </p>
          )}
          <ol className={"choiceopts" + (entry.en ? " inline" : "")}>
            {order.map((i, k) => {
              const right = i === 0;
              const cls =
                "choiceopt" + (revealed && right ? " ok" : "") + (revealed && attempt.choice === i && !right ? " bad" : "");
              return (
                <li key={i}>
                  <button type="button" className={cls} onClick={() => onPick(i)} disabled={revealed}>
                    <span className="optkey">{k + 1}</span>
                    <span className="opttext">{opts[i]}</span>
                    {revealed && right && <Check size={16} aria-hidden />}
                    {revealed && attempt.choice === i && !right && <X size={16} aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      );
      back = (
        <>
          {ru}
          {extra}
        </>
      );
      break;
    }
    case "translate":
      front = (
        <>
          <p className="wordbigtrans" lang="ru">
            {entry.ru}
          </p>
          {typeAnswers && field(0, attempt.text, phraseAnswers(entry), "the English", "wfull")}
        </>
      );
      back = (
        <>
          <div className="wordbig">
            <span className={"wordbigtext" + (typeAnswers && attempt.text.trim() && !checkFill(attempt.text, phraseAnswers(entry)) ? " missed" : "")}>
              {entry.en}
            </span>
            <Speak text={entry.en ?? ""} />
          </div>
          {entry.alt && entry.alt.length > 0 && <p className="packalt">also {entry.alt.join(", ")}</p>}
          {extra}
        </>
      );
      break;
    case "meaning":
      front = (
        <>
          <div className="wordbig">
            <span className="wordbigtext">{entry.en}</span>
            <Speak text={entry.en ?? ""} />
          </div>
          {entry.ex && <p className="wordcontext">{entry.ex}</p>}
        </>
      );
      back = (
        <>
          <p className="wordbigtrans" lang="ru">
            {entry.ru}
          </p>
          {extra}
        </>
      );
      break;
  }

  return (
    <>
      <p className="cardsource">
        {deck.title}
        <LevelChip level={deck.level} />
      </p>
      <p className="instruction">{instruction(deck, kind, entry)}</p>
      <div className="cardfront">{front}</div>
      {revealed && back && <div className="cardback">{back}</div>}
    </>
  );
}

export function CardLinks({ r }: { r: ResolvedCard }) {
  if (r.type === "word")
    return (
      <button type="button" className="linkbtn" onClick={() => openWordEditor({ id: r.word.id })}>
        <PencilLine size={15} aria-hidden /> Edit word
      </button>
    );
  // a phrase to keep: vocabulary, not a grammar sentence
  if (r.section !== "vocabulary") return null;
  const phrase = r.entry.choice ? null : entryText(r.entry);
  return (
    <>
      <a className="linkbtn" href={dictionaryDeckHash(r.deck.id)}>
        <List size={15} aria-hidden /> Word list
      </a>
      {phrase && (
        <button type="button" className="linkbtn" onClick={() => openWordEditor({ word: phrase, context: r.entry.ex })}>
          <Plus size={15} aria-hidden /> Add to my words
        </button>
      )}
    </>
  );
}
