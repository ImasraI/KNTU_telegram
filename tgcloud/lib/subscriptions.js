import { db, api, fetch } from 'sdk';
import { eq, sql } from 'sdk/db';
import { subscriptions, snapshots } from '../schema.js';
import { enabledAccounts } from './accounts.js';
import { getSetting } from './settings.js';
import { connector } from './moodle.js';
import { courseKey } from './plan.js';
import { signature, notification } from './content.js';
import { personalItems, itemReceipt, unseenItems, consented } from './student-policy.js';

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
    username: row.profile.username ?? null, name: pending.name ?? null,
    courses: selected.map(c => String(c.id)), confirmed: true, confirmedAt: Date.now(),
  } });
  return true;
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
    ambiguous: people.size > 1, incomplete: incomplete || failures.length > 0 };
  } finally {
    await db.run(sql`UPDATE leases SET until = 0 WHERE key = 'participant_lookup' AND until = ${leaseUntil}`);
  }
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
