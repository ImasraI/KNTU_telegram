import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseCode, deriveLabel, toAsciiDigits, weekdayIndex, parseSlots, formatSlots, classLine, professorFor, professorLabel, describeBinding, parseClassCommand, WEEKDAYS } from '../tgcloud/lib/classes.js';
import { notification, digest, extractCourseMeta, extractEnrollmentCodes } from '../tgcloud/lib/content.js';

test('the 13-digit course code is read in both orders the university prints it', () => {
  assert.deepEqual(parseCourseCode('آز سيستم هاي ديجيتال 2 [4051-1111166-17]')?.fields, ['4051', '1111166', '17']);
  assert.deepEqual(parseCourseCode('22-1110274-4051')?.fields, ['22', '1110274', '4051']);
  assert.deepEqual(parseCourseCode('۴۰۵۱-۱۱۱۱۱۶۶-۱۷')?.code, '4051-1111166-17'); // Persian digits
  assert.deepEqual(parseCourseCode('گروه 4051 – 1111166 — 17')?.code, '4051-1111166-17'); // en/em dashes
  assert.deepEqual(parseCourseCode('2211102744051')?.code, '22-1110274-4051'); // no separators
  assert.equal(parseCourseCode('رياضيات مهندسي'), null);
  assert.equal(parseCourseCode('1405-09-07'), null);   // a Jalali date is not a course code
  assert.equal(parseCourseCode('نمره 20 از 20'), null);
  assert.equal(parseCourseCode(undefined), null);
});

test('the class label is the field that changes per class, and stays overridable', () => {
  // The site's shape (…-17/18/19) varies per class, so the trailing 2-digit field wins.
  assert.equal(deriveLabel('4051-1111166-17'), '17');
  // The registration-portal shape the owner quoted leads with a 2-digit class, and the
  // trailing field is 4 digits, so the leading field is used instead.
  assert.equal(deriveLabel(parseCourseCode('22-1110274-4051')), '22');
  assert.equal(deriveLabel(null), null);
});

test('Persian and Arabic-Indic digits normalise, and weekdays accept common spellings', () => {
  assert.equal(toAsciiDigits('۱۲۳۴۵۶۷۸۹۰'), '1234567890');
  assert.equal(weekdayIndex('یکشنبه'), 1);
  assert.equal(weekdayIndex('يكشنبه'), 1);            // Arabic yeh
  assert.equal(weekdayIndex('یک‌شنبه'), 1);           // ZWNJ
  assert.equal(weekdayIndex('سه شنبه'), 3);
  assert.equal(weekdayIndex('پنجشنبه'), 5);
  assert.equal(weekdayIndex('sunday'), 1);
  assert.equal(weekdayIndex('sat'), 0);
  assert.equal(weekdayIndex('چیزی'), null);
  assert.equal(WEEKDAYS[0], 'شنبه');
});

test('class times are parsed all-or-nothing, never half-saved', () => {
  assert.deepEqual(parseSlots('یکشنبه 10:00-11:30'), [{ weekday: 1, from: '10:00', to: '11:30' }]);
  assert.deepEqual(parseSlots('یک‌شنبه ۱۰:۰۰-۱۱:۳۰، سه‌شنبه 8:00 تا 9:30'), [
    { weekday: 1, from: '10:00', to: '11:30' },
    { weekday: 3, from: '08:00', to: '09:30' },
  ]);
  assert.equal(parseSlots('یکشنبه'), null);           // no time
  assert.equal(parseSlots('10:00-11:30'), null);      // no weekday
  assert.equal(parseSlots('یکشنبه 25:00-26:00'), null);
  assert.equal(parseSlots('یکشنبه 10:00-11:30، حالا'), null); // one bad part rejects all
  assert.equal(parseSlots(''), null);
  assert.equal(formatSlots([{ weekday: 1, from: '10:00', to: '11:30' }]), 'یکشنبه 10:00-11:30');
  assert.equal(formatSlots([{ weekday: 1, from: '10:00', to: '11:30' }, { weekday: 3, from: '08:00', to: '09:30' }]), 'یکشنبه 10:00-11:30، سه‌شنبه 08:00-09:30');
});

