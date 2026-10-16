import { api } from 'sdk';
import { MINI_APP_URL } from './config.js';
import { PUBLIC_HELP, PRIVACY, selectedIds, consented, validFullName, isExam, FULL_NAME_PROMPT, FULL_NAME_HINT } from './student-policy.js';
import { subscriber, saveSubscriber, forgetSubscriber, confirmSubscription, savedItems, registerDetected, registerStudent, stopStudent, resumeStudent, COURSE_SUPPORT } from './subscriptions.js';
import { directorySummary } from './monitor.js';
import { notification } from './content.js';
import { canConnect } from './authorize.js';

const BUTTONS = { '📚 درس‌ها': '/courses', '📝 تکلیف‌ها': '/assignments', '🗓 امتحان‌ها': '/exams',
  '🔔 اعلان شخصی': '/register', 'درس‌های من': '/mycourses', '🤝 همکاری': '/cooperate', 'راهنما': '/help',
  'تأیید درس‌ها': '/confirm', 'لغو': '/cancel', 'توقف اعلان‌ها': '/stop' };
const MENU = { keyboard: [['📚 درس‌ها', '📝 تکلیف‌ها', '🗓 امتحان‌ها'], ['🔔 اعلان شخصی', 'درس‌های من'], ['🤝 همکاری', 'راهنما']], resize_keyboard: true };
const PRIVATE = new Set(['/register', '/name', '/select', '/confirm', '/cancel', '/mycourses', '/stop', '/resume', '/forget', '/cooperate', '/privacy']);

