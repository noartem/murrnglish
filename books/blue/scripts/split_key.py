"""Split the answer key into per-unit files from key-page block text.

Geometry (2 columns x 2 sub-columns) makes y-sorted block order unreliable,
so spans are rebuilt from CONTENT: lines beginning 'N.M' own the following
continuation lines within their block. 'UNIT N' headers confirm unit presence.

Outputs:
  work/key/unit-NNN.txt     item groups for unit N, ordered by item number,
                            '# key pages:' line listing source pages
  work/key/additional.txt   the Key to Additional exercises grouped by
                            exercise number 1..41

Asserts: every unit 1..145 has a non-empty key section.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BLOCKS = ROOT / "work" / "pages" / "blocks"
KEYDIR = ROOT / "work" / "key"
LAYOUT = ROOT / "work" / "layout.json"

UNIT_HDR = re.compile(r"^\s*UNIT\s+(\d{1,3})\s*$")
ITEM = re.compile(r"^(\d{1,3})\.(\d{1,2})\b\s*(.*)$")
ADD_ITEM = re.compile(r"^(\d{1,2})\b\s*(.*)$")


def groups_from(lo, hi):
    """Return ({unit: [(subnum, text, page)]}, seen_unit_headers)."""
    groups = {}
    seen_units = set()
    last_owner = None
    for n in range(lo, hi + 1):
        text = (BLOCKS / ("p%03d.txt" % n)).read_text(encoding="utf-8", errors="replace")
        for block in text.split("\n\n"):
            block = block.strip()
            if not block:
                continue
            lines = block.splitlines()
            m_hdr = UNIT_HDR.match(lines[0])
            if m_hdr and len(lines) <= 2:
                seen_units.add(int(m_hdr.group(1)))
                if len(lines) == 2 and lines[1].strip():
                    groups.setdefault(last_owner, []).append(
                        (9999, lines[1].strip(), n))
                continue
            owner = None
            buf = []
            key = None
            for ln in lines:
                m = ITEM.match(ln)
                if m and m.group(2) != "":
                    if owner is not None and buf:
                        groups.setdefault(owner, []).append((key, "\n".join(buf), n))
                    owner = int(m.group(1))
                    key = int(m.group(2))
                    buf = [ln.strip()]
                else:
                    if owner is None:
                        # continuation block before any item line on this page:
                        # attribute to the last owner seen so far
                        if last_owner is not None:
                            groups.setdefault(last_owner, []).append((0, ln.strip(), n))
                        continue
                    buf.append(ln.rstrip())
            if owner is not None and buf:
                groups.setdefault(owner, []).append((key, "\n".join(buf), n))
                last_owner = owner
            elif owner is None:
                for ln in lines:
                    if ln.strip() and last_owner is not None:
                        groups.setdefault(last_owner, []).append((0, ln.strip(), n))
    return groups, seen_units


def main():
    lay = json.loads(LAYOUT.read_text(encoding="utf-8"))
    KEYDIR.mkdir(parents=True, exist_ok=True)

    groups, seen_units = groups_from(lay["keyStart"], lay["keyEnd"])

    errors = []
    for un in range(1, 146):
        if un not in seen_units and un not in groups:
            errors.append("unit %d: no UNIT header and no items" % un)
            continue
        items = sorted(groups.get(un, []), key=lambda g: (1 if g[0] else 0, g[2], g[0]))
        body = "\n\n".join(t for _, t, _ in items).strip()
        if not body:
            errors.append("unit %d key body empty" % un)
            continue
        pages = sorted({p for _, _, p in items})
        pg = "p%d" % pages[0] if len(pages) == 1 else "p%d-p%d" % (pages[0], pages[-1])
        (KEYDIR / ("unit-%03d.txt" % un)).write_text(
            "# key pages: %s\n\n%s\n" % (pg, body), encoding="utf-8")
    if errors:
        print("SPLIT ERRORS:")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    add_parts = []
    for n in range(lay["addKeyStart"], lay["addKeyEnd"] + 1):
        text = (BLOCKS / ("p%03d.txt" % n)).read_text(encoding="utf-8", errors="replace")
        if n == lay["addKeyStart"]:
            text = "\n".join(text.splitlines()[1:])
        add_parts.append(text.strip())
    add_body = "\n\n".join(p for p in add_parts if p)
    (KEYDIR / "additional.txt").write_text(add_body + "\n", encoding="utf-8")
    if len(add_body.strip()) < 200:
        sys.exit("additional key suspiciously short: %d chars" % len(add_body))

    n_items = sum(len(v) for v in groups.values())
    print("key units written: 145 (%d item groups); additional key: %d chars"
          % (n_items, len(add_body)))


if __name__ == "__main__":
    main()
