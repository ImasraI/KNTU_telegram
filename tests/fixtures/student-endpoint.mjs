// Runs the real `endpoints/student` module against a fake platform: a fake
// database, fake settings, a fake Bot API and a fake university (real Participants
// HTML through the real parser). Only infrastructure is mocked, so
// this exercises the shipped registration, matching, coverage and notification
// services — and proves what a caller may see.
import assert from 'node:assert/strict';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../../tgcloud/', import.meta.url);
const BASE = 'https://vc.kntu.ac.ir';
const SECRET = 'TESTSECRET-not-real-0123456789';
const plain = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/* ------------------------------------------------------------- fake database */
const subs = new Map(), snaps = new Map(), settingRows = new Map();
const store = table => (table.name === 'subscriptions' ? subs : snaps);
const keyOf = row => (row.tgId !== undefined ? row.tgId : row.key);
const matches = (row, condition) => !condition
  || (condition.type === 'in' ? condition.values.includes(row[condition.column]) : row[condition.column] === condition.value);
const db = {
  async run() { return { rowsAffected: 1 }; },
  select() {
    let table, condition;
    return {
      from(t) { table = t; return this; },
      where(c) { condition = c; return this; },
      async get() { return plain([...store(table).values()].find(row => matches(row, condition))); },
      async all() { return plain([...store(table).values()].filter(row => matches(row, condition))); },
    };
  },
  insert(table) {
    let row, conflict, nothing = false;
    return {
      values(value) { row = plain(value); return this; },
      onConflictDoUpdate(options) { conflict = options; return this; },
      onConflictDoNothing() { nothing = true; return this; },
      async run() {
        const target = store(table), key = keyOf(row);
        if (!target.has(key)) { target.set(key, row); return; }
        if (nothing) return;
        target.set(key, { ...target.get(key), ...(conflict?.set ?? row) });
      },
    };
  },
  update(table) {
    let patch, condition;
    return {
      set(value) { patch = value; return this; },
      where(c) { condition = c; return this; },
      async run() { for (const [key, row] of store(table)) if (matches(row, condition)) store(table).set(key, { ...row, ...patch }); },
    };
  },
  delete(table) {
    let condition;
    return {
      where(c) { condition = c; return this; },
      async run() { for (const [key, row] of store(table)) if (matches(row, condition)) store(table).delete(key); },
    };
  },
};

/* ------------------------------------------- fake university (real parsing) */
const rosters = {
  3: [{ id: 42, name: 'Student One' }, { id: 43, name: 'Student Two' }],
  82: [{ id: 77, name: 'Other Person' }],
  20: [{ id: 88, name: 'Same Name' }, { id: 89, name: 'Same Name' }],
  55: [{ id: 42, name: 'Student One' }],
};
const rosterHtml = id => `<body id="page-user-index"><table id="participants">${(rosters[id] ?? [])
  .map(person => `<tr><th class="c1"><a href="/user/view.php?id=${person.id}&amp;course=${id}">${person.name}</a></th><td class="c2">شاگرد</td></tr>`).join('')}</table></body>`;
const fetcher = async (url, options = {}) => {
  assert.ok(url.startsWith(BASE + '/'), url);
  assert.equal(options.headers?.Cookie, 'MoodleSession=' + SECRET);
  assert.ok(!url.includes(SECRET));
  const id = Number((url.match(/[?&]id=(\d+)/) ?? [])[1]);
  return { ok: true, text: async () => rosterHtml(id) };
};

