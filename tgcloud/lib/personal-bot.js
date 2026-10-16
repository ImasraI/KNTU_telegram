// Pure routing: no university credentials, no shared DB, no group Web App buttons.
import { messageDestination, sendTarget } from './destination.js';
export function personalCommand(message,appUrl) {
  const text=String(message?.text??'').trim();
  if(!/^\/personal(?:@KNTU_aidbot)?$/i.test(text) && text!=='🔐 حساب شخصی VC') return null;
  if(message.chat?.type!=='private' || message.chat.id!==message.from?.id) return {...sendTarget(messageDestination(message)),text:'اتصال شخصی فقط در پیوی ربات انجام می‌شود. در پیوی /personal را بفرستید؛ رمز را در چت ارسال نکنید.'};
  // Telegram isolates do not expose the browser/Node URL constructor.
  const valid = typeof appUrl === 'string' && /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::443)?\/?$/i.test(appUrl);
  if(!valid)return {chat_id:message.chat.id,text:'سرویس حساب شخصی هنوز توسط مدیر راه‌اندازی نشده است. رمز یا کوکی را در چت نفرستید.'};
  return {chat_id:message.from.id,text:'اتصال اختیاری حساب شخصی VC: نام کاربری و رمز را فقط در فرم زیر وارد کنید. داده فقط برای خودتان است؛ اشتراک‌گذاری با گروه یا حساب‌های همکاری انجام نمی‌شود. ذخیره رمز برای تمدید خودکار پیش‌فرض خاموش است.',reply_markup:{inline_keyboard:[[{text:'بازکردن اتصال شخصی امن',web_app:{url:appUrl}}]]}};
}
