// Home: the "/#/ landing. The hero is the actual book cover (page 1 of the
// same PDF the viewer renders) with a one-paragraph description and a single
// call to action beside it on desktop (stacked and centered on phones).
// Progress numbers live in the topbar, the unit list behind the hamburger on
// content pages — the landing stays quiet. Scrolling is OverlayScrollbars,
// like every other pane.

import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

export function Home({ onStart }: { onStart: () => void }) {
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
        {/* focusable so keyboard users get the same tip-over as hover */}
        <img
          className="homecover"
          src={`${import.meta.env.BASE_URL}cover.png`}
          alt="Cover of English Grammar in Use, Fifth Edition, by Raymond Murphy"
          width={1112}
          height={1497}
          decoding="async"
          tabIndex={0}
        />
        <div className="hometext">
          <p className="homedesc">
            Raymond Murphy’s <em>English Grammar in Use</em> (Fifth edition) as
            an interactive web course: the book’s pages with exercises beside
            them, answers checked as you go, progress saved in this browser. 145
            units and 41 additional exercises.
          </p>
          <button type="button" className="homecta" onClick={onStart}>
            Start with Unit 1
          </button>
          <footer className="homecredit">
            Web edition by{" "}
            <a href="https://noartem.ru" rel="me noopener" target="_blank">
              Artem Noskov
            </a>
            <br />
            From the book by Raymond Murphy (Cambridge University Press)
          </footer>
        </div>
      </div>
    </OverlayScrollbarsComponent>
  );
}