/* ------------------------------------------------- fake Bot API and settings */
const messages = [];
const item = extra => ({ id: 0, name: 'مورد', kind: 'assign', files: [], dates: '', description: '', url: null, ...extra });
const courses = [
  { id: 3, fullname: 'ریاضی مهندسی [4051-1111167-17]' },
  { id: 82, fullname: 'الکترونیک ۱ [4051-1111168-17]' },
  { id: 20, fullname: 'مدارهای الکتریکی [4051-1111169-17]' },
];
settingRows.set('courses', courses);
settingRows.set('status', { checkedAt: new Date(Date.now() - 10 * 60000).toISOString(), reason: 'scheduled', courses: 3, failures: [], lost: [] });
snaps.set(BASE + '#3', { key: BASE + '#3', value: [
  item({ id: 9, name: 'تمرین سری ۱', dates: 'مهلت: چهارشنبه', url: BASE + '/mod/assign/view.php?id=9' }),
  item({ id: 5, kind: 'resource', name: 'مرجع درس', url: BASE + '/file.php?token=PRIVATE' }),
  item({ id: 6, kind: 'quiz', name: 'آزمون میان‌ترم', files: [{ name: 'hw.pdf', url: 'https://evil.example/hw.pdf' }], url: BASE + '/mod/quiz/view.php?id=6' }),
], updatedAt: Date.now() - 10 * 60000 });
snaps.set(BASE + '#82', { key: BASE + '#82', value: [item({ id: 30, kind: 'forum', name: 'تاریخ آزمون پایان‌ترم' })], updatedAt: Date.now() - 10 * 60000 });
snaps.set(BASE + '#20', { key: BASE + '#20', value: [], updatedAt: Date.now() - 10 * 60000 });

/* -------------------------------------------------------------- fake modules */
const schema = new Map([
  [new URL('schema.js', root).href, { subscriptions: { name: 'subscriptions', tgId: 'tgId' }, snapshots: { name: 'snapshots', key: 'key' } }],
  ['sdk', {
    db,
    api: { async sendMessage(input) { messages.push(plain(input)); return { message_id: messages.length }; } },
    fetch: fetcher,
    EndpointError: class EndpointError extends Error { constructor(message, parameters) { super(message); this.parameters = parameters; } },
  }],
  ['sdk/db', {
    eq: (column, value) => ({ column, value }),
    inArray: (column, values) => ({ column, values, type: 'in' }),
    sql: () => ({ text: 'sql' }),
  }],
  [new URL('lib/settings.js', root).href, {
    getSetting: async key => plain(settingRows.get(key)),
    putSetting: async (key, value) => { settingRows.set(key, plain(value)); },
    delSetting: async key => { settingRows.delete(key); },
  }],
  [new URL('lib/accounts.js', root).href, { enabledAccounts: async () => [{ id: 'acc_a', mode: 'session', secret: SECRET }] }],
  // The class directory is the one thing this test stubs logically: it is the same
  // summary the chat's /classes prints, including the data the app must drop.
  [new URL('lib/monitor.js', root).href, {
    directorySummary: async () => ({
      professors: [{ code: '4051', name: 'طباطبایی' }],
      courses: [
        { key: BASE + '#3', id: 3, name: 'ریاضی مهندسی', codeFromName: '4051-1111167-17', siteCode: '4051-1111167-17',
          binding: { key: BASE + '#3', code: '4051-1111167-17', label: '17', professorCode: null, professorName: 'طباطبایی', professor: 'طباطبایی', slots: [], source: 'participants' },
          text: '🏫 کلاس 17', line: '🏫 کلاس 17' },
        { key: BASE + '#82', id: 82, name: 'الکترونیک ۱', codeFromName: null, siteCode: null,
          binding: { slots: [{ weekday: 1, from: '09:00', to: '10:30' }], label: null, professorName: 'رضایی', professor: 'رضایی' },
          text: '🏫 یکشنبه 09:00 - 10:30 — استاد رضایی', line: '🏫 یکشنبه 09:00 - 10:30 — استاد رضایی' },
        { key: BASE + '#20', id: 20, name: 'مدارهای الکتریکی', codeFromName: null, siteCode: null, binding: null, text: 'بدون تنظیم', line: null },
      ],
    }),
  }],
]);

