// The rules compendium (#/rules, #/rules/<book>, #/rules/<book>/u<N>): every
// book's rules by its own groups, a search across all of them, and one unit's
// rule beside the list. The rule is the text scripts/rules_text.mjs read from
// the book page, laid out like the page (lettered sections, examples, side by
// side columns) — or, where a book has no text of its own or the learner
// prefers it, the book page itself in the same viewer the course uses. Each
// rule links to the unit's exercises and its card deck.
//
// Phones show one thing at a time: the list (with the search), or the rule
// with a way back to the list.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { ArrowLeft, FileText, Image, Layers, PencilLine, Search, X } from "lucide-react";
import type { Book } from "../books";
import { BOOKS, bookUrl } from "../books";
import type { PageAspects } from "../data";
import { fetchPageAspects } from "../data";
import { loadBookCards } from "../decks";
import type { BookRules, ParsedRule, RuleHit, RuleLine } from "../rules";
import { highlight, loadBookRules, queryTerms, searchRules, theoryPages } from "../rules";
import { bookHash, deckHash, rulesHash } from "../routes";
import { useIsMobile } from "../useIsMobile";
import { PageViewer } from "./PageViewer";
import { PickWord } from "./PickWord";
import { SectionBar } from "./SectionBar";

const OS_OPTIONS = {
  overflow: { x: "hidden" as const },
  scrollbars: { theme: "os-theme-dark", autoHide: "leave" as const, autoHideDelay: 500 },
};

type Loaded = Record<string, BookRules>;

