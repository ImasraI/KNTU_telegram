import { api, fetch } from 'sdk';
import { db } from './database.js';
import { eq, sql } from './database.js';
import { snapshots } from '../schema.js';
import { GROUP_ID, ORIGIN, OWNER_ID, COVERAGE_NOTICE_COOLDOWN_MS, SESSION_NOTICE_COOLDOWN_MS } from './config.js';
import { getSetting, putSetting } from './settings.js';
import { connector, classifyCode, failureCode } from './moodle.js';
import { notification, digest } from './content.js';
import { syncCourses } from './sync.js';
import { planCourses, courseKey, courseIdFromKey, courseList, coveredKeys, lostCoverage } from './plan.js';
import { destinationFrom, sendTarget, describeDestination } from './destination.js';
import { bindingMap, professorMap, professorRows, bindingView, detectedBinding, refreshProfessor } from './directory.js';
import { classLine, describeBinding, parseCourseCode, courseTitle, deriveLabel } from './classes.js';
import { enabledAccounts, ensureMigrated, setHealth } from './accounts.js';
import { notifyOnce } from './notify.js';
import { noticeKey } from './notice-policy.js';
import { deliverPersonal, refreshStudentCoverage } from './subscriptions.js';

export { getSetting, putSetting } from './settings.js';

const SCAN_LEASE_MS = 600000;

export async function resolveDestination() {
  const value = await getSetting('destination');
  const legacy = (await getSetting('groupId')) ?? GROUP_ID;
  return destinationFrom(value, legacy);
}

export async function sendToDestination(text) {
  const destination = await resolveDestination();
  if (!destination) throw new Error('GROUP_NOT_CONFIGURED');
  return await api.sendMessage({ ...sendTarget(destination), text, link_preview_options: { is_disabled: true } });
}

// One shared baseline per course, keyed by origin + course id. Snapshots written
// by the single-account version (key = plain course id) are still read, so the
// existing nine baselines keep counting.
async function loadSnapshot(key) {
  const row = await db.select().from(snapshots).where(eq(snapshots.key, key)).get();
  if (row) return { items: row.value ?? [], reader: row.reader ?? null };
  const legacyKey = courseIdFromKey(key);
  if (legacyKey !== key) {
    const legacy = await db.select().from(snapshots).where(eq(snapshots.key, legacyKey)).get();
    if (legacy) return { items: legacy.value ?? [], reader: legacy.reader ?? null };
  }
  return undefined;
}

async function saveSnapshot(key, items, reader) {
  const set = { value: items, reader: reader ?? null, updatedAt: new Date() };
  await db.insert(snapshots).values({ key, ...set }).onConflictDoUpdate({ target: snapshots.key, set }).run();
}

function sessionText(account) {
  return ['⚠️ اتصال حساب دانشگاهی «' + (account.label || account.id) + '» منقضی شده است.',
    'دوره‌های این حساب خوانده نمی‌شوند تا زمانی که اتصال تازه‌سازی شود.',
    'برای تازه‌سازی: در چت خصوصی ربات /setup را بزنید و «فرم خصوصی اتصال دانشگاه» را باز کنید.',
    account.code ? '(کد: ' + account.code + ')' : ''].filter(Boolean).join('\n');
}

function coverageText(lostKeys, knownCourses) {
  const names = lostKeys.map(key => {
    const course = knownCourses.find(c => courseKey(c) === key);
    return '• ' + courseTitle(course?.fullname ?? key);
  });
  return ['⚠️ پوشش دوره‌ها کاهش یافت: ' + lostKeys.length + ' دوره در این بررسی خوانده نشد.',
    ...names.slice(0, 15),
    lostKeys.length > 15 ? '…و ' + (lostKeys.length - 15) + ' دوره دیگر.' : '',
    'اگر جلسه یک حساب منقضی شده باشد، به صاحب همان حساب پیام خصوصی ارسال شده است.',
    'دوره‌های خوانده‌شده بدون تغییر ادامه می‌دهند.'].filter(Boolean).join('\n');
}

