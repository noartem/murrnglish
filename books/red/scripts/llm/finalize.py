"""Publish the merged LLM output into data/ (the app's data directory).

- data/units/unit-NNN.json      <- work/llm/final/units (merge.py)
- data/additional/NN.json       <- work/llm/additional (parse_additional.py)
- data/index.json               <- groups from work/llm/toc.json + per-exercise
                                   title/pages (as scripts/make_index.py)
- data/totals.json              <- graded-item counts (scripts/make_totals.py)
- work/layout.json              <- unit -> pdfPages/title (validator input)

Usage:  python scripts/llm/finalize.py [--dry-run]
"""
import argparse
import json
import sys
from pathlib import Path

from common import LLM, N_UNITS, ROOT, unit_pages
from merge import mark_personal

sys.path.insert(0, str(ROOT / "scripts"))
from make_totals import graded_count  # noqa: E402

DATA = ROOT / "data"
# key exercises whose printed page is absent from book.pdf: the scan
# carries the English-edition exercise pages for these units, which lack the
# Russian edition's translation exercise
NOT_IN_SCAN = {"51.4": "unit 51 exercise page is from the English edition",
               "76.4": "unit 76 exercise page is from the English edition"}


def dump(path, obj):
    # LF on every platform, like the rest of data/
    path.write_bytes((json.dumps(obj, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", default=str(LLM / "final" / "units"))
    ap.add_argument("--additional", default=str(LLM / "additional"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    units = {}
    for n in range(1, N_UNITS + 1):
        f = Path(a.final) / ("unit-%03d.json" % n)
        if f.exists():
            units[n] = json.loads(f.read_text(encoding="utf-8"))
    adds = {}
    add_key = json.loads((LLM / "key-add-mimo" / "key.json").read_text(encoding="utf-8"))
    for f in sorted(Path(a.additional).glob("[0-9][0-9].json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        mark_personal(d["exercise"], add_key)
        adds[d["id"]] = d
    missing_u = [n for n in range(1, N_UNITS + 1) if n not in units]
    missing_a = [n for n in range(1, 36) if n not in adds]
    print("units %d/%d (missing %s), additional %d/35 (missing %s)" % (
        len(units), N_UNITS, missing_u, len(adds), missing_a))
    if a.dry_run:
        return

    for sub in ("units", "additional"):
        for f in (DATA / sub).glob("*.json"):
            f.unlink()

    toc = json.loads((LLM / "toc.json").read_text(encoding="utf-8"))
    totals, info = {}, {}
    for n, u in units.items():
        dump(DATA / "units" / ("unit-%03d.json" % n), u)
        exs = {e["id"]: graded_count(e) for e in u["exercises"]}
        totals["u%d" % n] = {"total": sum(exs.values()), "exercises": exs}
        info["u%d" % n] = {"title": u["title"], "pages": u["pdfPages"]}
    for n, d in sorted(adds.items()):
        dump(DATA / "additional" / ("%02d.json" % n), d)
        c = graded_count(d["exercise"])
        totals["a%d" % n] = {"total": c, "exercises": {d["exercise"]["id"]: c}}
        info["a%d" % n] = {"title": "%s · %s" % (d["topic"], d["refs"]) if d.get("refs") else d["topic"],
                           "pages": d["pdfPages"]}

    index = {
        "groups": [{"name": g["name"], "units": [u["unit"] for u in g["units"] if u["unit"] in units]}
                   for g in toc["groups"]],
        "additional": {"title": "Дополнительные упражнения", "exercises": sorted(adds)},
        # same shape as scripts/make_index.py (validate.py checks it)
        "exercises": info,
    }
    dump(DATA / "index.json", index)
    dump(DATA / "totals.json", totals)
    # exercise ids per unit as printed in the answer key: the validator's
    # coverage reference (the scan's OCR text layer is too noisy for that)
    key = json.loads((LLM / "key-mimo" / "key.json").read_text(encoding="utf-8"))
    key_ids = {}
    for k in key:
        key_ids.setdefault(int(k.split(".")[0]), []).append(k)
    layout = {"units": {str(n): {"pdfPages": unit_pages(n), "title": u["title"],
                                 "keyExercises": sorted(key_ids.get(n, []),
                                                        key=lambda s: int(s.split(".")[1])),
                                 "notInScan": sorted(k for k in NOT_IN_SCAN if k.startswith("%d." % n))}
                        for n, u in units.items()}}
    dump(ROOT / "work" / "layout.json", layout)
    # items the key gives no answer for (validator allows them only when logged)
    gaps = []
    for n, u in sorted(units.items()):
        for ex in u["exercises"]:
            nums = [str(it.get("num")) for it in ex.get("items", [])
                    if (ex["type"] == "self-check" and not it.get("modelAnswers"))
                    or (ex["type"] == "write" and not it.get("answers"))]
            if nums:
                gaps.append("unit%s item%s (no answer in the key)" % (ex["id"], ",".join(nums)))
    for n, d in sorted(adds.items()):
        ex = d["exercise"]
        nums = [str(it.get("num")) for it in ex.get("items", [])
                if (ex["type"] == "self-check" and not it.get("modelAnswers"))
                or (ex["type"] == "write" and not it.get("answers"))]
        if nums:
            gaps.append("additional%s item%s (no answer in the key)" % (ex["id"], ",".join(nums)))
    (ROOT / "work" / "missing-key.txt").write_bytes(("\n".join(gaps) + "\n").encode("utf-8"))
    print("wrote data/units (%d), data/additional (%d), index.json, totals.json, work/layout.json"
          % (len(units), len(adds)))


if __name__ == "__main__":
    main()