const context = createContext({ console, Date, Map, Set, Number, String, JSON, Math });
const modules = new Map();
async function load(id) {
  if (modules.has(id)) return modules.get(id);
  let mod;
  if (schema.has(id)) {
    const exports = schema.get(id);
    mod = new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context, identifier: id });
  } else {
    mod = new SourceTextModule(await readFile(fileURLToPath(id), 'utf8'), { context, identifier: id });
  }
  modules.set(id, mod);
  return mod;
}

const entry = await load(new URL('endpoints/student.js', root).href);
await entry.link((specifier, parent) => load(specifier.startsWith('.') ? new URL(specifier, parent.identifier).href : specifier));
await entry.evaluate();
const endpoint = entry.namespace.default;
const subscriptions = modules.get(new URL('lib/subscriptions.js', root).href).namespace;

const ctx = id => ({ initData: { user: { id } } });
async function refuses(run, pattern) {
  try { await run(); } catch (error) { assert.match(String(error?.message ?? error), pattern); return; }
  assert.fail(`expected a refusal matching ${pattern}`);
}

/* --------------------------------------------------------- public browsing */
const anonymous = await endpoint({ action: 'home' }, {});
assert.equal(anonymous.me.registered, false);
assert.equal(subs.size, 0, 'browsing must not create a subscriber row');
assert.equal(anonymous.coverage.courses, 3);
assert.equal(anonymous.coverage.check.state, 'fresh');
assert.equal(anonymous.policy.fullNameLabel, 'نام کامل در VC');

const home = await endpoint({ action: 'home' }, ctx(111));
const serialized = JSON.stringify(home);
assert.ok(!serialized.includes(SECRET), 'no credential');
assert.ok(!serialized.includes('4051-1111167-17'), 'the long university code never leaves the server');
assert.ok(!serialized.includes('codeFromName') && !serialized.includes('siteCode') && !serialized.includes('binding'));
assert.ok(!serialized.includes('Student Two'), 'no participant roster');
const byId = Object.fromEntries(home.courses.map(course => [course.id, course]));
assert.equal(byId[3].classLabel, 'کلاس 17');
assert.equal(byId[3].professor, 'استاد طباطبایی');
assert.equal(byId[82].classLabel, 'یکشنبه 09:00 - 10:30');
assert.equal(byId[20].classLabel, null);
assert.equal(byId[3].counts.assign, 1);
assert.equal(byId[3].counts.exam, 1);

/* ------------------------------------------------- registration and matching */
await refuses(() => endpoint({ action: 'register', name: 'Ali' }, ctx(111)), /نام و نام خانوادگی/);
assert.equal(subs.size, 0, 'an implausible name must not create a row');

const queued = await endpoint({ action: 'register', name: 'Student One' }, ctx(111));
assert.equal(queued.result.queued, true);
assert.equal(queued.me.registrationPending, true);
assert.deepEqual(plain(queued.result.courses), []);
const registrationPlan = [3,82,20].map(id => ({course: {id, fullname: 'Course'}, readers: ['acc_a']}));
await endpoint({action:'refreshRegistration', tgId:222}, ctx(111));
assert.equal(subs.has(222), false, 'immediate lookup cannot act for a caller-supplied id');
const registered = await endpoint({action:'home'}, ctx(111));
assert.equal(registered.me.registrationPending, false);
assert.equal(registered.me.registered, true);
assert.equal(registered.me.notifications, 'on');
assert.deepEqual(plain(registered.me.courses), ['3']);
assert.equal(registered.me.exactIdentity, true);
assert.equal(subs.get(111).profile.participantId, '42');
assert.equal(subs.get(111).profile.username, null);
assert.equal(subs.get(111).active, true);
await refuses(() => endpoint({ action: 'register', name: 'Student One' }, ctx(111)), /یک دقیقه صبر کنید/);

