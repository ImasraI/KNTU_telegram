import { EndpointError } from 'sdk';
import { roleOf } from '../lib/accounts.js';
import { canConnect } from '../lib/authorize.js';
import { courseKey, courseIdFromKey } from '../lib/plan.js';
import { parseCourseCode, deriveLabel, parseSlots, normalizeSpaces } from '../lib/classes.js';
import { setBinding, deleteBinding, setProfessor, deleteProfessor, getBinding, professorMap, bindingMap, detectedBinding } from '../lib/directory.js';
import { getSetting } from '../lib/settings.js';
import { detectClassInfo, directorySummary } from '../lib/monitor.js';

function requireOwner(role) {
  if (role !== 'owner') throw new EndpointError('Only the bot owner may change the class directory.', { code: 'OWNER_ONLY' });
}

async function resolveCourseId(input) {
  const id = Number(input?.courseId ?? courseIdFromKey(input?.key ?? ''));
  if (!Number.isSafeInteger(id) || id <= 0) throw new EndpointError('A course id is required.', { code: 'COURSE_ID_REQUIRED' });
  return id;
}

// Owner-only editor for the class directory, readable by every approved account
// holder (a student needs to know which class a notice belongs to). Only course
// teaching information lives here: no grades, submissions or participant data.
export default async function (input, ctx) {
  const callerId = ctx?.initData?.user?.id;
  const role = await roleOf(callerId);
  if (!canConnect(role)) {
    throw new EndpointError('Your Telegram ID is not approved yet. Ask the bot owner to run /approve with your ID.', { code: 'NOT_APPROVED' });
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
    throw new EndpointError('Professor names are read from Participants.', { code: 'PARTICIPANTS_SOURCE' });
  }

  const courseId = await resolveCourseId(input);
  const key = courseKey({ id: courseId });
  const courses = (await getSetting('courses')) ?? [];
  if (!courses.some(course => String(course.id) === String(courseId))) {
    throw new EndpointError('That course is not among the covered courses.', { code: 'UNKNOWN_COURSE' });
  }
  if (action === 'clear') {
    await deleteBinding(key);
    return { cleared: true, ...(await directorySummary()) };
  }
  if (action === 'set') {
    const patch = { source: 'manual' };
    if (input.code !== undefined) {
      const parsed = parseCourseCode(input.code);
      if (!parsed) throw new EndpointError('That course code is not a 13-digit KNTU code.', { code: 'CODE' });
      patch.code = parsed.code;
      patch.label = input.label !== undefined ? String(input.label).slice(0, 20) : deriveLabel(parsed);
    }
    if (input.label !== undefined) patch.label = normalizeSpaces(input.label).slice(0, 20) || null;
    if (input.slots !== undefined) {
      const slots = input.slots === '' ? [] : typeof input.slots === 'string' ? parseSlots(input.slots) : input.slots;
      if (slots === null) throw new EndpointError('Could not read those class times. Use e.g. «یکشنبه 10:00-11:30، سه‌شنبه 8:00-9:30».', { code: 'SLOTS' });
      patch.slots = Array.isArray(slots) ? slots.slice(0, 10) : [];
    }
    await setBinding(key, patch, callerId);
    const professors = await professorMap();
    const saved = await detectedBinding(key, await getBinding(key));
    return { saved: { ...saved, professor: saved?.professorName ?? (professors.get(String(saved?.professorCode)) ?? null) } };
  }
  throw new EndpointError('Unknown action.', { code: 'BAD_ACTION' });
}
