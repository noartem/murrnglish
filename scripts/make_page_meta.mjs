import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// pdfjs-dist v4 legacy build is ESM-only; import it from app's node_modules
const pdfjs = await import(
  pathToFileURL(path.join(root, "app", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")).href
);

const data = new Uint8Array(fs.readFileSync(path.join(root, "app", "public", "book.pdf")));
const doc = await pdfjs.getDocument({ data }).promise;

const out = {};
for (let p = 1; p <= doc.numPages; p++) {
  const v = (await doc.getPage(p)).getViewport({ scale: 1 });
  out[p] = Number((v.height / v.width).toFixed(5));
}

fs.writeFileSync(
  path.join(root, "app", "src", "pages-meta.json"),
  JSON.stringify(out) + "\n",
);
console.log(`wrote ${doc.numPages} page aspects`);
