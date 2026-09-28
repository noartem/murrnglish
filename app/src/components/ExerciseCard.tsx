// ExerciseCard: one exercise = instruction, word bank, items, Check / Show answers.

import { useEffect, useState } from "react";
import { Eye, SquareCheckBig } from "lucide-react";
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

interface Props {
  exercise: Exercise;
  progress: Progress;
  setProgress: (fn: (p: Progress) => Progress) => void;
}

type States = (boolean | null)[];

export function ExerciseCard({ exercise, progress, setProgress }: Props) {
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
              saveProgress(next);
              return next;
            });
          }}
          onShow={() => {
            setRevealed(true);
            setChecked(true);
            setProgress((p) => {
              const rec = (p.answers[exercise.id] ?? {}) as Record<string, unknown>;
              const cur = { ...((rec.items ?? {}) as Record<string, string[]>) };
              for (const it of gradedItems) cur[it.num] = it.answers.map((vs) => vs[0] ?? "");
              const all = gradedItems.flatMap((it) => it.answers.map(() => true));
              const next = {
                ...p,
                answers: { ...p.answers, [exercise.id]: { items: cur } },
                results: { ...p.results, [exercise.id]: { correct: all.length, total: all.length } },
              };
              saveProgress(next);
              return next;
            });
          }}
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
      checked ? checkChoice(values[it.num] ?? null, it.answer) : null,
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
              saveProgress(next);
              return next;
            });
          }}
          onShow={() => {
            setRevealed(true);
            setChecked(true);
            setProgress((p) => {
              const rec = (p.answers[exercise.id] ?? {}) as Record<string, unknown>;
              const cur = { ...((rec.items ?? {}) as Record<string, number>) };
              for (const it of gradedItems) cur[it.num] = it.answer as number;
              const next = {
                ...p,
                answers: { ...p.answers, [exercise.id]: { items: cur } },
                results: { ...p.results, [exercise.id]: { correct: gradedItems.length, total: gradedItems.length } },
              };
              saveProgress(next);
              return next;
            });
          }}
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
            {left.map((l, i) => (
              <div key={i} className="matchrow">
                <span className={st[i] === true ? "matchleft ok" : st[i] === false ? "matchleft bad" : "matchleft"}>
                  {l}
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
              </div>
            ))}
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
              saveProgress(next);
              return next;
            });
          }}
          onShow={() => {
            setRevealed(true);
            setChecked(true);
            setProgress((p) => {
              const nextPairs = left.map((_, li) => pairs.find(([l]) => l === li)?.[1] ?? null);
              const next = {
                ...p,
                answers: { ...p.answers, [exercise.id]: { pairs: nextPairs } },
                results: { ...p.results, [exercise.id]: { correct: left.length, total: left.length } },
              };
              saveProgress(next);
              return next;
            });
          }}
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
      checked ? checkWrite(values[it.num] ?? "", it.answers) : null,
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
              saveProgress(next);
              return next;
            });
          }}
          onShow={() => {
            setRevealed(true);
            setChecked(true);
            setProgress((p) => {
              const rec = (p.answers[exercise.id] ?? {}) as Record<string, unknown>;
              const cur = { ...((rec.items ?? {}) as Record<string, string>) };
              for (const it of graded) cur[it.num] = it.answers[0] ?? "";
              const next = {
                ...p,
                answers: { ...p.answers, [exercise.id]: { items: cur } },
                results: { ...p.results, [exercise.id]: { correct: graded.length, total: graded.length } },
              };
              saveProgress(next);
              return next;
            });
          }}
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
              saveProgress(next);
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
  onShow: () => void;
  result?: { correct: number; total: number };
  total: number;
}

function CardActions({ onCheck, onShow, result, total }: ActionsProps) {
  return (
    <div className="cardactions">
      <button type="button" className="primary" onClick={onCheck}>
        <SquareCheckBig size={14} aria-hidden /> Check
      </button>
      <button type="button" onClick={onShow}>
        <Eye size={14} aria-hidden /> Show answers
      </button>
      {result && total > 0 && (
        <span className={result.correct === result.total ? "score ok" : "score"}>
          {result.correct}/{result.total} correct
        </span>
      )}
    </div>
  );
}

