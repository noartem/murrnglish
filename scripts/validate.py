"""Structural validator for parsed exercise JSON.

Per-file mode:   python scripts/validate.py <file.json> [more...]
Full-run mode:   python scripts/validate.py

Rules (units):
- JSON parses; 'unit' matches filename; title non-empty; pdfPages = 2 ints
- exercises: id 'N.M' with N == unit, unique in file, instruction non-empty,
  type in {fill-in, choice, matching, write, self-check}
- fill-in: parts.length == answers.length + 1 (parts len 1 + answers [] is a
  legal printed example); every gap has >= 1 non-empty string variant
- choice: >= 2 options; answer is an int or non-empty list of ints in range
  (list = several correct options, key says "both"/"A or B")
- matching: one pair per left index, right indices valid
- write: every item has >= 1 non-empty answer
- self-check: every item has a modelAnswers list; empty only when logged in
  work/missing-key.txt
- coverage (full run): ids printed on the unit's pages (consecutive run
  N.1, N.2, ...) == ids in JSON

Full run: all 145 unit files, all additional files, data/index.json groups
cover 1..145 exactly once, additional list matches files.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = {"fill-in", "choice", "matching", "write", "self-check"}
ID_RE = re.compile(r"(?m)^\s*(\d{1,3})\.(\d{1,2})\s+\S")
MISSING_KEY = ROOT / "work" / "missing-key.txt"


def nonempty_str(x):
    return isinstance(x, str) and x.strip() != ""


def consecutive_ids(ids):
    by_unit = {}
    for u, m in ids:
        by_unit.setdefault(u, set()).add(m)
    keep = set()
    for u, ms in by_unit.items():
        k = 1
        while k in ms:
            keep.add((u, k))
            k += 1
    return keep


def page_ids(pages):
    ids = set()
    for p in pages:
        t = ROOT / "work" / "pages" / ("plain/p%03d.txt" % p)
        if not t.exists():
            continue
        for m in ID_RE.finditer(t.read_text(encoding="utf-8", errors="replace")):
            ids.add((int(m.group(1)), int(m.group(2))))
    return consecutive_ids(ids)


def valid_choice_answer(ans, n_opts):
    if isinstance(ans, int):
        return 0 <= ans < n_opts
    if isinstance(ans, list) and ans and all(isinstance(a, int) for a in ans):
        return all(0 <= a < n_opts for a in ans)
    return False


def check_exercise(ex, name, missing_key_txt, errors):
    """Type-level checks for one exercise; returns nothing, appends errors."""
    eid = str(ex.get("id"))
    if not nonempty_str(ex.get("instruction")):
        errors.append("%s %s: instruction empty" % (name, eid))
    if ex.get("type") not in TYPES:
        errors.append("%s %s: bad type %r" % (name, eid, ex.get("type")))
        return
    wb = ex.get("wordBank")
    if wb is not None and not (isinstance(wb, list) and wb and all(nonempty_str(w) for w in wb)):
        errors.append("%s %s: wordBank invalid" % (name, eid))
    items = ex.get("items", [])
    nums = [it.get("num") for it in items]
    if len(set(nums)) != len(nums):
        errors.append("%s %s: duplicate item nums" % (name, eid))
    t = ex["type"]
    if t == "fill-in":
        for it in items:
            parts, answers = it.get("parts"), it.get("answers")
            if not (isinstance(parts, list) and isinstance(answers, list)
                    and len(parts) == len(answers) + 1):
                errors.append("%s %s item %s: parts/answers length"
                              % (name, eid, it.get("num")))
                continue
            for i, variants in enumerate(answers):
                if not (isinstance(variants, list) and variants
                        and all(nonempty_str(v) for v in variants)):
                    errors.append("%s %s item %s gap %d: empty variants"
                                  % (name, eid, it.get("num"), i))
    elif t == "choice":
        for it in items:
            opts, ans = it.get("options"), it.get("answer")
            if not (isinstance(opts, list) and len(opts) >= 2
                    and valid_choice_answer(ans, len(opts))):
                errors.append("%s %s item %s: choice invalid" % (name, eid, it.get("num")))
    elif t == "matching":
        lo, ro, pairs = ex.get("leftOptions"), ex.get("rightOptions"), ex.get("pairs")
        if not (isinstance(lo, list) and lo and isinstance(ro, list) and ro
                and isinstance(pairs, list)):
            errors.append("%s %s: matching fields invalid" % (name, eid))
            return
        lefts = [p[0] for p in pairs if isinstance(p, list) and len(p) == 2]
        if sorted(lefts) != list(range(len(lo))):
            errors.append("%s %s: pairs must cover each left index once" % (name, eid))
        for p in pairs:
            if not (isinstance(p, list) and len(p) == 2
                    and 0 <= p[0] < len(lo) and 0 <= p[1] < len(ro)):
                errors.append("%s %s: pair %r out of range" % (name, eid, p))
    elif t == "write":
        for it in items:
            answers = it.get("answers")
            if not (isinstance(answers, list) and answers
                    and all(nonempty_str(a) for a in answers)):
                errors.append("%s %s item %s: write answers empty" % (name, eid, it.get("num")))
    elif t == "self-check":
        for it in items:
            ma = it.get("modelAnswers")
            if not isinstance(ma, list):
                errors.append("%s %s item %s: modelAnswers missing"
                              % (name, eid, it.get("num")))
            elif not ma and eid not in missing_key_txt:
                errors.append("%s %s item %s: empty modelAnswers not logged in missing-key.txt"
                              % (name, eid, it.get("num")))


def validate_unit_file(path, errors):
    name = path.name
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        errors.append("%s: JSON parse: %s" % (name, e))
        return set()
    unit = data.get("unit")
    if not isinstance(unit, int) or "%03d" % unit != name[5:8]:
        errors.append("%s: unit/filename mismatch" % name)
    if not nonempty_str(data.get("title")):
        errors.append("%s: title empty" % name)
    pp = data.get("pdfPages")
    if not (isinstance(pp, list) and len(pp) == 2 and all(isinstance(x, int) for x in pp)):
        errors.append("%s: pdfPages must be 2 ints" % name)

    missing_key_txt = MISSING_KEY.read_text(encoding="utf-8") if MISSING_KEY.exists() else ""
    seen = set()
    for ex in data.get("exercises", []):
        eid = ex.get("id", "")
        m = re.match(r"^(\d{1,3})\.(\d{1,2})$", str(eid))
        if not m or int(m.group(1)) != unit:
            errors.append("%s: bad id %r" % (name, eid))
            continue
        if eid in seen:
            errors.append("%s: duplicate id %s" % (name, eid))
        seen.add(eid)
        check_exercise(ex, name, missing_key_txt, errors)
    return seen


def validate_additional_file(path, errors):
    name = path.name
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        errors.append("%s: JSON parse: %s" % (name, e))
        return None
    if data.get("id") is None:
        errors.append("%s: id missing" % name)
    if not nonempty_str(data.get("topic")):
        errors.append("%s: topic empty" % name)
    pp = data.get("pdfPages")
    if not (isinstance(pp, list) and pp and all(isinstance(x, int) for x in pp) and pp[0] > 0):
        errors.append("%s: pdfPages invalid" % name)
    ex = data.get("exercise")
    if not isinstance(ex, dict):
        errors.append("%s: exercise missing" % name)
        return data.get("id")
    eid = str(ex.get("id"))
    if not re.match(r"^\d{1,2}$", eid) or int(eid) != data.get("id"):
        errors.append("%s: exercise id %r must equal additional id" % (name, eid))
    missing_key_txt = MISSING_KEY.read_text(encoding="utf-8") if MISSING_KEY.exists() else ""
    check_exercise(ex, name, missing_key_txt, errors)
    return data.get("id")


def full_run():
    errors = []
    n_ex = 0
    unit_ids = set()
    lay = json.loads((ROOT / "work" / "layout.json").read_text(encoding="utf-8"))
    for un in range(1, 146):
        path = ROOT / "data" / "units" / ("unit-%03d.json" % un)
        if not path.exists():
            errors.append("missing file %s" % path.name)
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            errors.append("%s: JSON parse: %s" % (path.name, e))
            continue
        seen = validate_unit_file(path, errors)
        want = {(u, m) for (u, m) in page_ids(lay["units"][str(un)]["pdfPages"]) if u == un}
        got = {(un, int(e.split(".")[1])) for e in seen}
        if want != got:
            miss = sorted(want - got)
            extra = sorted(got - want)
            errors.append("unit %d: coverage pages=%s json=%s missing=%s extra=%s"
                          % (un, sorted(want), sorted(got), miss, extra))
        unit_ids.add(un)
        n_ex += len(data.get("exercises", []))

    index = json.loads((ROOT / "data" / "index.json").read_text(encoding="utf-8"))
    idx_units = [u for g in index["groups"] for u in g["units"]]
    if sorted(idx_units) != list(range(1, 146)):
        errors.append("index groups do not cover 1..145 exactly: %d entries" % len(idx_units))
    add_files = sorted((ROOT / "data" / "additional").glob("*.json"))
    add_ids = set()
    for p in add_files:
        rid = validate_additional_file(p, errors)
        if rid is not None:
            add_ids.add(rid)
    add_list = set(index.get("additional", {}).get("exercises", []))
    if add_list != add_ids:
        errors.append("additional index %d != files %d (diff %s)"
                      % (len(add_list), len(add_ids), sorted(add_list ^ add_ids)[:10]))
    n_add = len(add_files)

    print("units: %d/145, unit exercises: %d, additional files: %d"
          % (len(unit_ids), n_ex, n_add))
    if errors:
        print("VALIDATION ERRORS (%d):" % len(errors))
        for e in errors[:60]:
            print(" -", e)
        if len(errors) > 60:
            print(" ... and %d more" % (len(errors) - 60))
        sys.exit(1)
    print("OK")


def main():
    args = sys.argv[1:]
    if not args:
        full_run()
        return
    errors = []
    for a in args:
        p = Path(a)
        if "additional" in str(p):
            validate_additional_file(p, errors)
        else:
            validate_unit_file(p, errors)
    if errors:
        print("VALIDATION ERRORS (%d):" % len(errors))
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("OK %d file(s)" % len(args))


if __name__ == "__main__":
    main()
