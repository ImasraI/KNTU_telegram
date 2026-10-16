import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_INTERVAL_MINUTES, courseCounts, courseView, coverageView, freshness, itemView, newestRead, pageItems, selectItems, studentState, universityUrl } from '../tgcloud/lib/student-view.js';
import { ORIGIN } from '../tgcloud/lib/config.js';

const now = Date.parse('2026-10-16T12:00:00Z');
const minutesAgo = n => new Date(now - n * 60000);
const item = { id: 9, kind: 'assign', name: 'تمرین سری ۱', dates: 'مهلت: چهارشنبه', description: 'x'.repeat(400), files: [], url: ORIGIN + '/mod/assign/view.php?id=9' };

test('scan age is reported as fresh, aging or stale, and never invented', () => {
  assert.equal(freshness(null, now).state, 'unknown');
  assert.equal(freshness(null, now).at, null);
  assert.equal(freshness(undefined, now).ageSeconds, null);
  assert.equal(freshness(minutesAgo(5), now).state, 'fresh');
  assert.equal(freshness(minutesAgo(CHECK_INTERVAL_MINUTES * 3), now).state, 'aging');
  assert.equal(freshness(minutesAgo(CHECK_INTERVAL_MINUTES * 40), now).state, 'stale');
  // A Date (the snapshots column) and an ISO string (a stored scan) both work.
  assert.equal(freshness(minutesAgo(5), now).at, minutesAgo(5).toISOString());
  assert.equal(freshness(minutesAgo(5).toISOString(), now).state, 'fresh');
  assert.equal(freshness(minutesAgo(5), now).ageSeconds, 300);
});

test('only university links without credentials survive into a response', () => {
  assert.equal(universityUrl(ORIGIN + '/mod/resource/view.php?id=5'), ORIGIN + '/mod/resource/view.php?id=5');
  assert.equal(universityUrl('https://evil.example/mod/resource/view.php?id=5'), null);
  assert.equal(universityUrl(ORIGIN + '.evil.example/x'), null);
  assert.equal(universityUrl(ORIGIN + '/file.php?token=SECRET'), null);
  assert.equal(universityUrl(ORIGIN + '/file.php?wstoken=SECRET'), null);
  assert.equal(universityUrl(null), null);
});

test('a course shows its class number or weekly time and professor — never the long code', () => {
  const withLabel = courseView({ id: 3, name: 'ریاضی مهندسی', codeFromName: '4051-1111167-17', siteCode: '4051-1111167-17',
    binding: { code: '4051-1111167-17', label: '17', professorName: 'طباطبایی' } });
  assert.equal(withLabel.classLabel, 'کلاس 17');
  assert.equal(withLabel.professor, 'استاد طباطبایی');
  const withTime = courseView({ id: 82, name: 'الکترونیک ۱', binding: { slots: [{ weekday: 1, from: '09:00', to: '10:30' }] } });
  assert.equal(withTime.classLabel, 'یکشنبه 09:00 - 10:30');
  assert.equal(withTime.professor, null);
  const bare = courseView({ id: 20, name: 'مدارها', binding: null });
  assert.equal(bare.classLabel, null);
  // A name that already carries a title is not titled twice.
  assert.equal(courseView({ id: 1, binding: { professorName: 'دکتر رضایی' } }).professor, 'دکتر رضایی');
  const serialized = JSON.stringify([withLabel, withTime, bare]);
  for (const hidden of ['4051-1111167-17', 'codeFromName', 'siteCode', 'binding']) assert.ok(!serialized.includes(hidden), hidden);
});

test('activities are bucketed into homework, exams, files and notices', () => {
  const items = [
    item,
    { id: 10, kind: 'quiz', name: 'آزمون میان‌ترم', files: [] },
    { id: 11, kind: 'forum', name: 'تاریخ آزمون پایان‌ترم', files: [] },
    { id: 12, kind: 'resource', name: 'مرجع درس', files: [] },
    { id: 13, kind: 'folder', name: 'اسلایدها', files: [] },
    { id: 14, kind: 'forum', name: 'اطلاعیه کلاس', files: [] },
  ];
  assert.deepEqual(courseCounts(items), { assign: 1, exam: 2, file: 2, notice: 1, total: 6 });
  assert.equal(selectItems(items, 'exam').length, 2);
  assert.equal(selectItems(items, 'file').length, 2);
  assert.equal(selectItems(items, 'nonsense').length, 6);
});

