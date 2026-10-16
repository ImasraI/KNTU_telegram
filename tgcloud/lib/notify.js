import { api, BotApiError } from 'sdk';
import { db } from './database.js';
import { eq } from './database.js';
import { notices } from '../schema.js';
import { noticePlan } from './notice-policy.js';

// Private warnings only (an account holder or the bot owner). Authentication
// errors must never reach the public destination chat.
async function record(key, plan, info) {
  await db.insert(notices).values({ key, sentAt: plan.sentAt, count: plan.count, info: info ?? null })
    .onConflictDoUpdate({ target: notices.key, set: { sentAt: plan.sentAt, count: plan.count, info: info ?? null } }).run();
}

// Returns { sent, suppressed, reason } and never throws: a blocked bot or a user
// who never started a chat must not break a scan.
export async function notifyOnce({ key, tgId, text, cooldownMs, now = Date.now() }) {
  if (!tgId) return { sent: false, suppressed: true, reason: 'NO_RECIPIENT' };
  const existing = await db.select().from(notices).where(eq(notices.key, key)).get();
  const plan = noticePlan(existing, { now, cooldownMs });
  if (!plan.send) return { sent: false, suppressed: true, reason: 'COOLDOWN', nextEligibleAt: plan.nextEligibleAt };
  let reason = null;
  try {
    await api.sendMessage({ chat_id: tgId, text, link_preview_options: { is_disabled: true } });
  } catch (e) {
    // Remember the attempt anyway so a failing recipient cannot be hammered.
    reason = e instanceof BotApiError ? (e.description ?? `BOT_API_${e.code}`) : 'SEND_FAILED';
  }
  await record(key, plan, reason ? { lastError: String(reason).slice(0, 200) } : { lastSentAt: new Date(now).toISOString() });
  return reason ? { sent: false, suppressed: false, reason } : { sent: true, suppressed: false, reason: null };
}

export async function noticeState(key) {
  return (await db.select().from(notices).where(eq(notices.key, key)).get()) ?? null;
}
