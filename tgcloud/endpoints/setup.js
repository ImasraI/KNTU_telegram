import { EndpointError, fetch } from 'sdk';
import { connector, failureCode } from '../lib/moodle.js';
import { connectAccount, redactAccount, roleOf } from '../lib/accounts.js';
import { canConnect, validCredential } from '../lib/authorize.js';
import { putSetting } from '../lib/settings.js';

// Connect or renew the caller's own university account. The credential is tested
// against the university first, stored in the bot's private Telegram database,
// and never returned to the Mini App or written to logs.
export default async function (input, ctx) {
  const callerId = ctx?.initData?.user?.id;
  const role = await roleOf(callerId);
  if (!canConnect(role)) {
    throw new EndpointError('برای همکاری در اتصال حساب، ابتدا از @Arsam_alaei تأیید بگیرید. استفادهٔ عمومی ربات نیازی به تأیید ندارد.', { code: 'NOT_APPROVED' });
  }
  if (!validCredential(input?.mode, input?.secret)) {
    throw new EndpointError('مقدار اتصال معتبر نیست. فقط مقدار MoodleSession یا توکن دانشگاه را وارد کنید؛ رمز عبور لازم نیست.', { code: 'INVALID_CREDENTIAL' });
  }
  let courses;
  try {
    courses = await connector(fetch, { mode: input.mode, secret: input.secret }).courses();
  } catch (e) {
    const code = failureCode(e);
    throw new EndpointError(`اتصال به دانشگاه برقرار نشد. اعتبار اتصال و دسترسی را بررسی و دوباره تلاش کنید.`, { code });
  }
  let account;
  try {
    account = await connectAccount({
      callerId, role, accountId: input.accountId ?? null,
      mode: input.mode, secret: input.secret, label: input.label, courses: courses.length,
    });
  } catch (e) {
    const code = String(e?.message ?? 'SAVE_FAILED');
    throw new EndpointError(code === 'FORBIDDEN' ? 'فقط اتصال متعلق به خودتان را می‌توانید تغییر دهید.' : 'ذخیرهٔ اتصال انجام نشد.', { code });
  }
  // The next scheduled scan discovers new coverage and rematches registered
  // students, even if their previous roster lookup was cached recently.
  await putSetting('coverageRefreshAt', Date.now());
  return { connected: true, account: redactAccount(account), courses: courses.length };
}
