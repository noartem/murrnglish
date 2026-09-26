"""Render page images for the web app.

Renders exactly the pages listed in work/layout.json (unit pages + additional
exercise pages) at 125 dpi color PNG into app/public/pages/pNNN.png.
Contingency if app/public/pages exceeds 200 MB total:
  pass --gray 150  (grayscale, 150 dpi)  or  --gray 100 (grayscale, 100 dpi)
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "original" / "book.pdf"
OUT = ROOT / "app" / "public" / "pages"
LAYOUT = ROOT / "work" / "layout.json"


def pages_to_render(lay):
    pages = set()
    for u in lay["units"].values():
        pages.update(u["pdfPages"])
    for ex in lay.get("additionalExercises", []):
        pages.update(ex["pages"])
    return sorted(pages)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gray", type=int, choices=[100, 150], default=None)
    args = ap.parse_args()

    lay = json.loads(LAYOUT.read_text(encoding="utf-8"))
    pages = pages_to_render(lay)
    OUT.mkdir(parents=True, exist_ok=True)

    done = 0
    for n in pages:
        out_base = OUT / ("p%03d" % n)
        png = out_base.with_suffix(".png")
        if png.exists() and png.stat().st_size > 1000:
            done += 1
            continue
        cmd = ["pdftoppm", "-r", str(args.gray or 125), "-png"]
        if args.gray:
            cmd.append("-gray")
        cmd += ["-f", str(n), "-l", str(n), "-singlefile", str(PDF), str(out_base)]
        r = subprocess.run(cmd, check=False, capture_output=True, text=True)
        if r.returncode != 0 or not png.exists():
            print("FAIL page %d: %s" % (n, (r.stderr or "")[:200]), file=sys.stderr)
            sys.exit(1)
        done += 1
        if done % 25 == 0:
            print("rendered %d/%d" % (done, len(pages)))
    print("rendered %d pages into %s" % (done, OUT))


if __name__ == "__main__":
    main()
