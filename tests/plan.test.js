import test from 'node:test';
import assert from 'node:assert/strict';
import { courseKey, courseIdFromKey, planCourses, courseList, coveredKeys, lostCoverage } from '../tgcloud/lib/plan.js';
import { destinationFrom, sendTarget, describeDestination, sameTarget, parseThreadId } from '../tgcloud/lib/destination.js';
import { cooldownActive, noticePlan, noticeKey } from '../tgcloud/lib/notice-policy.js';

const origin = 'https://vc.kntu.ac.ir';

test('overlapping enrollment is deduplicated on origin + course id, keeping reader order', () => {
  const plan = planCourses([
    { accountId: 'acc_a', courses: [{ id: 3, fullname: 'رياضيات مهندسي', origin }] },
    { accountId: 'acc_b', courses: [{ id: 3, fullname: 'رياضيات مهندسي', origin }, { id: 82, fullname: 'الكترونيك 1', origin }] },
    { accountId: 'acc_c', courses: [{ id: 3, fullname: 'رياضيات مهندسي', origin }] },
  ]);
  assert.equal(plan.length, 2);
  const math = plan.find(p => p.course.id === 3);
  assert.deepEqual(math.readers, ['acc_a', 'acc_b', 'acc_c']);
  assert.deepEqual(plan.find(p => p.course.id === 82).readers, ['acc_b']);
});

test('different sections/professors with the same course name stay separate courses', () => {
  const plan = planCourses([
    { accountId: 'acc_a', courses: [{ id: 25, fullname: 'مدارهاي الكتريكي 2', origin }] },
    { accountId: 'acc_b', courses: [{ id: 425, fullname: 'مدارهاي الكتريكي 2', origin }] },
  ]);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map(p => p.course.id).sort((a, b) => a - b), [25, 425]);
});

test('the same course id from another origin is a different course', () => {
  const plan = planCourses([
    { accountId: 'acc_a', courses: [{ id: 3, fullname: 'A', origin }] },
    { accountId: 'acc_b', courses: [{ id: 3, fullname: 'A', origin: 'https://other.example' }] },
  ]);
  assert.equal(plan.length, 2);
  assert.notEqual(plan[0].key, plan[1].key);
});

test('invalid or duplicate enrollment entries never create phantom courses', () => {
  const plan = planCourses([
    { accountId: 'acc_a', courses: [{ id: 3, fullname: 'Math', origin }, { id: 3, fullname: 'Math', origin }, { id: 0, fullname: 'bad' }, { id: -1, fullname: 'bad' }] },
  ]);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].readers, ['acc_a']);
  assert.deepEqual(courseList(plan), [{ id: 3, fullname: 'Math', origin }]);
});

test('course keys round-trip and coverage loss is computed against the plan', () => {
  const plan = planCourses([{ accountId: 'acc_a', courses: [{ id: 861, fullname: 'Life', origin }] }]);
  const key = courseKey({ id: 861, fullname: 'Life', origin });
  assert.equal(key, `${origin}#861`);
  assert.equal(courseIdFromKey(key), '861');
  assert.equal(courseIdFromKey('120'), '120');
  assert.deepEqual(coveredKeys(plan, []), [key]);
  assert.deepEqual(coveredKeys(plan, [{ course: key, code: 'UNIVERSITY_LOGIN_REQUIRED' }]), []);
  assert.deepEqual(lostCoverage([key, `${origin}#999`], [key]), [`${origin}#999`]);
});

test('topic routing carries message_thread_id only when a topic was captured', () => {
  assert.deepEqual(sendTarget({ chatId: -100123, threadId: null }), { chat_id: -100123 });
  assert.deepEqual(sendTarget({ chatId: -100123, threadId: 42 }), { chat_id: -100123, message_thread_id: 42 });
  assert.equal(sendTarget(null), null);
  assert.equal(parseThreadId('42'), 42);
  assert.equal(parseThreadId(''), null);
  assert.equal(parseThreadId('abc'), null);
});

test('destination resolution preserves the legacy group and honours an explicit unbind', () => {
  assert.deepEqual(destinationFrom({ chatId: -100, threadId: 7, source: 'bind' }, 0), { chatId: -100, threadId: 7, source: 'bind' });
  assert.deepEqual(destinationFrom(undefined, -100456), { chatId: -100456, threadId: null, source: 'legacy' });
  assert.equal(destinationFrom(null, -100456), null);          // /unbind must not fall back
  assert.equal(destinationFrom(undefined, 0), null);
  assert.match(describeDestination(null), /No destination bound/);
  assert.match(describeDestination({ chatId: -100, threadId: 9, source: 'bind' }), /topic 9/);
  assert.ok(sameTarget({ chatId: -100, threadId: 9 }, { chatId: -100, threadId: 9 }));
  assert.ok(!sameTarget({ chatId: -100, threadId: 9 }, { chatId: -100, threadId: null }));
});

test('failure warnings are deduplicated by cooldown instead of spamming the holder', () => {
  const hour = 3600000;
  assert.ok(!cooldownActive(0, 1000, hour));
  assert.ok(cooldownActive(1000, 1000 + hour / 2, hour));
  assert.ok(!cooldownActive(1000, 1000 + hour, hour));
  const first = noticePlan(null, { now: 1000, cooldownMs: hour });
  assert.deepEqual([first.send, first.count, first.nextEligibleAt], [true, 1, 1000 + hour]);
  const second = noticePlan({ sentAt: 1000, count: 1 }, { now: 1000 + 60, cooldownMs: hour });
  assert.equal(second.send, false);
  assert.equal(second.count, 1);
  const third = noticePlan({ sentAt: 1000, count: 1 }, { now: 1000 + hour + 1, cooldownMs: hour });
  assert.deepEqual([third.send, third.count], [true, 2]);
  assert.equal(noticeKey('expired', 'acc_a'), 'expired:acc_a');
});
