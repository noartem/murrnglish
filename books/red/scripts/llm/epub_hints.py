"""Plain-text dump of the interactive exercises in the (partial) EPUB.

The EPUB is the English original (4th ed.) and only covers ~32 units; its
hidden "answer*" elements carry the model answers. The text is given to the
unit parser as a cross-check hint — the Russian PDF edition differs in places
(extra translation exercises, changed items), so the PDF page stays the
source of truth.

Usage:  python scripts/llm/epub_hints.py 2      (prints the hint for unit 2)
"""
import html
import re
import sys
from html.parser import HTMLParser

from common import EPUB_HTML

BLOCK = {"div", "p", "li", "tr", "br", "h1", "h2", "h3", "h4", "table"}


class _Dump(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines, self.cur, self.stack = [], "", []

    def _flush(self):
        t = re.sub(r"[ \t ]+", " ", self.cur).strip()
        if t:
            self.lines.append(t)
        self.cur = ""

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class") or ""
        is_ans = cls.startswith("answer")
        if tag in BLOCK:
            self._flush()
        if tag in ("br",):
            return
        self.stack.append((tag, is_ans))
        if is_ans:
            self.cur += " [ANSWER: "

    def handle_endtag(self, tag):
        while self.stack:
            t, is_ans = self.stack.pop()
            if is_ans:
                self.cur += "] "
            if t == tag:
                break
        if tag in BLOCK:
            self._flush()

    def handle_data(self, data):
        self.cur += data


def unit_hint(n):
    path = EPUB_HTML / ("ESSB01U%03dP002.html" % n)
    if not path.exists():
        return None
    src = path.read_text(encoding="utf-8")
    # interactive part starts at the first "Unit N   Exercise M" header; the
    # page's static text layer before it duplicates the printed page
    i = src.find('class="bgimg0"')
    src = src[src.rfind("<", 0, i):] if i >= 0 else src
    src = re.sub(r"<(script|style)\b.*?</\1>", "", src, flags=re.S)
    d = _Dump()
    d.feed(src)
    d._flush()
    out = "\n".join(d.lines)
    out = re.sub(r"\[ANSWER:\s*\]", "", out)
    return html.unescape(out).strip()


if __name__ == "__main__":
    print(unit_hint(int(sys.argv[1])) or "(no EPUB page for this unit)")
