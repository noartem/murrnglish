// Data layer: types mirroring work/PARSING-SPEC.md schemas + fetch helpers.

export type ExerciseType = "fill-in" | "choice" | "matching" | "write" | "self-check";

export interface FillInItem {
  num: number;
  parts: string[];
  answers: string[][];
  /** pre-solved in the printed book; rendered as plain text, excluded from grading */
  example?: boolean;
}
export interface ChoiceItem {
  num: number | string;
  options: string[];
  answer: number | number[];
  /** pre-solved in the printed book; rendered as static text, excluded from grading */
  example?: boolean;
}
export interface WriteItem {
  num: number | string;
  prompt: string;
  answers: string[];
  /** pre-solved in the printed book or key-less; rendered as static text, excluded from grading */
  example?: boolean;
}
export interface SelfCheckItem {
  num: number;
  prompt: string;
  modelAnswers: string[];
}

export type Item = FillInItem | ChoiceItem | WriteItem | SelfCheckItem;

export interface Exercise {
  id: string;
  type: ExerciseType;
  instruction: string;
  wordBank?: string[];
  items?: Item[];
  leftOptions?: string[];
  rightOptions?: string[];
  pairs?: [number, number][];
  /** printed-book example items (solved on the page), by item num */
  example?: number[];
}

export interface UnitData {
  unit: number;
  title: string;
  pdfPages: number[];
  exercises: Exercise[];
}

export interface AdditionalData {
  id: number;
  topic: string;
  refs?: string;
  pdfPages: number[];
  exercise: Exercise;
}

export interface Group {
  name: string;
  units: number[];
}

export interface IndexData {
  groups: Group[];
  additional: { title: string; exercises: number[] };
}

export async function fetchIndex(): Promise<IndexData> {
  const r = await fetch("/data/index.json");
  if (!r.ok) throw new Error(`index.json: ${r.status}`);
  return r.json();
}

export async function fetchUnit(n: number): Promise<UnitData> {
  const r = await fetch(`/data/units/unit-${String(n).padStart(3, "0")}.json`);
  if (!r.ok) throw new Error(`unit-${n}: ${r.status}`);
  return r.json();
}

export async function fetchAdditional(n: number): Promise<AdditionalData> {
  const r = await fetch(`/data/additional/${String(n).padStart(2, "0")}.json`);
  if (!r.ok) throw new Error(`additional-${n}: ${r.status}`);
  return r.json();
}

export interface UnitTotals {
  total: number;
  exercises: Record<string, number>;
}
export type TotalsMap = Record<string, UnitTotals>;

export async function fetchTotals(): Promise<TotalsMap> {
  const r = await fetch("/data/totals.json");
  if (!r.ok) throw new Error(`totals.json: ${r.status}`);
  return r.json();
}
