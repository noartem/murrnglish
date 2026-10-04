// Which app-wide window is open, and whether a key opened it. The keyboard
// dispatcher (shortcuts.ts) reads this module instead of taking props, so the
// help, the data window and the book picker work in every view and no view
// has to register its own window listener for them. App mounts the three
// windows off useGlobalModal().

import { useSyncExternalStore } from "react";

/** The windows the whole app owns: help, data (export/import/share), book picker. */
export type GlobalModal = "help" | "data" | "books" | null;

let modal: GlobalModal = null;
// "opened by a key" arms the window's letter shortcuts — the hint mode the
// progress window had for its Shift+I. The topbar button opens it unarmed.
let hints = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openGlobal(m: Exclude<GlobalModal, null>, withHints = false): void {
  modal = m;
  hints = withHints;
  emit();
}

export function closeGlobal(): void {
  modal = null;
  hints = false;
  emit();
}

export function currentGlobal(): GlobalModal {
  return modal;
}

export function globalHints(): boolean {
  return hints;
}

/** The open window, for the component that renders it. */
export function useGlobalModal(): GlobalModal {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => modal,
  );
}