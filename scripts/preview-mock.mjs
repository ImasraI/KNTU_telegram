// Temporary local harness: serves dist/ and swaps telegram-web-app.js for a mock
// client with fixture data, so both surfaces can be inspected in a browser.
// Not part of the shipped build; deleted after the visual check.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const now = Date.now();
const iso = ms => new Date(ms).toISOString();

const courses = [
  { id: 3, name: 'رياضيات مهندسي', classLabel: 'کلاس 17', professor: 'استاد Mahsan Tavakoli Kakhki', counts: { assign: 2, exam: 1, file: 23, notice: 0, total: 26 }, scan: { at: iso(now - 7 * 60000), ageSeconds: 420, state: 'fresh', label: 'تازه' } },
  { id: 82, name: 'الكترونيك 1', classLabel: '09:00 - 10:30', professor: 'استاد Ebrahim Nadimi', counts: { assign: 1, exam: 0, file: 3, notice: 0, total: 4 }, scan: { at: iso(now - 9 * 60000), ageSeconds: 540, state: 'fresh', label: 'تازه' } },
  { id: 81, name: 'الكترومغناطيس مهندسي', classLabel: null, professor: 'استاد Mohammad Ali Shameli', counts: { assign: 2, exam: 0, file: 11, notice: 0, total: 13 }, scan: { at: iso(now - 9 * 60000), ageSeconds: 555, state: 'fresh', label: 'تازه' } },
  { id: 27, name: 'مدارهاي الكتريكي 2', classLabel: null, professor: 'استاد Zahra Hosseindokht', counts: { assign: 4, exam: 0, file: 6, notice: 0, total: 10 }, scan: { at: iso(now - 26 * 3600 * 1000), ageSeconds: 93600, state: 'stale', label: 'قدیمی' } },
  { id: 104, name: 'آز فيزيك 1', classLabel: null, professor: null, counts: { assign: 0, exam: 0, file: 0, notice: 0, total: 0 }, scan: { at: null, ageSeconds: null, state: 'unknown', label: 'نامشخص' } },
];

const policy = {
  fullNameLabel: 'نام کامل در VC',
  fullNamePrompt: 'نام و نام خانوادگی خود را دقیقاً همان‌طور که در بخش شرکت‌کنندگان VC نمایش داده می‌شود بفرستید.',
  fullNameHint: 'فقط «نام کامل در VC» لازم است؛ رمز عبور یا توکن را نفرستید.',
  support: 'اگر فهرست درس‌ها ناقص یا نادرست است، از بخش پشتیبانی مینی‌اپ به مدیر پیام بدهید.',
  contact: '@Arsam_alaei',
};

const me = {
  registered: true, registrationPending: false, notifications: 'on',
  name: 'Sina Keynejhad', courses: ['3', '82'], ambiguous: false,
  exactIdentity: true, registeredAt: iso(now - 5 * 86400000), aiChat: true,
};

const ai = {
  available: true, enabled: true,
  disclosure: 'گفت‌وگوی هوشمند اختیاری است و فقط پس از روشن‌کردن آن فعال می‌شود. با روشن‌بودن آن، متن پیام شما و اطلاعات عمومی درس‌ها به ارائه‌دهندهٔ مدل (Groq یا Gemini) فرستاده می‌شود. رمز، کوکی، نمره و فهرست دانشجویان فرستاده نمی‌شود.',
};

const coverage = {
  courses: 43,
  lastCheckAt: iso(now - 8 * 60000),
  check: { at: iso(now - 8 * 60000), ageSeconds: 480, state: 'fresh', label: 'تازه' },
  recorded: { at: iso(now - 74 * 60000), check: { at: iso(now - 74 * 60000), state: 'aging', label: 'کمی قدیمی' }, reason: 'scheduled', failedCourses: 1, lostCourses: 0, olderThanReads: true },
  reason: 'scheduled', partial: true, failedCourses: 1, lostCourses: 0, intervalMinutes: 30,
};

const home = { coverage, courses, me, ai, policy };
const stopped = { ...home, me: { ...me, notifications: 'paused' }, result: { notifications: 'paused' } };
const aiOn = { ...home, result: { aiChat: true, memoryCleared: true } };
const aiOff = { ...home, me: { ...me, aiChat: false }, ai: { ...ai, enabled: false }, result: { aiChat: false, memoryCleared: true } };

