// Item-level interactive components keyed by exercise type.

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { checkFill } from "../checker";
import { Check, Eye, EyeOff, X } from "lucide-react";
import type { ChoiceItem, FillInItem, SelfCheckItem, WriteItem } from "../data";

const measure = document.createElement("canvas").getContext("2d");

function GapInput({ className, value, onChange, ariaLabel }: {
  className: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !measure) return;
    measure.font = getComputedStyle(el).font;
    const w = measure.measureText(value).width + 30; // padding + caret slop
    const max = (el.closest(".itembody") as HTMLElement | null)?.clientWidth ?? 800;
    // one inline line while it fits, then a wrapped, vertically-growing field
    el.style.width = `${Math.min(Math.max(w, 120), max)}px`;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
          e.preventDefault(); // no stray newlines in answers
        }
      }}
      aria-label={ariaLabel}
    />
  );
}

interface GapProps {
  item: FillInItem;
  values: string[];
  onChange: (idx: number, v: string) => void;
  states: (boolean | null)[];
  revealed: boolean;
}

export function FillInItemView({ item, values, onChange, states, revealed }: GapProps) {
  const nodes: React.ReactNode[] = [];
  item.parts.forEach((part, i) => {
    nodes.push(<span key={`p${i}`}>{part}</span>);
    if (i < item.answers.length) {
      const state = states[i];
      const cls =
        state === true ? "gap ok" : state === false ? "gap bad" : "gap";
      nodes.push(
        <GapInput
          key={`g${i}`}
          className={cls}
          value={values[i] ?? ""}
          onChange={(v) => onChange(i, v)}
          ariaLabel={`gap ${i + 1}`}
        />,
      );
    }
  });
  const wrong = states.some((s) => s === false);
  return (
    <div className="item">
      <span className="itemnum">{item.num}</span>
      <span className="itembody">{nodes}</span>
      {(revealed || wrong) && (
        <div className="variants">
          {item.answers.map((vs, i) => (
            <div key={i}>
              gap {i + 1}: {vs.map((a, j) => (
                <Fragment key={j}>
                  {j > 0 && " / "}
                  <span className={checkFill(values[i] ?? "", [a]) ? "ok" : undefined}>
                    {a}
                  </span>
                </Fragment>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChoiceProps {
  item: ChoiceItem;
  selected: number | null;
  onSelect: (idx: number) => void;
  state: boolean | null;
  revealed?: boolean;
}

export function ChoiceItemView({ item, selected, onSelect, state, revealed }: ChoiceProps) {
  return (
    <div className="item">
      <span className="itemnum">{item.num}</span>
      <span className="itembody options">
        {item.options.map((opt, i) => {
          const cls =
            (revealed || state === true) && i === item.answer
              ? "option ok"
              : state === false && i === selected
                ? "option bad"
                : "option";
          return (
            <label key={i} className={cls}>
              <input
                type="radio"
                name={`opt-${item.num}`}
                checked={selected === i}
                onChange={() => onSelect(i)}
              />
              <span>{opt}</span>
            </label>
          );
        })}
      </span>
    </div>
  );
}

interface WriteProps {
  item: WriteItem;
  value: string;
  onChange: (v: string) => void;
  state: boolean | null;
  revealed: boolean;
}

export function MarkedPrompt({ text }: { text: string }) {
  // printed underline: "[tries]" between prompt text halves
  const out: React.ReactNode[] = [];
  text.split(/\[([^\]]*)\]/g).forEach((piece, i) => {
    out.push(i % 2 ? <u key={i}>{piece}</u> : piece);
  });
  return <>{out}</>;
}

export function WriteItemView({ item, value, onChange, state, revealed }: WriteProps) {
  const marked = /\[[^\]]*\]/.test(item.prompt);
  const long =
    !marked &&
    (item.prompt.length > 60 || item.answers.some((a) => a.length > 90));
  const cls = state === true ? "winline ok" : state === false ? "winline bad" : "winline";
  return (
    <div className={marked ? "item markeditem" : "item"}>
      <span className="itemnum">{item.num}</span>
      <span className="itembody">
        <span className="prompt"><MarkedPrompt text={item.prompt} /></span>
        {long ? (
          <textarea
            rows={2}
            className={state === true ? "wfull ok" : state === false ? "wfull bad" : "wfull"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <GapInput
            className={cls}
            value={value}
            onChange={onChange}
            ariaLabel={`write ${item.num}`}
          />
        )}
        {(revealed || state === false) && (
          <div className="variants">
            {item.answers.map((a, j) => (
              <Fragment key={j}>
                {j > 0 && " / "}
                <span className={checkFill(value, [a]) ? "ok" : undefined}>{a}</span>
              </Fragment>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

interface SelfCheckProps {
  item: SelfCheckItem;
  value: string;
  onChange: (v: string) => void;
  mark: boolean | null;
  onMark: (ok: boolean) => void;
}

export function SelfCheckItemView({ item, value, onChange, mark, onMark }: SelfCheckProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="item selfcheck">
      <span className="itemnum">{item.num}</span>
      <span className="itembody">
        {item.prompt && <span className="prompt">{item.prompt}</span>}
        <textarea
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer"
        />
        <div className="selfcheck-controls">
          <button type="button" className="examplebtn" onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            {show ? "Hide example answer" : "Show example answer"}
          </button>
          <button
            type="button"
            className={"mark ok" + (mark === true ? " active" : "")}
            onClick={() => onMark(true)}
          >
            <Check size={14} strokeWidth={2.5} aria-hidden /> I was right
          </button>
          <button
            type="button"
            className={"mark bad" + (mark === false ? " active" : "")}
            onClick={() => onMark(false)}
          >
            <X size={14} strokeWidth={2.5} aria-hidden /> I was wrong
          </button>
        </div>
        {show && (
          <div className="variants">
            {item.modelAnswers.length
              ? item.modelAnswers.join(" / ")
              : "No example answer in the key."}
          </div>
        )}
      </span>
    </div>
  );
}
