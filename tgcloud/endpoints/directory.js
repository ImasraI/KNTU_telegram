import { EndpointError } from 'sdk';
import { roleOf } from '../lib/accounts.js';
import { canConnect } from '../lib/authorize.js';
import { courseKey, courseIdFromKey } from '../lib/plan.js';
import { parseCourseCode, deriveLabel, parseSlots, normalizeSpaces } from '../lib/classes.js';
import { setBinding, deleteBinding, setProfessor, deleteProfessor, getBinding, professorMap, bindingMap, detectedBinding } from '../lib/directory.js';
import { getSetting } from '../lib/settings.js';
import { detectClassInfo, directorySummary } from '../lib/monitor.js';

function requireOwner(role) {
  if (role !== 'owner') throw new EndpointError('فقط مدیر ربات می‌تواند تنظیم کلاس‌ها را تغییر دهد.', { code: 'OWNER_ONLY' });
}

async function resolveCourseId(input) {
  const id = Number(input?.courseId ?? courseIdFromKey(input?.key ?? ''));
  if (!Number.isSafeInteger(id) || id <= 0) throw new EndpointError('شمارهٔ درس را وارد کنید.', { code: 'COURSE_ID_REQUIRED' });
  return id;
}

// Owner-only editor for the class directory, readable by every approved account
// holder (a student needs to know which class a notice belongs to). Only course
// teaching information lives here: no grades, submissions or participant data.
export default async function (input, ctx) {
  const callerId = ctx?.initData?.user?.id;
  const role = await roleOf(callerId);
  if (!canConnect(role)) {
    throw new EndpointError('این فرم برای همکاران تأییدشده است. راهنمای /cooperate را ببینید.', { code: 'NOT_APPROVED' });
  }
  const action = input?.action ?? 'list';

  if (action === 'list') {
    const summary = await directorySummary();
    const detection = (await getSetting('courseDetection')) ?? null;
    return { role, owner: role === 'owner', ...summary, detection };
  }

  requireOwner(role);

  if (action === 'resetProfessors') {
    const bindings = await bindingMap();
    for (const [key] of bindings) await setBinding(key, { professorName: null, professorCode: null, source: 'participants' }, callerId);
    return { reset: bindings.size };
  }

  if (action === 'detect') {
    const courseId = input?.courseId ? [await resolveCourseId(input)] : null;
    return await detectClassInfo(courseId, Number(input?.limit) > 0 ? Number(input.limit) : 10);
  }

  if (action === 'professor') {
    throw new EndpointError('نام استاد از فهرست شرکت‌کنندگان دریافت می‌شود.', { code: 'PARTICIPANTS_SOURCE' });
  }

  const courseId = await resolveCourseId(input);
  const key = courseKey({ id: courseId });
  const courses = (await getSetting('courses')) ?? [];
  if (!courses.some(course => String(course.id) === String(courseId))) {
    throw new EndpointError('این درس تحت پوشش ربات نیست.', { code: 'UNKNOWN_COURSE' });
  }
  if (action === 'clear') {
    await deleteBinding(key);
    return { cleared: true, ...(await directorySummary()) };
  }
  if (action === 'set') {
    const patch = { source: 'manual' };
    if (input.code !== undefined) {
      const parsed = parseCourseCode(input.code);
      if (!parsed) throw new EndpointError('شناسهٔ درس معتبر نیست.', { code: 'CODE' });
      patch.code = parsed.code;
      patch.label = input.label !== undefined ? String(input.label).slice(0, 20) : deriveLabel(parsed);
    }
    if (input.label !== undefined) patch.label = normalizeSpaces(input.label).slice(0, 20) || null;
    if (input.slots !== undefined) {
      const slots = input.slots === '' ? [] : typeof input.slots === 'string' ? parseSlots(input.slots) : input.slots;
      if (slots === null) throw new EndpointError('زمان را مانند «9:00 - 10:30» یا «یکشنبه 10:00 - 11:30» وارد کنید.', { code: 'SLOTS' });
      patch.slots = Array.isArray(slots) ? slots.slice(0, 10) : [];
    }
    await setBinding(key, patch, callerId);
    const professors = await professorMap();
    const saved = await detectedBinding(key, await getBinding(key));
    return { saved: { ...saved, professor: saved?.professorName ?? (professors.get(String(saved?.professorCode)) ?? null) } };
  }
  throw new EndpointError('درخواست شناخته نشد.', { code: 'BAD_ACTION' });
}
