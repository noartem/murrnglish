// Cover: a book's cover, drawn. The app used to serve a scan of the printed
// cover per book (books/<id>/cover.*); one cover shape per book anyway, so it
// is drawn here instead: the book's own color, its title and its size, in the
// theme's colors, so it follows the light/dark switch like the rest of the UI.
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

/** "English Grammar: Foundations" -> ["English Grammar", "Foundations"]. */
function titleLines(title: string): string[] {
  const i = title.indexOf(": ");
  return i === -1 ? [title] : [title.slice(0, i), title.slice(i + 2)];
}

export function Cover({ book, className }: { book: Book; className?: string }): JSX.Element {
  const lines = titleLines(book.title);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${book.title} — ${book.level}`}
      className={className}
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      <rect width={W} height={H} fill="var(--img-bg)" />
      {/* the spine: the book's color, with a darker rule on its fold */}
      <rect width={96} height={H} fill={book.color} />
      <rect x={72} width={24} height={H} fill={`color-mix(in srgb, ${book.color} 70%, black)`} />
      {lines.map((line, i) => (
        <text
          key={line}
          x={176}
          y={i === 0 ? 520 : 660}
          style={{ fontFamily: "var(--font-ui)", fontSize: 108, fontWeight: 900 }}
          fill="var(--text)"
        >
          {line}
        </text>
      ))}
      <text
        x={176}
        y={1500}
        style={{ fontFamily: "var(--font-ui)", fontSize: 44, fontWeight: 800 }}
        fill="var(--muted)"
      >
        Murrnglish
      </text>
      <text
        x={176}
        y={1560}
        style={{ fontFamily: "var(--font-ui)", fontSize: 40, fontWeight: 700 }}
        fill="var(--soft)"
      >
        {`${book.level} · ${book.units} units`}
      </text>
    </svg>
  );
}