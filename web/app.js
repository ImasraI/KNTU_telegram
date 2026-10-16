// Public student Mini App. Plain ES modules: no bundler, no npm packages, no
// secret ever reaches this file. Every call goes to the bot's own `student`
// endpoint through Telegram.WebApp.Serverless.call, which attaches the
// platform-verified init data — the server decides who the caller is.
const app = window.Telegram?.WebApp ?? null;
const ENDPOINT = 'student';
const ENTRY_TABS = ['home', 'courses', 'feed', 'me', 'help'];

const state = {
  tab: 'home',
  data: null,          // { coverage, courses, me, policy }
  feed: null,          // the "تکلیف‌ها" tab
  feedFilter: 'assign',
  feedScope: 'all',
  detail: null,        // the open course sheet
  detailFilter: 'all',
  help: null,
  query: '',
  registerResult: null,
  busy: false,
  loading: true,
};

const view = document.getElementById('view');
const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheet-body');
const sheetTitle = document.getElementById('sheet-title');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const overlayNote = document.getElementById('overlay-note');
const toastEl = document.getElementById('toast');
const freshness = document.getElementById('freshness');

/* ------------------------------------------------------------------ helpers */
const fa = value => Number(value ?? 0).toLocaleString('fa-IR');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  toastEl.className = kind === 'err' ? 'toast err' : 'toast';
  toastEl.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toastEl.hidden = true; }, kind === 'err' ? 7000 : 4000);
}

function setBusy(busy, text = 'در حال بارگذاری…', note = '') {
  state.busy = busy;
  overlayText.textContent = text;
  overlayNote.textContent = note;
  overlay.hidden = !busy;
}

function emptyState(title, hint) {
  return `<div class="empty">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v4H4Zm0 7h16v9H4Zm3 3h6v2H7Z"/></svg>
    <b>${escapeHtml(title)}</b><span>${escapeHtml(hint)}</span></div>`;
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
  const message = error?.message || 'ارتباط با سرویس برقرار نشد؛ دوباره تلاش کنید.';
  return `<div class="notice err"><b>انجام درخواست ممکن نشد</b>${escapeHtml(message)}
    <div class="btn-row" style="margin-top:10px"><button class="btn ghost" type="button" data-act="refresh">تلاش دوباره</button>
    <button class="btn ghost" type="button" data-act="support">پیام به پشتیبان</button></div></div>`;
}

/* ------------------------------------------------------------------- theme */
function applyTheme() {
  const params = app?.themeParams ?? {};
  const root = document.documentElement.style;
  const map = { bg_color: '--bg', secondary_bg_color: '--card', text_color: '--text', hint_color: '--hint',
    button_color: '--accent', button_text_color: '--accent-text', link_color: '--accent', section_separator_color: '--line' };
  for (const [key, name] of Object.entries(map)) if (params[key]) root.setProperty(name, params[key]);
  if (params.secondary_bg_color) {
    root.setProperty('--card', params.secondary_bg_color);
    root.setProperty('--card-2', params.bg_color ?? params.secondary_bg_color);
  }
}

/* ------------------------------------------------------------------ pieces */
function freshnessPill(check) {
  const label = check?.state === 'unknown' ? 'زمان بررسی نامشخص'
    : `${check.label} · ${relativeTime(check.at)}`;
  return `<span class="freshness" data-state="${escapeHtml(check?.state ?? 'unknown')}"><span class="dot"></span><span class="freshness-text">${escapeHtml(label)}</span></span>`;
}

