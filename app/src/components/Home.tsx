// Home: the "/#/ landing. The hero is the actual book cover (page 1 of the
// same PDF the viewer renders), centered, with a one-paragraph description
// and a single call to action. Progress numbers live in the topbar, the
// unit list behind the hamburger on content pages — the landing stays quiet.

export function Home({ onStart }: { onStart: () => void }) {
  return (
    <main className="home">
      <div className="homecol">
        <img
          className="homecover"
          src={`${import.meta.env.BASE_URL}cover.png`}
          alt="Cover of English Grammar in Use, Fifth Edition, by Raymond Murphy"
          width={1112}
          height={1497}
          decoding="async"
        />
        <p className="homedesc">
          Raymond Murphy’s <em>English Grammar in Use</em> (Fifth edition) as an
          interactive web course: the book’s pages with exercises beside them,
          answers checked as you go, progress saved in this browser. 145 units
          and 41 additional exercises.
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
    </main>
  );
}
