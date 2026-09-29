# -*- coding: utf-8 -*-
"""Mark printed-book example items (book pre-solves first item(s) of exercises)
and repair parse debris (answer word glued into a stem where the page shows a blank).

Fill-in items only. For each exercise it anchors the exercise segment on the unit's
book pages, rebuilds item line blocks, and applies:

R1  a full reconstruction using real (non-dash) answer variants is a substring of an
    item block -> the book pre-solved this item -> example: true
R2  every gap's answer sits at a stem boundary (tail of parts[i] / head of parts[i+1])
    AND the full stem text appears in an item block -> example: true (the book prints
    the solved sentence; the parse kept the answer word inside the stem)
R3  gaps adjacent as in R2 but the stem is NOT printed -> the answer word was glued
    into the stem while the page shows a blank -> strip it from the stem.

Baked expectations: exactly 2 repairs -
    unit-105 105.3 item 5   (strip trailing "more")
    unit-119 119.1 item 10  (strip trailing "for")
Any other repair must be eyeballed against its page line before trusting.
"""
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DASHES = {"-", "\u2013", "\u2014"}
CAP = 12
MIN_LEN = 15


def norm(s: str) -> str:
    s = s.lower().replace("\u2019", "'")
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def page_text(p: int):
    fp = "work/pages/plain/p%03d.txt" % p
    if not os.path.exists(fp):
        return None
    with open(fp, encoding="utf-8") as f:
        return f.read()


def collect_blocks(raw: str, ex_id: str):
    """Candidate item line-blocks for one exercise anchor on one page."""
    if raw is None:
        return []
    anchor = re.search(r"(?m)^\s*" + re.escape(ex_id) + r"\s+\S", raw)
    if not anchor:
        return []
    seg = raw[anchor.start(): anchor.start() + 6000]
    out = []
    for m in re.finditer(r"(?m)^\s*(\d{1,3})(?:\s+[a-z])?\s+\S", seg):
        start = m.start()
        nxt = re.search(r"(?m)^\s*\d{1,3}[a-z]?\s+\S", seg[m.end():])
        end = (m.end() + nxt.start()) if nxt else (m.end() + 900)
        out.append(norm(seg[start:end]))
    return out


def variant_combos(answers):
    """Cartesian product of per-gap variants (dashes skipped), capped at CAP."""
    lists = []
    for group in answers:
        keep = [v for v in group if v not in DASHES]
        if not keep:
            return None
        lists.append(keep)
    prod = 1
    for l in lists:
        prod *= len(l)
    if prod == 0 or prod > CAP:
        return None
    out = [[]]
    for l in lists:
        out = [c + [v] for c in out for v in l]
    return out


def reconstitute(parts, fill):
    """Stem with each answer inserted after the part preceding its gap."""
    pieces = []
    for i, part in enumerate(parts):
        pieces.append(part)
        if i < len(fill):
            pieces.append(fill[i])
    return " ".join(pieces)


def is_adjacent(n_left: str, n_right: str, n_variants) -> bool:
    """True if some variant (len>=2) is the tail word-run of the left part or the
    head word-run of the right part (word-boundary safe on both sides)."""
    lw = n_left.split()
    rw = n_right.split()
    for v in n_variants:
        vw = v.split()
        if len(v) < 2 or not vw:
            continue
        if len(vw) <= len(lw) and lw[len(lw) - len(vw):] == vw:
            return True
        if len(vw) <= len(rw) and rw[: len(vw)] == vw:
            return True
    return False


def strip_trailing_seq(text: str, v: str):
    esc = r"\s*" + r"\s+".join(re.escape(w) for w in v.split()) + r"\s*$"
    new = re.sub(esc, " ", text)
    return new if new != text else None


def strip_leading_seq(text: str, v: str):
    esc = r"^\s*" + r"\s+".join(re.escape(w) for w in v.split()) + r"\s*"
    new = re.sub(esc, "", text)
    return new if new != text else None


