// The "cards due" number the library and the section tabs show: the cards
// met before that are due now — learning and review, the red and green
// numbers of the deck list. Computed from the study store alone, so no book
// has to load for it. New cards are left out: how many a deck offers depends
// on the units started (decks.ts), and knowing that needs the books. Cards the
// learner took out of daily study (selection.ts) are left out too.

import { useEffect, useMemo, useState } from "react";
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
    const c = deckCounts({
      ids: Object.keys(srs.states).filter((id) => !cardExcluded(id, settings.include)),
      states: srs.states,
      suspended: new Set(srs.suspended),
      daily: todayDaily(srs.daily, now, cfg),
      now,
      cfg,
    });
    return c.learn + c.review;
  }, [srs, settings, now]);
}
