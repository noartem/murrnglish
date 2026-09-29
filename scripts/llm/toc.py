"""Unit titles and groups from the table of contents (PDF pages 4-7).

Writes work/llm/toc.json ({"groups": [{"name", "units": [{"unit", "title"}]}]})
and work/llm/titles.json ({"N": title}) used by parse_units.py.

Usage:  python scripts/llm/toc.py --model xiaomi/mimo-v2.6-flash
"""
import argparse
import json

from common import LLM, N_UNITS, chat, client, extract_json, image_part, page_image

SYSTEM = """You transcribe the table of contents ("Содержание") of the Russian
edition of Murphy's "Essential Grammar in Use". The images are consecutive
contents pages. Units are numbered 1–%d and grouped under section headings
(e.g. "Настоящее время", "There и it", "-ing и to …").

Reply with ONE compact JSON object and nothing else:
{"groups": [{"name": "There и it", "units": [{"unit": 38, "title": "there is · there are"}]}]}

Rules:
- Every unit 1–%d exactly once, in order; skip prefaces and appendices
  ("Приложения", "Дополнительные упражнения", indexes).
- `title` = the printed title verbatim (English and Russian parts, curly
  apostrophes ’, ellipsis …). When the title prints several separate
  phrases side by side separated by wide spaces, join them with " · ".
  A title wrapped onto the next line continues the same title.
- `name` = the group heading verbatim.
""" % (N_UNITS, N_UNITS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--pages", type=int, nargs="*", default=[4, 5, 6, 7])
    a = ap.parse_args()
    content = [{"type": "text", "text": "Contents pages %s." % a.pages}]
    content += [image_part(page_image(p)) for p in a.pages]
    text, meta = chat(client(), a.model, SYSTEM, content, tag="toc")
    toc = extract_json(text)
    (LLM / "toc.json").write_text(json.dumps(toc, ensure_ascii=False, indent=1), encoding="utf-8")
    titles = {str(u["unit"]): u["title"] for g in toc["groups"] for u in g["units"]}
    (LLM / "titles.json").write_text(json.dumps(titles, ensure_ascii=False, indent=1), encoding="utf-8")
    missing = [n for n in range(1, N_UNITS + 1) if str(n) not in titles]
    print("groups %d, titles %d, missing %s, cost %.3f" % (
        len(toc["groups"]), len(titles), missing, meta["cost"]))


if __name__ == "__main__":
    main()
