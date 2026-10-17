import { EndpointError } from 'sdk';
import { db, inArray, sql } from '../lib/database.js';
import { snapshots } from '../schema.js';
import { getSetting, putSetting } from '../lib/settings.js';
import { AI_DISCLOSURE, normalizeConfig } from '../lib/ai-policy.js';
import { directorySummary } from '../lib/monitor.js';
import { courseKey } from '../lib/plan.js';
import { CONTACT, FULL_NAME_HINT, FULL_NAME_LABEL, FULL_NAME_PROMPT, PRIVACY, PUBLIC_COMMANDS } from '../lib/student-policy.js';
import { COURSE_SUPPORT, forgetSubscriber, registerStudent, refreshRegistration, resumeStudent, stopStudent, subscriber } from '../lib/subscriptions.js';
import { FILTERS, PAGE_SIZE, courseCounts, courseView, coverageView, freshness, helpView, itemView, newestRead, pageItems, selectItems, studentState } from '../lib/student-view.js';

// The public student Mini App's only endpoint.
//
// It reuses the same services the chat uses (registration, exact participant
// matching, notification controls, the professor/class directory, saved
// baselines), so a student gets the same answer either way. What it adds is
// isolation: every personal action is scoped to `ctx.initData.user.id`, verified
// by the platform, and no input can name another user. A response never carries a
// credential, an account id, a participant roster or the long university code.
const MAX_KEYS_PER_QUERY = 100;
const AI_CONSENT = tgId => 'ai:consent:' + tgId;

// The optional smart chat, described in the caller's own terms. `enabled` is this
// caller's consent; `available` is the owner's global switch. Neither value says
// anything about another subscriber.
async function aiFacts(callerId) {
  const config = normalizeConfig(await getSetting('ai:config'));
  return {
    available: config.enabled,
    enabled: callerId ? !!(await getSetting(AI_CONSENT(callerId))) : false,
    disclosure: AI_DISCLOSURE,
  };
}

function policyView() {
  return {
    fullNameLabel: FULL_NAME_LABEL, fullNamePrompt: FULL_NAME_PROMPT, fullNameHint: FULL_NAME_HINT,
    support: COURSE_SUPPORT, contact: CONTACT,
  };
}

function requireCaller(callerId) {
  if (!callerId) throw new EndpointError('این بخش به حساب تلگرام شما نیاز دارد؛ صفحه را از دکمهٔ ربات باز کنید.', { code: 'NO_USER' });
  return callerId;
}

function keysFor(course) {
  // The canonical `origin#id` key, plus the plain-id key the single-account era
  // wrote, so the nine original baselines keep counting.
  return [courseKey(course), String(course.id)];
}

// One query for the whole course list instead of two per course.
async function snapshotRows(keys) {
  const unique = [...new Set(keys)];
  const rows = [];
  for (let i = 0; i < unique.length; i += MAX_KEYS_PER_QUERY) {
    const slice = unique.slice(i, i + MAX_KEYS_PER_QUERY);
    if (!slice.length) continue;
    rows.push(...await db.select().from(snapshots).where(inArray(snapshots.key, slice)).all());
  }
  return rows;
}

function snapshotCache(rows) {
  return new Map(rows.map(row => [row.key, row]));
}

function rowFor(cache, course) {
  return cache.get(courseKey(course)) ?? cache.get(String(course.id)) ?? null;
}

// `list` is the course list already loaded by the caller: its per-course `scan`
// times are the newest information a student is looking at, which is what the
// header badge must follow.
async function coverage(now, list = []) {
  const status = await getSetting('status');
  const courses = (await getSetting('courses')) ?? [];
  return coverageView(status, courses.length, now, newestRead(list));
}

// Public browsing: every covered course with its class line and activity counts.
async function courses(now) {
  const summary = await directorySummary();
  const cache = snapshotCache(await snapshotRows(summary.courses.flatMap(keysFor)));
  return summary.courses.map(entry => {
    const row = rowFor(cache, entry);
    const items = Array.isArray(row?.value) ? row.value : [];
    return courseView(entry, { counts: courseCounts(items), scan: freshness(row?.updatedAt ?? null, now) });
  });
}

async function payload(callerId, now) {
  const list = await courses(now);
  const ai = await aiFacts(callerId);
  return {
    coverage: await coverage(now, list),
    courses: list,
    me: { ...studentState(callerId ? await subscriber(callerId) : null), aiChat: ai.enabled },
    ai,
    policy: policyView(),
  };
}

