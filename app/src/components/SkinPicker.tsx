// Topbar popover switching the visual skin (redesign preview).

import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { SKINS, loadSkin, saveSkin } from "../skin";
import type { Skin } from "../skin";

export function SkinPicker() {
  const [skin, setSkin] = useState<Skin>(loadSkin);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => saveSkin(skin), [skin]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="skinpicker" ref={rootRef}>
      <button
        className="themebtn"
        onClick={() => setOpen((v) => !v)}
        title="Design variant"
        aria-label="Design variant"
        aria-expanded={open}
      >
        <Palette size={15} strokeWidth={1.6} aria-hidden />
      </button>
      {open && (
        <div className="skinmenu" role="menu">
          {SKINS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={skin === s.id}
              className={"skinitem" + (skin === s.id ? " on" : "")}
              onClick={() => setSkin(s.id)}
            >
              <span className={"skinswatch sw-" + s.id} aria-hidden />
              <span className="skintext">
                <span className="skinlabel">{s.label}</span>
                <span className="skinhint">{s.hint}</span>
              </span>
              {skin === s.id && <Check size={14} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