const feed = {
  scan: { at: iso(now - 8 * 60000), state: 'fresh', label: 'تازه' },
  scope: 'mine', scoped: true, requestedScope: 'mine', period: 'upcoming',
  filter: 'assign', total: 2, offset: 0, hasMore: false, courses: 2,
  me, ai, policy,
  items: [
    { id: 9, kind: 'assign', kindLabel: '📝 تکلیف', bucket: 'assign', name: 'تمرین سری ۳ — تبدیل لاپلاس', dates: null, dueAt: iso(now + 2 * 86400000), done: false, period: 'upcoming', description: 'مسائل ۱ تا ۸ فصل چهارم را تحویل دهید.', files: [{ name: 'hw3.pdf', url: 'https://vc.kntu.ac.ir/pluginfile/hw3.pdf' }], url: 'https://vc.kntu.ac.ir/mod/assign/view.php?id=9', courseId: 3, courseName: 'رياضيات مهندسي', classLabel: 'کلاس 17' },
    { id: 11, kind: 'assign', kindLabel: '📝 تکلیف', bucket: 'assign', name: 'آزمایش ۲ — مدارهای منطقی', dates: null, dueAt: iso(now + 5 * 86400000), done: true, period: 'upcoming', description: null, files: [], url: 'https://vc.kntu.ac.ir/mod/assign/view.php?id=11', courseId: 82, courseName: 'الكترونيك 1', classLabel: null },
  ],
};

const courseDetail = {
  course: courses[0],
  items: { items: feed.items, total: 2, offset: 0, hasMore: false },
  scan: { at: iso(now - 8 * 60000), state: 'fresh', label: 'تازه' },
  policy,
};

const help = {
  intervalMinutes: 30, contact: '@Arsam_alaei', support: policy.support,
  fullNameLabel: policy.fullNameLabel, fullNamePrompt: policy.fullNamePrompt, fullNameHint: policy.fullNameHint,
  privacy: 'برای مشاهدهٔ عمومی یا دریافت اعلان شخصی، رمز عبور یا توکن دانشگاه لازم نیست. در اشتراک شخصی، شناسهٔ تلگرام، نام اعلام‌شده و درس‌های شناسایی‌شده نگهداری می‌شود.',
  commands: [
    { command: 'register', description: 'ثبت‌نام با نام کامل در VC' },
    { command: 'courses', description: 'فهرست درس‌های تحت پوشش' },
    { command: 'assignments', description: 'تکلیف‌های ثبت‌شده' },
    { command: 'exams', description: 'امتحان‌ها' },
    { command: 'stop', description: 'توقف اعلان‌ها' },
    { command: 'resume', description: 'ادامهٔ اعلان‌ها' },
    { command: 'forget', description: 'حذف اطلاعات شخصی' },
    { command: 'chaton', description: 'فعال‌سازی گفت‌وگوی هوشمند' },
  ],
};

const accounts = {
  role: 'owner', owner: true,
  accounts: [
    { id: 'acc_main', ownerId: 747977517, label: 'حساب اصلی', mode: 'session', enabled: true, hasCredential: true, health: { state: 'ok', courses: 43, at: now - 8 * 60000 } },
    { id: 'acc_second', ownerId: 747977517, label: 'حساب دوم', mode: 'session', enabled: false, hasCredential: true, health: { state: 'auth', courses: 0, at: now - 5 * 3600 * 1000 } },
    { id: 'acc_third', ownerId: 812345678, label: 'همکار — برق', mode: 'session', enabled: true, hasCredential: false, health: { state: 'unknown', courses: null, at: null } },
  ],
  destination: { text: 'گروه اطلاع‌رسانی — موضوع «درس‌ها»', sendable: true, source: 'topic' },
  status: { checkedAt: iso(now - 8 * 60000), reason: 'scheduled', courses: 43, sent: 12, personal: { sent: 5 }, failures: [{ key: 'x' }], lost: [], health: [] },
  pendingDigests: [{ key: 'x', courseId: 3, at: now }],
  limits: ['activities'],
};

const directory = {
  role: 'owner', owner: true,
  professors: [{ code: '4051', name: 'طباطبایی' }, { code: '4052', name: 'رضایی' }],
  courses: [
    { key: 'https://vc.kntu.ac.ir#3', id: 3, name: 'رياضيات مهندسي', text: '🏫 کلاس 17', line: '🏫 کلاس 17', binding: { label: '17', slots: [], professorName: 'استاد Mahsan Tavakoli Kakhki' } },
    { key: 'https://vc.kntu.ac.ir#82', id: 82, name: 'الكترونيك 1', text: '🏫 یکشنبه 09:00 - 10:30', line: '🏫 یکشنبه 09:00 - 10:30', binding: { label: null, slots: [{ weekday: 1, from: '09:00', to: '10:30' }], professorName: 'استاد Ebrahim Nadimi' } },
    { key: 'https://vc.kntu.ac.ir#104', id: 104, name: 'آز فيزيك 1', text: 'بدون تنظیم', line: null, binding: null },
  ],
};