function coverageCard(data) {
  const { coverage } = data;
  const total = data.courses.reduce((sum, course) => sum + (course.counts?.total ?? 0), 0);
  return `<div class="card hero">
    <div class="hero-top">
      <div>
        <div class="hero-count">${fa(coverage.courses)}</div>
        <div class="muted">درس تحت پوشش</div>
      </div>
      <div class="chips" style="justify-content:flex-end">
        <span class="chip">${coverage.recorded?.olderThanReads ? 'آخرین بررسی کامل' : 'آخرین بررسی'}: ${escapeHtml(coverage.recorded?.at ? relativeTime(coverage.recorded.at) : 'ثبت نشده')}</span>
        ${coverage.recorded?.olderThanReads ? `<span class="chip">تازه‌ترین خواندن درس‌ها: ${escapeHtml(relativeTime(coverage.lastCheckAt))}</span>` : ''}
        <span class="chip accent">هر ${fa(coverage.intervalMinutes)} دقیقه</span>
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

// Say plainly what is stored and when it was read, instead of showing old data as
// if a scan had just run.
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

function courseTile(course) {
  const counts = course.counts ?? {};
  const chips = [
    counts.assign ? `<span class="chip">${fa(counts.assign)} تکلیف</span>` : '',
    counts.exam ? `<span class="chip">${fa(counts.exam)} آزمون</span>` : '',
    counts.file ? `<span class="chip">${fa(counts.file)} فایل</span>` : '',
    counts.notice ? `<span class="chip">${fa(counts.notice)} اطلاعیه</span>` : '',
  ].join('');
  return `<button class="card tile" type="button" data-act="course" data-id="${course.id}">
    <span class="tile-head">
      <span class="tile-name">${escapeHtml(course.name)}</span>
      ${course.classLabel ? `<span class="chip accent">${escapeHtml(course.classLabel)}</span>` : ''}
    </span>
    ${course.professor ? `<span class="tile-line">${escapeHtml(course.professor)}</span>` : ''}
    ${chips ? `<span class="chips">${chips}</span>` : '<span class="tile-line">محتوایی ثبت نشده است</span>'}
  </button>`;
}

function mineTile(course) {
  return `<button class="card tile" type="button" data-act="course" data-id="${course.id}">
    <span class="tile-head"><span class="tile-name">${escapeHtml(course.name)}</span>
    ${course.classLabel ? `<span class="chip accent">${escapeHtml(course.classLabel)}</span>` : ''}</span>
    ${course.professor ? `<span class="tile-line">${escapeHtml(course.professor)}</span>` : ''}
  </button>`;
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
    <form data-form="register" style="margin-top:12px">
      <label class="field"><span>${escapeHtml(policy.fullNameLabel)}</span>
        <input class="input" id="fullname" name="name" type="text" required minlength="3" maxlength="100"
          autocomplete="off" placeholder="نام و نام خانوادگی در VC" value="${escapeHtml(data.me.name ?? '')}">
        <small>${escapeHtml(policy.fullNameHint)}</small>
      </label>
      <button class="btn" type="submit" ${state.busy ? 'disabled' : ''}>ثبت‌نام و شناسایی خودکار درس‌ها</button>
    </form>
    ${compact ? '' : '<p class="muted" style="margin-top:10px">درس‌ها به‌صورت خودکار و بدون صفحهٔ انتخاب شناسایی می‌شوند؛ نام‌های هم‌نام به‌طور خودکار متصل نمی‌شوند.</p>'}
  </div>`;
}

function notificationCard(data) {
  const me = data.me;
  const on = me.notifications === 'on';
  const paused = me.notifications === 'paused';
  return `<div class="card">
    <div class="item-head"><h2>اعلان شخصی</h2>
      <span class="chip ${on ? 'accent' : ''}">${on ? 'فعال' : paused ? 'متوقف' : 'غیرفعال'}</span></div>
    <p class="muted" style="margin-top:6px">تغییرات بعدی درس‌های شناسایی‌شده در گفت‌وگوی خصوصی ربات ارسال می‌شود. تاریخچه ارسال نمی‌شود.</p>
    <div class="btn-row" style="margin-top:12px">
      ${on ? '<button class="btn ghost" type="button" data-act="stop">توقف اعلان‌ها</button>'
        : '<button class="btn" type="button" data-act="resume">فعال‌کردن اعلان‌ها</button>'}
      <button class="btn ghost" type="button" data-act="tab" data-tab="home">نمای کلی</button>
    </div>
    ${paused ? '<p class="muted" style="margin-top:8px">اعلان‌ها متوقف است؛ با فعال‌کردن، فقط تغییرات بعدی ارسال می‌شود.</p>' : ''}
  </div>`;
}

