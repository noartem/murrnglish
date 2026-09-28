// Visual skin (redesign preview): same markup and UX, different CSS layer.
// Applied as data-skin="<id>" on <html>; "classic" removes the attribute so
// the base stylesheet renders untouched. Persisted in localStorage; an inline
// script in index.html sets it before first paint.

export const SKINS = [
  { id: "classic", label: "Classic", hint: "current design" },
  { id: "paper", label: "Paper", hint: "editorial workbook, serif, ink" },
  { id: "studio", label: "Studio", hint: "modern product UI, soft cards" },
  { id: "notebook", label: "Notebook", hint: "friendly, chunky, lined paper" },
  { id: "mono", label: "Mono", hint: "brutalist, hard edges, acid accent" },
] as const;

export type Skin = (typeof SKINS)[number]["id"];

const KEY = "egu-skin";

export function loadSkin(): Skin {
  const s = localStorage.getItem(KEY);
  return SKINS.some((k) => k.id === s) ? (s as Skin) : "classic";
}

export function saveSkin(s: Skin): void {
  localStorage.setItem(KEY, s);
  if (s === "classic") delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = s;
}
