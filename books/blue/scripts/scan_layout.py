"""Scan work/pages/plain for structural markers -> work/layout.json

Verified book order (PDF pages):
  units 1-145: 14-303 (2 pages each) | Appendices 1-7: 304-313 |
  Additional exercises: 314-337 | Study guide: 338-347 |
  Key to Exercises: 348-379 | Key to Additional exercises: 380-383 |
  Key to Study guide: 384+

Marker forms:
- unit header: line 'Unit' alone, next line ' N <Title>' (or one-line
  'Unit N <Title>')
- section headers are indented; 'Key to Additional exercises' carries a
  suffix '(see page 302)'
- additional-exercise headings: ' N    <Instruction>' with N strictly sequential
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLAIN = ROOT / "work" / "pages" / "plain"
OUT = ROOT / "work" / "layout.json"

UNIT_NUM_TITLE = re.compile(r"^\s*(\d{1,3})\s{1,}([A-Za-z(-].+?)\s*$")
UNIT_ONELINE = re.compile(r"^Unit\s+(\d{1,3})\s+([A-Za-z(-].+?)\s*$")
UNIT_TITLE_LINE = re.compile(r"^Unit(?:\s{2,}|(?!s)(?=[A-Za-z(-]))([A-Za-z(-].+?)\s*$")
SEC_ADD = re.compile(r"^\s*Additional exercises\s*$")
EXERCISES_HDR = re.compile(r"(?m)^\s*Exercises\b.*$")
SEC_STUDY = re.compile(r"^\s*Study guide\s*$")
SEC_KEY = re.compile(r"^\s*Key to Exercises\s*$")
SEC_ADDKEY = re.compile(r"^\s*Key to Additional exercises\b")
SEC_KEYSTUDY = re.compile(r"^\s*Key to Study guide\b")
ADD_HEADING = re.compile(r"^\s{0,9}(\d{1,2})\s{2,}([A-Z-].+?)\s*$")
EX_ID = re.compile(r"(?m)^\s+(\d{1,3}\.\d)\s+\S")



def clean_title(t):
    parts = re.split(r"\s{8,}", t)
    while len(parts) > 1:
        last = parts[-1].strip()
        if (len(last.split()) <= 3 and len(last) <= 12
                and "?" not in last and "…" not in last):
            parts = parts[:-1]
        else:
            break
    t = re.sub(r"\s{2,}", " ", " ".join(parts)).strip()
    for lig, plain in (("ﬀ", "ff"), ("ﬁ", "fi"), ("ﬂ", "fl"), ("ﬃ", "ffi"), ("ﬄ", "ffl")):
        t = t.replace(lig, plain)
    return t

def page_text(n):
    return (PLAIN / ("p%03d.txt" % n)).read_text(encoding="utf-8", errors="replace")


def next_unit_header_page(t):
    ls = t.splitlines()
    for i in range(0, min(len(ls), 8)):
        if ls[i].strip() == "Unit" and i + 1 < len(ls) and UNIT_NUM_TITLE.match(ls[i + 1]):
            return True
        if UNIT_ONELINE.match(ls[i]):
            return True
        if UNIT_TITLE_LINE.match(ls[i]) and i + 1 < len(ls) and UNIT_NUM_TITLE.match(ls[i + 1]):
            return True
    return False


def first_page_after(pages, regex, lo):
    for n in range(lo, 395):
        for ln in pages[n].splitlines():
            if regex.match(ln):
                return n
    return None


def main():
    pages = {n: page_text(n) for n in range(1, 395)}

    # --- unit starts (scan up to the appendices zone) -----------------------
    units = {}
    for n in range(1, 314):
        ls = pages[n].splitlines()
        for i, ln in enumerate(ls):
            cands = []
            if i > 0 and ls[i - 1].strip() == "Unit":
                m = UNIT_NUM_TITLE.match(ln)
                if m:
                    cands.append((int(m.group(1)), clean_title(m.group(2))))
            m = UNIT_ONELINE.match(ln)
            if m:
                cands.append((int(m.group(1)), clean_title(m.group(2))))
            if i + 1 < len(ls):
                m_t = UNIT_TITLE_LINE.match(ln)
                m_n = UNIT_NUM_TITLE.match(ls[i + 1])
                if m_t and m_n:
                    title = clean_title(m_t.group(1) + " " + m_n.group(2))
                    cands.append((int(m_n.group(1)), title))
            for un, title in cands:
                if un in units or not (1 <= un <= 145):
                    continue
                nxt = pages[n + 1] if n + 1 <= 394 else ""
                if EX_ID.search(pages[n]) or EXERCISES_HDR.search(nxt):
                    units[un] = {"pdfStart": n, "title": title}

    errors = []
    if len(units) != 145:
        missing = sorted(set(range(1, 146)) - set(units))
        errors.append("units found=%d missing=%s" % (len(units), missing[:20]))
    if errors:
        print("SCAN ERRORS:")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    units_end = max(max([u["pdfStart"] + 1]) for u in units.values())

    # --- section boundaries (position-aware, after units) -------------------
    add_start = first_page_after(pages, SEC_ADD, units_end + 1)
    add_end = None
    study_start = first_page_after(pages, SEC_STUDY, add_start + 1) if add_start else None
    if add_start and study_start:
        add_end = study_start - 1
    key_start = first_page_after(pages, SEC_KEY, add_end + 1) if add_end else None
    addkey_start = first_page_after(pages, SEC_ADDKEY, (key_start or 1) + 1) if key_start else None
    keystudy_start = first_page_after(pages, SEC_KEYSTUDY, (addkey_start or 1) + 1) if addkey_start else None
    addkey_end = keystudy_start - 1 if keystudy_start else None

    # --- exercise page extension (spill) -----------------------------------
    appendix_start = first_page_after(pages, re.compile(r"^\s*Appendix 1\s*$"), 300)
    cap = (appendix_start or 304) - 1
    for un in sorted(units):
        ex_page = units[un]["pdfStart"] + 1
        pages_used = [units[un]["pdfStart"], ex_page]
        own = str(un) + "."
        while ex_page + 1 <= cap:
            spill = pages[ex_page + 1]
            if next_unit_header_page(spill):
                break
            ids = set(EX_ID.findall(spill))
            if any(i.startswith(str(un + 1) + ".") for i in ids):
                break
            if not any(i.startswith(own) for i in ids):
                break
            pages_used.append(ex_page + 1)
            ex_page += 1
        units[un]["pdfPages"] = pages_used

    # --- additional exercise headings --------------------------------------
    add_ex = []
    if add_start and add_end:
        want = 1
        for n in range(add_start, add_end + 1):
            for ln in pages[n].splitlines():
                m = ADD_HEADING.match(ln)
                if m and int(m.group(1)) == want:
                    add_ex.append({"id": want, "startPage": n, "title": m.group(2).strip()})
                    want += 1
        for k, ex in enumerate(add_ex):
            end_page = add_ex[k + 1]["startPage"] if k + 1 < len(add_ex) else add_end
            ex["pages"] = list(range(ex["startPage"], end_page + 1))

    out = {
        "units": {
            str(un): {"pdfPages": units[un]["pdfPages"], "title": units[un]["title"]}
            for un in sorted(units)
        },
        "additionalStart": add_start,
        "additionalEnd": add_end,
        "keyStart": key_start,
        "keyEnd": addkey_start - 1 if addkey_start else None,
        "addKeyStart": addkey_start,
        "addKeyEnd": addkey_end,
        "studyGuideStart": study_start,
        "keyStudyGuideStart": keystudy_start,
        "appendicesStart": units_end + 1,
        "additionalExercises": [
            {"id": ex["id"], "pages": ex["pages"], "title": ex["title"]} for ex in add_ex
        ],
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")

    # --- assertions ---------------------------------------------------------
    for un in sorted(units):
        if len(units[un]["pdfPages"]) < 2:
            errors.append("unit %d pages<2" % un)
    if not (add_start and add_end and add_end - add_start >= 19):
        errors.append("additional range %s..%s too small" % (add_start, add_end))
    if not (key_start and addkey_start and addkey_end and addkey_end > addkey_start):
        errors.append("key ranges %s %s %s" % (key_start, addkey_start, addkey_end))
    if not add_ex:
        errors.append("no additional exercise headings found")
    if errors:
        print("SCAN ERRORS:")
        for e in errors:
            print(" -", e)
        sys.exit(1)

    print("units=145 (end pdf %d) additional=%d..%d key=%d..%d addkey=%d..%d addEx=%d"
          % (units_end, add_start, add_end, key_start, addkey_start - 1,
             addkey_start, addkey_end, len(add_ex)))
    spills = [(un, len(units[un]["pdfPages"])) for un in sorted(units)
              if len(units[un]["pdfPages"]) > 2]
    print("units with >2 pages:", spills)
    print("first/last unit pages:", units[1]["pdfPages"], units[145]["pdfPages"])
    print("additional ids:", [e["id"] for e in add_ex])


if __name__ == "__main__":
    main()
