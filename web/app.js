// Public student Mini App. Plain script syntax with no imports: no bundler, no
// npm packages, and no secret ever reaches this file. Every call goes to the
// bot's own `student` endpoint through Telegram.WebApp.Serverless.call, which
// attaches the platform-verified init data — the server decides who the caller is.
const app = window.Telegram?.WebApp ?? null;
const ENDPOINT = 'student';

const TAB_LABELS = { home: 'خانه', courses: 'درس‌ها', feed: 'تکلیف‌ها', me: 'من', help: 'راهنما' };

const state = {
  tab: 'home',
  data: null,           // { coverage, courses, me, ai, policy }
  feed: null,           // the "تکلیف‌ها" tab
  feedFilter: 'assign',
  feedScope: 'all',
  feedPeriod: 'upcoming', // deadline window for homework
  detail: null,         // the open course sheet
  detailFilter: 'all',
  help: null,
  query: '',
  courseScope: 'mine',
  registerResult: null,
  busy: false,
  loading: true,
  error: null,
};

const view = document.getElementById('view');
const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheet-body');
const sheetTitle = document.getElementById('sheet-title');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const overlayNote = document.getElementById('overlay-note');
const toastEl = document.getElementById('toast');
const announcer = document.getElementById('announcer');
const freshness = document.getElementById('freshness');
const tabbar = document.getElementById('tabbar');

/* ------------------------------------------------------------------ helpers */
const fa = value => Number(value ?? 0).toLocaleString('fa-IR');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isLatin = text => /^[\p{Script=Latin}\s.'-]+$/u.test(String(text ?? ''));

function relativeTime(iso) {
  if (!iso) return 'نامشخص';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return 'همین چند لحظه پیش';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${fa(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${fa(hours)} ساعت پیش`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${fa(days)} روز پیش`;
  return new Date(iso).toLocaleDateString('fa-IR');
}

function toast(message, kind = 'ok') {
  toastEl.textContent = message;
  toastEl.className = kind === 'err' ? 'toast err' : kind === 'ok' ? 'toast ok' : 'toast';
  toastEl.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toastEl.hidden = true; }, kind === 'err' ? 7000 : 4000);
}

// Polite announcements: screen readers hear what changed without losing focus.
function announce(message) {
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = message; }, 30);
}

function setBusy(busy, text = 'در حال بارگذاری…', note = '') {
  state.busy = busy;
  overlayText.textContent = text;
  overlayNote.textContent = note;
  overlay.hidden = !busy;
  view.setAttribute('aria-busy', String(busy || state.loading));
}

function emptyState(title, hint, action = '') {
  return `<div class="empty">
    <span class="empty-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5h16v3H4Zm0 5h16v9H4Zm3 3h6v2H7Z"/></svg></span>
    <b>${escapeHtml(title)}</b><span>${escapeHtml(hint)}</span>${action}</div>`;
}

