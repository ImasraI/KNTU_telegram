import { api } from 'sdk';
import { refreshRosters } from '../lib/roster-cache.js';
import { OWNER_ID, SETUP_APP_URL } from '../lib/config.js';
import { getSetting, putSetting } from '../lib/settings.js';
import { roleOf, visibleAccounts, approveContributor, revokeContributor } from '../lib/accounts.js';
import { canConnect } from '../lib/authorize.js';
import { handlePublic } from '../lib/public-bot.js';
import { parseThreadId, sendTarget, describeDestination } from '../lib/destination.js';
import { scan, publishDigests, resolveDestination, directorySummary, detectClassInfo } from '../lib/monitor.js';
import { parseClassCommand, courseTitle, deriveLabel } from '../lib/classes.js';
import { setBinding, deleteBinding } from '../lib/directory.js';
import { courseKey } from '../lib/plan.js';

const CLASS_HELP = ['تنظیم کلاس (فقط مدیر):', '/classes — فهرست کلاس‌ها',
  '/class 3 — نمایش درس', '/class 3 label 11 — تعیین شماره کلاس',
  '/class 3 time 9:00 - 10:30 — نمایش زمان به جای شماره',
  '/class 3 time clear — بازگشت به شماره', '/class 3 detect — تازه‌سازی نام استاد',
  '/class 3 clear — حذف تنظیم دستی'].join('\n');
const ADMIN_HELP = ['مدیریت ربات:', '/setup — اتصال دانشگاه', '/check — بررسی فوری',
  '/refreshparticipants [شماره درس] — تازه‌سازی فهرست شرکت‌کنندگان', '/status — وضعیت اتصال‌ها', '/accounts — حساب‌های همکاری', '/classes — تنظیم کلاس‌ها',
  '/approve شناسه نام — تأیید همکار', '/revoke شناسه — لغو همکاری',
  '/bind — ثبت مقصد در گروه یا موضوع', '/unbind — حذف مقصد', '/destination — مقصد فعلی',
  '/digest — انتشار نمای اولیهٔ درس‌ها', CLASS_HELP].join('\n');
const HEALTH = { ok: 'سالم', auth: 'نشست منقضی', partial: 'پوشش ناقص', unreachable: 'عدم دسترسی', layout: 'تغییر ساختار سایت', error: 'خطا', unknown: 'نامشخص' };

