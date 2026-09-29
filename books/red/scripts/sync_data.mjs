// Copy data/ -> app/public/data/ so both dev and build serve the same files,
// and pack the per-exercise JSON into one course.json. Run before
// `npm run dev` / `npm run build` (see package.json predev/prebuild hooks).
//
// Why the pack: the offline download used to pull all 145 unit files and all
// 41 additional files one by one — ~190 requests for 1.4 MB. course.json is
// that same data in a single request, and it gives the app a second source to
// read from when a per-unit fetch fails offline (app/src/data.ts loadBundle).
// Generated here rather than committed, so it cannot drift from data/ — the
// per-file JSON stays the source of truth.

import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "data");
const dest = join(root, "app", "public", "data");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

// unit-001.json -> "1", 07.json -> "7" (the keys the fetchers ask for)
const read = (dir, file) => JSON.parse(readFileSync(join(src, dir, file), "utf8"));
const pick = (dir, re) => {
  const out = {};
  for (const f of readdirSync(join(src, dir))) {
    const m = re.exec(f);
    if (m) out[String(Number(m[1]))] = read(dir, f);
  }
  return out;
};

const bundle = {
  units: pick("units", /^unit-(\d+)\.json$/),
  additional: pick("additional", /^(\d+)\.json$/),
};
const units = Object.keys(bundle.units).length;
const additional = Object.keys(bundle.additional).length;
if (!units || !additional) {
  throw new Error(`empty course bundle: ${units} units, ${additional} additional`);
}
writeFileSync(join(dest, "course.json"), JSON.stringify(bundle));

console.log(
  `synced data/ -> app/public/data/ (+ course.json: ${units} units, ${additional} additional)`,
);
