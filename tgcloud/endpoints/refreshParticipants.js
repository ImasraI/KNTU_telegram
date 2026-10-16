import { EndpointError } from 'sdk';
import { OWNER_ID } from '../lib/config.js';
import { refreshRosters } from '../lib/roster-cache.js';

export default async function(input, ctx) {
  if (ctx?.initData?.user?.id !== OWNER_ID) throw new EndpointError('این بخش مخصوص مدیر ربات است.', {code:'OWNER_ONLY'});
  if (input?.courseId !== undefined && !/^[1-9]\d*$/.test(String(input.courseId))) throw new EndpointError('شماره درس نامعتبر است.', {code:'COURSE_INVALID'});
  return await refreshRosters(input?.courseId);
}
