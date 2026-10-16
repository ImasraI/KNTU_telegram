// View shaping for the public student Mini App. Pure: no SDK imports, so it runs
// under `node --test`.
//
// Three rules live here rather than in the endpoint, because they are about what a
// student is allowed to see:
//   1. the long 13-digit university code never leaves the server — a student
//      recognises a class by its weekly time or its two-digit class number;
//   2. only university links survive into a response, with credential-bearing URLs
//      dropped (the same rule the notification formatter already applies);
//   3. a personal view is built only from the caller's own row.
import { ORIGIN } from './config.js';
import { kindLabel } from './content.js';
import { formatSlots, professorLabel } from './classes.js';
import { isExam, personalItems } from './student-policy.js';

// The scheduled check runs every 30 minutes (see docs/cloudflare-setup.md). One
// missed run is still "fresh"; after that the app says so instead of pretending.
export const CHECK_INTERVAL_MINUTES = 30;
export const CHECK_INTERVAL_MS = CHECK_INTERVAL_MINUTES * 60 * 1000;
export const FRESH_WINDOW_MS = CHECK_INTERVAL_MS * 2;
export const AGING_WINDOW_MS = CHECK_INTERVAL_MS * 8;
export const PAGE_SIZE = 40;
export const MAX_ITEMS_PER_COURSE = 300;
export const SHORT_DESCRIPTION = 180;

const KIND_BUCKETS = { assign: 'assign', resource: 'file', folder: 'file', book: 'file', page: 'file' };
export const FILTERS = ['all', 'assign', 'exam', 'file', 'notice'];
const FRESH_LABELS = { fresh: 'تازه', aging: 'کمی قدیمی', stale: 'قدیمی', unknown: 'نامشخص' };

// Number (ms), Date (the snapshots.updated_at column) or ISO string → ms.
export function atMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// How old a scan is, in the student's terms: fresh, a bit old, or stale.
export function freshness(value, now = Date.now()) {
  const ms = atMs(value);
  if (ms === null) return { at: null, ageSeconds: null, state: 'unknown', label: FRESH_LABELS.unknown };
  const ageSeconds = Math.max(0, Math.round((Number(now) - ms) / 1000));
  const age = ageSeconds * 1000;
  const state = age <= FRESH_WINDOW_MS ? 'fresh' : age <= AGING_WINDOW_MS ? 'aging' : 'stale';
  return { at: new Date(ms).toISOString(), ageSeconds, state, label: FRESH_LABELS[state] };
}

export function universityUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(ORIGIN + '/')) return null;
  if (/[?&](?:token|wstoken|sesskey|password)=/i.test(value)) return null;
  return value;
}

// One covered course as a student sees it: name, class number or weekly time, the
// professor detected from the Participants استاد role, and activity counts. The
// directory's `code`, `codeFromName` and `siteCode` are deliberately dropped.
export function courseView(entry, extras = {}) {
  if (!entry) return null;
  const binding = entry.binding ?? {};
  const professor = binding.professor ?? binding.professorName ?? null;
  return {
    id: Number(entry.id),
    name: String(entry.name ?? ''),
    classLabel: formatSlots(binding.slots) || (binding.label ? `کلاس ${binding.label}` : null),
    professor: professor ? professorLabel(professor) : null,
    ...extras,
  };
}

export function bucketOf(item) {
  if (!item) return 'notice';
  if (item.kind === 'assign') return 'assign';
  if (isExam(item)) return 'exam';
  return KIND_BUCKETS[item.kind] ?? 'notice';
}

// Counts for the course cards.
export function courseCounts(items) {
  const buckets = { assign: 0, exam: 0, file: 0, notice: 0 };
  for (const item of personalItems(Array.isArray(items) ? items : [])) buckets[bucketOf(item)]++;
  return { ...buckets, total: buckets.assign + buckets.exam + buckets.file + buckets.notice };
}

// The student-facing slice of a saved course baseline, filtered by kind.
export function selectItems(items, filter = 'all') {
  const wanted = FILTERS.includes(filter) ? filter : 'all';
  const list = personalItems(Array.isArray(items) ? items : []).slice(0, MAX_ITEMS_PER_COURSE);
  return wanted === 'all' ? list : list.filter(item => bucketOf(item) === wanted);
}

