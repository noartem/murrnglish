// Home: the "/#/ landing. The hero is the actual book cover (page 1 of the
// same PDF the viewer renders) with a one-paragraph description and a single
// call to action beside it on desktop (stacked and centered on phones). The
// cover is a real button mirroring the CTA — same action, mouse or keyboard.
// Learners with saved progress get the CTA corrected to "Continue with …"
// pointing where they left off; Progress numbers live in the topbar, the
// unit list behind the hamburger on content pages — the landing stays
// quiet. Scrolling is OverlayScrollbars, like every other pane.

import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

/** Where a learner with saved progress should resume; null = fresh start. */
export interface HomeContinue {
  hash: string;
  label: string;
}

export function Home({
  onStart,
  continueTo,
}: {
  onStart: () => void;
  continueTo: HomeContinue | null;
}) {
  return (
    <OverlayScrollbarsComponent
      element="main"
      className="home"
      options={{
        overflow: { x: "hidden" },
        scrollbars: {
          theme: "os-theme-dark",
          autoHide: "leave",
          autoHideDelay: 500,
        },
      }}
    >
      <div className="homecol">
        <button type="button" className="homecoverbtn" onClick={onStart}>
          <img
            className="homecover"
            src={`${import.meta.env.BASE_URL}cover.jpg`}
            alt="Cover of Essential Grammar in Use, Russian edition, by Raymond Murphy with Olga Sands"
            width={1112}
            height={1653}
            decoding="async"
            draggable={false}
          />
        </button>
        <div className="hometext">
          <p className="homedesc">
            Raymond Murphy’s <em>Essential Grammar in Use</em> (Russian edition)
            as an interactive web course: the book’s pages with exercises beside
            them, answers checked as you go, progress saved in this browser. 115
            units and 35 additional exercises.
          </p>
          <button type="button" className="homecta" onClick={onStart}>
            {continueTo ? (
              <>
                <s>Start with Unit 1</s> {continueTo.label}
              </>
            ) : (
              "Start with Unit 1"
            )}
          </button>
          <footer className="homecredit">
            Web edition by{" "}
            <a href="https://noartem.ru" rel="me noopener" target="_blank">
              Artem Noskov
            </a>
            <br />
            From the book by Raymond Murphy with Olga Sands (Cambridge
            University Press)
          </footer>
        </div>
      </div>
    </OverlayScrollbarsComponent>
  );
}
