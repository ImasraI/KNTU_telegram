import { fetch } from 'sdk';
import { getSetting, putSetting } from './settings.js';
import { enabledAccounts } from './accounts.js';
import { connector } from './moodle.js';
import { courseKey } from './plan.js';
import { identityText } from './student-policy.js';

// Private server-side records, never included in student endpoint responses.
export async function courseRoster(course, { force = false, readers, load } = {}) {
  const key = 'participantRoster:' + courseKey(course);
  const cached = await getSetting(key);
  if (!force && cached?.version === 1 && Array.isArray(cached.people)) return cached.people;
  let people;
  if (load) people = await load(course);
  else {
    const accounts = (await enabledAccounts()).filter(a => a.mode === 'session' && (!readers?.length || readers.includes(a.id)));
    for (const account of accounts) {
      try { people = await connector(fetch, account).participants(course); break; }
      catch { /* keep a previous complete cache intact and try another reader */ }
    }
  }
  if (!Array.isArray(people)) throw new Error('PARTICIPANT_ROSTER_UNAVAILABLE');
  const clean = [...new Map(people.filter(p => p.id && p.name).map(p => [String(p.id), {id: String(p.id), name: String(p.name).slice(0,100)}])).values()];
  await putSetting(key, { version: 1, fetchedAt: Date.now(), people: clean });
  return clean;
}

export function matchRoster(people, queries) {
  return people.filter(person => queries.some(query => query.id ? String(query.id) === person.id : identityText(query.name) === identityText(person.name)));
}

export async function refreshRosters(courseId) {
  const courses = ((await getSetting('courses')) ?? []).filter(c => courseId === undefined || String(c.id) === String(courseId));
  let refreshed = 0, failed = 0;
  for (const course of courses) {
    try { await courseRoster(course, {force:true}); refreshed++; } catch { failed++; }
  }
  if (refreshed) await putSetting('coverageRefreshAt', Date.now());
  return { refreshed, failed };
}

export async function rosterCacheStatus() {
  const courses = (await getSetting('courses')) ?? [];
  const result = [];
  for (const course of courses) {
    const cached = await getSetting('participantRoster:' + courseKey(course));
    result.push({courseId:course.id, cached:cached?.version === 1 && Array.isArray(cached.people), participants:cached?.people?.length ?? 0});
  }
  return result;
}
