// A unit's lesson (src/lesson.ts): the header with the unit's sticker, its
// goals and reading time, then the opening blocks and the lettered sections.
// Every block kind has its own frame — a scene with speech bubbles, an index
// card, a sticky note, form tables, a timeline — so the page reads as a
// notebook spread, not a wall of text. The words are the book's language
// (book.lang): the red book's lessons are in Russian, the blue one's in English.

import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Check, Clock3, Eye } from "lucide-react";
import type { Book } from "../books";
import { useBook } from "../bookContext";
import type { Block, Lesson, Text, TimeMark } from "../lesson";
import { bookHash } from "../routes";

const LABELS = {
  en: {
    unit: "Unit",
    goals: "In this lesson",
    minutes: (n: number) => `${n} min read`,
    rule: "The rule",
    note: "Remember",
    trap: "Watch out!",
    examples: "Examples",
    words: "Words to know",
    quiz: "Check yourself",
    show: "Show",
    summary: "In a nutshell",
    seealso: "See also",
    past: "past",
    now: "now",
    future: "future",
    practice: "Practice",
    lesson: "Lesson",
    soon: "The lesson for this unit is still being written. The exercises are ready below.",
  },
  ru: {
    unit: "Урок",
    goals: "В этом уроке",
    minutes: (n: number) => `${n} мин чтения`,
    rule: "Правило",
    note: "Запомните",
    trap: "Осторожно!",
    examples: "Примеры",
    words: "Слова",
    quiz: "Проверьте себя",
    show: "Ответ",
    summary: "Коротко",
    seealso: "См. также",
    past: "прошлое",
    now: "сейчас",
    future: "будущее",
    practice: "Практика",
    lesson: "Теория",
    soon: "Теория к этому уроку ещё пишется. Упражнения — ниже.",
  },
} as const;

export type Labels = (typeof LABELS)[keyof typeof LABELS];
export const labelsFor = (book: Book): Labels => LABELS[book.lang] ?? LABELS.en;

// ---- text -------------------------------------------------------------------------

export function Runs({ t }: { t: Text }): ReactNode {
  const book = useBook();
  return t.map((r, i) => {
    if (typeof r === "string") return r;
    if ("u" in r)
      return (
        <a key={i} className="lunitlink" href={bookHash(book, { kind: "unit", n: r.u })}>
          <Runs t={r.c} />
        </a>
      );
    const inner = <Runs t={r.c} />;
    switch (r.s) {
      case "hl":
        return (
          <mark key={i} className="lhl">
            {inner}
          </mark>
        );
      case "b":
        return <strong key={i}>{inner}</strong>;
      case "i":
        return <em key={i}>{inner}</em>;
      case "x":
        return (
          <s key={i} className="lwrong">
            {inner}
          </s>
        );
    }
  });
}

// ---- the lesson --------------------------------------------------------------------

/** The unit's heading: the sticker, the title and, with a lesson, its hook. */
export function UnitHead({
  n,
  title,
  lesson,
  done,
}: {
  n: number;
  title: string;
  lesson?: Lesson;
  done?: ReactNode;
}) {
  const L = labelsFor(useBook());
  return (
    <header className="lessonhead">
      <span className="lessonsticker" aria-hidden>
        <span className="stickerword">{L.unit}</span>
        <span className="stickernum">{n}</span>
      </span>
      <div className="lessonheadtext">
        <h2 className="unitheading">
          <span className="visually-hidden">
            {L.unit} {n} —{" "}
          </span>
          {title}
          {done}
        </h2>
        {lesson?.hook && (
          <p className="lessonhook">
            <Runs t={lesson.hook} />
          </p>
        )}
      </div>
    </header>
  );
}

export function LessonBody({ lesson }: { lesson: Lesson }) {
  const L = labelsFor(useBook());
  return (
    <div className="lesson">
      {lesson.goals.length > 0 && (
        <div className="lessongoals">
          <span className="goalslabel">{L.goals}</span>
          <ul>
            {lesson.goals.map((g, i) => (
              <li key={i}>
                <Runs t={g} />
              </li>
            ))}
          </ul>
          <span className="readtime">
            <Clock3 size={13} aria-hidden /> {L.minutes(lesson.minutes)}
          </span>
        </div>
      )}
      {lesson.intro.length > 0 && <Blocks blocks={lesson.intro} L={L} />}
      {lesson.sections.map((s, i) => (
        <section key={i} className="lsection" data-tint={i % 4}>
          <h3 className="lsectionhead">
            <span className="lletter" aria-hidden>
              {s.letter}
            </span>
            <span>
              <Runs t={s.title} />
            </span>
          </h3>
          <Blocks blocks={s.blocks} L={L} />
        </section>
      ))}
    </div>
  );
}

/** Where a unit without its lesson yet says so. */
export function LessonSoon() {
  const L = labelsFor(useBook());
  return <p className="lessonsoon">✍️ {L.soon}</p>;
}

