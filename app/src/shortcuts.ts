// Central keyboard shortcuts: one window keydown dispatcher + the shared
// labels/help data used by tooltips and the help modal. Pane-scoped keys
// (arrows / zoom / R / Esc) are NOT here — they live on the focused
// .pageviewer container itself (PageViewer onKeyDown); this dispatcher
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
  pagePane: "Shift+S",
  sidebarToggle: "Alt+Shift+E",
  cycleTheme: "Shift+T",
  invertPage: "T",
  help: "Shift+?",
} as const;

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
    desc: "Shows the unit list and focuses the current unit. If the list was hidden, it appears over the page, like when you move the mouse to the left edge.",
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
    title: "Book page",
    desc: "Moves the focus to the book page on the left.",
    sub: [
      { keys: ["\u2191 / \u2193", "\u2190 / \u2192"], desc: "scroll the page" },
      { keys: ["PgUp"], alt: ["PgDn"], desc: "scroll one screen up / down" },
      { keys: ["Home"], alt: ["End"], desc: "jump to the top / bottom" },
      { keys: ["Ctrl", "="], alt: ["Ctrl", "\u2212"], desc: "zoom in / zoom out" },
      { keys: ["T"], desc: "invert the page colors (dark theme only)" },
      { keys: ["Esc"], desc: "go back to where you were (or to the first exercise)" },
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


// "Shift+?" arrives as e.key === "?" with shiftKey set on every layout.
// Letter shortcuts (S/E/N/P/A) always check e.code, so they work on any
// keyboard layout. Handler order (critical):
//   1. help modal open  2. exercise scope  3. defaultPrevented guard
//   4. help toggle  5. sidebar scope  6. global letters
export interface ShortcutDeps {
  helpOpen: boolean;
  openHelp(): void;
  closeHelp(): void;
  goNextUnit(): void; // App computes prev/next from its pager memo
  goPrevUnit(): void;
  focusPagePane(): void; // App bumps the pane focus tick
  focusUnitPanel(): void; // App focuses the active unit button
  toggleSidebar(): void; // App: burger toggle (no focus move)
  cycleTheme(): void; // App cycles system/light/dark
}

export function useCourseShortcuts(hookDeps: ShortcutDeps): { restoreFocus(): void } {
  // latest deps without re-subscribing the window listener
  const depsRef = useRef(hookDeps);
  depsRef.current = hookDeps;

  // where "Esc = go back" returns to (unit panel / book pane chains)
  const lastFocus = useRef<HTMLElement | null>(null);

  // never anchor on the two panes that have their own scoped keys, so
  // chaining Shift+S then Shift+E still returns to the exercise side
  const rememberFocus = () => {
    const el = document.activeElement;
    if (
      el instanceof HTMLElement &&
      !el.closest(".pageviewer") &&
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

      // 2. exercise scope — BEFORE the defaultPrevented guard, because
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

      // 3. the pane container's own onKeyDown wins for arrows/Esc/zoom/R
      if (e.defaultPrevented) return;

      // 4. Shift+? opens help (e.key === "?" already implies Shift)
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        depsRef.current.openHelp();
        return;
      }

      // 5. sidebar scope: arrows move focus among the unit buttons
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

      // 6. global letter shortcuts (after sidebar scope so they still work
      // while focus sits in the unit panel)
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.code) {
          case "KeyS":
            e.preventDefault();
            rememberFocus();
            depsRef.current.focusPagePane();
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
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { restoreFocus };
}

/** Focus the first interactive element of the first exercise in the pane. */
export function focusFirstExercise(): void {
  const first = document
    .querySelector(".rightpane")
    ?.querySelector<HTMLElement>(
      ".exercise textarea, .exercise input, .exercise select, .exercise button",
    );
  first?.focus({ preventScroll: true });
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
