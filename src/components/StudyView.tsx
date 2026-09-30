// A study session (#/cards/<deck>): Anki's review loop. One card at a time —
// the question, then the answer — and four buttons (Again / Hard / Good /
// Easy) carrying the interval each one schedules. The queue is rebuilt from
// the store after every answer (srs.ts buildQueue), so answers in another tab,
// an undo or the clock passing a learning card's due time are all picked up;
// the card on screen stays put until it is answered.
//
// Unit cards come from the book's exercises: gap sentences (typed and checked
// like an exercise, or turned over), "which is right" options, sentences to
// write, matching pairs. Word cards show a saved word and its translation, or
// the translation and the word. Everything the session needs is in the
// offline copy (course.json) or the store, so it works offline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ArrowLeft, BookOpenText, Check, PauseCircle, PencilLine, Undo2, Volume2, X } from "lucide-react";
import { bookById } from "../books";
import type { UnitCard } from "../cards";
import { checkChoice, checkFill, normalize } from "../checker";
import type { ResolvedCard } from "../decks";
import { deckBooks, deckIds, deckTitle, useBookCards, useCardLookup } from "../decks";
import { speak } from "../lookup";
import type { DeckRef } from "../routes";
import { CARDS_HASH, bookHash, rulesHash } from "../routes";
import type { Rating } from "../srs";
import { RATINGS, RATING_LABEL, buildQueue, intervalLabel, nextCard, preview, todayDaily } from "../srs";
import { STUDY_HELP } from "../shortcuts";
import { answerCard, setSuspended, srsConfig, undoAnswer, useStudy } from "../study";
import type { Word } from "../words";
import { CountsLine } from "./CardsView";
import { SectionBar } from "./SectionBar";
import { ShortcutsHelpButton, ShortcutsModal } from "./ShortcutsHelp";
import { openWordEditor } from "./WordEditor";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

/** What the learner did on the question side, for checking and the suggested rating. */
interface Attempt {
  gaps: string[];
  text: string;
  choice: number | null;
}
const EMPTY: Attempt = { gaps: [], text: "", choice: null };

