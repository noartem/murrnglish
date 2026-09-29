// Theme: "light" | "dark" | "system" (default), persisted in localStorage.
// The effective scheme is applied as data-theme="light|dark" on <html>;
// an inline script in index.html sets it before first paint.

import { THEME_KEY as KEY } from "./keys";

export type Theme = "light" | "dark" | "system";

export function loadTheme(): Theme {
  const t = localStorage.getItem(KEY);
  return t === "light" || t === "dark" ? t : "system";
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme =
    t === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : t;
}

export function saveTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

// In system mode, follow OS scheme changes. Returns an unsubscribe fn.
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