export default async function (message) {
  const chat = message?.chat ?? {}, fromId = message?.from?.id;
  if (!fromId || !message?.text) return;
  const [raw, ...args] = String(message.text).trim().split(/\s+/);
  if (/@\w+$/.test(raw) && !/@KNTU_aidbot$/i.test(raw)) return;
  const command = raw.replace(/@\w+$/, '').toLowerCase();
  const role = await roleOf(fromId), owner = role === 'owner', privateChat = chat.type === 'private';
  const reply = text => api.sendMessage({ chat_id: chat.id,
    text: courseTitle(text).replace(/\b\d{1,4}-\d{7}-\d{1,4}\b/g, code => deriveLabel(code) ?? ''),
    link_preview_options: { is_disabled: true } });
  try {
    if (await handlePublic(message, role)) return;
    if (command === '/bind') {
      if (!owner || !['group', 'supergroup'].includes(chat.type)) return;
      const threadId = parseThreadId(message.message_thread_id ?? message.reply_to_message?.message_thread_id);
      const destination = { chatId: chat.id, threadId, boundBy: fromId, boundAt: new Date().toISOString(), source: 'bind' };
      await api.sendMessage({ ...sendTarget(destination), text: '✅ این گروه یا موضوع برای اطلاع‌رسانی ثبت شد.' });
      await putSetting('destination', destination);
      if (!threadId) await putSetting('groupId', chat.id);
      return;
    }
    if (!privateChat) return;
    if (command === '/setup') {
      if (!canConnect(role)) return;
      return await api.sendMessage({ chat_id: chat.id,
        text: 'فرم خصوصی همکاری: اتصال یا تازه‌سازی حساب دانشگاهی. قبل از ارائهٔ اعتبار اتصال /privacy را بخوانید. رمز عبور، کوکی یا توکن را در چت نفرستید.',
        reply_markup: { inline_keyboard: [[{ text: 'باز کردن فرم خصوصی دانشگاه', web_app: { url: SETUP_APP_URL } }]] } });
    }
    if (command === '/accounts' && canConnect(role)) {
      const rows = await visibleAccounts(role, fromId);
      return await reply(['حساب‌های همکاری شما:', ...rows.map(row =>
        `${row.label || 'حساب دانشگاهی'} — ${row.enabled ? 'فعال' : 'غیرفعال'} — ${HEALTH[row.health?.state] ?? 'نامشخص'}`),
        rows.length ? 'برای حذف یا تازه‌سازی اتصال /setup را بزنید.' : 'هنوز اتصالی ثبت نشده است. /setup'].join('\n'));
    }
    if (!owner) {
      if (!command.startsWith('/')) await reply('از دکمه‌های منو استفاده کنید یا /help را بزنید.');
      return;
    }
    if (command === '/admin') return await reply(ADMIN_HELP);
    if (command === '/approve' || command === '/revoke') {
      const target = Number(args[0]);
      if (!Number.isSafeInteger(target) || target <= 0 || target === OWNER_ID) return await reply('شناسهٔ تلگرام همکار را وارد کنید؛ مثال: /approve 123456 نام');
      if (command === '/approve') {
        await approveContributor(target, args.slice(1).join(' '));
        try { await api.sendMessage({ chat_id: target, text: '✅ همکاری شما تأیید شد. راهنمای /cooperate را بخوانید و برای اتصال داوطلبانه /setup را باز کنید.' }); } catch { /* user may not have started bot */ }
        return await reply(`همکاری شناسهٔ ${target} تأیید شد.`);
      }
      const result = await revokeContributor(target);
      return await reply(`همکاری لغو و ${result.disabled} اتصال غیرفعال شد. اشتراک عمومی و اعلان شخصی کاربر مستقل است.`);
    }
    if (command === '/refreshparticipants') {
      if (args.length && !/^[1-9]\d*$/.test(args[0])) return await reply('شماره درس را وارد کنید یا برای همهٔ درس‌ها /refreshparticipants را بزنید.');
      await reply('در حال تازه‌سازی فهرست‌های خصوصی شرکت‌کنندگان…');
      const result = await refreshRosters(args[0]);
      return await reply(`${result.refreshed} فهرست تازه شد؛ ${result.failed} خطا. فهرست قبلی درس‌های ناموفق حفظ شد.${result.remaining ? ` برای ${result.remaining} درس باقی‌مانده دوباره /refreshparticipants را بزنید.` : ''}`);
    }
    if (command === '/check') {
      const result = await scan({ reason: 'command' });
      return await reply(result.busy ? 'یک بررسی در حال اجراست.' :
        `${result.courses} درس بررسی شد؛ ${result.sent} اعلان گروهی و ${result.personal?.sent ?? 0} اعلان شخصی ارسال شد. ${result.failures.length} درس با خطا روبه‌رو شد.`);
    }
    if (command === '/status') {
      const status = await getSetting('status');
      return await reply(status ? `آخرین بررسی: ${status.checkedAt}\nدرس‌ها: ${status.courses}\nاعلان گروهی: ${status.sent}\nاعلان شخصی: ${status.personal?.sent ?? 0}\nخطای درس: ${status.failures?.length ?? 0}\nحساب ناموفق: ${status.accounts?.failed ?? 0}` : 'هنوز بررسی کامل نشده است.');
    }
    if (command === '/destination') return await reply(describeDestination(await resolveDestination()));
    if (command === '/unbind') {
      await putSetting('destination', null); await putSetting('groupId', 0);
      return await reply('مقصد اطلاع‌رسانی حذف شد. برای ثبت دوباره /bind را در گروه مقصد اجرا کنید.');
    }
    if (command === '/digest') {
      const result = await publishDigests(args.length ? args : null);
      return await reply(`${result.sent} نمای اولیه ارسال شد؛ ${result.remaining} مورد باقی مانده است.`);
    }
    if (command === '/classes' || command === '/prof') {
      const directory = await directorySummary();
      let text = 'درس‌ها و کلاس‌ها:\n';
      for (const c of directory.courses) {
        const block = `#${c.id} ${c.name}\n${c.line ?? ''}\n\n`;
        if (text.length + block.length > 3500) { await reply(text); text = ''; }
        text += block;
      }
      return await reply(text || 'درسی ثبت نشده است.');
    }
    if (command === '/class') {
      if (!args.length) return await reply(CLASS_HELP);
      const parsed = parseClassCommand(args);
      if (parsed.error) return await reply('شمارهٔ درس یا زمان معتبر نیست.\n' + CLASS_HELP);
      if (parsed.action === 'professor') return await reply('نام استاد فقط از شرکت‌کنندگان گرفته می‌شود. برای تازه‌سازی /class ' + parsed.courseId + ' detect');
      const courses = (await getSetting('courses')) ?? [];
      const course = courses.find(c => String(c.id) === String(parsed.courseId));
      if (!course) return await reply('این درس تحت پوشش نیست. /classes');
      const key = courseKey(course);
      if (parsed.action === 'clear') await deleteBinding(key);
      else if (parsed.action === 'detect') await detectClassInfo([parsed.courseId], 1);
      else if (parsed.action !== 'show') {
        const patch = parsed.action === 'code' ? { code: parsed.code, label: parsed.label }
          : parsed.action === 'label' ? { label: parsed.label } : { slots: parsed.slots };
        await setBinding(key, patch, fromId);
      }
      const directory = await directorySummary();
      const current = directory.courses.find(c => String(c.id) === String(course.id));
      return await reply(`#${course.id} ${courseTitle(course.fullname)}\n${current?.line ?? 'بدون تنظیم'}`);
    }
    await reply('دستور شناخته نشد. /help برای راهنمای عمومی و /admin برای مدیریت');
  } catch {
    await reply('انجام درخواست ممکن نشد. کمی بعد دوباره تلاش کنید.' + (canConnect(role) ? ' برای مشکل اتصال دانشگاه، فرم /setup را بررسی کنید.' : ''));
  }
}
