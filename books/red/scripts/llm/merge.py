"""Assemble final unit JSON from the primary and cross-check model outputs.

For every exercise the first candidate (in --dirs order) that passes
check_units without flags wins; if none is clean, the primary version is
kept and the exercise is listed for repair/review. Titles come from
work/llm/titles.json.

Output: <out>/units/unit-NNN.json and <out>/review.txt (flagged exercises).

Usage:  python scripts/llm/merge.py [--dirs work/llm/units work/llm/units-bunny]
                                     [--out work/llm/final]
"""
import argparse
import json
import re
from pathlib import Path

from check_units import check_unit, load_key
from common import LLM, N_UNITS, unit_pages


def ex_flags(unit_no, ex, key):
    return check_unit({"unit": unit_no, "exercises": [ex]}, key, False)


def personal_nums(lines):
    """Item nums the key marks as example answers about the learner:
    "9 (Возможный ответ) …" or every item after a "… возможные ответы:" line."""
    nums, after = set(), False
    for ln in lines:
        if re.search(r"возможн\w* ответ\w*\s*\)?\s*:?\s*$", ln, re.I) and not re.match(r"^\s*\d", ln):
            after = True
            continue
        m = re.match(r"^\s*(\d{1,2})\b(.*)$", ln)
        if m and (after or re.search(r"\(возможн\w* ответ", m.group(2), re.I)):
            nums.add(m.group(1))
    return nums


def mark_personal(ex, key):
    """Graded exercise with learner-specific items: keep one exercise type and
    flag those items `selfCheck` (sample answers, not graded)."""
    if ex["type"] in ("self-check", "matching", "choice"):
        return
    k = key.get(ex["id"])
    personal = personal_nums(k["lines"]) if k else set()
    for it in ex.get("items", []):
        if it.get("type") == "self-check":  # model's per-item override
            it.pop("type")
            if ex["type"] == "write":
                it["answers"] = it.pop("modelAnswers", []) or it.get("answers", [])
            it["selfCheck"] = True
        # key shorthand "или What time …" can never match typed input: drop
        # such variants when a full one remains; an item left with only
        # shorthand ("I was born in …", "for … years") is not checkable
        ell = lambda v: "…" in v or "..." in v  # noqa: E731
        shorthand_only = False
        if ex["type"] == "fill-in":
            gaps = it.get("answers", [])
            for i, g in enumerate(gaps):
                full = [v for v in g if not ell(v)]
                if full:
                    gaps[i] = full
                elif g:
                    shorthand_only = True
        elif ex["type"] == "write":
            full = [v for v in it.get("answers", []) if not ell(v)]
            if full:
                it["answers"] = full
            elif it.get("answers"):
                shorthand_only = True
        if (str(it.get("num")) in personal or shorthand_only) and not it.get("example"):
            it["selfCheck"] = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dirs", nargs="*", default=[str(LLM / "units"), str(LLM / "units-bunny"),
                                                  str(LLM / "repair")])
    ap.add_argument("--key", default=str(LLM / "key-mimo" / "key.json"))
    ap.add_argument("--out", default=str(LLM / "final"))
    ap.add_argument("--manual", default=str(LLM / "manual"),
                    help="hand-fixed exercises (unit wrapper), used as-is")
    a = ap.parse_args()
    key = load_key(a.key)
    titles = json.loads((LLM / "titles.json").read_text(encoding="utf-8"))
    out = Path(a.out) / "units"
    out.mkdir(parents=True, exist_ok=True)
    review, stats = [], {"primary": 0, "fallback": 0, "flagged": 0, "manual": 0}
    missing = []
    for n in range(1, N_UNITS + 1):
        cands = []
        for d in a.dirs:
            f = Path(d) / ("unit-%03d.json" % n)
            if f.exists():
                cands.append((Path(d).name, json.loads(f.read_text(encoding="utf-8"))))
        if not cands:
            missing.append(n)
            continue
        primary = cands[0][1]
        ids = [ex["id"] for ex in primary["exercises"]]
        for _, u in cands[1:]:  # an exercise only the other model found
            ids += [ex["id"] for ex in u["exercises"] if ex["id"] not in ids]
        ids.sort(key=lambda s: [int(x) for x in s.split(".")])
        mf = Path(a.manual) / ("unit-%03d.json" % n)
        manual = {e["id"]: e for e in json.loads(mf.read_text(encoding="utf-8"))["exercises"]} \
            if mf.exists() else {}
        exercises = []
        for eid in ids:
            if eid in manual:  # hand-reviewed version always wins
                exercises.append(manual[eid])
                stats["manual"] += 1
                continue
            chosen, flags0 = None, None
            for i, (name, u) in enumerate(cands):
                ex = next((e for e in u["exercises"] if e["id"] == eid), None)
                if ex is None:
                    continue
                fl = ex_flags(n, ex, key)
                if flags0 is None:
                    flags0 = (name, ex, fl)
                if not fl:
                    chosen = ex
                    stats["primary" if i == 0 else "fallback"] += 1
                    break
            if chosen is None:
                name, chosen, fl = flags0
                stats["flagged"] += 1
                review.append("%s (%s): %s" % (eid, name, " | ".join(fl)))
            exercises.append(chosen)
        for ex in exercises:
            mark_personal(ex, key)
        unit = {"unit": n, "title": titles.get(str(n), "Раздел %d" % n),
                "pdfPages": unit_pages(n), "exercises": exercises}
        (out / ("unit-%03d.json" % n)).write_text(
            json.dumps(unit, ensure_ascii=False, indent=1), encoding="utf-8")
    (Path(a.out) / "review.txt").write_text("\n".join(review) + "\n", encoding="utf-8")
    print("exercises: %(primary)d primary, %(fallback)d from cross-check, %(manual)d manual, "
          "%(flagged)d flagged" % stats)
    print("units missing: %s; review list -> %s" % (missing, Path(a.out) / "review.txt"))


if __name__ == "__main__":
    main()
