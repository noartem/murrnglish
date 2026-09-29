"""Stage A: transcribe answer-key pages with a vision model.

Output: <out>/key-pNNN.json per page ({"leading": [...], "exercises": [...]}),
then merged into <out>/key.json: {"N.M": {"note": str, "lines": [...]}}.

Usage:
  python scripts/llm/key_pages.py --model z-ai/glm-5.3-flash [--pages 282 283]
                                  [--out work/llm/key] [--jobs 6] [--force]
"""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import KEY_PAGES, LLM, chat, client, extract_json, image_part, page_image

SYSTEM = (Path(__file__).parent / "prompts" / "key.md").read_text(encoding="utf-8")


def run_page(cl, model, p, out, force, max_side, max_tokens):
    path = out / ("key-p%03d.json" % p)
    if path.exists() and not force:
        return p, "cached", None
    content = [
        {"type": "text", "text": "Answer-key page (PDF page %d). Transcribe it." % p},
        image_part(page_image(p, max_side)),
    ]
    text, meta = chat(cl, model, SYSTEM, content, tag="key-p%03d" % p, max_tokens=max_tokens)
    try:
        data = extract_json(text)
    except Exception as e:
        (out / ("key-p%03d.raw.txt" % p)).write_text(text, encoding="utf-8")
        return p, "BAD JSON: %s" % e, meta
    data["page"] = p
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    return p, "ok", meta


def merge(out, pages):
    """Concatenate per-page transcriptions into one {id: {note, lines}} map."""
    key, last = {}, None
    for p in pages:
        path = out / ("key-p%03d.json" % p)
        if not path.exists():
            continue
        d = json.loads(path.read_text(encoding="utf-8"))
        if d.get("leading") and last:
            key[last]["lines"] += d["leading"]
        for ex in d.get("exercises", []):
            eid = str(ex["id"]).strip()
            if eid in key:  # label repeated across a page break
                key[eid]["lines"] += ex.get("lines", [])
            else:
                key[eid] = {"note": ex.get("note") or "", "lines": list(ex.get("lines", [])),
                            "page": p}
            last = eid
    (out / "key.json").write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding="utf-8")
    return key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--pages", type=int, nargs="*", default=KEY_PAGES)
    ap.add_argument("--out", default=str(LLM / "key"))
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--max-side", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--max-tokens", type=int, default=16000)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cl = client()
    cost = 0.0
    with ThreadPoolExecutor(a.jobs) as pool:
        futs = [pool.submit(run_page, cl, a.model, p, out, a.force, a.max_side, a.max_tokens) for p in a.pages]
        for f in as_completed(futs):
            try:
                p, status, meta = f.result()
            except Exception as e:
                print("FAIL", e)
                continue
            if meta:
                cost += meta["cost"]
                print("p%03d %s  %ss  in=%d out=%d  cost=%.3f" % (
                    p, status, meta["secs"], meta["prompt_tokens"], meta["completion_tokens"],
                    meta["cost"]))
            else:
                print("p%03d %s" % (p, status))
    key = merge(out, sorted(set(KEY_PAGES) | set(a.pages)))
    print("merged %d exercises -> %s   (cost this run: %.3f)" % (len(key), out / "key.json", cost))


if __name__ == "__main__":
    main()
