import { readdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../tgcloud/', import.meta.url);
const sources = {};
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) await collect(new URL(entry.name + '/', dir), name + '/');
    else if (name.endsWith('.js')) sources[name.slice(0, -3)] = await readFile(new URL(entry.name, dir), 'utf8');
  }
}
await collect(root);
await writeFile(new URL('./sources.json', import.meta.url), JSON.stringify(sources));
console.log(`Bundled ${Object.keys(sources).length} Telegram modules (no CLI state).`);