function itemCard(item, context = null) {
  const links = [
    item.url ? `<button type="button" class="linkbtn primary" data-act="link" data-url="${escapeHtml(item.url)}">باز کردن در سایت دانشگاه</button>` : '',
    ...(item.files ?? []).filter(f => f.url).map(f => `<button type="button" class="linkbtn" data-act="link" data-url="${escapeHtml(f.url)}">📎 ${escapeHtml(f.name || 'پیوست')}</button>`),
  ].join('');
  return `<div class="item">
    <div class="item-head">
      <span class="item-name">${escapeHtml(item.name || 'بدون نام')}</span>
      <span class="chip">${escapeHtml(item.kindLabel)}</span>
    </div>
    ${context ? `<div class="item-ctx">${escapeHtml(context)}</div>` : ''}
    ${item.dates ? `<div class="item-dates">${escapeHtml(item.dates)}</div>` : ''}
    ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
    ${links ? `<div class="files">${links}</div>` : ''}
    ${item.files?.filter(f => !f.url).length ? `<div class="files">${item.files.filter(f => !f.url).map(f => `<span class="chip">📎 ${escapeHtml(f.name)}</span>`).join('')}</div>` : ''}
  </div>`;
}

/* -------------------------------------------------------------------- views */
function viewHome() {
  const data = state.data;
  const mine = myCourses(data);
  const result = state.registerResult;
  return `${result ? registerResultCard(result) : ''}
  ${coverageCard(data)}
  ${!data.me.registered ? `<div class="section">${registerForm(data)}</div>` : ''}
  ${data.me.registered ? `<div class="section">
    <div class="section-head"><h2>درس‌های من</h2><span class="chip">${fa(mine.length)} درس</span></div>
    ${mine.length ? `<div class="grid courses">${mine.map(mineTile).join('')}</div>`
      : `<div class="notice"><b>هنوز درسی شناسایی نشده است</b>درس‌های تازهٔ تحت پوشش برای شما خودکار بررسی می‌شوند. ${escapeHtml(data.policy.support)}</div>`}
    ${data.me.ambiguous ? '<div class="notice warn" style="margin-top:10px"><b>نام شما با چند نفر در فهرست شرکت‌کنندگان یکسان بود</b>برای جلوگیری از اتصال اشتباه، درسی ثبت نشد. برای بررسی به پشتیبان پیام بدهید.</div>' : ''}
  </div>` : ''}
  <div class="section">
    <div class="section-head"><h2>درس‌های تحت پوشش</h2>
      <button class="chip" type="button" data-act="tab" data-tab="courses">همه</button></div>
    ${data.courses.length ? `<div class="grid courses">${data.courses.slice(0, 4).map(courseTile).join('')}</div>`
      : emptyState('هنوز درسی ثبت نشده است', 'پس از اولین بررسی خودکار، فهرست درس‌ها اینجا نمایش داده می‌شود')}
  </div>`;
}

function registerResultCard(result) {
  if (result.queued) return `<div class="notice ok"><b>درخواست ثبت شد</b>درس‌ها همین حالا بررسی می‌شوند؛ نتیجه در این صفحه و پیام خصوصی ربات نمایش داده می‌شود. اگر دانشگاه پاسخ ندهد، خودکار دوباره تلاش می‌کنیم.</div>`;
  if (result.ambiguous) {
    return `<div class="notice warn" style="margin-bottom:12px"><b>درس‌های شما ثبت نشد</b>
      در فهرست شرکت‌کنندگان چند نفر با این نام پیدا شدند و برای جلوگیری از اشتباه چیزی متصل نشد. ${escapeHtml(state.data.policy.support)}</div>`;
  }
  if (!result.courses.length) {
    return `<div class="notice" style="margin-bottom:12px"><b>ثبت‌نام انجام شد</b>
      فعلاً درسی با این نام پیدا نشد. درس‌های تازهٔ تحت پوشش خودکار بررسی می‌شوند. ${escapeHtml(state.data.policy.support)}</div>`;
  }
  return `<div class="notice ok" style="margin-bottom:12px"><b>${fa(result.courses.length)} درس ثبت شد</b>
    ${result.incomplete ? 'بعضی فهرست‌ها در این بررسی قابل خواندن نبود؛ ممکن است فهرست ناقص باشد.' : 'اعلان تغییرات بعدی این درس‌ها برای شما ارسال می‌شود.'}</div>`;
}

