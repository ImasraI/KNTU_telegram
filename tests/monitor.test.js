import test from 'node:test';
import assert from 'node:assert/strict';
import { changes, changeSet, mergeBaseline, digest, notification, parseCourse, parseAssignment, safeLink } from '../tgcloud/lib/content.js';
import { connector, classifyFailure, classifyCode, isAuthFailure, failureCode } from '../tgcloud/lib/moodle.js';
const base = 'https://vc.kntu.ac.ir';
// Reduced from the actual KNTU course markup inspected on 2026-10-15.
const courseHtml = `<body id="page-course-view-weeks"><main><ul>
<li id="module-2650"><div class="activity-item"><input disabled><a href="${base}/mod/assign/view.php?id=2650"><span class="instancename">تمرین سری 1 <span class="accesshide"> تکلیف</span></span></a><div data-region="activity-dates"><div><strong>مهلت:</strong> چهارشنبه، 22 مهر 1405، 11:59 عصر</div></div></div></li>
<li id="module-1528"><a href="${base}/mod/forum/view.php?id=1528"><span class="instancename">تاریخ آزمون میان ترم <span class="accesshide">تالار گفتگو</span></span></a><div class="activity-altcontent activity-description"><p>آزمون در تاریخ 1405/9/7 برگزار می شود.</p></div></li>
<li id="module-1487"><a href="${base}/mod/resource/view.php?id=1487"><span class="instancename">مرجع درس <span>فایل</span></span></a></li>
</ul></main></body>`;
const item = { id: 1, kind: 'assign', name: 'HW', description: '', dates: 'Friday', files: [], url: base + '/mod/assign/view.php?id=1' };

test('KNTU markup extracts homework, Persian dates, files and forum exam descriptions', () => {
  const items = parseCourse(courseHtml, base);
  assert.equal(items.length, 3); assert.equal(items[0].name, 'تمرین سری 1');
  assert.match(items[0].dates, /22 مهر/); assert.match(items[1].description, /1405\/9\/7/);
  assert.equal(items[2].kind, 'resource');
});
test('assignment attachments exclude private submission files and grading table', () => {
  const files = parseAssignment(`<body id="page-mod-assign-view"><a href="${base}/pluginfile.php/20993/mod_assign/introattachment/0/hw.pdf?forcedownload=1">hw.pdf</a><a href="${base}/pluginfile.php/9/assignsubmission_file/submission_files/answer.pdf">answer.pdf</a><table>Grade 10</table></body>`, base);
  assert.deepEqual(files.map(x => x.name), ['hw.pdf']);
});
test('unchanged content is silent, while deadline and attachment changes are announced', () => {
  assert.equal(changes([item], [{ ...item }]).length, 0);
  assert.equal(changes([item], [{ ...item, dates: 'Saturday' }])[0].change, 'updated');
  assert.equal(changes([item], [{ ...item, files: [{name:'hw.pdf', modified:1}] }]).length, 1);
  assert.equal(changes([item], [{ ...item, id: 2 }])[0].change, 'new');
  assert.deepEqual(changes([item], []), []);
});
test('markup mismatch fails rather than accepting a login page as an empty course', () => {
  assert.throws(() => parseCourse('<body id="page-login-index">Login</body>', base), /COURSE_LAYOUT/);
});
test('credential-bearing URLs and foreign origins cannot be published', () => {
  for (const u of [base + '.evil/x', '//evil/x', base + '/file?wstoken=secret', base + '/file?token=secret']) assert.equal(safeLink(u, base), null);
  assert.equal(safeLink('/mod/quiz/view.php?id=3', base), base + '/mod/quiz/view.php?id=3');
});
test('notification text fits Telegram length and retains Persian', () => {
  const text = notification({ fullname:'رياضيات مهندسي' }, {...item, description:'x'.repeat(10000), change:'new'});
  assert.ok(text.length <= 4000); assert.match(text, /رياضيات/); assert.ok(text.endsWith(item.url));
});
test('session login expiry is explicit and secret is sent only as a cookie', async () => {
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(base + '/')); assert.equal(options.headers.Cookie, 'MoodleSession=TESTSECRET');
    assert.ok(!url.includes('TESTSECRET'));
    return {ok:true, url:base+'/login/index.php', text:async()=>'<body id="page-login-index">'};
  };
  await assert.rejects(connector(fetcher, {mode:'session', secret:'TESTSECRET'}).courses(), /LOGIN_REQUIRED/);
});
test('session discovers courses from the calendar selector rather than a hardcoded enrollment', async () => {
  const f = async()=>({ok:true,text:async()=>'<select id="calendar-course-filter-1"><option value="1">All</option><option value="3">رياضيات</option><option value="999">New course</option></select>'});
  assert.deepEqual((await connector(f,{mode:'session',secret:'test'}).courses()).map(c=>c.id), [3,999]);
});
test('API discovers enrollment and extracts assignments without returning API download tokens', async () => {
  const f = async(url, options)=>{
    assert.ok(!url.includes('PRIVATE'));
    const p = new URLSearchParams(options.body); assert.equal(p.get('wstoken'),'PRIVATE');
    const payloads = {
      core_webservice_get_site_info:{userid:2066}, core_enrol_get_users_courses:[{id:3,fullname:'Math'}],
      core_course_get_contents:[{modules:[{id:9,modname:'assign',name:'HW',url:base+'/mod/assign/view.php?id=9'}]}],
      mod_assign_get_assignments:{courses:[{assignments:[{cmid:9,duedate:1792080000,intro:'<p>Read</p>',introattachments:[{filename:'hw.pdf',fileurl:base+'/file?token=PRIVATE',timemodified:4}]}]}]},
    };
    return {ok:true,json:async()=>payloads[p.get('wsfunction')]};
  };
  const m = connector(f,{mode:'token',secret:'PRIVATE'}); const courses=await m.courses(); const items=await m.items(courses[0]);
  assert.equal(items[0].files[0].name,'hw.pdf'); assert.match(items[0].dates,/UTC/);
  assert.ok(!JSON.stringify(items).includes('PRIVATE'));
});
test('API access errors never echo server content or credentials', async()=>{
  const f=async()=>({ok:true,json:async()=>({exception:'moodle_exception',errorcode:'invalidtoken',message:'PRIVATE'})});
  await assert.rejects(connector(f,{mode:'token',secret:'PRIVATE'}).courses(), /MOODLE_API_ACCESS_DENIED/);
});

