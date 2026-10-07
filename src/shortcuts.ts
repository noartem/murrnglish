// The keyboard layer: ONE window keydown dispatcher for the whole app, the
// shared labels the help and the tooltips render, and the app-wide shortcuts
// that work in every view (help, data window, book picker, section jumps).
// Per-view keys live in the views themselves and register through keyScopes.
//
// Exercise-scope actions resolve through the DOM to the exercise's own
// buttons (data-shortcut attributes render in ExerciseCard's CardActions),
// so there is no ref plumbing and every exercise type gets the shortcuts.
//
// "Shift+?" arrives as e.key === "?" with shiftKey set on every layout.
// Letter shortcuts always check e.code, so they work on any keyboard layout.
// Handler order (critical):
//   1. the help window owns every key  2. the data window's access letters
//   3. any other .modal-overlay owns its own Esc — nothing global fires
//   4. exercise scope (before the defaultPrevented guard: GapInput calls
//      preventDefault on plain Enter)
//   5. defaultPrevented guard  6. app-wide letters and Alt+digit
//   7. the view's own keys (the shell's panel first, then the view's)

import { useEffect } from "react";
import { BOOKS } from "./books";
import { closeGlobal, currentGlobal, globalHints, openGlobal } from "./globalUi";
import { scopeHandler } from "./keyScopes";
import { CARDS_HASH, DICTIONARY_HASH, LIBRARY_HASH, bookHash, entryHash } from "./routes";

/** Shortcut labels shared by tooltips, the topbar and the help window. */
export const SC = {
  check: "Ctrl+Enter",
  reveal: "Shift+A",
  nextUnit: "Shift+N",
  prevUnit: "Shift+P",
  lessonJump: "Shift+S",
  sidebarToggle: "Alt+Shift+E",
  cycleTheme: "Shift+T",
  cards: "Shift+C",
  dictionary: "Shift+D",
  library: "Shift+L",
  bookJump: "Alt+1…9",
  backHome: "Shift+Z",
  dataAlt: "Shift+I",
  data: "Alt+D",
  search: "Ctrl+K",
  help: "Shift+?",
} as const;

export interface HelpEntry {
  keys: string[]; // one combo, rendered as separate key chips
  title: string;
  desc: string;
  /** an alternative combo for the same action */
  alt?: string[];
  sub?: { keys: string[]; alt?: string[]; desc: string }[];
}

