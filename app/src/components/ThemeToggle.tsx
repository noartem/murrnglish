// Top-right control cycling the theme: system → light → dark → system.

import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyTheme, loadTheme, saveTheme, watchSystemTheme } from "../theme";
import type { Theme } from "../theme";

const ORDER: Theme[] = ["system", "light", "dark"];

const LABEL: Record<Theme, string> = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
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

  return (
    <button
      className="themebtn"
      onClick={cycle}
      title={LABEL[theme]}
      aria-label={LABEL[theme]}
    >
      {ICON[theme]}
    </button>
  );
}
