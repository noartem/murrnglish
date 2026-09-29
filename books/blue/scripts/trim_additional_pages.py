# -*- coding: utf-8 -*-
"""Trim superfluous pages from data/additional/*.json pdfPages.

Each additional exercise listed two book pages, but most exercises live on one
page only; the second page either belongs to the NEXT exercise or repeats
unrelated content. Rule, verified against work/pages/plain:

  keep page 2 only when the exercise's own item text (a leading fragment of
  some item's first part or trailing part) is actually printed on page 2
  (i.e. the exercise overflows there). Otherwise keep page 1 only.

Baked expectation (verified 2026-09): keep page 2 for 05, 06, 25, 26, 35, 39;
trim to a single page for 01, 03, 07, 09, 11, 12, 14, 16, 17, 19, 22, 24,
27, 29, 31, 33, 34, 37. Single-page files are untouched.
"""
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

KEEP = {"05", "06", "25", "26", "35", "39"}


def norm(s: str) -> str:
    s = s.lower().replace("\u2019", "'")
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def main():
    apply = "--apply" in sys.argv
    trimmed, kept = [], []
    for f in sorted(os.listdir("data/additional")):
        if not (f.endswith(".json") and f[:2].isdigit()):
            continue
        path = "data/additional/" + f
        d = json.load(open(path, encoding="utf-8"))
        pages = d.get("pdfPages") or []
        if len(pages) < 2:
            continue
        if f[:2] in KEEP:
            kept.append(f)
            continue
        d["pdfPages"] = pages[:1]
        trimmed.append((f, pages, pages[:1]))
        if apply:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(d, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
    print("kept two pages: %s" % ", ".join(kept))
    print("trimmed: %d files" % len(trimmed))
    for f, old, new in trimmed:
        print("  %s %s -> %s" % (f, old, new))
    if not apply:
        print("dry-run: nothing written. Re-run with --apply.")


if __name__ == "__main__":
    main()