test('a reduced view of an activity is absorbed, not announced as an update', () => {
  const rich = { ...item, dates: 'مهلت: 22 مهر', description: 'توضیح', files: [{ name: 'hw.pdf' }] };
  const bare = { ...item, dates: '', description: '', files: [] };
  assert.equal(changes([rich], [bare]).length, 0);
  const set = changeSet([rich], [bare]);
  assert.equal(set.announce.length, 0);
  assert.equal(set.absorbed, 1);
  // Adding information in either direction still announces.
  assert.equal(changes([bare], [rich])[0].change, 'updated');
  assert.equal(changes([item], [{ ...item, dates: 'جمعه' }])[0].change, 'updated');
  // A real deadline move keeps both sides non-empty and is announced.
  assert.equal(changes([rich], [{ ...rich, dates: 'مهلت: 23 مهر' }])[0].change, 'updated');
  // An attachment disappearing is a reduction, so it is absorbed, not announced.
  assert.equal(changes([rich], [{ ...rich, files: [] }]).length, 0);
});

test('the richer observation survives account switches so the baseline cannot flap', () => {
  const rich = { ...item, dates: 'مهلت: 22 مهر', files: [{ name: 'hw.pdf' }] };
  const reduced = { ...item, dates: '', files: [] };
  const merged = mergeBaseline([rich], [reduced]);
  assert.equal(merged[0].dates, 'مهلت: 22 مهر');
  assert.deepEqual(merged[0].files, [{ name: 'hw.pdf' }]);
  assert.deepEqual(changes([rich], mergeBaseline([rich], [reduced])), []);
  // Without a previous baseline the current observation is stored as-is.
  assert.deepEqual(mergeBaseline(undefined, [reduced]), [reduced]);
});

test('failure classification drives account health without leaking details', () => {
  for (const c of ['UNIVERSITY_LOGIN_REQUIRED', 'MOODLE_API_ACCESS_DENIED', 'UNIVERSITY_HTTP_401', 'UNIVERSITY_HTTP_403']) {
    assert.equal(classifyCode(c), 'auth'); assert.equal(classifyFailure(new Error(c)), 'auth'); assert.ok(isAuthFailure(new Error(c)));
  }
  assert.equal(classifyCode('UNIVERSITY_UNREACHABLE'), 'unreachable');
  assert.equal(classifyFailure(new Error('COURSE_LAYOUT')), 'layout');
  assert.equal(failureCode(new Error('some private server text')), 'UNIVERSITY_ERROR');
  assert.equal(classifyCode('UNIVERSITY_ERROR'), 'error');
});

test('a connector refuses any origin except the university origin', () => {
  const fetcher = async () => { throw new Error('must not be called'); };
  assert.throws(() => connector(fetcher, { mode: 'session', secret: 'x'.repeat(20), origin: 'https://evil.example' }), /ORIGIN_NOT_ALLOWED/);
  assert.doesNotThrow(() => connector(fetcher, { mode: 'session', secret: 'x'.repeat(20), origin: base }));
});

test('an initial digest stays bounded, in Persian, and lists what already exists', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ ...item, id: i + 1, name: 'تمرین ' + (i + 1), dates: 'مهلت: 1 مهر' }));
  const text = digest({ fullname: 'رياضيات مهندسي' }, items);
  assert.ok(text.length <= 4000);
  assert.match(text, /رياضيات مهندسي/);
  assert.match(text, /40 فعالیت/);
  assert.match(text, /و 25 مورد دیگر/);
  assert.ok(!text.includes('مهلت: 1 مهر'.repeat(20)));
});
