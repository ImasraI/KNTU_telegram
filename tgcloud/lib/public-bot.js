import { api } from 'sdk';
import { PUBLIC_HELP, PRIVACY, selectedIds, consented, validUsername } from './student-policy.js';
import { subscriber, saveSubscriber, forgetSubscriber, confirmSubscription, findStudentCourses, savedItems } from './subscriptions.js';
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
    return true;
  }
  if (command === '/privacy') { await reply(PRIVACY); return true; }
  if (command === '/id') { await reply(`شناسهٔ تلگرام شما: ${tgId}`); return true; }
  if (command === '/cooperate' || (command === '/setup' && !canConnect(role))) {
    await reply(['🤝 همکاری داوطلبانه برای پوشش درس‌های بیشتر',
      'استفاده از ربات و اعلان شخصی رایگان است و به همکاری یا تأیید مدیر نیاز ندارد.',
      '۱. ابتدا به @Arsam_alaei پیام بدهید و شناسه‌ای را که /id نشان می‌دهد برای تأیید همکاری بفرستید.',
      '۲. بعد از تأیید، /setup را در گفت‌وگوی خصوصی اجرا کنید.',
      '۳. در مرورگر خود وارد VC شوید. در ابزار توسعه‌دهندهٔ مرورگر، بخش Application یا Storage ← Cookies ← vc.kntu.ac.ir، مقدار MoodleSession را پیدا کنید.',
      '۴. فقط مقدار MoodleSession را در فرم خصوصی وارد و «آزمایش و ذخیره» را بزنید. رمز عبور یا تصویر صفحهٔ حاوی کوکی را برای کسی نفرستید.',
      '۵. اتصال را هر زمان از همان فرم غیرفعال یا حذف کنید؛ کوکی ممکن است با پایان نشست یا خروج از سایت منقضی شود.',
      PRIVACY,
    ].join('\n\n'));
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
        if (command === '/assignments' ? item.kind !== 'assign' : !(item.kind === 'quiz' || /آزمون|امتحان|میان.?ترم|exam|midterm/i.test(item.name))) continue;
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
    await saveSubscriber(tgId, { active: false, profile: { ...user?.profile, stage: null, pending: null } });
    await reply('اعلان خصوصی متوقف شد. برای شروع دوباره /resume را بزنید. دستورهای عمومی همچنان در دسترس‌اند.', MENU);
    return true;
  }
  if (command === '/resume') {
    if (!consented(user?.profile)) await reply('ابتدا با /register درس‌هایتان را انتخاب و تأیید کنید.');
    else {
      // Reconfirmation seeds current items, avoiding a flood of paused updates.
      await saveSubscriber(tgId, { profile: { ...user.profile, pending: { courses: user.profile.courses, name: user.profile.name, at: Date.now() } } });
      await confirmSubscription(tgId);
      await reply('اعلان خصوصی برای تغییرات بعدی فعال شد.', MENU);
    }
    return true;
  }
  if (command === '/cancel') {
    await saveSubscriber(tgId, { profile: { ...user?.profile, pending: null, stage: null } });
    await reply('ثبت یا تغییر درس‌ها لغو شد؛ تنظیمات تأییدشدهٔ قبلی حفظ شد.', MENU); return true;
  }
  if (command === '/mycourses') {
    const directory = await directorySummary();
    const courses = directory.courses.filter(c => user?.profile?.courses?.includes(String(c.id)));
    await sendBlocks(reply, courses.map(c => `#${c.id} ${c.name}\n${c.line ?? ''}`),
      user?.active ? '🔔 اعلان شخصی فعال است. درس‌های تأییدشده:' : '🔕 اعلان شخصی غیرفعال است. درس‌های تأییدشده:');
    if (!courses.length) await reply('برای ثبت درس‌ها /register را بزنید.'); return true;
  }
  if (command === '/confirm') {
    await reply(await confirmSubscription(tgId)
      ? '✅ درس‌ها تأیید و اعلان شخصی فعال شد. فقط تغییرات بعدی ارسال می‌شود. /stop برای توقف'
      : 'فهرست آماده‌ای برای تأیید نیست یا مهلت ۳۰ دقیقه‌ای آن گذشته است. دوباره /register را بزنید.', MENU);
    return true;
  }
  if (command === '/register') {
    const username = args.join(' ');
    if (username && !validUsername(username)) { await reply('فقط نام کاربری VC را وارد کنید؛ رمز عبور، کوکی یا توکن نفرستید.'); return true; }
    await saveSubscriber(tgId, { profile: { ...user?.profile, pending: null, stage: username ? 'name' : 'username', username: username || null } });
    await reply(username ? 'نام کاربری ثبت شد. سامانه نام ورود را در شرکت‌کنندگان نمایش نمی‌دهد؛ نام و نام خانوادگی را دقیقاً مطابق VC (با همان زبان فارسی یا لاتین) بفرستید. رمز عبور لازم نیست.'
      : 'برای اعلان شخصی، نام کاربری ورود به VC را بفرستید؛ رمز عبور و توکن نفرستید. اطلاعات فقط برای ثبت اشتراک شما نگهداری می‌شود. /privacy برای جزئیات؛ /cancel برای لغو.');
    return true;
  }
  if (!text.startsWith('/') && user?.profile?.stage === 'username') {
    if (!validUsername(text)) { await reply('فقط نام کاربری VC را وارد کنید، بدون فاصله، رمز عبور یا توکن.'); return true; }
    await saveSubscriber(tgId, { profile: { ...user.profile, username: text, stage: 'name' } });
    await reply('حالا نام و نام خانوادگی را دقیقاً مطابق فهرست شرکت‌کنندگان VC بفرستید. نام کاربری ورود در این فهرست نمایش داده نمی‌شود.');
    return true;
  }
  if (command === '/name' || (!text.startsWith('/') && user?.profile?.stage === 'name')) {
    const name = command === '/name' ? args.join(' ') : text;
    if (name.length < 3 || name.length > 100 || name.split(/\s+/).length < 2) {
      await reply('نام و نام خانوادگی کامل مطابق VC را بفرستید، مثلاً /name Arsam Alaei'); return true;
    }
    if (Date.now() - (user?.profile?.lookupAt ?? 0) < 60000) { await reply('برای جست‌وجوی بعدی یک دقیقه صبر کنید.'); return true; }
    await saveSubscriber(tgId, { profile: { ...user?.profile, stage: null, lookupAt: Date.now(), pending: null } });
    await reply('در حال جست‌وجوی نام شما در درس‌های تحت پوشش…');
    let found;
    try { found = await findStudentCourses(name); }
    catch {
      await reply('جست‌وجو اکنون ممکن نیست یا جست‌وجوی دیگری در حال اجراست. یک دقیقه بعد با /name نام کامل دوباره امتحان کنید، یا درس‌ها را با /select انتخاب کنید.');
      return true;
    }
    if (!found.courses.length) {
      await reply(found.ambiguous ? 'چند نفر هم‌نام پیدا شدند؛ برای جلوگیری از انتخاب اشتباه، درس‌ها را با /select انتخاب کنید.'
        : 'تطبیق قطعی پیدا نشد. نام را مطابق VC با /name دوباره بفرستید، یا از /courses شمارهٔ درس‌ها را ببینید و با /select انتخاب کنید.');
      return true;
    }
    user = await subscriber(tgId);
    await propose(tgId, user, found.courses, found.name, reply, found.incomplete); return true;
  }
  if (command === '/select') {
    const directory = await directorySummary();
    const ids = selectedIds(args, directory.courses);
    if (!ids.length) await reply('شمارهٔ درس‌ها را از /courses انتخاب کنید. مثال: /select 3 82');
    else await propose(tgId, user, ids, user?.profile?.name, reply, false);
    return true;
  }
  return false;
}

async function propose(tgId, user, ids, name, reply, incomplete) {
  const directory = await directorySummary();
  await saveSubscriber(tgId, { profile: { ...user?.profile, stage: null, pending: { courses: ids, name, at: Date.now() } } });
  await sendBlocks(reply, directory.courses.filter(c => ids.includes(String(c.id))).map(c => `#${c.id} ${c.name}\n${c.line ?? ''}`),
    `این درس‌ها برای شما درست هستند؟${incomplete ? '\nبعضی فهرست‌ها قابل خواندن نبودند؛ ممکن است فهرست ناقص باشد.' : ''}`);
  await reply('این تطبیق، احراز مالکیت حساب دانشگاه نیست. فقط همین درس‌های تأییدشده برای اعلان استفاده می‌شوند. برای تغییر: /select شماره‌ها؛ برای فعال‌سازی: /confirm؛ برای لغو: /cancel',
    { keyboard: [['تأیید درس‌ها', 'لغو']], resize_keyboard: true });
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
