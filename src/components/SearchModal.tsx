// The global search: one field over everything the app holds — the books and
// their units, the decks and their entries, the learner's own words, the
// shortcuts, and the places themselves. Opened by Ctrl+K, by the search
// button in the navigation panel, or by the row in the phone drawer.
//
// The index is built from what is already in memory — the book registry, the
// decks' lazy chunk, the words in localStorage, the help data — plus each
// book's index.json for its unit titles, which is small, cached per session
// and fetched only while the window is open. Nothing here blocks on the
// network: the field answers the moment the window paints, and the unit
// titles join in when they arrive.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { BookOpen, Keyboard, Layers, NotebookPen, Search, X } from "lucide-react";
import { BOOKS } from "../books";
import { fetchIndexOnce } from "../data";
import type { IndexData } from "../data";
import { useDecks } from "../deckdata";
import type { DeckLibrary } from "../deckdata";
import { openGlobal, useGlobalModal } from "../globalUi";
import { HELP_SECTIONS } from "../shortcuts";
import { useStudy } from "../study";
import {
  CARDS_HASH,
  DICTIONARY_HASH,
  LIBRARY_HASH,
  bookHash,
  browseHash,
  deckHash,
} from "../routes";

/** What a hit is: the group it belongs to, and where Enter takes you. */
interface Hit {
  group: string;
  label: string;
  detail: string;
  /** the order inside a group: lower is better */
  rank: number;
  icon: ReactNode;
  go: () => void;
}

/** The order the groups appear in the results. */
const GROUP_ORDER = ["Shortcuts", "Units", "Decks", "Words", "Places"];

/** A word-boundary match, so "past" finds "past simple" but not "pastry". */
function matches(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const at = h.indexOf(needle);
  return at === 0 || (at > 0 && /[^a-z0-9]/.test(h[at - 1]));
}

