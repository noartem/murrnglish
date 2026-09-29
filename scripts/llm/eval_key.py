"""Compare model key transcriptions against hand-made gold pages.

Usage:  python scripts/llm/eval_key.py [page ...]    (default: all gold pages)
Reads work/llm/gold/key-pNNN.json and work/llm/eval/<model>/key/key-pNNN.json.
"""
import difflib
import json
import re
import sys

from common import LLM


def norm(s):
    s = s.replace("‘", "’").replace("'", "’").replace("...", "…")
    s = re.sub(r"\s*/\s*", " / ", s)
    return re.sub(r"\s+", " ", s).strip()


def flat(d):
    rows = [("lead", norm(x)) for x in d.get("leading", [])]
    for ex in d.get("exercises", []):
        rows.append((str(ex["id"]), "#" + str(ex["id"]) + " " + norm(ex.get("note") or "")))
        rows += [(str(ex["id"]), norm(x)) for x in ex.get("lines", [])]
    return ["%s| %s" % r for r in rows]


def main():
    pages = [int(x) for x in sys.argv[1:]] or sorted(
        int(p.stem[5:]) for p in (LLM / "gold").glob("key-p*.json"))
    for mdir in sorted((LLM / "eval").iterdir()):
        tot = ok = 0
        diffs = []
        for p in pages:
            gold = flat(json.loads((LLM / "gold" / ("key-p%03d.json" % p)).read_text(encoding="utf-8")))
            f = mdir / "key" / ("key-p%03d.json" % p)
            got = flat(json.loads(f.read_text(encoding="utf-8"))) if f.exists() else []
            sm = difflib.SequenceMatcher(a=gold, b=got, autojunk=False)
            tot += len(gold)
            ok += sum(b.size for b in sm.get_matching_blocks())
            for op, a1, a2, b1, b2 in sm.get_opcodes():
                if op != "equal":
                    diffs.append((p, gold[a1:a2], got[b1:b2]))
        print("=== %-32s lines ok %d/%d (%.1f%%)" % (mdir.name, ok, tot, 100.0 * ok / max(tot, 1)))
        for p, g, m in diffs[:12]:
            print("  p%d  gold: %s\n        got : %s" % (p, " ¦ ".join(g) or "-", " ¦ ".join(m) or "-"))
        if len(diffs) > 12:
            print("  ... %d more diff blocks" % (len(diffs) - 12))


if __name__ == "__main__":
    main()