export function StudyView({ deck }: { deck: DeckRef }) {
  const study = useStudy();
  const { words, srs, settings } = study;
  const books = useBookCards(useMemo(() => deckBooks(deck), [deck]));
  const lookup = useCardLookup(books.books, words);
  const cfg = useMemo(() => srsConfig(settings), [settings]);

  // the clock the queue is built at: moved on by every answer, and every
  // 15 s so a learning card falls due while its screen is open
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const ids = useMemo(() => deckIds(deck, books.books, words, srs.states), [deck, books.books, words, srs.states]);
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
    if (shownId && !books.loading && !resolved) setCurrentId(null);
  }, [shownId, resolved, books.loading]);

  // turned over: the answer field lets go of the focus, so 1–4 and Space rate
  const turn = useCallback(() => setRevealed(true), []);
  useEffect(() => {
    if (!revealed) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && el.closest(".studycard input, .studycard textarea")) el.blur();
  }, [revealed]);
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
  const keyState = useRef({ revealed, rate, turn, undo, suggested, pickChoice, resolved, helpOpen });
  keyState.current = { revealed, rate, turn, undo, suggested, pickChoice, resolved, helpOpen };
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
        } else if (digit && k.resolved?.type === "unit" && k.resolved.card.kind === "choice") {
          const i = Number(digit) - 1;
          if (i < k.resolved.card.options.length) {
            e.preventDefault();
            k.pickChoice(i);
          }
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
  if (!ids || (books.loading && !resolved)) {
    body = books.failed.length ? (
      <Notice>
        {books.failed.map((b) => b.title).join(", ")} could not be loaded. Are you offline? Download the book to
        study its cards offline.
      </Notice>
    ) : (
      <Notice>Loading the cards…</Notice>
    );
  } else if (!shownId || !resolved) {
    body = <Finished deck={deck} total={ids.length} later={queue?.later.length ?? 0} failed={books.failed.map((b) => b.title)} />;
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
              <h2 className="studytitle">{deckTitle(deck, books.books)}</h2>
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

function Finished({ deck, total, later, failed }: { deck: DeckRef; total: number; later: number; failed: string[] }) {
  let text: string;
  if (!total)
    text =
      deck.kind === "words"
        ? "No words yet. Add some in the dictionary — or select a word in an exercise."
        : deck.kind === "unit"
          ? "This unit has no cards: its exercises need the pictures or situations of the printed page."
          : deck.kind === "all"
            ? "Nothing here yet. Finish a unit in a book, or add words to your dictionary, and their cards will appear."
            : "No cards here.";
  else if (later)
    text = `${later} card${later === 1 ? "" : "s"} you are learning come${later === 1 ? "s" : ""} back later today — this page brings ${later === 1 ? "it" : "them"} up when due.`;
  else text = "Nothing more is due in this deck today. Come back tomorrow.";
  return (
    <section className="sheet finished">
      <h2 className="unitheading">{total ? "Done for now" : "No cards"}</h2>
      <p className="ruleprose">{text}</p>
      {failed.length > 0 && (
        <p className="lookupstatus warn">Cards of {failed.join(", ")} are not available offline.</p>
      )}
      <div className="modal-actions">
        <a className="themebtn labelled" href={CARDS_HASH}>
          <ArrowLeft size={15} aria-hidden /> All decks
        </a>
        {deck.kind === "unit" && (
          <a className="themebtn labelled" href={bookHash(deck.book, { kind: "unit", n: deck.unit })}>
            <PencilLine size={15} aria-hidden /> The unit’s exercises
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
  const c = r.card;
  switch (c.kind) {
    case "cloze":
      if (!typing || a.gaps.every((g) => !g?.trim())) return null;
      return c.answers.every((vs, i) => checkFill(a.gaps[i] ?? "", vs));
    case "write":
      if (!typing || !a.text.trim()) return null;
      return checkFill(a.text, c.answers);
    case "choice":
      return a.choice === null ? null : checkChoice(a.choice, c.answer);
    case "match":
      return null;
  }
}

// ---- faces --------------------------------------------------------------------------

interface FaceProps {
  r: ResolvedCard;
  revealed: boolean;
  attempt: Attempt;
  setAttempt: (f: (a: Attempt) => Attempt) => void;
  typeAnswers: boolean;
  onSubmit: () => void;
  onPick: (i: number) => void;
}

function CardFace(p: FaceProps) {
  return p.r.type === "word" ? <WordFace {...p} word={p.r.word} dir={p.r.dir} /> : <UnitFace {...p} card={p.r.card} />;
}

function UnitFace({ card, revealed, attempt, setAttempt, typeAnswers, onSubmit, onPick }: FaceProps & { card: UnitCard }) {
  const book = bookById(card.book);
  const firstInput = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    firstInput.current?.focus({ preventScroll: true });
  }, []);
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !revealed) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <>
      <p className="cardsource">
        {book && <span className="libdot" style={{ background: book.color }} aria-hidden />}
        {book?.level} · Unit {card.unit} · <span className="exid small">{card.exercise}</span>
      </p>
      <p className="instruction">{card.instruction}</p>
      {card.wordBank && (
        <div className="wordbank">
          {card.wordBank.map((w) => (
            <span key={w} className="chip">
              {w}
            </span>
          ))}
        </div>
      )}
      <div className="cardfront">
        {card.kind === "cloze" && (
          <p className="clozeline">
            {card.parts.map((part, i) => (
              <span key={i}>
                {part}
                {i < card.answers.length &&
                  (typeAnswers ? (
                    <input
                      ref={i === 0 ? (el) => void (firstInput.current = el) : undefined}
                      className={
                        "gap" +
                        (revealed && (attempt.gaps[i] ?? "").trim()
                          ? checkFill(attempt.gaps[i] ?? "", card.answers[i])
                            ? " ok"
                            : " bad"
                          : "")
                      }
                      size={Math.max(6, card.answers[i][0].length + 3)}
                      value={attempt.gaps[i] ?? ""}
                      readOnly={revealed}
                      onChange={(e) => {
                        const v = e.target.value;
                        setAttempt((a) => {
                          const gaps = [...a.gaps];
                          gaps[i] = v;
                          return { ...a, gaps };
                        });
                      }}
                      onKeyDown={enter}
                      aria-label={`Gap ${i + 1}`}
                      autoCapitalize="off"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  ) : revealed ? (
                    <mark className="gapfill">{card.answers[i][0]}</mark>
                  ) : (
                    <span className="gapblank" aria-label="gap" />
                  ))}
              </span>
            ))}
          </p>
        )}
        {card.kind === "choice" && (
          <ol className="choiceopts">
            {card.options.map((o, i) => {
              const right = checkChoice(i, card.answer);
              const cls =
                "choiceopt" +
                (revealed && right ? " ok" : "") +
                (revealed && attempt.choice === i && !right ? " bad" : "");
              return (
                <li key={i}>
                  <button type="button" className={cls} onClick={() => onPick(i)} disabled={revealed}>
                    <span className="optkey">{i + 1}</span>
                    <span className="opttext">{o}</span>
                    {revealed && right && <Check size={16} aria-hidden />}
                    {revealed && attempt.choice === i && !right && <X size={16} aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {card.kind === "write" && (
          <>
            <p className="prompt">{card.prompt}</p>
            {typeAnswers && (
              <textarea
                ref={(el) => void (firstInput.current = el)}
                className={
                  "wfull" + (revealed && attempt.text.trim() ? (checkFill(attempt.text, card.answers) ? " ok" : " bad") : "")
                }
                rows={2}
                value={attempt.text}
                readOnly={revealed}
                onChange={(e) => {
                  const v = e.target.value;
                  setAttempt((a) => ({ ...a, text: v }));
                }}
                onKeyDown={enter}
                aria-label="Your answer"
                autoCapitalize="off"
                spellCheck={false}
              />
            )}
          </>
        )}
        {card.kind === "match" && <p className="prompt">{card.left}</p>}
      </div>
      {revealed && <UnitBack card={card} attempt={attempt} typeAnswers={typeAnswers} />}
    </>
  );
}

function UnitBack({ card, attempt, typeAnswers }: { card: UnitCard; attempt: Attempt; typeAnswers: boolean }) {
  switch (card.kind) {
    case "cloze":
      if (!typeAnswers) return null; // the answers are filled into the sentence
      return (
        <div className="cardback">
          <span className="variants">
            {card.answers.map((vs, i) => (
              <span key={i} className="keyline">
                {card.answers.length > 1 && <span className="gapno">{i + 1}</span>}
                {vs.map((v, j) => (
                  <span key={j} className={checkFill(attempt.gaps[i] ?? "", [v]) ? "ok" : undefined}>
                    {j > 0 && " / "}
                    {v}
                  </span>
                ))}
              </span>
            ))}
          </span>
        </div>
      );
    case "write":
      return (
        <div className="cardback">
          <span className="variants">
            {card.answers.map((v, j) => (
              <span key={j} className={typeAnswers && checkFill(attempt.text, [v]) ? "ok" : undefined}>
                {j > 0 && <br />}
                {v}
              </span>
            ))}
          </span>
        </div>
      );
    case "match":
      return (
        <div className="cardback">
          <span className="variants">{card.right}</span>
        </div>
      );
    case "choice":
      return null; // marked on the options
  }
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
      <button
        type="button"
        className="wordspeak"
        onClick={() => void speak(word.word, word.audio)}
        aria-label={`Listen: ${word.word}`}
      >
        <Volume2 size={16} aria-hidden />
      </button>
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

function CardLinks({ r }: { r: ResolvedCard }) {
  if (r.type === "word")
    return (
      <button type="button" className="linkbtn" onClick={() => openWordEditor({ id: r.word.id })}>
        <PencilLine size={15} aria-hidden /> Edit word
      </button>
    );
  const book = bookById(r.card.book);
  if (!book) return null;
  return (
    <>
      <a className="linkbtn" href={rulesHash(book, r.card.unit)}>
        <BookOpenText size={15} aria-hidden /> Rule
      </a>
      <a className="linkbtn" href={bookHash(book, { kind: "unit", n: r.card.unit })}>
        <PencilLine size={15} aria-hidden /> Exercise {r.card.exercise}
      </a>
    </>
  );
}
