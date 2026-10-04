// The topbar of the sections that are not a book (cards, dictionary):
// the library crumb, the section's title, and the switch between the two
// sections — in the topbar on desktop, as a row of tabs under it on phones
// (the phone topbar keeps the title alone, like a book's). The cards tab
// carries the number of cards due, so it is visible from every section.
// Every section that renders this bar gets the app-wide help and data
// buttons, so neither view has to add them itself.

import type { ReactNode } from "react";
import { Download, Layers, LibraryBig, NotebookPen } from "lucide-react";
import { useDueCount } from "../dueCount";
import { openGlobal } from "../globalUi";
import { CARDS_HASH, DICTIONARY_HASH } from "../routes";
import { SC } from "../shortcuts";
import { useIsMobile } from "../useIsMobile";
import { ShortcutsHelpButton } from "./ShortcutsHelp";
import { ThemeToggle } from "./ThemeToggle";

export type Section = "cards" | "dictionary";

export function SectionBar({
  section,
  title,
  actions,
}: {
  section: Section;
  /** the h1; defaults to the section's name */
  title?: ReactNode;
  /** extra topbar buttons before the theme toggle (desktop) */
  actions?: ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <>
      <header className="topbar">
        <div className="topbar-mid">
          <a className="topbar-lib keep" href="#/" title="All books">
            <LibraryBig size={17} aria-hidden />
            <span>Murrnglish</span>
          </a>
          <span className="topbar-crumbsep" aria-hidden>
            /
          </span>
          <h1 className="sectiontitle">{title ?? SECTION_NAME[section]}</h1>
        </div>
        {!isMobile && <SectionTabs section={section} />}
        <div className="topbar-actions">
          {!isMobile && (
            <>
              {actions}
              <ShortcutsHelpButton onOpen={() => openGlobal("help")} />
              <button
                className="themebtn"
                data-global-btn="data"
                onClick={() => openGlobal("data")}
                title={"Data — export, import, share — " + SC.data}
                aria-label="Data: export, import, share"
              >
                <Download size={15} aria-hidden />
              </button>
            </>
          )}
          <ThemeToggle />
        </div>
      </header>
      {isMobile && <SectionTabs section={section} />}
    </>
  );
}

const SECTION_NAME: Record<Section, string> = {
  cards: "Cards",
  dictionary: "Dictionary",
};

function SectionTabs({ section }: { section: Section }) {
  const due = useDueCount();
  const tab = (s: Section, href: string, icon: ReactNode, badge?: number) => (
    <a
      className={"sectiontab" + (s === section ? " on" : "")}
      href={href}
      aria-current={s === section ? "page" : undefined}
    >
      {icon}
      <span>{SECTION_NAME[s]}</span>
      {badge ? (
        <span className="duebadge" title={`${badge} due today`}>
          {badge}
        </span>
      ) : null}
    </a>
  );
  return (
    <nav className="sectiontabs" aria-label="Sections">
      {tab("cards", CARDS_HASH, <Layers size={16} aria-hidden />, due)}
      {tab("dictionary", DICTIONARY_HASH, <NotebookPen size={16} aria-hidden />)}
    </nav>
  );
}
