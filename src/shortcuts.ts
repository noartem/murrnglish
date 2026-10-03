// Central keyboard shortcuts: one window keydown dispatcher + the shared
// labels/help data used by tooltips and the help modal. A control that owns
// a key itself (GapInput's Enter) calls preventDefault, and this dispatcher
// steps out of the way via the defaultPrevented guard.
//
// Exercise-scope actions resolve through the DOM to the exercise's own
// buttons (data-shortcut attributes render in ExerciseCard's CardActions),
// so there is no ref plumbing and every exercise type gets the shortcuts.

import { useEffect, useRef } from "react";

/** Shortcut labels shared by tooltips and the help modal. */
export const SC = {
  check: "Ctrl+Enter",
  reveal: "Shift+A",
  nextUnit: "Shift+N",
  prevUnit: "Shift+P",
  unitPanel: "Shift+E",
  lessonJump: "Shift+S",
  sidebarToggle: "Alt+Shift+E",
  cycleTheme: "Shift+T",
  progress: "Shift+I",
  help: "Shift+?",
} as const;

/** First letter -> control of the progress modal, for its Shift+I hint mode. */
export const PROGRESS_HINTS: Record<string, string> = {
  KeyA: "A", // Include answer texts
  KeyI: "I", // Import
  KeyE: "E", // Export
  KeyS: "S", // Share
};

export interface HelpEntry {
  keys: string[]; // one combo, rendered as separate key chips
  title: string;
  desc: string;
  sub?: { keys: string[]; alt?: string[]; desc: string }[];
}

export const SHORTCUT_HELP: HelpEntry[] = [
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
    keys: ["Shift", "E"],
    title: "Unit list",
    desc: "Shows the unit list and focuses the current unit. On the landing, where no unit is open, it focuses Unit 1. If the list was hidden, it appears over the page, like when you move the mouse to the left edge.",
    sub: [
      { keys: ["\u2190"], alt: ["\u2192"], desc: "move to the next or previous unit; at the end of a group you jump to the next group" },
      { keys: ["\u2191"], alt: ["\u2193"], desc: "move to the next or previous group (first unit)" },
      { keys: ["Enter"], desc: "open the focused unit" },
      { keys: ["Esc"], desc: "go back to where you were (or to the first exercise)" },
    ],
  },
  {
    keys: ["Alt", "Shift", "E"],
    title: "Show or hide unit list",
    desc: "Toggles the unit list exactly like the burger button at the top. The focus stays where it is.",
  },
  {
    keys: ["Shift", "S"],
    title: "Lesson or exercises",
    desc: "In a unit, jumps from the lesson down to the first exercise (the cursor lands in it), and from the exercises back up to the lesson.",
  },
  {
    keys: ["Shift", "I"],
    title: "Progress window",
    desc: "Shows the progress overview and its import / export / share actions. Opened this way, the window marks a key letter of each control — I, E, S, and the a of \u201canswer\u201d — and pressing that letter does the same as clicking the control.",
    sub: [
      { keys: ["A"], desc: "include or leave out the answer texts" },
      { keys: ["I"], desc: "import progress from a file" },
      { keys: ["E"], desc: "export progress to a file" },
      { keys: ["S"], desc: "copy the share link" },
      { keys: ["Esc"], desc: "close the window" },
    ],
  },
  {
    keys: ["Shift", "?"],
    title: "This help",
    desc: "Open this window from any place. Press Esc to close it.",
  },
  {
    keys: ["Shift", "T"],
    title: "Switch theme",
    desc: "Cycle the color theme: system, light, dark.",
  },
];


/** The review screen's keys (StudyView handles them itself). */
export const STUDY_HELP: HelpEntry[] = [
  {
    keys: ["Space"],
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
    keys: ["Ctrl", "Z"],
    title: "Undo",
    desc: "Takes the last answer back and shows that card again.",
  },
  {
    keys: ["Shift", "?"],
    title: "This help",
    desc: "Press Esc to close it.",
  },
  {
    keys: ["Shift", "T"],
    title: "Switch theme",
    desc: "Cycle the color theme: system, light, dark.",
  },
];

// "Shift+?" arrives as e.key === "?" with shiftKey set on every layout.
// Letter shortcuts (S/E/N/P/A/I) always check e.code, so they work on any
// keyboard layout. Handler order (critical):
//   1. help modal open  2. progress window  3. exercise scope
//   4. defaultPrevented guard  5. help toggle  6. sidebar scope
//   7. global letters
export interface ShortcutDeps {
  helpOpen: boolean;
  openHelp(): void;
  closeHelp(): void;
  /** progress window: any open state, plus the Shift+I hint mode */
  progressOpen: boolean;
  progressHints: boolean; // armed only for the Shift+I open
  hintProgress(): void; // Shift+I: open with the keys hinted
  goNextUnit(): void; // App computes prev/next from its pager memo
  goPrevUnit(): void;
  jumpLesson(): void; // App: lesson -> first exercise, exercises -> lesson
  focusUnitPanel(): void; // App focuses the route's unit (first one on the landing)
  toggleSidebar(): void; // App: burger toggle (no focus move)
  cycleTheme(): void; // App cycles system/light/dark
}

