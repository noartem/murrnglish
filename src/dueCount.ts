// The "cards due" number the library and the section tabs show: the cards
// met before that are due now — learning and review, the red and green
// numbers of the deck list. Computed from the study store alone, so the decks
// need not load for it. New cards are left out: how many there are depends on
// the decks (decks.ts). Cards the learner took out of daily study
// (selection.ts) are left out too, and — once the decks are in — cards whose
// entry is gone from its deck.

import { useEffect, useMemo, useState } from "react";
import { loadedDecks } from "./deckdata";
import { cardExists } from "./decks";
import { cardExcluded } from "./selection";
import { deckCounts, todayDaily } from "./srs";
import { srsConfig, useStudy } from "./study";

/** Re-render every minute: learning cards fall due as time passes. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

export function useDueCount(): number {
  const { srs, settings } = useStudy();
  const now = useMinuteClock();
  return useMemo(() => {
    const cfg = srsConfig(settings);
    const lib = loadedDecks();
    const c = deckCounts({
      ids: Object.keys(srs.states).filter((id) => !cardExcluded(id, settings.include) && (!lib || cardExists(id, lib))),
      states: srs.states,
      suspended: new Set(srs.suspended),
      daily: todayDaily(srs.daily, now, cfg),
      now,
      cfg,
    });
    return c.learn + c.review;
  }, [srs, settings, now]);
}
