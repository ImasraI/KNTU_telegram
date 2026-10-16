import { normalizeSpaces, toAsciiDigits } from './classes.js';
import { signature } from './content.js';

export function identityText(value) {
  return normalizeSpaces(toAsciiDigits(value)).toLowerCase();
}
export function validUsername(value) {
  return /^[\w.@-]{2,100}$/.test(value) && !/^[a-f0-9]{32}$/i.test(value) && !/^[A-Za-z0-9_-]{24,}$/.test(value);
}
export function selectedIds(values, covered) {
  const allowed = new Set(covered.map(c => String(c.id)));
  return [...new Set(values.map(v => String(Number(toAsciiDigits(v)))))]
    .filter(id => allowed.has(id));
}
export function personalItems(items) {
  return items.filter(item => ['assign', 'quiz', 'resource', 'folder', 'forum', 'page', 'book'].includes(item.kind));
}
export function itemReceipt(courseId, item) { return `${courseId}:${item.id}`; }
export function unseenItems(courseId, items, seen = {}) {
  return personalItems(items).filter(item => seen[itemReceipt(courseId, item)] !== signature(item));
}
export function consented(profile) {
  return profile?.confirmed === true && Array.isArray(profile.courses) && profile.courses.length > 0;
}
export const PUBLIC_COMMANDS = [
  { command: 'courses', description: 'فهرست درس‌های تحت پوشش' },
  { command: 'assignments', description: 'تکلیف‌های ثبت‌شده' },
  { command: 'exams', description: 'امتحان‌ها و اطلاعیه‌های آزمون' },
  { command: 'register', description: 'ثبت درس‌ها برای اعلان شخصی' },
  { command: 'mycourses', description: 'درس‌ها و وضعیت اعلان شخصی من' },
  { command: 'stop', description: 'توقف اعلان‌های خصوصی' },
  { command: 'resume', description: 'فعال‌کردن دوباره اعلان‌های خصوصی' },
  { command: 'cooperate', description: 'راهنمای همکاری داوطلبانه' },
  { command: 'privacy', description: 'حریم خصوصی و دسترسی‌ها' },
  { command: 'help', description: 'راهنمای استفاده' },
];
export const PUBLIC_HELP = ['🎓 به ربات اطلاع‌رسانی درس‌های دانشگاه خوش آمدید!',
  'دیدن درس‌ها و اطلاعیه‌ها برای همه آزاد است و نیازی به تأیید یا ارائهٔ توکن ندارد.',
  ...PUBLIC_COMMANDS.map(c => `/${c.command} — ${c.description}`),
  '', 'اعلان شخصی فقط پس از تأیید درس‌ها توسط خودتان فعال می‌شود.',
  'پس از /register، نام کاربری و نام کامل مطابق VC را بفرستید. درس‌های پیشنهادی را بررسی و با /confirm تأیید کنید؛ برای انتخاب دستی /select شماره‌درس‌ها را بزنید.',
  '/cancel — لغو ثبت؛ /forget — حذف اطلاعات اشتراک شخصی',
  'اطلاعات مربوط به آخرین بررسی است؛ بررسی خودکار هر ۳۰ دقیقه انجام می‌شود.',
].join('\n');
export const PRIVACY = ['🔐 حریم خصوصی',
  'برای مشاهدهٔ عمومی یا دریافت اعلان شخصی، رمز عبور یا توکن دانشگاه لازم نیست.',
  'در اشتراک شخصی، شناسهٔ تلگرام، نام/نام کاربری اعلام‌شده، درس‌های تأییدشده و سابقهٔ ارسال نگهداری می‌شود. نام دانشجویان دیگر منتشر نمی‌شود.',
  'توکن یا کوکی فقط برای همکاری داوطلبانه و پس از تأیید @Arsam_alaei دریافت می‌شود؛ فقط در فرم خصوصی مینی‌اپ وارد کنید، نه در چت.',
  'اعتبار اتصال در پایگاه دادهٔ خصوصی ربات روی تلگرام ذخیره می‌شود و هنگام خواندن سامانه برای vc.kntu.ac.ir ارسال می‌شود. مقدار آن در گروه، پاسخ ربات یا مخزن گیت‌هاب منتشر نمی‌شود.',
  'رمز عبور لازم نیست. ربات نمره‌ها، پاسخ تکالیف یا پیام‌های خصوصی شما را جمع‌آوری یا منتشر نمی‌کند.',
  'با /stop اعلان‌ها را متوقف و با /forget اطلاعات اشتراک شخصی را حذف کنید. اتصال همکاری را جداگانه از /setup حذف و برای لغو اعتبار توکن از تنظیمات دانشگاه اقدام کنید.',
].join('\n\n');
