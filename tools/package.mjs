// Creates dist/quicktext-lite-<version>.xpi (npm run package).

import { zipSync } from "fflate";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const INCLUDE = [
  "manifest.json",
  "background.js",
  "menus.js",
  "LICENSE",
  "compose",
  "lib",
  "popup",
  "manager",
  "vendor",
  "_locales",
  "icons",
];
// Fixed timestamp, so the same sources always give the same file.
const MTIME = new Date("2026-01-01T00:00:00Z");

async function collect(path, files) {
  const info = await stat(path);
  if (info.isDirectory()) {
    for (const name of (await readdir(path)).sort()) {
      if (!name.startsWith(".")) await collect(join(path, name), files);
    }
  } else {
    files[relative(root, path).split(sep).join("/")] = [new Uint8Array(await readFile(path)), { mtime: MTIME }];
  }
}

const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const files = {};
for (const entry of INCLUDE) await collect(join(root, entry), files);
if (!files["vendor/codemirror.js"]) throw new Error("vendor/codemirror.js is missing: run npm run build:vendor");

await mkdir(join(root, "dist"), { recursive: true });
const output = join(root, "dist", `quicktext-lite-${manifest.version}.xpi`);
// The installer may still hold an open ZIP reader for the previous package.
// Replace the file atomically instead of truncating it under that reader.
const temporary = `${output}.${process.pid}.tmp`;
await writeFile(temporary, zipSync(files, { level: 9 }));
await rename(temporary, output);
console.log(`${relative(root, output)}: ${Object.keys(files).length} files`);
