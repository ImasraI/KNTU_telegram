// Front-end build. `tgcloud push` uploads the static folder as it is on disk and
// never builds it, so this assembles `dist/` first (npm run deploy does both).
//
//   dist/index.html, dist/app.css, dist/app.js   the public student Mini App (host root)
//   dist/setup/*                                 the protected cooperation/admin console
//
// Only these files are ever copied: no sources outside web/ and setup/, no config,
// no secrets. `--out <dir>` writes the same layout somewhere else, which lets the
// UI test build a private copy instead of racing the other tests over dist/.
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
if (outIndex !== -1 && !args[outIndex + 1]) throw new Error('--out needs a directory');
const outLabel = outIndex === -1 ? 'dist' : args[outIndex + 1];

// The output folder is emptied before writing, so refuse anything that is not a
// dedicated directory: a drive root, a home, or the shared temp folder itself.
const outPath = outIndex === -1 ? null : resolve(outLabel);
if (outPath) {
  if (!basename(outPath) || outPath === resolve(outPath, '..')) throw new Error(`--out needs a directory of its own, not ${outPath}`);
  for (const shared of [homedir(), tmpdir()]) if (outPath === resolve(shared)) throw new Error(`refusing to empty the shared folder ${outPath}`);
}
// The trailing separator matters: `new URL('./', url)` walks up to the parent.
const dist = outPath ? pathToFileURL(outPath + sep) : new URL('dist/', root);

const OUTPUT = [
  ['web/index.html', 'index.html'],
  ['web/app.css', 'app.css'],
  ['web/app.js', 'app.js'],
  ['setup/index.html', 'setup/index.html'],
  ['setup/setup.css', 'setup/setup.css'],
  ['setup/setup.js', 'setup/setup.js'],
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
  const target = new URL(to, dist);
  await mkdir(new URL('./', target), { recursive: true });
  await copyFile(new URL(from, root), target);
  if (process.argv.includes('--verbose')) console.log(`${from} → ${outLabel}/${to}`);
}
const files = await count(dist);
console.log(`Front-end built: ${files} files in ${outLabel} (student app at /, console at /setup/).`);
if (files !== OUTPUT.length) throw new Error(`unexpected output contents: ${files} files`);
