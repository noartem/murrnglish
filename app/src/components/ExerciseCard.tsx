// ExerciseCard: one exercise = instruction, word bank, items, Check / Show answers.

import { useEffect, useState } from "react";
import { Eye, EyeOff, SquareCheckBig } from "lucide-react";
import { SC } from "../shortcuts";
import type { ChoiceItem, Exercise, FillInItem, SelfCheckItem, WriteItem } from "../data";
import {
  checkChoice,
  checkFill,
  checkMatching,
  checkWrite,
} from "../checker";
import {
  ChoiceItemView,
  FillInItemView,
  MarkedPrompt,
  SelfCheckItemView,
  WriteItemView,
} from "./items";
import type { Progress } from "../progress";
import { saveProgress } from "../progress";
import { useBook } from "../bookContext";

interface Props {
  exercise: Exercise;
  progress: Progress;
  setProgress: (fn: (p: Progress) => Progress) => void;
}

type States = (boolean | null)[];

export function ExerciseCard({ exercise, progress, setProgress }: Props) {
  const book = useBook();
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);

  // reset per-exercise transient UI state when navigating between exercises
  useEffect(() => {
    setChecked(false);
    setRevealed(false);
  }, [exercise.id]);

  const answerRecord = (progress.answers[exercise.id] ?? {}) as Record<string, unknown>;

  function updateAnswer(next: Record<string, unknown>) {
    setProgress((p) => ({
      ...p,
      answers: { ...p.answers, [exercise.id]: next },
    }));
  }


  const savedResult = progress.results[exercise.id];

  // ---- type-specific state -------------------------------------------------
  let states: States = [];
  let answerCount = 0;

  if (exercise.type === "fill-in") {
    const items = (exercise.items ?? []) as FillInItem[];
    const gradedItems = items.filter((it) => !it.example && it.answers.length > 0);
    const gradedIdx = new Map(gradedItems.map((it, i) => [it.num, i]));
    const values = (answerRecord.items ?? {}) as Record<string, string[]>;
    const perItem: (boolean | null)[][] = [];
    states = [];
    for (const it of gradedItems) {
      const vals = it.answers.map((_, i) => values[it.num]?.[i] ?? "");
      const st = checked
        ? it.answers.map((vs, i) => checkFill(vals[i], vs))
        : revealed
          ? it.answers.map((vs, i) => checkFill(vals[i], vs) || null)
          : it.answers.map(() => null);
      perItem.push(st);
      states = states.concat(st);
    }
    answerCount = states.length;
    return (
      <section className="exercise" id={`ex-${exercise.id}`}>
        <header>
          <span className="exid">{exercise.id}</span>
          <p className="instruction">{exercise.instruction}</p>
        </header>
        {exercise.wordBank && <WordBank words={exercise.wordBank} />}
        {items.map((it) =>
          it.example || it.answers.length === 0 ? (
            <div key={it.num} className="item exampleitem">
              <span className="itemnum">{it.num}</span>
              <span className="itembody">{it.parts.join("")}</span>
            </div>
          ) : (
            <FillInItemView
              key={it.num}
              item={it}
              values={it.answers.map((_, i) => values[it.num]?.[i] ?? "")}
              onChange={(gi, v) => {
                const cur = { ...values };
                const arr = [...(cur[it.num] ?? it.answers.map(() => ""))];
                arr[gi] = v;
                cur[it.num] = arr;
                updateAnswer({ items: cur });
              }}
              states={perItem[gradedIdx.get(it.num) ?? -1] ?? []}
              revealed={revealed}
            />
          ),
        )}
        <CardActions
          onCheck={() => {
            setChecked(true);
            setProgress((p) => {
              const cur = ((p.answers[exercise.id] ?? {}) as Record<string, unknown>).items as
                Record<string, string[]> | undefined;
              const all = gradedItems.flatMap((it) =>
                it.answers.map((vs, i) => checkFill(cur?.[it.num]?.[i] ?? "", vs)));
              const next = {
                ...p,
                results: { ...p.results, [exercise.id]: { correct: all.filter(Boolean).length, total: all.length } },
              };
              saveProgress(book.id, next);
              return next;
            });
          }}
          onToggleReveal={() => setRevealed((r) => !r)}
          revealed={revealed}
          result={savedResult}
          total={answerCount}
        />
      </section>
    );
  }

  if (exercise.type === "choice") {
    const items = (exercise.items ?? []) as ChoiceItem[];
    const values = (answerRecord.items ?? {}) as Record<string, number>;
    const exNums = new Set<string | number>(exercise.example ?? []);
    const gradedItems = items.filter((it) => !exNums.has(it.num) && !it.example);
    const gradedIdx = new Map(gradedItems.map((it, i) => [it.num, i]));
    states = gradedItems.map((it) =>
      checked
        ? checkChoice(values[it.num] ?? null, it.answer)
        : revealed
          ? checkChoice(values[it.num] ?? null, it.answer) || null
          : null,
    );
    return (
      <section className="exercise" id={`ex-${exercise.id}`}>
        <header>
          <span className="exid">{exercise.id}</span>
          <p className="instruction">{exercise.instruction}</p>
        </header>
        {items.map((it) =>
          exNums.has(it.num) || it.example ? (
            <div key={it.num} className="item exampleitem">
              <span className="itemnum">{it.num}</span>
              <span className="itembody">
                {it.options[Array.isArray(it.answer) ? it.answer[0] : it.answer]}
              </span>
            </div>
          ) : (
            <ChoiceItemView
              key={it.num}
              item={it}
              selected={values[it.num] ?? null}
              onSelect={(i) => {
                updateAnswer({ items: { ...values, [it.num]: i } });
              }}
              state={states[gradedIdx.get(it.num) ?? -1]}
              revealed={revealed}
            />
          ),
        )}
        <CardActions
          onCheck={() => {
            setChecked(true);
            setProgress((p) => {
              const cur = ((p.answers[exercise.id] ?? {}) as Record<string, unknown>).items as
                Record<string, number> | undefined;
              const all = gradedItems.map((it) => checkChoice(cur?.[it.num] ?? null, it.answer));
              const next = {
                ...p,
                results: { ...p.results, [exercise.id]: { correct: all.filter(Boolean).length, total: all.length } },
              };
              saveProgress(book.id, next);
              return next;
            });
          }}
          onToggleReveal={() => setRevealed((r) => !r)}
          revealed={revealed}
          result={savedResult}
          total={states.length}
        />
      </section>
    );
  }

  if (exercise.type === "matching") {
    const left = exercise.leftOptions ?? [];
    const right = exercise.rightOptions ?? [];
    const pairs = exercise.pairs ?? [];
    const sel = (answerRecord.pairs ?? left.map(() => null)) as (number | null)[];
    const st = checked ? checkMatching(sel, pairs) : left.map(() => null);
    return (
      <section className="exercise" id={`ex-${exercise.id}`}>
        <header>
          <span className="exid">{exercise.id}</span>
          <p className="instruction">{exercise.instruction}</p>
        </header>
        <div className="matching">
          <div className="matchcol">
            {left.map((l, i) => {
              const correct = pairs.find(([li]) => li === i)?.[1] ?? null;
              const stCls = st[i] === true ? " ok" : st[i] === false ? " bad" : "";
              return (
                <div key={i} className="matchrow">
                  <span className={"matchleft" + stCls}>{l}</span>
                  {/* phones: the select is an invisible tap target over
                      .matchvalue, which wraps the long chosen sentence that a
                      native closed select would cut off */}
                  <span className={"matchpick" + stCls}>
                    <span className={sel[i] == null ? "matchvalue empty" : "matchvalue"} aria-hidden>
                      {sel[i] == null ? "Choose…" : right[sel[i] as number]}
                    </span>
                    <select
                      value={sel[i] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        const next = [...sel];
                        next[i] = v;
                        updateAnswer({ pairs: next });
                      }}
                    >
                      <option value="">—</option>
                      {right.map((r, ri) => (
                        <option key={ri} value={ri}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </span>
                  {revealed && (
                    <span className={sel[i] === correct ? "variants matchans ok" : "variants matchans"}>
                      {correct !== null ? right[correct] : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <CardActions
          onCheck={() => {
            setChecked(true);
            setProgress((p) => {
              const rec = (p.answers[exercise.id] ?? {}) as Record<string, unknown>;
              const cur = (rec.pairs ?? left.map(() => null)) as (number | null)[];
              const all = checkMatching(cur, pairs);
              const next = {
                ...p,
                results: { ...p.results, [exercise.id]: { correct: all.filter(Boolean).length, total: all.length } },
              };
              saveProgress(book.id, next);
              return next;
            });
          }}
          onToggleReveal={() => setRevealed((r) => !r)}
          revealed={revealed}
          result={savedResult}
          total={st.length}
        />
      </section>
    );
  }

  if (exercise.type === "write") {
    const items = (exercise.items ?? []) as WriteItem[];
    const values = (answerRecord.items ?? {}) as Record<string, string>;
    const examples = new Set<string | number>(exercise.example ?? []);
    const graded = items.filter(
      (it) => !examples.has(it.num) && !it.example && it.answers.length > 0,
    );
    states = graded.map((it) =>
      checked
        ? checkWrite(values[it.num] ?? "", it.answers)
        : revealed
          ? checkWrite(values[it.num] ?? "", it.answers) || null
          : null,
    );
    return (
      <section className="exercise" id={`ex-${exercise.id}`}>
        <header>
          <span className="exid">{exercise.id}</span>
          <p className="instruction">{exercise.instruction}</p>
        </header>
        {items.map((it) =>
          examples.has(it.num) || it.example || it.answers.length === 0 ? (
            <div key={it.num} className="item exampleitem">
              <span className="itemnum">{it.num}</span>
              <span className="itembody">
                <span className="prompt"><MarkedPrompt text={it.prompt} /></span>
                <span className="printed">{it.answers[0] ?? ""}</span>
              </span>
            </div>
          ) : (
            <WriteItemView
              key={it.num}
              item={it}
              value={values[it.num] ?? ""}
              onChange={(v) => updateAnswer({ items: { ...values, [it.num]: v } })}
              state={states[graded.indexOf(it)]}
              revealed={revealed}
            />
          ),
        )}
        <CardActions
          onCheck={() => {
            setChecked(true);
            setProgress((p) => {
              const cur = ((p.answers[exercise.id] ?? {}) as Record<string, unknown>).items as
                Record<string, string> | undefined;
              const all = graded.map((it) => checkWrite(cur?.[it.num] ?? "", it.answers));
              const next = {
                ...p,
                results: { ...p.results, [exercise.id]: { correct: all.filter(Boolean).length, total: all.length } },
              };
              saveProgress(book.id, next);
              return next;
            });
          }}
          onToggleReveal={() => setRevealed((r) => !r)}
          revealed={revealed}
          result={savedResult}
          total={states.length}
        />
      </section>
    );
  }

  // self-check
  const items = (exercise.items ?? []) as SelfCheckItem[];
  const values = (answerRecord.items ?? {}) as Record<string, string>;
  const marks = (progress.selfMarks[exercise.id] ?? {}) as Record<string, boolean>;
  return (
    <section className="exercise" id={`ex-${exercise.id}`}>
      <header>
        <span className="exid">{exercise.id}</span>
        <p className="instruction">{exercise.instruction}</p>
      </header>
      {items.map((it) => (
        <SelfCheckItemView
          key={it.num}
          item={it}
          value={values[it.num] ?? ""}
          onChange={(v) => updateAnswer({ items: { ...values, [it.num]: v } })}
          mark={marks[it.num] ?? null}
          onMark={(ok) => {
            setProgress((p) => {
              const next = {
                ...p,
                selfMarks: {
                  ...p.selfMarks,
                  [exercise.id]: { ...(p.selfMarks[exercise.id] ?? {}), [it.num]: ok },
                },
              };
              saveProgress(book.id, next);
              return next;
            });
          }}
        />
      ))}
    </section>
  );
}

function WordBank({ words }: { words: string[] }) {
  return (
    <div className="wordbank">
      {words.map((w, i) => (
        <span key={i} className="chip">
          {w}
        </span>
      ))}
    </div>
  );
}

interface ActionsProps {
  onCheck: () => void;
  onToggleReveal: () => void;
  revealed: boolean;
  result?: { correct: number; total: number };
  total: number;
}

function CardActions({ onCheck, onToggleReveal, revealed, result, total }: ActionsProps) {
  return (
    <div className="cardactions">
      <button
        type="button"
        className="primary"
        data-shortcut="check"
        title={"Check — " + SC.check}
        onClick={onCheck}
      >
        <SquareCheckBig size={14} aria-hidden /> Check
      </button>
      <button
        type="button"
        data-shortcut="reveal"
        title={(revealed ? "Hide answers — " : "Show answers — ") + SC.reveal}
        onClick={onToggleReveal}
      >
        {revealed ? (
          <>
            <EyeOff size={14} aria-hidden /> Hide answers
          </>
        ) : (
          <>
            <Eye size={14} aria-hidden /> Show answers
          </>
        )}
      </button>
      {result && total > 0 && (
        <span className={result.correct === result.total ? "score ok" : "score"}>
          {result.correct}/{result.total} correct
        </span>
      )}
    </div>
  );
}

