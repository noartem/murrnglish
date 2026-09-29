"""Key-fidelity check of parsed units (no API calls).

Answers must come from the key, so every word of an item's answers has to
occur in that item's key line (or in the item's own printed text, which the
key abbreviates with "…"). Also flags key items missing from the JSON,
choice/matching answers that disagree with the key, and structural
validation errors.

Usage:  python scripts/llm/check_units.py [--units 1-115]
          [--dir work/llm/units] [--key work/llm/key-mimo/key.json] [-v]
Writes a report to <dir>/check.txt and prints a per-unit summary.
"""
import argparse
import json
import re
import sys
from pathlib import Path

from common import LLM, ROOT, N_UNITS
from parse_units import parse_ranges

sys.path.insert(0, str(ROOT / "scripts"))
from validate import check_exercise  # noqa: E402

WORD = re.compile(r"'?[a-z0-9]+(?:'[a-z]+)?")


AUX = ("is|are|was|were|do|does|did|have|has|had|could|would|should|must|need|"
       "might|may|dare|used|ought")


def normalize(s):
    """Port of app/src/checker.ts normalize(): contractions expanded."""
    s = s.strip().replace("’", "'").replace("‘", "'").lower()
    s = re.sub(r"\s*'", "'", s)
    s = re.sub(r"\b(%s)n't\b" % AUX, r"\1 not", s)
    s = re.sub(r"\bcan't\b|\bcannot\b", "can not", s)
    s = re.sub(r"\bwon't\b", "will not", s)
    s = re.sub(r"\bshan't\b", "shall not", s)
    s = re.sub(r"\bi'm\b", "i am", s)
    s = re.sub(r"\b([a-z]+)'re\b", r"\1 are", s)
    s = re.sub(r"\b([a-z]+)'s\b", r"\1 is", s)
    s = re.sub(r"\b([a-z]+)'ll\b", r"\1 will", s)
    s = re.sub(r"\b([a-z]+)'ve\b", r"\1 have", s)
    return s


# a bare clitic answer ("’s cooking") expands to these words
CLITIC = {"s": {"is", "has"}, "re": {"are"}, "m": {"am"}, "ve": {"have"},
          "ll": {"will"}, "d": {"would", "had"}}


def words(s, allowed=False):
    # opening quotes are punctuation, not clitics (‘Where’s Tom?’), but a
    # bare clitic answer (’s cooking, ’re tired) keeps its apostrophe
    s = re.sub(r"(^|[\s(/])[‘“\"]+", r"\1 ", s)
    s = re.sub(r"(^|[\s(/])[’'](?!(?:s|re|ve|m|ll|d)\b)", r"\1 ", s)
    out = set()
    for w in WORD.findall(normalize(s)):
        if w.startswith("'") and w[1:] in CLITIC:
            out |= CLITIC[w[1:]]
            continue
        out.add(w.strip("'"))
        if w.endswith("'d"):
            out |= {w[:-2], "would", "had"}
    if allowed:  # a key "’s" was normalised to "is" but may mean "has"
        out |= {"has"} if "is" in out else set()
    return out - {""}


def key_items(lines):
    """{num: text} from key lines "N text"; unnumbered lines continue the last."""
    items, last, pending = {}, None, []
    for ln in lines:
        r = re.match(r"^\s*(\d{1,2})\s*[–-]\s*(\d{1,2})\s*$", ln)
        if r:  # "2–6" header, then one unnumbered line per item
            pending = [str(i) for i in range(int(r.group(1)), int(r.group(2)) + 1)]
            continue
        if pending and not re.match(r"^\s*\d", ln):
            last = pending.pop(0)
            items[last] = ln.strip()
            continue
        m = re.match(r"^\s*(\d{1,2}[a-z]?)[.)]?\s+(.*)$", ln)
        if m:
            last = m.group(1)
            items[last] = (items.get(last, "") + " " + m.group(2)).strip()
        elif last:
            items[last] += " " + ln
    return items


def item_text(it):
    return " ".join(it.get("parts", []) + [it.get("prompt", "") or ""])


def answer_strings(ex, it):
    t = ex["type"]
    if t == "fill-in":
        return [v for gap in it.get("answers", []) for v in gap]
    if t == "write":
        return it.get("answers", [])
    return []


def is_example(ex, it):
    return bool(it.get("example")) or it.get("num") in (ex.get("example") or [])