/** The line between the lesson and the exercises. */
export function PracticeDivider({ id }: { id: string }) {
  const L = labelsFor(useBook());
  return (
    <div className="practicediv" id={id}>
      <span>✏️ {L.practice}</span>
    </div>
  );
}

function Blocks({ blocks, L }: { blocks: Block[]; L: Labels }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} L={L} />
      ))}
    </>
  );
}

function Title({ t, fallback, icon }: { t?: Text; fallback?: string; icon?: string }) {
  if (!t && !fallback && !icon) return null;
  return (
    <p className="lblocktitle">
      {icon && (
        <span className="lblockicon" aria-hidden>
          {icon}
        </span>
      )}
      {t ? <Runs t={t} /> : fallback}
    </p>
  );
}

function Paras({ ps }: { ps: Text[] }) {
  return (
    <>
      {ps.map((p, i) => (
        <p key={i}>
          <Runs t={p} />
        </p>
      ))}
    </>
  );
}

function BlockView({ b, L }: { b: Block; L: Labels }): ReactNode {
  switch (b.k) {
    case "p":
      return (
        <p className="lp">
          <Runs t={b.t} />
        </p>
      );
    case "scene":
      return <Scene b={b} />;
    case "rule":
      return (
        <div className="lrule">
          <Title t={b.title} icon={b.icon} fallback={b.title ? undefined : L.rule} />
          <Paras ps={b.body} />
        </div>
      );
    case "note":
      return (
        <aside className="lnote">
          <span className="ltape" aria-hidden />
          <Title t={b.title} icon={b.icon ?? "💡"} fallback={L.note} />
          <Paras ps={b.body} />
        </aside>
      );
    case "form":
      return (
        <div className="lform">
          {b.title && <Title t={b.title} />}
          <div className="lformtables">
            {b.tables.map((t, i) => (
              <table key={i} className="lformtable">
                {t.head && (
                  <caption>
                    <Runs t={t.head} />
                  </caption>
                )}
                <tbody>
                  {t.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className={k === 0 && r.length > 1 ? "lsubj" : undefined}>
                          <Runs t={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      );
    case "examples":
      return (
        <div className="lexamples">
          <Title t={b.title} icon={b.icon} fallback={b.title || b.icon ? undefined : L.examples} />
          <ul>
            {b.items.map((x, i) => (
              <li key={i}>
                <span className="lex">
                  <Runs t={x.t} />
                </span>
                {x.gloss && (
                  <span className="lgloss">
                    <Runs t={x.gloss} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      );
    case "compare":
      return (
        <div className="lcompare">
          {b.title && <Title t={b.title} />}
          <div className="lcols" style={{ "--cols": b.cols.length } as CSSProperties}>
            {b.cols.map((c, i) => (
              <div key={i} className={"lcol" + (c.tone ? ` ${c.tone}` : "")}>
                <p className="lcolhead">
                  {c.tone === "good" && <span aria-label="right">✓ </span>}
                  {c.tone === "bad" && <span aria-label="wrong">✗ </span>}
                  <Runs t={c.head} />
                </p>
                <ul>
                  {c.items.map((x, j) => (
                    <li key={j}>
                      <Runs t={x} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );
    case "timeline":
      return <Timeline title={b.title} marks={b.marks} L={L} />;
    case "trap":
      return (
        <div className="ltrap">
          <Title t={b.title} icon="⚠️" fallback={L.trap} />
          <div className="ltrappairs">
            {b.pairs.map((p, i) => (
              <div key={i} className="ltrappair">
                {p.bad && (
                  <span className="lbad">
                    <span className="lmark" aria-label="wrong">
                      ✗
                    </span>{" "}
                    <s>
                      <Runs t={p.bad} />
                    </s>
                  </span>
                )}
                <span className="lgood">
                  <span className="lmark" aria-label="right">
                    ✓
                  </span>{" "}
                  <Runs t={p.good} />
                </span>
              </div>
            ))}
          </div>
          <Paras ps={b.body} />
        </div>
      );
    case "words":
      return (
        <div className="lwords">
          <Title t={b.title} icon={b.icon} fallback={b.title || b.icon ? undefined : L.words} />
          <ul>
            {b.items.map((w, i) => (
              <li key={i}>
                <Runs t={w} />
              </li>
            ))}
          </ul>
        </div>
      );
    case "cards":
      return (
        <div className="lcards">
          {b.cards.map((c, i) => (
            <div key={i} className="lcard">
              {c.icon && (
                <span className="lcardicon" aria-hidden>
                  {c.icon}
                </span>
              )}
              <p className="lcardtitle">
                <Runs t={c.title} />
              </p>
              <Paras ps={c.body} />
            </div>
          ))}
        </div>
      );
    case "quiz":
      return (
        <div className="lquiz">
          <Title t={b.title} icon="🤔" fallback={L.quiz} />
          <ol>
            {b.items.map((x, i) => (
              <QuizItem key={i} q={x.q} a={x.a} L={L} />
            ))}
          </ol>
        </div>
      );
    case "summary":
      return (
        <div className="lsummary">
          <Title t={b.title} icon="📌" fallback={L.summary} />
          <ul>
            {b.items.map((x, i) => (
              <li key={i}>
                <Check size={16} strokeWidth={3} aria-hidden className="lsumcheck" />
                <span>
                  <Runs t={x} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "seealso":
      return <SeeAlso items={b.items} L={L} />;
    case "row":
      return (
        <div className="lrow">
          {b.blocks.map((x, i) => (
            <div key={i} className="lrowcell">
              <BlockView b={x} L={L} />
            </div>
          ))}
        </div>
      );
  }
}

function Scene({ b }: { b: Extract<Block, { k: "scene" }> }) {
  // the first speaker talks from the left, the next from the right
  const sides = new Map<string, number>();
  for (const l of b.lines) if (l.who && !sides.has(l.who)) sides.set(l.who, sides.size % 2);
  return (
    <figure className="lscene">
      {b.icon && (
        <span className="lsceneicon" aria-hidden>
          {b.icon}
        </span>
      )}
      <div className="lscenebody">
        {b.title && (
          <figcaption className="lscenetitle">
            <Runs t={b.title} />
          </figcaption>
        )}
        {b.lines.map((l, i) =>
          l.who !== undefined ? (
            <div key={i} className={"lbubble" + (sides.get(l.who) ? " right" : "")}>
              {l.who && <span className="lwho">{l.who}</span>}
              <span className="lsaid">
                <Runs t={l.t} />
              </span>
            </div>
          ) : (
            <p key={i} className="lnarr">
              <Runs t={l.t} />
            </p>
          ),
        )}
      </div>
    </figure>
  );
}

function QuizItem({ q, a, L }: { q: Text; a: Text; L: Labels }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={"lquizitem" + (open ? " open" : "")}>
      <span className="lq">
        <Runs t={q} />
      </span>
      {open ? (
        <span className="la">
          <Runs t={a} />
        </span>
      ) : (
        <button type="button" className="lshow" onClick={() => setOpen(true)}>
          <Eye size={14} aria-hidden /> {L.show}
        </button>
      )}
    </li>
  );
}

function SeeAlso({ items, L }: { items: { unit: number; t: Text }[]; L: Labels }) {
  const book = useBook();
  return (
    <nav className="lseealso" aria-label={L.seealso}>
      <span className="lseelabel">{L.seealso}</span>
      {items.map((x, i) => (
        <a key={i} className="lseechip" href={bookHash(book, { kind: "unit", n: x.unit })}>
          <span className="lseenum">{x.unit}</span>
          <Runs t={x.t} />
        </a>
      ))}
    </nav>
  );
}

/**
 * A time axis: past on the left, now in the middle, future on the right, each
 * mark on a lane of its own over it — a dot for a moment, a bar for a stretch
 * of time, a row of ticks for a habit, an arrow for a change.
 */
function Timeline({ title, marks, L }: { title?: Text; marks: TimeMark[]; L: Labels }) {
  return (
    <figure className="ltimeline">
      {title && <Title t={title} icon="🕰️" />}
      <div className="ltlanes">
        <span className="ltnow" aria-hidden />
        {marks.map((m, i) => (
          <div key={i} className="ltlane">
            <TimeMarkView m={m} />
          </div>
        ))}
        <div className="ltaxis" aria-hidden>
          <span>← {L.past}</span>
          <span className="ltnowlabel">{L.now}</span>
          <span>{L.future} →</span>
        </div>
      </div>
    </figure>
  );
}

function TimeMarkView({ m }: { m: TimeMark }) {
  const mid = (m.from + m.to) / 2;
  const label = m.label && (
    <span
      className="ltlabel"
      style={{ left: `${Math.min(88, Math.max(12, mid))}%` }}
    >
      <Runs t={m.label} />
    </span>
  );
  const width = Math.max(0, m.to - m.from);
  switch (m.kind) {
    case "point":
      return (
        <>
          <span className="ltdot" style={{ left: `${m.from}%` }} />
          {label}
        </>
      );
    case "span":
      return (
        <>
          <span className="ltbar" style={{ left: `${m.from}%`, width: `${width}%` }} />
          {label}
        </>
      );
    case "arrow":
      return (
        <>
          <span className="ltarrow" style={{ left: `${m.from}%`, width: `${width}%` }} />
          {label}
        </>
      );
    case "repeat": {
      const n = Math.max(3, Math.round(width / 7));
      return (
        <>
          {Array.from({ length: n }, (_, i) => (
            <span
              key={i}
              className="lttick"
              style={{ left: `${m.from + (width * (i + 0.5)) / n}%` }}
            />
          ))}
          {label}
        </>
      );
    }
  }
}
