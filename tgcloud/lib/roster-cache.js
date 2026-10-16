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
  const professor = await getSetting('participantProfessor:' + courseKey(course));
  // Upgrade rosters saved before professor extraction existed, once only.
  if (!force && cached?.version === 1 && Array.isArray(cached.people) && professor?.at) return cached.people;
  let people, professorName, professorCount;
  if (load) people = await load(course);
  else {
    const accounts = (await enabledAccounts()).filter(a => a.mode === 'session' && (!readers?.length || readers.includes(a.id)));
    for (const account of accounts) {
      try {
        const directory = await connector(fetch, account).participantDirectory(course);
        people = directory.people; professorName = directory.professorName; professorCount = directory.professorCount; break;
      }
      catch { /* keep a previous complete cache intact and try another reader */ }
    }
  }
  if (!Array.isArray(people)) throw new Error('PARTICIPANT_ROSTER_UNAVAILABLE');
  const clean = [...new Map(people.filter(p => p.id && p.name).map(p => [String(p.id), {id: String(p.id), name: String(p.name).slice(0,100)}])).values()];
  await putSetting(key, { version: 1, fetchedAt: Date.now(), people: clean });
  if (professorName !== undefined) await putSetting('participantProfessor:' + courseKey(course), {name:professorName, count:professorCount, at:Date.now()});
  return clean;
}

export function matchRoster(people, queries) {
  return people.filter(person => queries.some(query => query.id ? String(query.id) === person.id : identityText(query.name) === identityText(person.name)));
}

export async function refreshRosters(courseId) {
  const courses = ((await getSetting('courses')) ?? []).filter(c => courseId === undefined || String(c.id) === String(courseId));
  const start = courseId === undefined ? Math.min(Number(await getSetting('participantRefreshCursor')) || 0, courses.length) : 0;
  let refreshed = 0, failed = 0, next = start;
  const began = Date.now();
  for (; next < courses.length; next++) {
    if (Date.now() - began > 20000) break;
    try { await courseRoster(courses[next], {force:true}); refreshed++; } catch { failed++; }
    // Persist progress after each course in case a university request stalls later.
    if (courseId === undefined) await putSetting('participantRefreshCursor', next + 1);
  }
  const remaining = courses.length - next;
  if (courseId === undefined && !remaining) await putSetting('participantRefreshCursor', 0);
  if (refreshed) await putSetting('coverageRefreshAt', Date.now());
  return { refreshed, failed, remaining };
}

export async function rosterCacheStatus() {
  const courses = (await getSetting('courses')) ?? [];
  const result = [];
  for (const course of courses) {
    const cached = await getSetting('participantRoster:' + courseKey(course));
    const professor = await getSetting('participantProfessor:' + courseKey(course));
    result.push({courseId:course.id, professor:professor?.name ?? null, professorCount:professor?.count ?? null, cached:cached?.version === 1 && Array.isArray(cached.people), participants:cached?.people?.length ?? 0});
  }
  return result;
}
