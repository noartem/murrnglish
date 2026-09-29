"""Extract per-page text from book.pdf (this book's root).

Plain output:  pdftotext -layout, one file per page -> work/pages/plain/pNNN.txt
Block output:  PyMuPDF blocks, 2-column reading order for key pages ->
               work/pages/blocks/pNNN.txt (other pages copy plain text).

Key-page ranges are read from work/layout.json when present; otherwise the
conservative defaults below are used (superset is safe later: split_key works
from unit-header spans, not ranges).

Usage:  python scripts/extract_pages.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "book.pdf"
PLAIN = ROOT / "work" / "pages" / "plain"
BLOCKS = ROOT / "work" / "pages" / "blocks"
LAYOUT = ROOT / "work" / "layout.json"

DEFAULT_KEY_RANGES = [(348, 379), (380, 394)]


def read_layout():
    if LAYOUT.exists():
        return json.loads(LAYOUT.read_text(encoding="utf-8"))
    return None


def extract_plain(total):
    for n in range(1, total + 1):
        out = PLAIN / ("p%03d.txt" % n)
        r = subprocess.run(
            ["pdftotext", "-layout", "-f", str(n), "-l", str(n), str(PDF), str(out)],
            check=False,
        )
        if r.returncode != 0:
            print("FAIL pdftotext page %d" % n, file=sys.stderr)
            sys.exit(1)


def extract_blocks(total):
    import pymupdf

    doc = pymupdf.open(str(PDF))
    key_pages = set()
    layout = read_layout()
    if layout is not None:
        if layout.get("keyStart"):
            key_pages.update(range(layout["keyStart"], layout["keyEnd"] + 1))
        if layout.get("addKeyStart"):
            key_pages.update(range(layout["addKeyStart"], layout["addKeyEnd"] + 1))
    else:
        for lo, hi in DEFAULT_KEY_RANGES:
            key_pages.update(range(lo, hi + 1))

    for n in range(1, total + 1):
        out = BLOCKS / ("p%03d.txt" % n)
        if n not in key_pages:
            out.write_text(
                (PLAIN / ("p%03d.txt" % n)).read_text(encoding="utf-8", errors="replace"),
                encoding="utf-8",
            )
            continue

        page = doc[n - 1]
        mid = page.rect.width / 2
        blocks = [b for b in page.get_text("blocks") if b[4].strip()]
        blocks.sort(key=lambda b: (1 if b[0] > mid + 5 else 0, round(b[1], 1), round(b[3], 1)))
        parts = []
        for b in blocks:
            text = b[4].rstrip()
            if text:
                parts.append(text)
        out.write_text("\n\n".join(parts) + "\n", encoding="utf-8")
    doc.close()


def main():
    if not PDF.exists():
        sys.exit("missing " + str(PDF))
    PLAIN.mkdir(parents=True, exist_ok=True)
    BLOCKS.mkdir(parents=True, exist_ok=True)
    import pymupdf

    doc = pymupdf.open(str(PDF))
    total = doc.page_count
    doc.close()
    extract_plain(total)
    extract_blocks(total)
    print("extracted %d pages: plain + blocks" % total)


if __name__ == "__main__":
    main()
