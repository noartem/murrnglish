# -*- coding: utf-8 -*-
"""Produce data/index.json "titles": nav descriptions for the prev/next pager.

Schema addition (keyed like totals.json):
  "titles": { "u1": "Present continuous (I am doing)", ..., "a1": "Present and past · Units 1–6", ... }

Sources (all already in data/): unit title from data/units/unit-NNN.json,
topic (+" · "+refs) from data/additional/NN.json.

Re-run after ANY unit/additional title change (build artifact of the current data).
"""
import json
import os
import re

OUT = "data/index.json"


def main():
    titles = {}
    for f in sorted(os.listdir("data/units")):
        if not f.endswith(".json"):
            continue
        pn = int(re.match(r"unit-(\d{3})\.json", f).group(1))
        d = json.load(open("data/units/" + f, encoding="utf-8"))
        titles["u%d" % pn] = d.get("title") or ""
    for f in sorted(os.listdir("data/additional")):
        if not (f.endswith(".json") and f[:2].isdigit()):
            continue
        pn = int(f[:2])
        d = json.load(open("data/additional/" + f, encoding="utf-8"))
        topic = d.get("topic") or ""
        refs = d.get("refs") or ""
        titles["a%d" % pn] = "%s · %s" % (topic, refs) if refs else topic

    index = json.load(open(OUT, encoding="utf-8"))
    missing = [k for k in titles if not titles[k]]
    if missing:
        raise SystemExit("empty descriptions: %s" % missing)
    index["titles"] = titles
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote %s titles (%d keys); u3: %r" % (OUT, len(titles), titles["u3"]))


if __name__ == "__main__":
    main()