function viewCourses() {
  const data = state.data;
  const query = state.query.trim().toLowerCase();
  const list = query
    ? data.courses.filter(course => `${course.name} ${course.professor ?? ''} ${course.classLabel ?? ''}`.toLowerCase().includes(query))
    : data.courses;
  return `<div class="search">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2a8 8 0 1 1-4.9 14.3l-3.4 3.4-1.4-1.4 3.4-3.4A8 8 0 0 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>
    <input class="input" id="search" type="search" placeholder="جست‌وجوی درس، استاد یا شمارهٔ کلاس" value="${escapeHtml(state.query)}">
  </div>
  <p class="muted" style="margin-bottom:10px">${fa(list.length)} درس · ${escapeHtml(data.me.registered ? 'برای دیدن تکلیف‌ها روی هر درس بزنید' : 'مشاهده برای همه آزاد است')}</p>
  <div class="grid courses" id="course-list">
    ${list.length ? list.map(courseTile).join('') : emptyState('درسی پیدا نشد', 'عبارت دیگری را جست‌وجو کنید یا فهرست را دوباره بارگذاری کنید')}
  </div>`;
}

function viewFeed() {
  const feed = state.feed;
  if (!feed) return '<div class="skeleton skeleton-card"></div>';
  const chips = [['assign', 'تکلیف‌ها'], ['exam', 'امتحان‌ها'], ['file', 'فایل‌ها'], ['all', 'همه']];
  return `<div class="segmented">
      ${chips.map(([key, label]) => `<button type="button" data-act="feed-filter" data-filter="${key}" aria-pressed="${state.feedFilter === key}">${label}</button>`).join('')}
    </div>
    <div class="segmented">
      <button type="button" data-act="feed-scope" data-scope="all" aria-pressed="${!feed.scoped}">همهٔ درس‌ها</button>
      <button type="button" data-act="feed-scope" data-scope="mine" aria-pressed="${feed.scoped}">درس‌های من</button>
    </div>
    ${feed.requestedScope === 'mine' && !feed.scoped ? '<div class="notice" style="margin-bottom:10px">برای دیدن تکلیف‌های درس‌های خودتان ابتدا ثبت‌نام کنید؛ اکنون همهٔ درس‌ها نمایش داده می‌شود.</div>' : ''}
    <p class="muted" style="margin-bottom:6px">${fa(feed.total)} مورد در ${fa(feed.courses)} درس · اطلاعات آخرین بررسی (${escapeHtml(relativeTime(feed.scan?.at))})</p>
    <div class="card" id="feed-list">
      ${feed.items.length ? feed.items.map(item => itemCard(item, `${item.courseName}${item.classLabel ? ' · ' + item.classLabel : ''}`)).join('')
        : emptyState('موردی ثبت نشده است', 'با بررسی خودکار بعدی، تکلیف‌ها و امتحان‌های تازه اینجا نمایش داده می‌شوند')}
    </div>
    ${feed.hasMore ? `<button class="btn ghost" type="button" data-act="feed-more" style="margin-top:12px">موارد بیشتر</button>` : ''}`;
}

