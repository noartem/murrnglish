"""Stage B for "Дополнительные упражнения" (PDF pages 252-270, 35 exercises).

Each page is sent together with the next page (for exercises that continue
there) and the whole additional-exercise key; the model returns only the
exercises whose number is printed on the first page. Topics/unit refs come
from the printed list on page 252 (TOPICS below).

Output: <out>/NN.json in the data/additional schema.

Usage:
  python scripts/llm/parse_additional.py --model xiaomi/mimo-v2.6-flash
         [--pages 252 253] [--key work/llm/key-add-mimo/key.json]
         [--out work/llm/additional] [--jobs 6] [--force]
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import ADD_PAGES, LLM, ROOT, chat, client, extract_json, image_part, page_image
from parse_units import curly

sys.path.insert(0, str(ROOT / "scripts"))
from validate import check_exercise  # noqa: E402

# "Список упражнений" on PDF page 252: (first, last, topic, refs)
TOPICS = [
    (1, 2, "am/is/are", "Разделы 1–3"),
    (3, 3, "present continuous", "Разделы 4–5"),
    (4, 4, "present simple", "Разделы 6–8"),
    (5, 7, "present simple, am/is/are и have (got)", "Разделы 1–3, 6–8, 10"),
    (8, 9, "present continuous и present simple", "Разделы 4–9"),
    (10, 13, "was/were и past simple", "Разделы 11–13"),
    (14, 14, "past simple и past continuous", "Разделы 12–15"),
    (15, 15, "настоящее и прошедшее время", "Разделы 4–15"),
    (16, 18, "present perfect", "Разделы 16–20"),
    (19, 22, "present perfect и past simple", "Разделы 19–21"),
    (23, 23, "настоящее время, прошедшее время и present perfect", "Разделы 4–21"),
    (24, 27, "пассивные конструкции", "Разделы 22–23"),
    (28, 28, "будущее время", "Разделы 26–29"),
    (29, 29, "прошедшее, настоящее и будущее время", "Разделы 4–21, 26–29"),
    (30, 31, "прошедшее, настоящее и будущее время", "Разделы 4–23, 26–29, 53, 55, 99, 105"),
    (32, 32, "-ing и to …", "Разделы 52–56, 105, 112"),
    (33, 34, "a и the", "Разделы 66, 70–74"),
    (35, 35, "предлоги", "Разделы 103–108, 111"),
]

EXTRA = """

## This call: additional exercises ("Дополнительные упражнения")

The exercises here are numbered 1–35 (a red numbered badge), not N.M. You
get TWO page images: the page to convert (first) and the next page (second,
only for exercises that continue there). Convert ONLY the exercises whose
number badge is printed on the FIRST page; an exercise that runs over onto
the second page is converted in full and gets `"continues": true`. Ignore
the topic bars ("present simple …", "Разделы 1–3") and the list of
exercises on the first page of the section.

Output: {"exercises": [{"id": "5", "continues": false, "type": ..., ...}]}
with `id` = the exercise number as a string. Answers come from the key for
that exercise number.
"""


def topic_of(n):
    for lo, hi, topic, refs in TOPICS:
        if lo <= n <= hi:
            return topic, refs
    return "", ""


def key_text(key):
    out = []
    for k in sorted(key, key=int):
        out.append(k + ("  " + key[k]["note"] if key[k].get("note") else ""))
        out += ["  " + x for x in key[k]["lines"]]
    return "\n".join(out)


def run_page(cl, model, p, key, out, a, system):
    marker = out / ("page-%03d.done" % p)
    if marker.exists() and not a.force:
        return p, "cached", None, []
    raw = out / ("page-%03d.raw.txt" % p)
    if raw.exists() and not a.force:  # earlier reply with broken JSON: try repairing first
        try:
            return finish_page(p, curly(extract_json(raw.read_text(encoding="utf-8"))), out, None)
        except Exception:
            pass
    content = [{"type": "text", "text": "First page = PDF page %d (convert this one):" % p},
               image_part(page_image(p, a.max_side))]
    if p + 1 <= ADD_PAGES[-1]:
        content += [{"type": "text", "text": "Second page = PDF page %d (continuation only):" % (p + 1)},
                    image_part(page_image(p + 1, a.max_side))]
    content.append({"type": "text", "text": "\n## Answer key for the additional exercises\n" + key_text(key)})
    text, meta = chat(cl, model, system, content, tag="add-p%03d" % p, max_tokens=a.max_tokens)
    try:
        data = curly(extract_json(text))
    except Exception as e:
        raw.write_text(text, encoding="utf-8")
        return p, "BAD JSON: %s" % e, meta, []
    return finish_page(p, data, out, meta)


def finish_page(p, data, out, meta):
    errors, ids = [], []
    for ex in data.get("exercises", []):
        n = int(str(ex["id"]).strip())
        cont = bool(ex.pop("continues", False))
        ex["id"] = str(n)
        topic, refs = topic_of(n)
        rec = {"id": n, "topic": topic, "refs": refs,
               "pdfPages": [p, p + 1] if cont else [p], "exercise": ex}
        check_exercise(ex, "add-%02d" % n, "", errors)
        # per-page candidate; assemble() keeps the one from the page where the
        # exercise starts (a later page may echo a continued exercise)
        (out / ("%02d.p%03d.json" % (n, p))).write_text(
            json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        ids.append(n)
    (out / ("page-%03d.done" % p)).write_text(json.dumps(ids), encoding="utf-8")
    return p, "ok %s" % ids + ("" if not errors else ", %d validation errors" % len(errors)), meta, errors


def assemble(out):
    """NN.json <- the candidate from the lowest page that returned exercise NN."""
    best = {}
    for f in out.glob("[0-9][0-9].p[0-9][0-9][0-9].json"):
        n, p = int(f.name[:2]), int(f.name[4:7])
        if n not in best or p < best[n][0]:
            best[n] = (p, f)
    for n, (p, f) in best.items():
        (out / ("%02d.json" % n)).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--pages", type=int, nargs="*", default=ADD_PAGES)
    ap.add_argument("--key", default=str(LLM / "key-add-mimo" / "key.json"))
    ap.add_argument("--out", default=str(LLM / "additional"))
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--max-side", type=int, default=0)
    ap.add_argument("--max-tokens", type=int, default=16000)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    key = json.loads(Path(a.key).read_text(encoding="utf-8"))
    system = (Path(__file__).parent / "prompts" / "unit.md").read_text(encoding="utf-8") + EXTRA
    cl = client()
    cost = 0.0
    with ThreadPoolExecutor(a.jobs) as pool:
        futs = [pool.submit(run_page, cl, a.model, p, key, out, a, system) for p in a.pages]
        for f in as_completed(futs):
            try:
                p, status, meta, errors = f.result()
            except Exception as e:
                print("FAIL", e)
                continue
            if meta:
                cost += meta["cost"]
                print("p%03d %s  %ss cost=%.3f" % (p, status, meta["secs"], meta["cost"]))
            else:
                print("p%03d %s" % (p, status))
            for e in errors[:8]:
                print("    ", e)
    assemble(out)
    got = sorted(int(x.stem) for x in out.glob("[0-9][0-9].json"))
    print("exercises: %d, missing %s, cost this run: %.3f" % (
        len(got), sorted(set(range(1, 36)) - set(got)), cost))


if __name__ == "__main__":
    main()
