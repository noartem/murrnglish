// Data layer: types mirroring work/PARSING-SPEC.md schemas + fetch helpers.

export type ExerciseType = "fill-in" | "choice" | "matching" | "write" | "self-check";

export interface FillInItem {
  num: number;
  parts: string[];
  answers: string[][];
}
export interface ChoiceItem {
  num: number;
  options: string[];
  answer: number;
}
export interface WriteItem {
  num: number;
  prompt: string;
  answers: string[];
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

export function pageUrl(pdfPage: number): string {
  return `/pages/p${String(pdfPage).padStart(3, "0")}.png`;
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