function useAllRules(): { rules: Loaded; failed: Book[] } {
  const [state, setState] = useState<{ rules: Loaded; failed: Book[] }>({ rules: {}, failed: [] });
  useEffect(() => {
    let alive = true;
    for (const b of BOOKS)
      loadBookRules(b).then(
        (r) => alive && setState((s) => ({ ...s, rules: { ...s.rules, [b.id]: r } })),
        () => alive && setState((s) => ({ ...s, failed: [...s.failed, b] })),
      );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export function RulesView({ book: routeBook, unit }: { book?: Book; unit?: number }) {
  const isMobile = useIsMobile();
  const { rules, failed } = useAllRules();
  const book = routeBook ?? BOOKS[0];
  const br = rules[book.id];
  const [q, setQ] = useState("");
  const terms = useMemo(() => queryTerms(q), [q]);
  const hits = useMemo(() => searchRules(Object.values(rules), q), [rules, q]);
  const searching = terms.length > 0;

  // phones: the list, or the open rule
  const showList = !isMobile || unit === undefined;
  const showRule = !isMobile || unit !== undefined;

  return (
    <div className="app">
      <SectionBar section="rules" />
      <div className="main rulesmain">
        {showList && (
          <OverlayScrollbarsComponent element="nav" className="rulesnav" options={OS_OPTIONS}>
            <div className="rulesnav-inner">
              <label className="searchbox">
                <Search size={16} aria-hidden />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search every rule…"
                  aria-label="Search the rules"
                  spellCheck={false}
                />
                {q && (
                  <button type="button" className="searchclear" onClick={() => setQ("")} aria-label="Clear the search">
                    <X size={14} aria-hidden />
                  </button>
                )}
              </label>
              {searching ? (
                <SearchResults hits={hits} terms={terms} current={unit !== undefined ? { book, unit } : null} q={q} />
              ) : (
                <>
                  <div className="booktabs" role="tablist" aria-label="Book">
                    {BOOKS.map((b) => (
                      <a
                        key={b.id}
                        role="tab"
                        aria-selected={b === book}
                        className={"booktab" + (b === book ? " on" : "")}
                        href={rulesHash(b)}
                      >
                        <span className="libdot" style={{ background: b.color }} aria-hidden />
                        {b.level}
                      </a>
                    ))}
                  </div>
                  {br ? (
                    <UnitList br={br} active={unit} />
                  ) : failed.includes(book) ? (
                    <p className="rulesnote">This book’s list could not be loaded. Are you offline?</p>
                  ) : (
                    <p className="rulesnote">Loading…</p>
                  )}
                </>
              )}
            </div>
          </OverlayScrollbarsComponent>
        )}
        {showRule &&
          (unit !== undefined && br ? (
            <RulePane key={`${book.id}:${unit}`} br={br} unit={unit} terms={terms} />
          ) : (
            <RulesIntro book={book} br={br} />
          ))}
      </div>
    </div>
  );
}

function UnitList({ br, active }: { br: BookRules; active?: number }) {
  const activeRef = useRef<HTMLAnchorElement>(null);
  // the open unit in the middle of the list (its own scroller only)
  useEffect(() => {
    const el = activeRef.current;
    const vp = el?.closest<HTMLElement>("[data-overlayscrollbars-viewport]");
    if (!el || !vp) return;
    const r = el.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    if (r.top < v.top + 60 || r.bottom > v.bottom) vp.scrollTop += r.top - v.top - v.height / 2;
  }, []);
  return (
    <>
      {br.index.groups.map((g) => (
        <div key={g.name} className="rulegroup">
          <div className="groupname">
            <span>{g.name}</span>
          </div>
          <ul className="rulelist">
            {g.units.map((u) => (
              <li key={u}>
                <a
                  ref={u === active ? activeRef : undefined}
                  className={"rulerow" + (u === active ? " active" : "")}
                  href={rulesHash(br.book, u)}
                  aria-current={u === active ? "page" : undefined}
                >
                  <span className="rulenum">{u}</span>
                  <span className="ruletitle">{br.index.exercises[`u${u}`]?.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function SearchResults({
  hits,
  terms,
  current,
  q,
}: {
  hits: RuleHit[];
  terms: string[];
  current: { book: Book; unit: number } | null;
  q: string;
}) {
  if (!hits.length)
    return (
      <p className="rulesnote">
        Nothing found for “{q.trim()}”. The search reads unit titles in every book and the rule text of the books
        that have it.
      </p>
    );
  return (
    <ul className="rulelist hits" aria-label="Search results">
      {hits.map((h) => {
        const on = current?.book === h.book && current.unit === h.unit;
        return (
          <li key={`${h.book.id}:${h.unit}`}>
            <a className={"rulerow hit" + (on ? " active" : "")} href={rulesHash(h.book, h.unit)}>
              <span className="rulenum">{h.unit}</span>
              <span className="hitbody">
                <span className="ruletitle">
                  <Marked text={h.title} terms={terms} />
                </span>
                <span className="hitbook">
                  <span className="libdot" style={{ background: h.book.color }} aria-hidden />
                  {h.book.level} · {h.group}
                </span>
                {h.snippet && (
                  <span className="hitsnippet">
                    <Marked text={h.snippet} terms={terms} />
                  </span>
                )}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Marked({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlight(text, terms).map((r, i) =>
        r.hit ? (
          <mark key={i} className="hlmark">
            {r.t}
          </mark>
        ) : (
          r.t
        ),
      )}
    </>
  );
}

function RulesIntro({ book, br }: { book: Book; br?: BookRules }) {
  const withText = br ? br.rules.size : 0;
  return (
    <OverlayScrollbarsComponent className="rulepane" options={OS_OPTIONS}>
      <div className="rulecol">
        <article className="rulesheet intro">
          <p className="libkicker">
            <span className="libdot" style={{ background: book.color }} aria-hidden />
            {book.level} · {book.edition}
          </p>
          <h2 className="unitheading">{book.title}: the rules</h2>
          <p className="ruleprose">
            Every unit of the book opens with its rule. Pick a unit from the list, or search: the search looks
            through the rules of every book at once — try <em>since</em>, <em>used to</em> or <em>passive</em>.
          </p>
          {br && (
            <p className="ruleprose muted">
              {withText
                ? `${withText} of ${book.units} rules are here as text; the rest open as the book page.`
                : "This book’s rules open as the book page."}{" "}
              Each rule links to its exercises and its flash cards.
            </p>
          )}
        </article>
      </div>
    </OverlayScrollbarsComponent>
  );
}

// book page aspect ratios, per book, for the page viewer
const aspectCache = new Map<string, Promise<PageAspects>>();
function useAspects(book: Book): PageAspects | null {
  const [a, setA] = useState<PageAspects | null>(null);
  useEffect(() => {
    let p = aspectCache.get(book.id);
    if (!p) {
      p = fetchPageAspects(book).catch(() => ({}));
      aspectCache.set(book.id, p);
    }
    let alive = true;
    void p.then((x) => alive && setA(x));
    return () => {
      alive = false;
    };
  }, [book]);
  return a;
}

function useUnitCardCount(book: Book, unit: number): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    loadBookCards(book).then(
      (bc) => alive && setN(bc.byUnit.get(unit)?.length ?? 0),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [book, unit]);
  return n;
}

function RulePane({ br, unit, terms }: { br: BookRules; unit: number; terms: string[] }) {
  const { book, index } = br;
  const rule = br.rules.get(unit);
  const info = index.exercises[`u${unit}`];
  const group = index.groups.find((g) => g.units.includes(unit));
  const [asPage, setAsPage] = useState(!rule);
  const aspects = useAspects(book);
  const cards = useUnitCardCount(book, unit);
  const isMobile = useIsMobile();
  const bodyRef = useRef<HTMLDivElement>(null);

  // arriving from a search: bring the first highlighted word into view
  useEffect(() => {
    if (asPage || !terms.length) return;
    const t = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector(".hlmark");
      const vp = el?.closest<HTMLElement>("[data-overlayscrollbars-viewport]");
      if (!el || !vp) return;
      vp.scrollTop += el.getBoundingClientRect().top - vp.getBoundingClientRect().top - vp.clientHeight / 3;
    }, 60);
    return () => window.clearTimeout(t);
  }, [asPage, terms]);

  const head = (
    <div className="rulehead">
      {isMobile && (
        <a className="ruleback" href={rulesHash(book)}>
          <ArrowLeft size={16} aria-hidden /> All rules
        </a>
      )}
      <p className="libkicker">
        <span className="libdot" style={{ background: book.color }} aria-hidden />
        {book.level}
        {group ? ` · ${group.name}` : ""}
      </p>
      <h2 className="unitheading">
        Unit {unit} — {info?.title}
      </h2>
      <div className="rulelinks">
        <a className="pillbtn" href={bookHash(book, { kind: "unit", n: unit })}>
          <PencilLine size={15} aria-hidden /> Exercises
        </a>
        {cards !== 0 && (
          <a className="pillbtn" href={deckHash({ kind: "unit", book, unit })}>
            <Layers size={15} aria-hidden /> Cards{cards ? ` · ${cards}` : ""}
          </a>
        )}
        {rule && (
          <button
            type="button"
            className="pillbtn"
            onClick={() => setAsPage((v) => !v)}
            aria-pressed={asPage}
            title={asPage ? "Show the rule as text" : "Show the book page"}
          >
            {asPage ? <FileText size={15} aria-hidden /> : <Image size={15} aria-hidden />}
            {asPage ? "Text" : "Book page"}
          </button>
        )}
      </div>
    </div>
  );

  if (asPage || !rule) {
    const pages = info ? theoryPages(info.pages) : [];
    return (
      <div className="rulepane paged">
        <div className="rulecol headonly">{head}</div>
        <div className="rulepages">
          {aspects && pages.length > 0 && (
            <PageViewer
              pdfUrl={bookUrl(book, "book.pdf")}
              aspects={aspects}
              pdfPages={pages}
              focusTick={0}
              onPaneEscape={() => {}}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <OverlayScrollbarsComponent className="rulepane" options={OS_OPTIONS}>
      <div className="rulecol">
        {head}
        <article className="rulesheet" ref={bodyRef}>
          <RuleBody rule={rule} terms={terms} />
          {rule.r.length > 0 && <SeeAlso br={br} rule={rule} />}
        </article>
        <PickWord scope=".rulesheet" source={{ book: book.id, unit }} />
      </div>
    </OverlayScrollbarsComponent>
  );
}

function RuleBody({ rule, terms }: { rule: ParsedRule; terms: string[] }) {
  return (
    <>
      {rule.s.map((s, i) => (
        <section key={i} className="rulesection">
          {s.l && <span className="exid rulesec">{s.l}</span>}
          <div className="rulesecbody">{s.x.map((line, j) => renderLine(line, j, terms))}</div>
        </section>
      ))}
    </>
  );
}

function renderLine(line: RuleLine, key: number, terms: string[]): ReactNode {
  switch (line[0]) {
    case "h":
      return (
        <h3 key={key} className="rulesubhead">
          <Marked text={line[1]} terms={terms} />
        </h3>
      );
    case "t":
      return (
        <p key={key} className="ruleprose">
          <Marked text={line[1]} terms={terms} />
        </p>
      );
    case "e":
      return (
        <p key={key} className="ruleexample">
          <Marked text={line[1]} terms={terms} />
        </p>
      );
    case "c":
      return (
        <div key={key} className="rulecols" style={{ gridTemplateColumns: `repeat(${line[1].length}, minmax(min-content, 1fr))` }}>
          {line[1].map((c, k) => (
            <span key={k}>
              <Marked text={c} terms={terms} />
            </span>
          ))}
        </div>
      );
    case "b":
      return <div key={key} className="rulegap" aria-hidden />;
  }
}

function SeeAlso({ br, rule }: { br: BookRules; rule: ParsedRule }) {
  return (
    <footer className="rulerefs">
      <span className="rulerefs-label">See also</span>
      {rule.r.map((r, i) => (
        <span key={i} className="ruleref">
          {r.t}
          {r.u.length > 0 ? (
            r.u.map((n) => (
              <a key={n} className="chip refchip" href={rulesHash(br.book, n)} title={br.index.exercises[`u${n}`]?.title}>
                {n}
              </a>
            ))
          ) : (
            <span className="refto">{r.to}</span>
          )}
        </span>
      ))}
    </footer>
  );
}