export async function handlePublic(message, role) {
  const privateChat = message.chat?.type === 'private';
  const tgId = message.from?.id;
  const text = String(message.text ?? '').trim();
  const [raw, ...args] = text.split(/\s+/);
  let command = BUTTONS[text] ?? (raw ?? '').replace(/@\w+$/, '').toLowerCase();
  if (command === '/assignment') command = '/assignments';
  const reply = async (value, markup) => api.sendMessage({ chat_id: message.chat.id, text: value,
    link_preview_options: { is_disabled: true }, ...(markup ? { reply_markup: markup } : {}) });
  if (PRIVATE.has(command) && !privateChat) {
    await reply('برای تنظیم اعلان شخصی و حفظ حریم خصوصی، این دستور را در گفت‌وگوی خصوصی ربات اجرا کنید.');
    return true;
  }
  if (command === '/start' || command === '/help') {
    await reply(PUBLIC_HELP, privateChat ? MENU : undefined);
    // The Mini App is the same public data in a browsable form; a button here is
    // how a student finds it, next to the bot's own menu button.
    if (privateChat) await api.sendMessage({ chat_id: message.chat.id,
      text: '📱 مینی‌اپ درس‌ها: دیدن درس‌ها، تکلیف‌ها، امتحان‌ها و فایل‌ها — و ثبت‌نام خودکار درس‌های خودتان.',
      reply_markup: { inline_keyboard: [[{ text: 'باز کردن مینی‌اپ درس‌ها', web_app: { url: MINI_APP_URL } }]] } });
    return true;
  }
  if (command === '/privacy') { await reply(PRIVACY); return true; }
  if (command === '/id') { await reply(`شناسهٔ تلگرام شما: ${tgId}`); return true; }
  if (command === '/cooperate' || (command === '/setup' && !canConnect(role))) {
    await sendBlocks(reply, ['🤝 همکاری داوطلبانه برای پوشش درس‌های بیشتر',
      'استفاده از ربات و اعلان شخصی رایگان است و به همکاری یا تأیید مدیر نیاز ندارد.',
      '۱. ابتدا به @Arsam_alaei پیام بدهید و شناسه‌ای را که /id نشان می‌دهد برای تأیید همکاری بفرستید.',
      '۲. بعد از تأیید، /setup را در گفت‌وگوی خصوصی اجرا کنید.',
      '۳. با مرورگر Chrome یا Edge روی کامپیوتر وارد https://vc.kntu.ac.ir شوید و مطمئن شوید حساب دانشگاهی شما باز است.',
      '۴. روی همان صفحه کلید F12 را بزنید (در بعضی لپ‌تاپ‌ها Fn + F12). پنلی کنار یا پایین صفحه باز می‌شود؛ تب Application را انتخاب کنید. اگر آن را نمی‌بینید، روی علامت » یا منوی تب‌های بیشتر بزنید و Application را پیدا کنید.',
      '۵. در ستون چپ پنل Application، زیر Storage، بخش Cookies را باز و https://vc.kntu.ac.ir را انتخاب کنید. در جدول سمت راست، ردیفی را پیدا کنید که ستون Name آن دقیقاً MoodleSession است.',
      '۶. روی مقدار ستون Value در همان ردیف دوبار کلیک کنید و با Ctrl + C کپی کنید. فقط مقدار Value را کپی کنید؛ نام MoodleSession، نشانی سایت و سایر ردیف‌ها لازم نیست.',
      '۷. به گفت‌وگوی خصوصی همین ربات برگردید و /setup را بفرستید. دکمهٔ «باز کردن فرم خصوصی دانشگاه» را بزنید. در فرم بازشده، مقدار کپی‌شده را با Ctrl + V داخل کادر «مقدار MoodleSession» وارد کنید؛ نام دلخواه اختیاری است. سپس دکمهٔ «آزمایش و ذخیره» را بزنید و منتظر پیام اتصال موفق بمانید.',
      'رمز عبور، مقدار کپی‌شده یا تصویر پنل حاوی آن را در چت برای کسی نفرستید. اتصال را هر زمان از همان فرم غیرفعال یا حذف کنید؛ کوکی ممکن است با پایان نشست یا خروج از سایت منقضی شود.',
      PRIVACY,
    ], 'راهنمای اتصال دانشگاه');
    return true;
  }
  if (command === '/courses') {
    const directory = await directorySummary();
    const blocks = directory.courses.map(c => `#${c.id} ${c.name}\n${c.line ?? ''}`);
    await sendBlocks(reply, blocks, '📚 درس‌های تحت پوشش ربات:');
    return true;
  }
  if (['/assignments', '/exams'].includes(command)) {
    const directory = await directorySummary();
    const user = privateChat ? await subscriber(tgId) : null;
    const filter = args[0] && /^\d+$/.test(args[0]) && Number(args[0]) > 0 ? String(Number(args[0])) : null;
    const courses = directory.courses.filter(c => filter ? String(c.id) === filter :
      (!privateChat || !consented(user?.profile) || user.profile.courses.includes(String(c.id))));
    const blocks = [];
    for (const course of courses) {
      for (const item of await savedItems(course)) {
        if (command === '/assignments' ? item.kind !== 'assign' : !isExam(item)) continue;
        blocks.push(notification({ fullname: course.name }, { ...item, change: 'updated' }, { classLine: course.line }));
      }
    }
    const page = Math.max(1, Number(args[1]) || 1), start = (page - 1) * 6;
    await reply('اطلاعات آخرین بررسی؛ ممکن است شامل مهلت‌های گذشته باشد.');
    await sendBlocks(reply, blocks.slice(start, start + 6), command === '/assignments' ? '📝 تکلیف‌ها:' : '🗓 امتحان‌ها:');
    if (blocks.length > start + 6) await reply(`موارد بیشتر: ${command} ${filter ?? 0} ${page + 1}`);
    return true;
  }
  if (!privateChat) return false;
  let user = await subscriber(tgId);
  if (command === '/forget') {
    await forgetSubscriber(tgId);
    await reply('اطلاعات اشتراک شخصی حذف و اعلان خصوصی متوقف شد. اتصال همکاری، در صورت وجود، جداگانه از /setup مدیریت می‌شود.', MENU);
    return true;
  }
  if (command === '/stop') {
    await stopStudent(tgId);
    await reply('اعلان خصوصی متوقف شد. برای شروع دوباره /resume را بزنید. دستورهای عمومی همچنان در دسترس‌اند.', MENU);
    return true;
  }
  if (command === '/resume') {
    // Reconfirmation seeds current items, avoiding a flood of paused updates.
    const resumed = await resumeStudent(tgId);
    if (resumed.state === 'not-registered') await reply('ابتدا با /register ثبت‌نام کنید.');
    else if (resumed.state === 'no-courses') await reply('اعلان شخصی فعال شد؛ پس از شناسایی درس‌های شما، تغییرات بعدی ارسال می‌شود.\n' + COURSE_SUPPORT, MENU);
    else if (resumed.state === 'failed') await reply('فعال‌سازی انجام نشد؛ کمی بعد دوباره /resume را بزنید.');
    else await reply('اعلان خصوصی برای تغییرات بعدی فعال شد.', MENU);
    return true;
  }
  if (command === '/cancel') {
    await saveSubscriber(tgId, { profile: { ...user?.profile, pending: null, stage: null } });
    await reply('ثبت یا تغییر درس‌ها لغو شد؛ تنظیمات ثبت‌شدهٔ قبلی حفظ شد.', MENU); return true;
  }
  if (command === '/mycourses') {
    const directory = await directorySummary();
    const courses = directory.courses.filter(c => user?.profile?.courses?.includes(String(c.id)));
    await sendBlocks(reply, courses.map(c => `#${c.id} ${c.name}\n${c.line ?? ''}`),
      user?.active ? '🔔 اعلان شخصی فعال است. درس‌های شناسایی‌شده:' : '🔕 اعلان شخصی غیرفعال است. درس‌های شناسایی‌شده:');
    await reply(COURSE_SUPPORT);
    if (!courses.length && !user?.profile?.registered) await reply('برای ثبت‌نام /register را بزنید.'); return true;
  }
  if (command === '/confirm') {
    await reply(await confirmSubscription(tgId)
      ? '✅ درس‌ها تأیید و اعلان شخصی فعال شد. فقط تغییرات بعدی ارسال می‌شود. /stop برای توقف'
      : 'ثبت درس‌ها اکنون خودکار است؛ نیازی به تأیید جداگانه نیست. /mycourses برای دیدن فهرست', MENU);
    return true;
  }
  if (command === '/register') {
    // No login username, student number, password or token is ever requested. The
    // only input is the name the university shows in VC Participants.
    await saveSubscriber(tgId, { profile: { ...user?.profile, paused: false, pending: null, stage: 'name', username: null } });
    const name = args.join(' ').trim();
    if (!name) { await reply(FULL_NAME_PROMPT + '\n' + FULL_NAME_HINT); return true; }
    return await registerByFullName(tgId, name, reply);
  }
  // A user left waiting at the removed login-username stage is asked only for the
  // displayed full name, so an in-progress registration never gets stuck.
  if (!text.startsWith('/') && ['username', 'name'].includes(user?.profile?.stage)) {
    return await registerByFullName(tgId, text, reply);
  }
  if (command === '/name') return await registerByFullName(tgId, args.join(' '), reply);
  if (command === '/select') {
    const directory = await directorySummary();
    const ids = selectedIds(args, directory.courses);
    if (!ids.length) await reply('درسی با این شماره‌ها پیدا نشد.\n' + COURSE_SUPPORT);
    else {
      await registerDetected(tgId, { courses: ids, name: user?.profile?.name, participantId: user?.profile?.participantId }, user?.profile?.name);
      await showRegistered(reply, ids, false);
    }
    return true;
  }
  return false;
}

