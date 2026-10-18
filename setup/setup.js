// Setup console — cooperation form and owner management, in one accessible page.
//
// Plain script, no imports and no bundler. Every call goes through
// Telegram.WebApp.Serverless.call with the platform-verified init data; the server
// decides the role and scopes what each caller may see or change. No credential
// value is ever rendered: the accounts endpoint only returns whether one exists.
const app = window.Telegram?.WebApp ?? null;

const STATES = {
  ok: 'سالم', auth: 'نشست منقضی', partial: 'پوشش ناقص', unreachable: 'عدم دسترسی',
  layout: 'تغییر ساختار سایت', error: 'خطا', unknown: 'نامشخص',
};
const PANELS = ['overview', 'connections', 'directory', 'ai'];
const OWNER_PANELS = ['directory', 'ai'];

const state = {
  data: null,
  directory: null,
  ai: null,
  panel: 'overview',
  renewingId: null,
  owner: false,
  query: '',
  loading: true,
};

const $ = id => document.getElementById(id);
const roleEl = $('role');
const healthEl = $('health');
const statusEl = $('status');
const shell = $('shell');
const shellError = $('shell-error');
const accountsEl = $('accounts');
const accountsEmpty = $('accounts-empty');
const form = $('form');
const secretInput = $('secret');
const labelInput = $('label');
const saveButton = $('save');
const cancelButton = $('cancel');
const formTitle = $('form-title');
const renewNote = $('renew-note');
const secretError = $('secret-error');
const classList = $('class-list');
const courseSearch = $('course-search');
const courseSearchCount = $('course-search-count');
const confirmDialog = $('confirm-dialog');

/* ------------------------------------------------------------------ helpers */
// Persian/Arabic-Indic digits become ASCII everywhere; words and the Persian
// calendar stay, so a date reads 1405/7/25 instead of ۱۴۰۵/۷/۲۵.
const latinDigits = value => String(value ?? '').replace(/[۰-۹٠-٩]/g, digit => String(digit.charCodeAt(0) & 0xf));
const num = value => latinDigits(Number(value ?? 0).toLocaleString('en-US'));
const escapeHtml = value => latinDigits(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DATE = 'fa-IR-u-nu-latn';

function relativeTime(value) {
  if (!value) return 'نامشخص';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return 'نامشخص';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 90) return 'همین چند لحظه پیش';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${num(minutes)} دقیقه پیش`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${num(hours)} ساعت پیش`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${num(days)} روز پیش`;
  return new Date(ms).toLocaleDateString(DATE);
}

let statusTimer = null;
function say(message, kind = 'ok') {
  statusEl.textContent = message ?? '';
  statusEl.className = kind === 'err' ? 'status-line err' : 'status-line';
  clearTimeout(statusTimer);
  if (message) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, kind === 'err' ? 12000 : 7000);
}

function toneOf(healthState) {
  if (healthState === 'ok') return 'ok';
  if (healthState === 'auth') return 'warn';
  if (!healthState || healthState === 'unknown') return '';
  return 'err';
}

function call(name, input) {
  return new Promise((resolve, reject) => {
    if (!app?.initData || !app?.Serverless) {
      reject(new Error('این صفحه را از @KNTU_aidbot در تلگرام باز کنید.'));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('پاسخ سرویس دیر رسید؛ دوباره تلاش کنید.'));
    }, 120000);
    app.Serverless.call(name, input || {}, (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        const error = new Error(err.message || err.description || 'درخواست انجام نشد.');
        error.code = err.parameters?.code ?? null;
        reject(error);
        return;
      }
      resolve(data);
    });
  });
}

// Panels rebuild their lists, which would drop keyboard focus to the body.
function focusKey(element) {
  if (!element?.dataset || element === document.body) return null;
  if (element.id) return `#${element.id}`;
  const act = element.dataset.act;
  if (!act) return null;
  if (element.dataset.trait) return `[data-act="${act}"][data-trait="${element.dataset.trait}"]`;
  const row = element.closest('[data-account],[data-course]');
  if (row?.dataset.account) return `[data-account="${row.dataset.account}"] [data-act="${act}"]`;
  if (row?.dataset.course) return `[data-course="${row.dataset.course}"] [data-act="${act}"]`;
  return `[data-act="${act}"]`;
}

