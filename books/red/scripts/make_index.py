# -*- coding: utf-8 -*-
"""Produce data/index.json "exercises": everything the app needs per unit
BEFORE the unit's own file arrives.

Schema (keyed like totals.json):
  "exercises": {
    "u1": { "title": "Present continuous (I am doing)", "pages": [14, 15] },
    ...,
    "a1": { "title": "Present and past · Units 1–6", "pages": [314] }
  }

Sources (all already in data/): title + pdfPages from
data/units/unit-NNN.json, topic/refs + pdfPages from
data/additional/NN.json (the additional title joins topic and refs the way
the prev/next pager shows them).

Why it duplicates the per-file fields: index.json is fetched at startup, so
the app can label the page and start the 74.6 MB book PDF the moment a route
is opened, instead of waiting for the exercise JSON of that unit. validate.py
fails the build if this copy ever drifts. The per-file fields stay the source
of truth for the scripts that read one exercise file.

Re-run after ANY unit/additional title or pdfPages change (build artifact of
the current data).
"""
import json
import os
import re

OUT = "data/index.json"


def main():
    exercises = {}
    for f in sorted(os.listdir("data/units")):
        if not f.endswith(".json"):
            continue
        pn = int(re.match(r"unit-(\d{3})\.json", f).group(1))
        d = json.load(open("data/units/" + f, encoding="utf-8"))
        exercises["u%d" % pn] = {
            "title": d.get("title") or "",
            "pages": d.get("pdfPages"),
        }
    for f in sorted(os.listdir("data/additional")):
        if not (f.endswith(".json") and f[:2].isdigit()):
            continue
        pn = int(f[:2])
        d = json.load(open("data/additional/" + f, encoding="utf-8"))
        topic = d.get("topic") or ""
        refs = d.get("refs") or ""
        exercises["a%d" % pn] = {
            "title": "%s · %s" % (topic, refs) if refs else topic,
            "pages": d.get("pdfPages"),
        }

    empty = [k for k, v in exercises.items() if not v["title"]]
    if empty:
        raise SystemExit("empty titles: %s" % empty)
    bad = [k for k, v in exercises.items()
           if not (isinstance(v["pages"], list) and v["pages"]
                   and all(isinstance(x, int) for x in v["pages"]))]
    if bad:
        raise SystemExit("bad pdfPages: %s" % bad)

    index = json.load(open(OUT, encoding="utf-8"))
    index.pop("titles", None)  # superseded by "exercises"
    index.pop("pages", None)
    index["exercises"] = exercises
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote %s: %d exercises; u3: %s"
          % (OUT, len(exercises), json.dumps(exercises["u3"], ensure_ascii=False)))


if __name__ == "__main__":
    main()
