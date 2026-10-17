// Front-end build. `tgcloud push` uploads the static folder as it is on disk and
// never builds it, so this assembles `dist/` first (npm run deploy does both).
//
//   dist/index.html, dist/app.css, dist/app.js   the public student Mini App (host root)
//   dist/setup/*                                 the protected cooperation/admin console
//
// Only these files are ever copied: no sources outside web/ and setup/, no config,
// no secrets.
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const OUTPUT = [
  ['web/index.html', 'dist/index.html'],
  ['web/app.css', 'dist/app.css'],
  ['web/app.js', 'dist/app.js'],
  ['setup/index.html', 'dist/setup/index.html'],
  ['setup/setup.css', 'dist/setup/setup.css'],
  ['setup/setup.js', 'dist/setup/setup.js'],
];

async function count(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) total += await count(new URL(entry.name + '/', dir));
    else total++;
  }
  return total;
}

await rm(dist, { recursive: true, force: true });
for (const [from, to] of OUTPUT) {
  const target = new URL(to, root);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(from, root), target);
  if (process.argv.includes('--verbose')) console.log(`${from} → ${to}`);
}
const files = await count(dist);
console.log(`Front-end built: ${files} files in dist/ (student app at /, console at /setup/).`);
if (files !== OUTPUT.length) throw new Error(`unexpected dist contents: ${files} files`);
