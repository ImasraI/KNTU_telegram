import { db, api, fetch } from 'sdk';
import { eq, sql } from 'sdk/db';
import { subscriptions, snapshots } from '../schema.js';
import { enabledAccounts } from './accounts.js';
import { getSetting } from './settings.js';
import { connector } from './moodle.js';
import { courseKey } from './plan.js';
import { courseTitle } from './classes.js';
import { signature, notification } from './content.js';
import { personalItems, itemReceipt, unseenItems, consented, identityText, validFullName } from './student-policy.js';

export const COURSE_SUPPORT = 'اگر فهرست درس‌ها ناقص یا نادرست است، به @Arsam_alaei پیام بدهید.';

export async function registerDetected(tgId, found, requestedName) {
  const row = await subscriber(tgId);
  if (!row) return false;
  const courses = (await getSetting('courses')) ?? [];
  const ids = courses.filter(c => found.courses.includes(String(c.id))).map(c => String(c.id));
  const seen = {};
  for (const course of courses.filter(c => ids.includes(String(c.id)))) {
    for (const item of personalItems(await savedItems(course))) seen[itemReceipt(course.id, item)] = signature(item);
  }
  const live = await subscriber(tgId);
  if (!live) return false; // /forget during a lookup must not recreate the user.
  await saveSubscriber(tgId, { active: !live.profile.paused, seen, profile: {
    ...live.profile, stage: null, pending: null, registered: true, confirmed: true,
    name: found.name ?? requestedName, participantId: found.participantId ?? null,
    ambiguous: !!found.ambiguous, courses: ids, confirmedAt: Date.now(),
  } });
  return true;
}

export async function subscriber(tgId) {
  return (await db.select().from(subscriptions).where(eq(subscriptions.tgId, tgId)).get()) ?? null;
}
export async function saveSubscriber(tgId, patch) {
  const existing = await subscriber(tgId);
  const row = { tgId, active: false, profile: {}, seen: {}, ...existing, ...patch };
  await db.insert(subscriptions).values(row).onConflictDoUpdate({ target: subscriptions.tgId, set: patch }).run();
  return row;
}
export async function forgetSubscriber(tgId) {
  await db.delete(subscriptions).where(eq(subscriptions.tgId, tgId)).run();
}
export async function savedItems(course) {
  const row = await db.select().from(snapshots).where(eq(snapshots.key, courseKey(course))).get()
    ?? await db.select().from(snapshots).where(eq(snapshots.key, String(course.id))).get();
  return Array.isArray(row?.value) ? row.value : [];
}
export async function confirmSubscription(tgId) {
  const row = await subscriber(tgId);
  const pending = row?.profile?.pending;
  if (!pending?.courses?.length || Date.now() - pending.at > 1800000) return false;
  const courses = (await getSetting('courses')) ?? [];
  const selected = courses.filter(c => pending.courses.includes(String(c.id)));
  if (!selected.length) return false;
  const seen = {};
  for (const course of selected) for (const item of personalItems(await savedItems(course))) seen[itemReceipt(course.id, item)] = signature(item);
  await saveSubscriber(tgId, { active: true, seen, profile: {
    ...row.profile, paused: false, pending: null, registered: true,
    // No login username is ever collected; clear any value a legacy rule stored.
    username: null, name: pending.name ?? null,
    courses: selected.map(c => String(c.id)), confirmed: true, confirmedAt: Date.now(),
  } });
  return true;
}

// Notification controls shared by the chat commands and the Mini App, so both
// paths pause, resume and delete identically. Resume always seeds the current
// baseline, which is what keeps a returning reader from a flood of history.
export async function stopStudent(tgId) {
  const user = await subscriber(tgId);
  if (!user) return { state: 'not-registered' };
  await saveSubscriber(tgId, { active: false, profile: { ...user.profile, paused: true, stage: null, pending: null, lookupPending: false } });
  return { state: 'stopped' };
}

