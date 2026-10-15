import sources from './sources.json' with { type: 'json' };
import { OWNER_ID } from '../tgcloud/lib/config.js';

// Mirrors @tgcloud/cli 0.2.0's authenticated /manage/run request.
// No public HTTP route is exposed for triggering checks.
export async function check(env, request = fetch) {
  const token = env.TGCLOUD_TOKEN;
  if (!/^app\d+:[^\s:]+$/.test(token ?? '')) throw new Error('Missing or invalid CLI secret');
  const appId = token.split(':')[0];
  const response = await request(`https://cloud.telegram.org/${appId}/manage/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      module: 'endpoints/check', sources, args: { scheduled: true },
      ctx: { initData: { user: { id: OWNER_ID } } },
    }),
    signal: AbortSignal.timeout(300000),
  });
  // Do not log remote bodies: they might contain account details or credentials.
  if (!response.ok) throw new Error(`Telegram request failed: HTTP ${response.status}`);
  let envelope;
  try { envelope = await response.json(); }
  catch { throw new Error('Invalid Telegram response'); }
  if (envelope?.ok !== true || !envelope.result) throw new Error('Telegram check failed');
  const result = JSON.stringify(envelope.result);
  if (/SCHEDULED_CHECK_PROBLEMS|ALL_ACCOUNTS_UNAVAILABLE|UNIVERSITY_LOGIN_REQUIRED|MOODLE_API_ACCESS_DENIED/.test(result)) {
    throw new Error('Course check incomplete; review university sessions in the Mini App');
  }
  console.log('Course check completed');
}

export default {
  async scheduled(_event, env) { await check(env); },
  fetch() { return new Response('Not found', { status: 404 }); },
};