test('a class line names the class, the professor and the weekly time', () => {
  const professors = new Map([['4051', 'استاد طباطبایی']]);
  assert.equal(classLine(null, professors), null);
  assert.equal(classLine({ code: '4051-1111166-17', label: '17', professorCode: '4051', slots: [{ weekday: 1, from: '10:00', to: '11:30' }] }, professors),
    '🏫 کلاس 17 — کد 4051-1111166-17 — استاد طباطبایی — یکشنبه 10:00-11:30');
  // An unmapped professor code is not invented.
  assert.equal(classLine({ label: '13', professorCode: '9999' }, professors), '🏫 کلاس 13');
  assert.equal(classLine({ label: '13', professorName: 'استاد رضایی' }, professors), '🏫 کلاس 13 — استاد رضایی');
  // A name with its own title is not doubly titled.
  assert.equal(professorLabel('استاد طباطبایی'), 'استاد طباطبایی');
  assert.equal(professorLabel('دکتر رضایی'), 'دکتر رضایی');
  assert.equal(professorLabel('طباطبایی'), 'استاد طباطبایی');
  assert.equal(professorLabel(''), null);
  assert.equal(professorFor({ professorCode: '4051' }, professors), 'استاد طباطبایی');
  assert.equal(professorFor({ professorName: 'دکتر X', professorCode: '4051' }, professors), 'دکتر X');
  assert.equal(professorFor({ professorCode: '1' }, professors), null);
});

test('an unbound class is described as unbound rather than guessed', () => {
  assert.equal(describeBinding(null, new Map()), 'بدون تنظیم');
  assert.equal(describeBinding({ label: '17', professorCode: '4051' }, new Map([['4051', 'استاد طباطبایی']])), 'کلاس 17 — استاد طباطبایی');
  assert.match(describeBinding({ label: '17', professorCode: '4051' }, new Map()), /نام ثبت نشده/);
});

test('owner commands are parsed into explicit intent', () => {
  assert.deepEqual(parseClassCommand(['1413']), { courseId: 1413, action: 'show' });
  assert.deepEqual(parseClassCommand(['1413', 'code', '4051-1111166-17']), { courseId: 1413, action: 'code', code: '4051-1111166-17', label: '17' });
  assert.deepEqual(parseClassCommand(['1413', 'prof', 'استاد طباطبایی']), { courseId: 1413, action: 'professor', professorName: 'استاد طباطبایی' });
  assert.deepEqual(parseClassCommand(['1413', 'prof', '4051']), { courseId: 1413, action: 'professor', professorCode: '4051' });
  assert.deepEqual(parseClassCommand(['1413', 'slots', 'یکشنبه 10:00-11:30']), { courseId: 1413, action: 'slots', slots: [{ weekday: 1, from: '10:00', to: '11:30' }] });
  assert.deepEqual(parseClassCommand(['۱۴۱۳', 'label', '۱۷']), { courseId: 1413, action: 'label', label: '17' });
  assert.deepEqual(parseClassCommand(['1413', 'clear']), { courseId: 1413, action: 'clear' });
  assert.deepEqual(parseClassCommand(['1413', 'حذف']), { courseId: 1413, action: 'clear' });
  assert.deepEqual(parseClassCommand(['1413', 'استاد', 'دکتر رضایی']), { courseId: 1413, action: 'professor', professorName: 'دکتر رضایی' });
  assert.deepEqual(parseClassCommand(['abc']), { error: 'COURSE_ID' });
  assert.deepEqual(parseClassCommand(['1413', 'code', 'nope']), { error: 'CODE' });
  assert.deepEqual(parseClassCommand(['1413', 'slots', 'هر روز']), { error: 'SLOTS' });
  assert.deepEqual(parseClassCommand(['1413', 'wat']), { error: 'SUBCOMMAND' });
  assert.deepEqual(parseClassCommand([]), { error: 'COURSE_ID' });
});

