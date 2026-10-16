import { EndpointError } from 'sdk';
import { ORIGIN } from '../lib/config.js';
import { READ_CAPABILITIES } from '../lib/moodle.js';
import { roleOf, visibleAccounts, setEnabled, setLabel, deleteAccount, accountById } from '../lib/accounts.js';
import { canConnect, canManageAccount, scopeHealth } from '../lib/authorize.js';
import { resolveDestination } from '../lib/monitor.js';
import { describeDestination, sendTarget } from '../lib/destination.js';
import { getSetting } from '../lib/settings.js';
import { courseIdFromKey } from '../lib/plan.js';

async function view(role, callerId) {
  const destination = await resolveDestination();
  const pending = (await getSetting('pendingDigests')) ?? [];
  const isOwner = role === 'owner';
  const status = (await getSetting('status')) ?? null;
  return {
    role,
    owner: isOwner,
    origin: ORIGIN,
    accounts: await visibleAccounts(role, callerId),
    destination: destination
      ? { chatId: destination.chatId, threadId: destination.threadId, source: destination.source, text: describeDestination(destination), sendable: !!sendTarget(destination) }
      : { chatId: null, threadId: null, source: null, text: describeDestination(null), sendable: false },
    // A contributor only ever sees their own account's health.
    status: status ? { ...status, health: scopeHealth(status.health, callerId, isOwner) } : null,
    pendingDigests: pending.map(entry => ({ key: entry.key, courseId: courseIdFromKey(entry.key), at: entry.at })),
    limits: READ_CAPABILITIES,
  };
}

// The Mini App's account panel. A caller only ever sees and changes their own
// accounts (the bot owner sees and manages every account). No credential value is
// ever part of a response.
export default async function (input, ctx) {
  const callerId = ctx?.initData?.user?.id;
  const role = await roleOf(callerId);
  if (!canConnect(role)) {
    throw new EndpointError('این فرم برای همکاران تأییدشده است. راهنمای /cooperate را ببینید.', { code: 'NOT_APPROVED' });
  }
  const action = input?.action ?? 'list';
  if (action === 'list') return await view(role, callerId);

  const account = await accountById(String(input?.accountId ?? ''));
  if (!account) throw new EndpointError('اتصال پیدا نشد.', { code: 'ACCOUNT_NOT_FOUND' });
  if (!canManageAccount(role, callerId, account)) {
    throw new EndpointError('فقط اتصال متعلق به خودتان را می‌توانید تغییر دهید.', { code: 'FORBIDDEN' });
  }
  switch (action) {
    case 'enable': await setEnabled(account.id, true); break;
    case 'disable': await setEnabled(account.id, false); break;
    case 'rename': await setLabel(account.id, input?.label); break;
    case 'delete':
      // Baselines are shared per course and stay: deleting an account must not
      // re-announce everything another account still covers.
      await deleteAccount(account.id);
      break;
    default: throw new EndpointError('درخواست شناخته نشد.', { code: 'BAD_ACTION' });
  }
  return await view(role, callerId);
}