/** One group of the help window: a heading and the keys under it. */
export interface HelpSection {
  title: string;
  entries: HelpEntry[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    title: "Anywhere",
    entries: [
      {
        keys: ["Ctrl", "K"],
        title: "Search",
        desc: "One field over everything: the books and their units, the cards and their entries, your own words, the shortcuts, and the places themselves. Type to narrow, then click a result or press Enter to go there.",
      },
      {
        keys: ["Shift", "?"],
        title: "This help",
        desc: "Open this window from any place — a book, the library, the cards, the dictionary. Press Esc to close it.",
      },
      {
        keys: ["Shift", "C"],
        title: "Cards",
        desc: "Go to the card decks from anywhere in the app.",
      },
      {
        keys: ["Shift", "D"],
        title: "Dictionary",
        desc: "Go to your words from anywhere in the app.",
      },
      {
        keys: ["Shift", "L"],
        title: "Library",
        desc: "Go to the library — the list of books — from anywhere in the app.",
      },
      {
        keys: ["Alt", "1 … 9"],
        title: "Go to a book",
        desc: "Open the first book with Alt+1, the second with Alt+2 and so on, from anywhere in the app. The navigation panel holds every book too — Shift+E focuses the one you are reading.",
      },
      {
        keys: ["Alt", "D"],
        alt: ["Shift", "I"],
        title: "Progress and data window",
        desc: "How far each book has come, the file or link that moves it — export, import or share your progress, cards and words — and a report of what you have learned. Opened this way, the window marks the key of every control — F, P, C, D, A, I, E, S, L — and pressing that key does the same as clicking the control. Esc closes it.",
        sub: [
          { keys: ["F"], alt: ["P"], desc: "tick or untick a book; the letter is in its title" },
          { keys: ["C"], desc: "tick or untick the cards: their learning state and daily limits" },
          { keys: ["D"], desc: "tick or untick the dictionary" },
          { keys: ["A"], desc: "include or leave out the answer texts in the books" },
          { keys: ["I"], desc: "import a file" },
          { keys: ["E"], desc: "export a file" },
          { keys: ["S"], desc: "copy the share link — the book you are in, else the first ticked" },
          { keys: ["L"], desc: "tick or untick the learning report: which cards are learned and when they come back" },
          { keys: ["Esc"], desc: "close the window" },
        ],
      },
      {
        keys: ["Shift", "E"],
        title: "The navigation panel",
        desc: "Brings the panel up and focuses the tile that stands for the page you are on: the open unit in a book, Unit 1 on a book's landing, Cards, the Dictionary, or the panel's first control anywhere else. If the panel is hidden it slides in from the left edge, exactly as it does when the pointer goes there.",
        sub: [
          { keys: ["\u2190"], alt: ["\u2192"], desc: "move to the next or previous control of the panel — a tile, a book, a unit" },
          { keys: ["\u2191"], alt: ["\u2193"], desc: "move to the row above or below" },
          { keys: ["Enter"], desc: "open the focused control" },
          { keys: ["Esc"], desc: "go back to where you were (or to the first exercise)" },
        ],
      },
      {
        keys: ["Alt", "Shift", "E"],
        title: "Show or hide the panel",
        desc: "Toggles the navigation panel exactly like the burger button at the top, on any page. The focus stays where it is.",
      },
      {
        keys: ["Shift", "Z"],
        title: "Back, or the landing",
        desc: "Goes back where the browser came from — another page of the app, or the site you arrived from. Opened straight onto this page, with no history behind it, it takes you where the app opens: the page you last worked on, else the library.",
      },
    ],
  },
  {
    title: "In a book",
    entries: [
      {
        keys: ["Ctrl", "Enter"],
        title: "Check the exercise",
        desc: "Works while you are inside one exercise (the cursor is in one of its inputs, or one of its buttons is focused). Checks your answers.",
      },
      {
        keys: ["Shift", "A"],
        title: "Show or hide answers",
        desc: "Also works inside one exercise. The correct answers appear under the items, and answers that match your text are green. Your own text does not change. Press it again to hide the answers.",
      },
      {
        keys: ["Shift", "N"],
        title: "Next unit",
        desc: "Go to the next unit of the course.",
      },
      {
        keys: ["Shift", "P"],
        title: "Previous unit",
        desc: "Go to the previous unit of the course.",
      },
      {
        keys: ["Shift", "S"],
        title: "Lesson or exercises",
        desc: "In a unit, jumps from the lesson down to the first exercise (the cursor lands in it), and from the exercises back up to the lesson.",
      },
      {
        keys: ["Alt", "D"],
        title: "Progress and data window",
        desc: "The same window as anywhere else in the app: this book's progress beside the other book's, and export, import or share for progress, cards and words.",
      },
    ],
  },
  {
    title: "In a review session",
    entries: [
      {
        keys: ["Ctrl", "Enter"],
        alt: ["Space"],
        title: "Show the answer",
        desc: "Turns the card over. When the card asks you to type, Enter in the field checks what you typed and turns the card over.",
      },
      {
        keys: ["1"],
        title: "Before the answer: pick an option",
        desc: "On a card with options, 1, 2, 3 … pick the first, second, third option and turn the card over.",
      },
      {
        keys: ["1 / 2 / 3 / 4"],
        title: "After the answer: Again, Hard, Good, Easy",
        desc: "How well you knew it decides when the card comes back; the time is printed on each button.",
        sub: [
          { keys: ["Space"], alt: ["Enter"], desc: "the suggested answer: Good, or Again when what you typed was wrong" },
        ],
      },
      {
        keys: ["S"],
        title: "Suspend",
        desc: "Stops showing this card. The cards → Settings brings suspended cards back.",
      },
      {
        keys: ["I"],
        title: "Card info",
        desc: "Opens the card among its deck's cards, with its review history.",
      },
      {
        keys: ["W"],
        title: "Word list",
        desc: "The vocabulary deck's entries as a list.",
      },
      {
        keys: ["A"],
        title: "Add to my words",
        desc: "Keeps the phrase on the card in your own dictionary.",
      },
      {
        keys: ["Ctrl", "Z"],
        title: "Undo",
        desc: "Takes the last answer back and shows that card again.",
      },
      {
        keys: ["Ctrl", "Enter"],
        title: "Done for now: back to the decks",
        desc: "On the finished page, where there is no card left, this goes to All decks.",
      },
    ],
  },
  {
    title: "Browsing a deck's cards",
    entries: [
      {
        keys: ["\u2190"],
        alt: ["\u2192"],
        title: "Step through the cards",
        desc: "The previous or the next card of the deck, while you are looking through it.",
      },
      {
        keys: ["Esc"],
        title: "Back to the deck's list",
        desc: "Leave one card, or the whole browser, for the deck's list of cards.",
      },
    ],
  },
];

/**
 * Where the browser keeps its own session history, if it says: the Navigation
 * API's current index. It is found by its shape — the DOM lib this project
 * compiles against types `window.navigation` as the old timing object, and
 * only the Navigation API carries a `currentEntry`.
 */
function sessionIndex(): number | null {
  const nav: unknown = Reflect.get(window, "navigation");
  if (typeof nav !== "object" || nav === null || !("currentEntry" in nav)) return null;
  const entry: unknown = nav.currentEntry;
  if (typeof entry !== "object" || entry === null || !("index" in entry)) return null;
  return typeof entry.index === "number" ? entry.index : null;
}

