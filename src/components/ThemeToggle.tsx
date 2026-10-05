// Control cycling the theme: system → light → dark → system. It is one of
// the app's controls in the navigation panel, so it renders as a tool — the
// icon of the current theme over its name, with the key in the tooltip.

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { SC } from "../shortcuts";
import { applyTheme, loadTheme, saveTheme, watchSystemTheme } from "../theme";
import type { Theme } from "../theme";

const ORDER: Theme[] = ["system", "light", "dark"];

const LABEL: Record<Theme, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
};

const SHORT: Record<Theme, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

const ICON: Record<Theme, ReactElement> = {
  system: <Monitor size={15} strokeWidth={1.6} aria-hidden />,
  light: <Sun size={15} strokeWidth={1.6} aria-hidden />,
  dark: <Moon size={15} aria-hidden />,
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    saveTheme(theme);
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  function cycle() {
    setTheme(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]);
  }

  const title = `${LABEL[theme]} — ${SC.cycleTheme}`;
  return (
    <button className="navtile" onClick={cycle} title={title} aria-label={title}>
      {ICON[theme]}
      <span className="navtoollabel">{SHORT[theme]}</span>
    </button>
  );
}