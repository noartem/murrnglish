// Which app-wide window is open, what it is holding, and whether a key opened
// it. The keyboard dispatcher (shortcuts.ts) reads this module instead of
// taking props, so the help, the data window and the book picker work in every
// view and no view has to register its own window listener for them. App
// mounts the three windows off useGlobalModal().
//
// The window's payload lives here for the same reason: a share link is opened
// by the course whose route carried it, but it is previewed and applied in the
// window — which every view can open, and which closes over its payload.

import { useSyncExternalStore } from "react";
import type { Incoming } from "./datatransfer";

/** The windows the whole app owns: help, search, data (progress + export/import/share), book picker. */
export type GlobalModal = "help" | "search" | "data" | "books" | null;

let modal: GlobalModal = null;
// "opened by a key" arms the window's letter shortcuts — the hint mode the
// progress window had for its Shift+I. The topbar button opens it unarmed.
let hints = false;
// what the data window is holding, waiting for its Apply: a picked file or the
// progress a share link carries. Closing the window drops it.
let incoming: Incoming | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function openGlobal(m: Exclude<GlobalModal, null>, withHints = false): void {
  modal = m;
  hints = withHints;
  emit();
}

export function closeGlobal(): void {
  modal = null;
  hints = false;
  incoming = null;
  emit();
}

/** Hand the data window something to preview and put it on screen. */
export function openIncoming(read: Incoming): void {
  incoming = read;
  modal = "data";
  hints = false;
  emit();
}

/** The payload is written (Apply) or dismissed (close) — either way, gone. */
export function clearIncoming(): void {
  if (!incoming) return;
  incoming = null;
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
  return useSyncExternalStore(subscribe, () => modal);
}

/** What the window is holding, for the component that renders it. */
export function useIncoming(): Incoming | null {
  return useSyncExternalStore(subscribe, () => incoming);
}