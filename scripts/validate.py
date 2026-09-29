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
- write: every item has >= 1 non-empty answer; prompts may carry inline
  [underline] markers (balanced brackets, non-empty content)
- self-check: every item has a modelAnswers list; empty only when logged
  in work/missing-key.txt
- coverage (full run): every exercise id of the unit's answer key
  (work/layout.json keyExercises) is in the JSON; extra JSON ids are allowed
  only for self-check exercises (open tasks the key may not list); key
  exercises listed in notInScan (page missing from the scan) are exempt

Full run: all 115 unit files, all additional files, data/index.json groups
cover 1..115 exactly once, additional list matches files.
"""
import json
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
N_UNITS = 115
TYPES = {"fill-in", "choice", "matching", "write", "self-check"}
MISSING_KEY = ROOT / "work" / "missing-key.txt"


def nonempty_str(x):
    return isinstance(x, str) and x.strip() != ""


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
                if eid not in missing_key_txt:
                    errors.append("%s %s item %s: write answers empty"
                                  % (name, eid, it.get("num")))
            prompt = it.get("prompt")
            if nonempty_str(prompt) and prompt.count("[") != prompt.count("]"):
                errors.append("%s %s item %s: prompt markers unbalanced"
                              % (name, eid, it.get("num")))
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
    for un in range(1, N_UNITS + 1):
        path = ROOT / "data" / "units" / ("unit-%03d.json" % un)
        if not path.exists():
            errors.append("missing file %s" % path.name)
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            errors.append("%s: JSON parse: %s" % (path.name, e))
            continue
        validate_unit_file(path, errors)
        want = set(lay["units"][str(un)]["keyExercises"]) - set(lay["units"][str(un)].get("notInScan", []))
        types = {e.get("id"): e.get("type") for e in data.get("exercises", [])}
        miss = sorted(want - set(types))
        extra = sorted(e for e in set(types) - want if types[e] != "self-check")
        if miss or extra:
            errors.append("unit %d: coverage vs key: missing=%s extra non-self-check=%s"
                          % (un, miss, extra))
        unit_ids.add(un)
        n_ex += len(data.get("exercises", []))
    stray = sorted(p.name for p in (ROOT / "data" / "units").glob("unit-*.json")
                   if int(p.name[5:8]) > N_UNITS)
    if stray:
        errors.append("unit files beyond %d: %s" % (N_UNITS, stray[:5]))

    index = json.loads((ROOT / "data" / "index.json").read_text(encoding="utf-8"))
    idx_units = [u for g in index["groups"] for u in g["units"]]
    if sorted(idx_units) != list(range(1, N_UNITS + 1)):
        errors.append("index groups do not cover 1..%d exactly: %d entries"
                      % (N_UNITS, len(idx_units)))
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

    print("units: %d/%d, unit exercises: %d, additional files: %d"
          % (len(unit_ids), N_UNITS, n_ex, n_add))
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
