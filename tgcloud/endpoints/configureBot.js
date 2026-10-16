import { api, db, EndpointError } from 'sdk';
import { subscriptions } from '../schema.js';
import { MINI_APP_URL, OWNER_ID } from '../lib/config.js';
import { PUBLIC_COMMANDS } from '../lib/student-policy.js';

// Owner-only one-shot setup: public command menus, bot description and the chat
// menu button that opens the public student Mini App. The cooperation form is not
// a menu button — it stays reachable through /setup, which only approved
// contributors may use.
const MENU_BUTTON = { type: 'web_app', text: 'درس‌های من', web_app: { url: MINI_APP_URL } };

export default async function (input, ctx) {
  if (ctx?.initData?.user?.id !== OWNER_ID) throw new EndpointError('این بخش مخصوص مدیر است.', { code: 'OWNER_ONLY' });
  if (input?.action === 'verify') return {
    commands: await api.getMyCommands({}),
    menuButton: await api.getChatMenuButton({}),
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
  // The menu button: the bot-wide default and the owner's own chat. Verified on the
  // live bot (2026-10-16): the per-chat button takes effect, while the bot-wide
  // default stays `commands` even though the API answers `true` — that default is
  // owned by BotFather for this bot. So the result reports what is actually in
  // effect instead of what was requested, and the chat still has the button in
  // /start and /help either way.
  let menuButton;
  try {
    await api.setChatMenuButton({ menu_button: MENU_BUTTON });
    await api.setChatMenuButton({ chat_id: OWNER_ID, menu_button: MENU_BUTTON });
    menuButton = {
      requested: 'web_app',
      botWide: (await api.getChatMenuButton({}))?.type ?? null,
      ownerChat: (await api.getChatMenuButton({ chat_id: OWNER_ID }))?.type ?? null,
    };
  } catch (error) {
    menuButton = { requested: 'web_app', failed: error?.description ?? error?.code ?? 'unknown' };
  }
  return { configured: true, menuButton };
}