/* ------------------------------------------------------ caller isolation */
const second = await endpoint({ action: 'register', name: 'Other Person' }, ctx(222));
assert.equal(second.result.queued, true);
await subscriptions.refreshStudentCoverage(registrationPlan);
const home222 = await endpoint({ action: 'home' }, ctx(222));
const home111 = await endpoint({ action: 'home' }, ctx(111));
assert.deepEqual(plain(home222.me.courses), ['82']);
assert.ok(!JSON.stringify(home222).includes('Student One'), 'no other student in the payload');
assert.deepEqual(plain(home111.me.courses), ['3']);
assert.ok(!JSON.stringify(home111).includes('Other Person'));
// A caller-supplied id is ignored: the platform's verified init data decides.
await endpoint({ action: 'stop', tgId: 111, chatId: 111, user: { id: 111 } }, ctx(222));
assert.equal(subs.get(111).active, true, 'the other caller is untouched');
assert.equal(subs.get(222).active, false);
assert.equal(subs.get(222).profile.paused, true);
await refuses(() => endpoint({ action: 'stop' }, { initData: {} }), /حساب تلگرام/);
await refuses(() => endpoint({ action: 'forget' }, {}), /حساب تلگرام/);

/* --------------------------------- homonyms are never guessed automatically */
await endpoint({ action: 'register', name: 'Same Name' }, ctx(333));
await subscriptions.refreshStudentCoverage(registrationPlan);
const ambiguous = await endpoint({action:'home'}, ctx(333));
assert.equal(ambiguous.me.ambiguous, true);
assert.deepEqual(plain(ambiguous.me.courses), []);
assert.equal(ambiguous.me.registered, true, 'the student stays registered for future coverage');

messages.length = 0;
/* ------------------------------------------- stop, resume, dedupe, deletion */
const course3 = { id: 3, fullname: 'ریاضی مهندسی' };
const stopped = await endpoint({ action: 'stop' }, ctx(111));
assert.equal(stopped.me.notifications, 'paused');
assert.equal(subs.get(111).active, false);
snaps.get(BASE + '#3').value.push(item({ id: 101, name: 'تکلیف زمان توقف' }));
assert.equal((await subscriptions.deliverPersonal([course3], () => '')).sent, 0, 'a stopped student receives nothing');
const resumed = await endpoint({ action: 'resume' }, ctx(111));
assert.equal(resumed.me.notifications, 'on');
assert.equal((await subscriptions.deliverPersonal([course3], () => '')).sent, 0, 'resume seeds the current baseline');
snaps.get(BASE + '#3').value.push(item({ id: 102, name: 'تکلیف تازه' }));
assert.equal((await subscriptions.deliverPersonal([course3], () => '🏫 کلاس 17')).sent, 1);
assert.equal(messages.length, 1);
assert.equal(messages[0].chat_id, 111);
assert.equal((await subscriptions.deliverPersonal([course3], () => '')).sent, 0, 'a delivered item is not repeated');

/* ---------------------------------------- new coverage matches registered users */
settingRows.get('courses').push({ id: 55, fullname: 'درس تازه [4051-1111170-17]' });
snaps.set(BASE + '#55', { key: BASE + '#55', value: [item({ id: 200, name: 'تمرین ۱' })], updatedAt: Date.now() });
let rosterReads = 0;
const coverage = await subscriptions.refreshStudentCoverage([{ course: { id: 55, fullname: 'درس تازه' }, readers: ['acc_a'] }], {
  readRoster: async (_course, queries) => {
    rosterReads++;
    assert.ok(queries.some(query => query.name === 'Student One' && query.id === '42'));
    return [{ id: '42', name: 'Student One' }];
  },
});
assert.equal(coverage.added, 1);
assert.equal(rosterReads, 1, 'one roster read for every candidate');
assert.equal((await subscriptions.deliverPersonal([{ id: 55, fullname: 'درس تازه' }], () => '')).sent, 0, 'a newly covered course does not flood the inbox');
const covered = await endpoint({ action: 'home' }, ctx(111));
assert.deepEqual(plain(covered.me.courses), ['3', '55']);
assert.equal(covered.coverage.courses, 4);
assert.equal(subs.get(111).active, true);
assert.equal(subs.get(222).active, false, 'a coverage update never reactivates a stopped user');

