import { DIGEST_MAX_ITEMS } from './config.js';
import { courseTitle } from './classes.js';

export function decode(s) {
  return String(s ?? '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (e[0] !== '#') return named[e.toLowerCase()];
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
export function plain(s) {
  return decode(String(s ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
export function safeLink(value, base) {
  const s = decode(value);
  const full = s.startsWith('/') && !s.startsWith('//') ? base + s : s;
  if (!full.startsWith(base + '/')) return null;
  if (/[?&](?:token|wstoken|sesskey|password)=/i.test(full)) return null;
  return full;
}
export function signature(item) {
  return JSON.stringify([item.name, item.kind, item.description, item.dates, item.files]);
}
export const KIND_LABELS = { assign: '📝 تکلیف', quiz: '🗓 آزمون', resource: '📄 فایل', folder: '📁 پوشه', forum: '📢 اطلاعیه', page: '📃 مطلب', book: '📖 کتاب', label: '🏷 برچسب' };
export function kindLabel(kind) {
  return KIND_LABELS[kind] ?? '📚 فعالیت';
}

// Accounts differ in what Moodle renders for them (group/visibility
// restrictions). A version that lost information compared with the baseline is
// therefore not treated as an announcement-worthy change.
export function isNarrower(previous, next) {
  if (!previous || !next) return false;
  for (const field of ['name', 'description', 'dates']) {
    if (previous[field] && !next[field]) return true;
  }
  return (previous.files?.length ?? 0) > (next.files?.length ?? 0);
}

// Keeps the richer of two observations, so switching between accounts does not
// make the baseline flap between a full and a reduced view of the same activity.
export function mergeBaseline(previous, current) {
  if (!Array.isArray(previous)) return current;
  const old = new Map(previous.map(x => [x.id, x]));
  return current.map(item => {
    const prev = old.get(item.id);
    if (!prev || !isNarrower(prev, item)) return item;
    return { ...item,
      name: item.name || prev.name,
      description: item.description || prev.description,
      dates: item.dates || prev.dates,
      files: (item.files?.length ?? 0) >= (prev.files?.length ?? 0) ? item.files : prev.files,
    };
  });
}
// Splits detected differences into what gets announced and what is only absorbed.
// An "updated" event that merely drops information (missing dates, description or
// fewer attachments) is what a less privileged account sees for the same
// activity, so announcing it would be a false update. New items always announce.
function detected(previous, current) {
  const old = new Map(previous.map(x => [x.id, signature(x)]));
  return current.filter(x => old.get(x.id) !== signature(x))
    .map(x => ({ ...x, change: old.has(x.id) ? 'updated' : 'new' }));
}
// `current` is the baseline to compare (already merged with the richer view),
// `raw` is what the reader actually returned this round — the difference between
// the two is what got absorbed instead of announced.
export function changeSet(previous, current, raw = current) {
  const narrower = x => x.change === 'updated' && isNarrower(previous.find(p => p.id === x.id), x);
  return {
    announce: detected(previous, current).filter(x => !narrower(x)),
    absorbed: detected(previous, raw).filter(narrower).length,
  };
}
export function changes(previous, current, raw) {
  return changeSet(previous, current, raw).announce;
}
export function notification(course, item, options = {}) {
  return [`${item.change === 'updated' ? 'به‌روزرسانی' : 'مورد جدید'} — ${kindLabel(item.kind)}`,
    // Which class/professor/time this belongs to, so a student can tell whether the
    // activity is for their class. Kept near the top so truncation never hides it.
    options.classLine,
    courseTitle(course.fullname), item.name, item.dates, item.description?.slice(0, 1600),
    item.files?.length ? 'پیوست‌ها: ' + item.files.map(f => f.name).join('، ').slice(0, 600) : '',
    item.url].filter(Boolean).join('\n').slice(0, 4000);
}
// Owner-only initial digest for a newly discovered course: what already exists in
// it, so a late-added account's enrollment can be announced once on purpose.
export function digest(course, items, maxItems = DIGEST_MAX_ITEMS, options = {}) {
  const list = (items ?? []).slice(0, maxItems);
  const total = items?.length ?? 0;
  return [`📚 نمای اولیه — ${courseTitle(course.fullname)}`,
    options.classLine,
    `${total} فعالیت پیش‌تر در این دوره ثبت شده است.`,
    ...list.map(x => `• ${kindLabel(x.kind)} ${x.name}${x.dates ? `\n${x.dates}` : ''}`),
    total > list.length ? `…و ${total - list.length} مورد دیگر.` : '',
    'از این پس فقط موارد جدید و تغییرات اطلاع‌رسانی می‌شوند.'].filter(Boolean).join('\n').slice(0, 4000);
}

// The "My courses" sidebar lists each enrolled course with its full 13-digit code
// (`آز فيزيك2 [4051-1110274-23]`) even though the course's own name only carries the
// group code (`[4051]`). One page therefore yields an authoritative id → code map,
// which is how a class gets its number without the owner typing it.
export function extractEnrollmentCodes(html) {
  const doc = tree(html);
  const found = {};
  for (const link of nodes(doc, n => n.tag === 'a' && /\/course\/view\.php\?id=\d+/.test(n.attrs.href ?? ''))) {
    const id = Number((link.attrs.href.match(/id=(\d+)/) ?? [])[1]);
    // Normalise digits first: Moodle renders ۴۰۵۱ and JS `\d` matches ASCII only.
    const ascii = normalizeDigits(nodeText(link));
    if (!id || !/\d{1,4}\s*-\s*\d{7}\s*-\s*\d{1,4}/.test(ascii)) continue;
    const code = toCourseCode(ascii);
    if (!code) continue;
    found[id] = { code, name: ascii.replace(/\s*\[?\s*\d[\d\s-]*\]?\s*$/, '').trim().slice(0, 120) };
  }
  return found;
}

function toCourseCode(text) {
  const match = normalizeDigits(text).match(/(\d{1,4})\s*-\s*(\d{7})\s*-\s*(\d{1,4})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
function normalizeDigits(text) {
  return String(text ?? '')
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660));
}

// Evidence gathering for the class/professor directory: what the student-visible
// course page itself exposes. The site prints the 13-digit code in the course name
// and (in the pages checked publicly) never the professor, so teacher candidates
// come only from teacher-marked markup when the site happens to render it.
export function extractCourseMeta(html) {
  const text = plain(html);
  const codes = [...new Set(text.match(/\d{1,4}\s*-\s*\d{7}\s*-\s*\d{1,4}/g) ?? [])].map(s => s.replace(/\s/g, '')).slice(0, 5);
  const doc = tree(html);
  // Which page did we actually get? A course page must self-identify, otherwise a
  // code found here may belong to a course list/block rather than this course.
  const bodyId = nodes(doc, n => n.tag === 'body')[0]?.attrs.id ?? null;
  const pageTitle = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const codeContexts = [];
  for (const match of text.matchAll(/\d{1,4}\s*-\s*\d{7}\s*-\s*\d{1,4}/g)) {
    codeContexts.push({ code: match[0].replace(/\s/g, ''), near: text.slice(Math.max(0, match.index - 60), match.index).replace(/\s+/g, ' ').trim().slice(-60) });
    if (codeContexts.length >= 5) break;
  }
  const marked = nodes(doc, n => /teacher|instructor|course-?contact|مدرس|استاد/i.test(`${n.attrs.class ?? ''} ${n.attrs.id ?? ''} ${n.attrs['data-region'] ?? ''}`));
  const teachers = [...new Set(marked.map(nodeText).filter(Boolean))].slice(0, 10);
  const userLinks = nodes(doc, n => n.tag === 'a' && /\/user\/view\.php\?id=\d+/.test(n.attrs.href ?? ''))
    .map(nodeText).filter(t => t && !/^(پروفایل|profile)$/i.test(t));
  const header = nodes(doc, n => `${n.attrs.class ?? ''} ${n.attrs.id ?? ''}`.includes('page-header-headings')).map(nodeText).join(' ');
  return {
    codes, codeContexts, teachers, bodyId, pageTitle,
    userLinkNames: [...new Set(userLinks)].slice(0, 12),
    header: header.replace(/\s+/g, ' ').slice(0, 200),
  };
}
// Minimal HTML tree for Moodle's rendered modules; no npm packages at runtime.
export function tree(html) {
  const root = { tag: '', attrs: {}, children: [] }; const stack = [root];
  const source = html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi, '');
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const token of source.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (!token.startsWith('<')) { stack.at(-1).children.push(decode(token)); continue; }
    const close = token.match(/^<\/([\w-]+)/);
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === close[1].toLowerCase()) { stack.length = i; break; }
      continue;
    }
    const match = token.match(/^<([\w-]+)/); if (!match) continue;
    const node = { tag: match[1].toLowerCase(), attrs: {}, children: [] };
    for (const a of token.slice(match[0].length).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    stack.at(-1).children.push(node);
    if (!voids.has(node.tag) && !token.endsWith('/>')) stack.push(node);
  }
  return root;
}
export function nodes(node, predicate) {
  if (typeof node === 'string') return [];
  return [...(predicate(node) ? [node] : []), ...node.children.flatMap(n => nodes(n, predicate))];
}
export function nodeText(node) {
  return (typeof node === 'string' ? node : node.children.map(nodeText).join(' ')).replace(/\s+/g, ' ').trim();
}
const hasClass = (n, c) => (n.attrs.class ?? '').split(/\s+/).includes(c);
export function parseCourse(html, base) {
  const doc = tree(html);
  if (!nodes(doc, n => /^page-course-view-/.test(n.attrs.id ?? '')).length) throw new Error('COURSE_LAYOUT');
  return nodes(doc, n => /^module-\d+$/.test(n.attrs.id ?? '')).flatMap(n => {
    const link = nodes(n, x => x.tag === 'a' && /\/mod\/\w+\/view\.php\?id=\d+/.test(x.attrs.href ?? ''))[0];
    if (!link) return [];
    const url = safeLink(link.attrs.href, base); if (!url) return [];
    const kind = url.match(/\/mod\/(\w+)\//)[1];
    if (!['assign', 'quiz', 'resource', 'folder', 'forum', 'page', 'book'].includes(kind)) return [];
    const nameNode = nodes(link, x => hasClass(x, 'instancename'))[0];
    const name = nodeText(nameNode ?? link).replace(/\s+(تکلیف|فایل|تالار گفتگو|آزمون|پوشه|صفحه)$/, '');
    return [{ id: Number(n.attrs.id.slice(7)), kind, name, url,
      description: nodes(n, x => hasClass(x, 'activity-description')).map(nodeText).join(' '),
      dates: nodes(n, x => x.attrs['data-region'] === 'activity-dates').map(nodeText).join(' '), files: [] }];
  });
}
export function parseAssignment(html, base) {
  const doc = tree(html);
  if (!nodes(doc, n => n.attrs.id === 'page-mod-assign-view').length) throw new Error('ASSIGNMENT_LAYOUT');
  return nodes(doc, n => n.tag === 'a' && /\/pluginfile\.php\//.test(n.attrs.href ?? '')).flatMap(n => {
    const url = safeLink(n.attrs.href, base);
    return url && /\/mod_assign\/introattachment\//.test(url) ? [{ name: nodeText(n), url }] : [];
  }).sort((a, b) => a.url.localeCompare(b.url));
}