export function useAppShortcuts(): void {
  useEffect(() => {
    // How far back the app can go without leaving it. The browser's session
    // history also holds whatever opened this tab — about:blank, or the site
    // the learner arrived from — and stepping into that is leaving, not going
    // back, so the count starts at the page the tab opened on. Chromium
    // reports the session history's own index (a step between hashes shows up
    // there, though it fires no popstate); elsewhere the app counts the pages
    // it has moved through since it opened.
    const openedAt = sessionIndex() ?? 0;
    let moved = 0;
    const onHash = () => {
      moved += 1;
    };
    window.addEventListener("hashchange", onHash);
    const behind = () => {
      const now = sessionIndex();
      return now === null ? moved : Math.max(0, now - openedAt);
    };

    const handler = (e: KeyboardEvent) => {
      // 1. the help window owns every key: only Esc does anything
      if (currentGlobal() === "help") {
        if (e.key === "Escape") {
          e.preventDefault();
          closeGlobal();
        }
        return;
      }
      // 2. the window Alt+D or Shift+I opened: a plain letter clicks the
      // control that carries it. Every control of the data window names its
      // own access key in `data-modal-key` (DataModal), so there is no table
      // here to fall out of step with the markup. Only in hint mode — opened
      // from a topbar button it leaves plain letters alone. Esc is the
      // window's own listener, not repeated here, so one key press can never
      // run the close path twice.
      if (currentGlobal() === "data" && globalHints()) {
        // plain letters only: no modifiers, no auto-repeat. Shift+I while
        // the window is open falls through to the global branch instead of
        // clicking Import a second time.
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && /^Key[A-Z]$/.test(e.code)) {
          const target = document.querySelector<HTMLElement>(`[data-modal-key="${e.code}"]`);
          if (target) {
            e.preventDefault();
            // a click lands the same way as the pointer: buttons fire
            // onClick, the checkbox label forwards to its hidden input
            target.click();
            return;
          }
        }
      }

      // 3. another window is up (the word editor, the data window, the book
      // picker, the offline panel): each owns an Esc listener of its own, so
      // no global key fires behind it
      if (document.querySelector(".modal-overlay")) return;

      // 4. exercise scope — BEFORE the defaultPrevented guard, because
      // GapInput calls preventDefault on every plain Enter
      const ex = document.activeElement?.closest(".exercise");
      if (ex) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "Enter") {
          e.preventDefault();
          ex.querySelector<HTMLButtonElement>('[data-shortcut="check"]')?.click();
          return;
        }
        if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === "KeyA") {
          e.preventDefault();
          ex.querySelector<HTMLButtonElement>('[data-shortcut="reveal"]')?.click();
          return;
        }
      }

      // 5. a control that handled the key itself wins
      if (e.defaultPrevented) return;

      // 6. the app-wide keys, in every view
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openGlobal("help");
        return;
      }
      // Ctrl+K: the global search, everywhere. A field with text keeps
      // Ctrl+K for itself (browsers bind it to the address bar anyway).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "KeyK") {
        const el = document.activeElement;
        const typing = el instanceof HTMLElement && el.closest("input, textarea, select");
        if (typing && "value" in typing && String(typing.value)) return;
        e.preventDefault();
        openGlobal("search");
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (e.altKey && e.code === "KeyD") {
          e.preventDefault();
          openGlobal("data", true);
          return;
        }
        // Alt+1..9: the books in library order. Some browsers and window
        // managers claim Alt+digit for tab switching; the navigation panel,
        // which holds every book, is the fallback path to the same place.
        if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
          const book = BOOKS[Number(e.code.slice(5)) - 1];
          if (book) {
            e.preventDefault();
            window.location.hash = bookHash(book);
          }
          return;
        }
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.code) {
          case "KeyI":
            e.preventDefault();
            openGlobal("data", true);
            return;
          case "KeyC":
            e.preventDefault();
            window.location.hash = CARDS_HASH;
            return;
          case "KeyD":
            e.preventDefault();
            window.location.hash = DICTIONARY_HASH;
            return;
          case "KeyL":
            e.preventDefault();
            window.location.hash = LIBRARY_HASH;
            return;
          case "KeyT":
            e.preventDefault();
            // the theme button the header renders, on every view
            document.querySelector<HTMLButtonElement>('[data-global-btn="theme"]')?.click();
            return;
          case "KeyZ":
            e.preventDefault();
            // back to the page behind this one; with nothing of the app
            // behind it — opened straight onto this page — the landing
            if (behind() > 0) window.history.back();
            else window.location.hash = entryHash();
            return;
        }
      }

      // 7. the view's own keys
      for (const scope of ["shell", "course", "study", "browse"] as const) {
        const fn = scopeHandler(scope);
        if (fn && fn(e)) return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
}

/**
 * Focus the first interactive element of the first exercise in the pane.
 * The landing has no exercises: its call to action takes that place, so
 * "Esc = go back" from the unit list there returns to the page's own button.
 */
export function focusFirstExercise(): void {
  const target =
    document
      .querySelector(".coursepane")
      ?.querySelector<HTMLElement>(
        ".exercise textarea, .exercise input, .exercise select, .exercise button",
      ) ?? document.querySelector<HTMLElement>(".home .homecta");
  target?.focus({ preventScroll: true });
}