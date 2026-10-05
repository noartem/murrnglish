// Cover: a book's cover, drawn. The app used to serve a scan of the printed
// cover per book (books/<id>/cover.*); one cover shape per book anyway, so it
// is drawn here instead — and drawn as the book really is: its colour edge to
// edge, the printed cover's typography knocked out in the ink that reads on
// it. Nothing of the app's chrome leaks in, so the cover is the same picture
// in the light and the dark theme.
//
// It is an inline <svg>, not a replaced <img>: nothing to download, and the
// title reflows to two lines when it carries a colon. Call sites pass their
// own className — .homecover, .libcover, .dlcover — and set the aspect ratio
// inline, because an inline svg has no intrinsic size.

import type { JSX } from "react";
import type { Book } from "../books";

/** The drawn cover's box: A5-ish, the shape the printed covers were. */
const W = 1112;
const H = 1653;

/**
 * The ink on a book colour: white where it is dark enough to carry white,
 * near-black where it is not. Chosen by relative luminance, so a third book
 * in any colour gets readable type without anyone tuning it by hand.
 */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // white reaches ~3:1 on this luminance; black carries the rest far better
  return lum > 0.28 ? "#141118" : "#ffffff";
}

/** "English Grammar: Foundations" -> ["English Grammar", "Foundations"]. */
function titleLines(title: string): string[] {
  const i = title.indexOf(": ");
  return i === -1 ? [title] : [title.slice(0, i), title.slice(i + 2)];
}

export function Cover({ book, className }: { book: Book; className?: string }): JSX.Element {
  const lines = titleLines(book.title);
  // one flat field of the book's colour, with the ink that reads on it
  const ink = inkOn(book.color);
  const dim = `color-mix(in srgb, ${ink} 72%, transparent)`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${book.title} — ${book.level}`}
      className={className}
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      <rect width={W} height={H} fill={book.color} />
      {/* the printed cover's furniture: a rule under the title block and
          another above the imprint, the same device both books carry */}
      <rect x={140} y={760} width={W - 280} height={10} fill={dim} />
      {lines.map((line, i) => (
        <text
          key={line}
          x={140}
          y={i === 0 ? 480 : 660}
          // textLength fits the line to the block whatever its length, so a
          // long or short title never runs off the cover
          textLength={W - 280}
          lengthAdjust="spacingAndGlyphs"
          style={{ fontFamily: "var(--font-ui)", fontSize: 116, fontWeight: 900 }}
          fill={ink}
        >
          {line}
        </text>
      ))}
      <text
        x={140}
        y={1520}
        style={{ fontFamily: "var(--font-ui)", fontSize: 46, fontWeight: 800 }}
        fill={ink}
      >
        Murrnglish
      </text>
      <text
        x={140}
        y={1584}
        style={{ fontFamily: "var(--font-ui)", fontSize: 40, fontWeight: 700 }}
        fill={dim}
      >
        {`${book.level} · ${book.units} units`}
      </text>
    </svg>
  );
}