const app = window.Telegram?.WebApp;
const $ = id => document.getElementById(id);
const state = { data: null, busy: false, tab: 'home', filter: 'all', editing: false };
const available = !!app?.initData;
const fa = value => Number(value ?? 0).toLocaleString('fa-IR');
const errors = {
  UNAUTHORIZED: 'فرم را ببندید و با /personal در پیوی ربات دوباره باز کنید.',
  LOGIN_FAILED: 'ورود موفق نشد؛ نام کاربری و رمز حساب دانشگاهی را بررسی کنید.',
  LOGIN_REQUIRED: 'اتصال منقضی شده؛ از بخش حساب من دوباره وارد شوید.',
  LOGIN_INTERACTION_REQUIRED: 'ورود به دانشگاه به مرحله دیگری نیاز دارد؛ دوباره وارد شوید.',
  LOGIN_FLOW_UNSUPPORTED: 'ساختار ورود دانشگاه تغییر کرده است؛ اتصال نیاز به بررسی دارد.',
  BUSY: 'یک درخواست در حال اجراست یا هنوز یک دقیقه از تلاش قبلی نگذشته؛ کمی بعد امتحان کنید.',
  NOT_CONNECTED: 'ابتدا از بخش حساب من، حساب دانشگاهی را متصل کنید.',
  UNIVERSITY_UNREACHABLE: 'سامانه دانشگاه پاسخ نداد؛ کمی بعد دوباره تلاش کنید.',
  UNIVERSITY_RATE_LIMIT: 'تعداد درخواست‌ها به دانشگاه زیاد شده؛ کمی بعد امتحان کنید.',
  SERVER_CONFIG: 'سرویس اتصال آماده نیست؛ به پشتیبانی اطلاع بدهید.',
  REQUEST_FAILED: 'درخواست کامل نشد؛ دوباره تلاش کنید.',
  INVALID_INPUT: 'نام کاربری و رمز را بررسی کنید.',
  DASHBOARD_LAYOUT: 'ساختار داشبورد دانشگاه تغییر کرده و نیاز به بررسی دارد.',
};
function theme() {
  document.documentElement.dataset.theme = app?.colorScheme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const map = { bg_color: '--bg', secondary_bg_color: '--card', text_color: '--text', hint_color: '--hint', button_color: '--accent', button_text_color: '--accent-text' };
  for (const [key, variable] of Object.entries(map)) {
    const value = app?.themeParams?.[key];
    if (/^#[0-9a-f]{6}$/i.test(value ?? '')) document.documentElement.style.setProperty(variable, value);
  }
  if (/^#[0-9a-f]{6}$/i.test(app?.themeParams?.bg_color ?? '')) document.documentElement.style.setProperty('--card-2', app.themeParams.bg_color);
  try { app?.setHeaderColor?.(app.themeParams?.bg_color ?? (app.colorScheme === 'dark' ? '#12161d' : '#f4f6fa')); } catch { /* older Telegram client */ }
}
app?.ready(); app?.expand(); theme(); app?.onEvent?.('themeChanged', theme);
function message(text, kind = 'info') {
  $('message').textContent = text; $('message').dataset.state = kind; $('message').hidden = !text;
}
function element(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
}
function empty(container, title, hint) {
  const box = element('div', 'empty'); box.append(element('b', '', title), element('span', '', hint)); container.append(box);
}
function controls() {
  const connected = !!state.data?.connected;
  $('view').setAttribute('aria-busy', String(state.busy));
  $('reload').disabled = state.busy || !available;
  $('reload').classList.toggle('spin', state.busy);
  $('refresh').disabled = state.busy || !connected || !available;
  $('disconnect').disabled = state.busy || !connected || !available;
  for (const input of $('connect').querySelectorAll('input, button')) input.disabled = state.busy || !available;
  $('reconnect').disabled = state.busy;
}
function showTab(tab, focus = false) {
  if (!['home', 'courses', 'activity', 'account'].includes(tab)) return;
  state.tab = tab;
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== tab;
  for (const button of document.querySelectorAll('.tabbar [data-tab]')) {
    if (button.dataset.tab === tab) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  if (tab === 'home') app?.BackButton?.hide(); else app?.BackButton?.show();
  if (focus) { window.scrollTo({ top: 0 }); $('view').focus({ preventScroll: true }); }
}
app?.BackButton?.onClick(() => showTab('home', true));
function renderItems(container, items, courses, filtered = false) {
  container.replaceChildren();
  if (!items.length) {
    empty(container, state.data?.connected ? 'موردی ثبت نشده است' : 'ابتدا حسابتان را متصل کنید',
      state.data?.connected ? (filtered ? 'در این دسته فعالیتی پیدا نشد.' : 'پس از همگام‌سازی، فعالیت‌های درس‌ها اینجا نمایش داده می‌شوند.') : 'از بخش حساب من، اتصال شخصی را فعال کنید.'); return;
  }
  const kinds = { assign: 'تکلیف', quiz: 'آزمون', resource: 'فایل', folder: 'پوشه', forum: 'اطلاعیه', page: 'مطلب', book: 'کتاب' };
  for (const item of items) {
    const row = element('article', 'item');
    row.append(element('p', 'item-ctx', courses.get(String(item.courseId)) ?? 'درس دانشگاهی'));
    const head = element('div', 'item-head'); head.append(element('h3', 'item-name', item.name), element('span', 'chip', kinds[item.kind] ?? 'فعالیت')); row.append(head);
    if (item.dates) row.append(element('p', 'item-dates', item.dates));
    if (item.url?.startsWith('https://vc.kntu.ac.ir/')) {
      const link = element('a', 'linkbtn', 'مشاهده در VC ↗'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link);
    }
    container.append(row);
  }
}
function render(data) {
  state.data = data;
  const connected = !!data.connected, courses = data.courses ?? [], items = data.items ?? [];
  const names = new Map(courses.map(c => [String(c.id), c.name]));
  const label = !connected ? 'متصل نشده' : data.state === 'connected' ? 'متصل' : data.state === 'needs_login' ? 'نیازمند ورود' : 'نیازمند بررسی';
  $('connection-chip').textContent = label; $('connection-chip').classList.toggle('accent', connected && data.state === 'connected');
  $('account-state').textContent = label;
  $('hero-title').textContent = connected ? 'درس‌های شما، یک‌جا' : 'به حساب دانشگاه وصل شوید';
  $('hero-description').textContent = connected ? 'فعالیت‌های درس‌ها را ببینید و تغییرات بعدی را در پیوی ربات دریافت کنید.' : 'با یک‌بار اتصال، درس‌ها و فعالیت‌های VC را بدون ورود مکرر دنبال کنید.';
  $('course-count').textContent = connected ? fa(courses.length) : '—';
  $('assignment-count').textContent = connected ? fa(items.filter(i => i.kind === 'assign').length) : '—';
  $('quiz-count').textContent = connected ? fa(items.filter(i => i.kind === 'quiz').length) : '—';
  $('courses-total').textContent = fa(courses.length) + ' درس';
  $('items-total').textContent = fa(items.length) + ' فعالیت';
  $('refresh').hidden = !connected; $('start-connect').hidden = connected;
  $('sync-hint').textContent = connected ? 'پس از اتصال یا همگام‌سازی، برای تلاش بعدی یک دقیقه صبر کنید.' : 'اتصال اختیاری است و اطلاعات فقط برای خودتان نمایش داده می‌شود.';
  $('freshness').dataset.state = connected && data.lastSuccessAt ? (data.state === 'connected' ? 'fresh' : 'stale') : 'aging';
  const date = data.lastSuccessAt && new Date(data.lastSuccessAt);
  const when = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('fa-IR') : 'هنوز همگام‌سازی نشده';
  $('freshness-text').textContent = connected ? when : 'اتصال شخصی و خصوصی';
  $('renewal-state').textContent = data.remember ? 'فعال' : 'غیرفعال'; $('last-sync').textContent = when;
  $('account-summary').hidden = !connected; $('disconnect-card').hidden = !connected;
  $('login-card').hidden = connected && !state.editing && data.state !== 'needs_login';
  $('courses').replaceChildren();
  if (!courses.length) empty($('courses'), connected ? 'هنوز درسی دریافت نشده' : 'درس‌های شما اینجا خواهند بود', connected ? 'حساب را همگام‌سازی کنید.' : 'ابتدا حساب دانشگاهی را متصل کنید.');
  for (const course of courses) {
    const card = element('article', 'card tile'); const heading = element('div', 'course-heading');
    heading.append(element('span', 'tile-icon', '▤'), element('h2', 'tile-name', course.name));
    card.append(heading, element('p', 'tile-line', fa(items.filter(i => String(i.courseId) === String(course.id)).length) + ' فعالیت ثبت‌شده')); $('courses').append(card);
  }
  const visible = items.filter(i => state.filter === 'all' || (state.filter === 'files' ? ['resource','folder','page','book'].includes(i.kind) : i.kind === state.filter));
  renderItems($('items'), visible, names, state.filter !== 'all'); renderItems($('recent'), items.slice(-3).reverse(), names);
  for (const filter of document.querySelectorAll('[data-filter]')) filter.setAttribute('aria-pressed', String(filter.dataset.filter === state.filter));
  controls();
}
async function call(action, input = {}) {
  if (!available) throw new Error('UNAUTHORIZED');
  const response = await fetch('/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, initData: app.initData }), signal: AbortSignal.timeout(90000) });
  let data; try { data = await response.json(); } catch { throw new Error('REQUEST_FAILED'); }
  if (!response.ok) throw new Error(data.error ?? 'REQUEST_FAILED'); return data;
}
async function run(work, loading, success = '') {
  if (state.busy) return;
  state.busy = true; controls(); message(loading);
  try { await work(); message(success || (state.data?.error ? errors[state.data.error] ?? 'اتصال نیاز به بررسی دارد.' : ''), state.data?.error ? 'error' : 'success'); }
  catch (error) { message(errors[error.message] ?? 'درخواست کامل نشد؛ اتصال اینترنت را بررسی و دوباره تلاش کنید.', 'error'); }
  finally { state.busy = false; controls(); }
}
document.addEventListener('click', event => {
  const tab = event.target.closest('[data-tab]'); if (tab) showTab(tab.dataset.tab, true);
  const filter = event.target.closest('[data-filter]'); if (filter && state.data) { state.filter = filter.dataset.filter; render(state.data); }
});
$('toggle-password').onclick = () => {
  const reveal = $('password').type === 'password'; $('password').type = reveal ? 'text' : 'password';
  $('toggle-password').textContent = reveal ? 'پنهان' : 'نمایش'; $('toggle-password').setAttribute('aria-label', reveal ? 'پنهان‌کردن رمز' : 'نمایش رمز'); $('toggle-password').setAttribute('aria-pressed', String(reveal));
};
$('reconnect').onclick = () => { state.editing = true; render(state.data); $('username').focus(); };
$('connect').addEventListener('submit', event => {
  event.preventDefault(); if (state.busy) return;
  const input = { username: $('username').value, password: $('password').value, remember: $('remember').checked };
  $('password').value = ''; $('password').type = 'password'; $('toggle-password').textContent = 'نمایش'; $('toggle-password').setAttribute('aria-pressed','false'); $('toggle-password').setAttribute('aria-label','نمایش رمز');
  run(async () => { const result = await call('connect', input); state.editing = false; $('remember').checked = false; render(result); showTab('home', true); }, 'در حال اتصال به حساب دانشگاهی…', 'حساب متصل شد. برای اولین همگام‌سازی یک دقیقه صبر کنید.');
});
$('refresh').onclick = () => run(async () => render(await call('refresh')), 'در حال همگام‌سازی درس‌ها…', 'اطلاعات حساب به‌روز شد.');
$('reload').onclick = () => run(async () => render(await call('status')), 'در حال دریافت وضعیت…');
$('disconnect').onclick = async () => {
  if (state.busy) return;
  const confirmed = app?.showConfirm ? await new Promise(resolve => app.showConfirm('اتصال، اطلاعات ورود و کش شخصی حذف شوند؟', resolve)) : window.confirm('اتصال، اطلاعات ورود و کش شخصی حذف شوند؟');
  if (!confirmed) return;
  run(async () => { await call('disconnect'); $('username').value = ''; $('password').value = ''; $('remember').checked = false; state.editing = false; render({ connected: false }); showTab('home', true); }, 'در حال حذف اتصال…', 'اتصال و اطلاعات شخصی حذف شدند.');
};
render({ connected: false });
if (available) run(async () => { const data = await call('status'); render(data); if (data.error) message(errors[data.error] ?? 'اتصال نیاز به بررسی دارد.', 'error'); }, 'در حال دریافت وضعیت…');
else message('برای اتصال حساب، این صفحه را از دستور /personal در پیوی ربات باز کنید.', 'error');
