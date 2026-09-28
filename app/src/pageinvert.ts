// Page color inversion preference, persisted in localStorage under
// egu-course-page-invert. Exposed as data-page-invert="on|off" on <html>;
// the inline script in index.html applies it before first paint so a dark
// page never flashes the wrong colors. Default on — pages were inverted in
// dark theme before the toggle existed, and the pref is independent of the
// theme choice, so it survives theme switches.

const KEY = "egu-course-page-invert";

export function loadPageInvert(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true; // storage unavailable: keep the inverted look
  }
}

export function savePageInvert(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {
    // storage unavailable: choice silently not persisted
  }
  document.documentElement.dataset.pageInvert = v ? "on" : "off";
}
