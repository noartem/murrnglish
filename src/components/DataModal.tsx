// The one window for everything this browser holds: the books' progress —
// every book, not just the one you are in — and the file or link that moves
// it. The books lead, each with its mosaic of units and the numbers behind it;
// then the cards and the words, ticked or not. Import / Export / share act on
// what is ticked. One window, open from every view (globalUi.ts), which is
// where the course's own progress window went: its overview is the top half
// of this one.
//
// Nothing is written on import — or from an incoming share link — until
// Apply: what arrived is summarised first, so a learner sees it before it
// touches their work.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Check, Download, Share2, Upload, X } from "lucide-react";
import { BOOKS, bookById } from "../books";
import type { Book } from "../books";
import type { IndexData, TotalsMap } from "../data";
import { fetchIndexOnce, fetchTotalsOnce } from "../data";
import { loadDecks } from "../deckdata";
import type { Incoming, Targets } from "../datatransfer";
import { makeDataFile, parseIncoming } from "../datatransfer";
import { clearIncoming, closeGlobal, globalHints, useGlobalModal, useIncoming } from "../globalUi";
import type { Progress } from "../progress";
import {
  completedUnitIds,
  countCorrect,
  hasProgress,
  loadProgress,
  pct,
  progressPayload,
  saveProgress,
  scopeStats,
  subscribeProgress,
} from "../progress";
import { parseRoute } from "../routes";
import { importSrs, importWords, srsConfig, useStudy } from "../study";
import { dayNumber } from "../srs";
import { encodeShare } from "../share";

/**
 * One row of the window: a checkbox and what ticking it carries, plus — in
 * hint mode — the letter that clicks it. `hint` is the control's own access
 * key: the letter its label carries, which the key press and the DOM
 * attribute both name, so the dispatcher needs no table of its own.
 */