export async function resumeStudent(tgId) {
  const user = await subscriber(tgId);
  if (!user || (!consented(user.profile) && !user.profile?.registered)) return { state: 'not-registered' };
  if (!user.profile.courses?.length) {
    await saveSubscriber(tgId, { active: true, profile: { ...user.profile, paused: false } });
    return { state: 'no-courses' };
  }
  await saveSubscriber(tgId, { profile: { ...user.profile, pending: { courses: user.profile.courses, name: user.profile.name, at: Date.now() } } });
  return { state: (await confirmSubscription(tgId)) ? 'resumed' : 'failed' };
}

// Queue registration from the chat or Mini App without university I/O.
// An immediate follow-up resolves the name; scheduled coverage retries failures.
export async function registerStudent(tgId, name) {
  const clean = String(name ?? '').trim();
  if (!validFullName(clean)) return { state: 'name-invalid' };
  const user = await subscriber(tgId);
  if (Date.now() - (user?.profile?.lookupAt ?? 0) < 60000) return { state: 'cooldown' };
  const sameName = identityText(user?.profile?.name) === identityText(clean);
  await saveSubscriber(tgId, { active: !user?.profile?.paused, seen: sameName ? user?.seen ?? {} : {}, profile: {
    ...user?.profile, stage: null, lookupAt: Date.now(), pending: null, username: null,
    name: clean, registered: true, confirmed: true, confirmedAt: Date.now(),
    participantId: sameName ? user?.profile?.participantId ?? null : null,
    courses: sameName ? user?.profile?.courses ?? [] : [],
    rosterChecks: {}, ambiguous: false, lookupPending: true,
  } });
  // Never hold a Telegram update/Mini App request open for university I/O.
  // Immediate or scheduled coverage matching processes the durable request.
  return { state: 'queued', found: { courses: sameName ? user?.profile?.courses ?? [] : [], incomplete: true } };
}

// Search only exact matches, never return rosters. Approval to contribute a
// credential and confirmation of a personal course selection are separate.
export async function findStudentCourses(query) {
  const allCourses = (await getSetting('courses')) ?? [];
  const courses = allCourses.slice(0, 60);
  const accounts = (await enabledAccounts()).filter(a => a.mode === 'session');
  const matches = [], failures = [];
  const people = new Set();
  let name = null;
  const now = Date.now();
  const leaseUntil = now + 120000;
  const claim = await db.run(sql`INSERT INTO leases (key, until) VALUES ('participant_lookup', ${leaseUntil}) ON CONFLICT(key) DO UPDATE SET until = excluded.until WHERE leases.until < ${now}`);
  if (!claim.rowsAffected) throw new Error('LOOKUP_BUSY');
  let incomplete = allCourses.length > courses.length;
  try {
  for (const course of courses) {
    if (Date.now() - now > 45000) { incomplete = true; break; }
    let read = false;
    for (const account of accounts) {
      try {
        const found = await connector(fetch, account).findParticipant(course, query);
        read = true;
        for (const person of found) { people.add(person.id); name = person.name; }
        if (found.length) matches.push(String(course.id));
        break;
      } catch { /* another enrolled reader may have access */ }
    }
    if (!read) failures.push(String(course.id));
  }
  return { courses: people.size > 1 ? [] : [...new Set(matches)], name,
    participantId: people.size === 1 ? [...people][0] : null,
    ambiguous: people.size > 1, incomplete: incomplete || failures.length > 0 };
  } finally {
    await db.run(sql`UPDATE leases SET until = 0 WHERE key = 'participant_lookup' AND until = ${leaseUntil}`);
  }
}

// New coverage is checked once per roster for all matching subscribers. This
// also retries inaccessible lists and empty registrations daily. Never unpauses
// someone and never removes established courses on a reduced participant view.
export async function refreshRegistration(tgId) {
  const user = await subscriber(tgId);
  if (!user?.active || !user.profile?.lookupPending) return;
  const now = Date.now(), until = now + 120000, key = `student_lookup:${tgId}`;
  const claim = await db.run(sql`INSERT INTO leases (key, until) VALUES (${key}, ${until}) ON CONFLICT(key) DO UPDATE SET until = excluded.until WHERE leases.until < ${now}`);
  if (!claim.rowsAffected) return;
  try {
    const courses = (await getSetting('courses')) ?? [];
    return await refreshStudentCoverage(courses.map(course => ({ course })), { tgId });
  } finally {
    await db.run(sql`UPDATE leases SET until = 0 WHERE key = ${key} AND until = ${until}`);
  }
}

