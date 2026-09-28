import fs from "fs";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(fs.readFileSync("public/book.pdf"));
const doc = await pdfjs.getDocument({ data }).promise;
console.log("pages:", doc.numPages);
for (const p of [1, 2, 120, 300, doc.numPages]) {
  const v = (await doc.getPage(p)).getViewport({ scale: 1 });
  console.log(p, v.width, v.height, "ratio", (v.height / v.width).toFixed(5));
}