function restoreFocus(selector) {
  if (!selector) return;
  const element = document.querySelector(selector);
  if (element && element !== document.activeElement) element.focus({ preventScroll: true });
}

// Dark is the default. The choice is stored per user and the Telegram chrome is
// told our background colour; adopting Telegram's own light themeParams would
// otherwise override the dark default on a light client.
const THEME_KEY = 'kntu.theme';
const THEMES = { dark: { bg: '#0d1219' }, light: { bg: '#f1f4f9' } };
const ICONS = {
  light: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-1-6h2v3h-2Zm0 17h2v3h-2ZM2 11h3v2H2Zm17 0h3v2h-3ZM4.9 6.3l1.4-1.4 2.2 2.2-1.4 1.4Zm10.6 10.6 1.4-1.4 2.2 2.2-1.4 1.4ZM4.9 17.7l2.2-2.2 1.4 1.4-2.2 2.2Zm10.6-10.6 2.2-2.2 1.4 1.4-2.2 2.2Z"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14.5A9 9 0 0 1 9.5 3 9 9 0 1 0 21 14.5Z"/></svg>',
};

function savedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* private mode or blocked storage */ }
  return 'dark';
}

function setTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage is optional */ }
  applyTheme();
}

function applyTheme() {
  const theme = savedTheme();
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'dark' ? 'dark light' : 'light dark');
  const next = theme === 'dark' ? 'light' : 'dark';
  const button = document.querySelector('[data-act="theme"]');
  if (button) {
    button.innerHTML = ICONS[next];
    button.setAttribute('aria-label', next === 'dark' ? 'تغییر به حالت تاریک' : 'تغییر به حالت روشن');
    button.title = next === 'dark' ? 'حالت تاریک' : 'حالت روشن';
  }
  // Telegram's own chrome follows the page, so the header never mismatches it.
  try { app?.setHeaderColor?.(THEMES[theme].bg); } catch { /* older client */ }
  try { app?.setBackgroundColor?.(THEMES[theme].bg); } catch { /* older client */ }
}

function confirmAction(title, text) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise(resolve => {
    const done = () => {
      confirmDialog.removeEventListener('close', done);
      resolve(confirmDialog.returnValue === 'ok');
    };
    confirmDialog.addEventListener('close', done);
  });
}

