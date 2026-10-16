import assert from 'node:assert/strict';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../tgcloud/', import.meta.url);
const records = new Map(), snapshotRows = new Map(), messages = [];
const subTable = { name: 'subscriptions', tgId: 'tgId' }, snapTable = { name: 'snapshots', key: 'key' };
const store = table => table.name === 'subscriptions' ? records : snapshotRows;
const db = {
  async run() { return { rowsAffected: 1 }; },
  select() {
    let table, condition;
    return { from(t) { table = t; return this; }, where(c) { condition = c; return this; },
      async get() { return structuredClone([...store(table).values()].find(row => row[condition.column] === condition.value)); },
      async all() { return structuredClone([...store(table).values()]); } };
  },
  insert(table) {
    let row, conflict;
    return { values(v) { row = structuredClone(v); return this; }, onConflictDoUpdate(v) { conflict = v; return this; },
      async run() { const s = store(table), key = row.tgId ?? row.key; s.set(key, s.has(key) ? { ...s.get(key), ...structuredClone(conflict.set) } : row); } };
  },
  update(table) {
    let patch, condition;
    return { set(p) { patch = p; return this; }, where(c) { condition = c; return this; }, async run() {
      for (const [key, row] of store(table)) if (row[condition.column] === condition.value) store(table).set(key, { ...row, ...structuredClone(patch) });
    } };
  },
  delete(table) { let condition; return { where(c) { condition = c; return this; }, async run() {
    for (const [key, row] of store(table)) if (row[condition.column] === condition.value) store(table).delete(key);
  } }; },
};
const course = { id: 3, fullname: 'ریاضی [4051]' };
const item = { id: 9, name: 'تکلیف', kind: 'assign', files: [], dates: 'جمعه', description: '' };
snapshotRows.set('https://vc.kntu.ac.ir#3', { key: 'https://vc.kntu.ac.ir#3', value: [item] });
let failPrivate = false, universityRequests = 0;
const api = { async sendMessage(input) {
  if (failPrivate && input.chat_id === 123) throw { code: 500 };
  messages.push(structuredClone(input)); return { message_id: messages.length };
} };
const context = createContext({ console, Date, Map, Set, Number, String, JSON, Math });
const modules = new Map();
const privateSettings = new Map();
const overrides = new Map([
  ['sdk', { db, api, fetch: async (url, options) => {
    universityRequests++;
    assert.ok(url.includes('/user/index.php?id=3'));
    assert.equal(options.headers.Cookie, 'MoodleSession=TEST');
    return { ok: true, text: async () => '<table id="participants"><tr><th class="c1"><a href="/user/view.php?id=42&amp;course=3">Student Name</a></th><td class="c2">شاگرد</td></tr></table>' };
  } }],
  ['sdk/db', { eq: (column, value) => ({ column, value }), sql: () => ({}) }],
  [new URL('schema.js', root).href, { subscriptions: subTable, snapshots: snapTable }],
  [new URL('lib/accounts.js', root).href, { enabledAccounts: async () => [{ id: 'acc_a', mode: 'session', secret: 'TEST' }] }],
  [new URL('lib/settings.js', root).href, { getSetting: async key => key === 'courses' ? [course] : privateSettings.get(key), putSetting: async (key,value) => privateSettings.set(key,value) }],
  [new URL('lib/monitor.js', root).href, { directorySummary: async () => ({ courses: [{ id: 3, name: 'ریاضی', line: '🏫 کلاس 11' }] }) }],
]);
async function load(id) {
  if (modules.has(id)) return modules.get(id);
  let mod;
  if (overrides.has(id)) {
    const exports = overrides.get(id);
    mod = new SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context, identifier: id });
  } else {
    mod = new SourceTextModule(await readFile(fileURLToPath(id), 'utf8'), { context, identifier: id });
  }
  modules.set(id, mod);
  return mod;
}
const entry = await load(new URL('lib/public-bot.js', root).href);
await entry.link((specifier, parent) => load(specifier.startsWith('.') ? new URL(specifier, parent.identifier).href : specifier));
await entry.evaluate();
const { handlePublic } = entry.namespace;
const sub = modules.get(new URL('lib/subscriptions.js', root).href).namespace;
const policy = modules.get(new URL('lib/student-policy.js', root).href).namespace;
const send = async text => handlePublic({ chat: { id: 123, type: 'private' }, from: { id: 123 }, text }, 'none');