export async function scan({ reason = 'manual' } = {}) {
  await ensureMigrated();
  const destination = await resolveDestination();
  if (!destination) throw new Error('GROUP_NOT_CONFIGURED');
  const target = sendTarget(destination);
  const accounts = await enabledAccounts();
  if (!accounts.length) throw new Error('UNIVERSITY_NOT_CONFIGURED');
  const knownCourses = (await getSetting('courses')) ?? [];

  const now = Date.now();
  // One atomic claim, including when no lease exists yet.
  const claimed = await db.run(sql`INSERT INTO leases (key, until) VALUES ('scan', ${now + SCAN_LEASE_MS}) ON CONFLICT(key) DO UPDATE SET until = excluded.until WHERE leases.until < ${now}`);
  if (!claimed.rowsAffected) return { busy: true };

  const checkedAt = new Date().toISOString();
  // Manual bindings override names detected from the Participants استاد role.
  const professors = await professorMap();
  const bindings = await bindingMap();
  const manualBindings = new Map(bindings);
  for (const course of knownCourses) {
    const key = courseKey(course);
    const binding = await detectedBinding(key, bindings.get(key));
    if (binding) bindings.set(key, binding);
  }
  const siteCodes = ((await getSetting('siteCourseCodes'))?.codes) ?? {};
  const lineCache = new Map();
  const lineFor = course => {
    const key = courseKey(course);
    if (!lineCache.has(key)) lineCache.set(key, classLine(bindings.get(key), professors, siteCodes[String(course.id)] ?? null));
    return lineCache.get(key);
  };
  try {
    // 1. Discover enrollment for every enabled account. One broken session only
    //    removes that account from the plan.
    const readers = new Map();
    const enrollments = [];
    const discovery = new Map();
    for (const account of accounts) {
      try {
        const moodle = connector(fetch, { mode: account.mode, secret: account.secret });
        const courses = await moodle.courses();
        readers.set(account.id, moodle);
        enrollments.push({ accountId: account.id, courses });
        discovery.set(account.id, { state: 'ok', code: null, courses: courses.length });
      } catch (e) {
        const state = classifyCode(failureCode(e));
        discovery.set(account.id, { state, code: failureCode(e), courses: 0 });
      }
    }

    // 2. One plan for the union of enrollments (origin + course id, plus the
    //    reader order used when an account cannot read a course).
    const plan = enrollments.length ? planCourses(enrollments) : [];
    if (plan.length) await putSetting('courses', courseList(plan));

    const attemptFailures = new Map();
    let counts = { sent: 0, baselined: 0, readerChanges: 0, absorbed: 0, baselineKeys: [], failures: [] };
    if (plan.length) {
      counts = await syncCourses({
        courses: plan.map(entry => ({ ...entry.course, readers: entry.readers })),
        read: async (course, readerId) => {
          const moodle = readers.get(readerId);
          if (!moodle) throw new Error('ACCOUNT_UNAVAILABLE');
          // Metadata failures must never prevent assignment checks. Session-mode
          // names are cached for a day and manual professor bindings take priority.
          if (accounts.find(a => a.id === readerId)?.mode === 'session') {
            try {
              const key = courseKey(course);
              await refreshProfessor(key, moodle);
              const binding = await detectedBinding(key, manualBindings.get(key));
              if (binding) bindings.set(key, binding);
              else bindings.delete(key);
              lineCache.delete(key);
            } catch { /* retain previously detected name */ }
          }
          return await moodle.items(course);
        },
        load: loadSnapshot,
        save: saveSnapshot,
        send: async (course, item) => {
          const lease = await db.get(sql`SELECT until FROM leases WHERE key = 'scan'`);
          if (lease?.until !== now + SCAN_LEASE_MS || Date.now() >= lease.until) throw new Error('SCAN_LEASE_EXPIRED');
          await api.sendMessage({ ...target, text: notification(course, item, { classLine: lineFor(course) }), link_preview_options: { is_disabled: true } });
        },
        onAttemptError: (course, readerId, error) => {
          if (!readerId) return;
          const list = attemptFailures.get(readerId) ?? [];
          list.push(failureCode(error));
          attemptFailures.set(readerId, list);
        },
      });
    }

    // 3. Per-account health. A read that failed for one account is recorded there;
    //    the course itself is only a failure when every reader failed.
    const health = [];
    for (const account of accounts) {
      const base = discovery.get(account.id) ?? { state: 'unknown', code: null, courses: 0 };
      const codes = attemptFailures.get(account.id) ?? [];
      const auth = codes.find(c => classifyCode(c) === 'auth');
      const state = auth ? 'auth' : codes.length ? 'partial' : base.state;
      const entry = {
        id: account.id, ownerId: account.ownerId, label: account.label,
        state, code: auth ?? base.code, courses: base.courses || null, readFailures: codes.length,
      };
      await setHealth(account.id, { ...entry, at: checkedAt, lastScanAt: checkedAt, migratedFrom: undefined });
      health.push(entry);
    }

    // 4. Private warnings: account holders first, then the owner for lost coverage.
    //    The public destination never receives an authentication error.
    const warnings = [];
    for (const entry of health) {
      if (entry.state !== 'auth') continue;
      warnings.push(await notifyOnce({
        key: noticeKey('expired', entry.id), tgId: entry.ownerId,
        text: sessionText(entry), cooldownMs: SESSION_NOTICE_COOLDOWN_MS, now,
      }));
    }
    const covered = coveredKeys(plan, counts.failures);
    const lost = lostCoverage(knownCourses.map(courseKey), covered);
    if (lost.length) {
      warnings.push(await notifyOnce({
        key: noticeKey('coverage', OWNER_ID), tgId: OWNER_ID,
        text: coverageText(lost, knownCourses), cooldownMs: COVERAGE_NOTICE_COOLDOWN_MS, now,
      }));
    }

    // 5. Newly discovered courses keep their pending initial digest for the owner.
    if (counts.baselineKeys.length) {
      const pending = (await getSetting('pendingDigests')) ?? [];
      const merged = [
        ...pending.filter(p => !counts.baselineKeys.includes(p.key)),
        ...counts.baselineKeys.map(key => ({ key, at: checkedAt })),
      ];
      await putSetting('pendingDigests', merged);
    }

    const studentCoverage = await refreshStudentCoverage(plan);
    const personal = await deliverPersonal(courseList(plan), lineFor);
    const result = {
      checkedAt, reason,
      personal,
      studentCoverage,
      accounts: { total: accounts.length, ok: health.filter(h => h.state === 'ok').length, failed: health.filter(h => h.state !== 'ok').length },
      courses: plan.length,
      sent: counts.sent, baselined: counts.baselined, readerChanges: counts.readerChanges, absorbed: counts.absorbed,
      failures: counts.failures,
      lost,
      health,
      warnings: warnings.map(w => ({ sent: w.sent, suppressed: w.suppressed, reason: w.reason ?? null })),
      destination: describeDestination(destination),
      classes: { bound: [...lineCache.values()].filter(Boolean).length },
    };
    await putSetting('status', result);
    if (!enrollments.length) throw new Error('ALL_ACCOUNTS_UNAVAILABLE');
    return result;
  } finally {
    await db.run(sql`UPDATE leases SET until = 0 WHERE key = 'scan' AND until = ${now + SCAN_LEASE_MS}`);
  }
}