export async function refreshStudentCoverage(plan, { readRoster, now = Date.now(), budgetMs = 45000, tgId } = {}) {
  const users = (await db.select().from(subscriptions).all()).filter(user => tgId === undefined || user.tgId === tgId);
  const accounts = readRoster ? [] : (await enabledAccounts()).filter(a => a.mode === 'session');
  const coverageEpoch = Number(await getSetting('coverageRefreshAt')) || 0;
  let added = 0, checked = 0, failed = 0, incomplete = false;
  const pendingMatches = new Map();
  for (const entry of plan) {
    if (Date.now() - now > budgetMs) { incomplete = true; break; }
    const id = String(entry.course.id);
    const candidates = users.filter(u => (u.profile?.registered || u.profile?.confirmed) && u.profile?.name && !u.profile?.ambiguous
      && !u.profile.courses?.includes(id)
      && Number(u.profile.rosterChecks?.[id] ?? 0) < Math.max(coverageEpoch, now - 86400000));
    if (!candidates.length) continue;
    const queries = candidates.map(u => ({ name: u.profile.name, id: u.profile.participantId }));
    let people;
    if (readRoster) {
      try { people = await readRoster(entry.course, queries); } catch { failed++; continue; }
    } else {
      for (const account of accounts.filter(a => !entry.readers?.length || entry.readers.includes(a.id))) {
        try { people = await connector(fetch, account).findParticipants(entry.course, queries); break; }
        catch { /* try another reader; leave failures eligible for next scan */ }
      }
    }
    if (!people) { failed++; continue; }
    checked++;
    for (const candidate of candidates) {
      const live = await subscriber(candidate.tgId);
      if (!live || live.profile.name !== candidate.profile.name) continue;
      const found = people.filter(p => live.profile.participantId ? String(p.id) === String(live.profile.participantId)
        : identityText(p.name) === identityText(live.profile.name));
      const identities = [...new Set(found.map(p => String(p.id)))];
      // New identities must be checked across every covered roster before choosing
      // a Moodle id: the same displayed name may belong to different people.
      if (live.profile.lookupPending && !live.profile.participantId) {
        const pending = pendingMatches.get(live.tgId) ?? { ids: new Set(), courses: [], checks: {} };
        for (const identity of identities) pending.ids.add(identity);
        if (identities.length) pending.courses.push(entry.course);
        pending.checks[id] = now;
        pendingMatches.set(live.tgId, pending);
        continue;
      }
      const profile = { ...live.profile, rosterChecks: { ...live.profile.rosterChecks, [id]: now } };
      const patch = { profile };
      if (identities.length > 1 && !profile.participantId) profile.ambiguous = true;
      if (identities.length === 1 && !profile.courses?.includes(id)) {
        profile.courses = [...(profile.courses ?? []), id];
        profile.participantId = identities[0];
        profile.registered = true;
        profile.confirmed = true;
        profile.confirmedAt ??= now;
        patch.seen = { ...live.seen };
        // Existing contents of a newly covered class are not a flood of alerts.
        for (const item of personalItems(await savedItems(entry.course))) patch.seen[itemReceipt(id, item)] = signature(item);
        added++;
      }
      await saveSubscriber(candidate.tgId, patch);
    }
  }
  if (!failed && !incomplete) for (const [tgId, pending] of pendingMatches) {
    const live = await subscriber(tgId);
    const initial = users.find(user => user.tgId === tgId);
    if (!live?.profile?.lookupPending || live.profile.lookupAt !== initial?.profile?.lookupAt) continue;
    const ambiguous = pending.ids.size > 1;
    const courses = ambiguous ? [] : pending.courses;
    const seen = { ...live.seen };
    for (const course of courses) for (const item of personalItems(await savedItems(course))) seen[itemReceipt(course.id, item)] = signature(item);
    await saveSubscriber(tgId, { seen, profile: { ...live.profile, ambiguous,
      participantId: pending.ids.size === 1 ? [...pending.ids][0] : null,
      courses: courses.map(course => String(course.id)), rosterChecks: pending.checks } });
    added += courses.length;
  }
  let reported = 0;
  for (const initial of users) {
    if (reported >= 20) break;
    const live = await subscriber(initial.tgId);
    if (!live?.active || !live.profile?.lookupPending || live.profile.name !== initial.profile.name) continue;
    const found = plan.filter(entry => live.profile.courses?.includes(String(entry.course.id)));
    const names = found.map(entry => '• ' + courseTitle(entry.course.fullname));
    try {
      await api.sendMessage({ chat_id: live.tgId, text: [
        live.profile.ambiguous ? 'چند نفر با نام شما پیدا شدند؛ برای بررسی به @Arsam_alaei پیام بدهید.' : found.length ? `✅ ${found.length} درس برای شما شناسایی شد؛ اعلان شخصی فعال است.` : 'بررسی ثبت‌نام انجام شد؛ فعلاً درسی برای شما شناسایی نشد.',
        ...names.slice(0, 30), failed || incomplete || !plan.length ? 'بعضی فهرست‌های دانشگاه قابل خواندن نبودند؛ ممکن است نتیجه ناقص باشد.' : '',
        '/mycourses برای دیدن درس‌ها؛ /stop برای توقف اعلان‌ها', COURSE_SUPPORT,
      ].filter(Boolean).join('\n').slice(0, 3900) });
      const current = await subscriber(live.tgId);
      if (current?.profile?.lookupAt === live.profile.lookupAt) await saveSubscriber(live.tgId, { profile: { ...current.profile, lookupPending: !!(failed || incomplete || !plan.length) } });
      reported++;
    } catch { /* leave the durable result pending for the next scan */ }
  }
  return { added, checked, failed, reported };
}

