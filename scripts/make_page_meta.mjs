// Bake every page's height/width ratio of books/<id>/book.pdf into
// books/<id>/data/pages.json. The page viewer sizes its placeholders from it,
// so pages that are still loading already take their real height.
//
// Run after replacing a book's PDF:  node scripts/make_page_meta.mjs <id> [<id> ...]
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("usage: node scripts/make_page_meta.mjs <book id> [...]");
  process.exit(2);
}

// pdfjs-dist v4 legacy build is ESM-only; import it from node_modules
const pdfjs = await import(
  pathToFileURL(path.join(root, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")).href
);

for (const id of ids) {
  const book = path.join(root, "books", id);
  const data = new Uint8Array(fs.readFileSync(path.join(book, "book.pdf")));
  const doc = await pdfjs.getDocument({ data }).promise;

  const out = {};
  for (let p = 1; p <= doc.numPages; p++) {
    const v = (await doc.getPage(p)).getViewport({ scale: 1 });
    out[p] = Number((v.height / v.width).toFixed(5));
  }

  fs.writeFileSync(path.join(book, "data", "pages.json"), JSON.stringify(out) + "\n");
  console.log(`${id}: wrote ${doc.numPages} page aspects`);
}