// Owner-only: publish the recorded baseline of courses that were discovered after
// the first scan, so adding an account does not silently hide its older items.
export async function publishDigests(onlyCourseIds = null) {
  const destination = await resolveDestination();
  if (!destination) throw new Error('GROUP_NOT_CONFIGURED');
  const pending = (await getSetting('pendingDigests')) ?? [];
  if (!pending.length) return { sent: 0, remaining: 0 };
  const courses = (await getSetting('courses')) ?? [];
  const professors = await professorMap();
  const bindings = await bindingMap();
  for (const course of courses) {
    const key = courseKey(course);
    const binding = await detectedBinding(key, bindings.get(key));
    if (binding) bindings.set(key, binding);
  }
  const siteCodes = ((await getSetting('siteCourseCodes'))?.codes) ?? {};
  const sent = [];
  for (const entry of pending) {
    if (onlyCourseIds?.length && !onlyCourseIds.some(id => String(id) === courseIdFromKey(entry.key))) continue;
    const snapshot = await loadSnapshot(entry.key);
    const course = courses.find(c => courseKey(c) === entry.key)
      ?? { id: Number(courseIdFromKey(entry.key)), fullname: entry.key, origin: ORIGIN };
    await sendToDestination(digest(course, snapshot?.items ?? [], undefined, { classLine: classLine(bindings.get(entry.key), professors, siteCodes[String(course.id)] ?? null) }));
    sent.push(entry.key);
  }
  const remaining = pending.filter(p => !sent.includes(p.key));
  await putSetting('pendingDigests', remaining);
  return { sent: sent.length, remaining: remaining.length };
}

