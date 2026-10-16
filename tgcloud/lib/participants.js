import { tree, nodes, nodeText } from './content.js';

// Only retain names from rows whose role cell explicitly says استاد.
// Other participant information is neither returned nor persisted.
export function participantProfessors(html) {
  const doc = tree(html);
  const table = nodes(doc, n => n.tag === 'table' && n.attrs.id === 'participants')[0];
  if (!table) throw new Error('PARTICIPANTS_LAYOUT');
  const names = [];
  for (const row of nodes(table, n => n.tag === 'tr')) {
    const role = nodes(row, n => ['td', 'th'].includes(n.tag) && /(?:^|\s)c2(?:\s|$)/.test(n.attrs.class ?? ''))[0];
    if (!role || nodeText(role) !== 'استاد') continue;
    const cell = nodes(row, n => ['td', 'th'].includes(n.tag) && /(?:^|\s)c1(?:\s|$)/.test(n.attrs.class ?? ''))[0];
    const link = cell && nodes(cell, n => n.tag === 'a' && /\/user\/(?:view|profile)\.php\?/.test(n.attrs.href ?? ''))[0];
    if (!link) continue;
    const text = n => typeof n === 'string' ? n :
      (n.attrs.role === 'img' || /(?:^|\s)accesshide(?:\s|$)/.test(n.attrs.class ?? '') ? '' : n.children.map(text).join(' '));
    const name = text(link).replace(/\s+/g, ' ').trim().slice(0, 100);
    if (name) names.push(name);
  }
  const pages = nodes(doc, n => n.tag === 'a' && /\/user\/index\.php\?/.test(n.attrs.href ?? ''))
    .map(n => Number((n.attrs.href.match(/[?&]page=(\d+)/) ?? [])[1]))
    .filter(n => Number.isSafeInteger(n) && n > 0);
  return { names: [...new Set(names)], pages: [...new Set(pages)] };
}
