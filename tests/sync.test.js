import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCourses } from '../tgcloud/lib/sync.js';
import { courseKey } from '../tgcloud/lib/plan.js';

const MATH = { id: 3, fullname: 'رياضيات مهندسي' };
const KEY = courseKey(MATH);
const item = id => ({ id, name: 'HW ' + id, kind: 'assign', files: [], dates: '', description: '' });

// `baselines` maps a course key to either an item array (as stored by the
// single-account version) or { items, reader } (as stored now).
function fixture(baselines, courses = [MATH]) {
  const state = new Map(Object.entries(baselines));
  const messages = [];
  const options = {
    courses,
    read: async () => [item(1)],
    load: async key => {
      if (!state.has(key)) return undefined;
      const value = state.get(key);
      return Array.isArray(value) ? { items: value, reader: null } : structuredClone(value);
    },
    save: async (key, items, reader) => state.set(key, { items: structuredClone(items), reader: reader ?? null }),
    send: async (course, i) => { messages.push(i); },
  };
  return { state, messages, options };
}

test('initial scan and new course baseline are silent; repeated scan stays silent', async () => {
  const f = fixture({});
  const first = await syncCourses(f.options);
  assert.equal(first.baselined, 1);
  assert.deepEqual(first.baselineKeys, [KEY]);
  assert.equal((await syncCourses(f.options)).sent, 0);
  assert.equal((await syncCourses(f.options)).baselined, 0);
  assert.equal(f.messages.length, 0);
});

test('a baseline written by the single-account version still counts', async () => {
  const f = fixture({ [KEY]: [item(1)] }); // plain array, no reader attributed
  f.options.read = async () => [item(1)];
  const result = await syncCourses(f.options);
  assert.equal(result.baselined, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.readerChanges, 0);
});

test('failed university read preserves prior snapshot and reports only an error code', async () => {
  const f = fixture({ [KEY]: { items: [item(1)], reader: 'acc_a' } });
  f.options.read = async () => { throw new Error('PRIVATE secret response'); };
  const result = await syncCourses(f.options);
  assert.deepEqual(f.state.get(KEY).items, [item(1)]);
  assert.deepEqual(result.failures, [{ course: KEY, code: 'COURSE_SCAN_FAILED' }]);
});

test('failed send retries only unsent changes on the next scan', async () => {
  const f = fixture({ [KEY]: { items: [], reader: 'acc_a' } });
  f.options.read = async () => [item(1), item(2)];
  f.options.send = async (c, i) => { if (i.id === 2) throw new Error('RATE_LIMIT'); f.messages.push(i); };
  assert.equal((await syncCourses(f.options)).sent, 1);
  assert.deepEqual(f.state.get(KEY).items.map(x => x.id), [1]);
  f.options.send = async (c, i) => f.messages.push(i);
  assert.equal((await syncCourses(f.options)).sent, 1);
  assert.deepEqual(f.messages.map(x => x.id), [1, 2]);
});

test('an expired first account falls through to another account holding the course', async () => {
  const course = { ...MATH, readers: ['acc_expired', 'acc_ok'] };
  const f = fixture({ [KEY]: { items: [{ ...item(1), dates: 'old' }], reader: 'acc_ok' } }, [course]);
  const attempts = [];
  f.options.read = async (c, readerId) => {
    if (readerId === 'acc_expired') throw new Error('UNIVERSITY_LOGIN_REQUIRED');
    return [{ ...item(1), dates: 'new' }];
  };
  f.options.onAttemptError = (c, readerId, e) => attempts.push([readerId, e.message]);
  const result = await syncCourses(f.options);
  assert.deepEqual(attempts, [['acc_expired', 'UNIVERSITY_LOGIN_REQUIRED']]);
  assert.equal(result.failures.length, 0);            // the course was still read
  assert.equal(result.sent, 1);                       // the deadline change is announced once
  assert.equal(f.state.get(KEY).reader, 'acc_ok');
});

test('a course fails only when every reader fails, and never blocks other courses', async () => {
  const other = { id: 82, fullname: 'الكترونيك 1' };
  const courses = [{ ...MATH, readers: ['acc_a', 'acc_b'] }, { ...other, readers: ['acc_a'] }];
  const f = fixture({ [KEY]: { items: [], reader: 'acc_a' }, [courseKey(other)]: { items: [], reader: 'acc_a' } }, courses);
  const attempts = [];
  f.options.read = async (c, readerId) => {
    if (c.id === 3) throw new Error(readerId === 'acc_a' ? 'UNIVERSITY_LOGIN_REQUIRED' : 'UNIVERSITY_UNREACHABLE');
    return [item(9)];
  };
  f.options.onAttemptError = (c, readerId) => attempts.push(readerId);
  const result = await syncCourses(f.options);
  assert.deepEqual(attempts.sort(), ['acc_a', 'acc_b']); // only the unreadable course was attempted twice
  assert.deepEqual(result.failures, [{ course: KEY, code: 'UNIVERSITY_UNREACHABLE' }]);
  assert.equal(result.sent, 1); // the healthy course was still delivered
});

test('switching accounts does not create false updates from a reduced view', async () => {
  const rich = { ...item(1), dates: 'مهلت: چهارشنبه', description: 'توضیح کامل', files: [{ name: 'hw.pdf' }] };
  const f = fixture({ [KEY]: { items: [rich], reader: 'acc_a' } });
  // The second account sees less: same module, no dates/description/attachment.
  f.options.read = async () => [{ ...item(1) }];
  const result = await syncCourses(f.options);
  assert.equal(result.sent, 0);
  assert.equal(result.readerChanges, 1);
  assert.equal(result.absorbed, 1);
  // The richer observation is kept, so flipping back later is silent too.
  assert.equal(f.state.get(KEY).items[0].dates, 'مهلت: چهارشنبه');
  assert.equal(f.state.get(KEY).items[0].description, 'توضیح کامل');
  assert.deepEqual(f.state.get(KEY).items[0].files, [{ name: 'hw.pdf' }]);
  assert.equal((await syncCourses(f.options)).sent, 0);
  assert.equal((await syncCourses(f.options)).sent, 0);
});

test('a genuinely new activity visible to another account is still announced', async () => {
  const f = fixture({ [KEY]: { items: [item(1)], reader: 'acc_a' } });
  f.options.read = async (c, readerId) => (readerId === 'acc_b' ? [item(1), item(2)] : [item(1)]);
  const course = { ...MATH, readers: ['acc_b'] };
  const result = await syncCourses({ ...f.options, courses: [course] });
  assert.equal(result.sent, 1);
  assert.equal(f.messages[0].id, 2);
  assert.equal(f.messages[0].change, 'new');
});

test('every failed course is reported with its code and nothing else is announced', async () => {
  const courses = [{ ...MATH, readers: ['acc_a'] }, { id: 82, fullname: 'x', readers: ['acc_a'] }];
  const f = fixture({}, courses);
  f.options.read = async () => { throw new Error('UNIVERSITY_UNREACHABLE'); };
  const result = await syncCourses(f.options);
  assert.deepEqual(result.failures.map(x => x.code), ['UNIVERSITY_UNREACHABLE', 'UNIVERSITY_UNREACHABLE']);
  assert.equal(result.baselined, 0);
  assert.equal(result.sent, 0);
});