def check_unit(u, key, verbose):
    flags = []
    n = u["unit"]
    errs = []
    for ex in u["exercises"]:
        check_exercise(ex, "unit-%03d" % n, "", errs)
    # an empty modelAnswers list is legal once logged; finalize.py logs them
    flags += ["STRUCT " + e for e in errs if "not logged in missing-key" not in e]
    for ex in u["exercises"]:
        eid, t = ex["id"], ex["type"]
        k = key.get(eid)
        if not k:
            if t != "self-check":
                flags.append("%s: no key entry (type %s)" % (eid, t))
            continue
        kit = key_items(k["lines"])
        if t == "matching":
            lo, ro = ex.get("leftOptions", []), ex.get("rightOptions", [])
            for l, r in ex.get("pairs", []):
                want = kit.get(str(l + 1))
                if want and re.fullmatch(r"[A-Z]", want.strip()) and ord(want.strip()) - 65 != r:
                    flags.append("%s #%d: pair -> %s, key says %s" % (eid, l + 1, chr(65 + r), want))
            continue
        items = ex.get("items", [])
        nums = {str(it.get("num")) for it in items}
        for kn in kit:
            if kn not in nums:
                flags.append("%s: key item %s missing in JSON" % (eid, kn))
        for it in items:
            num = str(it.get("num"))
            if "type" in it:
                flags.append("%s #%s: per-item type %r (mixed exercise)" % (eid, num, it["type"]))
            if is_example(ex, it):
                continue
            ktext = kit.get(num)
            if t == "self-check":
                continue
            if ktext is None:
                flags.append("%s #%s: no key line for a graded item" % (eid, num))
                continue
            if t == "choice":
                ans = it.get("answer")
                ans = ans if isinstance(ans, list) else [ans]
                opts = it.get("options", [])
                letter = re.fullmatch(r"\s*([A-Ea-e])\s*\.?\s*", ktext)
                if letter:  # key gives the option letter
                    if ord(letter.group(1).upper()) - 65 not in ans:
                        flags.append("%s #%s: chosen %s but key says %s" % (eid, num, ans, ktext))
                    continue
                # key alternatives ("must stop или have to stop"); Russian
                # remarks like "(См. Раздел 86C.)" are not part of the answer
                clean = re.sub(r"\([^)]*[А-Яа-яЁё][^)]*\)", " ", ktext)
                alts = [words(x) for x in re.split(r"\s+или\s+", clean) if x.strip()]
                chosen = [words(opts[i]) for i in ans if i is not None and 0 <= i < len(opts)]
                if not any(kw <= ow for kw in alts for ow in chosen):
                    flags.append("%s #%s: chosen %s but key says '%s'" % (
                        eid, num, [opts[i] for i in ans if i is not None and 0 <= i < len(opts)], ktext))
                continue
            if ktext.strip().rstrip(".").upper() == "OK":  # printed sentence is right
                ktext = item_text(it)
            allowed = words(ktext, True) | words(item_text(it), True)
            # second, independent key transcription: its words count too
            alt = key_items(k.get("alt_lines", [])).get(num)
            if alt:
                allowed |= words(alt, True)
            for a in answer_strings(ex, it):
                extra = words(a) - allowed
                if extra:
                    flags.append("%s #%s: answer '%s' has %s not in key '%s'" % (
                        eid, num, a, sorted(extra), ktext))
    return flags


PRIMARY_KEY = LLM / "key-mimo" / "key.json"
ALT_KEY = LLM / "key-bunny" / "key.json"


def load_key(primary=PRIMARY_KEY, alt=ALT_KEY):
    """Primary key transcription; each entry also carries `alt_lines` from the
    second model's transcription (when present) — transcription slips of the
    two models are independent, so an answer word found in either is fine."""
    key = json.loads(Path(primary).read_text(encoding="utf-8"))
    if alt and Path(alt).exists():
        other = json.loads(Path(alt).read_text(encoding="utf-8"))
        for k, v in key.items():
            v["alt_lines"] = other.get(k, {}).get("lines", [])
    return key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--units", nargs="*", default=["1-%d" % N_UNITS])
    ap.add_argument("--dir", default=str(LLM / "units"))
    ap.add_argument("--key", default=str(PRIMARY_KEY))
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    d = Path(a.dir)
    key = load_key(a.key)
    report, total, missing = [], 0, []
    for n in parse_ranges(a.units):
        f = d / ("unit-%03d.json" % n)
        if not f.exists():
            missing.append(n)
            continue
        flags = check_unit(json.loads(f.read_text(encoding="utf-8")), key, a.v)
        total += len(flags)
        if flags:
            report.append("## unit %d (%d)" % (n, len(flags)))
            report += ["  " + x for x in flags]
    (d / "check.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report if a.v else [r for r in report if r.startswith("##")]))
    print("flags: %d, units missing: %s -> %s" % (total, missing, d / "check.txt"))


if __name__ == "__main__":
    main()
