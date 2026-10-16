import { api, db, EndpointError } from 'sdk';
import { subscriptions } from '../schema.js';
import { OWNER_ID } from '../lib/config.js';
import { PUBLIC_COMMANDS } from '../lib/student-policy.js';

export default async function (input, ctx) {
  if (ctx?.initData?.user?.id !== OWNER_ID) throw new EndpointError('این بخش مخصوص مدیر است.', { code: 'OWNER_ONLY' });
  if (input?.action === 'verify') return {
    commands: await api.getMyCommands({}),
    subscribers: await db.$count(subscriptions),
  };
  for (const language of ['', 'fa', 'en']) {
    const common = { commands: PUBLIC_COMMANDS, ...(language ? { language_code: language } : {}) };
    await api.setMyCommands(common);
    await api.setMyCommands({ ...common, scope: { type: 'all_private_chats' } });
    await api.setMyCommands({ ...common, scope: { type: 'chat', chat_id: OWNER_ID },
      commands: [...PUBLIC_COMMANDS, { command: 'admin', description: 'مدیریت ربات' }] });
  }
  await api.setMyDescription({ description: 'اطلاع‌رسانی درس‌ها، تکلیف‌ها و امتحان‌های دانشگاه خواجه نصیر؛ مشاهدهٔ عمومی و اعلان شخصی با تأیید درس‌های خودتان.' });
  await api.setMyShortDescription({ short_description: 'درس‌ها، تکالیف و امتحان‌ها؛ اعلان شخصی و همکاری داوطلبانه' });
  return { configured: true };
}