function viewMe() {
  const data = state.data;
  const mine = myCourses(data);
  return `<div class="card">
    <div class="item-head"><h2>وضعیت من</h2>
      <span class="chip ${data.me.registered ? 'accent' : ''}">${data.me.registered ? 'ثبت‌نام‌شده' : 'ثبت‌نام‌نشده'}</span></div>
    ${data.me.registered ? `<p class="muted" style="margin-top:8px">نام ثبت‌شده: <b>${escapeHtml(data.me.name ?? '—')}</b></p>
      <p class="muted">شناسهٔ ثابت شرکت‌کننده: ${data.me.exactIdentity ? 'ثبت شده (تطبیق دقیق‌تر)' : 'ثبت نشده'}</p>
      <p class="muted">درس‌های شناسایی‌شده: ${fa(mine.length)}</p>`
      : '<p class="muted" style="margin-top:8px">برای شناسایی خودکار درس‌ها ثبت‌نام کنید.</p>'}
  </div>
  ${!data.me.registered ? `<div class="section">${registerForm(data)}</div>` : ''}
  <div class="section">${notificationCard(data)}</div>
  ${data.me.registered ? `<div class="section">
    <div class="section-head"><h2>درس‌های من</h2></div>
    ${mine.length ? `<div class="grid courses">${mine.map(mineTile).join('')}</div>` : '<div class="notice">هنوز درسی شناسایی نشده است.</div>'}
  </div>` : ''}
  <div class="section card">
    <h2>حذف اطلاعات من</h2>
    <p class="muted" style="margin-top:6px">شناسهٔ تلگرام، نام ثبت‌شده، درس‌های شناسایی‌شده و سابقهٔ ارسال حذف می‌شود. اتصال همکاری (در صورت وجود) جداگانه از فرم /setup در چت مدیریت می‌شود.</p>
    <button class="btn danger" type="button" data-act="forget" style="margin-top:12px" ${data.me.registered ? '' : 'disabled'}>حذف اطلاعات شخصی من</button>
  </div>`;
}

function viewHelp() {
  const help = state.help;
  if (!help) return '<div class="skeleton skeleton-card"></div>';
  const data = state.data;
  return `<div class="card">
    <h2>این مینی‌اپ چه کاری می‌کند؟</h2>
    <ol class="steps" style="margin-top:10px">
      <li>درس‌های تحت پوشش را می‌بینید؛ برای مشاهدهٔ عمومی نه تأیید لازم است و نه اطلاعات دانشگاه.</li>
      <li>با ثبت‌نام و فرستادن «${escapeHtml(help.fullNameLabel)}»، درس‌های شما خودکار و بدون صفحهٔ انتخاب شناسایی می‌شود.</li>
      <li>تغییرات بعدی درس‌های شما در گفت‌وگوی خصوصی ربات ارسال می‌شود؛ هر زمان می‌توانید متوقف یا حذف کنید.</li>
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
      <button class="btn ghost" type="button" data-act="commands">دستورهای ربات</button>
    </div>
  </div>
  <div class="section card">
    <h2>دستورهای چت</h2>
    <div class="chips" style="margin-top:8px">${help.commands.map(c => `<span class="chip">/${escapeHtml(c.command)} — ${escapeHtml(c.description)}</span>`).join('')}</div>
  </div>`;
}

function render() {
  const label = freshness.querySelector('.freshness-text');
  if (state.data) {
    const check = state.data.coverage.check;
    freshness.dataset.state = check.state;
    label.textContent = check.state === 'unknown'
      ? 'زمان آخرین بررسی نامشخص'
      : `${check.label} · ${relativeTime(check.at)}`;
  } else {
    // No payload yet: say so instead of implying a check is in progress forever.
    freshness.dataset.state = 'unknown';
    label.textContent = 'اطلاعات در دسترس نیست';
  }
  for (const button of document.querySelectorAll('#tabbar button')) {
    const active = button.dataset.tab ? button.dataset.tab === state.tab
      : button.dataset.feed ? state.tab === 'feed' && button.dataset.feed === state.feedFilter : false;
    button.setAttribute('aria-selected', String(active));
  }
  if (state.loading) return; // the skeleton in the shell stays visible
  if (!state.data) { view.innerHTML = fail(state.error); return; }
  const views = { home: viewHome, courses: viewCourses, feed: viewFeed, me: viewMe, help: viewHelp };
  view.innerHTML = (views[state.tab] ?? viewHome)();
}

/* ------------------------------------------------------------------ actions */
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
    const data = await call('feed', { filter: state.feedFilter, scope: state.feedScope, offset });
    state.feed = more && state.feed
      ? { ...data, items: [...state.feed.items, ...data.items] }
      : data;
    if (state.data && data.me) state.data.me = data.me;
  } catch (error) {
    toast(error.message, 'err');
  }
  render();
}

