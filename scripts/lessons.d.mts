// Types for lessons.mjs (imported by src/lesson.test.ts; the app reads its
// output through the units' JSON, typed in src/lesson.ts).

import type { Lesson, Text } from "../src/lesson";

export const MAX_WORDS: number;
export const MAX_PARAGRAPHS: number;
export const MIN_KINDS: number;
export const SHINGLE: number;
export const KINDS: string[];

export function inline(src: string, err?: string[], units?: Map<number, string> | null): Text;
export function plain(t: Text): string;
export function compileLesson(src: string, units?: Map<number, string> | null): { lesson: Lesson; errors: string[] };
export function lessonText(lesson: Lesson): string;
export function lintLesson(lesson: Lesson): string[];
export function shingles(text: string, n?: number): Set<string>;
export function originality(lesson: Lesson, bookShingles: Set<string>): string[];
