"""Side-by-side diff of parsed units across models (work/llm/eval/<model>/units).

Usage:  python scripts/llm/eval_units.py 2 14 [--models a b]
Prints, per exercise, the type/instruction per model and every item whose
rendering differs between models. Identical items are counted, not shown.
"""
import argparse
import json
from pathlib import Path

from common import LLM


def render_item(ex, it):
    t = ex.get("type")
    flag = "*" if it.get("example") or it.get("num") in (ex.get("example") or []) else ""
    if t == "fill-in":
        segs = []
        for i, p in enumerate(it.get("parts", [])):
            segs.append(p)
            if i < len(it.get("answers", [])):
                segs.append("[" + "|".join(it["answers"][i]) + "]")
        return flag + "".join(segs)
    if t == "choice":
        opts = it.get("options", [])
        ans = it.get("answer")
        ans = ans if isinstance(ans, list) else [ans]
        return flag + " ¦ ".join(("✓" if i in ans else "") + o for i, o in enumerate(opts))
    if t == "write":
        return flag + "%s => %s" % (it.get("prompt", ""), " | ".join(it.get("answers", [])))
    if t == "self-check":
        return flag + "%s ~> %s" % (it.get("prompt", ""), " | ".join(it.get("modelAnswers", [])))
    return json.dumps(it, ensure_ascii=False)


def rows(ex):
    if ex.get("type") == "matching":
        lo, ro = ex.get("leftOptions", []), ex.get("rightOptions", [])
        out = {}
        for l, r in ex.get("pairs", []):
            if 0 <= l < len(lo) and 0 <= r < len(ro):
                out[str(l + 1)] = "%s -> %s" % (lo[l], ro[r])
        return out
    return {str(it.get("num")): render_item(ex, it) for it in ex.get("items", [])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("units", type=int, nargs="+")
    ap.add_argument("--models", nargs="*")
    ap.add_argument("--dirs", nargs="*", help="unit dirs to compare instead of eval/*/units")
    a = ap.parse_args()
    if a.dirs:
        mdirs = [Path(d) for d in a.dirs]
    else:
        mdirs = [d / "units" for d in sorted((LLM / "eval").iterdir()) if (d / "units").exists()]
        if a.models:
            mdirs = [d for d in mdirs if any(m in d.parent.name for m in a.models)]
    names = {d: (d.name if a.dirs else d.parent.name) for d in mdirs}
    short = {names[d]: names[d].split("__")[-1][:18] for d in mdirs}
    for n in a.units:
        data = {}
        for d in mdirs:
            f = d / ("unit-%03d.json" % n)
            if f.exists():
                data[names[d]] = {ex["id"]: ex for ex in json.loads(f.read_text(encoding="utf-8"))["exercises"]}
        print("\n######## UNIT %d  (models: %s)" % (n, ", ".join(short[m] for m in data)))
        ids = sorted({i for m in data.values() for i in m}, key=lambda s: [int(x) for x in s.split(".")])
        for eid in ids:
            exs = {m: data[m].get(eid) for m in data}
            head = {m: ("MISSING" if e is None else "%s | %s | wb=%s" % (
                e.get("type"), e.get("instruction", "")[:70], e.get("wordBank"))) for m, e in exs.items()}
            print("== %s" % eid)
            if len(set(head.values())) == 1:
                print("   (all) " + next(iter(head.values())))
            else:
                for m, h in head.items():
                    print("   %-18s %s" % (short[m], h))
            r = {m: rows(e) if e else {} for m, e in exs.items()}
            nums = sorted({k for x in r.values() for k in x}, key=lambda s: (len(s), s))
            same = 0
            for k in nums:
                vals = {m: r[m].get(k, "—") for m in r}
                if len(set(vals.values())) == 1:
                    same += 1
                    continue
                print("   #%s" % k)
                for m, v in vals.items():
                    print("      %-18s %s" % (short[m], v))
            print("   (%d items identical across models)" % same)


if __name__ == "__main__":
    main()
