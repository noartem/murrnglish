"""Repair pass: re-ask the model about exercises that still carry check flags.

Reads the merged result (work/llm/final/units), re-checks every exercise and
sends each flagged unit once more with the page image, the key, the current
JSON of the flagged exercises and the list of problems. Repaired exercises go
to <out>/unit-NNN.json (unit wrapper holding only those exercises); merge.py
takes them as one more candidate.

Mixed exercises (graded + personal items, flagged "per-item type") are
skipped: they need a schema decision, not a model retry.

Usage:  python scripts/llm/repair.py --model xiaomi/mimo-v2.6-flash
          [--units 1-115] [--final work/llm/final/units] [--out work/llm/repair]
"""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from check_units import check_unit, load_key
from common import LLM, N_UNITS, chat, client, exercise_page, extract_json, image_part, page_image
from parse_units import SYSTEM, curly, parse_ranges, unit_key_text

TASK = """An automatic check against the answer key found problems in your
previous JSON for some exercises of this unit. Look at the page image and the
key again and return corrected versions of THESE exercises only:
{"exercises": [ ... ]}

Typical causes: items shifted by one (item N must hold item N's key line),
answers not copied exactly from the key (typos, missing words, words
changed), items that do not exist on the page, the pre-solved example item
with empty gaps (read its printed answer from the page), a key line for an
item that is missing in the JSON.

## Previous JSON of the flagged exercises
%s

## Problems found
%s
"""


def run_unit(cl, model, n, exs, flags, key, out, max_tokens):
    content = [{"type": "text", "text": "Unit %d. Exercise page = PDF page %d." % (n, exercise_page(n))},
               image_part(page_image(exercise_page(n))),
               {"type": "text", "text": "\n## Answer key for unit %d (transcribed)\n%s\n\n" % (
                   n, unit_key_text(key, n)) + TASK % (
                   json.dumps(exs, ensure_ascii=False), "\n".join(flags))}]
    text, meta = chat(cl, model, SYSTEM, content, tag="repair-%03d" % n, max_tokens=max_tokens)
    data = curly(extract_json(text))
    fixed = [e for e in data.get("exercises", []) if e.get("id") in {x["id"] for x in exs}]
    (out / ("unit-%03d.json" % n)).write_text(
        json.dumps({"unit": n, "exercises": fixed}, ensure_ascii=False, indent=1), encoding="utf-8")
    left = check_unit({"unit": n, "exercises": fixed}, key, False)
    return n, len(fixed), len(left), meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--units", nargs="*", default=["1-%d" % N_UNITS])
    ap.add_argument("--final", default=str(LLM / "final" / "units"))
    ap.add_argument("--key", default=str(LLM / "key-mimo" / "key.json"))
    ap.add_argument("--out", default=str(LLM / "repair"))
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--max-tokens", type=int, default=16000)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    key = load_key(a.key)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    todo = []
    for n in parse_ranges(a.units):
        f = Path(a.final) / ("unit-%03d.json" % n)
        if not f.exists() or ((out / f.name).exists() and not a.force):
            continue
        u = json.loads(f.read_text(encoding="utf-8"))
        exs, flags = [], []
        for ex in u["exercises"]:
            fl = check_unit({"unit": n, "exercises": [ex]}, key, False)
            if fl and not any("per-item type" in x for x in fl):
                exs.append(ex)
                flags += fl
        if exs:
            todo.append((n, exs, flags))
    print("units to repair: %s" % [t[0] for t in todo])
    cl = client()
    cost = 0.0
    with ThreadPoolExecutor(a.jobs) as pool:
        futs = [pool.submit(run_unit, cl, a.model, n, exs, fl, key, out, a.max_tokens)
                for n, exs, fl in todo]
        for f in as_completed(futs):
            try:
                n, nfix, nleft, meta = f.result()
            except Exception as e:
                print("FAIL", e)
                continue
            cost += meta["cost"]
            print("unit %3d: %d exercises returned, %d flags left, cost %.3f" % (n, nfix, nleft, meta["cost"]))
    print("cost this run: %.3f" % cost)


if __name__ == "__main__":
    main()
