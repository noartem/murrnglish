"""Stage B: exercise page image + unit key (+ EPUB hint) -> data/units JSON.

Usage:
  python scripts/llm/parse_units.py --model z-ai/glm-5.3-flash --units 2 7 45
         [--key work/llm/key/key.json] [--out work/llm/units] [--jobs 6]
         [--no-epub] [--force]
  --units accepts ranges: 1-115
"""
import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import (LLM, N_UNITS, ROOT, chat, client, exercise_page, extract_json,
                    image_part, page_image, unit_pages)
from epub_hints import unit_hint

sys.path.insert(0, str(ROOT / "scripts"))
from validate import check_exercise  # noqa: E402

SYSTEM = (Path(__file__).parent / "prompts" / "unit.md").read_text(encoding="utf-8")
TITLES = LLM / "titles.json"


def unit_key_text(key, n):
    ids = sorted((k for k in key if k.split(".")[0] == str(n)),
                 key=lambda k: int(k.split(".")[1]) if k.split(".")[1].isdigit() else 0)
    out = []
    for k in ids:
        out.append(k + ("  " + key[k]["note"] if key[k].get("note") else ""))
        out += ["  " + x for x in key[k]["lines"]]
    return "\n".join(out)


def curly(x):
    """Straight apostrophes inside words (don't, I'm) -> ’ as printed."""
    if isinstance(x, str):
        x = re.sub(r"(?<=[A-Za-z])'(?=[A-Za-z])", "’", x)
        # clitic at the start of a gap answer: 've seen, 's waiting
        return re.sub(r"(?<![\w’])'(?=(?:s|re|ve|m|ll|d)\b)", "’", x)
    if isinstance(x, list):
        return [curly(v) for v in x]
    if isinstance(x, dict):
        return {k: curly(v) for k, v in x.items()}
    return x


def parse_ranges(xs):
    out = []
    for x in xs:
        if "-" in x:
            a, b = x.split("-")
            out += range(int(a), int(b) + 1)
        else:
            out.append(int(x))
    return out


def run_unit(cl, model, n, key, out, a):
    path = out / ("unit-%03d.json" % n)
    if path.exists() and not a.force:
        return n, "cached", None, []
    raw = out / ("unit-%03d.raw.txt" % n)
    if raw.exists() and not a.force:  # earlier reply with broken JSON: try repairing first
        try:
            return finish_unit(n, extract_json(raw.read_text(encoding="utf-8")), path, None)
        except Exception:
            pass
    p = exercise_page(n)
    parts = ["Unit %d. Exercise page = PDF page %d." % (n, p),
             "\n## Answer key for unit %d (transcribed)\n%s" % (n, unit_key_text(key, n) or "(none)")]
    hint = None if a.no_epub else unit_hint(n)
    if hint:
        parts.append("\n## English original eBook text for this unit (HINT, may differ)\n" + hint)
    content = [{"type": "text", "text": parts[0]}, image_part(page_image(p, a.max_side)),
               {"type": "text", "text": "\n".join(parts[1:])}]
    text, meta = chat(cl, model, SYSTEM, content, tag="unit-%03d" % n, max_tokens=a.max_tokens)
    try:
        data = extract_json(text)
    except Exception as e:
        raw.write_text(text, encoding="utf-8")
        return n, "BAD JSON: %s" % e, meta, []
    return finish_unit(n, data, path, meta)


def finish_unit(n, data, path, meta):
    titles = json.loads(TITLES.read_text(encoding="utf-8")) if TITLES.exists() else {}
    data = curly(data)
    unit = {"unit": n, "title": titles.get(str(n), "Раздел %d" % n),
            "pdfPages": unit_pages(n), "exercises": data.get("exercises", [])}
    errors = []
    for ex in unit["exercises"]:
        check_exercise(ex, path.name, "", errors)
    path.write_text(json.dumps(unit, ensure_ascii=False, indent=1), encoding="utf-8")
    return n, "ok" if not errors else "ok, %d validation errors" % len(errors), meta, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--units", nargs="*", default=["1-%d" % N_UNITS])
    ap.add_argument("--key", default=str(LLM / "key" / "key.json"))
    ap.add_argument("--out", default=str(LLM / "units"))
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--max-side", type=int, default=0)
    ap.add_argument("--no-epub", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--max-tokens", type=int, default=16000)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    key = json.loads(Path(a.key).read_text(encoding="utf-8"))
    cl = client()
    cost = 0.0
    with ThreadPoolExecutor(a.jobs) as pool:
        futs = [pool.submit(run_unit, cl, a.model, n, key, out, a) for n in parse_ranges(a.units)]
        for f in as_completed(futs):
            try:
                n, status, meta, errors = f.result()
            except Exception as e:
                print("FAIL", e)
                continue
            if meta:
                cost += meta["cost"]
                print("unit %3d %s  %ss in=%d out=%d cost=%.3f" % (
                    n, status, meta["secs"], meta["prompt_tokens"], meta["completion_tokens"],
                    meta["cost"]))
            else:
                print("unit %3d %s" % (n, status))
            for e in errors[:8]:
                print("    ", e)
    print("cost this run: %.3f" % cost)


if __name__ == "__main__":
    main()