export function itemView(item, mode = 'full') {
  const description = item?.description ? String(item.description) : '';
  const limit = mode === 'short' ? SHORT_DESCRIPTION : 700;
  return {
    id: item?.id ?? null,
    kind: String(item?.kind ?? ''),
    kindLabel: kindLabel(item?.kind),
    bucket: bucketOf(item),
    name: String(item?.name ?? '').slice(0, 200),
    dates: item?.dates ? String(item.dates).slice(0, 300) : null,
    description: description ? description.slice(0, limit) + (description.length > limit ? '…' : '') : null,
    url: universityUrl(item?.url),
    files: (Array.isArray(item?.files) ? item.files : []).slice(0, 20)
      .map(file => ({ name: String(file?.name ?? '').slice(0, 200), url: universityUrl(file?.url) }))
      .filter(file => file.name || file.url),
  };
}

// One page of shaped items: the Mini App asks for more instead of downloading a
// whole course, so a course with hundreds of resources stays responsive.
export function pageItems(items, offset = 0, size = PAGE_SIZE, mode = 'full') {
  const list = Array.isArray(items) ? items : [];
  const start = Math.max(0, Number(offset) || 0);
  return {
    items: list.slice(start, start + size).map(item => itemView(item, mode)),
    total: list.length, offset: start, hasMore: start + size < list.length,
  };
}

// The caller's own registration and notification state. Only ever built from the
// caller's row, and it carries no credential, no Moodle id and nobody else's name.
export function studentState(row) {
  const profile = row?.profile ?? {};
  const courses = Array.isArray(profile.courses) ? profile.courses.map(String) : [];
  return {
    registered: !!profile.registered,
    notifications: row?.active ? 'on' : profile.paused ? 'paused' : 'off',
    name: profile.name ?? null,
    courses,
    ambiguous: !!profile.ambiguous,
    exactIdentity: !!profile.participantId,
    registeredAt: profile.confirmedAt ? new Date(profile.confirmedAt).toISOString() : null,
  };
}

// The newest per-course reading in a course list, in ms (null when none is known).
export function newestRead(courses) {
  let ms = null;
  for (const course of Array.isArray(courses) ? courses : []) {
    const value = atMs(course?.scan?.at ?? null);
    if (value !== null && (ms === null || value > ms)) ms = value;
  }
  return ms;
}

// Coverage health for the header badge. Two different facts, kept apart:
//   `recorded` — the last scan that finished and stored its summary (courses read,
//                failures, lost coverage);
//   `check`    — how fresh the newest information on screen is.
// They differ when a scan reads courses and is then cut short before recording its
// summary, which happens while the number of connected accounts grows. The badge
// follows the newest reading so it cannot contradict the per-course timestamps,
// and the recorded scan is still reported instead of being hidden.
// Account-level health stays out of a student-facing response.
export function coverageView(status, courseCount, now = Date.now(), newestReadAt = null) {
  const failed = Array.isArray(status?.failures) ? status.failures.length : 0;
  const lost = Array.isArray(status?.lost) ? status.lost.length : 0;
  const recordedAt = atMs(status?.checkedAt ?? null);
  const newest = atMs(newestReadAt);
  const latest = newest === null ? recordedAt : recordedAt === null ? newest : Math.max(recordedAt, newest);
  return {
    courses: Number(courseCount) || 0,
    lastCheckAt: latest === null ? null : new Date(latest).toISOString(),
    check: freshness(latest === null ? null : new Date(latest), now),
    recorded: {
      at: recordedAt === null ? null : new Date(recordedAt).toISOString(),
      check: freshness(recordedAt === null ? null : new Date(recordedAt), now),
      reason: status?.reason ?? null,
      failedCourses: failed,
      lostCourses: lost,
      olderThanReads: recordedAt !== null && newest !== null && newest - recordedAt > 60000,
    },
    reason: status?.reason ?? null,
    partial: failed + lost > 0,
    failedCourses: failed,
    lostCourses: lost,
    intervalMinutes: CHECK_INTERVAL_MINUTES,
  };
}

// The help tab is server-driven, so the app never restates policy on its own.
export function helpView({ commands, privacy, support, contact, label, prompt, hint }) {
  return {
    commands: commands ?? [], privacy: privacy ?? '', support: support ?? '', contact: contact ?? '',
    fullNameLabel: label ?? '', fullNamePrompt: prompt ?? '', fullNameHint: hint ?? '',
    intervalMinutes: CHECK_INTERVAL_MINUTES,
  };
}
