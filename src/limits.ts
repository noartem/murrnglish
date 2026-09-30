// The daily limits (new cards and reviews a day) and the presets the settings
// offer for them. Learning cards have no limit of their own, as in Anki: a
// card on its 1 m / 10 m steps must come back on time or the steps mean
// nothing, and how many are learning follows from the new-card limit anyway.
//
// The minutes are rough: at steady state each new card a day brings about ten
// reviews a day, at some 8 seconds an answer.

import type { StudySettings } from "./backup";

export interface LimitPreset {
  id: string;
  name: string;
  hint: string;
  newPerDay: number;
  reviewsPerDay: number;
}

export const LIMIT_PRESETS: readonly LimitPreset[] = [
  { id: "light", name: "Light", hint: "5 new cards a day, about 10 minutes", newPerDay: 5, reviewsPerDay: 50 },
  { id: "standard", name: "Standard", hint: "Anki’s defaults, about half an hour a day", newPerDay: 20, reviewsPerDay: 200 },
  { id: "intensive", name: "Intensive", hint: "twice the standard, about an hour a day", newPerDay: 40, reviewsPerDay: 400 },
  { id: "catchup", name: "Catch up", hint: "no new cards, every review that is due", newPerDay: 0, reviewsPerDay: 9999 },
];

/** The preset the limits match, or null for numbers of the learner's own. */
export function presetOf(s: Pick<StudySettings, "newPerDay" | "reviewsPerDay">): LimitPreset | null {
  return LIMIT_PRESETS.find((p) => p.newPerDay === s.newPerDay && p.reviewsPerDay === s.reviewsPerDay) ?? null;
}

/** Anki's warning: a review limit under ten times the new one lets reviews pile up. */
export function reviewsTooFew(s: Pick<StudySettings, "newPerDay" | "reviewsPerDay">): boolean {
  return s.reviewsPerDay < 10 * s.newPerDay;
}