// Owner-triggered evidence gathering: asks the student-visible course pages what
// they actually expose about the class code and the professor, and records the
// answer so the owner can decide what to bind. Never part of a scheduled scan
// (it is one extra request per course) and never sends anything to the group.
export async function detectClassInfo(courseIds = null, limit = 10) {
  const courses = ((await getSetting('courses')) ?? []).filter(course =>
    !courseIds?.length || courseIds.some(id => String(id) === String(course.id)));
  const accounts = await enabledAccounts();
  if (!accounts.length) throw new Error('UNIVERSITY_NOT_CONFIGURED');

  // 1. The "My courses" block carries every enrolled course's full 13-digit code, so
  //    one page usually covers the whole list without a request per course.
  let codes = {};
  let codesSource = null;
  for (const account of accounts) {
    try {
      const moodle = connector(fetch, { mode: account.mode, secret: account.secret });
      const found = await moodle.enrollmentCodes(courses[0]?.id ?? null);
      if (Object.keys(found).length) { codes = found; codesSource = account.id; break; }
    } catch { /* try the next account */ }
  }
  if (Object.keys(codes).length) {
    await putSetting('siteCourseCodes', {
      at: new Date().toISOString(), source: codesSource,
      codes: Object.fromEntries(Object.entries(codes).map(([id, value]) => [String(id), value.code])),
    });
  }

  const results = [];
  for (const course of courses.slice(0, limit)) {
    const fromSite = codes[course.id] ?? codes[String(course.id)] ?? null;
    const entry = { key: courseKey(course), id: course.id, name: course.fullname,
      codeFromName: parseCourseCode(course.fullname)?.code ?? null,
      siteCode: fromSite?.code ?? null, detected: null, error: null };
    for (const account of accounts.filter(a => a.mode === 'session')) {
      try {
        const moodle = connector(fetch, { mode: account.mode, secret: account.secret });
        await refreshProfessor(entry.key, moodle, true);
        const binding = await detectedBinding(entry.key);
        if (binding?.professorName) {
          entry.detected = { available: true, teachers: [binding.professorName], codes: [], source: 'participants' };
          break;
        }
      } catch (e) { entry.error = failureCode(e); }
    }
    // Only fetch a page when the code is still unknown; otherwise the sidebar answered it.
    if (!entry.siteCode) {
      for (const account of accounts) {
        try {
          const moodle = connector(fetch, { mode: account.mode, secret: account.secret });
          const meta = await moodle.meta(course);
          entry.detected = { ...meta, teachers: entry.detected?.teachers ?? meta.teachers };
        } catch (e) { entry.error = failureCode(e); }
        if (entry.detected?.available) break; // a token account cannot render a page
      }
    }
    results.push(entry);
  }
  const record = { at: new Date().toISOString(), courses: results.length, codeSource: codesSource, results };
  await putSetting('courseDetection', record);
  return record;
}

// Current directory state for the Mini App and /classes.
export async function directorySummary() {
  const professors = await professorRows();
  const map = new Map(professors.map(row => [String(row.code), row.name]));
  const bindings = await bindingMap();
  const courses = (await getSetting('courses')) ?? [];
  for (const course of courses) {
    const key = courseKey(course);
    const binding = await detectedBinding(key, bindings.get(key));
    if (binding) bindings.set(key, binding);
  }
  const siteCodes = ((await getSetting('siteCourseCodes'))?.codes) ?? {};
  return {
    professors: professors.map(row => ({ code: row.code, name: row.name })),
    courses: courses.map(course => {
      const binding = bindings.get(courseKey(course));
      const siteCode = siteCodes[String(course.id)] ?? null;
      return {
        key: courseKey(course), id: course.id, name: courseTitle(course.fullname),
        codeFromName: parseCourseCode(course.fullname)?.code ?? null,
        siteCode,
        binding: bindingView(binding, map),
        text: classLine(binding, map, siteCode) ?? 'بدون تنظیم',
        line: classLine(binding, map, siteCode),
      };
    }),
  };
}
