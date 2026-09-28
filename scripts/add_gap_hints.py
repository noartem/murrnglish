#!/usr/bin/env python3
"""Add missing bracket hints (e.g. "(not / use)") to fill-in items in data/.

Book ground truth: original/book.pdf prints a parenthetical hint after many
fill-in gaps.  Extraction of some exercises lost that hint text, so the app
shows bare gaps.  This script scans the book pages for hint parens and adds
them to items' `parts` verbatim.

Modes:
    python scripts/add_gap_hints.py --dry-run    report only, no writes
    python scripts/add_gap_hints.py --apply      edit data files

Report goes to stdout and work/hint-gaps-report.txt.
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "original" / "book.pdf"
UNITS = ROOT / "data" / "units"
ADDITIONAL = ROOT / "data" / "additional"
REPORT = ROOT / "work" / "hint-gaps-report.txt"

# Hint parens: the book prints per-gap prompts like "(not / use)", "(work)",
# "(the floor)".  Any paren text is a candidate; is_hint_paren() filters out
# answer notes ("(if is correct)", "(I'm doing etc.)"), "(= ...)", digits and
# multi-word explanations.
PAREN_RE = re.compile(r"\([^()\n]+\)")
BAD_HINT_RE = re.compile(r"etc\.|[=;]|[0-9]|^\([A-Za-z]\)$|correct|\)\s*:")


def is_hint_paren(h):
    """True when a page paren is a fill-in hint."""
    if BAD_HINT_RE.search(h):
        return False
    body = h[1:-1]
    if "/" in body or not re.search(r"\s", body):
        return True
    words = re.findall(r"[A-Za-z\u2019'\-]+", body)
    return 2 <= len(words) <= 6

# Out of scope per plan: unit-046 items are mis-modeled against the book;
# unit-099 99.1 models two-word answers as one gap; unit-111 111.1 is a
# two-column prompt grid handled by hand.
EXCLUDE_EXERCISES = {"46.2", "46.5", "99.1", "111.1", "103.2"}

# ---------------------------------------------------------------- page text

class Pages:
    """Per-page reconstructed text + whitespace-stripped normalized copy."""

    def __init__(self, path):
        import pymupdf
        self.doc = pymupdf.open(str(path))
        self._cache = {}

    def raw(self, pages):
        """Concatenated raw text of pages (1-based list)."""
        return "\n".join(self._page(p) for p in pages)

    def _page(self, pno):
        if pno in self._cache:
            return self._cache[pno]
        page = self.doc[pno - 1]
        words = page.get_text("words")  # x0,y0,x1,y1,word,block,line,wordno
        groups = {}
        for w in words:
            groups.setdefault(round(w[1] / 3), []).append(w)
        lines = []
        for k in sorted(groups):
            ws = sorted(groups[k], key=lambda w: w[0])
            lines.append(self._segmented(ws))
        text = "\n".join(lines)
        self._cache[pno] = text
        return text

    @staticmethod
    def _segmented(ws):
        """Split one visual line into segments on wide gaps (two-column grids)."""
        if len(ws) < 2:
            return ws[0][4] if ws else ""
        gaps = [ws[i + 1][0] - ws[i][2] for i in range(len(ws) - 1)]
        med = sorted(gaps)[len(gaps) // 2]
        thr = 3 * max(med, 4)
        segs, cur = [], [ws[0]]
        for i in range(1, len(ws)):
            if ws[i][0] - ws[i - 1][2] > thr:
                segs.append(cur)
                cur = [ws[i]]
            else:
                cur.append(ws[i])
        segs.append(cur)
        return "\n".join(" ".join(w[4] for w in seg) for seg in segs)

    def close(self):
        self.doc.close()


def norm_map(s):
    """Normalized copy (lower, curly quotes -> ', all whitespace removed)
    plus map normalized-index -> raw-index."""
    out, mapping = [], []
    for i, ch in enumerate(s):
        if ch.isspace():
            continue
        if ch in "\u2018\u2019":
            ch2 = "'"
        else:
            ch2 = ch.lower()
        out.append(ch2)
        mapping.append(i)
    return "".join(out), mapping


def norm(s):
    """Normalized needle (no whitespace)."""
    return norm_map(s)[0]


def find_token(hay_n, needle_n, start, end=None):
    """Find needle_n in hay_n; when the needle starts/ends with a letter,
    that boundary char must not be a letter or apostrophe (avoids matching
    inside words like 'fit' for needle 'it'; digits/parens may adjoin,
    because book item numbers glue to text: '8it(take)')."""
    if not needle_n:
        return None
    lead = "(?<![a-z'])" if needle_n[0].isalpha() else ""
    tail = "(?![a-z'])" if needle_n[-1].isalpha() else ""
    pat = re.compile(lead + re.escape(needle_n) + tail)
    if end is None:
        return pat.search(hay_n, start)
    return pat.search(hay_n, start, end)


# ------------------------------------------------------------ line helpers

def line_index(raw):
    """[(start, end)] raw offsets of each line."""
    lines = raw.split("\n")
    idx, pos = [], 0
    for ln in lines:
        idx.append((pos, pos + len(ln)))
        pos += len(ln) + 1
    return idx


def next_line_match(raw, li, offset, pattern):
    """Raw offset of the first line at/after offset whose text matches pattern."""
    for s, e in li:
        if s < offset:
            continue
        if pattern.match(raw[s:e]):
            return s
    return None


def num_line_re(n):
    """Line that starts with item number n ('3 ', '3.', '10a '); rejects
    exercise-head lines like '2.2' when n=2."""
    return re.compile(r"^%s(?!\.\d)(?:[ .]|$)" % re.escape(str(n)))

NUM_LINE_RE = num_line_re

# -------------------------------------------------------------- data model

def exercises_of(data):
    if "exercises" in data:
        return data["exercises"]
    if "exercise" in data:
        return [data["exercise"]]
    return []


def find_hints(region):
    """All hint parens printed in a text region, in book order.  Parens that
    are stage directions ("You say (to your friend):") are not hints."""
    out = []
    for m in PAREN_RE.finditer(region):
        h = m.group(0)
        if BAD_HINT_RE.search(h):
            continue
        if region[m.end(): m.end() + 1] == ":":
            continue
        out.append(h)
    return out


def hint_count(s):
    return len(find_hints(s))


def gaps_of(item):
    return max(len(item.get("parts", [])) - 1, 0)


def collect_workbook(pages):
    """All fill-in exercises from every data file with their raw page text."""
    out = []
    for folder in (UNITS, ADDITIONAL):
        for path in sorted(folder.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                print("SKIP %s: %s" % (path.name, e), file=sys.stderr)
                continue
            raw = pages.raw(data.get("pdfPages", []))
            li = line_index(raw)
            raw_n, map_n = norm_map(raw)
            for ex in exercises_of(data):
                if ex.get("type") != "fill-in":
                    continue
                out.append(dict(path=path, data=data, ex=ex, raw=raw, li=li,
                                raw_n=raw_n, map_n=map_n))
    return out


# ---------------------------------------------------------- per-item scan

def exercise_window_start(eid, raw, li):
    """First line that is the exercise head: prefer a bare '<id>' line
    (additional exercises print the number alone), then '<id> ' heads."""
    pat_bare = re.compile(r"^%s$" % re.escape(eid))
    pat_head = re.compile(r"^%s(?:[ .]|$)" % re.escape(eid))
    for s, e in li:
        if pat_bare.match(raw[s:e]):
            return s
    for s, e in li:
        if pat_head.match(raw[s:e]):
            return s
    return 0


def occ_iter(hay_n, needle_n, start, end=None, enforce_lead=True):
    """Yield candidate matches for needle_n in document order (the item text
    precedes hint parens on the page).  With enforce_lead, a needle starting
    with a letter must not match inside a word ('wife' for needle 'i').
    A punctuation-stripped variant covers pages that drop the part's trailing
    punctuation (e.g. 'table.' printed as 'table (')."""
    if not needle_n:
        return
    variants = [needle_n]
    stripped = re.sub(r"[.;:?!,\u2018\u2019\u2026]+$", "", needle_n)
    if stripped and stripped != needle_n:
        variants.append(stripped)
    if enforce_lead:
        lead = r"(?<![a-z'])" if needle_n[0].isalpha() else ""
        pats = [re.compile(lead + "|".join(re.escape(v) for v in variants))]
    else:
        pats = [re.compile("|".join(re.escape(v) for v in variants))]
    seen = set()
    for pat in pats:
        m = pat.search(hay_n, start) if end is None else pat.search(hay_n, start, end)
        while m:
            if m.span() not in seen:
                seen.add(m.span())
                yield m
            m = pat.search(hay_n, m.end()) if end is None else pat.search(hay_n, m.end(), end)


def anchor_chain(raw_n, norms, start, end=None):
    """Sequentially anchor normalized needles with backtracking: a candidate
    is accepted only when the remaining parts also anchor after it.  First
    pass enforces a lead-word boundary; the fallback pass allows in-word
    matches for layouts that glue handwriting to the part text."""
    for enforce in (True, False):
        spans = _chain(raw_n, norms, start, end, enforce)
        if spans is not None:
            return spans
    return None


def _chain(raw_n, norms, start, end, enforce):
    def rec(idx, pos):
        if idx == len(norms):
            return []
        pn = norms[idx]
        if not pn:
            rest = rec(idx + 1, pos)
            return None if rest is None else [None] + rest
        for m in occ_iter(raw_n, pn, pos, end, enforce_lead=enforce):
            rest = rec(idx + 1, m.end())
            if rest is not None:
                return [(m.start(), m.end())] + rest
        return None
    return rec(0, start)


def next_num_raw(raw, num, start, end=None, last=False):
    """Raw offset of a standalone item-number token.  Item numbers start a
    reconstructed line/segment (real line break or wide-gap split) or appear
    as '(n)' mid-line.  With last=True, return the last match in the range."""
    num_s = str(num)
    alts = [r"%s(?!\d)(?!\.\d)(?:[ .]|$)" % re.escape(num_s),
            r"\(%s\)" % re.escape(num_s)]
    m = re.match(r"^(\d+)([a-z])$", num_s)
    if m:
        d, L = m.group(1), m.group(2)
        # printed forms: '10a', '10 a'; continuation subitems print the
        # letter alone ('b We weren't allowed …')
        alts = [r"%s%s?%s(?!\d)(?!\.\d)(?:[ .]|$)" % (re.escape(d), r"[ ]?", re.escape(L)),
                r"\(%s[ ]?%s\)" % (re.escape(d), re.escape(L)),
                r"%s(?![a-z0-9])(?:[ .]|$)" % re.escape(L)]
    pat = re.compile(r"(?m)^(?:%s)|(?<=[\s(])\(%s\)" % ("|".join(alts), re.escape(num_s)))
    if last:
        m = None
        for m in pat.finditer(raw, start, end if end is not None else len(raw)):
            pass
        return m.start() if m else None
    m = pat.search(raw, start) if end is None else pat.search(raw, start, end)
    return m.start() if m else None


def norm_to_raw(entry, n_idx):
    """Raw offset for a normalized index (clamped)."""
    map_n = entry["map_n"]
    return map_n[n_idx] if n_idx < len(map_n) else len(entry["raw"])


def scan_item(entry, item, prev_pos, win_start, win_end, win_start_raw=0):
    """Extract hint parens for one item.  Positions are tracked across items
    in data order; win_start/win_end bound the search range (normalized idx);
    win_start_raw is the raw offset of the exercise window head."""
    raw, raw_n, map_n, li = entry["raw"], entry["raw_n"], entry["map_n"], entry["li"]
    parts = item.get("parts", [])
    nums = [it.get("num") for it in entry["ex"].get("items", [])]
    norms = [norm(p) for p in parts]
    # Pure-punctuation parts (".", "?”, …) cannot anchor meaningfully on the
    # page; the paren hunt for their gap falls to the trailing region.
    anchorable = [bool(re.search(r"[0-9a-z]", n)) for n in norms]
    norms = [n if a else "" for n, a in zip(norms, anchorable)]
    if any(norms):
        spans = anchor_chain(raw_n, norms, max(prev_pos, win_start), win_end)
        if spans is None:
            # chain failed: try the item's number region (number line to next
            # item's number) — dialogue layouts glue labels/handwriting into
            # the sentence; the book prints the hint at the region's end
            win_end_raw = norm_to_raw(entry, win_end)
            floor = head_line_end(raw, win_start_raw)
            num_here = next_num_raw(raw, item["num"], max(entry.get("num_waterline", floor), floor), win_end_raw)
            if num_here is None:
                return dict(status="unresolved",
                            reason="anchor chain failed (parts=%r)" % parts[:4])
            nxt = next_num_raw(raw, nums[nums.index(item["num"]) + 1], num_here + 1, win_end_raw) \
                if nums.index(item["num"]) + 1 < len(nums) else None
            region_end = min(nxt if nxt is not None else win_end_raw, win_end_raw)
            if region_end - num_here > 600:
                return dict(status="unresolved",
                            reason="anchor chain failed (parts=%r)" % parts[:4])
            region = raw[num_here: region_end]
            hs = find_hints(region)
            n_gaps_here = len(parts) - 1
            if len(hs) == n_gaps_here and n_gaps_here > 1:
                # the book prints one paren after each gap: gaps 1..n-1 get
                # convention A, the last one B
                hints = [("A", k, h) for k, h in enumerate(hs[:-1])]
                hints.append(("B", None, hs[-1]))
            else:
                hints = [("B", None, h) for h in hs]
            return dict(status="region", hints=hints,
                        next_pos=prev_pos, region_end=region_end)
        anchors = list(spans)
    else:
        anchors = [None] * len(parts)

    filled = [a for a in anchors if a is not None]
    if not filled:
        return dict(status="fallback", next_pos=prev_pos)
    first_s, last_e = filled[0][0], filled[-1][1]

    # before-first-part region: starts at the item's number (last occurrence
    # before the first anchor, so the exercise head '7' never wins)
    before_start = 0
    floor = head_line_end(raw, win_start_raw)
    nl = next_num_raw(raw, item["num"], max(win_start_raw, floor), map_n[first_s], last=True)
    if nl is not None:
        before_start = nl
    next_pos = max(prev_pos, last_e)

    # trailing bound: next item's number (raw line/segment start) or window end
    trail_end = norm_to_raw(entry, win_end)
    if item["num"] in nums:
        idx_num = nums.index(item["num"])
        if idx_num + 1 < len(nums):
            nxt_raw = next_num_raw(raw, nums[idx_num + 1], map_n[last_e], trail_end)
            if nxt_raw is not None:
                trail_end = nxt_raw

    hints = []  # (region_kind, gap_index, hint)
    if before_start:
        region = raw[before_start: map_n[first_s]]
        for h in find_hints(region):
            hints.append(("C", None, h))
    for j in range(len(anchors) - 1):
        if anchors[j] is None:
            continue
        k = j + 1
        while k < len(anchors) and anchors[k] is None:
            k += 1
        if k >= len(anchors):
            continue
        if anchors[k][0] <= anchors[j][1]:
            continue
        region = raw[map_n[anchors[j][1]]: map_n[anchors[k][0]]]
        hs = find_hints(region)
        if k == j + 1:
            for h in hs:
                hints.append(("A", j, h))
        else:
            # punctuation-only parts (and short glued tails) sit between the
            # gap and the next anchor: assign parens in book order to the
            # successive part boundaries ('(I / not / wait). (I / go) now.')
            for i, h in enumerate(hs):
                idx = j + 1 + i
                if idx < len(parts):
                    hints.append(("P", idx - 1, h))
                else:
                    break
    region = raw[map_n[last_e]: trail_end]
    trail_hs = find_hints(region)
    first_char = region.lstrip()[:1]
    if (trail_hs and first_char == "(" and len(anchors) >= 2
            and not re.search(r"[0-9a-z]", norm(parts[-1]))):
        # region opens with the printed hint: it precedes the item's
        # punctuation tail ('What (this word / mean)?')
        for h in trail_hs:
            hints.append(("P", len(parts) - 2, h))
    else:
        for h in trail_hs:
            hints.append(("B", None, h))

    return dict(status="ok", hints=hints, next_pos=next_pos)


# ------------------------------------------------------- hint application

def apply_hints(parts, hints, log):
    """Return True if parts changed."""
    changed = False
    joined = " ".join(parts)
    for kind, gap, hint in hints:
        if hint in joined:
            continue
        if kind == "A":
            target = parts[gap + 1]
            if PAREN_RE.search(target):
                log.append("skip A gap %d: part already has hint" % gap)
                continue
            # hint already carries its parentheses, as printed
            if target and target[0].isspace():
                parts[gap + 1] = " " + hint + target
            elif target and target[0] in ".,;:!?…)»":
                parts[gap + 1] = hint + target
            else:
                parts[gap + 1] = hint + " " + target
            changed = True
        elif kind == "P":
            # insert before the punctuation-only part, as printed
            target = parts[gap + 1]
            if hint in target:
                continue
            parts[gap + 1] = hint + target
            changed = True
        elif kind == "B":
            last = parts[-1]
            if hint in last:
                continue
            sep = "" if not last or last[-1].isspace() else " "
            parts[-1] = last + sep + hint
            changed = True
        elif kind == "C":
            if PAREN_RE.search(parts[0]):
                log.append("skip C: first part already has hint")
                continue
            parts[0] = hint + " " + parts[0].lstrip()
            changed = True
    return changed


def additional_next_id_re(eid):
    """Bare-number line of the next additional exercise (smallest id > eid)."""
    try:
        eid_i = int(eid)
    except ValueError:
        return None
    ids = sorted(int(p.stem) for p in ADDITIONAL.glob("*.json"))
    nxt = [i for i in ids if i > eid_i]
    if not nxt:
        return None
    return re.compile(r"^%d$" % nxt[0])


def head_line_end(raw, start):
    """Raw offset just after the newline that ends the head line at start."""
    nl = raw.find("\n", start)
    return nl + 1 if nl >= 0 else len(raw)


EX_HEAD_RE = re.compile(r"^\d{1,3}\.\d{1,2}(?:[ .]|$)")


def window_bounds(eid, raw, li, additional=False):
    """Raw offsets [start, end) of one exercise's text window.  Additional
    exercises (bare-number heads) stop at the next additional exercise's
    bare-number head line."""
    start = exercise_window_start(eid, raw, li)
    if additional:
        pat = additional_next_id_re(eid)
        end = next_line_match(raw, li, start + 1, pat) if pat is not None else None
        if end is None:
            end = len(raw)
        return start, end

    end = next_line_match(raw, li, start + 1, EX_HEAD_RE)
    if end is None:
        end = len(raw)
    return start, end


def norm_pos(entry, raw_off):
    """Map a raw offset to the normalized index (whitespace stripped)."""
    map_n = entry["map_n"]
    lo, hi = 0, len(map_n)
    while lo < hi:
        mid = (lo + hi) // 2
        if map_n[mid] < raw_off:
            lo = mid + 1
        else:
            hi = mid
    return lo


def json_dump(v, ensure_ascii):
    return json.dumps(v, ensure_ascii=ensure_ascii)


def dump_el(v, ensure_ascii):
    return json.dumps(v, ensure_ascii=ensure_ascii)


def rebuild_parts_literal(old_src_span, new_parts, ensure_ascii):
    """Rebuild the parts array literal preserving the original layout."""
    text = old_src_span
    dec = json.JSONDecoder()
    open_br = text.index("[")
    if "\n" not in text[open_br: open_br + 2 + 1]:
        return "[" + ", ".join(dump_el(v, ensure_ascii) for v in new_parts) + "]"
    # multi-line: derive the element indent and the closing-bracket indent
    after = text[open_br + 1:]
    first_nl = after.index("\n")
    el_ind = re.match(r"[ ]*", after[first_nl + 1:]).group(0)
    m_close = re.search(r"\n([ ]*)\]\s*$", text)
    close_ind = m_close.group(1) if m_close else el_ind[:-2]
    lines = [el_ind + dump_el(v, ensure_ascii) for v in new_parts]
    return "[" + "\n" + ",\n".join(lines) + "\n" + close_ind + "]"


def surgical_edit(src, fname, eid, item, new_parts):
    """Replace the parts literal of one item in the file text, preserving the
    file's layout (one-line vs pretty) and escape style."""
    ex_anchor = '"id": "%s"' % eid
    i = src.find(ex_anchor)
    if i < 0:
        ex_anchor = '"id":"%s"' % eid
        i = src.find(ex_anchor)
    if i < 0:
        raise RuntimeError("%s: exercise %s not found" % (fname, eid))
    nxt = src.find('"id":', i + len(ex_anchor))
    seg_end = nxt if nxt >= 0 else len(src)
    num = item["num"]
    if isinstance(num, str):
        num_pat = re.compile(r'"num":\s*"%s"' % re.escape(num))
    else:
        num_pat = re.compile(r'"num":\s*%d\b' % num)
    m = num_pat.search(src, i, seg_end)
    if m is None:
        raise RuntimeError("%s: item %s of %s not found" % (fname, num, eid))
    # the "parts" key of this item
    kp = src.find('"parts"', m.end(), seg_end)
    if kp < 0:
        raise RuntimeError("%s: parts key of %s item %s not found" % (fname, num, eid))
    open_br = src.index("[", kp, seg_end)
    old_val, end = json.JSONDecoder().raw_decode(src, open_br)
    assert old_val == item.get("parts", []), \
        "%s %s item %s: file parts differ from data" % (fname, eid, num)
    span = src[open_br: end]
    # escape style from the original literal
    ensure_ascii = "\\u" in span
    new_lit = rebuild_parts_literal(span, new_parts, ensure_ascii)
    return src[:open_br] + new_lit + src[end:]


def verify_file(path, expected):
    """After write: parse and assert new part values + counts unchanged."""
    data = json.loads(path.read_text(encoding="utf-8"))
    exs = {e.get("id"): e for e in exercises_of(data)}
    for eid, num, new_parts, old_lens in expected:
        ex = exs[eid]
        it = next(i for i in ex["items"] if i.get("num") == num)
        assert it["parts"] == new_parts, "%s %s item %s: parts mismatch" % (path.name, eid, num)
        assert len(it.get("answers", [])) == old_lens[0]
        assert len(it["parts"]) == old_lens[1]


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    pages = Pages(PDF)
    book = collect_workbook(pages)
    pages.close()

    lines = []
    ok_n = unres_n = edit_n = 0

    changes_by_file = {}
    for entry in book:
        path, ex = entry["path"], entry["ex"]
        eid = ex.get("id")
        if eid in EXCLUDE_EXERCISES:
            continue
        file_report = []
        # normalized instruction texts of every exercise in this file: parens
        # printed inside them are prompts/annotations, never item hints
        instr_norms = [norm(e.get("instruction", "")) for e in exercises_of(entry["data"])]
        entry.pop("num_waterline", None)
        win_start, win_end = window_bounds(eid, entry["raw"], entry["li"],
                                           additional=entry["path"].parent == ADDITIONAL)
        win_start_n, win_end_n = norm_pos(entry, win_start), norm_pos(entry, win_end)
        items = ex.get("items", [])
        sub_nums = [it.get("num") for it in items
                    if isinstance(it.get("num"), str) and re.match(r"^\d+[a-z]$", it["num"])]
        if sub_nums and len(sub_nums) == len(items):
            floor = head_line_end(entry["raw"], win_start)
            groups = {}
            for it in items:
                d, L = re.match(r"^(\d+)([a-z])$", str(it["num"])).groups()
                groups.setdefault(d, []).append((L, it))
            for d, members in groups.items():
                g_start = next_num_raw(entry["raw"], d, floor, win_end)
                if g_start is None:
                    continue
                g_end = next_num_raw(entry["raw"], str(int(d) + 1), g_start + 1, win_end)
                if g_end is None:
                    g_end = win_end
                hs = find_hints(entry["raw"][g_start:g_end])
                if not hs:
                    continue
                for i, (L, it) in enumerate(members):
                    parts = it.get("parts", [])
                    if not parts or sum(hint_count(p) for p in parts) >= gaps_of(it):
                        continue
                    h = hs[i] if len(hs) == len(members) else hs[0]
                    new_parts = list(parts)
                    sep = "" if not new_parts[-1] or new_parts[-1][-1].isspace() else " "
                    if h not in new_parts[-1]:
                        new_parts[-1] = new_parts[-1] + sep + h
                        edit_n += 1
                        file_report.append(
                            "  SUBITEM %s %s item %s: hint %r -> B (group region)"
                            % (path.name, eid, it.get("num"), h))
                        changes_by_file.setdefault(path, []).append(
                            (eid, it, new_parts, [("B", None, h)], "subitem"))
            lines.append("%s %s" % (path.name, eid))
            lines.extend(file_report)
            continue
        pos = win_start_n

        for it in items:
            parts = it.get("parts", [])
            n_gaps = gaps_of(it)
            have = sum(hint_count(p) for p in parts)
            if not parts or have >= n_gaps:
                continue
            res = scan_item(entry, it, pos, win_start_n, win_end_n, win_start)
            # drop hints that are printed inside any instruction of this file
            res_hints = [(k, g, h) for k, g, h in res.get("hints", [])
                         if norm(h) not in "".join(instr_norms)
                         and all(norm(h) not in n for n in instr_norms)]
            if res["status"] in ("ok", "region"):
                res = dict(res, hints=res_hints)
            if res["status"] == "region":
                # hint extracted from the item's printed number region
                waterline = res.get("region_end") or win_start
                entry["num_waterline"] = waterline
                if not res["hints"]:
                    pos = norm_pos(entry, waterline)
                    continue
                new_parts = list(parts)
                if apply_hints(new_parts, res["hints"], []):
                    kinds = ", ".join("%s%s" % (k, "" if g is None else "/gap%d" % g)
                                      for k, g, _ in res["hints"])
                    edit_n += 1
                    file_report.append(
                        "  REGION %s %s item %s: hints %r -> %s (number-region fallback)"
                        % (path.name, eid, it.get("num"), [h for _, _, h in res["hints"]], kinds))
                    changes_by_file.setdefault(path, []).append((eid, it, new_parts, res["hints"], "region"))
                pos = norm_pos(entry, waterline)
                continue
            if res["status"] == "unresolved":
                unres_n += 1
                file_report.append(
                    "  UNRESOLVED %s %s item %s: %s (parts=%r)"
                    % (path.name, eid, it.get("num"), res["reason"], parts))
                pos = res.get("next_pos") or pos
                continue
            pos = res.get("next_pos") or pos
            if res["status"] == "fallback":
                # all parts empty: parens live on the item-number line
                floor = head_line_end(entry["raw"], win_start)
                nl = next_num_raw(entry["raw"], it["num"],
                                  max(floor, entry.get("num_waterline", floor)), win_end)
                region = ""
                end = win_end
                if nl is not None:
                    idx_num = [x.get("num") for x in items].index(it["num"]) \
                        if it["num"] in [x.get("num") for x in items] else None
                    if idx_num is not None and idx_num + 1 < len(items):
                        nxt = next_num_raw(entry["raw"], items[idx_num + 1].get("num"),
                                           nl + 1, win_end)
                        end = nxt if nxt is not None else win_end
                    region = entry["raw"][nl: end]
                hs = find_hints(region)
                entry["num_waterline"] = end
                pos = norm_pos(entry, end)
                if not hs:
                    ok_n += 1
                    continue
                new_parts = list(parts)
                for h in hs:
                    sep = "" if not new_parts[-1] or new_parts[-1][-1].isspace() else " "
                    new_parts[-1] = new_parts[-1] + sep + h
                ok_n += 1
                file_report.append(
                    "  FALLBACK %s %s item %s: %s (convention B)"
                    % (path.name, eid, it.get("num"), hs))
                edit_n += 1
                changes_by_file.setdefault(path, []).append((eid, it, new_parts, hs, "fallback"))
                continue
            if not res["hints"]:
                ok_n += 1
                continue
            new_parts = list(parts)
            log = []
            if not apply_hints(new_parts, res["hints"], log):
                ok_n += 1
                continue
            for msg in log:
                file_report.append("  note %s %s item %s: %s" % (path.name, eid, it.get("num"), msg))
            ok_n += 1
            edit_n += 1
            kinds = ", ".join("%s%s" % (k, "" if g is None else "/gap%d" % g) for k, g, _ in res["hints"])
            file_report.append(
                "  EDIT %s %s item %s: hints %r -> %s"
                % (path.name, eid, it.get("num"), [h for _, _, h in res["hints"]], kinds))
            changes_by_file.setdefault(path, []).append((eid, it, new_parts, res["hints"], "auto"))
        if file_report:
            lines.append("%s %s" % (path.name, eid))
            lines.extend(file_report)

    lines.insert(0, "candidates=%d edits=%d unresolved=%d" % (ok_n + unres_n, edit_n, unres_n))
    text = "\n".join(lines) + "\n"
    print(text, end="")
    if args.apply:
        srcs = {}
        expected_by_path = {}
        for path, chs in changes_by_file.items():
            src = srcs.setdefault(path, path.read_text(encoding="utf-8"))
            expected = expected_by_path.setdefault(path, [])
            for eid, it, new_parts, hs, mode in chs:
                src = surgical_edit(src, path.name, eid, it, new_parts)
                expected.append((eid, it["num"], new_parts,
                                 (len(it.get("answers", [])), len(it["parts"]))))
            srcs[path] = src
        for path, src in srcs.items():
            path.write_text(src, encoding="utf-8")
            verify_file(path, expected_by_path[path])
        print("applied %d item edit(s) across %d file(s); validate next."
              % (sum(len(v) for v in changes_by_file.values()), len(changes_by_file)))


if __name__ == "__main__":
    main()