test('notifications lead with the class identity so it survives truncation', () => {
  const course = { fullname: 'رياضيات مهندسي' };
  const item = { id: 1, kind: 'assign', name: 'تمرین', dates: 'مهلت', description: 'x'.repeat(5000), files: [], url: 'https://vc.kntu.ac.ir/mod/assign/view.php?id=1', change: 'new' };
  const line = '🏫 کلاس 17 — استاد طباطبایی';
  const text = notification(course, item, { classLine: line });
  assert.ok(text.length <= 4000);
  assert.ok(text.includes(line));
  assert.ok(text.indexOf(line) < text.indexOf('تمرین'));
  assert.ok(!notification(course, item).includes('🏫'));
  assert.ok(digest(course, [item], 5, { classLine: line }).includes(line));
});

test('the site evidence extractor reports codes and teacher markup, never invention', () => {
  const html = `<body id="page-course-view-weeks"><div class="page-header-headings"><h1>آز سيستم هاي ديجيتال 2 [4051-1111166-17]</h1></div>
    <div class="teachers"><a href="/user/view.php?id=99">استاد طباطبایی</a></div>
    <aside id="block-region-side-pre"><a href="/user/view.php?id=77">علی رضایی</a></aside></body>`;
  const meta = extractCourseMeta(html);
  assert.deepEqual(meta.codes, ['4051-1111166-17']);
  assert.match(meta.header, /1111166-17/);
  assert.deepEqual(meta.teachers, ['استاد طباطبایی']);
  const empty = extractCourseMeta('<body id="page-course-view-weeks"><h1>رياضيات مهندسي</h1></body>');
  assert.deepEqual(empty.codes, []);
  assert.deepEqual(empty.teachers, []);
});

test('every enrolled course code is read from the "My courses" block, not the course name', () => {
  // Reduced from the real sidebar block inspected on 2026-10-15: the course's own
  // name carries only [4051], the block carries the full 4051-1110274-23.
  const html = `<aside><div class="block_mycourses"><ul>
    <li><a href="https://vc.kntu.ac.ir/course/view.php?id=168"><span>كارگاه برق [4051-1112034-12]</span></a></li>
    <li><a href="https://vc.kntu.ac.ir/course/view.php?id=120">آز فيزيك2 [4051-1110274-23]</a></li>
    <li><a href="https://vc.kntu.ac.ir/course/view.php?id=3">رياضيات مهندسي [۴۰۵۱-۱۱۱۱۵۵۹-۱۱]</a></li>
    <li><a href="https://vc.kntu.ac.ir/course/view.php?id=2">template</a></li>
    </ul></div></aside>`;
  const found = extractEnrollmentCodes(html);
  assert.equal(found[120].code, '4051-1110274-23');
  assert.equal(found[120].name, 'آز فيزيك2');
  assert.equal(found[168].code, '4051-1112034-12');
  assert.equal(found[3].code, '4051-1111559-11');   // Persian digits normalise
  assert.equal(found[2], undefined);                 // no code → no guess
  assert.deepEqual(extractEnrollmentCodes('<p>nothing here</p>'), {});
});

test('an unbound class still names itself once the site code is known', () => {
  const line = classLine(null, new Map(), '4051-1110274-23');
  assert.equal(line, '🏫 کلاس 23 — کد 4051-1110274-23');
  assert.equal(classLine(null, new Map(), null), null);
  // A manual binding wins over the detected code, but both identify the class.
  assert.equal(classLine({ code: '4051-1110274-22', professorName: 'طباطبایی' }, new Map(), '4051-1110274-23'),
    '🏫 کلاس 22 — کد 4051-1110274-22 — استاد طباطبایی');
});
