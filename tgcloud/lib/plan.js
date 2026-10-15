// Pure course coverage plan. No SDK imports.
//
// Identity rules (see README "Coverage and limits"):
// - a course is identified by university origin + Moodle course id, so two
//   accounts never double-count the same course even when they read it from
//   different sections/professor groups;
// - courses that share a name but have different Moodle ids stay separate;
// - activities belong to their course and are identified by module id.
import { ORIGIN } from './config.js';

export function courseKey(course) {
  return `${course.origin ?? ORIGIN}#${course.id}`;
}

export function courseIdFromKey(key) {
  const text = String(key ?? '');
  const at = text.lastIndexOf('#');
  return at === -1 ? text : text.slice(at + 1);
}

// enrollments: [{ accountId, courses: [{ id, fullname, origin? }] }]
// Returns one entry per distinct course with the reader order: accounts that
// discovered it, in discovery order (first = preferred reader).
export function planCourses(enrollments) {
  const plan = new Map();
  for (const enrollment of enrollments ?? []) {
    for (const course of enrollment?.courses ?? []) {
      const normalized = { id: Number(course.id), fullname: String(course.fullname ?? ''), origin: course.origin ?? ORIGIN };
      if (!Number.isSafeInteger(normalized.id) || normalized.id <= 0) continue;
      const key = courseKey(normalized);
      const entry = plan.get(key) ?? { key, course: normalized, readers: [] };
      if (!entry.readers.includes(enrollment.accountId)) entry.readers.push(enrollment.accountId);
      plan.set(key, entry);
    }
  }
  return [...plan.values()];
}

export function courseList(plan) {
  return plan.map(entry => entry.course);
}

export function coveredKeys(plan, failures) {
  const failed = new Set((failures ?? []).map(f => f.course));
  return plan.map(entry => entry.key).filter(key => !failed.has(key));
}

// A course that already had a baseline but was not covered this scan, or that
// vanished from every enrollment, counts as lost coverage.
export function lostCoverage(knownKeys, covered) {
  const have = new Set(covered ?? []);
  return [...new Set(knownKeys ?? [])].filter(key => !have.has(key));
}
