import { normalizeSpaces, toAsciiDigits } from './classes.js';
import { signature } from './content.js';

export function identityText(value) {
  return normalizeSpaces(toAsciiDigits(value)).toLowerCase();
}
// Registration asks for one thing only: the name the university displays in VC
// Participants (the displayed full name). No login username, student number,
// password, cookie or token is requested, validated or stored. The displayed full
// name is what the Participants page exposes, so it is what can be matched.
export const FULL_NAME_LABEL = 'نام کامل در VC';
export const FULL_NAME_PROMPT = 'نام و نام خانوادگی خود را دقیقاً همان‌طور که در بخش شرکت‌کنندگان VC نمایش داده می‌شود بفرستید؛ بدون نیاز به نام کاربری ورود.';
export const FULL_NAME_HINT = `فقط «${FULL_NAME_LABEL}» لازم است؛ رمز عبور، نام کاربری ورود یا توکن را نفرستید. /privacy برای جزئیات؛ /cancel برای لغو.`;
// A displayed full name is at least two words and a plausible length. This is not
// identity verification; it only rejects obvious non-names before a lookup runs.
export function validFullName(value) {
  const clean = normalizeSpaces(value);
  return clean.length >= 3 && clean.length <= 100 && clean.split(/\s+/).length >= 2;
}
export function selectedIds(values, covered) {
  const allowed = new Set(covered.map(c => String(c.id)));
  return [...new Set(values.map(v => String(Number(toAsciiDigits(v)))))]
    .filter(id => allowed.has(id));
}
export function personalItems(items) {
  return items.filter(item => ['assign', 'quiz', 'resource', 'folder', 'forum', 'page', 'book'].includes(item.kind));
}
// Contact tag shown by the Mini App contact buttons.
export const CONTACT = '@Arsam_alaei';
// Moodle files an exam as a quiz module, but KNTU also announces exam dates in a
// forum post, so the name is what decides. Shared by the chat listing and the app.
export function isExam(item) {
  return item?.kind === 'quiz' || /آزمون|امتحان|میان.?ترم|exam|midterm/i.test(String(item?.name ?? ''));
}
export function itemReceipt(courseId, item) { return `${courseId}:${item.id}`; }
export function unseenItems(courseId, items, seen = {}) {
  return personalItems(items).filter(item => seen[itemReceipt(courseId, item)] !== signature(item));
}
export function consented(profile) {
  return profile?.confirmed === true && Array.isArray(profile.courses) && profile.courses.length > 0;
}
export const PUBLIC_COMMANDS = [
  { command: 'personal', description: 'اتصال اختیاری و خصوصی حساب VC' },
  { command: 'courses', description: 'فهرست درس‌های تحت پوشش' },
  { command: 'assignments', description: 'تکلیف‌های ثبت‌شده' },
  { command: 'exams', description: 'امتحان‌ها و اطلاعیه‌های آزمون' },
  { command: 'register', description: 'ثبت‌نام با نام کامل در VC و شناسایی خودکار درس‌ها' },
  { command: 'mycourses', description: 'درس‌ها و وضعیت اعلان شخصی من' },
  { command: 'stop', description: 'توقف اعلان‌های خصوصی' },
  { command: 'resume', description: 'فعال‌کردن دوباره اعلان‌های خصوصی' },
  { command: 'cooperate', description: 'راهنمای همکاری داوطلبانه' },
  { command: 'privacy', description: 'حریم خصوصی و دسترسی‌ها' },
  { command: 'help', description: 'راهنمای استفاده' },
];
export const PUBLIC_HELP = ['🎓 به ربات اطلاع‌رسانی درس‌های دانشگاه خوش آمدید!',
  'دیدن درس‌ها و اطلاعیه‌ها برای همه آزاد است و نیازی به تأیید یا ارائهٔ توکن ندارد.',
  '', 'برای شروع یکی از این دو راه را انتخاب کنید:',
  '/register — فقط نام کامل در VC را بفرستید تا درس‌های شما شناسایی شود؛ رمز لازم نیست.',
  '/personal — اتصال اختیاری حساب شخصی VC از طریق فرم خصوصی؛ این راه مستقل از /register است.',
  '', 'دستورهای عمومی:',
  ...PUBLIC_COMMANDS.filter(c => !['register','personal'].includes(c.command)).map(c => `/${c.command} — ${c.description}`),
  '', 'پس از /register فقط «نام کامل در VC» را بفرستید؛ درس‌ها خودکار شناسایی و اعلان شخصی فعال می‌شود.',
  'اگر فهرست درس‌ها ناقص یا نادرست است، از بخش پشتیبانی مینی‌اپ به مدیر پیام بدهید. درس‌های تازهٔ تحت پوشش هم خودکار برای شما بررسی می‌شوند.',
  '/cancel — لغو ثبت؛ /forget — حذف اطلاعات اشتراک شخصی',
  'اطلاعات مربوط به آخرین بررسی است؛ بررسی خودکار هر ۳۰ دقیقه انجام می‌شود.',
].join('\n');
export const PRIVACY = ['🔐 حریم خصوصی',
  'برای مدیریت استفاده، نام و نام کاربری تلگرام، شناسه و زمان اولین و آخرین استفاده ثبت می‌شود و فقط مدیر در پیوی می‌بیند؛ متن پیام‌ها در سابقهٔ استفاده ذخیره نمی‌شود.',
  'اتصال اختیاری /personal از همکاری عمومی جداست: رمز فقط در فرم خصوصی دریافت می‌شود، ذخیره رمز برای تمدید خودکار اختیاری است، و نشست و کش شخصی در سرویس جدا رمزنگاری می‌شوند. خروجی آن فقط برای صاحب حساب است. حذف این اتصال از همان فرم انجام می‌شود و /forget قدیمی آن را حذف نمی‌کند.',
  'برای مشاهدهٔ عمومی یا دریافت اعلان شخصی، رمز عبور یا توکن دانشگاه لازم نیست.',
  'در اشتراک شخصی، شناسهٔ تلگرام، «نام کامل در VC» اعلام‌شده، شناسهٔ شرکت‌کننده، درس‌های شناسایی‌شده و سابقهٔ ارسال نگهداری می‌شود. رمز عبور یا نام کاربری ورود ذخیره نمی‌شود و برای شناسایی درس‌ها، نام نمایشی و شناسهٔ شرکت‌کنندگان هر درس در حافظهٔ خصوصی پایگاه داده ذخیره می‌شود؛ فهرست شرکت‌کنندگان در گروه یا مینی‌اپ عمومی منتشر نمی‌شود.',
  'توکن یا کوکی فقط برای همکاری داوطلبانه و پس از تأیید مدیر دریافت می‌شود؛ فقط در فرم خصوصی مینی‌اپ وارد کنید، نه در چت.',
  'اعتبار اتصال در پایگاه دادهٔ خصوصی ربات روی تلگرام ذخیره می‌شود و هنگام خواندن سامانه برای vc.kntu.ac.ir ارسال می‌شود. مقدار آن در گروه، پاسخ ربات یا مخزن گیت‌هاب منتشر نمی‌شود.',
  'رمز عبور لازم نیست. ربات نمره‌ها، پاسخ تکالیف یا پیام‌های خصوصی شما را جمع‌آوری یا منتشر نمی‌کند.',
  'با /stop اعلان‌ها را متوقف و با /forget اطلاعات اشتراک شخصی را حذف کنید. اتصال همکاری را جداگانه از /setup حذف و برای لغو اعتبار توکن از تنظیمات دانشگاه اقدام کنید.',
].join('\n\n');