function Row({
  checked,
  onChange,
  title,
  hint,
  hints,
  detail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  /** the access letter, when the control has one */
  hint?: string;
  /** a key opened the window: mark the letter */
  hints: boolean;
  detail?: string;
}) {
  return (
    <label className="modal-opt" data-modal-key={hint && keyOf(hint)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <HintText text={title} letter={hints && hint ? hint : null} />
      {detail && <span className="modal-optdetail">{detail}</span>}
    </label>
  );
}

/** An access letter as the KeyboardEvent.code that presses it. */
function keyOf(letter: string): string {
  return `Key${letter.toUpperCase()}`;
}

/** The date the exports are stamped with: the day they were made. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Hand a JSON file to the browser under `name` (without the extension). */
function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The book a share link carries: the one the learner is in when it is among
 * the ticked ones, else the first ticked. Null with nothing ticked — there
 * would be no progress to put in a link.
 */
function shareBookId(ids: string[]): string | null {
  if (!ids.length) return null;
  const route = parseRoute(window.location.hash, BOOKS);
  return route.view === "book" && ids.includes(route.book.id) ? route.book.id : ids[0];
}
/**
 * The letters the fixed controls hold — cards, dictionary, answers, Import,
 * Export, share, learning state — so a book's never collides with one of
 * them. Each control names its own letter next to its label; this is the
 * reservation, not a second source of truth.
 */
const HELD = new Set(["c", "d", "a", "i", "e", "s", "l"]);

/**
 * A book's letter, from its own title: the first free letter of the word
 * after the colon — "English Grammar: Foundations" answers to F, "English
 * Grammar: Progress" to P, and that P is free because F was taken first. A
 * title left with no free letter gets none, and its row is clicked instead.
 */
const BOOK_HINTS: Record<string, string> = (() => {
  const taken = new Set(HELD);
  const out: Record<string, string> = {};
  for (const book of BOOKS) {
    const name = book.title.slice(book.title.lastIndexOf(":") + 1);
    const letter = [...name].find((c) => /[a-z]/i.test(c) && !taken.has(c.toLowerCase()));
    if (!letter) continue;
    out[book.id] = letter;
    taken.add(letter.toLowerCase());
  }
  return out;
})();

/** What the read file — or the link — carries, one line per target it carries. */
function incomingSummary(read: Incoming): string[] {
  if (read.kind === "study") {
    const cards = Object.keys(read.backup.srs.states).length;
    return [
      `Cards: ${read.backup.words.length} word${read.backup.words.length === 1 ? "" : "s"}, ${cards} reviewed cards`,
    ];
  }
  if (read.kind === "progress") {
    const book = read.book ? bookById(read.book) : undefined;
    // a share link names its book: what it carries, of this course
    if (book) {
      const done = completedUnitIds(read.progress).size;
      const cc = countCorrect(read.progress);
      const answers = Object.keys(read.progress.answers).length;
      return [
        `Incoming from a link: ${book.title} — units completed ${done}/${book.units}, answers correct ${cc.correct}/${cc.total}`,
        answers > 0 ? `Includes ${answers} answer texts` : "Completion facts only — no answer texts",
      ];
    }
    return ["One book's progress — it goes into the course you are in"];
  }
  const lines: string[] = [];
  for (const [id, p] of Object.entries(read.file.books)) {
    const book = bookById(id);
    const done = completedUnitIds(p).size;
    lines.push(
      book ? `${book.title}: ${done}/${book.units} units done` : `Book "${id}": not in this app`,
    );
  }
  if (read.file.cards) {
    const cards = Object.keys(read.file.cards.srs.states).length;
    lines.push(`Cards: ${cards} reviewed card${cards === 1 ? "" : "s"}`);
  }
  if (read.file.dictionary) {
    const n = read.file.dictionary.words.length;
    lines.push(`Dictionary: ${n} word${n === 1 ? "" : "s"}`);
  }
  // a report to read, never applied — the schedule itself moves under cards
  if (read.file.learning) {
    const t = read.file.learning.totals;
    lines.push(
      `Learning report: ${t.cards} card${t.cards === 1 ? "" : "s"}, ${t.learned} learned, ${t.dueToday} due today`,
    );
  }
  return lines.length ? lines : ["Nothing in this file"];
}

/** Apply what arrived. Returns what changed, for the status line. */
function applyIncoming(read: Incoming): string {
  if (read.kind === "study") {
    const w = importWords(read.backup.words);
    const s = importSrs(read.backup.srs);
    return `Applied: ${w.added} new word${w.added === 1 ? "" : "s"}, ${w.updated} updated, ${s.cards} card${s.cards === 1 ? "" : "s"} with newer reviews`;
  }
  if (read.kind === "progress") {
    // a share link names its book; a bare progress file names no book, so it
    // belongs to the course you are in
    const route = parseRoute(window.location.hash, BOOKS);
    const id = read.book ?? (route.view === "book" ? route.book.id : "");
    const book = id ? bookById(id) : undefined;
    if (!book) return "A progress file belongs to a book — open one of the two courses first";
    saveProgress(book.id, read.progress, 0);
    return `Applied to ${book.title}`;
  }
  const parts: string[] = [];
  for (const [id, p] of Object.entries(read.file.books)) {
    const book = bookById(id);
    if (!book) continue;
    saveProgress(id, p, 0);
    parts.push(`${book.title} — ${completedUnitIds(p).size} units done`);
  }
  if (read.file.cards) {
    const s = importSrs(read.file.cards.srs);
    parts.push(`${s.cards} card${s.cards === 1 ? "" : "s"} with newer reviews`);
  }
  if (read.file.dictionary) {
    const w = importWords(read.file.dictionary.words);
    parts.push(`${w.added} new word${w.added === 1 ? "" : "s"}, ${w.updated} updated`);
  }
  return parts.length ? `Applied: ${parts.join(" · ")}` : "Nothing in this file to apply";
}
export function DataModal(): JSX.Element | null {
  // one app-wide window at a time: the help window and the book picker
  // close this one rather than opening beside it
  const open = useGlobalModal() === "data";
  // a book with any progress in it is what a learner wants out of this
  // window, so it starts ticked. The choice is made on the window's first
  // open, not on mount: the app boots long before anyone opens this, and
  // progress lands in between. Unticking afterwards is theirs to make, and
  // stays made.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const firstOpen = useRef(false);
  useEffect(() => {
    if (!open || firstOpen.current) return;
    firstOpen.current = true;
    setTicked((t) => {
      const next = { ...t };
      for (const book of BOOKS) if (hasProgress(loadProgress(book.id))) next[book.id] = true;
      return next;
    });
  }, [open]);
  const [withAnswers, setWithAnswers] = useState(true);
  // what is waiting to be written: the file the learner picked, or the
  // progress a share link carries. One at a time, and a picked file replaces
  // a link the window was already holding.
  const [file, setFile] = useState<Incoming | null>(null);
  const link = useIncoming();
  const incoming = file ?? link;
  // status line: seq re-keys the node so the entry animation (fade, plus the
  // copy-shake) replays even when the same text is set twice in a row.
  const [msg, setMsgState] = useState<{ text: string; shake: boolean; seq: number }>({
    text: "",
    shake: false,
    seq: 0,
  });
  const [msgLeaving, setMsgLeaving] = useState(false);
  const setMsg = (text: string, shake = false) => {
    setMsgLeaving(false);
    setMsgState((m) => ({ text, shake, seq: m.seq + 1 }));
  };
  // exit: the window stays mounted under .closing while modal-out plays, then
  // drops from the DOM. closing is derived from open (not set in an effect),
  // so the class lands in the same commit as open=false — unmounting first
  // would flash the backdrop away and back.
  const [shown, setShown] = useState(open);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // one book mosaic: its index (which units it has) and its totals (how many
  // answers each holds). Fetched the first time the window opens and kept, so
  // reopening costs nothing; a book whose index never arrived — offline, not
  // downloaded — is asked again the next time.
  const [meta, setMeta] = useState<Record<string, { index: IndexData; totals: TotalsMap | null }>>({});
  const asked = useRef(new Set<string>());

  // closing drops what the window was holding: a dismissed file or link must
  // not come back on the next open
  const dismiss = useCallback(() => {
    setFile(null);
    clearIncoming();
    closeGlobal();
  }, []);

  // a write that lands while the window is open — applied here, or by the
  // course behind it — must reach the mosaics without another click: the bump
  // re-reads localStorage, which is where progressOf() gets the progress
  const [, afterWrite] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!open) return;
    return subscribeProgress(afterWrite);
  }, [open]);

  // Esc closes while open; the close button takes focus for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 150);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // the learning report names its decks, so the decks come in with the
    // window: by the time Export is pressed they are there, and the click is
    // still the browser's own download
    void loadDecks().catch(() => {
      /* offline: the report falls back to naming cards by their id */
    });
    let alive = true;
    for (const book of BOOKS) {
      if (asked.current.has(book.id)) continue;
      asked.current.add(book.id);
      void Promise.all([fetchIndexOnce(book), fetchTotalsOnce(book).catch(() => null)]).then(
        ([index, totals]) => {
          if (!alive) return;
          setMeta((m) => (m[book.id] ? m : { ...m, [book.id]: { index, totals } }));
        },
        () => {
          asked.current.delete(book.id); // no index yet (offline): ask again next open
        },
      );
    }
    return () => {
      alive = false;
    };
  }, [open]);

  // what the cards row carries, in the learner's terms: the same counts the
  // learning-state export reports, read straight off the store
  const study = useStudy();
  const cardsDetail = useMemo(() => {
    const cfg = srsConfig(study.settings);
    const studyDay = dayNumber(Date.now(), cfg);
    let learned = 0;
    let due = 0;
    for (const s of Object.values(study.srs.states)) {
      if (s.kind !== "review") continue;
      learned++;
      if (dayNumber(s.due, cfg) <= studyDay) due++;
    }
    const suspended = study.srs.suspended.length;
    if (!learned && !suspended) return "";
    return (
      `${learned} learned · ${due} due today` +
      (suspended ? ` · ${suspended} suspended` : "")
    );
  }, [study.srs, study.settings]);

  // result message auto-clears: fade out, then drop the text once the
  // 0.18s leave animation has played (so the line doesn't blink away)
  useEffect(() => {
    if (!msg.text) return;
    const hide = setTimeout(() => setMsgLeaving(true), 6000);
    const drop = setTimeout(() => {
      setMsgState((m) => ({ ...m, text: "" }));
      setMsgLeaving(false);
    }, 6180);
    return () => {
      clearTimeout(hide);
      clearTimeout(drop);
    };
  }, [msg]);


  const targets: Targets = useMemo(
    () => ({
      books: BOOKS.filter((b) => ticked[b.id]).map((b) => b.id),
      includeAnswers: withAnswers,
      cards: Boolean(ticked.cards),
      dictionary: Boolean(ticked.dictionary),
      learning: Boolean(ticked.learning),
    }),
    [ticked, withAnswers],
  );

  if (!shown) return null;
  const closing = !open;
  const hints = globalHints();
  // a link carries one book's progress: with several ticked it carries the
  // one the learner is in, and failing that the first of them
  const shareBook = shareBookId(targets.books);
  // an incoming share link shows the book it names instead of the stored
  // progress, so the window previews exactly what Apply would write
  const progressOf = (book: Book): Progress =>
    incoming?.kind === "progress" && incoming.book === book.id
      ? incoming.progress
      : loadProgress(book.id);

  async function share() {
    if (!shareBook) return;
    try {
      const code = await encodeShare(progressPayload(loadProgress(shareBook), withAnswers));
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}#/${shareBook}/p=${code}`,
      );
      setMsg("Link copied — " + (bookById(shareBook)?.title ?? ""), true);
    } catch {
      setMsg("Could not copy — the browser blocked the clipboard", true);
    }
  }

  function exportFile() {
    if (!targets.books.length && !targets.cards && !targets.dictionary && !targets.learning) {
      setMsg("Nothing selected — tick what to export");
      return;
    }
    const file = makeDataFile(targets, Date.now());
    downloadJson(`murrnglish-data-${today()}`, file);
    const learning = file.learning;
    setMsg(
      learning
        ? learning.totals.cards
          ? `File downloaded — ${learning.totals.cards} card${learning.totals.cards === 1 ? "" : "s"} in the learning report, ${learning.totals.dueToday} due today`
          : "File downloaded — nothing has been learned yet, the learning report is empty"
        : "File downloaded",
    );
  }

  function apply() {
    if (!incoming) return;
    setMsg(applyIncoming(incoming));
    setFile(null);
    clearIncoming();
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // the same file can be picked again
    if (!f) return;
    let text: string;
    try {
      text = await f.text();
    } catch {
      setMsg("Could not read the file", true);
      return;
    }
    const found = parseIncoming(text);
    if (!found) {
      setMsg("Not a Murrnglish file", true);
      return;
    }
    clearIncoming();
    setFile(found);
  }

  return (
    <div className={"modal-overlay" + (closing ? " closing" : "")} onClick={dismiss}>
      <div
        className={"modal" + (closing ? " closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Progress and data"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Progress and data</h2>
          <button ref={closeRef} className="themebtn" onClick={dismiss} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <div className="modal-summary">
          Everything here lives in this browser only. How far each book has come, then what to
          move: tick the targets and Import, Export or share act on them.
        </div>
        <OverlayScrollbarsComponent
          className="modal-body"
          options={{
            overflow: { x: "hidden" as const },
            scrollbars: {
              theme: "os-theme-dark",
              autoHide: "leave" as const,
              autoHideDelay: 500,
            },
          }}
        >
          <div className="modal-subhead">Progress</div>
          {BOOKS.map((book) => {
            const progress = progressOf(book);
            const cc = countCorrect(progress);
            return (
              <div className="databook" key={book.id}>
                <Row
                  checked={Boolean(ticked[book.id])}
                  onChange={(v) => setTicked((t) => ({ ...t, [book.id]: v }))}
                  title={book.title}
                  hint={BOOK_HINTS[book.id]}
                  hints={hints}
                  detail={`${completedUnitIds(progress).size}/${book.units} units done · ${cc.correct}/${cc.total} answers correct`}
                />
                {meta[book.id] && (
                  <UnitGrid
                    index={meta[book.id].index}
                    totals={meta[book.id].totals}
                    progress={progress}
                  />
                )}
              </div>
            );
          })}
          <div className="modal-subhead">What to move</div>
          <Row
            checked={Boolean(ticked.cards)}
            onChange={(v) => setTicked((t) => ({ ...t, cards: v }))}
            title="Cards — which cards are learned, and when they come back"
            hint="C"
            hints={hints}
            detail={cardsDetail}
          />
          <Row
            checked={Boolean(ticked.dictionary)}
            onChange={(v) => setTicked((t) => ({ ...t, dictionary: v }))}
            title="Dictionary — your words"
            hint="D"
            hints={hints}
          />
          <Row
            checked={withAnswers}
            onChange={setWithAnswers}
            title="Include answer texts in the books"
            hint="A"
            hints={hints}
            detail="the answers you typed into the exercises"
          />
          <Row
            checked={Boolean(ticked.learning)}
            onChange={(v) => setTicked((t) => ({ ...t, learning: v }))}
            title="Learning state — what is learned and what comes back"
            hint="L"
            hints={hints}
            detail="a report to read, not to import"
          />
        </OverlayScrollbarsComponent>
        <div className="modal-actions">
          <button
            className="themebtn"
            data-modal-key={keyOf("I")}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} aria-hidden /> <HintText text="Import" letter={hints ? "I" : null} />
          </button>
          <button className="themebtn" data-modal-key={keyOf("E")} onClick={exportFile}>
            <Download size={14} aria-hidden /> <HintText text="Export" letter={hints ? "E" : null} />
          </button>
          <button
            className="themebtn"
            data-modal-key={keyOf("S")}
            disabled={!shareBook}
            title={
              shareBook
                ? "A link with one book's progress — " + (bookById(shareBook)?.title ?? "")
                : "Tick a book to share its progress"
            }
            onClick={() => void share()}
          >
            <Share2 size={14} aria-hidden />{" "}
            <HintText text="Copy share link" letter={hints ? "S" : null} />
          </button>
        </div>
        {incoming && (
          <>
            <div className="modal-summary">
              {incomingSummary(incoming).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="themebtn primary" onClick={apply}>
                <Check size={14} aria-hidden /> Apply
              </button>
            </div>
          </>
        )}
        <div className="modal-msg" role="status">
          {msg.text && (
            <span
              key={msg.seq}
              className={"msgtext" + (msg.shake ? " shake" : "") + (msgLeaving ? " leaving" : "")}
            >
              {msg.text}
            </span>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pickFile} />
      </div>
    </div>
  );
}

/** One book's mosaic: a square per unit, then per additional exercise. */
function UnitGrid({
  index,
  totals,
  progress,
}: {
  index: IndexData;
  totals: TotalsMap | null;
  progress: Progress;
}): JSX.Element {
  const done = useMemo(() => completedUnitIds(progress), [progress]);
  return (
    <div className="unitgrid">
      {index.groups.flatMap((g) => g.units).map((u) => {
        const p = pct(scopeStats(totals, [`u${u}`], progress));
        return (
          <Square
            key={u}
            done={done.has(u)}
            p={p}
            title={`Unit ${u}${p > 0 ? ` — ${p}%` : ""}`}
          />
        );
      })}
      {index.additional.exercises.map((n) => {
        const p = pct(scopeStats(totals, [`a${n}`], progress));
        return (
          <Square
            key={n}
            done={Boolean(progress.results[String(n)])}
            p={p}
            title={`Additional exercise ${n}${p > 0 ? ` — ${p}%` : ""}`}
          />
        );
      })}
    </div>
  );
}

// One overview square: grey while untouched, the ok fill mixed toward grey by
// its percent while partial, solid ok once done. No label — the color IS the
// information; hover the title for the exact unit.
function Square({ done, p, title }: { done: boolean; p: number; title: string }): JSX.Element {
  const partial = !done && p > 0;
  return (
    <div
      className={done ? "unitsq done" : "unitsq"}
      title={title}
      style={
        partial ? { background: `color-mix(in srgb, var(--ok-solid) ${p}%, var(--track))` } : undefined
      }
    />
  );
}

/**
 * Alt+D and Shift+I open the window in "hint mode": one letter of each
 * control is underlined and pressing that letter does the same as clicking
 * it. The letter is the control's access key (F, P, C, D, A, I, E, S), which
 * is also what the control carries as `data-modal-key`. Everything stays
 * inside ONE inline span: the buttons are flex rows with a 6px gap, so bare
 * text next to the highlighted letter would become its own flex item and push
 * a gap in the middle of the word.
 */
export function HintText({ text, letter }: { text: string; letter: string | null }): JSX.Element {
  const at = letter === null ? -1 : text.toLowerCase().indexOf(letter.toLowerCase());
  return (
    <span>
      {at === -1 ? (
        text
      ) : (
        <>
          {text.slice(0, at)}
          <span className="hintkey">{text[at]}</span>
          {text.slice(at + 1)}
        </>
      )}
    </span>
  );
}