async function openCourse(id) {
  sheet.hidden = false;
  app?.BackButton?.show?.();
  state.detail = null;
  state.detailFilter = 'all';
  sheetBody.scrollTop = 0;
  sheetTitle.textContent = 'در حال بارگذاری…';
  sheetBody.innerHTML = '<div class="skeleton-wrap"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';
  try {
    state.detail = await call('course', { courseId: id, filter: 'all' });
  } catch (error) {
    sheetBody.innerHTML = fail(error);
    return;
  }
  renderDetail();
}

function closeCourse() {
  sheet.hidden = true;
  app?.BackButton?.hide?.();
  state.detail = null;
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
      <div class="tile-head"><span class="tile-name">${escapeHtml(course.name)}</span>
        ${course.classLabel ? `<span class="chip accent">${escapeHtml(course.classLabel)}</span>` : ''}</div>
      ${course.professor ? `<span class="tile-line">${escapeHtml(course.professor)}</span>` : ''}
      <div class="chips">
        <span class="chip">${fa(counts.assign ?? 0)} تکلیف</span>
        <span class="chip">${fa(counts.exam ?? 0)} آزمون</span>
        <span class="chip">${fa(counts.file ?? 0)} فایل</span>
        <span class="chip">${fa(counts.notice ?? 0)} اطلاعیه</span>
      </div>
      ${freshnessPill(detail.scan)}
    </div>
    <div class="segmented" style="margin-top:14px">
      ${filters.map(([key, label]) => `<button type="button" data-act="detail-filter" data-filter="${key}" aria-pressed="${state.detailFilter === key}">${label}</button>`).join('')}
    </div>
    <div class="card" id="detail-list">
      ${detail.items.items.length ? detail.items.items.map(item => itemCard(item)).join('')
        : emptyState('موردی در این بخش نیست', 'با بررسی بعدی، موارد تازه اینجا نمایش داده می‌شوند')}
    </div>
    ${detail.items.hasMore ? '<button class="btn ghost" type="button" data-act="detail-more" style="margin-top:12px">موارد بیشتر</button>' : ''}
    <p class="muted" style="margin-top:12px">اطلاعات ${escapeHtml(detail.items.total ? fa(detail.items.total) : '۰')} مورد از آخرین بررسی (${escapeHtml(relativeTime(detail.scan?.at))}). ${escapeHtml(detail.policy.support)}</p>`;
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

async function register(name) {
  setBusy(true, 'در حال ثبت درخواست…');
  try {
    const data = await call('register', { name });
    state.data = { ...data };
    state.registerResult = data.result;
    if (data.result.queued) void refreshRegisteredCourses();
    state.tab = data.result.ambiguous || !data.result.courses.length ? 'home' : 'me';
    toast(data.result.queued ? 'درخواست ثبت شد؛ نتیجه در پیام خصوصی ربات ارسال می‌شود.' : data.result.ambiguous ? 'نام شما هم‌نام داشت؛ برای بررسی به پشتیبان پیام بدهید.'
      : data.result.courses.length ? `${fa(data.result.courses.length)} درس شناسایی و ثبت شد.`
        : 'ثبت‌نام انجام شد؛ فعلاً درسی پیدا نشد.');
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
    state.registerResult = data.me.registered ? { queued: data.me.registrationPending, courses: data.me.courses, ambiguous: data.me.ambiguous } : null;
    if (data.me.courses.length) state.tab = 'me';
    render();
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

async function forget() {
  const confirmed = app?.showConfirm ? await new Promise(resolve => app.showConfirm('اطلاعات شخصی شما حذف شود؟ اعلان‌ها متوقف و فهرست درس‌ها پاک می‌شود.', resolve))
    : window.confirm('اطلاعات شخصی شما حذف شود؟');
  if (!confirmed) return;
  await mutate('forget', 'اطلاعات شخصی شما حذف شد.');
  state.registerResult = null;
  state.tab = 'home';
  render();
}

function openUniversityLink(url) {
  if (app?.openLink) app.openLink(url, { try_instant_view: false });
  else window.open(url, '_blank', 'noopener');
}

function switchTab(tab, feedFilter = null) {
  if (feedFilter && tab === 'feed') state.feedFilter = feedFilter;
  state.tab = tab;
  if (tab === 'feed') { state.feed = null; render(); loadFeed(); return; }
  if (tab === 'help' && !state.help) { call('help').then(data => { state.help = data; render(); }).catch(error => { state.help = null; toast(error.message, 'err'); render(); }); }
  render();
  // Back to the top of the new tab: the header is sticky, so scrolling the view
  // itself into place would tuck the first control underneath it.
  window.scrollTo({ top: 0, behavior: 'auto' });
}

/* ------------------------------------------------------------------ wiring */
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  app?.HapticFeedback?.selectionChanged?.();
  if (act === 'tab') { switchTab(target.dataset.feed ? 'feed' : target.dataset.tab, target.dataset.feed ?? null); return; }
  if (act === 'refresh') {
    const button = target;
    button.classList.add('spin');
    await load({ silent: true });
    button.classList.remove('spin');
    toast('اطلاعات به‌روز شد.');
    return;
  }
  if (act === 'course') { openCourse(Number(target.dataset.id)); return; }
  if (act === 'back') { closeCourse(); return; }
  if (act === 'detail-filter') { refreshDetail(target.dataset.filter); return; }
  if (act === 'detail-more') { replaceCourseItems(); return; }
  if (act === 'feed-filter') { state.feedFilter = target.dataset.filter; state.feed = null; render(); loadFeed(); return; }
  if (act === 'feed-scope') { state.feedScope = target.dataset.scope; state.feed = null; render(); loadFeed(); return; }
  if (act === 'feed-more') { loadFeed({ more: true }); return; }
  if (act === 'stop') { mutate('stop', 'اعلان‌های شخصی متوقف شد.'); return; }
  if (act === 'resume') { mutate('resume', 'اعلان‌های شخصی فعال شد؛ فقط تغییرات بعدی ارسال می‌شود.'); return; }
  if (act === 'forget') { forget(); return; }
  if (act === 'link') { openUniversityLink(target.dataset.url); return; }
  if (act === 'tg') { app?.openTelegramLink ? app.openTelegramLink(`https://t.me/${target.dataset.user}`) : window.open(`https://t.me/${target.dataset.user}`, '_blank'); return; }
  if (act === 'bot') { app?.openTelegramLink ? app.openTelegramLink('https://t.me/KNTU_aidbot') : window.open('https://t.me/KNTU_aidbot', '_blank'); return; }
  if (act === 'support') {
    const contact = state.data?.policy?.contact ?? '@Arsam_alaei';
    if (app?.openTelegramLink) app.openTelegramLink(`https://t.me/${contact.replace('@', '')}`);
    return;
  }
  if (act === 'commands') { switchTab('help'); return; }
});

