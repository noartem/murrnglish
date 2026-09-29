# -*- coding: utf-8 -*-
"""Produce data/totals.json: graded-item totals per exercise, keyed per unit.

Schema:
  { "u1": { "total": 32, "exercises": { "1.1": 5, "1.2": 8, ... } }, ...,
    "a1": { ... } }

Graded counts:
  fill-in  -> sum of answers.length over items WITHOUT example:true
  choice   -> number of items
  matching -> number of leftOptions
  write    -> number of items except those listed in exercise-level example: [..]
  self-check -> 0 (self-assessed; still listed so the id shows up)

Re-run after ANY data change (build artifact of the current data).
"""
import json
import os
import re

OUT = "data/totals.json"


def graded_count(ex):
    t = ex.get("type")
    if t == "fill-in":
        n = 0
        for it in ex.get("items") or []:
            if it.get("example"):
                continue
            for gap in it.get("answers") or []:
                if isinstance(gap, list):
                    n += 1
        return n
    if t in ("choice", "write"):
        ex_ex = set(ex.get("example") or [])
        return len([
            it
            for it in ex.get("items") or []
            if it.get("num") not in ex_ex
            and not it.get("example")
            and (t == "choice" or it.get("answers"))
        ])
    if t == "matching":
        return len(ex.get("leftOptions") or [])
    return 0  # self-check and unknown types: 0, but still listed


def main():
    totals = {}
    for f in sorted(os.listdir("data/units")):
        if not f.endswith(".json"):
            continue
        pn = int(re.match(r"unit-(\d{3})\.json", f).group(1))
        d = json.load(open("data/units/" + f, encoding="utf-8"))
        exercises = {}
        total = 0
        for e in d.get("exercises") or []:
            n = graded_count(e)
            exercises[e["id"]] = n
            total += n
        totals["u%d" % pn] = {"total": total, "exercises": exercises}
    for f in sorted(os.listdir("data/additional")):
        if not (f.endswith(".json") and f[:2].isdigit()):
            continue
        pn = int(f[:2])
        d = json.load(open("data/additional/" + f, encoding="utf-8"))
        ex = d.get("exercise") or {}
        n = graded_count(ex)
        totals["a%d" % pn] = {"total": n, "exercises": {ex.get("id") or str(pn): n}}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(totals, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote %s (%d keys); u1: %s" % (OUT, len(totals), json.dumps(totals["u1"])))


if __name__ == "__main__":
    main()