// The chat face of `registerStudent` (the Mini App uses the same service). The
// displayed VC full name is the only input; here the caller's own progress and
// outcome are phrased as chat replies.
async function registerByFullName(tgId, name, reply) {
  const user = await subscriber(tgId);
  const clean = String(name ?? '').trim();
  if (!validFullName(clean)) {
    await saveSubscriber(tgId, { profile: { ...user?.profile, stage: 'name', username: null } });
    await reply(FULL_NAME_PROMPT + '\n' + FULL_NAME_HINT);
    return true;
  }
  if (Date.now() - (user?.profile?.lookupAt ?? 0) < 60000) { await reply('برای جست‌وجوی بعدی یک دقیقه صبر کنید.'); return true; }
  await reply('در حال جست‌وجوی نام شما در درس‌های تحت پوشش…');
  const result = await registerStudent(tgId, clean);
  if (result.state === 'busy') {
    await reply('جست‌وجو اکنون ممکن نیست یا جست‌وجوی دیگری در حال اجراست. یک دقیقه بعد دوباره نام کامل را بفرستید.\n' + COURSE_SUPPORT);
    return true;
  }
  if (result.state === 'name-invalid') { await reply(FULL_NAME_PROMPT + '\n' + FULL_NAME_HINT); return true; }
  if (result.state !== 'registered') return true; // `/forget` during the lookup owns the outcome.
  const found = result.found;
  if (!found.courses.length) {
    await reply((found.ambiguous ? 'چند نفر هم‌نام پیدا شدند و برای جلوگیری از اشتباه، درسی به حساب شما متصل نشد.'
      : 'ثبت‌نام شما انجام شد؛ فعلاً درسی با این نام پیدا نشد. درس‌های تازهٔ تحت پوشش هم خودکار بررسی می‌شوند.') + '\n' + COURSE_SUPPORT, MENU);
    return true;
  }
  await showRegistered(reply, found.courses, found.incomplete);
  return true;
}

// Renders what was just registered. Saving is the caller's job (registerStudent or
// registerDetected), which keeps one registration path for the chat and the app.
async function showRegistered(reply, ids, incomplete) {
  const directory = await directorySummary();
  await sendBlocks(reply, directory.courses.filter(c => ids.includes(String(c.id))).map(c => `#${c.id} ${c.name}\n${c.line ?? ''}`),
    `✅ درس‌های شما خودکار ثبت شدند.${incomplete ? '\nبعضی فهرست‌ها قابل خواندن نبودند؛ ممکن است فهرست ناقص باشد.' : ''}`);
  await reply('اعلان تغییرات بعدی این درس‌ها به گفت‌وگوی خصوصی شما ارسال می‌شود. درس‌های تازهٔ تحت پوشش هم خودکار بررسی خواهند شد. /stop برای توقف\n' + COURSE_SUPPORT, MENU);
}
async function sendBlocks(reply, blocks, heading) {
  if (!blocks.length) { await reply(heading + '\nموردی ثبت نشده است.'); return; }
  let text = heading + '\n\n';
  for (const block of blocks) {
    if (text.length + block.length > 3800) { await reply(text); text = ''; }
    text += block.slice(0, 3700) + '\n\n';
  }
  if (text.trim()) await reply(text);
}