document.addEventListener('submit', async event => {
  const form = event.target.closest('[data-form="register"]');
  if (!form) return;
  event.preventDefault();
  const name = form.elements.name.value.trim();
  if (name.length < 3) { toast('نام کامل خود را وارد کنید.', 'err'); return; }
  await register(name);
});

document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  state.query = event.target.value;
  const list = document.getElementById('course-list');
  if (!list) return;
  const query = state.query.trim().toLowerCase();
  const data = state.data;
  const matches = query
    ? data.courses.filter(course => `${course.name} ${course.professor ?? ''} ${course.classLabel ?? ''}`.toLowerCase().includes(query))
    : data.courses;
  list.innerHTML = matches.length ? matches.map(courseTile).join('')
    : emptyState('درسی پیدا نشد', 'عبارت دیگری را جست‌وجو کنید');
});

/* --------------------------------------------------------------------- init */
applyTheme();
app?.onEvent?.('themeChanged', applyTheme);
app?.ready?.();
app?.expand?.();
app?.disableVerticalSwipes?.();
app?.BackButton?.onClick?.(() => closeCourse());
if (!app?.initData || !app?.Serverless) {
  state.loading = false;
  state.data = null;
  state.error = new Error('این مینی‌اپ را باید از دکمهٔ ربات @KNTU_aidbot در تلگرام باز کنید.');
  render();
} else {
  load();
}