test('an item is shaped with bounded text and no credential-bearing link', () => {
  const view = itemView({ ...item, description: 'x'.repeat(900), url: ORIGIN + '/file.php?token=SECRET', files: [{ name: 'hw.pdf', url: ORIGIN + '/pluginfile.php/1/mod_assign/introattachment/0/hw.pdf' }, { name: 'private.pdf', url: 'https://evil.example/private.pdf' }] });
  assert.equal(view.url, null);
  assert.deepEqual(view.files.map(f => f.url), [ORIGIN + '/pluginfile.php/1/mod_assign/introattachment/0/hw.pdf', null]);
  assert.equal(view.files[0].name, 'hw.pdf');
  assert.equal(view.dates, 'مهلت: چهارشنبه');
  assert.equal(view.kindLabel, '📝 تکلیف');
  assert.ok(view.description.length <= 701 && view.description.endsWith('…'));
  assert.ok(itemView(item, 'short').description.length <= 181);
  // A description that already fits is passed through unchanged.
  assert.equal(itemView({ ...item, description: 'کوتاه' }).description, 'کوتاه');
});

test('items are paged so a large course does not arrive in one payload', () => {
  const many = Array.from({ length: 95 }, (_, i) => ({ ...item, id: i + 1 }));
  const first = pageItems(many, 0);
  assert.equal(first.items.length, 40);
  assert.equal(first.total, 95);
  assert.equal(first.offset, 0);
  assert.ok(first.hasMore);
  const last = pageItems(many, 80);
  assert.equal(last.items.length, 15);
  assert.ok(!last.hasMore);
  assert.equal(pageItems(many, 'bad').offset, 0);
});

test('the caller view carries registration state and never a participant id', () => {
  const state = studentState({ active: true, profile: { registered: true, name: 'Arsam Alaei', participantId: '42', courses: [3, '82'], confirmedAt: now } });
  assert.equal(state.registered, true);
  assert.equal(state.notifications, 'on');
  assert.deepEqual(state.courses, ['3', '82']);
  assert.equal(state.exactIdentity, true);
  assert.equal(state.registeredAt, new Date(now).toISOString());
  assert.ok(!JSON.stringify(state).includes('42'));
  assert.equal(studentState({ active: false, profile: { paused: true } }).notifications, 'paused');
  assert.equal(studentState({ active: false, profile: {} }).notifications, 'off');
  assert.deepEqual(studentState(null), studentState(undefined));
  assert.equal(studentState(null).registered, false);
});

test('coverage health exposes scan age and completeness without account details', () => {
  const known = { checkedAt: minutesAgo(10).toISOString(), reason: 'scheduled', failures: [], lost: [] };
  const clean = coverageView(known, 9, now);
  assert.equal(clean.courses, 9);
  assert.equal(clean.partial, false);
  assert.equal(clean.check.state, 'fresh');
  assert.equal(clean.intervalMinutes, CHECK_INTERVAL_MINUTES);
  assert.equal(clean.recorded.at, known.checkedAt);
  assert.equal(clean.recorded.olderThanReads, false);
  const partial = coverageView({ ...known, failures: [{ course: 'a' }], lost: ['b', 'c'], health: [{ ownerId: 111, secret: 'x' }] }, 9, now);
  assert.equal(partial.partial, true);
  assert.equal(partial.failedCourses, 1);
  assert.equal(partial.lostCourses, 2);
  assert.ok(!JSON.stringify(partial).includes('secret'));
  const unknown = coverageView(null, 0, now);
  assert.equal(unknown.lastCheckAt, null);
  assert.equal(unknown.check.state, 'unknown');
  assert.equal(unknown.partial, false);
  assert.equal(unknown.recorded.at, null);
});

test('the badge follows the newest course reading while the recorded scan stays visible', () => {
  const courses = [
    { id: 3, scan: { at: minutesAgo(8).toISOString() } },
    { id: 82, scan: { at: minutesAgo(3).toISOString() } },
    { id: 20, scan: { at: null } },
  ];
  assert.equal(newestRead(courses), minutesAgo(3).getTime());
  assert.equal(newestRead([]), null);
  assert.equal(newestRead([{ id: 1 }]), null);
  // A scan that read courses and then failed to record its summary: the header must
  // not claim the data is two hours old when a course was read three minutes ago.
  const split = coverageView({ checkedAt: minutesAgo(12 * 60).toISOString(), reason: 'scheduled', failures: [{ course: 'a' }], lost: [] }, 3, now, newestRead(courses));
  assert.equal(split.check.state, 'fresh');
  assert.equal(split.check.ageSeconds, 180);
  assert.equal(split.recorded.check.state, 'stale');
  assert.equal(split.recorded.at, minutesAgo(12 * 60).toISOString());
  assert.equal(split.recorded.olderThanReads, true);
  assert.equal(split.partial, true);
  // Equal or near-equal times are one fact, not two.
  const together = coverageView({ checkedAt: minutesAgo(10).toISOString() }, 1, now, newestRead([{ scan: { at: minutesAgo(9).toISOString() } }]));
  assert.equal(together.recorded.olderThanReads, false);
  assert.equal(together.lastCheckAt, minutesAgo(9).toISOString());
});
