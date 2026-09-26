// Item-level interactive components keyed by exercise type.

import { useState } from "react";
import type { ChoiceItem, FillInItem, SelfCheckItem, WriteItem } from "../data";

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
        <input
          key={`g${i}`}
          className={cls}
          value={values[i] ?? ""}
          onChange={(e) => onChange(i, e.target.value)}
          aria-label={`gap ${i + 1}`}
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
              gap {i + 1}: {vs.join(" / ")}
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
}

export function ChoiceItemView({ item, selected, onSelect, state }: ChoiceProps) {
  return (
    <div className="item">
      <span className="itemnum">{item.num}</span>
      <span className="itembody options">
        {item.options.map((opt, i) => {
          const cls =
            state !== null && i === item.answer
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


export function WriteItemView({ item, value, onChange, state, revealed }: WriteProps) {
  const long = item.prompt.length > 60 || item.answers.some((a) => a.length > 90);
  return (
    <div className="item">
      <span className="itemnum">{item.num}</span>
      <span className="itembody">
        <span className="prompt">{item.prompt}</span>
        {long ? (
          <textarea
            rows={2}
            className={state === true ? "wfull ok" : state === false ? "wfull bad" : "wfull"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            className={state === true ? "winline ok" : state === false ? "winline bad" : "winline"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {(revealed || state === false) && (
          <div className="variants">{item.answers.join(" / ")}</div>
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
          <button type="button" onClick={() => setShow((s) => !s)}>
            {show ? "Hide example answer" : "Show example answer"}
          </button>
          <button
            type="button"
            className={mark === true ? "markbtn ok" : "markbtn"}
            onClick={() => onMark(true)}
          >
            I was right
          </button>
          <button
            type="button"
            className={mark === false ? "markbtn bad" : "markbtn"}
            onClick={() => onMark(false)}
          >
            I was wrong
          </button>
          {mark !== null && <span className="markstate">{mark ? "correct" : "incorrect"}</span>}
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
