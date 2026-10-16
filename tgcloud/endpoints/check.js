import { EndpointError } from 'sdk';
import { OWNER_ID } from '../lib/config.js';
import { scan } from '../lib/monitor.js';

export default async function (input, ctx) {
  if (!OWNER_ID || ctx?.initData?.user?.id !== OWNER_ID) throw new EndpointError('این بخش مخصوص مدیر ربات است.', { code: 'OWNER_ONLY' });
  const result = await scan({ reason: input?.scheduled ? 'scheduled' : 'manual' });
  if (input?.scheduled && !result.busy) {
    // A scheduled run must fail loudly when something was not covered, so the
    // external scheduler surfaces it instead of reporting a silent success.
    const problems = [];
    if (result.failures?.length) problems.push(`COURSE_CHECKS_FAILED:${result.failures.length}`);
    if (result.lost?.length) problems.push(`COVERAGE_LOST:${result.lost.length}`);
    if (result.accounts?.failed) problems.push(`ACCOUNTS_FAILED:${result.accounts.failed}`);
    if (problems.length) throw new Error('SCHEDULED_CHECK_PROBLEMS ' + problems.join(' '));
  }
  return result;
}
