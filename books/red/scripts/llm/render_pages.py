"""Render book.pdf pages to work/img/pNNN.jpg for the vision models.

Usage:  python scripts/llm/render_pages.py [first last]   (default: all pages)
"""
import sys

import pymupdf

from common import IMG, PDF

DPI = 150  # ~ the scan's native resolution (1600 px wide)


def main():
    doc = pymupdf.open(str(PDF))
    lo, hi = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) == 3 else (1, doc.page_count)
    IMG.mkdir(parents=True, exist_ok=True)
    for p in range(lo, hi + 1):
        out = IMG / ("p%03d.jpg" % p)
        if out.exists():
            continue
        doc[p - 1].get_pixmap(dpi=DPI).save(str(out), jpg_quality=90)
    print("rendered pages %d..%d -> %s" % (lo, hi, IMG))


if __name__ == "__main__":
    main()