export default async function (input, ctx) {
  const callerId = ctx?.initData?.user?.id ?? null;
  const action = String(input?.action ?? 'home');
  const now = Date.now();

  if (action === 'help') {
    return helpView({
      commands: PUBLIC_COMMANDS, privacy: PRIVACY, support: COURSE_SUPPORT, contact: CONTACT,
      label: FULL_NAME_LABEL, prompt: FULL_NAME_PROMPT, hint: FULL_NAME_HINT,
    });
  }
  if (action === 'home' || action === 'courses') return await payload(callerId, now);

  if (action === 'course') {
    const id = Number(input?.courseId);
    const list = await courses(now);
    const course = list.find(entry => entry.id === id);
    if (!course) throw new EndpointError('این درس تحت پوشش ربات نیست.', { code: 'UNKNOWN_COURSE' });
    const row = rowFor(snapshotCache(await snapshotRows(keysFor(course))), course);
    return {
      course,
      items: pageItems(selectItems(row?.value, input?.filter), input?.offset),
      scan: freshness(row?.updatedAt ?? null, now),
      coverage: await coverage(now, list),
      policy: policyView(),
    };
  }

  // One list of everything, across every covered course or across the caller's
  // own courses, so a deadline can be found without opening course by course.
  if (action === 'feed') {
    const list = await courses(now);
    const ai = await aiFacts(callerId);
    const me = { ...studentState(callerId ? await subscriber(callerId) : null), aiChat: ai.enabled };
    const mine = me.registered && me.courses.length;
    const scope = input?.scope === 'mine' && mine ? 'mine' : 'all';
    const selected = scope === 'mine' ? list.filter(entry => me.courses.includes(String(entry.id))) : list;
    const cache = snapshotCache(await snapshotRows(selected.flatMap(keysFor)));
    const entries = [];
    for (const course of selected) {
      const row = rowFor(cache, course);
      for (const item of selectItems(row?.value, input?.filter)) {
        entries.push({
          ...itemView(item, 'short'),
          courseId: course.id, courseName: course.name,
          classLabel: course.classLabel, professor: course.professor,
        });
      }
    }
    const start = Math.max(0, Number(input?.offset) || 0);
    const status = await getSetting('status');
    return {
      scan: freshness(status?.checkedAt ?? null, now),
      scope,
      scoped: scope === 'mine',
      requestedScope: input?.scope === 'mine' ? 'mine' : 'all',
      filter: FILTERS.includes(input?.filter) ? input.filter : 'all',
      items: entries.slice(start, start + PAGE_SIZE),
      total: entries.length, offset: start, hasMore: start + PAGE_SIZE < entries.length,
      courses: selected.length,
      coverage: coverageView(status, list.length, now, newestRead(selected)),
      me,
      ai,
      policy: policyView(),
    };
  }

  // Everything below is the caller's own data; a caller-supplied id is ignored.
  const caller = requireCaller(callerId);

  if (action === 'refreshRegistration') {
    await refreshRegistration(caller);
    return await payload(caller, Date.now());
  }

  if (action === 'register') {
    const result = await registerStudent(caller, input?.name);
    if (result.state === 'name-invalid') throw new EndpointError(FULL_NAME_PROMPT, { code: 'NAME_INVALID' });
    if (result.state === 'cooldown') throw new EndpointError('برای جست‌وجوی بعدی یک دقیقه صبر کنید.', { code: 'COOLDOWN' });
    if (result.state === 'busy') throw new EndpointError('جست‌وجو اکنون ممکن نیست یا جست‌وجوی دیگری در حال اجراست؛ یک دقیقه بعد دوباره تلاش کنید.', { code: 'LOOKUP_BUSY' });
    if (result.state === 'gone') throw new EndpointError('اطلاعات شما حذف شده است؛ دوباره ثبت‌نام کنید.', { code: 'DELETED' });
    return {
      ...await payload(caller, now),
      result: {
        queued: result.state === 'queued',
        registered: true,
        courses: result.found.courses.map(Number),
        ambiguous: !!result.found.ambiguous,
        incomplete: !!result.found.incomplete,
      },
    };
  }
  if (action === 'stop') {
    await stopStudent(caller);
    return { ...await payload(caller, now), result: { notifications: 'paused' } };
  }
  if (action === 'resume') {
    const resumed = await resumeStudent(caller);
    if (resumed.state === 'not-registered') throw new EndpointError('ابتدا ثبت‌نام کنید تا اعلان شخصی فعال شود.', { code: 'NOT_REGISTERED' });
    return { ...await payload(caller, now), result: { notifications: 'on', state: resumed.state } };
  }
  // Delete the short conversation memory without changing consent.
  if (action === 'aiClear') {
    const ai = await aiFacts(caller);
    let memoryCleared = false;
    try {
      await db.run(sql`DELETE FROM ai_threads WHERE scope = ${'u:' + caller}`);
      memoryCleared = true;
    } catch { /* conversation store not provisioned yet */ }
    return { ...await payload(caller, now), result: { aiChat: ai.enabled, memoryCleared } };
  }

  // The optional smart chat. Consent is per caller; turning it off also asks the
  // shared conversation store to drop this user's short memory. If that store is
  // not provisioned yet, consent still turns off and the result says so instead
  // of pretending a deletion happened.
  if (action === 'aiOn' || action === 'aiOff') {
    const enabled = action === 'aiOn';
    if (enabled && !(await aiFacts(caller)).available) {
      throw new EndpointError('گفت‌وگوی هوشمند فعلاً در دسترس نیست.', { code: 'AI_UNAVAILABLE' });
    }
    await putSetting(AI_CONSENT(caller), enabled);
    let memoryCleared = false;
    if (!enabled) {
      try {
        await db.run(sql`DELETE FROM ai_threads WHERE scope = ${'u:' + caller}`);
        memoryCleared = true;
      } catch { /* conversation store not provisioned yet; consent is still off */ }
    }
    return { ...await payload(caller, now), result: { aiChat: enabled, memoryCleared } };
  }
  if (action === 'forget') {
    // Personal-data deletion: the subscription row (Telegram id, displayed name,
    // participant id, course list and send receipts) is removed. A cooperation
    // connection contributed separately is managed on its own form and stays.
    await forgetSubscriber(caller);
    return { ...await payload(caller, now), result: { deleted: true } };
  }
  throw new EndpointError('درخواست شناخته نشد.', { code: 'BAD_ACTION' });
}