/* -------------------------------------------------- course view and listing */
await refuses(() => endpoint({ action: 'course', courseId: 999 }, ctx(111)), /تحت پوشش/);
const detail = await endpoint({ action: 'course', courseId: 3 }, ctx(111));
assert.equal(detail.course.classLabel, 'کلاس 17');
assert.equal(detail.course.professor, 'استاد طباطبایی');
const badLink = detail.items.items.find(entry => entry.id === 5);
assert.equal(badLink.url, null, 'a credential-bearing link is dropped at the delivery boundary');
assert.equal(detail.items.items.find(entry => entry.id === 6).files[0].url, null);
assert.ok(!JSON.stringify(detail).includes('PRIVATE'));
assert.ok(!JSON.stringify(detail).includes('evil.example'));
const exams = await endpoint({ action: 'course', courseId: 3, filter: 'exam' }, ctx(111));
assert.deepEqual(plain(exams.items.items.map(entry => entry.id)), [6]);

const feedMine = await endpoint({ action: 'feed', filter: 'assign', scope: 'mine' }, ctx(111));
assert.equal(feedMine.scoped, true);
assert.ok(feedMine.items.length > 0);
assert.ok(feedMine.items.every(entry => entry.bucket === 'assign' && [3, 55].includes(entry.courseId)));
assert.equal(feedMine.items[0].courseName, 'ریاضی مهندسی');
assert.ok(!JSON.stringify(feedMine).includes('PRIVATE'));
const feedAnonymous = await endpoint({ action: 'feed', filter: 'exam' }, ctx(444));
assert.equal(feedAnonymous.scoped, false);
assert.ok(feedAnonymous.items.some(entry => entry.bucket === 'exam'), 'exams posted in a forum count');
const feedUnregistered = await endpoint({ action: 'feed', scope: 'mine' }, ctx(444));
assert.equal(feedUnregistered.requestedScope, 'mine');
assert.equal(feedUnregistered.scoped, false, 'an unregistered caller falls back to every course');

/* ------------------------------- the badge follows the newest reading, not the record */
const recordedStatus = settingRows.get('status');
assert.equal(home.coverage.recorded.olderThanReads, false, 'a completed scan is one fact');
const olderAt = new Date(Date.now() - 12 * 60 * 60000).toISOString();
settingRows.set('status', { ...recordedStatus, checkedAt: olderAt });
const split = await endpoint({ action: 'home' }, ctx(444));
assert.equal(split.coverage.check.state, 'fresh', 'course snapshots were read minutes ago');
assert.equal(split.coverage.recorded.at, olderAt, 'the recorded scan time is still reported');
assert.equal(split.coverage.recorded.check.state, 'stale');
assert.equal(split.coverage.recorded.olderThanReads, true);
settingRows.set('status', recordedStatus);

const help = await endpoint({ action: 'help' }, {});
assert.equal(help.contact, '@Arsam_alaei');
assert.ok(help.privacy.includes('حریم خصوصی'));
assert.ok(help.commands.some(command => command.command === 'register'));
assert.ok(!JSON.stringify(help).includes(SECRET));

/* ---------------------------------------------------- personal-data deletion */
const forgotten = await endpoint({ action: 'forget' }, ctx(111));
assert.equal(forgotten.result.deleted, true);
assert.equal(forgotten.me.registered, false);
assert.deepEqual(plain(forgotten.me.courses), []);
assert.equal(subs.has(111), false, 'the caller row is gone');
assert.equal(subs.has(222), true, 'another subscriber is untouched');
assert.equal((await endpoint({ action: 'home' }, ctx(111))).me.registered, false);
await refuses(() => endpoint({ action: 'dropEverything' }, ctx(222)), /شناخته نشد/);

console.log('Student endpoint: public browsing, isolation, registration, coverage, notification controls and deletion passed.');
