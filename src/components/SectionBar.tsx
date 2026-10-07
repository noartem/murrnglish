// The shell of the sections that are not a book (cards, dictionary): the
// library crumb, the section's title, and its own page. The switch between
// the sections is not here any more — the navigation panel carries both, on
// every screen, so a phone reaches them from its hamburger like a desktop
// reaches them from the panel beside the page.
//
// The bar, the navigation panel and the theme all come from the app shell
// now, so a section only says what is its own: its title and its page. The
// download is the shell's own business too — in the installed app every page
// carries it, a section reaching the same panel as the library does.

import { useState } from "react";
import type { ReactNode } from "react";
import { AppCrumb, AppShell } from "./AppShell";
import { OfflineButton } from "./OfflineButton";
import { OfflinePanel } from "./OfflinePanel";
import { isStandalone } from "../offline";

export type Section = "cards" | "dictionary";

const SECTION_NAME: Record<Section, string> = {
  cards: "Cards",
  dictionary: "Dictionary",
};

/** The shell around a section's page. */
export function SectionShell({
  section,
  title,
  children,
}: {
  section: Section;
  /** the h1; defaults to the section's name */
  title?: ReactNode;
  children: ReactNode;
}) {
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [standalone] = useState(isStandalone);
  return (
    <AppShell
      head={<AppCrumb section={String(title ?? SECTION_NAME[section])} />}
      navActions={standalone ? <OfflineButton onOpen={() => setOfflineOpen(true)} /> : undefined}
      topbarActions={
        standalone ? <OfflineButton onOpen={() => setOfflineOpen(true)} variant="bar" /> : undefined
      }
    >
      {children}
      <OfflinePanel open={offlineOpen} onClose={() => setOfflineOpen(false)} />
    </AppShell>
  );
}
