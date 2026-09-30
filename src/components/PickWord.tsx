// "Add to dictionary" for a word selected in the text: select a word (or a
// short phrase) in an exercise or a rule and a small button appears under
// it; the button opens the word editor with the word, the sentence it came
// from and where it was found. Selections inside the answer fields are the
// learner's own typing and are left alone, as is anything that is not one to
// four English words (words.ts pickableWord).

import { useEffect, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import type { Word } from "../words";
import { pickableWord } from "../words";
import { openWordEditor } from "./WordEditor";

// the smallest block that reads as the word's sentence
const CONTEXT = ".item, .instruction, .ruleprose, .ruleexample, .rulecols > span, .rulesubhead, .matchrow, .option, p, li";

interface Pick {
  word: string;
  context: string;
  x: number;
  y: number;
}

function current(scope: string): Pick | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el?.closest(scope) || el.closest("input, textarea, select, button")) return null;
  const word = pickableWord(sel.toString());
  if (!word) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const block = el.closest(CONTEXT) ?? el;
  const context = (block.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  return {
    word,
    context: context !== word ? context : "",
    x: rect.left + rect.width / 2,
    y: rect.bottom,
  };
}

export function PickWord({ scope, source }: { scope: string; source?: Word["source"] }) {
  const [pick, setPick] = useState<Pick | null>(null);

  useEffect(() => {
    let t = 0;
    const update = () => {
      window.clearTimeout(t);
      // after the selection settles (a drag fires many changes)
      t = window.setTimeout(() => setPick(current(scope)), 180);
    };
    const hide = () => setPick(null);
    document.addEventListener("selectionchange", update);
    // the button is placed in the viewport: a scroll moves the text away from it
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [scope]);

  if (!pick) return null;
  const left = Math.min(window.innerWidth - 100, Math.max(100, pick.x));
  const top = Math.min(window.innerHeight - 52, pick.y + 8);
  return (
    <button
      type="button"
      className="pickword"
      style={{ left, top }}
      // keep the selection: a pointerdown would collapse it before the click
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        openWordEditor({ word: pick.word, context: pick.context, source });
        window.getSelection()?.removeAllRanges();
        setPick(null);
      }}
    >
      <BookmarkPlus size={15} aria-hidden />
      Add “{pick.word.length > 24 ? pick.word.slice(0, 22) + "…" : pick.word}”
    </button>
  );
}