/* ------------------------------------------------------------------- panels */
function switchPanel(name, { focus = false } = {}) {
  if (!PANELS.includes(name)) name = 'overview';
  if (!state.owner && OWNER_PANELS.includes(name)) name = 'overview';
  state.panel = name;
  for (const button of document.querySelectorAll('[role="tab"]')) {
    const active = button.dataset.panel === name;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('[role="tabpanel"]')) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
  if (focus) $(`nav-${name}`)?.focus();
  if (name === 'ai' && state.owner) void loadAi();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function movePanel(step) {
  const buttons = [...document.querySelectorAll('[role="tab"]')].filter(button => !button.hidden);
  const current = buttons.findIndex(button => button.dataset.panel === state.panel);
  const next = buttons[(current + step + buttons.length) % buttons.length];
  if (!next) return;
  switchPanel(next.dataset.panel, { focus: true });
}

function edgePanel(where) {
  const buttons = [...document.querySelectorAll('[role="tab"]')].filter(button => !button.hidden);
  const next = where === 'first' ? buttons[0] : buttons[buttons.length - 1];
  if (next) switchPanel(next.dataset.panel, { focus: true });
}

/* ----------------------------------------------------------------- overview */
function kpi(value, label, extra = '', tone = '') {
  return `<div class="kpi ${tone}"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span>${extra ? `<small>${escapeHtml(extra)}</small>` : ''}</div>`;
}

function renderOverview() {
  const data = state.data;
  const accounts = data.accounts ?? [];
  const status = data.status ?? null;
  const healthy = accounts.filter(account => account.health?.state === 'ok').length;
  const courses = state.directory?.courses?.length ?? status?.courses ?? 0;
  const checkedAt = status?.checkedAt ?? null;
  const ageMinutes = checkedAt ? (Date.now() - Date.parse(checkedAt)) / 60000 : null;
  const tone = ageMinutes === null ? '' : ageMinutes <= 60 ? 'ok' : ageMinutes <= 240 ? 'warn' : 'err';

  $('kpis').innerHTML = [
    kpi(accounts.length ? `${num(healthy)} از ${num(accounts.length)}` : '—', 'اتصال سالم', accounts.length ? 'حساب‌های دانشگاهی متصل' : 'هنوز اتصالی ثبت نشده', accounts.length && healthy < accounts.length ? 'warn' : accounts.length ? 'ok' : ''),
    kpi(num(courses), 'درس تحت پوشش', 'در آخرین بررسی'),
    kpi(num((status?.sent ?? 0) + (status?.personal?.sent ?? 0)), 'اعلان ارسال‌شده', `${num(status?.personal?.sent ?? 0)} اعلان شخصی`),
    kpi(checkedAt ? relativeTime(checkedAt) : '—', 'آخرین بررسی', status?.reason === 'manual' ? 'بررسی دستی' : 'بررسی خودکار', tone),
  ].join('');

  $('health-note').textContent = accounts.length ? `${num(healthy)} از ${num(accounts.length)} سالم` : '';
  $('health-list').innerHTML = accounts.length
    ? accounts.map(account => {
      const health = account.health ?? {};
      const tone2 = toneOf(health.state);
      return `<div class="row-card">
        <div class="row-top">
          <div>
            <p class="row-title"><span class="health-dot ${tone2}" aria-hidden="true"></span>${escapeHtml(account.label || account.id)}</p>
            <p class="row-sub">${account.mode === 'session' ? 'کوکی نشست' : 'توکن دانشگاه'}${account.enabled ? '' : ' · غیرفعال'} · ${num(health.courses ?? 0)} درس</p>
            <p class="row-sub">آخرین بررسی ${escapeHtml(relativeTime(health.at))}</p>
          </div>
          <span class="badge ${tone2}">${escapeHtml(STATES[health.state] ?? 'نامشخص')}</span>
        </div>
      </div>`;
    }).join('')
    : '<p class="muted">هنوز اتصالی ثبت نشده است. از بخش «اتصال‌ها» یکی اضافه کنید.</p>';

  const destination = data.destination ?? {};
  $('destination').textContent = destination.text || 'مقصدی ثبت نشده است.';
  const badge = $('destination-badge');
  badge.textContent = destination.sendable ? 'فعال' : 'تنظیم‌نشده';
  badge.className = `badge ${destination.sendable ? 'ok' : 'warn'}`;

  const pending = data.pendingDigests ?? [];
  $('digests').innerHTML = pending.length
    ? `<div class="notice warn" style="margin-top:10px"><b>${num(pending.length)} نمای اولیه در انتظار انتشار</b>
        برای ارسال نخستین معرفی درس‌ها، در چت <code>/digest</code> را بزنید.</div>`
    : '';

  $('limits').textContent = 'خوانده می‌شود: فعالیت‌ها، توضیحات و تاریخ‌های قابل مشاهده، پیوست‌های معرفی تکلیف، زمان آزمون و فهرست شرکت‌کنندگان برای تطبیق نام استاد و درس‌های درخواستی دانشجو. فهرست کامل دانشجویان ذخیره یا منتشر نمی‌شود. نمره‌ها، پاسخ‌های تحویلی و پیام‌های خصوصی خوانده نمی‌شود. محتوای فایل PDF، پاسخ‌های تالار و تغییر فایل در همان نشانی بررسی نمی‌شود.';

  $('check-button').hidden = !state.owner;
}

/* -------------------------------------------------------------- connections */
function accountCard(account) {
  const health = account.health ?? {};
  const tone = toneOf(health.state);
  const when = health.at ? relativeTime(health.at) : 'هنوز بررسی نشده';
  const stateLabel = STATES[health.state] ?? 'نامشخص';
  return `<article class="row-card" data-account="${escapeHtml(account.id)}">
    <div class="row-top">
      <div>
        <p class="row-title"><span class="health-dot ${tone}" aria-hidden="true"></span>${escapeHtml(account.label || account.id)}
          ${account.enabled ? '' : '<span class="badge">غیرفعال</span>'}</p>
        <p class="row-sub">${account.mode === 'session' ? 'کوکی نشست' : 'توکن دانشگاه'}${Number.isFinite(Number(health.courses)) ? ` · ${num(health.courses)} درس` : ''} · آخرین بررسی ${escapeHtml(when)}</p>
        ${state.owner ? `<p class="row-sub">صاحب حساب ${escapeHtml(account.ownerId)}</p>` : ''}
        ${account.hasCredential ? '' : '<p class="row-sub">فاقد اعتبار اتصال؛ مقدار تازه ذخیره کنید.</p>'}
      </div>
      <span class="badge ${tone}">${escapeHtml(stateLabel)}</span>
    </div>
    <div class="row-actions">
      <button class="btn ghost small" type="button" data-act="renew" data-id="${escapeHtml(account.id)}">تازه‌سازی مقدار</button>
      <button class="btn ghost small" type="button" data-act="${account.enabled ? 'disable' : 'enable'}" data-id="${escapeHtml(account.id)}">${account.enabled ? 'غیرفعال‌کردن' : 'فعال‌کردن'}</button>
      <button class="btn danger small" type="button" data-act="delete" data-id="${escapeHtml(account.id)}">حذف اتصال</button>
    </div>
  </article>`;
}

function renderAccounts() {
  const accounts = state.data?.accounts ?? [];
  const keepFocus = focusKey(document.activeElement);
  accountsEl.innerHTML = accounts.map(accountCard).join('');
  accountsEmpty.hidden = accounts.length > 0;
  if (!accounts.length) {
    accountsEmpty.innerHTML = '<div class="notice"><b>هنوز اتصالی ثبت نشده است</b>با ثبت مقدار MoodleSession، درس‌های آن حساب به پوشش ربات اضافه می‌شود.</div>';
  }
  $('nav-connections-count').textContent = accounts.length ? num(accounts.length) : '';
  restoreFocus(keepFocus);
}

function updateFormMode() {
  const renewing = !!state.renewingId;
  formTitle.textContent = renewing ? 'تازه‌سازی این اتصال' : 'افزودن اتصال';
  cancelButton.hidden = !renewing;
  renewNote.hidden = !renewing;
  $('secret').required = true;
}

function startRenew(account) {
  state.renewingId = account.id;
  labelInput.value = account.label ?? '';
  secretInput.value = '';
  updateFormMode();
  switchPanel('connections');
  secretInput.focus();
  say(`مقدار تازهٔ «${account.label || account.id}» را وارد کنید.`);
}

/* ----------------------------------------------------------------- directory */
function courseRow(course) {
  const binding = course.binding ?? {};
  const slots = Array.isArray(binding.slots) ? binding.slots : [];
  const slotText = slots.map(slot => `${slot.from ?? ''}${slot.to ? ` - ${slot.to}` : ''}`).join('، ');
  const professor = binding.professor ?? binding.professorName ?? null;
  return `<div class="row-card course-row" data-course="${escapeHtml(course.id)}" data-key="${escapeHtml(course.key ?? '')}">
    <div class="row-top">
      <div>
        <p class="row-title">${escapeHtml(course.name ?? '')}</p>
        <p class="row-sub">${escapeHtml(course.line || course.text || 'بدون تنظیم')}</p>
      </div>
      <span class="badge">#${escapeHtml(course.id)}</span>
    </div>
    <div class="mini-grid">
      <div class="field">
        <label for="label-${course.id}">شمارهٔ کلاس</label>
        <input class="input" id="label-${course.id}" data-f="label" maxlength="20" autocomplete="off"
          placeholder="17" value="${escapeHtml(binding.label ?? '')}">
      </div>
      <div class="field">
        <label for="slots-${course.id}">زمان کلاس (جایگزین شماره)</label>
        <input class="input" id="slots-${course.id}" data-f="slots" maxlength="200" autocomplete="off"
          placeholder="سه‌شنبه 09:00 - 10:30" value="${escapeHtml(slotText)}">
      </div>
    </div>
    <p class="row-sub">استاد از شرکت‌کنندگان: <b>${escapeHtml(professor || 'نامشخص')}</b></p>
    <div class="row-actions">
      <button class="btn ghost small" type="button" data-act="save-class">ذخیره</button>
      <button class="btn ghost small" type="button" data-act="detect">بررسی سایت</button>
      <button class="btn danger small" type="button" data-act="clear-class">حذف تنظیم</button>
    </div>
    <p class="out" role="status" aria-live="polite"></p>
  </div>`;
}

function renderDirectory() {
  const directory = state.directory;
  if (!directory) return;
  const query = state.query.trim().toLowerCase();
  const courses = (directory.courses ?? []).filter(course =>
    !query || `${course.name ?? ''} ${course.binding?.professor ?? ''} ${course.binding?.professorName ?? ''}`.toLowerCase().includes(query));
  $('course-count').textContent = `${num(directory.courses?.length ?? 0)} درس`;
  courseSearchCount.textContent = query ? `${num(courses.length)} نتیجه` : '';
  const keepFocus = focusKey(document.activeElement);
  classList.innerHTML = courses.length ? courses.map(courseRow).join('')
    : '<div class="notice">درسی با این عبارت پیدا نشد.</div>';
  restoreFocus(keepFocus);
  const professors = directory.professors ?? [];
  $('prof-count').textContent = professors.length ? `${num(professors.length)} استاد` : '';
  $('professors').innerHTML = professors.length
    ? professors.slice(0, 60).map(professor => `<span class="chip">${escapeHtml(professor.name)}</span>`).join('')
    : '<p class="muted">هنوز استادی ثبت نشده است.</p>';
}

/* ------------------------------------------------------------------------ ai */
function traitRow(trait) {
  const value = trait.value ?? null;
  const slider = value ?? 5;
  return `<div class="trait" data-trait="${escapeHtml(trait.key)}">
    <div class="trait-head">
      <label for="trait-${trait.key}">${escapeHtml(trait.label)}</label>
      <span class="trait-value" id="trait-value-${trait.key}">${value === null ? 'پیش‌فرض' : num(value)}</span>
    </div>
    <div class="trait-row">
      <input type="range" id="trait-${trait.key}" min="0" max="10" step="1" value="${slider}"
        aria-describedby="trait-scale-${trait.key}">
      <button class="btn ghost" type="button" data-act="trait-save" data-trait="${escapeHtml(trait.key)}">ذخیره</button>
    </div>
    <div class="trait-scale" id="trait-scale-${trait.key}">
      <span>${escapeHtml(trait.low)}</span><span>${escapeHtml(trait.high)}</span>
    </div>
  </div>`;
}

function renderTraits() {
  const ai = state.ai;
  if (!ai) return;
  const keepFocus = focusKey(document.activeElement);
  $('ai-traits').innerHTML = ai.traits.map(traitRow).join('');
  restoreFocus(keepFocus);
}

function renderAi() {
  const ai = state.ai;
  if (!ai) return;
  $('ai-loading').hidden = true;
  $('ai-body').hidden = false;
  const badge = $('ai-badge');
  badge.textContent = ai.config.enabled ? 'روشن' : 'خاموش';
  badge.className = `badge ${ai.config.enabled ? 'ok' : 'warn'}`;
  $('ai-enabled').setAttribute('aria-checked', String(ai.config.enabled));

  const provider = $('ai-provider');
  provider.innerHTML = '<option value="">پیش‌فرض سرویس</option>' +
    ai.providers.map(item => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join('');
  provider.value = ai.config.provider ?? '';
  $('ai-model').value = ai.config.model ?? '';
  $('ai-daily-user').value = ai.config.dailyUser ?? '';
  $('ai-daily-global').value = ai.config.dailyGlobal ?? '';
  $('ai-media-badge').textContent = `${num(ai.media.count)} از ${num(ai.media.max)}`;
  $('ai-disclosure').textContent = ai.disclosure;
  renderTraits();
}

async function loadAi(force = false) {
  if (!state.owner) return;
  if (state.ai && !force) { renderAi(); return; }
  $('ai-loading').hidden = false;
  $('ai-body').hidden = true;
  try {
    state.ai = await call('aiAdmin', { action: 'state' });
    renderAi();
  } catch (error) {
    $('ai-loading').hidden = true;
    say(error.message, 'err');
  }
}

function setService(tone, label, text) {
  const badge = $('ai-service-badge');
  badge.textContent = label;
  badge.className = `badge ${tone}`;
  $('ai-service-text').textContent = text;
}

async function probeAi() {
  setService('', 'در حال بررسی…', 'درخواست وضعیت به سرویس ارسال شد.');
  try {
    const result = await call('aiStatus', { probe: true });
    if (result?.configured === false) {
      setService('warn', 'تنظیم‌نشده', 'سرویس هوش مصنوعی هنوز تنظیم نشده یا کلید مدل در Secretهای کلادفلر ثبت نشده است.');
    } else {
      setService('ok', 'پاسخ داد', 'سرویس به درخواست وضعیت پاسخ داد. برای پاسخ‌دهی گفت‌وگو، کلید مدل باید در همان سرویس تنظیم شده باشد.');
    }
  } catch (error) {
    setService('err', 'بدون پاسخ', error.message);
  }
}

/* --------------------------------------------------------------------- data */
function applyRole() {
  roleEl.textContent = state.owner
    ? 'مدیر ربات: اتصال‌ها، کلاس‌ها، مقصد و گفت‌وگوی هوشمند'
    : state.data?.role === 'contributor'
      ? 'همکار تأییدشده: فقط اتصال خودتان را مدیریت می‌کنید'
      : 'دسترسی همکاری ندارید؛ برای راهنما /cooperate را در ربات بزنید.';
  for (const element of document.querySelectorAll('[data-owner-only]')) element.hidden = !state.owner;
  if (!state.owner) {
    for (const panel of OWNER_PANELS) $(`panel-${panel}`).hidden = true;
  }
}

async function load({ quiet = false } = {}) {
  if (!quiet) shell.setAttribute('aria-busy', 'true');
  try {
    const data = await call('accounts', { action: 'list' });
    state.data = data;
    state.owner = !!data.owner;
    applyRole();
    renderOverview();
    renderAccounts();
    const healthy = (data.accounts ?? []).filter(account => account.health?.state === 'ok').length;
    healthEl.textContent = data.accounts?.length ? `${num(healthy)}/${num(data.accounts.length)} سالم` : 'بدون اتصال';
    healthEl.className = `badge ${data.accounts?.length ? (healthy === data.accounts.length ? 'ok' : 'warn') : 'warn'}`;
    shellError.hidden = true;

    if (state.owner) {
      try {
        state.directory = await call('directory', { action: 'list' });
        renderDirectory();
        renderOverview();
      } catch (error) {
        say(`فهرست درس‌ها بارگذاری نشد: ${error.message}`, 'err');
      }
    }
  } catch (error) {
    if (!state.data) {
      shellError.hidden = false;
      shellError.textContent = error.message;
    } else {
      say(error.message, 'err');
    }
  } finally {
    state.loading = false;
    shell.setAttribute('aria-busy', 'false');
  }
}

/* ------------------------------------------------------------------ actions */
async function handleRowAction(button) {
  const row = button.closest('[data-account]');
  const id = button.dataset.id;
  const action = button.dataset.act;
  const account = (state.data?.accounts ?? []).find(item => item.id === id);
  if (!account) return;

  if (action === 'renew') { startRenew(account); return; }

  if (action === 'delete') {
    const confirmed = await confirmAction('حذف این اتصال؟', 'این حساب دیگر خوانده نمی‌شود؛ سابقهٔ عمومی درس‌ها و پوشش آنها حفظ می‌شود.');
    if (!confirmed) return;
  }

  button.disabled = true;
  try {
    await call('accounts', { action, accountId: id });
    if (state.renewingId === id) { state.renewingId = null; updateFormMode(); }
    await load({ quiet: true });
    say(action === 'delete' ? 'اتصال حذف شد.' : action === 'enable' ? 'اتصال فعال شد.' : 'اتصال غیرفعال شد.');
  } catch (error) {
    say(error.message, 'err');
  } finally {
    button.disabled = false;
  }
}

async function handleCourseAction(button) {
  const row = button.closest('[data-course]');
  const courseId = Number(row.dataset.course);
  const out = row.querySelector('.out');
  const value = field => row.querySelector(`[data-f="${field}"]`)?.value.trim() ?? '';

  if (button.dataset.act === 'clear-class') {
    const confirmed = await confirmAction('حذف تنظیم این درس؟', 'شماره/زمان کلاس و نام استاد دستی این درس پاک می‌شود.');
    if (!confirmed) return;
  }

  button.disabled = true;
  out.textContent = 'در حال انجام…';
  try {
    if (button.dataset.act === 'detect') {
      const found = await call('directory', { action: 'detect', courseId, limit: 1 });
      const entry = found.results?.[0];
      out.textContent = entry?.detected?.available
        ? `استاد: ${(entry.detected.teachers || []).join('، ') || 'نامشخص'}`
        : `صفحهٔ درس خوانده نشد (${entry?.detected?.reason || entry?.error || 'نامشخص'})`;
    } else if (button.dataset.act === 'clear-class') {
      const data = await call('directory', { action: 'clear', courseId });
      state.directory = data;
      renderDirectory();
      renderOverview();
      say(`تنظیم درس #${num(courseId)} حذف شد.`);
    } else {
      await call('directory', { action: 'set', courseId, label: value('label'), slots: value('slots'), source: 'manual' });
      state.directory = await call('directory', { action: 'list' });
      renderDirectory();
      say(`تنظیم درس #${num(courseId)} ذخیره شد.`);
    }
  } catch (error) {
    out.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function saveAi() {
  const enabled = $('ai-enabled').getAttribute('aria-checked') === 'true';
  const provider = $('ai-provider').value;
  const model = $('ai-model').value.trim();
  const dailyUser = $('ai-daily-user').value.trim();
  const dailyGlobal = $('ai-daily-global').value.trim();
  const input = { action: 'save', enabled, provider, model };
  if (dailyUser) input.dailyUser = Number(dailyUser);
  if (dailyGlobal) input.dailyGlobal = Number(dailyGlobal);

  const modelError = $('ai-model-error');
  modelError.hidden = true;
  $('ai-model').setAttribute('aria-invalid', 'false');
  $('ai-save').disabled = true;
  try {
    state.ai = await call('aiAdmin', input);
    renderAi();
    say('تنظیم‌های گفت‌وگو ذخیره شد.');
  } catch (error) {
    if (error.code === 'INVALID' && /مدل/.test(error.message)) {
      modelError.textContent = error.message;
      modelError.hidden = false;
      $('ai-model').setAttribute('aria-invalid', 'true');
      $('ai-model').focus();
    }
    say(error.message, 'err');
  } finally {
    $('ai-save').disabled = false;
  }
}

/* ------------------------------------------------------------------ wiring */
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-act]');
  if (button) {
    const act = button.dataset.act;
    app?.HapticFeedback?.selectionChanged?.();
    if (act === 'theme') {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      say(next === 'dark' ? 'حالت تاریک فعال شد.' : 'حالت روشن فعال شد.');
      return;
    }
    if (act === 'panel') { switchPanel(button.dataset.panel); return; }
    if (act === 'reload') { await load(); say('وضعیت به‌روز شد.'); return; }
    if (act === 'check') {
      button.disabled = true;
      say('در حال بررسی درس‌ها…');
      try {
        const result = await call('check', {});
        await load({ quiet: true });
        say(result.busy ? 'بررسی دیگری در حال اجراست.' : `${num(result.courses ?? 0)} درس بررسی شد؛ ${num(result.sent ?? 0)} اعلان گروهی و ${num(result.personal?.sent ?? 0)} اعلان شخصی ارسال شد.`);
      } catch (error) {
        say(error.message, 'err');
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (['renew', 'enable', 'disable', 'delete'].includes(act)) { await handleRowAction(button); return; }
    if (['save-class', 'detect', 'clear-class'].includes(act)) { await handleCourseAction(button); return; }
    if (act === 'trait-save') {
      const key = button.dataset.trait;
      const input = $(`trait-${key}`);
      button.disabled = true;
      try {
        state.ai = await call('aiAdmin', { action: 'persona', trait: key, value: Number(input.value) });
        renderTraits();
        say('ویژگی شخصیت ذخیره شد.');
      } catch (error) {
        say(error.message, 'err');
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (act === 'ai-probe') { await probeAi(); return; }
    if (act === 'ai-reload') { await loadAi(true); say('تنظیم‌های گفت‌وگو بارگذاری شد.'); return; }
    if (act === 'ai-media-clear') {
      const confirmed = await confirmAction('فهرست رسانه‌ها پاک شود؟', 'گفت‌وگو دیگر گیف یا موسیقی از این فهرست نمی‌فرستد.');
      if (!confirmed) return;
      button.disabled = true;
      try {
        state.ai = await call('aiAdmin', { action: 'media', op: 'clear' });
        renderAi();
        say('فهرست رسانه‌ها پاک شد.');
      } catch (error) {
        say(error.message, 'err');
      } finally {
        button.disabled = false;
      }
      return;
    }
  }

  // Slider feedback is separate from saving: moving a range only updates its value.
  if (event.target.matches('input[type="range"]')) {
    const key = event.target.id.replace('trait-', '');
    const output = $(`trait-value-${key}`);
    if (output) output.textContent = num(event.target.value);
  }
});

document.addEventListener('input', event => {
  if (event.target.matches('input[type="range"]')) {
    const key = event.target.id.replace('trait-', '');
    const output = $(`trait-value-${key}`);
    if (output) output.textContent = num(event.target.value);
    return;
  }
  if (event.target === courseSearch) {
    state.query = courseSearch.value;
    renderDirectory();
  }
});

// The enabled switch only flips its own state; «ذخیرهٔ تنظیم‌ها» persists it.
document.addEventListener('click', event => {
  if (!event.target.closest('#ai-enabled')) return;
  const control = $('ai-enabled');
  control.setAttribute('aria-checked', String(control.getAttribute('aria-checked') !== 'true'));
});

document.addEventListener('keydown', event => {
  if (!event.target.closest?.('.sidenav-list')) return;
  const moves = { ArrowDown: 1, ArrowLeft: 1, ArrowUp: -1, ArrowRight: -1 };
  if (event.key in moves) { event.preventDefault(); movePanel(moves[event.key]); return; }
  if (event.key === 'Home') { event.preventDefault(); edgePanel('first'); return; }
  if (event.key === 'End') { event.preventDefault(); edgePanel('last'); return; }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const secret = secretInput.value.trim();
  const valid = secret.length >= 10 && secret.length <= 256;
  secretInput.setAttribute('aria-invalid', String(!valid));
  secretError.hidden = valid;    secretError.textContent = valid ? '' : 'مقدار MoodleSession را کامل وارد کنید (حداقل 10 نویسه).';
  if (!valid) { secretInput.focus(); return; }

  saveButton.disabled = true;
  say('در حال آزمایش اتصال دانشگاه…');
  try {
    const input = { mode: 'session', secret, label: labelInput.value.trim() };
    if (state.renewingId) input.accountId = state.renewingId;
    const data = await call('setup', input);
    secretInput.value = '';
    state.renewingId = null;
    updateFormMode();
    await load({ quiet: true });
    say(`اتصال برقرار شد؛ ${num(data.courses ?? 0)} درس قابل مشاهده است. نخستین بررسی هر درس، محتوای موجود را بدون ارسال اعلان ثبت می‌کند.`);
    switchPanel('overview');
  } catch (error) {
    say(error.message, 'err');
  } finally {
    saveButton.disabled = false;
  }
});

cancelButton.addEventListener('click', () => {
  state.renewingId = null;
  secretInput.value = '';
  labelInput.value = '';
  secretInput.setAttribute('aria-invalid', 'false');
  secretError.hidden = true;
  updateFormMode();
  say('تازه‌سازی لغو شد.');
});

$('ai-form').addEventListener('submit', event => { event.preventDefault(); void saveAi(); });
confirmDialog.addEventListener('click', event => {
  const button = event.target.closest('button[value]');
  if (!button) return;
  confirmDialog.close(button.value);
});
confirmDialog.addEventListener('cancel', event => { event.preventDefault(); confirmDialog.close('cancel'); });

/* --------------------------------------------------------------------- init */
applyTheme();
app?.ready?.();
app?.expand?.();
app?.disableVerticalSwipes?.();
updateFormMode();
switchPanel('overview');

if (!app?.initData || !app?.Serverless) {
  state.loading = false;
  shell.setAttribute('aria-busy', 'false');
  roleEl.textContent = 'این صفحه را از @KNTU_aidbot در تلگرام باز کنید.';
  shellError.hidden = false;
  shellError.textContent = 'برای بررسی دسترسی و مدیریت اتصال‌ها، این صفحه باید از دکمهٔ ربات در تلگرام باز شود.';
} else {
  load();
}