// Independent of public-send bookkeeping: failed private sends remain unseen and
// are retried on the next scan. Only confirmed selections receive future changes.
export async function deliverPersonal(courses, lineFor, max = 100) {
  const users = await db.select().from(subscriptions).all();
  const cache = new Map();
  let sent = 0, failed = 0;
  for (const initial of users) {
    if (!initial.active || !consented(initial.profile)) continue;
    for (const course of courses.filter(c => initial.profile.courses.includes(String(c.id)))) {
      if (!cache.has(String(course.id))) cache.set(String(course.id), await savedItems(course));
      const items = cache.get(String(course.id));
      for (const item of unseenItems(course.id, items, initial.seen)) {
        if (sent + failed >= max) return { sent, failed, limited: true };
        const live = await subscriber(initial.tgId);
        if (!live?.active || !consented(live.profile) || !live.profile.courses.includes(String(course.id))) break;
        // Changing/reconfirming selections must not send stale in-flight work.
        if (live.profile.confirmedAt !== initial.profile.confirmedAt) break;
        try {
          const old = live.seen?.[itemReceipt(course.id, item)];
          if (old === signature(item)) continue;
          await api.sendMessage({ chat_id: initial.tgId,
            text: notification(course, { ...item, change: old ? 'updated' : 'new' }, { classLine: lineFor(course) }),
            link_preview_options: { is_disabled: true } });
          initial.seen = { ...live.seen, [itemReceipt(course.id, item)]: signature(item) };
          await db.update(subscriptions).set({ seen: initial.seen }).where(eq(subscriptions.tgId, initial.tgId)).run();
          sent++;
        } catch (error) {
          failed++;
          if (error?.code === 403) await db.update(subscriptions).set({ active: false }).where(eq(subscriptions.tgId, initial.tgId)).run();
          if (error?.code === 429) return { sent, failed, limited: true };
          break;
        }
      }
    }
  }
  return { sent, failed };
}
