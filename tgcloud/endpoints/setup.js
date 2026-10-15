import { EndpointError, fetch } from 'sdk';
import { connector, failureCode } from '../lib/moodle.js';
import { connectAccount, redactAccount, roleOf } from '../lib/accounts.js';
import { canConnect, validCredential } from '../lib/authorize.js';

// Connect or renew the caller's own university account. The credential is tested
// against the university first, stored in the bot's private Telegram database,
// and never returned to the Mini App or written to logs.
export default async function (input, ctx) {
  const callerId = ctx?.initData?.user?.id;
  const role = await roleOf(callerId);
  if (!canConnect(role)) {
    throw new EndpointError('Your Telegram ID is not approved to connect an account yet. Ask the bot owner to run /approve with your ID.', { code: 'NOT_APPROVED' });
  }
  if (!validCredential(input?.mode, input?.secret)) {
    throw new EndpointError('Invalid credential. Paste only the MoodleSession value or a Moodle API token, not a password.', { code: 'INVALID_CREDENTIAL' });
  }
  let courses;
  try {
    courses = await connector(fetch, { mode: input.mode, secret: input.secret }).courses();
  } catch (e) {
    const code = failureCode(e);
    throw new EndpointError(`University connection failed (${code}). Check access and the credential, then try again.`, { code });
  }
  let account;
  try {
    account = await connectAccount({
      callerId, role, accountId: input.accountId ?? null,
      mode: input.mode, secret: input.secret, label: input.label, courses: courses.length,
    });
  } catch (e) {
    const code = String(e?.message ?? 'SAVE_FAILED');
    throw new EndpointError(code === 'FORBIDDEN' ? 'You can only change your own connection.' : 'Could not save the connection.', { code });
  }
  return { connected: true, account: redactAccount(account), courses: courses.length };
}
