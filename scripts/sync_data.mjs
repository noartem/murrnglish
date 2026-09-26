// Copy data/ -> app/public/data/ so both dev and build serve the same files.
// Run before `npm run dev` / `npm run build` (see package.json predev/prebuild hooks).

import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "data");
const dest = join(root, "app", "public", "data");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("synced data/ -> app/public/data/");
