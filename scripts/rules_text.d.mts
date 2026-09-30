// Types for rules_text.mjs (imported by src/rulestext.test.ts; the app reads
// its output through src/rules.ts).

export type RuleLine = ["h" | "t" | "e", string] | ["c", string[]] | ["b"];
export interface RuleSection {
  l: string;
  x: RuleLine[];
}
export interface RuleRef {
  t: string;
  to: string;
  u: number[];
}
export interface ParsedRule {
  s: RuleSection[];
  r: RuleRef[];
}

export function theoryPages(pages: number[]): number[];
export function headerMatches(text: string, unit: number, title: string): boolean;
export function refUnits(target: string): number[];
export function parseRulePage(text: string, unit: number, title: string): ParsedRule | null;
export function ruleText(rule: ParsedRule): string;