def apply_r3(parts, answers):
    """Strip glued answer words from part boundaries. Returns (new_parts, notes)."""
    new_parts = list(parts)
    notes = []
    nrm = [norm(p) for p in new_parts]
    for i in range(len(answers)):
        for v in answers[i]:
            nv = norm(v)
            if len(nv) < 2:
                continue
            left = nrm[i]
            if left.endswith(nv) and (len(left) == len(nv) or left[-len(nv) - 1] == " "):
                cut = strip_trailing_seq(new_parts[i], v)
                if cut is not None:
                    new_parts[i] = cut
                    notes.append("parts[%d] -= %r" % (i, v))
        # nrm must track edits; recompute the pair norms each gap
        nrm = [norm(p) for p in new_parts]
    return new_parts, notes


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_docs():
    """Load full JSON docs; returns [(kind, pk, path, doc)]."""
    docs = []
    for f in sorted(os.listdir("data/units")):
        if not f.endswith(".json"):
            continue
        pn = int(re.match(r"unit-(\d{3})\.json", f).group(1))
        path = "data/units/" + f
        docs.append(("u", "u%d" % pn, path, json.load(open(path, encoding="utf-8"))))
    for f in sorted(os.listdir("data/additional")):
        if not (f.endswith(".json") and f[:2].isdigit()):
            continue
        pn = int(f[:2])
        path = "data/additional/" + f
        docs.append(("a", "a%d" % pn, path, json.load(open(path, encoding="utf-8"))))
    return docs


def iter_exercises(kind, doc):
    if kind == "u":
        for e in doc.get("exercises") or []:
            yield e["id"], e
    else:
        ex = doc.get("exercise")
        if ex:
            yield ex.get("id") or "?", ex

EXCLUDE = {("a15", "15", 15), ("a15", "15", 19)}  # page-verified false positives (blank labels in a letter text)


def main():
    apply = "--apply" in sys.argv
    flagged = []
    repairs = []
    changed_docs = {}

    for kind, pk, path, doc in load_docs():
        pages = doc.get("pdfPages") or []
        raws = [page_text(p) for p in pages]
        for ex_id, ex in iter_exercises(kind, doc):
            if ex.get("type") != "fill-in":
                continue
            blocks = []
            for raw in raws:
                blocks.extend(collect_blocks(raw, ex_id))
            if not blocks:
                continue
            for it in ex.get("items") or []:
                num = it.get("num")
                if (pk, ex_id, num) in EXCLUDE:
                    continue
                answers = it.get("answers") or []
                if not answers or not all(isinstance(g, list) and g for g in answers):
                    continue
                if it.get("example"):
                    continue
                parts = it.get("parts") or []
                if len(parts) != len(answers) + 1 or len(parts) < 2:
                    continue

                # ---- R1: pre-solved with a dash-free variant combo ----
                marked = False
                for combo in variant_combos(answers) or ():
                    nrec = norm(reconstitute(parts, combo))
                    if len(nrec) >= MIN_LEN and any(nrec in b for b in blocks):
                        it["example"] = True
                        flagged.append((pk, ex_id, num, "R1", nrec))
                        changed_docs[path] = doc
                        marked = True
                        break
                if marked:
                    continue

                # ---- R2: stem-with-glued-answers printed on the page ----
                nrm = [norm(p) for p in parts]
                nvars = [[norm(v) for v in g] for g in answers]
                if all(is_adjacent(nrm[i], nrm[i + 1], nvars[i]) for i in range(len(answers))):
                    stem = norm(" ".join(parts))
                    if len(stem) >= MIN_LEN and any(stem in b for b in blocks):
                        it["example"] = True
                        flagged.append((pk, ex_id, num, "R2", stem))
                        changed_docs[path] = doc
                        continue

                    # ---- R3: glued answer but stem not printed -> debris ----
                    new_parts, notes = apply_r3(parts, answers)
                    if notes:
                        repairs.append((pk, ex_id, num, notes))
                        it["parts"] = new_parts
                        changed_docs[path] = doc

    print("examples flagged: %d" % len(flagged))
    for pk, ex_id, num, rule, sample in flagged:
        print("  EX %-6s %-8s item %-3s [%s] %s" % (pk, ex_id, num, rule, sample[:70]))
    print("repairs: %d" % len(repairs))
    for pk, ex_id, num, notes in repairs:
        print("  RP %-6s %-8s item %-3s %s" % (pk, ex_id, num, notes))
    print("changed files: %d" % len(changed_docs))

    if not apply:
        print("dry-run: nothing written. Re-run with --apply to write.")
        return
    for path, doc in changed_docs.items():
        write_json(path, doc)
    print("applied: wrote %d files" % len(changed_docs))


if __name__ == "__main__":
    main()