/* ------------------------------------------------------------- api bridge */
function call(action, input = {}) {
  return new Promise((resolve, reject) => {
    if (!app?.initData || !app?.Serverless) {
      reject(new Error('این صفحه را از دکمهٔ ربات @KNTU_aidbot در تلگرام باز کنید.'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('پاسخ سرویس دیر رسید؛ دوباره تلاش کنید.'));
    }, 120000);
    app.Serverless.call(ENDPOINT, { action, ...input }, (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        const error = new Error(err.message || err.description || 'درخواست انجام نشد.');
        error.code = err.parameters?.code ?? null;
        error.type = err.type ?? null;
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

function fail(error) {
  const message = escapeHtml(error?.message || 'ارتباط با سرویس برقرار نشد؛ دوباره تلاش کنید.');
  return `<div class="notice err" role="alert"><b>انجام درخواست ممکن نشد</b>${message}
    <div class="btn-row"><button class="btn ghost" type="button" data-act="retry">تلاش دوباره</button>
    <button class="btn ghost" type="button" data-act="support">پیام به پشتیبان</button></div></div>`;
}

/* ------------------------------------------------------------------- theme */
function applyTheme() {
  const params = app?.themeParams ?? {};
  const root = document.documentElement.style;
  const map = {
    bg_color: '--bg', secondary_bg_color: '--card', text_color: '--text',
    hint_color: '--hint', button_color: '--accent', button_text_color: '--accent-text',
    link_color: '--accent', section_separator_color: '--line',
  };
  for (const [key, name] of Object.entries(map)) if (params[key]) root.setProperty(name, params[key]);
  if (params.secondary_bg_color) {
    root.setProperty('--card', params.secondary_bg_color);
    root.setProperty('--card-2', params.bg_color ?? params.secondary_bg_color);
    root.setProperty('--card-3', params.bg_color ?? params.secondary_bg_color);
  }
}

/* ------------------------------------------------------------------ pieces */
function freshnessPill(check) {
  const label = check?.state === 'unknown' ? 'زمان بررسی نامشخص' : `${check.label} · ${relativeTime(check.at)}`;
  return `<span class="freshness" data-state="${escapeHtml(check?.state ?? 'unknown')}"><span class="dot" aria-hidden="true"></span><span class="freshness-text">${escapeHtml(label)}</span></span>`;
}

function coverageNote(coverage) {
  const every = `به‌روزرسانی خودکار هر ${fa(coverage.intervalMinutes)} دقیقه انجام می‌شود`;
  if (coverage.recorded?.olderThanReads) {
    return `<div class="notice"><b>خواندن درس‌ها از بررسی کامل جدا است</b>
      بعضی درس‌ها بعد از آخرین بررسی کامل خوانده شده‌اند؛ زمان خواندن هر درس در صفحهٔ همان درس آمده است.</div>`;
  }
  if (coverage.check.state === 'fresh' || coverage.check.state === 'aging') return '';
  if (coverage.check.state === 'unknown') {
    return `<div class="notice"><b>اطلاعات ذخیره‌شده است</b>
      زمان آخرین بررسی در دسترس نیست؛ موارد نمایش‌داده‌شده از بررسی‌های پیشین است. ${every}.</div>`;
  }
  return `<div class="notice"><b>اطلاعات ذخیره‌شده است</b>
    آخرین بررسی ${escapeHtml(relativeTime(coverage.lastCheckAt))} انجام شده؛ موارد نمایش‌داده‌شده از همان بررسی است. ${every}.</div>`;
}

function coverageHero(data) {
  const { coverage } = data;
  const mine = myCourses(data);
  const percent = data.courses.length ? Math.round((mine.length / data.courses.length) * 100) : 0;
  const total = data.courses.reduce((sum, course) => sum + (course.counts?.total ?? 0), 0);
  return `<div class="card hero">
    <div class="hero-top">
      <div class="hero-copy">
        <span class="hero-eyebrow">درس تحت پوشش ربات</span>
        <div class="hero-count">${fa(coverage.courses)}</div>
        <div class="chips">
          <span class="chip ${coverage.check.state === 'fresh' ? 'accent' : ''}">${escapeHtml(coverage.check.state === 'unknown' ? 'زمان بررسی نامشخص' : `${coverage.check.label} · ${relativeTime(coverage.check.at)}`)}</span>
          ${coverage.recorded?.at ? `<span class="chip">آخرین بررسی کامل: ${escapeHtml(relativeTime(coverage.recorded.at))}</span>` : ''}
        </div>
      </div>
      <div class="ring" style="--p:${percent}" role="img" aria-label="${data.me.registered ? `${fa(mine.length)} درس از ${fa(coverage.courses)} درس تحت پوشش شما ثبت شده است` : 'هنوز ثبت‌نام نکرده‌اید'}">
        <span class="ring-label">${data.me.registered ? `${fa(percent)}٪` : '—'}<span class="ring-cap">${data.me.registered ? 'از پوشش' : 'بدون ثبت‌نام'}</span></span>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><b>${fa(total)}</b><span>فعالیت ثبت‌شده</span></div>
      <div class="stat"><b>${fa(data.courses.reduce((sum, c) => sum + (c.counts?.assign ?? 0), 0))}</b><span>تکلیف</span></div>
      <div class="stat"><b>${fa(data.courses.reduce((sum, c) => sum + (c.counts?.exam ?? 0), 0))}</b><span>آزمون</span></div>
    </div>
    ${coverage.partial ? `<div class="notice warn"><b>پوشش این بررسی کامل نبود</b>
      ${fa(coverage.failedCourses + coverage.lostCourses)} درس در آخرین بررسی خوانده نشد؛ اطلاعات نمایش‌داده‌شده مربوط به بررسی‌های قبلی است.</div>` : ''}
    ${coverageNote(coverage)}
  </div>`;
}

function professorLine(name) {
  if (!name) return '';
  const initial = String(name).replace(/^استاد\s*/, '').trim().charAt(0) || '؟';
  return `<span class="course-prof"><span class="avatar" aria-hidden="true">${escapeHtml(initial)}</span>
    <span${isLatin(name) ? ' dir="ltr"' : ''}>${escapeHtml(name)}</span></span>`;
}

function courseCard(course) {
  const counts = course.counts ?? {};
  const pills = [
    counts.assign ? `<span class="pill assign"><b>${fa(counts.assign)}</b> تکلیف</span>` : '',
    counts.exam ? `<span class="pill exam"><b>${fa(counts.exam)}</b> آزمون</span>` : '',
    counts.file ? `<span class="pill"><b>${fa(counts.file)}</b> فایل</span>` : '',
    counts.notice ? `<span class="pill"><b>${fa(counts.notice)}</b> اطلاعیه</span>` : '',
  ].join('');
  return `<button class="course" type="button" data-act="course" data-id="${course.id}">
    <span class="course-head">
      <span class="course-name">${escapeHtml(course.name)}</span>
      ${course.classLabel ? `<span class="chip accent">${escapeHtml(course.classLabel)}</span>` : ''}
    </span>
    ${professorLine(course.professor)}
    <span class="course-foot">${pills || '<span class="pill empty">محتوایی ثبت نشده است</span>'}</span>
  </button>`;
}

// Deadline in the student's terms: how long is left, plus the date itself.
function dueLabel(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms).toLocaleDateString('fa-IR', { month: 'long', day: 'numeric' });
  const days = Math.ceil((ms - Date.now()) / 86400000);
  if (days < 0) return `مهلت گذشته · ${date}`;
  if (days === 0) return `مهلت امروز · ${date}`;
  if (days === 1) return `مهلت فردا · ${date}`;
  return `${fa(days)} روز مانده · ${date}`;
}

function itemRow(item, context = null) {
  const due = dueLabel(item.dueAt);
  const links = [
    item.url ? `<button type="button" class="filebtn primary" data-act="link" data-url="${escapeHtml(item.url)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1 1.5 1.5 1-1a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0Zm4-2a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1-1.5-1.5-1 1a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0Z"/></svg>
      باز کردن در سایت دانشگاه</button>` : '',
    ...(item.files ?? []).filter(file => file.url).map(file => `<button type="button" class="filebtn" data-act="link" data-url="${escapeHtml(file.url)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6Zm8 1.5V7h3.5Z"/></svg>
      ${escapeHtml(file.name || 'پیوست')}</button>`),
  ].join('');
  const deadline = `<div class="item-dates"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:14px;height:14px"><path d="M7 2v2H5a2 2 0 0 0-2 2v14h18V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2Zm12 8v10H5V10Z"/></svg>${escapeHtml(due || item.dates)}</div>`;
  // Homework carries the caller's own completion state; it is never shared.
  const tracker = item.period && item.courseId ? `<label class="check">
      <input type="checkbox" data-act="homework-done" data-course="${escapeHtml(item.courseId)}" data-item="${escapeHtml(item.id)}" ${item.done ? 'checked' : ''}>
      <span>انجام شد</span></label>` : '';
  return `<article class="item">
    <div class="item-head">
      <span class="item-name">${escapeHtml(item.name || 'بدون نام')}</span>
      <span class="badge">${escapeHtml(item.kindLabel)}</span>
    </div>
    ${context ? `<div class="item-ctx">${escapeHtml(context)}</div>` : ''}
    ${due || item.dates ? deadline : ''}
    ${tracker}
    ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
    ${links ? `<div class="files">${links}</div>` : ''}
    ${item.files?.filter(file => !file.url).length ? `<div class="files">${item.files.filter(file => !file.url).map(file => `<span class="chip">${escapeHtml(file.name)}</span>`).join('')}</div>` : ''}
  </article>`;
}

function myCourses(data) {
  const ids = new Set(data.me.courses);
  return data.courses.filter(course => ids.has(String(course.id)));
}

function registerForm(data, compact = false) {
  const policy = data.policy;
  return `<div class="card">
    <h2>${escapeHtml(policy.fullNameLabel)}</h2>
    <p class="muted" style="margin-top:6px">${escapeHtml(policy.fullNamePrompt)}</p>
    <form data-form="register" style="margin-top:12px" novalidate>
      <label class="field" for="fullname"><span>${escapeHtml(policy.fullNameLabel)}</span></label>
      <input class="input" id="fullname" name="name" type="text" required minlength="3" maxlength="100"
        autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done"
        aria-describedby="fullname-hint fullname-error" aria-invalid="false"
        placeholder="نام و نام خانوادگی در VC" value="${escapeHtml(data.me.name ?? '')}">
      <p class="form-error" id="fullname-error" role="alert" hidden></p>
      <small class="muted" id="fullname-hint" style="display:block;margin-top:6px">${escapeHtml(policy.fullNameHint)}</small>
      <button class="btn" type="submit" style="margin-top:12px" ${state.busy ? 'disabled' : ''}>ثبت‌نام و شناسایی خودکار درس‌ها</button>
    </form>
    ${compact ? '' : '<p class="muted" style="margin-top:10px">درس‌ها به‌صورت خودکار و بدون صفحهٔ انتخاب شناسایی می‌شوند؛ نام‌های هم‌نام به‌طور خودکار متصل نمی‌شوند.</p>'}
  </div>`;
}

function registerResultCard(result) {
  if (result.queued) {
    return `<div class="notice ok" role="status"><b>درخواست ثبت شد</b>درس‌ها همین حالا بررسی می‌شوند؛ نتیجه در این صفحه و پیام خصوصی ربات نمایش داده می‌شود. اگر دانشگاه پاسخ ندهد، خودکار دوباره تلاش می‌کنیم.</div>`;
  }
  if (result.ambiguous) {
    return `<div class="notice warn" role="status"><b>درس‌های شما ثبت نشد</b>
      در فهرست شرکت‌کنندگان چند نفر با این نام پیدا شدند و برای جلوگیری از اشتباه چیزی متصل نشد. ${escapeHtml(state.data.policy.support)}</div>`;
  }
  if (!result.courses.length) {
    return `<div class="notice" role="status"><b>ثبت‌نام انجام شد</b>
      فعلاً درسی با این نام پیدا نشد. درس‌های تازهٔ تحت پوشش خودکار بررسی می‌شوند. ${escapeHtml(state.data.policy.support)}</div>`;
  }
  return `<div class="notice ok" role="status"><b>${fa(result.courses.length)} درس ثبت شد</b>
    ${result.incomplete ? 'بعضی فهرست‌ها در این بررسی قابل خواندن نبود؛ ممکن است فهرست ناقص باشد.' : 'اعلان تغییرات بعدی این درس‌ها برای شما ارسال می‌شود.'}</div>`;
}

function notificationCard(data) {
  const me = data.me;
  const on = me.notifications === 'on';
  const paused = me.notifications === 'paused';
  return `<div class="card">
    <div class="section-head"><h2>اعلان شخصی</h2>
      <span class="badge ${on ? 'ok' : paused ? 'warn' : ''}">${on ? 'فعال' : paused ? 'متوقف' : 'غیرفعال'}</span></div>
    <p class="muted">تغییرات بعدی درس‌های شناسایی‌شده در گفت‌وگوی خصوصی ربات ارسال می‌شود. تاریخچه ارسال نمی‌شود.</p>
    <button class="switch-field" type="button" role="switch" aria-checked="${on}"
      data-act="${on ? 'stop' : 'resume'}" style="margin-top:12px"
      ${!me.registered && !paused ? 'aria-disabled="true" disabled' : ''}>
      <span class="switch-copy"><b>دریافت اعلان تغییرات</b>
        <small>${on ? 'برای توقف بزنید' : paused ? 'اعلان‌ها متوقف است؛ برای ادامه بزنید' : 'ابتدا ثبت‌نام کنید'}</small></span>
      <span class="switch-track" aria-hidden="true"></span>
    </button>
    ${paused ? '<p class="muted" style="margin-top:8px">با فعال‌کردن، فقط تغییرات بعدی ارسال می‌شود؛ موارد قدیمی ارسال نمی‌شوند.</p>' : ''}
  </div>`;
}

// Optional smart chat. The disclosure text is server-driven, so the client never
// restates privacy policy on its own.
function aiCard(data) {
  const ai = data.ai ?? { available: true, enabled: !!data.me.aiChat, disclosure: '' };
  const available = ai.available !== false;
  const on = !!ai.enabled;
  return `<div class="card">
    <div class="section-head"><h2>گفت‌وگوی هوشمند</h2>
      <span class="badge ${on ? 'ok' : ''}">${on ? 'فعال' : 'خاموش'}</span></div>
    ${ai.disclosure ? `<p class="muted" style="margin-top:6px">${escapeHtml(ai.disclosure)}</p>` : ''}
    <button class="switch-field" type="button" role="switch" aria-checked="${on}"
      data-act="ai-toggle" data-on="${on ? '0' : '1'}" style="margin-top:12px"
      ${available ? '' : 'aria-disabled="true" disabled'}>
      <span class="switch-copy"><b>${available ? (on ? 'گفت‌وگو روشن است' : 'روشن‌کردن گفت‌وگو') : 'فعلاً در دسترس نیست'}</b>
        <small>${available ? (on ? 'برای خاموش‌کردن و پاک‌کردن حافظه بزنید' : 'اختیاری؛ متن پیام به ارائه‌دهندهٔ مدل فرستاده می‌شود') : 'مدیر ربات آن را خاموش کرده است'}</small></span>
      <span class="switch-track" aria-hidden="true"></span>
    </button>
    ${on ? '<button class="btn ghost" type="button" data-act="ai-clear" style="margin-top:8px">پاک‌کردن حافظهٔ گفت‌وگو</button>' : ''}
  </div>`;
}

/* -------------------------------------------------------------------- views */
function viewHome() {
  const data = state.data;
  const mine = myCourses(data);
  const result = state.registerResult;
  return `${result ? `<div style="margin-bottom:12px">${registerResultCard(result)}</div>` : ''}
  ${coverageHero(data)}
  ${data.me.registered ? `<div class="section">
    <div class="section-head"><h2>درس‌های من</h2><span class="badge accent">${fa(mine.length)} درس</span></div>
    ${mine.length ? `<div class="grid courses">${mine.map(courseCard).join('')}</div>`
      : `<div class="notice"><b>هنوز درسی شناسایی نشده است</b>درس‌های تازهٔ تحت پوشش برای شما خودکار بررسی می‌شوند. ${escapeHtml(data.policy.support)}</div>`}
    ${data.me.ambiguous ? '<div class="notice warn" style="margin-top:10px"><b>نام شما با چند نفر در فهرست شرکت‌کنندگان یکسان بود</b>برای جلوگیری از اتصال اشتباه، درسی ثبت نشد. برای بررسی به پشتیبان پیام بدهید.</div>' : ''}
  </div>`
    : `<div class="section">
      <div class="section-head"><h2>شروع کنید</h2><span class="muted">۳ گام</span></div>
      <div class="card">
        <ol class="steps">
          <li><b>درس‌ها را ببینید.</b> مشاهدهٔ عمومی بدون تأیید و بدون اطلاعات دانشگاه است.</li>
          <li><b>«${escapeHtml(data.policy.fullNameLabel)}» را بفرستید.</b> تطبیق دقیق، درس‌ها را خودکار ثبت می‌کند.</li>
          <li><b>اعلان بگیرید.</b> فقط تغییرات بعدی درس‌های شما ارسال می‌شود.</li>
        </ol>
      </div>
      <div style="margin-top:12px">${registerForm(data)}</div>
    </div>`}
  <div class="section">
    <div class="section-head"><h2>درس‌های تحت پوشش</h2>
      <button class="chip" type="button" data-act="tab" data-tab="courses" data-course-scope="all">همه ${fa(data.courses.length)}</button></div>
    ${data.courses.length ? `<div class="grid courses">${data.courses.slice(0, 4).map(courseCard).join('')}</div>`
      : emptyState('هنوز درسی ثبت نشده است', 'پس از اولین بررسی خودکار، فهرست درس‌ها اینجا نمایش داده می‌شود')}
  </div>`;
}

function viewCourses() {
  const data = state.data;
  const query = state.query.trim().toLowerCase();
  const available = state.courseScope === 'all' ? data.courses : myCourses(data);
  const list = query
    ? available.filter(course => `${course.name} ${course.professor ?? ''} ${course.classLabel ?? ''}`.toLowerCase().includes(query))
    : available;
  const mine = new Set(myCourses(data).map(course => String(course.id)));
  return `<div class="segmented" role="group" aria-label="فهرست درس‌ها">
    <button type="button" data-act="course-scope" data-scope="mine" aria-pressed="${state.courseScope === 'mine'}">درس‌های من</button>
    <button type="button" data-act="course-scope" data-scope="all" aria-pressed="${state.courseScope === 'all'}">همهٔ درس‌ها</button>
  </div>
  ${state.courseScope === 'mine' && !data.me.registered ? '<div class="notice">برای شناسایی درس‌های خودتان ابتدا ثبت‌نام یا حساب VC را متصل کنید. همهٔ درس‌ها از گزینهٔ بالا در دسترس است.</div>' : ''}
  <div class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2a8 8 0 1 1-4.9 14.3l-3.4 3.4-1.4-1.4 3.4-3.4A8 8 0 0 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>
    <input class="input" id="search" type="search" inputmode="search" autocomplete="off"
      placeholder="جست‌وجوی درس، استاد یا شمارهٔ کلاس" aria-label="جست‌وجوی درس" value="${escapeHtml(state.query)}">
    <button class="search-clear" type="button" data-act="search-clear" aria-label="پاک‌کردن جست‌وجو" ${state.query ? '' : 'hidden'}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6Z"/></svg>
    </button>
  </div>
  <p class="muted" id="search-count" role="status" aria-live="polite">${fa(list.length)} درس${query ? ' با این جست‌وجو' : ''} · ${data.me.registered ? 'برای دیدن تکلیف‌ها روی هر درس بزنید' : 'مشاهده برای همه آزاد است'}</p>
  <div class="grid courses" id="course-list">
    ${list.length ? list.map(course => courseCard({ ...course, mine: mine.has(String(course.id)) })).join('')
      : emptyState(query ? 'درسی پیدا نشد' : 'هنوز درسی برای شما شناسایی نشده', query ? 'عبارت دیگری را جست‌وجو کنید.' : 'برای مرور فهرست عمومی، همهٔ درس‌ها را انتخاب کنید.',
        query ? '<button class="btn ghost small" type="button" data-act="search-clear">پاک‌کردن جست‌وجو</button>' : '<button class="btn ghost small" type="button" data-act="course-scope" data-scope="all">همهٔ درس‌ها</button>')}
  </div>`;
}

function viewFeed() {
  const feed = state.feed;
  if (!feed) return '<div class="skeleton-wrap" aria-hidden="true"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';
  const kinds = [['assign', 'تکلیف‌ها'], ['exam', 'امتحان‌ها'], ['file', 'فایل‌ها'], ['all', 'همه']];
  const periods = [['upcoming', 'پیش‌رو'], ['past_undone', 'انجام‌نشده'], ['past_done', 'انجام‌شده'], ['unknown', 'بدون تاریخ'], ['all', 'همه']];
  return `<div class="segmented" role="group" aria-label="نوع محتوا">
      ${kinds.map(([key, label]) => `<button type="button" data-act="feed-filter" data-filter="${key}" aria-pressed="${state.feedFilter === key}">${label}</button>`).join('')}
    </div>
    ${state.feedFilter === 'assign' || state.feedFilter === 'all' ? `<div class="segmented" role="group" aria-label="بازهٔ مهلت">
      ${periods.map(([key, label]) => `<button type="button" data-act="feed-period" data-period="${key}" aria-pressed="${state.feedPeriod === key}">${label}</button>`).join('')}
    </div>` : ''}
    <div class="segmented" role="group" aria-label="دامنهٔ درس‌ها">
      <button type="button" data-act="feed-scope" data-scope="all" aria-pressed="${!feed.scoped}">همهٔ درس‌ها</button>
      <button type="button" data-act="feed-scope" data-scope="mine" aria-pressed="${feed.scoped}">درس‌های من</button>
    </div>
    ${feed.requestedScope === 'mine' && !feed.scoped ? '<div class="notice" style="margin-bottom:10px">برای دیدن تکلیف‌های درس‌های خودتان ابتدا ثبت‌نام کنید؛ اکنون همهٔ درس‌ها نمایش داده می‌شود.</div>' : ''}
    <p class="muted" style="margin-bottom:8px">${fa(feed.total)} مورد در ${fa(feed.courses)} درس · اطلاعات آخرین بررسی (${escapeHtml(relativeTime(feed.scan?.at))})</p>
    <div class="card" id="feed-list">
      ${feed.items.length ? feed.items.map(item => itemRow(item, `${item.courseName}${item.classLabel ? ' · ' + item.classLabel : ''}`)).join('')
        : emptyState('موردی ثبت نشده است', 'با بررسی خودکار بعدی، تکلیف‌ها و امتحان‌های تازه اینجا نمایش داده می‌شوند')}
    </div>
    ${feed.hasMore ? '<button class="btn ghost" type="button" data-act="feed-more" style="margin-top:12px">موارد بیشتر</button>' : ''}`;
}

function viewMe() {
  const data = state.data;
  const mine = myCourses(data);
  const me = data.me;
  const status = me.registered
    ? `<span class="badge ok">ثبت‌نام‌شده</span>`
    : me.registrationPending ? '<span class="badge warn">در حال بررسی</span>' : '<span class="badge">ثبت‌نام‌نشده</span>';
  return `<div class="card">
    <div class="section-head"><h2>وضعیت من</h2>${status}</div>
    <dl class="facts">
      <div><dt>نام ثبت‌شده</dt><dd${me.name && isLatin(me.name) ? ' dir="ltr"' : ''}>${escapeHtml(me.name ?? '—')}</dd></div>
      <div><dt>تطبیق هویت</dt><dd>${me.exactIdentity ? 'شناسهٔ ثابت شرکت‌کننده' : me.registered ? 'فقط با نام نمایشی' : '—'}</dd></div>
      <div><dt>درس‌های شناسایی‌شده</dt><dd>${me.registered ? `${fa(mine.length)} درس` : '—'}</dd></div>
      ${me.registeredAt ? `<div><dt>تاریخ ثبت</dt><dd>${escapeHtml(new Date(me.registeredAt).toLocaleDateString('fa-IR'))}</dd></div>` : ''}
      <div><dt>اعلان شخصی</dt><dd>${me.notifications === 'on' ? 'فعال' : me.notifications === 'paused' ? 'متوقف' : 'غیرفعال'}</dd></div>
    </dl>
    ${me.registrationPending ? '<div class="notice info" style="margin-top:10px">درخواست ثبت شما ذخیره شده و در حال بررسی است؛ نتیجه در پیام خصوصی ربات ارسال می‌شود.</div>' : ''}
  </div>
  ${!me.registered ? `<div class="section">${registerForm(data)}</div>` : ''}
  ${me.registered ? `<div class="section">
    <div class="section-head"><h2>درس‌های من</h2><span class="badge accent">${fa(mine.length)}</span></div>
    ${mine.length ? `<div class="grid courses">${mine.map(courseCard).join('')}</div>` : '<div class="notice">هنوز درسی شناسایی نشده است.</div>'}
  </div>` : ''}
  <div class="section">${notificationCard(data)}</div>
  <div class="section">${aiCard(data)}</div>
  <div class="section card">
    <h2>حذف اطلاعات من</h2>
    <p class="muted" style="margin-top:6px">شناسهٔ تلگرام، نام ثبت‌شده، درس‌های شناسایی‌شده و سابقهٔ ارسال حذف می‌شود. اتصال همکاری (در صورت وجود) جداگانه از فرم پشتیبانی مدیریت می‌شود.</p>
    <button class="btn danger" type="button" data-act="forget" style="margin-top:12px" ${me.registered || me.registrationPending ? '' : 'disabled'}>حذف اطلاعات شخصی من</button>
  </div>`;
}

function viewHelp() {
  const help = state.help;
  if (!help) return '<div class="skeleton-wrap" aria-hidden="true"><div class="skeleton skeleton-card"></div></div>';
  const data = state.data;
  return `<div class="card">
    <h2>این مینی‌اپ چه کاری می‌کند؟</h2>
    <ol class="steps">
      <li>درس‌های تحت پوشش را می‌بینید؛ برای مشاهدهٔ عمومی نه تأیید لازم است و نه اطلاعات دانشگاه.</li>
      <li>با ثبت‌نام و فرستادن «${escapeHtml(help.fullNameLabel)}»، درس‌های شما خودکار و بدون صفحهٔ انتخاب شناسایی می‌شود.</li>
      <li>تغییرات بعدی درس‌های شما در گفت‌وگوی خصوصی ربات ارسال می‌شود؛ هر زمان می‌توانید متوقف یا حذف کنید.</li>
      <li>گفت‌وگوی هوشمند اختیاری است و از تب «من» روشن یا خاموش می‌شود.</li>
    </ol>
    <p class="muted" style="margin-top:10px">اطلاعات این مینی‌اپ از آخرین بررسی خودکار است (هر ${fa(help.intervalMinutes)} دقیقه) و «تازه» یا «قدیمی» بودن آن در نوار بالای صفحه دیده می‌شود.</p>
  </div>
  <div class="section card">
    <h2>حریم خصوصی</h2>
    <p class="muted" style="margin-top:8px; white-space:pre-wrap">${escapeHtml(help.privacy)}</p>
  </div>
  <div class="section card">
    <h2>همکاری داوطلبانه</h2>
    <p class="muted" style="margin-top:6px">پوشش درس‌های بیشتر با اشتراک داوطلبانهٔ دسترسی دانشگاهی انجام می‌شود. فقط همکاران تأییدشده به فرم اتصال دسترسی دارند و مقدار اتصال فقط در همان فرم خصوصی وارد می‌شود — هرگز در چت نفرستید. اتصال هر زمان از همان فرم قابل حذف است.</p>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn ghost" type="button" data-act="tg" data-user="${escapeHtml(help.contact.replace('@', ''))}">درخواست همکاری از ${escapeHtml(help.contact)}</button>
      <button class="btn ghost" type="button" data-act="bot">باز کردن ربات</button>
    </div>
  </div>
  <div class="section card">
    <h2>فهرست ناقص یا نادرست است؟</h2>
    <p class="muted" style="margin-top:6px">${escapeHtml(data.policy.support)}</p>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn" type="button" data-act="tg" data-user="${escapeHtml(data.policy.contact.replace('@', ''))}">پیام به ${escapeHtml(data.policy.contact)}</button>
      <button class="btn ghost" type="button" data-act="tab" data-tab="courses">فهرست درس‌ها</button>
    </div>
  </div>
  <div class="section card">
    <h2>دستورهای چت</h2>
    <div class="chips" style="margin-top:8px">${help.commands.map(command => `<span class="chip">/${escapeHtml(command.command)} — ${escapeHtml(command.description)}</span>`).join('')}</div>
  </div>`;
}

/* ------------------------------------------------------------------- render */
// Re-rendering replaces the node the user was on, which would drop keyboard
// focus back to the page body. Remember a stable selector and restore it.
function focusKey(element) {
  if (!element?.dataset || element === document.body) return null;
  if (element.id) return `#${element.id}`;
  const act = element.dataset.act;
  if (!act) return null;
  const scope = element.dataset.feed ? `[data-feed="${element.dataset.feed}"]`
    : element.dataset.item ? `[data-item="${element.dataset.item}"]`
      : element.dataset.tab ? `[data-tab="${element.dataset.tab}"]`
        : element.dataset.id ? `[data-id="${element.dataset.id}"]`
          : element.dataset.filter ? `[data-filter="${element.dataset.filter}"]`
            : element.dataset.period ? `[data-period="${element.dataset.period}"]` : '';
  return `[data-act="${act}"]${scope}`;
}

function restoreFocus(selector) {
  if (!selector) return;
  const element = document.querySelector(selector);
  if (element && element !== document.activeElement) element.focus({ preventScroll: true });
}

function syncTabs() {
  for (const button of tabbar.querySelectorAll('[role="tab"]')) {
    const key = button.dataset.tab ?? 'feed';
    const active = key === state.tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
}

function render() {
  const keepFocus = focusKey(document.activeElement);
  const label = freshness.querySelector('.freshness-text');
  if (state.data) {
    const check = state.data.coverage.check;
    freshness.dataset.state = check.state;
    label.textContent = check.state === 'unknown' ? 'زمان آخرین بررسی نامشخص' : `${check.label} · ${relativeTime(check.at)}`;
  } else {
    // No payload yet: say so instead of implying a check is in progress forever.
    freshness.dataset.state = 'unknown';
    label.textContent = 'اطلاعات در دسترس نیست';
  }
  syncTabs();
  view.setAttribute('aria-busy', String(state.loading || state.busy));
  if (state.loading) return; // the skeleton in the shell stays visible
  if (!state.data) { view.innerHTML = fail(state.error); return; }
  const views = { home: viewHome, courses: viewCourses, feed: viewFeed, me: viewMe, help: viewHelp };
  view.innerHTML = (views[state.tab] ?? viewHome)();
  view.setAttribute('aria-labelledby', `tab-${state.tab}`);
  restoreFocus(keepFocus);
}

/* ------------------------------------------------------------------ loaders */
async function load({ silent = false } = {}) {
  if (!silent) state.loading = true;
  try {
    state.data = await call('home');
    state.error = null;
  } catch (error) {
    if (!state.data) state.error = error;
    else toast(error.message, 'err');
  } finally {
    state.loading = false;
    render();
  }
}

async function loadFeed({ more = false } = {}) {
  const offset = more && state.feed ? state.feed.items.length : 0;
  try {
    const data = await call('feed', {
      filter: state.feedFilter, scope: state.feedScope, offset,
      // Deadline windows only mean something for homework.
      period: state.feedFilter === 'exam' || state.feedFilter === 'file' ? 'all' : state.feedPeriod,
    });
    state.feed = more && state.feed ? { ...data, items: [...state.feed.items, ...data.items] } : data;
    if (state.data && data.me) state.data.me = data.me;
    if (state.data && data.ai) state.data.ai = data.ai;
  } catch (error) {
    toast(error.message, 'err');
  }
  render();
}

async function openCourse(id) {
  sheetTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  sheet.hidden = false;
  app?.BackButton?.show?.();
  state.detail = null;
  state.detailFilter = 'all';
  sheetBody.scrollTop = 0;
  sheetTitle.textContent = 'در حال بارگذاری…';
  sheetBody.setAttribute('aria-busy', 'true');
  sheetBody.innerHTML = '<div class="skeleton-wrap" aria-hidden="true"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';
  requestAnimationFrame(() => sheet.querySelector('[data-act="back"]')?.focus());
  try {
    state.detail = await call('course', { courseId: id, filter: 'all' });
  } catch (error) {
    sheetBody.innerHTML = fail(error);
    return;
  }
  sheetBody.setAttribute('aria-busy', 'false');
  renderDetail();
}

function closeCourse() {
  if (sheet.hidden) return;
  sheet.hidden = true;
  app?.BackButton?.hide?.();
  state.detail = null;
  sheetBody.innerHTML = '';
  sheetTrigger?.focus?.();
  sheetTrigger = null;
  render();
}

function renderDetail() {
  const detail = state.detail;
  if (!detail) return;
  const course = detail.course;
  sheetTitle.textContent = course.name;
  const filters = [['all', 'همه'], ['assign', 'تکلیف‌ها'], ['exam', 'امتحان‌ها'], ['file', 'فایل‌ها'], ['notice', 'اطلاعیه‌ها']];
  const counts = course.counts ?? {};
  sheetBody.innerHTML = `
    <div class="card">
      <div class="section-head"><span class="course-name">${escapeHtml(course.name)}</span>
        ${course.classLabel ? `<span class="chip accent">${escapeHtml(course.classLabel)}</span>` : ''}</div>
      ${professorLine(course.professor)}
      <div class="chips">
        <span class="pill assign"><b>${fa(counts.assign ?? 0)}</b> تکلیف</span>
        <span class="pill exam"><b>${fa(counts.exam ?? 0)}</b> آزمون</span>
        <span class="pill"><b>${fa(counts.file ?? 0)}</b> فایل</span>
        <span class="pill"><b>${fa(counts.notice ?? 0)}</b> اطلاعیه</span>
      </div>
      <p class="muted" style="margin-top:10px">${freshnessPill(detail.scan)}</p>
    </div>
    <div class="segmented" style="margin-top:14px" role="group" aria-label="نوع محتوا">
      ${filters.map(([key, label]) => `<button type="button" data-act="detail-filter" data-filter="${key}" aria-pressed="${state.detailFilter === key}">${label}</button>`).join('')}
    </div>
    <div class="card" id="detail-list">
      ${detail.items.items.length ? detail.items.items.map(item => itemRow(item)).join('')
        : emptyState('موردی در این بخش نیست', 'با بررسی بعدی، موارد تازه اینجا نمایش داده می‌شوند')}
    </div>
    ${detail.items.hasMore ? '<button class="btn ghost" type="button" data-act="detail-more" style="margin-top:12px">موارد بیشتر</button>' : ''}
    <p class="muted" style="margin-top:12px">${escapeHtml(detail.items.total ? `${fa(detail.items.total)} مورد` : 'بدون مورد')} از آخرین بررسی (${escapeHtml(relativeTime(detail.scan?.at))}). ${escapeHtml(detail.policy.support)}</p>`;
}

async function refreshDetail(filter) {
  const id = state.detail.course.id;
  state.detailFilter = filter;
  try {
    state.detail = await call('course', { courseId: id, filter });
  } catch (error) {
    toast(error.message, 'err');
  }
  renderDetail();
}

async function replaceCourseItems() {
  const current = state.detail.items;
  try {
    const data = await call('course', { courseId: state.detail.course.id, filter: state.detailFilter, offset: current.items.length });
    // Append the next page instead of replacing what the student already sees.
    state.detail.items = { ...data.items, items: [...current.items, ...data.items.items] };
  } catch (error) {
    toast(error.message, 'err');
    return;
  }
  renderDetail();
}

/* ---------------------------------------------------------------- mutations */
async function register(name) {
  setBusy(true, 'در حال ثبت درخواست…');
  try {
    const data = await call('register', { name });
    state.data = { ...data };
    state.registerResult = data.result;
    if (data.result.queued) void refreshRegisteredCourses();
    state.tab = data.result.ambiguous || !data.result.courses.length ? 'home' : 'me';
    const message = data.result.queued ? 'درخواست ثبت شد؛ نتیجه در پیام خصوصی ربات ارسال می‌شود.'
      : data.result.ambiguous ? 'نام شما هم‌نام داشت؛ برای بررسی به پشتیبان پیام بدهید.'
        : data.result.courses.length ? `${fa(data.result.courses.length)} درس شناسایی و ثبت شد.`
          : 'ثبت‌نام انجام شد؛ فعلاً درسی پیدا نشد.';
    toast(message);
    announce(message);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    setBusy(false);
    render();
  }
}

async function refreshRegisteredCourses() {
  try {
    const data = await call('refreshRegistration');
    state.data = { ...data };
    state.registerResult = data.me.registered
      ? { queued: data.me.registrationPending, courses: data.me.courses, ambiguous: data.me.ambiguous }
      : null;
    if (data.me.courses.length) state.tab = 'me';
    render();
    if (data.me.registered) {
      const message = data.me.courses.length ? `${fa(data.me.courses.length)} درس شناسایی شد.` : 'ثبت‌نام کامل شد؛ فعلاً درسی پیدا نشد.';
      toast(message);
      announce(message);
    }
  } catch {
    toast('بررسی هنوز کامل نشده؛ درخواست ذخیره شده و نتیجه در پیام خصوصی ارسال می‌شود.');
  }
}

async function mutate(action, text) {
  setBusy(true, 'در حال انجام…');
  try {
    const data = await call(action);
    state.data = { ...data };
    if (text) toast(text);
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    setBusy(false);
    render();
  }
}

// The optional smart chat. Turning it off also asks the shared store to drop this
// user's short memory; the response says whether that deletion happened.
async function setAi(on) {
  setBusy(true, on ? 'در حال روشن‌کردن گفت‌وگو…' : 'در حال خاموش‌کردن و پاک‌کردن حافظه…');
  try {
    const data = await call(on ? 'aiOn' : 'aiOff');
    state.data = { ...state.data, ...data };
    const cleared = data.result?.memoryCleared;
    toast(on ? 'گفت‌وگوی هوشمند روشن شد؛ از این پس می‌توانید در پیوی ربات گفت‌وگو کنید.'
      : cleared ? 'گفت‌وگو خاموش شد و حافظهٔ آن پاک شد.'
        : 'گفت‌وگو خاموش شد؛ حافظهٔ گفت‌وگو در اولین فرصت پاک می‌شود.');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    setBusy(false);
    render();
  }
}

async function clearAiMemory() {
  const confirmed = await confirmDialog('حافظهٔ گفت‌وگو پاک شود؟',
    'خلاصهٔ گفت‌وگوهای قبلی حذف می‌شود. گفت‌وگو روشن می‌ماند و می‌توانید ادامه دهید.', 'پاک‌کردن حافظه');
  if (!confirmed) return;
  setBusy(true, 'در حال پاک‌کردن حافظه…');
  try {
    const data = await call('aiClear');
    state.data = { ...state.data, ...data };
    toast(data.result?.memoryCleared ? 'حافظهٔ گفت‌وگو پاک شد.' : 'حافظه در اولین فرصت پاک می‌شود.');
  } catch (error) {
    toast(error.message, 'err');
  } finally {
    setBusy(false);
    render();
  }
}

// A native <dialog> fallback keeps the confirmation accessible (focus is trapped
// and Escape cancels) when the Telegram client has no built-in confirm sheet.
function confirmDialog(title, body, confirmLabel = 'تأیید') {
  if (app?.showConfirm) return new Promise(resolve => app.showConfirm(`${title}\n\n${body}`, resolve));
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialog.innerHTML = `<div class="dialog-body"><h2 id="dialog-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p></div>
      <div class="dialog-actions"><button class="btn ghost" type="button" data-answer="0">انصراف</button>
      <button class="btn danger" type="button" data-answer="1">${escapeHtml(confirmLabel)}</button></div>`;
    dialog.addEventListener('click', event => {
      const button = event.target.closest('[data-answer]');
      if (!button) return;
      resolve(button.dataset.answer === '1');
      dialog.close();
    });
    dialog.addEventListener('close', () => { resolve(false); dialog.remove(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function forget() {
  const confirmed = await confirmDialog('اطلاعات شخصی شما حذف شود؟',
    'اعلان‌ها متوقف و فهرست درس‌های شناسایی‌شده پاک می‌شود. این کار قابل بازگشت نیست.', 'حذف اطلاعات');
  if (!confirmed) return;
  await mutate('forget', 'اطلاعات شخصی شما حذف شد.');
  state.registerResult = null;
  state.tab = 'home';
  render();
}

/* -------------------------------------------------------------------- links */
function openUniversityLink(url) {
  if (app?.openLink) app.openLink(url, { try_instant_view: false });
  else window.open(url, '_blank', 'noopener');
}

function openTelegramUser(user) {
  if (app?.openTelegramLink) app.openTelegramLink(`https://t.me/${user}`);
  else window.open(`https://t.me/${user}`, '_blank', 'noopener');
}

/* -------------------------------------------------------------- navigation */
function switchTab(tab, feedFilter = null) {
  if (!TAB_LABELS[tab]) tab = 'home';
  if (tab === 'feed' && feedFilter) state.feedFilter = feedFilter;
  const changed = state.tab !== tab;
  state.tab = tab;
  document.title = `${TAB_LABELS[tab]} — درس‌های من`;
  if (changed) announce(`${TAB_LABELS[tab]} نمایش داده شد`);
  if (tab === 'feed') {
    state.feed = null;
    render();
    loadFeed();
    window.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  if (tab === 'help' && !state.help) {
    call('help').then(data => { state.help = data; render(); }).catch(error => { state.help = null; toast(error.message, 'err'); render(); });
  }
  render();
  // Back to the top of the new tab: the header is sticky, so scrolling the view
  // itself into place would tuck the first control underneath it.
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// Arrow keys move between tabs, as expected of a tablist. In RTL the next tab is
// to the left, so ArrowLeft advances.
function focusTab(position) {
  const tabs = [...tabbar.querySelectorAll('[role="tab"]')];
  const current = tabs.findIndex(button => (button.dataset.tab ?? 'feed') === state.tab);
  const index = position === 'first' ? 0 : position === 'last' ? tabs.length - 1
    : (current + (position === 'next' ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[index];
  const key = next.dataset.tab ?? 'feed';
  switchTab(key, next.dataset.feed ?? null);
  syncTabs();
  next.focus();
  if (next.scrollIntoView) next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* ------------------------------------------------------------------ wiring */
let sheetTrigger = null;

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  app?.HapticFeedback?.selectionChanged?.();
  if (act === 'tab') { if(target.dataset.courseScope)state.courseScope=target.dataset.courseScope;switchTab(target.dataset.feed ? 'feed' : target.dataset.tab, target.dataset.feed ?? null); return; }
  if (act === 'course-scope') { state.courseScope=target.dataset.scope==='all'?'all':'mine';render();return; }
  if (act === 'refresh' || act === 'retry') {
    if (!state.data) { state.loading = true; state.error = null; render(); }
    const button = target.closest('.iconbtn');
    button?.classList.add('spin');
    await load({ silent: true });
    button?.classList.remove('spin');
    if (state.data) toast('اطلاعات به‌روز شد.');
    return;
  }
  if (act === 'course') { openCourse(Number(target.dataset.id)); return; }
  if (act === 'back') { closeCourse(); return; }
  if (act === 'detail-filter') { refreshDetail(target.dataset.filter); return; }
  if (act === 'detail-more') { replaceCourseItems(); return; }
  if (act === 'feed-filter') {
    state.feedFilter = target.dataset.filter;
    state.feed = null;
    render();
    loadFeed();
    return;
  }
  if (act === 'feed-scope') {
    state.feedScope = target.dataset.scope;
    state.feed = null;
    render();
    loadFeed();
    return;
  }
  if (act === 'feed-period') {
    state.feedPeriod = target.dataset.period;
    state.feed = null;
    render();
    loadFeed();
    return;
  }
  if (act === 'feed-more') { loadFeed({ more: true }); return; }
  if (act === 'search-clear') {
    state.query = '';
    render();
    document.getElementById('search')?.focus();
    return;
  }
  if (act === 'stop') { mutate('stop', 'اعلان‌های شخصی متوقف شد.'); return; }
  if (act === 'resume') { mutate('resume', 'اعلان‌های شخصی فعال شد؛ فقط تغییرات بعدی ارسال می‌شود.'); return; }
  if (act === 'ai-toggle') { setAi(target.dataset.on === '1'); return; }
  if (act === 'ai-clear') { clearAiMemory(); return; }
  if (act === 'forget') { forget(); return; }
  if (act === 'link') { openUniversityLink(target.dataset.url); return; }
  if (act === 'tg') { openTelegramUser(target.dataset.user); return; }
  if (act === 'bot') { openTelegramUser('KNTU_aidbot'); return; }
  if (act === 'support') { openTelegramUser((state.data?.policy?.contact ?? '@Arsam_alaei').replace('@', '')); return; }
});

document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form="register"]');
  if (!form) return;
  event.preventDefault();
  const input = form.elements.name;
  const errorBox = form.querySelector('[id$="-error"]');
  const name = input.value.replace(/\s+/g, ' ').trim();
  const valid = name.length >= 3 && name.length <= 100;
  input.setAttribute('aria-invalid', String(!valid));
  if (errorBox) {
    errorBox.textContent = valid ? '' : 'نام کامل خود را دقیقاً همان‌طور که در VC نمایش داده می‌شود بنویسید.';
    errorBox.hidden = valid;
  }
  if (!valid) { input.focus(); return; }
  await register(name);
});

// Marking homework done is the caller's own record; the server checks the course
// belongs to them. The list is reloaded so the current window stays truthful.
document.addEventListener('change', async event => {
  const box = event.target.closest('[data-act="homework-done"]');
  if (!box) return;
  box.disabled = true;
  try {
    await call('setHomeworkDone', {
      courseId: Number(box.dataset.course), itemId: Number(box.dataset.item), done: box.checked,
    });
    announce(box.checked ? 'به‌عنوان انجام‌شده ثبت شد.' : 'علامت انجام برداشته شد.');
    await loadFeed();
  } catch (error) {
    box.checked = !box.checked;
    toast(error.message, 'err');
  } finally {
    box.disabled = false;
  }
});

document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  state.query = event.target.value;
  const list = document.getElementById('course-list');
  const count = document.getElementById('search-count');
  const clear = document.querySelector('[data-act="search-clear"]');
  if (clear) clear.hidden = !state.query;
  if (!list) return;
  const query = state.query.trim().toLowerCase();
  const available = state.courseScope === 'all' ? state.data.courses : myCourses(state.data);
  const matches = query
    ? available.filter(course => `${course.name} ${course.professor ?? ''} ${course.classLabel ?? ''}`.toLowerCase().includes(query))
    : available;
  list.innerHTML = matches.length ? matches.map(courseCard).join('')
    : emptyState('درسی پیدا نشد', 'عبارت دیگری را جست‌وجو کنید');
  if (count) count.textContent = `${fa(matches.length)} درس${query ? ' با این جست‌وجو' : ''}`;
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !sheet.hidden) { event.preventDefault(); closeCourse(); return; }
  if (!event.target.closest?.('#tabbar')) return;
  const keys = { ArrowLeft: 'next', ArrowRight: 'prev', Home: 'first', End: 'last' };
  const move = keys[event.key];
  if (!move) return;
  event.preventDefault();
  focusTab(move);
});

// Keep keyboard focus inside the open course sheet.
sheet.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const focusable = [...sheet.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.disabled && element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

/* --------------------------------------------------------------------- init */
applyTheme();
app?.onEvent?.('themeChanged', applyTheme);
app?.ready?.();
app?.expand?.();
app?.disableVerticalSwipes?.();
app?.BackButton?.onClick?.(() => { if (!sheet.hidden) closeCourse(); });
document.title = 'خانه — درس‌های من';
if (!app?.initData || !app?.Serverless) {
  state.loading = false;
  state.data = null;
  state.error = new Error('این مینی‌اپ را باید از دکمهٔ ربات @KNTU_aidbot در تلگرام باز کنید.');
  render();
} else {
  load();
}