export function SearchModal({ onClose }: { onClose: () => void }) {
  const open = useGlobalModal() === "search";
  const { lib } = useDecks();
  const { words } = useStudy();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [titles, setTitles] = useState<Record<string, string[]>>({});
  const [shown, setShown] = useState(open);
  const inputRef = useRef<HTMLInputElement>(null);

  // exit: the card stays mounted under .closing while it plays, then drops
  useEffect(() => {
    if (open) {
      setShown(true);
      setQ("");
      setAt(0);
      return;
    }
    const t = window.setTimeout(() => setShown(false), 150);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [shown]);

  // Esc closes while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // each book's unit titles: index.json is small, cached per session, and the
  // unit rows only appear once it lands
  useEffect(() => {
    if (!open) return;
    const missing = BOOKS.filter((b) => !titles[b.id]);
    if (!missing.length) return;
    let alive = true;
    void Promise.all(
      missing.map((b) =>
        fetchIndexOnce(b)
          .then((index) => [b.id, unitTitles(index)] as const)
          .catch(() => null),
      ),
    ).then((rows) => {
      if (!alive) return;
      setTitles((t) => {
        const next = { ...t };
        for (const row of rows) if (row) next[row[0]] = row[1];
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [open, titles]);

  const hits = useMemo(
    () => (q.trim() ? search(q, { lib, words, titles, onClose }) : []),
    [q, lib, words, titles, onClose],
  );

  if (!shown) return null;
  const closing = !open;
  const needle = q.trim();

  return (
    <div className={"searchoverlay" + (closing ? " closing" : "")} onClick={onClose}>
      <div
        className={"searchcard" + (closing ? " closing" : "")}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        // the field owns the typing; the arrows walk the results and Enter
        // takes the selected one
        onKeyDown={(e) => {
          if (!hits.length) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setAt((i) =>
              e.key === "ArrowDown"
                ? Math.min(hits.length - 1, i + 1)
                : Math.max(0, i - 1),
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            hits[at]?.go();
          }
        }}
      >
        <div className="searchbar">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={q}
            placeholder="Search units, cards, words, keys…"
            aria-label="Search"
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
          />
          <button className="themebtn" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden />
          </button>
        </div>
        <OverlayScrollbarsComponent
          className="searchresults"
          options={{
            overflow: { x: "hidden" as const },
            scrollbars: {
              theme: "os-theme-dark",
              autoHide: "leave" as const,
              autoHideDelay: 500,
            },
          }}
        >
          {!needle && (
            <p className="searchhint">
              Every unit, every card, every word you saved, and every key — type to narrow.
            </p>
          )}
          {needle && !hits.length && <p className="searchhint">Nothing matches “{needle}”.</p>}
          {GROUP_ORDER.map((group) => {
            const rows = hits.filter((h) => h.group === group);
            if (!rows.length) return null;
            return (
              <div className="searchgroup" key={group}>
                <div className="searchgroupname">{group}</div>
                {rows.map((h) => {
                  // the row's place in the flat list, so the arrows and the
                  // marked row are the same thing
                  const i = hits.indexOf(h);
                  return (
                    <button
                      key={h.group + h.label + h.detail}
                      className={"searchrow" + (i === at ? " on" : "")}
                      onMouseEnter={() => setAt(i)}
                      onClick={h.go}
                    >
                      <span className="searchrowicon">{h.icon}</span>
                      <span className="searchrowtext">
                        <span className="searchrowlabel">{h.label}</span>
                        <span className="searchrowdetail">{h.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </OverlayScrollbarsComponent>
      </div>
    </div>
  );
}

/** "Unit 13 — Present simple (I am doing)" for every unit, then every extra. */
function unitTitles(index: IndexData): string[] {
  return [
    ...index.groups.flatMap((g) =>
      g.units.map((u) => index.exercises[`u${u}`]?.title ?? `Unit ${u}`),
    ),
    ...index.additional.exercises.map(
      (n) => index.exercises[`a${n}`]?.title ?? `Additional exercise ${n}`,
    ),
  ];
}

interface Sources {
  lib: DeckLibrary | null;
  words: { word: string; translation: string }[];
  /** book id -> its unit titles, once index.json has arrived */
  titles: Record<string, string[]>;
  onClose: () => void;
}

/**
 * Every hit for `q`, grouped and ranked. Rank is what the order inside a
 * group follows: a name that starts with the query beats one that only
 * contains it, and a deck beats an entry inside it.
 */
function search(q: string, { lib, words, titles, onClose }: Sources): Hit[] {
  const needle = q.trim().toLowerCase();
  const go = (hash: string) => () => {
    onClose();
    window.location.hash = hash;
  };
  const hits: Hit[] = [];

  // the shortcuts: the combo itself, what the key is called, or what it does
  for (const section of HELP_SECTIONS) {
    for (const entry of section.entries) {
      const combo = [...entry.keys, ...(entry.alt ?? [])].join(" ").toLowerCase();
      const where = matches(combo, needle)
        ? 0
        : matches(entry.title, needle)
          ? 1
          : matches(entry.desc, needle)
            ? 2
            : -1;
      if (where < 0) continue;
      hits.push({
        group: "Shortcuts",
        label: entry.keys.join("+") + (entry.alt ? " / " + entry.alt.join("+") : ""),
        detail: `${entry.title} — ${section.title}`,
        rank: where,
        icon: <Keyboard size={15} aria-hidden />,
        go: () => {
          onClose();
          jumpToHelp(section.title);
        },
      });
    }
  }

  // the books, their units and their additional exercises
  for (const book of BOOKS) {
    if (matches(book.title, needle)) {
      hits.push({
        group: "Places",
        label: book.title,
        detail: `${book.level} · ${book.units} units`,
        rank: 0,
        icon: <BookOpen size={15} aria-hidden />,
        go: go(bookHash(book)),
      });
    }
    const list = titles[book.id];
    if (!list) continue;
    list.forEach((title, i) => {
      if (!matches(title, needle)) return;
      const unit =
        i < book.units
          ? { kind: "unit" as const, n: i + 1 }
          : { kind: "additional" as const, n: i - book.units + 1 };
      hits.push({
        group: "Units",
        label: title,
        detail: `${book.title} — ${
          unit.kind === "unit" ? `Unit ${unit.n}` : `Additional exercise ${unit.n}`
        }`,
        rank: 0,
        icon: <BookOpen size={15} aria-hidden />,
        go: go(bookHash(book, unit)),
      });
    });
  }

  // the decks and their entries
  if (lib) {
    for (const section of lib.sections) {
      for (const group of section.groups) {
        for (const deck of group.decks) {
          if (matches(deck.title, needle)) {
            hits.push({
              group: "Decks",
              label: deck.title,
              detail: `${section.title} · ${deck.level}`,
              rank: 0,
              icon: <Layers size={15} aria-hidden />,
              go: go(browseHash(deck.id)),
            });
          }
          for (const entry of deck.entries) {
            if (!matches(`${entry.en ?? ""} ${entry.ru ?? ""}`, needle)) continue;
            hits.push({
              group: "Decks",
              label: entry.en ?? entry.ru ?? entry.id,
              detail: deck.title,
              rank: 1,
              icon: <Layers size={15} aria-hidden />,
              go: go(browseHash(deck.id, entry.id)),
            });
          }
        }
      }
    }
  }

  // the learner's own words
  for (const w of words) {
    if (!matches(`${w.word} ${w.translation}`, needle)) continue;
    hits.push({
      group: "Words",
      label: w.word,
      detail: w.translation,
      rank: matches(w.word, needle) ? 0 : 1,
      icon: <NotebookPen size={15} aria-hidden />,
      go: go(DICTIONARY_HASH),
    });
  }

  // the places themselves, so a name can be typed instead of clicked
  for (const [label, detail, hash] of PLACES) {
    if (!matches(`${label} ${detail}`, needle)) continue;
    hits.push({
      group: "Places",
      label,
      detail,
      rank: 1,
      icon: <Layers size={15} aria-hidden />,
      go: go(hash),
    });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

/** The app's own destinations, so a name can be typed instead of clicked. */
const PLACES: [string, string, string][] = [
  ["Library", "every book", LIBRARY_HASH],
  ["Cards", "the deck list", CARDS_HASH],
  ["Dictionary", "your own words", DICTIONARY_HASH],
  ["Study everything", "today's queue across the decks", deckHash({ kind: "all" })],
  ["My words", "the cards made from your dictionary", deckHash({ kind: "words" })],
];

/**
 * Open the help window on one of its groups. The window is not mounted yet
 * when the search asks, so the group waits in a slot the window reads as it
 * opens — an event would fire into nothing.
 */
let helpJump: string | null = null;

/** Ask the help window to open on a group. */
export function jumpToHelp(section: string): void {
  helpJump = section;
  openGlobal("help");
}

/** The group the search asked for, once. */
export function takeHelpJump(): string | null {
  const want = helpJump;
  helpJump = null;
  return want;
}