for (const command of ['/start', '/help', '/courses', '/assignment', '/assignments', '/exams']) assert.equal(await send(command), true);
// A private /start offers the public student Mini App as a button (the cooperation
// form stays behind /setup, so the button must point at the app root).
await send('/start');
const appButton = messages.at(-1).reply_markup?.inline_keyboard?.[0]?.[0];
assert.ok(appButton?.web_app?.url, 'private /start offers a Mini App button');
assert.match(appButton.web_app.url, /^https:\/\/app\d+\.tgcloud\.ai\/$/);
assert.ok(!appButton.web_app.url.includes('/setup'));
assert.ok(messages.some(m => m.text.includes('تکلیف')));
assert.ok(messages.every(m => !m.text.includes('/approve') && !m.text.includes('/admin')));
assert.equal(await handlePublic({ chat: { id: -10, type: 'group' }, from: { id: 123 }, text: '/courses' }, 'none'), true);
// /register asks only for the displayed VC full name — no login-username stage.
await send('/register');
assert.equal(records.get(123).active, false);
assert.equal(records.get(123).profile.stage, 'name');
assert.equal(records.get(123).profile.username, null);
assert.ok(messages.at(-1).text.includes(policy.FULL_NAME_PROMPT));
assert.ok(messages.at(-1).text.includes('نام کامل در VC'));
assert.ok(!messages.some(m => /نام کاربری ورود به VC را بفرستید/.test(m.text)));
// /register <full name> registers directly, with no selection or confirmation step.
const beforeRegister = universityRequests;
await send('/register Student Name');
assert.ok(universityRequests > beforeRegister, 'chat registration starts the lookup immediately');
assert.equal(records.get(123).profile.lookupPending, false);
assert.deepEqual(records.get(123).profile.courses, ['3']);
assert.equal(records.get(123).profile.pending, null);
assert.equal(records.get(123).profile.participantId, '42');
assert.equal(records.get(123).active, true);
let result = await sub.deliverPersonal([course], () => '🏫 کلاس 11');
assert.equal(result.sent, 0); // Confirmation seeds the current snapshot.
snapshotRows.get('https://vc.kntu.ac.ir#3').value.push({ ...item, id: 10, name: 'تکلیف جدید' });
failPrivate = true;
assert.equal((await sub.deliverPersonal([course], () => '')).failed, 1);
failPrivate = false;
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 1);
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 0);
await send('/stop');
snapshotRows.get('https://vc.kntu.ac.ir#3').value.push({ ...item, id: 11 });
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 0);
await send('/resume');
assert.equal(records.get(123).active, true);
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 0); // No flood after pause.
await send('/forget');
assert.equal(records.has(123), false);
await sub.saveSubscriber(456, { active: true, profile: { confirmed: false, courses: ['3'] }, seen: {} });
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 0);
await sub.saveSubscriber(456, { active: true, profile: { confirmed: true, courses: ['82'] }, seen: {} });
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 0);
// Legacy /register + /cancel + /confirm compatibility (no username is collected now).
await send('/register');
await send('/cancel');
assert.equal(records.get(123).profile.pending, null);
await send('/confirm');
assert.equal(records.get(123).active, false);
records.clear();
await sub.saveSubscriber(123, { active: true, profile: { registered: true, confirmed: true, name: 'Student Name', participantId: '42', courses: [] }, seen: {} });
await sub.saveSubscriber(456, { active: false, profile: { registered: true, confirmed: true, paused: true, name: 'Student Name', participantId: '42', courses: [] }, seen: {} });
let rosterReads = 0;
const plan = [{ course, readers: ['acc_a'] }];
const coverage = await sub.refreshStudentCoverage(plan, { readRoster: async (_course, queries) => {
  rosterReads++; assert.equal(queries.length, 2); return [{ id: '42', name: 'Student Name' }];
} });
assert.equal(coverage.added, 2);
assert.equal(rosterReads, 1); // Read once for all students, not once per user.
assert.deepEqual(records.get(123).profile.courses, ['3']);
assert.deepEqual(records.get(456).profile.courses, ['3']);
assert.equal(records.get(456).active, false); // Coverage must not undo /stop.
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 0); // Seed existing items.
snapshotRows.get('https://vc.kntu.ac.ir#3').value.push({ ...item, id: 99 });
assert.equal((await sub.deliverPersonal([course], () => '')).sent, 1); // Active student only.
await sub.saveSubscriber(789, { active: true, profile: { registered: true, name: 'Same Name', participantId: '99', courses: [] }, seen: {} });
await sub.refreshStudentCoverage(plan, { readRoster: async () => [{ id: '100', name: 'Same Name' }] });
assert.deepEqual(records.get(789).profile.courses, []); // Known Moodle id prevents homonym matches.
// A user still waiting at the removed username stage is asked only for the full name.
await sub.saveSubscriber(321, { active: false, profile: { stage: 'username', username: 'legacy_login' }, seen: {} });
const legacySend = text => handlePublic({ chat: { id: 321, type: 'private' }, from: { id: 321 }, text }, 'none');
assert.equal(await legacySend('Student Name'), true);
assert.equal(records.get(321).profile.lookupPending, false);
await sub.refreshStudentCoverage(plan);
assert.deepEqual(records.get(321).profile.courses, ['3']);
assert.equal(records.get(321).profile.participantId, '42');
assert.equal(records.get(321).profile.username, null); // the old login name is dropped, not kept
assert.equal(records.get(321).active, true);
// Homonyms across distinct courses must not be merged into one student's profile.
await sub.registerStudent(900, 'Shared Name');
await sub.refreshStudentCoverage([{ course, readers: [] }, { course: {id: 4, fullname: 'Other'}, readers: [] }], {
  readRoster: async c => [{id: String(c.id), name: 'Shared Name'}],
});
assert.equal(records.get(900).profile.ambiguous, true);
assert.deepEqual(records.get(900).profile.courses, []);
await sub.registerStudent(901, 'Stopped Name');
await sub.stopStudent(901);
const beforeStopped = messages.filter(m => m.chat_id === 901).length;
await sub.refreshStudentCoverage(plan, {readRoster: async () => []});
assert.equal(messages.filter(m => m.chat_id === 901).length, beforeStopped);
await send('/cooperate');
assert.ok(messages.every(m => m.text.length <= 4096));
assert.ok(messages.some(m => m.text.includes('F12')));
assert.ok(messages.some(m => m.text.includes('ستون Value')));
const rosterCache = modules.get(new URL('lib/roster-cache.js', root).href).namespace;
const cachedRequests = universityRequests;
await rosterCache.courseRoster(course);
await rosterCache.courseRoster(course);
assert.equal(universityRequests, cachedRequests, 'persistent roster cache avoids university requests');
await rosterCache.courseRoster(course, {force:true});
assert.ok(universityRequests > cachedRequests, 'owner refresh fetches a new complete roster');
await assert.rejects(() => rosterCache.courseRoster(course, {force:true, load:async () => {throw new Error('offline');}}));
assert.equal((await rosterCache.courseRoster(course))[0].name, 'Student Name', 'failed refresh preserves previous roster');
console.log('Automatic registration, new coverage, paused users, private retry and Persian guidance passed.');