export function useCourseShortcuts(hookDeps: ShortcutDeps): void {
  // latest deps without re-subscribing the window listener
  const depsRef = useRef(hookDeps);
  depsRef.current = hookDeps;

  // where "Esc = go back" returns to from the unit panel
  const lastFocus = useRef<HTMLElement | null>(null);

  // never anchor on the unit panel itself, which has its own scoped keys;
  // the body is not a focus location (focus() on it is a no-op), so leaving
  // it out lets restoreFocus fall back instead of stranding the focus
  const rememberFocus = () => {
    const el = document.activeElement;
    if (
      el instanceof HTMLElement &&
      el !== document.body &&
      !el.closest("nav.sidebar")
    ) {
      lastFocus.current = el;
    }
  };

  const restoreFocus = () => {
    const el = lastFocus.current;
    lastFocus.current = null;
    if (el && el.isConnected) {
      el.focus();
    } else {
      focusFirstExercise();
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 1. help modal open: only Esc does anything
      if (depsRef.current.helpOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          depsRef.current.closeHelp();
        }
        return;
      }

      // 2. progress window that Shift+I opened: a plain letter clicks the
      // control carrying it (A / I / E / S). Only in hint mode — the window
      // opened from the topbar button leaves plain letters alone.
      // Esc is the modal's own window listener — not repeated here, so one
      // key press can never run the close path twice.
      if (depsRef.current.progressOpen && depsRef.current.progressHints) {
        // plain letters only: no modifiers, no auto-repeat. Shift+I while
        // the window is open falls through to the global Shift+I branch
        // instead of clicking Import a second time.
        if (
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          !e.repeat
        ) {
          const hint = PROGRESS_HINTS[e.code];
          const target =
            hint &&
            document.querySelector<HTMLElement>(`[data-modal-key="${hint}"]`);
          if (target) {
            e.preventDefault();
            // a click lands the same way as the pointer: buttons fire
            // onClick, the checkbox label forwards to its hidden input
            target.click();
            return;
          }
        }
      }

      // 3. exercise scope — BEFORE the defaultPrevented guard, because
      // GapInput calls preventDefault on every plain Enter
      const ex = document.activeElement?.closest(".exercise");
      if (ex) {
        if (
          (e.ctrlKey || e.metaKey) &&
          !e.shiftKey &&
          !e.altKey &&
          e.key === "Enter"
        ) {
          e.preventDefault();
          ex.querySelector<HTMLButtonElement>('[data-shortcut="check"]')?.click();
          return;
        }
        if (
          e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !e.altKey &&
          e.code === "KeyA"
        ) {
          e.preventDefault();
          ex.querySelector<HTMLButtonElement>('[data-shortcut="reveal"]')?.click();
          return;
        }
      }

      // 4. a control that handled the key itself wins
      if (e.defaultPrevented) return;

      // 5. Shift+? opens help (e.key === "?" already implies Shift)
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        depsRef.current.openHelp();
        return;
      }

      // 6. sidebar scope: arrows move focus among the unit buttons
      if (document.activeElement?.closest(".sidebar")) {
        if (e.key === "Escape") {
          e.preventDefault();
          restoreFocus();
          return;
        }
        if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown"
        ) {
          e.preventDefault();
          moveSidebarFocus(e.key);
          return;
        }
      }
      // Alt+Shift+E toggles the sidebar like the burger button, without
      // moving focus into it (before the plain Shift+E branch)
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyE") {
        e.preventDefault();
        depsRef.current.toggleSidebar();
        return;
      }

      // 7. global letter shortcuts (after sidebar scope so they still work
      // while focus sits in the unit panel)
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.code) {
          case "KeyS":
            e.preventDefault();
            depsRef.current.jumpLesson();
            return;
          case "KeyE":
            e.preventDefault();
            rememberFocus();
            depsRef.current.focusUnitPanel();
            return;
          case "KeyN":
            e.preventDefault();
            depsRef.current.goNextUnit();
            return;
          case "KeyP":
            e.preventDefault();
            depsRef.current.goPrevUnit();
            return;
          case "KeyT":
            e.preventDefault();
            depsRef.current.cycleTheme();
            return;
          case "KeyI":
            e.preventDefault();
            depsRef.current.hintProgress();
            return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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

// sidebar arrow navigation: from nav.sidebar, groups of .unitlink buttons;
// plain focus() so the sidebar scroller brings the button into view
function moveSidebarFocus(key: string): void {
  const nav = document.querySelector("nav.sidebar");
  if (!nav) return;
  const groups = [...nav.querySelectorAll(".group")].map((g) =>
    [...g.querySelectorAll<HTMLElement>("button.unitlink")],
  );
  const active = document.activeElement;
  if (!active || !(active instanceof HTMLElement)) return;
  const btn = active.closest("button.unitlink") as HTMLButtonElement | null;
  let gi = -1;
  let ui = -1;
  for (let i = 0; i < groups.length; i++) {
    const idx = groups[i].indexOf(btn as HTMLButtonElement);
    if (idx !== -1) {
      gi = i;
      ui = idx;
      break;
    }
  }
  if (gi === -1) return;
  const btns = groups[gi];
  let target: HTMLElement | undefined;
  switch (key) {
    case "ArrowRight":
      target = btns[ui + 1] ?? groups[gi + 1]?.[0];
      break;
    case "ArrowLeft":
      target = btns[ui - 1] ?? groups[gi - 1]?.[groups[gi - 1].length - 1];
      break;
    case "ArrowDown":
      target = groups[gi + 1]?.[0];
      break;
    case "ArrowUp":
      target = groups[gi - 1]?.[0];
      break;
  }
  target?.focus();
}