const aiState = {
  config: { enabled: true, provider: 'gemini', model: 'gemini-2.0-flash', dailyUser: 20, dailyGlobal: 800 },
  traits: [
    { key: 'sarcasm', label: 'طعنه و کنایه', low: 'بی‌کنایه', high: 'پر از کنایه', value: 6 },
    { key: 'ego', label: 'اعتمادبه‌نفس', low: 'فروتن', high: 'مغرور', value: 4 },
    { key: 'toxicity', label: 'تندی لحن', low: 'مؤدب', high: 'تند', value: null },
    { key: 'talkative', label: 'پرحرفی', low: 'کوتاه', high: 'پرحرف', value: 7 },
    { key: 'warmth', label: 'گرمی لحن', low: 'رسمی', high: 'خودمانی', value: 8 },
  ],
  media: { count: 3, max: 100 },
  providers: [{ value: 'groq', label: 'Groq' }, { value: 'gemini', label: 'Gemini' }],
  limits: { trait: [0, 10], dailyUser: [1, 100], dailyGlobal: [1, 5000] },
  disclosure: 'گفت‌وگوی هوشمند اختیاری است. متن پیام و اطلاعات عمومی درس‌ها به ارائه‌دهندهٔ مدل فرستاده می‌شود.',
};

const responses = { home, stopped, aiOn, aiOff, feed, course: courseDetail, courses, help, accounts, directory, ai: aiState };

const injected = `<script>
window.__calls = [];
window.__responses = ${JSON.stringify(responses)};
window.__pick = function (name, action, input) {
  var r = window.__responses;
  if (name === 'student') {
    if (action === 'help') return r.help;
    if (action === 'feed') return Object.assign({}, r.feed, {
      period: input.period || 'upcoming',
      items: r.feed.items.filter(function (entry) { return !input.filter || input.filter === 'all' || entry.bucket === input.filter; })
    });
    if (action === 'course') return Object.assign({}, r.course, {
      course: r.courses.find(function (c) { return c.id === Number(input.courseId); }) || r.courses[0]
    });
    if (action === 'aiOff') return r.aiOff;
    if (action === 'aiOn' || action === 'aiClear') return r.aiOn;
    if (action === 'stop') return r.stopped;
    if (action === 'resume') return r.home;
    if (action === 'setHomeworkDone') return r.feed.items[0];
    if (action === 'register') return Object.assign({}, r.home, { result: { queued: true, registered: true, courses: [], ambiguous: false, incomplete: false } });
    return r.home;
  }
  if (name === 'accounts') return r.accounts;
  if (name === 'directory') return r.directory;
  if (name === 'aiAdmin') return r.ai;
  if (name === 'aiStatus') return { configured: true };
  if (name === 'check') return { courses: 43, sent: 0, personal: { sent: 0 } };
  if (name === 'setup') return { courses: 43 };
  return {};
};
window.Telegram = { WebApp: {
  initData: 'mock-init-data', initDataUnsafe: {}, themeParams: {},
  ready: function () {}, expand: function () {}, disableVerticalSwipes: function () {}, onEvent: function () {},
  BackButton: { show: function () {}, hide: function () {}, onClick: function () {} },
  HapticFeedback: { selectionChanged: function () {} },
  openLink: function (url) { window.open(url, '_blank'); },
  openTelegramLink: function (url) { window.open(url, '_blank'); },
  showConfirm: function (message, callback) { callback(true); },
  Serverless: { call: function (name, input, callback) {
    var action = (input || {}).action || 'state';
    window.__calls.push({ name: name, action: action });
    setTimeout(function () { callback(null, window.__pick(name, action, input || {})); }, 40);
  } },
} };
</script>`;

const pages = new Map([['/', 'index.html'], ['/setup/', 'setup/index.html']]);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  try {
    if (url.pathname === '/__calls') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(globalThis.__calls ?? []));
      return;
    }
    const page = pages.get(url.pathname) ?? (url.pathname === '' ? 'index.html' : null);
    const file = page ?? url.pathname.replace(/^\//, '');
    let body;
    if (page) {
      body = (await readFile(join(root, page), 'utf8')).replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>', injected);
    } else {
      body = await readFile(join(root, normalize(file)));
    }
    const type = types[extname(page ?? file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  }
});

server.listen(5199, '127.0.0.1', () => console.log('preview on http://127.0.0.1:5199'));
